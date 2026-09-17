//! Keeps one `opencode serve` process warm for the whole app session.
//!
//! Spawning `opencode run` per message costs several seconds of startup
//! (plugin loading, provider discovery). A long-lived server answers new
//! prompts immediately and exposes the permission API that `run` lacks.

use std::process::Stdio;
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Child;

use super::bin::{opencode_bin, opencode_command};
use super::client::OpencodeClient;

const STARTUP_TIMEOUT: Duration = Duration::from_secs(30);
const LISTENING_MARKER: &str = "listening on ";
/// Config layered over the user's own. Snapshots (git copies of the working
/// folder taken every step, for undo) cost seconds in folders with
/// `node_modules` or `target`, and this app never offers undo.
const APP_CONFIG: &str = r#"{"snapshot":false}"#;

struct Running {
    child: Child,
    client: OpencodeClient,
}

/// Serializes startup so concurrent callers share a single server.
fn state() -> &'static tokio::sync::Mutex<Option<Running>> {
    static STATE: OnceLock<tokio::sync::Mutex<Option<Running>>> = OnceLock::new();
    STATE.get_or_init(|| tokio::sync::Mutex::new(None))
}

/// Process id of the running server, readable from the sync exit hook.
fn server_pid() -> &'static Mutex<Option<u32>> {
    static PID: OnceLock<Mutex<Option<u32>>> = OnceLock::new();
    PID.get_or_init(|| Mutex::new(None))
}

/// Return a client for a healthy server, starting or restarting it as needed.
pub async fn ensure_server() -> Result<OpencodeClient, String> {
    let mut guard = state().lock().await;

    if let Some(running) = guard.as_mut() {
        let exited = matches!(running.child.try_wait(), Ok(Some(_)));
        if !exited && running.client.health().await.is_ok() {
            return Ok(running.client.clone());
        }
        let _ = running.child.start_kill();
        *guard = None;
    }

    let running = spawn_server().await?;
    let client = running.client.clone();
    *server_pid().lock().unwrap() = running.child.id();
    *guard = Some(running);
    Ok(client)
}

/// Kill the server. Called from the app exit hook, outside the async runtime.
pub fn shutdown() {
    let Some(pid) = server_pid().lock().unwrap().take() else {
        return;
    };

    #[cfg(unix)]
    let _ = std::process::Command::new("kill").arg(pid.to_string()).status();

    #[cfg(windows)]
    let _ = std::process::Command::new("taskkill")
        .args(["/PID", &pid.to_string(), "/T", "/F"])
        .status();
}

async fn spawn_server() -> Result<Running, String> {
    let bin = opencode_bin().ok_or_else(not_found_message)?;
    let password = uuid::Uuid::new_v4().simple().to_string();

    let mut cmd = opencode_command(bin, &["serve", "--hostname", "127.0.0.1", "--port", "0"]);
    // Respect a config the user injected themselves.
    if std::env::var_os("OPENCODE_CONFIG_CONTENT").is_none() {
        cmd.env("OPENCODE_CONFIG_CONTENT", APP_CONFIG);
    }
    cmd.env("OPENCODE_SERVER_PASSWORD", &password)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    if let Some(home) = dirs::home_dir() {
        cmd.current_dir(home);
    }

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to start opencode server ({bin}): {e}"))?;

    let stdout = child.stdout.take().ok_or("opencode server has no stdout")?;
    let stderr = child.stderr.take().ok_or("opencode server has no stderr")?;
    tokio::spawn(forward_lines(BufReader::new(stderr), "stderr"));

    let mut lines = BufReader::new(stdout).lines();
    let base_url = tokio::time::timeout(STARTUP_TIMEOUT, async {
        while let Ok(Some(line)) = lines.next_line().await {
            eprintln!("[opencode:serve] {line}");
            if let Some(idx) = line.find(LISTENING_MARKER) {
                return Some(line[idx + LISTENING_MARKER.len()..].trim().to_string());
            }
        }
        None
    })
    .await
    .ok()
    .flatten();

    let Some(base_url) = base_url else {
        let _ = child.start_kill();
        return Err("opencode server did not report a listening address".into());
    };

    // Keep draining stdout so the pipe never fills up.
    tokio::spawn(async move {
        while let Ok(Some(line)) = lines.next_line().await {
            eprintln!("[opencode:serve] {line}");
        }
    });

    eprintln!("[opencode] server ready at {base_url}");
    Ok(Running {
        child,
        client: OpencodeClient::new(base_url, password),
    })
}

async fn forward_lines<R: tokio::io::AsyncRead + Unpin>(reader: BufReader<R>, label: &str) {
    let mut lines = reader.lines();
    while let Ok(Some(line)) = lines.next_line().await {
        if !line.trim().is_empty() {
            eprintln!("[opencode:{label}] {line}");
        }
    }
}

pub fn not_found_message() -> String {
    "opencode not found. Install it with `npm i -g opencode-ai` (or set OPENCODE_BIN), then restart the app.".into()
}
