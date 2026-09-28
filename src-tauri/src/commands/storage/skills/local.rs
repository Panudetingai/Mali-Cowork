//! Skills in a folder on this Mac — a cloned repository, a shared drive —
//! and exporting the library back out as folders others can import.

use std::path::{Path, PathBuf};

use serde::Deserialize;

use crate::commands::secure_fs::write_private;

use super::{
    blocked_reason, folder_of, is_skill_file, safe_slug, skip_dir, vet_assets, SkillAsset,
    SkillPackage, MAX_SCAN_DEPTH, MAX_SKILLS, MAX_SKILL_BYTES,
};

#[derive(Debug, Deserialize)]
pub struct ExportSkill {
    pub slug: String,
    pub content: String,
    /// Where the skill already lives on disk; bundled files are copied too.
    #[serde(default)]
    pub dir: Option<String>,
}

fn walk(root: &Path, max_depth: usize) -> impl Iterator<Item = walkdir::DirEntry> {
    walkdir::WalkDir::new(root)
        .max_depth(max_depth)
        .follow_links(false)
        .into_iter()
        .filter_entry(|e| {
            let name = e.file_name().to_string_lossy();
            !(e.file_type().is_dir() && e.depth() > 0 && skip_dir(name.as_ref()))
        })
        .filter_map(Result::ok)
}

pub fn scan_dir(root: &Path) -> Vec<SkillPackage> {
    let skills: Vec<PathBuf> = walk(root, MAX_SCAN_DEPTH)
        .filter(|e| e.file_type().is_file() && is_skill_file(&e.file_name().to_string_lossy()))
        .filter(|e| e.metadata().is_ok_and(|m| m.len() as usize <= MAX_SKILL_BYTES))
        .map(|e| e.path().to_path_buf())
        .take(MAX_SKILLS)
        .collect();
    // A skill's own folder holds its scripts; a nested skill keeps its own.
    let dirs: Vec<PathBuf> =
        skills.iter().filter_map(|p| p.parent().map(Path::to_path_buf)).collect();

    skills
        .iter()
        .filter_map(|path| {
            let content = std::fs::read_to_string(path).ok()?;
            let dir = path.parent()?;
            let source = path.to_string_lossy().to_string();
            Some(SkillPackage {
                folder: folder_of(&source),
                files: assets_in(dir, &dirs),
                source,
                content,
            })
        })
        .collect()
}

/// Everything in a skill's folder except its `SKILL.md` and any nested skill.
fn assets_in(dir: &Path, all_skill_dirs: &[PathBuf]) -> Vec<SkillAsset> {
    let assets = walk(dir, MAX_SCAN_DEPTH)
        .filter(|e| e.file_type().is_file())
        .filter(|e| !e.path().ancestors().any(|a| a != dir && all_skill_dirs.iter().any(|d| d == a)))
        .filter_map(|e| {
            let path = e.path().strip_prefix(dir).ok()?.to_string_lossy().replace('\\', "/");
            if is_skill_file(&path) {
                return None;
            }
            let bytes = e.metadata().map(|m| m.len()).unwrap_or(0);
            Some(SkillAsset {
                url: e.path().to_string_lossy().to_string(),
                skipped: blocked_reason(&path, bytes),
                bytes,
                path,
            })
        })
        .collect();
    vet_assets(assets)
}

/// Pick a folder — a shared drive, a cloned repository — and find its skills.
#[tauri::command]
pub async fn skills_scan_folder(folder: String) -> Result<Vec<SkillPackage>, String> {
    let root = PathBuf::from(&folder);
    if !root.is_dir() {
        return Err(format!("{folder} is not a folder"));
    }
    let found = tokio::task::spawn_blocking(move || scan_dir(&root)).await.map_err(|e| e.to_string())?;
    if found.is_empty() {
        return Err("No SKILL.md files found in that folder".into());
    }
    Ok(found)
}

/// Write each skill to `<folder>/<slug>/SKILL.md`; returns how many were written.
#[tauri::command]
pub async fn skills_export_folder(folder: String, skills: Vec<ExportSkill>) -> Result<usize, String> {
    let root = PathBuf::from(&folder);
    if !root.is_dir() {
        return Err(format!("{folder} is not a folder"));
    }
    for skill in &skills {
        safe_slug(&skill.slug)?;
        if skill.content.len() > MAX_SKILL_BYTES {
            return Err(format!("{} is too large to export", skill.slug));
        }
    }
    tokio::task::spawn_blocking(move || {
        for skill in &skills {
            let target = root.join(&skill.slug);
            std::fs::create_dir_all(&target)
                .map_err(|e| format!("Cannot create {}: {e}", target.display()))?;
            if let Some(dir) = &skill.dir {
                copy_skill_contents(PathBuf::from(dir), &target)?;
            }
            write_private(&target.join("SKILL.md"), &skill.content)?;
        }
        Ok(skills.len())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Copy every file from an installed skill folder into an export target,
/// keeping subdirectories such as `example/` or `scripts/`. The `SKILL.md`
/// itself is left out because the caller writes the latest content separately.
fn copy_skill_contents(source: PathBuf, target: &Path) -> Result<(), String> {
    if !source.is_dir() {
        return Ok(());
    }
    for entry in walkdir::WalkDir::new(&source)
        .max_depth(MAX_SCAN_DEPTH)
        .follow_links(false)
        .into_iter()
        .filter_map(Result::ok)
        .filter(|e| e.file_type().is_file())
    {
        let relative = entry
            .path()
            .strip_prefix(&source)
            .map_err(|e| e.to_string())?;
        let path = relative.to_string_lossy().replace('\\', "/");
        if is_skill_file(&path) {
            continue;
        }
        let dest = target.join(relative);
        if let Some(parent) = dest.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Cannot create {}: {e}", parent.display()))?;
        }
        std::fs::copy(entry.path(), &dest).map_err(|e| {
            format!("Cannot copy {} to {}: {e}", entry.path().display(), dest.display())
        })?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp() -> PathBuf {
        let root = std::env::temp_dir().join(format!("mali-skills-{}", uuid::Uuid::new_v4().simple()));
        std::fs::create_dir_all(&root).unwrap();
        root
    }

    #[test]
    fn finds_skill_files_and_what_they_bundle() {
        let root = temp();
        std::fs::create_dir_all(root.join("pdf/scripts")).unwrap();
        std::fs::create_dir_all(root.join("node_modules/x")).unwrap();
        std::fs::write(root.join("pdf/SKILL.md"), "---\nname: pdf\n---\nRead PDFs").unwrap();
        std::fs::write(root.join("pdf/scripts/fill.py"), "print(1)").unwrap();
        std::fs::write(root.join("pdf/scripts/tool.exe"), "MZ").unwrap();
        std::fs::write(root.join("node_modules/x/SKILL.md"), "skip me").unwrap();

        let found = scan_dir(&root);
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].folder, "pdf");
        let paths: Vec<&str> = found[0].files.iter().map(|f| f.path.as_str()).collect();
        assert_eq!(paths, ["scripts/fill.py", "scripts/tool.exe"]);
        assert!(found[0].files[0].skipped.is_none());
        assert!(found[0].files[1].skipped.is_some(), "a .exe is listed but not installed");
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn a_nested_skill_keeps_its_own_files() {
        let root = temp();
        std::fs::create_dir_all(root.join("outer/inner")).unwrap();
        std::fs::write(root.join("outer/SKILL.md"), "outer").unwrap();
        std::fs::write(root.join("outer/notes.md"), "mine").unwrap();
        std::fs::write(root.join("outer/inner/SKILL.md"), "inner").unwrap();
        std::fs::write(root.join("outer/inner/notes.md"), "theirs").unwrap();

        let found = scan_dir(&root);
        let outer = found.iter().find(|p| p.folder == "outer").unwrap();
        assert_eq!(outer.files.iter().map(|f| f.path.as_str()).collect::<Vec<_>>(), ["notes.md"]);
        let _ = std::fs::remove_dir_all(root);
    }
}
