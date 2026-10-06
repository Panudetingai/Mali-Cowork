use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::{Arc, Mutex, OnceLock};
use std::collections::VecDeque;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde_json::{json, Value};
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
    schema::{self, Unsupported},
    server::{ensure_server, not_found_message, restart},
    stream::{self, Event},
    OpencodeCheckResult, OpencodeModel, OpencodeModelsResult, OpencodeProvider, OpencodeRequest,
    FolderGrant, PermissionReplyRequest, QuestionReplyRequest, SetAuthRequest,
};

const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
/// Silence on the event stream after which the server is checked.
const STREAM_IDLE: Duration = Duration::from_secs(90);
/// After Stop, how long the agent has to say it stopped before the reply ends anyway.
const STOP_GRACE: Duration = Duration::from_secs(3);

/// `opencode --version`, for messages that tell the user which one they have.
async fn cli_version(bin: &str) -> Option<String> {
    let output = tokio::time::timeout(
        std::time::Duration::from_secs(10),
        super::bin::opencode_command(bin, &["--version"]).output(),
    )
    .await
    .ok()?
    .ok()?;
    let text = String::from_utf8_lossy(&output.stdout).trim().to_string();
    (!text.is_empty()).then(|| text.lines().last().unwrap_or(&text).trim().to_string())
}

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
        Err(error) => {
            let version = match path.as_deref() {
                Some(bin) => cli_version(bin).await,
                None => None,
            };
            let error = if error.starts_with(super::client::HEALTH_UNSUPPORTED) {
                format!(
                    "OpenCode {} on this computer doesn't work with Mali — its server doesn't have the API Mali \
                     uses. Update it: open Terminal, run `opencode upgrade`, then quit and reopen Mali.",
                    version.as_deref().unwrap_or("(unknown version)")
                )
            } else {
                error
            };
            OpencodeCheckResult { available: false, version, path, error: Some(error) }
        }
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
            && !crate::ai::is_custom_provider(provider_id)
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
            // Models the user added in Settings have no metadata but are chat models.
            let added_by_user = app_models.contains(&format!("{provider_id}/{model_id}"));
            let output = string_list(&model["modalities"]["output"]);
            // A picture model has a context window like any other, so the
            // window alone never told them apart: `gemini-3-pro-image-preview`
            // was offered as something to chat with and answered nothing.
            let draws = output.iter().any(|m| m == "image" || m == "video");
            if (context_limit.is_none() && !added_by_user && !draws)
                || model["status"] == "deprecated"
            {
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
                output,
                input: string_list(&model["modalities"]["input"]),
                efforts: effort_levels(&model["variants"]),
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

/// Weakest to strongest, from opencode's own per-model `variants`.
///
/// The names differ by model — `gpt-5.2` offers none…xhigh, Claude offers
/// low…max, and plenty of models offer nothing at all — so the order is fixed
/// here rather than guessed from whatever order the map came back in. A name
/// this list has never heard of is kept, at the end, so a new level still
/// reaches the user.
fn effort_levels(variants: &Value) -> Vec<String> {
    const ORDER: &[&str] = &[
        "none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra",
    ];
    let Some(names) = variants.as_object() else {
        return Vec::new();
    };
    let mut levels: Vec<String> = names.keys().cloned().collect();
    levels.sort_by_key(|name| {
        ORDER
            .iter()
            .position(|known| known == name)
            .unwrap_or(ORDER.len())
    });
    // One choice is not a choice: a model with a single variant is offered no
    // control, the same as one with none.
    if levels.len() < 2 {
        return Vec::new();
    }
    levels
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

/// Permission requests for risky commands: "Always" is answered as "once",
/// so opencode never learns a rule that skips the next one.
fn risky_asks() -> &'static std::sync::Mutex<std::collections::HashSet<String>> {
    static ASKS: std::sync::OnceLock<std::sync::Mutex<std::collections::HashSet<String>>> = std::sync::OnceLock::new();
    ASKS.get_or_init(Default::default)
}

#[tauri::command]
pub async fn opencode_permission_reply(request: PermissionReplyRequest) -> Result<(), String> {
    if !matches!(request.reply.as_str(), "once" | "always" | "reject") {
        return Err(format!("Invalid permission reply: {}", request.reply));
    }
    let risky = risky_asks().lock().unwrap().remove(&request.id);
    if risky && request.reply == "always" {
        let client = ensure_server().await?;
        return client.reply_permission(&request.directory, &request.id, "once", None).await;
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

/// Stop for a running prompt, by session. OpenCode is asked to abort, but a
/// tool that won't quit (a hung command) keeps it from ever saying it
/// stopped; the reply then ends anyway after [`STOP_GRACE`], so Stop always
/// stops — in the chat, the Inbox and the notch.
struct StopSignal(String);

impl StopSignal {
    fn registry() -> &'static Mutex<HashMap<String, Arc<tokio::sync::Notify>>> {
        static STOPS: OnceLock<Mutex<HashMap<String, Arc<tokio::sync::Notify>>>> = OnceLock::new();
        STOPS.get_or_init(Default::default)
    }

    fn register(session_id: &str) -> (Self, Arc<tokio::sync::Notify>) {
        let signal = Arc::new(tokio::sync::Notify::new());
        Self::registry().lock().unwrap().insert(session_id.to_string(), signal.clone());
        (Self(session_id.to_string()), signal)
    }

    fn raise(session_id: &str) {
        if let Some(signal) = Self::registry().lock().unwrap().get(session_id) {
            // Kept until awaited, so a Stop that lands between two events still counts.
            signal.notify_one();
        }
    }
}

impl Drop for StopSignal {
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
    // The reply ends even if the server never answers the abort.
    StopSignal::raise(&session_id);
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
        // A body that broke off here is the connection to OpenCode, not a key or an address.
        let message = if message.contains("error decoding response body") {
            DROPPED.to_string()
        } else {
            message
        };
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
    let mut events = stream::subscribe(&client, &directory, CONNECT_TIMEOUT).await?;

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
    let (_stoppable, stop) = StopSignal::register(&session_id);
    // Set once Stop was pressed: the reply ends by then, confirmed or not.
    let mut stopping: Option<Instant> = None;
    let done = || ChatStreamEvent::Done {
        model_id: model.map(|m| format!("opencode:{m}")).unwrap_or_else(|| "opencode:default".into()),
    };
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
    let skipped = if mcp.is_empty() {
        Vec::new()
    } else {
        unusable_tools(&client, &directory, model, &mcp).await
    };
    for activity in skipped_tools_activities(&skipped) {
        emit(on_event, activity)?;
    }
    let mut skip: Vec<String> = skipped.iter().map(|(name, _)| name.clone()).collect();

    // A provider that already refused this model's connector tools refuses
    // them every time, so the failed round trip is skipped from then on.
    let mut without_mcp = !mcp.is_empty() && mcp_was_refused(model, &mcp);
    if without_mcp {
        skip.extend(mcp_tool_patterns(&mcp));
        emit(on_event, mcp_refused_activity(&mcp, false))?;
    }

    // Without their tools the servers are not "connected" as far as this
    // prompt goes, so they are left out of the note as well — a model told it
    // has a connector it cannot call says it will use it, then cannot.
    let announced = |off: bool| if off { Vec::new() } else { mcp.clone() };
    let mut options = prompt_options(
        request,
        &policy.lock().unwrap(),
        &directory,
        model,
        tool_call,
        &announced(without_mcp),
        &skip,
    );
    options.files = file_parts(&request.files)?;
    let mut turn_started = now_ms();
    client
        .prompt_async(&directory, &session_id, prompt, &options)
        .await?;
    // Events caught up after the stream dropped, read before the stream's own.
    let mut pending: VecDeque<Event> = VecDeque::new();

    let auto_approve = request.auto_approve.unwrap_or(false);
    let mut translator = EventTranslator::new(session_id.clone(), request.thinking.unwrap_or(false));

    // Set when the tool list was refused and the prompt is being sent again
    // without the connector tools; the stream then carries the second answer.
    let mut resent = false;

    loop {
        if resent {
            resent = false;
            // A fresh subscription first: the refused turn's own trailing
            // `session.idle` is still in the stream, and reading it against
            // the new turn would end the reply before it had started.
            events = stream::subscribe(&client, &directory, CONNECT_TIMEOUT).await?;
            pending.clear();
            translator = EventTranslator::new(session_id.clone(), request.thinking.unwrap_or(false));
            turn_started = now_ms();
            client
                .prompt_async(&directory, &session_id, prompt, &options)
                .await?;
        }
        let wait = stopping.map_or(STREAM_IDLE, |by| by.saturating_duration_since(Instant::now()));
        let next = match pending.pop_front() {
            Some(event) => Ok(Some(event)),
            None => tokio::select! {
                _ = stop.notified(), if stopping.is_none() => {
                    stopping = Some(Instant::now() + STOP_GRACE);
                    continue;
                }
                next = tokio::time::timeout(wait, events.next()) => next,
            },
        };
        let event = match next {
            Ok(Some(event)) => event,
            Ok(None) => break,
            // Stopped, and the agent didn't say so in time (a tool that won't quit): end here.
            Err(_) if stopping.is_some() => {
                eprintln!("[opencode] {session_id} didn't confirm the stop; ending the reply");
                return emit(on_event, done());
            }
            // Quiet for a while: a long tool call is fine, a hung server is not.
            Err(_) if client.alive().await => {
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
        match event["type"].as_str().unwrap_or_default() {
            // The stream dropped and came back: pick up what was missed.
            stream::RECONNECTED => {
                pending.extend(catch_up(&client, &directory, &session_id, turn_started).await);
                continue;
            }
            stream::LOST => {
                let _ = client.abort(&directory, &session_id).await;
                return Err(DROPPED.into());
            }
            _ => {}
        }
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
                        Decision::AskUser => {
                            // A risky command says why on the card, and can't be allowed "always".
                            let warning = (ask.permission == "bash")
                                .then(|| crate::sandbox::command_risk::classify(ask.command.as_deref().unwrap_or_default()))
                                .and_then(|risk| match risk {
                                    crate::sandbox::command_risk::Risk::Dangerous(reason) => Some(reason),
                                    _ => None,
                                });
                            let detail = match warning {
                                Some(reason) => {
                                    risky_asks().lock().unwrap().insert(ask.id.clone());
                                    Some(format!("⚠ {reason}\n{}", ask.detail.unwrap_or_default()))
                                }
                                None => ask.detail,
                            };
                            emit(
                                on_event,
                                ChatStreamEvent::Permission {
                                    id: ask.id,
                                    directory: directory.clone(),
                                    permission: ask.permission,
                                    patterns: ask.patterns,
                                    title: ask.title,
                                    detail,
                                },
                            )
                        }
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
                Outcome::Idle => return emit(on_event, done()),
                // The provider threw the whole request out over a tool it was
                // offered, so the message was never read. Send it again with
                // the connector tools left out rather than answering nothing.
                Outcome::Failed(message)
                    if !without_mcp && !mcp.is_empty() && schema::is_tool_list_rejection(&message) =>
                {
                    remember_mcp_refused(model, &mcp);
                    without_mcp = true;
                    resent = true;
                    skip.extend(mcp_tool_patterns(&mcp));
                    options = prompt_options(
                        request,
                        &policy.lock().unwrap(),
                        &directory,
                        model,
                        tool_call,
                        &announced(true),
                        &skip,
                    );
                    options.files = file_parts(&request.files)?;
                    emit(on_event, mcp_refused_activity(&mcp, true))
                }
                Outcome::Failed(message) => return Err(message),
            };

            // The window went away: stop the agent instead of running unattended.
            if let Err(e) = sent {
                let _ = client.abort(&directory, &session_id).await;
                return Err(e);
            }
            if resent {
                break;
            }
        }
    }

    Err("opencode event stream closed before the reply finished".into())
}

/// Shown when the connection to OpenCode broke off and didn't come back.
const DROPPED: &str = "The connection to OpenCode dropped before the reply finished. Send the message again to retry.";

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_millis() as u64)
}

/// What a turn missed while its stream was down: its parts as they stand
/// now (the translator sends only what it hasn't yet), then how the turn
/// ended if it ended meanwhile.
async fn catch_up(client: &OpencodeClient, directory: &str, session_id: &str, since_ms: u64) -> Vec<Event> {
    let Ok(messages) = client.session_messages(directory, session_id).await else {
        return Vec::new();
    };
    missed_events(&messages, session_id, since_ms, client.session_busy(directory, session_id).await)
}

/// The turn's messages (created since it started, give or take a clock
/// tick) as the events that would have told of them.
fn missed_events(messages: &[Value], session_id: &str, since_ms: u64, busy: Option<bool>) -> Vec<Event> {
    let turn: Vec<&Value> = messages
        .iter()
        .filter(|m| m["info"]["time"]["created"].as_u64().unwrap_or(0) + 2000 >= since_ms)
        .filter(|m| m["info"]["role"] == "assistant")
        .collect();
    let mut events: Vec<Event> = turn
        .iter()
        .flat_map(|m| m["parts"].as_array().cloned().unwrap_or_default())
        .map(|part| Arc::new(json!({ "type": "message.part.updated", "properties": { "part": part } })))
        .collect();
    let Some(last) = turn.last().map(|m| &m["info"]) else { return events };
    if !last["error"].is_null() {
        events.push(Arc::new(json!({
            "type": "session.error",
            "properties": { "sessionID": session_id, "error": last["error"] },
        })));
        return events;
    }
    // Without a status from the server: a finished last message that isn't
    // handing over to a tool ends the turn.
    let busy = busy.unwrap_or_else(|| last["time"]["completed"].is_null() || last["finish"] == "tool-calls");
    if !busy {
        events.push(Arc::new(json!({ "type": "session.idle", "properties": { "sessionID": session_id } })));
    }
    events
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
if the task needs that, suggest switching to Cowork mode. \
When the task needs an external service and no connected MCP tool covers it, say so and suggest \
a connector (see Connectors instructions below) — do not claim the integration work is done.";

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
) -> SkippedTools {
    let Some((provider_id, model_id)) = model.and_then(|m| m.split_once('/')) else {
        return Vec::new();
    };
    // Keyed by provider too: the same model name reaches Google through more
    // than one provider, and only some of them mind an empty choice.
    let key = format!("{directory}|{provider_id}/{model_id}|{}", mcp.join(","));
    if let Some(known) = unusable_cache().lock().unwrap().get(&key) {
        return known.clone();
    }
    let Ok(tools) = client.tools(directory, provider_id, model_id).await else {
        return Vec::new();
    };
    let google = schema::goes_to_google(provider_id, model_id);
    let skip: SkippedTools = tools
        .into_iter()
        .filter_map(|(name, schema)| Some((name, schema::unsupported(&schema, google)?)))
        .collect();
    if !skip.is_empty() {
        let names: Vec<&str> = skip.iter().map(|(name, _)| name.as_str()).collect();
        eprintln!(
            "[opencode] leaving out tools {provider_id}/{model_id} can't accept: {}",
            names.join(", ")
        );
    }
    unusable_cache().lock().unwrap().insert(key, skip.clone());
    skip
}

/// Tools left out for one folder, model and server set.
type SkippedTools = Vec<(String, Unsupported)>;

fn unusable_cache() -> &'static Mutex<HashMap<String, SkippedTools>> {
    static CACHE: OnceLock<Mutex<HashMap<String, SkippedTools>>> = OnceLock::new();
    CACHE.get_or_init(Default::default)
}

/// Say which tools were left out, where the user is already looking — one
/// line per reason, because the two have different answers: recursion is the
/// server's to fix, an empty choice goes away on a non-Google model.
fn skipped_tools_activities(skipped: &[(String, Unsupported)]) -> Vec<ChatStreamEvent> {
    let mut by_reason: Vec<(Unsupported, Vec<&str>)> = Vec::new();
    for (name, reason) in skipped {
        match by_reason.iter_mut().find(|(known, _)| known == reason) {
            Some((_, names)) => names.push(name),
            None => by_reason.push((*reason, vec![name])),
        }
    }
    by_reason
        .into_iter()
        .map(|(reason, names)| ChatStreamEvent::Activity {
            id: Some(format!("skipped-tools-{reason:?}")),
            kind: "system".into(),
            title: format!("{} left out: {}", names.join(", "), reason.explanation()),
            detail: Some(format!(
                "{} The rest of the server works as usual.\n\n{}",
                reason.detail(),
                names.join("\n")
            )),
            done: true,
            duration_ms: None,
        })
        .collect()
}

/// `server_*` switches off a whole MCP server's tools for one prompt, the
/// same pattern Chat uses for the workspace servers.
fn mcp_tool_patterns(mcp: &[String]) -> Vec<String> {
    mcp.iter().map(|id| format!("{id}_*")).collect()
}

/// Models whose provider refused the tool list these MCP servers contributed.
/// Keyed by the server set too, so changing the connectors tries again.
fn refused_mcp_cache() -> &'static Mutex<HashSet<String>> {
    static CACHE: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
    CACHE.get_or_init(Default::default)
}

fn refused_key(model: Option<&str>, mcp: &[String]) -> String {
    format!("{}|{}", model.unwrap_or_default(), mcp.join(","))
}

fn mcp_was_refused(model: Option<&str>, mcp: &[String]) -> bool {
    refused_mcp_cache().lock().unwrap().contains(&refused_key(model, mcp))
}

fn remember_mcp_refused(model: Option<&str>, mcp: &[String]) {
    refused_mcp_cache().lock().unwrap().insert(refused_key(model, mcp));
}

/// Said where the user is already looking, because the reply that follows is
/// missing tools they switched on and nothing else would explain why.
fn mcp_refused_activity(mcp: &[String], first_time: bool) -> ChatStreamEvent {
    let named = if mcp.len() == 1 {
        format!("the {} connector", mcp[0])
    } else {
        format!("one of these connectors: {}", mcp.join(", "))
    };
    ChatStreamEvent::Activity {
        id: Some("mcp-tools-refused".into()),
        kind: "system".into(),
        title: format!(
            "Connector tools left out: this model's provider won't accept {}",
            if mcp.len() == 1 { mcp[0].clone() } else { mcp.join(", ") }
        ),
        detail: Some(format!(
            "The provider checks every tool it is offered before it reads the message, and it \
             turned the whole request down over a tool from {named}. {}\n\nThe reply below was \
             made without those tools. To use them, pick a model from another provider — \
             Anthropic, OpenAI and OpenCode take them — or switch that connector off in \
             Settings → MCP to stop this happening.",
            if first_time {
                "The message was sent again without them."
            } else {
                "That happened earlier in this session, so they were left out from the start."
            }
        )),
        done: true,
        duration_ms: None,
    }
}

/// Points the model at the MCP tools; without it, models tend to write
/// scripts or hunt for instructions instead.
fn mcp_note(servers: &[String]) -> Option<String> {
    // `mali` is Mali's gateway: name the connectors behind it, as OpenCode
    // names their tools (`mali_<connector>_<tool>`).
    let servers: Vec<String> = servers
        .iter()
        .flat_map(|id| {
            if id == crate::mcp_hub::gateway::SERVER_NAME {
                // Mali's own document tools (templates, .docx), plus each connector behind the gateway.
                let mut ids: Vec<String> = crate::mcp_hub::offered_ids().into_iter().map(|c| format!("mali_{c}")).collect();
                ids.push(crate::mcp_hub::gateway::SERVER_NAME.into());
                ids
            } else {
                vec![id.clone()]
            }
        })
        .collect();
    if servers.is_empty() {
        return Some(
            "No MCP connectors are connected right now. If the user's task needs an external \
             app or API, explain that briefly and add a ```connector {\"query\": \"…\"} ``` block \
             in your reply so the app can show a safe install card — do not run install commands \
             or ask for secrets in chat.".into(),
        );
    }
    let list = servers
        .iter()
        .map(|id| {
            if id == crate::mcp_hub::gateway::SERVER_NAME {
                "- mali — Mali's document tools: mali_list_templates, mali_read_document, mali_fill_template, \
                 mali_save_template, mali_make_template (quotations, invoices, letters, the user's own templates)"
                    .to_string()
            } else {
                format!("- {id} (tools named `{id}_*`)")
            }
        })
        .collect::<Vec<_>>()
        .join("\n");
    Some(format!(
        "Connected MCP servers:\n{list}\n\nWhen one of these servers covers the task \
         (e.g. `word_*` for Word documents, `media_*` to make a picture or a video), call its \
         tools directly rather than writing a script — or saying you cannot — for what they \
         already do. If the task needs another service and none of the above apply, suggest a \
         connector via a ```connector``` block (see Connectors instructions below). A skill listed \
         below may still tell you how the user wants that work done."
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
    let variant = request.effort.as_deref().map(str::trim).filter(|v| !v.is_empty()).map(str::to_string);
    if request.is_chat() {
        let system = [Some(CHAT_SYSTEM.to_string()), mcp_note, instructions].into_iter().flatten();
        return PromptOptions {
            model,
            variant,
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
        variant,
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

#[cfg(test)]
mod tests {
    use crate::commands::supervisor::shutdown_all as shutdown;
    use super::*;
    use serde_json::json;

    fn message(role: &str, created: u64, info: Value, parts: Value) -> Value {
        let mut message = json!({ "info": { "role": role, "time": { "created": created } }, "parts": parts });
        for (key, value) in info.as_object().unwrap() {
            message["info"][key] = value.clone();
        }
        message
    }

    /// After the stream drops, the turn's answer is read back whole (the
    /// translator sends only what it hadn't), and a turn that ended meanwhile ends.
    #[test]
    fn a_dropped_stream_catches_up_on_the_turn() {
        let earlier = message("assistant", 1_000, json!({}), json!([{ "id": "old", "type": "text", "text": "before" }]));
        let asked = message("user", 50_000, json!({}), json!([{ "id": "q", "type": "text", "text": "hi" }]));
        let answer = message(
            "assistant",
            50_100,
            json!({ "time": { "created": 50_100, "completed": 51_000 }, "finish": "stop" }),
            json!([{ "id": "a", "type": "text", "text": "hello there" }]),
        );
        let events = missed_events(&[earlier, asked, answer], "ses_1", 50_000, None);
        let types: Vec<&str> = events.iter().map(|e| e["type"].as_str().unwrap()).collect();
        assert_eq!(types, ["message.part.updated", "session.idle"]);
        assert_eq!(events[0]["properties"]["part"]["id"], "a");

        // Still working (the server says so, or the message hands over to a tool): no end yet.
        let working = message("assistant", 50_100, json!({}), json!([]));
        assert!(missed_events(std::slice::from_ref(&working), "ses_1", 50_000, Some(true)).is_empty());
        let tooling = message(
            "assistant",
            50_100,
            json!({ "time": { "created": 50_100, "completed": 51_000 }, "finish": "tool-calls" }),
            json!([]),
        );
        assert!(missed_events(&[tooling], "ses_1", 50_000, None).is_empty());
    }

    #[test]
    fn a_turn_that_failed_meanwhile_says_why() {
        let failed = message("assistant", 50_100, json!({ "error": { "name": "APIError", "data": { "message": "quota" } } }), json!([]));
        let events = missed_events(&[failed], "ses_1", 50_000, Some(false));
        assert_eq!(events.last().unwrap()["type"], "session.error");
    }

    /// The levels a model actually accepts, in the order a slider should show
    /// them — not the order the map happened to come back in.
    #[test]
    fn effort_levels_are_sorted_weakest_first() {
        let variants = json!({ "high": {}, "none": {}, "medium": {}, "low": {}, "xhigh": {} });
        assert_eq!(
            effort_levels(&variants),
            ["none", "low", "medium", "high", "xhigh"]
        );
        // A level we have never heard of still reaches the user, at the end.
        let future = json!({ "low": {}, "high": {}, "ludicrous": {} });
        assert_eq!(effort_levels(&future), ["low", "high", "ludicrous"]);
    }

    /// One variant is not a choice, so no control is offered for it.
    #[test]
    fn a_model_without_a_real_choice_offers_no_control() {
        assert!(effort_levels(&json!({})).is_empty());
        assert!(effort_levels(&json!({ "high": {} })).is_empty());
        assert!(effort_levels(&Value::Null).is_empty());
    }


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
            effort: None,
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
            effort: None,
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
        let mut events = stream::SseStream::new(client.events(&directory).await.unwrap());
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
