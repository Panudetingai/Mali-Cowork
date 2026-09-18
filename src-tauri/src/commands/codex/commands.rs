use std::collections::HashMap;
use std::process::Stdio;
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use serde_json::Value;
use tauri::ipc::Channel;
use tokio::io::{AsyncBufReadExt, BufReader};

use crate::chat_stream::ChatStreamEvent;

use super::bin::{codex_bin, codex_command, not_found_message};
use super::stream::{CodexStream, Outcome};
use super::{CodexCheckResult, CodexModel, CodexRequest};

const CHECK_TIMEOUT: Duration = Duration::from_secs(20);

#[tauri::command]
pub async fn codex_check() -> CodexCheckResult {
    let Some(bin) = codex_bin() else {
        return CodexCheckResult {
            available: false,
            logged_in: false,
            version: None,
            path: None,
            account: None,
            error: Some(not_found_message()),
        };
    };
    let path = Some(bin.to_string());

    let version = match run(bin, &["--version"]).await {
        Ok(out) => out.trim().to_string(),
        Err(error) => {
            return CodexCheckResult {
                available: false,
                logged_in: false,
                version: None,
                path,
                account: None,
                error: Some(error),
            }
        }
    };

    // `codex login status` prints the account when signed in.
    let status = run(bin, &["login", "status"]).await.unwrap_or_default();
    let logged_in = !status.trim().is_empty() && !status.to_lowercase().contains("not logged in");
    CodexCheckResult {
        available: true,
        logged_in,
        version: Some(version),
        path,
        account: logged_in
            .then(|| status.lines().next().unwrap_or_default().trim().to_string())
            .filter(|a| !a.is_empty()),
        error: (!logged_in).then(|| {
            "Not signed in to Codex. Run `codex login`, then restart the app.".into()
        }),
    }
}

/// Models known to the CLI. `codex models` output is plain text, one id per
/// line (newer CLIs print a table) — best-effort parse, never fatal.
#[tauri::command]
pub async fn codex_list_models() -> Result<Vec<CodexModel>, String> {
    let bin = codex_bin().ok_or_else(not_found_message)?;
    let output = run(bin, &["models"]).await?;
    let models: Vec<CodexModel> = output.lines().filter_map(parse_model_line).collect();
    if models.is_empty() {
        return Err("codex listed no models. Check `codex login status`.".into());
    }
    Ok(models)
}

fn parse_model_line(line: &str) -> Option<CodexModel> {
    let line = line.trim();
    if line.is_empty() || line.starts_with("Available") || line.starts_with("Model") {
        return None;
    }
    // Table row: `gpt-5.3-codex   Codex 5.3   default` → first token is the id.
    // `gpt-5.3-codex - Codex 5.3` → split on ` - ` like cursor.
    let (id, name): (&str, &str) = match line.split_once(" - ") {
        Some((id, name)) => (id.trim(), name.trim()),
        None => {
            let mut parts = line.split_whitespace();
            let id = parts.next()?;
            let name = line[id.len()..].trim();
            (id, if name.is_empty() { id } else { name })
        }
    };
    if id.is_empty() || id.contains(char::is_whitespace) {
        return None;
    }
    Some(CodexModel {
        id: id.to_string(),
        name: if name.is_empty() { id.to_string() } else { name.to_string() },
    })
}

/// Base args for one prompt. The prompt itself is appended last by the caller.
/// When `session_id` is set the caller uses `resume` instead (see below).
pub fn build_args(request: &CodexRequest) -> Vec<String> {
    let mut args: Vec<String> = ["exec", "--json"].iter().map(|s| s.to_string()).collect();

    // Non-interactive like cursor `--trust` / `--force`: never ask, sandbox it.
    if request.is_chat() || request.read_only() {
        args.extend(["--sandbox".into(), "read-only".into()]);
    } else {
        args.extend(["--sandbox".into(), "workspace-write".into()]);
    }
    args.extend(["--ask-for-approval".into(), "never".into()]);
    args.extend(["--skip-git-repo-check".into()]);

    if let Some(model) = request
        .model
        .as_deref()
        .map(str::trim)
        .filter(|m| !m.is_empty() && *m != "auto")
    {
        args.extend(["-m".into(), model.into()]);
    }
    if let Some(cwd) = request.workspace() {
        args.extend(["-C".into(), cwd.into()]);
    }
    for folder in request.extra_folders() {
        args.extend(["--add-dir".into(), folder]);
    }
    args
}

/// Codex has no per-folder read-only flag, so read-only folders are stated in
/// the prompt — same pattern as cursor.
pub fn prompt_with_notes(request: &CodexRequest) -> String {
    let read_only: Vec<&str> = request
        .folders
        .iter()
        .filter(|f| !f.writable())
        .map(|f| f.path.as_str())
        .collect();
    if read_only.is_empty() || request.is_chat() {
        return request.prompt.trim().to_string();
    }
    format!(
        "[The user granted these folders as read-only. Do not create, modify or delete anything in them:\n- {}]\n\n{}",
        read_only.join("\n- "),
        request.prompt.trim()
    )
}

#[tauri::command]
pub async fn codex_generate(
    request: CodexRequest,
    on_event: Channel<ChatStreamEvent>,
) -> Result<(), String> {
    if let Err(message) = run_prompt(&request, &on_event).await {
        let _ = on_event.send(ChatStreamEvent::Error { message });
    }
    Ok(())
}

async fn run_prompt(
    request: &CodexRequest,
    on_event: &Channel<ChatStreamEvent>,
) -> Result<(), String> {
    if request.prompt.trim().is_empty() {
        return Err("Prompt cannot be empty.".into());
    }
    let bin = codex_bin().ok_or_else(not_found_message)?;

    // Resume continues an existing thread; otherwise a fresh `exec`.
    let mut args: Vec<String> = if let Some(session) =
        request.session_id.as_deref().map(str::trim).filter(|s| !s.is_empty())
    {
        let mut v = vec!["exec".to_string(), "resume".to_string(), session.to_string(), "--json".to_string()];
        // Keep the same sandbox/model flags as a fresh run (minus `exec`).
        v.extend(build_args(request).into_iter().skip(2));
        v
    } else {
        build_args(request)
    };
    args.push(prompt_with_notes(request));
    let arg_refs: Vec<&str> = args.iter().map(String::as_str).collect();

    let mut cmd = codex_command(bin, &arg_refs);
    cmd.stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    if let Some(cwd) = request.workspace() {
        cmd.current_dir(cwd);
    }
    // Own process group, so stopping also stops the tools it started.
    #[cfg(unix)]
    cmd.process_group(0);

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to start codex ({bin}): {e}"))?;
    let _running = child.id().map(|pid| Running::register(&request.run_id, pid));

    let stdout = child.stdout.take().ok_or("codex has no stdout")?;
    let stderr = child.stderr.take().ok_or("codex has no stderr")?;
    let errors = collect_stderr(stderr);

    on_event.send(ChatStreamEvent::Started).map_err(|e| e.to_string())?;

    let mut lines = BufReader::new(stdout).lines();
    let mut stream = CodexStream::new();
    let mut finished = false;
    let mut failure = None;

    while let Ok(Some(line)) = lines.next_line().await {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let Ok(event) = serde_json::from_str::<Value>(line) else {
            eprintln!("[codex] non-JSON line: {}", &line[..line.len().min(200)]);
            continue;
        };
        for outcome in stream.handle(&event) {
            match outcome {
                Outcome::Emit(event) => {
                    if let Err(e) = on_event.send(event) {
                        // The window went away: stop the agent.
                        let _ = child.start_kill();
                        return Err(e.to_string());
                    }
                }
                Outcome::Finished => finished = true,
                Outcome::Failed(message) => failure = Some(message),
            }
        }
    }

    let status = child.wait().await.map_err(|e| e.to_string())?;
    let stderr_text = errors.lock().unwrap().join("\n");

    if let Some(message) = failure {
        return Err(message);
    }
    if finished {
        return on_event
            .send(ChatStreamEvent::Done {
                model_id: format!("codex:{}", request.model.as_deref().unwrap_or("auto")),
            })
            .map_err(|e| e.to_string());
    }
    if status.success() {
        return Err(format!("codex ended without a reply.{}", tail(&stderr_text)));
    }
    Err(format!("codex exited with {status}.{}", tail(&stderr_text)))
}

fn tail(stderr: &str) -> String {
    let text = stderr.trim();
    if text.is_empty() {
        return String::new();
    }
    let lines: Vec<&str> = text.lines().rev().take(12).collect();
    format!("\n\n— codex —\n{}", lines.into_iter().rev().collect::<Vec<_>>().join("\n"))
}

fn collect_stderr<R>(stderr: R) -> std::sync::Arc<Mutex<Vec<String>>>
where
    R: tokio::io::AsyncRead + Unpin + Send + 'static,
{
    let buffer = std::sync::Arc::new(Mutex::new(Vec::new()));
    let sink = buffer.clone();
    tokio::spawn(async move {
        let mut lines = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            if !line.trim().is_empty() {
                eprintln!("[codex:stderr] {line}");
                sink.lock().unwrap().push(line);
            }
        }
    });
    buffer
}

/// Running prompts, so the Stop button can end them.
struct Running(String);

impl Running {
    fn registry() -> &'static Mutex<HashMap<String, u32>> {
        static RUNNING: OnceLock<Mutex<HashMap<String, u32>>> = OnceLock::new();
        RUNNING.get_or_init(Default::default)
    }

    fn register(run_id: &str, pid: u32) -> Self {
        Self::registry().lock().unwrap().insert(run_id.to_string(), pid);
        Self(run_id.to_string())
    }
}

impl Drop for Running {
    fn drop(&mut self) {
        Self::registry().lock().unwrap().remove(&self.0);
    }
}

#[tauri::command]
pub fn codex_abort(run_id: String) -> Result<(), String> {
    let Some(pid) = Running::registry().lock().unwrap().get(&run_id).copied() else {
        return Ok(());
    };
    // Negative pid targets the whole group, so spawned tools stop too.
    #[cfg(unix)]
    let _ = std::process::Command::new("kill")
        .args(["-TERM", &format!("-{pid}")])
        .status();
    #[cfg(windows)]
    let _ = std::process::Command::new("taskkill")
        .args(["/PID", &pid.to_string(), "/T", "/F"])
        .status();
    Ok(())
}

async fn run(bin: &str, args: &[&str]) -> Result<String, String> {
    let output = tokio::time::timeout(CHECK_TIMEOUT, codex_command(bin, args).output())
        .await
        .map_err(|_| format!("`codex {}` timed out", args.join(" ")))?
        .map_err(|e| e.to_string())?;
    if !output.status.success() {
        let error = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if error.is_empty() {
            format!("`codex {}` exited with {}", args.join(" "), output.status)
        } else {
            error
        });
    }
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::opencode::FolderGrant;

    fn request(mode: &str, folders: Vec<FolderGrant>) -> CodexRequest {
        CodexRequest {
            prompt: "do it".into(),
            model: Some("gpt-5.3-codex".into()),
            cwd: Some("/w".into()),
            session_id: None,
            mode: Some(mode.into()),
            folders,
            run_id: "run1".into(),
        }
    }

    fn grant(path: &str, access: &str) -> FolderGrant {
        FolderGrant { path: path.into(), access: access.into() }
    }

    #[test]
    fn chat_mode_is_read_only() {
        let args = build_args(&request("chat", vec![]));
        assert!(args.windows(2).any(|w| w == ["--sandbox", "read-only"]));
        assert!(args.windows(2).any(|w| w == ["--ask-for-approval", "never"]));
        // Chat never exposes the folder.
        assert!(!args.iter().any(|a| a == "-C"));
    }

    #[test]
    fn cowork_with_write_access_may_act() {
        let args = build_args(&request("cowork", vec![grant("/w", "write")]));
        assert!(args.windows(2).any(|w| w == ["--sandbox", "workspace-write"]));
        assert!(args.windows(2).any(|w| w == ["-C", "/w"]));
        assert!(args.windows(2).any(|w| w == ["-m", "gpt-5.3-codex"]));
    }

    #[test]
    fn read_only_working_folder_stays_read_only() {
        let args = build_args(&request("cowork", vec![grant("/w", "read")]));
        assert!(args.windows(2).any(|w| w == ["--sandbox", "read-only"]));
    }

    #[test]
    fn extra_folders_are_added_and_read_only_ones_stated_in_the_prompt() {
        let mut req = request("cowork", vec![grant("/w", "write"), grant("/docs", "read")]);
        req.session_id = Some("sess-1".into());
        let args = build_args(&req);
        assert!(args.windows(2).any(|w| w == ["--add-dir", "/docs"]));

        let prompt = prompt_with_notes(&req);
        assert!(prompt.contains("/docs"));
        assert!(prompt.contains("read-only"));
        assert!(prompt.ends_with("do it"));
        assert_eq!(prompt_with_notes(&request("chat", vec![grant("/docs", "read")])), "do it");
    }

    #[test]
    fn auto_model_is_left_to_codex() {
        let mut req = request("cowork", vec![grant("/w", "write")]);
        req.model = Some("auto".into());
        assert!(!build_args(&req).iter().any(|a| a == "-m"));
    }
}
