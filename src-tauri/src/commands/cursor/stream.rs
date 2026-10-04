//! Translates `cursor-agent --output-format stream-json` lines into [`ChatStreamEvent`]s.

use serde_json::Value;

use crate::chat_stream::{AgentUsage, ChatStreamEvent};

const MAX_DETAIL_CHARS: usize = 1200;

pub enum Outcome {
    Emit(ChatStreamEvent),
    /// The run finished; carries the session id to remember.
    Finished,
    Failed(String),
}

#[derive(Default)]
pub struct CursorStream {
    /// Text already forwarded. With `--stream-partial-output` each `assistant`
    /// event is a delta, but the final one repeats the whole reply, so the
    /// overlap has to be dropped instead of printed twice.
    text: String,
}

impl CursorStream {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn handle(&mut self, event: &Value) -> Vec<Outcome> {
        let subtype = event["subtype"].as_str().unwrap_or_default();
        match event["type"].as_str().unwrap_or_default() {
            "system" if subtype == "init" => vec![Outcome::Emit(ChatStreamEvent::Metadata {
                session_id: event["session_id"].as_str().map(str::to_string),
                usage: None,
                duration_ms: None,
                model: event["model"].as_str().map(str::to_string),
            })],
            "thinking" if subtype == "delta" => match event["text"].as_str() {
                Some(text) if !text.is_empty() => vec![Outcome::Emit(ChatStreamEvent::Reasoning {
                    reasoning: text.to_string(),
                })],
                _ => vec![],
            },
            "assistant" => self.on_assistant(event),
            "tool_call" => tool_activity(event, subtype).into_iter().map(Outcome::Emit).collect(),
            "result" => {
                let mut out = vec![Outcome::Emit(ChatStreamEvent::Metadata {
                    session_id: event["session_id"].as_str().map(str::to_string),
                    usage: usage(&event["usage"]),
                    duration_ms: event["duration_ms"].as_u64(),
                    model: None,
                })];
                if event["is_error"].as_bool().unwrap_or(false) {
                    let message = event["result"]
                        .as_str()
                        .filter(|s| !s.trim().is_empty())
                        .unwrap_or("cursor-agent reported an error")
                        .to_string();
                    out.push(Outcome::Failed(message));
                } else {
                    out.push(Outcome::Finished);
                }
                out
            }
            _ => vec![],
        }
    }

    fn on_assistant(&mut self, event: &Value) -> Vec<Outcome> {
        let text = message_text(&event["message"]);
        if text.is_empty() {
            return vec![];
        }
        // The full reply repeated at the end, or a delta that overlaps it.
        let new_text = if self.text.ends_with(&text) {
            String::new()
        } else if text.starts_with(&self.text) {
            text[self.text.len()..].to_string()
        } else {
            text
        };
        if new_text.is_empty() {
            return vec![];
        }
        self.text.push_str(&new_text);
        vec![Outcome::Emit(ChatStreamEvent::Chunk { text: new_text })]
    }
}

fn message_text(message: &Value) -> String {
    message["content"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|part| part["type"] == "text")
        .filter_map(|part| part["text"].as_str())
        .collect()
}

fn usage(usage: &Value) -> Option<AgentUsage> {
    if !usage.is_object() {
        return None;
    }
    let input = usage["inputTokens"].as_u64();
    let output = usage["outputTokens"].as_u64();
    Some(AgentUsage {
        input_tokens: input,
        output_tokens: output,
        cache_read_tokens: usage["cacheReadTokens"].as_u64(),
        cache_write_tokens: usage["cacheWriteTokens"].as_u64(),
        reasoning_tokens: None,
        total_tokens: input.zip(output).map(|(i, o)| i + o),
        cost: None,
        context_tokens: None,
    })
}

/// `tool_call` events carry one `<name>ToolCall` object, e.g. `editToolCall`.
/// Where Cursor puts the tools of Mali's `mali` gateway (see `mcp_bridge`).
const MALI_NAMESPACE: &str = "plugin-mali-cowork-mali";

fn tool_activity(event: &Value, subtype: &str) -> Option<ChatStreamEvent> {
    if !matches!(subtype, "started" | "completed" | "error") {
        return None;
    }
    let call_object = event["tool_call"].as_object()?;
    // The call sits beside bookkeeping keys (`toolCallId`, `startedAtMs`, …)
    // under a name like `editToolCall`.
    let (key, call) = call_object
        .iter()
        .find(|(key, value)| key.ends_with("ToolCall") && value.is_object())?;
    let tool = key.strip_suffix("ToolCall").unwrap_or(key);
    let args = &call["args"];

    // MCP calls go through `CallDynamicTool`: show the tool, not the wrapper.
    // Mali's connectors (`plugin-mali-cowork-mali`) read `<connector>_<tool>`,
    // which the step list shows with the connector's name and icon.
    let dynamic = args["namespace"].as_str().zip(args["toolName"].as_str());
    let subject = first_str(
        args,
        &["path", "command", "pattern", "query", "url", "filePath", "target_file"],
    )
    .unwrap_or_default();
    let title = match dynamic {
        Some((MALI_NAMESPACE, name)) => name.to_string(),
        Some(("cursor", name)) => name.to_string(),
        Some((namespace, name)) => format!("{}: {name}", namespace.trim_start_matches("plugin-")),
        None if subject.is_empty() => tool.to_string(),
        None => format!("{tool}: {subject}"),
    };

    let mut detail = Vec::new();
    if let Some(command) = args["command"].as_str() {
        detail.push(format!("$ {command}"));
    }
    let result = &call["result"];
    if let Some(error) = first_str(result, &["error"]).or_else(|| result["failure"]["error"].as_str()) {
        detail.push(format!("Error: {error}"));
    } else if let Some(output) = first_str(
        &result["success"],
        &["output", "stdout", "contents", "text", "message", "diffString"],
    ) {
        detail.push(truncate(output.trim()));
    }

    Some(ChatStreamEvent::Activity {
        id: event["call_id"].as_str().map(str::to_string),
        kind: "tool".into(),
        title,
        detail: (!detail.is_empty()).then(|| detail.join("\n")),
        done: subtype != "started",
        duration_ms: millis(call_object, "completedAtMs")
            .zip(millis(call_object, "startedAtMs"))
            .map(|(end, start)| end.saturating_sub(start)),
    })
}

fn millis(object: &serde_json::Map<String, Value>, key: &str) -> Option<u64> {
    object.get(key)?.as_u64()
}

fn first_str<'a>(value: &'a Value, keys: &[&str]) -> Option<&'a str> {
    keys.iter().find_map(|k| value[*k].as_str().filter(|s| !s.is_empty()))
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

    #[test]
    fn a_mali_connector_call_reads_as_the_connector_tool() {
        let call = |namespace: &str| {
            json!({
                "type": "tool_call", "subtype": "started", "call_id": "t9",
                "tool_call": { "callDynamicToolToolCall": { "args": {
                    "namespace": namespace, "toolName": "custom-notion_notion-search", "arguments": {}
                } } }
            })
        };
        let title = |event: Value| match tool_activity(&event, "started") {
            Some(ChatStreamEvent::Activity { title, .. }) => title,
            _ => panic!("no activity"),
        };
        assert_eq!(title(call(MALI_NAMESPACE)), "custom-notion_notion-search");
        assert_eq!(title(call("plugin-github-github")), "github-github: custom-notion_notion-search");
    }

    fn assistant(text: &str) -> Value {
        json!({ "type": "assistant", "message": { "content": [{ "type": "text", "text": text }] } })
    }

    #[test]
    fn final_full_message_is_not_printed_twice() {
        let mut stream = CursorStream::new();
        let mut seen = String::new();
        for delta in ["A webhook", " is", " a callback."] {
            for text in chunks(&stream.handle(&assistant(delta))) {
                seen.push_str(&text);
            }
        }
        // cursor-agent repeats the whole reply in its last assistant event.
        assert!(chunks(&stream.handle(&assistant("A webhook is a callback."))).is_empty());
        assert_eq!(seen, "A webhook is a callback.");
    }

    #[test]
    fn full_message_without_deltas_is_forwarded_once() {
        let mut stream = CursorStream::new();
        assert_eq!(chunks(&stream.handle(&assistant("DONE"))), vec!["DONE"]);
        assert!(chunks(&stream.handle(&assistant("DONE"))).is_empty());
    }

    #[test]
    fn repeated_word_is_still_streamed() {
        let mut stream = CursorStream::new();
        assert_eq!(chunks(&stream.handle(&assistant("yes"))), vec!["yes"]);
        // A later delta that happens to repeat the tail is real text.
        assert_eq!(chunks(&stream.handle(&assistant(" yes"))), vec![" yes"]);
    }

    #[test]
    fn tool_calls_become_steps_with_stable_ids() {
        let mut stream = CursorStream::new();
        // The real payload keeps bookkeeping keys next to the call itself, and
        // some of them sort before it.
        let started = json!({
            "type": "tool_call", "subtype": "started", "call_id": "tool_1",
            "tool_call": {
                "editToolCall": { "args": { "path": "/w/a.txt" } },
                "hookAdditionalContexts": [], "toolCallId": "tool_1", "startedAtMs": 1000
            }
        });
        let completed = json!({
            "type": "tool_call", "subtype": "completed", "call_id": "tool_1",
            "tool_call": {
                "completedAtMs": 1750, "startedAtMs": 1000, "toolCallId": "tool_1",
                "editToolCall": {
                    "args": { "path": "/w/a.txt" },
                    "result": { "success": { "message": "Wrote file" } }
                }
            }
        });
        match &stream.handle(&started)[0] {
            // A started call has no `completedAtMs`; reading it must not panic.
            Outcome::Emit(ChatStreamEvent::Activity { id, title, done, duration_ms, .. }) => {
                assert_eq!(*duration_ms, None);
                assert_eq!(id.as_deref(), Some("tool_1"));
                assert_eq!(title, "edit: /w/a.txt");
                assert!(!done);
            }
            _ => panic!("expected an activity"),
        }
        match &stream.handle(&completed)[0] {
            Outcome::Emit(ChatStreamEvent::Activity { title, detail, done, duration_ms, .. }) => {
                assert!(*done);
                assert_eq!(title, "edit: /w/a.txt");
                assert_eq!(detail.as_deref(), Some("Wrote file"));
                assert_eq!(*duration_ms, Some(750));
            }
            _ => panic!("expected an activity"),
        }
    }

    #[test]
    fn init_reports_the_session_and_result_reports_usage() {
        let mut stream = CursorStream::new();
        let init = json!({ "type": "system", "subtype": "init", "session_id": "s1", "model": "Composer 2.5" });
        match &stream.handle(&init)[0] {
            Outcome::Emit(ChatStreamEvent::Metadata { session_id, model, .. }) => {
                assert_eq!(session_id.as_deref(), Some("s1"));
                assert_eq!(model.as_deref(), Some("Composer 2.5"));
            }
            _ => panic!("expected metadata"),
        }

        let result = json!({
            "type": "result", "subtype": "success", "is_error": false, "duration_ms": 7439,
            "session_id": "s1", "usage": { "inputTokens": 10, "outputTokens": 5, "cacheReadTokens": 2 }
        });
        let outcomes = stream.handle(&result);
        assert!(matches!(outcomes[1], Outcome::Finished));
        match &outcomes[0] {
            Outcome::Emit(ChatStreamEvent::Metadata { usage, duration_ms, .. }) => {
                let usage = usage.as_ref().expect("usage");
                assert_eq!(usage.total_tokens, Some(15));
                assert_eq!(usage.cache_read_tokens, Some(2));
                assert_eq!(*duration_ms, Some(7439));
            }
            _ => panic!("expected metadata"),
        }
    }

    #[test]
    fn error_results_fail_with_their_message() {
        let mut stream = CursorStream::new();
        let result = json!({ "type": "result", "is_error": true, "result": "rate limited" });
        match &stream.handle(&result)[1] {
            Outcome::Failed(message) => assert_eq!(message, "rate limited"),
            _ => panic!("expected a failure"),
        }
    }
}
