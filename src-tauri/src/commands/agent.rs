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
                skills: Vec::new(),
                install_connectors: Vec::new(),
                find_connectors: Vec::new(),
                install_skills: Vec::new(),
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

/// What `team_write_bot` works from: the user's own words for a bot.
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteBotRequest {
    pub model: agent::coach::CoachModel,
    /// What the user wants the bot to do, in their words.
    pub need: String,
    #[serde(default)]
    pub team: Vec<agent::team::Teammate>,
    /// The user's connectors, `id — name`.
    #[serde(default)]
    pub connectors: Vec<String>,
    /// The user's skills it may use, `id — name: what it does`.
    #[serde(default)]
    pub skills: Vec<String>,
    /// Built-in connectors the user hasn't added, `id — name: what it does`.
    #[serde(default)]
    pub catalog_connectors: Vec<String>,
    /// Skills the user could install, `id — name: what it does`.
    #[serde(default)]
    pub catalog_skills: Vec<String>,
    /// The chat it was asked from, as a transcript: what "from this session" means.
    #[serde(default)]
    pub context: String,
}

/// A bot written from the user's description, for them to look over before it's added.
#[tauri::command]
pub async fn team_write_bot(request: WriteBotRequest) -> Result<crate::chat_stream::TeammateProposal, String> {
    let need = request.need.trim();
    if need.is_empty() {
        return Err("Say what the bot should do.".into());
    }
    let (_stop, mut cancel) = tokio::sync::watch::channel(false);
    let mut usage = Default::default();
    let owned = agent::team::owned_connectors(&request.team);
    let known: Vec<&str> = request.connectors.iter().filter_map(|c| c.split(" — ").next()).collect();
    let skill_ids: Vec<&str> = request.skills.iter().filter_map(|k| k.split(" — ").next()).collect();
    let catalog_ids: Vec<&str> = request.catalog_connectors.iter().filter_map(|c| c.split(" — ").next()).collect();
    let catalog_skill_ids: Vec<&str> = request.catalog_skills.iter().filter_map(|k| k.split(" — ").next()).collect();
    let free: Vec<&String> = request.connectors.iter().filter(|c| c.split(" — ").next().is_some_and(|id| !owned.contains(id))).collect();
    let mut asked = format!("The user describes the bot they want, in their own words: {need}");
    let context = request.context.trim();
    if !context.is_empty() {
        asked.push_str(&format!(
            "\n\nThey asked from this chat. When their words point at it (\"from this session\", \"like above\", \"จากแชทนี้\") \
or leave out what the bot is for, build the bot from what was actually done and asked here — its real steps, tools and \
sources — not a generic one:\n<chat>\n{context}\n</chat>"
        ));
    }
    asked.push_str(&if free.is_empty() {
        "\n\nThey have no free connectors: give it none.".to_string()
    } else {
        format!("\n\nConnectors it may own (id — name):\n- {}", free.iter().map(|c| c.as_str()).collect::<Vec<_>>().join("\n- "))
    });
    if !request.skills.is_empty() {
        asked.push_str(&format!(
            "\n\nSkills it may use (id — name: what it does); pick only the ones its duty really needs, or none:\n- {}",
            request.skills.join("\n- ")
        ));
    }
    if !request.catalog_connectors.is_empty() {
        asked.push_str(&format!(
            "\n\nConnectors the user hasn't added yet (id — name: what it does):\n- {}",
            request.catalog_connectors.join("\n- ")
        ));
    }
    if !request.catalog_skills.is_empty() {
        asked.push_str(&format!(
            "\n\nSkills the user could install (id — name: what it does):\n- {}",
            request.catalog_skills.join("\n- ")
        ));
    }
    asked.push_str(
        "\n\nAlso say what the user should add for this bot to work well, only what its duty really needs: \
\"install_connectors\": [ids from the connectors not added yet], \"find_connectors\": [one or two words naming \
an app it needs that no list has, e.g. \"slack\"], \"install_skills\": [ids from the skills to install].",
    );
    asked.push_str("\n\nWrite the name, duty and instructions in the language the user wrote in.");
    let w = agent::coach::write_teammate(&request.model, &asked, &request.team, &[], &mut usage, &mut cancel).await?;
    Ok(crate::chat_stream::TeammateProposal {
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
        // Only skills it was offered.
        skills: w.skills.into_iter().filter(|k| skill_ids.contains(&k.as_str())).collect(),
        // Only from the lists offered; search words are kept short.
        install_connectors: w.install_connectors.into_iter().filter(|c| catalog_ids.contains(&c.as_str())).take(3).collect(),
        find_connectors: w.find_connectors.into_iter().map(|q| q.trim().to_string()).filter(|q| !q.is_empty() && q.len() <= 40).take(2).collect(),
        install_skills: w.install_skills.into_iter().filter(|k| catalog_skill_ids.contains(&k.as_str())).take(3).collect(),
        updates: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Writes a bot on a local model: `cargo test --lib write_bot -- --ignored` (needs Ollama).
    #[tokio::test]
    #[ignore]
    async fn writes_a_bot_from_the_users_words_on_a_local_model() {
        let model = std::env::var("BOT_TEST_MODEL").unwrap_or_else(|_| "qwen3:4b-smooth".into());
        let request: WriteBotRequest = serde_json::from_value(serde_json::json!({
            "model": { "provider": "ollama", "model": model },
            "need": "บอทสรุปข่าวจากลิงก์ที่ฉันส่ง เป็นภาษาไทย 5 ข้อ",
            "connectors": ["fetch — Fetch", "github — GitHub"],
        }))
        .unwrap();
        let bot = team_write_bot(request).await.unwrap();
        println!("{} | {} | tools {} | connectors {:?}\n{}", bot.name, bot.role, bot.tools, bot.connectors, bot.instructions);
        assert!(!bot.name.is_empty() && !bot.role.is_empty() && !bot.instructions.is_empty());
        assert!(bot.connectors.iter().all(|c| c == "fetch" || c == "github"));
    }
}
