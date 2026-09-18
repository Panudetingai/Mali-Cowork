//! Providers the app sets up for OpenCode, so Cowork (the CLI agent) can use
//! the same models as Chat: OpenRouter models missing from models.dev, a
//! local Ollama server and Ollama Cloud.
//!
//! The provider config is layered over the user's own opencode config when the
//! server starts (see `server::app_config`) and saved without secrets. API keys
//! go to opencode's own auth store instead.

use std::collections::HashSet;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};

use super::server::{ensure_server, restart};
use crate::commands::secure_fs::write_private;

/// Provider ids this module may configure.
pub const APP_PROVIDERS: &[&str] = &["openrouter", "ollama", "ollama-cloud"];

const OLLAMA_LOCAL_URL: &str = "http://localhost:11434/v1";
const OLLAMA_CLOUD_URL: &str = "https://ollama.com/v1";
const MAX_MODELS: usize = 200;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CliProviderConfig {
    pub id: String,
    #[serde(default)]
    pub base_url: Option<String>,
    #[serde(default)]
    pub models: Vec<String>,
    /// Stored in opencode's auth file, never in the provider config.
    #[serde(default)]
    pub api_key: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigureProvidersResult {
    /// The server was restarted to load the new provider config.
    pub restarted: bool,
}

fn overlay_path() -> PathBuf {
    dirs::data_local_dir()
        .unwrap_or_else(std::env::temp_dir)
        .join("mali-cowork")
        .join("opencode-providers.json")
}

/// The saved `provider` block, or an empty object.
pub fn load_overlay() -> Map<String, Value> {
    std::fs::read_to_string(overlay_path())
        .ok()
        .and_then(|raw| serde_json::from_str::<Value>(&raw).ok())
        .and_then(|v| v.as_object().cloned())
        .unwrap_or_default()
}

/// `provider/model` ids the overlay adds, so the model list keeps them even
/// without models.dev metadata.
pub fn overlay_model_ids() -> HashSet<String> {
    load_overlay()
        .iter()
        .flat_map(|(provider, config)| {
            config["models"]
                .as_object()
                .into_iter()
                .flatten()
                .map(move |(model, _)| format!("{provider}/{model}"))
        })
        .collect()
}

fn valid_model(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 200
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "._:/@+-".contains(c))
}

fn base_url(raw: Option<&str>, default: &str) -> Result<String, String> {
    let raw = raw.map(str::trim).filter(|s| !s.is_empty()).unwrap_or(default);
    let url = reqwest::Url::parse(raw).map_err(|_| format!("Invalid base URL: {raw}"))?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err(format!("Base URL must use http or https: {raw}"));
    }
    Ok(raw.trim_end_matches('/').to_string())
}

fn models_map(models: &[String]) -> Result<Map<String, Value>, String> {
    let mut out = Map::new();
    for model in models.iter().map(|m| m.trim()).filter(|m| !m.is_empty()).take(MAX_MODELS) {
        if !valid_model(model) {
            return Err(format!("Invalid model id: {model}"));
        }
        out.insert(model.to_string(), json!({ "name": model }));
    }
    Ok(out)
}

fn build_overlay(providers: &[CliProviderConfig]) -> Result<Map<String, Value>, String> {
    let mut overlay = Map::new();
    for provider in providers {
        let models = models_map(&provider.models)?;
        if models.is_empty() {
            continue;
        }
        let has_key = provider.api_key.as_deref().is_some_and(|k| !k.trim().is_empty());
        let config = match provider.id.as_str() {
            // Built into opencode; only add models it does not list yet.
            "openrouter" => json!({ "models": models }),
            "ollama" => json!({
                "npm": "@ai-sdk/openai-compatible",
                "name": "Ollama (local)",
                // Ollama ignores the key, but the SDK wants one.
                "options": { "baseURL": base_url(provider.base_url.as_deref(), OLLAMA_LOCAL_URL)?, "apiKey": "ollama" },
                "models": models,
            }),
            "ollama-cloud" => {
                let mut options = json!({ "baseURL": base_url(provider.base_url.as_deref(), OLLAMA_CLOUD_URL)? });
                if !has_key && std::env::var_os("OLLAMA_API_KEY").is_some() {
                    options["apiKey"] = json!("{env:OLLAMA_API_KEY}");
                }
                json!({
                    "npm": "@ai-sdk/openai-compatible",
                    "name": "Ollama Cloud",
                    "options": options,
                    "models": models,
                })
            }
            other => return Err(format!("Provider {other} cannot be configured for OpenCode")),
        };
        overlay.insert(provider.id.clone(), config);
    }
    Ok(overlay)
}

/// Point OpenCode at the providers configured in Settings → Models.
#[tauri::command]
pub async fn opencode_configure_providers(
    providers: Vec<CliProviderConfig>,
) -> Result<ConfigureProvidersResult, String> {
    let overlay = build_overlay(&providers)?;
    let changed = overlay != load_overlay();
    if changed {
        let pretty = serde_json::to_string_pretty(&Value::Object(overlay)).map_err(|e| e.to_string())?;
        write_private(&overlay_path(), &pretty)?;
        // Provider config is only read at startup.
        restart().await;
    }

    let keys: Vec<(&str, &str)> = providers
        .iter()
        .filter_map(|p| Some((p.id.as_str(), p.api_key.as_deref()?.trim())))
        .filter(|(_, key)| !key.is_empty())
        .collect();
    if !keys.is_empty() {
        let client = ensure_server().await?;
        for (id, key) in keys {
            client.set_api_key(id, key).await?;
        }
    }
    Ok(ConfigureProvidersResult { restarted: changed })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn provider(id: &str, models: &[&str]) -> CliProviderConfig {
        CliProviderConfig {
            id: id.into(),
            base_url: None,
            models: models.iter().map(|m| m.to_string()).collect(),
            api_key: None,
        }
    }

    #[test]
    fn builds_ollama_and_openrouter_entries() {
        let overlay = build_overlay(&[
            provider("ollama", &["llama3.2", "qwen3:8b"]),
            provider("openrouter", &["z-ai/glm-5.2:free"]),
            provider("ollama-cloud", &[]),
        ])
        .unwrap();
        assert_eq!(overlay["ollama"]["options"]["baseURL"], OLLAMA_LOCAL_URL);
        assert!(overlay["ollama"]["models"]["qwen3:8b"].is_object());
        assert!(overlay["openrouter"]["models"]["z-ai/glm-5.2:free"].is_object());
        assert!(!overlay.contains_key("ollama-cloud"), "no models, no entry");
    }

    #[test]
    fn rejects_unknown_providers_and_bad_input() {
        assert!(build_overlay(&[provider("anthropic", &["x"])]).is_err());
        assert!(build_overlay(&[provider("ollama", &["bad model"])]).is_err());
        let mut bad_url = provider("ollama", &["m"]);
        bad_url.base_url = Some("file:///etc".into());
        assert!(build_overlay(&[bad_url]).is_err());
    }
}
