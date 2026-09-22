//! Locating the Antigravity CLI binary (`agy`).
//!
//! The installer (`https://antigravity.google/cli/install.sh`) puts it in
//! `~/.local/bin/agy`; on Windows in `%LOCALAPPDATA%\agy\bin`.

use std::path::{Path, PathBuf};

use tokio::process::Command;

use crate::commands::bin_cache::BinCache;

/// The binary's path; see [`BinCache`] for when it is looked up.
pub fn antigravity_bin() -> Option<&'static str> {
    static BIN: BinCache = BinCache::new();
    BIN.get(resolve)
}

/// `AGY_BIN` first, then `PATH` and the installer's own locations.
/// GUI apps on macOS start with a minimal `PATH`, so `~/.local/bin` must be
/// searched explicitly.
fn resolve() -> Option<String> {
    for key in ["AGY_BIN", "ANTIGRAVITY_BIN"] {
        if let Ok(value) = std::env::var(key) {
            let value = value.trim();
            if !value.is_empty() && Path::new(value).exists() {
                return Some(value.to_string());
            }
        }
    }

    let names: &[&str] = if cfg!(windows) {
        &["agy.exe", "agy.cmd", "agy"]
    } else {
        &["agy"]
    };

    search_dirs()
        .iter()
        .flat_map(|dir| names.iter().map(move |name| dir.join(name)))
        .find(|candidate| candidate.is_file())
        .map(|p| p.to_string_lossy().into_owned())
}

/// `PATH` entries plus the installer's locations.
pub fn search_dirs() -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = std::env::var_os("PATH")
        .map(|p| std::env::split_paths(&p).collect())
        .unwrap_or_default();

    if let Some(home) = dirs::home_dir() {
        // `~/.local/bin` is where install.sh lands.
        dirs.push(home.join(".local/bin"));
        #[cfg(windows)]
        dirs.push(home.join("AppData/Local/agy/bin"));
    }
    #[cfg(windows)]
    if let Some(local) = dirs::data_local_dir() {
        dirs.push(local.join("agy").join("bin"));
    }
    dirs.extend([
        PathBuf::from("/opt/homebrew/bin"),
        PathBuf::from("/usr/local/bin"),
        PathBuf::from("/usr/bin"),
    ]);
    dirs
}

/// A command with a `PATH` the agent's own child processes can use.
pub fn antigravity_command(bin: &str, args: &[&str]) -> Command {
    let mut cmd = crate::commands::process::command(bin, args);
    if let Ok(path) = std::env::join_paths(search_dirs()) {
        cmd.env("PATH", path);
    }
    // A check that times out is dropped; don't leave it running.
    cmd.kill_on_drop(true);
    cmd
}

/// Where the CLI keeps its own settings (`modelProvider`, permission rules).
pub fn settings_path() -> Option<PathBuf> {
    dirs::home_dir().map(|home| home.join(".gemini").join("antigravity-cli").join("settings.json"))
}

pub fn not_found_message() -> String {
    if cfg!(windows) {
        "Antigravity CLI (agy) not found. Install it in PowerShell with \
         `irm https://antigravity.google/cli/install.ps1 | iex` (or set AGY_BIN), \
         then restart the app."
            .into()
    } else {
        "Antigravity CLI (agy) not found. Install it with \
         `curl -fsSL https://antigravity.google/cli/install.sh | bash` (or set AGY_BIN), \
         then restart the app."
            .into()
    }
}
