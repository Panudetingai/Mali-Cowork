use std::path::Path;

use super::policy::{AccessDecision, SandboxPolicy};

/// Process policy is evaluated against a resolved executable, never a shell
/// string. Shell interpreters are denied by default because they can turn an
/// approved argument into a second command.
pub fn evaluate_program(policy: &SandboxPolicy, executable: &Path) -> AccessDecision {
    let Some(name) = executable.file_name().and_then(|name| name.to_str()) else {
        return AccessDecision::Deny;
    };
    let name = name.trim_end_matches(".exe").to_ascii_lowercase();
    if [
        "cmd",
        "powershell",
        "pwsh",
        "sh",
        "bash",
        "zsh",
        "python",
        "python3",
    ]
    .contains(&name.as_str())
    {
        return AccessDecision::Deny;
    }
    if policy
        .process
        .allow
        .iter()
        .any(|allowed| allowed.eq_ignore_ascii_case(&name))
    {
        AccessDecision::Allow
    } else {
        AccessDecision::Deny
    }
}
