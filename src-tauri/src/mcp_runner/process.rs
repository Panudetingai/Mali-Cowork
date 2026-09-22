//! Spawn an MCP server inside the runner's sandbox.

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
#[cfg(windows)]
use std::os::windows::io::AsRawHandle;

use crate::sandbox::{AccessDecision, SandboxPolicy};

#[cfg(windows)]
use super::job::Job;
use super::policy::load_policy;

/// Environment variables that are known credentials and must never reach an
/// untrusted MCP process. The list is conservative: it strips cloud keys even
/// when the user might have intended them for the server, because trusted
/// servers should be explicitly marked as trusted.
const SENSITIVE_ENV_PREFIXES: &[&str] = &[
    "AWS_",
    "AZURE_",
    "GOOGLE_APPLICATION_CREDENTIALS",
    "GCLOUD_",
    "GITHUB_TOKEN",
    "GITLAB_TOKEN",
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
    "GEMINI_API_KEY",
    "ANTIGRAVITY_API_KEY",
    "GROQ_API_KEY",
    "DEEPSEEK_API_KEY",
    "MISTRAL_API_KEY",
    "COHERE_API_KEY",
    "HF_TOKEN",
    "DOCKER_CONFIG",
    "NETRC",
    "NPM_TOKEN",
    "PYPI_TOKEN",
];

/// Environment keys whose values often contain absolute paths to credential
/// stores or to the user's home.
const SENSITIVE_ENV_NAMES: &[&str] = &[
    "SSH_AUTH_SOCK",
    "GNUPGHOME",
    "KUBECONFIG",
    "AWS_CONFIG_FILE",
    "AWS_SHARED_CREDENTIALS_FILE",
];

pub struct Child {
    pub process: std::process::Child,
    #[cfg(windows)]
    pub job: Option<Job>,
}

/// Prepare the environment the MCP child actually receives.
fn sanitized_env(
    policy: &SandboxPolicy,
    parent: impl Iterator<Item = (std::ffi::OsString, std::ffi::OsString)>,
) -> Vec<(String, String)> {
    let mut out = Vec::new();
    // A policy that asks before `shell.exec` is one written for an untrusted
    // server (see `SandboxPolicy::for_mcp`); a policy without the key at all
    // was written for a trusted one. The fallback must therefore be `Allow`,
    // or every server would look untrusted.
    let untrusted = !matches!(
        policy.tool_decision("shell.exec", AccessDecision::Allow),
        AccessDecision::Allow
    );

    for (key, value) in parent {
        let key_str = key.to_string_lossy().to_ascii_uppercase();
        // A credential the user configured for *this* server is its own: the
        // app lists those names in the policy, and only ambient credentials
        // that happen to sit in the app's environment are stripped.
        let granted = policy
            .credentials
            .allow_names
            .iter()
            .any(|name| name.eq_ignore_ascii_case(&key_str));
        if !granted {
            if SENSITIVE_ENV_NAMES.contains(&key_str.as_str()) {
                continue;
            }
            if SENSITIVE_ENV_PREFIXES.iter().any(|prefix| key_str.starts_with(prefix)) {
                continue;
            }
        }
        // Unknown-trust MCPs should not inherit the parent PATH blindly when a
        // minimal one was already supplied by the app. Since we cannot tell here
        // whether PATH came from the app or the system, we keep it but strip
        // entries that are obviously user scripts.
        if key_str == "PATH" {
            if untrusted {
                if let Some(sanitized) = sanitize_path(&value) {
                    out.push((key_str, sanitized));
                    continue;
                }
            }
        }
        out.push((
            key.to_string_lossy().into_owned(),
            value.to_string_lossy().into_owned(),
        ));
    }

    // When the policy grants no network, point the HTTP stack at a discard
    // address so that even if the job-object/network filter is bypassed, direct
    // outbound calls fail. This is a mitigation, not a guarantee; a determined
    // process can ignore these variables. Real isolation needs
    // AppContainer/WFP/namespaces. Most MCP servers exist to call an API, so
    // the app grants network unless it was told otherwise.
    if !policy.network.enabled {
        out.retain(|(k, _)| k.to_ascii_uppercase() != "HTTP_PROXY" && k.to_ascii_uppercase() != "HTTPS_PROXY");
        out.push(("HTTP_PROXY".into(), "127.0.0.1:9".into()));
        out.push(("HTTPS_PROXY".into(), "127.0.0.1:9".into()));
        out.push(("NO_PROXY".into(), "".into()));
    }

    out
}

/// Remove directories that look like personal scripts from PATH.
fn sanitize_path(value: &std::ffi::OsString) -> Option<String> {
    let mut kept = Vec::new();
    for part in std::env::split_paths(value) {
        let s = part.to_string_lossy().to_ascii_lowercase();
        if s.contains("download") || s.contains("temp") || s.contains("tmp") {
            // Keep system temp, drop anything that looks like a user download folder.
            if s.ends_with("\\temp") || s.ends_with("/tmp") || s.contains("windows\\temp") {
                kept.push(part);
            }
            continue;
        }
        kept.push(part);
    }
    std::env::join_paths(kept).ok().map(|p| p.to_string_lossy().into_owned())
}

/// Resolve a working directory that is isolated from the user's project.
pub fn work_dir(_policy: &SandboxPolicy, override_dir: Option<&Path>) -> PathBuf {
    if let Some(dir) = override_dir {
        return dir.to_path_buf();
    }
    dirs::data_local_dir()
        .unwrap_or_else(std::env::temp_dir)
        .join("mali-cowork")
        .join("mcp-runner")
}

/// Build and spawn the real MCP command. The returned [`Child`] owns the
/// process-tree boundary.
pub fn spawn(
    policy_path: &Path,
    command: &[String],
    work_dir_override: Option<&Path>,
) -> Result<Child, String> {
    let policy = load_policy(policy_path)?;

    let (program, args) = command
        .split_first()
        .ok_or_else(|| "MCP command is empty".to_string())?;
    let program_path = resolve_program(program)?;
    if !policy.allows_program(&program_path) {
        return Err(format!(
            "Sandbox policy denies launcher '{program}'. Shell interpreters and untrusted runtimes are not allowed."
        ));
    }

    let work = work_dir(&policy, work_dir_override);
    std::fs::create_dir_all(&work).map_err(|e| format!("Cannot create runner work dir {work:?}: {e}"))?;

    let mut cmd = Command::new(&program_path);
    cmd.args(args)
        .current_dir(&work)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let env = sanitized_env(&policy, std::env::vars_os());
    cmd.env_clear();
    for (k, v) in env {
        cmd.env(k, v);
    }

    let child = cmd.spawn().map_err(|e| format!("Cannot spawn MCP {program:?}: {e}"))?;

    // Only Windows has a job object to contain the tree in; on Unix the
    // runner's own process group is the boundary (see `job.rs`).
    #[cfg(windows)]
    let job = {
        let handle = child.as_raw_handle();
        if handle.is_null() {
            None
        } else {
            super::job::contain(handle, &policy.resources)
        }
    };

    Ok(Child {
        process: child,
        #[cfg(windows)]
        job,
    })
}

/// A relative binary is searched on the sanitized PATH; an absolute path is
/// returned as-is if it exists. On Windows, `.exe` is appended when the name
/// has no extension.
fn resolve_program(name: &str) -> Result<PathBuf, String> {
    let candidate = PathBuf::from(name);
    if candidate.is_absolute() {
        if candidate.is_file() {
            return Ok(candidate);
        }
        for with_ext in executable_candidates(&candidate) {
            if with_ext.is_file() {
                return Ok(with_ext);
            }
        }
    }
    let candidates: Vec<PathBuf> = std::iter::once(candidate.clone())
        .chain(executable_candidates(&candidate))
        .collect();
    if let Some(path) = std::env::var_os("PATH").and_then(|p| {
        std::env::split_paths(&p)
            .flat_map(|dir| candidates.iter().map(move |c| dir.join(c)))
            .find(|full| full.is_file())
    }) {
        return Ok(path);
    }
    if candidate.is_file() {
        return Ok(candidate);
    }
    for with_ext in executable_candidates(&candidate) {
        if with_ext.is_file() {
            return Ok(with_ext);
        }
    }
    Err(format!("Cannot find MCP program '{name}'"))
}

fn executable_candidates(base: &Path) -> Vec<PathBuf> {
    #[cfg(not(windows))]
    let _ = base;
    #[cfg(windows)]
    {
        if base.extension().is_none() {
            return vec![
                base.with_extension("exe"),
                base.with_extension("cmd"),
                base.with_extension("bat"),
            ];
        }
    }
    Vec::new()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sandbox::McpTrustLevel;
    use std::ffi::OsString;

    fn env(pairs: &[(&str, &str)]) -> Vec<(OsString, OsString)> {
        pairs.iter().map(|(k, v)| (OsString::from(k), OsString::from(v))).collect()
    }

    fn value<'a>(env: &'a [(String, String)], key: &str) -> Option<&'a str> {
        env.iter().find(|(k, _)| k == key).map(|(_, v)| v.as_str())
    }

    #[test]
    fn the_servers_own_token_survives_while_ambient_keys_are_stripped() {
        let mut policy = SandboxPolicy::for_mcp(McpTrustLevel::Unknown);
        policy.credentials.allow_names = vec!["GITHUB_TOKEN".into()];
        let parent = env(&[
            ("GITHUB_TOKEN", "for-this-server"),
            ("OPENAI_API_KEY", "not-its-business"),
            ("SSH_AUTH_SOCK", "/tmp/agent.sock"),
            ("HOME", "/Users/me"),
        ]);
        let sanitized = sanitized_env(&policy, parent.into_iter());
        assert_eq!(value(&sanitized, "GITHUB_TOKEN"), Some("for-this-server"));
        assert_eq!(value(&sanitized, "HOME"), Some("/Users/me"));
        assert_eq!(value(&sanitized, "OPENAI_API_KEY"), None);
        assert_eq!(value(&sanitized, "SSH_AUTH_SOCK"), None);
    }

    #[test]
    fn network_is_left_alone_unless_the_policy_denies_it() {
        let granted = SandboxPolicy::for_mcp(McpTrustLevel::Unknown);
        let sanitized = sanitized_env(&granted, env(&[("HOME", "/Users/me")]).into_iter());
        assert_eq!(value(&sanitized, "HTTPS_PROXY"), None, "an MCP server may call its API");

        let mut denied = granted.clone();
        denied.network.enabled = false;
        let sanitized = sanitized_env(&denied, env(&[("HOME", "/Users/me")]).into_iter());
        assert_eq!(value(&sanitized, "HTTPS_PROXY"), Some("127.0.0.1:9"));
    }

    #[test]
    fn the_app_own_shell_wrapper_would_be_refused() {
        let policy = SandboxPolicy::default();
        assert!(!policy.allows_program(Path::new("/bin/sh")));
        assert!(policy.allows_program(Path::new("/usr/local/bin/npx")));
    }
}
