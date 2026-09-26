//! The agent's hands: files and commands in the chat's folders. Reading is
//! free; changing a file or running a command asks the user first (unless
//! they turned on auto-approve, or said "Always" earlier in this chat).

use std::collections::BTreeSet;
use std::path::Path;
use std::process::Stdio;
use std::time::Duration;

use serde_json::{json, Value};
use tauri::ipc::Channel;
use tokio::io::AsyncReadExt;
use tokio::sync::watch;
use walkdir::WalkDir;

use super::paths::{glob_regex, Scope};
use super::permissions::{self, Ask, Reply};
use super::wire::{ToolCall, ToolSpec};
use crate::chat_stream::{ChatStreamEvent, TodoItem};
use crate::commands::{code, supervisor};

const MAX_READ_LINES: usize = 2000;
const MAX_LINE_CHARS: usize = 2000;
const MAX_FILE_BYTES: u64 = 5 * 1024 * 1024;
const MAX_LIST: usize = 400;
const MAX_MATCHES: usize = 200;
/// Tool output the model gets back, in characters.
const MAX_OUTPUT: usize = 30_000;
/// What a step in the app shows of it.
const MAX_DETAIL: usize = 4_000;
const DEFAULT_TIMEOUT_SECS: u64 = 120;
const MAX_TIMEOUT_SECS: u64 = 600;
/// Folders nobody means when they search a project.
const SKIP_DIRS: &[&str] = &[".git", "node_modules", "target", ".venv", "__pycache__", ".next", ".turbo"];

pub fn specs() -> Vec<ToolSpec> {
    let mut specs = vec![
        ToolSpec {
            name: "read_file".into(),
            description: "Read a text file. Returns numbered lines. Use offset/limit for long files.".into(),
            schema: json!({
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "File path, relative to the working folder or absolute." },
                    "offset": { "type": "integer", "description": "First line to read (1-based). Optional." },
                    "limit": { "type": "integer", "description": "How many lines to read (max 2000). Optional." }
                },
                "required": ["path"]
            }),
        },
        ToolSpec {
            name: "list_dir".into(),
            description: "List a folder's entries; folders end with '/'.".into(),
            schema: json!({
                "type": "object",
                "properties": { "path": { "type": "string", "description": "Folder path; defaults to the working folder." } }
            }),
        },
        ToolSpec {
            name: "glob".into(),
            description: "Find files by name pattern, e.g. '**/*.ts' or 'src/**/index.{js,ts}'.".into(),
            schema: json!({
                "type": "object",
                "properties": {
                    "pattern": { "type": "string" },
                    "path": { "type": "string", "description": "Folder to search; defaults to the working folder." }
                },
                "required": ["pattern"]
            }),
        },
        ToolSpec {
            name: "grep".into(),
            description: "Search file contents with a regular expression. Returns 'file:line: text' matches.".into(),
            schema: json!({
                "type": "object",
                "properties": {
                    "pattern": { "type": "string", "description": "Regular expression (Rust regex syntax)." },
                    "path": { "type": "string", "description": "Folder or file to search; defaults to the working folder." },
                    "include": { "type": "string", "description": "Only files matching this glob, e.g. '*.py'." },
                    "ignore_case": { "type": "boolean" }
                },
                "required": ["pattern"]
            }),
        },
        ToolSpec {
            name: "write_file".into(),
            description: "Create a file or replace its whole content. Prefer edit_file for changes to an existing file.".into(),
            schema: json!({
                "type": "object",
                "properties": {
                    "path": { "type": "string" },
                    "content": { "type": "string" }
                },
                "required": ["path", "content"]
            }),
        },
        ToolSpec {
            name: "edit_file".into(),
            description: "Replace exact text in a file. old_string must match exactly once (include surrounding lines to make it unique), unless replace_all is true. Read the file first.".into(),
            schema: json!({
                "type": "object",
                "properties": {
                    "path": { "type": "string" },
                    "old_string": { "type": "string" },
                    "new_string": { "type": "string" },
                    "replace_all": { "type": "boolean" }
                },
                "required": ["path", "old_string", "new_string"]
            }),
        },
        ToolSpec {
            name: "bash".into(),
            description: "Run a shell command in the working folder and get its output and exit code. Not interactive: pass flags so it never waits for input.".into(),
            schema: json!({
                "type": "object",
                "properties": {
                    "command": { "type": "string" },
                    "description": { "type": "string", "description": "A few words on what it does, shown to the user." },
                    "timeout_seconds": { "type": "integer", "description": "Default 120, max 600." }
                },
                "required": ["command"]
            }),
        },
        ToolSpec {
            name: "todo_write".into(),
            description: "Keep the user's task plan up to date for multi-step work. Send the whole list each time.".into(),
            schema: json!({
                "type": "object",
                "properties": {
                    "todos": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "content": { "type": "string" },
                                "status": { "type": "string", "enum": ["pending", "in_progress", "completed"] }
                            },
                            "required": ["content", "status"]
                        }
                    }
                },
                "required": ["todos"]
            }),
        },
    ];
    // Documents: the same tools the `mali` gateway gives CLI agents.
    specs.extend(crate::templates::tools::specs());
    specs
}

pub struct ToolCtx<'a> {
    pub scope: &'a Scope,
    pub on_event: &'a Channel<ChatStreamEvent>,
    pub auto_approve: bool,
    pub always: &'a mut BTreeSet<String>,
    pub cancel: &'a mut watch::Receiver<bool>,
}

pub struct Outcome {
    /// What the model gets back.
    pub content: String,
    pub is_error: bool,
    /// What the step in the app shows under its title.
    pub detail: Option<String>,
    /// Pictures for the model to look at (only kept for models that can see).
    pub images: Vec<super::wire::ToolImage>,
}

impl Outcome {
    pub fn ok(content: String) -> Self {
        Self { detail: Some(clip(&content, MAX_DETAIL)), content, is_error: false, images: Vec::new() }
    }
    pub fn err(message: impl Into<String>) -> Self {
        let content = message.into();
        Self { detail: Some(content.clone()), content, is_error: true, images: Vec::new() }
    }
}

fn str_arg<'a>(args: &'a Value, key: &str) -> Option<&'a str> {
    args.get(key).and_then(Value::as_str)
}

/// "Action: target", as the app's step list and permission card read it.
pub fn title_for(call: &ToolCall, scope: &Scope) -> String {
    let a = &call.args;
    let path = |key| {
        str_arg(a, key)
            .map(|p| scope.resolve(p, false).map(|p| scope.show(&p)).unwrap_or_else(|_| p.to_string()))
            .unwrap_or_else(|| ".".into())
    };
    match call.name.as_str() {
        "read_file" => format!("Read: {}", path("path")),
        "list_dir" => format!("List: {}", path("path")),
        "glob" => format!("Find: {}", str_arg(a, "pattern").unwrap_or("")),
        "grep" => format!("Search: {}", str_arg(a, "pattern").unwrap_or("")),
        "write_file" => format!("Write: {}", path("path")),
        "edit_file" => format!("Edit: {}", path("path")),
        "bash" => format!("Run: {}", str_arg(a, "description").unwrap_or(str_arg(a, "command").unwrap_or(""))),
        "todo_write" => "Update plan".into(),
        "list_templates" => "Read: document templates".into(),
        "read_document" => format!("Read: {}", path("path")),
        "fill_template" => format!("Create: {}", path("output")),
        "save_template" => format!("Create: {}", path("output")),
        "make_template" => match str_arg(a, "name").filter(|_| a["save_to_library"].as_bool() == Some(true)) {
            Some(name) => format!("Create: template {name}"),
            None => format!("Create: {}", path("output")),
        },
        other => format!("Tool: {other}"),
    }
}

/// What "Always" covers: every edit in this chat, or commands that start with the same program.
fn approval_key(permission: &str, pattern: &str) -> String {
    match permission {
        "bash" => format!("bash:{}", pattern.split_whitespace().next().unwrap_or_default()),
        other => other.to_string(),
    }
}

async fn approve(ctx: &mut ToolCtx<'_>, permission: &str, pattern: String, title: String, detail: Option<String>) -> bool {
    if ctx.auto_approve {
        return true;
    }
    let key = approval_key(permission, &pattern);
    if ctx.always.contains(&key) {
        return true;
    }
    let directory = ctx.scope.cwd.to_string_lossy().to_string();
    let reply = permissions::ask(
        ctx.on_event,
        Ask { directory: &directory, permission, pattern, title, detail },
        ctx.cancel,
    )
    .await;
    match reply {
        Reply::Always => {
            ctx.always.insert(key);
            true
        }
        Reply::Once => true,
        Reply::Reject => false,
    }
}

const DENIED: &str = "The user denied this. Don't try it another way; say what you wanted to do and ask how to proceed.";

pub async fn run(call: &ToolCall, ctx: &mut ToolCtx<'_>) -> Outcome {
    if let Value::String(raw) = &call.args {
        return Outcome::err(format!("The arguments weren't valid JSON: {}", clip(raw, 300)));
    }
    let result = match call.name.as_str() {
        "read_file" => read_file(&call.args, ctx.scope),
        "list_dir" => list_dir(&call.args, ctx.scope),
        "glob" => glob(&call.args, ctx.scope),
        "grep" => grep(&call.args, ctx.scope),
        "write_file" => return write_file(&call.args, ctx).await,
        "edit_file" => return edit_file(&call.args, ctx).await,
        "bash" => return bash(&call.args, ctx).await,
        "todo_write" => todo_write(&call.args, ctx.on_event),
        name if crate::templates::tools::is_template_tool(name) => return template_tool(call, ctx).await,
        other => Err(format!("There is no tool named {other}.")),
    };
    match result {
        Ok(text) => Outcome::ok(text),
        Err(e) => Outcome::err(e),
    }
}

pub fn clip(text: &str, max: usize) -> String {
    if text.chars().count() <= max {
        return text.to_string();
    }
    let head: String = text.chars().take(max / 3).collect();
    let tail: String = text.chars().rev().take(max - max / 3).collect::<Vec<_>>().into_iter().rev().collect();
    format!("{head}\n… ({} characters left out) …\n{tail}", text.chars().count() - max)
}

fn read_text(path: &Path) -> Result<String, String> {
    let meta = std::fs::metadata(path).map_err(|e| format!("Can't read {}: {e}", path.display()))?;
    if meta.is_dir() {
        return Err(format!("{} is a folder; use list_dir.", path.display()));
    }
    if meta.len() > MAX_FILE_BYTES {
        return Err(format!("{} is larger than 5 MB; search it with grep instead.", path.display()));
    }
    let bytes = std::fs::read(path).map_err(|e| format!("Can't read {}: {e}", path.display()))?;
    if bytes.iter().take(8000).any(|&b| b == 0) {
        return Err(format!("{} is a binary file ({} bytes).", path.display(), bytes.len()));
    }
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

fn read_file(args: &Value, scope: &Scope) -> Result<String, String> {
    let path = scope.resolve(str_arg(args, "path").unwrap_or_default(), false)?;
    let text = read_text(&path)?;
    let total = text.lines().count();
    let offset = args["offset"].as_u64().unwrap_or(1).max(1) as usize;
    let limit = (args["limit"].as_u64().unwrap_or(MAX_READ_LINES as u64) as usize).clamp(1, MAX_READ_LINES);
    let mut out = String::new();
    for (i, line) in text.lines().enumerate().skip(offset - 1).take(limit) {
        let line: String = line.chars().take(MAX_LINE_CHARS).collect();
        out.push_str(&format!("{:>6}\t{line}\n", i + 1));
    }
    if total == 0 {
        return Ok("(empty file)".into());
    }
    let end = (offset - 1 + limit).min(total);
    if end < total || offset > 1 {
        out.push_str(&format!("\n(lines {offset}–{end} of {total}; use offset to read more)"));
    }
    Ok(out)
}

fn list_dir(args: &Value, scope: &Scope) -> Result<String, String> {
    let path = scope.resolve(str_arg(args, "path").unwrap_or("."), false)?;
    let mut entries: Vec<String> = std::fs::read_dir(&path)
        .map_err(|e| format!("Can't list {}: {e}", path.display()))?
        .flatten()
        .map(|e| {
            let name = e.file_name().to_string_lossy().to_string();
            if e.file_type().map(|t| t.is_dir()).unwrap_or(false) { format!("{name}/") } else { name }
        })
        .collect();
    entries.sort();
    let total = entries.len();
    entries.truncate(MAX_LIST);
    let mut out = entries.join("\n");
    if total > MAX_LIST {
        out.push_str(&format!("\n… and {} more", total - MAX_LIST));
    }
    Ok(if out.is_empty() { "(empty folder)".into() } else { out })
}

fn walk(root: &Path) -> impl Iterator<Item = walkdir::DirEntry> {
    WalkDir::new(root)
        .follow_links(false)
        .into_iter()
        .filter_entry(|e| !(e.file_type().is_dir() && SKIP_DIRS.contains(&e.file_name().to_string_lossy().as_ref())))
        .flatten()
        .filter(|e| e.file_type().is_file())
}

fn rel(root: &Path, path: &Path) -> String {
    path.strip_prefix(root).unwrap_or(path).to_string_lossy().replace('\\', "/")
}

fn glob(args: &Value, scope: &Scope) -> Result<String, String> {
    let root = scope.resolve(str_arg(args, "path").unwrap_or("."), false)?;
    let re = glob_regex(str_arg(args, "pattern").unwrap_or("*"))?;
    let mut found = Vec::new();
    for entry in walk(&root) {
        let rel = rel(&root, entry.path());
        if re.is_match(&rel) {
            found.push(scope.show(entry.path()));
            if found.len() >= MAX_MATCHES {
                found.push(format!("(stopped at {MAX_MATCHES} files; narrow the pattern)"));
                break;
            }
        }
    }
    Ok(if found.is_empty() { "No files match.".into() } else { found.join("\n") })
}

fn grep(args: &Value, scope: &Scope) -> Result<String, String> {
    let root = scope.resolve(str_arg(args, "path").unwrap_or("."), false)?;
    let re = regex::RegexBuilder::new(str_arg(args, "pattern").unwrap_or_default())
        .case_insensitive(args["ignore_case"].as_bool().unwrap_or(false))
        .build()
        .map_err(|e| format!("Bad regular expression: {e}"))?;
    let include = str_arg(args, "include").map(glob_regex).transpose()?;
    let files: Vec<std::path::PathBuf> = if root.is_file() {
        vec![root.clone()]
    } else {
        walk(&root)
            .filter(|e| include.as_ref().map(|inc| inc.is_match(&rel(&root, e.path()))).unwrap_or(true))
            .filter(|e| e.metadata().map(|m| m.len() <= 2 * 1024 * 1024).unwrap_or(false))
            .map(|e| e.into_path())
            .collect()
    };
    let mut out = Vec::new();
    'files: for file in files {
        let Ok(bytes) = std::fs::read(&file) else { continue };
        if bytes.iter().take(8000).any(|&b| b == 0) {
            continue;
        }
        let text = String::from_utf8_lossy(&bytes);
        for (i, line) in text.lines().enumerate() {
            if re.is_match(line) {
                let line: String = line.trim().chars().take(300).collect();
                out.push(format!("{}:{}: {line}", scope.show(&file), i + 1));
                if out.len() >= MAX_MATCHES {
                    out.push(format!("(stopped at {MAX_MATCHES} matches; narrow the search)"));
                    break 'files;
                }
            }
        }
    }
    Ok(if out.is_empty() { "No matches.".into() } else { out.join("\n") })
}

fn diff(old: &str, new: &str, name: &str) -> String {
    let text = similar::TextDiff::from_lines(old, new)
        .unified_diff()
        .context_radius(3)
        .header(name, name)
        .to_string();
    clip(&text, MAX_DETAIL)
}

async fn write_file(args: &Value, ctx: &mut ToolCtx<'_>) -> Outcome {
    let path = match ctx.scope.resolve(str_arg(args, "path").unwrap_or_default(), true) {
        Ok(p) => p,
        Err(e) => return Outcome::err(e),
    };
    let Some(content) = str_arg(args, "content") else { return Outcome::err("No content given.") };
    if path.is_dir() {
        return Outcome::err(format!("{} is a folder.", path.display()));
    }
    let shown = ctx.scope.show(&path);
    let old = std::fs::read_to_string(&path).ok();
    let preview = diff(old.as_deref().unwrap_or(""), content, &shown);
    let verb = if old.is_some() { "Overwrite" } else { "Create" };
    if !approve(ctx, "edit", path.to_string_lossy().into(), format!("{verb}: {shown}"), Some(preview.clone())).await {
        return Outcome::err(DENIED);
    }
    if let Some(parent) = path.parent() {
        if let Err(e) = std::fs::create_dir_all(parent) {
            return Outcome::err(format!("Can't create {}: {e}", parent.display()));
        }
    }
    match std::fs::write(&path, content) {
        Ok(()) => Outcome {
            content: format!("{} {shown} ({} lines).", if old.is_some() { "Replaced" } else { "Created" }, content.lines().count()),
            is_error: false,
            detail: Some(preview),
            images: Vec::new(),
        },
        Err(e) => Outcome::err(format!("Can't write {shown}: {e}")),
    }
}

async fn edit_file(args: &Value, ctx: &mut ToolCtx<'_>) -> Outcome {
    let path = match ctx.scope.resolve(str_arg(args, "path").unwrap_or_default(), true) {
        Ok(p) => p,
        Err(e) => return Outcome::err(e),
    };
    let (Some(old_string), Some(new_string)) = (str_arg(args, "old_string"), str_arg(args, "new_string")) else {
        return Outcome::err("old_string and new_string are both needed.");
    };
    if old_string.is_empty() {
        return Outcome::err("old_string is empty; use write_file to create a file.");
    }
    if old_string == new_string {
        return Outcome::err("old_string and new_string are the same; nothing to change.");
    }
    let shown = ctx.scope.show(&path);
    let text = match read_text(&path) {
        Ok(t) => t,
        Err(e) => return Outcome::err(e),
    };
    let count = text.matches(old_string).count();
    let replace_all = args["replace_all"].as_bool().unwrap_or(false);
    if count == 0 {
        return Outcome::err(format!("old_string wasn't found in {shown}. Read the file again and copy the text exactly, whitespace included."));
    }
    if count > 1 && !replace_all {
        return Outcome::err(format!("old_string appears {count} times in {shown}. Include more surrounding lines so it's unique, or set replace_all."));
    }
    let updated = if replace_all { text.replace(old_string, new_string) } else { text.replacen(old_string, new_string, 1) };
    let preview = diff(&text, &updated, &shown);
    if !approve(ctx, "edit", path.to_string_lossy().into(), format!("Edit: {shown}"), Some(preview.clone())).await {
        return Outcome::err(DENIED);
    }
    match std::fs::write(&path, &updated) {
        Ok(()) => Outcome {
            content: format!("Edited {shown} ({count} replacement{}).", if count == 1 { "" } else { "s" }),
            is_error: false,
            detail: Some(preview),
            images: Vec::new(),
        },
        Err(e) => Outcome::err(format!("Can't write {shown}: {e}")),
    }
}

async fn bash(args: &Value, ctx: &mut ToolCtx<'_>) -> Outcome {
    let Some(command) = str_arg(args, "command").map(str::trim).filter(|c| !c.is_empty()) else {
        return Outcome::err("No command given.");
    };
    if let Some(reason) = crate::sandbox::permission_rejection_reason("bash", None, Some(command)) {
        return Outcome::err(reason);
    }
    let title = format!("Run command: {}", str_arg(args, "description").unwrap_or(command));
    if !approve(ctx, "bash", command.to_string(), title, Some(format!("$ {command}"))).await {
        return Outcome::err(DENIED);
    }
    let timeout = args["timeout_seconds"].as_u64().unwrap_or(DEFAULT_TIMEOUT_SECS).clamp(1, MAX_TIMEOUT_SECS);

    let mut inner = code::shell_command(command);
    inner.current_dir(&ctx.scope.cwd).env("CI", "1").env("NO_COLOR", "1").env("TERM", "dumb");
    if let Some(path) = code::run_path() {
        inner.env("PATH", path);
    }
    let mut cmd = supervisor::command(inner);
    cmd.current_dir(&ctx.scope.cwd).stdout(Stdio::piped()).stderr(Stdio::piped()).kill_on_drop(true);
    let (mut child, mut tree) = match supervisor::spawn(&mut cmd, "agent-bash") {
        Ok(spawned) => spawned,
        Err(e) => return Outcome::err(format!("Couldn't start the command: {e}")),
    };
    let read = |stream: Option<Box<dyn tokio::io::AsyncRead + Unpin + Send>>| async move {
        let mut buf = Vec::new();
        if let Some(mut s) = stream {
            let _ = s.read_to_end(&mut buf).await;
        }
        buf
    };
    let out_task = tokio::spawn(read(child.stdout.take().map(|s| Box::new(s) as _)));
    let err_task = tokio::spawn(read(child.stderr.take().map(|s| Box::new(s) as _)));

    let ended = tokio::select! {
        status = child.wait() => Ok(status),
        _ = tokio::time::sleep(Duration::from_secs(timeout)) => Err(format!("timed out after {timeout}s")),
        _ = ctx.cancel.wait_for(|stopped| *stopped) => Err("stopped by the user".to_string()),
    };
    if ended.is_err() {
        tree.stop();
    }
    let stdout = out_task.await.unwrap_or_default();
    let stderr = err_task.await.unwrap_or_default();
    drop(tree);

    let mut text = String::from_utf8_lossy(&stdout).trim_end().to_string();
    let err_text = String::from_utf8_lossy(&stderr);
    if !err_text.trim().is_empty() {
        if !text.is_empty() {
            text.push('\n');
        }
        text.push_str(err_text.trim_end());
    }
    let (footer, failed) = match ended {
        Ok(Ok(status)) => match status.code() {
            Some(0) => (String::new(), false),
            Some(code) => (format!("\n(exit code {code})"), true),
            None => ("\n(ended by a signal)".to_string(), true),
        },
        Ok(Err(e)) => (format!("\n(couldn't wait for the command: {e})"), true),
        Err(why) => (format!("\n(the command was stopped: {why})"), true),
    };
    let body = if text.is_empty() { "(no output)".to_string() } else { clip(&text, MAX_OUTPUT) };
    let content = format!("{body}{footer}");
    Outcome {
        detail: Some(clip(&format!("$ {command}\n{content}"), MAX_DETAIL)),
        content,
        is_error: failed,
        images: Vec::new(),
    }
}

/// A document tool: planned by `templates::tools`, written once the user allows it.
async fn template_tool(call: &ToolCall, ctx: &mut ToolCtx<'_>) -> Outcome {
    use crate::templates::tools::{execute, plan, Plan};
    let planned = match plan(&call.name, &call.args, ctx.scope) {
        Ok(p) => p,
        Err(e) => return Outcome::err(e),
    };
    let (key, title, preview) = match &planned {
        Plan::Text(_) => (None, String::new(), String::new()),
        Plan::Write { path, title, preview, .. } => (Some(path.to_string_lossy().to_string()), title.clone(), preview.clone()),
        Plan::Library { name, title, preview, .. } => (Some(format!("template:{name}")), title.clone(), preview.clone()),
    };
    if let Some(key) = key {
        if !approve(ctx, "edit", key, title, Some(preview.clone())).await {
            return Outcome::err(DENIED);
        }
    }
    match execute(planned) {
        Ok(text) if preview.is_empty() => Outcome::ok(text),
        Ok(text) => Outcome { content: text, is_error: false, detail: Some(clip(&preview, MAX_DETAIL)), images: Vec::new() },
        Err(e) => Outcome::err(e),
    }
}

fn todo_write(args: &Value, on_event: &Channel<ChatStreamEvent>) -> Result<String, String> {
    let todos = args["todos"].as_array().ok_or("todos must be a list.")?;
    let items: Vec<TodoItem> = todos
        .iter()
        .take(50)
        .filter_map(|t| {
            let text = t["content"].as_str().or_else(|| t["text"].as_str())?.to_string();
            let status = t["status"].as_str().unwrap_or("pending").to_string();
            Some(TodoItem { id: None, done: Some(status == "completed"), status: Some(status), text })
        })
        .collect();
    let summary = format!(
        "Plan updated: {} of {} done.",
        items.iter().filter(|i| i.done == Some(true)).count(),
        items.len()
    );
    let _ = on_event.send(ChatStreamEvent::Todos { items });
    Ok(summary)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn always_covers_same_program_only() {
        assert_eq!(approval_key("bash", "npm test --watch=false"), "bash:npm");
        assert_eq!(approval_key("edit", "/a/b"), "edit");
    }

    #[test]
    fn clip_keeps_both_ends() {
        let text = "a".repeat(50) + &"z".repeat(50);
        let out = clip(&text, 30);
        assert!(out.starts_with("aaaaaaaaaa"));
        assert!(out.ends_with("zzzz"));
        assert!(out.contains("left out"));
    }

    #[tokio::test]
    async fn fills_a_quotation_into_the_folder() {
        let dir = std::env::temp_dir().join(format!("mali-tpl-{}", uuid::Uuid::new_v4().simple()));
        std::fs::create_dir_all(&dir).unwrap();
        let scope = Scope::new(dir.to_str().unwrap(), &[]).unwrap();
        let channel: Channel<ChatStreamEvent> = Channel::new(|_| Ok(()));
        let (_tx, mut cancel) = watch::channel(false);
        let mut always = BTreeSet::new();
        let mut ctx = ToolCtx { scope: &scope, on_event: &channel, auto_approve: true, always: &mut always, cancel: &mut cancel };
        let call = ToolCall {
            id: "t".into(),
            name: "fill_template".into(),
            args: json!({
                "template": "quotation",
                "output": "ใบเสนอราคา-QT-001",
                "values": { "company_name": "Cups Of Hope", "company_address": "กรุงเทพฯ", "doc_no": "QT-001", "customer_name": "คุณบี" },
                "items": [{ "description": "ลาเต้", "qty": 10, "unit": "แก้ว", "unit_price": 60 }]
            }),
        };
        let out = run(&call, &mut ctx).await;
        assert!(!out.is_error, "{}", out.content);
        assert!(out.content.contains("642.00"), "{}", out.content);
        let saved = dir.join("ใบเสนอราคา-QT-001.docx");
        let text = crate::templates::docx::read_text(&std::fs::read(&saved).unwrap()).unwrap();
        assert!(text.contains("หกร้อยสี่สิบสองบาทถ้วน"), "{text}");

        // The file reads back as a document, with no fields left over.
        let read = run(&ToolCall { id: "r".into(), name: "read_document".into(), args: json!({ "path": "ใบเสนอราคา-QT-001.docx" }) }, &mut ctx).await;
        assert!(read.content.contains("ลาเต้") && !read.content.contains("Template fields"), "{}", read.content);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn read_list_glob_grep_in_a_temp_folder() {
        let dir = std::env::temp_dir().join(format!("mali-tools-{}", uuid::Uuid::new_v4().simple()));
        std::fs::create_dir_all(dir.join("src/node_modules")).unwrap();
        std::fs::write(dir.join("src/a.ts"), "one\nneedle two\nthree\n").unwrap();
        std::fs::write(dir.join("src/node_modules/b.ts"), "needle\n").unwrap();
        let scope = Scope::new(dir.to_str().unwrap(), &[]).unwrap();

        let read = read_file(&json!({"path": "src/a.ts", "offset": 2, "limit": 1}), &scope).unwrap();
        assert!(read.contains("     2\tneedle two"));
        assert!(!read.contains("one"));
        assert_eq!(list_dir(&json!({}), &scope).unwrap(), "src/");
        assert_eq!(glob(&json!({"pattern": "*.ts"}), &scope).unwrap(), "src/a.ts");
        assert_eq!(grep(&json!({"pattern": "needle"}), &scope).unwrap(), "src/a.ts:2: needle two");
        let _ = std::fs::remove_dir_all(dir);
    }
}
