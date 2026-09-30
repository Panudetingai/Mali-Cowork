//! A chat's conversation with the agent, kept on disk so the next prompt —
//! even after a restart — carries on where the last one ended.

use std::collections::{BTreeMap, BTreeSet};
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use super::wire::Msg;

#[derive(Debug, Default, Serialize, Deserialize)]
pub struct Session {
    pub id: String,
    pub messages: Vec<Msg>,
    /// What the user said "Always" to in this chat (see `tools::approval_key`).
    #[serde(default)]
    pub always: BTreeSet<String>,
    /// A lead's teammates' own sessions in this chat, by teammate id.
    #[serde(default, rename = "teamSessions")]
    pub team_sessions: BTreeMap<String, String>,
}

fn dir() -> PathBuf {
    dirs::data_local_dir()
        .unwrap_or_else(std::env::temp_dir)
        .join("mali-cowork")
        .join("agent-sessions")
}

fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 64 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

impl Session {
    /// The saved session, or a new one when there is none (or the id is unknown).
    pub fn load_or_new(id: Option<&str>) -> Self {
        if let Some(id) = id.filter(|id| valid_id(id)) {
            if let Ok(text) = std::fs::read_to_string(dir().join(format!("{id}.json"))) {
                if let Ok(session) = serde_json::from_str::<Session>(&text) {
                    return session;
                }
            }
        }
        Self { id: format!("mali_{}", uuid::Uuid::new_v4().simple()), ..Default::default() }
    }

    pub fn save(&self) -> Result<(), String> {
        let dir = dir();
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let text = serde_json::to_string(self).map_err(|e| e.to_string())?;
        let tmp = dir.join(format!("{}.json.tmp", self.id));
        std::fs::write(&tmp, text).map_err(|e| e.to_string())?;
        std::fs::rename(&tmp, dir.join(format!("{}.json", self.id))).map_err(|e| e.to_string())
    }

    /// A turn that was cut off may leave tool calls without results, which
    /// every provider rejects on the next request: answer them as cancelled.
    pub fn close_open_calls(&mut self) {
        let Some(Msg::Assistant { tool_calls, .. }) = self.messages.last() else { return };
        let calls: Vec<_> = tool_calls.iter().map(|c| (c.id.clone(), c.name.clone())).collect();
        for (call_id, name) in calls {
            self.messages.push(Msg::Tool {
                call_id,
                name,
                content: "Cancelled: the user stopped the run before this ran.".into(),
                is_error: true,
                images: Vec::new(),
            });
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::wire::ToolCall;

    #[test]
    fn rejects_path_like_ids() {
        assert!(!valid_id("../x"));
        assert!(valid_id("mali_abc-1"));
        let s = Session::load_or_new(Some("../../etc/passwd"));
        assert!(s.id.starts_with("mali_"));
    }

    #[test]
    fn closes_dangling_tool_calls() {
        let mut s = Session::default();
        s.messages.push(Msg::Assistant {
            text: String::new(),
            tool_calls: vec![ToolCall { id: "c1".into(), name: "bash".into(), args: serde_json::json!({}) }],
        });
        s.close_open_calls();
        assert!(matches!(s.messages.last(), Some(Msg::Tool { call_id, .. }) if call_id == "c1"));
    }
}
