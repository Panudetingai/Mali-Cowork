//! The skill library: find, preview, install and export Agent Skills.
//!
//! A skill is a folder holding a `SKILL.md` — front matter with `name` and
//! `description`, then the instructions — and, optionally, the scripts,
//! references and assets those instructions point at. Installing one copies
//! the whole folder into the app's skill library (see `install`), where an
//! agent reads it when a task matches, instead of every skill's text riding
//! along in the system prompt.
//!
//! Nothing is ever run while importing or installing, and the user sees the
//! list of files — and can read any of them — before anything is written.

mod command;
mod discover;
mod install;
mod local;
mod npm;
pub mod remote;
pub mod source;
pub mod tree;

use std::path::PathBuf;

use serde::{Deserialize, Serialize};

pub use discover::skills_search_repos;
pub use install::{skills_dir, skills_install, skills_installed, skills_sync, skills_uninstall};
pub use local::{skills_export_folder, skills_scan_folder};
pub use npm::skills_install_npx;
pub use remote::{skills_fetch_url, skills_read_asset};

/// A `SKILL.md` is a short guide; anything bigger is not one.
pub const MAX_SKILL_BYTES: usize = 256 * 1024;
/// One bundled script, reference or asset.
pub const MAX_ASSET_BYTES: u64 = 2 * 1024 * 1024;
/// Everything one skill folder may hold.
pub const MAX_PACKAGE_BYTES: u64 = 16 * 1024 * 1024;
pub const MAX_ASSETS: usize = 200;
/// How many skills one repository or folder may offer at once.
pub const MAX_SKILLS: usize = 400;
pub const MAX_SCAN_DEPTH: usize = 6;

const SKIP_DIRS: &[&str] = &[".git", "node_modules", "target", ".venv", "venv", "dist", "build"];

/// Formats that are programs rather than skill material. A skill's scripts
/// (`.sh`, `.py`, `.js`…) are kept — they are text the user can read — but
/// compiled binaries are never copied onto the machine.
const BLOCKED_EXTENSIONS: &[&str] = &[
    "exe", "dll", "so", "dylib", "bin", "app", "pkg", "dmg", "msi", "bat", "cmd", "com", "scr",
    "jar", "apk", "deb", "rpm", "iso", "img", "o", "a", "lib", "node", "wasm", "pyc", "pyo",
    "class", "elf", "ko", "sys",
];

/// One file beside a `SKILL.md`, as offered to the user before installing.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillAsset {
    /// Where it goes inside the skill folder, e.g. `scripts/build.py`.
    pub path: String,
    pub bytes: u64,
    /// Where to read it from: an `https` URL or an absolute path on this Mac.
    pub url: String,
    /// Why it won't be installed, when it won't be.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub skipped: Option<String>,
}

/// A skill found somewhere, ready to preview and install.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillPackage {
    /// Where the `SKILL.md` came from (a URL or a path), shown in the picker.
    pub source: String,
    /// The folder holding it — the fallback name when the file has no `name`.
    pub folder: String,
    pub content: String,
    /// Everything else in that folder.
    pub files: Vec<SkillAsset>,
}

pub fn is_skill_file(name: &str) -> bool {
    name.eq_ignore_ascii_case("SKILL.md")
}

/// The name of the folder a path sits in.
pub fn folder_of(path: &str) -> String {
    let mut parts: Vec<&str> = path.split(['/', '\\']).filter(|p| !p.is_empty()).collect();
    parts.pop();
    parts.pop().unwrap_or_default().to_string()
}

pub fn skip_dir(name: &str) -> bool {
    SKIP_DIRS.contains(&name)
}

/// A folder name for one skill that can't escape the skills folder.
pub fn safe_slug(slug: &str) -> Result<&str, String> {
    let ok = !slug.is_empty()
        && slug.len() <= 200
        && slug != "."
        && slug != ".."
        && !slug.starts_with('.')
        && !slug.ends_with(' ')
        && !slug.ends_with('.')
        && !slug.chars().any(|c| c.is_control() || "<>:\"/\\|?*".contains(c));
    ok.then_some(slug).ok_or_else(|| format!("Invalid skill folder name: {slug:?}"))
}

/// A path inside a skill folder that can't reach outside it.
pub fn safe_relative(path: &str) -> Result<PathBuf, String> {
    let bad = |why: &str| Err(format!("{path}: {why}"));
    if path.is_empty() || path.len() > 400 {
        return bad("the path is empty or too long");
    }
    if path.starts_with('/') || path.contains('\\') || path.contains(':') {
        return bad("only relative paths can go in a skill folder");
    }
    let parts: Vec<&str> = path.split('/').collect();
    if parts.len() > MAX_SCAN_DEPTH {
        return bad("nested too deeply");
    }
    let mut out = PathBuf::new();
    for part in parts {
        if part.is_empty() || part.starts_with('.') || part == ".." {
            return bad("has an empty, hidden or “..” part");
        }
        if part.len() > 120 || part.ends_with(' ') || part.ends_with('.') {
            return bad("has an unusable name");
        }
        if part.chars().any(|c| c.is_control() || "<>:\"|?*".contains(c)) {
            return bad("has an unusable name");
        }
        out.push(part);
    }
    Ok(out)
}

pub fn human_bytes(bytes: u64) -> String {
    match bytes {
        0..=1023 => format!("{bytes} B"),
        1024..=1_048_575 => format!("{:.0} KB", bytes as f64 / 1024.0),
        _ => format!("{:.1} MB", bytes as f64 / 1_048_576.0),
    }
}

/// Why a file beside a `SKILL.md` won't be installed, if it won't be.
pub fn blocked_reason(path: &str, bytes: u64) -> Option<String> {
    if let Err(why) = safe_relative(path) {
        return Some(why);
    }
    if bytes > MAX_ASSET_BYTES {
        return Some(format!("{} — larger than {}", human_bytes(bytes), human_bytes(MAX_ASSET_BYTES)));
    }
    let name = path.rsplit('/').next().unwrap_or(path);
    let ext = name.rsplit_once('.').map(|(_, e)| e.to_ascii_lowercase())?;
    BLOCKED_EXTENSIONS
        .contains(&ext.as_str())
        .then(|| format!("a .{ext} file is a program, not skill material"))
}

/// Keep the assets a skill may carry within the limits, marking the rest as
/// skipped so the user sees what was left out and why.
pub fn vet_assets(mut assets: Vec<SkillAsset>) -> Vec<SkillAsset> {
    assets.sort_by(|a, b| a.path.cmp(&b.path));
    assets.truncate(MAX_ASSETS);
    let mut total = 0u64;
    for asset in &mut assets {
        asset.skipped = blocked_reason(&asset.path, asset.bytes).or_else(|| {
            total = total.saturating_add(asset.bytes);
            (total > MAX_PACKAGE_BYTES)
                .then(|| format!("the skill is over {}", human_bytes(MAX_PACKAGE_BYTES)))
        });
    }
    assets
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slugs_cannot_escape_the_folder() {
        assert!(safe_slug("weekly-report").is_ok());
        assert!(safe_slug("สรุปงาน").is_ok());
        assert!(safe_slug("ส่งงาน-v2").is_ok());
        for bad in ["", "..", ".hidden", "a/b", "a\\b", "../x", "a:b", "x\n", "x."] {
            assert!(safe_slug(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn asset_paths_cannot_escape_the_skill() {
        assert!(safe_relative("scripts/build.py").is_ok());
        assert!(safe_relative("references/รูปแบบ.md").is_ok());
        for bad in ["", "/etc/passwd", "../../x", "a/../b", "a//b", "scripts/.env", "a\\b", "C:/x", "a/b/c/d/e/f/g"] {
            assert!(safe_relative(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn programs_are_left_out_but_scripts_are_kept() {
        assert_eq!(blocked_reason("scripts/run.sh", 100), None);
        assert_eq!(blocked_reason("scripts/run.py", 100), None);
        assert_eq!(blocked_reason("references/notes.md", 100), None);
        assert_eq!(blocked_reason("LICENSE", 100), None);
        assert!(blocked_reason("bin/tool.exe", 100).is_some());
        assert!(blocked_reason("lib/native.dylib", 100).is_some());
        assert!(blocked_reason("assets/huge.png", MAX_ASSET_BYTES + 1).is_some());
        assert!(blocked_reason("../escape.md", 100).is_some());
    }

    #[test]
    fn a_skill_that_is_too_big_is_trimmed_not_refused() {
        let asset = |path: &str, bytes: u64| SkillAsset {
            path: path.into(),
            bytes,
            url: format!("https://example.com/{path}"),
            skipped: None,
        };
        let big = MAX_ASSET_BYTES;
        let assets = vet_assets((0..12).map(|i| asset(&format!("a{i:02}.md"), big)).collect());
        assert!(assets.iter().take(8).all(|a| a.skipped.is_none()), "first 16 MB fit");
        assert!(assets.iter().any(|a| a.skipped.is_some()), "the rest are skipped");
    }
}
