//! Providers the app sets up for OpenCode, so Cowork (the CLI agent) and
//! MCP tools can use the same models and keys as Chat: every provider from
//! Settings → Models, plus a local Ollama server and Ollama Cloud.
//!
//! The provider config is layered over the user's own opencode config when the
//! server starts (see `server::app_config`) and saved without secrets. API keys
//! go to opencode's own auth store instead.

use std::collections::{HashMap, HashSet};
use std::hash::{DefaultHasher, Hash, Hasher};
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};

use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};

use super::server::{ensure_server, restart};
use crate::ai::provider_info;
use crate::commands::secure_fs::write_private;

/// Provider ids this module may configure. All but `ollama` are built into
/// opencode (models.dev), so only the user's extra models are added for them.
pub const APP_PROVIDERS: &[&str] = &[
    "anthropic", "openai", "google", "xai", "deepseek", "mistral", "alibaba", "zai",
    "moonshotai", "openrouter", "groq", "ollama", "ollama-cloud",
];

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

/// Settings may point a built-in provider at another host (a proxy, a
/// regional endpoint); pass that on, but not the app's own default.
fn custom_base_url(id: &str, raw: Option<&str>) -> Result<Option<String>, String> {
    let Some(raw) = raw.map(str::trim).filter(|s| !s.is_empty()) else {
        return Ok(None);
    };
    let default = provider_info(id)?.base_url;
    // The app talks to Gemini through its OpenAI-compatible endpoint, which
    // opencode's Gemini SDK cannot use.
    if id == "google" || raw.trim_end_matches('/') == default.trim_end_matches('/') {
        return Ok(None);
    }
    base_url(Some(raw), default).map(Some)
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
            "ollama" => json!({
                "npm": "@ai-sdk/openai-compatible",
                "name": "Ollama (local)",
                // Ollama ignores the key, but the SDK wants one.
                "options": { "baseURL": base_url(provider.base_url.as_deref(), OLLAMA_LOCAL_URL)?, "apiKey": "ollama" },
                "models": models,
            }),
            "ollama-cloud" => {
                let url = base_url(provider.base_url.as_deref(), OLLAMA_CLOUD_URL)?;
                // The key from the environment only goes to Ollama's own host.
                let official = reqwest::Url::parse(&url)
                    .ok()
                    .and_then(|u| u.host_str().map(|h| h == "ollama.com" || h.ends_with(".ollama.com")))
                    .unwrap_or(false);
                let mut options = json!({ "baseURL": url });
                if !has_key && official && std::env::var_os("OLLAMA_API_KEY").is_some() {
                    options["apiKey"] = json!("{env:OLLAMA_API_KEY}");
                }
                json!({
                    "npm": "@ai-sdk/openai-compatible",
                    "name": "Ollama Cloud",
                    "options": options,
                    "models": models,
                })
            }
            // Built into opencode: keep its SDK, add the models it may not list yet.
            id if APP_PROVIDERS.contains(&id) => {
                let mut config = json!({ "models": models });
                if let Some(url) = custom_base_url(id, provider.base_url.as_deref())? {
                    config["options"] = json!({ "baseURL": url });
                }
                config
            }
            other => return Err(format!("Provider {other} cannot be configured for OpenCode")),
        };
        overlay.insert(provider.id.clone(), config);
    }
    Ok(overlay)
}

/// Fingerprints of the keys already handed to the running server, so a key
/// the user changed restarts it. Keys themselves are never kept in memory.
fn applied_keys() -> &'static Mutex<Option<HashMap<String, u64>>> {
    static APPLIED: OnceLock<Mutex<Option<HashMap<String, u64>>>> = OnceLock::new();
    APPLIED.get_or_init(Default::default)
}

fn fingerprint(key: &str) -> u64 {
    let mut hasher = DefaultHasher::new();
    key.hash(&mut hasher);
    hasher.finish()
}

/// Record the keys of this sync and report whether any of them changed.
///
/// The first sync after launch only records: the server about to run reads
/// opencode's auth store when it builds a provider, so nothing is stale yet.
fn note_keys(keys: &[(&str, &str)]) -> bool {
    let fingerprints: HashMap<String, u64> =
        keys.iter().map(|(id, key)| ((*id).to_string(), fingerprint(key))).collect();
    let mut guard = applied_keys().lock().unwrap();
    match guard.as_mut() {
        None => {
            *guard = Some(fingerprints);
            false
        }
        Some(previous) => {
            let changed = fingerprints.iter().any(|(id, fp)| previous.get(id) != Some(fp));
            previous.extend(fingerprints);
            changed
        }
    }
}

/// Point OpenCode at the providers configured in Settings → Models.
#[tauri::command]
pub async fn opencode_configure_providers(
    providers: Vec<CliProviderConfig>,
) -> Result<ConfigureProvidersResult, String> {
    let overlay = build_overlay(&providers)?;
    let config_changed = overlay != load_overlay();
    if config_changed {
        let pretty = serde_json::to_string_pretty(&Value::Object(overlay)).map_err(|e| e.to_string())?;
        write_private(&overlay_path(), &pretty)?;
    }

    let keys: Vec<(&str, &str)> = providers
        .iter()
        .filter_map(|p| Some((p.id.as_str(), p.api_key.as_deref()?.trim())))
        .filter(|(_, key)| !key.is_empty())
        .collect();
    let key_changed = note_keys(&keys);
    // Store the keys first: opencode writes them to its auth file, which the
    // next server reads at startup.
    if !keys.is_empty() {
        let client = ensure_server().await?;
        for (id, key) in keys {
            client.set_api_key(id, key).await?;
        }
    }
    // Provider config is only read at startup, and a provider keeps the
    // credentials it was built with, so both need a fresh server.
    let restarted = config_changed || key_changed;
    if restarted {
        restart().await;
    }
    Ok(ConfigureProvidersResult { restarted })
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
    fn builtin_providers_get_models_and_only_custom_hosts() {
        let mut openai = provider("openai", &["gpt-4o"]);
        openai.base_url = Some("https://api.openai.com/v1/".into());
        let mut google = provider("google", &["gemini-2.5-flash"]);
        google.base_url = Some("https://example.com/v1".into());
        let mut groq = provider("groq", &["openai/gpt-oss-120b"]);
        groq.base_url = Some("https://proxy.example.com/groq".into());
        let overlay = build_overlay(&[openai, google, groq]).unwrap();
        assert!(overlay["openai"]["models"]["gpt-4o"].is_object());
        assert!(overlay["openai"].get("options").is_none(), "default host is not repeated");
        assert!(overlay["google"].get("options").is_none(), "Gemini keeps its native endpoint");
        assert_eq!(overlay["groq"]["options"]["baseURL"], "https://proxy.example.com/groq");
        assert!(overlay["groq"].get("npm").is_none(), "built-ins keep their own SDK");
    }

    #[test]
    fn rejects_unknown_providers_and_bad_input() {
        assert!(build_overlay(&[provider("unknown", &["x"])]).is_err());
        assert!(build_overlay(&[provider("ollama", &["bad model"])]).is_err());
        let mut bad_url = provider("ollama", &["m"]);
        bad_url.base_url = Some("file:///etc".into());
        assert!(build_overlay(&[bad_url]).is_err());
    }
}
