//! Integration tests สำหรับทดสอบ CLI แล้ว print data ที่ได้
//! รันด้วย:
//!   cargo test --test cli_openai_print -- --nocapture
//! หรือเจาะจง:
//!   cargo test --test cli_openai_print print_cursor_openai -- --nocapture
//!   cargo test --test cli_openai_print print_opencode -- --nocapture
//!   cargo test --test cli_openai_print print_codex_openai -- --nocapture
//!
//! ต้องมี binary ติดตั้งก่อน (where.exe จะหาให้เอง):
//!   cursor-agent -> C:\Users\...\cursor-agent.cmd
//!   opencode     -> %APPDATA%\npm\opencode.cmd
//!   codex        -> via npm `npm i -g @openai/codex`

use std::path::Path;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command as TokioCommand;

fn resolve_bin(bin: &str) -> Option<String> {
    let env_key = format!("{}_BIN", bin.to_uppercase().replace('-', "_"));
    if let Ok(p) = std::env::var(&env_key) {
        if !p.trim().is_empty() && Path::new(&p).exists() {
            return Some(p);
        }
    }
    #[cfg(windows)]
    {
        let mut cands = Vec::new();
        for q in [bin.to_string(), format!("{bin}.cmd"), format!("{bin}.exe")] {
            if let Ok(out) = std::process::Command::new("where.exe").arg(&q).output() {
                if out.status.success() {
                    for line in String::from_utf8_lossy(&out.stdout).lines() {
                        let p = line.trim();
                        if !p.is_empty() && Path::new(p).exists() {
                            cands.push(p.to_string());
                        }
                    }
                }
            }
        }
        if !cands.is_empty() {
            cands.sort_by_key(|p| {
                let l = p.to_lowercase();
                if l.ends_with(".cmd") { 0 } else if l.ends_with(".exe") { 1 } else { 10 }
            });
            return Some(cands[0].clone());
        }
    }
    #[cfg(not(windows))]
    {
        if let Ok(out) = std::process::Command::new("which").arg(bin).output() {
            if out.status.success() {
                let p = String::from_utf8_lossy(&out.stdout).trim().to_string();
                if !p.is_empty() && Path::new(&p).exists() { return Some(p); }
            }
        }
    }
    None
}

fn build_cmd(bin_path: &str, args: &[String]) -> TokioCommand {
    #[cfg(windows)]
    {
        let lower = bin_path.to_lowercase();
        if lower.ends_with(".cmd") || lower.ends_with(".bat") {
            let mut c = TokioCommand::new("cmd");
            c.args(["/D", "/S", "/C", bin_path]);
            c.args(args);
            return c;
        }
    }
    let mut c = TokioCommand::new(bin_path);
    c.args(args);
    c
}

async fn run_and_print(agent: &str, bin: &str, args: Vec<String>) {
    println!("\n========== [{}] via `{}` ==========", agent, bin);
    let bin_path = resolve_bin(bin).unwrap_or_else(|| bin.to_string());
    println!("resolved bin_path: {}", bin_path);
    println!("args: {:?}", args);

    if !Path::new(&bin_path).exists() && resolve_bin(bin).is_none() {
        println!("SKIP: binary `{bin}` not found in PATH (where.exe). ติดตั้งก่อนหรือตั้ง {}_BIN", bin.to_uppercase().replace('-', "_"));
        return;
    }

    let mut cmd = build_cmd(&bin_path, &args);
    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::piped());

    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            println!("FAILED to spawn: {e}");
            return;
        }
    };

    let stdout = child.stdout.take().expect("stdout");
    let stderr = child.stderr.take().expect("stderr");

    // spawn stderr drain to avoid blocking
    let stderr_handle = tokio::spawn(async move {
        let mut r = BufReader::new(stderr).lines();
        let mut acc = Vec::new();
        while let Ok(Some(line)) = r.next_line().await {
            acc.push(line);
        }
        acc
    });

    let mut reader = BufReader::new(stdout).lines();
    let mut raw_lines: Vec<String> = Vec::new();
    let mut reasoning_acc = String::new();
    let mut text_acc = String::new();
    let mut usage_json: Option<serde_json::Value> = None;

    while let Ok(Some(line)) = reader.next_line().await {
        if line.trim().is_empty() { continue; }
        println!("[raw] {}", line);
        raw_lines.push(line.clone());

        // ลอง parse เป็น json
        if line.trim_start().starts_with('{') {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&line) {
                // pretty print json ที่ parse ได้
                println!("  └─ parsed json type={:?}", v.get("type").and_then(|x| x.as_str()));
                // cursor: thinking / assistant / result
                if v.get("type").and_then(|x| x.as_str()) == Some("thinking") {
                    if let Some(t) = v.get("text").and_then(|x| x.as_str()) {
                        reasoning_acc.push_str(t);
                        println!("  └─ reasoning delta: {:?}", t);
                    }
                }
                if v.get("type").and_then(|x| x.as_str()) == Some("assistant") {
                    println!("  └─ assistant: {}", v);
                }
                if v.get("type").and_then(|x| x.as_str()) == Some("result") {
                    usage_json = Some(v.clone());
                    println!("  └─ result usage: {}", serde_json::to_string_pretty(&v).unwrap_or_default());
                }
                // opencode: text / reasoning / step_finish
                if v.get("type").and_then(|x| x.as_str()) == Some("text") {
                    if let Some(t) = v.get("part").and_then(|p| p.get("text")).and_then(|x| x.as_str()) {
                        text_acc.push_str(t);
                        println!("  └─ opencode text: {:?}", &t[..t.len().min(120)]);
                    }
                }
                if v.get("type").and_then(|x| x.as_str()) == Some("reasoning") {
                    if let Some(t) = v.get("part").and_then(|p| p.get("text")).and_then(|x| x.as_str()) {
                        reasoning_acc.push_str(t);
                        println!("  └─ opencode reasoning: {:?}", &t[..t.len().min(120)]);
                    }
                }
                if v.get("type").and_then(|x| x.as_str()) == Some("step_finish") {
                    println!("  └─ step_finish tokens: {}", v.get("part").and_then(|p| p.get("tokens")).map(|x| x.to_string()).unwrap_or_default());
                    usage_json = Some(v.clone());
                }
                // codex: item.completed
                if v.get("type").and_then(|x| x.as_str()) == Some("item.completed") {
                    println!("  └─ codex item: {}", v.get("item").and_then(|x| x.get("text")).and_then(|x| x.as_str()).unwrap_or(""));
                }
            }
        } else {
            // plain text
            text_acc.push_str(&line);
            text_acc.push('\n');
            println!("  └─ plain text ({} chars)", line.len());
        }
    }

    let status = child.wait().await.expect("wait");
    let stderr_lines = stderr_handle.await.unwrap_or_default();

    println!("\n--- SUMMARY [{}] ---", agent);
    println!("exit: {}", status);
    println!("raw lines: {}", raw_lines.len());
    println!("text_acc len: {} chars", text_acc.len());
    if !text_acc.is_empty() {
        println!("text preview (first 500 chars):\n{}", &text_acc[..text_acc.len().min(500)]);
    }
    println!("reasoning_acc len: {} chars", reasoning_acc.len());
    if !reasoning_acc.is_empty() {
        println!("reasoning preview (first 500 chars):\n{}", &reasoning_acc[..reasoning_acc.len().min(500)]);
    }
    if let Some(u) = usage_json {
        println!("usage/result json:\n{}", serde_json::to_string_pretty(&u).unwrap_or_default());
    }
    if !stderr_lines.is_empty() {
        println!("stderr ({} lines):", stderr_lines.len());
        for l in stderr_lines.iter().take(20) { println!("  [stderr] {}", l); }
    }
    println!("========== END [{}] ==========\n", agent);
}

// ── Tests ──

/// ทดสอบ cursor-agent (OpenAI-compatible, รุ่นที่ login ไว้คือ Kimi K2.7 Code แต่เปลี่ยน model ได้)
/// จะ print reasoning (thinking delta) + assistant text + usage แม้ exit 1 ก็เห็น
#[tokio::test]
async fn print_cursor_openai() {
    // ใช้ stream-json เพื่อได้ reasoning/usage
    let prompt = "say hi in 5 words, also think step by step briefly";
    let args = vec![
        "--print".to_string(),
        "--output-format".to_string(),
        "stream-json".to_string(),
        "--stream-partial-output".to_string(),
        "--trust".to_string(),
        prompt.to_string(),
    ];
    run_and_print("cursor (openai-compatible)", "cursor-agent", args).await;
}

/// ทดสอบ opencode (format json) — จะได้ text / reasoning / step_finish{tokens,cost}
#[tokio::test]
async fn print_opencode() {
    let prompt = "say hi in 5 words";
    let args = vec!["run".to_string(), "--format".to_string(), "--thinking".to_string(), "json".to_string(), prompt.to_string()];
    run_and_print("opencode", "opencode", args).await;
}

/// ทดสอบ codex (OpenAI Codex CLI) — OpenAI โดยตรง
#[tokio::test]
async fn print_codex_openai() {
    // codex exec --json "prompt" จะได้ item.completed + usage ผ่าน json
    let prompt = "say hi in 5 words";
    let args = vec!["exec".to_string(), "--json".to_string(), "--thinking".to_string(), prompt.to_string()];
    run_and_print("codex (openai)", "codex", args).await;
}

/// ทดสอบแบบ error เพื่อดูว่าแม้ exit 1 ก็ยังได้ reasoning/usage
#[tokio::test]
async fn print_cursor_error_context() {
    // prompt ที่ทำให้ agent พยายามรันคำสั่งแล้ว fail (เช่น ให้รัน `exit 1`)
    let prompt = "Run `exit 1` in shell and tell me the result";
    let args = vec![
        "--print".to_string(),
        "--output-format".to_string(),
        "stream-json".to_string(),
        "--trust".to_string(),
        prompt.to_string(),
    ];
    run_and_print("cursor-error-context", "cursor-agent", args).await;
}
