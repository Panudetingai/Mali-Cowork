//! Keeps one `opencode serve` process warm for the whole app session.
//!
//! Spawning `opencode run` per message costs several seconds of startup
//! (plugin loading, provider discovery). A long-lived server answers new
//! prompts immediately and exposes the permission API that `run` lacks.

use std::process::Stdio;
use std::sync::OnceLock;
use std::time::{Duration, Instant};

use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Child;

use super::bin::{opencode_bin, opencode_command};
use super::client::OpencodeClient;
use super::instances;
use crate::commands::supervisor::{self, Tree};

const STARTUP_TIMEOUT: Duration = Duration::from_secs(30);
const LISTENING_MARKER: &str = "listening on ";
/// A health check this recent is trusted without asking again.
const HEALTH_FRESH: Duration = Duration::from_secs(10);
/// Failed checks in a row before a running server counts as hung.
const HEALTH_ATTEMPTS: u32 = 3;
/// Config layered over the user's own. Snapshots (git copies of the working
/// folder taken every step, for undo) cost seconds in folders with
/// `node_modules` or `target`, and this app never offers undo. Providers set
/// up in Settings → Models (Ollama, OpenRouter) are added on top.
fn app_config() -> String {
    let mut config = serde_json::json!({ "snapshot": false });
    let providers = super::providers::load_overlay();
    if !providers.is_empty() {
        config["provider"] = serde_json::Value::Object(providers);
    }
    config.to_string()
}

struct Running {
    child: Child,
    /// The server and everything it started (MCP servers, their helpers).
    tree: Tree,
    client: OpencodeClient,
    /// Last time the server answered a health check.
    checked: Instant,
    /// Closes idle folder instances; see [`instances`].
    sweeper: tokio::task::JoinHandle<()>,
}

/// Serializes startup so concurrent callers share a single server.
fn state() -> &'static tokio::sync::Mutex<Option<Running>> {
    static STATE: OnceLock<tokio::sync::Mutex<Option<Running>>> = OnceLock::new();
    STATE.get_or_init(|| tokio::sync::Mutex::new(None))
}

/// Return a client for a healthy server, starting or restarting it as needed.
///
/// A server that is still running is only replaced after it failed several
/// health checks in a row. Replacing it on one slow answer used to pile up
/// servers (each with its own MCP servers) exactly when the machine was
/// already busy.
pub async fn ensure_server() -> Result<OpencodeClient, String> {
    let mut guard = state().lock().await;

    if let Some(running) = guard.as_mut() {
        match running.child.try_wait() {
            Ok(None) => {
                if running.checked.elapsed() < HEALTH_FRESH || responsive(&running.client).await {
                    running.checked = Instant::now();
                    return Ok(running.client.clone());
                }
                eprintln!("[opencode] server stopped answering; restarting it");
            }
            Ok(Some(status)) => eprintln!("[opencode] server exited ({status}); restarting it"),
            Err(e) => eprintln!("[opencode] can't check the server ({e}); restarting it"),
        }
        if let Some(running) = guard.take() {
            stop(running).await;
        }
    }

    let running = spawn_server().await?;
    let client = running.client.clone();
    *guard = Some(running);
    Ok(client)
}

/// A few health checks with a pause between them.
async fn responsive(client: &OpencodeClient) -> bool {
    for attempt in 1..=HEALTH_ATTEMPTS {
        if client.health().await.is_ok() {
            return true;
        }
        if attempt < HEALTH_ATTEMPTS {
            tokio::time::sleep(Duration::from_secs(attempt.into())).await;
        }
    }
    false
}

/// Stop the server and everything it started, waiting briefly for it to exit.
async fn stop(mut running: Running) {
    running.sweeper.abort();
    running.tree.stop();
    let _ = tokio::time::timeout(Duration::from_secs(5), running.child.wait()).await;
    instances::reset();
}

/// Stop the running server so the next call starts one with fresh config.
pub async fn restart() {
    if let Some(running) = state().lock().await.take() {
        stop(running).await;
    }
}

async fn spawn_server() -> Result<Running, String> {
    let bin = opencode_bin().ok_or_else(not_found_message)?;
    let password = uuid::Uuid::new_v4().simple().to_string();

    let mut cmd = supervisor::command(opencode_command(
        bin,
        &["serve", "--hostname", "127.0.0.1", "--port", "0"],
    ));
    // Respect a config the user injected themselves.
    if std::env::var_os("OPENCODE_CONFIG_CONTENT").is_none() {
        cmd.env("OPENCODE_CONFIG_CONTENT", app_config());
    }
    // Skills in ~/.claude/skills belong to Claude Code; offered here, they
    // pull the agent away from the MCP servers set up in this app.
    cmd.env("OPENCODE_DISABLE_CLAUDE_CODE_SKILLS", "1");
    cmd.env("OPENCODE_SERVER_PASSWORD", &password)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(home) = dirs::home_dir() {
        cmd.current_dir(home);
    }

    let (mut child, mut tree) = supervisor::spawn(&mut cmd, "opencode serve")
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
        tree.stop();
        let _ = tokio::time::timeout(Duration::from_secs(5), child.wait()).await;
        return Err("opencode server did not report a listening address".into());
    };

    // Keep draining stdout so the pipe never fills up.
    tokio::spawn(async move {
        while let Ok(Some(line)) = lines.next_line().await {
            eprintln!("[opencode:serve] {line}");
        }
    });

    eprintln!("[opencode] server ready at {base_url}");
    instances::reset();
    let client = OpencodeClient::new(base_url, password);
    Ok(Running {
        child,
        tree,
        sweeper: instances::spawn_sweeper(client.clone()),
        client,
        checked: Instant::now(),
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
