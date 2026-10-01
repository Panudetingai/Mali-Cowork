//! A Mali team: a lead that hands work to teammates the user made. Every
//! teammate runs on this same agent loop with a model, instructions,
//! connectors and tools of its own, so no provider needs a loop of its own.
//!
//! Duties never overlap. A connector belongs to one teammate only; the lead
//! doesn't get the teammates' connectors, so their work has to go to them;
//! and each teammate is told what the others are there for and leaves it to
//! them. A teammate can't hand work on: only the lead delegates.
//!
//! A teammate on a CLI agent (Codex, Cursor, Antigravity, OpenCode) runs
//! through that agent's own command instead, and reports back the same way.

use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
use std::future::Future;
use std::pin::Pin;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use serde::de::DeserializeOwned;
use serde::Deserialize;
use serde_json::{json, Map, Value};
use tauri::ipc::{Channel, InvokeResponseBody};
use tokio::sync::watch;

use super::coach;
use super::permissions::{self, Ask, Reply};
use super::tools::{self, Outcome};
use super::wire::{ToolCall, ToolSpec, Usage};
use super::AgentRequest;
use crate::chat_stream::{ChatStreamEvent, TeammateProposal};
use crate::commands::mcp::McpServerEntry;

pub const DELEGATE: &str = "delegate_task";
pub const PROPOSE: &str = "propose_teammate";
pub const COACH: &str = "coach_teammate";
/// Hand-offs one prompt may make; past it the lead finishes with what it has.
pub const MAX_DELEGATIONS: usize = 8;
/// A teammate's report as the lead gets it, in characters.
const MAX_REPORT: usize = 20_000;
/// How much new report text updates the lead's step while a teammate works.
const PROGRESS_EVERY: usize = 240;
/// A hand-off's steps carry ids `team:<teammate>:<call>` (its report),
/// `…:brief` (the lead's brief) and `…:step:<step>` (what the teammate ran),
/// so the app shows them as the team's conversation.
pub const STEP_PREFIX: &str = "team:";


/// One teammate, as the app sends it: everything its own run needs.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Teammate {
    pub id: String,
    pub name: String,
    /// Its duty, in the user's words; the lead routes work by it.
    pub role: String,
    /// Its role instructions, skills and connector notes, ready to use.
    #[serde(default)]
    pub instructions: Option<String>,
    /// For a teammate on Mali's own agent; empty on a CLI agent.
    #[serde(default)]
    pub provider: String,
    #[serde(default)]
    pub model: String,
    pub api_key: Option<String>,
    pub base_url: Option<String>,
    #[serde(default)]
    pub effort: Option<String>,
    #[serde(default)]
    pub vision: bool,
    #[serde(default)]
    pub context_limit: Option<u64>,
    /// `none` (connectors only), `read`, `files` or `all` (files and commands).
    #[serde(default)]
    pub tools: String,
    /// Its connectors; nobody else on the team gets them.
    #[serde(default)]
    pub mcp: Vec<McpServerEntry>,
    /// Names of the skills it has, for the lead's roster.
    #[serde(default)]
    pub skills: Vec<String>,
    /// On this chat's team: the lead calls it without asking the user.
    #[serde(default)]
    pub approved: bool,
    /// Runs on a CLI agent rather than Mali's own loop.
    #[serde(default)]
    pub cli: Option<CliAgent>,
}

/// A teammate's CLI agent, and its request as the app sends that agent.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CliAgent {
    /// `codex`, `cursor`, `antigravity` or `opencode`.
    pub kind: String,
    /// Everything but the prompt, session, run id and folders, which the hand-off fills in.
    #[serde(default)]
    pub request: Value,
}

/// Which of the file and command tools a teammate gets.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ToolScope {
    /// Connectors only; no folder.
    Connectors,
    Read,
    Files,
    All,
}

const READ_TOOLS: &[&str] = &["read_file", "list_dir", "glob", "grep", "todo_write", "list_templates", "read_document"];
const WRITE_TOOLS: &[&str] = &["write_file", "edit_file", "fill_template", "save_template", "make_template"];

impl ToolScope {
    pub fn parse(value: &str) -> Self {
        match value {
            "none" => Self::Connectors,
            "files" => Self::Files,
            "all" => Self::All,
            _ => Self::Read,
        }
    }

    /// Whether one of the file and command tools is in this scope.
    pub fn allows(self, tool: &str) -> bool {
        match self {
            Self::Connectors => false,
            Self::Read => READ_TOOLS.contains(&tool),
            Self::Files => READ_TOOLS.contains(&tool) || WRITE_TOOLS.contains(&tool),
            Self::All => true,
        }
    }

    fn describe(self) -> &'static str {
        match self {
            Self::Connectors => "connectors only",
            Self::Read => "reads files",
            Self::Files => "reads and changes files",
            Self::All => "files and commands",
        }
    }
}

/// One owner per connector: a connector already listed by an earlier teammate
/// is dropped from the later ones, so two teammates never do the same work.
pub fn settle(team: &mut [Teammate]) {
    let mut taken = HashSet::new();
    for mate in team.iter_mut() {
        mate.mcp.retain(|server| taken.insert(server.id.clone()));
    }
}

/// Connectors the teammates own, which the lead doesn't get.
pub fn owned_connectors(team: &[Teammate]) -> HashSet<String> {
    team.iter().flat_map(|m| m.mcp.iter().map(|s| s.id.clone())).collect()
}

/// The lead's team tools: hand a job over, propose a teammate, and (with a coach) coach one.
pub fn specs(lead: &AgentRequest) -> Vec<ToolSpec> {
    let team = &lead.team;
    let coached = lead.coach.is_some();
    let mut specs = Vec::new();
    if !team.is_empty() {
        let ids: Vec<&str> = team.iter().map(|m| m.id.as_str()).collect();
        specs.push(ToolSpec {
            name: DELEGATE.into(),
            description: "Hand one job to the teammate whose duty it is and wait for its report. The teammate \
can't see this chat: put everything it needs in `task` and `context` — what the user wants, links, ids, file \
paths, and what other teammates already found."
                .into(),
            schema: json!({
                "type": "object",
                "properties": {
                    "teammate": { "type": "string", "enum": ids, "description": "The teammate's id, from the team list." },
                    "task": { "type": "string", "description": "The job, within that teammate's duty." },
                    "context": { "type": "string", "description": "Everything it needs to do the job without seeing the chat." },
                    "expected_output": { "type": "string", "description": "What to send back: a link, a file, a list, a summary." }
                },
                "required": ["teammate", "task"]
            }),
        });
    }
    specs.push(ToolSpec {
        name: PROPOSE.into(),
        description: if coached {
            "Propose a new teammate to the user, with one duty no teammate has. It joins only if the user takes it \
on. Just say what's needed in `need`: the coach, a stronger model, writes the bot for you."
        } else {
            "Propose a new teammate to the user, with one duty no teammate has. It joins only if the user takes it on."
        }
        .into(),
        schema: json!({
            "type": "object",
            "properties": {
                "need": { "type": "string", "description": "What the team is missing and why, in a sentence or two, e.g. \"someone to write Instagram captions — the user asked for them in 4 chats this week\"." },
                "name": { "type": "string", "description": "A short friendly name with its job, e.g. \"News Digest\"." },
                "role": { "type": "string", "description": "Its duty in one sentence, not overlapping any teammate's." },
                "instructions": { "type": "string", "description": "How it should do the work: steps, style, what to hand back." },
                "reason": { "type": "string", "description": "Why the team needs it, in the user's language: the gap, or the work the user keeps asking for." },
                "tools": { "type": "string", "enum": ["none", "read", "files", "all"], "description": "The least it needs: none = connectors only, read = read files, files = change files, all = also run commands." },
                "connectors": { "type": "array", "items": { "type": "string" }, "description": "Connector ids it would own (the part of a tool name before `_`). Leave out connectors a teammate already owns." }
            },
            "required": if coached { json!(["need"]) } else { json!(["name", "role", "reason"]) }
        }),
    });
    if coached && !team.is_empty() {
        let ids: Vec<&str> = team.iter().map(|m| m.id.as_str()).collect();
        specs.push(ToolSpec {
            name: COACH.into(),
            description: "Ask the coach, a stronger model, to rewrite how a teammate works after it did a job badly \
or got stuck. The user sees the new instructions and decides."
                .into(),
            schema: json!({
                "type": "object",
                "properties": {
                    "teammate": { "type": "string", "enum": ids, "description": "The teammate's id." },
                    "what_went_wrong": { "type": "string", "description": "What it did, what it should have done, and the job it was on." }
                },
                "required": ["teammate", "what_went_wrong"]
            }),
        });
    }
    specs
}

/// The lead's part of the system prompt: the team, its rules, and what the user works on.
pub fn lead_note(lead: &AgentRequest) -> String {
    let (team, recent_work, declined) = (&lead.team, &lead.recent_work, &lead.declined);
    let mut note = String::from(
        "\n\n# Your team\nYou are the lead of the user's Mali team: you plan the work, hand each job to the \
teammate whose duty it is with delegate_task, check what comes back, and report to the user.",
    );
    if team.is_empty() {
        note.push_str("\nThere are no teammates yet.");
    } else {
        note.push_str("\nTeammates:");
        for mate in team {
            note.push_str(&format!("\n- `{}` {} — duty: {}", mate.id, mate.name, mate.role.trim()));
            let connectors: Vec<&str> = mate.mcp.iter().map(|s| s.id.as_str()).collect();
            if !connectors.is_empty() {
                note.push_str(&format!("; owns connectors: {}", connectors.join(", ")));
            }
            if !mate.skills.is_empty() {
                note.push_str(&format!("; skills: {}", mate.skills.join(", ")));
            }
            note.push_str(&format!("; {}", ToolScope::parse(&mate.tools).describe()));
            if let Some(cli) = &mate.cli {
                note.push_str(&format!("; runs on the {} CLI", cli.kind));
            }
            if !mate.approved {
                note.push_str(" (not on this chat's team: the user is asked before it starts)");
            }
        }
        note.push_str(
            "\nRules:
- One duty, one teammate. Give a job only to the teammate whose duty covers it. Never give the same job to two \
teammates, and never ask a teammate for work outside its duty (don't ask a researcher to design, or a designer \
to research).
- The teammates' connectors are theirs alone. You don't have them, so work that needs them goes to their owner.
- Split a request into jobs and run them in order, passing each teammate what the earlier ones found. Small \
things no teammate's duty covers, do yourself with your own tools.
- When a teammate reports a problem, decide the next step: give it what it was missing, pass the part it \
couldn't do to the teammate whose duty it is, or ask the user with ask_user. Don't send the same job back \
unchanged more than once.
- When the work is done, tell the user what each teammate did and where the results are, in the user's language.",
        );
    }
    let notebook: Vec<&str> = lead.notebook.iter().map(|t| t.trim()).filter(|t| !t.is_empty()).collect();
    if !notebook.is_empty() {
        note.push_str("\n\n# Your notebook: what the user keeps doing\nLearned from their chats; cite it when you propose a teammate:");
        for line in notebook {
            note.push_str(&format!("\n- {line}"));
        }
    }
    let recent: Vec<&str> = recent_work.iter().map(|t| t.trim()).filter(|t| !t.is_empty()).take(30).collect();
    if !recent.is_empty() {
        note.push_str("\n\n# What the user has been working on\nTheir recent chats, newest first:");
        for title in recent {
            note.push_str(&format!("\n- {title}"));
        }
    }
    note.push_str(
        "\n\n# Growing the team\nWhen a job needs a duty no teammate has and you can't do it well yourself, or \
the user keeps asking for a kind of work no teammate owns, propose a teammate with propose_teammate: one clear \
duty that doesn't overlap anyone's, and why. Propose at most one per request; it joins only if the user takes \
it on, so carry on with the work meanwhile.",
    );
    if lead.coach.is_some() {
        note.push_str(
            "\nYou have a coach, a stronger model: when you're not sure how a new bot should work, give \
propose_teammate just the `need`; when a teammate did a job badly, call coach_teammate with what went wrong.",
        );
    }
    let declined: Vec<&str> = declined.iter().map(|d| d.trim()).filter(|d| !d.is_empty()).collect();
    if !declined.is_empty() {
        note.push_str(&format!("\nThe user turned these down; don't propose them again: {}.", declined.join(", ")));
    }
    note
}

/// A teammate's part of its system prompt: its duty, and the others' to leave alone.
fn member_note(me: &Teammate, team: &[Teammate]) -> String {
    let mut note = format!(
        "\n\n# Your place on the team\nYou are {name}, a teammate on the user's Mali team. The lead hands you one \
job at a time, and you report back to the lead.\nYour duty: {role}",
        name = me.name,
        role = me.role.trim(),
    );
    let others: Vec<&Teammate> = team.iter().filter(|m| m.id != me.id).collect();
    if !others.is_empty() {
        note.push_str("\nThe rest of the team — their work is theirs; never do it yourself, even if you could:");
        for mate in others {
            note.push_str(&format!("\n- {}: {}", mate.name, mate.role.trim()));
        }
    }
    note.push_str(
        "\nIf the job needs something outside your duty, do your part only and say in your report what is left \
and for whom. Don't ask the user things the lead gave you; ask with ask_user only when you're truly stuck.
End with a short report for the lead: what you did, the results (links, ids and file paths exactly as the tools \
gave them), and any problem or open question.",
    );
    note
}

/// A teammate's own instructions and its place on the team.
fn own_instructions(mate: &Teammate, team: &[Teammate]) -> String {
    let own = mate.instructions.as_deref().map(str::trim).unwrap_or_default();
    format!("{own}{}", member_note(mate, team)).trim().to_string()
}

/// The run a teammate does for one job.
fn child_request(lead: &AgentRequest, mate: &Teammate, prompt: String, session_id: Option<String>) -> AgentRequest {
    let scope = ToolScope::parse(&mate.tools);
    let cowork = lead.cowork() && scope != ToolScope::Connectors;
    AgentRequest {
        prompt,
        provider: mate.provider.clone(),
        model: mate.model.clone(),
        api_key: mate.api_key.clone(),
        base_url: mate.base_url.clone(),
        session_id,
        mode: Some(if cowork { "cowork" } else { "chat" }.into()),
        cwd: if cowork { lead.cwd.clone() } else { None },
        folders: if cowork { lead.folders.clone() } else { Vec::new() },
        instructions: Some(own_instructions(mate, &lead.team)),
        effort: mate.effort.clone(),
        auto_approve: lead.auto_approve,
        sandbox: lead.sandbox,
        run_id: child_run_id(lead, mate),
        mcp: mate.mcp.clone(),
        images: Vec::new(),
        context_limit: mate.context_limit,
        vision: mate.vision,
        lead: false,
        team: Vec::new(),
        recent_work: Vec::new(),
        declined: Vec::new(),
        tool_scope: Some(scope),
        coach: None,
        notebook: Vec::new(),
    }
}

fn child_run_id(lead: &AgentRequest, mate: &Teammate) -> String {
    format!("{}:{}", lead.run_id, mate.id)
}

/// The request a CLI teammate's agent gets for one job.
fn cli_request(lead: &AgentRequest, mate: &Teammate, cli: &CliAgent, prompt: &str, session_id: Option<String>) -> Value {
    let scope = ToolScope::parse(&mate.tools);
    let cowork = lead.cowork() && scope != ToolScope::Connectors;
    // A teammate that only reads gets the folders read-only, which each CLI respects.
    let folders: Vec<Value> = if cowork {
        lead.folders
            .iter()
            .map(|f| json!({ "path": f.path, "access": if scope == ToolScope::Read { "read" } else { f.access.as_str() } }))
            .collect()
    } else {
        Vec::new()
    };
    let own = own_instructions(mate, &lead.team);
    let opencode = cli.kind == "opencode";
    // CLIs have no system prompt: the instructions open its session instead (OpenCode takes them apart).
    let prompt = if opencode || session_id.is_some() {
        prompt.to_string()
    } else {
        format!("<instructions>\n{own}\n</instructions>\n\n{prompt}")
    };
    let mut body = match &cli.request {
        Value::Object(map) => map.clone(),
        _ => Map::new(),
    };
    body.insert("prompt".into(), prompt.into());
    body.insert("sessionId".into(), session_id.into());
    body.insert("mode".into(), if cowork { "cowork" } else { "chat" }.into());
    body.insert("cwd".into(), if cowork { lead.cwd.clone().into() } else { Value::Null });
    body.insert("folders".into(), folders.into());
    body.insert("runId".into(), child_run_id(lead, mate).into());
    if opencode {
        body.insert("instructions".into(), own.into());
        body.insert("autoApprove".into(), (cowork && lead.auto_approve).into());
    }
    Value::Object(body)
}

/// A one-off question to a CLI agent, in Chat mode (no folder, nothing changed): the coach's.
pub(crate) fn ask_cli_body(cli: &CliAgent, prompt: &str, run_id: &str) -> Value {
    let mut body = match &cli.request {
        Value::Object(map) => map.clone(),
        _ => Map::new(),
    };
    body.insert("prompt".into(), prompt.into());
    body.insert("sessionId".into(), Value::Null);
    body.insert("mode".into(), "chat".into());
    body.insert("cwd".into(), Value::Null);
    body.insert("folders".into(), json!([]));
    body.insert("runId".into(), run_id.into());
    if cli.kind == "opencode" {
        body.insert("autoApprove".into(), false.into());
    }
    Value::Object(body)
}

/// Ask a CLI agent one question and return its answer.
pub(crate) async fn ask_cli(cli: &CliAgent, prompt: &str, cancel: &mut watch::Receiver<bool>) -> Result<String, String> {
    let run_id = format!("coach_{}", &uuid::Uuid::new_v4().simple().to_string()[..12]);
    let body = ask_cli_body(cli, prompt, &run_id);
    // (answer, error, session) as the agent streams them.
    let heard = Arc::new(Mutex::new((String::new(), None::<String>, None::<String>)));
    let sink = heard.clone();
    let channel = Channel::new(move |event| {
        let InvokeResponseBody::Json(text) = event else { return Ok(()) };
        let mut heard = sink.lock().unwrap();
        match serde_json::from_str::<ChatStreamEvent>(&text) {
            Ok(ChatStreamEvent::Chunk { text }) => heard.0.push_str(&text),
            Ok(ChatStreamEvent::Error { message }) => heard.1 = Some(message),
            Ok(ChatStreamEvent::Metadata { session_id: Some(id), .. }) => heard.2 = Some(id),
            _ => {}
        }
        Ok(())
    });
    let run = run_cli(&cli.kind, body.clone(), channel);
    tokio::pin!(run);
    let finished = tokio::select! {
        result = &mut run => Some(result),
        _ = cancel.wait_for(|stopped| *stopped) => None,
    };
    let result = match finished {
        Some(result) => result,
        None => {
            let session = heard.lock().unwrap().2.clone();
            stop_cli(&cli.kind, run_id, session, &body);
            let _ = tokio::time::timeout(Duration::from_secs(5), &mut run).await;
            Err("Stopped by the user.".into())
        }
    };
    let (answer, error, _) = std::mem::take(&mut *heard.lock().unwrap());
    result?;
    if let Some(error) = error {
        return Err(error);
    }
    if answer.trim().is_empty() {
        return Err(format!("The {} CLI gave no answer.", cli.kind));
    }
    Ok(answer)
}

fn parse<T: DeserializeOwned>(body: Value) -> Result<T, String> {
    serde_json::from_value(body).map_err(|e| format!("The teammate's agent settings are off: {e}"))
}

/// Run one job on a CLI agent; its events go to `channel`.
async fn run_cli(kind: &str, body: Value, channel: Channel<ChatStreamEvent>) -> Result<(), String> {
    use crate::commands::{antigravity, codex, cursor, opencode};
    match kind {
        "codex" => codex::codex_generate(parse(body)?, channel).await,
        "cursor" => cursor::cursor_generate(parse(body)?, channel).await,
        "antigravity" => antigravity::antigravity_generate(parse(body)?, channel).await,
        "opencode" => opencode::opencode_generate(parse(body)?, channel).await,
        other => Err(format!("Mali can't run {other} as a teammate.")),
    }
}

/// Stop a CLI teammate's run.
fn stop_cli(kind: &str, run_id: String, session_id: Option<String>, body: &Value) {
    use crate::commands::{antigravity, codex, cursor, opencode};
    let _ = match kind {
        "codex" => codex::codex_abort(run_id),
        "cursor" => cursor::cursor_abort(run_id),
        "antigravity" => antigravity::antigravity_abort(run_id),
        "opencode" => {
            if let Some(session) = session_id {
                let cwd = body["cwd"].as_str().map(str::to_string);
                let mode = body["mode"].as_str().map(str::to_string);
                tauri::async_runtime::spawn(opencode::opencode_abort(session, cwd, mode));
            }
            Ok(())
        }
        _ => Ok(()),
    };
}

/// Cards an OpenCode teammate is waiting on, by id: its answer goes back to
/// OpenCode rather than to Mali's own agent. The value is the card's directory.
fn forwarded() -> &'static Mutex<HashMap<String, String>> {
    static FORWARDED: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();
    FORWARDED.get_or_init(Default::default)
}

/// Answer a permission card an OpenCode teammate raised; false when it isn't one.
pub fn reply_forwarded(id: &str, reply: &str) -> bool {
    let Some(directory) = forwarded().lock().unwrap().remove(id) else { return false };
    let request = crate::commands::opencode::PermissionReplyRequest {
        id: id.to_string(),
        directory,
        reply: reply.to_string(),
        session_id: None,
        grant: None,
    };
    tauri::async_runtime::spawn(crate::commands::opencode::opencode_permission_reply(request));
    true
}

/// Answer a question an OpenCode teammate asked; false when it isn't one.
pub fn answer_forwarded(id: &str, answers: Vec<Vec<String>>) -> bool {
    let Some(directory) = forwarded().lock().unwrap().remove(id) else { return false };
    let request = crate::commands::opencode::QuestionReplyRequest { id: id.to_string(), directory, answers };
    tauri::async_runtime::spawn(crate::commands::opencode::opencode_question_reply(request));
    true
}

/// What a teammate's run streamed that the lead needs afterwards.
#[derive(Default)]
struct Relay {
    text: String,
    shown: usize,
    usage: Usage,
    session_id: Option<String>,
    /// A CLI agent reports failure as an event rather than a result.
    error: Option<String>,
}

/// The id of the lead's step for a hand-off, which becomes the teammate's report.
pub fn step_id(teammate: &str, call: &str) -> String {
    format!("{STEP_PREFIX}{teammate}:{call}")
}

/// A channel for the teammate's run: its steps, permission cards and questions
/// go on to the chat, marked as its own; its reply is kept as the report.
fn relay_channel(parent: Channel<ChatStreamEvent>, relay: Arc<Mutex<Relay>>, mate: &Teammate, lead_step: String) -> Channel<ChatStreamEvent> {
    let name = mate.name.clone();
    let opencode = mate.cli.as_ref().is_some_and(|c| c.kind == "opencode");
    Channel::new(move |body| {
        let InvokeResponseBody::Json(text) = body else { return Ok(()) };
        let Ok(event) = serde_json::from_str::<ChatStreamEvent>(&text) else { return Ok(()) };
        let forward = match event {
            ChatStreamEvent::Chunk { text } => {
                let mut relay = relay.lock().unwrap();
                relay.text.push_str(&text);
                if relay.text.len() < relay.shown + PROGRESS_EVERY {
                    return Ok(());
                }
                relay.shown = relay.text.len();
                Some(ChatStreamEvent::Activity {
                    id: Some(lead_step.clone()),
                    kind: "team".into(),
                    title: format!("Team: {name}"),
                    detail: Some(tools::clip(relay.text.trim(), 4_000)),
                    done: false,
                    duration_ms: None,
                })
            }
            ChatStreamEvent::Activity { id: step, kind, title, detail, done, duration_ms } => Some(ChatStreamEvent::Activity {
                id: Some(format!("{lead_step}:step:{}", step.as_deref().unwrap_or("step"))),
                kind,
                title,
                detail,
                done,
                duration_ms,
            }),
            ChatStreamEvent::Metadata { session_id, usage, .. } => {
                let mut relay = relay.lock().unwrap();
                if session_id.is_some() {
                    relay.session_id = session_id;
                }
                if let Some(u) = usage {
                    relay.usage.add(&Usage {
                        input: u.input_tokens.unwrap_or(0),
                        output: u.output_tokens.unwrap_or(0),
                        cache_read: u.cache_read_tokens.unwrap_or(0),
                        cache_write: u.cache_write_tokens.unwrap_or(0),
                        reasoning: u.reasoning_tokens.unwrap_or(0),
                    });
                }
                None
            }
            ChatStreamEvent::Error { message } => {
                relay.lock().unwrap().error = Some(message);
                None
            }
            // Who is asking goes in front of what they ask.
            ChatStreamEvent::Permission { id: request, directory, permission, patterns, title, detail } => {
                if opencode {
                    forwarded().lock().unwrap().insert(request.clone(), directory.clone());
                }
                Some(ChatStreamEvent::Permission { id: request, directory, permission, patterns, title: format!("{name} · {title}"), detail })
            }
            ChatStreamEvent::Question { id: request, directory, questions } => {
                if opencode {
                    forwarded().lock().unwrap().insert(request.clone(), directory.clone());
                }
                Some(ChatStreamEvent::Question { id: request, directory, questions })
            }
            event @ (ChatStreamEvent::PermissionResolved { .. } | ChatStreamEvent::QuestionResolved { .. }) => Some(event),
            // Its plan, thinking and start/finish are its own business.
            _ => None,
        };
        if let Some(event) = forward {
            let _ = parent.send(event);
        }
        Ok(())
    })
}

/// A teammate's run, boxed: the lead's run is waiting on it, so the future can't be inline.
fn run_boxed<'a>(
    request: &'a AgentRequest,
    on_event: &'a Channel<ChatStreamEvent>,
    cancel: &'a mut watch::Receiver<bool>,
) -> Pin<Box<dyn Future<Output = Result<(), String>> + Send + 'a>> {
    Box::pin(super::run(request, on_event, cancel))
}

/// What a hand-off needs from the lead's run.
pub struct Handoff<'a> {
    pub lead: &'a AgentRequest,
    /// The lead's step for this call, which shows the teammate's progress.
    pub step: &'a str,
    /// "Always" answers of the chat: a teammate allowed once stays allowed.
    pub always: &'a mut BTreeSet<String>,
    /// Each teammate's session in this chat, so it remembers earlier jobs.
    pub sessions: &'a mut BTreeMap<String, String>,
    pub usage: &'a mut Usage,
    pub on_event: &'a Channel<ChatStreamEvent>,
    pub cancel: &'a mut watch::Receiver<bool>,
}

/// The teammate a call names, if it is on the team.
pub fn teammate_of<'a>(team: &'a [Teammate], args: &Value) -> Option<&'a Teammate> {
    args["teammate"].as_str().and_then(|id| team.iter().find(|m| m.id == id))
}

/// Hand one job to a teammate: ask the user if it isn't on the chat's team,
/// run it, and return its report to the lead.
pub async fn delegate(call: &ToolCall, h: Handoff<'_>) -> Outcome {
    let team = &h.lead.team;
    let Some(mate) = teammate_of(team, &call.args) else {
        let ids: Vec<&str> = team.iter().map(|m| m.id.as_str()).collect();
        return Outcome::err(format!("There's no teammate by that id. The team: {}.", ids.join(", ")));
    };
    let arg = |key: &str| call.args[key].as_str().map(str::trim).unwrap_or_default().to_string();
    let (task, context, expected) = (arg("task"), arg("context"), arg("expected_output"));
    if task.is_empty() {
        return Outcome::err("Say what the job is in `task`.");
    }

    let key = format!("team:{}", mate.id);
    if !mate.approved && !h.always.contains(&key) {
        let directory = h.lead.cwd.clone().unwrap_or_default();
        let ask = Ask {
            directory: &directory,
            permission: "team",
            pattern: mate.id.clone(),
            title: format!("Hand off to: {}", mate.name),
            detail: Some(task.clone()),
        };
        match permissions::ask(h.on_event, ask, h.cancel).await {
            Reply::Always => {
                h.always.insert(key);
            }
            Reply::Once => {}
            Reply::Reject => {
                return Outcome::err(format!(
                    "The user didn't allow {} to take this job. Don't give it to a teammate whose duty it isn't; \
ask the user how to go on.",
                    mate.name
                ))
            }
        }
    }

    let mut prompt = format!("Job from the lead: {task}");
    if !context.is_empty() {
        prompt.push_str(&format!("\n\nContext:\n{context}"));
    }
    if !expected.is_empty() {
        prompt.push_str(&format!("\n\nSend back: {expected}"));
    }
    // The lead's brief, as the team's conversation shows it.
    let _ = h.on_event.send(ChatStreamEvent::Activity {
        id: Some(format!("{}:brief", h.step)),
        kind: "team-brief".into(),
        title: format!("Brief: {}", mate.name),
        detail: Some(prompt.clone()),
        done: true,
        duration_ms: None,
    });

    let session = h.sessions.get(&mate.id).cloned();
    let relay = Arc::new(Mutex::new(Relay::default()));
    let channel = relay_channel(h.on_event.clone(), relay.clone(), mate, h.step.to_string());
    let mut cancel = h.cancel.clone();
    let result = match &mate.cli {
        None => {
            let request = child_request(h.lead, mate, prompt, session);
            run_boxed(&request, &channel, &mut cancel).await
        }
        Some(cli) => {
            let body = cli_request(h.lead, mate, cli, &prompt, session);
            let run = run_cli(&cli.kind, body.clone(), channel.clone());
            tokio::pin!(run);
            let finished = tokio::select! {
                result = &mut run => Some(result),
                _ = cancel.wait_for(|stopped| *stopped) => None,
            };
            match finished {
                Some(result) => result,
                None => {
                    let session = relay.lock().unwrap().session_id.clone();
                    stop_cli(&cli.kind, child_run_id(h.lead, mate), session, &body);
                    // Let it wind down, so the process it started is gone.
                    let _ = tokio::time::timeout(Duration::from_secs(5), &mut run).await;
                    Err("Stopped by the user.".into())
                }
            }
        }
    };

    let relay = std::mem::take(&mut *relay.lock().unwrap());
    let result = match (result, relay.error) {
        (Ok(()), Some(error)) => Err(error),
        (result, _) => result,
    };
    if let Some(session) = relay.session_id {
        h.sessions.insert(mate.id.clone(), session);
    }
    h.usage.add(&relay.usage);
    if *h.cancel.borrow() {
        return Outcome::err("Stopped by the user.");
    }
    let report = relay.text.trim();
    match result {
        Err(e) => Outcome::err(format!("{} couldn't finish the job: {e}", mate.name)),
        Ok(()) if report.is_empty() => Outcome::err(format!("{} finished without a report.", mate.name)),
        Ok(()) => Outcome::ok(format!("Report from {}:\n\n{}", mate.name, tools::clip(report, MAX_REPORT))),
    }
}

/// Put a proposed teammate in front of the user; it joins only if they take it on.
/// With a coach and a `need`, the coach writes the teammate.
pub async fn propose(
    call: &ToolCall,
    lead: &AgentRequest,
    on_event: &Channel<ChatStreamEvent>,
    usage: &mut Usage,
    cancel: &mut watch::Receiver<bool>,
) -> Outcome {
    let arg = |key: &str| call.args[key].as_str().map(str::trim).unwrap_or_default().to_string();
    let need = arg("need");
    let written = match &lead.coach {
        Some(model) if !need.is_empty() && arg("instructions").is_empty() => {
            match coach::write_teammate(model, &need, &lead.team, &lead.notebook, usage, cancel).await {
                Ok(written) => Some(written),
                Err(e) => return Outcome::err(format!("The coach couldn't write the bot: {e}")),
            }
        }
        _ => None,
    };
    let pick = |mine: String, coach: Option<&String>| {
        coach.map(|c| c.trim().to_string()).filter(|c| !c.is_empty()).unwrap_or(mine)
    };
    let name = pick(arg("name"), written.as_ref().map(|w| &w.name));
    let role = pick(arg("role"), written.as_ref().map(|w| &w.role));
    let reason = pick(if arg("reason").is_empty() { need.clone() } else { arg("reason") }, written.as_ref().map(|w| &w.reason));
    let instructions = pick(arg("instructions"), written.as_ref().map(|w| &w.instructions));
    if name.is_empty() || role.is_empty() {
        return Outcome::err("A proposal needs a `name` and a `role`.");
    }
    if lead.team.iter().any(|m| m.name.eq_ignore_ascii_case(&name)) {
        return Outcome::err(format!("{name} is on the team already; hand it the job with delegate_task."));
    }
    if lead.declined.iter().any(|d| d.eq_ignore_ascii_case(&name)) {
        return Outcome::err(format!("The user turned {name} down before; don't propose it again."));
    }
    // A connector that already has an owner stays with it.
    let owned = owned_connectors(&lead.team);
    let asked: Vec<String> = match &written {
        Some(w) if !w.connectors.is_empty() => w.connectors.clone(),
        _ => call.args["connectors"]
            .as_array()
            .map(|list| list.iter().filter_map(Value::as_str).map(str::to_string).collect())
            .unwrap_or_default(),
    };
    let connectors: Vec<String> = asked.into_iter().filter(|c| !owned.contains(c)).collect();
    let tools = match written.as_ref().map(|w| w.tools.clone()).filter(|t| !t.is_empty()).unwrap_or_else(|| arg("tools")).as_str() {
        t @ ("none" | "read" | "files" | "all") => t.to_string(),
        _ => "read".into(),
    };
    let proposal = TeammateProposal {
        id: format!("proposal_{}", uuid::Uuid::new_v4().simple()),
        name: name.clone(),
        role: role.clone(),
        instructions,
        reason,
        tools,
        connectors,
        updates: None,
    };
    let _ = on_event.send(ChatStreamEvent::TeammateProposal { proposal });
    let by = if written.is_some() { " (written by the coach)" } else { "" };
    Outcome::ok(format!(
        "Proposed {name}{by}: {role}. The user sees a card to take it on; it isn't on the team yet, so carry on without it."
    ))
}

/// Ask the coach to rewrite how a teammate works; the user sees the new way and decides.
pub async fn coach(
    call: &ToolCall,
    lead: &AgentRequest,
    on_event: &Channel<ChatStreamEvent>,
    usage: &mut Usage,
    cancel: &mut watch::Receiver<bool>,
) -> Outcome {
    let Some(model) = &lead.coach else { return Outcome::err("There's no coach set up in Settings → Team.") };
    let Some(mate) = teammate_of(&lead.team, &call.args) else {
        return Outcome::err("There's no teammate by that id.");
    };
    let feedback = call.args["what_went_wrong"].as_str().map(str::trim).unwrap_or_default();
    if feedback.is_empty() {
        return Outcome::err("Say what went wrong in `what_went_wrong`.");
    }
    let written = match coach::coach_teammate(model, mate, feedback, &lead.team, usage, cancel).await {
        Ok(written) => written,
        Err(e) => return Outcome::err(format!("The coach couldn't help: {e}")),
    };
    let proposal = TeammateProposal {
        id: format!("coaching_{}", uuid::Uuid::new_v4().simple()),
        name: mate.name.clone(),
        role: mate.role.clone(),
        instructions: written.instructions,
        reason: written.reason.clone(),
        tools: mate.tools.clone(),
        connectors: Vec::new(),
        updates: Some(mate.id.clone()),
    };
    let _ = on_event.send(ChatStreamEvent::TeammateProposal { proposal });
    Outcome::ok(format!(
        "The coach rewrote how {} works ({}). The user decides whether to take it; until then it works as before.",
        mate.name,
        written.reason.trim()
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mate(id: &str, role: &str, connectors: &[&str]) -> Teammate {
        Teammate {
            id: id.into(),
            name: id.to_uppercase(),
            role: role.into(),
            instructions: None,
            provider: "openai".into(),
            model: "m".into(),
            api_key: None,
            base_url: None,
            effort: None,
            vision: false,
            context_limit: None,
            tools: "read".into(),
            mcp: connectors
                .iter()
                .map(|c| serde_json::from_value(json!({ "id": c, "enabled": true })).unwrap())
                .collect(),
            skills: Vec::new(),
            approved: true,
            cli: None,
        }
    }

    #[test]
    fn a_connector_has_one_owner() {
        let mut team = vec![mate("momo", "design in Canva", &["canva"]), mate("sora", "research", &["canva", "notion"])];
        settle(&mut team);
        assert_eq!(team[0].mcp.len(), 1);
        assert_eq!(team[1].mcp.iter().map(|s| s.id.as_str()).collect::<Vec<_>>(), vec!["notion"]);
        assert_eq!(owned_connectors(&team).len(), 2);
    }

    #[test]
    fn scopes_hold_their_tools() {
        assert!(!ToolScope::Connectors.allows("read_file"));
        assert!(ToolScope::Read.allows("grep") && !ToolScope::Read.allows("write_file"));
        assert!(ToolScope::Files.allows("edit_file") && !ToolScope::Files.allows("bash"));
        assert!(ToolScope::All.allows("bash"));
        assert_eq!(ToolScope::parse("nonsense"), ToolScope::Read);
    }

    #[test]
    fn a_teammate_is_told_to_leave_others_duties_alone() {
        let team = vec![mate("momo", "design in Canva", &["canva"]), mate("sora", "research on the web", &[])];
        let note = member_note(&team[1], &team);
        assert!(note.contains("Your duty: research on the web"));
        assert!(note.contains("MOMO: design in Canva"));
        assert!(!note.contains("SORA: research"));
    }

    fn lead(team: Vec<Teammate>) -> AgentRequest {
        serde_json::from_value::<AgentRequest>(json!({
            "prompt": "p", "provider": "openai", "model": "m", "apiKey": null, "baseUrl": null,
            "cwd": "/work", "folders": [{ "path": "/work", "access": "write" }],
            "instructions": null, "effort": null, "runId": "chat1", "autoApprove": true
        }))
        .map(|mut r| {
            r.team = team;
            r
        })
        .unwrap()
    }

    #[test]
    fn a_cli_teammate_gets_its_job_its_rules_and_read_only_folders() {
        let mut momo = mate("momo", "design in Canva", &[]);
        momo.cli = Some(CliAgent { kind: "codex".into(), request: json!({ "model": "gpt-5-codex", "effort": null }) });
        let lead = lead(vec![momo.clone()]);
        let body = cli_request(&lead, &momo, momo.cli.as_ref().unwrap(), "Job from the lead: make a post", None);
        assert_eq!(body["model"], "gpt-5-codex");
        assert_eq!(body["runId"], "chat1:momo");
        assert_eq!(body["mode"], "cowork");
        assert_eq!(body["folders"][0]["access"], "read", "a read-only teammate can't write");
        let prompt = body["prompt"].as_str().unwrap();
        assert!(prompt.starts_with("<instructions>") && prompt.contains("Your duty: design in Canva"));
        assert!(prompt.ends_with("Job from the lead: make a post"));
        // A session already knows its rules.
        let again = cli_request(&lead, &momo, momo.cli.as_ref().unwrap(), "next job", Some("t1".into()));
        assert_eq!(again["prompt"], "next job");
        assert_eq!(again["sessionId"], "t1");
        let _: crate::commands::codex::CodexRequest = parse(body).unwrap();
    }

    #[test]
    fn an_opencode_teammate_takes_its_rules_apart() {
        let mut sora = mate("sora", "research", &[]);
        sora.tools = "all".into();
        sora.cli = Some(CliAgent { kind: "opencode".into(), request: json!({ "model": "anthropic/claude" }) });
        let lead = lead(vec![sora.clone()]);
        let body = cli_request(&lead, &sora, sora.cli.as_ref().unwrap(), "research it", None);
        assert_eq!(body["prompt"], "research it");
        assert!(body["instructions"].as_str().unwrap().contains("Your duty: research"));
        assert_eq!(body["autoApprove"], true);
        assert_eq!(body["folders"][0]["access"], "write");
        let _: crate::commands::opencode::OpencodeRequest = parse(body).unwrap();
        assert!(!reply_forwarded("nobody", "once"), "unknown cards aren't OpenCode's");
    }

    #[test]
    fn the_lead_sees_who_owns_what() {
        let mut team = vec![mate("momo", "design in Canva", &["canva"])];
        team[0].approved = false;
        let mut request = lead(team.clone());
        request.recent_work = vec!["Weekly coffee post".into()];
        request.declined = vec!["News Digest".into()];
        let note = lead_note(&request);
        assert!(note.contains("`momo` MOMO — duty: design in Canva; owns connectors: canva"));
        assert!(note.contains("user is asked before it starts"));
        assert!(note.contains("- Weekly coffee post"));
        assert!(note.contains("don't propose them again: News Digest"));
        assert_eq!(specs(&request).len(), 2);
        assert_eq!(specs(&lead(vec![])).len(), 1);
        // A coach adds coaching, and lets a proposal be just a need.
        request.coach = Some(serde_json::from_value(json!({ "provider": "openai", "model": "big" })).unwrap());
        let with_coach = specs(&request);
        assert_eq!(with_coach.iter().map(|s| s.name.as_str()).collect::<Vec<_>>(), vec![DELEGATE, PROPOSE, COACH]);
        assert_eq!(with_coach[1].schema["required"], json!(["need"]));
        assert!(lead_note(&request).contains("You have a coach"));
    }
}
