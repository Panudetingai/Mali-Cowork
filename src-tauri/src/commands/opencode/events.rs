//! Translates `opencode serve` events into [`ChatStreamEvent`]s for one prompt.

use std::collections::{HashMap, HashSet};

use serde_json::Value;

use crate::chat_stream::{AgentUsage, ChatStreamEvent, QuestionItem, QuestionOption, TodoItem};

const MAX_DETAIL_CHARS: usize = 1200;

/// What the stream loop should do after an event.
pub enum Outcome {
    Emit(ChatStreamEvent),
    /// The agent needs approval before it can continue.
    PermissionAsked(PermissionAsk),
    /// The agent asked the user something and is waiting for the answer.
    QuestionAsked(QuestionAsk),
    /// The prompt finished.
    Idle,
    Failed(String),
}

pub struct PermissionAsk {
    pub id: String,
    pub permission: String,
    pub patterns: Vec<String>,
    pub title: String,
    pub detail: Option<String>,
    /// Absolute file the tool wants to change (`edit`).
    pub path: Option<String>,
    /// Shell command the tool wants to run (`bash`).
    pub command: Option<String>,
}

pub struct QuestionAsk {
    pub id: String,
    pub questions: Vec<QuestionItem>,
}

#[derive(Clone, Copy, PartialEq)]
enum PartKind {
    Text,
    Reasoning,
}

pub struct EventTranslator {
    session_id: String,
    show_reasoning: bool,
    /// Our session plus any sub-agent sessions it spawns.
    related_sessions: HashSet<String>,
    user_messages: HashSet<String>,
    part_kinds: HashMap<String, PartKind>,
    /// Bytes already forwarded per part, so full-text updates don't duplicate deltas.
    emitted: HashMap<String, usize>,
    /// Tool parts still marked running; flushed when assistant text arrives.
    running_tools: HashMap<String, Value>,
}

impl EventTranslator {
    pub fn new(session_id: String, show_reasoning: bool) -> Self {
        Self {
            related_sessions: HashSet::from([session_id.clone()]),
            session_id,
            show_reasoning,
            user_messages: HashSet::new(),
            part_kinds: HashMap::new(),
            emitted: HashMap::new(),
            running_tools: HashMap::new(),
        }
    }

    pub fn handle(&mut self, event: &Value) -> Vec<Outcome> {
        let props = &event["properties"];
        match event["type"].as_str().unwrap_or_default() {
            "session.created" => {
                let info = &props["info"];
                if let (Some(id), Some(parent)) = (info["id"].as_str(), info["parentID"].as_str()) {
                    if self.related_sessions.contains(parent) {
                        self.related_sessions.insert(id.to_string());
                    }
                }
                vec![]
            }
            "message.updated" => {
                let info = &props["info"];
                if info["role"] == "user" {
                    if let Some(id) = info["id"].as_str() {
                        self.user_messages.insert(id.to_string());
                    }
                }
                vec![]
            }
            "message.part.updated" => self.on_part(&props["part"]),
            "message.part.delta" => self.on_delta(props),
            "permission.asked" if self.is_related(props) => {
                vec![Outcome::PermissionAsked(permission_ask(props))]
            }
            "permission.replied" if self.is_related(props) => {
                let id = props["requestID"].as_str().unwrap_or_default().to_string();
                vec![Outcome::Emit(ChatStreamEvent::PermissionResolved { id })]
            }
            // The agent cannot continue until these are answered, so they are
            // forwarded like permissions rather than left to time out.
            "question.asked" if self.is_related(props) => {
                vec![Outcome::QuestionAsked(question_ask(props))]
            }
            "question.replied" | "question.rejected" if self.is_related(props) => {
                let id = props["requestID"].as_str().unwrap_or_default().to_string();
                vec![Outcome::Emit(ChatStreamEvent::QuestionResolved { id })]
            }
            "session.error" if self.is_own(props) => {
                let error = &props["error"];
                if error["name"] == "MessageAbortedError" {
                    vec![Outcome::Idle]
                } else {
                    vec![Outcome::Failed(error_message(error))]
                }
            }
            "session.idle" if self.is_own(props) => vec![Outcome::Idle],
            _ => vec![],
        }
    }

    fn is_own(&self, props: &Value) -> bool {
        props["sessionID"] == self.session_id.as_str()
    }

    fn is_related(&self, props: &Value) -> bool {
        props["sessionID"]
            .as_str()
            .is_some_and(|id| self.related_sessions.contains(id))
    }

    fn on_part(&mut self, part: &Value) -> Vec<Outcome> {
        if part["sessionID"] != self.session_id.as_str() {
            return vec![];
        }
        if part["messageID"]
            .as_str()
            .is_some_and(|id| self.user_messages.contains(id))
        {
            return vec![];
        }
        let part_id = part["id"].as_str().unwrap_or_default().to_string();

        match part["type"].as_str().unwrap_or_default() {
            "text" => self.on_text_part(part_id, PartKind::Text, part),
            "reasoning" => self.on_text_part(part_id, PartKind::Reasoning, part),
            // A pending tool has no input yet; wait for the running update.
            "tool" if part["state"]["status"] == "pending" => vec![],
            "tool" => self.on_tool_part(part),
            "step-finish" => vec![Outcome::Emit(step_usage(&self.session_id, part))],
            _ => vec![],
        }
    }

    fn on_tool_part(&mut self, part: &Value) -> Vec<Outcome> {
        let id = part["id"].as_str().unwrap_or_default();
        let status = part["state"]["status"].as_str().unwrap_or_default();
        if matches!(status, "completed" | "error") {
            self.running_tools.remove(id);
        } else if !id.is_empty() {
            self.running_tools.insert(id.to_string(), part.clone());
        }
        tool_activity(part).into_iter().map(Outcome::Emit).collect()
    }

    fn on_text_part(&mut self, part_id: String, kind: PartKind, part: &Value) -> Vec<Outcome> {
        self.part_kinds.insert(part_id.clone(), kind);
        let text = part["text"].as_str().unwrap_or_default();
        let sent = self.emitted.get(&part_id).copied().unwrap_or(0);
        match text.get(sent..) {
            Some(rest) if !rest.is_empty() => {
                self.emitted.insert(part_id, text.len());
                let mut outcomes = self.flush_running_tools();
                if let Some(ev) = self.text_event(kind, rest.to_string()) {
                    outcomes.push(ev);
                }
                outcomes
            }
            _ => vec![],
        }
    }

    fn on_delta(&mut self, props: &Value) -> Vec<Outcome> {
        if !self.is_own(props) || props["field"] != "text" {
            return vec![];
        }
        let part_id = props["partID"].as_str().unwrap_or_default();
        let Some(&kind) = self.part_kinds.get(part_id) else {
            return vec![];
        };
        let delta = props["delta"].as_str().unwrap_or_default();
        if delta.is_empty() {
            return vec![];
        }
        *self.emitted.entry(part_id.to_string()).or_default() += delta.len();
        let mut outcomes = self.flush_running_tools();
        if let Some(ev) = self.text_event(kind, delta.to_string()) {
            outcomes.push(ev);
        }
        outcomes
    }

    fn text_event(&self, kind: PartKind, text: String) -> Option<Outcome> {
        let event = match kind {
            PartKind::Text => ChatStreamEvent::Chunk { text },
            PartKind::Reasoning if self.show_reasoning => ChatStreamEvent::Reasoning { reasoning: text },
            PartKind::Reasoning => return None,
        };
        Some(Outcome::Emit(event))
    }

    /// Some tools never send a final `completed` update; once the model writes, treat them as done.
    fn flush_running_tools(&mut self) -> Vec<Outcome> {
        let running: Vec<Value> = self.running_tools.drain().map(|(_, part)| part).collect();
        running
            .into_iter()
            .filter_map(|mut part| {
                if let Some(state) = part.get_mut("state").and_then(|s| s.as_object_mut()) {
                    state.insert("status".into(), serde_json::json!("completed"));
                }
                tool_activity(&part).map(Outcome::Emit)
            })
            .collect()
    }
}

fn tool_activity(part: &Value) -> Option<ChatStreamEvent> {
    let tool = part["tool"].as_str().unwrap_or("tool");
    if tool == "todowrite" {
        return todo_items(part).map(|items| ChatStreamEvent::Todos { items });
    }

    let state = &part["state"];
    let input = &state["input"];
    let status = state["status"].as_str().unwrap_or_default();

    let subject = state["title"]
        .as_str()
        .or_else(|| first_str(input, &["description", "filePath", "command", "pattern", "url"]))
        .unwrap_or_default();
    let title = if subject.is_empty() {
        tool.to_string()
    } else {
        format!("{tool}: {subject}")
    };

    let mut detail = Vec::new();
    if let Some(command) = input["command"].as_str() {
        detail.push(format!("$ {command}"));
    }
    match status {
        "completed" => {
            if let Some(output) = state["output"].as_str().filter(|s| !s.trim().is_empty()) {
                detail.push(truncate(output.trim()));
            }
        }
        "error" => {
            if let Some(error) = state["error"].as_str() {
                detail.push(format!("Error: {error}"));
            }
        }
        _ => {}
    }

    Some(ChatStreamEvent::Activity {
        id: part["id"].as_str().map(str::to_string),
        kind: "tool".into(),
        title,
        detail: (!detail.is_empty()).then(|| detail.join("\n")),
        done: matches!(status, "completed" | "error"),
        duration_ms: duration_ms(&state["time"]),
    })
}

/// Extract todo items from a `todowrite` tool part. Supports several likely
/// shapes because OpenCode does not document a stable schema.
fn todo_items(part: &Value) -> Option<Vec<TodoItem>> {
    const MAX_TODOS: usize = 50;

    let input = part["state"]["input"].as_object();
    let output = part["state"]["output"].as_object();
    let items: Option<&Vec<Value>> = input
        .and_then(|o| o.get("items").or_else(|| o.get("todos")))
        .and_then(|v| v.as_array())
        .or_else(|| output.and_then(|o| o.get("items").or_else(|| o.get("todos"))).and_then(|v| v.as_array()));

    let items = items?;
    let mut out = Vec::with_capacity(items.len().min(MAX_TODOS));
    for item in items.iter().take(MAX_TODOS) {
        let text = item["text"]
            .as_str()
            .or_else(|| item["title"].as_str())
            .or_else(|| item["description"].as_str())
            .map(str::to_string)?;
        let status = item["status"].as_str().map(str::to_string);
        let done = status.as_deref().map(|s| matches!(s, "completed" | "done")).or(item["done"].as_bool());
        out.push(TodoItem {
            id: item["id"].as_str().map(str::to_string),
            text,
            status,
            done,
        });
    }
    (!out.is_empty()).then_some(out)
}

fn step_usage(session_id: &str, part: &Value) -> ChatStreamEvent {
    let tokens = &part["tokens"];
    let cache = &tokens["cache"];
    ChatStreamEvent::Metadata {
        session_id: Some(session_id.to_string()),
        usage: Some(AgentUsage {
            input_tokens: tokens["input"].as_u64(),
            output_tokens: tokens["output"].as_u64(),
            cache_read_tokens: cache["read"].as_u64(),
            cache_write_tokens: cache["write"].as_u64(),
            reasoning_tokens: tokens["reasoning"].as_u64(),
            total_tokens: tokens["total"].as_u64(),
            cost: part["cost"].as_f64(),
        }),
        duration_ms: None,
        model: None,
    }
}

fn permission_ask(props: &Value) -> PermissionAsk {
    let permission = props["permission"].as_str().unwrap_or("unknown").to_string();
    let metadata = &props["metadata"];
    let patterns: Vec<String> = props["patterns"]
        .as_array()
        .map(|a| a.iter().filter_map(|p| p.as_str().map(str::to_string)).collect())
        .unwrap_or_default();

    let title = match permission.as_str() {
        "bash" => "Run a shell command".to_string(),
        "edit" => "Modify a file".to_string(),
        "external_directory" => "Access files outside the working folder".to_string(),
        "webfetch" => "Fetch a web page".to_string(),
        "websearch" => "Search the web".to_string(),
        "task" => "Start a sub-agent".to_string(),
        other => format!("Use {other}"),
    };

    let mut detail = Vec::new();
    if let Some(command) = metadata["command"].as_str() {
        detail.push(format!("$ {command}"));
    }
    if let Some(path) = first_str(metadata, &["filepath", "filePath", "path", "url"]) {
        detail.push(path.to_string());
    }
    if let Some(diff) = metadata["diff"].as_str() {
        detail.push(truncate(diff));
    }
    if detail.is_empty() && !patterns.is_empty() {
        detail.push(patterns.join("\n"));
    }

    PermissionAsk {
        id: props["id"].as_str().unwrap_or_default().to_string(),
        permission,
        patterns,
        title,
        detail: (!detail.is_empty()).then(|| detail.join("\n")),
        path: first_str(metadata, &["filepath", "filePath", "path"]).map(str::to_string),
        command: metadata["command"].as_str().map(str::to_string),
    }
}

/// An `ask` tool call: the questions and their choices, as opencode sends them.
pub fn question_ask(props: &Value) -> QuestionAsk {
    let questions = props["questions"]
        .as_array()
        .map(|items| items.iter().map(question_item).collect())
        .unwrap_or_default();
    QuestionAsk {
        id: props["id"].as_str().unwrap_or_default().to_string(),
        questions,
    }
}

fn question_item(item: &Value) -> QuestionItem {
    let options = item["options"]
        .as_array()
        .map(|options| {
            options
                .iter()
                .filter_map(|option| {
                    let label = option["label"].as_str()?.trim();
                    (!label.is_empty()).then(|| QuestionOption {
                        label: label.to_string(),
                        description: option["description"]
                            .as_str()
                            .map(str::trim)
                            .filter(|d| !d.is_empty())
                            .map(str::to_string),
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    QuestionItem {
        question: item["question"].as_str().unwrap_or_default().to_string(),
        header: item["header"]
            .as_str()
            .map(str::trim)
            .filter(|h| !h.is_empty())
            .map(str::to_string),
        options,
        multiple: item["multiple"].as_bool().unwrap_or(false),
        // opencode allows a written answer unless the question says otherwise.
        custom: item["custom"].as_bool().unwrap_or(true),
    }
}

fn error_message(error: &Value) -> String {
    let raw = error["data"]["message"]
        .as_str()
        .or_else(|| error["message"].as_str())
        .or_else(|| error["name"].as_str())
        .map(str::to_string)
        .unwrap_or_else(|| format!("opencode error: {error}"));
    explain(&raw).unwrap_or(raw)
}

/// A plainer version of the few provider errors whose own wording sends the
/// user looking in the wrong place.
fn explain(raw: &str) -> Option<String> {
    let lower = raw.to_lowercase();
    // Zen gates its free tier on the request looking like a full OpenCode
    // coding session, which Chat mode — no file tools — is not. Its own
    // message reads as if the app were not OpenCode at all.
    if lower.contains("free tier") && lower.contains("within opencode") {
        return Some(
            "OpenCode Zen's free models only answer full coding sessions, so they can't be \
             used in Chat. Switch to Cowork to use this model, or pick a paid Zen model or \
             another provider for Chat."
                .into(),
        );
    }
    // Google validates the whole tool list before it reads the prompt, and
    // names the offending field by index — `function_declarations[26]…` tells
    // the user nothing about which connector to switch off. Tools with a
    // schema Google is known to refuse are already left out (see `schema.rs`);
    // this is for a shape that is new to us.
    if lower.contains("generatecontentrequest.tools")
        || (lower.contains("function_declarations") && lower.contains("parameters"))
    {
        return Some(format!(
            "Gemini turned down the tool list from a connected MCP server, so it never saw the \
             message. One of its tools describes an option in a way Gemini doesn't accept, and \
             it refuses the whole request over it.\n\nPick a non-Google model for this chat, or \
             switch that connector off in Settings → MCP.\n\n— Gemini —\n{}",
            first_line(raw)
        ));
    }
    None
}

/// The one line of a provider error worth showing under an explanation.
fn first_line(raw: &str) -> String {
    let line = raw.lines().find(|l| !l.trim().is_empty()).unwrap_or(raw).trim();
    line.chars().take(300).collect()
}

fn first_str<'a>(value: &'a Value, keys: &[&str]) -> Option<&'a str> {
    keys.iter()
        .find_map(|k| value[*k].as_str().filter(|s| !s.is_empty()))
}

fn duration_ms(time: &Value) -> Option<u64> {
    Some(time["end"].as_u64()?.saturating_sub(time["start"].as_u64()?))
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

    const SES: &str = "ses_main";

    /// A provider error whose own wording sends the user to the wrong place
    /// is replaced; everything else is passed through as the provider said it.
    #[test]
    fn the_errors_that_need_translating_get_it() {
        let zen = error_message(&json!({ "data": { "message":
            "OpenCode's free tier can only be used from within OpenCode" } }));
        assert!(zen.contains("Cowork"), "{zen}");

        let gemini = error_message(&json!({ "data": { "message":
            "GenerateContentRequest.tools[0].function_declarations[26].parameters\
             .properties[operations].items.any_of[8].properties[formatting]\
             .properties[link].any_of[0].enum[0]: cannot be empty" } }));
        assert!(gemini.contains("Settings → MCP"), "{gemini}");
        assert!(gemini.contains("non-Google model"), "{gemini}");
        // The provider's own words stay, below the explanation.
        assert!(gemini.contains("cannot be empty"), "{gemini}");

        let plain = error_message(&json!({ "data": { "message": "rate limit exceeded" } }));
        assert_eq!(plain, "rate limit exceeded");
    }

    fn texts(outcomes: &[Outcome]) -> Vec<String> {
        outcomes
            .iter()
            .filter_map(|o| match o {
                Outcome::Emit(ChatStreamEvent::Chunk { text }) => Some(text.clone()),
                _ => None,
            })
            .collect()
    }

    fn part_event(part: Value) -> Value {
        json!({ "type": "message.part.updated", "properties": { "sessionID": SES, "part": part } })
    }

    #[test]
    fn skips_user_prompt_and_merges_deltas_without_duplicates() {
        let mut t = EventTranslator::new(SES.into(), false);
        t.handle(&json!({ "type": "message.updated", "properties": { "info": { "id": "msg_user", "role": "user" } } }));

        let echoed = t.handle(&part_event(json!({
            "id": "prt_u", "messageID": "msg_user", "sessionID": SES, "type": "text", "text": "hello"
        })));
        assert!(texts(&echoed).is_empty());

        t.handle(&part_event(json!({
            "id": "prt_a", "messageID": "msg_a", "sessionID": SES, "type": "text", "text": ""
        })));
        let delta = t.handle(&json!({ "type": "message.part.delta", "properties": {
            "sessionID": SES, "messageID": "msg_a", "partID": "prt_a", "field": "text", "delta": "Hi "
        }}));
        assert_eq!(texts(&delta), ["Hi "]);

        let full = t.handle(&part_event(json!({
            "id": "prt_a", "messageID": "msg_a", "sessionID": SES, "type": "text", "text": "Hi there"
        })));
        assert_eq!(texts(&full), ["there"]);
    }

    #[test]
    fn reasoning_is_hidden_unless_enabled() {
        let part = part_event(json!({
            "id": "prt_r", "messageID": "msg_a", "sessionID": SES, "type": "reasoning", "text": "hmm"
        }));
        assert!(EventTranslator::new(SES.into(), false).handle(&part).is_empty());
        let shown = EventTranslator::new(SES.into(), true).handle(&part);
        assert!(matches!(shown[..], [Outcome::Emit(ChatStreamEvent::Reasoning { .. })]));
    }

    #[test]
    fn permission_from_subagent_session_is_forwarded() {
        let mut t = EventTranslator::new(SES.into(), false);
        t.handle(&json!({ "type": "session.created", "properties": { "info": { "id": "ses_child", "parentID": SES } } }));
        let out = t.handle(&json!({ "type": "permission.asked", "properties": {
            "id": "per_1", "sessionID": "ses_child", "permission": "bash",
            "patterns": ["rm *"], "metadata": { "command": "rm victim.txt" }, "always": []
        }}));
        match &out[..] {
            [Outcome::PermissionAsked(ask)] => {
                assert_eq!(ask.id, "per_1");
                assert_eq!(ask.detail.as_deref(), Some("$ rm victim.txt"));
            }
            _ => panic!("expected a permission request"),
        }

        let other = t.handle(&json!({ "type": "permission.asked", "properties": {
            "id": "per_2", "sessionID": "ses_unrelated", "permission": "bash", "patterns": [], "metadata": {}, "always": []
        }}));
        assert!(other.is_empty());
    }

    #[test]
    fn question_is_forwarded_with_its_choices() {
        let mut t = EventTranslator::new(SES.into(), false);
        let out = t.handle(&json!({ "type": "question.asked", "properties": {
            "id": "que_1", "sessionID": SES, "questions": [{
                "question": "Which folder should I use?",
                "header": "Folder",
                "options": [
                    { "label": "src", "description": "The app code" },
                    { "label": "docs", "description": "" }
                ],
                "multiple": true
            }]
        }}));
        match &out[..] {
            [Outcome::QuestionAsked(ask)] => {
                assert_eq!(ask.id, "que_1");
                let question = &ask.questions[0];
                assert_eq!(question.header.as_deref(), Some("Folder"));
                assert_eq!(question.options.len(), 2);
                assert_eq!(question.options[1].description, None);
                assert!(question.multiple);
                // opencode allows a written answer unless it says otherwise.
                assert!(question.custom);
            }
            _ => panic!("expected a question"),
        }

        let answered = t.handle(&json!({ "type": "question.replied", "properties": {
            "sessionID": SES, "requestID": "que_1", "answers": [["src"]]
        }}));
        assert!(matches!(
            answered[..],
            [Outcome::Emit(ChatStreamEvent::QuestionResolved { .. })]
        ));
    }

    #[test]
    fn idle_and_abort_finish_the_prompt() {
        let mut t = EventTranslator::new(SES.into(), false);
        let idle = t.handle(&json!({ "type": "session.idle", "properties": { "sessionID": SES } }));
        assert!(matches!(idle[..], [Outcome::Idle]));
        let aborted = t.handle(&json!({ "type": "session.error", "properties": {
            "sessionID": SES, "error": { "name": "MessageAbortedError", "data": {} }
        }}));
        assert!(matches!(aborted[..], [Outcome::Idle]));
        let failed = t.handle(&json!({ "type": "session.error", "properties": {
            "sessionID": SES, "error": { "name": "APIError", "data": { "message": "quota" } }
        }}));
        assert!(matches!(&failed[..], [Outcome::Failed(m)] if m == "quota"));
    }
}
