//! Code mode: the editor's view of a project folder.
//!
//! - [`code_scan`] lists the tree with sizes and modification times; the app
//!   polls it, so edits made by the agent (or any other program) show up
//!   within a second without a file-watcher dependency.
//! - [`code_read`] / [`code_write`] open and save one file, always inside the
//!   project root (resolved through `..` and symlinks) and never a secret.
//! - [`code_detect`] suggests build / check / test commands for the project.
//! - [`code_run`] runs one of them and streams its output; [`code_kill`]
//!   stops it.

use std::collections::HashMap;
use std::path::{Component, Path, PathBuf};
use std::process::Stdio;
use std::sync::{Mutex, OnceLock};
use std::time::{Instant, UNIX_EPOCH};

use serde::Serialize;
use tauri::ipc::Channel;
use tokio::io::{AsyncBufReadExt, BufReader};

use super::supervisor;

/// Folders that are build output or dependencies: never listed.
const SKIP_DIRS: &[&str] = &[
    "node_modules",
    ".git",
    "target",
    "dist",
    "build",
    ".next",
    ".nuxt",
    ".svelte-kit",
    ".turbo",
    ".cache",
    "out",
    "coverage",
    ".venv",
    "venv",
    "__pycache__",
    ".idea",
    ".gradle",
    "Pods",
    "DerivedData",
];
const MAX_ENTRIES: usize = 8000;
const MAX_DEPTH: usize = 14;
/// Larger files open read-only as "too large".
const MAX_READ: u64 = 2 * 1024 * 1024;
/// Output kept from one line of a running command.
const MAX_LINE: usize = 4000;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeEntry {
    /// Path inside the root, with `/` separators.
    rel: String,
    dir: bool,
    size: u64,
    /// Milliseconds since the epoch.
    mtime: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanResult {
    entries: Vec<CodeEntry>,
    truncated: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeFile {
    text: Option<String>,
    binary: bool,
    too_large: bool,
    size: u64,
    mtime: u64,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CodeTask {
    id: String,
    label: String,
    command: String,
    /// `check`, `build`, `test`, `lint` or `dev`.
    kind: String,
    /// Folder to run in, relative to the root; empty for the root.
    cwd: String,
}

#[derive(Serialize, Clone)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum RunEvent {
    Line { stream: &'static str, text: String },
    Exit { code: Option<i32>, duration_ms: u64 },
}

/// Secrets the editor never opens, lists or writes, matching the app's
/// file-system deny list.
fn is_secret(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    lower == ".env"
        || lower.starts_with(".env.")
        || lower == ".npmrc"
        || lower == ".netrc"
        || lower == ".git-credentials"
        || lower.starts_with("id_rsa")
        || lower.starts_with("id_ed25519")
        || lower.ends_with(".pem")
        || lower.ends_with(".key")
        || lower.ends_with(".p12")
}

fn mtime_ms(meta: &std::fs::Metadata) -> u64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn canonical_root(root: &str) -> Result<PathBuf, String> {
    let path = Path::new(root);
    if !path.is_absolute() {
        return Err("Project folder must be an absolute path".into());
    }
    let root = path
        .canonicalize()
        .map_err(|e| format!("Can't open {root}: {e}"))?;
    if !root.is_dir() {
        return Err(format!("{} is not a folder", root.display()));
    }
    Ok(root)
}

/// `rel` inside `root`, refusing absolute paths, `..`, symlinks that lead
/// outside, and secrets. The file itself may not exist yet (new files).
fn resolve(root: &Path, rel: &str) -> Result<PathBuf, String> {
    let rel_path = Path::new(rel);
    if rel.is_empty()
        || rel_path
            .components()
            .any(|c| !matches!(c, Component::Normal(_)))
    {
        return Err(format!("Invalid path: {rel}"));
    }
    let name = rel_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or_default();
    if is_secret(name) {
        return Err(format!("{name} may hold secrets and can't be opened here"));
    }
    let joined = root.join(rel_path);
    // The deepest part that exists decides where the path really goes.
    let mut existing = joined.as_path();
    while !existing.exists() {
        existing = existing
            .parent()
            .ok_or_else(|| format!("Invalid path: {rel}"))?;
    }
    let real = existing.canonicalize().map_err(|e| e.to_string())?;
    if !real.starts_with(root) {
        return Err(format!("{rel} is outside the project folder"));
    }
    if existing == joined.as_path() {
        Ok(real)
    } else {
        Ok(real.join(joined.strip_prefix(existing).map_err(|e| e.to_string())?))
    }
}

fn scan(root: &Path) -> ScanResult {
    let mut entries = Vec::new();
    let mut truncated = false;
    let walker = walkdir::WalkDir::new(root)
        .max_depth(MAX_DEPTH)
        .follow_links(false)
        .sort_by(|a, b| {
            b.file_type()
                .is_dir()
                .cmp(&a.file_type().is_dir())
                .then_with(|| a.file_name().cmp(b.file_name()))
        })
        .into_iter()
        .filter_entry(|e| {
            if e.depth() == 0 {
                return true;
            }
            let name = e.file_name().to_string_lossy();
            if e.file_type().is_dir() {
                !SKIP_DIRS.contains(&name.as_ref())
            } else {
                !is_secret(&name) && name != ".DS_Store"
            }
        });
    for entry in walker.flatten() {
        if entry.depth() == 0 {
            continue;
        }
        if entries.len() >= MAX_ENTRIES {
            truncated = true;
            break;
        }
        let Ok(rel) = entry.path().strip_prefix(root) else {
            continue;
        };
        let meta = entry.metadata().ok();
        let dir = entry.file_type().is_dir();
        entries.push(CodeEntry {
            rel: rel.to_string_lossy().replace('\\', "/"),
            dir,
            size: if dir { 0 } else { meta.as_ref().map_or(0, |m| m.len()) },
            mtime: meta.as_ref().map_or(0, mtime_ms),
        });
    }
    ScanResult { entries, truncated }
}

#[tauri::command]
pub async fn code_scan(root: String) -> Result<ScanResult, String> {
    let root = canonical_root(&root)?;
    tokio::task::spawn_blocking(move || scan(&root))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn code_read(root: String, rel: String) -> Result<CodeFile, String> {
    let root = canonical_root(&root)?;
    let path = resolve(&root, &rel)?;
    let meta = std::fs::metadata(&path).map_err(|e| format!("Can't open {rel}: {e}"))?;
    if meta.is_dir() {
        return Err(format!("{rel} is a folder"));
    }
    let size = meta.len();
    let mtime = mtime_ms(&meta);
    if size > MAX_READ {
        return Ok(CodeFile { text: None, binary: false, too_large: true, size, mtime });
    }
    let bytes = tokio::fs::read(&path).await.map_err(|e| format!("Can't read {rel}: {e}"))?;
    let head = &bytes[..bytes.len().min(8192)];
    if head.contains(&0) {
        return Ok(CodeFile { text: None, binary: true, too_large: false, size, mtime });
    }
    match String::from_utf8(bytes) {
        Ok(text) => Ok(CodeFile { text: Some(text), binary: false, too_large: false, size, mtime }),
        Err(_) => Ok(CodeFile { text: None, binary: true, too_large: false, size, mtime }),
    }
}

/// Save `text` to `rel`. With `expected_mtime`, refuses (error starting with
/// `conflict:`) when the file changed on disk since it was opened, so the
/// user's save never silently drops an edit the agent just made.
#[tauri::command]
pub async fn code_write(
    root: String,
    rel: String,
    text: String,
    expected_mtime: Option<u64>,
) -> Result<u64, String> {
    let root = canonical_root(&root)?;
    let path = resolve(&root, &rel)?;
    if let (Some(expected), Ok(meta)) = (expected_mtime, std::fs::metadata(&path)) {
        if mtime_ms(&meta) != expected {
            return Err(format!("conflict: {rel} changed on disk"));
        }
    }
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| format!("Can't create folder for {rel}: {e}"))?;
    }
    tokio::fs::write(&path, text)
        .await
        .map_err(|e| format!("Can't save {rel}: {e}"))?;
    let meta = std::fs::metadata(&path).map_err(|e| e.to_string())?;
    Ok(mtime_ms(&meta))
}

fn task(kind: &str, label: impl Into<String>, command: impl Into<String>, cwd: &str) -> CodeTask {
    let command = command.into();
    CodeTask {
        id: format!("{cwd}::{command}"),
        label: label.into(),
        command,
        kind: kind.into(),
        cwd: cwd.into(),
    }
}

const KNOWN_SCRIPTS: [&str; 8] = ["typecheck", "type-check", "check", "build", "lint", "test", "dev", "start"];

fn script_rank(name: &str) -> usize {
    KNOWN_SCRIPTS.iter().position(|k| *k == name).unwrap_or(KNOWN_SCRIPTS.len())
}

/// Guess what a package.json script does from its name. Unknown ones count as
/// `dev` so auto-check never starts something that may not exit.
fn script_kind(name: &str) -> &'static str {
    let n = name.to_ascii_lowercase();
    let has = |words: &[&str]| words.iter().any(|w| n.contains(w));
    if has(&["dev", "start", "serve", "watch", "preview"]) {
        "dev"
    } else if has(&["typecheck", "type-check", "tsc"]) || n == "check" || n.starts_with("check:") {
        "check"
    } else if has(&["test", "e2e", "spec"]) {
        "test"
    } else if has(&["lint", "format", "fmt", "prettier"]) {
        "lint"
    } else if has(&["build", "compile", "bundle"]) {
        "build"
    } else {
        "dev"
    }
}

fn node_tasks(dir: &Path, cwd: &str, out: &mut Vec<CodeTask>) {
    let Ok(raw) = std::fs::read_to_string(dir.join("package.json")) else {
        return;
    };
    let Ok(pkg) = serde_json::from_str::<serde_json::Value>(&raw) else {
        return;
    };
    let runner = if dir.join("bun.lock").exists() || dir.join("bun.lockb").exists() {
        "bun run"
    } else if dir.join("pnpm-lock.yaml").exists() {
        "pnpm run"
    } else if dir.join("yarn.lock").exists() {
        "yarn"
    } else {
        "npm run"
    };
    let empty = serde_json::Map::new();
    let scripts = pkg["scripts"].as_object().unwrap_or(&empty);
    let mut names: Vec<&str> = scripts
        .keys()
        .map(String::as_str)
        // `prebuild` / `postbuild` run on their own with `build`.
        .filter(|name| {
            !["pre", "post"]
                .iter()
                .any(|p| name.strip_prefix(p).is_some_and(|base| scripts.contains_key(base)))
        })
        .collect();
    // The usual check / build / test scripts first, then the rest by name.
    names.sort_by_key(|name| (script_rank(name), name.to_string()));
    let mut typecheck = false;
    for name in names {
        let kind = script_kind(name);
        typecheck |= kind == "check";
        let command = format!("{runner} {name}");
        out.push(task(kind, command.clone(), command, cwd));
    }
    if !typecheck && dir.join("tsconfig.json").exists() {
        out.insert(0, task("check", "Type check (tsc)", "npx tsc --noEmit", cwd));
    }
}

#[tauri::command]
pub async fn code_detect(root: String) -> Result<Vec<CodeTask>, String> {
    let root = canonical_root(&root)?;
    let mut out = Vec::new();
    node_tasks(&root, "", &mut out);
    for (dir, cwd) in [(root.clone(), ""), (root.join("src-tauri"), "src-tauri")] {
        if dir.join("Cargo.toml").exists() {
            out.push(task("check", format!("cargo check{}", if cwd.is_empty() { "" } else { " (src-tauri)" }), "cargo check --message-format short", cwd));
            out.push(task("test", "cargo test", "cargo test", cwd));
        }
    }
    if root.join("go.mod").exists() {
        out.push(task("check", "go vet", "go vet ./...", ""));
        out.push(task("build", "go build", "go build ./...", ""));
        out.push(task("test", "go test", "go test ./...", ""));
    }
    if root.join("pyproject.toml").exists() || root.join("requirements.txt").exists() || root.join("setup.py").exists() {
        out.push(task("check", "Python syntax check", "python3 -m compileall -q .", ""));
        if root.join("tests").is_dir() || root.join("pytest.ini").exists() {
            out.push(task("test", "pytest", "python3 -m pytest -q", ""));
        }
    }
    if root.join("Makefile").exists() {
        out.push(task("build", "make", "make", ""));
    }
    Ok(out)
}

/// Running commands, by run id, so they can be stopped.
fn runs() -> &'static Mutex<HashMap<String, u32>> {
    static RUNS: OnceLock<Mutex<HashMap<String, u32>>> = OnceLock::new();
    RUNS.get_or_init(Default::default)
}

/// `PATH` for a GUI app that started with a minimal one.
fn run_path() -> Option<std::ffi::OsString> {
    let mut dirs: Vec<PathBuf> = std::env::var_os("PATH")
        .map(|p| std::env::split_paths(&p).collect())
        .unwrap_or_default();
    if let Some(home) = dirs::home_dir() {
        #[cfg(not(windows))]
        let extra = [
            home.join(".bun/bin"),
            home.join(".cargo/bin"),
            home.join(".local/bin"),
            home.join(".npm-global/bin"),
            home.join("go/bin"),
            PathBuf::from("/opt/homebrew/bin"),
            PathBuf::from("/usr/local/bin"),
        ];
        #[cfg(windows)]
        let extra = [home.join(".bun").join("bin"), home.join(".cargo").join("bin")];
        for dir in extra {
            if !dirs.contains(&dir) {
                dirs.push(dir);
            }
        }
    }
    std::env::join_paths(dirs).ok()
}

fn shell_command(command: &str) -> tokio::process::Command {
    #[cfg(windows)]
    {
        let mut cmd = tokio::process::Command::new("cmd");
        cmd.arg("/D").arg("/S").arg("/C").arg(command);
        cmd.creation_flags(0x0800_0000);
        cmd
    }
    #[cfg(not(windows))]
    {
        // A login shell reads the user's profile, where nvm/pyenv/etc. set
        // up the PATH the command expects.
        let shell = std::env::var("SHELL")
            .ok()
            .filter(|s| s.starts_with('/'))
            .unwrap_or_else(|| "/bin/sh".into());
        let mut cmd = tokio::process::Command::new(shell);
        cmd.arg("-lc").arg(command);
        cmd
    }
}

fn clip(mut line: String) -> String {
    if line.len() > MAX_LINE {
        line.truncate(super::truncate_chars(&line, MAX_LINE).len());
        line.push('…');
    }
    line
}

/// Run `command` in the project (or `cwd` inside it) and stream each output
/// line. Resolves with the exit code once it ends; [`code_kill`] stops it.
#[tauri::command]
pub async fn code_run(
    run_id: String,
    root: String,
    command: String,
    cwd: Option<String>,
    on_event: Channel<RunEvent>,
) -> Result<Option<i32>, String> {
    let root = canonical_root(&root)?;
    let dir = match cwd.as_deref().filter(|c| !c.is_empty()) {
        Some(rel) => resolve(&root, rel)?,
        None => root,
    };
    if command.trim().is_empty() {
        return Err("No command to run".into());
    }
    let mut inner = shell_command(&command);
    inner
        .current_dir(&dir)
        .env("FORCE_COLOR", "0")
        .env("NO_COLOR", "1")
        .env("CI", "1");
    if let Some(path) = run_path() {
        inner.env("PATH", path);
    }
    let mut cmd = supervisor::command(inner);
    cmd.current_dir(&dir)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    let started = Instant::now();
    let (mut child, tree) =
        supervisor::spawn(&mut cmd, "code-run").map_err(|e| format!("Can't run `{command}`: {e}"))?;
    runs().lock().unwrap().insert(run_id.clone(), tree.pid());

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let pump = |reader: Option<Box<dyn tokio::io::AsyncRead + Unpin + Send>>, stream: &'static str| {
        let channel = on_event.clone();
        async move {
            let Some(reader) = reader else { return };
            let mut lines = BufReader::new(reader).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let _ = channel.send(RunEvent::Line { stream, text: clip(line) });
            }
        }
    };
    let out_task = tokio::spawn(pump(stdout.map(|s| Box::new(s) as _), "stdout"));
    let err_task = tokio::spawn(pump(stderr.map(|s| Box::new(s) as _), "stderr"));
    let status = child.wait().await;
    let _ = out_task.await;
    let _ = err_task.await;
    runs().lock().unwrap().remove(&run_id);
    drop(tree);

    let code = status.ok().and_then(|s| s.code());
    let _ = on_event.send(RunEvent::Exit {
        code,
        duration_ms: started.elapsed().as_millis() as u64,
    });
    Ok(code)
}

#[tauri::command]
pub fn code_kill(run_id: String) {
    if let Some(pid) = runs().lock().unwrap().get(&run_id).copied() {
        supervisor::terminate(pid);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn script_kind_guesses_from_name() {
        assert_eq!(script_kind("typecheck"), "check");
        assert_eq!(script_kind("check:types"), "check");
        assert_eq!(script_kind("build"), "build");
        assert_eq!(script_kind("build:watch"), "dev");
        assert_eq!(script_kind("test:unit"), "test");
        assert_eq!(script_kind("lint"), "lint");
        assert_eq!(script_kind("tauri"), "dev");
    }

    #[test]
    fn resolve_rejects_escapes_and_secrets() {
        let root = std::env::temp_dir().canonicalize().unwrap();
        assert!(resolve(&root, "../etc/passwd").is_err());
        assert!(resolve(&root, "/etc/passwd").is_err());
        assert!(resolve(&root, "app/.env").is_err());
        assert!(resolve(&root, ".env.local").is_err());
        assert!(resolve(&root, "").is_err());
    }

    #[test]
    fn resolve_allows_new_files_inside() {
        let root = std::env::temp_dir().canonicalize().unwrap();
        let path = resolve(&root, "mali-code-test/new/file.ts").unwrap();
        assert!(path.starts_with(&root));
        assert!(path.ends_with("mali-code-test/new/file.ts"));
    }
}
