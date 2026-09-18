//! Thin HTTP client for the local `opencode serve` API.

use std::time::Duration;

use reqwest::{Method, RequestBuilder, Response};
use serde_json::{json, Value};

const USERNAME: &str = "opencode";
const SHORT_TIMEOUT: Duration = Duration::from_secs(15);

/// Per-prompt settings beyond the text itself.
#[derive(Default)]
pub struct PromptOptions<'a> {
    /// `provider/model`; the server default when `None`.
    pub model: Option<&'a str>,
    /// Tools the agent may not call for this prompt.
    pub disabled_tools: &'a [&'a str],
    /// Extra system instructions.
    pub system: Option<String>,
}

#[derive(Clone)]
pub struct OpencodeClient {
    http: reqwest::Client,
    base_url: String,
    password: String,
}

impl OpencodeClient {
    pub fn new(base_url: String, password: String) -> Self {
        let http = reqwest::Client::builder()
            .no_proxy()
            .build()
            .expect("failed to build HTTP client");
        Self {
            http,
            base_url: base_url.trim_end_matches('/').to_string(),
            password,
        }
    }

    fn request(&self, method: Method, path: &str, directory: Option<&str>) -> RequestBuilder {
        let mut req = self
            .http
            .request(method, format!("{}{}", self.base_url, path))
            .basic_auth(USERNAME, Some(&self.password));
        if let Some(dir) = directory {
            req = req.query(&[("directory", dir)]);
        }
        req
    }

    async fn send(req: RequestBuilder) -> Result<Response, String> {
        let res = req.send().await.map_err(|e| e.to_string())?;
        if res.status().is_success() {
            return Ok(res);
        }
        let status = res.status();
        let body = res.text().await.unwrap_or_default();
        Err(format!("opencode server returned {status}: {body}"))
    }

    /// Returns the server version.
    pub async fn health(&self) -> Result<String, String> {
        let req = self
            .request(Method::GET, "/global/health", None)
            .timeout(Duration::from_secs(2));
        let body: Value = Self::send(req).await?.json().await.map_err(|e| e.to_string())?;
        Ok(body["version"].as_str().unwrap_or_default().to_string())
    }

    /// `GET /provider` — every known provider plus the ids that have credentials.
    pub async fn all_providers(&self, directory: &str) -> Result<Value, String> {
        let req = self
            .request(Method::GET, "/provider", Some(directory))
            .timeout(SHORT_TIMEOUT);
        Self::send(req).await?.json().await.map_err(|e| e.to_string())
    }

    /// `PUT /auth/{provider}` — store an API key in opencode's auth file.
    pub async fn set_api_key(&self, provider_id: &str, key: &str) -> Result<(), String> {
        let req = self
            .request(Method::PUT, &format!("/auth/{provider_id}"), None)
            .json(&json!({ "type": "api", "key": key }))
            .timeout(SHORT_TIMEOUT);
        Self::send(req).await.map(|_| ())
    }

    pub async fn delete_session(&self, directory: &str, session_id: &str) -> Result<(), String> {
        let req = self
            .request(Method::DELETE, &format!("/session/{session_id}"), Some(directory))
            .timeout(SHORT_TIMEOUT);
        Self::send(req).await.map(|_| ())
    }

    /// Returns true if the session exists in this directory.
    pub async fn session_exists(&self, directory: &str, session_id: &str) -> bool {
        let req = self
            .request(Method::GET, &format!("/session/{session_id}"), Some(directory))
            .timeout(SHORT_TIMEOUT);
        Self::send(req).await.is_ok()
    }

    /// Creates a session and returns its id.
    pub async fn create_session(&self, directory: &str) -> Result<String, String> {
        let req = self
            .request(Method::POST, "/session", Some(directory))
            .json(&json!({}))
            .timeout(SHORT_TIMEOUT);
        let body: Value = Self::send(req).await?.json().await.map_err(|e| e.to_string())?;
        body["id"]
            .as_str()
            .map(str::to_string)
            .ok_or_else(|| "opencode server did not return a session id".into())
    }

    /// Queues a prompt; progress arrives on the event stream.
    pub async fn prompt_async(
        &self,
        directory: &str,
        session_id: &str,
        text: &str,
        options: &PromptOptions<'_>,
    ) -> Result<(), String> {
        let mut body = json!({ "parts": [{ "type": "text", "text": text }] });
        if let Some((provider_id, model_id)) = options.model.and_then(|m| m.split_once('/')) {
            body["model"] = json!({ "providerID": provider_id, "modelID": model_id });
        }
        if !options.disabled_tools.is_empty() {
            let tools: serde_json::Map<String, Value> = options
                .disabled_tools
                .iter()
                .map(|tool| (tool.to_string(), Value::Bool(false)))
                .collect();
            body["tools"] = Value::Object(tools);
        }
        if let Some(system) = options.system.as_deref() {
            body["system"] = json!(system);
        }
        let req = self
            .request(Method::POST, &format!("/session/{session_id}/prompt_async"), Some(directory))
            .json(&body)
            .timeout(SHORT_TIMEOUT);
        Self::send(req).await.map(|_| ())
    }

    pub async fn abort(&self, directory: &str, session_id: &str) -> Result<(), String> {
        let req = self
            .request(Method::POST, &format!("/session/{session_id}/abort"), Some(directory))
            .timeout(SHORT_TIMEOUT);
        Self::send(req).await.map(|_| ())
    }

    /// Replace the session's permission rules (later rules win).
    pub async fn set_permissions(
        &self,
        directory: &str,
        session_id: &str,
        rules: Vec<Value>,
    ) -> Result<(), String> {
        let req = self
            .request(Method::PATCH, &format!("/session/{session_id}"), Some(directory))
            .json(&json!({ "permission": rules }))
            .timeout(SHORT_TIMEOUT);
        Self::send(req).await.map(|_| ())
    }

    /// Touch a directory so opencode loads its config and plugins now
    /// instead of during the first prompt.
    pub async fn warm(&self, directory: &str) -> Result<(), String> {
        let req = self
            .request(Method::GET, "/agent", Some(directory))
            .timeout(SHORT_TIMEOUT);
        Self::send(req).await.map(|_| ())
    }

    /// `reply` is one of `once`, `always`, `reject`; `message` tells the agent why.
    pub async fn reply_permission(
        &self,
        directory: &str,
        request_id: &str,
        reply: &str,
        message: Option<&str>,
    ) -> Result<(), String> {
        let mut body = json!({ "reply": reply });
        if let Some(message) = message {
            body["message"] = json!(message);
        }
        let req = self
            .request(Method::POST, &format!("/permission/{request_id}/reply"), Some(directory))
            .json(&body)
            .timeout(SHORT_TIMEOUT);
        Self::send(req).await.map(|_| ())
    }

    /// Opens the server-sent event stream scoped to a directory.
    pub async fn events(&self, directory: &str) -> Result<Response, String> {
        let req = self
            .request(Method::GET, "/event", Some(directory))
            .header("accept", "text/event-stream");
        Self::send(req).await
    }
}
