//! The user's own bots ("Your bots") as an MCP server, for Claude Code and
//! other agents on this computer: one `ask_<bot>` tool each, plus
//! `list_bots`. A call runs the bot in Mali — on its model, with its
//! instructions, skills and connectors — and returns what it reports.
//!
//! It listens on the loopback only, on a port that stays the same, and
//! answers only requests with this install's token (kept in Mali's data
//! folder, replaced with "Reset"). Bots run in Chat mode: no folder, so no
//! file tools and nothing waits on a question in Mali's window. The agent
//! that calls asks its own user before it calls a tool.

use std::collections::{BTreeMap, BTreeSet};
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::ipc::Channel;
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::watch;

use super::team::{self, Handoff, Teammate};
use super::wire::{ToolCall, Usage};
use super::AgentRequest;
use crate::mcp_hub::client::PROTOCOL_VERSION;
use crate::mcp_hub::gateway::{host_ok, read_request, respond, same_secret};

pub const DEFAULT_PORT: u16 = 47917;
const SERVER_NAME: &str = "mali-bots";
const LIST: &str = "list_bots";

#[derive(Clone, Serialize, Deserialize)]
struct Saved {
    port: u16,
    token: String,
    #[serde(default)]
    enabled: bool,
}

#[derive(Default)]
struct State {
    /// The bots as the app last sent them: everything a run needs.
    bots: Vec<Teammate>,
    /// Set while the server runs: sending `true` stops it.
    stop: Option<watch::Sender<bool>>,
    error: Option<String>,
}

fn state() -> &'static Mutex<State> {
    static STATE: OnceLock<Mutex<State>> = OnceLock::new();
    STATE.get_or_init(Default::default)
}

#[cfg(not(test))]
fn saved_path() -> PathBuf {
    dirs::data_local_dir().unwrap_or_else(std::env::temp_dir).join("mali-cowork").join("bots-mcp.json")
}

/// Tests never touch the real token.
#[cfg(test)]
fn saved_path() -> PathBuf {
    static PATH: OnceLock<PathBuf> = OnceLock::new();
    PATH.get_or_init(|| std::env::temp_dir().join(format!("mali-bots-mcp-test-{}.json", uuid::Uuid::new_v4().simple()))).clone()
}

fn new_token() -> String {
    format!("{}{}", uuid::Uuid::new_v4().simple(), uuid::Uuid::new_v4().simple())
}

fn load() -> Saved {
    std::fs::read_to_string(saved_path())
        .ok()
        .and_then(|raw| serde_json::from_str::<Saved>(&raw).ok())
        .filter(|s| s.token.len() >= 32 && s.port > 0)
        .unwrap_or_else(|| Saved { port: DEFAULT_PORT, token: new_token(), enabled: false })
}

fn store(saved: &Saved) {
    let path = saved_path();
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    if std::fs::write(&path, serde_json::to_string_pretty(saved).unwrap_or_default()).is_ok() {
        // The token opens your bots: only you may read it.
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BotsMcpStatus {
    enabled: bool,
    running: bool,
    port: u16,
    url: String,
    token: String,
    /// The tools callers see now, `name — bot`.
    tools: Vec<String>,
    error: Option<String>,
}

fn status() -> BotsMcpStatus {
    let saved = load();
    let st = state().lock().unwrap();
    BotsMcpStatus {
        enabled: saved.enabled,
        running: st.stop.is_some(),
        port: saved.port,
        url: format!("http://127.0.0.1:{}/mcp", saved.port),
        token: saved.token,
        tools: tool_names(&st.bots).into_iter().map(|(tool, bot)| format!("{tool} — {}", bot.name)).collect(),
        error: st.error.clone(),
    }
}

/// The app sends the user's bots whenever they (or their models, keys, connectors) change.
#[tauri::command]
pub fn bots_mcp_publish(bots: Vec<Teammate>) {
    state().lock().unwrap().bots = bots;
}

#[tauri::command]
pub fn bots_mcp_status() -> BotsMcpStatus {
    status()
}

/// Turn the server on (it stays on across launches) or off.
#[tauri::command]
pub async fn bots_mcp_set_enabled(enabled: bool) -> BotsMcpStatus {
    let mut saved = load();
    saved.enabled = enabled;
    store(&saved);
    stop();
    if enabled {
        if let Err(error) = start(saved.port).await {
            state().lock().unwrap().error = Some(error);
        }
    }
    status()
}

/// A new token: whatever had the old one can't call your bots any more.
#[tauri::command]
pub fn bots_mcp_reset_token() -> BotsMcpStatus {
    let mut saved = load();
    saved.token = new_token();
    store(&saved);
    status()
}

/// At launch: back on if it was on.
pub fn resume() {
    if load().enabled {
        tauri::async_runtime::spawn(async {
            if let Err(error) = start(load().port).await {
                state().lock().unwrap().error = Some(error);
            }
        });
    }
}

fn stop() {
    let mut st = state().lock().unwrap();
    if let Some(stop) = st.stop.take() {
        let _ = stop.send(true);
    }
    st.error = None;
}

async fn start(port: u16) -> Result<(), String> {
    let listener = TcpListener::bind(("127.0.0.1", port))
        .await
        .map_err(|e| format!("Port {port} is taken ({e}). Close what uses it, then turn this on again."))?;
    let (tx, mut rx) = watch::channel(false);
    {
        let mut st = state().lock().unwrap();
        st.stop = Some(tx);
        st.error = None;
    }
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::select! {
                accepted = listener.accept() => {
                    let Ok((stream, peer)) = accepted else { continue };
                    if !peer.ip().is_loopback() {
                        continue;
                    }
                    tokio::spawn(async move {
                        let _ = handle(stream, port).await;
                    });
                }
                _ = rx.wait_for(|stopped| *stopped) => break,
            }
        }
    });
    Ok(())
}

async fn handle(mut stream: TcpStream, port: u16) -> Option<()> {
    let request = read_request(&mut stream).await?;
    if request.path.split('?').next() != Some("/mcp") {
        respond(&mut stream, "404 Not Found", &[], "").await;
        return Some(());
    }
    // Only its own host name: a web page can't point a domain of its own here.
    if !host_ok(request.header("host"), port) {
        respond(&mut stream, "403 Forbidden", &[], "").await;
        return Some(());
    }
    let token = load().token;
    let authorized = request
        .header("authorization")
        .and_then(|v| v.strip_prefix("Bearer "))
        .is_some_and(|t| same_secret(t.trim(), &token));
    if !authorized {
        respond(&mut stream, "401 Unauthorized", &[], "").await;
        return Some(());
    }
    match request.method.as_str() {
        "POST" => {}
        "DELETE" => {
            respond(&mut stream, "200 OK", &[], "").await;
            return Some(());
        }
        _ => {
            respond(&mut stream, "405 Method Not Allowed", &[("allow", "POST, DELETE".into())], "").await;
            return Some(());
        }
    }
    let Ok(message) = serde_json::from_slice::<Value>(&request.body) else {
        let error = json!({ "jsonrpc": "2.0", "id": null, "error": { "code": -32700, "message": "Parse error" } });
        respond(&mut stream, "400 Bad Request", &[], &error.to_string()).await;
        return Some(());
    };
    let session = [("mcp-session-id", SERVER_NAME.to_string())];
    let answer = match &message {
        Value::Array(batch) => {
            let mut out = Vec::new();
            for m in batch {
                if let Some(reply) = dispatch(m).await {
                    out.push(reply);
                }
            }
            (!out.is_empty()).then(|| Value::Array(out))
        }
        m => dispatch(m).await,
    };
    match answer {
        Some(reply) => respond(&mut stream, "200 OK", &session, &reply.to_string()).await,
        None => respond(&mut stream, "202 Accepted", &session, "").await,
    }
    Some(())
}

/// `ask_<name>` for each bot, from its name; its id when the name has no Latin letters.
fn tool_names(bots: &[Teammate]) -> Vec<(String, &Teammate)> {
    let mut used = BTreeSet::new();
    bots.iter()
        .map(|bot| {
            let mut slug: String = bot
                .name
                .to_lowercase()
                .chars()
                .map(|c| if c.is_ascii_alphanumeric() { c } else { '_' })
                .collect();
            slug = slug.split('_').filter(|p| !p.is_empty()).collect::<Vec<_>>().join("_");
            if slug.is_empty() {
                slug = bot.id.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '_').collect();
            }
            slug.truncate(48);
            let mut name = format!("ask_{slug}");
            let mut n = 2;
            while !used.insert(name.clone()) {
                name = format!("ask_{slug}_{n}");
                n += 1;
            }
            (name, bot)
        })
        .collect()
}

fn model_of(bot: &Teammate) -> String {
    match &bot.cli {
        Some(cli) => cli.kind.clone(),
        None => format!("{}/{}", bot.provider, bot.model),
    }
}

async fn dispatch(message: &Value) -> Option<Value> {
    let id = message.get("id").cloned()?;
    let method = message["method"].as_str().unwrap_or_default();
    let result = match method {
        "initialize" => Ok(json!({
            "protocolVersion": message["params"]["protocolVersion"].as_str().unwrap_or(PROTOCOL_VERSION),
            "capabilities": { "tools": { "listChanged": false } },
            "serverInfo": { "name": SERVER_NAME, "title": "Your bots in Mali Cowork", "version": env!("CARGO_PKG_VERSION") },
            "instructions": "The user's own bots in Mali Cowork. Each ask_<bot> tool hands one job to that bot, which works on its own model with its own connectors and skills, and returns its answer. Give the whole job and any context in one call.",
        })),
        "ping" => Ok(json!({})),
        "tools/list" => {
            let bots = state().lock().unwrap().bots.clone();
            let mut tools = vec![json!({
                "name": LIST,
                "description": "List the user's bots in Mali Cowork: each one's duty, model and connectors.",
                "inputSchema": { "type": "object", "properties": {} },
            })];
            for (name, bot) in tool_names(&bots) {
                tools.push(json!({
                    "name": name,
                    "description": format!("Ask {} (the user's bot in Mali Cowork). Its duty: {}. Runs on {}.", bot.name, bot.role.trim(), model_of(bot)),
                    "inputSchema": {
                        "type": "object",
                        "properties": {
                            "request": { "type": "string", "description": "The job, in full: what to do and what to send back." },
                            "context": { "type": "string", "description": "Anything it needs to know that isn't in the request." },
                        },
                        "required": ["request"],
                    },
                }));
            }
            Ok(json!({ "tools": tools }))
        }
        "tools/call" => {
            let name = message["params"]["name"].as_str().unwrap_or_default().to_string();
            let args = message["params"].get("arguments").cloned().unwrap_or_else(|| json!({}));
            let (text, is_error) = call(&name, &args).await;
            Ok(json!({ "content": [{ "type": "text", "text": text }], "isError": is_error }))
        }
        "resources/list" => Ok(json!({ "resources": [] })),
        "prompts/list" => Ok(json!({ "prompts": [] })),
        _ => Err((-32601, format!("Method not found: {method}"))),
    };
    Some(match result {
        Ok(result) => json!({ "jsonrpc": "2.0", "id": id, "result": result }),
        Err((code, message)) => json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } }),
    })
}

async fn call(name: &str, args: &Value) -> (String, bool) {
    let bots = state().lock().unwrap().bots.clone();
    if name == LIST {
        if bots.is_empty() {
            return ("No bots yet. In Mali Cowork: Settings › Team, make a bot and turn on \"As my own bot\".".into(), false);
        }
        let lines: Vec<String> = tool_names(&bots)
            .into_iter()
            .map(|(tool, bot)| {
                let connectors: Vec<&str> = bot.mcp.iter().map(|s| s.id.as_str()).collect();
                format!(
                    "- {} (`{tool}`): {} Model: {}.{}",
                    bot.name,
                    bot.role.trim(),
                    model_of(bot),
                    if connectors.is_empty() { String::new() } else { format!(" Connectors: {}.", connectors.join(", ")) }
                )
            })
            .collect();
        return (lines.join("\n"), false);
    }
    let Some(bot) = tool_names(&bots).into_iter().find(|(tool, _)| tool == name).map(|(_, bot)| bot.clone()) else {
        return (format!("There's no bot behind {name} any more. Call {LIST} to see them."), true);
    };
    let task = args["request"].as_str().unwrap_or_default().trim().to_string();
    if task.is_empty() {
        return ("Say what the job is in `request`.".into(), true);
    }
    run(bot, task, args["context"].as_str().unwrap_or_default().to_string()).await
}

/// One job for one bot: the team's hand-off, with the bot as the whole team
/// and nobody to ask (it's the caller's own user who called it).
async fn run(mut bot: Teammate, task: String, context: String) -> (String, bool) {
    bot.approved = true;
    let run_id = format!("mcp-{}", uuid::Uuid::new_v4().simple());
    let mut lead: AgentRequest = match serde_json::from_value(json!({
        "prompt": "", "provider": "", "model": "", "apiKey": null, "baseUrl": null,
        "instructions": null, "effort": null, "runId": run_id, "mode": "chat",
    })) {
        Ok(lead) => lead,
        Err(e) => return (format!("Couldn't start the bot: {e}"), true),
    };
    lead.team = vec![bot.clone()];
    let call = ToolCall { id: run_id.clone(), name: team::DELEGATE.into(), args: json!({ "teammate": bot.id, "task": task, "context": context }) };
    let step = team::step_id(&bot.id, &call.id);
    // Nobody is watching this run in Mali's window; its steps go nowhere.
    let quiet: Channel<crate::chat_stream::ChatStreamEvent> = Channel::new(|_| Ok(()));
    let (_stop, mut cancel) = watch::channel(false);
    let (mut always, mut sessions) = (BTreeSet::new(), BTreeMap::new());
    let mut usage = Usage::default();
    let out = team::delegate(
        &call,
        Handoff {
            lead: &lead,
            step: &step,
            always: &mut always,
            sessions: &mut sessions,
            usage: &mut usage,
            on_event: &quiet,
            cancel: &mut cancel,
        },
    )
    .await;
    (out.content, out.is_error)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bot(name: &str) -> Teammate {
        serde_json::from_value(json!({
            "id": format!("mate_{}", name.len()), "name": name, "role": "Summarizes links", "provider": "groq",
            "model": "llama", "apiKey": null, "baseUrl": null, "tools": "none",
        }))
        .unwrap()
    }

    #[test]
    fn each_bot_is_a_tool_with_a_safe_name() {
        let bots = vec![bot("News Digest"), bot("News digest!"), bot("สรุปข่าว")];
        let names: Vec<String> = tool_names(&bots).into_iter().map(|(n, _)| n).collect();
        assert_eq!(names[0], "ask_news_digest");
        assert_eq!(names[1], "ask_news_digest_2");
        assert!(names[2].starts_with("ask_mate_"), "{}", names[2]);
        assert!(names.iter().all(|n| n.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') && n.len() <= 64));
    }

    /// The whole way an agent like Claude Code sees it: over HTTP, with the token.
    #[tokio::test]
    async fn answers_mcp_over_http_with_the_token_only() {
        let port = std::net::TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port();
        store(&Saved { port, token: new_token(), enabled: true });
        start(port).await.unwrap();
        bots_mcp_publish(vec![bot("News Digest")]);
        let url = format!("http://127.0.0.1:{port}/mcp");
        let http = reqwest::Client::new();
        let list = json!({ "jsonrpc": "2.0", "id": 2, "method": "tools/list" });

        let denied = http.post(&url).json(&list).send().await.unwrap();
        assert_eq!(denied.status(), 401);
        let token = load().token;
        let rebound = http.post(&url).header("authorization", format!("Bearer {token}")).header("host", "evil.example").json(&list).send().await.unwrap();
        assert_eq!(rebound.status(), 403);
        let ok: Value = http.post(&url).header("authorization", format!("Bearer {token}")).json(&list).send().await.unwrap().json().await.unwrap();
        assert!(ok["result"]["tools"].as_array().unwrap().iter().any(|t| t["name"] == "ask_news_digest"));

        // A reset token shuts the old one out.
        bots_mcp_reset_token();
        let stale = http.post(&url).header("authorization", format!("Bearer {token}")).json(&list).send().await.unwrap();
        assert_eq!(stale.status(), 401);
        stop();
    }

    /// Runs a real bot on a local model: `cargo test --lib bot_server -- --ignored`
    /// (needs Ollama with `BOT_TEST_MODEL`, default qwen3:4b-smooth).
    #[tokio::test]
    #[ignore]
    async fn a_bot_answers_on_a_local_model() {
        let model = std::env::var("BOT_TEST_MODEL").unwrap_or_else(|_| "qwen3:4b-smooth".into());
        let local: Teammate = serde_json::from_value(json!({
            "id": "mate_local", "name": "Echo", "role": "Answers in one short sentence",
            "instructions": "Answer in one short sentence. No tools.", "provider": "ollama", "model": model,
            "apiKey": null, "baseUrl": null, "tools": "none",
        }))
        .unwrap();
        bots_mcp_publish(vec![local]);
        let (text, is_error) = call("ask_echo", &json!({ "request": "What colour is the sky on a clear day?" })).await;
        println!("{text}");
        assert!(!is_error, "{text}");
        assert!(text.starts_with("Report from Echo"), "{text}");
    }

    /// As Claude Code does it: HTTP, the token, `tools/call` on a bot running a
    /// local model. `cargo test --lib called_over_http -- --ignored` (needs Ollama).
    #[tokio::test]
    #[ignore]
    async fn a_bot_is_called_over_http_on_a_local_model() {
        let model = std::env::var("BOT_TEST_MODEL").unwrap_or_else(|_| "qwen3:4b-smooth".into());
        let port = std::net::TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port();
        store(&Saved { port, token: new_token(), enabled: true });
        start(port).await.unwrap();
        bots_mcp_publish(vec![serde_json::from_value(json!({
            "id": "mate_thai", "name": "Thai Helper", "role": "Answers in one short Thai sentence",
            "instructions": "Answer in one short Thai sentence.", "provider": "ollama", "model": model,
            "apiKey": null, "baseUrl": null, "tools": "none",
        }))
        .unwrap()]);
        let reply: Value = reqwest::Client::new()
            .post(format!("http://127.0.0.1:{port}/mcp"))
            .header("authorization", format!("Bearer {}", load().token))
            .json(&json!({ "jsonrpc": "2.0", "id": 9, "method": "tools/call", "params": { "name": "ask_thai_helper", "arguments": { "request": "ท้องฟ้าสีอะไร" } } }))
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        let text = reply["result"]["content"][0]["text"].as_str().unwrap_or_default();
        println!("{text}");
        assert_eq!(reply["result"]["isError"], false, "{reply}");
        assert!(text.starts_with("Report from Thai Helper"));
        stop();
    }

    #[tokio::test]
    async fn lists_the_bots_and_refuses_an_unknown_one() {
        bots_mcp_publish(vec![bot("News Digest")]);
        let listed = dispatch(&json!({ "jsonrpc": "2.0", "id": 1, "method": "tools/list" })).await.unwrap();
        let tools: Vec<&str> = listed["result"]["tools"].as_array().unwrap().iter().map(|t| t["name"].as_str().unwrap()).collect();
        assert_eq!(tools, vec![LIST, "ask_news_digest"]);
        let (text, is_error) = call(LIST, &json!({})).await;
        assert!(!is_error && text.contains("News Digest (`ask_news_digest`)") && text.contains("groq/llama"));
        let (text, is_error) = call("ask_nobody", &json!({ "request": "hi" })).await;
        assert!(is_error && text.contains(LIST));
        let (text, is_error) = call("ask_news_digest", &json!({})).await;
        assert!(is_error && text.contains("request"));
        // A notification gets no answer.
        assert!(dispatch(&json!({ "jsonrpc": "2.0", "method": "notifications/initialized" })).await.is_none());
    }
}
