//! Making a picture or a clip: pick a model that draws, describe what you
//! want, and that is the whole feature.
//!
//! A model whose job is drawing (`gemini-3-pro-image-preview`, `gpt-image-1`,
//! `qwen-image-3.0`, `veo-3.1-generate-preview`) has nothing to say and no
//! tools to call, so there is no agent in the way: the prompt goes straight
//! to the provider's own API with the key already in Settings → Models. One
//! request, one key, in the one place keys live.
//!
//! The reply is a ```media block, which the chat renders as the picture
//! itself (see `chat-blocks/parse.ts`).

use std::time::{Duration, Instant};

use serde::Deserialize;
use tauri::ipc::Channel;

use crate::chat_stream::ChatStreamEvent;
use crate::media::output::{resolve_dir, save_all};
use crate::media::providers::{self, Job, Kind, Provider};

/// Longest a single picture or clip may take before it is given up on.
const IMAGE_TIMEOUT: u64 = 180;
const VIDEO_TIMEOUT: u64 = 900;
/// Most pictures one request may ask for. Every provider here takes at least
/// this many, and the count control is capped to it.
pub const MAX_COUNT: u8 = 4;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaRequest {
    pub prompt: String,
    /// Provider id as Settings → Models knows it (`google`, `openai`, …).
    pub provider: String,
    pub model: String,
    /// `image` or `video`.
    pub kind: String,
    /// From Settings → Models; falls back to the provider's environment
    /// variable, the same way a chat request does.
    pub api_key: Option<String>,
    pub base_url: Option<String>,
    /// Where to save. Cowork passes its working folder; Chat leaves it unset
    /// and the app's own media folder is used.
    pub output_dir: Option<String>,
    #[serde(default)]
    pub count: Option<u8>,
    pub aspect_ratio: Option<String>,
    /// Video only: how long the clip should be.
    pub duration_seconds: Option<u32>,
    /// Video only: `1080P`, `720P`, `480P`.
    pub resolution: Option<String>,
}

fn trimmed(value: Option<&str>) -> Option<&str> {
    value.map(str::trim).filter(|v| !v.is_empty())
}

/// Can this model only draw? Used by the front end to route the prompt here,
/// and repeated in Rust so a hand-edited request cannot send a chat model
/// down a path that would charge for an image it cannot make.
pub fn kind_of(kind: &str) -> Option<Kind> {
    match kind.trim().to_ascii_lowercase().as_str() {
        "image" => Some(Kind::Image),
        "video" => Some(Kind::Video),
        _ => None,
    }
}

#[tauri::command]
pub async fn media_generate(
    request: MediaRequest,
    on_event: Channel<ChatStreamEvent>,
) -> Result<(), String> {
    match run(&request, &on_event).await {
        Ok(()) => Ok(()),
        Err(message) => {
            let _ = on_event.send(ChatStreamEvent::Error { message });
            Ok(())
        }
    }
}

async fn run(request: &MediaRequest, on_event: &Channel<ChatStreamEvent>) -> Result<(), String> {
    let prompt = request.prompt.trim();
    if prompt.is_empty() {
        return Err("Prompt cannot be empty.".into());
    }
    let kind = kind_of(&request.kind)
        .ok_or_else(|| format!("Unknown media kind: {}", request.kind))?;
    let provider = Provider::parse(&request.provider).ok_or_else(|| {
        format!(
            "Mali can't make {}s through {} yet. The providers that can are: {}.",
            kind_noun(kind),
            request.provider,
            Provider::ALL.iter().map(|p| p.id()).collect::<Vec<_>>().join(", ")
        )
    })?;
    let model = request.model.trim();
    if model.is_empty() {
        return Err("No model selected.".into());
    }
    let key = trimmed(request.api_key.as_deref())
        .map(str::to_string)
        .or_else(|| provider.key())
        .ok_or_else(|| {
            format!(
                "No API key for {}. Add it in Settings → Models.",
                provider.label()
            )
        })?;
    let directory = resolve_dir(trimmed(request.output_dir.as_deref()))?;

    on_event
        .send(ChatStreamEvent::Started)
        .map_err(|e| e.to_string())?;
    // A picture takes seconds and a clip takes minutes with nothing streaming
    // in between, so say what is happening rather than showing a still cursor.
    let _ = on_event.send(ChatStreamEvent::Activity {
        id: Some("media-generate".into()),
        kind: "system".into(),
        title: format!("Making {} with {model}…", a_noun(kind)),
        detail: Some(prompt.chars().take(300).collect()),
        done: false,
        duration_ms: None,
    });

    let timeout = if kind == Kind::Image { IMAGE_TIMEOUT } else { VIDEO_TIMEOUT };
    let job = Job {
        kind,
        prompt,
        model: Some(model),
        aspect_ratio: trimmed(request.aspect_ratio.as_deref()),
        count: request.count.unwrap_or(1).clamp(1, MAX_COUNT),
        // Only ever sent for video: an image model handed a duration answers
        // with a validation error rather than ignoring it.
        duration_seconds: (kind == Kind::Video)
            .then(|| request.duration_seconds.map(|s| s.clamp(1, 60)))
            .flatten(),
        resolution: (kind == Kind::Video)
            .then(|| trimmed(request.resolution.as_deref()))
            .flatten(),
        deadline: Instant::now() + Duration::from_secs(timeout),
        base_url: trimmed(request.base_url.as_deref()),
    };

    let started = Instant::now();
    let output = providers::generate_with(provider, &key, &job).await?;
    let paths = save_all(&directory, prompt, &output.files)?;

    let _ = on_event.send(ChatStreamEvent::Activity {
        id: Some("media-generate".into()),
        kind: "system".into(),
        title: format!(
            "Made {} {} with {}",
            paths.len(),
            if paths.len() == 1 { kind_noun(kind).to_string() } else { format!("{}s", kind_noun(kind)) },
            output.model
        ),
        detail: Some(paths.iter().map(|p| p.display().to_string()).collect::<Vec<_>>().join("\n")),
        done: true,
        duration_ms: Some(started.elapsed().as_millis() as u64),
    });

    let blocks: String = paths
        .iter()
        .map(|path| {
            let body = serde_json::json!({
                "kind": kind_noun(kind),
                "path": path.to_string_lossy(),
                "title": prompt.chars().take(120).collect::<String>(),
            });
            format!("```media\n{body}\n```")
        })
        .collect::<Vec<_>>()
        .join("\n\n");
    on_event
        .send(ChatStreamEvent::Chunk { text: blocks })
        .map_err(|e| e.to_string())?;

    on_event
        .send(ChatStreamEvent::Done {
            model_id: format!("{}/{}", request.provider, model),
        })
        .map_err(|e| e.to_string())
}

fn kind_noun(kind: Kind) -> &'static str {
    match kind {
        Kind::Image => "image",
        Kind::Video => "video",
    }
}

fn a_noun(kind: Kind) -> &'static str {
    match kind {
        Kind::Image => "a picture",
        Kind::Video => "a video",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(provider: &str, kind: &str) -> MediaRequest {
        MediaRequest {
            prompt: "a cat".into(),
            provider: provider.into(),
            model: "some-model".into(),
            kind: kind.into(),
            api_key: Some("k".into()),
            base_url: None,
            output_dir: None,
            count: None,
            aspect_ratio: None,
            duration_seconds: None,
            resolution: None,
        }
    }

    fn fails_with(request: &MediaRequest) -> String {
        let channel = Channel::new(|_| Ok(()));
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap()
            .block_on(run(request, &channel))
            .expect_err("should not reach the provider")
    }

    #[test]
    fn only_the_two_media_kinds_are_accepted() {
        assert_eq!(kind_of("image"), Some(Kind::Image));
        assert_eq!(kind_of(" VIDEO "), Some(Kind::Video));
        assert_eq!(kind_of("text"), None);
        assert!(fails_with(&request("google", "text")).contains("Unknown media kind"));
    }

    #[test]
    fn a_provider_with_no_picture_api_names_the_ones_that_have() {
        let message = fails_with(&request("moonshotai", "image"));
        assert!(message.contains("google"), "{message}");
        assert!(message.contains("alibaba"), "{message}");
    }

    /// A provider with no video call says so, and says who has one — it does
    /// not claim the provider is incapable.
    #[test]
    fn video_from_a_provider_with_no_video_call_points_somewhere_that_has_one() {
        let message = fails_with(&request("openai", "video"));
        assert!(message.contains("Google"), "{message}");
        assert!(message.contains("Alibaba"), "{message}");
    }

    #[test]
    fn an_empty_prompt_never_reaches_the_provider() {
        let mut empty = request("google", "image");
        empty.prompt = "   ".into();
        assert!(fails_with(&empty).contains("Prompt cannot be empty"));
    }
}
