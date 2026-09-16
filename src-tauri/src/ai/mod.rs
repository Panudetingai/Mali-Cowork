use aisdk::core::language_model::LanguageModelStream;
use aisdk::core::{DynamicModel, LanguageModelRequest, LanguageModelStreamChunkType};
use aisdk::providers::{Anthropic, Google, OpenAI, Openrouter, Groq};
use futures::StreamExt;
use tauri::ipc::Channel;

use crate::chat_stream::ChatStreamEvent;

#[derive(Debug, Clone)]
struct ModelSpec {
    provider: &'static str,
    api_model: &'static str,
}

fn resolve_model(model_id: &str) -> Result<ModelSpec, String> {
    match model_id {
        "claude-sonnet-4" => Ok(ModelSpec {
            provider: "anthropic",
            api_model: "claude-sonnet-4-20250514",
        }),
        "claude-opus-4" => Ok(ModelSpec {
            provider: "anthropic",
            api_model: "claude-opus-4-20250514",
        }),
        "gpt-4o" => Ok(ModelSpec {
            provider: "openai",
            api_model: "gpt-4o",
        }),
        "o3-mini" => Ok(ModelSpec {
            provider: "openai",
            api_model: "o3-mini",
        }),
        "gemini-2-flash" => Ok(ModelSpec {
            provider: "google",
            api_model: "gemini-2.0-flash",
        }),
        "gemini-2-pro" => Ok(ModelSpec {
            provider: "google",
            api_model: "gemini-2.0-pro",
        }),
        "z-ai/glm-5.2:free" => Ok(ModelSpec {
            provider: "openrouter",
            api_model: "z-ai/glm-5.2:free",
        }),
        "groq" => Ok(ModelSpec {
            provider: "groq",
            api_model: "openai/gpt-oss-120b",
        }),
        other => Err(format!("Unknown model id: {other}")),
    }
}

fn missing_key_message(provider: &str) -> String {
    match provider {
        "anthropic" => {
            "Set ANTHROPIC_API_KEY in .env (project root) and restart `bun tauri dev`.".into()
        }
        "openai" => "Set OPENAI_API_KEY in .env (project root) and restart `bun tauri dev`.".into(),
        "google" => "Set GOOGLE_API_KEY in .env (project root) and restart `bun tauri dev`.".into(),
        "openrouter" => {
            "Set OPENROUTER_API_KEY in .env (project root) and restart `bun tauri dev`.".into()
        }
        "groq" => "Set GROQ_API_KEY in .env (project root) and restart `bun tauri dev`.".into(),
        _ => "Missing API key for the selected provider.".into(),
    }
}

fn get_api_key(var: &str) -> Result<String, String> {
    let raw = std::env::var(var).map_err(|_| {
        missing_key_message(match var {
            "ANTHROPIC_API_KEY" => "anthropic",
            "OPENAI_API_KEY" => "openai",
            "GOOGLE_API_KEY" => "google",
            "OPENROUTER_API_KEY" => "openrouter",
            "GROQ_API_KEY" => "groq",
            _ => "",
        })
    })?;
    let trimmed = raw
        .trim()
        .trim_matches('"')
        .trim_matches('\'')
        .trim()
        .to_string();
    if trimmed.is_empty() {
        return Err(missing_key_message(match var {
            "ANTHROPIC_API_KEY" => "anthropic",
            "OPENAI_API_KEY" => "openai",
            "GOOGLE_API_KEY" => "google",
            "OPENROUTER_API_KEY" => "openrouter",
            "GROQ_API_KEY" => "groq",
            _ => "",
        }));
    }
    if trimmed != raw {
        unsafe { std::env::set_var(var, &trimmed) };
    }
    Ok(trimmed)
}

async fn consume_stream(
    mut stream: LanguageModelStream,
    on_event: &Channel<ChatStreamEvent>,
) -> Result<(), String> {
    on_event
        .send(ChatStreamEvent::Started)
        .map_err(|e| e.to_string())?;

    let mut has_text = false;

    while let Some(chunk) = stream.next().await {
        match chunk {
            LanguageModelStreamChunkType::Text(text) => {
                if !text.is_empty() {
                    has_text = true;
                    on_event
                        .send(ChatStreamEvent::Chunk { text })
                        .map_err(|e| e.to_string())?;
                }
            }
            LanguageModelStreamChunkType::Failed(message) => {
                return Err(message);
            }
            LanguageModelStreamChunkType::Incomplete(message) => {
                return Err(message);
            }
            LanguageModelStreamChunkType::NotSupported(message) => {
                return Err(message);
            }
            LanguageModelStreamChunkType::End(_) => break,
            LanguageModelStreamChunkType::Start
            | LanguageModelStreamChunkType::Reasoning(_)
            | LanguageModelStreamChunkType::ToolCall(_) => {}
        }
    }

    if !has_text {
        return Err("Model returned an empty response.".into());
    }

    Ok(())
}

macro_rules! stream_with_model {
    ($model:expr, $prompt:expr, $on_event:expr) => {{
        let mut request = LanguageModelRequest::builder()
            .model($model)
            .system("You are Mali Cowork, a concise and helpful assistant.")
            .prompt($prompt)
            .build();

        let response = request
            .stream_text()
            .await
            .map_err(|e| e.to_string())?;

        consume_stream(response.stream, $on_event).await
    }};
}

pub async fn stream_chat_response(
    prompt: &str,
    model_id: &str,
    on_event: Channel<ChatStreamEvent>,
) -> Result<(), String> {
    let spec = resolve_model(model_id)?;
    let prompt = prompt.trim();
    if prompt.is_empty() {
        return Err("Prompt cannot be empty.".into());
    }

    let result = match spec.provider {
        "anthropic" => {
            get_api_key("ANTHROPIC_API_KEY")?;
            let model = Anthropic::<DynamicModel>::builder()
                .model_name(spec.api_model)
                .build()
                .map_err(|e| e.to_string())?;
            stream_with_model!(model, prompt, &on_event)
        }
        "openai" => {
            get_api_key("OPENAI_API_KEY")?;
            let model = OpenAI::<DynamicModel>::builder()
                .model_name(spec.api_model)
                .build()
                .map_err(|e| e.to_string())?;
            stream_with_model!(model, prompt, &on_event)
        }
        "google" => {
            get_api_key("GOOGLE_API_KEY")?;
            let model = Google::<DynamicModel>::builder()
                .model_name(spec.api_model)
                .build()
                .map_err(|e| e.to_string())?;
            stream_with_model!(model, prompt, &on_event)
        }
        "openrouter" => {
            get_api_key("OPENROUTER_API_KEY")?;
            let model = Openrouter::<DynamicModel>::builder()
                .model_name(spec.api_model)
                .build()
                .map_err(|e| e.to_string())?;
            stream_with_model!(model, prompt, &on_event)
        }
        "groq" => {
            get_api_key("GROQ_API_KEY")?;
            let model = Groq::<DynamicModel>::builder()
                .model_name(spec.api_model)
                .build()
                .map_err(|e| e.to_string())?;
            stream_with_model!(model, prompt, &on_event)
        }
        other => Err(format!("Unsupported provider: {other}")),
    };

    match result {
        Ok(()) => {
            on_event
                .send(ChatStreamEvent::Done {
                    model_id: model_id.to_string(),
                })
                .map_err(|e| e.to_string())?;
            Ok(())
        }
        Err(message) => {
            // ส่ง error ผ่าน channel อย่างเดียวพอ — อย่า return Err อีก
            // ไม่งั้น frontend จะโดนทั้ง onError (channel) + catch (invoke throw) = ขึ้นซ้ำ 2 อันแบบในภาพ
            let _ = on_event.send(ChatStreamEvent::Error {
                message: message.clone(),
            });
            Ok(())
        }
    }
}
