use aisdk::core::language_model::LanguageModelStream;
use aisdk::core::{DynamicModel, LanguageModelRequest, LanguageModelStreamChunkType, Message};
use aisdk::providers::{Anthropic, OpenAICompatible};
use futures::StreamExt;
use serde::Deserialize;
use tauri::ipc::Channel;

use crate::chat_stream::{AgentUsage, ChatStreamEvent};

const SYSTEM_PROMPT: &str = "You are Mali Cowork, a concise and helpful assistant.";

/// One earlier turn of the conversation, sent so the model keeps context.
#[derive(Debug, Deserialize)]
pub struct HistoryMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatRequest {
    pub prompt: String,
    /// Provider id from the settings page, e.g. "openai", "ollama".
    pub provider: String,
    pub model: String,
    /// Falls back to the provider's env var when empty.
    pub api_key: Option<String>,
    /// Falls back to the provider's default host when empty.
    pub base_url: Option<String>,
    #[serde(default)]
    pub history: Vec<HistoryMessage>,
    /// The user's custom instructions and enabled skills.
    #[serde(default)]
    pub system: Option<String>,
}

pub(crate) struct ProviderInfo {
    pub base_url: &'static str,
    pub env_var: Option<&'static str>,
}

pub(crate) fn provider_info(provider: &str) -> Result<ProviderInfo, String> {
    let (base_url, env_var) = match provider {
        "anthropic" => ("https://api.anthropic.com/v1/", Some("ANTHROPIC_API_KEY")),
        "openai" => ("https://api.openai.com/v1", Some("OPENAI_API_KEY")),
        "google" => (
            "https://generativelanguage.googleapis.com/v1beta/openai/",
            Some("GOOGLE_API_KEY"),
        ),
        "xai" => ("https://api.x.ai/v1", Some("XAI_API_KEY")),
        "deepseek" => ("https://api.deepseek.com/v1", Some("DEEPSEEK_API_KEY")),
        "mistral" => ("https://api.mistral.ai/v1", Some("MISTRAL_API_KEY")),
        "alibaba" => (
            "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
            Some("DASHSCOPE_API_KEY"),
        ),
        "zai" => ("https://api.z.ai/api/paas/v4", Some("ZAI_API_KEY")),
        "moonshotai" => ("https://api.moonshot.ai/v1", Some("MOONSHOT_API_KEY")),
        "openrouter" => ("https://openrouter.ai/api/v1", Some("OPENROUTER_API_KEY")),
        "groq" => ("https://api.groq.com/openai/v1", Some("GROQ_API_KEY")),
        "ollama" => ("http://localhost:11434/v1", None),
        "ollama-cloud" => ("https://ollama.com/v1", Some("OLLAMA_API_KEY")),
        _ => return Err(format!("Unknown provider: {provider}")),
    };
    Ok(ProviderInfo { base_url, env_var })
}

fn clean(value: &str) -> String {
    value
        .trim()
        .trim_matches('"')
        .trim_matches('\'')
        .trim()
        .to_string()
}

fn non_empty(value: Option<&str>) -> Option<String> {
    value.map(clean).filter(|v| !v.is_empty())
}

fn resolve_api_key(request: &ChatRequest, info: &ProviderInfo, base_url: &str) -> Result<String, String> {
    if let Some(key) = non_empty(request.api_key.as_deref()) {
        return Ok(key);
    }
    let Some(var) = info.env_var else {
        // Local servers such as Ollama ignore the key, but the client requires one.
        return Ok(request.provider.clone());
    };
    // A key from the environment only ever goes to its own provider.
    if !same_host(base_url, info.base_url) {
        return Err(format!(
            "{} uses a custom base URL, so the key in {var} isn't sent there. Enter the API key in Settings → Models.",
            request.provider
        ));
    }
    non_empty(std::env::var(var).ok().as_deref()).ok_or_else(|| {
        format!("No API key for {}. Add it in Settings → Models, or set {var} in .env.", request.provider)
    })
}

fn same_host(url: &str, default: &str) -> bool {
    let host = |u: &str| {
        reqwest::Url::parse(u)
            .ok()
            .map(|u| (u.scheme().to_string(), u.host_str().map(str::to_ascii_lowercase), u.port_or_known_default()))
    };
    host(url).is_some() && host(url) == host(default)
}

/// Provider ids whose API key is already set in the environment.
pub fn providers_with_env_key() -> Vec<String> {
    [
        "anthropic", "openai", "google", "xai", "deepseek", "mistral", "alibaba", "zai",
        "moonshotai", "openrouter", "groq", "ollama-cloud", "kimi",
    ]
    .into_iter()
    .filter(|id| {
        provider_info(id)
            .ok()
            .and_then(|info| info.env_var)
            .and_then(|var| non_empty(std::env::var(var).ok().as_deref()))
            .is_some()
    })
    .map(String::from)
    .collect()
}

async fn consume_stream(
    mut stream: LanguageModelStream,
    on_event: &Channel<ChatStreamEvent>,
) -> Result<(), String> {
    on_event
        .send(ChatStreamEvent::Started)
        .map_err(|e| e.to_string())?;

    let mut has_output = false;

    while let Some(chunk) = stream.next().await {
        match chunk {
            LanguageModelStreamChunkType::Text(text) => {
                if !text.is_empty() {
                    has_output = true;
                    on_event
                        .send(ChatStreamEvent::Chunk { text })
                        .map_err(|e| e.to_string())?;
                }
            }
            LanguageModelStreamChunkType::Reasoning(reasoning) => {
                if !reasoning.is_empty() {
                    has_output = true;
                    on_event
                        .send(ChatStreamEvent::Reasoning { reasoning })
                        .map_err(|e| e.to_string())?;
                }
            }
            LanguageModelStreamChunkType::Failed(message)
            | LanguageModelStreamChunkType::Incomplete(message)
            | LanguageModelStreamChunkType::NotSupported(message) => {
                return Err(message);
            }
            LanguageModelStreamChunkType::End(message) => {
                if let Some(usage) = message.usage {
                    let input = usage.input_tokens.map(|n| n as u64);
                    let output = usage.output_tokens.map(|n| n as u64);
                    let _ = on_event.send(ChatStreamEvent::Metadata {
                        session_id: None,
                        usage: Some(AgentUsage {
                            input_tokens: input,
                            output_tokens: output,
                            cache_read_tokens: usage.cached_tokens.map(|n| n as u64),
                            cache_write_tokens: None,
                            reasoning_tokens: usage.reasoning_tokens.map(|n| n as u64),
                            total_tokens: input.zip(output).map(|(i, o)| i + o),
                            cost: None,
                        }),
                        duration_ms: None,
                        model: None,
                    });
                }
                break;
            }
            LanguageModelStreamChunkType::Start
            | LanguageModelStreamChunkType::ToolCall(_) => {}
        }
    }

    if !has_output {
        return Err("Model returned an empty response.".into());
    }

    Ok(())
}

macro_rules! stream_with_model {
    ($model:expr, $messages:expr, $on_event:expr) => {{
        let mut request = LanguageModelRequest::builder()
            .model($model)
            .system(SYSTEM_PROMPT)
            .messages($messages)
            .build();

        let response = request
            .stream_text()
            .await
            .map_err(|e| e.to_string())?;

        consume_stream(response.stream, $on_event).await
    }};
}

async fn run(request: &ChatRequest, on_event: &Channel<ChatStreamEvent>) -> Result<(), String> {
    let prompt = request.prompt.trim();
    if prompt.is_empty() {
        return Err("Prompt cannot be empty.".into());
    }
    let model_name = request.model.trim();
    if model_name.is_empty() {
        return Err("No model selected. Set one in Settings → Models.".into());
    }

    let info = provider_info(&request.provider)?;
    let base_url =
        non_empty(request.base_url.as_deref()).unwrap_or_else(|| info.base_url.to_string());
    let api_key = resolve_api_key(request, &info, &base_url)?;

    let mut conversation = Message::conversation_builder();
    for message in &request.history {
        if message.content.trim().is_empty() {
            continue;
        }
        conversation = match message.role.as_str() {
            "user" => conversation.user(message.content.as_str()),
            "assistant" => conversation.assistant(message.content.as_str()),
            _ => conversation,
        };
    }
    let mut messages = conversation.user(prompt).build();
    if let Some(system) = non_empty(request.system.as_deref()) {
        messages.insert(0, Message::System(system.into()));
    }

    if request.provider == "anthropic" {
        let model = Anthropic::<DynamicModel>::builder()
            .model_name(model_name)
            .base_url(base_url)
            .api_key(api_key)
            .build()
            .map_err(|e| e.to_string())?;
        return stream_with_model!(model, messages, on_event);
    }

    let model = OpenAICompatible::<DynamicModel>::builder()
        .provider_name(request.provider.as_str())
        .model_name(model_name)
        .base_url(base_url)
        .api_key(api_key)
        .build()
        .map_err(|e| e.to_string())?;
    stream_with_model!(model, messages, on_event)
}

pub async fn stream_chat_response(
    request: ChatRequest,
    on_event: Channel<ChatStreamEvent>,
) -> Result<(), String> {
    match run(&request, &on_event).await {
        Ok(()) => on_event
            .send(ChatStreamEvent::Done {
                model_id: format!("{}/{}", request.provider, request.model),
            })
            .map_err(|e| e.to_string()),
        Err(message) => {
            // Report through the channel only; returning Err too would show the error twice.
            let _ = on_event.send(ChatStreamEvent::Error { message });
            Ok(())
        }
    }
}
