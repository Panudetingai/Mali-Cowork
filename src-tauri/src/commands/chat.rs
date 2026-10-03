use serde::{Deserialize, Serialize};
use tauri::ipc::Channel;

use crate::ai::{self, ChatRequest};
use crate::chat_stream::ChatStreamEvent;

#[tauri::command]
pub async fn chat_generate(
    request: ChatRequest,
    on_event: Channel<ChatStreamEvent>,
) -> Result<(), String> {
    ai::stream_chat_response(request, on_event).await
}

/// Provider ids that already have an API key in `.env`.
#[tauri::command]
pub fn provider_env_keys() -> Vec<String> {
    ai::providers_with_env_key()
}

#[derive(Deserialize)]
struct OllamaTags {
    models: Vec<OllamaModel>,
}

#[derive(Deserialize)]
struct OllamaModel {
    name: String,
}

/// Models served by Ollama: a local server, or Ollama Cloud with an API key.
#[tauri::command]
pub async fn ollama_list_models(
    base_url: Option<String>,
    api_key: Option<String>,
) -> Result<Vec<String>, String> {
    let base = base_url
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("http://localhost:11434/v1");
    let url = reqwest::Url::parse(base).map_err(|_| format!("Invalid base URL: {base}"))?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err("Base URL must start with http:// or https://".into());
    }
    // Tags live on the native API, not under the OpenAI-compatible `/v1`.
    let root = base.trim_end_matches('/').trim_end_matches("/v1");
    let tags_url = format!("{root}/api/tags");
    let key = api_key
        .as_deref()
        .map(str::trim)
        .filter(|k| !k.is_empty())
        .map(str::to_string)
        .or_else(|| {
            // Ollama Cloud falls back to the key from `.env`.
            let cloud = url.host_str().is_some_and(|h| h == "ollama.com" || h.ends_with(".ollama.com"));
            cloud.then(|| std::env::var("OLLAMA_API_KEY").ok()).flatten()
        });

    let mut request = reqwest::Client::new()
        .get(&tags_url)
        .timeout(std::time::Duration::from_secs(10));
    if let Some(key) = key {
        request = request.bearer_auth(key);
    }
    let response = request.send().await.map_err(|e| {
        format!("Cannot reach Ollama at {root}. Is `ollama serve` running? ({e})")
    })?;
    let status = response.status();
    if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN {
        return Err(format!("Ollama rejected the API key ({status}). Check the key at ollama.com/settings/keys."));
    }
    if !status.is_success() {
        return Err(format!("Ollama returned {status} for {tags_url}"));
    }
    let tags: OllamaTags = response.json().await.map_err(|e| e.to_string())?;
    Ok(tags.models.into_iter().map(|m| m.name).collect())
}

/// What a provider said about an API key.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KeyCheck {
    /// `valid`, `rejected`, or `unknown` when the provider could not answer.
    pub status: &'static str,
    /// What the provider replied, when it rejected the key.
    pub message: Option<String>,
}

impl KeyCheck {
    fn unknown() -> Self {
        Self { status: "unknown", message: None }
    }
}

/// The short message inside an error body such as
/// `{"error":{"message":"User not found"}}`, if there is one.
fn error_message(body: &str) -> Option<String> {
    let value: serde_json::Value = serde_json::from_str(body).ok()?;
    let message = value["error"]["message"]
        .as_str()
        .or_else(|| value["error"].as_str())
        .or_else(|| value["message"].as_str())?
        .trim();
    (!message.is_empty()).then(|| message.chars().take(200).collect())
}

/// The endpoint that actually needs the key. OpenRouter serves its model list
/// to anyone — checking `/models` there would call a dead key valid — but
/// `/key`, which describes the key itself, answers 401 without a good one.
/// Puter has no `/models` on its OpenAI endpoint; its `whoami`, at the API's
/// root, answers 401 for a bad token.
fn check_url(provider: &str, base: &str) -> String {
    let base = base.trim_end_matches('/');
    match provider {
        "openrouter" => format!("{base}/key"),
        "puter" => format!("{}/whoami", crate::puter::origin(Some(base))),
        _ => format!("{base}/models"),
    }
}

/// Ask a provider whether an API key works, so a wrong key is caught while the
/// dialog is still open instead of in the middle of the next reply.
///
/// Only a clear rejection is reported as such: a provider that is unreachable,
/// rate-limited or simply does not list models answers `unknown`, and the key
/// is saved as before.
#[tauri::command]
pub async fn provider_check_key(
    provider: String,
    api_key: String,
    base_url: Option<String>,
) -> Result<KeyCheck, String> {
    let key = api_key.trim();
    if key.is_empty() {
        return Err("API key is required.".into());
    }
    // Providers this app doesn't know (opencode zen, a local server) can't be checked.
    let Ok(info) = ai::provider_info(&provider) else {
        return Ok(KeyCheck::unknown());
    };
    let base = base_url
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or(info.base_url);
    let url = check_url(&provider, base);

    let mut request = reqwest::Client::new()
        .get(&url)
        .timeout(std::time::Duration::from_secs(12));
    request = if provider == "anthropic" {
        request.header("x-api-key", key).header("anthropic-version", "2023-06-01")
    } else {
        request.bearer_auth(key)
    };

    let Ok(response) = request.send().await else {
        return Ok(KeyCheck::unknown());
    };
    let status = response.status();
    if status.is_success() {
        return Ok(KeyCheck { status: "valid", message: None });
    }
    if !matches!(status.as_u16(), 401 | 403) {
        return Ok(KeyCheck::unknown());
    }
    let body = response.text().await.unwrap_or_default();
    Ok(KeyCheck { status: "rejected", message: error_message(&body) })
}

/// How one model answered a test message.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelTest {
    pub ok: bool,
    /// The start of its reply, or why it didn't answer.
    pub message: String,
    pub duration_ms: u64,
}

/// Send a model one short message, the way a chat would, so Settings can say
/// whether the provider, key and model id really work together.
#[tauri::command]
pub async fn provider_test_model(
    provider: String,
    model: String,
    api_key: Option<String>,
    base_url: Option<String>,
) -> Result<ModelTest, String> {
    use crate::agent::wire::{Delta, Msg};
    let target = crate::agent::target_for(&provider, &model, api_key.as_deref(), base_url.as_deref(), None)?;
    let started = std::time::Instant::now();
    let msgs = [Msg::User { text: "Reply with the single word: OK".into(), images: Vec::new() }];
    let mut ignore = |_: Delta| {};
    let (_stop, mut cancel) = crate::agent::Stoppable::new(None);
    let reply = tokio::time::timeout(
        std::time::Duration::from_secs(60),
        crate::agent::reply_once(&target, "You are a connection test. Answer in one word.", &msgs, &mut ignore, &mut cancel),
    )
    .await;
    let duration_ms = started.elapsed().as_millis() as u64;
    Ok(match reply {
        Ok(Ok(result)) if !result.text.trim().is_empty() => {
            ModelTest { ok: true, message: result.text.trim().chars().take(80).collect(), duration_ms }
        }
        Ok(Ok(_)) => ModelTest { ok: false, message: "The model answered with nothing.".into(), duration_ms },
        Ok(Err(e)) => ModelTest {
            ok: false,
            message: crate::http_body::clarify_reqwest(&e).unwrap_or(e).chars().take(400).collect(),
            duration_ms,
        },
        Err(_) => ModelTest { ok: false, message: "No answer within a minute.".into(), duration_ms },
    })
}

#[cfg(test)]
mod tests {
    use super::check_url;

    #[test]
    fn checks_each_key_where_a_bad_one_is_refused() {
        assert_eq!(check_url("openai", "https://api.openai.com/v1/"), "https://api.openai.com/v1/models");
        assert_eq!(check_url("openrouter", "https://openrouter.ai/api/v1"), "https://openrouter.ai/api/v1/key");
        assert_eq!(check_url("puter", "https://api.puter.com/puterai/openai/v1"), "https://api.puter.com/whoami");
        assert_eq!(check_url("puter", "http://api.puter.localhost:4100"), "http://api.puter.localhost:4100/whoami");
    }

    /// One reply from a server on this machine: `status`, then `body` as an SSE stream or JSON.
    async fn serve_once(status: &'static str, content_type: &'static str, body: String) -> String {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            let (mut sock, _) = listener.accept().await.unwrap();
            let mut buf = [0u8; 16384];
            let mut req = Vec::new();
            while !String::from_utf8_lossy(&req).contains("\"messages\"") || !req.ends_with(b"}") {
                let n = sock.read(&mut buf).await.unwrap();
                if n == 0 {
                    break;
                }
                req.extend_from_slice(&buf[..n]);
            }
            let head = format!("HTTP/1.1 {status}\r\ncontent-type: {content_type}\r\ncontent-length: {}\r\nconnection: close\r\n\r\n", body.len());
            sock.write_all(head.as_bytes()).await.unwrap();
            sock.write_all(body.as_bytes()).await.unwrap();
            let _ = sock.shutdown().await;
        });
        format!("http://{addr}/v1")
    }

    #[tokio::test]
    async fn a_model_test_says_whether_it_answered() {
        use super::provider_test_model;
        let sse = "data: {\"choices\":[{\"delta\":{\"content\":\"OK\"}}]}\n\ndata: [DONE]\n\n".to_string();
        let base = serve_once("200 OK", "text/event-stream", sse).await;
        let test = provider_test_model("openai".into(), "gpt-test".into(), Some("sk".into()), Some(base)).await.unwrap();
        assert!(test.ok, "{}", test.message);
        assert_eq!(test.message, "OK");

        let refused = r#"{"error":{"message":"Incorrect API key provided"}}"#.to_string();
        let base = serve_once("401 Unauthorized", "application/json", refused).await;
        let test = provider_test_model("openai".into(), "gpt-test".into(), Some("bad".into()), Some(base)).await.unwrap();
        assert!(!test.ok);
        assert!(test.message.contains("Incorrect API key provided"), "{}", test.message);
    }
}
