//! Mali's own agent (see `crate::agent`), for Cowork on an API key.

use tauri::ipc::Channel;

use crate::agent::{self, AgentRequest};
use crate::chat_stream::ChatStreamEvent;

#[tauri::command]
pub async fn agent_generate(request: AgentRequest, on_event: Channel<ChatStreamEvent>) -> Result<(), String> {
    agent::generate(request, on_event).await
}

/// Answer a permission card: `once`, `always` or `reject`.
#[tauri::command]
pub fn agent_reply_permission(id: String, reply: String) -> bool {
    agent::reply_permission(&id, &reply)
}

/// Answer a question the agent asked; empty answers withdraw it.
#[tauri::command]
pub fn agent_answer_question(id: String, answers: Vec<Vec<String>>) -> bool {
    agent::answer_question(&id, answers)
}

/// Team mode with a CLI lead: offer it the team through the `mali` gateway
/// for this run; the team's steps stream on `on_event` into the chat.
#[tauri::command]
pub fn team_lead_begin(request: AgentRequest, on_event: Channel<ChatStreamEvent>) {
    agent::team_gateway::begin(request, on_event);
}

/// The CLI lead's run ended: stop offering the team, and stop a hand-off in flight.
#[tauri::command]
pub fn team_lead_end(run_id: String) {
    agent::team_gateway::end(&run_id);
}

/// What `team_reflect` learns from.
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReflectRequest {
    pub model: agent::coach::CoachModel,
    pub chats: Vec<agent::coach::ChatDigest>,
    #[serde(default)]
    pub notebook: Vec<agent::coach::Insight>,
    /// Patterns the user removed, which stay out.
    #[serde(default)]
    pub forgotten: Vec<String>,
}

/// Bring the lead's notebook up to date with the user's latest chats.
#[tauri::command]
pub async fn team_reflect(request: ReflectRequest) -> Result<Vec<agent::coach::Insight>, String> {
    let (_stop, mut cancel) = tokio::sync::watch::channel(false);
    let mut usage = Default::default();
    agent::coach::reflect(&request.model, &request.chats, &request.notebook, &request.forgotten, &mut usage, &mut cancel).await
}

/// What `team_suggest` works from.
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SuggestRequest {
    pub model: agent::coach::CoachModel,
    /// Patterns the notebook has enough of, not suggested before.
    pub patterns: Vec<agent::coach::Insight>,
    #[serde(default)]
    pub team: Vec<agent::team::Teammate>,
    /// The user's connectors, `id — name`.
    #[serde(default)]
    pub connectors: Vec<String>,
    /// Names the user turned down.
    #[serde(default)]
    pub declined: Vec<String>,
}

/// Bots for what the user keeps doing, written by the coach for the user to take on.
/// Each pattern comes back as `(pattern, proposal)`; no proposal when a bot already covers it.
#[tauri::command]
pub async fn team_suggest(request: SuggestRequest) -> Result<Vec<(String, Option<crate::chat_stream::TeammateProposal>)>, String> {
    let (_stop, mut cancel) = tokio::sync::watch::channel(false);
    let mut usage = Default::default();
    let owned = agent::team::owned_connectors(&request.team);
    let known: Vec<&str> = request.connectors.iter().filter_map(|c| c.split(" — ").next()).collect();
    let mut out = Vec::new();
    for insight in request.patterns.iter().filter(|i| i.count >= agent::coach::READY_AT).take(2) {
        let written = agent::coach::suggest_for(&request.model, insight, &request.team, &request.connectors, &mut usage, &mut cancel).await?;
        let proposal = written
            .filter(|w| !request.declined.iter().any(|d| d.eq_ignore_ascii_case(w.name.trim())))
            .filter(|w| !request.team.iter().any(|m| m.name.eq_ignore_ascii_case(w.name.trim())))
            .map(|w| crate::chat_stream::TeammateProposal {
                id: format!("proposal_{}", uuid::Uuid::new_v4().simple()),
                name: w.name.trim().to_string(),
                role: w.role.trim().to_string(),
                instructions: w.instructions.trim().to_string(),
                reason: w.reason.trim().to_string(),
                tools: match w.tools.as_str() {
                    t @ ("none" | "read" | "files" | "all") => t.to_string(),
                    _ => "read".into(),
                },
                // Only connectors the user has, and no bot owns yet.
                connectors: w.connectors.into_iter().filter(|c| known.contains(&c.as_str()) && !owned.contains(c)).collect(),
                updates: None,
            });
        out.push((insight.pattern.clone(), proposal));
    }
    Ok(out)
}

/// Stop the run of a chat.
#[tauri::command]
pub fn agent_abort(run_id: String) -> bool {
    agent::abort(&run_id)
}
