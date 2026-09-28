//! The installed skill library on disk.
//!
//! Every enabled skill lives at `<app data>/mali-cowork/skills/<slug>/`, with
//! its `SKILL.md` and whatever scripts, references and assets it bundles. The
//! agent is told the folder exists and what each skill is for; it opens the
//! file itself when a task matches, so a large library costs nothing until it
//! is used.
//!
//! Installing only ever writes files. Nothing is executed, and no file is
//! made executable — a skill's script runs the way any other file does, when
//! the agent decides to run it and the user's folder permissions allow it.

use std::collections::HashSet;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::commands::secure_fs::write_private;

use super::remote::{client, fetch_bytes};
use super::{
    is_skill_file, safe_relative, safe_slug, SkillAsset, MAX_ASSETS, MAX_PACKAGE_BYTES,
    MAX_SCAN_DEPTH, MAX_SKILL_BYTES,
};

/// A skill the user chose to install, with the files they kept.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallRequest {
    pub slug: String,
    /// The `SKILL.md` text, as edited in the app.
    pub content: String,
    #[serde(default)]
    pub files: Vec<SkillAsset>,
}

/// A skill folder as it sits on disk.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledSkill {
    pub slug: String,
    /// The absolute folder, which is what the agent is given.
    pub dir: String,
    /// Bundled files, relative to `dir`, in a stable order.
    pub files: Vec<String>,
    pub bytes: u64,
}

/// Where installed skills live. Created on first use.
fn root() -> Result<PathBuf, String> {
    let dir = base().join("mali-cowork").join("skills");
    std::fs::create_dir_all(&dir).map_err(|e| format!("Cannot create {}: {e}", dir.display()))?;
    Ok(dir)
}

#[cfg(not(test))]
fn base() -> PathBuf {
    dirs::data_local_dir().unwrap_or_else(std::env::temp_dir)
}

/// Tests write and delete whole folders, so they get their own library rather
/// than the one belonging to whoever is running them.
#[cfg(test)]
fn base() -> PathBuf {
    use std::sync::OnceLock;
    static BASE: OnceLock<PathBuf> = OnceLock::new();
    BASE.get_or_init(|| std::env::temp_dir().join(format!("mali-test-{}", uuid::Uuid::new_v4().simple())))
        .clone()
}

/// The folder for one skill, guaranteed to sit directly inside the library.
fn skill_dir(slug: &str) -> Result<PathBuf, String> {
    let root = root()?;
    let dir = root.join(safe_slug(slug)?);
    // `safe_slug` already refuses separators; this is the belt to its braces.
    if dir.parent() != Some(root.as_path()) {
        return Err(format!("Invalid skill folder name: {slug:?}"));
    }
    Ok(dir)
}

/// The library folder, for showing the user and granting the agent access.
#[tauri::command]
pub fn skills_dir() -> Result<String, String> {
    Ok(root()?.to_string_lossy().to_string())
}

/// Install skills: write each `SKILL.md` and download the files the user kept.
///
/// A file that can't be fetched is left out rather than failing the install —
/// the skill's instructions are what matter most, and the result says which
/// files made it.
#[tauri::command]
pub async fn skills_install(skills: Vec<InstallRequest>) -> Result<Vec<InstalledSkill>, String> {
    let http = client()?;
    let mut installed = Vec::new();
    for skill in &skills {
        let dir = skill_dir(&skill.slug)?;
        if skill.content.len() > MAX_SKILL_BYTES {
            return Err(format!("“{}” is too large to install", skill.slug));
        }

        // Replace the folder so a reinstall never leaves an old script behind.
        remove_dir(&dir)?;
        write_private(&dir.join("SKILL.md"), &skill.content)?;

        let mut files = Vec::new();
        let mut bytes = skill.content.len() as u64;
        for asset in skill.files.iter().filter(|a| a.skipped.is_none()).take(MAX_ASSETS) {
            let relative = safe_relative(&asset.path)?;
            if is_skill_file(&asset.path) || bytes.saturating_add(asset.bytes) > MAX_PACKAGE_BYTES {
                continue;
            }
            let data = match read_asset(&http, asset).await {
                Ok(data) => data,
                Err(why) => {
                    eprintln!("[skills_install] skipped {}: {}", asset.path, why);
                    continue;
                }
            };
            let target = dir.join(&relative);
            if !target.starts_with(&dir) {
                return Err(format!("{}: that path leaves the skill folder", asset.path));
            }
            if let Some(parent) = target.parent() {
                std::fs::create_dir_all(parent)
                    .map_err(|e| format!("Cannot create {}: {e}", parent.display()))?;
            }
            std::fs::write(&target, &data).map_err(|e| format!("Cannot write {}: {e}", target.display()))?;
            bytes += data.len() as u64;
            files.push(asset.path.clone());
        }
        files.sort();
        installed.push(InstalledSkill {
            slug: skill.slug.clone(),
            dir: dir.to_string_lossy().to_string(),
            files,
            bytes,
        });
    }
    Ok(installed)
}

/// Read one asset from wherever it came from: a link, or a folder on this Mac.
async fn read_asset(http: &reqwest::Client, asset: &SkillAsset) -> Result<Vec<u8>, String> {
    if asset.url.starts_with("https://") {
        return fetch_bytes(http, &asset.url).await;
    }
    let path = Path::new(&asset.url);
    if !path.is_absolute() || path.is_symlink() {
        return Err(format!("{}: not a file this app can copy", asset.path));
    }
    std::fs::read(path).map_err(|e| format!("Cannot read {}: {e}", path.display()))
}

/// Mirror the library to disk: refresh each skill's `SKILL.md` and drop the
/// folders named in `remove`. Bundled files already installed are kept, so
/// editing a skill's text never costs it its scripts.
///
/// Only the folders the app names are removed. A folder nobody claims is
/// left alone — someone may have put it there on purpose.
#[tauri::command]
pub async fn skills_sync(
    skills: Vec<InstallRequest>,
    remove: Vec<String>,
) -> Result<Vec<InstalledSkill>, String> {
    let keep: HashSet<&str> = skills.iter().map(|s| s.slug.as_str()).collect();
    for slug in remove.iter().filter(|s| !keep.contains(s.as_str())) {
        // A name the app can't have written is not ours to delete.
        if let Ok(dir) = skill_dir(slug) {
            remove_dir(&dir)?;
        }
    }

    let mut installed = Vec::new();
    for skill in &skills {
        let dir = skill_dir(&skill.slug)?;
        if skill.content.len() > MAX_SKILL_BYTES {
            continue;
        }
        write_private(&dir.join("SKILL.md"), &skill.content)?;
        installed.push(read_installed(&skill.slug, &dir));
    }
    Ok(installed)
}

/// Remove one skill's folder.
#[tauri::command]
pub fn skills_uninstall(slug: String) -> Result<(), String> {
    remove_dir(&skill_dir(&slug)?)
}

/// What is on disk right now, so the app can show and repair the library.
#[tauri::command]
pub fn skills_installed() -> Result<Vec<InstalledSkill>, String> {
    let root = root()?;
    let mut found: Vec<InstalledSkill> = std::fs::read_dir(&root)
        .map_err(|e| format!("Cannot read {}: {e}", root.display()))?
        .filter_map(Result::ok)
        .filter(|e| e.path().is_dir())
        .filter(|e| e.path().join("SKILL.md").is_file())
        .map(|e| read_installed(&e.file_name().to_string_lossy(), &e.path()))
        .collect();
    found.sort_by(|a, b| a.slug.cmp(&b.slug));
    Ok(found)
}

fn read_installed(slug: &str, dir: &Path) -> InstalledSkill {
    let mut files = Vec::new();
    let mut bytes = 0;
    for entry in walkdir::WalkDir::new(dir)
        .max_depth(MAX_SCAN_DEPTH)
        .follow_links(false)
        .into_iter()
        .filter_map(Result::ok)
        .filter(|e| e.file_type().is_file())
    {
        bytes += entry.metadata().map(|m| m.len()).unwrap_or(0);
        let Ok(relative) = entry.path().strip_prefix(dir) else { continue };
        let path = relative.to_string_lossy().replace('\\', "/");
        if !is_skill_file(&path) {
            files.push(path);
        }
    }
    files.sort();
    InstalledSkill { slug: slug.to_string(), dir: dir.to_string_lossy().to_string(), files, bytes }
}

/// Delete a folder inside the library, and only there.
fn remove_dir(dir: &Path) -> Result<(), String> {
    let root = root()?;
    if !dir.starts_with(&root) || dir == root {
        return Err(format!("{} is not an installed skill", dir.display()));
    }
    match std::fs::remove_dir_all(dir) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("Cannot remove {}: {e}", dir.display())),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The library folder is fixed, so these run against the real one and
    /// clean up after themselves.
    fn slug() -> String {
        format!("mali-test-{}", uuid::Uuid::new_v4().simple())
    }

    #[tokio::test]
    async fn installs_a_skill_with_its_scripts_then_removes_it() {
        let source = std::env::temp_dir().join(format!("mali-src-{}", uuid::Uuid::new_v4().simple()));
        std::fs::create_dir_all(source.join("scripts")).unwrap();
        let script = source.join("scripts/build.py");
        std::fs::write(&script, "print('hi')").unwrap();

        let slug = slug();
        let installed = skills_install(vec![InstallRequest {
            slug: slug.clone(),
            content: "---\nname: test\n---\nDo the thing".into(),
            files: vec![SkillAsset {
                path: "scripts/build.py".into(),
                bytes: 11,
                url: script.to_string_lossy().to_string(),
                skipped: None,
            }],
        }])
        .await
        .unwrap();

        let dir = PathBuf::from(&installed[0].dir);
        assert_eq!(installed[0].files, ["scripts/build.py"]);
        assert!(dir.join("SKILL.md").is_file());
        assert_eq!(std::fs::read_to_string(dir.join("scripts/build.py")).unwrap(), "print('hi')");

        skills_uninstall(slug).unwrap();
        assert!(!dir.exists());
        let _ = std::fs::remove_dir_all(source);
    }

    #[tokio::test]
    async fn a_file_cannot_be_written_outside_its_skill() {
        let slug = slug();
        let result = skills_install(vec![InstallRequest {
            slug: slug.clone(),
            content: "x".into(),
            files: vec![SkillAsset {
                path: "../../escaped.md".into(),
                bytes: 1,
                url: "https://example.com/escaped.md".into(),
                skipped: None,
            }],
        }])
        .await;
        assert!(result.is_err());
        let _ = skills_uninstall(slug);
    }

    #[test]
    fn nothing_outside_the_library_can_be_removed() {
        assert!(skills_uninstall("../..".into()).is_err());
        assert!(skills_uninstall("/etc".into()).is_err());
        assert!(remove_dir(&std::env::temp_dir()).is_err());
    }

    fn request(slug: &str) -> InstallRequest {
        InstallRequest {
            slug: slug.into(),
            content: format!("---\nname: {slug}\n---\nbody"),
            files: Vec::new(),
        }
    }

    #[tokio::test]
    async fn sync_writes_the_library_and_drops_only_what_it_is_told_to() {
        let keep = slug();
        let drop = slug();
        let stranger = slug();
        skills_sync(vec![request(&keep), request(&drop)], vec![]).await.unwrap();
        std::fs::create_dir_all(root().unwrap().join(&stranger)).unwrap();

        let after = skills_sync(vec![request(&keep)], vec![drop.clone()]).await.unwrap();

        assert!(after.iter().any(|s| s.slug == keep));
        assert!(!root().unwrap().join(&drop).exists(), "an unlisted skill is removed");
        assert!(root().unwrap().join(&stranger).exists(), "a folder we never wrote is left alone");
        assert!(skills_installed().unwrap().iter().any(|s| s.slug == keep));
        let _ = skills_uninstall(keep);
        let _ = std::fs::remove_dir_all(root().unwrap().join(stranger));
    }

    /// Editing a skill's text must not cost it the scripts it came with.
    #[tokio::test]
    async fn sync_keeps_bundled_files() {
        let source = std::env::temp_dir().join(format!("mali-src-{}", uuid::Uuid::new_v4().simple()));
        std::fs::create_dir_all(&source).unwrap();
        let script = source.join("run.sh");
        std::fs::write(&script, "echo hi").unwrap();

        let slug = slug();
        skills_install(vec![InstallRequest {
            slug: slug.clone(),
            content: "before".into(),
            files: vec![SkillAsset {
                path: "run.sh".into(),
                bytes: 7,
                url: script.to_string_lossy().to_string(),
                skipped: None,
            }],
        }])
        .await
        .unwrap();

        let synced = skills_sync(vec![request(&slug)], vec![]).await.unwrap();
        assert_eq!(synced[0].files, ["run.sh"]);
        assert!(std::fs::read_to_string(root().unwrap().join(&slug).join("SKILL.md")).unwrap().contains("body"));
        let _ = skills_uninstall(slug);
        let _ = std::fs::remove_dir_all(source);
    }
}
