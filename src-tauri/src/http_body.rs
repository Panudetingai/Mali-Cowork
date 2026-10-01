//! Plain-language errors when an HTTP response isn't JSON (reqwest otherwise
//! says only "error decoding response body").

use serde_json::Value;

pub async fn json_value(response: reqwest::Response, context: &str) -> Result<Value, String> {
    let status = response.status();
    let bytes = response.bytes().await.map_err(|e| {
        format!(
            "Couldn't read a reply from {context} ({status}). The connection may have dropped ({e})."
        )
    })?;
    if bytes.is_empty() {
        return Err(format!(
            "{context} returned an empty reply ({status}). \
             If you use OpenCode, quit and reopen Mali; otherwise check Settings → Models (API key and base URL) and try again."
        ));
    }
    serde_json::from_slice(&bytes).map_err(|_| {
        let preview = String::from_utf8_lossy(&bytes[..bytes.len().min(280)]).trim().to_string();
        let hint = if preview.starts_with('<') {
            " That often means a wrong base URL, a proxy, or a firewall answering with a web page."
        } else {
            ""
        };
        format!(
            "{context} returned something that isn't JSON ({status}).{hint}\n\n{}",
            clip_one_line(&preview, 220)
        )
    })
}

/// Turn reqwest's opaque decode message into something the user can act on.
pub fn clarify_reqwest(raw: &str) -> Option<String> {
    if !raw.contains("error decoding response body") {
        return None;
    }
    Some(
        "The reply broke off before it finished — the connection dropped, or the server sent \
         something that isn't a reply. Send the message again; if it keeps happening, check the \
         API key and base URL in Settings → Models."
            .into(),
    )
}

fn clip_one_line(text: &str, max: usize) -> String {
    let one = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if one.chars().count() <= max {
        one
    } else {
        format!("{}…", one.chars().take(max).collect::<String>())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clarifies_reqwest_decode_wording() {
        let msg = clarify_reqwest("error decoding response body").unwrap();
        assert!(msg.contains("Settings → Models"));
        assert!(clarify_reqwest("401 Unauthorized").is_none());
    }
}
