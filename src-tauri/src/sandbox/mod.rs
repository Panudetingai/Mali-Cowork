//! The app's own security boundary, next to whatever the agent CLIs enforce.
//!
//! Two things live here:
//! - the credential gate an approval can never bypass ([`permission_rejection_reason`]),
//!   used by the OpenCode permission flow;
//! - the policy each local MCP server is launched under, enforced by
//!   `mali-mcp-runner`, plus an audit trail the Settings → MCP card reads back.

mod audit;
mod events;
mod filesystem;
mod manager;
mod policy;

pub(crate) use manager::{permission_rejection_reason, record_blocked, record_mcp_launch};
pub use manager::{get_audit_logs, get_sandbox_status};
pub use policy::{AccessDecision, McpTrustLevel, ResourceLimits, SandboxPolicy};
