//! A bot shared as a `.zip` (bot-forge's export): unpacked into a folder Mali
//! keeps, so it installs like any plugin from a folder (`plugins_fetch`) and
//! its source stays there for the update check. Nothing in it runs.

use std::io::{Cursor, Read};
use std::path::{Component, Path, PathBuf};

use super::{base, plugin_id};

/// A shared bot is a handful of Markdown and JSON files.
const MAX_FILES: usize = 500;
const MAX_TOTAL: u64 = 20 * 1024 * 1024;

/// Where unpacked bots live, one folder each.
fn bots_root() -> PathBuf {
    base().join("mali-cowork").join("bots")
}

/// Unpack a bot's `.zip` into its own folder and return the folder. The same
/// bot again replaces the earlier copy (that's an update).
#[tauri::command]
pub fn plugins_unpack_bot(data: Vec<u8>) -> Result<String, String> {
    unpack(&data, &bots_root()).map(|dir| dir.to_string_lossy().to_string())
}

fn unpack(data: &[u8], root: &Path) -> Result<PathBuf, String> {
    let mut zip = zip::ZipArchive::new(Cursor::new(data)).map_err(|_| "That isn't a .zip file.".to_string())?;
    if zip.len() > MAX_FILES {
        return Err("That archive is too big to be a bot.".into());
    }
    let mut files: Vec<(PathBuf, Vec<u8>)> = Vec::new();
    let mut total = 0u64;
    for i in 0..zip.len() {
        let mut entry = zip.by_index(i).map_err(|e| format!("Couldn't read the archive: {e}"))?;
        if entry.is_dir() {
            continue;
        }
        // Only plain relative paths: nothing may land outside the bot's folder.
        let path = entry.enclosed_name().ok_or_else(|| format!("Unsafe path in the archive: {}", entry.name()))?;
        if path.components().any(|c| !matches!(c, Component::Normal(_))) {
            return Err(format!("Unsafe path in the archive: {}", entry.name()));
        }
        let name = path.to_string_lossy();
        if name.starts_with("__MACOSX") || path.file_name().is_some_and(|f| f == ".DS_Store") {
            continue;
        }
        total += entry.size();
        if total > MAX_TOTAL {
            return Err("That archive is too big to be a bot.".into());
        }
        let mut bytes = Vec::new();
        entry.by_ref().take(MAX_TOTAL).read_to_end(&mut bytes).map_err(|e| format!("Couldn't read the archive: {e}"))?;
        files.push((path, bytes));
    }
    // An export holds one folder (`<slug>/…`): the bot is what's inside it.
    let tops: std::collections::BTreeSet<_> = files.iter().filter_map(|(p, _)| p.components().next()).collect();
    let strip = tops.len() == 1 && files.iter().all(|(p, _)| p.components().count() > 1);
    let files: Vec<(PathBuf, Vec<u8>)> = files
        .into_iter()
        .map(|(p, b)| (if strip { p.components().skip(1).collect() } else { p }, b))
        .collect();
    let manifest = files
        .iter()
        .find(|(p, _)| p == Path::new(".claude-plugin/plugin.json"))
        .and_then(|(_, b)| serde_json::from_slice::<serde_json::Value>(b).ok());
    let agent = files.iter().any(|(p, _)| p.starts_with("agents") && p.extension().is_some_and(|e| e == "md"));
    if !agent {
        return Err("This isn't a bot: it has no agents/*.md. Export it from bot-forge, or install it as a plugin.".into());
    }
    let name = manifest.as_ref().and_then(|m| m["name"].as_str()).map(plugin_id).filter(|n| !n.is_empty());
    let dir = root.join(name.unwrap_or_else(|| format!("bot-{}", &uuid::Uuid::new_v4().simple().to_string()[..8])));
    if dir.exists() {
        std::fs::remove_dir_all(&dir).map_err(|e| format!("Couldn't replace {}: {e}", dir.display()))?;
    }
    for (path, bytes) in files {
        let file = dir.join(&path);
        if let Some(parent) = file.parent() {
            std::fs::create_dir_all(parent).map_err(|e| format!("Couldn't create {}: {e}", parent.display()))?;
        }
        std::fs::write(&file, bytes).map_err(|e| format!("Couldn't write {}: {e}", file.display()))?;
    }
    Ok(dir)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn zip_of(files: &[(&str, &str)]) -> Vec<u8> {
        let mut out = Cursor::new(Vec::new());
        {
            let mut zip = zip::ZipWriter::new(&mut out);
            for (name, body) in files {
                zip.start_file(*name, zip::write::SimpleFileOptions::default()).unwrap();
                zip.write_all(body.as_bytes()).unwrap();
            }
            zip.finish().unwrap();
        }
        out.into_inner()
    }

    fn root() -> PathBuf {
        std::env::temp_dir().join(format!("mali-bots-test-{}", uuid::Uuid::new_v4().simple()))
    }

    #[test]
    fn a_bot_forge_export_lands_in_its_own_folder() {
        let data = zip_of(&[
            ("news-digest/.claude-plugin/plugin.json", r#"{"name":"news-digest"}"#),
            ("news-digest/agents/news-digest.md", "---\nname: news-digest\n---\nHi"),
            ("news-digest/skills/thai-brief/SKILL.md", "---\nname: thai-brief\n---\nDo it"),
            ("__MACOSX/news-digest/._bot.json", ""),
        ]);
        let root = root();
        let dir = unpack(&data, &root).unwrap();
        assert_eq!(dir, root.join("news-digest"));
        assert!(dir.join("agents/news-digest.md").exists());
        assert!(dir.join("skills/thai-brief/SKILL.md").exists());
        assert!(!root.join("__MACOSX").exists());
        // Again: the newer copy replaces it.
        assert_eq!(unpack(&data, &root).unwrap(), dir);
    }

    #[test]
    fn nothing_lands_outside_and_a_plain_plugin_isnt_a_bot() {
        let root = root();
        let evil = zip_of(&[("../escape.md", "x"), ("agents/a.md", "x")]);
        assert!(unpack(&evil, &root).unwrap_err().contains("Unsafe path"));
        let skills_only = zip_of(&[("skills/x/SKILL.md", "x")]);
        assert!(unpack(&skills_only, &root).unwrap_err().contains("isn't a bot"));
        assert!(unpack(b"not a zip", &root).unwrap_err().contains(".zip"));
    }
}
