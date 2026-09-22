//! Rust-owned security boundary for workspace filesystem operations.
//!
//! The webview gets only high-level commands from this module.  Policy is
//! evaluated after canonicalisation, so textual path prefixes never grant an
//! escape through `..`, symlinks or Windows junctions.

mod audit;
mod events;
mod filesystem;
mod manager;
mod policy;
mod process;
mod resources;

pub(crate) use manager::permission_rejection_reason;
pub use manager::{
    filesystem_read, filesystem_search, filesystem_write, get_audit_logs, get_sandbox_status,
};
pub use policy::{AccessDecision, McpTrustLevel, ResourceLimits, SandboxPolicy};
