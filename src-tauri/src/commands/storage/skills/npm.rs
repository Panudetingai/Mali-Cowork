//! Installing skills from npm packages.
//!
//! A published skill package is a normal npm package that contains one or
//! more `SKILL.md` files. We download it with `npm pack`, extract the
//! tarball, and scan the result the same way we scan a local folder.

use std::path::Path;

use crate::commands::process::command;

use super::local::scan_dir;
use super::{SkillPackage, MAX_SKILLS};

/// Install an npm package and return any `SKILL.md` files it contains.
#[tauri::command]
pub async fn skills_install_npx(package: String) -> Result<Vec<SkillPackage>, String> {
    let package = sanitize_package(&package)?;
    let temp = std::env::temp_dir().join(format!("mali-npx-{}-skills", uuid::Uuid::new_v4().simple()));
    std::fs::create_dir_all(&temp).map_err(|e| format!("Cannot create temp folder: {e}"))?;

    let result = install_and_scan(&temp, &package).await;
    let _ = std::fs::remove_dir_all(&temp);
    result
}

fn sanitize_package(package: &str) -> Result<String, String> {
    let package = package.trim();
    if package.is_empty() {
        return Err("Package name is required".into());
    }
    if package.len() > 200 {
        return Err("Package name is too long".into());
    }
    if package.chars().any(|c| c.is_control()) {
        return Err("Package name contains invalid characters".into());
    }
    // npm package names are scoped or unscoped; allow the characters npm allows.
    if !package
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || "@/-._~".contains(c))
    {
        return Err("Package name contains invalid characters".into());
    }
    Ok(package.to_string())
}

async fn install_and_scan(temp: &Path, package: &str) -> Result<Vec<SkillPackage>, String> {
    // Download the package tarball without running any of its scripts.
    let pack = command("npm", &["pack", package, "--pack-destination", "."]);
    run_in_dir(pack, temp).await.map_err(|e| format!("Could not download {package}: {e}"))?;

    let tarball = std::fs::read_dir(temp)
        .map_err(|e| format!("Cannot read temp folder: {e}"))?
        .filter_map(Result::ok)
        .map(|e| e.path())
        .find(|p| p.extension().is_some_and(|e| e == "tgz"))
        .ok_or_else(|| format!("npm pack did not produce a tarball for {package}"))?;

    let extract = command("tar", &["-xzf", tarball.to_string_lossy().as_ref()]);
    run_in_dir(extract, temp).await?;

    let extracted = temp.join("package");
    if !extracted.is_dir() {
        return Err("The package tarball did not contain a package folder".into());
    }

    let package_label = package.to_string();
    tokio::task::spawn_blocking(move || {
        let mut found = scan_dir(&extracted);
        found.truncate(MAX_SKILLS);
        if found.is_empty() {
            return Err(format!("No SKILL.md files found in {package_label}"));
        }
        // Replace the temp path in sources with the npm package name so the
        // install dialog tells the user where the skill came from.
        for skill in &mut found {
            skill.source = format!("npm:{package_label}");
        }
        Ok(found)
    })
    .await
    .map_err(|e| e.to_string())?
}

async fn run_in_dir(
    mut cmd: tokio::process::Command,
    dir: &Path,
) -> Result<std::process::Output, String> {
    cmd.current_dir(dir);
    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::piped());
    let output = cmd
        .output()
        .await
        .map_err(|e| format!("Failed to run npm: {e}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(stderr.trim().to_string());
    }
    Ok(output)
}
