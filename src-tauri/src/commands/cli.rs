use std::sync::{Arc, Mutex};

use serde::Deserialize;
use serde_json::Value;
use tauri::ipc::Channel;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

use crate::chat_stream::{AgentUsage, ChatStreamEvent};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CliRequest {
    pub prompt: String,
    /// เช่น "opencode" | "cursor" | "codex"
    pub agent: String,
    /// optional: working directory
    pub cwd: Option<String>,
    /// A CLI the user added in Settings → Models: how to run it.
    #[serde(default)]
    pub custom: Option<CustomCli>,
    /// Custom instructions and skills, given to the CLI as its own system
    /// instructions where it takes them, instead of inside the user's message.
    #[serde(default)]
    pub instructions: Option<String>,
    /// The CLI's own session to continue, for CLIs that can (see `resume_flag`).
    #[serde(default)]
    pub session_id: Option<String>,
}

/// A CLI agent the user set up themselves, for one Mali doesn't know yet.
/// Its output is read as plain text (or JSON lines with a `text` field).
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomCli {
    /// What the user calls it, for error messages.
    #[serde(default)]
    pub name: Option<String>,
    /// The program, by name on PATH or by full path.
    pub command: String,
    /// Arguments, one per entry; `{prompt}` is replaced with the prompt, and
    /// the prompt goes last when no argument names it.
    #[serde(default)]
    pub args: Vec<String>,
}

const PROMPT_TOKEN: &str = "{prompt}";

fn custom_command(custom: &CustomCli, prompt: &str) -> Result<(String, Vec<String>), String> {
    let command = custom.command.trim();
    if command.is_empty() || command.contains(['\n', '\r', '\0']) {
        return Err("Set the command this CLI runs in Settings → Models → CLI agents.".into());
    }
    let mut args: Vec<String> = custom.args.iter().map(|a| a.replace(PROMPT_TOKEN, prompt)).collect();
    if !custom.args.iter().any(|a| a.contains(PROMPT_TOKEN)) {
        args.push(prompt.to_string());
    }
    Ok((command.to_string(), args))
}

fn agent_command(agent: &str, prompt: &str, custom: Option<&CustomCli>) -> Result<(String, Vec<String>), String> {
    if let Some(custom) = custom {
        return custom_command(custom, prompt);
    }
    match agent {
        "opencode" => Ok((
            "opencode".into(),
            vec!["run".into(), "--format".into(), "json".into(), prompt.into(), "--thinking".into()],
        )),
        "cursor" => Ok((
            "cursor-agent".into(),
            vec![
                "--print".into(),
                "--output-format".into(),
                "stream-json".into(),
                "--stream-partial-output".into(),
                "--trust".into(),
                prompt.into(),
            ],
        )),
        "codex" => Ok((
            "codex".into(),
            vec!["exec".into(), "--json".into(), prompt.into()],
        )),
        other => Err(format!(
            "Unknown agent: {other}. Available: opencode, cursor, codex"
        )),
    }
}

/// How a CLI takes system instructions apart from the message.
#[derive(Debug, PartialEq)]
enum InstructionsChannel {
    /// OpenCode-style config JSON in this env var: `instructions` lists files
    /// to load, and `mcp` gets Mali's `mali` gateway.
    ConfigEnv(&'static str),
    /// A flag that appends its value to the system prompt.
    AppendFlag(&'static str),
}

fn instructions_channel(stem: &str) -> Option<InstructionsChannel> {
    match stem {
        "kilo" => Some(InstructionsChannel::ConfigEnv("KILO_CONFIG_CONTENT")),
        "opencode" => Some(InstructionsChannel::ConfigEnv("OPENCODE_CONFIG_CONTENT")),
        "claude" => Some(InstructionsChannel::AppendFlag("--append-system-prompt")),
        _ => None,
    }
}

/// The flag that continues one of the CLI's own sessions. Mali only keeps a
/// session for these; any other CLI hears the earlier turns in the message.
fn resume_flag(stem: &str) -> Option<&'static str> {
    match stem {
        "kilo" | "opencode" => Some("--session"),
        _ => None,
    }
}

/// Instructions written out for a config-driven CLI to load; removed with the run.
struct InstructionsFile(std::path::PathBuf);

impl Drop for InstructionsFile {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.0);
    }
}

/// Config JSON for the run: whatever the user already set in the env var,
/// plus `file` in its `instructions` and `mcp` entries added to its `mcp`.
fn run_config(existing: Option<&str>, file: Option<&str>, mcp: Option<(&str, Value)>) -> String {
    let mut config = existing
        .and_then(|raw| serde_json::from_str::<Value>(raw).ok())
        .filter(Value::is_object)
        .unwrap_or_else(|| serde_json::json!({}));
    let object = config.as_object_mut().expect("config is an object");
    if let Some(file) = file {
        let list = object.entry("instructions").or_insert_with(|| Value::Array(Vec::new()));
        if !list.is_array() {
            *list = Value::Array(Vec::new());
        }
        list.as_array_mut().expect("instructions is an array").push(Value::String(file.into()));
    }
    if let Some((name, entry)) = mcp {
        let servers = object.entry("mcp").or_insert_with(|| serde_json::json!({}));
        if !servers.is_object() {
            *servers = serde_json::json!({});
        }
        servers.as_object_mut().expect("mcp is an object").insert(name.into(), entry);
    }
    config.to_string()
}

fn resolve_bin(bin: &str) -> Option<String> {
    // 1. ENV override เช่น OPENCODE_BIN, CURSOR_AGENT_BIN
    let env_key = format!("{}_BIN", bin.to_uppercase().replace('-', "_"));
    if let Ok(p) = std::env::var(&env_key) {
        if !p.trim().is_empty() && std::path::Path::new(&p).exists() {
            return Some(p);
        }
    }

    // 2. ลอง where.exe (Windows) / which (Unix)
    #[cfg(windows)]
    {
        let mut candidates: Vec<String> = Vec::new();
        for query in [bin.to_string(), format!("{bin}.cmd"), format!("{bin}.exe"), format!("{bin}.bat")] {
            if let Ok(out) = crate::commands::process::std_command("where.exe").arg(&query).output() {
                if out.status.success() {
                    let s = String::from_utf8_lossy(&out.stdout);
                    for line in s.lines() {
                        let p = line.trim();
                        if !p.is_empty() && std::path::Path::new(p).exists() {
                            candidates.push(p.to_string());
                        }
                    }
                }
            }
        }
        if !candidates.is_empty() {
            candidates.sort_by_key(|p| {
                let l = p.to_lowercase();
                if l.ends_with(".cmd") { 0 } else if l.ends_with(".exe") { 1 } else if l.ends_with(".bat") { 2 } else if l.ends_with(".com") { 3 } else { 10 }
            });
            return Some(candidates[0].clone());
        }
    }
    // PATH plus the folders installers use (Homebrew, ~/.npm-global, …),
    // which a GUI app's short PATH misses.
    #[cfg(not(windows))]
    if let Some(p) = super::setup::find_tool(bin) {
        return Some(p.to_string_lossy().into_owned());
    }

    if let Ok(path_var) = std::env::var("PATH") {
        let sep = if cfg!(windows) { ';' } else { ':' };
        let pathext: Vec<String> = if cfg!(windows) {
            std::env::var("PATHEXT")
                .unwrap_or_else(|_| ".EXE;.CMD;.BAT;.COM".into())
                .split(';')
                .map(|s| s.to_string())
                .collect()
        } else {
            vec!["".into()]
        };
        for dir in path_var.split(sep) {
            if dir.is_empty() { continue; }
            for ext in &pathext {
                if ext.is_empty() { continue; }
                let candidate = std::path::Path::new(dir).join(format!("{bin}{ext}"));
                if candidate.exists() {
                    return Some(candidate.to_string_lossy().to_string());
                }
            }
            #[cfg(not(windows))]
            {
                let direct = std::path::Path::new(dir).join(bin);
                if direct.exists() { return Some(direct.to_string_lossy().to_string()); }
            }
        }
    }

    #[cfg(windows)]
    {
        let home = std::env::var("USERPROFILE").unwrap_or_default();
        let appdata = std::env::var("APPDATA").unwrap_or_default();
        let candidates = vec![
            format!(r"{appdata}\npm\{bin}.cmd"),
            format!(r"{appdata}\npm\{bin}"),
            format!(r"{home}\.bun\bin\{bin}.exe"),
            format!(r"{home}\.bun\bin\{bin}.cmd"),
            format!(r"{home}\AppData\Local\Programs\cursor-agent\{bin}.exe"),
            format!(r"C:\Program Files\nodejs\{bin}.cmd"),
        ];
        for c in candidates { if std::path::Path::new(&c).exists() { return Some(c); } }
    }

    None
}

fn build_command(bin_path: &str, args: &[String]) -> Command {
    let args: Vec<&str> = args.iter().map(String::as_str).collect();
    super::process::command(bin_path, &args)
}

/// The user's PATH plus installer folders, so a Node-based CLI finds `node`
/// even when the app was opened from the Dock.
fn augment_path_for_child(cmd: &mut Command) {
    if let Some(path) = super::setup::child_path() {
        cmd.env("PATH", path);
    }
}

// ── parsers ──

fn parse_cursor_line(v: &Value) -> Option<ChatStreamEvent> {
    let typ = v.get("type")?.as_str()?;
    match typ {
        "thinking" => {
            // {"type":"thinking","subtype":"delta","text":"..."}
            if v.get("subtype").and_then(|x| x.as_str()) == Some("delta") {
                let t = v.get("text")?.as_str()?;
                if !t.is_empty() {
                    return Some(ChatStreamEvent::Reasoning { reasoning: t.to_string() });
                }
            }
        }
        "assistant" => {
            // {"type":"assistant","message":{"content":[{"type":"text","text":"..."}]}}
            if let Some(msg) = v.get("message") {
                if let Some(content) = msg.get("content").and_then(|c| c.as_array()) {
                    let mut text = String::new();
                    for part in content {
                        if part.get("type").and_then(|x| x.as_str()) == Some("text") {
                            if let Some(t) = part.get("text").and_then(|x| x.as_str()) {
                                text.push_str(t);
                            }
                        }
                    }
                    if !text.is_empty() {
                        return Some(ChatStreamEvent::Chunk { text: text.clone() + "\n" });
                    }
                }
            }
        }
        "result" => {
            // usage is in v["usage"]
            let usage = v.get("usage").map(|u| AgentUsage {
                input_tokens: u.get("inputTokens").and_then(|x| x.as_u64()),
                output_tokens: u.get("outputTokens").and_then(|x| x.as_u64()),
                cache_read_tokens: u.get("cacheReadTokens").and_then(|x| x.as_u64()),
                cache_write_tokens: u.get("cacheWriteTokens").and_then(|x| x.as_u64()),
                reasoning_tokens: None,
                total_tokens: None,
                cost: None,
                context_tokens: None,
            });
            let session_id = v.get("session_id").and_then(|x| x.as_str()).map(|s| s.to_string());
            let duration_ms = v.get("duration_ms").and_then(|x| x.as_u64());
            let model = v.get("model").and_then(|x| x.as_str()).map(|s| s.to_string());
            return Some(ChatStreamEvent::Metadata { session_id, usage, duration_ms, model });
        }
        "system" | "user" => {
            // ignore init
        }
        _ => {}
    }
    None
}

fn parse_opencode_line(v: &Value) -> Option<ChatStreamEvent> {
    let typ = v.get("type")?.as_str()?;
    match typ {
        "text" => {
            // {"type":"text","part":{"type":"text","text":"..."}}
            let t = v.get("part").and_then(|p| p.get("text")).and_then(|x| x.as_str())
                .or_else(|| v.get("text").and_then(|x| x.as_str()))?;
            if !t.is_empty() {
                return Some(ChatStreamEvent::Chunk { text: t.to_string() });
            }
        }
        "reasoning" => {
            let t = v.get("part").and_then(|p| p.get("text")).and_then(|x| x.as_str())
                .or_else(|| v.get("reasoning").and_then(|x| x.as_str()))?;
            if !t.is_empty() {
                return Some(ChatStreamEvent::Reasoning { reasoning: t.to_string() });
            }
        }
        "step_finish" => {
            // {"type":"step_finish","part":{"tokens":{...},"cost":...}}
            let part = v.get("part")?;
            let tokens = part.get("tokens")?;
            let usage = AgentUsage {
                input_tokens: tokens.get("input").and_then(|x| x.as_u64()),
                output_tokens: tokens.get("output").and_then(|x| x.as_u64()),
                cache_read_tokens: tokens.get("cache").and_then(|c| c.get("read")).and_then(|x| x.as_u64()),
                cache_write_tokens: tokens.get("cache").and_then(|c| c.get("write")).and_then(|x| x.as_u64()),
                reasoning_tokens: tokens.get("reasoning").and_then(|x| x.as_u64()),
                total_tokens: tokens.get("total").and_then(|x| x.as_u64()),
                cost: part.get("cost").and_then(|x| x.as_f64()),
                context_tokens: None,
            };
            let session_id = v.get("sessionID").and_then(|x| x.as_str()).map(|s| s.to_string());
            return Some(ChatStreamEvent::Metadata { session_id, usage: Some(usage), duration_ms: None, model: None });
        }
        // {"type":"tool_use","part":{"type":"tool","tool":"bash","state":{...}}}
        "tool_use" => return crate::commands::opencode::events::tool_activity(v.get("part")?),
        _ => {}
    }
    None
}

fn parse_codex_line(v: &Value) -> Option<ChatStreamEvent> {
    // codex exec --json: {"type":"item.completed","item":{"text":"..."}}
    if v.get("type").and_then(|x| x.as_str()) == Some("item.completed") {
        if let Some(t) = v.get("item").and_then(|i| i.get("text")).and_then(|x| x.as_str()) {
            if !t.is_empty() {
                return Some(ChatStreamEvent::Chunk { text: t.to_string() + "\n" });
            }
        }
    }
    // also try generic text
    if let Some(t) = v.get("text").and_then(|x| x.as_str()) {
        if !t.is_empty() { return Some(ChatStreamEvent::Chunk { text: t.to_string() + "\n" }); }
    }
    None
}

#[tauri::command]
pub async fn cli_generate(
    request: CliRequest,
    on_event: Channel<ChatStreamEvent>,
) -> Result<(), String> {
    let prompt = request.prompt.trim().to_string();
    if prompt.is_empty() {
        let _ = on_event.send(ChatStreamEvent::Error { message: "Prompt cannot be empty.".into() });
        return Ok(());
    }

    let instructions = request.instructions.as_deref().map(str::trim).filter(|i| !i.is_empty());
    let stem = request
        .custom
        .as_ref()
        .map(|c| c.command.as_str())
        .or(match request.agent.as_str() {
            "opencode" => Some("opencode"),
            _ => None,
        })
        .map(command_stem)
        .unwrap_or_default();
    let channel = instructions_channel(&stem);
    let resume = resume_flag(&stem);
    // A CLI with no way to take instructions apart hears them in the message.
    let prompt = match (instructions, &channel) {
        (Some(text), None) => format!("<instructions>\n{text}\n</instructions>\n\n{prompt}"),
        _ => prompt,
    };

    let (bin, mut args) = agent_command(&request.agent, &prompt, request.custom.as_ref())?;
    let bin_path = resolve_bin(&bin).unwrap_or_else(|| bin.clone());

    if let (Some(flag), Some(session)) = (resume, request.session_id.as_deref().map(str::trim).filter(|s| !s.is_empty())) {
        args.push(flag.into());
        args.push(session.into());
    }

    let mut config_env: Option<(&'static str, String)> = None;
    let mut _instructions_file: Option<InstructionsFile> = None;
    match &channel {
        Some(InstructionsChannel::AppendFlag(flag)) => {
            if let Some(text) = instructions {
                args.push((*flag).to_string());
                args.push(text.to_string());
            }
        }
        Some(InstructionsChannel::ConfigEnv(var)) => {
            let file = match instructions {
                Some(text) => {
                    let path = std::env::temp_dir().join(format!("mali-instructions-{}.md", uuid::Uuid::new_v4()));
                    std::fs::write(&path, text).map_err(|e| format!("Couldn't write instructions for the CLI: {e}"))?;
                    let file = path.to_string_lossy().into_owned();
                    _instructions_file = Some(InstructionsFile(path));
                    Some(file)
                }
                None => None,
            };
            // The user's connectors, through Mali's gateway, as OpenCode gets them.
            let mcp = crate::mcp_hub::gateway::ensure()
                .await
                .ok()
                .map(|gw| (crate::mcp_hub::gateway::SERVER_NAME, super::mcp_bridge::opencode_gateway_entry(&gw)));
            let existing = std::env::var(var).ok();
            config_env = Some((var, run_config(existing.as_deref(), file.as_deref(), mcp)));
        }
        None => {}
    }

    on_event.send(ChatStreamEvent::Started)
        .map_err(|e| e.to_string())?;

    // Supervised, so the agent and the MCP servers it starts stop together,
    // also when this function returns early or the app quits.
    let mut cmd = super::supervisor::command(build_command(&bin_path, &args));
    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::piped());
    augment_path_for_child(&mut cmd);
    if let Some((var, config)) = config_env { cmd.env(var, config); }
    if let Some(cwd) = request.cwd { cmd.current_dir(cwd); }

    eprintln!("[cli] spawning: {bin_path} {:?}", args);

    let (mut child, _tree) = super::supervisor::spawn(&mut cmd, "cli agent").map_err(|e| {
        if let Some(custom) = request.custom.as_ref() {
            let name = custom_name(custom);
            return format!("{name} isn't installed on this computer (couldn't start `{bin}`: {e}). Open Settings → Models → {name} and press Install.");
        }
        let path = std::env::var("PATH").unwrap_or_default();
        format!("Failed to spawn `{bin}` (resolved: `{bin_path}`): {e}\nPATH={path}\nแก้: where.exe {bin} / ตั้ง {bin}_BIN")
    })?;

    let stdout = child.stdout.take().ok_or("Failed to capture stdout")?;
    let stderr = child.stderr.take().ok_or("Failed to capture stderr")?;

    // เก็บ stderr แบบ concurrent เพื่อไม่ให้ pipe เต็มแล้ว block
    let stderr_buf: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
    let stderr_buf_clone = stderr_buf.clone();
    tokio::spawn(async move {
        let mut reader = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = reader.next_line().await {
            if !line.is_empty() {
                eprintln!("[cli:stderr] {}", line);
                stderr_buf_clone.lock().unwrap().push(line);
            }
        }
    });

    let mut stdout_reader = BufReader::new(stdout).lines();
    let mut has_output = false;
    let mut has_reasoning = false;
    let mut last_metadata: Option<ChatStreamEvent> = None;
    let mut text_accum = String::new();
    let mut reasoning_accum = String::new();
    // User-added CLIs (Kilo, etc.) use their own id as `agent`; pick a parser from the command.
    let stream_kind = request
        .custom
        .as_ref()
        .and_then(custom_stream_profile)
        .unwrap_or(request.agent.as_str());

    while let Ok(Some(line)) = stdout_reader.next_line().await {
        if line.trim().is_empty() { continue; }

        // ลอง parse เป็น JSON ก่อน — สำคัญ: อย่าส่ง raw JSON ของ control messages ให้ user
        if line.trim_start().starts_with('{') {
            if let Ok(v) = serde_json::from_str::<Value>(&line) {
                let typ = v.get("type").and_then(|x| x.as_str()).unwrap_or("");
                let is_control = match stream_kind {
                    "cursor" => matches!(typ, "system" | "user" | "thinking" | "assistant" | "result" | "tool_call" | "tool_result"),
                    "opencode" => matches!(typ, "system" | "step_start" | "step_finish" | "text" | "reasoning" | "tool_use" | "tool_result" | "file" | "permission"),
                    "codex" => matches!(typ, "item.completed" | "item.started" | "thread.started"),
                    _ => false,
                };

                let event = match stream_kind {
                    "cursor" => parse_cursor_line(&v),
                    "opencode" => parse_opencode_line(&v),
                    "codex" => parse_codex_line(&v),
                    _ => None,
                };
                if let Some(mut ev) = event {
                    if resume.is_none() {
                        if let ChatStreamEvent::Metadata { session_id, .. } = &mut ev { *session_id = None; }
                    }
                    match &ev {
                        ChatStreamEvent::Chunk { text } => { has_output = true; text_accum.push_str(text); let _ = on_event.send(ev); }
                        ChatStreamEvent::Reasoning { reasoning } => { has_reasoning = true; reasoning_accum.push_str(reasoning); let _ = on_event.send(ev); }
                        ChatStreamEvent::Metadata { .. } => { last_metadata = Some(ev.clone()); let _ = on_event.send(ev); }
                        _ => { let _ = on_event.send(ev); }
                    }
                    continue;
                }
                // ถ้าเป็น JSON ที่รู้จักว่าเป็น control message แต่ parse ไม่ได้ (เช่น thinking:completed, system:init) ให้ข้าม ไม่ส่ง raw
                if is_control {
                    eprintln!("[cli] skip control json type={}", typ);
                    continue;
                }
                // ถ้าเป็น JSON แต่ไม่รู้จัก type — ลอง fallback ดึง text/reasoning ทั่วไป
                if let Some(t) = v.get("text").and_then(|x| x.as_str()) {
                    has_output = true; text_accum.push_str(t);
                    let _ = on_event.send(ChatStreamEvent::Chunk { text: t.to_string() + "\n" });
                    continue;
                }
                if let Some(r) = v.get("reasoning").and_then(|x| x.as_str()) {
                    has_reasoning = true; reasoning_accum.push_str(r);
                    let _ = on_event.send(ChatStreamEvent::Reasoning { reasoning: r.to_string() + "\n" });
                    continue;
                }
                // JSON อื่นๆ ที่ไม่รู้จักและไม่ใช่ control ให้ข้าม ไม่ส่ง raw JSON ให้ user งง
                eprintln!("[cli] skip unknown json: {}", crate::commands::truncate_chars(&line, 200));
                continue;
            }
        }

        // fallback: plain text line (ไม่ใช่ JSON)
        has_output = true;
        text_accum.push_str(&line); text_accum.push('\n');
        let text = if stream_kind == "codex" {
            parse_codex_line(&Value::String(line.clone())).map(|ev| if let ChatStreamEvent::Chunk { text } = ev { text } else { line.clone() + "\n" }).unwrap_or_else(|| line.clone() + "\n")
        } else {
            line.clone() + "\n"
        };
        let _ = on_event.send(ChatStreamEvent::Chunk { text });
    }

    let status = child.wait().await.map_err(|e| e.to_string())?;
    // ให้ stderr task มีเวลา drain
    tokio::time::sleep(std::time::Duration::from_millis(80)).await;
    let stderr_lines = stderr_buf.lock().unwrap().clone();
    let stderr_text = stderr_lines.join("\n");

    if !status.success() {
        // A CLI the user added stands on its own: explain its failure in its
        // own terms, without hints about the built-in agents.
        if let Some(custom) = request.custom.as_ref() {
            let _ = on_event.send(ChatStreamEvent::Error { message: custom_failure(custom, &stderr_lines, &text_accum) });
            return Ok(());
        }
        // ถึงแม้ exit 1 ก็ส่ง metadata ที่เก็บไว้ไปแล้ว ให้ UI เห็น reasoning/usage
        // แต่ต้องส่ง Error ที่มี context ครบให้ user debug ได้
        let mut msg = format!("Agent `{bin}` exited with {status}");
        if !stderr_text.is_empty() {
            let tail: String = stderr_lines.iter().rev().take(20).rev().cloned().collect::<Vec<_>>().join("\n");
            msg.push_str(&format!("\n\n— stderr —\n{tail}"));
        }
        if has_reasoning || has_output {
            msg.push_str(&format!("\n\n— context —\n reasoning: {} chars, output: {} chars", reasoning_accum.len(), text_accum.len()));
            if let Some(ChatStreamEvent::Metadata { usage, duration_ms, session_id, .. }) = &last_metadata {
                if let Some(u) = usage {
                    msg.push_str(&format!("\n usage: input={:?} output={:?} cache_read={:?}", u.input_tokens, u.output_tokens, u.cache_read_tokens));
                }
                if let Some(d) = duration_ms { msg.push_str(&format!("\n duration: {d}ms")); }
                if let Some(s) = session_id { msg.push_str(&format!("\n session: {s}")); }
            }
        }
        msg.push_str("\n\n[hint] ถ้าเป็น cursor-agent ลองเช็ค `cursor-agent --help` / `CURSES_API_KEY` / quota; opencode ลอง `opencode --format json` ใน terminal ว่าได้ JSON ไหม");
        let _ = on_event.send(ChatStreamEvent::Error { message: msg });
        return Ok(());
    }

    // ส่ง metadata ที่ยังไม่ได้ส่ง (กรณี opencode จบแล้วมี step_finish ค้าง)
    if let Some(ev) = last_metadata { let _ = on_event.send(ev); }

    if !has_output && !has_reasoning {
        let extra = if !stderr_text.is_empty() { format!("\nstderr: {}", stderr_lines.iter().take(5).cloned().collect::<Vec<_>>().join("; ")) } else { String::new() };
        let _ = on_event.send(ChatStreamEvent::Error { message: format!("Agent returned empty output.{extra}") });
        return Ok(());
    }

    let _ = on_event.send(ChatStreamEvent::Done { model_id: format!("cli:{}", request.agent) });
    Ok(())
}

fn custom_name(custom: &CustomCli) -> String {
    custom
        .name
        .as_deref()
        .map(str::trim)
        .filter(|n| !n.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| custom.command.trim().to_string())
}

/// A failed run of a user-added CLI in words: what to do first, then the
/// CLI's own last lines.
fn custom_failure(custom: &CustomCli, stderr: &[String], stdout: &str) -> String {
    let name = custom_name(custom);
    let output = if stderr.is_empty() { stdout.to_string() } else { stderr.join("\n") };
    let lower = output.to_ascii_lowercase();
    let advice = if lower.contains("session") && lower.contains("not found") {
        format!("{name} no longer has this chat's session. Start a new chat to keep going with {name}.")
    } else if lower.contains("model not found") || lower.contains("unknown model") || lower.contains("invalid model") {
        format!("{name} doesn't offer this model. Open Settings → Models → {name}, press Refresh list, then pick a model again.")
    } else if ["unauthorized", "not logged in", "not authenticated", "login required", "please log in", "sign in", "api key", "401"]
        .iter()
        .any(|k| lower.contains(k))
    {
        format!("{name} needs you to sign in. Open Settings → Models → {name} and press Sign in.")
    } else if ["quota", "rate limit", "insufficient", "credit", "402", "429"].iter().any(|k| lower.contains(k)) {
        format!("{name} says this account is out of credits or rate-limited. Try a free model or wait a bit.")
    } else {
        format!("{name} stopped with an error.")
    };
    let tail: Vec<&str> = output.lines().map(str::trim).filter(|l| !l.is_empty()).collect();
    let tail = tail[tail.len().saturating_sub(8)..].join("\n");
    if tail.is_empty() {
        advice
    } else {
        format!("{advice}\n\n— {name} said —\n{tail}")
    }
}

fn _unused_parse_codex_json_line(line: &str) -> Option<String> {
    let v: serde_json::Value = serde_json::from_str(line).ok()?;
    v.get("item")?.get("text")?.as_str().map(|s| s.to_string() + "\n")
}

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CustomCliModel {
    pub id: String,
    pub name: String,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliCheckResult {
    pub available: bool,
    pub version: Option<String>,
    pub path: Option<String>,
    pub error: Option<String>,
}

/// Which built-in parser understands this custom CLI's stdout (Kilo ≈ OpenCode JSON).
fn custom_stream_profile(custom: &CustomCli) -> Option<&'static str> {
    let stem = command_stem(&custom.command);
    let args = custom.args.join(" ").to_ascii_lowercase();
    if args.contains("--format json") || args.contains("--output-format stream-json") {
        return match stem.as_str() {
            "cursor-agent" | "cursor" => Some("cursor"),
            "codex" => Some("codex"),
            "kilo" | "opencode" => Some("opencode"),
            _ => Some("opencode"),
        };
    }
    if args.contains("--json") && stem == "codex" {
        return Some("codex");
    }
    None
}

fn command_stem(command: &str) -> String {
    std::path::Path::new(command)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or(command)
        .to_ascii_lowercase()
}

fn list_model_arg_sets(stem: &str) -> Vec<Vec<&'static str>> {
    match stem {
        "cursor-agent" | "cursor" => vec![vec!["--list-models"]],
        "codex" => vec![vec!["debug", "models"], vec!["models"]],
        "agy" | "antigravity" => vec![vec!["models"]],
        "aider" => vec![],
        _ => vec![
            vec!["models"],
            vec!["model", "list"],
            vec!["--list-models"],
            vec!["debug", "models"],
        ],
    }
}

fn display_name_for_model(id: &str) -> String {
    id.rsplit('/').next().unwrap_or(id).replace('-', " ")
}

fn looks_like_model_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 120
        && !id.contains(char::is_whitespace)
        && id.chars().any(|c| c.is_ascii_alphanumeric())
        && !id.starts_with("Usage:")
        && !id.starts_with("When using")
}

/// Cursor-style `"id - Name"`, OpenCode/Kilo `provider/model`, or JSON catalog.
/// Ids are kept whole: in `kilo/poolside/laguna`, `kilo` is the provider, and
/// the CLI rejects the model without it.
fn parse_cli_models(output: &str) -> Vec<CustomCliModel> {
    if let Some(models) = parse_json_model_catalog(output) {
        return models;
    }
    let mut out = Vec::new();
    for line in output.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with("When using") || line.starts_with("Update your") {
            continue;
        }
        if let Some((id, name)) = line.split_once(" - ") {
            let id = id.trim();
            let name = name.trim();
            if looks_like_model_id(id) {
                out.push(CustomCliModel {
                    id: id.to_string(),
                    name: if name.is_empty() { display_name_for_model(id) } else { name.to_string() },
                });
            }
            continue;
        }
        let id = line;
        if looks_like_model_id(id) {
            out.push(CustomCliModel {
                id: id.to_string(),
                name: display_name_for_model(id),
            });
        }
    }
    out
}

fn parse_json_model_catalog(output: &str) -> Option<Vec<CustomCliModel>> {
    let start = output.find('{')?;
    let catalog: Value = serde_json::from_str(output[start..].trim()).ok()?;
    let entries = catalog["models"].as_array()?;
    let models: Vec<CustomCliModel> = entries
        .iter()
        .filter(|m| m["visibility"].as_str().is_none_or(|v| v == "list"))
        .filter_map(|m| {
            let id = m["slug"].as_str().or_else(|| m["id"].as_str())?.trim();
            if id.is_empty() {
                return None;
            }
            let name = m["display_name"]
                .as_str()
                .map(str::trim)
                .filter(|n| !n.is_empty())
                .map(str::to_string)
                .unwrap_or_else(|| display_name_for_model(id));
            Some(CustomCliModel {
                id: id.to_string(),
                name,
            })
        })
        .collect();
    (!models.is_empty()).then_some(models)
}

/// Ask a user-added CLI which models it supports (`kilo models`, `codex debug models`, …).
#[tauri::command]
pub async fn custom_cli_list_models(command: String) -> Result<Vec<CustomCliModel>, String> {
    let command = command.trim();
    if command.is_empty() || command.contains(['\n', '\r', '\0']) {
        return Err("No command to list models for.".into());
    }
    let path = resolve_bin(command).ok_or_else(|| format!("{command} not found in PATH"))?;
    let stem = command_stem(command);
    let mut last_err = None;
    for args in list_model_arg_sets(&stem) {
        let arg_strings: Vec<String> = args.iter().map(|s| s.to_string()).collect();
        let mut cmd = build_command(&path, &arg_strings);
        augment_path_for_child(&mut cmd);
        cmd.kill_on_drop(true);
        let output = tokio::time::timeout(std::time::Duration::from_secs(20), cmd.output())
            .await
            .map_err(|_| "Listing models timed out".to_string())?
            .map_err(|e| e.to_string())?;
        let stdout = String::from_utf8_lossy(&output.stdout);
        let stderr = String::from_utf8_lossy(&output.stderr);
        let combined = if stdout.trim().is_empty() {
            stderr.to_string()
        } else {
            stdout.to_string()
        };
        let models = parse_cli_models(&combined);
        if !models.is_empty() {
            return Ok(models);
        }
        if !output.status.success() || !combined.trim().is_empty() {
            last_err = Some(combined.trim().chars().take(400).collect());
        }
    }
    Err(last_err.unwrap_or_else(|| {
        "This CLI did not list any models. Sign in to it in Terminal first, then try again.".into()
    }))
}

#[tauri::command]
pub async fn check_cli(agent: String, command: Option<String>) -> CliCheckResult {
    // Known agents, or the command the user typed for one they added: this
    // runs `<bin> --version` on the user's machine.
    let custom = command.as_deref().map(str::trim).filter(|c| !c.is_empty() && !c.contains(['\n', '\r', '\0']));
    let bin = match (agent.as_str(), custom) {
        (_, Some(command)) => command,
        ("opencode", _) => "opencode",
        ("cursor", _) => "cursor-agent",
        ("codex", _) => "codex",
        (other, _) => {
            return CliCheckResult {
                available: false,
                version: None,
                path: None,
                error: Some(format!("Unknown agent: {other}")),
            }
        }
    };
    let Some(path) = resolve_bin(bin) else {
        return CliCheckResult { available: false, version: None, path: None, error: Some(format!("{bin} not found in PATH")) };
    };
    // A CLI the user added may not know `--version`; being found is enough.
    let lenient = custom.is_some();
    let ver_args: Vec<String> = vec!["--version".to_string()];
    let mut cmd = build_command(&path, &ver_args);
    augment_path_for_child(&mut cmd);
    cmd.kill_on_drop(true);
    let output = tokio::time::timeout(std::time::Duration::from_secs(20), cmd.output())
        .await
        .unwrap_or_else(|_| Err(std::io::Error::other("`--version` timed out")));
    match output {
        Ok(out) if out.status.success() => {
            let ver = String::from_utf8_lossy(&out.stdout).trim().to_string();
            CliCheckResult { available: true, version: Some(ver), path: Some(path), error: None }
        }
        Ok(_) | Err(_) if lenient => CliCheckResult { available: true, version: None, path: Some(path), error: None },
        Ok(out) => {
            let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
            CliCheckResult { available: false, version: None, path: Some(path), error: Some(if err.is_empty() { "version check failed".into() } else { err }) }
        }
        Err(e) => CliCheckResult { available: false, version: None, path: Some(path), error: Some(e.to_string()) },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cli(command: &str, args: &[&str]) -> CustomCli {
        CustomCli { name: None, command: command.into(), args: args.iter().map(|a| a.to_string()).collect() }
    }

    #[test]
    fn instructions_go_where_each_cli_takes_them() {
        assert_eq!(instructions_channel("kilo"), Some(InstructionsChannel::ConfigEnv("KILO_CONFIG_CONTENT")));
        assert_eq!(instructions_channel("claude"), Some(InstructionsChannel::AppendFlag("--append-system-prompt")));
        assert_eq!(instructions_channel("aider"), None, "others hear them in the message");
    }

    #[test]
    fn config_keeps_what_the_user_set() {
        let fresh: Value = serde_json::from_str(&run_config(None, Some("/tmp/a.md"), None)).unwrap();
        assert_eq!(fresh["instructions"], serde_json::json!(["/tmp/a.md"]));
        let merged = run_config(
            Some(r#"{"model":"x","instructions":["mine.md"],"mcp":{"own":{"type":"local"}}}"#),
            Some("/tmp/a.md"),
            Some(("mali", serde_json::json!({"type": "remote"}))),
        );
        let merged: Value = serde_json::from_str(&merged).unwrap();
        assert_eq!(merged["model"], "x");
        assert_eq!(merged["instructions"], serde_json::json!(["mine.md", "/tmp/a.md"]));
        assert_eq!(merged["mcp"]["own"]["type"], "local");
        assert_eq!(merged["mcp"]["mali"]["type"], "remote");
    }

    #[test]
    fn kilo_tool_calls_become_steps() {
        let line = serde_json::json!({"type": "tool_use", "part": {"id": "prt_1", "type": "tool", "tool": "bash",
            "state": {"status": "completed", "input": {"command": "ls"}, "output": "a.md", "title": "List files"}}});
        let Some(ChatStreamEvent::Activity { title, done, .. }) = parse_opencode_line(&line) else { panic!("no step") };
        assert_eq!(title, "bash: List files");
        assert!(done);
    }

    #[test]
    fn only_kilo_and_opencode_sessions_continue() {
        assert_eq!(resume_flag("kilo"), Some("--session"));
        assert_eq!(resume_flag("gemini"), None);
    }

    #[test]
    fn kilo_json_profile_uses_opencode_parser() {
        let cli = cli("kilo", &["run", "{prompt}", "--format", "json"]);
        assert_eq!(custom_stream_profile(&cli), Some("opencode"));
    }

    #[test]
    fn kilo_models_keep_their_provider() {
        let out = "kilo/~anthropic/claude-sonnet-latest\nkilo/poolside/laguna-s-2.1:free\n";
        let models = parse_cli_models(out);
        assert_eq!(models.len(), 2);
        assert_eq!(models[0].id, "kilo/~anthropic/claude-sonnet-latest");
        assert_eq!(models[1].id, "kilo/poolside/laguna-s-2.1:free", "`kilo run --model` needs the `kilo/` provider");
    }

    #[test]
    fn custom_failures_say_what_to_do() {
        let kilo = CustomCli { name: Some("Kilo CLI".into()), ..cli("kilo", &[]) };
        let err = ["Error: Model not found: poolside/laguna-s-2.1:free. Did you mean: poolside/laguna-m.1?".to_string()];
        let msg = custom_failure(&kilo, &err, "");
        assert!(msg.starts_with("Kilo CLI doesn't offer this model."), "{msg}");
        assert!(msg.contains("Model not found"), "keeps the CLI's own words");
        assert!(!msg.contains("cursor-agent") && !msg.contains("opencode"), "no hints about other agents");
        let msg = custom_failure(&kilo, &["Error: Unauthorized (401)".into()], "");
        assert!(msg.contains("sign in"), "{msg}");
    }

    #[test]
    fn cursor_style_lines_parse() {
        let out = "gpt-5.3-codex - Codex 5.3\nAvailable models\n";
        let models = parse_cli_models(out);
        assert_eq!(models.len(), 1);
        assert_eq!(models[0].id, "gpt-5.3-codex");
        assert_eq!(models[0].name, "Codex 5.3");
    }

    #[test]
    fn custom_cli_puts_the_prompt_where_asked() {
        let (bin, args) = custom_command(&cli("gemini", &["-p", "{prompt}", "--yolo"]), "hi there").unwrap();
        assert_eq!(bin, "gemini");
        assert_eq!(args, ["-p", "hi there", "--yolo"]);
        let (_, args) = custom_command(&cli("claude", &["-p"]), "hi").unwrap();
        assert_eq!(args, ["-p", "hi"], "prompt goes last when no argument names it");
        assert!(custom_command(&cli("  ", &[]), "hi").is_err());
        assert!(custom_command(&cli("evil\nrm", &[]), "hi").is_err());
    }
}
