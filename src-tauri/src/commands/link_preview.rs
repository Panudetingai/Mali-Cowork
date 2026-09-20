//! Fetch Open Graph metadata for a public https URL (link hover previews).

use std::net::IpAddr;

use reqwest::Url;
use serde::Serialize;

const MAX_HTML_BYTES: usize = 512 * 1024;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkPreview {
    pub url: String,
    pub title: Option<String>,
    pub description: Option<String>,
    pub image: Option<String>,
    pub site_name: Option<String>,
}

fn public_http_url(raw: &str) -> Result<Url, String> {
    let url = Url::parse(raw.trim()).map_err(|_| "Invalid URL".to_string())?;
    if url.scheme() != "https" && url.scheme() != "http" {
        return Err("Only http(s) links can be previewed.".into());
    }
    let host = url.host_str().ok_or("Invalid URL host")?;
    if host == "localhost" || host.ends_with(".localhost") || host.ends_with(".local") {
        return Err("Local links can't be previewed.".into());
    }
    if let Ok(ip) = host.trim_matches(['[', ']']).parse::<IpAddr>() {
        let private = match ip {
            IpAddr::V4(v4) => v4.is_private() || v4.is_loopback() || v4.is_link_local() || v4.is_unspecified(),
            IpAddr::V6(v6) => v6.is_loopback() || v6.is_unspecified() || (v6.segments()[0] & 0xfe00) == 0xfc00,
        };
        if private {
            return Err("Local links can't be previewed.".into());
        }
    }
    Ok(url)
}

fn decode_meta(raw: &str) -> String {
    raw.trim()
        .trim_matches('"')
        .trim_matches('\'')
        .replace("&amp;", "&")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
}

fn title_tag(html: &str) -> Option<String> {
    let lower = html.to_ascii_lowercase();
    let start = lower.find("<title")?;
    let after = &html[start..];
    let open_end = after.find('>')? + 1;
    let close = after[open_end..].find("</title>")?;
    let value = decode_meta(&after[open_end..open_end + close]);
    if value.is_empty() { None } else { Some(value) }
}

fn pick_meta(html: &str, keys: &[&str]) -> Option<String> {
    for key in keys {
        if let Some(v) = meta_tag_simple(html, key) {
            return Some(v);
        }
    }
    None
}

/// Scan `<meta …>` tags without regex — good enough for OG tags in the wild.
fn meta_tag_simple(html: &str, key: &str) -> Option<String> {
    let key_l = key.to_ascii_lowercase();
    let mut i = 0;
    let bytes = html.as_bytes();
    while i + 6 < bytes.len() {
        if html[i..].starts_with("<meta") {
            let end = html[i..].find('>').map(|o| i + o + 1)?;
            let tag = &html[i..end];
            let tag_l = tag.to_ascii_lowercase();
            let mentions = tag_l.contains(&format!("property=\"{key_l}\""))
                || tag_l.contains(&format!("property='{key_l}'"))
                || tag_l.contains(&format!("name=\"{key_l}\""))
                || tag_l.contains(&format!("name='{key_l}'"));
            if mentions {
                if let Some(content) = attr_value(tag, "content") {
                    let value = decode_meta(&content);
                    if !value.is_empty() {
                        return Some(value);
                    }
                }
            }
            i = end;
        } else {
            i += 1;
        }
    }
    None
}

fn attr_value(tag: &str, name: &str) -> Option<String> {
    let name_l = name.to_ascii_lowercase();
    let tag_l = tag.to_ascii_lowercase();
    for quote in ['"', '\''] {
        let needle = format!("{name_l}={quote}");
        if let Some(start) = tag_l.find(&needle) {
            let rest = &tag[start + needle.len()..];
            let end = rest.find(quote)?;
            return Some(rest[..end].to_string());
        }
    }
    None
}

fn absolutize(base: &Url, maybe: &str) -> Option<String> {
    let trimmed = maybe.trim();
    if trimmed.is_empty() {
        return None;
    }
    if trimmed.starts_with("data:") {
        return None;
    }
    Url::parse(trimmed)
        .ok()
        .map(|u| u.to_string())
        .or_else(|| base.join(trimmed).ok().map(|u| u.to_string()))
}

#[tauri::command]
pub async fn link_preview(url: String) -> Result<LinkPreview, String> {
    let parsed = public_http_url(&url)?;
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(8))
        .redirect(reqwest::redirect::Policy::limited(4))
        .user_agent("Mali-Cowork/1.0 (link preview)")
        .build()
        .map_err(|e| e.to_string())?;
    let response = client
        .get(parsed.clone())
        .header("Accept", "text/html,application/xhtml+xml")
        .send()
        .await
        .map_err(|e| format!("Couldn't reach site: {e}"))?;
    if !response.status().is_success() {
        return Err(format!("Site returned HTTP {}", response.status()));
    }
    let bytes = response
        .bytes()
        .await
        .map_err(|e| e.to_string())?
        .to_vec();
    let truncated = if bytes.len() > MAX_HTML_BYTES {
        &bytes[..MAX_HTML_BYTES]
    } else {
        &bytes[..]
    };
    let html = String::from_utf8_lossy(truncated);
    let title = pick_meta(&html, &["og:title", "twitter:title"]).or_else(|| title_tag(&html));
    let description = pick_meta(&html, &["og:description", "twitter:description", "description"]);
    let image_raw = pick_meta(&html, &["og:image", "twitter:image", "twitter:image:src"]);
    let image = image_raw.as_deref().and_then(|raw| absolutize(&parsed, raw));
    let site_name = pick_meta(&html, &["og:site_name"]);
    Ok(LinkPreview {
        url: parsed.to_string(),
        title,
        description,
        image,
        site_name,
    })
}
