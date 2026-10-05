//! Speech through a model: what the user said into text, and a reply read
//! aloud. Every engine here runs in the cloud on a key from Settings → Models
//! or Settings → Voice (or a Puter account), so nothing is loaded into this
//! machine's memory; the offline choice — the system's own dictation and
//! voices — runs in the webview and never comes here.
//!
//! - `groq` / `openai`: the OpenAI-compatible `/audio/transcriptions` and
//!   `/audio/speech`. Groq's Whisper is free and fast; Groq has no voices.
//! - `puter`: its `speech2txt` and `txt2speech` drivers through `crate::puter`,
//!   on the free plan too; voices from OpenAI, Gemini, ElevenLabs or Polly.
//! - `elevenlabs`: Scribe for listening, its own voices for speaking, on the
//!   user's ElevenLabs key (`xi-api-key`).
//! - `fishaudio`: Fish Audio's ASR and TTS on the user's key; a voice is a
//!   model id (`reference_id`) from its library or the user's own clones.

use std::time::Duration;

use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::puter::{self, Service};

/// Whisper's own limit; a minute of speech is far below it.
const MAX_AUDIO_BYTES: usize = 25 * 1024 * 1024;
/// Text read aloud at once (Puter's limit; longer replies are cut by the app first).
const MAX_SPEECH_CHARS: usize = 3000;

const ELEVENLABS: &str = "https://api.elevenlabs.io";
const FISH_AUDIO: &str = "https://api.fish.audio";
/// ElevenLabs' "Rachel": every account has it.
const ELEVENLABS_VOICE: &str = "21m00Tcm4TlvDq8ikWAM";
/// Speaks Thai as well as English; Flash and Multilingual v2 don't.
const ELEVENLABS_MODEL: &str = "eleven_v3";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscribeRequest {
    /// `groq`, `openai`, `puter`, `elevenlabs` or `fishaudio`.
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
    /// `openai`, `puter`, `elevenlabs` or `fishaudio`.
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
        .and_then(|v| {
            puter::refusal(v)
                .or_else(|| v["error"]["message"].as_str().map(str::to_string))
                // ElevenLabs: `{"detail":{"message":…}}`; Fish Audio: `{"message":…}`.
                .or_else(|| v["detail"]["message"].as_str().map(str::to_string))
                .or_else(|| v["detail"].as_str().map(str::to_string))
                .or_else(|| v["message"].as_str().map(str::to_string))
        })
        .unwrap_or_else(|| body.chars().take(300).collect());
    let hint = match status.as_u16() {
        401 | 403 => " — check the key in Settings",
        402 => " — the account is out of credits",
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
            let part = audio_part(audio, &request.mime)?;
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
        "elevenlabs" => {
            let key = trimmed(request.api_key.as_deref()).ok_or("Add your ElevenLabs key in Settings → Voice first.")?;
            let mut form = reqwest::multipart::Form::new()
                .part("file", audio_part(audio, &request.mime)?)
                .text("model_id", if model.is_empty() { "scribe_v2".to_string() } else { model.to_string() })
                .text("tag_audio_events", "false");
            if let Some(language) = language {
                form = form.text("language_code", language.to_string());
            }
            let response = client(120)?
                .post(format!("{ELEVENLABS}/v1/speech-to-text"))
                .header("xi-api-key", key)
                .multipart(form)
                .send()
                .await
                .map_err(|e| format!("Cannot reach ElevenLabs: {e}"))?;
            read_text("ElevenLabs", response).await?
        }
        "fishaudio" => {
            let key = trimmed(request.api_key.as_deref()).ok_or("Add your Fish Audio key in Settings → Voice first.")?;
            let mut form = reqwest::multipart::Form::new()
                .part("audio", audio_part(audio, &request.mime)?)
                .text("ignore_timestamps", "true");
            if let Some(language) = language {
                form = form.text("language", language.to_string());
            }
            let response = client(120)?
                .post(format!("{FISH_AUDIO}/v1/asr"))
                .bearer_auth(key)
                .header("model", if model.is_empty() { "transcribe-1-pro" } else { model })
                .multipart(form)
                .send()
                .await
                .map_err(|e| format!("Cannot reach Fish Audio: {e}"))?;
            fish_transcript(&read_text("Fish Audio", response).await?)
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
        "elevenlabs" => {
            let key = trimmed(request.api_key.as_deref()).ok_or("Add your ElevenLabs key in Settings → Voice first.")?;
            let response = client(90)?
                .post(format!(
                    "{ELEVENLABS}/v1/text-to-speech/{}?output_format=mp3_44100_128",
                    voice.unwrap_or(ELEVENLABS_VOICE)
                ))
                .header("xi-api-key", key)
                .json(&json!({ "text": text, "model_id": model.unwrap_or(ELEVENLABS_MODEL) }))
                .send()
                .await
                .map_err(|e| format!("Cannot reach ElevenLabs: {e}"))?;
            read_audio("ElevenLabs", response).await?
        }
        "fishaudio" => {
            let key = trimmed(request.api_key.as_deref()).ok_or("Add your Fish Audio key in Settings → Voice first.")?;
            let mut body = json!({ "text": text, "format": "mp3", "latency": "balanced" });
            if let Some(voice) = voice {
                body["reference_id"] = json!(voice);
            }
            let mut call = client(90)?.post(format!("{FISH_AUDIO}/v1/tts")).bearer_auth(key).json(&body);
            if let Some(model) = model {
                call = call.header("model", model);
            }
            let response = call.send().await.map_err(|e| format!("Cannot reach Fish Audio: {e}"))?;
            read_audio("Fish Audio", response).await?
        }
        other => return Err(format!("Mali can't speak with {other}.")),
    };
    Ok(SpeechAudio { audio: base64::engine::general_purpose::STANDARD.encode(bytes), mime })
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VoicesRequest {
    /// `elevenlabs` or `fishaudio`.
    pub engine: String,
    pub api_key: Option<String>,
    /// `th`, `en`… — Fish Audio's library is filtered by it.
    pub language: Option<String>,
    /// Words to look for in the voices' names, searched by the service itself.
    pub query: Option<String>,
}

#[derive(Debug, Serialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct VoiceOption {
    pub id: String,
    pub name: String,
    /// The user's own voice (a clone) rather than one from the library.
    pub mine: bool,
    /// A short sample of the voice, to hear before picking it.
    pub preview: Option<String>,
    /// What it sounds like at a glance: gender, accent, age, language.
    pub tags: Vec<String>,
    pub description: Option<String>,
}

/// The speech models a key can use, straight from the service: ElevenLabs'
/// own TTS models and Scribe, or an OpenAI-compatible `/v1/models` page
/// narrowed to TTS / transcription. The app falls back to its built-in list
/// when the service can't be reached.
#[tauri::command]
pub async fn speech_models(request: ModelsRequest) -> Result<Vec<SpeechModel>, String> {
    let kind = request.kind.as_str();
    if kind != "tts" && kind != "stt" {
        return Err("kind is `tts` or `stt`.".into());
    }
    let client = client(30)?;
    match request.engine.as_str() {
        "elevenlabs" => {
            let key = trimmed(request.api_key.as_deref()).ok_or("Add your ElevenLabs key in Settings → Voice first.")?;
            let response = client
                .get(format!("{ELEVENLABS}/v1/models"))
                .header("xi-api-key", key)
                .send()
                .await
                .map_err(|e| format!("Cannot reach ElevenLabs: {e}"))?;
            let value = read_json("ElevenLabs", response).await?;
            let models = elevenlabs_models(&value, kind);
            if models.is_empty() {
                return Err("ElevenLabs listed no speech models.".into());
            }
            Ok(models)
        }
        engine @ ("groq" | "openai") => {
            let (base, key) = crate::ai::endpoint(engine, request.api_key.as_deref(), request.base_url.as_deref())?;
            let response = client
                .get(format!("{}/models", base.trim_end_matches('/')))
                .bearer_auth(key)
                .send()
                .await
                .map_err(|e| format!("Cannot reach {engine}: {e}"))?;
            let value = read_json(engine, response).await?;
            let models = openai_models(&value, engine, kind);
            if models.is_empty() {
                return Err(format!("{engine} listed no speech models."));
            }
            Ok(models)
        }
        other => Err(format!("{other} lists no speech models: pick from the built-in list.")),
    }
}

/// ElevenLabs `/v1/models`: TTS models speak (`eleven_v3` speaks Thai),
/// Scribe turns speech into text.
fn elevenlabs_models(value: &Value, kind: &str) -> Vec<SpeechModel> {
    let items: &[Value] = value
        .as_array()
        .map(Vec::as_slice)
        .or_else(|| value["models"].as_array().map(Vec::as_slice))
        .unwrap_or(&[]);
    let mut models: Vec<SpeechModel> = items
        .iter()
        .filter_map(|v| {
            let id = v["model_id"].as_str().or_else(|| v["id"].as_str())?.trim().to_string();
            if id.is_empty() {
                return None;
            }
            let scribe = id.contains("scribe");
            if kind == "tts" && (scribe || v["can_do_text_to_speech"].as_bool() == Some(false)) {
                return None;
            }
            if kind == "stt" && !scribe {
                return None;
            }
            let languages: Vec<String> = v["languages"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|l| {
                    if let Some(s) = l.as_str() {
                        return Some(s.to_string());
                    }
                    l["language_id"]
                        .as_str()
                        .or_else(|| l["language"].as_str())
                        .or_else(|| l["name"].as_str())
                        .map(str::to_string)
                })
                .collect();
            let name = v["name"].as_str().map(str::trim).filter(|s| !s.is_empty()).unwrap_or(&id).to_string();
            let description = text(v["description"].as_str());
            let thai = speaks_thai(&languages, &name, description.as_deref());
            Some(SpeechModel { id, name, description, languages, thai })
        })
        .collect();
    // Thai voices first — people ask in Thai — then by name.
    models.sort_by(|a, b| b.thai.cmp(&a.thai).then(a.name.cmp(&b.name)));
    models
}

fn speaks_thai(languages: &[String], name: &str, description: Option<&str>) -> bool {
    languages.iter().any(|l| {
        let l = l.to_lowercase();
        l == "th" || l == "tha" || l == "thai" || l.starts_with("th-") || l.starts_with("th_")
    }) || name.to_lowercase().contains("thai")
        || description.is_some_and(|d| d.to_lowercase().contains("thai"))
}

/// An OpenAI-compatible `/v1/models` page narrowed to speech: TTS speaks,
/// transcription listens. OpenAI's speech models and Whisper are
/// multilingual, Thai included.
fn openai_models(value: &Value, engine: &str, kind: &str) -> Vec<SpeechModel> {
    let items: &[Value] = value["data"]
        .as_array()
        .map(Vec::as_slice)
        .or_else(|| value.as_array().map(Vec::as_slice))
        .unwrap_or(&[]);
    let mut models: Vec<SpeechModel> = items
        .iter()
        .filter_map(|v| {
            let id = v["id"].as_str()?.trim().to_string();
            if id.is_empty() {
                return None;
            }
            let lower = id.to_lowercase();
            let wanted = if kind == "tts" {
                lower.contains("tts") || lower.contains("speech")
            } else {
                lower.contains("transcribe") || lower.contains("transcription") || lower.contains("whisper") || lower.contains("scribe")
            };
            if !wanted {
                return None;
            }
            Some(SpeechModel { name: id.clone(), id, description: None, languages: vec![], thai: true })
        })
        .collect();
    // Known-good first, then alphabetically.
    let preferred: &[&str] = match (engine, kind) {
        (_, "tts") => &["gpt-4o-mini-tts", "gpt-4o-tts", "tts-1-hd", "tts-1"],
        ("groq", _) => &["whisper-large-v3-turbo", "whisper-large-v3"],
        _ => &["gpt-4o-mini-transcribe", "gpt-4o-transcribe", "whisper-1"],
    };
    let rank = |id: &str| preferred.iter().position(|p| *p == id).unwrap_or(preferred.len());
    models.sort_by(|a, b| rank(&a.id).cmp(&rank(&b.id)).then_with(|| a.id.cmp(&b.id)));
    models.dedup_by(|a, b| a.id == b.id);
    models
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelsRequest {
    /// `groq`, `openai` or `elevenlabs` (the rest keep a built-in list).
    pub engine: String,
    /// `tts` (a voice reads replies) or `stt` (speech into text).
    pub kind: String,
    pub api_key: Option<String>,
    pub base_url: Option<String>,
}

#[derive(Debug, Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SpeechModel {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    /// Language ids the service lists, e.g. `["en", "th"]`.
    pub languages: Vec<String>,
    /// Listed (or known) to handle Thai.
    pub thai: bool,
}

/// Voices the user can pick for a key: their own first, then the library's.
#[tauri::command]
pub async fn speech_voices(request: VoicesRequest) -> Result<Vec<VoiceOption>, String> {    let key = trimmed(request.api_key.as_deref()).ok_or("Add the key first.")?;
    let client = client(30)?;
    match request.engine.as_str() {
        "elevenlabs" => {
            let mut call = client
                .get(format!("{ELEVENLABS}/v2/voices"))
                .query(&[("page_size", "100"), ("sort", "name"), ("sort_direction", "asc")]);
            if let Some(query) = trimmed(request.query.as_deref()) {
                call = call.query(&[("search", query)]);
            }
            let response = call
                .header("xi-api-key", key)
                .send()
                .await
                .map_err(|e| format!("Cannot reach ElevenLabs: {e}"))?;
            let value = read_json("ElevenLabs", response).await?;
            Ok(elevenlabs_voices(&value))
        }
        "fishaudio" => {
            let mut voices = Vec::new();
            let language = trimmed(request.language.as_deref());
            for mine in [true, false] {
                let mut call = client
                    .get(format!("{FISH_AUDIO}/model"))
                    .bearer_auth(key)
                    .query(&[("page_size", "40"), ("sort_by", "task_count"), ("self", if mine { "true" } else { "false" })]);
                if let (false, Some(language)) = (mine, language) {
                    call = call.query(&[("language", language)]);
                }
                if let Some(query) = trimmed(request.query.as_deref()) {
                    call = call.query(&[("title", query)]);
                }
                let response = call.send().await.map_err(|e| format!("Cannot reach Fish Audio: {e}"))?;
                let value = read_json("Fish Audio", response).await?;
                for voice in fish_voices(&value, mine) {
                    if !voices.iter().any(|v: &VoiceOption| v.id == voice.id) {
                        voices.push(voice);
                    }
                }
            }
            Ok(voices)
        }
        other => Err(format!("{other} has no voice list.")),
    }
}

fn elevenlabs_voices(value: &Value) -> Vec<VoiceOption> {
    let mut voices: Vec<VoiceOption> = value["voices"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|v| {
            let mine = matches!(v["category"].as_str(), Some("cloned" | "generated" | "professional"));
            let labels = &v["labels"];
            let mut tags: Vec<String> = ["gender", "accent", "age", "descriptive", "use_case"]
                .iter()
                .filter_map(|k| labels[*k].as_str())
                .map(|t| t.replace('_', " "))
                .filter(|t| !t.is_empty())
                .collect();
            tags.truncate(4);
            Some(VoiceOption {
                id: v["voice_id"].as_str()?.to_string(),
                name: v["name"].as_str()?.to_string(),
                mine,
                preview: web_url(v["preview_url"].as_str()),
                tags,
                description: text(v["description"].as_str()).or_else(|| text(labels["description"].as_str())),
            })
        })
        .collect();
    voices.sort_by_key(|v| !v.mine);
    voices
}

fn fish_voices(value: &Value, mine: bool) -> Vec<VoiceOption> {
    value["items"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|v| v["type"].as_str().is_none_or(|t| t == "tts"))
        .filter(|v| v["state"].as_str().is_none_or(|s| s == "trained"))
        .filter_map(|v| {
            let mut tags: Vec<String> = v["languages"]
                .as_array()
                .into_iter()
                .flatten()
                .chain(v["tags"].as_array().into_iter().flatten())
                .filter_map(|t| t.as_str().map(str::to_string))
                .filter(|t| !t.is_empty())
                .collect();
            tags.dedup();
            tags.truncate(4);
            let preview = v["samples"].as_array().into_iter().flatten().find_map(|s| web_url(s["audio"].as_str()));
            Some(VoiceOption {
                id: v["_id"].as_str()?.to_string(),
                name: v["title"].as_str()?.to_string(),
                mine,
                preview,
                tags,
                description: text(v["description"].as_str()),
            })
        })
        .collect()
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct LibraryRequest {
    /// `elevenlabs` or `fishaudio`.
    pub engine: String,
    pub api_key: Option<String>,
    pub query: Option<String>,
    /// `th`, `en`… — none for every language.
    pub language: Option<String>,
    /// ElevenLabs: `standard`, `american`…
    pub accent: Option<String>,
    /// ElevenLabs: `conversational`, `narrative_story`…
    pub use_case: Option<String>,
    /// `trending`, `usage` (most used this year) or `newest`.
    pub sort: Option<String>,
    /// From 0.
    pub page: u32,
}

/// A voice in a service's public library.
#[derive(Debug, Serialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct LibraryVoice {
    pub id: String,
    /// ElevenLabs: whose voice it is, needed to add it to an account.
    pub owner_id: Option<String>,
    pub name: String,
    pub description: Option<String>,
    pub preview: Option<String>,
    pub language: Option<String>,
    pub accent: Option<String>,
    pub gender: Option<String>,
    pub use_case: Option<String>,
    /// How many people added (ElevenLabs) or used (Fish Audio) it.
    pub users: Option<u64>,
    /// ElevenLabs: days the owner promises to keep it available.
    pub notice_days: Option<u64>,
}

#[derive(Debug, Serialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct LibraryPage {
    pub voices: Vec<LibraryVoice>,
    pub has_more: bool,
}

const LIBRARY_PAGE: u32 = 30;

/// One page of a service's public voice library, filtered there.
#[tauri::command]
pub async fn speech_voice_library(request: LibraryRequest) -> Result<LibraryPage, String> {
    let key = trimmed(request.api_key.as_deref()).ok_or("Add the key first.")?;
    let client = client(30)?;
    let query = trimmed(request.query.as_deref());
    let language = trimmed(request.language.as_deref());
    let sort = trimmed(request.sort.as_deref()).unwrap_or("trending");
    let size = LIBRARY_PAGE.to_string();
    let page = request.page.to_string();
    match request.engine.as_str() {
        "elevenlabs" => {
            let mut call = client
                .get(format!("{ELEVENLABS}/v1/shared-voices"))
                .header("xi-api-key", key)
                .query(&[("page_size", size.as_str()), ("page", page.as_str())])
                .query(&[(
                    "sort",
                    match sort {
                        "usage" => "usage_character_count_1y",
                        "newest" => "created_date",
                        _ => "trending",
                    },
                )]);
            for (name, value) in [
                ("search", query),
                ("language", language),
                ("accent", trimmed(request.accent.as_deref())),
                ("use_cases", trimmed(request.use_case.as_deref())),
            ] {
                if let Some(value) = value {
                    call = call.query(&[(name, value)]);
                }
            }
            let response = call.send().await.map_err(|e| format!("Cannot reach ElevenLabs: {e}"))?;
            let value = read_json("ElevenLabs", response).await?;
            Ok(LibraryPage {
                voices: elevenlabs_library(&value, language),
                has_more: value["has_more"].as_bool().unwrap_or(false),
            })
        }
        "fishaudio" => {
            let number = (request.page + 1).to_string();
            let mut call = client
                .get(format!("{FISH_AUDIO}/model"))
                .bearer_auth(key)
                .query(&[("page_size", size.as_str()), ("page_number", number.as_str())])
                .query(&[(
                    "sort_by",
                    match sort {
                        "usage" => "task_count",
                        "newest" => "created_at",
                        _ => "score",
                    },
                )]);
            for (name, value) in [("title", query), ("language", language), ("tag", trimmed(request.use_case.as_deref()))] {
                if let Some(value) = value {
                    call = call.query(&[(name, value)]);
                }
            }
            let response = call.send().await.map_err(|e| format!("Cannot reach Fish Audio: {e}"))?;
            let value = read_json("Fish Audio", response).await?;
            let total = value["total"].as_u64().unwrap_or(0);
            Ok(LibraryPage {
                voices: fish_library(&value),
                has_more: u64::from(request.page + 1) * u64::from(LIBRARY_PAGE) < total,
            })
        }
        other => Err(format!("{other} has no voice library.")),
    }
}

fn elevenlabs_library(value: &Value, language: Option<&str>) -> Vec<LibraryVoice> {
    value["voices"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|v| {
            // A voice checked in the language asked for has a sample in it: hear that one.
            let verified = v["verified_languages"]
                .as_array()
                .into_iter()
                .flatten()
                .find(|l| language.is_some_and(|lang| l["language"].as_str() == Some(lang)));
            let label = |k: &str| text(v[k].as_str()).map(|t| t.replace('_', " "));
            Some(LibraryVoice {
                id: v["voice_id"].as_str()?.to_string(),
                owner_id: text(v["public_owner_id"].as_str()),
                name: v["name"].as_str()?.trim().to_string(),
                description: text(v["description"].as_str()),
                preview: verified.and_then(|l| web_url(l["preview_url"].as_str())).or_else(|| web_url(v["preview_url"].as_str())),
                language: verified.and_then(|l| text(l["language"].as_str())).or_else(|| label("language")),
                accent: verified.and_then(|l| text(l["accent"].as_str())).or_else(|| label("accent")),
                gender: label("gender"),
                use_case: label("use_case"),
                users: v["cloned_by_count"].as_u64(),
                notice_days: v["notice_period"].as_u64(),
            })
        })
        .collect()
}

fn fish_library(value: &Value) -> Vec<LibraryVoice> {
    value["items"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|v| v["type"].as_str().is_none_or(|t| t == "tts"))
        .filter(|v| v["state"].as_str().is_none_or(|s| s == "trained"))
        .filter_map(|v| {
            let first = |k: &str| v[k].as_array().and_then(|a| a.iter().find_map(|t| text(t.as_str())));
            Some(LibraryVoice {
                id: v["_id"].as_str()?.to_string(),
                name: v["title"].as_str()?.trim().to_string(),
                description: text(v["description"].as_str()),
                preview: v["samples"].as_array().into_iter().flatten().find_map(|s| web_url(s["audio"].as_str())),
                language: first("languages"),
                use_case: first("tags"),
                users: v["task_count"].as_u64(),
                ..Default::default()
            })
        })
        .collect()
}

/// Put a library voice in the ElevenLabs account, so it can speak; the id to
/// speak with comes back. One already there is simply used.
#[tauri::command]
pub async fn speech_voice_add(api_key: Option<String>, owner_id: String, voice_id: String, name: String) -> Result<String, String> {
    let key = trimmed(api_key.as_deref()).ok_or("Add your ElevenLabs key first.")?;
    let response = client(30)?
        .post(format!("{ELEVENLABS}/v1/voices/add/{}/{}", owner_id.trim(), voice_id.trim()))
        .header("xi-api-key", key)
        .json(&json!({ "new_name": name.trim() }))
        .send()
        .await
        .map_err(|e| format!("Cannot reach ElevenLabs: {e}"))?;
    let status = response.status();
    let body = response.text().await.unwrap_or_default();
    if !status.is_success() {
        if body.contains("already") {
            return Ok(voice_id);
        }
        return Err(reason("ElevenLabs", status, &body));
    }
    let value: Value = serde_json::from_str(&body).unwrap_or(Value::Null);
    Ok(value["voice_id"].as_str().map(str::to_string).unwrap_or(voice_id))
}

fn text(value: Option<&str>) -> Option<String> {
    trimmed(value).map(|s| s.chars().take(160).collect())
}

/// Only a full https link can be fetched for a preview.
fn web_url(value: Option<&str>) -> Option<String> {
    trimmed(value).filter(|u| u.starts_with("https://")).map(str::to_string)
}

/// A voice's sample, fetched here because the page may only play its own
/// audio: an https link to a short clip (a few MB at most).
#[tauri::command]
pub async fn speech_preview(url: String) -> Result<SpeechAudio, String> {
    const MAX_PREVIEW_BYTES: usize = 8 * 1024 * 1024;
    let url = web_url(Some(&url)).ok_or("Previews come from https links only.")?;
    let response = client(30)?.get(&url).send().await.map_err(|e| format!("Cannot fetch the preview: {e}"))?;
    let status = response.status();
    if !status.is_success() {
        return Err(format!("The preview answered {status}."));
    }
    let mime = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or_default()
        .to_string();
    if !(mime.starts_with("audio/") || mime.starts_with("application/octet-stream") || mime.starts_with("binary/")) {
        return Err("That link isn't a sound.".into());
    }
    let bytes = response.bytes().await.map_err(|e| e.to_string())?;
    if bytes.len() > MAX_PREVIEW_BYTES {
        return Err("That preview is too long.".into());
    }
    let mime = if mime.starts_with("audio/") { mime } else { "audio/mpeg".into() };
    Ok(SpeechAudio { audio: base64::engine::general_purpose::STANDARD.encode(bytes), mime })
}

/// Fish Audio marks speakers (`<|speaker:0|>`) and sounds (`[laughs]`) in the
/// transcript; a prompt wants only the words.
fn fish_transcript(text: &str) -> String {
    static MARKS: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    let marks = MARKS.get_or_init(|| regex::Regex::new(r"<\|[^|>]*\|>|\[[a-z][a-z _-]*\]").unwrap());
    marks.replace_all(text, " ").split_whitespace().collect::<Vec<_>>().join(" ")
}

fn audio_part(audio: Vec<u8>, mime: &str) -> Result<reqwest::multipart::Part, String> {
    reqwest::multipart::Part::bytes(audio)
        .file_name(file_name(mime))
        .mime_str(mime.split(';').next().unwrap_or("audio/mp4"))
        .map_err(|e| e.to_string())
}

async fn read_json(engine: &str, response: reqwest::Response) -> Result<Value, String> {
    let status = response.status();
    let body = response.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(reason(engine, status, &body));
    }
    serde_json::from_str(&body).map_err(|_| format!("{engine} answered: {}", body.chars().take(200).collect::<String>()))
}

/// The `text` of a transcription reply.
async fn read_text(engine: &str, response: reqwest::Response) -> Result<String, String> {
    let value = read_json(engine, response).await?;
    Ok(value["text"].as_str().unwrap_or_default().to_string())
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
    fn speech_models_come_from_the_service() {
        let value = json!([
            { "model_id": "scribe_v2", "name": "Scribe v2", "can_do_text_to_speech": false },
            { "model_id": "eleven_flash_v2_5", "name": "Flash v2.5", "can_do_text_to_speech": true,
              "languages": [{ "language_id": "en", "name": "English" }] },
            { "model_id": "eleven_v3", "name": "Eleven v3", "can_do_text_to_speech": true,
              "languages": ["en", "th"], "description": "Speaks Thai well" },
        ]);
        let tts = elevenlabs_models(&value, "tts");
        let ids: Vec<&str> = tts.iter().map(|m| m.id.as_str()).collect();
        // Scribe doesn't speak; the Thai voice comes first.
        assert_eq!(ids, ["eleven_v3", "eleven_flash_v2_5"]);
        assert!(tts[0].thai && !tts[1].thai);
        let stt = elevenlabs_models(&value, "stt");
        assert_eq!(stt.iter().map(|m| m.id.as_str()).collect::<Vec<_>>(), ["scribe_v2"]);

        let value = json!({ "data": [
            { "id": "gpt-4o" },
            { "id": "gpt-4o-mini-tts" },
            { "id": "tts-1" },
            { "id": "whisper-1" },
            { "id": "gpt-4o-mini-transcribe" },
        ] });
        let tts = openai_models(&value, "openai", "tts");
        assert_eq!(
            tts.iter().map(|m| m.id.as_str()).collect::<Vec<_>>(),
            ["gpt-4o-mini-tts", "tts-1"]
        );
        assert!(tts.iter().all(|m| m.thai));
        let stt = openai_models(&value, "openai", "stt");
        assert_eq!(
            stt.iter().map(|m| m.id.as_str()).collect::<Vec<_>>(),
            ["gpt-4o-mini-transcribe", "whisper-1"]
        );
    }

    #[test]
    fn recordings_are_named_by_their_format() {
        assert_eq!(file_name("audio/mp4"), "speech.m4a");
        assert_eq!(file_name("audio/webm;codecs=opus"), "speech.webm");
        assert_eq!(file_name("audio/wav"), "speech.wav");
    }

    #[test]
    fn failures_say_what_to_do() {
        let msg = reason("groq", reqwest::StatusCode::UNAUTHORIZED, r#"{"error":{"message":"Invalid API Key"}}"#);
        assert!(msg.contains("check the key") && msg.contains("Invalid API Key"), "{msg}");
        let msg = reason("Puter", reqwest::StatusCode::PAYMENT_REQUIRED, r#"{"success":false,"error":{"message":"No usage left for request."}}"#);
        assert!(msg.contains("No usage left"), "{msg}");
    }

    #[test]
    fn fish_transcripts_lose_their_speaker_and_sound_marks() {
        assert_eq!(fish_transcript("<|speaker:0|>สวัสดี [laughs] ครับ  [Mali]"), "สวัสดี ครับ [Mali]");
    }

    #[test]
    fn own_voices_come_first() {
        let value = json!({ "voices": [
            { "voice_id": "a", "name": "Rachel", "category": "premade" },
            { "voice_id": "b", "name": "Me", "category": "cloned" },
            { "name": "no id" },
        ] });
        let ids: Vec<String> = elevenlabs_voices(&value).into_iter().map(|v| v.id).collect();
        assert_eq!(ids, ["b", "a"]);
        let fish = json!({ "items": [
            { "_id": "x", "title": "Narrator", "type": "tts", "state": "trained" },
            { "_id": "y", "title": "Still training", "type": "tts", "state": "training" },
        ] });
        assert_eq!(
            fish_voices(&fish, false),
            [VoiceOption { id: "x".into(), name: "Narrator".into(), ..Default::default() }]
        );
    }

    #[test]
    fn voices_say_what_they_sound_like() {
        let value = json!({ "voices": [{
            "voice_id": "a", "name": "Rachel", "category": "premade",
            "preview_url": "https://storage.example/rachel.mp3",
            "labels": { "gender": "female", "accent": "american", "use_case": "narration" },
        }] });
        let rachel = &elevenlabs_voices(&value)[0];
        assert_eq!(rachel.tags, ["female", "american", "narration"]);
        assert_eq!(rachel.preview.as_deref(), Some("https://storage.example/rachel.mp3"));
        let fish = json!({ "items": [{
            "_id": "x", "title": "Thai news", "languages": ["th"], "tags": ["male"],
            "samples": [{ "audio": "/relative.mp3" }, { "audio": "https://cdn.example/x.mp3" }],
        }] });
        let voice = &fish_voices(&fish, false)[0];
        assert_eq!(voice.tags, ["th", "male"]);
        assert_eq!(voice.preview.as_deref(), Some("https://cdn.example/x.mp3"));
    }

    #[test]
    fn library_voices_play_in_the_language_asked_for() {
        let value = json!({ "voices": [{
            "voice_id": "v", "public_owner_id": "o", "name": "Anan - Confident, Deep ",
            "preview_url": "https://cdn.example/en.mp3", "accent": "american", "use_case": "narrative_story",
            "cloned_by_count": 504, "notice_period": 365,
            "verified_languages": [
                { "language": "en", "accent": "american", "preview_url": "https://cdn.example/en.mp3" },
                { "language": "th", "accent": "standard", "preview_url": "https://cdn.example/th.mp3" },
            ],
        }] });
        let anan = &elevenlabs_library(&value, Some("th"))[0];
        assert_eq!(anan.name, "Anan - Confident, Deep");
        assert_eq!(anan.preview.as_deref(), Some("https://cdn.example/th.mp3"));
        assert_eq!((anan.language.as_deref(), anan.accent.as_deref()), (Some("th"), Some("standard")));
        assert_eq!(anan.use_case.as_deref(), Some("narrative story"));
        assert_eq!((anan.users, anan.notice_days, anan.owner_id.as_deref()), (Some(504), Some(365), Some("o")));
        let fish = json!({ "total": 1, "items": [{ "_id": "x", "title": "ข่าว", "languages": ["th"], "tags": ["news"], "task_count": 9 }] });
        let voice = &fish_library(&fish)[0];
        assert_eq!((voice.language.as_deref(), voice.use_case.as_deref(), voice.users), (Some("th"), Some("news"), Some(9)));
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
