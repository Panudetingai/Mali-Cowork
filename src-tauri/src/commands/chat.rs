use serde::Deserialize;
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
