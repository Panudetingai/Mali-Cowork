use std::collections::HashMap;
use std::process::Stdio;
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use serde_json::Value;
use tauri::ipc::Channel;
use tokio::io::{AsyncBufReadExt, BufReader};

use crate::chat_stream::ChatStreamEvent;
use crate::commands::supervisor;

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
        // The user granted this folder for writing, and `--print` cannot ask,
        // so commands run on their own, but only inside Cursor's sandbox.
        args.extend(["--force".into(), "--sandbox".into(), "enabled".into()]);
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

/// How one `cursor-agent` run ended.
enum Attempt {
    /// The reply finished.
    Done,
    /// Cursor turned the request away before anything reached the chat, for a
    /// reason that usually passes: running the same prompt again is safe.
    Retriable(String),
    Failed(String),
}

/// Waits before the second and third try. Cursor's backend answers
/// `resource_exhausted` when the account's quota for the moment is used up or
/// its servers are loaded, and the CLI exits instead of retrying, so a turn
/// that produced nothing is given another chance here before the user is
/// shown an error.
const RETRY_DELAYS: [Duration; 2] = [Duration::from_secs(5), Duration::from_secs(15)];

/// A failure worth trying again: Cursor says so itself (`RetriableError`), or
/// it is one of the transient statuses its backend returns under load.
fn is_retriable(message: &str) -> bool {
    let text = message.to_ascii_lowercase();
    ["retriableerror", "resource_exhausted", "unavailable", "deadline_exceeded", "overloaded"]
        .iter()
        .any(|needle| text.contains(needle))
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
    // Connectors come from Mali's gateway (see `mcp_bridge`); approved up
    // front, since a headless run can't ask.
    args.push("--approve-mcps".into());
    match crate::commands::mcp_bridge::cursor_plugin().await {
        Ok(dir) => args.extend(["--plugin-dir".into(), dir.to_string_lossy().into_owned()]),
        Err(e) => eprintln!("[cursor] connectors unavailable this run: {e}"),
    }
    args.push(prompt_with_notes(request));

    // Registered for the whole turn, including the pauses between tries, so
    // Stop reaches a retry that hasn't started yet.
    let running = Running::start(&request.run_id);
    let mut last = String::new();
    for (attempt, delay) in std::iter::once(None)
        .chain(RETRY_DELAYS.iter().map(Some))
        .enumerate()
    {
        if let Some(delay) = delay {
            notify_retry(on_event, *delay, attempt, false)?;
            tokio::time::sleep(*delay).await;
            notify_retry(on_event, *delay, attempt, true)?;
            if running.aborted() {
                return Err(last);
            }
        }
        match run_once(request, on_event, &running, bin, &args, attempt == 0).await? {
            Attempt::Done => return Ok(()),
            Attempt::Failed(message) => return Err(message),
            Attempt::Retriable(message) => last = message,
        }
        if running.aborted() {
            return Err(last);
        }
    }
    Err(last)
}

/// Tell the chat why nothing is happening, instead of leaving a spinner.
fn notify_retry(
    on_event: &Channel<ChatStreamEvent>,
    delay: Duration,
    attempt: usize,
    waited: bool,
) -> Result<(), String> {
    let tries = RETRY_DELAYS.len();
    on_event
        .send(ChatStreamEvent::Activity {
            id: Some("cursor-retry".into()),
            kind: "system".into(),
            title: if waited {
                format!("Cursor was busy: trying again ({attempt}/{tries})")
            } else {
                format!(
                    "Cursor is busy: waiting {}s before trying again ({attempt}/{tries})",
                    delay.as_secs()
                )
            },
            detail: None,
            done: waited,
            duration_ms: waited.then(|| delay.as_millis() as u64),
        })
        .map_err(|e| e.to_string())
}

async fn run_once(
    request: &CursorRequest,
    on_event: &Channel<ChatStreamEvent>,
    running: &Running,
    bin: &str,
    args: &[String],
    announce: bool,
) -> Result<Attempt, String> {
    let arg_refs: Vec<&str> = args.iter().map(String::as_str).collect();

    // Supervised, so the agent and the tools and MCP servers it starts
    // always stop together.
    let mut cmd = supervisor::command(cursor_command(bin, &arg_refs));
    cmd.stdout(Stdio::piped()).stderr(Stdio::piped());
    if let Some(cwd) = request.workspace() {
        cmd.current_dir(cwd);
    }
    let (mut child, mut tree) = supervisor::spawn(&mut cmd, "cursor-agent")
        .map_err(|e| format!("Failed to start cursor-agent ({bin}): {e}"))?;
    running.set_pid(tree.pid());
    // Stopped while this try was starting: there is no pid to kill until now.
    if running.aborted() {
        tree.stop();
    }

    let stdout = child.stdout.take().ok_or("cursor-agent has no stdout")?;
    let stderr = child.stderr.take().ok_or("cursor-agent has no stderr")?;
    let errors = collect_stderr(stderr);

    if announce {
        on_event.send(ChatStreamEvent::Started).map_err(|e| e.to_string())?;
    }

    let mut lines = BufReader::new(stdout).lines();
    let mut stream = CursorStream::new();
    let mut finished = false;
    let mut failure = None;
    // Anything already on screen must not be produced twice by a retry.
    let mut streamed = false;

    while let Ok(Some(line)) = lines.next_line().await {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let Ok(event) = serde_json::from_str::<Value>(line) else {
            eprintln!("[cursor] non-JSON line: {}", crate::commands::truncate_chars(line, 200));
            continue;
        };
        for outcome in stream.handle(&event) {
            match outcome {
                Outcome::Emit(event) => {
                    streamed = true;
                    if let Err(e) = on_event.send(event) {
                        // The window went away: stop the agent.
                        tree.stop();
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
        return Ok(classify(&running, streamed, message));
    }
    if finished {
        on_event
            .send(ChatStreamEvent::Done {
                model_id: format!("cursor:{}", request.model.as_deref().unwrap_or("auto")),
            })
            .map_err(|e| e.to_string())?;
        return Ok(Attempt::Done);
    }
    let message = if status.success() {
        format!("cursor-agent ended without a reply.{}", tail(&stderr_text))
    } else {
        format!("cursor-agent exited with {status}.{}", tail(&stderr_text))
    };
    Ok(classify(&running, streamed, message))
}

/// A stopped turn is not worth retrying, and neither is one that already wrote
/// part of a reply — running it again would say everything twice.
fn classify(running: &Running, streamed: bool, message: String) -> Attempt {
    if !running.aborted() && !streamed && is_retriable(&message) {
        Attempt::Retriable(message)
    } else {
        Attempt::Failed(message)
    }
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
/// A turn in flight: the process running it, if one is, and whether the user
/// stopped it. The flag outlives each try, so Stop also cancels a retry.
#[derive(Default)]
struct RunState {
    pid: Option<u32>,
    aborted: bool,
}

struct Running(String);

impl Running {
    fn registry() -> &'static Mutex<HashMap<String, RunState>> {
        static RUNNING: OnceLock<Mutex<HashMap<String, RunState>>> = OnceLock::new();
        RUNNING.get_or_init(Default::default)
    }

    /// Track `run_id` until the returned guard is dropped.
    fn start(run_id: &str) -> Self {
        Self::registry().lock().unwrap().insert(run_id.to_string(), RunState::default());
        Self(run_id.to_string())
    }

    fn set_pid(&self, pid: u32) {
        if let Some(state) = Self::registry().lock().unwrap().get_mut(&self.0) {
            state.pid = Some(pid);
        }
    }

    fn aborted(&self) -> bool {
        Self::registry().lock().unwrap().get(&self.0).is_some_and(|state| state.aborted)
    }
}

impl Drop for Running {
    fn drop(&mut self) {
        Self::registry().lock().unwrap().remove(&self.0);
    }
}

#[tauri::command]
pub fn cursor_abort(run_id: String) -> Result<(), String> {
    let pid = {
        let mut registry = Running::registry().lock().unwrap();
        let Some(state) = registry.get_mut(&run_id) else {
            return Ok(());
        };
        state.aborted = true;
        state.pid
    };
    // Stops the whole tree, so the tools it started stop too.
    if let Some(pid) = pid {
        supervisor::terminate(pid);
    }
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

    const EXHAUSTED: &str =
        "cursor-agent exited with exit status: 1.\n\n— cursor-agent —\nRetriableError: [resource_exhausted] Error";

    #[test]
    fn a_turn_that_said_nothing_is_retried_unless_it_was_stopped() {
        let running = Running::start("run_retry_test");
        assert!(matches!(
            classify(&running, false, EXHAUSTED.into()),
            Attempt::Retriable(_)
        ));
        // Part of the reply is already on screen: saying it twice is worse.
        assert!(matches!(classify(&running, true, EXHAUSTED.into()), Attempt::Failed(_)));
        // Not every failure is temporary.
        assert!(matches!(
            classify(&running, false, "cursor-agent exited with exit status: 2.".into()),
            Attempt::Failed(_)
        ));

        cursor_abort("run_retry_test".into()).unwrap();
        assert!(running.aborted());
        assert!(matches!(classify(&running, false, EXHAUSTED.into()), Attempt::Failed(_)));
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
        assert!(args.windows(2).any(|w| w == ["--sandbox", "enabled"]), "--force only runs sandboxed");
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
