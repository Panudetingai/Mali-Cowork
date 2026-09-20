use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use futures::StreamExt;
use serde_json::Value;
use tauri::ipc::Channel;

use crate::chat_stream::ChatStreamEvent;

use super::{
    bin::opencode_bin,
    client::{OpencodeClient, PromptOptions},
    cwd::get_default_public_dir,
    events::{question_ask, EventTranslator, Outcome, PermissionAsk, QuestionAsk},
    lease_instance,
    policy::{Decision, FolderPolicy},
    providers::{overlay_model_ids, APP_PROVIDERS},
    schema::is_recursive,
    server::{ensure_server, not_found_message, restart},
    OpencodeCheckResult, OpencodeModel, OpencodeModelsResult, OpencodeProvider, OpencodeRequest,
    FolderGrant, PermissionReplyRequest, QuestionReplyRequest, SetAuthRequest,
};

const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
/// Silence on the event stream after which the server is checked.
const STREAM_IDLE: Duration = Duration::from_secs(90);

#[tauri::command]
pub async fn opencode_check() -> OpencodeCheckResult {
    let path = opencode_bin().map(str::to_string);
    if path.is_none() {
        return OpencodeCheckResult {
            available: false,
            version: None,
            path,
            error: Some(not_found_message()),
        };
    }

    let result = match ensure_server().await {
        Ok(client) => client.health().await,
        Err(e) => Err(e),
    };
    match result {
        Ok(version) => OpencodeCheckResult {
            available: true,
            version: Some(version),
            path,
            error: None,
        },
        Err(error) => OpencodeCheckResult {
            available: false,
            version: None,
            path,
            error: Some(error),
        },
    }
}

/// Providers offered in the model picker even before they have a key, so the
/// user can pick one and be asked for the key. Connected providers always show.
const SUGGESTED_PROVIDERS: &[&str] = &[
    "opencode", "anthropic", "openai", "google", "groq", "openrouter", "deepseek", "xai",
    "mistral", "moonshotai", "zai",
];

#[tauri::command]
pub async fn opencode_list_models(cwd: Option<String>) -> Result<OpencodeModelsResult, String> {
    let directory = resolve_cwd(cwd.as_deref());
    let client = ensure_server().await?;
    let body = client.all_providers(&path_str(&directory)).await?;

    let connected: Vec<&str> = body["connected"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .collect();

    let app_models = overlay_model_ids();
    let mut models = Vec::new();
    let mut providers = Vec::new();
    for provider in body["all"].as_array().into_iter().flatten() {
        let provider_id = provider["id"].as_str().unwrap_or_default();
        let is_connected = connected.contains(&provider_id);
        if !is_connected
            && !SUGGESTED_PROVIDERS.contains(&provider_id)
            && !APP_PROVIDERS.contains(&provider_id)
        {
            continue;
        }
        let provider_name = provider["name"].as_str().unwrap_or(provider_id);
        providers.push(OpencodeProvider {
            id: provider_id.to_string(),
            name: provider_name.to_string(),
            env: string_list(&provider["env"]),
            connected: is_connected,
        });

        for (model_id, model) in provider["models"].as_object().into_iter().flatten() {
            let context_limit = model["limit"]["context"].as_u64().filter(|&n| n > 0);
            // Speech, image and deprecated models can't hold a conversation.
            // Models the user added in Settings have no metadata but are chat models.
            let added_by_user = app_models.contains(&format!("{provider_id}/{model_id}"));
            if (context_limit.is_none() && !added_by_user) || model["status"] == "deprecated" {
                continue;
            }
            let cost = &model["cost"];
            let free = cost["input"].as_f64().unwrap_or(0.0) == 0.0
                && cost["output"].as_f64().unwrap_or(0.0) == 0.0;
            models.push(OpencodeModel {
                id: format!("{provider_id}/{model_id}"),
                name: model["name"].as_str().unwrap_or(model_id).to_string(),
                provider_id: provider_id.to_string(),
                provider_name: provider_name.to_string(),
                free,
                connected: is_connected,
                context_limit,
                tool_call: model["capabilities"]["toolcall"]
                    .as_bool()
                    .or_else(|| model["tool_call"].as_bool()),
            });
        }
    }
    // Ready-to-use models first, then by provider and name.
    models.sort_by(|a, b| {
        (!a.connected, &a.provider_name, &a.name).cmp(&(!b.connected, &b.provider_name, &b.name))
    });

    let default_model = connected.first().and_then(|provider| {
        let model = body["default"][*provider].as_str()?;
        Some(format!("{provider}/{model}"))
    });

    Ok(OpencodeModelsResult {
        models,
        default_model,
        providers,
    })
}

/// Save an API key for a provider; its models become usable immediately.
///
/// opencode reads a provider's credentials once, when it first builds that
/// provider, so a server that already tried the old key keeps failing with it.
/// Stopping the server here makes the next prompt start one that loads the new
/// key — without it, saving a key in the middle of a chat looked like it did
/// nothing.
#[tauri::command]
pub async fn opencode_set_auth(request: SetAuthRequest) -> Result<(), String> {
    let provider_id = request.provider_id.trim();
    let key = request.key.trim();
    if provider_id.is_empty() || key.is_empty() {
        return Err("Provider and API key are required.".into());
    }
    ensure_server().await?.set_api_key(provider_id, key).await?;
    restart().await;
    Ok(())
}

#[tauri::command]
pub async fn opencode_delete_session(
    session_id: String,
    cwd: Option<String>,
    mode: Option<String>,
) -> Result<(), String> {
    let directory = session_dir(mode.as_deref(), cwd.as_deref());
    ensure_server()
        .await?
        .delete_session(&path_str(&directory), &session_id)
        .await
}

#[tauri::command]
pub fn opencode_default_cwd() -> String {
    path_str(&get_default_public_dir())
}

#[tauri::command]
pub async fn opencode_permission_reply(request: PermissionReplyRequest) -> Result<(), String> {
    if !matches!(request.reply.as_str(), "once" | "always" | "reject") {
        return Err(format!("Invalid permission reply: {}", request.reply));
    }
    let client = ensure_server().await?;
    if let (Some(session_id), Some(grant)) = (&request.session_id, &request.grant) {
        if let Some(rules) = ActivePrompt::grant(session_id, grant) {
            client.set_permissions(&request.directory, session_id, rules).await?;
        }
    }
    client
        .reply_permission(&request.directory, &request.id, &request.reply, None)
        .await
}

/// Questions this session is still waiting on, as the server sees them.
async fn waiting_questions(
    client: &OpencodeClient,
    directory: &str,
    session_id: &str,
) -> Vec<QuestionAsk> {
    client
        .pending_questions(directory)
        .await
        .unwrap_or_default()
        .iter()
        .filter(|ask| ask["sessionID"] == session_id)
        .map(question_ask)
        .collect()
}

/// Answer the agent's question. Without an answer the prompt waits forever, so
/// closing the card sends an empty answer, which withdraws the question and
/// lets the agent carry on.
#[tauri::command]
pub async fn opencode_question_reply(request: QuestionReplyRequest) -> Result<(), String> {
    let answers: Vec<Vec<String>> = request
        .answers
        .into_iter()
        .map(|answer| {
            answer
                .into_iter()
                .map(|label| label.trim().to_string())
                .filter(|label| !label.is_empty())
                .collect()
        })
        .collect();
    // An answer nobody filled in is no answer at all.
    let answers = if answers.iter().all(Vec::is_empty) { Vec::new() } else { answers };
    ensure_server()
        .await?
        .reply_question(&request.directory, &request.id, &answers)
        .await
}

type SharedPolicy = Arc<Mutex<FolderPolicy>>;

/// Policies of prompts that are still running, so a folder granted from the
/// permission card applies to the rest of the run.
struct ActivePrompt(String);

impl ActivePrompt {
    fn registry() -> &'static Mutex<HashMap<String, SharedPolicy>> {
        static ACTIVE: OnceLock<Mutex<HashMap<String, SharedPolicy>>> = OnceLock::new();
        ACTIVE.get_or_init(Default::default)
    }

    fn register(session_id: &str, policy: SharedPolicy) -> Self {
        Self::registry().lock().unwrap().insert(session_id.to_string(), policy);
        Self(session_id.to_string())
    }

    /// Returns the updated session rules when the session is running.
    fn grant(session_id: &str, grant: &FolderGrant) -> Option<Vec<Value>> {
        let policy = Self::registry().lock().unwrap().get(session_id)?.clone();
        let mut policy = policy.lock().unwrap();
        policy.grant(grant);
        Some(policy.rules())
    }
}

impl Drop for ActivePrompt {
    fn drop(&mut self) {
        Self::registry().lock().unwrap().remove(&self.0);
    }
}

#[tauri::command]
pub async fn opencode_abort(
    session_id: String,
    cwd: Option<String>,
    mode: Option<String>,
) -> Result<(), String> {
    let directory = session_dir(mode.as_deref(), cwd.as_deref());
    ensure_server()
        .await?
        .abort(&path_str(&directory), &session_id)
        .await
}

/// Send a prompt to the warm server and stream progress until the session is idle.
#[tauri::command]
pub async fn opencode_generate(
    request: OpencodeRequest,
    on_event: Channel<ChatStreamEvent>,
) -> Result<(), String> {
    if let Err(message) = run_prompt(&request, &on_event).await {
        let _ = on_event.send(ChatStreamEvent::Error { message });
    }
    Ok(())
}

async fn run_prompt(
    request: &OpencodeRequest,
    on_event: &Channel<ChatStreamEvent>,
) -> Result<(), String> {
    let prompt = request.prompt.trim();
    if prompt.is_empty() {
        return Err("Prompt cannot be empty.".into());
    }

    let cwd = session_dir(request.mode.as_deref(), request.cwd.as_deref());
    std::fs::create_dir_all(&cwd)
        .map_err(|e| format!("Cannot create working folder {}: {e}", cwd.display()))?;
    let directory = path_str(&cwd);
    // Keep this folder's instance (and its MCP servers) open until the reply ends.
    let _instance = lease_instance(&directory).await;

    let client = ensure_server().await?;
    let session_id = open_session(&client, &directory, request.session_id.as_deref()).await?;
    let model = request.model.as_deref().map(str::trim).filter(|m| !m.is_empty());
    let tool_call = match model {
        Some(model) => model_tool_call(&client, &directory, model).await?,
        None => true,
    };
    if !tool_call && !request.is_chat() {
        return Err(format!(
            "{} can't call tools, so it can't work on files. Pick another model for Cowork.",
            model.unwrap_or_default()
        ));
    }

    // Subscribe before prompting so no early event is missed.
    let mut events = SseStream::new(client.events(&directory).await?);
    tokio::time::timeout(CONNECT_TIMEOUT, events.wait_for("server.connected"))
        .await
        .map_err(|_| "Timed out connecting to the opencode event stream".to_string())??;

    emit(on_event, ChatStreamEvent::Started)?;
    emit(
        on_event,
        ChatStreamEvent::Metadata {
            session_id: Some(session_id.clone()),
            usage: None,
            duration_ms: None,
            model: model.map(str::to_string),
        },
    )?;

    let grants: &[FolderGrant] = if request.is_chat() { &[] } else { &request.folders };
    let policy: SharedPolicy = Arc::new(Mutex::new(FolderPolicy::new(&cwd, grants)));
    let _active = ActivePrompt::register(&session_id, policy.clone());
    let rules = policy.lock().unwrap().rules();
    if !rules.is_empty() {
        client.set_permissions(&directory, &session_id, rules).await?;
    }

    let mcp = if tool_call {
        connected_mcp(&client, &directory, request.is_chat()).await
    } else {
        Vec::new()
    };
    // One tool the provider refuses fails the whole prompt, so those are left
    // out and said out loud rather than taking the chat down with them.
    let skip = if mcp.is_empty() { Vec::new() } else { unusable_tools(&client, &directory, model, &mcp).await };
    if !skip.is_empty() {
        emit(on_event, skipped_tools_activity(&skip))?;
    }
    let mut options =
        prompt_options(request, &policy.lock().unwrap(), &directory, model, tool_call, &mcp, &skip);
    options.files = file_parts(&request.files)?;
    client
        .prompt_async(&directory, &session_id, prompt, &options)
        .await?;

    let auto_approve = request.auto_approve.unwrap_or(false);
    let mut translator = EventTranslator::new(session_id.clone(), request.thinking.unwrap_or(false));

    loop {
        let event = match tokio::time::timeout(STREAM_IDLE, events.next()).await {
            Ok(next) => match next? {
                Some(event) => event,
                None => break,
            },
            // Quiet for a while: a long tool call is fine, a hung server is not.
            Err(_) if client.health().await.is_ok() => {
                // A question whose event never reached the window (a reload, a
                // dropped card) holds the turn open for good, so ask the server
                // what it is still waiting for. The window ignores ids it
                // already shows.
                for ask in waiting_questions(&client, &directory, &session_id).await {
                    if let Err(e) = emit(
                        on_event,
                        ChatStreamEvent::Question {
                            id: ask.id,
                            directory: directory.clone(),
                            questions: ask.questions,
                        },
                    ) {
                        let _ = client.abort(&directory, &session_id).await;
                        return Err(e);
                    }
                }
                continue;
            }
            Err(_) => {
                let _ = client.abort(&directory, &session_id).await;
                return Err("opencode stopped responding. Send the message again to retry.".into());
            }
        };
        for outcome in translator.handle(&event) {
            let sent = match outcome {
                Outcome::Emit(ev) => emit(on_event, ev),
                Outcome::PermissionAsked(ask) => {
                    let decision = policy.lock().unwrap().decide(&ask, auto_approve);
                    match decision {
                        Decision::Approve => client
                            .reply_permission(&directory, &ask.id, "once", None)
                            .await
                            .map(|_| ()),
                        Decision::Reject(reason) => {
                            client
                                .reply_permission(&directory, &ask.id, "reject", Some(reason))
                                .await?;
                            emit(on_event, blocked_activity(&ask))
                        }
                        Decision::AskUser => emit(
                            on_event,
                            ChatStreamEvent::Permission {
                                id: ask.id,
                                directory: directory.clone(),
                                permission: ask.permission,
                                patterns: ask.patterns,
                                title: ask.title,
                                detail: ask.detail,
                            },
                        ),
                    }
                }
                Outcome::QuestionAsked(ask) => emit(
                    on_event,
                    ChatStreamEvent::Question {
                        id: ask.id,
                        directory: directory.clone(),
                        questions: ask.questions,
                    },
                ),
                Outcome::Idle => {
                    return emit(
                        on_event,
                        ChatStreamEvent::Done {
                            model_id: model
                                .map(|m| format!("opencode:{m}"))
                                .unwrap_or_else(|| "opencode:default".into()),
                        },
                    );
                }
                Outcome::Failed(message) => return Err(message),
            };

            // The window went away: stop the agent instead of running unattended.
            if let Err(e) = sent {
                let _ = client.abort(&directory, &session_id).await;
                return Err(e);
            }
        }
    }

    Err("opencode event stream closed before the reply finished".into())
}

/// Reuse the given session when it still exists, otherwise start a new one.
async fn open_session(
    client: &OpencodeClient,
    directory: &str,
    session_id: Option<&str>,
) -> Result<String, String> {
    if let Some(id) = session_id.filter(|id| id.starts_with("ses")) {
        if client.session_exists(directory, id).await {
            return Ok(id.to_string());
        }
    }
    client.create_session(directory).await
}

/// Whether a `provider/model` can call tools. Fails early when the provider
/// has no API key, which opencode would otherwise report as a confusing
/// "Model not found: groq/groq/compound".
async fn model_tool_call(
    client: &OpencodeClient,
    directory: &str,
    model: &str,
) -> Result<bool, String> {
    let Some((provider_id, model_id)) = model.split_once('/') else {
        return Ok(true);
    };
    // The prompt itself reports any problem when the lookup fails.
    let Ok(body) = client.usable_providers(directory).await else {
        return Ok(true);
    };
    let Some(provider) = body["providers"]
        .as_array()
        .into_iter()
        .flatten()
        .find(|p| p["id"] == provider_id)
    else {
        return Err(format!(
            "{provider_id} has no API key in OpenCode, so {model_id} can't run. \
             Add the key in Settings → Models (or pick the model again to enter it), then try again."
        ));
    };
    Ok(provider["models"][model_id]["capabilities"]["toolcall"].as_bool() != Some(false))
}

const CHAT_SYSTEM: &str = "You are Mali Cowork in Chat mode: a friendly, concise assistant. \
Answer from your own knowledge. You cannot read or change the user's files in this mode; \
if the task needs that, suggest switching to Cowork mode.";

/// Tools that touch the file system or run commands, including those of the
/// MCP servers in [`WORKSPACE_MCP`].
const WORKSPACE_TOOLS: &[&str] = &[
    "bash", "edit", "write", "patch", "multiedit", "read", "grep", "glob", "list", "task",
    "todowrite", "todoread", "filesystem_*", "exec_*",
];

/// MCP servers that read files or run commands, which Chat mode never offers.
const WORKSPACE_MCP: &[&str] = &["filesystem", "exec"];

/// For models without tool calling: providers such as Groq reject a request
/// that offers any tool ("`tool calling` is not supported with this model").
const ALL_TOOLS: &[&str] = &["*"];

/// MCP servers connected in this folder's instance. Chat leaves out the
/// [`WORKSPACE_MCP`] servers, whose tools it disables.
async fn connected_mcp(client: &OpencodeClient, directory: &str, chat: bool) -> Vec<String> {
    let Ok(status) = client.mcp_status(Some(directory)).await else {
        return Vec::new();
    };
    let mut ids: Vec<String> = status
        .as_object()
        .into_iter()
        .flatten()
        .filter(|(id, entry)| entry["status"] == "connected" && !(chat && WORKSPACE_MCP.contains(&id.as_str())))
        .map(|(id, _)| id.clone())
        .collect();
    ids.sort();
    ids
}

/// Tools whose input schema this provider would turn the whole request down
/// for. The answer only changes when the MCP servers do, so it is worked out
/// once per folder, model and server set instead of once per prompt.
async fn unusable_tools(
    client: &OpencodeClient,
    directory: &str,
    model: Option<&str>,
    mcp: &[String],
) -> Vec<String> {
    let Some((provider_id, model_id)) = model.and_then(|m| m.split_once('/')) else {
        return Vec::new();
    };
    let key = format!("{directory}|{model_id}|{}", mcp.join(","));
    if let Some(known) = unusable_cache().lock().unwrap().get(&key) {
        return known.clone();
    }
    let Ok(tools) = client.tools(directory, provider_id, model_id).await else {
        return Vec::new();
    };
    let skip: Vec<String> = tools
        .into_iter()
        .filter(|(_, schema)| is_recursive(schema))
        .map(|(name, _)| name)
        .collect();
    if !skip.is_empty() {
        eprintln!("[opencode] leaving out tools the provider can't accept: {}", skip.join(", "));
    }
    unusable_cache().lock().unwrap().insert(key, skip.clone());
    skip
}

fn unusable_cache() -> &'static Mutex<HashMap<String, Vec<String>>> {
    static CACHE: OnceLock<Mutex<HashMap<String, Vec<String>>>> = OnceLock::new();
    CACHE.get_or_init(Default::default)
}

/// Say which tools were left out, where the user is already looking.
fn skipped_tools_activity(skip: &[String]) -> ChatStreamEvent {
    ChatStreamEvent::Activity {
        id: Some("skipped-tools".into()),
        kind: "system".into(),
        title: format!(
            "{} left out: the model's provider rejects schemas that refer to themselves",
            skip.join(", ")
        ),
        detail: Some(format!(
            "These tools describe themselves in terms of themselves, which this provider answers \
             with \"Recursive JSON schemas are not currently supported\" — and it turns down the \
             whole request, not just the tool. The rest of the server works as usual.\n\n{}",
            skip.join("\n")
        )),
        done: true,
        duration_ms: None,
    }
}

/// Points the model at the MCP tools; without it, models tend to write
/// scripts or hunt for instructions instead.
fn mcp_note(servers: &[String]) -> Option<String> {
    if servers.is_empty() {
        return None;
    }
    let list = servers
        .iter()
        .map(|id| format!("- {id} (tools named `{id}_*`)"))
        .collect::<Vec<_>>()
        .join("\n");
    Some(format!(
        "Connected MCP servers:\n{list}\n\nWhen one of these servers covers the task \
         (e.g. `word_*` for Word documents), call its tools directly. Do not look for skills \
         or instruction files, and do not write scripts for what those tools already do."
    ))
}

fn prompt_options<'a>(
    request: &OpencodeRequest,
    policy: &FolderPolicy,
    directory: &str,
    model: Option<&'a str>,
    tool_call: bool,
    mcp: &[String],
    skip: &[String],
) -> PromptOptions<'a> {
    let owned = |tools: &[&str]| tools.iter().map(|t| (*t).to_string()).collect::<Vec<String>>();
    let with_skipped = |mut tools: Vec<String>| {
        tools.extend(skip.iter().cloned());
        tools
    };
    let mcp_note = mcp_note(mcp);
    let instructions = request
        .instructions
        .as_deref()
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(str::to_string);
    if request.is_chat() {
        let system = [Some(CHAT_SYSTEM.to_string()), mcp_note, instructions].into_iter().flatten();
        return PromptOptions {
            model,
            // A model without tool calling takes no tools at all, so there is
            // nothing left to skip.
            disabled_tools: if tool_call {
                with_skipped(owned(WORKSPACE_TOOLS))
            } else {
                owned(ALL_TOOLS)
            },
            system: Some(system.collect::<Vec<_>>().join("\n\n")),
            ..Default::default()
        };
    }
    let mut notes = policy.describe(directory);
    notes.extend(mcp_note);
    notes.extend(instructions);
    PromptOptions {
        model,
        disabled_tools: with_skipped(Vec::new()),
        system: Some(notes.join("\n\n")),
        ..Default::default()
    }
}

/// Attachments as inline `file` parts. Inline data needs no folder access,
/// so Chat mode can look at a picture too.
fn file_parts(paths: &[String]) -> Result<Vec<Value>, String> {
    paths
        .iter()
        .map(|path| {
            let (url, mime, filename) = crate::commands::attachments::data_url(path)?;
            Ok(serde_json::json!({ "type": "file", "mime": mime, "filename": filename, "url": url }))
        })
        .collect()
}

/// Shown in the step list when a change to a read-only folder was refused.
fn blocked_activity(ask: &PermissionAsk) -> ChatStreamEvent {
    ChatStreamEvent::Activity {
        id: Some(ask.id.clone()),
        kind: "permission".into(),
        title: "Blocked: folder is read-only".into(),
        detail: ask.path.clone().or_else(|| ask.detail.clone()),
        done: true,
        duration_ms: None,
    }
}

#[tauri::command]
pub async fn opencode_warm(cwd: Option<String>, mode: Option<String>) -> Result<(), String> {
    let directory = session_dir(mode.as_deref(), cwd.as_deref());
    if mode.as_deref() == Some("chat") {
        std::fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
    }
    ensure_server().await?.warm(&path_str(&directory)).await
}

/// Chat sessions live in a private scratch folder; cowork sessions in the chosen folder.
pub(crate) fn session_dir(mode: Option<&str>, cwd: Option<&str>) -> PathBuf {
    if mode == Some("chat") {
        return dirs::data_local_dir()
            .unwrap_or_else(std::env::temp_dir)
            .join("mali-cowork")
            .join("chat");
    }
    resolve_cwd(cwd)
}

fn string_list(value: &Value) -> Vec<String> {
    value
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|v| v.as_str().map(str::to_string))
        .collect()
}

fn emit(channel: &Channel<ChatStreamEvent>, event: ChatStreamEvent) -> Result<(), String> {
    channel.send(event).map_err(|e| e.to_string())
}

fn resolve_cwd(cwd: Option<&str>) -> PathBuf {
    cwd.map(str::trim)
        .filter(|s| !s.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(get_default_public_dir)
}

fn path_str(path: &std::path::Path) -> String {
    path.to_string_lossy().into_owned()
}

/// Minimal server-sent-events reader: yields the JSON payload of each `data:` line.
struct SseStream {
    body: futures::stream::BoxStream<'static, reqwest::Result<Vec<u8>>>,
    buffer: Vec<u8>,
}

impl SseStream {
    fn new(response: reqwest::Response) -> Self {
        Self {
            body: response.bytes_stream().map(|r| r.map(|b| b.to_vec())).boxed(),
            buffer: Vec::new(),
        }
    }

    async fn next(&mut self) -> Result<Option<Value>, String> {
        loop {
            while let Some(pos) = self.buffer.iter().position(|&b| b == b'\n') {
                let line: Vec<u8> = self.buffer.drain(..=pos).collect();
                let line = String::from_utf8_lossy(&line);
                if let Some(data) = line.trim().strip_prefix("data:") {
                    if let Ok(value) = serde_json::from_str(data.trim()) {
                        return Ok(Some(value));
                    }
                }
            }
            match self.body.next().await {
                Some(chunk) => self.buffer.extend_from_slice(&chunk.map_err(|e| e.to_string())?),
                None => return Ok(None),
            }
        }
    }

    async fn wait_for(&mut self, event_type: &str) -> Result<(), String> {
        while let Some(event) = self.next().await? {
            if event["type"] == event_type {
                return Ok(());
            }
        }
        Err("opencode event stream closed".into())
    }
}

#[cfg(test)]
mod tests {
    use crate::commands::supervisor::shutdown_all as shutdown;
    use super::*;

    /// A model without tool calling (Groq Compound) still answers in Chat.
    /// Run with `cargo test -- --ignored opencode_live_no_tools`.
    #[tokio::test]
    #[ignore = "needs the opencode CLI and a Groq key"]
    async fn opencode_live_no_tools_model() {
        let events = Arc::new(Mutex::new(Vec::<String>::new()));
        let sink = events.clone();
        let channel: Channel<ChatStreamEvent> = Channel::new(move |body| {
            if let tauri::ipc::InvokeResponseBody::Json(json) = body {
                sink.lock().unwrap().push(json);
            }
            Ok(())
        });
        let request = OpencodeRequest {
            prompt: "Reply with one short greeting.".into(),
            model: Some("groq/groq/compound".into()),
            cwd: None,
            session_id: None,
            thinking: Some(false),
            auto_approve: Some(false),
            mode: Some("chat".into()),
            folders: Vec::new(),
            files: Vec::new(),
            instructions: None,
        };
        let result = run_prompt(&request, &channel).await;
        shutdown();
        result.expect("prompt finishes");
        assert!(events.lock().unwrap().iter().any(|e| e.contains("\"chunk\"")), "the model answered");
    }

    /// Read-only folders block writes while read & write folders work, all
    /// without prompting. Run with `cargo test -- --ignored opencode_live_folder`.
    #[tokio::test]
    #[ignore = "needs the opencode CLI and network access"]
    async fn opencode_live_folder_policy() {
        let root = PathBuf::from("/tmp").join(format!("mali-policy-{}", uuid::Uuid::new_v4().simple()));
        let (work, rw, ro) = (root.join("work"), root.join("rw"), root.join("ro"));
        for dir in [&work, &rw, &ro] {
            std::fs::create_dir_all(dir).unwrap();
        }
        std::fs::write(ro.join("a.txt"), "hi").unwrap();

        let events = Arc::new(Mutex::new(Vec::<String>::new()));
        let sink = events.clone();
        let channel: Channel<ChatStreamEvent> = Channel::new(move |body| {
            if let tauri::ipc::InvokeResponseBody::Json(json) = body {
                sink.lock().unwrap().push(json);
            }
            Ok(())
        });
        let grant = |dir: &PathBuf, access: &str| FolderGrant { path: path_str(dir), access: access.into() };
        let request = OpencodeRequest {
            prompt: format!(
                "Use your tools, one step at a time, and continue even if a step fails: \
                 1) write {rw}/x.txt containing ok 2) write {ro}/y.txt containing no \
                 3) read {ro}/a.txt and tell me its content.",
                rw = rw.display(),
                ro = ro.display()
            ),
            model: Some("opencode/big-pickle".into()),
            cwd: Some(path_str(&work)),
            session_id: None,
            thinking: Some(false),
            auto_approve: Some(false),
            mode: Some("cowork".into()),
            folders: vec![grant(&work, "write"), grant(&rw, "write"), grant(&ro, "read")],
            files: Vec::new(),
            instructions: None,
        };
        let result = run_prompt(&request, &channel).await;
        shutdown();
        let events = events.lock().unwrap();
        for e in events.iter().filter(|e| !e.contains("\"chunk\"")) {
            eprintln!("{}", &e[..e.len().min(200)]);
        }
        result.expect("prompt finishes");
        assert!(rw.join("x.txt").exists(), "write folder accepts files");
        assert!(!ro.join("y.txt").exists(), "read-only folder blocks files");
        assert!(!events.iter().any(|e| e.contains(r#""event":"permission""#)), "no prompts for granted folders");
        assert!(events.iter().any(|e| e.contains("read-only")), "the block is reported");
        let _ = std::fs::remove_dir_all(root);
    }

    /// End-to-end check against the real CLI: a file deletion outside the
    /// working folder must surface as a permission request and succeed once
    /// approved. Run with `cargo test -- --ignored opencode_live`.
    #[tokio::test]
    #[ignore = "needs the opencode CLI and a configured model"]
    async fn opencode_live_permission_flow() {
        struct StopServer;
        impl Drop for StopServer {
            fn drop(&mut self) {
                shutdown();
            }
        }
        let _stop = StopServer;

        // `/tmp` rather than `$TMPDIR`: opencode treats its own temp dir as trusted.
        let root = PathBuf::from("/tmp").join(format!("mali-opencode-{}", uuid::Uuid::new_v4().simple()));
        let workdir = root.join("work");
        let outside = root.join("outside");
        std::fs::create_dir_all(&workdir).unwrap();
        std::fs::create_dir_all(&outside).unwrap();
        let victim = outside.join("victim.txt");
        std::fs::write(&victim, "delete me").unwrap();
        let directory = path_str(&workdir);

        let started = std::time::Instant::now();
        let client = ensure_server().await.expect("server starts");
        eprintln!("server ready in {:?}", started.elapsed());

        let session = client.create_session(&directory).await.unwrap();
        let mut events = SseStream::new(client.events(&directory).await.unwrap());
        events.wait_for("server.connected").await.unwrap();

        let prompt = format!("Run this exact bash command: rm {}", victim.display());
        client
            .prompt_async(&directory, &session, &prompt, &PromptOptions::default())
            .await
            .unwrap();

        let mut translator = EventTranslator::new(session.clone(), false);
        let mut asked = false;
        'stream: while let Some(event) = events.next().await.unwrap() {
            for outcome in translator.handle(&event) {
                match outcome {
                    Outcome::PermissionAsked(ask) => {
                        eprintln!("permission: {} {:?}", ask.title, ask.detail);
                        asked = true;
                        client.reply_permission(&directory, &ask.id, "once", None).await.unwrap();
                    }
                    Outcome::QuestionAsked(ask) => {
                        // Nothing here answers questions; withdraw it so the
                        // agent carries on instead of waiting on the test.
                        client.reply_question(&directory, &ask.id, &[]).await.unwrap();
                    }
                    Outcome::Idle => break 'stream,
                    Outcome::Failed(message) => panic!("opencode failed: {message}"),
                    Outcome::Emit(ChatStreamEvent::Chunk { text }) => eprint!("{text}"),
                    Outcome::Emit(_) => {}
                }
            }
        }

        assert!(asked, "expected a permission request");
        assert!(!victim.exists(), "file should be deleted after approval");

        let second = std::time::Instant::now();
        ensure_server().await.unwrap();
        assert!(second.elapsed() < Duration::from_secs(1), "warm server should be reused");

        let _ = std::fs::remove_dir_all(root);
    }
}
