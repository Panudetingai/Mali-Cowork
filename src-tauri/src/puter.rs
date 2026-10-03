//! Puter (https://puter.com): one account and auth token, many vendors' models.
//!
//! Everything goes through `POST /drivers/call`, the route puter.js itself
//! uses. Puter's OpenAI-compatible endpoint is for paid plans only (free
//! accounts get 402 `subscription_required` there); this route takes the same
//! dashboard token on the free plan too. A call names an interface, a driver
//! and a method — chat, pictures and clips are three of them, and another
//! (speech, OCR) is one more `call`.
//!
//! Which models exist comes from Puter's public lists (`models`), not from
//! this code: Puter adds and retires models faster than releases go out.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::{json, Value};

pub const API: &str = "https://api.puter.com";

/// One Puter capability: the interface and driver puter.js names for it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Service {
    Chat,
    Image,
    Video,
    /// Speech to text (`puter.ai.speech2txt`).
    Transcribe,
    /// Text to speech (`puter.ai.txt2speech`).
    Speak,
}

impl Service {
    fn interface(self) -> &'static str {
        match self {
            Service::Chat => "puter-chat-completion",
            Service::Image => "puter-image-generation",
            Service::Video => "puter-video-generation",
            Service::Transcribe => "puter-speech2txt",
            Service::Speak => "puter-tts",
        }
    }

    fn driver(self) -> &'static str {
        match self {
            Service::Chat => "ai-chat",
            Service::Image => "ai-image",
            Service::Video => "ai-video",
            Service::Transcribe => "ai-speech2txt",
            Service::Speak => "ai-tts",
        }
    }

    /// The public list of this service's models, where Puter has one.
    fn models_path(self) -> Option<&'static str> {
        match self {
            Service::Chat => Some("/puterai/chat/models/details"),
            Service::Image => Some("/puterai/image/models/details"),
            Service::Video => Some("/puterai/video/models/details"),
            Service::Transcribe | Service::Speak => None,
        }
    }

    pub fn parse(kind: &str) -> Option<Self> {
        match kind {
            "chat" => Some(Service::Chat),
            "image" => Some(Service::Image),
            "video" => Some(Service::Video),
            _ => None,
        }
    }
}

/// Puter's API root from a saved URL — any path on it (the OpenAI endpoint's,
/// saved before this route was used) comes down to the host.
pub fn origin(base_url: Option<&str>) -> String {
    base_url
        .and_then(|url| reqwest::Url::parse(url.trim()).ok())
        .and_then(|url| {
            let host = url.host_str()?.to_string();
            Some(format!("{}://{host}{}", url.scheme(), url.port().map(|p| format!(":{p}")).unwrap_or_default()))
        })
        .unwrap_or_else(|| API.to_string())
}

/// `method` of `service` with `args`, as a request ready to send.
pub fn call(
    client: &reqwest::Client,
    base_url: Option<&str>,
    token: &str,
    service: Service,
    method: &str,
    args: &Value,
) -> reqwest::RequestBuilder {
    let mut body = json!({
        "interface": service.interface(),
        "driver": service.driver(),
        "method": method,
        "args": args,
        "auth_token": token,
    });
    // A sample instead of a real generation, free: for checking a setup.
    if matches!(service, Service::Image | Service::Video) && std::env::var("PUTER_TEST_MODE").is_ok_and(|v| v == "1") {
        body["test_mode"] = json!(true);
    }
    client
        .post(format!("{}/drivers/call", origin(base_url)))
        .bearer_auth(token)
        // What puter.js sends; Puter reads it as JSON.
        .header(reqwest::header::CONTENT_TYPE, "text/plain;actually=json")
        .body(body.to_string())
}

/// Why Puter turned a call down, from its JSON envelope (sent with 200 as
/// often as with an error status), or `None` when it didn't.
pub fn refusal(value: &Value) -> Option<String> {
    let error = value.get("error").filter(|e| !e.is_null());
    if value["success"] != json!(false) && error.is_none() {
        return None;
    }
    let error = error.unwrap_or(&Value::Null);
    let message = error["message"]
        .as_str()
        .or(value["message"].as_str())
        .or(error.as_str())
        .unwrap_or("Puter turned the request down.");
    Some(message.to_string())
}

// ── model lists ──

/// A Puter model, as the app needs it.
#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Model {
    pub id: String,
    pub name: String,
    /// Chat: it can call tools (needed for Cowork).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_call: Option<bool>,
    /// Chat: it can see pictures.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vision: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context: Option<u64>,
    /// Pictures and clips: it starts from a picture.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub image_input: Option<bool>,
    /// Clips: the lengths it makes.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub durations: Vec<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub release_date: Option<String>,
}

fn model_of(raw: &Value) -> Option<Model> {
    let id = raw["id"].as_str().filter(|s| !s.trim().is_empty())?.to_string();
    let inputs = raw["modalities"]["input"].as_array();
    Some(Model {
        name: raw["name"].as_str().filter(|s| !s.trim().is_empty()).unwrap_or(&id).to_string(),
        tool_call: raw["tool_call"].as_bool(),
        vision: inputs.map(|i| i.iter().any(|m| m == "image")),
        context: raw["context"].as_u64(),
        image_input: raw["supportsImageInput"].as_bool(),
        durations: raw["durationSeconds"]
            .as_array()
            .map(|d| d.iter().filter_map(|s| s.as_u64().map(|s| s as u32)).collect())
            .unwrap_or_default(),
        release_date: raw["release_date"].as_str().map(str::to_string),
        id,
    })
}

/// A copy of a model Puter resells through another gateway, named with the
/// gateway first (`openrouter:openai/gpt-5`, `infron:…`). Puter's chat list
/// holds most models several times over this way, without saying whether they
/// can call tools; the model's own entry (`gpt-5`) does.
fn resold(id: &str) -> bool {
    id.split_once(':').is_some_and(|(gateway, rest)| {
        !gateway.is_empty() && !rest.is_empty() && gateway.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
    })
}

/// The models in a list reply, newest first. For chat, only each model's own
/// entry: its resold copies would bury it (847 of 1,046 in October 2026).
fn parse_models(body: &Value, service: Service) -> Vec<Model> {
    let list = body["models"].as_array().or(body.as_array());
    let mut models: Vec<Model> = list
        .into_iter()
        .flatten()
        .filter_map(model_of)
        // Pictures and clips: some exist only through a gateway (`togetherai:…`), so all stay.
        .filter(|m| service != Service::Chat || !resold(&m.id))
        .collect();
    // Undated ones last, in Puter's own order.
    models.sort_by(|a, b| b.release_date.is_some().cmp(&a.release_date.is_some()).then(b.release_date.cmp(&a.release_date)));
    models
}

/// Kept this long, so opening the picker doesn't call Puter each time.
const KEEP_LIST: Duration = Duration::from_secs(60 * 60);

fn lists() -> &'static Mutex<HashMap<(String, &'static str), (Instant, Vec<Model>)>> {
    static LISTS: std::sync::OnceLock<Mutex<HashMap<(String, &'static str), (Instant, Vec<Model>)>>> =
        std::sync::OnceLock::new();
    LISTS.get_or_init(Default::default)
}

/// The models Puter offers for `service` right now. Public: no token needed.
pub async fn models(base_url: Option<&str>, service: Service) -> Result<Vec<Model>, String> {
    let root = origin(base_url);
    let key = (root.clone(), service.interface());
    if let Some((at, models)) = lists().lock().unwrap().get(&key) {
        if at.elapsed() < KEEP_LIST {
            return Ok(models.clone());
        }
    }
    let path = service.models_path().ok_or("Puter has no public list of these models.")?;
    let response = reqwest::Client::new()
        .get(format!("{root}{path}"))
        .timeout(Duration::from_secs(15))
        .send()
        .await
        .map_err(|e| format!("Cannot reach Puter for its model list: {e}"))?;
    if !response.status().is_success() {
        return Err(format!("Puter's model list answered {}", response.status()));
    }
    let body: Value = response.json().await.map_err(|e| format!("Puter's model list: {e}"))?;
    let models = parse_models(&body, service);
    if models.is_empty() {
        return Err("Puter's model list came back empty.".into());
    }
    lists().lock().unwrap().insert(key, (Instant::now(), models.clone()));
    Ok(models)
}

/// The models Puter offers: `kind` is `chat`, `image` or `video`.
#[tauri::command]
pub async fn puter_models(kind: String, base_url: Option<String>) -> Result<Vec<Model>, String> {
    let service = Service::parse(&kind).ok_or_else(|| format!("Unknown kind of Puter model: {kind}"))?;
    models(base_url.as_deref(), service).await
}

// ── account ──

/// Whose Puter account a token is, and whether it can use AI yet.
#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    pub username: String,
    /// Puter refuses AI until the account's email is confirmed.
    pub needs_email: bool,
    /// A guest account Puter made without a sign-up; it can lose its credits.
    pub temporary: bool,
}

fn account_of(body: &Value) -> Option<Account> {
    let username = body["username"].as_str().filter(|u| !u.trim().is_empty())?.to_string();
    let confirmed = body["email_confirmed"].as_bool().unwrap_or(true);
    Some(Account {
        username,
        needs_email: !confirmed && body["requires_email_confirmation"].as_bool().unwrap_or(false),
        temporary: body["is_temp"].as_bool().unwrap_or(false),
    })
}

/// The account behind `token`, or why Puter didn't accept it.
pub async fn account(base_url: Option<&str>, token: &str) -> Result<Account, String> {
    let response = reqwest::Client::new()
        .get(format!("{}/whoami", origin(base_url)))
        .bearer_auth(token.trim())
        .timeout(Duration::from_secs(15))
        .send()
        .await
        .map_err(|e| format!("Cannot reach Puter: {e}"))?;
    let status = response.status();
    if matches!(status.as_u16(), 401 | 403) {
        return Err("Puter didn't accept this token. Sign in again, or copy a new one from puter.com/dashboard.".into());
    }
    if !status.is_success() {
        return Err(format!("Puter answered {status}."));
    }
    let body: Value = response.json().await.map_err(|e| format!("Puter: {e}"))?;
    account_of(&body).ok_or_else(|| "Puter didn't say whose token this is.".into())
}

#[tauri::command]
pub async fn puter_account(token: String, base_url: Option<String>) -> Result<Account, String> {
    account(base_url.as_deref(), &token).await
}

/// A finished "Sign in with Puter".
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SignIn {
    pub token: String,
    pub account: Account,
}

/// The sign-in's id with the loopback callback (one sign-in waits at a time).
const SIGN_IN_ID: &str = "puter";

/// Where Puter's own pages are, for an API root: `api.puter.com` → `puter.com`.
fn gui_origin(base_url: Option<&str>) -> String {
    let api = origin(base_url);
    match api.split_once("://api.") {
        Some((scheme, host)) => format!("{scheme}://{host}"),
        None => "https://puter.com".into(),
    }
}

/// Sign in with Puter in the browser (its AuthMe flow, what puter.js's
/// `getAuthToken` does): Puter asks the user to allow Mali, then sends a
/// restricted API token — the kind puter.com/dashboard makes, which can't
/// change the account — to the loopback. The token is checked before it's
/// handed back.
#[tauri::command]
pub async fn puter_sign_in(app: tauri::AppHandle, base_url: Option<String>) -> Result<SignIn, String> {
    use tauri_plugin_opener::OpenerExt;
    use crate::commands::mcp_oauth::{listen, CALLBACK_PORT};

    let mut callback = listen(SIGN_IN_ID).await?;
    // Puter echoes no `state`, so the path is this sign-in's own.
    let path = format!("/puter/callback/{}", uuid::Uuid::new_v4().simple());
    let redirect = format!("http://127.0.0.1:{CALLBACK_PORT}{path}");
    let mut url = reqwest::Url::parse(&gui_origin(base_url.as_deref())).map_err(|e| e.to_string())?;
    url.query_pairs_mut().append_pair("action", "authme").append_pair("redirectURL", &redirect);
    app.opener()
        .open_url(url.as_str(), None::<&str>)
        .map_err(|e| format!("Couldn't open the browser: {e}"))?;
    let token = callback.wait_token(&path, "Puter").await?;
    let account = account(base_url.as_deref(), &token).await?;
    Ok(SignIn { token, account })
}

/// Stop waiting for a sign-in the user gave up on.
#[tauri::command]
pub fn puter_sign_in_cancel() {
    crate::commands::mcp_oauth::mcp_auth_cancel(SIGN_IN_ID.into());
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn origin_keeps_only_the_host() {
        assert_eq!(origin(Some("https://api.puter.com/puterai/openai/v1")), API);
        assert_eq!(origin(Some("http://127.0.0.1:9000/x")), "http://127.0.0.1:9000");
        assert_eq!(origin(None), API);
        assert_eq!(origin(Some("not a url")), API);
    }

    #[test]
    fn refusals_come_in_either_envelope() {
        assert_eq!(refusal(&json!({"success": true, "result": {}})), None);
        assert_eq!(refusal(&json!({"result": "x"})), None);
        assert_eq!(
            refusal(&json!({"success": false, "error": {"message": "No usage left for request."}})).as_deref(),
            Some("No usage left for request.")
        );
        assert_eq!(
            refusal(&json!({"error": "Authentication failed", "message": "Authentication failed"})).as_deref(),
            Some("Authentication failed")
        );
    }

    #[test]
    fn model_lists_read_what_the_app_uses_newest_first() {
        let body = json!({"models": [
            {"id": "old-chat", "name": "Old", "tool_call": false, "context": 8000, "release_date": "2024-01-01"},
            {"id": "undated"},
            {"id": "new-chat", "name": "New", "tool_call": true, "context": 200000, "release_date": "2026-09-01",
             "modalities": {"input": ["text", "image"], "output": ["text"]}},
            {"id": "veo", "name": "Veo", "supportsImageInput": true, "durationSeconds": [4, 6, 8]},
            {"name": "no id"},
        ]});
        let models = parse_models(&body, Service::Video);
        let ids: Vec<&str> = models.iter().map(|m| m.id.as_str()).collect();
        assert_eq!(ids, ["new-chat", "old-chat", "undated", "veo"]);
        assert_eq!(models[0].vision, Some(true));
        assert_eq!(models[0].tool_call, Some(true));
        assert_eq!(models[2].name, "undated");
        assert_eq!(models[3].durations, [4, 6, 8]);
        assert_eq!(models[3].image_input, Some(true));
    }

    #[test]
    fn accounts_say_what_stands_in_the_way() {
        let ok = account_of(&json!({"username": "ann", "email_confirmed": true, "is_temp": false})).unwrap();
        assert_eq!(ok, Account { username: "ann".into(), needs_email: false, temporary: false });
        let unconfirmed = account_of(&json!({"username": "bo", "email_confirmed": false, "requires_email_confirmation": true})).unwrap();
        assert!(unconfirmed.needs_email);
        assert!(account_of(&json!({"email_confirmed": true})).is_none());
        assert_eq!(gui_origin(None), "https://puter.com");
        assert_eq!(gui_origin(Some("http://api.puter.localhost:4100")), "http://puter.localhost:4100");
    }

    #[test]
    fn chat_lists_leave_out_resold_copies() {
        let body = json!({"models": [
            {"id": "gpt-5.4-nano", "tool_call": true},
            {"id": "openrouter:openai/gpt-5.4-nano"},
            {"id": "infron:anthropic/claude-sonnet-5"},
            {"id": "togetherai:wan-ai/wan2.7-t2v"},
            {"id": "@cf/black-forest-labs/flux-1-schnell"},
        ]});
        let chat: Vec<String> = parse_models(&body, Service::Chat).into_iter().map(|m| m.id).collect();
        assert_eq!(chat, ["gpt-5.4-nano", "@cf/black-forest-labs/flux-1-schnell"]);
        // Clips only some gateways make stay.
        assert_eq!(parse_models(&body, Service::Video).len(), 5);
    }
}
