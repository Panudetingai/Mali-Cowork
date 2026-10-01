//! Mali as the MCP hub: Mali alone connects to the user's connectors — local
//! servers through the sandbox runner, remote ones with Mali's own sign-in —
//! and hands their tools to whoever works inside Mali. Nothing is written into
//! another app's config for this.
//!
//! Connections are kept and reused while a server's settings stay the same;
//! a changed setting, a stopped process or a sign-in starts a fresh one.

pub mod client;
pub mod gateway;
mod patience;

use std::collections::HashMap;
use std::sync::{Arc, OnceLock};

use serde_json::Value;

use crate::commands::mcp::{failure_message, McpServerEntry, McpServerStatus};
use client::{Conn, NEEDS_AUTH};

/// Servers that only exist for OpenCode: Mali's agent has its own file and shell tools.
pub const AGENT_ONLY_ELSEWHERE: &[&str] = &["filesystem", "exec"];
/// Provider limit on tool names.
const MAX_TOOL_NAME: usize = 64;

/// The user's connectors as the app last sent them; what the `mali` gateway offers CLIs.
fn servers_store() -> &'static std::sync::Mutex<Vec<McpServerEntry>> {
    static SERVERS: OnceLock<std::sync::Mutex<Vec<McpServerEntry>>> = OnceLock::new();
    SERVERS.get_or_init(Default::default)
}

pub fn set_servers(servers: Vec<McpServerEntry>) {
    *servers_store().lock().unwrap() = servers;
}

pub fn current_servers() -> Vec<McpServerEntry> {
    servers_store().lock().unwrap().clone()
}

/// The Cowork folder a CLI agent is working in, and the folders the chat may
/// use: where the gateway's document tools read and write.
#[derive(Clone, Default)]
pub struct Workspace {
    pub cwd: Option<String>,
    pub folders: Vec<crate::agent::paths::FolderGrant>,
}

fn workspace_store() -> &'static std::sync::Mutex<Workspace> {
    static WORKSPACE: OnceLock<std::sync::Mutex<Workspace>> = OnceLock::new();
    WORKSPACE.get_or_init(Default::default)
}

pub fn set_workspace(workspace: Workspace) {
    *workspace_store().lock().unwrap() = workspace;
}

/// The folders the gateway may touch, or why it can't.
pub fn workspace_scope() -> Result<crate::agent::paths::Scope, String> {
    let workspace = workspace_store().lock().unwrap().clone();
    let cwd = workspace
        .cwd
        .filter(|c| !c.trim().is_empty())
        .ok_or("Document tools work in Cowork mode: open a Cowork chat with a folder, then ask again.")?;
    crate::agent::paths::Scope::new(&cwd, &workspace.folders)
}

/// The connectors the gateway offers right now, by id.
pub fn offered_ids() -> Vec<String> {
    servers_store()
        .lock()
        .unwrap()
        .iter()
        .filter(|s| s.enabled && !AGENT_ONLY_ELSEWHERE.contains(&s.id.as_str()))
        .map(|s| s.id.clone())
        .collect()
}

struct Cached {
    key: String,
    conn: Arc<Conn>,
}

fn cache() -> &'static tokio::sync::Mutex<HashMap<String, Cached>> {
    static CACHE: OnceLock<tokio::sync::Mutex<HashMap<String, Cached>>> = OnceLock::new();
    CACHE.get_or_init(Default::default)
}

/// One connect at a time per server, so two chats never start it twice.
fn connect_lock(id: &str) -> Arc<tokio::sync::Mutex<()>> {
    static LOCKS: OnceLock<std::sync::Mutex<HashMap<String, Arc<tokio::sync::Mutex<()>>>>> = OnceLock::new();
    LOCKS.get_or_init(Default::default).lock().unwrap().entry(id.to_string()).or_default().clone()
}

/// Everything that decides how a server is started or reached.
fn key_of(server: &McpServerEntry) -> String {
    let sorted = |map: &HashMap<String, String>| {
        let mut pairs: Vec<_> = map.iter().collect();
        pairs.sort();
        format!("{pairs:?}")
    };
    format!(
        "{}|{}|{:?}|{:?}|{}|{:?}|{}|{:?}",
        server.id,
        server.kind,
        server.command,
        server.fallbacks,
        sorted(&server.environment),
        server.url,
        sorted(&server.headers),
        server.trust_level,
    )
}

/// A live connection to `server`, reused when nothing about it changed.
pub async fn connection(server: &McpServerEntry) -> Result<Arc<Conn>, String> {
    let key = key_of(server);
    let lock = connect_lock(&server.id);
    let _guard = lock.lock().await;
    if let Some(cached) = cache().lock().await.get(&server.id) {
        if cached.key == key && cached.conn.alive() {
            return Ok(cached.conn.clone());
        }
    }
    // Drop a stale connection before starting its replacement.
    cache().lock().await.remove(&server.id);
    let conn = Arc::new(client::connect(server).await?);
    cache().lock().await.insert(server.id.clone(), Cached { key, conn: conn.clone() });
    Ok(conn)
}

/// Close a server's connection (switched off, removed, or signed out).
pub async fn disconnect(id: &str) {
    cache().lock().await.remove(id);
}

fn status_of(server: &McpServerEntry, result: &Result<Arc<Conn>, String>) -> McpServerStatus {
    match result {
        Ok(_) => McpServerStatus { id: server.id.clone(), status: "connected".into(), error: None },
        Err(e) if e.starts_with(NEEDS_AUTH) => {
            McpServerStatus { id: server.id.clone(), status: "needs_auth".into(), error: None }
        }
        Err(e) => McpServerStatus {
            id: server.id.clone(),
            status: "failed".into(),
            error: Some(failure_message(server, e.clone())),
        },
    }
}

/// Connect what's on, close what's off, and report each (`targets`: only these ids).
pub async fn sync(servers: &[McpServerEntry], targets: Option<&[String]>) -> Vec<McpServerStatus> {
    let wanted = |id: &str| targets.map(|t| t.iter().any(|x| x == id)).unwrap_or(true);
    let mut out = Vec::new();
    let mut connecting = Vec::new();
    for server in servers.iter().filter(|s| wanted(&s.id)) {
        if server.enabled {
            connecting.push(server);
        } else {
            disconnect(&server.id).await;
            out.push(McpServerStatus { id: server.id.clone(), status: "disabled".into(), error: None });
        }
    }
    let results = futures::future::join_all(connecting.iter().map(|s| connection(s))).await;
    for (server, result) in connecting.into_iter().zip(results) {
        out.push(status_of(server, &result));
    }
    out
}

/// A tool of some server, as the model sees it.
pub struct HubTool {
    pub name: String,
    pub server: String,
    pub tool: String,
    pub description: String,
    pub schema: Value,
    conn: Arc<Conn>,
}

impl HubTool {
    /// Call the tool. Arguments it turns down come back with its schema, and
    /// a call asking after a long job waits for it (`patience.rs`).
    pub async fn call(&self, args: Value) -> Result<client::ToolResult, String> {
        let result = match self.conn.call(&self.tool, args.clone()).await {
            Ok(result) => result,
            Err(e) if patience::bad_arguments(&e) => return Err(patience::with_schema(&e, &self.schema)),
            Err(e) => return Err(e),
        };
        if result.is_error && patience::bad_arguments(&result.text) {
            let text = patience::with_schema(&result.text, &self.schema);
            return Ok(client::ToolResult { text, ..result });
        }
        let (conn, tool) = (self.conn.clone(), self.tool.clone());
        patience::wait_for_job(&self.tool, args, result, move |args| {
            let (conn, tool) = (conn.clone(), tool.clone());
            async move { conn.call(&tool, args).await }
        })
        .await
    }
}

/// `serverId_tool`, as the app's step list reads MCP calls, within provider limits.
fn tool_name(server: &str, tool: &str) -> String {
    let clean = |s: &str| s.chars().map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '_' }).collect::<String>();
    let name = format!("{}_{}", clean(server), clean(tool));
    if name.len() <= MAX_TOOL_NAME {
        return name;
    }
    use sha2::Digest;
    let hash = hex::encode(&sha2::Sha256::digest(name.as_bytes())[..4]);
    format!("{}_{hash}", &name[..MAX_TOOL_NAME - 9])
}

/// Every tool of the servers that are on; servers that can't connect are
/// left out and named in the second list, so the model can say so.
pub async fn tools(servers: &[McpServerEntry]) -> (Vec<HubTool>, Vec<String>) {
    let enabled: Vec<&McpServerEntry> = servers
        .iter()
        .filter(|s| s.enabled && !AGENT_ONLY_ELSEWHERE.contains(&s.id.as_str()))
        .collect();
    let results = futures::future::join_all(enabled.iter().map(|s| connection(s))).await;
    let mut tools = Vec::new();
    let mut unavailable = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for (server, result) in enabled.into_iter().zip(results) {
        match result {
            Ok(conn) => {
                for def in &conn.tools {
                    let name = tool_name(&server.id, &def.name);
                    if !seen.insert(name.clone()) {
                        continue;
                    }
                    tools.push(HubTool {
                        name,
                        server: server.id.clone(),
                        tool: def.name.clone(),
                        description: def.description.clone(),
                        schema: def.schema.clone(),
                        conn: conn.clone(),
                    });
                }
            }
            Err(e) if e.starts_with(NEEDS_AUTH) => unavailable.push(format!("{} (needs sign-in in Connectors)", server.id)),
            Err(e) => unavailable.push(format!("{} ({})", server.id, e.lines().next().unwrap_or_default())),
        }
    }
    (tools, unavailable)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tool_names_fit_provider_rules() {
        assert_eq!(tool_name("custom-notion", "notion-search"), "custom-notion_notion-search");
        assert_eq!(tool_name("a b", "x.y"), "a_b_x_y");
        let long = tool_name(&"s".repeat(40), &"t".repeat(40));
        assert_eq!(long.len(), MAX_TOOL_NAME);
        assert_ne!(long, tool_name(&"s".repeat(40), &"u".repeat(40)));
    }
}
