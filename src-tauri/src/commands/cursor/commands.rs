use std::collections::HashMap;
use std::process::Stdio;
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use serde_json::Value;
use tauri::ipc::Channel;
use tokio::io::{AsyncBufReadExt, BufReader};

use crate::chat_stream::ChatStreamEvent;

use super::bin::{cursor_bin, cursor_command, not_found_message};
use super::stream::{CursorStream, Outcome};
use super::{CursorCheckResult, CursorModel, CursorRequest};

const CHECK_TIMEOUT: Duration = Duration::from_secs(20);

#[tauri::command]
pub async fn cursor_check() -> CursorCheckResult {
    let Some(bin) = cursor_bin() else {
        return CursorCheckResult {
            available: false,
            error: Some(not_found_message()),
            ..Default::default()
        };
    };
    let path = Some(bin.to_string());

    let version = match run(bin, &["--version"]).await {
        Ok(out) => out.trim().to_string(),
        Err(error) => {
            return CursorCheckResult { available: false, path, error: Some(error), ..Default::default() }
        }
    };

    // `status` prints the signed-in account, or fails when signed out.
    let status = run(bin, &["status"]).await.unwrap_or_default();
    let logged_in = status.contains("Logged in");
    CursorCheckResult {
        available: true,
        logged_in,
        version: Some(version),
        path,
        account: logged_in
            .then(|| status.rsplit(' ').next().unwrap_or_default().trim().to_string())
            .filter(|a| a.contains('@')),
        error: (!logged_in).then(|| {
            "Not signed in to Cursor. Sign in from Settings → Agents, or run `cursor-agent login`.".into()
        }),
    }
}

/// Sign in with Cursor; opens the browser and waits for the callback.
#[tauri::command]
pub async fn cursor_login() -> Result<CursorCheckResult, String> {
    let bin = cursor_bin().ok_or_else(not_found_message)?;
    let mut cmd = cursor_command(bin, &["login"]);
    let status = cmd
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .status()
        .await
        .map_err(|e| format!("Could not start `cursor-agent login`: {e}"))?;
    if !status.success() {
        return Err(format!("`cursor-agent login` exited with {status}"));
    }
    Ok(cursor_check().await)
}

/// Models the account can use, newest first as the CLI lists them.
#[tauri::command]
pub async fn cursor_list_models() -> Result<Vec<CursorModel>, String> {
    let bin = cursor_bin().ok_or_else(not_found_message)?;
    let output = run(bin, &["--list-models"]).await?;
    let models: Vec<CursorModel> = output
        .lines()
        .filter_map(parse_model_line)
        .collect();
    if models.is_empty() {
        return Err("cursor-agent listed no models. Check `cursor-agent status`.".into());
    }
    Ok(models)
}

/// `"gpt-5.3-codex - Codex 5.3"` → id and display name.
fn parse_model_line(line: &str) -> Option<CursorModel> {
    let line = line.trim();
    if line.is_empty() || line.starts_with("Available") {
        return None;
    }
    let (id, name) = match line.split_once(" - ") {
        Some((id, name)) => (id.trim(), name.trim()),
        None => (line, line),
    };
    // Ids never contain spaces; anything else is prose.
    if id.is_empty() || id.contains(char::is_whitespace) {
        return None;
    }
    Some(CursorModel { id: id.to_string(), name: name.to_string() })
}

/// Arguments for one prompt. `prompt` is passed separately, last.
pub fn build_args(request: &CursorRequest) -> Vec<String> {
    let mut args: Vec<String> = ["--print", "--output-format", "stream-json", "--stream-partial-output", "--trust"]
        .iter()
        .map(|s| s.to_string())
        .collect();

    if request.is_chat() {
        // Q&A style, read-only: the Chat tab never touches files.
        args.extend(["--mode".into(), "ask".into()]);
    } else if request.read_only() {
        // Plan mode analyses and proposes, but cannot edit.
        args.extend(["--mode".into(), "plan".into()]);
    } else {
        // The user granted this folder for writing, and `--print` cannot ask.
        args.push("--force".into());
    }

    if let Some(model) = request.model.as_deref().map(str::trim).filter(|m| !m.is_empty() && *m != "auto") {
        args.extend(["--model".into(), model.into()]);
    }
    if let Some(session) = request.session_id.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        args.extend(["--resume".into(), session.into()]);
    }
    if let Some(cwd) = request.workspace() {
        args.extend(["--workspace".into(), cwd.into()]);
    }
    for folder in request.extra_folders() {
        args.extend(["--add-dir".into(), folder]);
    }
    args
}

/// Cursor has no per-folder rules, so read-only folders are stated in the prompt.
pub fn prompt_with_notes(request: &CursorRequest) -> String {
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
pub async fn cursor_generate(
    request: CursorRequest,
    on_event: Channel<ChatStreamEvent>,
) -> Result<(), String> {
    if let Err(message) = run_prompt(&request, &on_event).await {
        let _ = on_event.send(ChatStreamEvent::Error { message });
    }
    Ok(())
}

async fn run_prompt(
    request: &CursorRequest,
    on_event: &Channel<ChatStreamEvent>,
) -> Result<(), String> {
    if request.prompt.trim().is_empty() {
        return Err("Prompt cannot be empty.".into());
    }
    let bin = cursor_bin().ok_or_else(not_found_message)?;

    let mut args = build_args(request);
    args.push(prompt_with_notes(request));
    let arg_refs: Vec<&str> = args.iter().map(String::as_str).collect();

    let mut cmd = cursor_command(bin, &arg_refs);
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
        .map_err(|e| format!("Failed to start cursor-agent ({bin}): {e}"))?;
    let _running = child.id().map(|pid| Running::register(&request.run_id, pid));

    let stdout = child.stdout.take().ok_or("cursor-agent has no stdout")?;
    let stderr = child.stderr.take().ok_or("cursor-agent has no stderr")?;
    let errors = collect_stderr(stderr);

    on_event.send(ChatStreamEvent::Started).map_err(|e| e.to_string())?;

    let mut lines = BufReader::new(stdout).lines();
    let mut stream = CursorStream::new();
    let mut finished = false;
    let mut failure = None;

    while let Ok(Some(line)) = lines.next_line().await {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let Ok(event) = serde_json::from_str::<Value>(line) else {
            eprintln!("[cursor] non-JSON line: {}", &line[..line.len().min(200)]);
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
                model_id: format!("cursor:{}", request.model.as_deref().unwrap_or("auto")),
            })
            .map_err(|e| e.to_string());
    }
    if status.success() {
        return Err(format!(
            "cursor-agent ended without a reply.{}",
            tail(&stderr_text)
        ));
    }
    Err(format!("cursor-agent exited with {status}.{}", tail(&stderr_text)))
}

fn tail(stderr: &str) -> String {
    let text = stderr.trim();
    if text.is_empty() {
        return String::new();
    }
    let lines: Vec<&str> = text.lines().rev().take(12).collect();
    format!("\n\n— cursor-agent —\n{}", lines.into_iter().rev().collect::<Vec<_>>().join("\n"))
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
                eprintln!("[cursor:stderr] {line}");
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
pub fn cursor_abort(run_id: String) -> Result<(), String> {
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
    let output = tokio::time::timeout(CHECK_TIMEOUT, cursor_command(bin, args).output())
        .await
        .map_err(|_| format!("`cursor-agent {}` timed out", args.join(" ")))?
        .map_err(|e| e.to_string())?;
    if !output.status.success() {
        let error = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if error.is_empty() {
            format!("`cursor-agent {}` exited with {}", args.join(" "), output.status)
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

    fn request(mode: &str, folders: Vec<FolderGrant>) -> CursorRequest {
        CursorRequest {
            prompt: "do it".into(),
            model: Some("composer-2.5".into()),
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
    fn chat_mode_is_read_only_q_and_a() {
        let args = build_args(&request("chat", vec![]));
        assert!(args.windows(2).any(|w| w == ["--mode", "ask"]));
        assert!(!args.iter().any(|a| a == "--force"));
        // Chat never exposes the folder.
        assert!(!args.iter().any(|a| a == "--workspace"));
    }

    #[test]
    fn cowork_with_write_access_may_act() {
        let args = build_args(&request("cowork", vec![grant("/w", "write")]));
        assert!(args.iter().any(|a| a == "--force"));
        assert!(args.windows(2).any(|w| w == ["--workspace", "/w"]));
        assert!(args.windows(2).any(|w| w == ["--model", "composer-2.5"]));
        assert!(args.iter().any(|a| a == "--trust"), "non-interactive runs need --trust");
    }

    #[test]
    fn read_only_working_folder_uses_plan_mode() {
        let args = build_args(&request("cowork", vec![grant("/w", "read")]));
        assert!(args.windows(2).any(|w| w == ["--mode", "plan"]));
        assert!(!args.iter().any(|a| a == "--force"));
    }

    #[test]
    fn extra_folders_are_added_and_read_only_ones_stated_in_the_prompt() {
        let mut req = request("cowork", vec![grant("/w", "write"), grant("/docs", "read")]);
        req.session_id = Some("sess-1".into());
        let args = build_args(&req);
        assert!(args.windows(2).any(|w| w == ["--add-dir", "/docs"]));
        assert!(args.windows(2).any(|w| w == ["--resume", "sess-1"]));
        // The working folder is writable, so the run is not plan mode.
        assert!(args.iter().any(|a| a == "--force"));

        let prompt = prompt_with_notes(&req);
        assert!(prompt.contains("/docs"));
        assert!(prompt.contains("read-only"));
        assert!(prompt.ends_with("do it"));
        // Chat mode has no folders, so it gets no note.
        assert_eq!(prompt_with_notes(&request("chat", vec![grant("/docs", "read")])), "do it");
    }

    #[test]
    fn auto_model_is_left_to_cursor() {
        let mut req = request("cowork", vec![grant("/w", "write")]);
        req.model = Some("auto".into());
        assert!(!build_args(&req).iter().any(|a| a == "--model"));
    }

    #[test]
    fn model_lines_are_parsed_and_prose_skipped() {
        assert_eq!(
            parse_model_line("gpt-5.3-codex - Codex 5.3").map(|m| (m.id, m.name)),
            Some(("gpt-5.3-codex".into(), "Codex 5.3".into()))
        );
        assert_eq!(parse_model_line("auto - Auto (default)").unwrap().id, "auto");
        assert!(parse_model_line("Available models").is_none());
        assert!(parse_model_line("").is_none());
        assert!(parse_model_line("some prose line here").is_none());
    }
}

#[cfg(test)]
mod live_tests {
    use super::tests_support::*;
    use super::*;
    use crate::commands::opencode::FolderGrant;

    /// Chat mode answers without touching the folder.
    /// `cargo test -- --ignored cursor_live_chat`.
    #[tokio::test]
    #[ignore = "needs cursor-agent, a signed-in account and network access"]
    async fn cursor_live_chat_mode_has_no_file_access() {
        let dir = std::env::temp_dir().join(format!("mali-cursor-chat-{}", uuid::Uuid::new_v4().simple()));
        std::fs::create_dir_all(&dir).unwrap();

        let (channel, events) = recording_channel();
        let request = CursorRequest {
            prompt: format!(
                "Create a file called proof.txt in {} with the text x. If you cannot, reply NOFILES.",
                dir.display()
            ),
            model: Some("composer-2.5".into()),
            cwd: Some(dir.to_string_lossy().into_owned()),
            session_id: None,
            mode: Some("chat".into()),
            folders: vec![],
            run_id: "live-chat".into(),
        };

        let result = run_prompt(&request, &channel).await;
        let events = events.lock().unwrap().clone();
        for event in &events {
            eprintln!("{}", &event[..event.len().min(180)]);
        }
        result.expect("prompt finishes");
        assert!(!dir.join("proof.txt").exists(), "chat mode must not write files");
        let _ = std::fs::remove_dir_all(dir);
    }

    /// Real run against the CLI: the file gets written, the reply arrives once,
    /// and the session id comes back. `cargo test -- --ignored cursor_live`.
    #[tokio::test]
    #[ignore = "needs cursor-agent, a signed-in account and network access"]
    async fn cursor_live_cowork_run() {
        let dir = std::env::temp_dir().join(format!("mali-cursor-{}", uuid::Uuid::new_v4().simple()));
        std::fs::create_dir_all(&dir).unwrap();

        let (channel, events) = recording_channel();
        let request = CursorRequest {
            prompt: "Create a file hello.txt containing hi, then reply with the single word DONE.".into(),
            model: Some("composer-2.5".into()),
            cwd: Some(dir.to_string_lossy().into_owned()),
            session_id: None,
            mode: Some("cowork".into()),
            folders: vec![FolderGrant {
                path: dir.to_string_lossy().into_owned(),
                access: "write".into(),
            }],
            run_id: "live-run".into(),
        };

        let result = run_prompt(&request, &channel).await;
        let events = events.lock().unwrap().clone();
        for event in &events {
            eprintln!("{}", &event[..event.len().min(200)]);
        }
        result.expect("prompt finishes");

        assert!(dir.join("hello.txt").exists(), "the agent wrote the file");
        let text: String = events
            .iter()
            .filter(|e| e.contains(r#""event":"chunk""#))
            .filter_map(|e| serde_json::from_str::<serde_json::Value>(e).ok())
            .filter_map(|v| v["data"]["text"].as_str().map(str::to_string))
            .collect();
        assert_eq!(text.matches("DONE").count(), 1, "reply is streamed once, not twice: {text:?}");
        assert!(events.iter().any(|e| e.contains(r#""sessionId""#)), "session id reported");
        assert!(events.iter().any(|e| e.contains(r#""event":"activity""#)), "tool steps reported");
        assert!(events.iter().any(|e| e.contains(r#""event":"done""#)), "run finished");
        let _ = std::fs::remove_dir_all(dir);
    }
}

#[cfg(test)]
mod tests_support {
    use std::sync::{Arc, Mutex};
    use tauri::ipc::Channel;

    use crate::chat_stream::ChatStreamEvent;

    /// A channel that records the JSON it would send to the window.
    pub fn recording_channel() -> (Channel<ChatStreamEvent>, Arc<Mutex<Vec<String>>>) {
        let events = Arc::new(Mutex::new(Vec::new()));
        let sink = events.clone();
        let channel = Channel::new(move |body| {
            if let tauri::ipc::InvokeResponseBody::Json(json) = body {
                sink.lock().unwrap().push(json);
            }
            Ok(())
        });
        (channel, events)
    }
}
