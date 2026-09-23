//! Calling the picture and video APIs.
//!
//! Every provider ends at the same place — bytes plus an extension — so the
//! caller never has to know whose API answered.
//!
//! The list is exactly the providers Settings → Models can hold a key for.
//! A service with no entry there would need its key kept somewhere else, and
//! one more place to put a key is the thing this replaced.

use std::time::{Duration, Instant};

use base64::Engine;
use serde_json::{json, Value};

use super::output::{extension_for, extension_from_url, Produced};

const GOOGLE_API: &str = "https://generativelanguage.googleapis.com/v1beta";
const OPENAI_API: &str = "https://api.openai.com/v1";
const OPENROUTER_API: &str = "https://openrouter.ai/api/v1";
const XAI_API: &str = "https://api.x.ai/v1";
const DASHSCOPE_API: &str = "https://dashscope-intl.aliyuncs.com";
/// DashScope's picture endpoint, which is not under `compatible-mode`.
const DASHSCOPE_IMAGE_PATH: &str = "/api/v1/services/aigc/multimodal-generation/generation";
/// DashScope's video endpoint, which only runs as a background task.
const DASHSCOPE_VIDEO_PATH: &str = "/api/v1/services/aigc/video-generation/video-synthesis";

/// How often a long-running job is asked whether it is done.
const POLL_EVERY: Duration = Duration::from_secs(5);

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Kind {
    Image,
    Video,
}

impl Kind {
    pub fn noun(self) -> &'static str {
        match self {
            Kind::Image => "image",
            Kind::Video => "video",
        }
    }

    fn default_extension(self) -> &'static str {
        match self {
            Kind::Image => "png",
            Kind::Video => "mp4",
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Provider {
    Google,
    OpenAI,
    OpenRouter,
    Xai,
    Alibaba,
}

impl Provider {
    pub const ALL: &'static [Provider] = &[
        Provider::Google,
        Provider::OpenAI,
        Provider::OpenRouter,
        Provider::Xai,
        Provider::Alibaba,
    ];

    pub fn id(self) -> &'static str {
        match self {
            Provider::Google => "google",
            Provider::OpenAI => "openai",
            Provider::OpenRouter => "openrouter",
            Provider::Xai => "xai",
            Provider::Alibaba => "alibaba",
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Provider::Google => "Google (Gemini & Veo)",
            Provider::OpenAI => "OpenAI",
            Provider::OpenRouter => "OpenRouter",
            Provider::Xai => "xAI (Grok)",
            Provider::Alibaba => "Alibaba (Qwen)",
        }
    }

    pub fn parse(id: &str) -> Option<Self> {
        Self::ALL.iter().copied().find(|p| p.id() == id.trim().to_ascii_lowercase())
    }

    /// The variables this provider's key may arrive in, best first.
    pub fn key_vars(self) -> &'static [&'static str] {
        match self {
            Provider::Google => &["GOOGLE_API_KEY", "GEMINI_API_KEY"],
            Provider::OpenAI => &["OPENAI_API_KEY"],
            Provider::OpenRouter => &["OPENROUTER_API_KEY"],
            Provider::Xai => &["XAI_API_KEY"],
            Provider::Alibaba => &["DASHSCOPE_API_KEY", "ALIBABA_API_KEY", "QWEN_API_KEY"],
        }
    }

    pub fn key(self) -> Option<String> {
        self.key_vars().iter().find_map(|var| {
            std::env::var(var).ok().map(|v| v.trim().to_string()).filter(|v| !v.is_empty())
        })
    }

    /// The calls this app knows how to make for a provider.
    ///
    /// Not a claim about what the provider sells — Grok and Sora both make
    /// video, and neither is wired up here (Sora's API shuts down on
    /// 2026-09-24, so it never will be). It is only ever consulted to explain
    /// a model that cannot run; a model whose provider has the route runs
    /// whatever its name or metadata says it makes.
    pub fn routes(self) -> &'static [Kind] {
        match self {
            Provider::Google | Provider::Alibaba => &[Kind::Image, Kind::Video],
            Provider::OpenAI | Provider::OpenRouter | Provider::Xai => &[Kind::Image],
        }
    }

    fn default_model(self, kind: Kind) -> &'static str {
        match (self, kind) {
            (Provider::Google, Kind::Image) => "gemini-3-pro-image-preview",
            (Provider::Google, Kind::Video) => "veo-3.1-generate-preview",
            (Provider::OpenAI, _) => "gpt-image-1",
            (Provider::Xai, _) => "grok-imagine-image",
            (Provider::Alibaba, _) => "qwen-image-plus",
            (Provider::OpenRouter, _) => "google/gemini-3-pro-image-preview",
        }
    }
}

pub struct Job<'a> {
    pub kind: Kind,
    pub prompt: &'a str,
    pub model: Option<&'a str>,
    pub aspect_ratio: Option<&'a str>,
    pub count: u8,
    pub duration_seconds: Option<u32>,
    pub deadline: Instant,
    /// Host to call instead of the provider's own, when the user pointed the
    /// provider somewhere else in Settings → Models (a proxy, a gateway).
    pub base_url: Option<&'a str>,
    /// Video only: `1080P`, `720P`, `480P`. Providers spell the case
    /// differently, so each route normalises it.
    pub resolution: Option<&'a str>,
}

impl Default for Job<'_> {
    fn default() -> Self {
        Self {
            kind: Kind::Image,
            prompt: "",
            model: None,
            aspect_ratio: None,
            count: 1,
            duration_seconds: None,
            deadline: Instant::now() + Duration::from_secs(300),
            base_url: None,
            resolution: None,
        }
    }
}

impl Job<'_> {
    fn left(&self) -> Duration {
        self.deadline.saturating_duration_since(Instant::now())
    }

    fn expired(&self) -> bool {
        self.left().is_zero()
    }
}

pub struct Output {
    pub files: Vec<Produced>,
    /// What actually ran, which may differ from what was asked for.
    pub model: String,
}

// ── shared HTTP helpers ──

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(300))
        .build()
        .map_err(|e| format!("Cannot start the HTTP client: {e}"))
}

/// A provider's own error text, kept short enough to read in a chat bubble.
fn api_error(provider: Provider, status: reqwest::StatusCode, body: &str) -> String {
    let detail = serde_json::from_str::<Value>(body)
        .ok()
        .and_then(|v| {
            for path in [&["error", "message"][..], &["detail"][..], &["message"][..]] {
                let mut cursor = &v;
                for key in path {
                    cursor = &cursor[*key];
                }
                if let Some(text) = cursor.as_str().filter(|s| !s.trim().is_empty()) {
                    return Some(text.to_string());
                }
            }
            None
        })
        .unwrap_or_else(|| body.trim().to_string());
    let detail: String = detail.chars().take(400).collect();
    let hint = match status.as_u16() {
        401 | 403 => " — check the API key in Settings → Models",
        404 => " — the model id may have been renamed; pass `model` explicitly",
        429 => " — the provider is rate-limiting; try again shortly",
        _ => "",
    };
    format!("{} returned {status}{hint}: {detail}", provider.label())
}

async fn post_json(
    provider: Provider,
    request: reqwest::RequestBuilder,
    body: &Value,
) -> Result<Value, String> {
    let response = request
        .json(body)
        .send()
        .await
        .map_err(|e| format!("Cannot reach {}: {e}", provider.label()))?;
    read_json(provider, response).await
}

async fn read_json(provider: Provider, response: reqwest::Response) -> Result<Value, String> {
    let status = response.status();
    let text = response.text().await.map_err(|e| format!("{}: {e}", provider.label()))?;
    if !status.is_success() {
        return Err(api_error(provider, status, &text));
    }
    serde_json::from_str(&text)
        .map_err(|e| format!("{} sent a reply this app cannot read ({e})", provider.label()))
}

/// Fetch a finished file. `headers` carries provider auth where the download
/// link needs it (Google's file URIs do).
async fn download(
    provider: Provider,
    url: &str,
    auth: Option<(&str, &str)>,
    kind: Kind,
) -> Result<Produced, String> {
    if let Some(rest) = url.strip_prefix("data:") {
        let (meta, data) = rest.split_once(',').ok_or("Malformed data URL")?;
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(data.trim())
            .map_err(|e| format!("Malformed data URL: {e}"))?;
        let mime = meta.split(';').next();
        return Ok(Produced::new(bytes, extension_for(mime, kind.default_extension())));
    }
    let mut request = client()?.get(url);
    if let Some((name, value)) = auth {
        request = request.header(name, value);
    }
    let response = request
        .send()
        .await
        .map_err(|e| format!("Cannot download the {} from {}: {e}", kind.noun(), provider.label()))?;
    let status = response.status();
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        return Err(api_error(provider, status, &body));
    }
    let mime = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .map(str::to_string);
    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("Download from {} failed: {e}", provider.label()))?;
    let extension = match mime.as_deref() {
        Some(mime) if mime.starts_with("image/") || mime.starts_with("video/") => {
            extension_for(Some(mime), kind.default_extension())
        }
        _ => extension_from_url(url, kind.default_extension()),
    };
    Ok(Produced::new(bytes.to_vec(), extension))
}

/// Every string under `key` anywhere in the reply, in document order.
///
/// Providers move these around between versions (`generatedSamples[].video.uri`
/// became `generatedVideos[].video.uri` mid-preview), and a walk finds the
/// link either way instead of failing on a renamed wrapper.
fn collect_strings(value: &Value, keys: &[&str], out: &mut Vec<String>) {
    match value {
        Value::Object(map) => {
            for (name, child) in map {
                if keys.contains(&name.as_str()) {
                    if let Some(text) = child.as_str().filter(|s| !s.trim().is_empty()) {
                        out.push(text.to_string());
                        continue;
                    }
                }
                collect_strings(child, keys, out);
            }
        }
        Value::Array(items) => {
            for item in items {
                collect_strings(item, keys, out);
            }
        }
        _ => {}
    }
}

fn find_all(value: &Value, keys: &[&str]) -> Vec<String> {
    let mut out = Vec::new();
    collect_strings(value, keys, &mut out);
    out
}

// `image` and `video` hold a plain link on DashScope; everywhere else they
// hold an object, and a walk steps into that instead.
const URL_KEYS: &[&str] = &["uri", "url", "signed_url", "video_url", "image_url", "image", "video"];
const BASE64_KEYS: &[&str] = &["bytesBase64Encoded", "b64_json", "data", "videoBytes"];

fn decode_base64(raw: &str) -> Option<Vec<u8>> {
    let payload = raw.rsplit(',').next().unwrap_or(raw).trim();
    base64::engine::general_purpose::STANDARD.decode(payload).ok()
}

/// Turn whatever a provider returned — inline base64 or links — into files.
async fn collect_files(
    provider: Provider,
    body: &Value,
    kind: Kind,
    auth: Option<(&str, &str)>,
    limit: usize,
) -> Result<Vec<Produced>, String> {
    let mut files = Vec::new();
    for raw in find_all(body, BASE64_KEYS) {
        if files.len() >= limit {
            break;
        }
        // `data` is also a common wrapper name; only take it when it decodes.
        if let Some(bytes) = decode_base64(&raw).filter(|b| b.len() > 64) {
            let mime = raw.strip_prefix("data:").and_then(|rest| rest.split(';').next());
            files.push(Produced::new(bytes, extension_for(mime, kind.default_extension())));
        }
    }
    if files.len() < limit {
        for url in find_all(body, URL_KEYS) {
            if files.len() >= limit {
                break;
            }
            if url.starts_with("http") || url.starts_with("data:") {
                files.push(download(provider, &url, auth, kind).await?);
            }
        }
    }
    if files.is_empty() {
        return Err(format!(
            "{} finished without a {}. It usually means the request was refused: {}",
            provider.label(),
            kind.noun(),
            summarize(body)
        ));
    }
    Ok(files)
}

/// A one-line version of a reply, for an error the user has to act on.
fn summarize(body: &Value) -> String {
    let text = serde_json::to_string(body).unwrap_or_default();
    text.chars().take(400).collect()
}

// ── Google ──

fn google_auth(key: &str) -> (&'static str, String) {
    ("x-goog-api-key", key.to_string())
}

/// Ask Google which models it actually serves, so a renamed preview (Veo and
/// the Gemini image models are renamed often) doesn't take the feature down.
async fn google_discover(key: &str, kind: Kind) -> Option<String> {
    let body: Value = client()
        .ok()?
        .get(format!("{GOOGLE_API}/models?pageSize=1000"))
        .header("x-goog-api-key", key)
        .send()
        .await
        .ok()?
        .json()
        .await
        .ok()?;
    let models = body["models"].as_array()?;
    let matches = |model: &Value, needle: &str, method: &str| {
        let name = model["name"].as_str().unwrap_or_default().to_ascii_lowercase();
        let methods = model["supportedGenerationMethods"].as_array();
        name.contains(needle)
            && methods.is_some_and(|m| m.iter().any(|v| v.as_str() == Some(method)))
    };
    let wanted: &[(&str, &str)] = match kind {
        Kind::Image => &[("image", "generateContent"), ("imagen", "predict")],
        Kind::Video => &[("veo", "predictLongRunning")],
    };
    for (needle, method) in wanted {
        if let Some(found) = models.iter().find(|m| matches(m, needle, method)) {
            let name = found["name"].as_str()?;
            return Some(name.trim_start_matches("models/").to_string());
        }
    }
    None
}

async fn google_image(job: &Job<'_>, key: &str, model: &str) -> Result<Vec<Produced>, String> {
    let http = client()?;
    // Imagen is a `predict` model; the Gemini image models answer on
    // `generateContent` with an IMAGE modality.
    if model.contains("imagen") {
        let mut parameters = json!({ "sampleCount": job.count.clamp(1, 4) });
        if let Some(ratio) = job.aspect_ratio {
            parameters["aspectRatio"] = json!(ratio);
        }
        let body = json!({ "instances": [{ "prompt": job.prompt }], "parameters": parameters });
        let reply = post_json(
            Provider::Google,
            http.post(format!("{GOOGLE_API}/models/{model}:predict")).header("x-goog-api-key", key),
            &body,
        )
        .await?;
        return collect_files(Provider::Google, &reply, Kind::Image, None, job.count as usize).await;
    }

    // TEXT goes in alongside IMAGE: the Gemini image models are conversational
    // and refuse a request that asks for pictures only ("Modality TEXT is
    // required"). The text part is a caption we don't use — `collect_files`
    // takes the `inlineData` parts and leaves the rest.
    let mut generation = json!({ "responseModalities": ["TEXT", "IMAGE"] });
    if let Some(ratio) = job.aspect_ratio {
        generation["imageConfig"] = json!({ "aspectRatio": ratio });
    }
    let body = json!({
        "contents": [{ "role": "user", "parts": [{ "text": job.prompt }] }],
        "generationConfig": generation,
    });
    let reply = post_json(
        Provider::Google,
        http.post(format!("{GOOGLE_API}/models/{model}:generateContent"))
            .header("x-goog-api-key", key),
        &body,
    )
    .await?;
    collect_files(Provider::Google, &reply, Kind::Image, None, job.count as usize).await
}

async fn google_video(job: &Job<'_>, key: &str, model: &str) -> Result<Vec<Produced>, String> {
    let http = client()?;
    let mut parameters = json!({});
    if let Some(ratio) = job.aspect_ratio {
        parameters["aspectRatio"] = json!(ratio);
    }
    if let Some(seconds) = job.duration_seconds {
        parameters["durationSeconds"] = json!(seconds);
    }
    if let Some(resolution) = job.resolution {
        parameters["resolution"] = json!(resolution.to_ascii_lowercase());
    }
    let body = json!({ "instances": [{ "prompt": job.prompt }], "parameters": parameters });
    let started = post_json(
        Provider::Google,
        http.post(format!("{GOOGLE_API}/models/{model}:predictLongRunning"))
            .header("x-goog-api-key", key),
        &body,
    )
    .await?;

    let operation = started["name"]
        .as_str()
        .ok_or_else(|| format!("Google did not start the job: {}", summarize(&started)))?
        .to_string();

    loop {
        if job.expired() {
            return Err(format!(
                "The video was still rendering when the time limit ran out. Google is still \
                 working on it ({operation}); ask again with a longer `timeout_seconds`."
            ));
        }
        tokio::time::sleep(POLL_EVERY.min(job.left())).await;
        let status = read_json(
            Provider::Google,
            http.get(format!("{GOOGLE_API}/{operation}"))
                .header("x-goog-api-key", key)
                .send()
                .await
                .map_err(|e| format!("Cannot reach Google: {e}"))?,
        )
        .await?;
        if let Some(error) = status["error"]["message"].as_str() {
            return Err(format!("Google could not make the video: {error}"));
        }
        if status["done"].as_bool() == Some(true) {
            let (name, value) = google_auth(key);
            return collect_files(Provider::Google, &status, Kind::Video, Some((name, &value)), 1)
                .await;
        }
    }
}

async fn run_google(job: &Job<'_>, key: &str) -> Result<Output, String> {
    let asked = job.model.map(str::to_string);
    let model = asked.clone().unwrap_or_else(|| Provider::Google.default_model(job.kind).to_string());
    let attempt = |model: String| async move {
        let files = match job.kind {
            Kind::Image => google_image(job, key, &model).await?,
            Kind::Video => google_video(job, key, &model).await?,
        };
        Ok::<Output, String>(Output { files, model })
    };

    match attempt(model.clone()).await {
        Ok(output) => Ok(output),
        // The preview names churn; when the default is gone, ask Google what
        // it has rather than telling the user to go and find out.
        Err(first) if asked.is_none() && looks_missing(&first) => {
            match google_discover(key, job.kind).await {
                Some(found) if found != model => attempt(found).await.map_err(|second| {
                    format!("{first}\n\nAlso tried the model Google lists: {second}")
                }),
                _ => Err(first),
            }
        }
        Err(e) => Err(e),
    }
}

fn looks_missing(error: &str) -> bool {
    let lower = error.to_ascii_lowercase();
    lower.contains("404")
        || lower.contains("not found")
        || lower.contains("is not supported")
        || lower.contains("does not exist")
}

// ── OpenAI ──

/// The sizes `gpt-image-1` accepts, chosen from the aspect ratio asked for.
fn openai_size(aspect_ratio: Option<&str>) -> Option<&'static str> {
    let ratio = aspect_ratio?.trim();
    let (w, h) = ratio.split_once([':', 'x', '/'])?;
    let (w, h) = (w.trim().parse::<f32>().ok()?, h.trim().parse::<f32>().ok()?);
    if h <= 0.0 || w <= 0.0 {
        return None;
    }
    Some(match w / h {
        r if r > 1.15 => "1536x1024",
        r if r < 0.87 => "1024x1536",
        _ => "1024x1024",
    })
}

/// `POST /images/generations` — OpenAI's shape, which xAI and most gateways
/// copy, so one route serves them all with a different host.
async fn run_openai_compatible(
    provider: Provider,
    default_base: &str,
    job: &Job<'_>,
    key: &str,
) -> Result<Output, String> {
    let model = job.model.unwrap_or_else(|| provider.default_model(job.kind)).to_string();
    let mut body = json!({ "model": model, "prompt": job.prompt, "n": job.count.clamp(1, 4) });
    if let Some(size) = openai_size(job.aspect_ratio) {
        body["size"] = json!(size);
    }
    let base = job
        .base_url
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(str::to_string)
        .or_else(|| {
            std::env::var("OPENAI_BASE_URL")
                .ok()
                .map(|v| v.trim().to_string())
                .filter(|v| !v.is_empty())
        })
        .unwrap_or_else(|| default_base.to_string());
    let base = base.trim_end_matches('/');
    let reply = post_json(
        provider,
        client()?.post(format!("{base}/images/generations")).bearer_auth(key),
        &body,
    )
    .await?;
    let files = collect_files(provider, &reply, Kind::Image, None, job.count as usize).await?;
    Ok(Output { files, model })
}

// ── OpenRouter ──

/// OpenRouter routes picture models through the chat endpoint, with the image
/// coming back on the message rather than as a `/images` response.
async fn run_openrouter(job: &Job<'_>, key: &str) -> Result<Output, String> {
    let asked = job.model.map(str::to_string);
    let model =
        asked.clone().unwrap_or_else(|| Provider::OpenRouter.default_model(job.kind).to_string());
    let attempt = |model: String| async move {
        let body = json!({
            "model": model,
            "modalities": ["image", "text"],
            "messages": [{ "role": "user", "content": job.prompt }],
        });
        let reply = post_json(
            Provider::OpenRouter,
            client()?
                .post(format!("{OPENROUTER_API}/chat/completions"))
                .bearer_auth(key)
                // OpenRouter asks callers to identify themselves for its
                // rankings; it also makes a rejected request traceable.
                .header("HTTP-Referer", "https://github.com/Panudetingai/Mali-Cowork")
                .header("X-Title", "Mali Cowork"),
            &body,
        )
        .await?;
        let files =
            collect_files(Provider::OpenRouter, &reply, Kind::Image, None, job.count as usize)
                .await?;
        Ok::<Output, String>(Output { files, model })
    };

    match attempt(model.clone()).await {
        Ok(output) => Ok(output),
        Err(first) if asked.is_none() && looks_missing(&first) => {
            match openrouter_discover(key).await {
                Some(found) if found != model => attempt(found).await.map_err(|second| {
                    format!("{first}\n\nAlso tried the model OpenRouter lists: {second}")
                }),
                _ => Err(first),
            }
        }
        Err(e) => Err(e),
    }
}

async fn openrouter_discover(key: &str) -> Option<String> {
    let body: Value = client()
        .ok()?
        .get(format!("{OPENROUTER_API}/models"))
        .bearer_auth(key)
        .send()
        .await
        .ok()?
        .json()
        .await
        .ok()?;
    body["data"]
        .as_array()?
        .iter()
        .find(|model| {
            model["architecture"]["output_modalities"]
                .as_array()
                .is_some_and(|m| m.iter().any(|v| v.as_str() == Some("image")))
        })
        .and_then(|model| model["id"].as_str().map(str::to_string))
}

// ── Alibaba (DashScope) ──

/// The sizes `qwen-image` takes, from the aspect ratio asked for.
fn dashscope_size(aspect_ratio: Option<&str>) -> Option<&'static str> {
    let ratio = aspect_ratio?.trim();
    let (w, h) = ratio.split_once([':', 'x', '*', '/'])?;
    let (w, h) = (w.trim().parse::<f32>().ok()?, h.trim().parse::<f32>().ok()?);
    if w <= 0.0 || h <= 0.0 {
        return None;
    }
    Some(match w / h {
        r if r > 1.6 => "1664*928",
        r if r > 1.1 => "1472*1140",
        r if r < 0.62 => "928*1664",
        r if r < 0.9 => "1140*1472",
        _ => "1328*1328",
    })
}

/// Settings → Models points at `…/compatible-mode/v1`; the picture and video
/// endpoints hang off the same host, one level up.
fn dashscope_root(job: &Job<'_>) -> String {
    job.base_url
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(|base| {
            base.trim_end_matches('/')
                .trim_end_matches("/v1")
                .trim_end_matches("/compatible-mode")
                .to_string()
        })
        .unwrap_or_else(|| DASHSCOPE_API.to_string())
}

/// DashScope keeps picture generation on its own endpoint, not under
/// `compatible-mode` — which is the whole reason a `qwen-image-*` model
/// pointed at the chat endpoint answers with a validation error about
/// `messages.0.role` instead of a picture.
async fn run_dashscope_image(job: &Job<'_>, key: &str) -> Result<Output, String> {
    let model = job.model.unwrap_or_else(|| Provider::Alibaba.default_model(job.kind)).to_string();
    let root = dashscope_root(job);

    let mut parameters = json!({ "n": job.count.clamp(1, 4) });
    if let Some(size) = dashscope_size(job.aspect_ratio) {
        parameters["size"] = json!(size);
    }
    let body = json!({
        "model": model,
        "input": { "messages": [{ "role": "user", "content": [{ "text": job.prompt }] }] },
        "parameters": parameters,
    });
    let reply = post_json(
        Provider::Alibaba,
        client()?.post(format!("{root}{DASHSCOPE_IMAGE_PATH}")).bearer_auth(key),
        &body,
    )
    .await?;
    let files =
        collect_files(Provider::Alibaba, &reply, Kind::Image, None, job.count as usize).await?;
    Ok(Output { files, model })
}

/// Wan text-to-video. DashScope runs this as a background task and nothing
/// else: the request only ever comes back with a task id, so the result is
/// polled for.
async fn run_dashscope_video(job: &Job<'_>, key: &str) -> Result<Output, String> {
    let model = job.model.unwrap_or_else(|| Provider::Alibaba.default_model(job.kind)).to_string();
    let root = dashscope_root(job);
    let http = client()?;

    let mut parameters = json!({});
    if let Some(ratio) = job.aspect_ratio {
        parameters["ratio"] = json!(ratio.replace(['x', '*', '/'], ":"));
    }
    if let Some(seconds) = job.duration_seconds {
        parameters["duration"] = json!(seconds);
    }
    if let Some(resolution) = job.resolution {
        parameters["resolution"] = json!(resolution.to_ascii_uppercase());
    }
    let body = json!({
        "model": model,
        "input": { "prompt": job.prompt },
        "parameters": parameters,
    });
    let started = post_json(
        Provider::Alibaba,
        http.post(format!("{root}{DASHSCOPE_VIDEO_PATH}"))
            .bearer_auth(key)
            // Not optional: without it the endpoint refuses the request.
            .header("X-DashScope-Async", "enable"),
        &body,
    )
    .await?;

    let task = started["output"]["task_id"]
        .as_str()
        .ok_or_else(|| format!("Alibaba did not start the job: {}", summarize(&started)))?
        .to_string();

    loop {
        if job.expired() {
            return Err(format!(
                "The video was still rendering when the time limit ran out. Alibaba is still \
                 working on it (task {task}); ask again with a longer time limit."
            ));
        }
        tokio::time::sleep(POLL_EVERY.min(job.left())).await;
        let status = read_json(
            Provider::Alibaba,
            http.get(format!("{root}/api/v1/tasks/{task}"))
                .bearer_auth(key)
                .send()
                .await
                .map_err(|e| format!("Cannot reach Alibaba: {e}"))?,
        )
        .await?;
        match status["output"]["task_status"].as_str().unwrap_or_default() {
            "SUCCEEDED" => {
                let files =
                    collect_files(Provider::Alibaba, &status, Kind::Video, None, 1).await?;
                return Ok(Output { files, model });
            }
            "FAILED" | "CANCELED" | "UNKNOWN" => {
                let detail = status["output"]["message"]
                    .as_str()
                    .unwrap_or_else(|| status["output"]["code"].as_str().unwrap_or("no reason given"));
                return Err(format!("Alibaba could not make the video: {detail}"));
            }
            _ => {}
        }
    }
}

// ── entry point ──

/// Run one job on a named provider with a key the caller already has.
///
/// This is the path the model picker takes: a model like
/// `gemini-3-pro-image-preview` picked in Settings → Models is called with
/// that provider's own key, no connector and no agent in between. The MCP
/// server (`generate`) is the same code with the key read from its
/// environment and the provider chosen for the model.
pub async fn generate_with(
    provider: Provider,
    key: &str,
    job: &Job<'_>,
) -> Result<Output, String> {
    run(provider, job, key).await
}

async fn run(provider: Provider, job: &Job<'_>, key: &str) -> Result<Output, String> {
    match (provider, job.kind) {
        (Provider::Google, _) => run_google(job, key).await,
        (Provider::Alibaba, Kind::Image) => run_dashscope_image(job, key).await,
        (Provider::Alibaba, Kind::Video) => run_dashscope_video(job, key).await,
        (Provider::OpenAI, Kind::Image) => {
            run_openai_compatible(provider, OPENAI_API, job, key).await
        }
        (Provider::Xai, Kind::Image) => run_openai_compatible(provider, XAI_API, job, key).await,
        (Provider::OpenRouter, Kind::Image) => run_openrouter(job, key).await,
        (provider, kind) => Err(no_route(provider, kind)),
    }
}

/// Said when the model is fine and the provider sells the thing, but this app
/// has no call wired up for that pair. It names what would work rather than
/// telling the user their provider cannot do something it plainly can.
fn no_route(provider: Provider, kind: Kind) -> String {
    let elsewhere: Vec<&str> = Provider::ALL
        .iter()
        .filter(|p| p.routes().contains(&kind))
        .map(|p| p.label())
        .collect();
    format!(
        "Mali can't ask {} for {} yet — only for {}. It can make {}s through: {}.",
        provider.label(),
        match kind {
            Kind::Image => "a picture",
            Kind::Video => "a video",
        },
        provider
            .routes()
            .iter()
            .map(|k| k.noun())
            .collect::<Vec<_>>()
            .join(" and "),
        kind.noun(),
        elsewhere.join(", "),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Which call exists is about this app, not about what the provider
    /// sells: Grok makes video and is not wired up; Qwen makes video and is.
    #[test]
    fn every_provider_can_be_asked_for_a_picture() {
        for provider in Provider::ALL {
            assert!(provider.routes().contains(&Kind::Image), "{}", provider.id());
        }
        assert!(Provider::Google.routes().contains(&Kind::Video));
        assert!(Provider::Alibaba.routes().contains(&Kind::Video));
    }

    /// The old message told the user their provider "cannot" do something it
    /// plainly can. It now says what is missing here, and where to go.
    #[test]
    fn a_missing_route_names_the_providers_that_have_one() {
        let message = no_route(Provider::Xai, Kind::Video);
        assert!(message.contains("Google"), "{message}");
        assert!(message.contains("Alibaba"), "{message}");
        assert!(!message.contains("cannot"), "{message}");
    }

    #[test]
    fn provider_ids_round_trip() {
        for provider in Provider::ALL {
            assert_eq!(Provider::parse(provider.id()), Some(*provider));
        }
        assert_eq!(Provider::parse("  GOOGLE "), Some(Provider::Google));
        assert_eq!(Provider::parse("midjourney"), None);
    }

    /// DashScope answers `content: [{ "image": "https://…" }]`, so the link
    /// is under a key that holds an object on every other provider.
    #[test]
    fn a_dashscope_picture_is_found_in_its_own_shape() {
        let reply = json!({
            "output": { "choices": [{ "message": { "role": "assistant", "content": [
                { "image": "https://dashscope-result.oss/x.png?Expires=1" }
            ] } }] }
        });
        assert_eq!(find_all(&reply, URL_KEYS), ["https://dashscope-result.oss/x.png?Expires=1"]);
    }

    #[test]
    fn dashscope_takes_its_own_size_names() {
        assert_eq!(dashscope_size(Some("1:1")), Some("1328*1328"));
        assert_eq!(dashscope_size(Some("16:9")), Some("1664*928"));
        assert_eq!(dashscope_size(Some("9:16")), Some("928*1664"));
        assert_eq!(dashscope_size(Some("4:3")), Some("1472*1140"));
        assert_eq!(dashscope_size(Some("3:4")), Some("1140*1472"));
        assert_eq!(dashscope_size(Some("wide")), None);
        assert_eq!(dashscope_size(None), None);
    }

    #[test]
    fn aspect_ratios_become_sizes_openai_accepts() {
        assert_eq!(openai_size(Some("1:1")), Some("1024x1024"));
        assert_eq!(openai_size(Some("16:9")), Some("1536x1024"));
        assert_eq!(openai_size(Some("9:16")), Some("1024x1536"));
        assert_eq!(openai_size(Some("4:3")), Some("1536x1024"));
        assert_eq!(openai_size(Some("nonsense")), None);
        assert_eq!(openai_size(Some("1:0")), None);
        assert_eq!(openai_size(None), None);
    }

    /// The wrappers around a finished file are renamed between previews, so
    /// the link is looked for by key at any depth.
    #[test]
    fn finds_the_file_wherever_the_reply_puts_it() {
        let veo_old = json!({
            "response": { "generateVideoResponse": { "generatedSamples": [
                { "video": { "uri": "https://x/files/a" } }
            ] } }
        });
        let veo_new = json!({
            "response": { "generatedVideos": [{ "video": { "uri": "https://x/files/b" } }] }
        });
        assert_eq!(find_all(&veo_old, URL_KEYS), ["https://x/files/a"]);
        assert_eq!(find_all(&veo_new, URL_KEYS), ["https://x/files/b"]);

        let openrouter = json!({
            "choices": [{ "message": { "images": [{ "image_url": { "url": "data:image/png;base64,AAA" } }] } }]
        });
        assert_eq!(find_all(&openrouter, URL_KEYS), ["data:image/png;base64,AAA"]);
    }

    #[test]
    fn inline_bytes_are_picked_up_from_every_provider_shape() {
        let gemini = json!({ "candidates": [{ "content": { "parts": [
            { "inlineData": { "mimeType": "image/png", "data": "QUJD" } }
        ] } }] });
        assert_eq!(find_all(&gemini, BASE64_KEYS), ["QUJD"]);
        let imagen = json!({ "predictions": [{ "bytesBase64Encoded": "QUJD" }] });
        assert_eq!(find_all(&imagen, BASE64_KEYS), ["QUJD"]);
        let openai = json!({ "data": [{ "b64_json": "QUJD" }] });
        assert_eq!(find_all(&openai, BASE64_KEYS), ["QUJD"]);
    }

    #[test]
    fn a_provider_error_names_what_to_do_about_it() {
        let body = r#"{"error":{"message":"API key not valid"}}"#;
        let message =
            api_error(Provider::Google, reqwest::StatusCode::UNAUTHORIZED, body);
        assert!(message.contains("API key not valid"), "{message}");
        assert!(message.contains("Settings"), "{message}");
        let renamed = api_error(Provider::Alibaba, reqwest::StatusCode::NOT_FOUND, "{}");
        assert!(renamed.contains("model id"), "{renamed}");
    }
}
