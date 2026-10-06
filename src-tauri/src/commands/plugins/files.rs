//! The files Mali keeps for a plugin, and serving its panels.
//!
//! A panel is a web page the plugin ships. It is served from its own scheme
//! (`mali-plugin://`) and shown in a sandboxed frame without same-origin
//! rights: it can't reach Mali's commands, its storage or the network
//! (`connect-src 'none'`). It talks to the app only through `postMessage`,
//! and the app decides what each message may do.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::http::{header, Request, Response, StatusCode};

use super::plugins_root;
use crate::commands::storage::skills::remote::{client, fetch_bytes_max};
use crate::commands::storage::skills::{safe_relative, safe_slug};
use crate::templates::library::{self, UserTemplate};

const MAX_TEMPLATE_BYTES: u64 = 20 * 1024 * 1024;
const MAX_PANEL_FILE_BYTES: u64 = 2 * 1024 * 1024;

/// What a panel page may do: run its own scripts and styles and show its own
/// pictures. No requests anywhere, no forms, no plugins.
const PANEL_CSP: &str = "default-src 'none'; \
    script-src 'self' 'unsafe-inline' mali-plugin: http://mali-plugin.localhost https://mali-plugin.localhost; \
    style-src 'self' 'unsafe-inline' mali-plugin: http://mali-plugin.localhost https://mali-plugin.localhost; \
    img-src 'self' data: blob: mali-plugin: http://mali-plugin.localhost https://mali-plugin.localhost; \
    font-src 'self' data: mali-plugin: http://mali-plugin.localhost https://mali-plugin.localhost; \
    media-src 'self' data: blob:; connect-src 'none'; form-action 'none'; base-uri 'none'; object-src 'none'";

/// A file to keep: where it comes from and what to call it.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileRequest {
    /// A template's name, or a panel file's path inside the panels folder.
    pub name: String,
    /// An `https` URL or an absolute path.
    pub url: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledFiles {
    pub templates: Vec<UserTemplate>,
    /// Panel files that landed, relative to the panels folder.
    pub panel_files: Vec<String>,
    /// Files that couldn't be kept, and why.
    pub failed: Vec<String>,
}

/// One plugin's folder, guaranteed to sit directly inside the plugins folder.
fn plugin_dir(id: &str) -> Result<PathBuf, String> {
    let root = plugins_root()?;
    let dir = root.join(safe_slug(id)?);
    if dir.parent() != Some(root.as_path()) {
        return Err(format!("Invalid plugin id: {id:?}"));
    }
    Ok(dir)
}

/// Keep a plugin's templates (in the template library) and panel files (in
/// its own folder, replacing what an earlier version left).
#[tauri::command]
pub async fn plugins_install_files(
    id: String,
    plugin_name: String,
    templates: Vec<FileRequest>,
    panel_files: Vec<FileRequest>,
) -> Result<InstalledFiles, String> {
    let http = client()?;
    let dir = plugin_dir(&id)?;
    let panels = dir.join("panels");
    remove_dir(&panels)?;

    let mut failed = Vec::new();
    let mut landed = Vec::new();
    for file in &panel_files {
        let relative = safe_relative(&file.name)?;
        match read(&http, &file.url, MAX_PANEL_FILE_BYTES).await {
            Ok(bytes) => {
                let target = panels.join(&relative);
                if let Some(parent) = target.parent() {
                    std::fs::create_dir_all(parent).map_err(|e| format!("Cannot create {}: {e}", parent.display()))?;
                }
                std::fs::write(&target, bytes).map_err(|e| format!("Cannot write {}: {e}", target.display()))?;
                landed.push(file.name.clone());
            }
            Err(why) => failed.push(format!("{}: {why}", file.name)),
        }
    }

    let mut added = Vec::new();
    for file in &templates {
        let bytes = match read(&http, &file.url, MAX_TEMPLATE_BYTES).await {
            Ok(bytes) => bytes,
            Err(why) => {
                failed.push(format!("{}: {why}", file.name));
                continue;
            }
        };
        let description = format!("From the {plugin_name} plugin");
        // A template with that name already: keep both, the plugin's named for it.
        let names = [file.name.clone(), format!("{} ({plugin_name})", file.name)];
        let result = names
            .iter()
            .map(|name| library::add(&bytes, name, &description))
            .find(|r| r.is_ok())
            .unwrap_or_else(|| library::add(&bytes, &names[0], &description));
        match result {
            Ok(template) => added.push(template),
            Err(why) => failed.push(format!("{}: {why}", file.name)),
        }
    }
    Ok(InstalledFiles { templates: added, panel_files: landed, failed })
}

/// Remove what Mali kept for a plugin: its folder and the templates it added.
#[tauri::command]
pub fn plugins_remove_files(id: String, templates: Vec<String>) -> Result<(), String> {
    for template in templates {
        // Already gone (the user deleted it) is fine.
        let _ = library::remove(&template);
    }
    remove_dir(&plugin_dir(&id)?)
}

async fn read(http: &reqwest::Client, url: &str, max: u64) -> Result<Vec<u8>, String> {
    if url.starts_with("https://") {
        return fetch_bytes_max(http, url, max).await;
    }
    let path = Path::new(url);
    if !path.is_absolute() || path.is_symlink() || !path.is_file() {
        return Err("not a file Mali can copy".into());
    }
    if std::fs::metadata(path).map(|m| m.len()).unwrap_or(0) > max {
        return Err("too large".into());
    }
    std::fs::read(path).map_err(|e| format!("Cannot read {}: {e}", path.display()))
}

fn remove_dir(dir: &Path) -> Result<(), String> {
    let root = plugins_root()?;
    if !dir.starts_with(&root) || dir == root {
        return Err(format!("{} is not a plugin's folder", dir.display()));
    }
    match std::fs::remove_dir_all(dir) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("Cannot remove {}: {e}", dir.display())),
    }
}

/// Serve `mali-plugin://localhost/<plugin id>/<file>` from that plugin's
/// panels folder, and nothing else.
pub fn serve_panel_request(request: &Request<Vec<u8>>) -> Response<Vec<u8>> {
    match panel_file(request.uri().path()) {
        Ok(path) => match std::fs::read(&path) {
            Ok(body) => Response::builder()
                .status(StatusCode::OK)
                .header(header::CONTENT_TYPE, content_type(&path))
                .header("Content-Security-Policy", PANEL_CSP)
                .header("X-Content-Type-Options", "nosniff")
                .header(header::CACHE_CONTROL, "no-store")
                .body(body)
                .unwrap_or_else(|_| not_found()),
            Err(_) => not_found(),
        },
        Err(_) => not_found(),
    }
}

fn not_found() -> Response<Vec<u8>> {
    Response::builder()
        .status(StatusCode::NOT_FOUND)
        .header(header::CONTENT_TYPE, "text/plain")
        .body(b"Not found".to_vec())
        .expect("a static response")
}

/// The file a request path names, inside a plugin's panels folder.
fn panel_file(path: &str) -> Result<PathBuf, String> {
    let path = decode(path.trim_start_matches('/'))?;
    let (id, rest) = path.split_once('/').ok_or("no file")?;
    let relative = safe_relative(rest)?;
    let dir = plugin_dir(id)?.join("panels");
    let file = dir.join(relative);
    if !file.starts_with(&dir) || file.is_symlink() || !file.is_file() {
        return Err("not a panel file".into());
    }
    Ok(file)
}

/// Undo `%xx` escapes in a URL path.
fn decode(text: &str) -> Result<String, String> {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            let hex = text.get(i + 1..i + 3).ok_or("bad escape")?;
            out.push(u8::from_str_radix(hex, 16).map_err(|_| "bad escape")?);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(out).map_err(|_| "bad escape".into())
}

fn content_type(path: &Path) -> &'static str {
    match path.extension().and_then(|e| e.to_str()).map(str::to_ascii_lowercase).as_deref() {
        Some("html" | "htm") => "text/html; charset=utf-8",
        Some("js" | "mjs") => "text/javascript; charset=utf-8",
        Some("css") => "text/css; charset=utf-8",
        Some("json") => "application/json",
        Some("svg") => "image/svg+xml",
        Some("png") => "image/png",
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("woff2") => "font/woff2",
        Some("woff") => "font/woff",
        Some("txt" | "md") => "text/plain; charset=utf-8",
        _ => "application/octet-stream",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn keeps_panel_files_and_serves_only_them() {
        let source = std::env::temp_dir().join(format!("mali-panel-src-{}", uuid::Uuid::new_v4().simple()));
        std::fs::create_dir_all(&source).unwrap();
        let page = source.join("board.html");
        std::fs::write(&page, "<h1>hi</h1>").unwrap();

        let id = format!("test-{}", uuid::Uuid::new_v4().simple());
        let result = plugins_install_files(
            id.clone(),
            "Test".into(),
            vec![],
            vec![FileRequest { name: "board.html".into(), url: page.to_string_lossy().to_string() }],
        )
        .await
        .unwrap();
        assert_eq!(result.panel_files, ["board.html"]);

        let ok = serve_panel_request(&Request::get(format!("mali-plugin://localhost/{id}/board.html")).body(vec![]).unwrap());
        assert_eq!(ok.status(), StatusCode::OK);
        assert!(ok.headers()["Content-Security-Policy"].to_str().unwrap().contains("connect-src 'none'"));
        assert_eq!(ok.body(), b"<h1>hi</h1>");

        for bad in [
            format!("/{id}/../../etc/passwd"),
            format!("/{id}/%2e%2e/%2e%2e/x"),
            "/../x".to_string(),
            format!("/{id}"),
        ] {
            let res = serve_panel_request(&Request::get(format!("mali-plugin://localhost{bad}")).body(vec![]).unwrap());
            assert_eq!(res.status(), StatusCode::NOT_FOUND, "{bad}");
        }

        plugins_remove_files(id.clone(), vec![]).unwrap();
        assert!(!plugins_root().unwrap().join(&id).exists());
        let _ = std::fs::remove_dir_all(source);
    }

    #[test]
    fn nothing_outside_the_plugins_folder_can_be_removed() {
        assert!(plugins_remove_files("..".into(), vec![]).is_err());
        assert!(plugins_remove_files("a/b".into(), vec![]).is_err());
    }
}
