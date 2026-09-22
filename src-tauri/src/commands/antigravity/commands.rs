use std::collections::HashMap;
use std::process::Stdio;
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use serde_json::Value;
use tauri::ipc::Channel;
use tokio::io::{AsyncBufReadExt, BufReader};

use crate::chat_stream::ChatStreamEvent;
use crate::commands::supervisor;

use super::bin::{antigravity_bin, antigravity_command, not_found_message};
use super::stream::{AntigravityStream, Outcome};
use super::{AntigravityCheckResult, AntigravityModel, AntigravityRequest};

const CHECK_TIMEOUT: Duration = Duration::from_secs(20);

/// The key handed to `antigravity` as `ANTIGRAVITY_API_KEY`: the one from Settings
/// first, then the environment. `GOOGLE_API_KEY` is mapped over because the
/// CLI's API-key sign-in only accepts `ANTIGRAVITY_API_KEY`.
pub fn api_key_for(settings_key: Option<&str>) -> Option<(String, &'static str)> {
    if let Some(key) = settings_key.map(str::trim).filter(|k| !k.is_empty()) {
        return Some((key.to_string(), "Settings"));
    }
    for name in ["ANTIGRAVITY_API_KEY", "GOOGLE_API_KEY"] {
        if let Ok(value) = std::env::var(name) {
            if !value.trim().is_empty() {
                return Some((value.trim().to_string(), name));
            }
        }
    }
    None
}

/// The CLI has no `status` command, so sign-in is detected best-effort:
/// an API key (Settings or environment) or OAuth credentials on disk.
fn is_logged_in(settings_key: Option<&str>) -> (bool, Option<String>) {
    if let Some((_, from)) = api_key_for(settings_key) {
        return (true, Some(format!("API key ({from})")));
    }
    if let Some(home) = dirs::home_dir() {
        // OAuth login from interactive `antigravity` stores credentials here.
        if home.join(".antigravity").join("oauth_creds.json").is_file() {
            return (true, Some("Google account".into()));
        }
    }
    (false, None)
}

#[tauri::command]
pub async fn antigravity_check(api_key: Option<String>) -> AntigravityCheckResult {
    let Some(bin) = antigravity_bin() else {
        return AntigravityCheckResult {
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
            return AntigravityCheckResult {
                available: false,
                logged_in: false,
                version: None,
                path,
                account: None,
                error: Some(error),
            }
        }
    };

    let (logged_in, account) = is_logged_in(api_key.as_deref());
    AntigravityCheckResult {
        available: true,
        logged_in,
        version: Some(version),
        path,
        account,
        error: (!logged_in).then(|| {
            "Not signed in to Antigravity. Add a Antigravity API key in Settings → Models, or run `antigravity` once and choose \"Sign in with Google\".".into()
        }),
    }
}

/// The CLI has no list command, so this is a curated set of current models.
/// The UI falls back to `auto` when the list is empty.
#[tauri::command]
pub async fn antigravity_list_models() -> Result<Vec<AntigravityModel>, String> {
    Ok(vec![
        AntigravityModel { id: "antigravity-2.5-pro".into(), name: "Antigravity 2.5 Pro".into() },
        AntigravityModel { id: "antigravity-2.5-flash".into(), name: "Antigravity 2.5 Flash".into() },
        AntigravityModel { id: "antigravity-2.0-flash".into(), name: "Antigravity 2.0 Flash".into() },
    ])
}

/// Base args for one prompt. The prompt itself is passed via `-p` last.
pub fn build_args(request: &AntigravityRequest) -> Vec<String> {
    let mut args: Vec<String> = vec!["--output-format".into(), "stream-json".into()];

    // Non-interactive: antigravity can't ask, so pick what it may do up front.
    // `plan` is read-only. Writing runs `yolo` only inside the macOS seatbelt
    // sandbox, which confines writes to the working folder; elsewhere there's
    // no sandbox to rely on, so `auto_edit` edits files but runs no commands.
    if request.is_chat() || request.read_only() {
        args.extend(["--approval-mode".into(), "plan".into()]);
    } else if cfg!(target_os = "macos") {
        args.extend(["--approval-mode".into(), "yolo".into(), "--sandbox".into()]);
    } else {
        args.extend(["--approval-mode".into(), "auto_edit".into()]);
    }

    if let Some(model) = request
        .model
        .as_deref()
        .map(str::trim)
        .filter(|m| !m.is_empty() && *m != "auto")
    {
        args.extend(["-m".into(), model.into()]);
    }
    if let Some(session) = request
        .session_id
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        args.extend(["-r".into(), session.into()]);
    }
    for folder in request.extra_folders() {
        args.extend(["--include-directories".into(), folder]);
    }
    args
}

/// Antigravity CLI has no per-folder read-only flag, so read-only folders are
/// stated in the prompt — same pattern as cursor/codex.
pub fn prompt_with_notes(request: &AntigravityRequest) -> String {
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
pub async fn antigravity_generate(
    request: AntigravityRequest,
    on_event: Channel<ChatStreamEvent>,
) -> Result<(), String> {
    if let Err(message) = run_prompt(&request, &on_event).await {
        let _ = on_event.send(ChatStreamEvent::Error { message });
    }
    Ok(())
}

async fn run_prompt(
    request: &AntigravityRequest,
    on_event: &Channel<ChatStreamEvent>,
) -> Result<(), String> {
    if request.prompt.trim().is_empty() {
        return Err("Prompt cannot be empty.".into());
    }
    let bin = antigravity_bin().ok_or_else(not_found_message)?;

    let mut args = build_args(request);
    // Pictures are `@path` references, which antigravity reads only inside its
    // workspace, so each picture's folder joins it.
    let mut prompt = prompt_with_notes(request);
    for image in &request.images {
        let path = crate::commands::attachments::resolve(image)?;
        if let Some(dir) = path.parent() {
            args.extend(["--include-directories".into(), dir.to_string_lossy().into_owned()]);
        }
        // `@` paths end at a space unless it's escaped.
        prompt.push_str(&format!("\n@{}", path.display().to_string().replace(' ', "\\ ")));
    }
    // `-p` forces headless mode; it also accepts piped stdin, which we close.
    args.extend(["-p".into(), prompt]);
    let arg_refs: Vec<&str> = args.iter().map(String::as_str).collect();

    // Supervised, so the agent and the tools and MCP servers it starts
    // always stop together.
    let mut cmd = supervisor::command(antigravity_command(bin, &arg_refs));
    cmd.stdout(Stdio::piped()).stderr(Stdio::piped());
    if let Some((key, _)) = api_key_for(request.api_key.as_deref()) {
        cmd.env("ANTIGRAVITY_API_KEY", key);
    }
    // Antigravity CLI is project-scoped: it reads settings and sessions from cwd.
    if let Some(cwd) = request.workspace() {
        cmd.current_dir(cwd);
    }
    let (mut child, mut tree) = supervisor::spawn(&mut cmd, "antigravity")
        .map_err(|e| format!("Failed to start antigravity ({bin}): {e}"))?;
    let _running = Running::register(&request.run_id, tree.pid());

    let stdout = child.stdout.take().ok_or("antigravity has no stdout")?;
    let stderr = child.stderr.take().ok_or("antigravity has no stderr")?;
    let errors = collect_stderr(stderr);

    on_event.send(ChatStreamEvent::Started).map_err(|e| e.to_string())?;

    let mut lines = BufReader::new(stdout).lines();
    let mut stream = AntigravityStream::new();
    let mut finished = false;
    let mut failure = None;

    while let Ok(Some(line)) = lines.next_line().await {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let Ok(event) = serde_json::from_str::<Value>(line) else {
            eprintln!("[antigravity] non-JSON line: {}", &line[..line.len().min(200)]);
            continue;
        };
        for outcome in stream.handle(&event) {
            match outcome {
                Outcome::Emit(event) => {
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
        return Err(known_error(&format!("{message}\n{stderr_text}")).unwrap_or(message));
    }
    if finished {
        return on_event
            .send(ChatStreamEvent::Done {
                model_id: format!("antigravity:{}", request.model.as_deref().unwrap_or("auto")),
            })
            .map_err(|e| e.to_string());
    }
    if status.success() {
        return Err(known_error(&stderr_text)
            .unwrap_or_else(|| format!("antigravity ended without a reply.{}", tail(&stderr_text))));
    }
    // Exit 42 = bad input, 53 = turn limit; surface stderr so it is actionable.
    Err(known_error(&stderr_text)
        .unwrap_or_else(|| format!("antigravity exited with {status}.{}", tail(&stderr_text))))
}

/// Failures with a known fix get a plain explanation instead of a stack trace.
fn known_error(stderr: &str) -> Option<String> {
    // Exit 41 = auth: the CLI is set to API-key sign-in but got no key.
    if stderr.contains("must specify the ANTIGRAVITY_API_KEY") {
        return Some(MISSING_KEY.into());
    }
    let limited = ["status: 429", "\"code\":429", "RESOURCE_EXHAUSTED", "Quota exceeded", "Too Many Requests"]
        .iter()
        .any(|needle| stderr.contains(needle));
    limited.then(|| RATE_LIMITED.into())
}

const MISSING_KEY: &str = "Antigravity CLI is set to sign in with an API key, but it got none. \
A key saved in antigravity's own /auth screen only works in its terminal UI, not here.\n\n\
Fix one of these:\n\
• Add your key in Settings → Models → Antigravity (from https://aistudio.google.com/app/apikey), or\n\
• Run `antigravity` in a terminal, type /auth and choose \"Sign in with Google\".";

const RATE_LIMITED: &str = "Antigravity API: 429 Too Many Requests — the quota for this API key is used up \
(the free tier allows only a few requests per minute and per day, and one task can use many).\n\n\
Try one of these:\n\
• Wait a minute and send again (per-minute limit), or try tomorrow (daily limit)\n\
• Switch to Antigravity 2.5 Flash — it has a bigger free quota than Pro\n\
• Check usage or turn on billing at https://aistudio.google.com/usage\n\
• Or sign in with Google instead of a key: run `antigravity`, type /auth, choose \"Sign in with Google\"";

fn tail(stderr: &str) -> String {
    // Stack frames and startup chatter hide the one line that matters.
    let lines: Vec<&str> = stderr
        .lines()
        .map(str::trim_end)
        .filter(|l| {
            let t = l.trim_start();
            !t.is_empty()
                && !t.starts_with("at ")
                && !t.starts_with("[STARTUP]")
                && !t.starts_with("YOLO mode is enabled")
        })
        .collect();
    if lines.is_empty() {
        return String::new();
    }
    let start = lines.len().saturating_sub(12);
    format!("\n\n— antigravity —\n{}", lines[start..].join("\n"))
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
                eprintln!("[antigravity:stderr] {line}");
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
pub fn antigravity_abort(run_id: String) -> Result<(), String> {
    let Some(pid) = Running::registry().lock().unwrap().get(&run_id).copied() else {
        return Ok(());
    };
    // Stops the whole tree, so the tools it started stop too.
    supervisor::terminate(pid);
    Ok(())
}

async fn run(bin: &str, args: &[&str]) -> Result<String, String> {
    let output = tokio::time::timeout(CHECK_TIMEOUT, antigravity_command(bin, args).output())
        .await
        .map_err(|_| format!("`antigravity {}` timed out", args.join(" ")))?
        .map_err(|e| e.to_string())?;
    if !output.status.success() {
        let error = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if error.is_empty() {
            format!("`antigravity {}` exited with {}", args.join(" "), output.status)
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

    fn request(mode: &str, folders: Vec<FolderGrant>) -> AntigravityRequest {
        AntigravityRequest {
            prompt: "do it".into(),
            model: Some("antigravity-2.5-pro".into()),
            cwd: Some("/w".into()),
            session_id: None,
            mode: Some(mode.into()),
            folders,
            run_id: "run1".into(),
            images: Vec::new(),
            api_key: None,
        }
    }

    fn grant(path: &str, access: &str) -> FolderGrant {
        FolderGrant { path: path.into(), access: access.into() }
    }

    #[test]
    fn chat_mode_is_read_only_plan() {
        let args = build_args(&request("chat", vec![]));
        assert!(args.windows(2).any(|w| w == ["--approval-mode", "plan"]));
        // Not a flag this CLI knows: passing it makes antigravity exit 1.
        assert!(!args.iter().any(|a| a == "--skip-trust"));
        assert!(args.windows(2).any(|w| w == ["--output-format", "stream-json"]));
        // Chat never resumes or exposes folders.
        assert!(!args.iter().any(|a| a == "-r"));
    }

    #[test]
    fn cowork_with_write_access_may_act() {
        let args = build_args(&request("cowork", vec![grant("/w", "write")]));
        if cfg!(target_os = "macos") {
            assert!(args.windows(2).any(|w| w == ["--approval-mode", "yolo"]));
            assert!(args.iter().any(|a| a == "--sandbox"), "yolo only runs sandboxed");
        } else {
            assert!(args.windows(2).any(|w| w == ["--approval-mode", "auto_edit"]));
        }
        assert!(args.windows(2).any(|w| w == ["-m", "antigravity-2.5-pro"]));
    }

    #[test]
    fn read_only_working_folder_stays_read_only() {
        let args = build_args(&request("cowork", vec![grant("/w", "read")]));
        assert!(args.windows(2).any(|w| w == ["--approval-mode", "plan"]));
    }

    #[test]
    fn session_resumes_and_extra_folders_are_included() {
        let mut req = request("cowork", vec![grant("/w", "write"), grant("/docs", "read")]);
        req.session_id = Some("sess-1".into());
        let args = build_args(&req);
        assert!(args.windows(2).any(|w| w == ["-r", "sess-1"]));
        assert!(args.windows(2).any(|w| w == ["--include-directories", "/docs"]));

        let prompt = prompt_with_notes(&req);
        assert!(prompt.contains("/docs"));
        assert!(prompt.contains("read-only"));
        assert!(prompt.ends_with("do it"));
        assert_eq!(prompt_with_notes(&request("chat", vec![grant("/docs", "read")])), "do it");
    }

    #[test]
    fn rate_limits_get_a_plain_explanation() {
        let stderr = "    at async retryWithBackoff (file:///x.js:1:1) {\n  status: 429\n}\nYOLO mode is enabled.";
        assert_eq!(known_error(stderr).as_deref(), Some(RATE_LIMITED));
        assert_eq!(known_error("must specify the ANTIGRAVITY_API_KEY").as_deref(), Some(MISSING_KEY));
        assert!(known_error("something else").is_none());
        assert_eq!(tail(stderr), "\n\n— antigravity —\n  status: 429\n}");
    }

    #[test]
    fn settings_key_wins_over_the_environment() {
        assert_eq!(
            api_key_for(Some("  from-settings ")),
            Some(("from-settings".into(), "Settings"))
        );
    }

    #[test]
    fn auto_model_is_left_to_antigravity() {
        let mut req = request("cowork", vec![grant("/w", "write")]);
        req.model = Some("auto".into());
        assert!(!build_args(&req).iter().any(|a| a == "-m"));
    }
}
