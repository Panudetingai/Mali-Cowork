use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use serde_json::Value;
use tauri::ipc::Channel;
use tokio::io::{AsyncBufReadExt, BufReader};

use crate::chat_stream::ChatStreamEvent;

use super::{
    bin::{augment_path, build_opencode_command, resolve_opencode_bin},
    cwd::get_default_public_dir,
    parser::{is_epipe_noise, parse_opencode_activity, parse_opencode_line},
    OpencodeCheckResult, OpencodeModelsResult, OpencodeRequest,
};

/// Check whether the opencode CLI is available and what version it reports.
#[tauri::command]
pub async fn opencode_check() -> OpencodeCheckResult {
    let Some(bin) = resolve_opencode_bin() else {
        return OpencodeCheckResult {
            available: false,
            version: None,
            path: None,
            error: Some(
                "opencode not found in PATH. ติดตั้งด้วย `npm i -g opencode` หรือ `bun add -g opencode`".into(),
            ),
        };
    };

    let mut cmd = build_opencode_command(&bin, &["--version".into()]);
    cmd = augment_path(cmd);

    match cmd.output().await {
        Ok(out) if out.status.success() => {
            let version = String::from_utf8_lossy(&out.stdout).trim().to_string();
            OpencodeCheckResult {
                available: true,
                version: Some(version),
                path: Some(bin),
                error: None,
            }
        }
        Ok(out) => {
            let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
            OpencodeCheckResult {
                available: false,
                version: None,
                path: Some(bin),
                error: Some(if err.is_empty() {
                    "opencode --version failed".into()
                } else {
                    err
                }),
            }
        }
        Err(e) => OpencodeCheckResult {
            available: false,
            version: None,
            path: Some(bin),
            error: Some(e.to_string()),
        },
    }
}

/// List available models from the configured providers.
#[tauri::command]
pub async fn opencode_list_models() -> Result<OpencodeModelsResult, String> {
    let Some(bin) = resolve_opencode_bin() else {
        return Err("opencode not found".into());
    };

    let mut cmd = build_opencode_command(&bin, &["models".into()]);
    cmd = augment_path(cmd);

    let out = cmd.output().await.map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }

    let stdout = String::from_utf8_lossy(&out.stdout);
    let models: Vec<String> = stdout
        .lines()
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty() && l.contains('/'))
        .collect();

    let mut providers: Vec<String> = models
        .iter()
        .filter_map(|m| m.split('/').next().map(|s| s.to_string()))
        .collect();
    providers.sort();
    providers.dedup();

    Ok(OpencodeModelsResult { models, providers })
}

/// Return the safe default working directory for opencode.
#[tauri::command]
pub fn opencode_default_cwd() -> String {
    get_default_public_dir().to_string_lossy().to_string()
}

/// Run `opencode run --format json ...` and stream the result back to the frontend.
#[tauri::command]
pub async fn opencode_generate(
    request: OpencodeRequest,
    on_event: Channel<ChatStreamEvent>,
) -> Result<(), String> {
    let prompt = request.prompt.trim().to_string();
    if prompt.is_empty() {
        let _ = on_event.send(ChatStreamEvent::Error {
            message: "Prompt cannot be empty.".into(),
        });
        return Ok(());
    }

    let Some(bin) = resolve_opencode_bin() else {
        let _ = on_event.send(ChatStreamEvent::Error {
            message: "opencode not found. ติดตั้งด้วย `npm i -g opencode` แล้ว restart แอป".into(),
        });
        return Ok(());
    };

    let cwd = request
        .cwd
        .as_ref()
        .map(|s| PathBuf::from(s))
        .unwrap_or_else(get_default_public_dir);

    if !cwd.exists() {
        let _ = std::fs::create_dir_all(&cwd);
    }

    let args = build_run_args(&request, &cwd, &prompt);
    eprintln!(
        "[opencode] bin={} cwd={} args={:?}",
        bin,
        cwd.display(),
        args
    );

    on_event
        .send(ChatStreamEvent::Started)
        .map_err(|e| e.to_string())?;

    let mut cmd = build_opencode_command(&bin, &args);
    cmd.current_dir(&cwd);
    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::piped());
    cmd = augment_path(cmd);

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to spawn opencode ({}): {e}", bin))?;
    let stdout = child.stdout.take().ok_or("Failed to capture stdout")?;
    let stderr = child.stderr.take().ok_or("Failed to capture stderr")?;

    // Drain stderr in the background so the pipe never blocks.
    let stderr_buf: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
    let stderr_clone = stderr_buf.clone();
    tokio::spawn(async move {
        let mut reader = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = reader.next_line().await {
            if line.is_empty() {
                continue;
            }
            if is_epipe_noise(&line) {
                eprintln!("[opencode:stderr] (ignored EPIPE) {}", line);
                continue;
            }
            eprintln!("[opencode:stderr] {}", line);
            stderr_clone.lock().unwrap().push(line);
        }
    });

    let mut reader = BufReader::new(stdout).lines();
    let mut has_output = false;
    let mut has_reasoning = false;
    let mut last_metadata: Option<ChatStreamEvent> = None;
    let mut text_accum = String::new();
    let mut reasoning_accum = String::new();

    while let Ok(Some(line)) = reader.next_line().await {
        if line.trim().is_empty() {
            continue;
        }

        if line.trim_start().starts_with('{') {
            if let Ok(v) = serde_json::from_str::<Value>(&line) {
                let typ = v.get("type").and_then(|x| x.as_str()).unwrap_or("");

                // Show progress/control events to the user.
                if let Some(ev) = parse_opencode_activity(&v) {
                    let _ = on_event.send(ev);
                }

                // Emit content / reasoning / metadata.
                if let Some(ev) = parse_opencode_line(&v) {
                    match &ev {
                        ChatStreamEvent::Chunk { text } => {
                            has_output = true;
                            text_accum.push_str(text);
                            let _ = on_event.send(ev);
                        }
                        ChatStreamEvent::Reasoning { reasoning } => {
                            has_reasoning = true;
                            reasoning_accum.push_str(reasoning);
                            let _ = on_event.send(ev);
                        }
                        ChatStreamEvent::Metadata { .. } => {
                            last_metadata = Some(ev.clone());
                            let _ = on_event.send(ev);
                        }
                        _ => {
                            let _ = on_event.send(ev);
                        }
                    }
                    continue;
                }

                // Skip control events that have already been handled as activities.
                let is_control = matches!(
                    typ,
                    "system" | "step_start" | "step_finish" | "tool_use" | "tool_result" | "permission" | "file"
                );
                if is_control {
                    continue;
                }

                eprintln!("[opencode] skip unknown json type={}", typ);
                continue;
            }
        }

        // Plain-text fallback.
        has_output = true;
        text_accum.push_str(&line);
        text_accum.push('\n');
        let _ = on_event.send(ChatStreamEvent::Chunk { text: line + "\n" });
    }

    let status = child.wait().await.map_err(|e| e.to_string())?;
    tokio::time::sleep(std::time::Duration::from_millis(80)).await;

    let stderr_lines = stderr_buf.lock().unwrap().clone();
    let stderr_text = stderr_lines.join("\n");
    let stderr_is_only_epipe = stderr_text.trim().is_empty();

    if !status.success() {
        // Bun sometimes exits with EPIPE after we already received all output.
        // Treat that as success if we actually got content or reasoning.
        if (has_output || has_reasoning) && stderr_is_only_epipe {
            eprintln!("[opencode] exit {} but output received (EPIPE ignored)", status);
        } else {
            let mut msg = format!("opencode exited with {status} (cwd: {})", cwd.display());
            if !stderr_text.is_empty() {
                let tail = stderr_lines
                    .iter()
                    .rev()
                    .take(20)
                    .rev()
                    .cloned()
                    .collect::<Vec<_>>()
                    .join("\n");
                msg.push_str(&format!("\n\n— stderr —\n{tail}"));
            }
            if has_reasoning || has_output {
                msg.push_str(&format!(
                    "\n\n— context —\n reasoning {} chars, output {} chars",
                    reasoning_accum.len(),
                    text_accum.len()
                ));
            }
            let _ = on_event.send(ChatStreamEvent::Error { message: msg });
            return Ok(());
        }
    }

    if let Some(ev) = last_metadata {
        let _ = on_event.send(ev);
    }

    if !has_output && !has_reasoning {
        let extra = if !stderr_text.is_empty() {
            format!(
                "\nstderr: {}",
                &stderr_text[..stderr_text.len().min(400)]
            )
        } else {
            String::new()
        };
        let _ = on_event.send(ChatStreamEvent::Error {
            message: format!(
                "opencode returned empty output (cwd: {}){extra}",
                cwd.display()
            ),
        });
        return Ok(());
    }

    let _ = on_event.send(ChatStreamEvent::Done {
        model_id: request.model.clone().unwrap_or_else(|| "opencode".to_string()),
    });
    Ok(())
}

/// Build the CLI argument vector for `opencode run` based on the official docs.
fn build_run_args(request: &OpencodeRequest, cwd: &PathBuf, prompt: &str) -> Vec<String> {
    let mut args = vec!["run".to_string(), "--format".to_string(), "json".to_string()];

    // --dir: working directory
    args.push("--dir".to_string());
    args.push(cwd.to_string_lossy().to_string());

    // -m: model
    if let Some(m) = request.model.as_ref().filter(|m| !m.trim().is_empty()) {
        args.push("-m".to_string());
        args.push(m.trim().to_string());
    }

    // --thinking
    if request.thinking.unwrap_or(false) {
        args.push("--thinking".to_string());
    }

    // --auto
    if request.auto_approve.unwrap_or(false) {
        args.push("--auto".to_string());
    }

    // --attach
    if let Some(url) = request.attach.as_ref().filter(|u| !u.trim().is_empty()) {
        args.push("--attach".to_string());
        args.push(url.trim().to_string());
    }

    // The message is passed as trailing args, per `opencode run [message..]`.
    args.push(prompt.to_string());

    args
}
