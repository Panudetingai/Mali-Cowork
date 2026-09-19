//! Onboarding: find what's missing on a new computer and install it, with
//! the user's go-ahead.
//!
//! - [`detect`]: which runtimes and agents are installed.
//! - [`recipes`]: the fixed install command for each tool and platform.
//! - [`simulate`]: a pretend new computer for testing (`MALI_SIMULATE_NEW_USER`).
//!
//! The UI first asks for a plan (`setup_plan`) and shows every command in
//! it; nothing runs until the user confirms and `setup_install` is called
//! for one tool at a time. Installs are supervised process trees, so
//! cancelling or quitting stops them completely.

mod detect;
mod recipes;
mod simulate;

use std::collections::HashMap;
use std::process::Stdio;
use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;
use tauri::ipc::Channel;
use tokio::io::{AsyncBufReadExt, BufReader};

use crate::commands::supervisor;
use detect::SetupScan;
use recipes::{Blocked, Recipe};

/// An install that takes longer than this is stopped.
const INSTALL_TIMEOUT: Duration = Duration::from_secs(15 * 60);
/// Codex sign-in waits for the browser this long.
const LOGIN_TIMEOUT: Duration = Duration::from_secs(5 * 60);

/// Installs that are running, by tool, so they can be cancelled.
static RUNNING: Mutex<Option<HashMap<String, u32>>> = Mutex::new(None);

#[derive(Serialize, Clone)]
#[serde(tag = "event", rename_all = "camelCase")]
pub enum SetupEvent {
    /// One line of the installer's output.
    Log { line: String },
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SetupPlan {
    /// In the order they will run: prerequisites first.
    pub steps: Vec<Recipe>,
    /// Tools that can't be installed automatically here, and why.
    pub blocked: Vec<Blocked>,
}

#[tauri::command]
pub async fn setup_scan() -> SetupScan {
    detect::scan().await
}

/// The commands that installing `tools` would run, prerequisites included.
#[tauri::command]
pub async fn setup_plan(tools: Vec<String>) -> SetupPlan {
    let scan = detect::scan().await;
    let installed = |id: &str| scan.tools.iter().any(|t| t.id == id && t.installed && !t.outdated);
    let mut wanted: Vec<String> = tools.into_iter().filter(|t| !installed(t)).collect();
    wanted.dedup();

    // npm-published agents need Node.js; add it first when it can be installed.
    let needs_node = wanted.iter().any(|t| matches!(t.as_str(), "opencode" | "codex" | "gemini"))
        && !installed("node")
        && !wanted.iter().any(|t| t == "node");
    let mut steps = Vec::new();
    let mut blocked = Vec::new();
    let mut node_coming = false;
    if needs_node || wanted.iter().any(|t| t == "node") {
        match recipes::recipe("node", &scan, false, false) {
            Ok(step) => {
                steps.push(step);
                node_coming = true;
            }
            // Agents with another way in (Homebrew, a script) still go ahead.
            Err(b) => {
                if wanted.iter().any(|t| t == "node") {
                    blocked.push(b);
                }
            }
        }
    }
    let user_prefix = npm_user_prefix().await;
    for tool in wanted.iter().filter(|t| *t != "node") {
        match recipes::recipe(tool, &scan, node_coming, user_prefix) {
            Ok(step) => steps.push(step),
            Err(b) => blocked.push(b),
        }
    }
    SetupPlan { steps, blocked }
}

/// Whether npm installs must go to `~/.npm-global` (its own folder needs admin).
async fn npm_user_prefix() -> bool {
    let Some(npm) = detect::find("npm") else { return false };
    let mut cmd = crate::commands::process::command(&npm.to_string_lossy(), &["prefix", "-g"]);
    cmd.kill_on_drop(true);
    if let Some(path) = detect::child_path() {
        cmd.env("PATH", path);
    }
    let Ok(Ok(out)) = tokio::time::timeout(Duration::from_secs(10), cmd.output()).await else {
        return false;
    };
    let prefix = String::from_utf8_lossy(&out.stdout).trim().to_string();
    !prefix.is_empty() && !recipes::npm_global_writable(std::path::Path::new(&prefix))
}

/// Install one tool, streaming its output. Resolves with a fresh scan once
/// the tool is found; fails if it can't be installed or isn't found after.
#[tauri::command]
pub async fn setup_install(tool: String, on_event: Channel<SetupEvent>) -> Result<SetupScan, String> {
    let log = |line: String| {
        let _ = on_event.send(SetupEvent::Log { line });
    };
    // Planned again here: the UI names the tool, the command comes from us.
    let scan = detect::scan().await;
    let recipe = recipes::recipe(&tool, &scan, false, npm_user_prefix().await).map_err(|b| b.reason)?;

    if simulate::enabled() {
        simulate::install(&tool, &recipe.display, log).await?;
        return Ok(detect::scan().await);
    }

    log(format!("$ {}", recipe.display));
    run(&recipe, &log).await?;

    let state = detect::tool(&tool).await;
    if !state.installed {
        return Err(format!(
            "The installer finished, but {} still isn't found. Restart the app; if it's still missing, run `{}` in a terminal.",
            state.name, recipe.display
        ));
    }
    log(format!("✓ {} is ready{}", state.name, state.path.map(|p| format!(" ({p})")).unwrap_or_default()));
    Ok(detect::scan().await)
}

async fn run(recipe: &Recipe, log: &impl Fn(String)) -> Result<(), String> {
    let program = detect::find(&recipe.program)
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_else(|| recipe.program.clone());
    let args: Vec<&str> = recipe.args.iter().map(String::as_str).collect();
    let mut cmd = supervisor::command(crate::commands::process::command(&program, &args));
    if let Some(path) = detect::child_path() {
        cmd.env("PATH", path);
    }
    // Never wait for a question nobody can answer.
    cmd.env("NONINTERACTIVE", "1")
        .env("HOMEBREW_NO_AUTO_UPDATE", "1")
        .env("HOMEBREW_NO_ENV_HINTS", "1")
        .env("npm_config_yes", "true")
        .env("CI", "1")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(home) = dirs::home_dir() {
        cmd.current_dir(home);
    }
    let (mut child, tree) = supervisor::spawn(&mut cmd, "installer").map_err(|e| format!("Couldn't start {}: {e}", recipe.program))?;
    RUNNING.lock().unwrap().get_or_insert_with(HashMap::new).insert(recipe.tool.clone(), tree.pid());

    let stdout = child.stdout.take().ok_or("installer has no output")?;
    let stderr = child.stderr.take().ok_or("installer has no output")?;
    let mut out = BufReader::new(stdout).lines();
    let mut err = BufReader::new(stderr).lines();
    let mut tail: Vec<String> = Vec::new();

    let work = async {
        let (mut out_done, mut err_done) = (false, false);
        while !(out_done && err_done) {
            let line = tokio::select! {
                l = out.next_line(), if !out_done => l.ok().flatten().or_else(|| { out_done = true; None }),
                l = err.next_line(), if !err_done => l.ok().flatten().or_else(|| { err_done = true; None }),
            };
            if let Some(line) = line.filter(|l| !l.trim().is_empty()) {
                tail.push(line.clone());
                if tail.len() > 20 {
                    tail.remove(0);
                }
                log(line);
            }
        }
        child.wait().await
    };
    let status = tokio::time::timeout(INSTALL_TIMEOUT, work).await;
    RUNNING.lock().unwrap().get_or_insert_with(HashMap::new).remove(&recipe.tool);
    drop(tree);
    match status {
        Err(_) => Err("The installer took too long and was stopped.".into()),
        Ok(Err(e)) => Err(e.to_string()),
        Ok(Ok(status)) if status.success() => Ok(()),
        Ok(Ok(status)) => Err(explain(&tail.join("\n"), &status.to_string())),
    }
}

/// The installer's failure in words, with the fix for common ones.
fn explain(output: &str, status: &str) -> String {
    let hint = if output.contains("EACCES") || output.contains("permission denied") {
        " It needs admin rights. Run the command in a terminal, or install Node.js with Homebrew/nvm so npm doesn't need them."
    } else if output.contains("ENOTFOUND") || output.contains("Could not resolve host") || output.contains("network") {
        " Check the internet connection and try again."
    } else if output.contains("EBADENGINE") || output.contains("Unsupported engine") {
        " Node.js is too old: install Node.js 20 or newer."
    } else {
        ""
    };
    let last = output.lines().rev().find(|l| !l.trim().is_empty()).unwrap_or(status);
    format!("Install failed: {last}.{hint}")
}

/// Stop a running install and everything it started.
#[tauri::command]
pub fn setup_cancel(tool: String) {
    if let Some(pid) = RUNNING.lock().unwrap().as_ref().and_then(|m| m.get(&tool).copied()) {
        supervisor::terminate(pid);
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoginResult {
    pub logged_in: bool,
    pub account: Option<String>,
}

/// `codex login`: opens the browser to sign in with ChatGPT and waits.
#[tauri::command]
pub async fn setup_codex_login() -> Result<LoginResult, String> {
    if simulate::enabled() {
        tokio::time::sleep(Duration::from_millis(1500)).await;
        return Ok(LoginResult { logged_in: true, account: Some("simulated@example.com".into()) });
    }
    let bin = crate::commands::codex::installed_bin().ok_or("Codex isn't installed yet.")?;
    let mut cmd = supervisor::command(crate::commands::process::command(bin, &["login"]));
    if let Some(path) = detect::child_path() {
        cmd.env("PATH", path);
    }
    cmd.stdout(Stdio::null()).stderr(Stdio::null());
    let (mut child, _tree) = supervisor::spawn(&mut cmd, "codex login").map_err(|e| e.to_string())?;
    let status = tokio::time::timeout(LOGIN_TIMEOUT, child.wait())
        .await
        .map_err(|_| "Sign-in timed out. Try again, and finish it in the browser window that opens.".to_string())?
        .map_err(|e| e.to_string())?;
    if !status.success() {
        return Err("Codex sign-in didn't finish. Try again.".into());
    }
    let check = crate::commands::codex::codex_check().await;
    Ok(LoginResult { logged_in: check.logged_in, account: check.account })
}
