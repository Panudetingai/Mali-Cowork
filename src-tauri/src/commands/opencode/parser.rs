use serde_json::Value;

use crate::chat_stream::{AgentUsage, ChatStreamEvent};

/// Try several JSON keys and return the first non-empty string.
pub fn extract_text(v: &Value, keys: &[&str]) -> Option<String> {
    for k in keys {
        if let Some(s) = v.get(*k).and_then(|x| x.as_str()) {
            if !s.is_empty() {
                return Some(s.to_string());
            }
        }
    }
    None
}

/// Walk a nested path (`["part", "text"]`) and return the first non-empty string.
pub fn extract_nested_text(v: &Value, path: &[&str]) -> Option<String> {
    let mut cur = v;
    for k in path {
        cur = cur.get(*k)?;
    }
    cur.as_str().filter(|s| !s.is_empty()).map(|s| s.to_string())
}

/// Parse content events produced by `opencode run --format json`.
pub fn parse_opencode_line(v: &Value) -> Option<ChatStreamEvent> {
    let typ = v.get("type")?.as_str()?;
    match typ {
        "text" => {
            let text = extract_nested_text(v, &["part", "text"])
                .or_else(|| extract_text(v, &["text", "content", "message"]))?;
            Some(ChatStreamEvent::Chunk { text })
        }
        "reasoning" => {
            let reasoning = extract_nested_text(v, &["part", "text"])
                .or_else(|| extract_text(v, &["reasoning", "text", "content"]))?;
            Some(ChatStreamEvent::Reasoning { reasoning })
        }
        "step_finish" => {
            let part = v.get("part")?;
            let tokens = part.get("tokens")?;
            let usage = AgentUsage {
                input_tokens: tokens.get("input").and_then(|x| x.as_u64()),
                output_tokens: tokens.get("output").and_then(|x| x.as_u64()),
                cache_read_tokens: tokens
                    .get("cache")
                    .and_then(|c| c.get("read"))
                    .and_then(|x| x.as_u64()),
                cache_write_tokens: tokens
                    .get("cache")
                    .and_then(|c| c.get("write"))
                    .and_then(|x| x.as_u64()),
                reasoning_tokens: tokens.get("reasoning").and_then(|x| x.as_u64()),
                total_tokens: tokens.get("total").and_then(|x| x.as_u64()),
                cost: part.get("cost").and_then(|x| x.as_f64()),
            };
            let session_id = v
                .get("sessionID")
                .and_then(|x| x.as_str())
                .map(|s| s.to_string());
            Some(ChatStreamEvent::Metadata {
                session_id,
                usage: Some(usage),
                duration_ms: None,
                model: None,
            })
        }
        _ => None,
    }
}

/// Parse control / progress events so the UI can show what the agent is doing.
pub fn parse_opencode_activity(v: &Value) -> Option<ChatStreamEvent> {
    let typ = v.get("type")?.as_str()?;
    match typ {
        "tool_use" => {
            let part = v.get("part")?;
            let tool = part
                .get("tool")
                .and_then(|x| x.as_str())
                .or_else(|| v.get("tool").and_then(|x| x.as_str()))
                .unwrap_or("tool");
            let state = part.get("state");
            let title = state
                .and_then(|s| s.get("title"))
                .and_then(|x| x.as_str())
                .or_else(|| {
                    state
                        .and_then(|s| s.get("input"))
                        .and_then(|i| i.get("command"))
                        .and_then(|x| x.as_str())
                })
                .or_else(|| {
                    state
                        .and_then(|s| s.get("input"))
                        .and_then(|i| i.get("pattern"))
                        .and_then(|x| x.as_str())
                })
                .unwrap_or(tool);

            let input_detail = state.and_then(|s| s.get("input")).map(|inp| {
                if let Some(cmd) = inp.get("command").and_then(|x| x.as_str()) {
                    format!("$ {}", cmd)
                } else if let Some(pat) = inp.get("pattern").and_then(|x| x.as_str()) {
                    format!("pattern: {}", pat)
                } else {
                    serde_json::to_string(inp).unwrap_or_default()
                }
            });

            let output_detail = state
                .and_then(|s| s.get("output"))
                .and_then(|x| x.as_str())
                .map(|s| {
                    let t = s.trim();
                    if t.len() > 600 {
                        format!("{}… ({} chars, truncated)", &t[..600], t.len())
                    } else {
                        t.to_string()
                    }
                });

            let detail = match (input_detail, output_detail) {
                (Some(i), Some(o)) => Some(format!("{}\n→ {}", i, o)),
                (Some(i), None) => Some(i),
                (None, Some(o)) => Some(o),
                _ => None,
            };

            let status = state
                .and_then(|s| s.get("status"))
                .and_then(|x| x.as_str())
                .unwrap_or("");
            let done = status == "completed";

            Some(ChatStreamEvent::Activity {
                kind: "tool".into(),
                title: format!("{}: {}", tool, title),
                detail,
                done,
                duration_ms: None,
            })
        }
        "status" => {
            let msg = v
                .get("part")
                .and_then(|p| p.get("text"))
                .and_then(|x| x.as_str())
                .or_else(|| v.get("message").and_then(|x| x.as_str()))
                .or_else(|| v.get("status").and_then(|x| x.as_str()))
                .unwrap_or("กำลังทำงาน…");
            Some(ChatStreamEvent::Activity {
                kind: "status".into(),
                title: msg.to_string(),
                detail: None,
                done: false,
                duration_ms: None,
            })
        }
        "system" => None,
        _ => {
            // Best-effort fallback: anything with `part.title` or `part.text`.
            if let Some(part) = v.get("part") {
                if let Some(t) = part
                    .get("title")
                    .and_then(|x| x.as_str())
                    .or_else(|| part.get("text").and_then(|x| x.as_str()))
                {
                    if !t.trim().is_empty() {
                        return Some(ChatStreamEvent::Activity {
                            kind: typ.to_string(),
                            title: t.to_string(),
                            detail: None,
                            done: false,
                            duration_ms: None,
                        });
                    }
                }
            }
            None
        }
    }
}

/// Bun prints an `EPIPE` stack trace when the parent closes the pipe early.
/// These lines are not user-facing errors, so we filter them out.
pub fn is_epipe_noise(line: &str) -> bool {
    let l = line.to_lowercase();
    l.contains("epipe")
        || l.contains("broken pipe")
        || l.contains("at write")
        || l.contains("at z (")
        || l.contains("at x (")
        || l.contains("processticksand")
        || l.contains("writefast")
        || l.contains("errno: -32")
        || l.trim_start().starts_with("fd:")
        || l.trim_start().starts_with("syscall:")
        || l.trim_start().starts_with("code:")
        || l.trim() == "at write (unknown:1:1)"
}
