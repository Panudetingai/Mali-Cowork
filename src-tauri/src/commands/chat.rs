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

/// Models installed in the local Ollama server.
#[tauri::command]
pub async fn ollama_list_models(base_url: Option<String>) -> Result<Vec<String>, String> {
    let base = base_url
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("http://localhost:11434/v1");
    // Tags live on the native API, not under the OpenAI-compatible `/v1`.
    let root = base.trim_end_matches('/').trim_end_matches("/v1");
    let url = format!("{root}/api/tags");

    let response = reqwest::Client::new()
        .get(&url)
        .timeout(std::time::Duration::from_secs(5))
        .send()
        .await
        .map_err(|e| format!("Cannot reach Ollama at {root}. Is `ollama serve` running? ({e})"))?;
    if !response.status().is_success() {
        return Err(format!("Ollama returned {} for {url}", response.status()));
    }
    let tags: OllamaTags = response.json().await.map_err(|e| e.to_string())?;
    Ok(tags.models.into_iter().map(|m| m.name).collect())
}
