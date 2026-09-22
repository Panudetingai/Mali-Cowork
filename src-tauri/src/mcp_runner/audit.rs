//! Minimal audit logging for the MCP runner.
//!
//! Writes one JSONL line per launch attempt. The log path is passed from the
//! main app so all sandbox records live in the same file.

use std::fs::OpenOptions;
use std::io::Write;
use std::path::PathBuf;

use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunnerAuditRecord {
    pub timestamp: String,
    pub mcp_id: Option<String>,
    pub command: String,
    pub success: bool,
    pub error: Option<String>,
}

pub fn append(record: &RunnerAuditRecord, path: Option<&PathBuf>) -> Result<(), String> {
    let Some(path) = path else { return Ok(()) };
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("Cannot create audit dir: {e}"))?;
    }
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map_err(|e| format!("Cannot open audit log: {e}"))?;
    let line = serde_json::to_string(record).map_err(|e| format!("Cannot serialize audit: {e}"))?;
    file.write_all(line.as_bytes())
        .and_then(|_| file.write_all(b"\n"))
        .map_err(|e| format!("Cannot write audit: {e}"))?;
    Ok(())
}
