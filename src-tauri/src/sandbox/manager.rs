use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use super::audit::{self, AuditRecord};
use super::events::{SandboxEvent, SandboxEventKind};
use super::filesystem::{self, FilesystemError};
use super::policy::{AccessDecision, SandboxPolicy};

/// The existing OpenCode approval dialog remains the authority for ordinary
/// commands. This is the non-bypassable second gate: an approval can never
/// permit a shell interpreter, command chaining, or an obvious sensitive path.
pub(crate) fn permission_rejection_reason(
    permission: &str,
    path: Option<&str>,
    command: Option<&str>,
) -> Option<&'static str> {
    if let Some(path) = path {
        if filesystem::is_sensitive(std::path::Path::new(path)) {
            return Some(
                "Sensitive files and credential directories are blocked by sandbox policy.",
            );
        }
    }
    if permission == "bash" {
        let command = command.unwrap_or_default().trim();
        if command.is_empty() || command.contains(|c: char| ";|&<>`$(){}\n\r".contains(c)) {
            return Some(
                "Shell composition and command injection syntax are blocked by sandbox policy.",
            );
        }
        let program = command
            .split_whitespace()
            .next()
            .unwrap_or_default()
            .trim_matches(['\"', '\''])
            .trim_end_matches(".exe")
            .to_ascii_lowercase();
        if [
            "cmd",
            "powershell",
            "pwsh",
            "sh",
            "bash",
            "zsh",
            "node",
            "python",
            "python3",
            "py",
            "rustc",
        ]
        .contains(&program.as_str())
        {
            return Some(
                "Shell interpreters and untrusted runtime launchers are blocked by sandbox policy.",
            );
        }
        if command_mentions_sensitive_path(command) {
            return Some(
                "Sensitive files and credential directories are blocked by sandbox policy.",
            );
        }
    }
    None
}

fn command_mentions_sensitive_path(command: &str) -> bool {
    command
        .split_whitespace()
        .map(|part| part.trim_matches(['\"', '\'']))
        .any(|part| filesystem::is_sensitive(std::path::Path::new(part)))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FilesystemSearchRequest {
    pub workspace: String,
    pub query: String,
    #[serde(default = "default_max_results")]
    pub max_results: usize,
}

fn default_max_results() -> usize {
    50
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FilesystemRequest {
    pub workspace: String,
    pub path: String,
    pub content: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SandboxStatus {
    pub policy: SandboxPolicy,
    pub enforcement: &'static str,
}

fn record(
    tool: &str,
    action: &str,
    decision: AccessDecision,
    path: Option<String>,
    reason: Option<String>,
) {
    let timestamp = format!("{}", chrono_like_timestamp());
    let _ = audit::append(&AuditRecord {
        timestamp,
        mcp_id: None,
        tool: tool.to_string(),
        action: action.to_string(),
        decision: format!("{decision:?}").to_ascii_lowercase(),
        path,
        event: (decision == AccessDecision::Deny).then(|| SandboxEvent {
            kind: SandboxEventKind::SandboxViolation,
            mcp_id: None,
            tool: tool.to_string(),
            reason: reason
                .clone()
                .unwrap_or_else(|| "Sandbox policy denied the operation.".into()),
        }),
        reason,
    });
}

// RFC3339-like UTC timestamp without adding a time crate.
fn chrono_like_timestamp() -> String {
    match std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH) {
        Ok(duration) => format!("{}.{:03}Z", duration.as_secs(), duration.subsec_millis()),
        Err(_) => "0.000Z".into(),
    }
}

fn map_error(tool: &str, path: &str, error: FilesystemError) -> String {
    let reason = error.to_string();
    record(
        tool,
        "filesystem",
        AccessDecision::Deny,
        Some(path.to_string()),
        Some(reason.clone()),
    );
    reason
}

#[tauri::command]
pub fn filesystem_search(request: FilesystemSearchRequest) -> Result<Vec<String>, String> {
    let policy = SandboxPolicy::default();
    let decision = policy.tool_decision("filesystem.search", policy.filesystem.workspace_search);
    if decision == AccessDecision::Deny {
        record(
            "filesystem.search",
            "search",
            decision,
            None,
            Some("Tool permission denied".into()),
        );
        return Err("Sandbox denied filesystem search".into());
    }
    let root = PathBuf::from(&request.workspace);
    let result = filesystem::search(&root, &request.query, request.max_results)
        .map_err(|e| map_error("filesystem.search", &request.workspace, e));
    if result.is_ok() {
        record(
            "filesystem.search",
            "search",
            decision,
            Some(request.workspace),
            None,
        );
    }
    result
}

#[tauri::command]
pub fn filesystem_read(request: FilesystemRequest) -> Result<String, String> {
    let policy = SandboxPolicy::default();
    let decision = policy.tool_decision("filesystem.read", policy.filesystem.workspace_read);
    if decision != AccessDecision::Allow {
        record(
            "filesystem.read",
            "read",
            decision,
            Some(request.path),
            Some("Permission is required".into()),
        );
        return Err("Sandbox requires permission before reading this file".into());
    }
    let resolved = filesystem::resolve_workspace_path(
        &PathBuf::from(&request.workspace),
        &PathBuf::from(&request.path),
    )
    .map_err(|e| map_error("filesystem.read", &request.path, e))?;
    let result = fs::read_to_string(&resolved).map_err(|e| e.to_string());
    if result.is_ok() {
        record(
            "filesystem.read",
            "read",
            decision,
            Some(request.path),
            None,
        );
    }
    result
}

#[tauri::command]
pub fn filesystem_write(request: FilesystemRequest) -> Result<(), String> {
    let policy = SandboxPolicy::default();
    let decision = policy.tool_decision("filesystem.write", policy.filesystem.workspace_write);
    if decision != AccessDecision::Allow {
        record(
            "filesystem.write",
            "write",
            decision,
            Some(request.path),
            Some("Permission is required".into()),
        );
        return Err("Sandbox requires permission before writing this file".into());
    }
    let resolved = filesystem::resolve_workspace_path(
        &PathBuf::from(&request.workspace),
        &PathBuf::from(&request.path),
    )
    .map_err(|e| map_error("filesystem.write", &request.path, e))?;
    if let Some(parent) = resolved.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(resolved, request.content.unwrap_or_default()).map_err(|e| e.to_string())?;
    record(
        "filesystem.write",
        "write",
        decision,
        Some(request.path),
        None,
    );
    Ok(())
}

#[tauri::command]
pub fn get_sandbox_status() -> SandboxStatus {
    SandboxStatus {
        policy: SandboxPolicy::default(),
        enforcement: "rust-policy-and-scoped-filesystem",
    }
}

#[tauri::command]
pub fn get_audit_logs(limit: Option<usize>) -> Result<Vec<AuditRecord>, String> {
    audit::recent(limit.unwrap_or(100))
}

#[cfg(test)]
mod tests {
    use super::permission_rejection_reason;

    #[test]
    fn sandbox_rejects_shell_bypass_attempts_after_approval() {
        for command in [
            "powershell -Command Get-Content C:\\Users\\me\\.ssh\\id_rsa",
            "node steal.js",
            "git status && curl https://example.test",
            "cat ~/.aws/credentials",
        ] {
            assert!(
                permission_rejection_reason("bash", None, Some(command)).is_some(),
                "{command}"
            );
        }
        assert!(permission_rejection_reason("bash", None, Some("git status")).is_none());
        assert!(permission_rejection_reason("bash", None, Some("rm -rf /docs/old")).is_none());
    }
}
