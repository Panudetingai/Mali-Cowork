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
}

fn agent_command(agent: &str, prompt: &str) -> Result<(String, Vec<String>), String> {
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
    #[cfg(not(windows))]
    {
        if let Ok(out) = crate::commands::process::std_command("which").arg(bin).output() {
            if out.status.success() {
                let p = String::from_utf8_lossy(&out.stdout).trim().to_string();
                if !p.is_empty() && std::path::Path::new(&p).exists() {
                    return Some(p);
                }
            }
        }
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

fn augment_path_for_child(cmd: &mut Command) {
    if let Ok(cur) = std::env::var("PATH") {
        #[cfg(windows)]
        {
            let home = std::env::var("USERPROFILE").unwrap_or_default();
            let appdata = std::env::var("APPDATA").unwrap_or_default();
            let extras = vec![
                format!(r"{appdata}\npm"),
                format!(r"{home}\.bun\bin"),
                format!(r"{home}\AppData\Local\cursor-agent"),
                format!(r"C:\Program Files\nodejs"),
            ];
            let mut new_path = cur.clone();
            for e in extras { if !cur.contains(&e) && std::path::Path::new(&e).exists() { new_path.push(';'); new_path.push_str(&e); } }
            cmd.env("PATH", new_path);
        }
        #[cfg(not(windows))]
        {
            let home = std::env::var("HOME").unwrap_or_default();
            let extras = vec![format!("{home}/.bun/bin"), format!("{home}/.local/bin")];
            let mut new_path = cur.clone();
            for e in extras { if !cur.contains(&e) && std::path::Path::new(&e).exists() { new_path.push(':'); new_path.push_str(&e); } }
            cmd.env("PATH", new_path);
        }
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
            };
            let session_id = v.get("sessionID").and_then(|x| x.as_str()).map(|s| s.to_string());
            return Some(ChatStreamEvent::Metadata { session_id, usage: Some(usage), duration_ms: None, model: None });
        }
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

    let (bin, args) = agent_command(&request.agent, &prompt)?;
    let bin_path = resolve_bin(&bin).unwrap_or_else(|| bin.clone());

    on_event.send(ChatStreamEvent::Started)
        .map_err(|e| e.to_string())?;

    // Supervised, so the agent and the MCP servers it starts stop together,
    // also when this function returns early or the app quits.
    let mut cmd = super::supervisor::command(build_command(&bin_path, &args));
    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::piped());
    augment_path_for_child(&mut cmd);
    if let Some(cwd) = request.cwd { cmd.current_dir(cwd); }

    eprintln!("[cli] spawning: {bin_path} {:?}", args);

    let (mut child, _tree) = super::supervisor::spawn(&mut cmd, "cli agent").map_err(|e| {
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

    while let Ok(Some(line)) = stdout_reader.next_line().await {
        if line.trim().is_empty() { continue; }

        // ลอง parse เป็น JSON ก่อน — สำคัญ: อย่าส่ง raw JSON ของ control messages ให้ user
        if line.trim_start().starts_with('{') {
            if let Ok(v) = serde_json::from_str::<Value>(&line) {
                let typ = v.get("type").and_then(|x| x.as_str()).unwrap_or("");
                let is_control = match request.agent.as_str() {
                    "cursor" => matches!(typ, "system" | "user" | "thinking" | "assistant" | "result" | "tool_call" | "tool_result"),
                    "opencode" => matches!(typ, "system" | "step_start" | "step_finish" | "text" | "reasoning" | "tool_use" | "tool_result" | "file" | "permission"),
                    "codex" => matches!(typ, "item.completed" | "item.started" | "thread.started"),
                    _ => false,
                };

                let event = match request.agent.as_str() {
                    "cursor" => parse_cursor_line(&v),
                    "opencode" => parse_opencode_line(&v),
                    "codex" => parse_codex_line(&v),
                    _ => None,
                };
                if let Some(ev) = event {
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
        let text = if request.agent == "codex" {
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

fn _unused_parse_codex_json_line(line: &str) -> Option<String> {
    let v: serde_json::Value = serde_json::from_str(line).ok()?;
    v.get("item")?.get("text")?.as_str().map(|s| s.to_string() + "\n")
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliCheckResult {
    pub available: bool,
    pub version: Option<String>,
    pub path: Option<String>,
    pub error: Option<String>,
}

#[tauri::command]
pub async fn check_cli(agent: String) -> CliCheckResult {
    // Only known agents: this runs `<bin> --version` on the user's machine.
    let bin = match agent.as_str() {
        "opencode" => "opencode",
        "cursor" => "cursor-agent",
        "codex" => "codex",
        other => {
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
        Ok(out) => {
            let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
            CliCheckResult { available: false, version: None, path: Some(path), error: Some(if err.is_empty() { "version check failed".into() } else { err }) }
        }
        Err(e) => CliCheckResult { available: false, version: None, path: Some(path), error: Some(e.to_string()) },
    }
}
