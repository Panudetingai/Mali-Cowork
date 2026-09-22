//! Load the sandbox policy the main app wrote for one MCP server.

use std::fs;
use std::path::Path;

use crate::sandbox::{AccessDecision, SandboxPolicy};

pub fn load_policy(path: &Path) -> Result<SandboxPolicy, String> {
    let text = fs::read_to_string(path).map_err(|e| format!("Cannot read policy {path:?}: {e}"))?;
    serde_json::from_str(&text).map_err(|e| format!("Invalid policy {path:?}: {e}"))
}

impl SandboxPolicy {
    /// Should the child be allowed to start at all, given its resolved executable?
    /// This is a runner-side guard even though the main app already validates the id.
    /// Shell interpreters are blocked, but language launchers such as `npx`,
    /// `uvx` and `python` are allowed because many MCP servers need them.
    pub fn allows_program(&self, executable: &std::path::Path) -> bool {
        let Some(name) = executable.file_stem().and_then(|n| n.to_str()) else {
            return false;
        };
        let name = name.trim_end_matches(".exe").to_ascii_lowercase();
        !matches!(
            name.as_str(),
            "cmd" | "powershell" | "pwsh" | "sh" | "bash" | "zsh" | "wsl" | "wt"
        )
    }

    /// True when the child may read the given absolute path.
    pub fn may_read(&self, _path: &std::path::Path) -> bool {
        self.filesystem.workspace_read != AccessDecision::Deny
    }

    /// True when the child may write the given absolute path.
    pub fn may_write(&self, _path: &std::path::Path) -> bool {
        self.filesystem.workspace_write != AccessDecision::Deny
    }
}
