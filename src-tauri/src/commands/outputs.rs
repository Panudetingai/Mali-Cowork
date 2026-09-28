//! Epic C (docs/PRD-delight-v0.3.md §6.4): whether files an agent created
//! are still on disk, for the Outputs gallery.

use std::collections::{HashMap, HashSet};
use std::time::UNIX_EPOCH;

use serde::{Deserialize, Serialize};

use super::checkpoint::{changed_paths, created_paths};

/// One screen of the gallery asks at a time; anything larger is a bug.
const MAX_ITEMS: usize = 500;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OutputRef {
    pub checkpoint_id: String,
    pub path: String,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct OutputStat {
    pub path: String,
    pub exists: bool,
    pub size: Option<u64>,
    /// Epoch ms.
    pub modified_at: Option<i64>,
}

/// One entry per item, in order. A path is only looked up when the checkpoint
/// it names recorded that path, so the webview can't probe the disk through
/// this call — anything else reads as `exists: false`.
#[tauri::command]
pub async fn outputs_stat(items: Vec<OutputRef>) -> Result<Vec<OutputStat>, String> {
    if items.len() > MAX_ITEMS {
        return Err(format!("Too many files at once (max {MAX_ITEMS})"));
    }
    tokio::task::spawn_blocking(move || stat_all(items, changed_paths))
        .await
        .map_err(|e| e.to_string())
}

fn stat_all(
    items: Vec<OutputRef>,
    paths_of: impl Fn(&str) -> Result<HashSet<String>, String>,
) -> Vec<OutputStat> {
    let mut known: HashMap<String, Option<HashSet<String>>> = HashMap::new();
    items
        .into_iter()
        .map(|item| {
            let recorded = known
                .entry(item.checkpoint_id.clone())
                .or_insert_with(|| paths_of(&item.checkpoint_id).ok())
                .as_ref()
                .is_some_and(|paths| paths.contains(&item.path));
            let meta = recorded.then(|| std::fs::metadata(&item.path).ok()).flatten().filter(|m| m.is_file());
            OutputStat {
                exists: meta.is_some(),
                size: meta.as_ref().map(|m| m.len()),
                modified_at: meta
                    .and_then(|m| m.modified().ok())
                    .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                    .map(|d| d.as_millis() as i64),
                path: item.path,
            }
        })
        .collect()
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TrashResult {
    pub path: String,
    /// Moved to the Trash, or already gone.
    pub ok: bool,
    pub error: Option<String>,
}

/// Move outputs to the Trash (Recycle Bin), so a mistake can be put back.
/// Only a file its checkpoint says the agent created is touched; anything
/// else — a file the agent only edited, or a path the checkpoint never
/// recorded — is refused.
#[tauri::command]
pub async fn outputs_trash(items: Vec<OutputRef>) -> Result<Vec<TrashResult>, String> {
    if items.len() > MAX_ITEMS {
        return Err(format!("Too many files at once (max {MAX_ITEMS})"));
    }
    tokio::task::spawn_blocking(move || trash_all(items, created_paths, |path| trash::delete(path).map_err(|e| e.to_string())))
        .await
        .map_err(|e| e.to_string())
}

fn trash_all(
    items: Vec<OutputRef>,
    created_of: impl Fn(&str) -> Result<HashSet<String>, String>,
    remove: impl Fn(&std::path::Path) -> Result<(), String>,
) -> Vec<TrashResult> {
    let mut known: HashMap<String, Option<HashSet<String>>> = HashMap::new();
    items
        .into_iter()
        .map(|item| {
            let created = known
                .entry(item.checkpoint_id.clone())
                .or_insert_with(|| created_of(&item.checkpoint_id).ok())
                .as_ref()
                .is_some_and(|paths| paths.contains(&item.path));
            let path = std::path::Path::new(&item.path);
            let outcome = if !created {
                Err("Only files an agent created can be moved to the Trash here.".to_string())
            } else if !path.exists() {
                // Nothing left to remove: the user wanted it gone, and it is.
                Ok(())
            } else if !path.is_file() {
                Err("This is no longer a file.".to_string())
            } else {
                remove(path)
            };
            TrashResult { path: item.path, ok: outcome.is_ok(), error: outcome.err() }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn item(checkpoint_id: &str, path: &str) -> OutputRef {
        OutputRef { checkpoint_id: checkpoint_id.into(), path: path.into() }
    }

    #[test]
    fn only_paths_the_checkpoint_recorded_are_looked_up() {
        let dir = std::env::temp_dir().join(format!("mali-outputs-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let made = dir.join("made.txt");
        let other = dir.join("other.txt");
        std::fs::write(&made, "hello").unwrap();
        std::fs::write(&other, "secret").unwrap();
        let made_s = made.to_string_lossy().into_owned();
        let other_s = other.to_string_lossy().into_owned();
        let gone_s = dir.join("gone.txt").to_string_lossy().into_owned();

        let recorded = HashSet::from([made_s.clone(), gone_s.clone()]);
        let stats = stat_all(
            vec![item("cp", &made_s), item("cp", &other_s), item("cp", &gone_s), item("missing", &made_s)],
            |id| if id == "cp" { Ok(recorded.clone()) } else { Err("gone".into()) },
        );

        assert!(stats[0].exists);
        assert_eq!(stats[0].size, Some(5));
        assert!(stats[0].modified_at.is_some());
        assert!(!stats[1].exists, "a file outside the checkpoint must not be revealed");
        assert_eq!(stats[1].size, None);
        assert!(!stats[2].exists, "a deleted output reads as missing");
        assert!(!stats[3].exists, "an unknown checkpoint answers nothing");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn only_created_files_are_trashed() {
        let dir = std::env::temp_dir().join(format!("mali-trash-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let made = dir.join("made.txt");
        let edited = dir.join("edited.txt");
        std::fs::write(&made, "new").unwrap();
        std::fs::write(&edited, "mine").unwrap();
        let made_s = made.to_string_lossy().into_owned();
        let edited_s = edited.to_string_lossy().into_owned();
        let gone_s = dir.join("gone.txt").to_string_lossy().into_owned();

        let created = HashSet::from([made_s.clone(), gone_s.clone()]);
        let results = trash_all(
            vec![item("cp", &made_s), item("cp", &edited_s), item("cp", &gone_s), item("missing", &made_s)],
            |id| if id == "cp" { Ok(created.clone()) } else { Err("gone".into()) },
            |path| std::fs::remove_file(path).map_err(|e| e.to_string()),
        );

        assert!(results[0].ok);
        assert!(!made.exists());
        assert!(!results[1].ok, "a file the agent only edited is the user's");
        assert!(edited.exists());
        assert!(results[2].ok, "already gone counts as done");
        assert!(!results[3].ok, "an unknown checkpoint allows nothing");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
