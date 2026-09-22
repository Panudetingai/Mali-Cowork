//! Sync MCP servers from the app into OpenCode (config + live) and Codex (`config.toml`).
//!
//! Robustness notes:
//! - The GUI process often has a smaller `PATH` than the user's terminal, so
//!   `uvx`/`npx` may resolve in a terminal but not for the opencode server.
//!   We resolve the binary to an absolute path before registering it.
//! - `uvx <pkg>` downloads on first run (slow). Config gets a generous
//!   `timeout`, and the UI sends fallback launch methods which we try in
//!   order until one connects.
//! - Only servers the app manages are written to `opencode.json`; entries the
//!   user added by hand are kept. The file is replaced atomically.
//! - Syncs are serialized, and a server already connected with the same
//!   config is left alone, so syncing before every prompt stays cheap.
//! - Everything coming from the UI is validated: ids end up in URL paths and
//!   commands are spawned, so neither may be arbitrary.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use toml_edit::{Array, DocumentMut, InlineTable, Item, Table, Value as TomlValue};

use super::mcp_clients;
use super::mcp_oauth::{self, Callback};
use super::opencode::warm_up_server as ensure_server;
use super::opencode::{lease_instance, session_dir, OpencodeClient, DEFAULT_INSTANCE};
use super::secure_fs::write_private;
use crate::mcp_runner::runner_binary_path;
use crate::sandbox::{McpTrustLevel, SandboxPolicy};

const DEFAULT_TIMEOUT_MS: u64 = 60_000;
const MAX_TIMEOUT_MS: u64 = 600_000;
/// Ids of servers the user created in Settings → MCP (see `features/mcp/custom.ts`).
const CUSTOM_PREFIX: &str = "custom-";

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
    fn is_remote(&self) -> bool {
        self.kind == "remote"
    }

    fn timeout(&self) -> u64 {
        self.timeout_ms
            .unwrap_or(DEFAULT_TIMEOUT_MS)
            .clamp(5_000, MAX_TIMEOUT_MS)
    }
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct McpSyncOptions {
    /// Only (re)connect these ids live; the config file still gets every server.
    #[serde(default)]
    pub targets: Option<Vec<String>>,
    /// Ids the app no longer manages (deleted custom servers).
    #[serde(default)]
    pub removed: Vec<String>,
    /// `chat`: connect in Chat mode's session folder instead of `directory`.
    #[serde(default)]
    pub mode: Option<String>,
    /// When false, only write config files (OpenCode JSON + Codex TOML) — no live connect.
    #[serde(default)]
    pub live_connect: Option<bool>,
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

fn validate(server: &McpServerEntry) -> Result<(), String> {
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

/// Extra folders where `uv`/`uvx`/`node` usually live but GUI `PATH` may miss.
fn extra_bin_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
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
fn resolve_argv(argv: &[String]) -> Vec<String> {
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
        _ => "Check the command runs in a terminal and is on PATH, then retry",
    }
}

// ── config ──

fn opencode_config_path() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or("Cannot resolve home directory")?;
    Ok(home.join(".config").join("opencode").join("opencode.json"))
}

fn server_config(server: &McpServerEntry, command: &[String]) -> Value {
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
        // Sign in as Mali Cowork (our registered client) instead of OpenCode.
        if let Some(oauth) =
            mcp_oauth::oauth_config_for(&server.id, server.url.as_deref().unwrap_or_default())
        {
            config["oauth"] = oauth;
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

fn write_opencode_mcp_config(servers: &[McpServerEntry], removed: &[String]) -> Result<(), String> {
    let path = opencode_config_path()?;
    let mut config: Value = if path.is_file() {
        let raw = std::fs::read_to_string(&path)
            .map_err(|e| format!("Can't read {}: {e}", path.display()))?;
        if raw.trim().is_empty() {
            json!({})
        } else {
            // Never overwrite a file we cannot parse: it is the user's own config.
            serde_json::from_str(&raw).map_err(|e| {
                format!(
                    "{} isn't valid JSON ({e}) — fix the file and retry",
                    path.display()
                )
            })?
        }
    } else {
        json!({ "$schema": "https://opencode.ai/config.json" })
    };
    if !config.is_object() {
        return Err(format!("{} must be a JSON object", path.display()));
    }

    let mut mcp = config
        .get("mcp")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    for id in removed {
        mcp.remove(id);
    }
    // Custom servers are always sent in full, so a `custom-*` id that is
    // missing was deleted (perhaps while OpenCode was not running).
    let sent: HashSet<&str> = servers.iter().map(|s| s.id.as_str()).collect();
    mcp.retain(|id, _| !id.starts_with(CUSTOM_PREFIX) || sent.contains(id.as_str()));
    for server in servers {
        let entry = if server.enabled {
            server_config(server, &server.command)
        } else {
            // opencode accepts a bare `enabled: false` to switch a server off.
            json!({ "enabled": false })
        };
        mcp.insert(server.id.clone(), entry);
    }
    config["mcp"] = Value::Object(mcp);

    let pretty = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
    write_private(&path, &pretty)
}

fn codex_config_path() -> Result<PathBuf, String> {
    let base = std::env::var("CODEX_HOME")
        .ok()
        .filter(|s| !s.trim().is_empty())
        .map(PathBuf::from)
        .or_else(|| dirs::home_dir().map(|h| h.join(".codex")))
        .ok_or("Cannot resolve Codex home directory")?;
    Ok(base.join("config.toml"))
}

/// MCP servers in Codex's `config.toml` that read files or run commands.
/// Codex runs MCP servers outside its sandbox, so read-only runs switch
/// these off with `-c mcp_servers.<id>.enabled=false`.
pub(crate) fn codex_workspace_mcp_overrides() -> Vec<String> {
    let Ok(raw) =
        codex_config_path().and_then(|p| std::fs::read_to_string(p).map_err(|e| e.to_string()))
    else {
        return Vec::new();
    };
    let Ok(doc) = raw.parse::<DocumentMut>() else {
        return Vec::new();
    };
    ["exec", "filesystem"]
        .into_iter()
        .filter(|id| doc.get("mcp_servers").and_then(|t| t.get(id)).is_some())
        .flat_map(|id| ["-c".to_string(), format!("mcp_servers.{id}.enabled=false")])
        .collect()
}

fn codex_env_table(server: &McpServerEntry) -> InlineTable {
    let mut environment = server.environment.clone();
    if !environment.contains_key("PATH") {
        if let Some(path) = child_path() {
            environment.insert("PATH".into(), path);
        }
    }
    let mut env = InlineTable::new();
    for (key, value) in environment {
        env.insert(key.as_str(), TomlValue::from(value));
    }
    env
}

fn codex_http_headers(server: &McpServerEntry) -> InlineTable {
    let mut headers = InlineTable::new();
    for (key, value) in &server.headers {
        headers.insert(key.as_str(), TomlValue::from(value.clone()));
    }
    headers
}

fn codex_set(table: &mut Table, key: &str, value: TomlValue) {
    table.insert(key, Item::Value(value));
}

fn codex_server_table(server: &McpServerEntry, argv: &[String]) -> Table {
    let mut table = Table::new();
    table.set_implicit(false);
    if !server.enabled {
        codex_set(&mut table, "enabled", TomlValue::from(false));
        return table;
    }

    codex_set(&mut table, "enabled", TomlValue::from(true));
    let startup_sec = server.timeout().div_ceil(1000).clamp(5, 600);

    if server.is_remote() {
        codex_set(
            &mut table,
            "url",
            TomlValue::from(server.url.as_deref().unwrap_or_default().trim()),
        );
        if !server.headers.is_empty() {
            codex_set(
                &mut table,
                "http_headers",
                TomlValue::InlineTable(codex_http_headers(server)),
            );
        }
        codex_set(
            &mut table,
            "startup_timeout_sec",
            TomlValue::from(startup_sec as i64),
        );
        return table;
    }

    let resolved = runner_wrapped_argv(server, argv);
    if let Some(command) = resolved.first() {
        codex_set(&mut table, "command", TomlValue::from(command.as_str()));
    }
    if resolved.len() > 1 {
        let mut args = Array::new();
        for arg in &resolved[1..] {
            args.push(TomlValue::from(arg.as_str()));
        }
        codex_set(&mut table, "args", TomlValue::Array(args));
    }
    let env = codex_env_table(server);
    if !env.is_empty() {
        codex_set(&mut table, "env", TomlValue::InlineTable(env));
    }
    codex_set(
        &mut table,
        "startup_timeout_sec",
        TomlValue::from(startup_sec as i64),
    );
    table
}

/// Mirror MCP choices into `~/.codex/config.toml` so Codex CLI picks them up
/// without spawning servers until a Codex run needs them.
fn write_codex_mcp_config(servers: &[McpServerEntry], removed: &[String]) -> Result<(), String> {
    let path = codex_config_path()?;
    let mut doc: DocumentMut = if path.is_file() {
        let raw = std::fs::read_to_string(&path)
            .map_err(|e| format!("Can't read {}: {e}", path.display()))?;
        if raw.trim().is_empty() {
            DocumentMut::new()
        } else {
            raw.parse().map_err(|e| {
                format!(
                    "{} isn't valid TOML ({e}) — fix the file and retry",
                    path.display()
                )
            })?
        }
    } else {
        DocumentMut::new()
    };

    let mcp_item = doc
        .entry("mcp_servers")
        .or_insert(Item::Table(Table::new()));
    let mcp = mcp_item
        .as_table_mut()
        .ok_or("mcp_servers in config.toml must be a table")?;

    for id in removed {
        mcp.remove(id);
    }
    let sent: HashSet<String> = servers.iter().map(|s| s.id.clone()).collect();
    mcp.retain(|id, _| !id.starts_with(CUSTOM_PREFIX) || sent.contains(id));

    for server in servers {
        let argv = if server.enabled && !server.is_remote() {
            resolve_argv(&server.command)
        } else {
            server.command.clone()
        };
        mcp.insert(
            server.id.as_str(),
            Item::Table(codex_server_table(server, &argv)),
        );
    }

    write_private(&path, &doc.to_string())
}

// ── live server ──

/// Config last applied per `(directory, id)` that reached `connected`.
fn applied() -> &'static Mutex<HashMap<(String, String), String>> {
    static APPLIED: OnceLock<Mutex<HashMap<(String, String), String>>> = OnceLock::new();
    APPLIED.get_or_init(Default::default)
}

fn sync_lock() -> &'static tokio::sync::Mutex<()> {
    static LOCK: OnceLock<tokio::sync::Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| tokio::sync::Mutex::new(()))
}

fn applied_key(directory: Option<&str>, id: &str) -> (String, String) {
    (directory.unwrap_or_default().to_string(), id.to_string())
}

fn parse_status(id: &str, value: &Value, fallback_error: Option<String>) -> McpServerStatus {
    let status = value
        .get("status")
        .and_then(Value::as_str)
        .unwrap_or("unknown")
        .to_string();
    let error = value
        .get("error")
        .and_then(Value::as_str)
        .map(str::to_string)
        .or(fallback_error);
    McpServerStatus {
        id: id.to_string(),
        status,
        error,
    }
}

async fn live_entry(
    client: &OpencodeClient,
    directory: Option<&str>,
    id: &str,
) -> Result<Option<Value>, String> {
    let status = client.mcp_status(directory).await?;
    Ok(status.get(id).cloned())
}

fn failure_message(server: &McpServerEntry, detail: String) -> String {
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

/// Try every launch variant for one server until the live status is `connected`.
async fn connect_server(
    client: &OpencodeClient,
    directory: Option<&str>,
    server: &McpServerEntry,
) -> McpServerStatus {
    let mut candidates: Vec<&Vec<String>> = vec![&server.command];
    if !server.is_remote() {
        for fallback in &server.fallbacks {
            if !fallback.is_empty() && !candidates.contains(&fallback) {
                candidates.push(fallback);
            }
        }
    }

    // Already connected with one of these configs: nothing to do.
    let key = applied_key(directory, &server.id);
    let known = applied().lock().unwrap().get(&key).cloned();
    if let Some(known) = known {
        let same = candidates
            .iter()
            .any(|c| server_config(server, c).to_string() == known);
        if same {
            if let Ok(Some(entry)) = live_entry(client, directory, &server.id).await {
                if entry["status"] == "connected" {
                    return parse_status(&server.id, &entry, None);
                }
            }
        }
    }

    let mut last_error: Option<String> = None;
    for (attempt, candidate) in candidates.iter().enumerate() {
        let config = server_config(server, candidate);
        let method = attempt + 1;
        if let Err(e) = client.mcp_add(directory, &server.id, &config).await {
            last_error = Some(format!("Registration failed (method {method}): {e}"));
            continue;
        }
        if let Err(e) = client.mcp_connect(directory, &server.id).await {
            last_error = Some(format!("Connection failed (method {method}): {e}"));
            continue;
        }
        match live_entry(client, directory, &server.id).await {
            Ok(Some(entry)) => {
                let st = entry["status"].as_str().unwrap_or("unknown");
                if st == "connected" {
                    applied().lock().unwrap().insert(key, config.to_string());
                    return parse_status(&server.id, &entry, None);
                }
                last_error = entry["error"]
                    .as_str()
                    .map(str::to_string)
                    .or_else(|| Some(format!("Status '{st}' (method {method})")));
                // `failed` may still succeed with another launcher; anything
                // else (e.g. an OAuth flow) is final.
                if st != "failed" && st != "unknown" {
                    return parse_status(&server.id, &entry, last_error);
                }
            }
            Ok(None) => last_error = Some(format!("No status after connecting (method {method})")),
            Err(e) => last_error = Some(format!("Can't read status (method {method}): {e}")),
        }
    }

    applied().lock().unwrap().remove(&key);
    McpServerStatus {
        id: server.id.clone(),
        status: "failed".into(),
        error: Some(failure_message(
            server,
            last_error.unwrap_or_else(|| "Couldn't connect".into()),
        )),
    }
}

async fn disconnect_server(client: &OpencodeClient, directory: Option<&str>, id: &str) {
    applied()
        .lock()
        .unwrap()
        .remove(&applied_key(directory, id));
    let _ = client.mcp_disconnect(directory, id).await;
}

/// Persist MCP choices to `~/.config/opencode/opencode.json` and register them on the running server.
#[tauri::command]
pub async fn mcp_sync(
    servers: Vec<McpServerEntry>,
    directory: Option<String>,
    options: Option<McpSyncOptions>,
) -> Result<McpSyncResult, String> {
    let options = options.unwrap_or_default();
    for server in &servers {
        validate(server)?;
    }
    let mut seen = HashSet::new();
    if let Some(dup) = servers.iter().find(|s| !seen.insert(s.id.as_str())) {
        return Err(format!("Duplicate MCP id: {}", dup.id));
    }
    let removed: Vec<String> = options
        .removed
        .into_iter()
        .filter(|id| valid_id(id) && !seen.contains(id.as_str()))
        .collect();

    let _guard = sync_lock().lock().await;
    write_opencode_mcp_config(&servers, &removed)?;
    write_codex_mcp_config(&servers, &removed)?;
    // Antigravity CLI and Cursor get the same connectors (best effort).
    for warning in mcp_clients::write_all(&servers, resolve_argv, child_path()) {
        eprintln!("[mcp] {warning}");
    }
    // A deleted connector's sign-in client isn't needed any more.
    for id in &removed {
        let _ = mcp_oauth::forget(id);
    }

    if !options.live_connect.unwrap_or(true) {
        return Ok(McpSyncResult { servers: vec![] });
    }

    let client = ensure_server().await?;
    let chat_dir = if options.mode.as_deref() == Some("chat") {
        let dir = session_dir(Some("chat"), None);
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        Some(dir.to_string_lossy().into_owned())
    } else {
        None
    };
    let dir = chat_dir.as_deref().or_else(|| {
        directory
            .as_deref()
            .map(str::trim)
            .filter(|d| !d.is_empty())
    });
    // Don't let the idle sweep close this instance while servers connect.
    let _instance = lease_instance(dir.unwrap_or(DEFAULT_INSTANCE)).await;
    let targets: Option<HashSet<&str>> = options
        .targets
        .as_ref()
        .map(|t| t.iter().map(String::as_str).collect());

    for id in &removed {
        disconnect_server(&client, dir, id).await;
    }

    let mut out = Vec::new();
    for server in &servers {
        if targets
            .as_ref()
            .is_some_and(|t| !t.contains(server.id.as_str()))
        {
            continue;
        }
        if server.enabled {
            out.push(connect_server(&client, dir, server).await);
        } else {
            disconnect_server(&client, dir, &server.id).await;
            out.push(McpServerStatus {
                id: server.id.clone(),
                status: "disabled".into(),
                error: None,
            });
        }
    }
    Ok(McpSyncResult { servers: out })
}

/// The folder a live MCP call runs in: Chat mode's session folder or a Cowork folder.
fn live_dir(directory: Option<String>, mode: Option<&str>) -> Result<Option<String>, String> {
    if mode == Some("chat") {
        let dir = session_dir(Some("chat"), None);
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        return Ok(Some(dir.to_string_lossy().into_owned()));
    }
    Ok(directory
        .map(|d| d.trim().to_string())
        .filter(|d| !d.is_empty()))
}

/// Sign in to a remote MCP server with OAuth. OpenCode opens the provider's
/// page in the user's browser, receives the callback on loopback (PKCE) and
/// keeps the tokens in its owner-only auth file: they never reach the
/// webview, the chat or the model.
#[tauri::command]
pub async fn mcp_auth(
    app: tauri::AppHandle,
    id: String,
    directory: Option<String>,
    mode: Option<String>,
) -> Result<McpServerStatus, String> {
    if !valid_id(&id) {
        return Err(format!("Invalid MCP id '{id}'"));
    }
    let client = ensure_server().await?;
    let dir = live_dir(directory, mode.as_deref())?;
    let _instance = lease_instance(dir.as_deref().unwrap_or(DEFAULT_INSTANCE)).await;

    let status = match mcp_oauth::registered_url(&id) {
        Some(url) => branded_sign_in(&app, &client, dir.as_deref(), &id, &url).await?,
        // No client of our own (the server has no dynamic registration): OpenCode's flow.
        None => client.mcp_authenticate(dir.as_deref(), &id).await.map_err(|e| {
            if e.contains("Unsupported") || e.contains("OAuth") {
                format!("This server doesn't support sign-in with OAuth. Add its token instead. ({e})")
            } else if e.contains("timed out") {
                "Sign-in wasn't finished in time. Try again.".to_string()
            } else {
                e
            }
        })?,
    };
    applied()
        .lock()
        .unwrap()
        .remove(&applied_key(dir.as_deref(), &id));
    Ok(parse_status(&id, &status, None))
}

/// OAuth as Mali Cowork: OpenCode prepares the request (PKCE + state) with
/// our client, we open the browser and take the callback on loopback.
async fn branded_sign_in(
    app: &tauri::AppHandle,
    client: &OpencodeClient,
    dir: Option<&str>,
    id: &str,
    server_url: &str,
) -> Result<Value, String> {
    use tauri_plugin_opener::OpenerExt;

    let service = reqwest::Url::parse(server_url)
        .ok()
        .and_then(|u| u.host_str().map(str::to_string))
        .unwrap_or_else(|| "the service".into());
    // Bind first: OpenCode then sees the port taken and leaves the callback to us.
    let mut callback = mcp_oauth::listen(id).await?;
    let started = client.mcp_auth_start(dir, id).await?;
    let authorize = started["authorizationUrl"]
        .as_str()
        .unwrap_or_default()
        .to_string();
    let state = started["oauthState"]
        .as_str()
        .unwrap_or_default()
        .to_string();
    if authorize.is_empty() {
        // Already signed in: report the live status.
        return Ok(live_entry(client, dir, id)
            .await?
            .unwrap_or_else(|| json!({ "status": "connected" })));
    }
    let parsed = reqwest::Url::parse(&authorize)
        .map_err(|_| "The server sent an invalid sign-in link".to_string())?;
    if parsed.scheme() != "https" {
        return Err("The server's sign-in page isn't https; not opening it".into());
    }
    app.opener()
        .open_url(parsed.as_str(), None::<&str>)
        .map_err(|e| format!("Couldn't open the browser: {e}"))?;
    match callback.wait(&state, &service).await? {
        Callback::Code(code) => client.mcp_auth_callback(dir, id, &code).await,
        Callback::Denied(reason) => Err(format!("Sign-in was declined: {reason}")),
    }
}

/// Sign out of a remote MCP server: OpenCode deletes its stored tokens.
#[tauri::command]
pub async fn mcp_auth_remove(
    id: String,
    directory: Option<String>,
    mode: Option<String>,
) -> Result<(), String> {
    if !valid_id(&id) {
        return Err(format!("Invalid MCP id '{id}'"));
    }
    let client = ensure_server().await?;
    let dir = live_dir(directory, mode.as_deref())?;
    client.mcp_auth_remove(dir.as_deref(), &id).await?;
    disconnect_server(&client, dir.as_deref(), &id).await;
    Ok(())
}

/// Read MCP status from the running OpenCode server without changing config.
#[tauri::command]
pub async fn mcp_status(directory: Option<String>) -> Result<Vec<McpServerStatus>, String> {
    let client = ensure_server().await?;
    let dir = directory
        .as_deref()
        .map(str::trim)
        .filter(|d| !d.is_empty());
    let status = client.mcp_status(dir).await?;
    Ok(status
        .as_object()
        .into_iter()
        .flatten()
        .map(|(id, entry)| parse_status(id, entry, None))
        .collect())
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
    fn codex_table_splits_command_and_args() {
        let server = entry("github");
        let table = codex_server_table(&server, &server.command);
        assert_eq!(
            table
                .get("enabled")
                .and_then(|i| i.as_value())
                .and_then(|v| v.as_bool()),
            Some(true)
        );
        assert!(table.contains_key("command"));
        assert!(table
            .get("args")
            .and_then(|i| i.as_value())
            .and_then(|v| v.as_array())
            .is_some_and(|a| !a.is_empty()));
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

    #[test]
    fn codex_disabled_is_a_single_flag() {
        let mut server = entry("word");
        server.enabled = false;
        let table = codex_server_table(&server, &[]);
        assert_eq!(
            table
                .get("enabled")
                .and_then(|i| i.as_value())
                .and_then(|v| v.as_bool()),
            Some(false)
        );
        assert!(!table.contains_key("command"));
    }
}
