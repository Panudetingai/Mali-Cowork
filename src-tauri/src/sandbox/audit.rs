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
    // Overridable so a test (or a support request) can read a log of its own.
    if let Some(path) = std::env::var_os("MALI_SANDBOX_AUDIT") {
        return PathBuf::from(path);
    }
    dirs::data_local_dir()
        .unwrap_or_else(std::env::temp_dir)
        .join("mali-cowork")
        .join("sandbox-audit.jsonl")
}

/// The log is a convenience, not evidence: it is trimmed instead of growing
/// without end.
const MAX_BYTES: u64 = 512 * 1024;
const KEEP_LINES: usize = 200;

pub fn append(record: &AuditRecord) -> Result<(), String> {
    let path = audit_path();
    let parent = path.parent().ok_or("Audit path has no parent")?;
    std::fs::create_dir_all(parent).map_err(|e| format!("Cannot create audit directory: {e}"))?;
    trim(&path);
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

/// Keep the newest lines when the file grows past [`MAX_BYTES`].
fn trim(path: &PathBuf) {
    let too_big = std::fs::metadata(path).is_ok_and(|meta| meta.len() > MAX_BYTES);
    if !too_big {
        return;
    }
    let Ok(text) = std::fs::read_to_string(path) else { return };
    let lines: Vec<&str> = text.lines().collect();
    let start = lines.len().saturating_sub(KEEP_LINES);
    let kept = lines[start..].join("\n");
    let _ = std::fs::write(path, format!("{kept}\n"));
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
