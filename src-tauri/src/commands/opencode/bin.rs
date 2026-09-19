//! Locating and invoking the `opencode` binary.

use std::path::{Path, PathBuf};

use tokio::process::Command;

use crate::commands::bin_cache::BinCache;

/// The binary's path; see [`BinCache`] for when it is looked up.
pub fn opencode_bin() -> Option<&'static str> {
    static BIN: BinCache = BinCache::new();
    BIN.get(resolve_opencode_bin)
}

/// Search order:
/// 1. `OPENCODE_BIN` / `OPENCODE_PATH` env vars
/// 2. every directory in `PATH` plus well-known install locations
///
/// GUI apps on macOS start with a minimal `PATH`, so the extra locations
/// (Homebrew, bun, npm, opencode installer) matter in release builds.
fn resolve_opencode_bin() -> Option<String> {
    for key in ["OPENCODE_BIN", "OPENCODE_PATH"] {
        if let Ok(value) = std::env::var(key) {
            let value = value.trim();
            if !value.is_empty() && Path::new(value).exists() {
                return Some(value.to_string());
            }
        }
    }

    let names: &[&str] = if cfg!(windows) {
        &["opencode.cmd", "opencode.exe", "opencode"]
    } else {
        &["opencode"]
    };

    search_dirs()
        .iter()
        .flat_map(|dir| names.iter().map(move |name| dir.join(name)))
        .find(|candidate| candidate.is_file())
        .map(|p| p.to_string_lossy().into_owned())
}

/// `PATH` entries followed by common package-manager bin directories.
fn search_dirs() -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = std::env::var_os("PATH")
        .map(|p| std::env::split_paths(&p).collect())
        .unwrap_or_default();

    for extra in extra_bin_dirs() {
        if !dirs.contains(&extra) {
            dirs.push(extra);
        }
    }
    dirs
}

fn extra_bin_dirs() -> Vec<PathBuf> {
    let Some(home) = dirs::home_dir() else {
        return Vec::new();
    };

    #[cfg(windows)]
    {
        let mut out = vec![
            home.join(".local").join("bin"),
            home.join(".bun").join("bin"),
            home.join(".opencode").join("bin"),
            home
                .join("AppData")
                .join("Local")
                .join("Programs")
                .join("uv"),
        ];
        if let Some(appdata) = std::env::var_os("APPDATA") {
            out.insert(0, PathBuf::from(appdata).join("npm"));
        }
        out
    }

    #[cfg(not(windows))]
    {
        vec![
            home.join(".opencode/bin"),
            home.join(".bun/bin"),
            home.join(".local/bin"),
            home.join(".npm-global/bin"),
            PathBuf::from("/opt/homebrew/bin"),
            PathBuf::from("/usr/local/bin"),
        ]
    }
}

/// Build a command for the binary with a `PATH` that can find `node`/`bun`.
///
/// Windows `.cmd` shims run without a shell; see [`crate::commands::process`].
pub fn opencode_command(bin: &str, args: &[&str]) -> Command {
    let mut cmd = crate::commands::process::command(bin, args);
    if let Ok(path) = std::env::join_paths(search_dirs()) {
        cmd.env("PATH", path);
    }
    cmd
}
