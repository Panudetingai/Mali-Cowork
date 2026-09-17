//! OpenCode CLI integration for Tauri.
//!
//! Implements the non-interactive mode documented at:
//! <https://opencode.ai/docs/cli/>
//!
//! Public entry points:
//! - `opencode_check`          — verify the CLI is installed
//! - `opencode_list_models`     — list available `provider/model` strings
//! - `opencode_default_cwd`     — return a safe default working directory
//! - `opencode_generate`        — run `opencode run --format json ...` and stream events

mod bin;
mod commands;
mod cwd;
mod parser;

pub use commands::{
    opencode_check, opencode_default_cwd, opencode_generate, opencode_list_models,
};

use serde::{Deserialize, Serialize};

/// Frontend request to run opencode.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpencodeRequest {
    pub prompt: String,
    /// `provider/model`, e.g. `"openai/gpt-5"`. OpenCode flag: `-m`.
    pub model: Option<String>,
    /// Working directory. OpenCode flag: `--dir`.
    pub cwd: Option<String>,
    /// Show thinking blocks. OpenCode flag: `--thinking`.
    pub thinking: Option<bool>,
    /// Auto-approve permissions. OpenCode flag: `--auto`.
    pub auto_approve: Option<bool>,
    /// Attach to a running server. OpenCode flag: `--attach`.
    pub attach: Option<String>,
}

/// Result of `opencode_check`.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpencodeCheckResult {
    pub available: bool,
    pub version: Option<String>,
    pub path: Option<String>,
    pub error: Option<String>,
}

/// Result of `opencode_list_models`.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpencodeModelsResult {
    pub models: Vec<String>,
    pub providers: Vec<String>,
}
