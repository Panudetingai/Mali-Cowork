//! Sync MCP servers from the app into OpenCode (config file + live server).
//!
//! Robustness notes:
//! - The GUI process often has a smaller `PATH` than the user's terminal, so
//!   `uvx`/`npx` may resolve in a terminal but not for the opencode server.
//!   We resolve the binary to an absolute path before registering it.
//! - `uvx <pkg>` downloads on first run (slow). Config gets a generous
//!   `timeout`, and the UI sends fallback launch methods (uvx → pip binary →
//!   `python -m` → docker) which we try in order until one connects.
//! - Errors from `mcp_add` / `mcp_connect` are captured per server instead of
//!   ignored, so the UI can tell the user what to install.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use super::opencode::OpencodeClient;
use super::opencode::warm_up_server as ensure_server;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServerEntry {
    pub id: String,
    pub enabled: bool,
    pub command: Vec<String>,
    #[serde(default)]
    pub fallbacks: Vec<Vec<String>>,
    #[serde(default)]
    pub environment: HashMap<String, String>,
    #[serde(default)]
    pub timeout_ms: Option<u64>,
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
    /// Desktop Microsoft Word (Word MCP live edit on Windows). `null` off Windows.
    pub microsoft_word: Option<bool>,
}

/// Extra folders where `uv`/`uvx` usually live but GUI `PATH` may miss.
fn extra_bin_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if let Some(home) = dirs::home_dir() {
        dirs.push(home.join(".local").join("bin"));
        dirs.push(home.join(".cargo").join("bin"));
        #[cfg(windows)]
        {
            dirs.push(home.join("AppData").join("Local").join("Programs").join("uv"));
            // astral install.ps1 default
            dirs.push(home.join(".local").join("bin"));
        }
    }
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
        let _ = base;
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
    for dir in search {
        for candidate in executable_candidates(&dir, binary) {
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    None
}

/// Replace `argv[0]` with its absolute path when found. Keeps argv unchanged
/// when the binary cannot be resolved (server will report the spawn error).
fn resolve_argv(argv: &[String]) -> Vec<String> {
    if argv.is_empty() {
        return Vec::new();
    }
    let mut out = argv.to_vec();
    if let Some(full) = find_binary(&argv[0]) {
        out[0] = full.to_string_lossy().to_string();
    }
    out
}

fn microsoft_word_installed() -> bool {
    #[cfg(windows)]
    {
        if find_binary("winword").is_some() {
            return true;
        }
        let roots = [
            r"C:\Program Files\Microsoft Office\root\Office16\WINWORD.EXE",
            r"C:\Program Files (x86)\Microsoft Office\root\Office16\WINWORD.EXE",
            r"C:\Program Files\Microsoft Office\Office16\WINWORD.EXE",
        ];
        return roots.iter().any(|p| Path::new(p).is_file());
    }
    #[cfg(not(windows))]
    {
        false
    }
}

fn word_failure_hint(_binary: &str, detail: &str) -> String {
    let mut steps: Vec<&str> = Vec::new();
    if find_binary("uvx").is_none() && find_binary("uv").is_none() {
        steps.push("ติดตั้ง uv: powershell -c \"irm https://astral.sh/uv/install.ps1 | iex\"");
        steps.push("ปิดแล้วเปิด Mali Cowork ใหม่ (ให้ PATH มี uvx)");
    }
    if detail.contains("Connection closed") || detail.contains("-32000") {
        steps.push("ครั้งแรก uvx โหลด word-mcp-live อาจใช้ 1–2 นาที — กด Connect แล้วรอ (timeout 2 นาที)");
    }
    #[cfg(windows)]
    if !microsoft_word_installed() {
        steps.push("ติดตั้ง Microsoft Word (Desktop) — live edit ใช้ Word COM บน Windows");
    }
    if steps.is_empty() {
        return format!(
            "{detail} — ลองวิธีเชื่อมอื่นในเมนู “วิธีเชื่อม” หรือ pip install word-mcp-live"
        );
    }
    format!("{detail} — {}", steps.join(" · "))
}

fn hint_for_binary(binary: &str) -> &'static str {
    match binary {
        "uvx" | "uv" => "ติดตั้ง uv ก่อน: powershell -c \"irm https://astral.sh/uv/install.ps1 | iex\" แล้ว restart แอป (ครั้งแรก uvx จะโหลด package อาจช้า 1–2 นาที)",
        "npx" | "bunx" | "node" | "npm" | "bun" => "ต้องมี Node.js (หรือ Bun) และต่อเน็ตโหลด package ครั้งแรก",
        "docker" => "ต้องมี Docker Desktop รันอยู่ — โหมด Docker ของ Word ใช้ได้เฉพาะ cross-platform tools (live edit ต้องติดตั้งแบบ native)",
        "python" | "python3" | "py" => "ต้องมี Python 3.11+ และ pip install word-mcp-live",
        "word-mcp-live" => "ต้อง pip install word-mcp-live ก่อน หรือใช้วิธี uvx แทน",
        _ => "ตรวจว่าโปรแกรมนี้อยู่ใน PATH แล้วลองใหม่",
    }
}

fn opencode_config_path() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or("Cannot resolve home directory")?;
    Ok(home.join(".config").join("opencode").join("opencode.json"))
}

fn write_opencode_mcp_config(servers: &[McpServerEntry]) -> Result<(), String> {
    let path = opencode_config_path()?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Cannot create {}: {e}", parent.display()))?;
    }

    let mut config: Value = if path.is_file() {
        let raw = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
        serde_json::from_str(&raw).unwrap_or(json!({}))
    } else {
        json!({})
    };

    let mut mcp = serde_json::Map::new();
    for server in servers {
        if server.enabled {
            let mut entry = json!({
                "type": "local",
                "command": resolve_argv(&server.command),
                "enabled": true,
                "timeout": server.timeout_ms.unwrap_or(60_000),
            });
            if !server.environment.is_empty() {
                entry["environment"] = json!(server.environment);
            }
            mcp.insert(server.id.clone(), entry);
        } else {
            mcp.insert(server.id.clone(), json!({ "enabled": false }));
        }
    }
    config["mcp"] = Value::Object(mcp);

    let pretty = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
    std::fs::write(&path, pretty).map_err(|e| format!("Cannot write {}: {e}", path.display()))?;
    Ok(())
}

fn local_config(command: &[String], environment: &HashMap<String, String>, timeout_ms: Option<u64>) -> Value {
    let mut config = json!({
        "type": "local",
        "command": resolve_argv(command),
        "enabled": true,
        "timeout": timeout_ms.unwrap_or(60_000),
    });
    if !environment.is_empty() {
        config["environment"] = json!(environment);
    }
    config
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

fn status_map(status: &Value) -> Option<&serde_json::Map<String, Value>> {
    status.as_object()
}

/// Try every launch variant for one server until the live status is `connected`.
async fn connect_server(
    client: &OpencodeClient,
    directory: Option<&str>,
    server: &McpServerEntry,
) -> McpServerStatus {
    let mut candidates: Vec<&Vec<String>> = Vec::with_capacity(1 + server.fallbacks.len());
    candidates.push(&server.command);
    for fallback in &server.fallbacks {
        if !fallback.is_empty() && fallback != &server.command {
            candidates.push(fallback);
        }
    }

    let mut last_error: Option<String> = None;
    let binary = server
        .command
        .first()
        .cloned()
        .unwrap_or_default();

    for (attempt, candidate) in candidates.iter().enumerate() {
        let config = local_config(candidate, &server.environment, server.timeout_ms);
        if let Err(e) = client.mcp_add(directory, &server.id, &config).await {
            last_error = Some(format!("register failed (วิธีที่ {}): {e}", attempt + 1));
            continue;
        }
        if let Err(e) = client.mcp_connect(directory, &server.id).await {
            last_error = Some(format!("connect failed (วิธีที่ {}): {e}", attempt + 1));
            continue;
        }
        match client.mcp_status(directory).await {
            Ok(status) => {
                if let Some(map) = status_map(&status) {
                    if let Some(entry) = map.get(&server.id) {
                        let st = entry
                            .get("status")
                            .and_then(Value::as_str)
                            .unwrap_or("unknown");
                        if st == "connected" {
                            return parse_status(&server.id, entry, None);
                        }
                        let server_error = entry
                            .get("error")
                            .and_then(Value::as_str)
                            .map(str::to_string);
                        last_error = server_error.or_else(|| {
                            Some(format!("server รายงานสถานะ '{st}' (วิธีที่ {})", attempt + 1))
                        });
                        // `failed` may still succeed with another launcher; anything
                        // else (e.g. oauth flow) is final.
                        if st != "failed" && st != "unknown" {
                            return parse_status(&server.id, entry, last_error);
                        }
                    }
                }
            }
            Err(e) => {
                last_error = Some(format!("อ่านสถานะไม่ได้ (วิธีที่ {}): {e}", attempt + 1));
            }
        }
    }

    // All variants exhausted — attach an actionable hint.
    match client.mcp_status(directory).await {
        Ok(status) => {
            if let Some(map) = status_map(&status) {
                if let Some(entry) = map.get(&server.id) {
                    let mut st = parse_status(&server.id, entry, last_error.clone());
                    if st.status != "connected" {
                        let hint = hint_for_binary(&binary);
                        let detail = st.error.unwrap_or_else(|| "เชื่อมไม่ได้".into());
                        if server.id == "word" {
                            st.error = Some(word_failure_hint(&binary, &detail));
                        } else {
                            st.error = Some(format!("{detail} — วิธีแก้: {hint}"));
                        }
                    }
                    return st;
                }
            }
            McpServerStatus {
                id: server.id.clone(),
                status: "failed".into(),
                error: last_error,
            }
        }
        Err(e) => McpServerStatus {
            id: server.id.clone(),
            status: "failed".into(),
            error: Some(format!(
                "{}. วิธีแก้: {}",
                last_error.unwrap_or(e),
                hint_for_binary(&binary)
            )),
        },
    }
}

async fn apply_live(
    client: &OpencodeClient,
    directory: Option<&str>,
    servers: &[McpServerEntry],
) -> Result<Vec<McpServerStatus>, String> {
    let mut out = Vec::new();
    for server in servers {
        if server.enabled {
            out.push(connect_server(client, directory, server).await);
        } else {
            let _ = client.mcp_disconnect(directory, &server.id).await;
            // Confirm the disabled state when the status map still lists it.
            match client.mcp_status(directory).await {
                Ok(status) => {
                    if let Some(map) = status_map(&status) {
                        if let Some(entry) = map.get(&server.id) {
                            out.push(parse_status(&server.id, entry, None));
                            continue;
                        }
                    }
                    out.push(McpServerStatus {
                        id: server.id.clone(),
                        status: "disabled".into(),
                        error: None,
                    });
                }
                Err(_) => out.push(McpServerStatus {
                    id: server.id.clone(),
                    status: "disabled".into(),
                    error: None,
                }),
            }
        }
    }
    Ok(out)
}

/// Persist MCP choices to `~/.config/opencode/opencode.json` and register them on the running server.
#[tauri::command]
pub async fn mcp_sync(
    servers: Vec<McpServerEntry>,
    directory: Option<String>,
) -> Result<McpSyncResult, String> {
    write_opencode_mcp_config(&servers)?;
    let client = ensure_server().await?;
    let dir = directory.as_deref().filter(|d| !d.trim().is_empty());
    let statuses = apply_live(&client, dir, &servers).await?;
    Ok(McpSyncResult { servers: statuses })
}

/// Read MCP status from the running OpenCode server without changing config.
#[tauri::command]
pub async fn mcp_status(directory: Option<String>) -> Result<Vec<McpServerStatus>, String> {
    let client = ensure_server().await?;
    let dir = directory.as_deref().filter(|d| !d.trim().is_empty());
    let status = client.mcp_status(dir).await?;
    let mut out = Vec::new();
    if let Some(map) = status.as_object() {
        for (id, entry) in map {
            out.push(parse_status(id, entry, None));
        }
    }
    Ok(out)
}

/// Check which launcher binaries (uvx, npx, docker, …) exist for MCP diagnostics.
#[tauri::command]
pub fn mcp_diagnose() -> McpDiagnoseResult {
    let binaries = ["uvx", "uv", "python", "node", "npx", "bunx", "docker"]
        .into_iter()
        .map(|binary| match find_binary(binary) {
            Some(path) => McpBinaryStatus {
                binary: binary.to_string(),
                found: true,
                path: Some(path.to_string_lossy().to_string()),
            },
            None => McpBinaryStatus {
                binary: binary.to_string(),
                found: false,
                path: None,
            },
        })
        .collect();
    #[cfg(windows)]
    let microsoft_word = Some(microsoft_word_installed());
    #[cfg(not(windows))]
    let microsoft_word = None;
    McpDiagnoseResult {
        binaries,
        microsoft_word,
    }
}
