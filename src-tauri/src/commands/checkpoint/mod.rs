//! Checkpoints: what an agent changed in the user's folders during one turn,
//! with a way back.
//!
//! - `checkpoint_begin` snapshots the writable folders before the agent
//!   starts; `checkpoint_add_folder` adds one granted mid-turn.
//! - `checkpoint_finish` snapshots them again and keeps only the files that
//!   changed, with their content before and after.
//! - `checkpoint_restore` puts those files back as they were before the turn
//!   (undo) or after it (redo). Files changed since then are reported as
//!   conflicts and left alone unless the user insists.
//! - `checkpoint_diff`, `checkpoint_preview` and `checkpoint_open` show a
//!   changed file. They accept only paths the checkpoint recorded, so the UI
//!   can't use them to read or open anything else.
//!
//! Checkpoints are kept for [`KEEP_FOR`] (at most [`MAX_RECORDS`]); file
//! contents no checkpoint needs any more are deleted.

mod docx;
mod snapshot;
mod store;

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use base64::Engine;
use serde::{Deserialize, Serialize};

use snapshot::{Change, Entry, Limits, Manifest};

use crate::commands::file_diff::FileDiff;

const KEEP_FOR: Duration = Duration::from_secs(30 * 24 * 60 * 60);
const MAX_RECORDS: usize = 200;
/// A snapshot still running after this gives up: the turn goes on without undo.
const SCAN_TIME: Duration = Duration::from_secs(20);
const LIMITS_FILES: usize = 50_000;
const LIMITS_FILE_BYTES: u64 = 50 * 1024 * 1024;
const LIMITS_NEW_BYTES: u64 = 1024 * 1024 * 1024;
/// Text larger than this gets no line counts, diff or preview.
const MAX_TEXT_BYTES: u64 = 1024 * 1024;
/// Pictures, PDFs and documents larger than this aren't previewed.
const MAX_PREVIEW_BYTES: u64 = 25 * 1024 * 1024;

/// Serializes everything that writes to the store, so garbage collection
/// never deletes content a snapshot in progress just saved.
static STORE_LOCK: Mutex<()> = Mutex::new(());

/// Folders that were too large to snapshot, so later turns skip them at once.
static TOO_LARGE: Mutex<Vec<String>> = Mutex::new(Vec::new());

// ── records ──

/// A snapshot taken before a turn that hasn't finished yet.
#[derive(Serialize, Deserialize)]
struct Pending {
    roots: Vec<String>,
    created_at: u64,
    partial: bool,
    before: Manifest,
}

/// A finished turn: only the files that changed.
#[derive(Serialize, Deserialize)]
struct Record {
    roots: Vec<String>,
    created_at: u64,
    partial: bool,
    changes: Vec<Change>,
}

fn pending_path(id: &str) -> Result<PathBuf, String> {
    Ok(store::root().join("pending").join(format!("{}.json", valid_id(id)?)))
}

fn record_path(id: &str) -> Result<PathBuf, String> {
    Ok(store::root().join("turns").join(format!("{}.json", valid_id(id)?)))
}

/// Ids end up in file names.
fn valid_id(id: &str) -> Result<&str, String> {
    let ok = !id.is_empty() && id.len() <= 64 && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-');
    ok.then_some(id).ok_or_else(|| "Invalid checkpoint id".to_string())
}

fn read_json<T: for<'de> Deserialize<'de>>(path: &Path) -> Option<T> {
    std::fs::read(path).ok().and_then(|raw| serde_json::from_slice(&raw).ok())
}

/// Atomic, owner-only write.
fn write_json(path: &Path, json: &str) -> Result<(), String> {
    crate::commands::secure_fs::write_private(path, json)
}

fn load_record(id: &str) -> Result<Record, String> {
    read_json(&record_path(id)?).ok_or_else(|| "This checkpoint is no longer available.".to_string())
}

fn now_secs() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or_default()
}

// ── API types ──

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BeginResult {
    pub id: String,
    pub files: usize,
    /// Some files were too large (or secret) to save, so they can't be restored.
    pub partial: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileChange {
    pub path: String,
    /// Path inside the folder it belongs to, for display.
    pub relative: String,
    /// `added`, `modified` or `deleted`.
    pub kind: &'static str,
    pub size: Option<u64>,
    /// Lines added/removed, for text files.
    pub additions: Option<usize>,
    pub deletions: Option<usize>,
    /// Both sides were saved, so undo and redo can restore it.
    pub restorable: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnChanges {
    pub id: String,
    pub changes: Vec<FileChange>,
    pub partial: bool,
}

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RestoreResult {
    pub restored: Vec<String>,
    /// Changed since the turn; left alone unless `force`.
    pub conflicts: Vec<String>,
    /// Can't be restored (content wasn't saved).
    pub skipped: Vec<String>,
    pub errors: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FilePreview {
    /// `text`, `markdown`, `image`, `pdf`, `document`, `binary` or `unavailable`.
    pub kind: &'static str,
    pub name: String,
    pub mime: String,
    pub text: Option<String>,
    /// Base64 bytes for pictures and PDFs.
    pub data: Option<String>,
    /// Code language for text, from the extension.
    pub language: Option<String>,
    /// The file was deleted; this is how it looked before.
    pub deleted: bool,
    pub note: Option<String>,
}

// ── commands ──

/// Snapshot `folders` before a turn. Fails when a folder is too large to
/// snapshot in time; the turn then runs without undo.
#[tauri::command]
pub async fn checkpoint_begin(folders: Vec<String>) -> Result<BeginResult, String> {
    blocking(move || {
        let roots = roots(&folders)?;
        let _lock = STORE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let scan = scan_roots(&roots)?;
        let id = uuid::Uuid::new_v4().simple().to_string();
        let pending = Pending {
            roots: roots.iter().map(|r| r.to_string_lossy().into_owned()).collect(),
            created_at: now_secs(),
            partial: scan.partial,
            before: scan.files,
        };
        let files = pending.before.len();
        let json = serde_json::to_string(&pending).map_err(|e| e.to_string())?;
        write_json(&pending_path(&id)?, &json)?;
        Ok(BeginResult { id, files, partial: pending.partial })
    })
    .await
}

/// Add a folder granted while the turn runs, before the agent writes to it.
#[tauri::command]
pub async fn checkpoint_add_folder(id: String, folder: String) -> Result<(), String> {
    blocking(move || {
        let _lock = STORE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let path = pending_path(&id)?;
        let mut pending: Pending = read_json(&path).ok_or("This turn has no checkpoint")?;
        let mut all: Vec<String> = pending.roots.clone();
        all.push(folder);
        let roots = roots(&all)?;
        let new: Vec<PathBuf> = roots
            .iter()
            .filter(|r| !pending.roots.iter().any(|old| Path::new(old) == r.as_path()))
            .cloned()
            .collect();
        if new.is_empty() {
            return Ok(());
        }
        let scan = scan_roots(&new)?;
        pending.partial |= scan.partial;
        // Files already recorded keep their state from before the turn.
        for (path, entry) in scan.files {
            pending.before.entry(path).or_insert(entry);
        }
        pending.roots = roots.iter().map(|r| r.to_string_lossy().into_owned()).collect();
        let json = serde_json::to_string(&pending).map_err(|e| e.to_string())?;
        write_json(&path, &json)
    })
    .await
}

/// Snapshot again after the turn and keep what changed.
#[tauri::command]
pub async fn checkpoint_finish(id: String) -> Result<TurnChanges, String> {
    blocking(move || {
        let _lock = STORE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let path = pending_path(&id)?;
        let pending: Pending = read_json(&path).ok_or("This turn has no checkpoint")?;
        let roots: Vec<PathBuf> = pending.roots.iter().map(PathBuf::from).collect();
        let after = scan_roots(&roots);
        let _ = std::fs::remove_file(&path);
        let after = after?;
        let record = Record {
            roots: pending.roots,
            created_at: pending.created_at,
            partial: pending.partial || after.partial,
            changes: snapshot::diff(&pending.before, &after.files),
        };
        if !record.changes.is_empty() {
            let json = serde_json::to_string(&record).map_err(|e| e.to_string())?;
            write_json(&record_path(&id)?, &json)?;
        }
        prune();
        Ok(TurnChanges { id, changes: describe(&record), partial: record.partial })
    })
    .await
}

/// Put the turn's files back as they were `before` (undo) or `after` (redo).
#[tauri::command]
pub async fn checkpoint_restore(id: String, to: String, force: bool) -> Result<RestoreResult, String> {
    let undo = match to.as_str() {
        "before" => true,
        "after" => false,
        other => return Err(format!("Unknown restore target: {other}")),
    };
    blocking(move || {
        let _lock = STORE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let record = load_record(&id)?;
        Ok(restore(&record, undo, force))
    })
    .await
}

/// Undo (`before`) or redo (`after`) one file of a turn, leaving the rest.
/// Same rules as [`checkpoint_restore`]: a file changed since is a conflict
/// and stays unless `force`.
#[tauri::command]
pub async fn checkpoint_restore_file(id: String, path: String, to: String, force: bool) -> Result<RestoreResult, String> {
    let undo = match to.as_str() {
        "before" => true,
        "after" => false,
        other => return Err(format!("Unknown restore target: {other}")),
    };
    blocking(move || {
        let _lock = STORE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let record = load_record(&id)?;
        let change = find(&record, &path)?.clone();
        let single = Record {
            roots: record.roots.clone(),
            created_at: record.created_at,
            partial: record.partial,
            changes: vec![change],
        };
        Ok(restore(&single, undo, force))
    })
    .await
}

/// A file's text from before the turn, for an inline diff: empty when the
/// turn created it, `None` when it wasn't saved or isn't text.
#[tauri::command]
pub async fn checkpoint_before_text(id: String, path: String) -> Result<Option<String>, String> {
    blocking(move || {
        let record = load_record(&id)?;
        let change = find(&record, &path)?;
        Ok(text_of(change.before.as_ref()).map(Option::unwrap_or_default))
    })
    .await
}

#[tauri::command]
pub async fn checkpoint_diff(id: String, path: String) -> Result<FileDiff, String> {
    blocking(move || {
        let record = load_record(&id)?;
        let change = find(&record, &path)?;
        Ok(file_diff(change))
    })
    .await
}

#[tauri::command]
pub async fn checkpoint_preview(id: String, path: String) -> Result<FilePreview, String> {
    blocking(move || {
        let record = load_record(&id)?;
        let change = find(&record, &path)?;
        Ok(preview(change))
    })
    .await
}

/// Open a changed file in its app, or show it in Finder/Explorer.
#[tauri::command]
pub async fn checkpoint_open(id: String, path: String, reveal: bool) -> Result<(), String> {
    blocking(move || {
        let record = load_record(&id)?;
        let change = find(&record, &path)?;
        let target = Path::new(&change.path);
        if reveal {
            // A deleted file can't be selected; show its folder instead.
            if target.exists() {
                tauri_plugin_opener::reveal_item_in_dir(target).map_err(|e| e.to_string())
            } else {
                let folder = target.parent().filter(|p| p.is_dir()).ok_or("The folder no longer exists")?;
                tauri_plugin_opener::open_path(folder, None::<&str>).map_err(|e| e.to_string())
            }
        } else if target.is_file() {
            tauri_plugin_opener::open_path(target, None::<&str>).map_err(|e| e.to_string())
        } else {
            Err("The file no longer exists".into())
        }
    })
    .await
}

// ── internals ──

async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tokio::task::spawn_blocking(work).await.map_err(|e| e.to_string())?
}

/// Existing, absolute folders, without ones inside another. The whole home
/// folder or a drive root is refused: far too large to snapshot every turn.
fn roots(folders: &[String]) -> Result<Vec<PathBuf>, String> {
    let home = dirs::home_dir();
    let mut roots: Vec<PathBuf> = Vec::new();
    for folder in folders {
        let path = std::fs::canonicalize(folder.trim()).map_err(|_| format!("{folder} doesn't exist"))?;
        if !path.is_dir() {
            return Err(format!("{folder} isn't a folder"));
        }
        if path.parent().is_none() || home.as_deref() == Some(path.as_path()) {
            return Err(format!("{} is too broad to checkpoint", path.display()));
        }
        roots.push(path);
    }
    roots.sort();
    roots.dedup();
    let mut outer: Vec<PathBuf> = Vec::new();
    for root in roots {
        if !outer.iter().any(|o| root.starts_with(o)) {
            outer.push(root);
        }
    }
    if outer.is_empty() {
        return Err("No folder to checkpoint".into());
    }
    Ok(outer)
}

fn scan_roots(roots: &[PathBuf]) -> Result<snapshot::Scan, String> {
    let too_large = TOO_LARGE.lock().unwrap_or_else(|e| e.into_inner()).clone();
    if let Some(root) = roots.iter().find(|r| too_large.contains(&r.to_string_lossy().into_owned())) {
        return Err(format!("{} is too large to checkpoint", root.display()));
    }
    let limits = Limits {
        max_files: LIMITS_FILES,
        max_file_bytes: LIMITS_FILE_BYTES,
        max_new_bytes: LIMITS_NEW_BYTES,
        deadline: Instant::now() + SCAN_TIME,
    };
    snapshot::scan(roots, &limits).inspect_err(|_| {
        // Remember the folders so the next turn doesn't wait again.
        let mut too_large = TOO_LARGE.lock().unwrap_or_else(|e| e.into_inner());
        too_large.extend(roots.iter().map(|r| r.to_string_lossy().into_owned()));
    })
}

/// Every path a turn changed, so other commands can answer only for files
/// the app itself listed (the Outputs gallery's `outputs_stat`).
pub(crate) fn changed_paths(id: &str) -> Result<std::collections::HashSet<String>, String> {
    Ok(load_record(id)?.changes.into_iter().map(|c| c.path).collect())
}

fn find<'a>(record: &'a Record, path: &str) -> Result<&'a Change, String> {
    record
        .changes
        .iter()
        .find(|c| c.path == path)
        .ok_or_else(|| "This file isn't part of the checkpoint".to_string())
}

fn describe(record: &Record) -> Vec<FileChange> {
    record
        .changes
        .iter()
        .map(|change| {
            let kind = match (&change.before, &change.after) {
                (None, _) => "added",
                (_, None) => "deleted",
                _ => "modified",
            };
            let relative = record
                .roots
                .iter()
                .filter_map(|root| Path::new(&change.path).strip_prefix(root).ok())
                .map(|rel| rel.to_string_lossy().into_owned())
                .min_by_key(String::len)
                .unwrap_or_else(|| change.path.clone());
            let (additions, deletions) = match line_counts(change) {
                Some((a, d)) => (Some(a), Some(d)),
                None => (None, None),
            };
            FileChange {
                path: change.path.clone(),
                relative,
                kind,
                size: change.after.as_ref().or(change.before.as_ref()).map(|e| e.size),
                additions,
                deletions,
                restorable: restorable(change.before.as_ref()) && restorable(change.after.as_ref()),
            }
        })
        .collect()
}

/// A side can be put back when the file didn't exist or its content was saved.
fn restorable(entry: Option<&Entry>) -> bool {
    entry.is_none_or(|e| e.hash.is_some())
}

fn text_of(entry: Option<&Entry>) -> Option<Option<String>> {
    let Some(entry) = entry else { return Some(None) };
    if entry.size > MAX_TEXT_BYTES {
        return None;
    }
    let bytes = store::read(entry.hash.as_deref()?).ok()?;
    if bytes.contains(&0) {
        return None;
    }
    String::from_utf8(bytes).ok().map(Some)
}

fn line_counts(change: &Change) -> Option<(usize, usize)> {
    let old = text_of(change.before.as_ref())?.unwrap_or_default();
    let new = text_of(change.after.as_ref())?.unwrap_or_default();
    let diff = FileDiff::from_texts(&old, &new);
    Some((diff.additions, diff.deletions))
}

fn file_diff(change: &Change) -> FileDiff {
    let too_large = [&change.before, &change.after]
        .iter()
        .any(|e| e.as_ref().is_some_and(|e| e.size > MAX_TEXT_BYTES));
    if too_large {
        return FileDiff::empty("too-large");
    }
    if !restorable(change.before.as_ref()) || !restorable(change.after.as_ref()) {
        return FileDiff::empty("unavailable");
    }
    match (text_of(change.before.as_ref()), text_of(change.after.as_ref())) {
        (Some(old), Some(new)) => FileDiff::from_texts(&old.unwrap_or_default(), &new.unwrap_or_default()),
        _ => FileDiff::empty("binary"),
    }
}

fn preview(change: &Change) -> FilePreview {
    let path = Path::new(&change.path);
    let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let mime = crate::commands::attachments::mime_for(path).to_string();
    let ext = path.extension().and_then(|e| e.to_str()).map(str::to_ascii_lowercase).unwrap_or_default();
    let deleted = change.after.is_none();
    let entry = change.after.as_ref().or(change.before.as_ref());
    let mut out = FilePreview {
        kind: "unavailable",
        name,
        mime,
        text: None,
        data: None,
        language: None,
        deleted,
        note: None,
    };
    let Some(entry) = entry else { return out };
    let is_image = matches!(ext.as_str(), "png" | "jpg" | "jpeg" | "gif" | "webp" | "bmp");
    let limit = if is_image || ext == "pdf" || ext == "docx" { MAX_PREVIEW_BYTES } else { MAX_TEXT_BYTES };
    if entry.size > limit {
        out.note = Some("Too large to preview — open it instead.".into());
        return out;
    }
    let bytes = match entry.hash.as_deref() {
        Some(hash) => store::read(hash).ok(),
        None => {
            out.note = Some("This file's content wasn't saved (too large or private).".into());
            return out;
        }
    };
    let Some(bytes) = bytes else {
        out.note = Some("The saved copy is missing.".into());
        return out;
    };
    let encode = |b: &[u8]| base64::engine::general_purpose::STANDARD.encode(b);
    match ext.as_str() {
        _ if is_image => {
            out.kind = "image";
            if ext == "bmp" {
                out.mime = "image/bmp".into();
            }
            out.data = Some(encode(&bytes));
        }
        "pdf" => {
            out.kind = "pdf";
            out.data = Some(encode(&bytes));
        }
        "docx" => match docx::to_markdown(&bytes) {
            Ok(markdown) => {
                out.kind = "document";
                out.text = Some(markdown);
            }
            Err(e) => out.note = Some(e),
        },
        _ => match String::from_utf8(bytes) {
            Ok(text) if !text.contains('\0') => {
                out.kind = if matches!(ext.as_str(), "md" | "markdown" | "mdx") { "markdown" } else { "text" };
                out.language = Some(language_for(&ext).to_string());
                out.text = Some(text);
            }
            _ => {
                out.kind = "binary";
                out.note = Some("No preview for this kind of file — open it instead.".into());
            }
        },
    }
    out
}

fn language_for(ext: &str) -> &str {
    match ext {
        "rs" => "rust",
        "ts" | "mts" | "cts" => "typescript",
        "tsx" => "tsx",
        "js" | "mjs" | "cjs" => "javascript",
        "jsx" => "jsx",
        "py" => "python",
        "sh" | "bash" | "zsh" => "bash",
        "yml" | "yaml" => "yaml",
        "htm" => "html",
        "md" | "markdown" | "mdx" => "markdown",
        "" | "txt" | "log" => "text",
        other => other,
    }
}

fn restore(record: &Record, undo: bool, force: bool) -> RestoreResult {
    let mut result = RestoreResult::default();
    let mut plan: Vec<(&Change, Option<&Entry>)> = Vec::new();
    for change in &record.changes {
        let (expected, target) = if undo {
            (change.after.as_ref(), change.before.as_ref())
        } else {
            (change.before.as_ref(), change.after.as_ref())
        };
        if !restorable(target) {
            result.skipped.push(change.path.clone());
            continue;
        }
        let current = snapshot::current(Path::new(&change.path));
        let untouched = match (&current, expected) {
            (None, None) => true,
            (Some(now), Some(then)) => now.same_as(then),
            _ => false,
        };
        let already = match (&current, target) {
            (None, None) => true,
            (Some(now), Some(goal)) => now.same_as(goal),
            _ => false,
        };
        if already {
            continue;
        }
        if !untouched {
            result.conflicts.push(change.path.clone());
        }
        plan.push((change, target));
    }
    // All or nothing: with conflicts and no `force`, nothing is touched.
    if !result.conflicts.is_empty() && !force {
        return result;
    }
    for (change, target) in plan {
        match put_back(Path::new(&change.path), target) {
            Ok(()) => result.restored.push(change.path.clone()),
            Err(e) => result.errors.push(format!("{}: {e}", change.path)),
        }
    }
    result
}

/// Make `path` hold `target`'s content, or not exist when `target` is `None`.
fn put_back(path: &Path, target: Option<&Entry>) -> Result<(), String> {
    let Some(entry) = target else {
        return match std::fs::remove_file(path) {
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.to_string()),
            _ => Ok(()),
        };
    };
    let hash = entry.hash.as_deref().ok_or("content wasn't saved")?;
    let source = store::blob_path(hash).filter(|p| p.is_file()).ok_or("the saved copy is missing")?;
    let parent = path.parent().ok_or("no parent folder")?;
    std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    // Copy next to the file, then swap it in, so a failure never leaves half a file.
    let tmp = parent.join(format!(".mali-restore-{}", uuid::Uuid::new_v4().simple()));
    let copy = std::fs::copy(&source, &tmp).map_err(|e| e.to_string()).and_then(|_| {
        #[cfg(unix)]
        if entry.mode != 0 {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(entry.mode));
        }
        std::fs::rename(&tmp, path).map_err(|e| e.to_string())
    });
    if copy.is_err() {
        let _ = std::fs::remove_file(&tmp);
    }
    copy
}

/// Drop old checkpoints and file contents nothing needs any more.
fn prune() {
    let base = store::root();
    let cutoff = now_secs().saturating_sub(KEEP_FOR.as_secs());
    // Pending snapshots of turns that never finished (the app quit mid-turn).
    let stale_pending = now_secs().saturating_sub(24 * 60 * 60);
    let mut keep = HashSet::new();
    for entry in std::fs::read_dir(base.join("pending")).into_iter().flatten().flatten() {
        match read_json::<Pending>(&entry.path()) {
            Some(p) if p.created_at >= stale_pending => {
                keep.extend(p.before.values().filter_map(|e| e.hash.clone()));
            }
            _ => {
                let _ = std::fs::remove_file(entry.path());
            }
        }
    }
    let mut records: Vec<(u64, PathBuf, Record)> = std::fs::read_dir(base.join("turns"))
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|entry| {
            let record = read_json::<Record>(&entry.path());
            if record.is_none() {
                let _ = std::fs::remove_file(entry.path());
            }
            record.map(|r| (r.created_at, entry.path(), r))
        })
        .collect();
    records.sort_by_key(|(created, _, _)| std::cmp::Reverse(*created));
    for (index, (created, path, record)) in records.into_iter().enumerate() {
        if index >= MAX_RECORDS || created < cutoff {
            let _ = std::fs::remove_file(path);
            continue;
        }
        for change in record.changes {
            keep.extend([change.before, change.after].into_iter().flatten().filter_map(|e| e.hash));
        }
    }
    store::collect_garbage(&keep);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_folder() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("mali-checkpoint-{}", uuid::Uuid::new_v4().simple()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::canonicalize(dir).unwrap()
    }

    fn kinds(turn: &TurnChanges) -> Vec<(String, &'static str)> {
        turn.changes.iter().map(|c| (c.relative.clone(), c.kind)).collect()
    }

    #[tokio::test]
    async fn a_turn_can_be_undone_and_redone() {
        let dir = temp_folder();
        let folder = dir.to_string_lossy().into_owned();
        std::fs::write(dir.join("keep.txt"), "same").unwrap();
        std::fs::write(dir.join("edit.md"), "one\ntwo\n").unwrap();
        std::fs::write(dir.join("gone.txt"), "bye").unwrap();
        std::fs::create_dir_all(dir.join("node_modules")).unwrap();
        std::fs::write(dir.join("node_modules").join("x.js"), "1").unwrap();

        let begin = checkpoint_begin(vec![folder.clone()]).await.unwrap();
        assert_eq!(begin.files, 3, "node_modules is skipped");

        // The agent's turn.
        std::fs::write(dir.join("edit.md"), "one\n2\nthree\n").unwrap();
        std::fs::remove_file(dir.join("gone.txt")).unwrap();
        std::fs::create_dir_all(dir.join("out")).unwrap();
        std::fs::write(dir.join("out").join("new.txt"), "hi").unwrap();

        let turn = checkpoint_finish(begin.id.clone()).await.unwrap();
        let sep = std::path::MAIN_SEPARATOR;
        assert_eq!(
            kinds(&turn),
            [
                ("edit.md".to_string(), "modified"),
                ("gone.txt".to_string(), "deleted"),
                (format!("out{sep}new.txt"), "added"),
            ]
        );
        let edit = &turn.changes[0];
        assert_eq!((edit.additions, edit.deletions), (Some(2), Some(1)));

        let diff = checkpoint_diff(turn.id.clone(), edit.path.clone()).await.unwrap();
        assert_eq!(diff.kind, "text");
        assert_eq!((diff.additions, diff.deletions), (2, 1));
        let preview = checkpoint_preview(turn.id.clone(), edit.path.clone()).await.unwrap();
        assert_eq!(preview.kind, "markdown");
        assert_eq!(preview.text.as_deref(), Some("one\n2\nthree\n"));
        // Only recorded files can be read through the checkpoint.
        assert!(checkpoint_preview(turn.id.clone(), dir.join("keep.txt").to_string_lossy().into()).await.is_err());

        let undo = checkpoint_restore(turn.id.clone(), "before".into(), false).await.unwrap();
        assert_eq!(undo.restored.len(), 3);
        assert!(undo.conflicts.is_empty());
        assert_eq!(std::fs::read_to_string(dir.join("edit.md")).unwrap(), "one\ntwo\n");
        assert_eq!(std::fs::read_to_string(dir.join("gone.txt")).unwrap(), "bye");
        assert!(!dir.join("out").join("new.txt").exists());

        let redo = checkpoint_restore(turn.id.clone(), "after".into(), false).await.unwrap();
        assert_eq!(redo.restored.len(), 3);
        assert_eq!(std::fs::read_to_string(dir.join("edit.md")).unwrap(), "one\n2\nthree\n");
        assert!(!dir.join("gone.txt").exists());

        // The user edits the file afterwards: undo stops and asks.
        std::fs::write(dir.join("edit.md"), "mine").unwrap();
        let blocked = checkpoint_restore(turn.id.clone(), "before".into(), false).await.unwrap();
        assert_eq!(blocked.conflicts, [edit.path.clone()]);
        assert!(blocked.restored.is_empty());
        assert_eq!(std::fs::read_to_string(dir.join("edit.md")).unwrap(), "mine");
        let forced = checkpoint_restore(turn.id.clone(), "before".into(), true).await.unwrap();
        assert_eq!(forced.restored.len(), 3);
        assert_eq!(std::fs::read_to_string(dir.join("edit.md")).unwrap(), "one\ntwo\n");

        let _ = std::fs::remove_dir_all(dir);
    }

    #[tokio::test]
    async fn a_turn_without_changes_leaves_nothing_behind() {
        let dir = temp_folder();
        std::fs::write(dir.join("a.txt"), "a").unwrap();
        let begin = checkpoint_begin(vec![dir.to_string_lossy().into()]).await.unwrap();
        let turn = checkpoint_finish(begin.id.clone()).await.unwrap();
        assert!(turn.changes.is_empty());
        assert!(!record_path(&begin.id).unwrap().exists());
        assert!(!pending_path(&begin.id).unwrap().exists());
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn roots_refuse_home_and_fold_nested_folders() {
        let dir = temp_folder();
        let inner = dir.join("inner");
        std::fs::create_dir_all(&inner).unwrap();
        let roots = roots(&[inner.to_string_lossy().into(), dir.to_string_lossy().into()]).unwrap();
        assert_eq!(roots, [dir.clone()]);
        let home = dirs::home_dir().unwrap().to_string_lossy().into_owned();
        assert!(super::roots(&[home]).is_err());
        assert!(super::roots(&["/".into()]).is_err());
        assert!(valid_id("../x").is_err());
        let _ = std::fs::remove_dir_all(dir);
    }
}
