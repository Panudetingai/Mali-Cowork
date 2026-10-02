//! Pictures of what an agent made in another app — a Canva design's pages,
//! Notion covers, Figma frames — for the chat and the notch to show.
//!
//! Their links are signed and short-lived (Canva's last about a quarter of
//! an hour), so a chat opened later found them dead ("Preview unavailable").
//! Each picture is kept on disk the first time it loads (the app fetches
//! them as soon as a reply ends), and a link that has expired falls back to
//! the copy Canva names in its `fallback` parameter.
//!
//! A model asked to copy one of those links into its reply often gets a
//! character wrong (Canva then answers "Signature invalid"), and each one
//! costs hundreds of tokens. So a connector's thumbnail links never reach the
//! model: the hub hands it a short `mali-preview:<key>` handle instead
//! ([`shorten_previews`]), fetches the picture right away, and the app shows
//! the handle from what was kept.

use std::path::PathBuf;

use sha2::Digest;

use super::mcp_registry::{fetch_image, public_https};

/// Pictures kept; the oldest go beyond this.
const KEEP: usize = 600;

fn dir() -> PathBuf {
    dirs::data_local_dir()
        .unwrap_or_else(std::env::temp_dir)
        .join("mali-cowork")
        .join("previews")
}

/// Query parameters that sign or date a link rather than say what it shows.
const SIGNING: &[&str] = &[
    "x-amz-algorithm", "x-amz-credential", "x-amz-date", "x-amz-expires", "x-amz-signature",
    "x-amz-signedheaders", "x-amz-security-token", "response-expires", "csig", "osig", "exp",
    "expires", "signature", "sig", "token", "key-pair-id", "policy", "fallback", "signed", "signer",
];

/// The same picture under a fresh signature has the same key.
fn key_of(url: &reqwest::Url) -> String {
    let mut stable = url.clone();
    let kept: Vec<(String, String)> = url
        .query_pairs()
        .filter(|(name, _)| !SIGNING.contains(&name.to_ascii_lowercase().as_str()))
        .map(|(name, value)| (name.into_owned(), value.into_owned()))
        .collect();
    stable.set_query(None);
    if !kept.is_empty() {
        stable.query_pairs_mut().extend_pairs(kept);
    }
    hex::encode(&sha2::Sha256::digest(stable.as_str().as_bytes())[..16])
}

fn read(key: &str) -> Option<String> {
    std::fs::read_to_string(dir().join(format!("{key}.txt"))).ok()
}

fn write(key: &str, data_url: &str) {
    let dir = dir();
    if std::fs::create_dir_all(&dir).is_err() {
        return;
    }
    let _ = std::fs::write(dir.join(format!("{key}.txt")), data_url);
    prune(&dir);
}

/// Oldest first, beyond [`KEEP`].
fn prune(dir: &std::path::Path) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    let mut files: Vec<(std::time::SystemTime, PathBuf)> = entries
        .flatten()
        .filter_map(|e| Some((e.metadata().ok()?.modified().ok()?, e.path())))
        .collect();
    if files.len() <= KEEP {
        return;
    }
    files.sort();
    for (_, path) in &files[..files.len() - KEEP] {
        let _ = std::fs::remove_file(path);
    }
}

/// The link Canva gives in case its own has expired.
fn fallback_of(url: &reqwest::Url) -> Option<reqwest::Url> {
    let (_, value) = url.query_pairs().find(|(name, _)| name == "fallback")?;
    public_https(&value)
}

/// What a short handle stands for: `mali-preview:` and a [`key_of`].
pub const HANDLE: &str = "mali-preview:";

/// Fetched and kept: the link itself, else its fallback.
async fn fetch_and_keep(url: &reqwest::Url, key: &str) -> Result<String, String> {
    let fetched = match fetch_image(url.clone()).await {
        Ok(data) => Ok(data),
        Err(first) => match fallback_of(url) {
            Some(fallback) => fetch_image(fallback).await.map_err(|_| first),
            None => Err(first),
        },
    };
    let data = fetched?;
    write(key, &data);
    Ok(data)
}

/// A preview picture as a data URL, for a link or a `mali-preview:` handle:
/// kept from before, else fetched (its fallback if the link has expired) and kept.
#[tauri::command]
pub async fn preview_image(url: String) -> Result<String, String> {
    if let Some(key) = url.strip_prefix(HANDLE) {
        let key = key.trim();
        if key.len() != 32 || !key.bytes().all(|b| b.is_ascii_hexdigit()) {
            return Err("Not a preview handle".into());
        }
        if let Some(kept) = read(key) {
            return Ok(kept);
        }
        let link = link_of(key).ok_or("The preview link expired")?;
        return fetch_and_keep(&link, key).await;
    }
    let url = public_https(&url).ok_or("Use a public https:// link")?;
    let key = key_of(&url);
    if let Some(kept) = read(&key) {
        return Ok(kept);
    }
    fetch_and_keep(&url, &key).await
}

/// The link behind a handle, kept beside the picture until it loads.
fn link_of(key: &str) -> Option<reqwest::Url> {
    let raw = std::fs::read_to_string(dir().join(format!("{key}.url"))).ok()?;
    public_https(raw.trim())
}

fn remember_link(key: &str, url: &reqwest::Url) {
    let dir = dir();
    if std::fs::create_dir_all(&dir).is_ok() {
        let _ = std::fs::write(dir.join(format!("{key}.url")), url.as_str());
    }
}

/// A signed, short-lived link to a page's picture (a Canva page, a Notion
/// cover), as opposed to a file to download (an export) or a page to open.
fn is_preview_link(url: &reqwest::Url, before: &str) -> bool {
    let signed = url
        .query_pairs()
        .any(|(name, _)| SIGNING.contains(&name.to_ascii_lowercase().as_str()) && name != "fallback");
    if !signed || url.as_str().len() < 120 {
        return false;
    }
    let path = url.path().to_ascii_lowercase();
    let named = |s: &str| ["thumbnail", "document-image", "preview", "cover"].iter().any(|w| s.contains(w));
    // The field it sits in counts too: `"thumbnail": {"url": "…"}`.
    named(&path) || named(&before.to_ascii_lowercase())
}

fn link_pattern() -> &'static regex::Regex {
    static RE: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    RE.get_or_init(|| regex::Regex::new(r#"https:(?:\\?/){2}(?:[^\s"'<>\\`)\]]|\\u0026|\\/)+"#).unwrap())
}

/// A connector's answer with each thumbnail link swapped for a short handle.
/// Each picture is fetched now (the links expire within minutes) and kept;
/// `on_link` hears each one swapped, so the caller can fetch it.
pub fn shorten_previews(text: &str, mut on_link: impl FnMut(String, reqwest::Url)) -> String {
    if !text.contains("https://") {
        return text.to_string();
    }
    let mut out = String::with_capacity(text.len());
    let mut last = 0;
    for found in link_pattern().find_iter(text) {
        let before = &text[found.start().saturating_sub(48)..found.start()];
        // JSON may escape the `&`s and `/`s; the link is read unescaped.
        let raw = found.as_str().replace("\\u0026", "&").replace("\\/", "/");
        let Some(url) = public_https(&raw).filter(|url| is_preview_link(url, before)) else {
            continue;
        };
        let key = key_of(&url);
        out.push_str(&text[last..found.start()]);
        out.push_str(HANDLE);
        out.push_str(&key);
        last = found.end();
        on_link(key, url);
    }
    out.push_str(&text[last..]);
    out
}

/// [`shorten_previews`], with each picture fetched and kept in the background.
pub fn shorten_and_keep(text: &str) -> String {
    shorten_previews(text, |key, url| {
        if read(&key).is_some() {
            return;
        }
        remember_link(&key, &url);
        tauri::async_runtime::spawn(async move {
            let _ = fetch_and_keep(&url, &key).await;
        });
    })
}

/// Handles in a tool's arguments back to the links they stand for, so a
/// connector given one (to attach a picture, say) gets the real address.
pub fn expand_previews(args: serde_json::Value) -> serde_json::Value {
    use serde_json::Value;
    match args {
        Value::String(s) if s.contains(HANDLE) => {
            let mut out = s.clone();
            for (at, _) in s.match_indices(HANDLE) {
                let key: String = s[at + HANDLE.len()..].chars().take(32).collect();
                if let Some(link) = link_of(&key) {
                    out = out.replace(&format!("{HANDLE}{key}"), link.as_str());
                }
            }
            Value::String(out)
        }
        Value::Array(items) => Value::Array(items.into_iter().map(expand_previews).collect()),
        Value::Object(map) => Value::Object(map.into_iter().map(|(k, v)| (k, expand_previews(v))).collect()),
        other => other,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn url(raw: &str) -> reqwest::Url {
        reqwest::Url::parse(raw).unwrap()
    }

    #[test]
    fn a_fresh_signature_is_the_same_picture() {
        let a = url("https://media.canva.com/v2/document-image/hash:1/id:D/width:387?brand=B&csig=one&exp=100&page=1");
        let b = url("https://media.canva.com/v2/document-image/hash:1/id:D/width:387?brand=B&csig=two&exp=200&page=1");
        let other_page = url("https://media.canva.com/v2/document-image/hash:1/id:D/width:387?brand=B&csig=two&exp=200&page=2");
        assert_eq!(key_of(&a), key_of(&b));
        assert_ne!(key_of(&a), key_of(&other_page));
    }

    #[test]
    fn thumbnail_links_become_handles() {
        let thumb = "https://media.canva.com/v2/document-image/hash:1/id:D/width:387?brand=B&csig=AAAAAAAAAAAAAAAAAAAAAJGxNRnzyD6AsPEW3J4Ck6hpcMYybxIoa0Ns4cJS8hTE&exp=100&page=1";
        let export = "https://export-download.canva.com/x/1.pdf?X-Amz-Signature=abcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdef&X-Amz-Expires=100";
        let edit = "https://www.canva.com/design/DAH/edit";
        let text = format!(r#"{{"thumbnail":{{"url":"{thumb}"}},"export":"{export}","edit":"{edit}"}}"#);
        let mut seen = Vec::new();
        let out = shorten_previews(&text, |key, url| seen.push((key, url)));
        let key = key_of(&url(thumb));
        assert!(out.contains(&format!(r#""url":"{HANDLE}{key}""#)), "{out}");
        assert!(out.contains(export) && out.contains(edit));
        assert_eq!(seen.len(), 1);
        assert_eq!(seen[0].1.as_str(), thumb);
    }

    #[test]
    fn canvas_fallback_link_is_found() {
        let u = url("https://media.canva.com/x?fallback=https%3A%2F%2Fs3.amazonaws.com%2Fdoc%2F1.png%3FX-Amz-Expires%3D5&page=1");
        assert_eq!(fallback_of(&u).unwrap().as_str(), "https://s3.amazonaws.com/doc/1.png?X-Amz-Expires=5");
        assert!(fallback_of(&url("https://example.com/a.png")).is_none());
    }
}
