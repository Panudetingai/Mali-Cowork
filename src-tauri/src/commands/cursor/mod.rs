//! Cursor Agent CLI integration (`cursor-agent --print --output-format stream-json`).
//!
//! Commands:
//! - `cursor_check`       — binary, version and whether the user is signed in
//! - `cursor_login`       — sign in through the browser
//! - `cursor_list_models` — models the account can use
//! - `cursor_generate`    — send a prompt and stream events back
//! - `cursor_abort`       — stop a running prompt

mod bin;
mod commands;
mod stream;

pub use commands::{
    cursor_abort, cursor_check, cursor_generate, cursor_list_models, cursor_login,
};

/// The CLI's path, if it's installed.
pub(crate) fn installed_bin() -> Option<&'static str> {
    bin::cursor_bin()
}

use serde::{Deserialize, Serialize};

use super::opencode::FolderGrant;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CursorRequest {
    pub prompt: String,
    /// Model id from `cursor-agent --list-models`; `auto` lets Cursor choose.
    pub model: Option<String>,
    /// Working folder for Cowork prompts.
    pub cwd: Option<String>,
    /// Cursor chat id to continue.
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
}

impl CursorRequest {
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
        // Cursor applies one mode to the whole run, so the working folder decides.
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
pub struct CursorCheckResult {
    pub available: bool,
    pub logged_in: bool,
    pub version: Option<String>,
    pub path: Option<String>,
    /// Signed-in account, when `cursor-agent status` reports one.
    pub account: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CursorModel {
    pub id: String,
    pub name: String,
}
