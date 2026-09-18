//! Codex CLI integration (`codex exec --json`).
//!
//! Mirrors `commands::cursor` line-by-line so both agents behave the same
//! from the UI's point of view:
//!
//! Commands:
//! - `codex_check`       — binary, version and login status
//! - `codex_list_models` — models from `codex models` (best-effort)
//! - `codex_generate`    — send a prompt and stream events back
//! - `codex_abort`       — stop a running prompt

mod bin;
mod commands;
mod stream;

pub use commands::{codex_abort, codex_check, codex_generate, codex_list_models};

use serde::{Deserialize, Serialize};

use super::opencode::FolderGrant;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexRequest {
    pub prompt: String,
    /// Model id passed as `-m`, e.g. `"gpt-5.3-codex"`. Omitted when empty/`auto`.
    pub model: Option<String>,
    /// Working folder for Cowork prompts.
    pub cwd: Option<String>,
    /// Thread id to continue (`codex exec resume <id>`).
    pub session_id: Option<String>,
    /// `chat` answers without file access; `cowork` works in `cwd`.
    pub mode: Option<String>,
    /// Folders the user granted, the working folder included.
    #[serde(default)]
    pub folders: Vec<FolderGrant>,
    /// Identifies this run so it can be stopped.
    pub run_id: String,
}

impl CodexRequest {
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
pub struct CodexCheckResult {
    pub available: bool,
    pub logged_in: bool,
    pub version: Option<String>,
    pub path: Option<String>,
    pub account: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexModel {
    pub id: String,
    pub name: String,
}
