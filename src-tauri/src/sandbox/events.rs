use serde::{Deserialize, Serialize};

/// Events are deliberately structured so the UI never has to infer a reason
/// from an operating-system error message.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SandboxEventKind {
    SandboxViolation,
    PermissionRequested,
    PermissionDenied,
    SensitiveFileBlocked,
    NetworkBlocked,
    ProcessBlocked,
    PathTraversalBlocked,
    CommandBlocked,
    ResourceLimitExceeded,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SandboxEvent {
    pub kind: SandboxEventKind,
    pub mcp_id: Option<String>,
    pub tool: String,
    pub reason: String,
}
