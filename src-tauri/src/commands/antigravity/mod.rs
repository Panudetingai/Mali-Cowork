//! Antigravity CLI integration (`agy -p "..." --output-format stream-json`).
//!
//! Antigravity CLI is Google's terminal agent and the successor to Gemini CLI;
//! its binary is `agy` and it signs in with a Google account through the OS
//! keyring. Ref: https://antigravity.google/docs/cli/headless/
//!
//! Mirrors `commands::cursor` / `commands::codex` so every agent behaves the
//! same from the UI's point of view:
//!
//! Commands:
//! - `antigravity_check`       — binary, version and sign-in status
//! - `antigravity_list_models` — the slugs `agy models` prints
//! - `antigravity_generate`    — send a prompt and stream events back
//! - `antigravity_abort`       — stop a running prompt

mod bin;
mod commands;
mod stream;

pub use commands::{antigravity_abort, antigravity_check, antigravity_generate, antigravity_list_models};

/// The CLI's path, if it's installed.
pub(crate) fn installed_bin() -> Option<&'static str> {
    bin::antigravity_bin()
}

use serde::{Deserialize, Serialize};

use super::opencode::FolderGrant;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AntigravityRequest {
    pub prompt: String,
    /// Model slug passed as `--model`, e.g. `"gemini-3.1-pro-high"`. Omitted
    /// when empty or `auto`; `agy models` lists what is accepted.
    pub model: Option<String>,
    /// Working folder for Cowork prompts (the CLI is workspace-scoped).
    pub cwd: Option<String>,
    /// Conversation to continue (`agy --conversation <id>`).
    pub session_id: Option<String>,
    /// `chat` answers without file access; `cowork` works in `cwd`.
    pub mode: Option<String>,
    /// Folders the user granted, the working folder included.
    #[serde(default)]
    pub folders: Vec<FolderGrant>,
    /// Identifies this run so it can be stopped.
    pub run_id: String,
    /// Gemini API key from Settings → Models. It only reaches the CLI as
    /// `GEMINI_API_KEY`, and only counts when the user set
    /// `"modelProvider": "gemini"` in the CLI's own settings.
    #[serde(default)]
    pub api_key: Option<String>,
}

impl AntigravityRequest {
    pub fn is_chat(&self) -> bool {
        self.mode.as_deref() == Some("chat")
    }

    /// The folder to run in; Chat mode stays out of the user's folders.
    pub fn workspace(&self) -> Option<&str> {
        if self.is_chat() {
            return None;
        }
        self.cwd.as_deref().map(str::trim).filter(|c| !c.is_empty())
    }

    /// True when the working folder was granted read-only.
    pub fn read_only(&self) -> bool {
        let Some(cwd) = self.workspace() else { return false };
        self.folders
            .iter()
            .find(|f| f.path.trim_end_matches(['/', '\\']) == cwd.trim_end_matches(['/', '\\']))
            .is_some_and(|f| !f.writable())
    }

    /// Granted folders other than the working folder.
    pub fn extra_folders(&self) -> Vec<String> {
        let cwd = self.workspace().unwrap_or_default().trim_end_matches(['/', '\\']);
        self.folders
            .iter()
            .map(|f| f.path.trim_end_matches(['/', '\\']).to_string())
            .filter(|path| !path.is_empty() && path != cwd)
            .collect()
    }
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AntigravityCheckResult {
    pub available: bool,
    pub logged_in: bool,
    pub version: Option<String>,
    pub path: Option<String>,
    pub account: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AntigravityModel {
    pub id: String,
    pub name: String,
}
