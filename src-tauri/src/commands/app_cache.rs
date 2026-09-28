//! Files the app can always fetch or rebuild again: the MCP registry
//! catalog, model prices and the like. Settings → General can clear them.

use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager, Runtime};

/// The webview's own data (localStorage, where settings live) sits beside the
/// cache on some platforms; it is never touched here.
const KEEP: &[&str] = &["WebKit", "EBWebView"];

fn cache_dirs<R: Runtime>(app: &AppHandle<R>) -> Vec<PathBuf> {
    app.path().app_cache_dir().ok().into_iter().collect()
}

/// Loose cache files kept with the app's data.
fn cache_files() -> Vec<PathBuf> {
    let dir = dirs::data_local_dir()
        .unwrap_or_else(std::env::temp_dir)
        .join("mali-cowork");
    vec![dir.join("model-prices.json")]
}

fn size_of(path: &Path) -> u64 {
    let Ok(meta) = fs::symlink_metadata(path) else { return 0 };
    if !meta.is_dir() {
        return meta.len();
    }
    fs::read_dir(path)
        .map(|entries| entries.flatten().map(|e| size_of(&e.path())).sum())
        .unwrap_or(0)
}

fn entries(dir: &Path) -> Vec<PathBuf> {
    fs::read_dir(dir)
        .map(|entries| {
            entries
                .flatten()
                .filter(|e| !KEEP.iter().any(|k| e.file_name() == *k))
                .map(|e| e.path())
                .collect()
        })
        .unwrap_or_default()
}

fn targets<R: Runtime>(app: &AppHandle<R>) -> Vec<PathBuf> {
    let mut all: Vec<PathBuf> = cache_dirs(app).iter().flat_map(|d| entries(d)).collect();
    all.extend(cache_files().into_iter().filter(|p| p.exists()));
    all
}

/// Bytes the cache takes up.
#[tauri::command]
pub async fn app_cache_size<R: Runtime>(app: AppHandle<R>) -> Result<u64, String> {
    Ok(targets(&app).iter().map(|p| size_of(p)).sum())
}

/// Remove the cache; returns the bytes freed. Files still in use are skipped.
#[tauri::command]
pub async fn app_clear_cache<R: Runtime>(app: AppHandle<R>) -> Result<u64, String> {
    let mut freed = 0;
    for path in targets(&app) {
        let size = size_of(&path);
        let removed = if path.is_dir() { fs::remove_dir_all(&path) } else { fs::remove_file(&path) };
        if removed.is_ok() {
            freed += size;
        }
    }
    Ok(freed)
}
