//! Translates `agy --output-format stream-json` NDJSON lines into
//! [`ChatStreamEvent`]s.
//!
//! Every line is `{"event": "<name>", "<name>": { … }}`. One run is:
//! `init` → `step_update`* → `result`.
//!
//! Ref: https://antigravity.google/docs/cli/headless/

use std::collections::HashMap;

use serde_json::Value;

use crate::chat_stream::{AgentUsage, ChatStreamEvent};

const MAX_DETAIL_CHARS: usize = 1200;

pub enum Outcome {
    Emit(ChatStreamEvent),
    /// The run finished; the conversation id can be remembered for
    /// `--conversation`.
    Finished,
    Failed(String),
}

#[derive(Default)]
pub struct AntigravityStream {
    /// Assistant text already forwarded, so a `result` that repeats the whole
    /// reply is not printed twice.
    text: String,
    conversation_id: Option<String>,
    /// Title and input of each tool step by step index: a step is reported
    /// `ACTIVE` then `DONE`, and the `DONE` event may carry no parameters.
    tools: HashMap<u64, (String, Option<String>)>,
}

impl AntigravityStream {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn handle(&mut self, event: &Value) -> Vec<Outcome> {
        match event["event"].as_str().unwrap_or_default() {
            "init" => {
                if let Some(id) = conversation_id(event, &event["init"]) {
                    self.conversation_id = Some(id);
                }
                vec![Outcome::Emit(ChatStreamEvent::Metadata {
                    session_id: self.conversation_id.clone(),
                    usage: None,
                    duration_ms: None,
                    model: event["init"]["model"].as_str().map(str::to_string),
                })]
            }
            "step_update" => {
                let step = &event["step_update"];
                if let Some(id) = conversation_id(event, step) {
                    self.conversation_id = Some(id);
                }
                self.step(step)
            }
            "result" => {
                let result = &event["result"];
                if let Some(id) = conversation_id(event, result) {
                    self.conversation_id = Some(id);
                }
                self.result(result)
            }
            // Newer CLIs may add events; skipping them keeps the run going.
            _ => vec![],
        }
    }

    fn step(&mut self, step: &Value) -> Vec<Outcome> {
        match step["step_type"].as_str().unwrap_or_default() {
            // `text_delta` is incremental: append it as it arrives.
            "agent_response" => {
                let delta = step["text_delta"].as_str().unwrap_or_default();
                if delta.is_empty() {
                    return vec![];
                }
                self.text.push_str(delta);
                vec![Outcome::Emit(ChatStreamEvent::Chunk { text: delta.to_string() })]
            }
            "tool" => vec![Outcome::Emit(self.tool(step))],
            "subagent" => step["subagent_info"]["subagents"]
                .as_array()
                .map(|subagents| {
                    subagents
                        .iter()
                        .map(|sub| {
                            let role = sub["role"].as_str().or_else(|| sub["type_name"].as_str());
                            Outcome::Emit(ChatStreamEvent::Activity {
                                id: sub["conversation_id"].as_str().map(str::to_string),
                                kind: "progress".into(),
                                title: match role {
                                    Some(role) => format!("Subagent: {role}"),
                                    None => "Subagent".into(),
                                },
                                detail: None,
                                done: step["state"].as_str() == Some("DONE"),
                                duration_ms: duration_ms(step),
                            })
                        })
                        .collect()
                })
                .unwrap_or_default(),
            // `user_input` and `checkpoint` carry nothing to show.
            _ => vec![],
        }
    }

    fn tool(&mut self, step: &Value) -> ChatStreamEvent {
        let info = &step["tool_info"];
        let name = step["tool_name"]
            .as_str()
            .or_else(|| info["name"].as_str())
            .unwrap_or_default();
        let params = &info["parameters"];
        let subject = first_str(params, SUBJECT_KEYS).map(str::to_string);
        let fresh_title = match &subject {
            Some(subject) => format!("{}: {}", verb(name), short(subject)),
            None => verb(name),
        };
        // Full input for the expanded row: the command itself, or the args.
        let fresh_input = subject.map(|s| truncate(&s)).or_else(|| {
            let flat = params.to_string();
            (params.is_object() && flat.len() > 2).then(|| truncate(&flat))
        });

        let index = step["step_index"].as_u64();
        let done = step["state"].as_str() == Some("DONE");
        // A `DONE` event may repeat the parameters or leave them out; the
        // `ACTIVE` event's title is kept either way.
        let (title, input) = match index.and_then(|i| self.tools.get(&i)).cloned() {
            Some((title, input)) => (title, input.or(fresh_input)),
            None => (fresh_title, fresh_input),
        };
        match (index, done) {
            (Some(index), false) => {
                self.tools.insert(index, (title.clone(), input.clone()));
            }
            (Some(index), true) => {
                self.tools.remove(&index);
            }
            _ => {}
        }

        let error = info["error"]["message"]
            .as_str()
            .or_else(|| info["error"].as_str())
            .map(str::trim)
            .filter(|e| !e.is_empty());
        let output = match error {
            Some(error) => Some(format!("Error: {}", truncate(error))),
            None => info["output"]
                .as_str()
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(truncate),
        };
        let detail = match (input, output) {
            (Some(input), Some(output)) => Some(format!("{input}\n\n{output}")),
            (input, output) => input.or(output),
        };
        ChatStreamEvent::Activity {
            id: index.map(|i| i.to_string()),
            kind: "tool".into(),
            title: if error.is_some() { format!("{title} (failed)") } else { title },
            detail,
            done,
            duration_ms: duration_ms(step),
        }
    }

    fn result(&mut self, result: &Value) -> Vec<Outcome> {
        let status = result["status"].as_str().unwrap_or("SUCCESS");
        if status != "SUCCESS" {
            let message = result["error"]
                .as_str()
                .map(str::trim)
                .filter(|e| !e.is_empty())
                .map(str::to_string)
                .unwrap_or_else(|| format!("Antigravity ended with status {status}."));
            return vec![Outcome::Failed(message)];
        }
        let mut out = Vec::new();
        // Short answers can arrive only in `result`; longer ones were streamed
        // as deltas already, so only the missing tail is forwarded.
        let response = result["response"].as_str().unwrap_or_default();
        if let Some(tail) = missing_tail(&self.text, response) {
            self.text.push_str(&tail);
            out.push(Outcome::Emit(ChatStreamEvent::Chunk { text: tail }));
        }
        out.push(Outcome::Emit(ChatStreamEvent::Metadata {
            session_id: self.conversation_id.clone(),
            usage: usage(&result["usage"]),
            duration_ms: duration_ms(result),
            model: result["model"].as_str().map(str::to_string),
        }));
        out.push(Outcome::Finished);
        out
    }
}

/// The conversation id sits on the envelope for `init` and inside the payload
/// for the other events.
fn conversation_id(event: &Value, payload: &Value) -> Option<String> {
    event["conversation_id"]
        .as_str()
        .or_else(|| payload["conversation_id"].as_str())
        .map(str::trim)
        .filter(|id| !id.is_empty())
        .map(str::to_string)
}

fn duration_ms(value: &Value) -> Option<u64> {
    value["duration_seconds"]
        .as_f64()
        .filter(|s| *s >= 0.0)
        .map(|s| (s * 1000.0).round() as u64)
}

/// What of `response` was not streamed yet. `None` when it was all seen.
fn missing_tail(seen: &str, response: &str) -> Option<String> {
    if response.is_empty() || seen == response {
        return None;
    }
    if seen.is_empty() {
        return Some(response.to_string());
    }
    // Deltas concatenate into the response, so what's left is the suffix.
    response.strip_prefix(seen).map(str::to_string).filter(|tail| !tail.is_empty())
}

/// Parameter names the Antigravity tools use for their subject, so a step can
/// be titled `Run: npm test` instead of just `Run`.
const SUBJECT_KEYS: &[&str] = &[
    "CommandLine",
    "command",
    "TargetFile",
    "AbsolutePath",
    "file_path",
    "path",
    "Query",
    "query",
    "SearchTerm",
    "pattern",
    "Url",
    "url",
    "SearchDirectory",
    "directory",
];

/// Antigravity's tool names as short verbs, so its steps read like the other
/// agents' steps. Ref: the `tools` array in the stream's `init` event.
fn verb(tool: &str) -> String {
    match tool {
        "run_command" | "command_status" => "Run",
        "view_file" | "view_file_outline" | "read_file" => "Read",
        "write_to_file" | "write_file" => "Write",
        "replace_file_content" | "edit_file" | "multi_edit" => "Edit",
        "list_dir" | "list_directory" => "List",
        "find_by_name" | "glob" => "Find files",
        "grep_search" | "codebase_search" | "search_file_content" => "Search",
        "read_url_content" | "web_fetch" | "read_url" => "Fetch",
        "search_web" | "google_web_search" => "Web search",
        "create_memory" | "save_memory" => "Remember",
        "update_plan" | "write_todos" => "Update plan",
        "ask_permission" => "Ask permission",
        "browser_preview" | "open_browser_url" => "Open browser",
        "" => "Tool",
        other => return other.replace('_', " "),
    }
    .into()
}

fn num(usage: &Value, keys: &[&str]) -> Option<u64> {
    keys.iter().filter_map(|k| usage[*k].as_u64()).next()
}

fn usage(usage: &Value) -> Option<AgentUsage> {
    if !usage.is_object() {
        return None;
    }
    let input = num(usage, &["input_tokens"]);
    let output = num(usage, &["output_tokens"]);
    let cached = num(usage, &["cache_read_tokens"]);
    let reasoning = num(usage, &["thinking_tokens"]);
    if input.is_none() && output.is_none() && cached.is_none() {
        return None;
    }
    Some(AgentUsage {
        input_tokens: input,
        output_tokens: output,
        cache_read_tokens: cached,
        cache_write_tokens: None,
        reasoning_tokens: reasoning,
        total_tokens: num(usage, &["total_tokens"]).or_else(|| input.zip(output).map(|(i, o)| i + o)),
        cost: None,
    })
}

fn first_str<'a>(value: &'a Value, keys: &[&str]) -> Option<&'a str> {
    keys.iter().find_map(|k| value[*k].as_str().filter(|s| !s.is_empty()))
}

/// Keep activity titles to one short line.
fn short(text: &str) -> String {
    const MAX: usize = 80;
    let line = text.lines().next().unwrap_or("").trim();
    if line.chars().count() <= MAX {
        return line.to_string();
    }
    format!("{}…", line.chars().take(MAX).collect::<String>())
}

fn truncate(text: &str) -> String {
    let total = text.chars().count();
    if total <= MAX_DETAIL_CHARS {
        return text.to_string();
    }
    let head: String = text.chars().take(MAX_DETAIL_CHARS).collect();
    format!("{head}… ({total} chars, truncated)")
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn chunks(outcomes: &[Outcome]) -> Vec<String> {
        outcomes
            .iter()
            .filter_map(|o| match o {
                Outcome::Emit(ChatStreamEvent::Chunk { text }) => Some(text.clone()),
                _ => None,
            })
            .collect()
    }

    fn activity(outcome: &Outcome) -> (Option<String>, String, Option<String>, bool) {
        match outcome {
            Outcome::Emit(ChatStreamEvent::Activity { id, title, detail, done, .. }) => {
                (id.clone(), title.clone(), detail.clone(), *done)
            }
            _ => panic!("expected an activity"),
        }
    }

    #[test]
    fn init_reports_the_conversation_and_model() {
        let mut stream = AntigravityStream::new();
        let outcomes = stream.handle(&json!({
            "event": "init",
            "conversation_id": "c1",
            "init": {"cwd": "/w", "tools": ["run_command"], "permission_mode": "request-review", "model": "gemini-3.1-pro-high"}
        }));
        match &outcomes[0] {
            Outcome::Emit(ChatStreamEvent::Metadata { session_id, model, .. }) => {
                assert_eq!(session_id.as_deref(), Some("c1"));
                assert_eq!(model.as_deref(), Some("gemini-3.1-pro-high"));
            }
            _ => panic!("expected metadata"),
        }
    }

    #[test]
    fn response_deltas_stream_and_the_result_adds_only_the_tail() {
        let mut stream = AntigravityStream::new();
        // `user_input` steps carry nothing to show.
        assert!(chunks(&stream.handle(&json!({
            "event": "step_update",
            "step_update": {"conversation_id": "c1", "step_index": 0, "state": "DONE", "step_type": "user_input"}
        })))
        .is_empty());
        assert_eq!(
            chunks(&stream.handle(&json!({
                "event": "step_update",
                "step_update": {"step_index": 2, "state": "ACTIVE", "step_type": "agent_response", "text_delta": "apple"}
            }))),
            vec!["apple"]
        );
        // The terminal result repeats the whole reply: only the tail is new.
        let outcomes = stream.handle(&json!({
            "event": "result",
            "result": {"conversation_id": "c1", "status": "SUCCESS", "response": "apple\n", "duration_seconds": 1.5,
                       "usage": {"input_tokens": 10, "output_tokens": 5, "thinking_tokens": 2, "cache_read_tokens": 3, "total_tokens": 15}}
        }));
        assert_eq!(chunks(&outcomes), vec!["\n"]);
        assert!(matches!(outcomes[outcomes.len() - 1], Outcome::Finished));
        match &outcomes[1] {
            Outcome::Emit(ChatStreamEvent::Metadata { usage, duration_ms, session_id, .. }) => {
                let usage = usage.as_ref().expect("usage");
                assert_eq!(usage.input_tokens, Some(10));
                assert_eq!(usage.reasoning_tokens, Some(2));
                assert_eq!(usage.cache_read_tokens, Some(3));
                assert_eq!(usage.total_tokens, Some(15));
                assert_eq!(*duration_ms, Some(1500));
                assert_eq!(session_id.as_deref(), Some("c1"));
            }
            _ => panic!("expected metadata"),
        }
    }

    #[test]
    fn a_short_reply_arriving_only_in_the_result_still_shows() {
        let mut stream = AntigravityStream::new();
        let outcomes = stream.handle(&json!({
            "event": "result",
            "result": {"status": "SUCCESS", "response": "just this"}
        }));
        assert_eq!(chunks(&outcomes), vec!["just this"]);
    }

    #[test]
    fn tool_steps_keep_their_title_from_active_to_done() {
        let mut stream = AntigravityStream::new();
        let active = stream.handle(&json!({
            "event": "step_update",
            "step_update": {"step_index": 4, "state": "ACTIVE", "step_type": "tool", "tool_name": "run_command",
                            "tool_info": {"name": "run_command", "parameters": {"CommandLine": "echo hi"}}}
        }));
        let (id, title, _, done) = activity(&active[0]);
        assert_eq!(id.as_deref(), Some("4"));
        assert_eq!(title, "Run: echo hi");
        assert!(!done);

        // The `DONE` event carries the output; the title survives.
        let finished = stream.handle(&json!({
            "event": "step_update",
            "step_update": {"step_index": 4, "state": "DONE", "step_type": "tool", "tool_name": "run_command",
                            "duration_seconds": 0.07, "tool_info": {"name": "run_command", "output": "hi\n"}}
        }));
        let (id, title, detail, done) = activity(&finished[0]);
        assert_eq!(id.as_deref(), Some("4"));
        assert_eq!(title, "Run: echo hi");
        assert_eq!(detail.as_deref(), Some("echo hi\n\nhi"));
        assert!(done);
    }

    #[test]
    fn failed_tools_say_so() {
        let mut stream = AntigravityStream::new();
        let outcomes = stream.handle(&json!({
            "event": "step_update",
            "step_update": {"step_index": 1, "state": "DONE", "step_type": "tool", "tool_name": "view_file",
                            "tool_info": {"parameters": {"AbsolutePath": "/a"}, "error": {"type": "NOT_FOUND", "message": "no such file"}}}
        }));
        let (_, title, detail, _) = activity(&outcomes[0]);
        assert_eq!(title, "Read: /a (failed)");
        assert!(detail.as_deref().unwrap().ends_with("Error: no such file"));
    }

    #[test]
    fn a_failed_run_fails_with_its_message() {
        let mut stream = AntigravityStream::new();
        match &stream.handle(&json!({
            "event": "result",
            "result": {"status": "ERROR", "response": "", "error": "invalid model selection"}
        }))[0] {
            Outcome::Failed(message) => assert_eq!(message, "invalid model selection"),
            _ => panic!("expected a failure"),
        }
        // A status with no message still fails, with something readable.
        match &AntigravityStream::new().handle(&json!({"event": "result", "result": {"status": "CANCELED"}}))[0] {
            Outcome::Failed(message) => assert!(message.contains("CANCELED")),
            _ => panic!("expected a failure"),
        }
    }

    /// A whole run, line for line as `agy --output-format stream-json` prints
    /// it. Ref: https://antigravity.google/docs/cli/headless/
    #[test]
    fn a_documented_transcript_reads_back_as_reply_and_steps() {
        const TRANSCRIPT: &str = concat!(
            r#"{"event":"init","conversation_id":"edb1c8c1","init":{"cwd":"/home/user/project","tools":["ask_permission","run_command","write_to_file"],"permission_mode":"request-review"}}"#,
            "\n",
            r#"{"event":"step_update","step_update":{"conversation_id":"edb1c8c1","step_index":0,"state":"DONE","step_type":"user_input"}}"#,
            "\n",
            r#"{"event":"step_update","step_update":{"conversation_id":"edb1c8c1","step_index":4,"state":"DONE","step_type":"tool","tool_name":"run_command","duration_seconds":0.07,"tool_info":{"name":"run_command","parameters":{"CommandLine":"echo hello_headless_demo"},"output":"hello_headless_demo\r\n"}}}"#,
            "\n",
            r#"{"event":"step_update","step_update":{"conversation_id":"edb1c8c1","step_index":5,"state":"ACTIVE","step_type":"agent_response","text_delta":"Ran it: "}}"#,
            "\n",
            r#"{"event":"step_update","step_update":{"conversation_id":"edb1c8c1","step_index":5,"state":"DONE","step_type":"agent_response","text_delta":"hello_headless_demo\n","duration_seconds":6.28,"usage":{"input_tokens":10302,"output_tokens":582,"thinking_tokens":551,"cache_read_tokens":8113,"total_tokens":10884}}}"#,
            "\n",
            r#"{"event":"step_update","step_update":{"conversation_id":"edb1c8c1","step_index":6,"state":"DONE","step_type":"checkpoint","duration_seconds":0.53}}"#,
            "\n",
            r#"{"event":"result","result":{"conversation_id":"edb1c8c1","status":"SUCCESS","response":"Ran it: hello_headless_demo\n","duration_seconds":6.88,"num_turns":1,"usage":{"input_tokens":10418,"output_tokens":589,"thinking_tokens":551,"cache_read_tokens":8113,"total_tokens":11007}}}"#,
        );

        let mut stream = AntigravityStream::new();
        let mut reply = String::new();
        let mut steps: Vec<String> = Vec::new();
        let mut finished = false;
        let mut session = None;
        for line in TRANSCRIPT.lines() {
            let event: Value = serde_json::from_str(line).expect("valid NDJSON");
            for outcome in stream.handle(&event) {
                match outcome {
                    Outcome::Emit(ChatStreamEvent::Chunk { text }) => reply.push_str(&text),
                    Outcome::Emit(ChatStreamEvent::Activity { title, done, .. }) if done => steps.push(title),
                    Outcome::Emit(ChatStreamEvent::Metadata { session_id, .. }) => {
                        session = session.or(session_id)
                    }
                    Outcome::Emit(_) => {}
                    Outcome::Finished => finished = true,
                    Outcome::Failed(message) => panic!("unexpected failure: {message}"),
                }
            }
        }
        assert_eq!(reply, "Ran it: hello_headless_demo\n");
        assert_eq!(steps, vec!["Run: echo hello_headless_demo"]);
        assert_eq!(session.as_deref(), Some("edb1c8c1"));
        assert!(finished, "the result event ends the run");
    }

    #[test]
    fn unknown_events_are_skipped() {
        let mut stream = AntigravityStream::new();
        assert!(stream.handle(&json!({"event": "future_thing", "future_thing": {}})).is_empty());
    }
}
