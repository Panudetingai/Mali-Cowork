//! Thin HTTP client for the local `opencode serve` API.

use std::time::Duration;

use reqwest::{Method, RequestBuilder, Response};
use serde_json::{json, Value};

use super::instances;

const USERNAME: &str = "opencode";
const SHORT_TIMEOUT: Duration = Duration::from_secs(15);
const MCP_TIMEOUT: Duration = Duration::from_secs(90);
/// Time the user has to finish signing in to an MCP server in the browser.
const MCP_AUTH_TIMEOUT: Duration = Duration::from_secs(300);
/// A busy server (starting MCP servers, a hot CPU) can take a few seconds to
/// answer; too short a limit makes a healthy server look dead.
const HEALTH_TIMEOUT: Duration = Duration::from_secs(5);

/// Per-prompt settings beyond the text itself.
#[derive(Default)]
pub struct PromptOptions<'a> {
    /// `provider/model`; the server default when `None`.
    pub model: Option<&'a str>,
    /// Tools the agent may not call for this prompt; `name` or `prefix_*`.
    pub disabled_tools: Vec<String>,
    /// Extra system instructions.
    pub system: Option<String>,
    /// Attached pictures and documents, as opencode `file` parts.
    pub files: Vec<Value>,
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

    /// A request to one folder's instance (the server's default one when
    /// `directory` is `None`), which marks that instance as in use.
    fn request(&self, method: Method, path: &str, directory: Option<&str>) -> RequestBuilder {
        if !path.starts_with("/global/") && !path.starts_with("/auth/") {
            instances::touch(directory.unwrap_or(instances::DEFAULT));
        }
        self.untracked(method, path, directory)
    }

    fn untracked(&self, method: Method, path: &str, directory: Option<&str>) -> RequestBuilder {
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
            .timeout(HEALTH_TIMEOUT);
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

    /// `GET /config/providers` — the providers this directory's instance can
    /// actually use (those with credentials), with their models.
    pub async fn usable_providers(&self, directory: &str) -> Result<Value, String> {
        let req = self
            .request(Method::GET, "/config/providers", Some(directory))
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
        let mut parts = vec![json!({ "type": "text", "text": text })];
        parts.extend(options.files.iter().cloned());
        let mut body = json!({ "parts": parts });
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

    /// `POST /instance/dispose` — close a folder's instance and the MCP
    /// servers it started. The next request to the folder opens a new one.
    pub async fn dispose_instance(&self, directory: Option<&str>) -> Result<(), String> {
        let req = self
            .untracked(Method::POST, "/instance/dispose", directory)
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

    /// Questions still waiting for an answer in this folder.
    pub async fn pending_questions(&self, directory: &str) -> Result<Vec<Value>, String> {
        let req = self
            .request(Method::GET, "/question", Some(directory))
            .timeout(SHORT_TIMEOUT);
        let body: Value = Self::send(req).await?.json().await.map_err(|e| e.to_string())?;
        Ok(body.as_array().cloned().unwrap_or_default())
    }

    /// Answer the agent's question: one list of chosen labels per question, in
    /// the order they were asked. An empty list withdraws the question instead,
    /// which lets the agent carry on without an answer.
    pub async fn reply_question(
        &self,
        directory: &str,
        request_id: &str,
        answers: &[Vec<String>],
    ) -> Result<(), String> {
        let req = if answers.is_empty() {
            // `reject` takes no body.
            self.request(Method::POST, &format!("/question/{request_id}/reject"), Some(directory))
        } else {
            self.request(Method::POST, &format!("/question/{request_id}/reply"), Some(directory))
                .json(&json!({ "answers": answers }))
        };
        Self::send(req.timeout(SHORT_TIMEOUT)).await.map(|_| ())
    }

    /// Every tool the model would be offered in this folder, with its input
    /// schema, as `(name, schema)`.
    pub async fn tools(
        &self,
        directory: &str,
        provider_id: &str,
        model_id: &str,
    ) -> Result<Vec<(String, Value)>, String> {
        let req = self
            .request(Method::GET, "/experimental/tool", Some(directory))
            .query(&[("provider", provider_id), ("model", model_id)])
            .timeout(SHORT_TIMEOUT);
        let body: Value = Self::send(req).await?.json().await.map_err(|e| e.to_string())?;
        Ok(body
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|tool| {
                let id = tool["id"].as_str()?.to_string();
                Some((id, tool["parameters"].clone()))
            })
            .collect())
    }

    /// MCP servers registered for a workspace (or global when `directory` is `None`).
    pub async fn mcp_status(&self, directory: Option<&str>) -> Result<Value, String> {
        let req = self
            .request(Method::GET, "/mcp", directory)
            .timeout(MCP_TIMEOUT);
        Self::send(req).await?.json().await.map_err(|e| e.to_string())
    }

    pub async fn mcp_add(
        &self,
        directory: Option<&str>,
        name: &str,
        config: &Value,
    ) -> Result<Value, String> {
        let req = self
            .request(Method::POST, "/mcp", directory)
            .json(&json!({ "name": name, "config": config }))
            .timeout(MCP_TIMEOUT);
        Self::send(req).await?.json().await.map_err(|e| e.to_string())
    }

    pub async fn mcp_connect(&self, directory: Option<&str>, name: &str) -> Result<(), String> {
        let req = self
            .request(Method::POST, &format!("/mcp/{name}/connect"), directory)
            .timeout(MCP_TIMEOUT);
        Self::send(req).await.map(|_| ())
    }

    /// `POST /mcp/{name}/auth/authenticate` — OpenCode opens the sign-in page
    /// in the browser, waits for the OAuth callback on loopback and stores
    /// the tokens in its own owner-only auth file. Returns the new status.
    pub async fn mcp_authenticate(&self, directory: Option<&str>, name: &str) -> Result<Value, String> {
        let req = self
            .request(Method::POST, &format!("/mcp/{name}/auth/authenticate"), directory)
            .timeout(MCP_AUTH_TIMEOUT);
        Self::send(req).await?.json().await.map_err(|e| e.to_string())
    }

    /// `POST /mcp/{name}/auth` — start OAuth without opening a browser:
    /// returns `authorizationUrl` (empty when already signed in) and `oauthState`.
    pub async fn mcp_auth_start(&self, directory: Option<&str>, name: &str) -> Result<Value, String> {
        let req = self
            .request(Method::POST, &format!("/mcp/{name}/auth"), directory)
            .timeout(MCP_TIMEOUT);
        Self::send(req).await?.json().await.map_err(|e| e.to_string())
    }

    /// `POST /mcp/{name}/auth/callback` — finish OAuth with the code the browser brought back.
    pub async fn mcp_auth_callback(&self, directory: Option<&str>, name: &str, code: &str) -> Result<Value, String> {
        let req = self
            .request(Method::POST, &format!("/mcp/{name}/auth/callback"), directory)
            .json(&json!({ "code": code }))
            .timeout(MCP_TIMEOUT);
        Self::send(req).await?.json().await.map_err(|e| e.to_string())
    }

    /// `DELETE /mcp/{name}/auth` — forget the OAuth tokens (sign out).
    pub async fn mcp_auth_remove(&self, directory: Option<&str>, name: &str) -> Result<(), String> {
        let req = self
            .request(Method::DELETE, &format!("/mcp/{name}/auth"), directory)
            .timeout(SHORT_TIMEOUT);
        Self::send(req).await.map(|_| ())
    }

    pub async fn mcp_disconnect(&self, directory: Option<&str>, name: &str) -> Result<(), String> {
        let req = self
            .request(Method::POST, &format!("/mcp/{name}/disconnect"), directory)
            .timeout(MCP_TIMEOUT);
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
