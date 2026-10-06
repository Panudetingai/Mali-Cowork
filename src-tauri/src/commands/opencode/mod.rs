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
//! - `opencode_question_reply`   — answer a question the agent asked
//! - `opencode_abort`            — stop a running prompt
//! - `opencode_set_auth`         — store an API key for a provider
//! - `opencode_delete_session`   — remove a session when its chat is deleted
//! - `opencode_warm`             — load a folder's instance before the first prompt
//! - `opencode_configure_providers` — OpenRouter / Ollama / Ollama Cloud for the agent

mod bin;
mod client;
mod commands;
mod cwd;
mod events;
mod instances;
mod policy;
mod providers;
mod schema;
mod server;
mod stream;

use instances::lease as lease_instance;

pub use commands::{
    opencode_abort, opencode_check, opencode_default_cwd, opencode_delete_session,
    opencode_generate, opencode_list_models, opencode_permission_reply, opencode_question_reply,
    opencode_set_auth, opencode_shutdown, opencode_warm,
};
pub use providers::opencode_configure_providers;
pub use server::ensure_server as warm_up_server;

/// The CLI's path, if it's installed.
pub(crate) fn installed_bin() -> Option<&'static str> {
    bin::opencode_bin()
}

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
    /// How hard the model should think, as one of its own effort levels.
    pub effort: Option<String>,
    /// Approve every permission request without asking.
    pub auto_approve: Option<bool>,
    /// `chat` answers without touching files; `cowork` (default) works in `cwd`.
    pub mode: Option<String>,
    /// Cowork: folders the user granted, the working folder included.
    #[serde(default)]
    pub folders: Vec<FolderGrant>,
    /// Attached pictures and documents (paths from `attachment_import`).
    #[serde(default)]
    pub files: Vec<String>,
    /// The user's custom instructions and enabled skills.
    #[serde(default)]
    pub instructions: Option<String>,
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

/// An answer to the agent's question: one list of chosen labels per question,
/// in the order they were asked. Empty withdraws the question.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QuestionReplyRequest {
    pub id: String,
    pub directory: String,
    #[serde(default)]
    pub answers: Vec<Vec<String>>,
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
    /// Can call tools (files, MCP); `None` when the model has no metadata.
    pub tool_call: Option<bool>,
    /// What the model produces: `text`, `image`, `video`. A model that makes
    /// pictures is called over its own API rather than through an agent
    /// (see `commands::media`), so the front end has to be able to tell.
    pub output: Vec<String>,
    /// What it takes in: `text`, `image`, `pdf`… Mali's agent only shows
    /// pictures to a model that lists `image` here.
    pub input: Vec<String>,
    /// Reasoning effort levels this model accepts, weakest first — the keys of
    /// opencode's per-model `variants`, which is also what a prompt passes
    /// back as `variant`. Empty when the model does not think in levels, and
    /// the app then shows no effort control for it at all.
    pub efforts: Vec<String>,
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
