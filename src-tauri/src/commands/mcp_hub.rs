//! The MCP hub for the app (see `crate::mcp_hub`): the Connectors page's
//! connect / status / sign-in go through Mali, not OpenCode.

use crate::commands::mcp::{validate, McpServerEntry, McpServerStatus, McpSyncResult};
use crate::commands::mcp_oauth;
use crate::mcp_hub;

/// Connect the connectors that are on, close the ones that are off.
#[tauri::command]
pub async fn mcp_hub_sync(servers: Vec<McpServerEntry>, targets: Option<Vec<String>>) -> Result<McpSyncResult, String> {
    for server in &servers {
        validate(server)?;
    }
    mcp_hub::set_servers(servers.clone());
    Ok(McpSyncResult { servers: mcp_hub::sync(&servers, targets.as_deref()).await })
}

/// Tell the hub which connectors the user has, without connecting them: the
/// `mali` gateway starts them when a CLI first asks.
#[tauri::command]
pub fn mcp_hub_set_servers(servers: Vec<McpServerEntry>) -> Result<(), String> {
    for server in &servers {
        validate(server)?;
    }
    mcp_hub::set_servers(servers);
    Ok(())
}

/// The Cowork folder (and granted folders) of the CLI run about to start, for
/// the gateway's document tools. `cwd` empty: not in Cowork.
#[tauri::command]
pub fn mcp_hub_set_workspace(cwd: Option<String>, folders: Vec<crate::agent::paths::FolderGrant>) {
    mcp_hub::set_workspace(mcp_hub::Workspace { cwd, folders });
}

/// Sign in to a remote connector as Mali Cowork, then reconnect it.
#[tauri::command]
pub async fn mcp_hub_sign_in(app: tauri::AppHandle, server: McpServerEntry, fresh: Option<bool>) -> Result<McpServerStatus, String> {
    validate(&server)?;
    let url = server.url.clone().filter(|u| !u.trim().is_empty()).ok_or("This connector has no URL to sign in to")?;
    if fresh.unwrap_or(false) {
        mcp_oauth::forget(&server.id)?;
        mcp_oauth::sign_out(&server.id)?;
    }
    mcp_oauth::sign_in(&app, &server.id, &url).await?;
    mcp_hub::disconnect(&server.id).await;
    let status = mcp_hub::sync(std::slice::from_ref(&server), None).await;
    status.into_iter().next().ok_or_else(|| "No status".to_string())
}

/// Forget Mali's sign-in for a connector.
#[tauri::command]
pub async fn mcp_hub_sign_out(id: String) -> Result<(), String> {
    mcp_oauth::sign_out(&id)?;
    mcp_hub::disconnect(&id).await;
    Ok(())
}
