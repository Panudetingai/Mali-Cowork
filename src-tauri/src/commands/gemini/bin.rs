//! Locating the `gemini` binary.

use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use tokio::process::Command;

/// Resolve the binary once and cache it for the app lifetime.
pub fn gemini_bin() -> Option<&'static str> {
    static BIN: OnceLock<Option<String>> = OnceLock::new();
    BIN.get_or_init(resolve).as_deref()
}

/// `GEMINI_BIN` first, then `PATH` and the installer's own locations.
/// GUI apps on macOS start with a minimal `PATH`, so npm/bun globals must be
/// searched explicitly.
fn resolve() -> Option<String> {
    for key in ["GEMINI_BIN", "GEMINI_CLI_BIN"] {
        if let Ok(value) = std::env::var(key) {
            let value = value.trim();
            if !value.is_empty() && Path::new(value).exists() {
                return Some(value.to_string());
            }
        }
    }

    let names: &[&str] = if cfg!(windows) {
        &["gemini.cmd", "gemini.exe", "gemini"]
    } else {
        &["gemini"]
    };

    search_dirs()
        .iter()
        .flat_map(|dir| names.iter().map(move |name| dir.join(name)))
        .find(|candidate| candidate.is_file())
        .map(|p| p.to_string_lossy().into_owned())
}

/// `PATH` entries plus the usual install locations.
pub fn search_dirs() -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = std::env::var_os("PATH")
        .map(|p| std::env::split_paths(&p).collect())
        .unwrap_or_default();

    if let Some(home) = dirs::home_dir() {
        dirs.extend([
            home.join(".local/bin"),
            home.join(".bun/bin"),
            home.join(".npm-global/bin"),
            home.join(".nvm/current/bin"),
        ]);
        #[cfg(windows)]
        dirs.push(home.join("AppData/Roaming/npm"));
    }
    dirs.extend([
        PathBuf::from("/opt/homebrew/bin"),
        PathBuf::from("/usr/local/bin"),
        PathBuf::from("/usr/bin"),
    ]);
    dirs
}

/// A command with a `PATH` the agent's own child processes can use.
pub fn gemini_command(bin: &str, args: &[&str]) -> Command {
    #[cfg(windows)]
    let mut cmd = {
        let lower = bin.to_lowercase();
        if lower.ends_with(".cmd") || lower.ends_with(".bat") {
            let mut cmd = Command::new("cmd");
            cmd.args(["/D", "/S", "/C", bin]);
            cmd
        } else {
            Command::new(bin)
        }
    };
    #[cfg(not(windows))]
    let mut cmd = Command::new(bin);

    cmd.args(args);
    if let Ok(path) = std::env::join_paths(search_dirs()) {
        cmd.env("PATH", path);
    }
    cmd
}

pub fn not_found_message() -> String {
    "gemini not found. Install it with `npm i -g @google/gemini-cli` \
     (or set GEMINI_BIN), then restart the app."
        .into()
}
