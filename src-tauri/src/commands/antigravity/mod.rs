//! Antigravity CLI integration (`antigravity -p "..." --output-format stream-json`).
//!
//! Mirrors `commands::cursor` / `commands::codex` line-by-line so every agent
//! behaves the same from the UI's point of view:
//!
//! Commands:
//! - `antigravity_check`       — binary, version and login status
//! - `antigravity_list_models` — known models (best-effort; the CLI has no list command)
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
    /// Model id passed as `-m`, e.g. `"antigravity-2.5-pro"`. Omitted when empty/`auto`.
    pub model: Option<String>,
    /// Working folder for Cowork prompts (Antigravity CLI is project-scoped).
    pub cwd: Option<String>,
    /// Session id to continue (`antigravity -r <id>`).
    pub session_id: Option<String>,
    /// `chat` answers without file access; `cowork` works in `cwd`.
    pub mode: Option<String>,
    /// Folders the user granted, the working folder included.
    #[serde(default)]
    pub folders: Vec<FolderGrant>,
    /// Identifies this run so it can be stopped.
    pub run_id: String,
    /// Attached pictures (paths from `attachment_import`).
    #[serde(default)]
    pub images: Vec<String>,
    /// Antigravity API key from Settings → Models. Headless `antigravity -p` only reads
    /// the key from `ANTIGRAVITY_API_KEY`, never the one saved by its `/auth` screen.
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

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AntigravityModel {
    pub id: String,
    pub name: String,
}
