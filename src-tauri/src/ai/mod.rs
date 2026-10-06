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
    /// How hard the model should think, as the provider spells the level
    /// (`none`, `low`, `medium`, `high`, `xhigh`…). Only sent for models that
    /// offer a choice; see `efforts` in the model list.
    #[serde(default)]
    pub effort: Option<String>,
    /// The chat's id: Stop reaches the reply through it (see `agent::abort`).
    #[serde(default)]
    pub run_id: Option<String>,
    /// The model's window. Puter's route leaves out the oldest turns past it.
    #[serde(default)]
    pub context_limit: Option<u64>,
}

pub(crate) struct ProviderInfo {
    pub base_url: &'static str,
    pub env_var: Option<&'static str>,
}

/// A provider the user added in Settings → Models: `custom-<slug>`, any
/// OpenAI-compatible server in the cloud or on this machine (LM Studio,
/// llama.cpp, vLLM…). It has no default host and no env var, so its address
/// always comes with the request.
pub(crate) fn is_custom_provider(provider: &str) -> bool {
    provider.strip_prefix("custom-").is_some_and(|slug| {
        !slug.is_empty()
            && slug.len() <= 48
            && slug.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
    })
}

pub(crate) fn provider_info(provider: &str) -> Result<ProviderInfo, String> {
    let (base_url, env_var) = match provider {
        id if is_custom_provider(id) => ("", None),
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
        // Puter's API: one auth token (puter.com/dashboard), many vendors' models. Calls go
        // to its driver route, which free accounts may use (`agent::provider::puter_step`).
        "puter" => ("https://api.puter.com", Some("PUTER_AUTH_TOKEN")),
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

/// Base URL and API key for a provider, as a chat request would use them:
/// the user's settings first, then the provider's default host and `.env`.
pub(crate) fn endpoint(provider: &str, api_key: Option<&str>, base_url: Option<&str>) -> Result<(String, String), String> {
    let info = provider_info(provider)?;
    let base_url = non_empty(base_url).unwrap_or_else(|| info.base_url.to_string());
    if base_url.is_empty() {
        return Err(format!("{provider} has no address yet. Set it in Settings → Models."));
    }
    let key = key_for(provider, api_key, &info, &base_url)?;
    Ok((base_url, key))
}

fn key_for(provider: &str, api_key: Option<&str>, info: &ProviderInfo, base_url: &str) -> Result<String, String> {
    if let Some(key) = non_empty(api_key) {
        return Ok(key);
    }
    let Some(var) = info.env_var else {
        // Local servers such as Ollama ignore the key, but the client requires one.
        return Ok(provider.to_string());
    };
    // A key from the environment only ever goes to its own provider.
    if !same_host(base_url, info.base_url) {
        return Err(format!(
            "{provider} uses a custom base URL, so the key in {var} isn't sent there. Enter the API key in Settings → Models."
        ));
    }
    non_empty(std::env::var(var).ok().as_deref()).ok_or_else(|| {
        format!("No API key for {provider}. Add it in Settings → Models, or set {var} in .env.")
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
        "moonshotai", "openrouter", "groq", "puter", "ollama-cloud", "kimi",
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
                            context_tokens: None,
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
    ($model:expr, $messages:expr, $on_event:expr, $effort:expr) => {{
        let builder = LanguageModelRequest::builder()
            .model($model)
            .system(SYSTEM_PROMPT)
            .messages($messages);
        let builder = match $effort {
            Some(effort) => builder.reasoning_effort(effort),
            None => builder,
        };
        let mut request = builder.build();

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

    if request.provider == "puter" {
        return puter_reply(request, prompt, on_event).await;
    }

    let (base_url, api_key) =
        endpoint(&request.provider, request.api_key.as_deref(), request.base_url.as_deref())?;

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

    // Only what the user picked; a model with no effort control sends none
    // and keeps the provider's own default.
    let effort = non_empty(request.effort.as_deref())
        .map(aisdk::core::language_model::ReasoningEffort::from);

    if request.provider == "anthropic" {
        let model = Anthropic::<DynamicModel>::builder()
            .model_name(model_name)
            .base_url(base_url)
            .api_key(api_key)
            .build()
            .map_err(|e| e.to_string())?;
        return stream_with_model!(model, messages, on_event, effort);
    }

    let model = OpenAICompatible::<DynamicModel>::builder()
        .provider_name(request.provider.as_str())
        .model_name(model_name)
        .base_url(base_url)
        .api_key(api_key)
        .build()
        .map_err(|e| e.to_string())?;
    stream_with_model!(model, messages, on_event, effort)
}

/// A plain chat on Puter goes through the agent's Puter route: the chat SDK
/// only speaks Puter's OpenAI endpoint, which free accounts can't use.
async fn puter_reply(request: &ChatRequest, prompt: &str, on_event: &Channel<ChatStreamEvent>) -> Result<(), String> {
    use crate::agent::wire::{Delta, Msg};
    let target = crate::agent::target_for(
        &request.provider,
        &request.model,
        request.api_key.as_deref(),
        request.base_url.as_deref(),
        non_empty(request.effort.as_deref()),
    )?;
    let mut msgs: Vec<Msg> = request
        .history
        .iter()
        .filter(|m| !m.content.trim().is_empty())
        .filter_map(|m| match m.role.as_str() {
            "user" => Some(Msg::User { text: m.content.clone(), images: Vec::new() }),
            "assistant" => Some(Msg::Assistant { text: m.content.clone(), tool_calls: Vec::new() }),
            _ => None,
        })
        .collect();
    msgs.push(Msg::User { text: prompt.to_string(), images: Vec::new() });
    let mut system = match non_empty(request.system.as_deref()) {
        Some(extra) => format!("{SYSTEM_PROMPT}\n\n{extra}"),
        None => SYSTEM_PROMPT.to_string(),
    };
    // A long chat goes on rather than running past the model's window.
    let limit = request.context_limit.filter(|l| *l > 4_000).unwrap_or(crate::agent::DEFAULT_CONTEXT);
    if crate::agent::compact::fit_history(&system, &mut msgs, limit) {
        system.push_str("\n\nThe oldest messages of this chat were left out to fit your context window.");
    }

    on_event.send(ChatStreamEvent::Started).map_err(|e| e.to_string())?;
    // Stop (the chat's id) or a closed window ends the reply — and Puter's
    // metering with it — rather than reading it to the end for no one.
    let (stoppable, mut cancel) = crate::agent::Stoppable::new(request.run_id.as_deref());
    let mut has_output = false;
    let mut on_delta = |delta: Delta| {
        has_output = true;
        let sent = on_event.send(match delta {
            Delta::Text(text) => ChatStreamEvent::Chunk { text },
            Delta::Reasoning(reasoning) => ChatStreamEvent::Reasoning { reasoning },
        });
        if sent.is_err() {
            stoppable.stop();
        }
    };
    let result = match crate::agent::reply_once(&target, &system, &msgs, &mut on_delta, &mut cancel).await {
        Ok(result) => result,
        // Stopped on purpose: what came so far stays, without an error.
        Err(e) if e == crate::agent::STOPPED => return Ok(()),
        Err(e) => return Err(e),
    };
    if !has_output {
        return Err("Model returned an empty response.".into());
    }
    let usage = result.usage;
    let _ = on_event.send(ChatStreamEvent::Metadata {
        session_id: None,
        usage: Some(AgentUsage {
            input_tokens: Some(usage.input),
            output_tokens: Some(usage.output),
            cache_read_tokens: (usage.cache_read > 0).then_some(usage.cache_read),
            cache_write_tokens: None,
            reasoning_tokens: (usage.reasoning > 0).then_some(usage.reasoning),
            total_tokens: Some(usage.input + usage.output),
            cost: None,
            context_tokens: (usage.context() > 0).then(|| usage.context()),
        }),
        duration_ms: None,
        model: None,
    });
    Ok(())
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
            let message = explain(&message, &request)
                .or_else(|| crate::http_body::clarify_reqwest(&message))
                .unwrap_or(message);
            // Report through the channel only; returning Err too would show the error twice.
            let _ = on_event.send(ChatStreamEvent::Error { message });
            Ok(())
        }
    }
}

/// A plainer version of the provider errors whose own wording sends the user
/// looking in the wrong place.
fn explain(raw: &str, request: &ChatRequest) -> Option<String> {
    let lower = raw.to_ascii_lowercase();
    // A picture model handed a conversation. Its API validates the message
    // list against a shape chat never uses — no system message, content as a
    // list of parts — and answers with field paths that name nothing the user
    // can act on ("Input should be 'user': input.messages.0.role").
    let message_shape = lower.contains("messages.0.role")
        || (lower.contains("input.messages") && lower.contains("should be a valid list"));
    if message_shape {
        return Some(format!(
            "{} doesn't hold a conversation — it looks like a picture or video model, and its              API turned the chat request down.

If it generates pictures, remove it from              Settings → Models and add it again: Mali calls picture models straight over their              own API and shows the result in the chat. If it is meant to answer in words, check              the model id.

— {} —
{}",
            request.model,
            request.provider,
            raw.lines().next().unwrap_or(raw).chars().take(300).collect::<String>(),
        ));
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn custom_providers_need_their_own_address() {
        assert!(is_custom_provider("custom-lm-studio"));
        assert!(!is_custom_provider("custom-"));
        assert!(!is_custom_provider("custom-Bad_Id"));
        assert!(!is_custom_provider("openai"));
        assert!(endpoint("custom-lm-studio", None, None).is_err(), "no default host");
        let (base, key) = endpoint("custom-lm-studio", None, Some("http://localhost:1234/v1")).unwrap();
        assert_eq!(base, "http://localhost:1234/v1");
        assert!(!key.is_empty(), "keyless local servers still get a placeholder key");
        let (_, key) = endpoint("custom-together", Some("sk-x"), Some("https://api.together.xyz/v1")).unwrap();
        assert_eq!(key, "sk-x");
    }
}
