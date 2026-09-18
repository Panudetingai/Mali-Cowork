//! Translates `codex exec --json` JSONL lines into [`ChatStreamEvent`]s.
//!
//! Event order per run:
//! `thread.started` → `turn.started` → (`item.started` → `item.updated`* →
//! `item.completed`)* → `turn.completed` (or `turn.failed` / `error`).

use serde_json::Value;

use crate::chat_stream::{AgentUsage, ChatStreamEvent};

const MAX_DETAIL_CHARS: usize = 1200;

pub enum Outcome {
    Emit(ChatStreamEvent),
    /// The turn finished; the session id can be remembered for `resume`.
    Finished,
    Failed(String),
}

#[derive(Default)]
pub struct CodexStream {
    /// Text already forwarded. The final `agent_message` repeats the whole
    /// reply, so overlapping prefixes are dropped instead of printed twice.
    text: String,
    thread_id: Option<String>,
}

impl CodexStream {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn handle(&mut self, event: &Value) -> Vec<Outcome> {
        match event["type"].as_str().unwrap_or_default() {
            "thread.started" => {
                if let Some(id) = event["thread_id"].as_str() {
                    self.thread_id = Some(id.to_string());
                    return vec![Outcome::Emit(ChatStreamEvent::Metadata {
                        session_id: Some(id.to_string()),
                        usage: None,
                        duration_ms: None,
                        model: None,
                    })];
                }
                vec![]
            }
            "turn.started" => vec![],
            "item.started" => item_activity(&event["item"], false)
                .into_iter()
                .map(Outcome::Emit)
                .collect(),
            "item.updated" => self.on_item_updated(event),
            "item.completed" => self.on_item_completed(&event["item"]),
            "turn.completed" => {
                let mut out = vec![Outcome::Emit(ChatStreamEvent::Metadata {
                    session_id: self.thread_id.clone(),
                    usage: usage(&event["usage"]),
                    duration_ms: None,
                    model: None,
                })];
                out.push(Outcome::Finished);
                out
            }
            "turn.failed" => {
                let message = event["error"]["message"]
                    .as_str()
                    .filter(|s| !s.trim().is_empty())
                    .unwrap_or("codex reported a turn failure")
                    .to_string();
                vec![Outcome::Failed(message)]
            }
            "error" => {
                let message = event["message"].as_str().unwrap_or_default();
                // Transient reconnect notices while the stream retries.
                if message.starts_with("Reconnecting") {
                    return vec![Outcome::Emit(ChatStreamEvent::Activity {
                        id: None,
                        kind: "progress".into(),
                        title: "Reconnecting…".into(),
                        detail: (!message.is_empty()).then(|| message.to_string()),
                        done: false,
                        duration_ms: None,
                    })];
                }
                vec![Outcome::Failed(if message.is_empty() {
                    "codex reported an error".into()
                } else {
                    message.to_string()
                })]
            }
            _ => vec![],
        }
    }

    fn on_item_updated(&mut self, event: &Value) -> Vec<Outcome> {
        let item = &event["item"];
        let item_type = item_type(item);
        match item_type {
            // Incremental agent text (when emitted) streams as chunks.
            "agent_message" => {
                let text = item_text(item);
                emit_delta(&mut self.text, &text)
            }
            // Plan steps / tool progress update the same activity row.
            "todo_list" | "command_execution" | "file_change" | "mcp_tool_call"
            | "web_search" => item_activity(item, false)
                .into_iter()
                .map(Outcome::Emit)
                .collect(),
            _ => vec![],
        }
    }

    fn on_item_completed(&mut self, item: &Value) -> Vec<Outcome> {
        match item_type(item) {
            "agent_message" => emit_delta(&mut self.text, &item_text(item)),
            "reasoning" => {
                let text = item_text(item);
                if text.is_empty() {
                    vec![]
                } else {
                    vec![Outcome::Emit(ChatStreamEvent::Reasoning { reasoning: text })]
                }
            }
            // Older CLI versions used `assistant_message`.
            "assistant_message" => emit_delta(&mut self.text, &item_text(item)),
            "command_execution" | "file_change" | "mcp_tool_call" | "web_search"
            | "todo_list" => item_activity(item, true)
                .into_iter()
                .map(Outcome::Emit)
                .collect(),
            _ => {
                // Forward-compatible: unknown items with text still reach the user.
                let text = item_text(item);
                if text.is_empty() {
                    vec![]
                } else {
                    emit_delta(&mut self.text, &text)
                }
            }
        }
    }
}

/// Append-only delta so a repeated full message is not printed twice.
fn emit_delta(seen: &mut String, text: &str) -> Vec<Outcome> {
    if text.is_empty() {
        return vec![];
    }
    let new_text = if seen.ends_with(text) {
        String::new()
    } else if text.starts_with(seen.as_str()) {
        text[seen.len()..].to_string()
    } else {
        text.to_string()
    };
    if new_text.is_empty() {
        return vec![];
    }
    seen.push_str(&new_text);
    vec![Outcome::Emit(ChatStreamEvent::Chunk { text: new_text })]
}

fn item_type(item: &Value) -> &str {
    // Pre-v0.44 CLIs named the field `item_type`.
    item["type"]
        .as_str()
        .or_else(|| item["item_type"].as_str())
        .unwrap_or_default()
}

fn item_text(item: &Value) -> String {
    item["text"].as_str().unwrap_or_default().to_string()
}

fn usage(usage: &Value) -> Option<AgentUsage> {
    if !usage.is_object() {
        return None;
    }
    let input = usage["input_tokens"].as_u64();
    let output = usage["output_tokens"].as_u64();
    let cached = usage["cached_input_tokens"].as_u64();
    Some(AgentUsage {
        input_tokens: input,
        output_tokens: output,
        cache_read_tokens: cached,
        cache_write_tokens: None,
        reasoning_tokens: usage["reasoning_output_tokens"].as_u64(),
        total_tokens: input.zip(output).map(|(i, o)| i + o),
        cost: None,
    })
}

/// Tool/plan items become progress rows with a stable id.
fn item_activity(item: &Value, done: bool) -> Option<ChatStreamEvent> {
    let item_type = item_type(item);
    let id = item["id"].as_str().map(str::to_string);
    let (title, detail) = match item_type {
        "command_execution" => {
            let cmd = item["command"].as_str().unwrap_or("command");
            let out = item["aggregated_output"].as_str().unwrap_or("");
            let mut detail = Vec::new();
            detail.push(format!("$ {cmd}"));
            if let Some(code) = item["exit_code"].as_i64() {
                detail.push(format!("exit: {code}"));
            }
            if !out.trim().is_empty() {
                detail.push(truncate(out.trim()));
            }
            (format!("run: {cmd}"), Some(detail.join("\n")))
        }
        "file_change" => {
            let files: Vec<&str> = item["changes"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|c| c["path"].as_str().or_else(|| c["file"].as_str()))
                .collect();
            let title = if files.is_empty() {
                "edit files".to_string()
            } else if files.len() == 1 {
                format!("edit: {}", files[0])
            } else {
                format!("edit: {} ({} files)", files[0], files.len())
            };
            (title, None)
        }
        "mcp_tool_call" => {
            let tool = item["tool"].as_str().or_else(|| item["name"].as_str()).unwrap_or("mcp");
            (format!("mcp: {tool}"), item["input"].as_str().map(truncate))
        }
        "web_search" => {
            let q = item["query"].as_str().unwrap_or("web search");
            (format!("search: {q}"), None)
        }
        "todo_list" => {
            let steps: Vec<String> = item["items"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|t| {
                    let text = t["text"].as_str().or_else(|| t["title"].as_str())?;
                    let status = t["status"].as_str().unwrap_or("");
                    let mark = match status {
                        "completed" => "✓",
                        "in_progress" => "…",
                        _ => "○",
                    };
                    Some(format!("{mark} {text}"))
                })
                .collect();
            (
                "plan".to_string(),
                (!steps.is_empty()).then(|| truncate(&steps.join("\n"))),
            )
        }
        _ => return None,
    };
    Some(ChatStreamEvent::Activity {
        id,
        kind: "tool".into(),
        title,
        detail,
        done,
        duration_ms: None,
    })
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
    fn thread_started_reports_the_session() {
        let mut stream = CodexStream::new();
        let outcomes = stream.handle(&json!({"type":"thread.started","thread_id":"t1"}));
        match &outcomes[0] {
            Outcome::Emit(ChatStreamEvent::Metadata { session_id, .. }) => {
                assert_eq!(session_id.as_deref(), Some("t1"));
            }
            _ => panic!("expected metadata"),
        }
    }

    #[test]
    fn final_agent_message_is_not_printed_twice() {
        let mut stream = CodexStream::new();
        assert_eq!(
            chunks(&stream.handle(&json!({"type":"item.completed","item":{"id":"a","type":"agent_message","text":"hello"}}))),
            vec!["hello"]
        );
        assert!(chunks(&stream.handle(&json!({"type":"item.completed","item":{"id":"a","type":"agent_message","text":"hello"}}))).is_empty());
    }

    #[test]
    fn reasoning_becomes_reasoning_event() {
        let mut stream = CodexStream::new();
        match &stream.handle(&json!({"type":"item.completed","item":{"id":"r","type":"reasoning","text":"thinking…"}}))[0] {
            Outcome::Emit(ChatStreamEvent::Reasoning { reasoning }) => {
                assert_eq!(reasoning, "thinking…");
            }
            _ => panic!("expected reasoning"),
        }
    }

    #[test]
    fn command_execution_becomes_activity() {
        let mut stream = CodexStream::new();
        match &stream.handle(&json!({"type":"item.completed","item":{"id":"c","type":"command_execution","command":"bash -lc ls","aggregated_output":"a\nb","exit_code":0,"status":"completed"}}))[0] {
            Outcome::Emit(ChatStreamEvent::Activity { title, done, .. }) => {
                assert!(title.contains("ls"));
                assert!(*done);
            }
            _ => panic!("expected activity"),
        }
    }

    #[test]
    fn turn_completed_reports_usage_and_finishes() {
        let mut stream = CodexStream::new();
        stream.handle(&json!({"type":"thread.started","thread_id":"t1"}));
        let outcomes = stream.handle(&json!({"type":"turn.completed","usage":{"input_tokens":10,"cached_input_tokens":2,"output_tokens":5}}));
        assert!(matches!(outcomes[1], Outcome::Finished));
        match &outcomes[0] {
            Outcome::Emit(ChatStreamEvent::Metadata { usage, session_id, .. }) => {
                let usage = usage.as_ref().expect("usage");
                assert_eq!(usage.input_tokens, Some(10));
                assert_eq!(usage.cache_read_tokens, Some(2));
                assert_eq!(usage.total_tokens, Some(15));
                assert_eq!(session_id.as_deref(), Some("t1"));
            }
            _ => panic!("expected metadata"),
        }
    }

    #[test]
    fn turn_failed_and_error_fail_with_message() {
        let mut stream = CodexStream::new();
        match &stream.handle(&json!({"type":"turn.failed","error":{"message":"boom"}}))[0] {
            Outcome::Failed(m) => assert_eq!(m, "boom"),
            _ => panic!("expected failure"),
        }
        match &stream.handle(&json!({"type":"error","message":"broken pipe"}))[0] {
            Outcome::Failed(m) => assert_eq!(m, "broken pipe"),
            _ => panic!("expected failure"),
        }
    }
}
