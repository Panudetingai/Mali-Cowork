//! The user's MCP servers as the app describes them: validation, finding the
//! launcher on `PATH`, the sandbox runner around local servers, and the hints
//! shown when one fails. Mali's own hub (`crate::mcp_hub`) connects them; the
//! CLI agents reach them through its `mali` gateway (see `mcp_bridge`).
//!
//! Robustness notes:
//! - The GUI process often has a smaller `PATH` than the user's terminal, so
//!   `uvx`/`npx` may resolve in a terminal but not for the opencode server.
//!   We resolve the binary to an absolute path before registering it.
//! - `uvx <pkg>` downloads on first run (slow). Config gets a generous
//!   `timeout`, and the UI sends fallback launch methods which we try in
//!   order until one connects.
//! - Everything coming from the UI is validated: ids end up in URL paths and
//!   commands are spawned, so neither may be arbitrary.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::mcp_runner::runner_binary_path;
use crate::sandbox::{McpTrustLevel, SandboxPolicy};

const DEFAULT_TIMEOUT_MS: u64 = 60_000;
const MAX_TIMEOUT_MS: u64 = 600_000;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServerEntry {
    pub id: String,
    pub enabled: bool,
    /// `local` (spawn a command) or `remote` (connect to a URL).
    #[serde(default = "default_kind")]
    pub kind: String,
    #[serde(default)]
    pub command: Vec<String>,
    #[serde(default)]
    pub fallbacks: Vec<Vec<String>>,
    #[serde(default)]
    pub environment: HashMap<String, String>,
    #[serde(default)]
    pub url: Option<String>,
    #[serde(default)]
    pub headers: HashMap<String, String>,
    #[serde(default)]
    pub timeout_ms: Option<u64>,
    /// New MCPs are unknown. Registry provenance is deliberately not trusted.
    #[serde(default)]
    pub trust_level: McpTrustLevel,
}

fn default_kind() -> String {
    "local".into()
}

impl McpServerEntry {
    pub(crate) fn is_remote(&self) -> bool {
        self.kind == "remote"
    }

    pub(crate) fn timeout(&self) -> u64 {
        self.timeout_ms
            .unwrap_or(DEFAULT_TIMEOUT_MS)
            .clamp(5_000, MAX_TIMEOUT_MS)
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServerStatus {
    pub id: String,
    pub status: String,
    pub error: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpSyncResult {
    pub servers: Vec<McpServerStatus>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpBinaryStatus {
    pub binary: String,
    pub found: bool,
    pub path: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpDiagnoseResult {
    pub binaries: Vec<McpBinaryStatus>,
    /// `windows`, `macos` or `linux`, for platform-specific install hints.
    pub platform: &'static str,
}

// ── validation ──

fn valid_id(id: &str) -> bool {
    let mut chars = id.chars();
    matches!(chars.next(), Some(c) if c.is_ascii_alphanumeric())
        && id.len() <= 64
        && chars.all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

fn valid_env_name(name: &str) -> bool {
    let mut chars = name.chars();
    matches!(chars.next(), Some(c) if c.is_ascii_alphabetic() || c == '_')
        && name.len() <= 128
        && chars.all(|c| c.is_ascii_alphanumeric() || c == '_')
}

fn valid_header_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 128
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "-_!#$%&'*+.^`|~".contains(c))
}

fn no_control_chars(value: &str) -> bool {
    !value.chars().any(|c| c.is_control())
}

/// Remote servers must use HTTPS, except on this machine.
fn validate_url(raw: &str) -> Result<String, String> {
    let url = reqwest::Url::parse(raw.trim()).map_err(|_| format!("Invalid URL: {raw}"))?;
    let local = matches!(
        url.host_str(),
        Some("localhost") | Some("127.0.0.1") | Some("[::1]") | Some("::1")
    );
    match url.scheme() {
        "https" => Ok(url.to_string()),
        "http" if local => Ok(url.to_string()),
        "http" => Err("Remote MCP needs https:// (http is for localhost only)".into()),
        other => Err(format!("Unsupported scheme {other}:// — use https://")),
    }
}

pub(crate) fn validate(server: &McpServerEntry) -> Result<(), String> {
    if !valid_id(&server.id) {
        return Err(format!(
            "Invalid MCP id '{}' — use a-z, 0-9, - or _ (max 64)",
            server.id
        ));
    }
    if !server.enabled {
        return Ok(());
    }
    // Constructing the policy here makes the default explicit at the only
    // ingress where an MCP may be enabled. The runner receives the same
    // policy once OpenCode exposes a launch interception hook.
    let _policy = SandboxPolicy::for_mcp(server.trust_level);
    match server.kind.as_str() {
        "local" => {
            if server.command.first().is_none_or(|c| c.trim().is_empty()) {
                return Err(format!("{}: command is required", server.id));
            }
            let argv_ok = std::iter::once(&server.command)
                .chain(server.fallbacks.iter())
                .flatten()
                .all(|arg| no_control_chars(arg));
            if !argv_ok {
                return Err(format!("{}: command has invalid characters", server.id));
            }
            for (name, value) in &server.environment {
                if !valid_env_name(name) || !no_control_chars(value) {
                    return Err(format!("{}: invalid env variable '{name}'", server.id));
                }
            }
        }
        "remote" => {
            validate_url(server.url.as_deref().unwrap_or_default())
                .map_err(|e| format!("{}: {e}", server.id))?;
            for (name, value) in &server.headers {
                if !valid_header_name(name) || !no_control_chars(value) {
                    return Err(format!("{}: invalid header '{name}'", server.id));
                }
            }
        }
        other => return Err(format!("{}: unknown type '{other}'", server.id)),
    }
    Ok(())
}

// ── binaries ──

/// Extra folders where `uv`/`uvx`/`node` usually live but GUI `PATH` may miss,
/// plus the app's own folder, which holds the sandbox runner and is never on
/// `PATH`.
fn extra_bin_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if let Some(app_dir) = std::env::current_exe().ok().and_then(|exe| exe.parent().map(Path::to_path_buf)) {
        dirs.push(app_dir);
    }
    if let Some(home) = dirs::home_dir() {
        dirs.push(home.join(".local").join("bin"));
        dirs.push(home.join(".cargo").join("bin"));
        dirs.push(home.join(".bun").join("bin"));
        #[cfg(windows)]
        {
            dirs.push(
                home.join("AppData")
                    .join("Local")
                    .join("Programs")
                    .join("uv"),
            );
            dirs.push(home.join("AppData").join("Roaming").join("npm"));
        }
    }
    #[cfg(target_os = "macos")]
    {
        dirs.push(PathBuf::from("/opt/homebrew/bin"));
        dirs.push(PathBuf::from("/usr/local/bin"));
    }
    #[cfg(windows)]
    dirs.push(PathBuf::from(r"C:\Program Files\nodejs"));
    dirs
}

fn executable_candidates(dir: &Path, base: &str) -> Vec<PathBuf> {
    #[cfg(windows)]
    {
        if base.to_lowercase().ends_with(".exe") {
            return vec![dir.join(base)];
        }
        vec![
            dir.join(format!("{base}.exe")),
            dir.join(format!("{base}.cmd")),
            dir.join(format!("{base}.bat")),
            dir.join(base),
        ]
    }
    #[cfg(not(windows))]
    {
        vec![dir.join(base)]
    }
}

/// Find `binary` on `PATH` plus well-known install dirs. Returns absolute path.
fn find_binary(binary: &str) -> Option<PathBuf> {
    if binary.contains('/') || binary.contains('\\') {
        let p = PathBuf::from(binary);
        return p.is_file().then_some(p);
    }
    // The app's own helper, which hosts the built-in servers. It ships beside
    // the app and is never on `PATH`, so it is looked up the same way the
    // sandbox wrapper finds it.
    if Path::new(binary).file_stem().and_then(|s| s.to_str()) == Some("mali-mcp-runner") {
        if let Some(runner) = runner_binary_path() {
            return Some(runner);
        }
    }
    let mut search: Vec<PathBuf> = Vec::new();
    if let Some(path) = std::env::var_os("PATH") {
        search.extend(std::env::split_paths(&path));
    }
    search.extend(extra_bin_dirs());
    search
        .iter()
        .flat_map(|dir| executable_candidates(dir, binary))
        .find(|candidate| candidate.is_file())
}

/// Replace `argv[0]` with its absolute path when found. Keeps argv unchanged
/// when the binary cannot be resolved (server will report the spawn error).
pub(crate) fn resolve_argv(argv: &[String]) -> Vec<String> {
    let mut out = argv.to_vec();
    if let Some(full) = argv.first().and_then(|bin| find_binary(bin)) {
        out[0] = full.to_string_lossy().to_string();
    }
    out
}

/// Servers that always write a file into the folder they start in, with no
/// setting to stop it: `@mkusaka/mcp-shell-server` writes `mcp-shell.log`.
/// Agents start MCP servers in the user's working folder, so these are
/// started in the app's own folder instead.
const WRITES_TO_CWD: [&str; 1] = ["@mkusaka/mcp-shell-server"];

fn mcp_work_dir() -> PathBuf {
    dirs::data_local_dir()
        .unwrap_or_else(std::env::temp_dir)
        .join("mali-cowork")
        .join("mcp")
}

fn mcp_policy_path(server_id: &str) -> PathBuf {
    mcp_work_dir().join(format!("policy-{server_id}.json"))
}

fn write_mcp_policy(server: &McpServerEntry) -> Result<PathBuf, String> {
    let path = mcp_policy_path(&server.id);
    let mut policy = SandboxPolicy::for_mcp(server.trust_level);
    // Tokens the user configured for this server belong to it, so the runner
    // must not strip them along with the app's own ambient credentials.
    policy.credentials.allow_names = server.environment.keys().cloned().collect();
    let text = serde_json::to_string_pretty(&policy).map_err(|e| e.to_string())?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(&path, text).map_err(|e| e.to_string())?;
    Ok(path)
}

/// True for servers that drop files in their working folder.
fn writes_to_cwd(argv: &[String]) -> bool {
    argv.iter().any(|arg| WRITES_TO_CWD.iter().any(|pkg| arg.starts_with(pkg)))
}

/// The argv written to agent configs: `argv[0]` resolved, and servers from
/// [`WRITES_TO_CWD`] started in [`mcp_work_dir`] so their files stay out of
/// the user's folders. The runner sets the working folder itself, so it passes
/// `shell_wrapper: false` — it refuses to launch `/bin/sh`.
fn launch_argv(argv: &[String]) -> Vec<String> {
    launch_argv_with(argv, true)
}

fn launch_argv_with(argv: &[String], shell_wrapper: bool) -> Vec<String> {
    let resolved = resolve_argv(argv);
    if !cfg!(unix) || !shell_wrapper || !writes_to_cwd(argv) {
        return resolved;
    }
    let dir = mcp_work_dir();
    if std::fs::create_dir_all(&dir).is_err() {
        return resolved;
    }
    // `$0` is the folder, `$@` the real command.
    let mut out: Vec<String> = vec![
        "/bin/sh".into(),
        "-c".into(),
        r#"cd "$0" && exec "$@""#.into(),
        dir.to_string_lossy().into_owned(),
    ];
    out.extend(resolved);
    out
}

/// `PATH` for the MCP child, so `npx` can find `node` even from a GUI launch.
fn child_path() -> Option<String> {
    let mut paths: Vec<PathBuf> = std::env::var_os("PATH")
        .map(|p| std::env::split_paths(&p).collect())
        .unwrap_or_default();
    for dir in extra_bin_dirs() {
        if dir.is_dir() && !paths.contains(&dir) {
            paths.push(dir);
        }
    }
    std::env::join_paths(paths)
        .ok()
        .map(|p| p.to_string_lossy().to_string())
}

fn uv_install_hint() -> &'static str {
    if cfg!(windows) {
        "Install uv: powershell -c \"irm https://astral.sh/uv/install.ps1 | iex\", then restart the app"
    } else {
        "Install uv: curl -LsSf https://astral.sh/uv/install.sh | sh, then restart the app"
    }
}

fn word_failure_hint(detail: &str) -> String {
    let mut steps: Vec<&str> = Vec::new();
    if find_binary("uvx").is_none() {
        steps.push(uv_install_hint());
    }
    if detail.contains("Connection closed")
        || detail.contains("-32000")
        || detail.contains("timed out")
    {
        steps.push("First run downloads office-word-mcp-server (~1 min); press Connect and wait");
    }
    steps.push("Or install it yourself: pip install office-word-mcp-server, then choose \"pip\"");
    format!("{detail} — {}", steps.join(" · "))
}

fn hint_for_binary(binary: &str) -> &'static str {
    let name = Path::new(binary)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or(binary);
    match name {
        "uvx" | "uv" => uv_install_hint(),
        "npx" | "bunx" | "node" | "npm" | "bun" => {
            "Needs Node.js (or Bun) and internet for the first download"
        }
        "docker" => "Needs Docker Desktop running",
        "python" | "python3" | "py" => "Needs Python 3.11+ on PATH",
        // Shipped inside the app; missing means a broken install, not a
        // missing tool the user could go and fetch.
        "mali-mcp-runner" => "Part of Mali Cowork — reinstall the app to restore it",
        _ => "Check the command runs in a terminal and is on PATH, then retry",
    }
}

// ── config ──

pub(crate) fn opencode_config_path() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or("Cannot resolve home directory")?;
    Ok(home.join(".config").join("opencode").join("opencode.json"))
}

pub(crate) fn server_config(server: &McpServerEntry, command: &[String]) -> Value {
    if server.is_remote() {
        let mut config = json!({
            "type": "remote",
            "url": server.url.as_deref().unwrap_or_default().trim(),
            "enabled": true,
            "timeout": server.timeout(),
        });
        if !server.headers.is_empty() {
            config["headers"] = json!(server.headers);
        }
        return config;
    }

    let mut environment = server.environment.clone();
    if !environment.contains_key("PATH") {
        if let Some(path) = child_path() {
            environment.insert("PATH".into(), path);
        }
    }
    json!({
        "type": "local",
        "command": runner_wrapped_argv(server, command),
        "enabled": true,
        "timeout": server.timeout(),
        "environment": environment,
    })
}

/// Wrap a resolved MCP argv with the sandbox runner when the runner binary is
/// available. The runner receives a JSON policy file derived from the server's
/// trust level so that OS-level restrictions can be applied even though
/// OpenCode spawned the process.
fn runner_wrapped_argv(server: &McpServerEntry, command: &[String]) -> Vec<String> {
    let unwrapped = |reason: &str| {
        let argv = launch_argv(command);
        eprintln!("[mcp] {} starts unsandboxed: {reason}", server.id);
        crate::sandbox::record_mcp_launch(&server.id, &argv.join(" "), false);
        argv
    };
    let Some(runner) = runner_binary_path() else {
        return unwrapped("the runner binary is not next to the app");
    };
    let policy_path = match write_mcp_policy(server) {
        Ok(p) => p,
        Err(e) => return unwrapped(&format!("cannot write its policy ({e})")),
    };
    let mut argv = vec![
        runner.to_string_lossy().into_owned(),
        "--policy".into(),
        policy_path.to_string_lossy().into_owned(),
    ];
    // Servers that write next to themselves get the same private folder the
    // `/bin/sh` wrapper used to give them, without the shell.
    if writes_to_cwd(command) {
        let dir = mcp_work_dir();
        if std::fs::create_dir_all(&dir).is_ok() {
            argv.extend(["--work-dir".into(), dir.to_string_lossy().into_owned()]);
        }
    }
    argv.push("--".into());
    argv.extend(launch_argv_with(command, false));
    crate::sandbox::record_mcp_launch(&server.id, &command.join(" "), true);
    argv
}

pub(crate) fn codex_config_path() -> Result<PathBuf, String> {
    let base = std::env::var("CODEX_HOME")
        .ok()
        .filter(|s| !s.trim().is_empty())
        .map(PathBuf::from)
        .or_else(|| dirs::home_dir().map(|h| h.join(".codex")))
        .ok_or("Cannot resolve Codex home directory")?;
    Ok(base.join("config.toml"))
}

pub(crate) fn failure_message(server: &McpServerEntry, detail: String) -> String {
    if server.id == "word" {
        return word_failure_hint(&detail);
    }
    if server.is_remote() {
        return format!("{detail} — check the URL, headers/token and that the server is up");
    }
    let binary = server
        .command
        .first()
        .map(String::as_str)
        .unwrap_or_default();
    format!("{detail} — Fix: {}", hint_for_binary(binary))
}

/// Check which launcher binaries (uvx, npx, docker, …) exist for MCP diagnostics.
#[tauri::command]
pub fn mcp_diagnose() -> McpDiagnoseResult {
    let binaries = ["uvx", "npx", "node", "python3", "docker"]
        .into_iter()
        .map(|binary| {
            let found = find_binary(binary).or_else(|| {
                // Windows installs Python as `python`.
                (binary == "python3")
                    .then(|| find_binary("python"))
                    .flatten()
            });
            McpBinaryStatus {
                binary: binary.to_string(),
                found: found.is_some(),
                path: found.map(|p| p.to_string_lossy().to_string()),
            }
        })
        .collect();
    let platform = if cfg!(windows) {
        "windows"
    } else if cfg!(target_os = "macos") {
        "macos"
    } else {
        "linux"
    };
    McpDiagnoseResult { binaries, platform }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(id: &str) -> McpServerEntry {
        McpServerEntry {
            id: id.into(),
            enabled: true,
            kind: "local".into(),
            command: vec!["npx".into(), "-y".into(), "pkg".into()],
            fallbacks: vec![],
            environment: HashMap::new(),
            url: None,
            headers: HashMap::new(),
            timeout_ms: None,
            trust_level: McpTrustLevel::Unknown,
        }
    }

    #[test]
    fn rejects_ids_that_could_escape_url_paths() {
        assert!(validate(&entry("word")).is_ok());
        assert!(validate(&entry("custom-my_server1")).is_ok());
        for bad in ["", "../x", "a/b", "a b", "-x", "ก"] {
            assert!(validate(&entry(bad)).is_err(), "{bad:?} should be rejected");
        }
    }

    #[test]
    fn remote_requires_https_except_localhost() {
        let mut server = entry("remote");
        server.kind = "remote".into();
        server.url = Some("http://example.com/mcp".into());
        assert!(validate(&server).is_err());
        server.url = Some("https://example.com/mcp".into());
        assert!(validate(&server).is_ok());
        server.url = Some("http://localhost:3000/mcp".into());
        assert!(validate(&server).is_ok());
        server.url = Some("file:///etc/passwd".into());
        assert!(validate(&server).is_err());
    }

    #[test]
    fn rejects_bad_env_and_headers() {
        let mut server = entry("x");
        server.environment.insert("BAD NAME".into(), "v".into());
        assert!(validate(&server).is_err());

        let mut remote = entry("y");
        remote.kind = "remote".into();
        remote.url = Some("https://example.com".into());
        remote
            .headers
            .insert("Authorization".into(), "Bearer a\r\nX-Evil: 1".into());
        assert!(validate(&remote).is_err());
    }

    #[test]
    fn disabled_entries_skip_command_checks() {
        let mut server = entry("off");
        server.enabled = false;
        server.command.clear();
        assert!(validate(&server).is_ok());
    }

    #[test]
    #[cfg(unix)]
    fn shell_server_starts_outside_the_users_folders() {
        let argv: Vec<String> = ["npx", "-y", "@mkusaka/mcp-shell-server"]
            .map(String::from)
            .into();
        let launched = launch_argv(&argv);
        assert_eq!(&launched[..2], ["/bin/sh", "-c"]);
        assert_eq!(launched[3], mcp_work_dir().to_string_lossy());
        assert!(launched
            .last()
            .unwrap()
            .starts_with("@mkusaka/mcp-shell-server"));

        // Other servers keep starting in the working folder.
        let other: Vec<String> = ["npx", "-y", "@modelcontextprotocol/server-filesystem"]
            .map(String::from)
            .into();
        assert_eq!(launch_argv(&other).len(), 3);
    }
}
