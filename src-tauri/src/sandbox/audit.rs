use std::fs::OpenOptions;
use std::io::Write;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use super::events::SandboxEvent;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditRecord {
    pub timestamp: String,
    pub mcp_id: Option<String>,
    pub tool: String,
    pub action: String,
    pub decision: String,
    pub path: Option<String>,
    pub reason: Option<String>,
    #[serde(default)]
    pub event: Option<SandboxEvent>,
}

fn audit_path() -> PathBuf {
    dirs::data_local_dir()
        .unwrap_or_else(std::env::temp_dir)
        .join("mali-cowork")
        .join("sandbox-audit.jsonl")
}

pub fn append(record: &AuditRecord) -> Result<(), String> {
    let path = audit_path();
    let parent = path.parent().ok_or("Audit path has no parent")?;
    std::fs::create_dir_all(parent).map_err(|e| format!("Cannot create audit directory: {e}"))?;
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map_err(|e| e.to_string())?;
    let line = serde_json::to_string(record).map_err(|e| e.to_string())?;
    file.write_all(line.as_bytes())
        .and_then(|_| file.write_all(b"\n"))
        .map_err(|e| e.to_string())
}

pub fn recent(limit: usize) -> Result<Vec<AuditRecord>, String> {
    let path = audit_path();
    let Ok(text) = std::fs::read_to_string(path) else {
        return Ok(Vec::new());
    };
    Ok(text
        .lines()
        .rev()
        .filter_map(|line| serde_json::from_str(line).ok())
        .take(limit.min(500))
        .collect())
}
