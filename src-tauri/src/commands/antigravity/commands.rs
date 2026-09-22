use std::collections::HashMap;
use std::process::Stdio;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use serde_json::Value;
use tauri::ipc::Channel;
use tokio::io::{AsyncBufReadExt, BufReader};

use crate::chat_stream::ChatStreamEvent;
use crate::commands::supervisor;

use super::bin::{antigravity_bin, antigravity_command, not_found_message, settings_path};
use super::stream::{AntigravityStream, Outcome};
use super::{AntigravityCheckResult, AntigravityModel, AntigravityRequest};

const CHECK_TIMEOUT: Duration = Duration::from_secs(30);
/// `agy` gives up on a prompt after five minutes by default, which is short
/// for a Cowork task, so the ceiling is raised for every run.
const PRINT_TIMEOUT: &str = "30m";
/// `agy models` is asked again at most this often.
const MODELS_TTL: Duration = Duration::from_secs(120);

/// The key handed to `agy` as `GEMINI_API_KEY`: the one from Settings first,
/// then the environment. The CLI reads the key from `GEMINI_API_KEY` only —
/// `GOOGLE_API_KEY` and `.env` files have no effect.
pub fn api_key_for(settings_key: Option<&str>) -> Option<(String, &'static str)> {
    if let Some(key) = settings_key.map(str::trim).filter(|k| !k.is_empty()) {
        return Some((key.to_string(), "Settings"));
    }
    match std::env::var("GEMINI_API_KEY") {
        Ok(value) if !value.trim().is_empty() => Some((value.trim().to_string(), "GEMINI_API_KEY")),
        _ => None,
    }
}

/// True when the CLI's own settings put it in API-key mode. Without that
/// setting a `GEMINI_API_KEY` is ignored, and with it the CLI refuses to start
/// unless the key is in the environment.
fn wants_api_key() -> bool {
    let Some(path) = settings_path() else { return false };
    let Ok(raw) = std::fs::read_to_string(path) else { return false };
    serde_json::from_str::<Value>(&raw)
        .ok()
        .and_then(|settings| settings["modelProvider"].as_str().map(|p| p.eq_ignore_ascii_case("gemini")))
        .unwrap_or(false)
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

    let version = match run(bin, &["--version"], api_key.as_deref()).await {
        Ok(out) => out.lines().next().unwrap_or_default().trim().to_string(),
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

    // The account lives in the OS keyring, so sign-in is proven by asking the
    // CLI something it can only answer once authenticated.
    let (logged_in, error) = match models(bin, api_key.as_deref()).await {
        Ok(_) => (true, None),
        Err(failure) => (false, Some(sign_in_hint(&failure))),
    };
    let account = logged_in.then(|| match api_key_for(api_key.as_deref()) {
        Some((_, from)) if wants_api_key() => format!("Gemini API key ({from})"),
        _ => "Google account".into(),
    });
    AntigravityCheckResult { available: true, logged_in, version: Some(version), path, account, error }
}

/// What to tell the user when the CLI would not answer.
fn sign_in_hint(failure: &str) -> String {
    if wants_api_key() && api_key_for(None).is_none() {
        return MISSING_KEY.into();
    }
    let auth = ["authenticat", "sign in", "sign-in", "login", "credential", "token", "keyring", "unauthor"]
        .iter()
        .any(|needle| failure.to_lowercase().contains(needle));
    if auth {
        return format!("{SIGN_IN}\n\n— agy —\n{}", first_lines(failure, 4));
    }
    format!("Antigravity CLI did not answer.{}", tail(failure))
}

/// The slugs `agy models` prints, cached briefly so the check and the model
/// list share one call.
async fn models(bin: &str, api_key: Option<&str>) -> Result<Vec<AntigravityModel>, String> {
    static CACHE: OnceLock<Mutex<Option<(Instant, Vec<AntigravityModel>)>>> = OnceLock::new();
    let cache = CACHE.get_or_init(Default::default);
    if let Some((at, models)) = cache.lock().unwrap().as_ref() {
        if at.elapsed() < MODELS_TTL && !models.is_empty() {
            return Ok(models.clone());
        }
    }
    let output = run(bin, &["models"], api_key).await?;
    let models: Vec<AntigravityModel> = output.lines().filter_map(parse_model_line).collect();
    if models.is_empty() {
        return Err(format!("`agy models` listed no models.{}", tail(&output)));
    }
    *cache.lock().unwrap() = Some((Instant::now(), models.clone()));
    Ok(models)
}

#[tauri::command]
pub async fn antigravity_list_models(api_key: Option<String>) -> Result<Vec<AntigravityModel>, String> {
    let bin = antigravity_bin().ok_or_else(not_found_message)?;
    models(bin, api_key.as_deref()).await
}

/// `agy models` prints one model per line: the slug, then its display name —
/// `gemini-3.1-pro-high       Gemini 3.1 Pro (High)`.
fn parse_model_line(line: &str) -> Option<AntigravityModel> {
    let line = line.trim();
    if line.is_empty() || line == "..." || line.starts_with(['-', '#']) {
        return None;
    }
    if line.ends_with(':') {
        return None;
    }
    let (id, name) = line.split_once(char::is_whitespace)?;
    let id = id.trim();
    let name = name.trim();
    // A slug, not prose: every slug carries a version, so a heading like
    // "Available models:" or a sentence is skipped.
    let slug = !id.is_empty()
        && id.len() <= 80
        && id.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | '/'))
        && id.chars().any(|c| c.is_ascii_digit() || c == '-');
    if !slug {
        return None;
    }
    Some(AntigravityModel {
        id: id.to_string(),
        name: if name.is_empty() { id.to_string() } else { name.to_string() },
    })
}

/// Base args for one prompt. The prompt itself is passed via `-p` last.
pub fn build_args(request: &AntigravityRequest) -> Vec<String> {
    let mut args: Vec<String> = vec![
        "--output-format".into(),
        "stream-json".into(),
        "--print-timeout".into(),
        PRINT_TIMEOUT.into(),
    ];

    // Headless runs cannot ask, so what the agent may do is decided up front.
    // Under the CLI's default preset a tool it can't get approval for is
    // soft-denied, which is what Chat and a read-only folder want. A folder
    // granted for writing gets every tool approved instead, with the terminal
    // sandbox on so shell commands stay inside the workspace.
    if !(request.is_chat() || request.read_only()) {
        args.extend(["--dangerously-skip-permissions".into(), "--sandbox".into()]);
    }

    if let Some(model) = request
        .model
        .as_deref()
        .map(str::trim)
        .filter(|m| !m.is_empty() && *m != "auto")
    {
        args.extend(["--model".into(), model.into()]);
    }
    if let Some(conversation) = request
        .session_id
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        args.extend(["--conversation".into(), conversation.into()]);
    }
    args
}

/// The CLI has no flag for extra folders or per-folder access in headless mode,
/// so the granted folders are stated in the prompt — same pattern as
/// cursor/codex. Files outside the workspace also need
/// `"allowNonWorkspaceAccess": true` in the CLI's settings.
pub fn prompt_with_notes(request: &AntigravityRequest) -> String {
    let prompt = request.prompt.trim().to_string();
    if request.is_chat() {
        return prompt;
    }
    let mut notes: Vec<String> = Vec::new();
    let extra = request.extra_folders();
    if !extra.is_empty() {
        notes.push(format!("The user also granted these folders:\n- {}", extra.join("\n- ")));
    }
    let read_only: Vec<&str> = request
        .folders
        .iter()
        .filter(|f| !f.writable())
        .map(|f| f.path.as_str())
        .collect();
    if !read_only.is_empty() {
        notes.push(format!(
            "These folders are read-only. Do not create, modify or delete anything in them:\n- {}",
            read_only.join("\n- ")
        ));
    }
    if notes.is_empty() {
        return prompt;
    }
    format!("[{}]\n\n{prompt}", notes.join("\n\n"))
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
    // `-p` forces headless mode; it also accepts piped stdin, which we close.
    args.extend(["-p".into(), prompt_with_notes(request)]);
    let arg_refs: Vec<&str> = args.iter().map(String::as_str).collect();

    // Supervised, so the agent and the tools and MCP servers it starts
    // always stop together.
    let mut cmd = supervisor::command(antigravity_command(bin, &arg_refs));
    cmd.stdout(Stdio::piped()).stderr(Stdio::piped());
    if let Some((key, _)) = api_key_for(request.api_key.as_deref()) {
        cmd.env("GEMINI_API_KEY", key);
    }
    // The CLI is workspace-scoped: it reads settings, rules and skills from cwd.
    if let Some(cwd) = request.workspace() {
        cmd.current_dir(cwd);
    }
    let (mut child, mut tree) = supervisor::spawn(&mut cmd, "antigravity")
        .map_err(|e| format!("Failed to start agy ({bin}): {e}"))?;
    let _running = Running::register(&request.run_id, tree.pid());

    let stdout = child.stdout.take().ok_or("agy has no stdout")?;
    let stderr = child.stderr.take().ok_or("agy has no stderr")?;
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
        // Exit 0 without a result: a tool was soft-denied, or nothing was said.
        return Err(known_error(&stderr_text)
            .unwrap_or_else(|| format!("agy ended without a reply.{}", tail(&stderr_text))));
    }
    // Exit 1 = bad input or unknown model, 2 = unsupported stream message.
    Err(known_error(&stderr_text)
        .unwrap_or_else(|| format!("agy exited with {status}.{}", tail(&stderr_text))))
}

/// Failures with a known fix get a plain explanation instead of a stack trace.
fn known_error(stderr: &str) -> Option<String> {
    let lower = stderr.to_lowercase();
    if lower.contains("gemini_api_key") {
        return Some(MISSING_KEY.into());
    }
    if lower.contains("authentication required") || lower.contains("failed to retrieve token") {
        return Some(SIGN_IN.into());
    }
    let limited = ["status: 429", "\"code\":429", "RESOURCE_EXHAUSTED", "Quota exceeded", "Too Many Requests"]
        .iter()
        .any(|needle| stderr.contains(needle))
        || lower.contains("quota");
    limited.then(|| RATE_LIMITED.into())
}

const SIGN_IN: &str = "Not signed in to Antigravity. Run `agy` once in a terminal and finish the \
browser sign-in — headless runs use the session it saves in your keyring. On a machine without a \
browser, sign in over SSH with the code the CLI prints.";

const MISSING_KEY: &str = "Antigravity CLI is set to sign in with a Gemini API key \
(`\"modelProvider\": \"gemini\"` in ~/.gemini/antigravity-cli/settings.json), but it got none.\n\n\
Fix one of these:\n\
• Add your key in Settings → Models → Google (from https://aistudio.google.com/app/apikey), or\n\
• Remove `modelProvider` from that settings file and run `agy` once to sign in with your Google account.";

const RATE_LIMITED: &str = "Antigravity: the quota for this account or key is used up.\n\n\
Try one of these:\n\
• Wait a minute and send again (per-minute limit), or try tomorrow (daily limit)\n\
• Pick a Flash model — its quota is bigger than Pro's\n\
• Check what is left with `agy -p /usage`, or see your AI credits at https://antigravity.google/";

/// The first `n` non-empty lines, for quoting a failure back.
fn first_lines(text: &str, n: usize) -> String {
    text.lines().map(str::trim).filter(|l| !l.is_empty()).take(n).collect::<Vec<_>>().join("\n")
}

fn tail(stderr: &str) -> String {
    // Stack frames and startup chatter hide the one line that matters.
    let lines: Vec<&str> = stderr
        .lines()
        .map(str::trim_end)
        .filter(|l| {
            let t = l.trim_start();
            !t.is_empty() && !t.starts_with("at ") && !t.starts_with("[STARTUP]")
        })
        .collect();
    if lines.is_empty() {
        return String::new();
    }
    let start = lines.len().saturating_sub(12);
    format!("\n\n— agy —\n{}", lines[start..].join("\n"))
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

async fn run(bin: &str, args: &[&str], api_key: Option<&str>) -> Result<String, String> {
    let mut cmd = antigravity_command(bin, args);
    if let Some((key, _)) = api_key_for(api_key) {
        cmd.env("GEMINI_API_KEY", key);
    }
    let output = tokio::time::timeout(CHECK_TIMEOUT, cmd.output())
        .await
        .map_err(|_| format!("`agy {}` timed out", args.join(" ")))?
        .map_err(|e| e.to_string())?;
    if !output.status.success() {
        let error = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if error.is_empty() {
            format!("`agy {}` exited with {}", args.join(" "), output.status)
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
            model: Some("gemini-3.1-pro-high".into()),
            cwd: Some("/w".into()),
            session_id: None,
            mode: Some(mode.into()),
            folders,
            run_id: "run1".into(),
            api_key: None,
        }
    }

    fn grant(path: &str, access: &str) -> FolderGrant {
        FolderGrant { path: path.into(), access: access.into() }
    }

    #[test]
    fn every_run_streams_json_and_raises_the_timeout() {
        let args = build_args(&request("chat", vec![]));
        assert!(args.windows(2).any(|w| w == ["--output-format", "stream-json"]));
        assert!(args.windows(2).any(|w| w == ["--print-timeout", PRINT_TIMEOUT]));
        // Not flags this CLI knows: passing one makes agy exit non-zero.
        for unknown in ["--approval-mode", "--include-directories", "-m", "-r"] {
            assert!(!args.iter().any(|a| a == unknown), "{unknown} is not an agy flag");
        }
    }

    #[test]
    fn chat_never_approves_tools_or_resumes() {
        let args = build_args(&request("chat", vec![]));
        assert!(!args.iter().any(|a| a == "--dangerously-skip-permissions"));
        assert!(!args.iter().any(|a| a == "--conversation"));
    }

    #[test]
    fn cowork_with_write_access_may_act_inside_the_sandbox() {
        let args = build_args(&request("cowork", vec![grant("/w", "write")]));
        assert!(args.iter().any(|a| a == "--dangerously-skip-permissions"));
        assert!(args.iter().any(|a| a == "--sandbox"));
        assert!(args.windows(2).any(|w| w == ["--model", "gemini-3.1-pro-high"]));
    }

    #[test]
    fn read_only_working_folder_keeps_the_asking_preset() {
        let args = build_args(&request("cowork", vec![grant("/w", "read")]));
        assert!(!args.iter().any(|a| a == "--dangerously-skip-permissions"));
    }

    #[test]
    fn a_conversation_resumes_and_extra_folders_are_named_in_the_prompt() {
        let mut req = request("cowork", vec![grant("/w", "write"), grant("/docs", "read")]);
        req.session_id = Some("055a398f-db14-4c5f-abbb-1bf03f8120a7".into());
        let args = build_args(&req);
        assert!(args
            .windows(2)
            .any(|w| w == ["--conversation", "055a398f-db14-4c5f-abbb-1bf03f8120a7"]));

        let prompt = prompt_with_notes(&req);
        assert!(prompt.contains("/docs"));
        assert!(prompt.contains("read-only"));
        assert!(prompt.ends_with("do it"));
        assert_eq!(prompt_with_notes(&request("chat", vec![grant("/docs", "read")])), "do it");
    }

    #[test]
    fn auto_model_is_left_to_antigravity() {
        let mut req = request("cowork", vec![grant("/w", "write")]);
        req.model = Some("auto".into());
        assert!(!build_args(&req).iter().any(|a| a == "--model"));
    }

    #[test]
    fn model_lines_parse_and_prose_is_skipped() {
        let output = "Available models:\ngemini-3.8-flash-high     Gemini 3.8 Flash (High)\n\
                      claude-sonnet-4-6         Claude Sonnet 4.6 (Thinking)\n...\n";
        let models: Vec<AntigravityModel> = output.lines().filter_map(parse_model_line).collect();
        assert_eq!(models.len(), 2);
        assert_eq!(models[0].id, "gemini-3.8-flash-high");
        assert_eq!(models[0].name, "Gemini 3.8 Flash (High)");
        assert_eq!(models[1].id, "claude-sonnet-4-6");
    }

    #[test]
    fn known_failures_get_a_plain_explanation() {
        assert_eq!(
            known_error("Error: GEMINI_API_KEY is not set").as_deref(),
            Some(MISSING_KEY)
        );
        assert_eq!(known_error("authentication required").as_deref(), Some(SIGN_IN));
        assert_eq!(
            known_error("    at async retry (file:///x.js:1:1)\n  status: 429").as_deref(),
            Some(RATE_LIMITED)
        );
        assert!(known_error("something else").is_none());
        assert_eq!(
            tail("    at async retry (file:///x.js:1:1)\n  status: 429"),
            "\n\n— agy —\n  status: 429"
        );
    }

    #[test]
    fn settings_key_wins_over_the_environment() {
        assert_eq!(
            api_key_for(Some("  from-settings ")),
            Some(("from-settings".into(), "Settings"))
        );
    }
}
