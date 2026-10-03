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
    Puter,
}

impl Provider {
    pub const ALL: &'static [Provider] = &[
        Provider::Google,
        Provider::OpenAI,
        Provider::OpenRouter,
        Provider::Xai,
        Provider::Alibaba,
        Provider::Puter,
    ];

    pub fn id(self) -> &'static str {
        match self {
            Provider::Google => "google",
            Provider::OpenAI => "openai",
            Provider::OpenRouter => "openrouter",
            Provider::Xai => "xai",
            Provider::Alibaba => "alibaba",
            Provider::Puter => "puter",
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Provider::Google => "Google (Gemini & Veo)",
            Provider::OpenAI => "OpenAI",
            Provider::OpenRouter => "OpenRouter",
            Provider::Xai => "xAI (Grok)",
            Provider::Alibaba => "Alibaba (Qwen)",
            Provider::Puter => "Puter",
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
            Provider::Puter => &["PUTER_AUTH_TOKEN"],
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
            Provider::Google | Provider::Alibaba | Provider::Puter => &[Kind::Image, Kind::Video],
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
            (Provider::Puter, Kind::Image) => "gpt-image-2",
            (Provider::Puter, Kind::Video) => "veo-3.1-lite",
        }
    }
}

/// A picture the user gave as a starting point: what to edit, what to keep
/// the style of, or a video's first frame.
pub struct Reference {
    pub mime: String,
    pub bytes: Vec<u8>,
    pub name: String,
}

// By hand: the bytes would flood a test failure or a log line.
impl std::fmt::Debug for Reference {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Reference").field("mime", &self.mime).field("bytes", &self.bytes.len()).finish()
    }
}

impl Reference {
    fn base64(&self) -> String {
        base64::engine::general_purpose::STANDARD.encode(&self.bytes)
    }

    fn data_uri(&self) -> String {
        format!("data:{};base64,{}", self.mime, self.base64())
    }
}

/// How many reference pictures a provider takes for a kind; 0 = none.
/// Mirrored by `maxReferencesFor` in the Visual page.
pub fn max_references(provider: Provider, kind: Kind) -> usize {
    match (provider, kind) {
        (Provider::Xai, _) => 0,
        (_, Kind::Image) => 3,
        // Veo and Wan animate from one picture: the first frame (Puter's `input_reference`).
        (Provider::Google | Provider::Alibaba | Provider::Puter, Kind::Video) => 1,
        (_, Kind::Video) => 0,
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
    /// Pictures to work from; see `max_references` for how many each takes.
    pub references: &'a [Reference],
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
            references: &[],
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
        if !job.references.is_empty() {
            return Err("Imagen models can't start from a reference picture. Pick a Gemini image model to use one.".into());
        }
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
    // Reference pictures go first, as inline data, then the instruction.
    let mut parts: Vec<Value> = job
        .references
        .iter()
        .map(|r| json!({ "inline_data": { "mime_type": r.mime, "data": r.base64() } }))
        .collect();
    parts.push(json!({ "text": job.prompt }));
    let body = json!({
        "contents": [{ "role": "user", "parts": parts }],
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
    let mut instance = json!({ "prompt": job.prompt });
    // Veo animates from a picture: it becomes the first frame.
    if let Some(first) = job.references.first() {
        instance["image"] = json!({ "bytesBase64Encoded": first.base64(), "mimeType": first.mime });
    }
    let body = json!({ "instances": [instance], "parameters": parameters });
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
    let reply = if job.references.is_empty() {
        post_json(provider, client()?.post(format!("{base}/images/generations")).bearer_auth(key), &body).await?
    } else {
        if provider == Provider::Xai {
            return Err("xAI can't start from a reference picture here yet. Remove it, or pick a Gemini, OpenAI or Qwen image model.".into());
        }
        // Pictures to start from go to `/images/edits`, as a form.
        let mut form = reqwest::multipart::Form::new()
            .text("model", model.clone())
            .text("prompt", job.prompt.to_string())
            .text("n", job.count.clamp(1, 4).to_string());
        if let Some(size) = openai_size(job.aspect_ratio) {
            form = form.text("size", size);
        }
        for reference in job.references {
            let part = reqwest::multipart::Part::bytes(reference.bytes.clone())
                .file_name(reference.name.clone())
                .mime_str(&reference.mime)
                .map_err(|e| e.to_string())?;
            form = form.part("image[]", part);
        }
        let response = client()?
            .post(format!("{base}/images/edits"))
            .bearer_auth(key)
            .multipart(form)
            .send()
            .await
            .map_err(|e| format!("Cannot reach {}: {e}", provider.label()))?;
        read_json(provider, response).await?
    };
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
        let content = if job.references.is_empty() {
            json!(job.prompt)
        } else {
            let mut parts: Vec<Value> = job
                .references
                .iter()
                .map(|r| json!({ "type": "image_url", "image_url": { "url": r.data_uri() } }))
                .collect();
            parts.push(json!({ "type": "text", "text": job.prompt }));
            json!(parts)
        };
        let body = json!({
            "model": model,
            "modalities": ["image", "text"],
            "messages": [{ "role": "user", "content": content }],
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
    // Edit models (`qwen-image-edit…`) take the pictures in the same message.
    let mut content: Vec<Value> = job.references.iter().map(|r| json!({ "image": r.data_uri() })).collect();
    content.push(json!({ "text": job.prompt }));
    let body = json!({
        "model": model,
        "input": { "messages": [{ "role": "user", "content": content }] },
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
    let mut input = json!({ "prompt": job.prompt });
    // Image-to-video models (`wan…-i2v…`) start from the picture.
    if let Some(first) = job.references.first() {
        input["img_url"] = json!(first.data_uri());
    }
    let body = json!({ "model": model, "input": input, "parameters": parameters });
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

// ── Puter ──
//
// Through `crate::puter` (the driver route puter.js's `txt2img` / `txt2vid`
// call, open to free accounts), with the auth token from puter.com/dashboard:
// no sign-in popup, which a desktop webview can't complete. Each call makes
// one picture or one clip, and the answer is the file itself, or a link to it.

/// A clip's size as Puter takes it, `WIDTHxHEIGHT`: the tier is the shorter side.
fn puter_video_size(aspect: Option<&str>, resolution: Option<&str>) -> String {
    let short: u32 = resolution
        .map(|r| r.trim().trim_end_matches(['p', 'P']))
        .and_then(|r| r.parse().ok())
        .filter(|n| (240..=2160).contains(n))
        .unwrap_or(720);
    let (w, h) = aspect
        .and_then(|a| a.split_once(':'))
        .and_then(|(w, h)| Some((w.trim().parse::<f64>().ok()?, h.trim().parse::<f64>().ok()?)))
        .filter(|(w, h)| *w > 0.0 && *h > 0.0)
        .unwrap_or((16.0, 9.0));
    let long = (f64::from(short) * w.max(h) / w.min(h)).round() as u32;
    // Video encoders want even sides.
    let long = long + long % 2;
    if w >= h { format!("{long}x{short}") } else { format!("{short}x{long}") }
}

async fn run_puter(job: &Job<'_>, key: &str) -> Result<Output, String> {
    let model = job.model.unwrap_or(Provider::Puter.default_model(job.kind)).to_string();
    let mut args = json!({ "prompt": job.prompt, "model": model });
    match job.kind {
        Kind::Image => {
            if let Some(ratio) = job.aspect_ratio {
                args["aspect_ratio"] = json!(ratio);
            }
            if !job.references.is_empty() {
                args["input_images"] = job.references.iter().map(Reference::data_uri).collect();
            }
        }
        Kind::Video => {
            args["size"] = json!(puter_video_size(job.aspect_ratio, job.resolution));
            if let Some(seconds) = job.duration_seconds {
                args["seconds"] = json!(seconds);
            }
            if let Some(first) = job.references.first() {
                args["input_reference"] = json!(first.data_uri());
            }
        }
    }
    // One per call: a picture asked for twice is two calls.
    let count = if job.kind == Kind::Image { job.count.max(1) } else { 1 };
    let mut files = Vec::new();
    for _ in 0..count {
        if job.expired() {
            break;
        }
        files.push(puter_generate(job, key, &args).await?);
    }
    if files.is_empty() {
        return Err(format!("Puter ran out of time before the {} was ready.", job.kind.noun()));
    }
    Ok(Output { files, model })
}

async fn puter_generate(job: &Job<'_>, key: &str, args: &Value) -> Result<Produced, String> {
    let service = match job.kind {
        Kind::Image => crate::puter::Service::Image,
        Kind::Video => crate::puter::Service::Video,
    };
    // A clip is only answered once it's made, which takes minutes.
    let client = reqwest::Client::builder()
        .timeout(job.left().max(Duration::from_secs(30)))
        .build()
        .map_err(|e| format!("Cannot start the HTTP client: {e}"))?;
    let response = crate::puter::call(&client, job.base_url, key, service, "generate", args)
        .send()
        .await
        .map_err(|e| format!("Cannot reach Puter: {e}"))?;
    let status = response.status();
    let mime = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or_default()
        .to_string();
    let bytes = response.bytes().await.map_err(|e| format!("Puter: {e}"))?;
    // The file itself.
    if status.is_success() && (mime.starts_with("image/") || mime.starts_with("video/")) {
        return Ok(Produced::new(bytes.to_vec(), extension_for(Some(&mime), job.kind.default_extension())));
    }
    let text = String::from_utf8_lossy(&bytes);
    if !status.is_success() {
        return Err(api_error(Provider::Puter, status, &text));
    }
    let Ok(value) = serde_json::from_str::<Value>(&text) else {
        // Not JSON and not labelled: take it as the file, if it's big enough to be one.
        if bytes.len() > 1024 {
            return Ok(Produced::new(bytes.to_vec(), job.kind.default_extension().to_string()));
        }
        return Err(format!("Puter sent a reply this app cannot read: {}", text.chars().take(300).collect::<String>()));
    };
    if let Some(message) = crate::puter::refusal(&value) {
        return Err(format!("Puter: {message}"));
    }
    let result = if value.get("result").is_some() { &value["result"] } else { &value };
    let url = result
        .as_str()
        .or_else(|| ["asset_url", "url", "href"].iter().find_map(|k| result[*k].as_str()))
        .filter(|u| !u.trim().is_empty())
        .ok_or_else(|| format!("Puter finished without a {}: {}", job.kind.noun(), summarize(&value)))?;
    // A link on Puter's own host needs the token; anyone else's must not get it.
    let own = reqwest::Url::parse(url)
        .ok()
        .and_then(|u| u.host_str().map(|h| h == "puter.com" || h.ends_with(".puter.com")))
        .unwrap_or(false);
    let auth = format!("Bearer {key}");
    download(Provider::Puter, url, own.then_some(("Authorization", auth.as_str())), job.kind).await
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
        (Provider::Puter, _) => run_puter(job, key).await,
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

    #[test]
    fn puter_sizes_a_clip_by_its_shorter_side() {
        assert_eq!(puter_video_size(None, None), "1280x720");
        assert_eq!(puter_video_size(Some("9:16"), Some("1080P")), "1080x1920");
        assert_eq!(puter_video_size(Some("16:9"), Some("480p")), "854x480");
        assert_eq!(puter_video_size(Some("1:1"), Some("720P")), "720x720");
    }

    /// A server answering each request in turn; hands back the request bodies.
    async fn puter_mock(replies: Vec<(&'static str, &'static str, Vec<u8>)>) -> (String, tokio::task::JoinHandle<Vec<String>>) {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let seen = tokio::spawn(async move {
            let mut seen = Vec::new();
            for (status, content_type, body) in replies {
                let (mut sock, _) = listener.accept().await.unwrap();
                let mut req = Vec::new();
                let mut buf = [0u8; 16384];
                loop {
                    let n = sock.read(&mut buf).await.unwrap();
                    req.extend_from_slice(&buf[..n]);
                    let text = String::from_utf8_lossy(&req).to_string();
                    if let Some(end) = text.find("\r\n\r\n") {
                        let len = text[..end]
                            .lines()
                            .find_map(|l| l.to_ascii_lowercase().strip_prefix("content-length:").map(|v| v.trim().parse::<usize>().unwrap()))
                            .unwrap_or(0);
                        if req.len() >= end + 4 + len {
                            seen.push(text);
                            break;
                        }
                    }
                }
                // A JSON reply may link back here: `{BASE}` is this server.
                let body = if content_type.contains("json") {
                    String::from_utf8_lossy(&body).replace("{BASE}", &format!("http://{addr}")).into_bytes()
                } else {
                    body
                };
                let head = format!("HTTP/1.1 {status}\r\ncontent-type: {content_type}\r\ncontent-length: {}\r\nconnection: close\r\n\r\n", body.len());
                sock.write_all(head.as_bytes()).await.unwrap();
                sock.write_all(&body).await.unwrap();
                let _ = sock.shutdown().await;
            }
            seen
        });
        (format!("http://{addr}"), seen)
    }

    #[tokio::test]
    async fn puter_makes_pictures_and_clips_through_its_driver_route() {
        let png = [&[0x89u8, b'P', b'N', b'G'][..], &[7u8; 200][..]].concat();
        let (base, seen) = puter_mock(vec![
            ("200 OK", "image/png", png.clone()),
            ("200 OK", "image/png", png.clone()),
        ])
        .await;
        let reference = Reference { mime: "image/png".into(), bytes: vec![1, 2, 3], name: "a.png".into() };
        let job = Job {
            kind: Kind::Image,
            prompt: "a cat",
            model: Some("gpt-image-2"),
            aspect_ratio: Some("1:1"),
            count: 2,
            base_url: Some(&base),
            references: std::slice::from_ref(&reference),
            ..Default::default()
        };
        let out = generate_with(Provider::Puter, "tok", &job).await.unwrap();
        assert_eq!(out.files.len(), 2);
        let seen = seen.await.unwrap();
        assert!(seen[0].starts_with("POST /drivers/call "), "{}", seen[0]);
        let sent: Value = serde_json::from_str(seen[0].split("\r\n\r\n").nth(1).unwrap()).unwrap();
        assert_eq!(sent["interface"], "puter-image-generation");
        assert_eq!(sent["method"], "generate");
        assert_eq!(sent["args"]["model"], "gpt-image-2");
        assert_eq!(sent["args"]["aspect_ratio"], "1:1");
        assert_eq!(sent["args"]["input_images"][0], "data:image/png;base64,AQID");

        // A clip answered with a link to it, fetched without the token (not Puter's host).
        let link = br#"{"success":true,"result":{"asset_url":"{BASE}/clip.mp4"}}"#.to_vec();
        let mp4 = vec![0u8; 2048];
        let (base, seen) = puter_mock(vec![("200 OK", "application/json", link), ("200 OK", "video/mp4", mp4)]).await;
        let job = Job {
            kind: Kind::Video,
            prompt: "a fox",
            model: Some("veo-3.1-lite"),
            aspect_ratio: Some("9:16"),
            duration_seconds: Some(4),
            base_url: Some(&base),
            ..Default::default()
        };
        let out = generate_with(Provider::Puter, "tok", &job).await.unwrap();
        assert_eq!(out.files.len(), 1);
        let seen = seen.await.unwrap();
        let sent: Value = serde_json::from_str(seen[0].split("\r\n\r\n").nth(1).unwrap()).unwrap();
        assert_eq!(sent["interface"], "puter-video-generation");
        assert_eq!(sent["args"]["size"], "720x1280");
        assert_eq!(sent["args"]["seconds"], 4);
        assert!(seen[1].starts_with("GET /clip.mp4 "), "{}", seen[1]);
        assert!(!seen[1].to_ascii_lowercase().contains("authorization"), "the token stays with Puter");
    }

    #[tokio::test]
    async fn puter_says_why_it_said_no() {
        let refusal = br#"{"error":"A subscription is required","message":"No usage left for request.","code":"insufficient_funds"}"#.to_vec();
        let (base, _) = puter_mock(vec![("402 Payment Required", "application/json", refusal)]).await;
        let job = Job { kind: Kind::Video, prompt: "a fox", model: Some("veo-3.1-lite"), base_url: Some(&base), ..Default::default() };
        let err = generate_with(Provider::Puter, "tok", &job).await.err().unwrap();
        assert!(err.contains("402") && err.contains("No usage left"), "{err}");

        let envelope = br#"{"success":false,"error":{"code":"email_must_be_confirmed","message":"Confirm your email first."}}"#.to_vec();
        let (base, _) = puter_mock(vec![("200 OK", "application/json", envelope)]).await;
        let job = Job { kind: Kind::Image, prompt: "a cat", base_url: Some(&base), ..Default::default() };
        let err = generate_with(Provider::Puter, "tok", &job).await.err().unwrap();
        assert_eq!(err, "Puter: Confirm your email first.");
    }
}
