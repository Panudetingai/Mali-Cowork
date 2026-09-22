use serde::Serialize;

use super::audit::{self, AuditRecord};
use super::events::{SandboxEvent, SandboxEventKind};
use super::filesystem;
use super::policy::{AccessDecision, SandboxPolicy};

/// The existing OpenCode approval dialog remains the authority for what the
/// agent may run: a pipeline, a chained command or a `node` script is ordinary
/// work, and `decide` already sends anything it is unsure about to the user.
///
/// This is the one thing an approval may never buy: reaching a credential.
/// Keys and credential folders stay blocked whatever the user clicks and
/// whatever auto-approve is set to.
pub(crate) fn permission_rejection_reason(
    permission: &str,
    path: Option<&str>,
    command: Option<&str>,
) -> Option<&'static str> {
    const BLOCKED: &str = "Sensitive files and credential directories are blocked by sandbox policy.";
    if let Some(path) = path {
        if filesystem::is_sensitive(std::path::Path::new(path)) {
            return Some(BLOCKED);
        }
    }
    if permission == "bash" {
        let command = command.unwrap_or_default().trim();
        if command.is_empty() {
            return Some("An empty command is blocked by sandbox policy.");
        }
        if command_mentions_sensitive_path(command) {
            return Some(BLOCKED);
        }
    }
    None
}

/// Any word in the command that names a credential path, whatever quoting,
/// separators or shell syntax sit around it. Backslashes count as separators
/// too, so a Windows-shaped path is caught on every host.
fn command_mentions_sensitive_path(command: &str) -> bool {
    command
        .split(|c: char| c.is_whitespace() || ";|&<>()".contains(c))
        .map(|part| part.trim_matches(['"', '\'', '`', '$']))
        .filter(|part| !part.is_empty())
        .any(|part| filesystem::is_sensitive(std::path::Path::new(&part.replace('\\', "/"))))
}

/// What the Sandbox card in Settings → MCP shows.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SandboxStatus {
    /// True when the runner binary sits next to the app, so local MCP servers
    /// are launched through it.
    pub runner_active: bool,
    pub runner_path: Option<String>,
    /// The policy every MCP server starts from.
    pub policy: SandboxPolicy,
}

fn record(
    tool: &str,
    action: &str,
    decision: AccessDecision,
    mcp_id: Option<String>,
    path: Option<String>,
    reason: Option<String>,
    kind: Option<SandboxEventKind>,
) {
    let _ = audit::append(&AuditRecord {
        timestamp: timestamp(),
        mcp_id: mcp_id.clone(),
        tool: tool.to_string(),
        action: action.to_string(),
        decision: format!("{decision:?}").to_ascii_lowercase(),
        path,
        event: kind.map(|kind| SandboxEvent {
            kind,
            mcp_id,
            tool: tool.to_string(),
            reason: reason
                .clone()
                .unwrap_or_else(|| "Sandbox policy denied the operation.".into()),
        }),
        reason,
    });
}

// RFC3339-like UTC timestamp without adding a time crate.
fn timestamp() -> String {
    match std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH) {
        Ok(duration) => format!("{}.{:03}Z", duration.as_secs(), duration.subsec_millis()),
        Err(_) => "0.000Z".into(),
    }
}

/// An agent action the credential gate refused. Written so the user can see
/// what was stopped instead of only reading it once in a chat bubble.
pub(crate) fn record_blocked(permission: &str, target: Option<&str>, reason: &str) {
    record(
        permission,
        "blocked",
        AccessDecision::Deny,
        None,
        target.map(str::to_string),
        Some(reason.to_string()),
        Some(SandboxEventKind::SensitiveFileBlocked),
    );
}

/// How one MCP server was started. `sandboxed` is false when the runner is
/// missing, which is worth seeing rather than guessing.
///
/// Config is rewritten before every prompt, so the same line would repeat all
/// day: each server is recorded once per app run, and again only if its state
/// changes.
pub(crate) fn record_mcp_launch(mcp_id: &str, command: &str, sandboxed: bool) {
    static SEEN: std::sync::OnceLock<std::sync::Mutex<std::collections::HashMap<String, bool>>> =
        std::sync::OnceLock::new();
    let seen = SEEN.get_or_init(Default::default);
    if seen.lock().unwrap().insert(mcp_id.to_string(), sandboxed) == Some(sandboxed) {
        return;
    }
    record(
        "mcp.launch",
        if sandboxed { "sandboxed" } else { "unsandboxed" },
        if sandboxed { AccessDecision::Allow } else { AccessDecision::Ask },
        Some(mcp_id.to_string()),
        Some(command.to_string()),
        (!sandboxed).then(|| "The sandbox runner is not installed next to the app.".to_string()),
        (!sandboxed).then_some(SandboxEventKind::ProcessBlocked),
    );
}

#[tauri::command]
pub fn get_sandbox_status() -> SandboxStatus {
    let runner = crate::mcp_runner::runner_binary_path();
    SandboxStatus {
        runner_active: runner.is_some(),
        runner_path: runner.map(|p| p.to_string_lossy().into_owned()),
        policy: SandboxPolicy::for_mcp(super::McpTrustLevel::default()),
    }
}

#[tauri::command]
pub fn get_audit_logs(limit: Option<usize>) -> Result<Vec<AuditRecord>, String> {
    audit::recent(limit.unwrap_or(100))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A refusal has to survive as a record, or the Sandbox card has nothing to
    /// show and the user only ever sees one error bubble.
    #[test]
    fn a_blocked_action_lands_in_the_audit_trail() {
        let log = std::env::temp_dir().join(format!("mali-audit-{}.jsonl", uuid::Uuid::new_v4().simple()));
        // SAFETY: this test owns the variable; nothing else reads the audit log.
        unsafe { std::env::set_var("MALI_SANDBOX_AUDIT", &log) };

        record_blocked("bash", Some("cat ~/.ssh/id_rsa"), "Sensitive files are blocked.");
        record_mcp_launch("github", "npx -y @modelcontextprotocol/server-github", true);

        let recent = audit::recent(10).expect("audit log");
        let launch = recent.iter().find(|r| r.tool == "mcp.launch").expect("launch record");
        assert_eq!(launch.action, "sandboxed");
        assert_eq!(launch.mcp_id.as_deref(), Some("github"));
        assert!(launch.event.is_none(), "a sandboxed launch is not an incident");

        let blocked = recent.iter().find(|r| r.tool == "bash").expect("blocked record");
        assert_eq!(blocked.decision, "deny");
        assert!(blocked.event.is_some(), "a refusal is an incident the card shows");
        assert!(blocked.path.as_deref().unwrap().contains(".ssh"));

        // The same launch is not written twice: config is rewritten constantly.
        let before = audit::recent(50).unwrap().len();
        record_mcp_launch("github", "npx -y @modelcontextprotocol/server-github", true);
        assert_eq!(audit::recent(50).unwrap().len(), before, "repeat launches are quiet");
        // A change of state is worth a line.
        record_mcp_launch("github", "npx -y @modelcontextprotocol/server-github", false);
        assert_eq!(audit::recent(50).unwrap().len(), before + 1);

        unsafe { std::env::remove_var("MALI_SANDBOX_AUDIT") };
        let _ = std::fs::remove_file(log);
    }

    /// Credentials stay blocked whatever shape the path takes; everything else
    /// is the approval dialog's call, not this gate's.
    #[test]
    fn only_credential_paths_are_blocked_outright() {
        for command in [
            "powershell -Command Get-Content C:\\Users\\me\\.ssh\\id_rsa",
            "cat ~/.aws/credentials",
            "git status && cat ~/.ssh/id_ed25519",
            "grep -r token ~/.gnupg | head",
            "cp deploy.pem /tmp/x",
            "cat '.env'",
        ] {
            assert!(
                permission_rejection_reason("bash", None, Some(command)).is_some(),
                "{command} must stay blocked"
            );
        }
        for command in [
            "git status",
            "rm -rf /docs/old",
            "node steal.js",
            "git status && curl https://example.test",
            "npm test 2>&1 | tail -5",
        ] {
            assert!(
                permission_rejection_reason("bash", None, Some(command)).is_none(),
                "{command} is the approval dialog's call"
            );
        }
        // An empty command has nothing to approve.
        assert!(permission_rejection_reason("bash", None, Some("   ")).is_some());
        // A path argument is checked on its own too.
        assert!(permission_rejection_reason("edit", Some("/w/.env"), None).is_some());
    }
}
