//! OpenCode integration backed by a long-lived `opencode serve` process.
//!
//! Docs: <https://opencode.ai/docs/server/>
//!
//! Commands:
//! - `opencode_check`            — CLI availability and version (also warms the server)
//! - `opencode_list_models`      — configured `provider/model` ids
//! - `opencode_default_cwd`      — safe default working directory
//! - `opencode_generate`         — send a prompt and stream events back
//! - `opencode_permission_reply` — answer a permission request
//! - `opencode_abort`            — stop a running prompt
//! - `opencode_set_auth`         — store an API key for a provider
//! - `opencode_delete_session`   — remove a session when its chat is deleted
//! - `opencode_warm`             — load a folder's instance before the first prompt

mod bin;
mod client;
mod commands;
mod cwd;
mod events;
mod policy;
mod server;

pub(crate) use client::OpencodeClient;
pub use commands::{
    opencode_abort, opencode_check, opencode_default_cwd, opencode_delete_session,
    opencode_generate, opencode_list_models, opencode_permission_reply, opencode_set_auth,
    opencode_warm,
};
pub use server::{ensure_server as warm_up_server, shutdown as shutdown_server};

use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpencodeRequest {
    pub prompt: String,
    /// `provider/model`, e.g. `"openai/gpt-5"`. Server default when empty.
    pub model: Option<String>,
    /// Working directory for the agent.
    pub cwd: Option<String>,
    /// Continue an existing session instead of starting a new one.
    pub session_id: Option<String>,
    /// Forward reasoning parts to the UI.
    pub thinking: Option<bool>,
    /// Approve every permission request without asking.
    pub auto_approve: Option<bool>,
    /// `chat` answers without touching files; `cowork` (default) works in `cwd`.
    pub mode: Option<String>,
    /// Cowork: folders the user granted, the working folder included.
    #[serde(default)]
    pub folders: Vec<FolderGrant>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderGrant {
    pub path: String,
    /// `read` or `write`.
    pub access: String,
}

impl FolderGrant {
    pub fn writable(&self) -> bool {
        self.access == "write"
    }
}

impl OpencodeRequest {
    pub fn is_chat(&self) -> bool {
        self.mode.as_deref() == Some("chat")
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionReplyRequest {
    pub id: String,
    pub directory: String,
    /// `once` | `always` | `reject`
    pub reply: String,
    /// Session whose running prompt should also allow `grant` from now on.
    pub session_id: Option<String>,
    pub grant: Option<FolderGrant>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpencodeCheckResult {
    pub available: bool,
    pub version: Option<String>,
    pub path: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpencodeModel {
    /// `provider/model`
    pub id: String,
    pub name: String,
    pub provider_id: String,
    pub provider_name: String,
    /// Costs nothing per token.
    pub free: bool,
    /// The provider has credentials, so the model can run right now.
    pub connected: bool,
    /// Context window in tokens, when known.
    pub context_limit: Option<u64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpencodeProvider {
    pub id: String,
    pub name: String,
    /// Environment variables the provider reads its key from.
    pub env: Vec<String>,
    pub connected: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpencodeModelsResult {
    pub models: Vec<OpencodeModel>,
    /// Model the server uses when none is selected.
    pub default_model: Option<String>,
    pub providers: Vec<OpencodeProvider>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetAuthRequest {
    pub provider_id: String,
    pub key: String,
}
