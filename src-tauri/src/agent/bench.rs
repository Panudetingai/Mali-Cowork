//! One benchmark run of Mali's own agent, for `scripts/token-bench`: the
//! task comes from the environment, the run uses a real model, and what it
//! cost and answered goes to a JSON file. Ignored unless asked for:
//!
//! `BENCH_IN=task.json BENCH_OUT=out.json cargo test --lib agent::bench -- --ignored`
//!
//! `task.json`: `{prompt, cwd, provider, model, apiKey, baseUrl?, mcpUrl?, contextLimit?}`.
//! `MALI_TOKEN_SAVER=0` turns the token savers off, for the "before" run.

use std::sync::{Arc, Mutex};

use serde_json::{json, Value};
use tauri::ipc::{Channel, InvokeResponseBody};

use super::{generate, AgentRequest};
use crate::chat_stream::ChatStreamEvent;

#[tokio::test]
#[ignore]
async fn bench_run() {
    let input = std::env::var("BENCH_IN").expect("BENCH_IN: the task file");
    let output = std::env::var("BENCH_OUT").expect("BENCH_OUT: where the result goes");
    let task: Value = serde_json::from_str(&std::fs::read_to_string(&input).unwrap()).unwrap();
    let text = |key: &str| task[key].as_str().map(str::to_string);

    let events = Arc::new(Mutex::new(Vec::<Value>::new()));
    let sink = events.clone();
    let channel: Channel<ChatStreamEvent> = Channel::new(move |body| {
        if let InvokeResponseBody::Json(raw) = body {
            if let Ok(event) = serde_json::from_str::<Value>(&raw) {
                sink.lock().unwrap().push(event);
            }
        }
        Ok(())
    });
    let mcp = match text("mcpUrl") {
        Some(url) => vec![serde_json::from_value(json!({
            "id": "acme", "enabled": true, "kind": "remote", "url": url,
        }))
        .unwrap()],
        None => vec![],
    };
    let request = AgentRequest {
        prompt: text("prompt").unwrap(),
        provider: text("provider").unwrap(),
        model: text("model").unwrap(),
        api_key: text("apiKey"),
        base_url: text("baseUrl"),
        session_id: None,
        mode: Some("cowork".into()),
        cwd: text("cwd"),
        folders: vec![],
        instructions: text("instructions"),
        effort: None,
        auto_approve: true,
        sandbox: true,
        run_id: format!("bench-{}", uuid::Uuid::new_v4().simple()),
        mcp,
        images: vec![],
        context_limit: task["contextLimit"].as_u64(),
        vision: false,
        lead: false,
        team: vec![],
        recent_work: vec![],
        declined: vec![],
        tool_scope: None,
        coach: None,
        notebook: vec![],
    };
    let started = std::time::Instant::now();
    let result = generate(request, channel).await;

    let events = events.lock().unwrap();
    let answer: String = events
        .iter()
        .filter(|e| e["event"] == "chunk")
        .filter_map(|e| e["data"]["text"].as_str())
        .collect();
    let usage = events
        .iter()
        .rev()
        .find_map(|e| (e["event"] == "metadata" && e["data"]["usage"].is_object()).then(|| e["data"]["usage"].clone()))
        .unwrap_or(Value::Null);
    let tools: Vec<Value> = events
        .iter()
        .filter(|e| e["event"] == "activity" && e["data"]["kind"] == "tool" && e["data"]["done"] == true)
        .map(|e| e["data"]["title"].clone())
        .collect();
    let error = events
        .iter()
        .find_map(|e| (e["event"] == "error").then(|| e["data"]["message"].clone()))
        .or_else(|| result.err().map(Value::from));
    let out = json!({
        "answer": answer,
        "usage": usage,
        "tools": tools,
        "error": error,
        "durationMs": started.elapsed().as_millis() as u64,
    });
    std::fs::write(&output, serde_json::to_string_pretty(&out).unwrap()).unwrap();
}
