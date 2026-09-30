//! The coach: a stronger model the user picks for the team. A lead that isn't
//! sure how a bot should work (a small or free model) asks the coach, which
//! writes a new teammate from a one-line need, or rewrites a teammate's way of
//! working after a job went wrong. It also keeps the lead's notebook: what the
//! user keeps working on. Nothing it writes takes effect until the user says so.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::sync::watch;

use super::team::{self, CliAgent, Teammate};
use super::wire::{Delta, Msg, ModelTarget, Usage};
use super::provider;

/// The coach's model, asked one question at a time: an API model with no
/// tools, or a CLI agent in Chat mode (no folder, so it changes nothing).
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CoachModel {
    #[serde(default)]
    pub provider: String,
    #[serde(default)]
    pub model: String,
    #[serde(default)]
    pub api_key: Option<String>,
    #[serde(default)]
    pub base_url: Option<String>,
    /// A coach on a CLI agent (Codex, Cursor, Antigravity, OpenCode).
    #[serde(default)]
    pub cli: Option<CliAgent>,
}

impl CoachModel {
    fn target(&self) -> Result<ModelTarget, String> {
        super::target_for(&self.provider, &self.model, self.api_key.as_deref(), self.base_url.as_deref(), None)
    }
}

/// A teammate as the coach writes it.
#[derive(Debug, Clone, Default, Deserialize, PartialEq)]
#[serde(default)]
pub struct Written {
    pub name: String,
    pub role: String,
    pub instructions: String,
    pub reason: String,
    pub tools: String,
    pub connectors: Vec<String>,
}

/// One thing the user keeps doing, with the chats that show it.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Insight {
    pub pattern: String,
    #[serde(default)]
    pub evidence: Vec<String>,
    #[serde(default)]
    pub count: u32,
}

/// A chat, as the notebook learns from it.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatDigest {
    pub title: String,
    /// The user's first request in it, shortened.
    #[serde(default)]
    pub asked: String,
}

/// The first JSON value in a reply, fenced or not.
pub fn json_in(text: &str) -> Option<Value> {
    let text = text.trim();
    if let Ok(value) = serde_json::from_str(text) {
        return Some(value);
    }
    let unfenced = text.split("```").nth(1).map(|b| b.trim_start_matches("json").trim());
    if let Some(value) = unfenced.and_then(|b| serde_json::from_str(b).ok()) {
        return Some(value);
    }
    // Whichever opens first: an object, or a list of them.
    let mut pairs = [('{', '}'), ('[', ']')];
    pairs.sort_by_key(|(open, _)| text.find(*open).unwrap_or(usize::MAX));
    for (open, close) in pairs {
        if let (Some(start), Some(end)) = (text.find(open), text.rfind(close)) {
            if let Ok(value) = serde_json::from_str(&text[start..=end]) {
                return Some(value);
            }
        }
    }
    None
}

async fn ask(model: &CoachModel, system: &str, prompt: String, usage: &mut Usage, cancel: &mut watch::Receiver<bool>) -> Result<String, String> {
    // A CLI has no system prompt of ours: the role goes in front of the question.
    if let Some(cli) = &model.cli {
        return team::ask_cli(cli, &format!("{system}\n\n{prompt}"), cancel).await;
    }
    let target = model.target()?;
    let mut quiet = |_: Delta| {};
    let result = provider::step(&target, system, &[Msg::User { text: prompt, images: Vec::new() }], &[], &mut quiet, cancel).await?;
    usage.add(&result.usage);
    Ok(result.text)
}

fn roster(team: &[Teammate]) -> String {
    if team.is_empty() {
        return "(no teammates yet)".into();
    }
    team.iter()
        .map(|m| {
            let connectors: Vec<&str> = m.mcp.iter().map(|s| s.id.as_str()).collect();
            format!("- {}: {} (connectors: {})", m.name, m.role.trim(), if connectors.is_empty() { "none".into() } else { connectors.join(", ") })
        })
        .collect::<Vec<_>>()
        .join("\n")
}

const WRITER: &str = "You are the coach of a user's team of AI bots in Mali Cowork. Each bot has exactly one duty \
that no other bot has; a connector (an app such as Canva or Notion) belongs to one bot only. You write bots that \
small models can follow: a clear duty, and concrete step-by-step instructions — what to check first, how to do the \
work, the quality bar, and exactly what to hand back to the lead (links, file paths, a short summary). Write in the \
user's language when the need is in it. Answer with JSON only.";

/// Write a new teammate from what the lead says the team needs.
pub async fn write_teammate(
    model: &CoachModel,
    need: &str,
    team: &[Teammate],
    notebook: &[String],
    usage: &mut Usage,
    cancel: &mut watch::Receiver<bool>,
) -> Result<Written, String> {
    let mut prompt = format!("The lead says the team needs: {need}\n\nThe team today:\n{}", roster(team));
    if !notebook.is_empty() {
        prompt.push_str(&format!("\n\nWhat the user keeps working on:\n- {}", notebook.join("\n- ")));
    }
    prompt.push_str(
        "\n\nWrite one new bot whose duty overlaps no one's. JSON: {\"name\": short name with its job, \"role\": its duty \
in one sentence, \"instructions\": numbered steps, \"reason\": why the user needs it, citing their work if you can, \
\"tools\": \"none\" | \"read\" | \"files\" | \"all\" (the least it needs), \"connectors\": [connector ids it should own, \
only ones no bot owns]}",
    );
    let reply = ask(model, WRITER, prompt, usage, cancel).await?;
    let written: Written = json_in(&reply)
        .and_then(|v| serde_json::from_value(v).ok())
        .ok_or_else(|| "The coach didn't answer with a bot. Try again, or pick another coach model.".to_string())?;
    if written.name.trim().is_empty() || written.role.trim().is_empty() {
        return Err("The coach's bot had no name or duty.".into());
    }
    Ok(written)
}

/// Patterns in the notebook with this many chats behind them are enough to build a bot on.
pub const READY_AT: u32 = 3;

/// A bot for a pattern the user keeps coming back to, or `None` when a bot on
/// the team already does that work. Nobody asked: the notebook showed it.
pub async fn suggest_for(
    model: &CoachModel,
    insight: &Insight,
    team: &[Teammate],
    connectors: &[String],
    usage: &mut Usage,
    cancel: &mut watch::Receiver<bool>,
) -> Result<Option<Written>, String> {
    let seen: Vec<String> = insight.evidence.iter().take(5).map(|t| format!("\"{t}\"")).collect();
    let mut prompt = format!(
        "The user keeps doing this: {pattern} ({count} chats, e.g. {seen}).\n\nThe team today:\n{roster}",
        pattern = insight.pattern.trim(),
        count = insight.count,
        seen = seen.join(", "),
        roster = roster(team),
    );
    if !connectors.is_empty() {
        prompt.push_str(&format!("\n\nConnectors the user has (id — name): {}", connectors.join("; ")));
    }
    prompt.push_str(
        "\n\nIf a bot on the team already does this work, answer {\"covered\": \"its name\"}. Otherwise write one new bot \
that takes this work on, whose duty overlaps no one's. JSON: {\"name\": short name with its job, \"role\": its duty in \
one sentence, \"instructions\": numbered steps, \"reason\": in the user's language, why — say how many times they did \
this, \"tools\": \"none\" | \"read\" | \"files\" | \"all\" (the least it needs), \"connectors\": [ids from the list \
above it should own, only ones no bot owns]}",
    );
    let reply = ask(model, WRITER, prompt, usage, cancel).await?;
    let value = json_in(&reply).ok_or_else(|| "The coach didn't answer with JSON.".to_string())?;
    if value["covered"].as_str().is_some_and(|name| !name.trim().is_empty()) {
        return Ok(None);
    }
    let written: Written = serde_json::from_value(value).map_err(|_| "The coach's bot came back in the wrong shape.".to_string())?;
    if written.name.trim().is_empty() || written.role.trim().is_empty() {
        return Err("The coach's bot had no name or duty.".into());
    }
    Ok(Some(written))
}

/// Rewrite how a teammate works, after the lead saw what went wrong.
pub async fn coach_teammate(
    model: &CoachModel,
    mate: &Teammate,
    feedback: &str,
    team: &[Teammate],
    usage: &mut Usage,
    cancel: &mut watch::Receiver<bool>,
) -> Result<Written, String> {
    let prompt = format!(
        "Bot: {name}\nDuty: {role}\nHow it works now:\n{instructions}\n\nWhat went wrong, as the lead saw it: {feedback}\n\n\
The team:\n{roster}\n\nRewrite its instructions so it does its duty right next time, without taking on anyone else's \
duty. Keep what worked. JSON: {{\"instructions\": the full new instructions, \"reason\": what you changed and why, in \
one or two sentences}}",
        name = mate.name,
        role = mate.role.trim(),
        instructions = mate.instructions.as_deref().map(str::trim).filter(|s| !s.is_empty()).unwrap_or("(none yet)"),
        roster = roster(team),
    );
    let reply = ask(model, WRITER, prompt, usage, cancel).await?;
    let mut written: Written = json_in(&reply)
        .and_then(|v| serde_json::from_value(v).ok())
        .ok_or_else(|| "The coach didn't answer with instructions.".to_string())?;
    if written.instructions.trim().is_empty() {
        return Err("The coach's instructions were empty.".into());
    }
    written.name = mate.name.clone();
    written.role = mate.role.clone();
    Ok(written)
}

const NOTEBOOK: &str = "You keep the notebook of a user's AI team lead: the kinds of work the user keeps coming back \
to, so the lead can suggest bots for them. Name each pattern concretely (\"Instagram promo posts for the coffee \
shop\", not \"social media\"). Only patterns with at least two chats behind them. Answer with JSON only.";

/// The notebook, brought up to date with the user's latest chats.
pub async fn reflect(
    model: &CoachModel,
    chats: &[ChatDigest],
    notebook: &[Insight],
    forgotten: &[String],
    usage: &mut Usage,
    cancel: &mut watch::Receiver<bool>,
) -> Result<Vec<Insight>, String> {
    let chats: Vec<String> = chats
        .iter()
        .take(40)
        .map(|c| if c.asked.trim().is_empty() { format!("- {}", c.title.trim()) } else { format!("- {} — \"{}\"", c.title.trim(), c.asked.trim()) })
        .collect();
    let mut prompt = format!("The user's recent chats, newest first:\n{}", chats.join("\n"));
    if !notebook.is_empty() {
        prompt.push_str(&format!("\n\nThe notebook so far:\n{}", serde_json::to_string(notebook).unwrap_or_default()));
    }
    if !forgotten.is_empty() {
        prompt.push_str(&format!("\n\nThe user removed these; leave them out: {}", forgotten.join("; ")));
    }
    prompt.push_str(
        "\n\nReturn the whole notebook, at most 12 patterns, most frequent first: [{\"pattern\": what they keep doing, \
\"evidence\": [titles of the chats that show it], \"count\": how many chats}]. Keep earlier patterns that still hold.",
    );
    let reply = ask(model, NOTEBOOK, prompt, usage, cancel).await?;
    let value = json_in(&reply).ok_or_else(|| "The notebook model didn't answer with JSON.".to_string())?;
    let list = match value {
        Value::Object(mut o) => o.remove("notebook").or_else(|| o.remove("patterns")).unwrap_or(Value::Null),
        other => other,
    };
    let mut insights: Vec<Insight> = serde_json::from_value(list).map_err(|_| "The notebook came back in the wrong shape.".to_string())?;
    insights.retain(|i| !i.pattern.trim().is_empty());
    insights.truncate(12);
    Ok(insights)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn finds_json_in_a_chatty_reply() {
        assert_eq!(json_in("{\"a\":1}"), Some(json!({"a": 1})));
        assert_eq!(json_in("Here you go:\n```json\n{\"a\":2}\n```"), Some(json!({"a": 2})));
        assert_eq!(json_in("Sure! {\"a\":3} hope it helps"), Some(json!({"a": 3})));
        assert_eq!(json_in("list: [{\"pattern\":\"x\"}]"), Some(json!([{"pattern": "x"}])));
        assert_eq!(json_in("nothing here"), None);
    }

    #[test]
    fn a_cli_coach_is_asked_in_chat_mode_with_no_folder() {
        let coach: CoachModel = serde_json::from_value(json!({
            "cli": { "kind": "codex", "request": { "model": "gpt-5-codex", "images": [], "effort": null } }
        }))
        .unwrap();
        let cli = coach.cli.as_ref().unwrap();
        let body = team::ask_cli_body(cli, "Write a bot", "coach_1");
        assert_eq!(body["mode"], "chat");
        assert_eq!(body["cwd"], Value::Null);
        assert_eq!(body["folders"], json!([]));
        assert_eq!(body["prompt"], "Write a bot");
        assert_eq!(body["model"], "gpt-5-codex");
        let _: crate::commands::codex::CodexRequest = serde_json::from_value(body).unwrap();
        let opencode = CliAgent { kind: "opencode".into(), request: json!({ "model": "anthropic/claude" }) };
        let body = team::ask_cli_body(&opencode, "Write a bot", "coach_2");
        assert_eq!(body["autoApprove"], false);
        let _: crate::commands::opencode::OpencodeRequest = serde_json::from_value(body).unwrap();
    }

    #[test]
    fn a_written_bot_takes_missing_fields_as_empty() {
        let w: Written = serde_json::from_value(json!({"name": "Mikan", "role": "Writes captions"})).unwrap();
        assert_eq!(w.tools, "");
        assert!(w.connectors.is_empty());
    }
}
