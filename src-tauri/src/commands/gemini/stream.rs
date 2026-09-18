//! Translates `gemini --output-format stream-json` JSONL lines into
//! [`ChatStreamEvent`]s.
//!
//! Event order per run:
//! `init` → `message` (role=user) → (`message` (role=assistant) |
//! `tool_use` → `tool_result`)* → `result` (or `error` when fatal).
//!
//! Ref: https://geminicli.com/docs/cli/headless

use serde_json::Value;

use crate::chat_stream::{AgentUsage, ChatStreamEvent};

const MAX_DETAIL_CHARS: usize = 1200;

pub enum Outcome {
    Emit(ChatStreamEvent),
    /// The run finished; the session id can be remembered for `-r`.
    Finished,
    Failed(String),
}

#[derive(Default)]
pub struct GeminiStream {
    /// Text already forwarded. Assistant messages arrive as deltas plus a
    /// final repeat, so overlapping prefixes are dropped, not printed twice.
    text: String,
    session_id: Option<String>,
}

impl GeminiStream {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn handle(&mut self, event: &Value) -> Vec<Outcome> {
        match event["type"].as_str().unwrap_or_default() {
            "init" => {
                let id = event["session_id"]
                    .as_str()
                    .or_else(|| event["sessionId"].as_str());
                if let Some(id) = id {
                    self.session_id = Some(id.to_string());
                }
                vec![Outcome::Emit(ChatStreamEvent::Metadata {
                    session_id: self.session_id.clone(),
                    usage: None,
                    duration_ms: None,
                    model: event["model"].as_str().map(str::to_string),
                })]
            }
            "message" => {
                if event["role"].as_str().unwrap_or_default() != "assistant" {
                    return vec![];
                }
                let content = event["content"].as_str().unwrap_or_default();
                emit_delta(&mut self.text, content)
            }
            "tool_use" => tool_activity(event, false)
                .into_iter()
                .map(Outcome::Emit)
                .collect(),
            "tool_result" => tool_activity(event, true)
                .into_iter()
                .map(Outcome::Emit)
                .collect(),
            // Non-fatal warnings and system errors: surface as progress so the
            // user sees them, but keep the run going.
            "error" => {
                let message = event["message"]
                    .as_str()
                    .or_else(|| event["error"].as_str())
                    .unwrap_or("gemini reported an error");
                vec![Outcome::Emit(ChatStreamEvent::Activity {
                    id: event["tool_id"].as_str().map(str::to_string),
                    kind: "progress".into(),
                    title: "Gemini notice".into(),
                    detail: (!message.is_empty()).then(|| truncate(message)),
                    done: false,
                    duration_ms: None,
                })]
            }
            "result" => {
                // A failed run reports `error`/`success: false` instead of stats.
                let success = event["success"].as_bool().unwrap_or(true);
                if !success {
                    let message = event["error"]
                        .as_str()
                        .or_else(|| event["message"].as_str())
                        .filter(|s| !s.trim().is_empty())
                        .unwrap_or("gemini reported a failure");
                    return vec![Outcome::Failed(message.to_string())];
                }
                let mut out = vec![Outcome::Emit(ChatStreamEvent::Metadata {
                    session_id: self.session_id.clone(),
                    usage: usage(&event["stats"]),
                    duration_ms: event["duration_ms"]
                        .as_u64()
                        .or_else(|| event["stats"]["duration_ms"].as_u64()),
                    model: event["model"].as_str().map(str::to_string),
                })];
                out.push(Outcome::Finished);
                out
            }
            _ => vec![],
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

fn num(stats: &Value, keys: &[&str]) -> Option<u64> {
    keys.iter().filter_map(|k| stats[k].as_u64()).next()
}

fn usage(stats: &Value) -> Option<AgentUsage> {
    if !stats.is_object() {
        return None;
    }
    // Field names vary by CLI version; accept the known variants.
    let input = num(stats, &["input_tokens", "promptTokenCount", "prompt_tokens"]);
    let output = num(stats, &["output_tokens", "candidatesTokenCount", "candidates_tokens"]);
    let cached = num(stats, &["cached_input_tokens", "cachedContentTokenCount", "cached_tokens"]);
    if input.is_none() && output.is_none() && cached.is_none() {
        return None;
    }
    Some(AgentUsage {
        input_tokens: input,
        output_tokens: output,
        cache_read_tokens: cached,
        cache_write_tokens: None,
        reasoning_tokens: num(stats, &["reasoning_output_tokens", "thoughtsTokenCount"]),
        total_tokens: num(stats, &["total_tokens", "totalTokenCount"])
            .or_else(|| input.zip(output).map(|(i, o)| i + o)),
        cost: None,
    })
}

/// `tool_use` / `tool_result` events become progress rows with a stable id.
fn tool_activity(event: &Value, done: bool) -> Option<ChatStreamEvent> {
    let name = event["tool_name"]
        .as_str()
        .or_else(|| event["name"].as_str())
        .unwrap_or("tool");
    let id = event["tool_id"]
        .as_str()
        .or_else(|| event["call_id"].as_str())
        .map(str::to_string);

    let mut detail = Vec::new();
    let params = &event["parameters"];
    if let Some(s) = first_str(params, &["command", "file_path", "path", "pattern", "query", "url", "filePath"]) {
        detail.push(s.to_string());
    } else if params.is_object() {
        let flat = params.to_string();
        if flat.len() > 2 {
            detail.push(truncate(&flat));
        }
    }
    // `tool_result` carries the output next to the same id.
    let output = &event["output"];
    if let Some(s) = output
        .as_str()
        .or_else(|| event["result"].as_str())
        .or_else(|| output["text"].as_str())
    {
        if !s.trim().is_empty() {
            detail.push(truncate(s.trim()));
        }
    }

    let title = match detail.first() {
        Some(subject) if !done || detail.len() == 1 => format!("{name}: {}", short(subject)),
        _ => name.to_string(),
    };
    Some(ChatStreamEvent::Activity {
        id,
        kind: "tool".into(),
        title,
        detail: (!detail.is_empty()).then(|| detail.join("\n")),
        done,
        duration_ms: None,
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

    #[test]
    fn init_reports_the_session_and_model() {
        let mut stream = GeminiStream::new();
        let outcomes = stream.handle(&json!({"type":"init","session_id":"s1","model":"gemini-2.5-pro"}));
        match &outcomes[0] {
            Outcome::Emit(ChatStreamEvent::Metadata { session_id, model, .. }) => {
                assert_eq!(session_id.as_deref(), Some("s1"));
                assert_eq!(model.as_deref(), Some("gemini-2.5-pro"));
            }
            _ => panic!("expected metadata"),
        }
    }

    #[test]
    fn assistant_deltas_stream_once_and_user_messages_are_ignored() {
        let mut stream = GeminiStream::new();
        assert!(chunks(&stream.handle(&json!({"type":"message","role":"user","content":"hi"}))).is_empty());
        assert_eq!(
            chunks(&stream.handle(&json!({"type":"message","role":"assistant","content":"hello","delta":true}))),
            vec!["hello"]
        );
        // Final repeat of the whole reply is not printed twice.
        assert!(chunks(&stream.handle(&json!({"type":"message","role":"assistant","content":"hello"}))).is_empty());
    }

    #[test]
    fn tool_use_and_result_become_activities_with_stable_ids() {
        let mut stream = GeminiStream::new();
        match &stream.handle(&json!({"type":"tool_use","tool_name":"run_shell_command","tool_id":"t1","parameters":{"command":"ls"}}))[0] {
            Outcome::Emit(ChatStreamEvent::Activity { id, title, done, .. }) => {
                assert_eq!(id.as_deref(), Some("t1"));
                assert!(title.contains("ls"));
                assert!(!done);
            }
            _ => panic!("expected activity"),
        }
        match &stream.handle(&json!({"type":"tool_result","tool_name":"run_shell_command","tool_id":"t1","output":"a\nb"}))[0] {
            Outcome::Emit(ChatStreamEvent::Activity { done, .. }) => assert!(*done),
            _ => panic!("expected activity"),
        }
    }

    #[test]
    fn result_reports_usage_and_finishes() {
        let mut stream = GeminiStream::new();
        stream.handle(&json!({"type":"init","session_id":"s1"}));
        let outcomes = stream.handle(&json!({"type":"result","stats":{"promptTokenCount":10,"candidatesTokenCount":5,"cachedContentTokenCount":2}}));
        assert!(matches!(outcomes[1], Outcome::Finished));
        match &outcomes[0] {
            Outcome::Emit(ChatStreamEvent::Metadata { usage, session_id, .. }) => {
                let usage = usage.as_ref().expect("usage");
                assert_eq!(usage.input_tokens, Some(10));
                assert_eq!(usage.output_tokens, Some(5));
                assert_eq!(usage.cache_read_tokens, Some(2));
                assert_eq!(usage.total_tokens, Some(15));
                assert_eq!(session_id.as_deref(), Some("s1"));
            }
            _ => panic!("expected metadata"),
        }
    }

    #[test]
    fn failed_results_fail_with_their_message() {
        let mut stream = GeminiStream::new();
        match &stream.handle(&json!({"type":"result","success":false,"error":"rate limited"}))[0] {
            Outcome::Failed(m) => assert_eq!(m, "rate limited"),
            _ => panic!("expected failure"),
        }
    }
}
