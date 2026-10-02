//! One model call, streamed: the OpenAI-compatible chat completions API
//! (OpenAI, Gemini, Grok, DeepSeek, Mistral, Qwen, Z.ai, Moonshot, OpenRouter,
//! Groq, Ollama) or Anthropic's messages API. Text and reasoning go out as
//! they arrive; tool calls come back whole once the model is done.

use std::collections::BTreeMap;
use std::time::Duration;

use futures::StreamExt;
use serde_json::{json, Value};
use tokio::sync::watch;

use super::wire::{parse_args, Delta, ModelTarget, Msg, SseLines, StepResult, ToolCall, ToolSpec, Usage, Wire};

/// Anthropic needs an explicit output cap; a long file written in one call needs room.
const ANTHROPIC_MAX_TOKENS: u64 = 16_000;
const ANTHROPIC_FALLBACK_MAX_TOKENS: u64 = 8_192;

pub const STOPPED: &str = "Stopped.";

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(30))
        // A model can think for a long time before its first token.
        .read_timeout(Duration::from_secs(300))
        .build()
        .map_err(|e| e.to_string())
}

/// Call the model once. `cancel` turning true stops it with [`STOPPED`].
pub async fn step(
    target: &ModelTarget,
    system: &str,
    msgs: &[Msg],
    tools: &[ToolSpec],
    on_delta: &mut (dyn FnMut(Delta) + Send),
    cancel: &mut watch::Receiver<bool>,
) -> Result<StepResult, String> {
    match target.wire {
        Wire::OpenAi => openai_step(target, system, msgs, tools, on_delta, cancel).await,
        Wire::Anthropic => {
            match anthropic_step(target, system, msgs, tools, on_delta, cancel, ANTHROPIC_MAX_TOKENS).await {
                // Older models cap output lower; ask again within their limit.
                Err(e) if e.contains("max_tokens") && !e.starts_with(STOPPED) => {
                    anthropic_step(target, system, msgs, tools, on_delta, cancel, ANTHROPIC_FALLBACK_MAX_TOKENS)
                        .await
                }
                // A model that takes no effort setting (Haiku 4.5, older ones): ask again without it.
                Err(e) if target.effort.is_some() && rejects_effort(&e) => {
                    let plain = ModelTarget { effort: None, ..target.clone() };
                    anthropic_step(&plain, system, msgs, tools, on_delta, cancel, ANTHROPIC_MAX_TOKENS).await
                }
                other => other,
            }
        }
    }
}

async fn send(request: reqwest::RequestBuilder) -> Result<reqwest::Response, String> {
    let response = request.send().await.map_err(|e| format!("Couldn't reach the provider: {e}"))?;
    let status = response.status();
    if status.is_success() {
        return Ok(response);
    }
    let body = response.text().await.unwrap_or_default();
    let detail = serde_json::from_str::<Value>(&body)
        .ok()
        .and_then(|v| {
            v["error"]["message"]
                .as_str()
                .or_else(|| v["message"].as_str())
                .or_else(|| v[0]["error"]["message"].as_str())
                .map(str::to_string)
        })
        .unwrap_or_else(|| body.chars().take(600).collect());
    Err(format!("{} {}: {detail}", status.as_u16(), status.canonical_reason().unwrap_or("")))
}

/// Read the stream to the end, handing each `data:` payload to `on_data`.
async fn read_events(
    response: reqwest::Response,
    cancel: &mut watch::Receiver<bool>,
    mut on_data: impl FnMut(&str) -> Result<bool, String>,
) -> Result<(), String> {
    let mut stream = response.bytes_stream();
    let mut sse = SseLines::new();
    loop {
        let chunk = tokio::select! {
            chunk = stream.next() => chunk,
            _ = cancel.wait_for(|stopped| *stopped) => return Err(STOPPED.into()),
        };
        let Some(chunk) = chunk else { return Ok(()) };
        let bytes = chunk.map_err(|e| format!("The provider's stream broke off: {e}"))?;
        for data in sse.push(&bytes) {
            if !on_data(&data)? {
                return Ok(());
            }
        }
    }
}

// ---------------------------------------------------------------- OpenAI

/// A picture ready to send.
struct Picture {
    data_url: String,
    mime: String,
}

impl Picture {
    fn base64(&self) -> &str {
        self.data_url.split_once(";base64,").map(|(_, b)| b).unwrap_or_default()
    }
}

fn pictures_of(paths: &[String]) -> Vec<Picture> {
    paths
        .iter()
        .filter_map(|p| crate::commands::attachments::data_url(p).ok())
        .filter(|(_, mime, _)| mime.starts_with("image/"))
        .map(|(data_url, mime, _)| Picture { data_url, mime })
        .collect()
}

/// Pictures from older turns aren't resent; the model is told they were there.
fn with_image_names(text: &str, images: &[String], recent: bool) -> String {
    if images.is_empty() || recent {
        return text.to_string();
    }
    let names: Vec<&str> = images.iter().map(|p| p.rsplit(['/', '\\']).next().unwrap_or(p)).collect();
    format!("{text}\n\n[Pictures attached earlier: {}]", names.join(", "))
}

/// Pictures travel with the last two prompts only, to keep every later
/// request from paying for them again.
fn recent_user_index(msgs: &[Msg]) -> usize {
    msgs.iter()
        .enumerate()
        .filter(|(_, m)| matches!(m, Msg::User { .. }))
        .map(|(i, _)| i)
        .rev()
        .nth(1)
        .unwrap_or(0)
}

fn openai_messages(system: &str, msgs: &[Msg]) -> Vec<Value> {
    let mut out = vec![json!({ "role": "system", "content": system })];
    let recent_from = recent_user_index(msgs);
    // Pictures from tools are shown while the current prompt is being worked on.
    let last_user = msgs.iter().rposition(|m| matches!(m, Msg::User { .. })).unwrap_or(0);
    let mut pending: Vec<Value> = Vec::new();
    for (index, msg) in msgs.iter().enumerate() {
        out.push(match msg {
            Msg::User { text, images } => {
                let pictures = if index >= recent_from { pictures_of(images) } else { Vec::new() };
                if pictures.is_empty() {
                    json!({ "role": "user", "content": with_image_names(text, images, index >= recent_from) })
                } else {
                    let mut parts = vec![json!({ "type": "text", "text": text })];
                    parts.extend(pictures.iter().map(|p| json!({ "type": "image_url", "image_url": { "url": p.data_url } })));
                    json!({ "role": "user", "content": parts })
                }
            }
            Msg::Assistant { text, tool_calls } => {
                let mut m = json!({ "role": "assistant", "content": text });
                if !tool_calls.is_empty() {
                    if text.is_empty() {
                        m["content"] = Value::Null;
                    }
                    m["tool_calls"] = tool_calls
                        .iter()
                        .map(|c| {
                            json!({
                                "id": c.id,
                                "type": "function",
                                "function": { "name": c.name, "arguments": c.args.to_string() },
                            })
                        })
                        .collect();
                }
                m
            }
            Msg::Tool { call_id, name, content, images, .. } => {
                let recent = index > last_user;
                if recent {
                    pending.extend(images.iter().map(|i| {
                        json!({ "type": "image_url", "image_url": { "url": format!("data:{};base64,{}", i.mime, i.data) } })
                    }));
                }
                let content = if images.is_empty() || recent {
                    content.clone()
                } else {
                    format!("{content}\n[The picture it returned is no longer shown.]")
                };
                json!({ "role": "tool", "tool_call_id": call_id, "name": name, "content": content })
            }
        });
        // Tool messages can't carry pictures here: they follow the tool
        // results as one user message, once the run of results ends.
        let run_ends = !matches!(msgs.get(index + 1), Some(Msg::Tool { .. }));
        if run_ends && !pending.is_empty() {
            let mut parts = vec![json!({ "type": "text", "text": "Pictures returned by the tools above:" })];
            parts.append(&mut pending);
            out.push(json!({ "role": "user", "content": parts }));
        }
    }
    out
}

#[derive(Default)]
struct PartialCall {
    id: String,
    name: String,
    args: String,
}

async fn openai_step(
    target: &ModelTarget,
    system: &str,
    msgs: &[Msg],
    tools: &[ToolSpec],
    on_delta: &mut (dyn FnMut(Delta) + Send),
    cancel: &mut watch::Receiver<bool>,
) -> Result<StepResult, String> {
    let mut body = json!({
        "model": target.model,
        "messages": openai_messages(system, msgs),
        "stream": true,
        "stream_options": { "include_usage": true },
    });
    if !tools.is_empty() {
        body["tools"] = tools
            .iter()
            .map(|t| {
                json!({
                    "type": "function",
                    "function": { "name": t.name, "description": t.description, "parameters": t.schema },
                })
            })
            .collect();
    }
    if let Some(effort) = &target.effort {
        body["reasoning_effort"] = json!(effort);
    }
    let url = format!("{}/chat/completions", target.base_url.trim_end_matches('/'));
    let response = send(client()?.post(url).bearer_auth(&target.api_key).json(&body)).await?;

    let mut result = StepResult::default();
    let mut calls: BTreeMap<u64, PartialCall> = BTreeMap::new();
    read_events(response, cancel, |data| {
        if data == "[DONE]" {
            return Ok(false);
        }
        let Ok(event) = serde_json::from_str::<Value>(data) else { return Ok(true) };
        if let Some(message) = event["error"]["message"].as_str() {
            return Err(message.to_string());
        }
        if let Some(usage) = event.get("usage").filter(|u| u.is_object()) {
            result.usage = Usage {
                input: usage["prompt_tokens"].as_u64().unwrap_or(0),
                output: usage["completion_tokens"].as_u64().unwrap_or(0),
                cache_read: usage["prompt_tokens_details"]["cached_tokens"].as_u64().unwrap_or(0),
                cache_write: 0,
                reasoning: usage["completion_tokens_details"]["reasoning_tokens"].as_u64().unwrap_or(0),
            };
        }
        let delta = &event["choices"][0]["delta"];
        if let Some(text) = delta["content"].as_str().filter(|t| !t.is_empty()) {
            result.text.push_str(text);
            on_delta(Delta::Text(text.to_string()));
        }
        let reasoning = delta["reasoning_content"].as_str().or_else(|| delta["reasoning"].as_str());
        if let Some(text) = reasoning.filter(|t| !t.is_empty()) {
            on_delta(Delta::Reasoning(text.to_string()));
        }
        for (position, call) in delta["tool_calls"].as_array().into_iter().flatten().enumerate() {
            // Some providers leave `index` out when there's only one call per chunk.
            let index = call["index"].as_u64().unwrap_or(position as u64);
            let entry = calls.entry(index).or_default();
            if let Some(id) = call["id"].as_str().filter(|s| !s.is_empty()) {
                entry.id = id.to_string();
            }
            if let Some(name) = call["function"]["name"].as_str() {
                entry.name.push_str(name);
            }
            if let Some(args) = call["function"]["arguments"].as_str() {
                entry.args.push_str(args);
            } else if let Some(args) = call["function"]["arguments"].as_object() {
                // Gemini sometimes sends the arguments already parsed.
                entry.args = Value::Object(args.clone()).to_string();
            }
        }
        Ok(true)
    })
    .await?;

    result.tool_calls = calls
        .into_values()
        .filter(|c| !c.name.is_empty())
        .map(|c| ToolCall {
            id: if c.id.is_empty() { format!("call_{}", uuid::Uuid::new_v4().simple()) } else { c.id },
            name: c.name,
            args: parse_args(&c.args),
        })
        .collect();
    Ok(result)
}

// ------------------------------------------------------------- Anthropic

/// Anthropic wants turns to alternate, with tool results inside a user turn.
fn anthropic_messages(msgs: &[Msg]) -> Vec<Value> {
    let mut out: Vec<Value> = Vec::new();
    let mut push = |role: &str, blocks: Vec<Value>| {
        if blocks.is_empty() {
            return;
        }
        if let Some(last) = out.last_mut().filter(|m| m["role"] == role) {
            if let Some(content) = last["content"].as_array_mut() {
                content.extend(blocks);
                return;
            }
        }
        out.push(json!({ "role": role, "content": blocks }));
    };
    let recent_from = recent_user_index(msgs);
    let last_user = msgs.iter().rposition(|m| matches!(m, Msg::User { .. })).unwrap_or(0);
    for (index, msg) in msgs.iter().enumerate() {
        match msg {
            Msg::User { text, images } => {
                let recent = index >= recent_from;
                let mut blocks: Vec<Value> = if recent {
                    pictures_of(images)
                        .iter()
                        .map(|p| json!({ "type": "image", "source": { "type": "base64", "media_type": p.mime, "data": p.base64() } }))
                        .collect()
                } else {
                    Vec::new()
                };
                blocks.push(json!({ "type": "text", "text": with_image_names(text, images, recent) }));
                push("user", blocks)
            }
            Msg::Assistant { text, tool_calls } => {
                let mut blocks = Vec::new();
                if !text.trim().is_empty() {
                    blocks.push(json!({ "type": "text", "text": text }));
                }
                for call in tool_calls {
                    let input = if call.args.is_object() { call.args.clone() } else { json!({}) };
                    blocks.push(json!({ "type": "tool_use", "id": call.id, "name": call.name, "input": input }));
                }
                push("assistant", blocks);
            }
            Msg::Tool { call_id, content, is_error, images, .. } => {
                let text = if content.is_empty() { "(no output)" } else { content.as_str() };
                let result = if images.is_empty() {
                    json!(text)
                } else if index > last_user {
                    let mut parts = vec![json!({ "type": "text", "text": text })];
                    parts.extend(images.iter().map(|i| {
                        json!({ "type": "image", "source": { "type": "base64", "media_type": i.mime, "data": i.data } })
                    }));
                    Value::Array(parts)
                } else {
                    json!(format!("{text}\n[The picture it returned is no longer shown.]"))
                };
                push(
                    "user",
                    vec![json!({ "type": "tool_result", "tool_use_id": call_id, "content": result, "is_error": is_error })],
                )
            }
        }
    }
    out
}

fn rejects_effort(error: &str) -> bool {
    let e = error.to_ascii_lowercase();
    e.starts_with("400") && (e.contains("effort") || e.contains("output_config"))
}

/// The request body. Effort goes in `output_config` (low … max, as the model
/// lists them); it's only sent for a model whose metadata offers levels.
///
/// Cached, so each step of a run (and the next message) re-reads what it
/// already sent at a tenth of the price and without counting against the
/// input rate limit: the tools and system prompt are a breakpoint of their
/// own (the same for every chat that day), and the top-level `cache_control`
/// moves along the conversation as it grows.
fn anthropic_body(target: &ModelTarget, system: &str, msgs: &[Msg], tools: &[ToolSpec], max_tokens: u64) -> Value {
    let mut body = json!({
        "model": target.model,
        "max_tokens": max_tokens,
        "system": [{ "type": "text", "text": system, "cache_control": { "type": "ephemeral" } }],
        "messages": anthropic_messages(msgs),
        "cache_control": { "type": "ephemeral" },
        "stream": true,
    });
    if !tools.is_empty() {
        body["tools"] = tools
            .iter()
            .map(|t| json!({ "name": t.name, "description": t.description, "input_schema": t.schema }))
            .collect();
    }
    if let Some(effort) = target.effort.as_deref().map(str::trim).filter(|e| !e.is_empty()) {
        body["output_config"] = json!({ "effort": effort });
    }
    body
}

async fn anthropic_step(
    target: &ModelTarget,
    system: &str,
    msgs: &[Msg],
    tools: &[ToolSpec],
    on_delta: &mut (dyn FnMut(Delta) + Send),
    cancel: &mut watch::Receiver<bool>,
    max_tokens: u64,
) -> Result<StepResult, String> {
    let body = anthropic_body(target, system, msgs, tools, max_tokens);
    let url = format!("{}/messages", target.base_url.trim_end_matches('/'));
    let request = client()?
        .post(url)
        .header("x-api-key", &target.api_key)
        .header("anthropic-version", "2023-06-01")
        .json(&body);
    let response = send(request).await?;

    let mut result = StepResult::default();
    let mut calls: BTreeMap<u64, PartialCall> = BTreeMap::new();
    read_events(response, cancel, |data| {
        let Ok(event) = serde_json::from_str::<Value>(data) else { return Ok(true) };
        match event["type"].as_str().unwrap_or_default() {
            "message_start" => {
                let usage = &event["message"]["usage"];
                result.usage.input = usage["input_tokens"].as_u64().unwrap_or(0);
                result.usage.cache_read = usage["cache_read_input_tokens"].as_u64().unwrap_or(0);
                result.usage.cache_write = usage["cache_creation_input_tokens"].as_u64().unwrap_or(0);
            }
            "content_block_start" => {
                let block = &event["content_block"];
                if block["type"] == "tool_use" {
                    let index = event["index"].as_u64().unwrap_or(0);
                    calls.insert(
                        index,
                        PartialCall {
                            id: block["id"].as_str().unwrap_or_default().to_string(),
                            name: block["name"].as_str().unwrap_or_default().to_string(),
                            args: String::new(),
                        },
                    );
                }
            }
            "content_block_delta" => {
                let delta = &event["delta"];
                match delta["type"].as_str().unwrap_or_default() {
                    "text_delta" => {
                        if let Some(text) = delta["text"].as_str() {
                            result.text.push_str(text);
                            on_delta(Delta::Text(text.to_string()));
                        }
                    }
                    "thinking_delta" => {
                        if let Some(text) = delta["thinking"].as_str() {
                            on_delta(Delta::Reasoning(text.to_string()));
                        }
                    }
                    "input_json_delta" => {
                        let index = event["index"].as_u64().unwrap_or(0);
                        if let (Some(call), Some(part)) = (calls.get_mut(&index), delta["partial_json"].as_str()) {
                            call.args.push_str(part);
                        }
                    }
                    _ => {}
                }
            }
            "message_delta" => {
                if let Some(out) = event["usage"]["output_tokens"].as_u64() {
                    result.usage.output = out;
                }
            }
            "message_stop" => return Ok(false),
            "error" => {
                return Err(event["error"]["message"].as_str().unwrap_or("The provider reported an error.").to_string())
            }
            _ => {}
        }
        Ok(true)
    })
    .await?;

    result.tool_calls = calls
        .into_values()
        .filter(|c| !c.name.is_empty())
        .map(|c| ToolCall { id: c.id, name: c.name, args: parse_args(&c.args) })
        .collect();
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn convo() -> Vec<Msg> {
        vec![
            Msg::User { text: "hi".into(), images: vec![] },
            Msg::Assistant {
                text: String::new(),
                tool_calls: vec![
                    ToolCall { id: "a".into(), name: "read_file".into(), args: json!({"path": "x"}) },
                    ToolCall { id: "b".into(), name: "list_dir".into(), args: json!({}) },
                ],
            },
            Msg::Tool { call_id: "a".into(), name: "read_file".into(), content: "1".into(), is_error: false, images: Vec::new() },
            Msg::Tool { call_id: "b".into(), name: "list_dir".into(), content: String::new(), is_error: true, images: Vec::new() },
            // An interrupted turn: the next prompt follows tool results directly.
            Msg::User { text: "go on".into(), images: vec![] },
        ]
    }

    #[test]
    fn pictures_from_tools_reach_the_model_while_the_prompt_is_worked_on() {
        use crate::agent::wire::ToolImage;
        let pic = || vec![ToolImage { mime: "image/png".into(), data: "AAAA".into() }];
        let call = |id: &str| ToolCall { id: id.into(), name: "view_image".into(), args: json!({"source": "a.png"}) };
        let msgs = vec![
            Msg::User { text: "earlier".into(), images: vec![] },
            Msg::Assistant { text: String::new(), tool_calls: vec![call("old")] },
            Msg::Tool { call_id: "old".into(), name: "view_image".into(), content: "old pic".into(), is_error: false, images: pic() },
            Msg::User { text: "now".into(), images: vec![] },
            Msg::Assistant { text: String::new(), tool_calls: vec![call("a"), call("b")] },
            Msg::Tool { call_id: "a".into(), name: "view_image".into(), content: "pic a".into(), is_error: false, images: pic() },
            Msg::Tool { call_id: "b".into(), name: "view_image".into(), content: "no pic".into(), is_error: false, images: vec![] },
        ];
        let out = openai_messages("s", &msgs);
        // The older turn's picture is only mentioned.
        assert!(out[3]["content"].as_str().unwrap().contains("no longer shown"));
        // Both tool results stay together, then one user message carries the picture.
        let roles: Vec<_> = out.iter().map(|m| m["role"].as_str().unwrap()).collect();
        assert_eq!(roles, ["system", "user", "assistant", "tool", "user", "assistant", "tool", "tool", "user"]);
        assert_eq!(out[8]["content"][1]["image_url"]["url"], "data:image/png;base64,AAAA");

        let anthropic = anthropic_messages(&msgs);
        let last = anthropic.last().unwrap()["content"].as_array().unwrap().clone();
        assert_eq!(last[0]["content"][1]["type"], "image");
        assert_eq!(last[0]["content"][1]["source"]["data"], "AAAA");
        assert_eq!(last[1]["content"], "no pic");
    }

    #[test]
    fn anthropic_effort_goes_in_output_config() {
        let mut target = ModelTarget {
            wire: Wire::Anthropic,
            provider: "anthropic".into(),
            model: "claude-sonnet-5".into(),
            base_url: String::new(),
            api_key: String::new(),
            effort: Some("high".into()),
        };
        let body = anthropic_body(&target, "s", &convo(), &[], 16_000);
        assert_eq!(body["output_config"]["effort"], "high");
        assert!(body.get("effort").is_none() && body.get("thinking").is_none());
        target.effort = None;
        assert!(anthropic_body(&target, "s", &convo(), &[], 16_000).get("output_config").is_none());
        let cached = anthropic_body(&target, "s", &convo(), &[], 16_000);
        assert_eq!(cached["cache_control"]["type"], "ephemeral");
        assert_eq!(cached["system"][0]["cache_control"]["type"], "ephemeral");
        assert!(rejects_effort("400 Bad Request: output_config.effort: not supported on this model"));
        assert!(!rejects_effort("401 Unauthorized: invalid x-api-key"));
    }

    #[test]
    fn only_the_last_two_prompts_carry_pictures() {
        let user = |t: &str| Msg::User { text: t.into(), images: vec!["/x/a.png".into()] };
        let msgs = vec![user("one"), Msg::Assistant { text: "ok".into(), tool_calls: vec![] }, user("two"), user("three")];
        assert_eq!(recent_user_index(&msgs), 2);
        let out = openai_messages("s", &msgs);
        // The oldest names its picture instead of sending it again.
        assert_eq!(out[1]["content"], "one\n\n[Pictures attached earlier: a.png]");
        // Recent ones would send it (here the file isn't a real attachment, so plain text).
        assert_eq!(out[3]["content"], "two");
    }

    #[test]
    fn anthropic_merges_tool_results_and_follow_up_into_one_user_turn() {
        let out = anthropic_messages(&convo());
        let roles: Vec<_> = out.iter().map(|m| m["role"].as_str().unwrap()).collect();
        assert_eq!(roles, ["user", "assistant", "user"]);
        let last = out[2]["content"].as_array().unwrap();
        assert_eq!(last.len(), 3);
        assert_eq!(last[0]["type"], "tool_result");
        assert_eq!(last[1]["is_error"], true);
        assert_eq!(last[1]["content"], "(no output)");
        assert_eq!(last[2]["type"], "text");
        // No empty text block before the tool calls.
        assert_eq!(out[1]["content"][0]["type"], "tool_use");
    }

    #[test]
    fn openai_sends_tool_calls_with_null_content() {
        let out = openai_messages("sys", &convo());
        assert_eq!(out[0]["role"], "system");
        assert!(out[2]["content"].is_null());
        assert_eq!(out[2]["tool_calls"][0]["function"]["arguments"], "{\"path\":\"x\"}");
        assert_eq!(out[3]["role"], "tool");
        assert_eq!(out[3]["tool_call_id"], "a");
    }
}
