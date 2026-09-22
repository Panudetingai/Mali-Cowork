//! What's installed on this computer: runtimes the agents need, and the
//! agents themselves.

use std::path::PathBuf;
use std::time::Duration;

use serde::Serialize;

use super::simulate;

/// Every tool onboarding knows how to find (and mostly how to install).
pub const TOOLS: &[(&str, &str)] = &[
    ("node", "Node.js"),
    ("git", "Git"),
    ("brew", "Homebrew"),
    ("winget", "winget"),
    ("uv", "uv (Python tools)"),
    ("opencode", "OpenCode"),
    ("codex", "Codex CLI"),
    ("antigravity", "Antigravity CLI"),
    ("cursor", "Cursor Agent"),
];

/// Node.js older than this can't run the agents' npm packages.
pub const NODE_MIN_MAJOR: u32 = 20;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ToolState {
    pub id: &'static str,
    pub name: &'static str,
    pub installed: bool,
    pub path: Option<String>,
    pub version: Option<String>,
    /// Installed but too old to use.
    pub outdated: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SetupScan {
    /// `macos`, `windows` or `linux`.
    pub platform: &'static str,
    /// `MALI_SIMULATE_NEW_USER` is on: nothing is really installed or changed.
    pub simulated: bool,
    pub tools: Vec<ToolState>,
}

pub fn platform() -> &'static str {
    if cfg!(windows) {
        "windows"
    } else if cfg!(target_os = "macos") {
        "macos"
    } else {
        "linux"
    }
}

/// Folders searched besides `PATH`: a GUI app's `PATH` is short, and
/// installers put things in these.
pub fn extra_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if let Some(home) = dirs::home_dir() {
        for sub in [".local/bin", ".npm-global/bin", ".bun/bin", ".cargo/bin", ".opencode/bin"] {
            dirs.push(home.join(sub));
        }
        #[cfg(windows)]
        {
            dirs.push(home.join("AppData").join("Roaming").join("npm"));
            dirs.push(home.join("AppData").join("Local").join("Microsoft").join("WindowsApps"));
            dirs.push(home.join("AppData").join("Local").join("cursor-agent"));
        }
    }
    #[cfg(windows)]
    {
        dirs.push(PathBuf::from(r"C:\Program Files\nodejs"));
        dirs.push(PathBuf::from(r"C:\Program Files\Git\cmd"));
    }
    #[cfg(not(windows))]
    dirs.extend(["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"].map(PathBuf::from));
    dirs
}

/// `PATH` for installers: the user's plus [`extra_dirs`], so `npm` finds
/// `node` and new tools are found right after installing.
pub fn child_path() -> Option<std::ffi::OsString> {
    let mut dirs: Vec<PathBuf> = std::env::var_os("PATH").map(|p| std::env::split_paths(&p).collect()).unwrap_or_default();
    for dir in extra_dirs() {
        if !dirs.contains(&dir) {
            dirs.push(dir);
        }
    }
    std::env::join_paths(dirs).ok()
}

pub fn find(name: &str) -> Option<PathBuf> {
    let names: Vec<String> = if cfg!(windows) {
        ["exe", "cmd", "bat"].iter().map(|ext| format!("{name}.{ext}")).collect()
    } else {
        vec![name.to_string()]
    };
    let mut dirs: Vec<PathBuf> = std::env::var_os("PATH").map(|p| std::env::split_paths(&p).collect()).unwrap_or_default();
    dirs.extend(extra_dirs());
    dirs.iter().flat_map(|d| names.iter().map(move |n| d.join(n))).find(|p| p.is_file())
}

/// The binary that proves a tool is installed.
fn binary_of(id: &str) -> Option<PathBuf> {
    use crate::commands::{codex, cursor, antigravity, opencode};
    let known = match id {
        "opencode" => opencode::installed_bin(),
        "codex" => codex::installed_bin(),
        "antigravity" => antigravity::installed_bin(),
        "cursor" => cursor::installed_bin(),
        _ => None,
    };
    known.map(PathBuf::from).or_else(|| match id {
        "node" => find("node"),
        "git" => find("git"),
        "brew" if cfg!(target_os = "macos") => find("brew"),
        "winget" if cfg!(windows) => find("winget"),
        "uv" => find("uvx"),
        _ => None,
    })
}

async fn version_of(path: &PathBuf) -> Option<String> {
    let mut cmd = crate::commands::process::command(&path.to_string_lossy(), &["--version"]);
    cmd.kill_on_drop(true);
    if let Some(p) = child_path() {
        cmd.env("PATH", p);
    }
    let out = tokio::time::timeout(Duration::from_secs(5), cmd.output()).await.ok()?.ok()?;
    let text = String::from_utf8_lossy(&out.stdout);
    text.lines().next().map(|l| l.trim().trim_start_matches('v').to_string()).filter(|v| !v.is_empty())
}

pub async fn tool(id: &str) -> ToolState {
    let (id, name) = TOOLS.iter().copied().find(|(t, _)| *t == id).unwrap_or(("?", "?"));
    if simulate::enabled() && !simulate::installed(id) {
        return ToolState { id, name, installed: false, path: None, version: None, outdated: false };
    }
    let path = binary_of(id);
    let version = match (&path, id) {
        (Some(p), "node") => version_of(p).await,
        _ => None,
    };
    let outdated = id == "node"
        && version
            .as_deref()
            .and_then(|v| v.split('.').next()?.parse::<u32>().ok())
            .is_some_and(|major| major < NODE_MIN_MAJOR);
    ToolState {
        id,
        name,
        installed: path.is_some() || (simulate::enabled() && simulate::installed(id)),
        path: path.map(|p| p.to_string_lossy().into_owned()),
        version,
        outdated,
    }
}

pub async fn scan() -> SetupScan {
    let states = futures::future::join_all(
        TOOLS
            .iter()
            .filter(|(id, _)| match *id {
                "brew" => cfg!(target_os = "macos"),
                "winget" => cfg!(windows),
                _ => true,
            })
            .map(|(id, _)| tool(id)),
    )
    .await;
    SetupScan { platform: platform(), simulated: simulate::enabled(), tools: states }
}
