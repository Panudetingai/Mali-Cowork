//! Mali's own agent: Cowork on a provider's API with the user's key, no
//! OpenCode in between. The model is called in a loop — it asks for a tool,
//! Mali runs it (asking the user first where it changes something), the
//! result goes back — until it answers without asking for more.
//!
//! It streams the same [`ChatStreamEvent`]s as the other agents, so the chat,
//! its steps, the permission cards and the Task Inbox work unchanged.

pub(crate) mod coach;
mod compact;
pub(crate) mod images;
pub(crate) mod paths;
mod permissions;
mod provider;
mod questions;
mod session;
pub(crate) mod team;
pub(crate) mod team_gateway;
mod tools;
pub(crate) mod wire;

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::Instant;

use serde::Deserialize;
use tauri::ipc::Channel;
use tokio::sync::watch;

use crate::chat_stream::{AgentUsage, ChatStreamEvent};
use crate::commands::mcp::McpServerEntry;
use crate::mcp_hub;
use paths::{FolderGrant, Scope};
use session::Session;
use wire::{Delta, ModelTarget, Msg, Usage, Wire};

/// A runaway loop is stopped here; the user can say "go on".
const MAX_STEPS: usize = 60;
/// Times a model that stops with nothing to say is asked to carry on.
const MAX_NUDGES: usize = 2;
/// Sent (as the app, not the user) when a turn ends with no reply and no tool call.
const NUDGE: &str = "(Note from the Mali app, not the user.) Your last turn ended without a reply or a tool \
call, and the user's request isn't finished. Continue with the next step using your tools — if a tool gave \
you an intermediate result (an upload URL, an id, instructions), carry it out now. If you're blocked, say \
what's blocking you and what you need, or ask with ask_user. If the work is done, tell the user what you \
did in their language.";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRequest {
    pub prompt: String,
    /// Provider id from Settings → Models, e.g. `openai`, `anthropic`.
    pub provider: String,
    pub model: String,
    pub api_key: Option<String>,
    pub base_url: Option<String>,
    /// The chat's agent session, to carry on the conversation.
    pub session_id: Option<String>,
    /// `cowork` (files, commands and connectors) or `chat` (connectors only).
    #[serde(default)]
    pub mode: Option<String>,
    /// Cowork: the folder the agent works in.
    #[serde(default)]
    pub cwd: Option<String>,
    #[serde(default)]
    pub folders: Vec<FolderGrant>,
    /// Custom instructions, skills and connector notes.
    pub instructions: Option<String>,
    pub effort: Option<String>,
    /// Settings: changes and commands run without asking.
    #[serde(default)]
    pub auto_approve: bool,
    /// Settings: run shell commands inside the OS sandbox (on unless turned off).
    #[serde(default = "yes")]
    pub sandbox: bool,
    /// The chat id; stops the run through [`abort`].
    pub run_id: String,
    /// The user's connectors, as the Connectors page keeps them; the ones that
    /// are on are reached through Mali's MCP hub.
    #[serde(default)]
    pub mcp: Vec<McpServerEntry>,
    /// Pictures sent with this prompt (attachment paths).
    #[serde(default)]
    pub images: Vec<String>,
    /// The model's context budget in tokens; past most of it the conversation is compacted.
    #[serde(default)]
    pub context_limit: Option<u64>,
    /// The model takes pictures: it gets `view_image`, and sees what tools return.
    #[serde(default)]
    pub vision: bool,
    /// Team mode: this run is the lead, and hands work to `team` (see [`team`]).
    #[serde(default)]
    pub lead: bool,
    #[serde(default)]
    pub team: Vec<team::Teammate>,
    /// Titles of the user's recent chats, which tell the lead what they work on.
    #[serde(default)]
    pub recent_work: Vec<String>,
    /// Teammates the lead proposed and the user turned down.
    #[serde(default)]
    pub declined: Vec<String>,
    /// A teammate's run: the file and command tools its role allows.
    #[serde(skip)]
    pub tool_scope: Option<team::ToolScope>,
    /// Team mode: a stronger model that writes and coaches bots for the lead.
    #[serde(default)]
    pub coach: Option<coach::CoachModel>,
    /// Team mode: the lead's notebook — what the user keeps working on.
    #[serde(default)]
    pub notebook: Vec<String>,
}

fn yes() -> bool {
    true
}

impl AgentRequest {
    fn cowork(&self) -> bool {
        self.mode.as_deref() != Some("chat")
    }
}

fn runs() -> &'static Mutex<HashMap<String, watch::Sender<bool>>> {
    static RUNS: OnceLock<Mutex<HashMap<String, watch::Sender<bool>>>> = OnceLock::new();
    RUNS.get_or_init(Default::default)
}

/// Stop a run: the model call in flight, a running command, or a waiting card.
pub fn abort(run_id: &str) -> bool {
    runs().lock().unwrap().get(run_id).map(|tx| tx.send(true).is_ok()).unwrap_or(false)
}

/// Answer a permission card the agent is waiting on.
pub fn reply_permission(id: &str, reply: &str) -> bool {
    // A card from an OpenCode teammate is answered in OpenCode.
    permissions::reply(id, reply) || team::reply_forwarded(id, reply)
}

/// Answer a question the agent asked; empty answers withdraw it.
pub fn answer_question(id: &str, answers: Vec<Vec<String>>) -> bool {
    questions::answer(id, answers.clone()) || team::answer_forwarded(id, answers)
}

/// Used when the app doesn't know the model's window.
const DEFAULT_CONTEXT: u64 = 128_000;

fn wire_for(provider: &str) -> Wire {
    if provider == "anthropic" { Wire::Anthropic } else { Wire::OpenAi }
}

/// Everything needed to call one model with the user's key.
pub(crate) fn target_for(
    provider: &str,
    model: &str,
    api_key: Option<&str>,
    base_url: Option<&str>,
    effort: Option<String>,
) -> Result<ModelTarget, String> {
    let (base_url, api_key) = crate::ai::endpoint(provider, api_key, base_url)?;
    Ok(ModelTarget {
        wire: wire_for(provider),
        provider: provider.to_string(),
        model: model.trim().to_string(),
        base_url,
        api_key,
        effort: effort.filter(|e| !e.trim().is_empty()),
    })
}

fn os_name() -> &'static str {
    match std::env::consts::OS {
        "macos" => "macOS",
        "windows" => "Windows",
        other => other,
    }
}

fn connectors_note(connected: &[String], unavailable: &[String]) -> String {
    let mut note = String::new();
    if !connected.is_empty() {
        note.push_str(&format!(
            "\n\n# Connectors\nConnected through Mali: {}. Their tools are named `<connector>_<tool>`; \
when one covers the task, call it rather than guessing or saying you can't.",
            connected.join(", ")
        ));
    }
    if !unavailable.is_empty() {
        note.push_str(&format!(
            "\nNot reachable right now: {}. If the task needs one of them, say so and how to fix it.",
            unavailable.join(", ")
        ));
    }
    note
}

/// How to work, for both modes: understand, act until done, recover, finish.
const WORKING_RULES: &str = "# Understand the request first
- Read the whole conversation, not only the last message. \"This\", \"the folder\", a link or \
\"do it in Canva\" refer to what came before — resolve them from the conversation, the working folder \
and the connectors before you act.
- Work out the result that would satisfy the user and where it belongs. If they name a place or a tool \
(\"in Canva\", \"in this file\", \"in Notion\"), deliver it there with that connector or file — not a \
stand-in such as a local HTML page, unless they asked for one.
- Links carry what you need: take ids from them (a Canva design id, a Notion page id, a GitHub repo) and \
pass them to the right tool.
- When a detail that matters is missing or ambiguous and a wrong guess would waste the user's time \
(which design or files, which style, what to write), ask with the ask_user tool: one short question with \
2–4 concrete options. For small details, choose sensibly, go on, and say what you assumed. Don't ask \
what you can find out yourself with your tools.

# Keep going until it's done
- For work with several steps, write a plan with todo_write and tick items off as you go.
- After every tool result, decide the next step and take it. Don't stop after gathering information, \
and never end a turn with no message: either call the next tool, ask the user, or give your final answer.
- Tools often return an intermediate step rather than the result: an upload URL, an id, a job to check, \
instructions. Follow through — read the tool's description, then carry it out (for example upload a \
local file to an upload URL with bash and curl) and use what comes back in the next call.

# Use real values only
- Use ids, URLs, tokens and paths exactly as a tool gave them. Never invent one or reuse one that was meant for something else — an upload URL is for one file: ask the tool for a new one for each file.

# Visual work (designs, posters, slides, pictures)
- Learn the design before you change it: the page size, and every element's position, size and role (title, main photo, price, body text, logo). If you have view_image, look at the design's thumbnail or preview.
- Decide the layout before editing: where each new element goes and how big, and what it replaces. Keep every element inside the page with a margin; never cover text, a logo or the main subject; keep the existing colours, fonts and spacing unless asked to change them. Filling an existing picture frame beats piling a new picture on top.
- Use only the assets that match what was asked (\"coffee pictures only\" → check file names, notes in the folder, and the pictures themselves if you can see them). If it's unclear which ones qualify, ask.
- \"Adjust the style\" without saying how: offer two or three concrete directions with ask_user before editing.
- Check before you save: go over the positions again for overlaps and anything off the page, look at the preview if you can, fix what's wrong — then commit. Tell the user what changed and offer to adjust.

# When something fails
- Read the error and fix the cause: other arguments, another tool, a command. Don't repeat the exact \
call that just failed.
- After two or three different attempts, stop and tell the user plainly what didn't work, what you \
tried, and what they can do (sign in to a connector, add a folder, pick another model).
- If the task needs a service no connector covers, say so and suggest one with a connector block.

# Finish
- End with a short message in the user's language: what you did, where the result is (a link, a file \
path), and anything left for them to check or decide.";

fn chat_system_prompt(request: &AgentRequest) -> String {
    let mut prompt = format!(
        "You are Mali Cowork in Chat mode: a friendly, capable assistant that works through the \
user's connectors. You can't read or change the user's files here; if the task needs that, suggest \
switching to Cowork mode.

# Environment
- Operating system: {os}
- Today: {today}

{rules}",
        os = os_name(),
        today = chrono_like_today(),
        rules = WORKING_RULES,
    );
    if let Some(extra) = request.instructions.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        prompt.push_str("\n\n");
        prompt.push_str(extra);
    }
    prompt
}

fn system_prompt(request: &AgentRequest, scope: &Scope) -> String {
    let os = os_name();
    let today = chrono_like_today();
    let mut prompt = format!(
        "You are Mali Cowork, an AI agent that gets real work done on the user's computer through tools: \
their files, commands, and their connected apps. You work in the folders the user granted this chat and \
nowhere else.

# Environment
- Working folder: {cwd}
- Folders you may use: {roots}
- Operating system: {os}
- Today: {today}

{rules}

# Files and commands
- Look before you change: list, search and read the relevant files first. Don't guess at file contents.
- Prefer edit_file for changes to existing files; write_file for new files or full rewrites.
- Changing a file or running a command shows the user an approval card. If they deny it, stop and ask \
what they'd like instead — don't try another route to the same thing.
- Run commands non-interactively. Never run destructive commands (deleting many files, force-pushing, \
dropping data) unless the user asked for exactly that.
- Documents with a set layout (quotation, invoice, official letter, meeting minutes, and the user's own \
templates): call list_templates, then fill_template, so the layout, Thai font and money figures come out \
right. A .docx the user wants to reuse can become a template with make_template: read it with \
read_document, pick the parts that change (names, dates, amounts, table rows), show the user that list \
and get their OK with ask_user first, then save it to their library. Ask with ask_user for required \
details you don't have — never make up customer names, prices or document numbers.",
        cwd = scope.cwd.display(),
        roots = scope.roots(),
        rules = WORKING_RULES,
    );
    if let Some(extra) = request.instructions.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        prompt.push_str("\n\n");
        prompt.push_str(extra);
    }
    prompt
}

/// `YYYY-MM-DD` in UTC, without pulling in a date crate for one line.
fn chrono_like_today() -> String {
    let days = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() / 86_400)
        .unwrap_or(0) as i64;
    // Civil-from-days (Howard Hinnant).
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + i64::from(m <= 2);
    format!("{y:04}-{m:02}-{d:02}")
}

fn usage_event(usage: &Usage) -> AgentUsage {
    AgentUsage {
        input_tokens: Some(usage.input),
        output_tokens: Some(usage.output),
        cache_read_tokens: (usage.cache_read > 0).then_some(usage.cache_read),
        cache_write_tokens: (usage.cache_write > 0).then_some(usage.cache_write),
        reasoning_tokens: (usage.reasoning > 0).then_some(usage.reasoning),
        total_tokens: Some(usage.input + usage.output),
        cost: None,
    }
}

/// Run one prompt to the end. Errors go out as an `Error` event.
pub async fn generate(mut request: AgentRequest, on_event: Channel<ChatStreamEvent>) -> Result<(), String> {
    team::settle(&mut request.team);
    let (tx, mut cancel) = watch::channel(false);
    runs().lock().unwrap().insert(request.run_id.clone(), tx);
    let result = run(&request, &on_event, &mut cancel).await;
    runs().lock().unwrap().remove(&request.run_id);
    match result {
        Ok(()) => {
            let _ = on_event.send(ChatStreamEvent::Done { model_id: String::new() });
        }
        Err(message) => {
            let message = crate::http_body::clarify_reqwest(&message).unwrap_or(message);
            let _ = on_event.send(ChatStreamEvent::Error { message });
        }
    }
    Ok(())
}

async fn run(
    request: &AgentRequest,
    on_event: &Channel<ChatStreamEvent>,
    cancel: &mut watch::Receiver<bool>,
) -> Result<(), String> {
    let started = Instant::now();
    let prompt = request.prompt.trim();
    if prompt.is_empty() {
        return Err("Prompt cannot be empty.".into());
    }
    let target = target_for(
        &request.provider,
        &request.model,
        request.api_key.as_deref(),
        request.base_url.as_deref(),
        request.effort.clone(),
    )?;
    let scope = if request.cowork() {
        let cwd = request.cwd.as_deref().filter(|c| !c.trim().is_empty()).ok_or("Pick the folder Cowork works in first.")?;
        Some(Scope::new(cwd, &request.folders)?)
    } else {
        None
    };

    let mut session = Session::load_or_new(request.session_id.as_deref());
    session.close_open_calls();
    session.messages.push(Msg::User { text: prompt.to_string(), images: request.images.clone() });
    session.save()?;

    let _ = on_event.send(ChatStreamEvent::Started);
    // The session id first, so a run stopped half-way still continues next time.
    let _ = on_event.send(ChatStreamEvent::Metadata {
        session_id: Some(session.id.clone()),
        usage: None,
        duration_ms: None,
        model: None,
    });

    // A lead doesn't get its teammates' connectors: their work goes to them.
    let owned = if request.lead { team::owned_connectors(&request.team) } else { Default::default() };
    let mcp: Vec<McpServerEntry> = request.mcp.iter().filter(|s| !owned.contains(&s.id)).cloned().collect();

    // Connectors: Mali's hub reaches them; a first start can take a while.
    let wants_mcp = mcp.iter().any(|s| s.enabled && !mcp_hub::AGENT_ONLY_ELSEWHERE.contains(&s.id.as_str()));
    let (hub_tools, unavailable) = if wants_mcp {
        let t0 = Instant::now();
        let step = |done: bool, detail: Option<String>, duration_ms: Option<u64>| ChatStreamEvent::Activity {
            id: Some("mcp-connect".into()),
            kind: "system".into(),
            title: "Connect: connectors".into(),
            detail,
            done,
            duration_ms,
        };
        let lookup = mcp_hub::tools(&mcp);
        tokio::pin!(lookup);
        // Already connected is instant; only a real wait (a first start) shows as a step.
        let mut shown = false;
        let found = match tokio::time::timeout(std::time::Duration::from_millis(400), &mut lookup).await {
            Ok(found) => found,
            Err(_) => {
                shown = true;
                let _ = on_event.send(step(false, None, None));
                tokio::select! {
                    found = &mut lookup => found,
                    _ = cancel.wait_for(|stopped| *stopped) => (Vec::new(), Vec::new()),
                }
            }
        };
        if shown || !found.1.is_empty() {
            let detail = (!found.1.is_empty()).then(|| format!("Not reachable: {}", found.1.join(", ")));
            let _ = on_event.send(step(true, detail, Some(t0.elapsed().as_millis() as u64)));
        }
        found
    } else {
        (Vec::new(), Vec::new())
    };
    let mut connected: Vec<String> = hub_tools.iter().map(|t| t.server.clone()).collect();
    connected.dedup();
    let hub: HashMap<String, &mcp_hub::HubTool> = hub_tools.iter().map(|t| (t.name.clone(), t)).collect();

    let mut specs = if scope.is_some() { tools::specs() } else { Vec::new() };
    if let Some(allowed) = request.tool_scope {
        specs.retain(|t| allowed.allows(&t.name));
    }
    if request.lead {
        specs.extend(team::specs(request));
    }
    specs.push(questions::spec());
    if request.vision {
        specs.push(images::spec());
    }
    specs.extend(hub_tools.iter().map(|t| wire::ToolSpec {
        name: t.name.clone(),
        description: if t.description.is_empty() { format!("{} tool {}", t.server, t.tool) } else { t.description.clone() },
        schema: t.schema.clone(),
    }));
    let system = match &scope {
        Some(scope) => system_prompt(request, scope),
        None => chat_system_prompt(request),
    } + &connectors_note(&connected, &unavailable)
        + &if request.lead { team::lead_note(request) } else { String::new() };

    let mut usage = Usage::default();
    let mut outcome: Result<(), String> = Ok(());
    let mut steps = 0;
    let mut nudges = 0;
    let mut handoffs = 0;
    loop {
        if *cancel.borrow() {
            break;
        }
        if steps >= MAX_STEPS {
            let _ = on_event.send(ChatStreamEvent::Chunk {
                text: format!("\n\n_Stopped after {MAX_STEPS} steps. Say \"continue\" to carry on._"),
            });
            break;
        }
        steps += 1;

        // Keep the conversation inside the window: shorten old tool output,
        // then summarise what came before this prompt.
        let limit = request.context_limit.filter(|l| *l > 4_000).unwrap_or(DEFAULT_CONTEXT);
        let tools_chars: usize = specs.iter().map(|t| t.description.len() + t.schema.to_string().len()).sum();
        let over = |msgs: &[Msg]| compact::estimate_tokens(&system, msgs, tools_chars) as f64 > limit as f64 * compact::TRIGGER;
        if over(&session.messages) && !(compact::trim_old(&mut session.messages) && !over(&session.messages)) {
            if let Some(cut) = compact::split_point(&session.messages) {
                let t0 = Instant::now();
                let step = |done: bool, duration_ms: Option<u64>| ChatStreamEvent::Activity {
                    id: Some(format!("compact-{steps}")),
                    kind: "system".into(),
                    title: "Summarise: earlier conversation".into(),
                    detail: None,
                    done,
                    duration_ms,
                };
                let _ = on_event.send(step(false, None));
                let transcript = compact::transcript(&session.messages[..cut]);
                let mut quiet = |_: Delta| {};
                let summary = provider::step(
                    &target,
                    compact::SUMMARY_SYSTEM,
                    &[Msg::User { text: transcript, images: Vec::new() }],
                    &[],
                    &mut quiet,
                    cancel,
                )
                .await;
                let _ = on_event.send(step(true, Some(t0.elapsed().as_millis() as u64)));
                match summary {
                    Ok(summary) if !summary.text.trim().is_empty() => {
                        usage.add(&summary.usage);
                        compact::replace_with_summary(&mut session.messages, cut, &summary.text);
                    }
                    Err(e) if e == provider::STOPPED => break,
                    // The summary failed: fall back to shortening harder.
                    _ => {
                        compact::trim_tight(&mut session.messages);
                    }
                }
            } else {
                // One very long turn: nothing before it to summarise.
                compact::trim_tight(&mut session.messages);
            }
            session.save()?;
        }

        let mut on_delta = |delta: Delta| {
            let _ = on_event.send(match delta {
                Delta::Text(text) => ChatStreamEvent::Chunk { text },
                Delta::Reasoning(reasoning) => ChatStreamEvent::Reasoning { reasoning },
            });
        };
        let result = match provider::step(&target, &system, &session.messages, &specs, &mut on_delta, cancel).await {
            Ok(result) => result,
            Err(e) if e == provider::STOPPED => break,
            Err(e) => {
                outcome = Err(e);
                break;
            }
        };
        usage.add(&result.usage);
        let calls = result.tool_calls.clone();
        // Text before tool calls reads as its own paragraph.
        if !result.text.is_empty() && !calls.is_empty() {
            let _ = on_event.send(ChatStreamEvent::Chunk { text: "\n\n".into() });
        }
        let silent = result.text.trim().is_empty() && calls.is_empty();
        session.messages.push(Msg::Assistant { text: result.text, tool_calls: result.tool_calls });
        session.save()?;
        if silent && nudges < MAX_NUDGES && !*cancel.borrow() {
            // The model stopped with nothing to show — often right after a tool
            // handed back an intermediate step. Point that out and let it go on.
            nudges += 1;
            session.messages.push(Msg::User { text: NUDGE.into(), images: Vec::new() });
            continue;
        }
        if silent {
            let _ = on_event.send(ChatStreamEvent::Chunk {
                text: "_The model stopped without finishing. Say \"continue\" to let it pick up from here, or try another model._".into(),
            });
        }
        if calls.is_empty() {
            break;
        }

        for call in &calls {
            if *cancel.borrow() {
                session.messages.push(Msg::Tool {
                    call_id: call.id.clone(),
                    name: call.name.clone(),
                    content: "Cancelled: the user stopped the run before this ran.".into(),
                    is_error: true,
                    images: Vec::new(),
                });
                continue;
            }
            if !specs.iter().any(|t| t.name == call.name) {
                session.messages.push(Msg::Tool {
                    call_id: call.id.clone(),
                    name: call.name.clone(),
                    content: format!("There is no tool named {} here. Use only the tools you were given.", call.name),
                    is_error: true,
                    images: Vec::new(),
                });
                continue;
            }
            let hub_tool = hub.get(&call.name).copied();
            let mate = (call.name == team::DELEGATE).then(|| team::teammate_of(&request.team, &call.args)).flatten();
            // A hand-off shows as the teammate's own step.
            let step_id = match mate {
                Some(mate) => team::step_id(&mate.id, &call.id),
                None => call.id.clone(),
            };
            let title = match (hub_tool, &scope) {
                _ if call.name == questions::NAME => "Ask: the user".to_string(),
                _ if call.name == team::DELEGATE => format!("Team: {}", mate.map(|m| m.name.as_str()).unwrap_or("teammate")),
                _ if call.name == team::PROPOSE => format!(
                    "Team: propose {}",
                    call.args["name"].as_str().or(call.args["need"].as_str()).unwrap_or("a teammate")
                ),
                _ if call.name == team::COACH => {
                    format!("Team: coach {}", team::teammate_of(&request.team, &call.args).map(|m| m.name.as_str()).unwrap_or("a teammate"))
                }
                _ if call.name == images::NAME => format!(
                    "View: {}",
                    call.args["source"].as_str().map(|s| s.split('?').next().unwrap_or(s)).unwrap_or("picture")
                ),
                // How the app's step list recognises a connector call.
                (Some(t), _) => format!("{}_{}", t.server, t.tool),
                (None, Some(scope)) => tools::title_for(call, scope),
                (None, None) => format!("Tool: {}", call.name),
            };
            let _ = on_event.send(ChatStreamEvent::Activity {
                id: Some(step_id.clone()),
                kind: "tool".into(),
                title: title.clone(),
                detail: None,
                done: false,
                duration_ms: None,
            });
            let t0 = Instant::now();
            let out = match (hub_tool, &scope) {
                _ if call.name == team::DELEGATE && handoffs >= team::MAX_DELEGATIONS => tools::Outcome::err(format!(
                    "That's {} hand-offs for this request, the most allowed. Finish with what the team has, and tell the user what's left.",
                    team::MAX_DELEGATIONS
                )),
                _ if call.name == team::DELEGATE => {
                    handoffs += 1;
                    let mut always = std::mem::take(&mut session.always);
                    let mut sessions = std::mem::take(&mut session.team_sessions);
                    let out = team::delegate(
                        call,
                        team::Handoff {
                            lead: request,
                            step: &step_id,
                            always: &mut always,
                            sessions: &mut sessions,
                            usage: &mut usage,
                            on_event,
                            cancel: &mut *cancel,
                        },
                    )
                    .await;
                    session.always = always;
                    session.team_sessions = sessions;
                    out
                }
                _ if call.name == team::PROPOSE => team::propose(call, request, on_event, &mut usage, &mut *cancel).await,
                _ if call.name == team::COACH => team::coach(call, request, on_event, &mut usage, &mut *cancel).await,
                _ if call.name == questions::NAME => {
                    let directory = scope.as_ref().map(|s| s.cwd.to_string_lossy().to_string()).unwrap_or_default();
                    match questions::ask(&call.args, &directory, on_event, cancel).await {
                        Ok(text) => tools::Outcome::ok(text),
                        Err(e) => tools::Outcome::err(e),
                    }
                }
                _ if call.name == images::NAME && request.vision => match images::view(&call.args, scope.as_ref()).await {
                    Ok((text, image)) => tools::Outcome { detail: Some(text.clone()), content: text, is_error: false, images: vec![image] },
                    Err(e) => tools::Outcome::err(e),
                },
                (Some(tool), _) => call_connector(tool, call, cancel).await,
                (None, Some(scope)) => {
                    let mut always = std::mem::take(&mut session.always);
                    let out = {
                        let mut ctx = tools::ToolCtx {
                            scope,
                            on_event,
                            auto_approve: request.auto_approve,
                            sandbox: request.sandbox,
                            always: &mut always,
                            cancel: &mut *cancel,
                        };
                        tools::run(call, &mut ctx).await
                    };
                    session.always = always;
                    out
                }
                (None, None) => tools::Outcome::err(format!("There is no tool named {} here.", call.name)),
            };
            let mut out = out;
            if !request.vision && !out.images.is_empty() {
                out.images.clear();
                out.content.push_str("\n[A picture came back, but this model can't see pictures.]");
            }
            let _ = on_event.send(ChatStreamEvent::Activity {
                id: Some(step_id),
                kind: "tool".into(),
                title: if out.is_error { format!("{title} (failed)") } else { title },
                detail: out.detail,
                done: true,
                duration_ms: Some(t0.elapsed().as_millis() as u64),
            });
            session.messages.push(Msg::Tool {
                call_id: call.id.clone(),
                name: call.name.clone(),
                content: out.content,
                is_error: out.is_error,
                images: out.images,
            });
        }
        session.save()?;
    }

    session.save()?;
    let _ = on_event.send(ChatStreamEvent::Metadata {
        session_id: Some(session.id.clone()),
        usage: Some(usage_event(&usage)),
        duration_ms: Some(started.elapsed().as_millis() as u64),
        model: Some(format!("{}/{}", target.provider, target.model)),
    });
    outcome
}

/// One connector tool call through the hub; stopping the run stops waiting for it.
async fn call_connector(tool: &mcp_hub::HubTool, call: &wire::ToolCall, cancel: &mut watch::Receiver<bool>) -> tools::Outcome {
    if let serde_json::Value::String(raw) = &call.args {
        return tools::Outcome::err(format!("The arguments weren't valid JSON: {}", tools::clip(raw, 300)));
    }
    let result = tokio::select! {
        result = tool.call(call.args.clone()) => result,
        _ = cancel.wait_for(|stopped| *stopped) => Err("Stopped by the user.".into()),
    };
    let args = serde_json::to_string_pretty(&call.args).unwrap_or_default();
    match result {
        Ok(result) => tools::Outcome {
            detail: Some(tools::clip(&format!("{args}\n\n{}", result.text), 4_000)),
            content: tools::clip(&result.text, 30_000),
            is_error: result.is_error,
            images: result.images,
        },
        Err(e) => tools::Outcome::err(format!("{} couldn't run {}: {e}", tool.server, tool.tool)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn today_is_a_date() {
        let today = chrono_like_today();
        assert_eq!(today.len(), 10);
        assert!(today.starts_with("20"));
    }

    /// A fake OpenAI-compatible server: each request gets the next canned SSE body.
    async fn mock_server(bodies: Vec<String>) -> (String, std::sync::Arc<Mutex<Vec<String>>>) {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let seen = std::sync::Arc::new(Mutex::new(Vec::new()));
        let log = seen.clone();
        tokio::spawn(async move {
            for body in bodies {
                let (mut sock, _) = listener.accept().await.unwrap();
                let mut req = Vec::new();
                let mut buf = [0u8; 8192];
                // Read headers, then the body by Content-Length.
                loop {
                    let n = sock.read(&mut buf).await.unwrap();
                    req.extend_from_slice(&buf[..n]);
                    let text = String::from_utf8_lossy(&req).to_string();
                    if let Some(end) = text.find("\r\n\r\n") {
                        let len = text[..end]
                            .lines()
                            .find_map(|l| l.to_ascii_lowercase().strip_prefix("content-length:").map(|v| v.trim().parse::<usize>().unwrap()))
                            .unwrap_or(0);
                        if req.len() >= end + 4 + len {
                            log.lock().unwrap().push(text[end + 4..].to_string());
                            break;
                        }
                    }
                }
                let head = format!(
                    "HTTP/1.1 200 OK\r\ncontent-type: text/event-stream\r\ncontent-length: {}\r\nconnection: close\r\n\r\n",
                    body.len()
                );
                sock.write_all(head.as_bytes()).await.unwrap();
                sock.write_all(body.as_bytes()).await.unwrap();
                let _ = sock.shutdown().await;
            }
        });
        (format!("http://{addr}/v1"), seen)
    }

    fn sse(events: &[serde_json::Value]) -> String {
        events.iter().map(|e| format!("data: {e}\n\n")).collect::<String>() + "data: [DONE]\n\n"
    }

    #[tokio::test]
    async fn runs_a_tool_and_answers_end_to_end() {
        use serde_json::json;
        let dir = std::env::temp_dir().join(format!("mali-agent-{}", uuid::Uuid::new_v4().simple()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("hello.txt"), "hi").unwrap();

        let first = sse(&[
            json!({"choices":[{"delta":{"content":"Let me look."}}]}),
            json!({"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"list_dir","arguments":"{\"pa"}}]}}]}),
            json!({"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"th\": \".\"}"}}]}}]}),
            json!({"choices":[],"usage":{"prompt_tokens":10,"completion_tokens":5}}),
        ]);
        let second = sse(&[
            json!({"choices":[{"delta":{"content":"There is hello.txt."}}]}),
            json!({"choices":[],"usage":{"prompt_tokens":20,"completion_tokens":4}}),
        ]);
        let (base, seen) = mock_server(vec![first, second]).await;

        let events = std::sync::Arc::new(Mutex::new(Vec::<String>::new()));
        let sink = events.clone();
        let channel: Channel<ChatStreamEvent> = Channel::new(move |body| {
            if let tauri::ipc::InvokeResponseBody::Json(text) = body {
                sink.lock().unwrap().push(text);
            }
            Ok(())
        });
        let request = AgentRequest {
            prompt: "What's in here?".into(),
            provider: "openai".into(),
            model: "gpt-test".into(),
            api_key: Some("sk-test".into()),
            base_url: Some(base),
            session_id: None,
            mode: None,
            mcp: vec![],
            images: vec![],
            context_limit: None,
            vision: false,
            lead: false,
            team: vec![],
            recent_work: vec![],
            declined: vec![],
            tool_scope: None,
            coach: None,
            notebook: vec![],
            cwd: Some(dir.to_string_lossy().into()),
            folders: vec![],
            instructions: None,
            effort: None,
            auto_approve: false,
            sandbox: true,
            run_id: "test-run".into(),
        };
        generate(request, channel).await.unwrap();

        let events = events.lock().unwrap().join("\n");
        assert!(events.contains("\"Let me look.\""), "{events}");
        assert!(events.contains("List: ."), "{events}");
        assert!(events.contains("There is hello.txt."), "{events}");
        assert!(events.contains("\"inputTokens\":30"), "{events}");
        assert!(events.contains("\"event\":\"done\""), "{events}");
        assert!(!events.contains("\"event\":\"error\""), "{events}");

        // The second request carried the tool call and its result back.
        let seen = seen.lock().unwrap();
        assert_eq!(seen.len(), 2);
        let second: serde_json::Value = serde_json::from_str(&seen[1]).unwrap();
        let msgs = second["messages"].as_array().unwrap();
        assert_eq!(msgs[2]["tool_calls"][0]["function"]["name"], "list_dir");
        assert_eq!(msgs[3]["role"], "tool");
        assert_eq!(msgs[3]["content"], "hello.txt");
        let _ = std::fs::remove_dir_all(dir);
    }

    #[tokio::test]
    async fn anthropic_tool_use_round_trip() {
        use serde_json::json;
        let dir = std::env::temp_dir().join(format!("mali-agent-a-{}", uuid::Uuid::new_v4().simple()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("notes.md"), "alpha\nbeta\n").unwrap();
        let ev = |v: serde_json::Value| format!("event: {}\ndata: {v}\n\n", v["type"].as_str().unwrap());
        let first = [
            ev(json!({"type":"message_start","message":{"usage":{"input_tokens":12}}})),
            ev(json!({"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_1","name":"read_file"}})),
            ev(json!({"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\"path\":"}})),
            ev(json!({"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"\"notes.md\"}"}})),
            ev(json!({"type":"message_delta","usage":{"output_tokens":7}})),
            ev(json!({"type":"message_stop"})),
        ]
        .concat();
        let second = [
            ev(json!({"type":"message_start","message":{"usage":{"input_tokens":30}}})),
            ev(json!({"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"It lists alpha and beta."}})),
            ev(json!({"type":"message_delta","usage":{"output_tokens":6}})),
            ev(json!({"type":"message_stop"})),
        ]
        .concat();
        let (base, seen) = mock_server(vec![first, second]).await;
        let events = std::sync::Arc::new(Mutex::new(Vec::<String>::new()));
        let sink = events.clone();
        let channel: Channel<ChatStreamEvent> = Channel::new(move |body| {
            if let tauri::ipc::InvokeResponseBody::Json(text) = body {
                sink.lock().unwrap().push(text);
            }
            Ok(())
        });
        let request = AgentRequest {
            prompt: "Summarise notes.md".into(),
            provider: "anthropic".into(),
            model: "claude-test".into(),
            api_key: Some("sk-ant-test".into()),
            base_url: Some(base),
            session_id: None,
            mode: None,
            mcp: vec![],
            images: vec![],
            context_limit: None,
            vision: false,
            lead: false,
            team: vec![],
            recent_work: vec![],
            declined: vec![],
            tool_scope: None,
            coach: None,
            notebook: vec![],
            cwd: Some(dir.to_string_lossy().into()),
            folders: vec![],
            instructions: None,
            effort: None,
            auto_approve: false,
            sandbox: true,
            run_id: "test-run-a".into(),
        };
        generate(request, channel).await.unwrap();
        let events = events.lock().unwrap().join("\n");
        assert!(events.contains("Read: notes.md"), "{events}");
        assert!(events.contains("It lists alpha and beta."), "{events}");
        assert!(!events.contains("\"event\":\"error\""), "{events}");

        let seen = seen.lock().unwrap();
        let second: serde_json::Value = serde_json::from_str(&seen[1]).unwrap();
        let msgs = second["messages"].as_array().unwrap();
        assert_eq!(msgs[1]["content"][0]["type"], "tool_use");
        assert_eq!(msgs[1]["content"][0]["input"]["path"], "notes.md");
        assert_eq!(msgs[2]["content"][0]["type"], "tool_result");
        assert!(msgs[2]["content"][0]["content"].as_str().unwrap().contains("alpha"));
        let _ = std::fs::remove_dir_all(dir);
    }

    /// Chat mode on an API key: no file tools, but the user's connectors —
    /// reached through Mali's hub — are there for the model to call.
    #[cfg(unix)]
    #[tokio::test]
    async fn chat_mode_calls_a_connector_through_the_hub() {
        use serde_json::json;
        let script = r#"
while IFS= read -r line; do
  id=$(printf '%s' "$line" | sed -n 's/.*"id":\([0-9]*\).*/\1/p')
  case "$line" in
    *'"initialize"'*) printf '{"jsonrpc":"2.0","id":%s,"result":{"protocolVersion":"2025-06-18","capabilities":{},"serverInfo":{"name":"w"}}}\n' "$id" ;;
    *'"tools/list"'*) printf '{"jsonrpc":"2.0","id":%s,"result":{"tools":[{"name":"weather","description":"Weather now","inputSchema":{"type":"object","properties":{"city":{"type":"string"}}}}]}}\n' "$id" ;;
    *'"tools/call"'*) printf '{"jsonrpc":"2.0","id":%s,"result":{"content":[{"type":"text","text":"Sunny, 31C"}]}}\n' "$id" ;;
  esac
done
"#;
        let server: McpServerEntry = serde_json::from_value(json!({
            "id": "custom-weather",
            "enabled": true,
            "kind": "local",
            "command": ["/bin/sh", "-c", script],
        }))
        .unwrap();

        let first = sse(&[
            json!({"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","function":{"name":"custom-weather_weather","arguments":"{\"city\":\"Bangkok\"}"}}]}}]}),
        ]);
        let second = sse(&[json!({"choices":[{"delta":{"content":"It's sunny in Bangkok."}}]})]);
        let (base, seen) = mock_server(vec![first, second]).await;
        let events = std::sync::Arc::new(Mutex::new(Vec::<String>::new()));
        let sink = events.clone();
        let channel: Channel<ChatStreamEvent> = Channel::new(move |body| {
            if let tauri::ipc::InvokeResponseBody::Json(text) = body {
                sink.lock().unwrap().push(text);
            }
            Ok(())
        });
        let request = AgentRequest {
            prompt: "Weather in Bangkok?".into(),
            provider: "openai".into(),
            model: "gpt-test".into(),
            api_key: Some("sk-test".into()),
            base_url: Some(base),
            session_id: None,
            mode: Some("chat".into()),
            mcp: vec![server],
            images: vec![],
            context_limit: None,
            vision: false,
            lead: false,
            team: vec![],
            recent_work: vec![],
            declined: vec![],
            tool_scope: None,
            coach: None,
            notebook: vec![],
            cwd: None,
            folders: vec![],
            instructions: None,
            effort: None,
            auto_approve: false,
            sandbox: true,
            run_id: "test-run-mcp".into(),
        };
        generate(request, channel).await.unwrap();
        let events = events.lock().unwrap().join("\n");
        assert!(events.contains("custom-weather_weather"), "{events}");
        assert!(events.contains("It's sunny in Bangkok."), "{events}");
        assert!(!events.contains("\"event\":\"error\""), "{events}");

        let seen = seen.lock().unwrap();
        let first: serde_json::Value = serde_json::from_str(&seen[0]).unwrap();
        let names: Vec<_> = first["tools"].as_array().unwrap().iter().map(|t| t["function"]["name"].as_str().unwrap().to_string()).collect();
        // Chat: the connector's tool (and asking the user) — no file or shell tools.
        assert_eq!(names, ["ask_user", "custom-weather_weather"]);
        let second: serde_json::Value = serde_json::from_str(&seen[1]).unwrap();
        let msgs = second["messages"].as_array().unwrap();
        assert_eq!(msgs.last().unwrap()["content"], "Sunny, 31C");
        mcp_hub::disconnect("custom-weather").await;
    }

    /// A conversation past its window: what came before the prompt is
    /// summarised by the model, then the run goes on with the summary.
    #[tokio::test]
    async fn compacts_a_long_conversation_before_answering() {
        use serde_json::json;
        let dir = std::env::temp_dir().join(format!("mali-compact-{}", uuid::Uuid::new_v4().simple()));
        std::fs::create_dir_all(&dir).unwrap();
        let mut old = Session::load_or_new(None);
        for i in 0..6 {
            old.messages.push(Msg::User { text: format!("question {i} {}", "x".repeat(4_000)), images: vec![] });
            old.messages.push(Msg::Assistant { text: format!("answer {i}"), tool_calls: vec![] });
        }
        old.save().unwrap();

        let summary = sse(&[json!({"choices":[{"delta":{"content":"- six questions answered"}}]})]);
        let reply = sse(&[json!({"choices":[{"delta":{"content":"Carrying on."}}]})]);
        let (base, seen) = mock_server(vec![summary, reply]).await;
        let events = std::sync::Arc::new(Mutex::new(Vec::<String>::new()));
        let sink = events.clone();
        let channel: Channel<ChatStreamEvent> = Channel::new(move |body| {
            if let tauri::ipc::InvokeResponseBody::Json(text) = body {
                sink.lock().unwrap().push(text);
            }
            Ok(())
        });
        let request = AgentRequest {
            prompt: "and now?".into(),
            provider: "openai".into(),
            model: "gpt-test".into(),
            api_key: Some("sk-test".into()),
            base_url: Some(base),
            session_id: Some(old.id.clone()),
            mode: None,
            mcp: vec![],
            images: vec![],
            context_limit: Some(6_000),
            vision: false,
            lead: false,
            team: vec![],
            recent_work: vec![],
            declined: vec![],
            tool_scope: None,
            coach: None,
            notebook: vec![],
            cwd: Some(dir.to_string_lossy().into()),
            folders: vec![],
            instructions: None,
            effort: None,
            auto_approve: false,
            sandbox: true,
            run_id: "test-run-compact".into(),
        };
        generate(request, channel).await.unwrap();
        let events = events.lock().unwrap().join("\n");
        assert!(events.contains("Summarise: earlier conversation"), "{events}");
        assert!(events.contains("Carrying on."), "{events}");

        let seen = seen.lock().unwrap();
        let summarise: serde_json::Value = serde_json::from_str(&seen[0]).unwrap();
        assert!(summarise["messages"][1]["content"].as_str().unwrap().contains("question 0"));
        assert!(summarise.get("tools").is_none(), "the summary call offers no tools");
        let answer: serde_json::Value = serde_json::from_str(&seen[1]).unwrap();
        let msgs = answer["messages"].as_array().unwrap();
        assert!(msgs[1]["content"].as_str().unwrap().contains("- six questions answered"));
        assert_eq!(msgs.last().unwrap()["content"], "and now?");
        assert_eq!(msgs.len(), 4, "system, summary, ack, prompt");
        let saved = Session::load_or_new(Some(&old.id));
        assert_eq!(saved.messages.len(), 4, "summary, ack, prompt, reply");
        let _ = std::fs::remove_dir_all(dir);
    }

    fn quiet_request(base: String, dir: &std::path::Path, run: &str) -> AgentRequest {
        AgentRequest {
            prompt: "upload it to Canva".into(),
            provider: "openai".into(),
            model: "gpt-test".into(),
            api_key: Some("sk-test".into()),
            base_url: Some(base),
            session_id: None,
            mode: None,
            mcp: vec![],
            images: vec![],
            context_limit: None,
            vision: false,
            lead: false,
            team: vec![],
            recent_work: vec![],
            declined: vec![],
            tool_scope: None,
            coach: None,
            notebook: vec![],
            cwd: Some(dir.to_string_lossy().into()),
            folders: vec![],
            instructions: None,
            effort: None,
            auto_approve: false,
            sandbox: true,
            run_id: run.into(),
        }
    }

    fn collect() -> (Channel<ChatStreamEvent>, std::sync::Arc<Mutex<Vec<String>>>) {
        let events = std::sync::Arc::new(Mutex::new(Vec::<String>::new()));
        let sink = events.clone();
        let channel = Channel::new(move |body| {
            if let tauri::ipc::InvokeResponseBody::Json(text) = body {
                sink.lock().unwrap().push(text);
            }
            Ok(())
        });
        (channel, events)
    }

    /// A model that stops with nothing to say is nudged to carry on, and does.
    #[tokio::test]
    async fn a_silent_stop_is_nudged_to_carry_on() {
        use serde_json::json;
        let dir = std::env::temp_dir().join(format!("mali-nudge-{}", uuid::Uuid::new_v4().simple()));
        std::fs::create_dir_all(&dir).unwrap();
        let empty = sse(&[json!({"choices":[{"delta":{}}]})]);
        let done = sse(&[json!({"choices":[{"delta":{"content":"Uploaded both pictures."}}]})]);
        let (base, seen) = mock_server(vec![empty, done]).await;
        let (channel, events) = collect();
        generate(quiet_request(base, &dir, "test-nudge"), channel).await.unwrap();
        let events = events.lock().unwrap().join("\n");
        assert!(events.contains("Uploaded both pictures."), "{events}");
        assert!(!events.contains("stopped without finishing"), "{events}");
        let second: serde_json::Value = serde_json::from_str(&seen.lock().unwrap()[1]).unwrap();
        let last = second["messages"].as_array().unwrap().last().unwrap().clone();
        assert!(last["content"].as_str().unwrap().contains("Note from the Mali app"));
        let _ = std::fs::remove_dir_all(dir);
    }

    /// Still nothing after the nudges: the user is told, not left with a blank reply.
    #[tokio::test]
    async fn a_model_that_keeps_stopping_is_reported() {
        use serde_json::json;
        let dir = std::env::temp_dir().join(format!("mali-nudge2-{}", uuid::Uuid::new_v4().simple()));
        std::fs::create_dir_all(&dir).unwrap();
        let empty = || sse(&[json!({"choices":[{"delta":{}}]})]);
        let (base, seen) = mock_server(vec![empty(), empty(), empty()]).await;
        let (channel, events) = collect();
        generate(quiet_request(base, &dir, "test-nudge2"), channel).await.unwrap();
        let events = events.lock().unwrap().join("\n");
        assert!(events.contains("stopped without finishing"), "{events}");
        assert_eq!(seen.lock().unwrap().len(), 1 + MAX_NUDGES);
        let _ = std::fs::remove_dir_all(dir);
    }

    fn teammate(base: &str, id: &str, approved: bool) -> team::Teammate {
        serde_json::from_value(serde_json::json!({
            "id": id, "name": id.to_uppercase(), "role": "design in Canva",
            "provider": "openai", "model": "mate-model", "apiKey": "sk-mate", "baseUrl": base,
            "tools": "read", "approved": approved
        }))
        .unwrap()
    }

    fn delegate_call(id: &str) -> String {
        use serde_json::json;
        let args = json!({"teammate": id, "task": "Make a coffee post", "context": "Brand colours: brown"}).to_string();
        sse(&[json!({"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_team","function":{"name":"delegate_task","arguments":args}}]}}]})])
    }

    /// The lead hands a job to a teammate, which runs on its own model and
    /// tools, and the lead gets its report back.
    #[tokio::test]
    async fn the_lead_hands_a_job_to_a_teammate() {
        use serde_json::json;
        let dir = std::env::temp_dir().join(format!("mali-team-{}", uuid::Uuid::new_v4().simple()));
        std::fs::create_dir_all(&dir).unwrap();
        let report = sse(&[json!({"choices":[{"delta":{"content":"Designed it: https://canva.example/d/1"}}]})]);
        let done = sse(&[json!({"choices":[{"delta":{"content":"Momo made the post."}}]})]);
        let (base, seen) = mock_server(vec![delegate_call("momo"), report, done]).await;
        let mut request = quiet_request(base.clone(), &dir, "test-team");
        request.lead = true;
        request.team = vec![teammate(&base, "momo", true)];
        let (channel, events) = collect();
        generate(request, channel).await.unwrap();

        let events = events.lock().unwrap().join("\n");
        assert!(events.contains("Momo made the post."), "{events}");
        assert!(events.contains("team:momo:call_team"), "{events}");
        assert!(events.contains("team:momo:call_team:brief") && events.contains("Brand colours: brown"), "the brief shows: {events}");
        assert!(!events.contains("\"permission\""), "an approved teammate starts without asking: {events}");
        let seen = seen.lock().unwrap();
        let lead: serde_json::Value = serde_json::from_str(&seen[0]).unwrap();
        let mate: serde_json::Value = serde_json::from_str(&seen[1]).unwrap();
        let back: serde_json::Value = serde_json::from_str(&seen[2]).unwrap();
        let tools = |body: &serde_json::Value| body["tools"].to_string();
        assert!(tools(&lead).contains("delegate_task"));
        assert_eq!(mate["model"], "mate-model");
        assert!(!tools(&mate).contains("delegate_task"), "a teammate never hands work on");
        assert!(!tools(&mate).contains("write_file") && tools(&mate).contains("read_file"), "read scope");
        assert!(mate["messages"][0]["content"].as_str().unwrap().contains("Your duty: design in Canva"));
        assert!(back.to_string().contains("Report from MOMO"), "{back}");
        let _ = std::fs::remove_dir_all(dir);
    }

    /// A teammate that isn't on the chat's team needs the user's OK; without it, it doesn't run.
    #[tokio::test]
    async fn a_teammate_off_the_team_waits_for_the_user() {
        use serde_json::json;
        let dir = std::env::temp_dir().join(format!("mali-team2-{}", uuid::Uuid::new_v4().simple()));
        std::fs::create_dir_all(&dir).unwrap();
        let done = sse(&[json!({"choices":[{"delta":{"content":"OK, I won't."}}]})]);
        let (base, seen) = mock_server(vec![delegate_call("momo"), done]).await;
        let mut request = quiet_request(base.clone(), &dir, "test-team2");
        request.lead = true;
        request.team = vec![teammate(&base, "momo", false)];
        let events = std::sync::Arc::new(Mutex::new(Vec::<String>::new()));
        let sink = events.clone();
        let channel = Channel::new(move |body| {
            if let tauri::ipc::InvokeResponseBody::Json(text) = body {
                let event: serde_json::Value = serde_json::from_str(&text).unwrap();
                if event["event"] == "permission" {
                    assert_eq!(event["data"]["permission"], "team");
                    reply_permission(event["data"]["id"].as_str().unwrap(), "reject");
                }
                sink.lock().unwrap().push(text);
            }
            Ok(())
        });
        generate(request, channel).await.unwrap();
        let events = events.lock().unwrap().join("\n");
        assert!(events.contains("OK, I won't."), "{events}");
        let seen = seen.lock().unwrap();
        assert_eq!(seen.len(), 2, "the teammate's model was never called");
        assert!(seen[1].contains("didn't allow MOMO"), "{}", seen[1]);
        let _ = std::fs::remove_dir_all(dir);
    }

    /// A lead that only knows what's missing asks the coach, a different model, to write the bot.
    #[tokio::test]
    async fn the_coach_writes_the_bot_a_weak_lead_asks_for() {
        use serde_json::json;
        let dir = std::env::temp_dir().join(format!("mali-coach-{}", uuid::Uuid::new_v4().simple()));
        std::fs::create_dir_all(&dir).unwrap();
        let args = json!({"need": "someone to write IG captions; the user asked in 4 chats"}).to_string();
        let lead_asks = sse(&[json!({"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_p","function":{"name":"propose_teammate","arguments":args}}]}}]})]);
        let bot = json!({"name": "Mikan Captions", "role": "Writes Instagram captions.", "instructions": "1. Read the brief.\n2. Write 3 options.",
            "reason": "You asked for captions in 4 chats.", "tools": "none", "connectors": []}).to_string();
        let coach_writes = sse(&[json!({"choices":[{"delta":{"content": format!("Here it is:\n```json\n{bot}\n```")}}]})]);
        let done = sse(&[json!({"choices":[{"delta":{"content":"I proposed a caption bot."}}]})]);
        let (base, seen) = mock_server(vec![lead_asks, coach_writes, done]).await;
        let mut request = quiet_request(base.clone(), &dir, "test-coach");
        request.lead = true;
        request.coach = Some(serde_json::from_value(json!({"provider": "openai", "model": "coach-model", "apiKey": "sk-c", "baseUrl": base})).unwrap());
        let (channel, events) = collect();
        generate(request, channel).await.unwrap();

        let events = events.lock().unwrap().join("\n");
        assert!(events.contains("teammateProposal") && events.contains("Mikan Captions"), "{events}");
        assert!(events.contains("2. Write 3 options"), "the coach's instructions reach the card: {events}");
        let seen = seen.lock().unwrap();
        let coach: serde_json::Value = serde_json::from_str(&seen[1]).unwrap();
        assert_eq!(coach["model"], "coach-model");
        assert!(seen[1].contains("someone to write IG captions"));
        assert!(seen[2].contains("written by the coach"), "{}", seen[2]);
        let _ = std::fs::remove_dir_all(dir);
    }

    /// The notebook: patterns with the chats behind them, and what the user removed stays out.
    #[tokio::test]
    async fn the_notebook_learns_what_the_user_keeps_doing() {
        use serde_json::json;
        let reply = json!([{"pattern": "Coffee promo posts", "evidence": ["IG coffee", "TikTok coffee"], "count": 2}]).to_string();
        let (base, seen) = mock_server(vec![sse(&[json!({"choices":[{"delta":{"content": reply}}]})])]).await;
        let model: coach::CoachModel = serde_json::from_value(json!({"provider": "openai", "model": "m", "apiKey": "k", "baseUrl": base})).unwrap();
        let chats: Vec<coach::ChatDigest> = serde_json::from_value(json!([
            {"title": "IG coffee", "asked": "make a coffee promo"}, {"title": "TikTok coffee"}
        ]))
        .unwrap();
        let (_tx, mut cancel) = watch::channel(false);
        let mut usage = Usage::default();
        let notebook = coach::reflect(&model, &chats, &[], &["Taxes".into()], &mut usage, &mut cancel).await.unwrap();
        assert_eq!(notebook[0].pattern, "Coffee promo posts");
        assert_eq!(notebook[0].count, 2);
        let sent = seen.lock().unwrap()[0].clone();
        assert!(sent.contains("make a coffee promo") && sent.contains("leave them out: Taxes"), "{sent}");
    }

    /// Enough of a pattern in the notebook: the coach writes a bot, unless one already does the work.
    #[tokio::test]
    async fn the_notebook_turns_into_a_bot_when_there_is_enough_of_it() {
        use serde_json::json;
        let bot = json!({"name": "Fah Facebook", "role": "Writes Facebook posts.", "instructions": "1. Read the brief.",
            "reason": "You wrote Facebook posts in 4 chats.", "tools": "none", "connectors": []}).to_string();
        let covered = json!({"covered": "Momo Designer"}).to_string();
        let (base, seen) = mock_server(vec![
            sse(&[json!({"choices":[{"delta":{"content": bot}}]})]),
            sse(&[json!({"choices":[{"delta":{"content": covered}}]})]),
        ])
        .await;
        let model: coach::CoachModel = serde_json::from_value(json!({"provider": "openai", "model": "m", "apiKey": "k", "baseUrl": base})).unwrap();
        let (_tx, mut cancel) = watch::channel(false);
        let mut usage = Usage::default();
        let facebook = coach::Insight { pattern: "Facebook posts".into(), evidence: vec!["FB 1".into()], count: 4 };
        let canva = coach::Insight { pattern: "Canva designs".into(), evidence: vec![], count: 3 };
        let team: Vec<team::Teammate> = vec![serde_json::from_value(json!({"id": "momo", "name": "Momo Designer", "role": "Designs in Canva"})).unwrap()];
        let first = coach::suggest_for(&model, &facebook, &team, &["custom-canva — Canva MCP".into()], &mut usage, &mut cancel).await.unwrap();
        assert_eq!(first.unwrap().name, "Fah Facebook");
        let second = coach::suggest_for(&model, &canva, &team, &[], &mut usage, &mut cancel).await.unwrap();
        assert!(second.is_none(), "Momo already covers Canva");
        let sent = seen.lock().unwrap()[0].clone();
        assert!(sent.contains("Facebook posts (4 chats") && sent.contains("Momo Designer: Designs in Canva") && sent.contains("custom-canva — Canva MCP"), "{sent}");
    }

    #[test]
    fn anthropic_speaks_its_own_wire() {
        assert_eq!(wire_for("anthropic"), Wire::Anthropic);
        assert_eq!(wire_for("google"), Wire::OpenAi);
    }
}
