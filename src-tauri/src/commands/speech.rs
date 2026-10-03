//! Speech through a model: what the user said into text, and a reply read
//! aloud. Every engine here runs in the cloud on a key from Settings → Models
//! (or a Puter account), so nothing is loaded into this machine's memory; the
//! offline choice — the system's own dictation and voices — runs in the
//! webview and never comes here.
//!
//! - `groq` / `openai`: the OpenAI-compatible `/audio/transcriptions` and
//!   `/audio/speech`. Groq's Whisper is free and fast; Groq has no voices.
//! - `puter`: its `speech2txt` and `txt2speech` drivers through `crate::puter`,
//!   on the free plan too; voices from OpenAI, Gemini, ElevenLabs or Polly.

use std::time::Duration;

use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::puter::{self, Service};

/// Whisper's own limit; a minute of speech is far below it.
const MAX_AUDIO_BYTES: usize = 25 * 1024 * 1024;
/// Text read aloud at once (Puter's limit; longer replies are cut by the app first).
const MAX_SPEECH_CHARS: usize = 3000;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscribeRequest {
    /// `groq`, `openai` or `puter`.
    pub engine: String,
    pub model: String,
    pub api_key: Option<String>,
    pub base_url: Option<String>,
    /// The recording, base64.
    pub audio: String,
    /// What the recorder made, e.g. `audio/mp4`.
    pub mime: String,
    /// `th`, `en`… — or none to let the model tell.
    pub language: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeakRequest {
    /// `openai` or `puter`.
    pub engine: String,
    pub model: Option<String>,
    pub voice: Option<String>,
    /// Puter: whose voices (`openai`, `gemini`, `elevenlabs`, `aws-polly`).
    pub provider: Option<String>,
    pub api_key: Option<String>,
    pub base_url: Option<String>,
    pub text: String,
    pub language: Option<String>,
    /// How to sound (OpenAI and Gemini voices), e.g. "warm and brief".
    pub instructions: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeechAudio {
    /// The audio, base64.
    pub audio: String,
    pub mime: String,
}

fn trimmed(value: Option<&str>) -> Option<&str> {
    value.map(str::trim).filter(|s| !s.is_empty())
}

fn client(timeout: u64) -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(timeout))
        .build()
        .map_err(|e| e.to_string())
}

/// A file name the API can tell the format from.
fn file_name(mime: &str) -> &'static str {
    match mime.split(';').next().unwrap_or_default().trim() {
        "audio/webm" => "speech.webm",
        "audio/ogg" => "speech.ogg",
        "audio/wav" | "audio/x-wav" => "speech.wav",
        "audio/mpeg" => "speech.mp3",
        // WebKit's MediaRecorder: AAC in MP4.
        _ => "speech.m4a",
    }
}

/// The provider's own words for a failure, short.
fn reason(engine: &str, status: reqwest::StatusCode, body: &str) -> String {
    let parsed: Option<Value> = serde_json::from_str(body).ok();
    let detail = parsed
        .as_ref()
        .and_then(|v| puter::refusal(v).or_else(|| v["error"]["message"].as_str().map(str::to_string)))
        .unwrap_or_else(|| body.chars().take(300).collect());
    let hint = match status.as_u16() {
        401 | 403 => " — check the key in Settings → Models",
        429 => " — the free limit was reached; wait a moment",
        _ => "",
    };
    format!("{engine} answered {status}{hint}: {detail}")
}

#[tauri::command]
pub async fn speech_transcribe(request: TranscribeRequest) -> Result<String, String> {
    let audio = base64::engine::general_purpose::STANDARD
        .decode(request.audio.trim())
        .map_err(|_| "The recording didn't arrive whole.".to_string())?;
    if audio.is_empty() {
        return Err("Nothing was recorded.".into());
    }
    if audio.len() > MAX_AUDIO_BYTES {
        return Err("That recording is too long. Keep it under a few minutes.".into());
    }
    let model = request.model.trim();
    let language = trimmed(request.language.as_deref());
    let text = match request.engine.as_str() {
        "puter" => {
            let token = trimmed(request.api_key.as_deref()).ok_or("Sign in to Puter in Settings → Models first.")?;
            let mut args = json!({
                "file": format!("data:{};base64,{}", request.mime, request.audio.trim()),
                "model": if model.is_empty() { "gpt-4o-mini-transcribe" } else { model },
            });
            if let Some(language) = language {
                args["language"] = json!(language);
            }
            let response = puter::call(&client(120)?, trimmed(request.base_url.as_deref()), token, Service::Transcribe, "transcribe", &args)
                .send()
                .await
                .map_err(|e| format!("Cannot reach Puter: {e}"))?;
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            if !status.is_success() {
                return Err(reason("Puter", status, &body));
            }
            let value: Value = serde_json::from_str(&body).map_err(|_| format!("Puter answered: {}", body.chars().take(200).collect::<String>()))?;
            if let Some(message) = puter::refusal(&value) {
                return Err(format!("Puter: {message}"));
            }
            let result = if value.get("result").is_some() { &value["result"] } else { &value };
            result.as_str().or(result["text"].as_str()).unwrap_or_default().to_string()
        }
        engine @ ("groq" | "openai") => {
            let (base, key) = crate::ai::endpoint(engine, request.api_key.as_deref(), request.base_url.as_deref())?;
            let part = reqwest::multipart::Part::bytes(audio)
                .file_name(file_name(&request.mime))
                .mime_str(request.mime.split(';').next().unwrap_or("audio/mp4"))
                .map_err(|e| e.to_string())?;
            let default = if engine == "groq" { "whisper-large-v3-turbo" } else { "gpt-4o-mini-transcribe" };
            let mut form = reqwest::multipart::Form::new()
                .part("file", part)
                .text("model", if model.is_empty() { default.to_string() } else { model.to_string() })
                .text("response_format", "json");
            if let Some(language) = language {
                form = form.text("language", language.to_string());
            }
            let response = client(120)?
                .post(format!("{}/audio/transcriptions", base.trim_end_matches('/')))
                .bearer_auth(key)
                .multipart(form)
                .send()
                .await
                .map_err(|e| format!("Cannot reach {engine}: {e}"))?;
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            if !status.is_success() {
                return Err(reason(engine, status, &body));
            }
            let value: Value = serde_json::from_str(&body).unwrap_or(Value::Null);
            value["text"].as_str().unwrap_or(&body).to_string()
        }
        other => return Err(format!("Mali can't transcribe with {other}.")),
    };
    Ok(text.trim().to_string())
}

#[tauri::command]
pub async fn speech_synthesize(request: SpeakRequest) -> Result<SpeechAudio, String> {
    let text: String = request.text.trim().chars().take(MAX_SPEECH_CHARS).collect();
    if text.is_empty() {
        return Err("Nothing to read aloud.".into());
    }
    let model = trimmed(request.model.as_deref());
    let voice = trimmed(request.voice.as_deref());
    let instructions = trimmed(request.instructions.as_deref());
    let (bytes, mime) = match request.engine.as_str() {
        "puter" => {
            let token = trimmed(request.api_key.as_deref()).ok_or("Sign in to Puter in Settings → Models first.")?;
            let mut args = json!({ "text": text, "provider": trimmed(request.provider.as_deref()).unwrap_or("openai") });
            for (key, value) in [("model", model), ("voice", voice), ("language", trimmed(request.language.as_deref())), ("instructions", instructions)] {
                if let Some(value) = value {
                    args[key] = json!(value);
                }
            }
            let response = puter::call(&client(90)?, trimmed(request.base_url.as_deref()), token, Service::Speak, "synthesize", &args)
                .send()
                .await
                .map_err(|e| format!("Cannot reach Puter: {e}"))?;
            read_audio("Puter", response).await?
        }
        "openai" => {
            let (base, key) = crate::ai::endpoint("openai", request.api_key.as_deref(), request.base_url.as_deref())?;
            let mut body = json!({
                "model": model.unwrap_or("gpt-4o-mini-tts"),
                "voice": voice.unwrap_or("alloy"),
                "input": text,
                "response_format": "mp3",
            });
            if let Some(instructions) = instructions {
                body["instructions"] = json!(instructions);
            }
            let response = client(90)?
                .post(format!("{}/audio/speech", base.trim_end_matches('/')))
                .bearer_auth(key)
                .json(&body)
                .send()
                .await
                .map_err(|e| format!("Cannot reach OpenAI: {e}"))?;
            read_audio("OpenAI", response).await?
        }
        other => return Err(format!("Mali can't speak with {other}.")),
    };
    Ok(SpeechAudio { audio: base64::engine::general_purpose::STANDARD.encode(bytes), mime })
}

/// The audio in a reply: the file itself, or (Puter) a link to it.
async fn read_audio(engine: &str, response: reqwest::Response) -> Result<(Vec<u8>, String), String> {
    let status = response.status();
    let mime = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or_default()
        .to_string();
    let bytes = response.bytes().await.map_err(|e| format!("{engine}: {e}"))?;
    if status.is_success() && (mime.starts_with("audio/") || mime.starts_with("application/octet-stream")) {
        let mime = if mime.starts_with("audio/") { mime } else { "audio/mpeg".into() };
        return Ok((bytes.to_vec(), mime));
    }
    let body = String::from_utf8_lossy(&bytes);
    if !status.is_success() {
        return Err(reason(engine, status, &body));
    }
    let value: Value = serde_json::from_str(&body).map_err(|_| format!("{engine} sent no audio."))?;
    if let Some(message) = puter::refusal(&value) {
        return Err(format!("{engine}: {message}"));
    }
    let result = if value.get("result").is_some() { &value["result"] } else { &value };
    let url = result
        .as_str()
        .or_else(|| ["asset_url", "url", "href"].iter().find_map(|k| result[*k].as_str()))
        .ok_or_else(|| format!("{engine} sent no audio."))?;
    if let Some(rest) = url.strip_prefix("data:") {
        let (meta, data) = rest.split_once(',').ok_or("Malformed audio data.")?;
        let bytes = base64::engine::general_purpose::STANDARD.decode(data.trim()).map_err(|e| e.to_string())?;
        return Ok((bytes, meta.split(';').next().unwrap_or("audio/mpeg").to_string()));
    }
    let response = client(60)?.get(url).send().await.map_err(|e| format!("{engine}: {e}"))?;
    // An expired or refused link answers with a page, not a voice.
    let status = response.status();
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        return Err(reason(engine, status, &body));
    }
    let mime = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .filter(|m| m.starts_with("audio/"))
        .unwrap_or("audio/mpeg")
        .to_string();
    let bytes = response.bytes().await.map_err(|e| format!("{engine}: {e}"))?;
    Ok((bytes.to_vec(), mime))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recordings_are_named_by_their_format() {
        assert_eq!(file_name("audio/mp4"), "speech.m4a");
        assert_eq!(file_name("audio/webm;codecs=opus"), "speech.webm");
        assert_eq!(file_name("audio/wav"), "speech.wav");
    }

    #[test]
    fn failures_say_what_to_do() {
        let msg = reason("groq", reqwest::StatusCode::UNAUTHORIZED, r#"{"error":{"message":"Invalid API Key"}}"#);
        assert!(msg.contains("Settings → Models") && msg.contains("Invalid API Key"), "{msg}");
        let msg = reason("Puter", reqwest::StatusCode::PAYMENT_REQUIRED, r#"{"success":false,"error":{"message":"No usage left for request."}}"#);
        assert!(msg.contains("No usage left"), "{msg}");
    }

    #[tokio::test]
    async fn nothing_recorded_is_said_plainly() {
        let request = TranscribeRequest {
            engine: "groq".into(),
            model: String::new(),
            api_key: Some("k".into()),
            base_url: None,
            audio: String::new(),
            mime: "audio/mp4".into(),
            language: None,
        };
        assert_eq!(speech_transcribe(request).await.unwrap_err(), "Nothing was recorded.");
    }
}
