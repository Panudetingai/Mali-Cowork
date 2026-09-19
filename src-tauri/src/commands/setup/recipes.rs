//! How each tool is installed on each platform. Only these fixed commands
//! ever run; the UI names a tool, never a command.
//!
//! Preferred order: npm for the agents published there (no admin rights
//! needed with a user prefix), then Homebrew on macOS / winget on Windows,
//! then the vendor's official install script over HTTPS.

use std::path::{Path, PathBuf};

use serde::Serialize;

use super::detect::{self, SetupScan};

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Recipe {
    pub tool: String,
    /// The command as the user sees it in the confirmation step.
    pub display: String,
    /// `npm`, `brew`, `winget` or `script`.
    pub via: &'static str,
    #[serde(skip)]
    pub program: String,
    #[serde(skip)]
    pub args: Vec<String>,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Blocked {
    pub tool: String,
    pub reason: String,
    /// Where to get it by hand.
    pub help_url: Option<&'static str>,
}

/// npm package, Homebrew formula and official script for each agent.
struct Agent {
    npm: Option<&'static str>,
    brew: Option<&'static str>,
    unix_script: Option<&'static str>,
    windows_script: Option<&'static str>,
}

fn agent(id: &str) -> Option<Agent> {
    Some(match id {
        "opencode" => Agent {
            npm: Some("opencode-ai"),
            brew: Some("sst/tap/opencode"),
            unix_script: Some("curl -fsSL https://opencode.ai/install | bash"),
            windows_script: None,
        },
        "codex" => Agent { npm: Some("@openai/codex"), brew: Some("codex"), unix_script: None, windows_script: None },
        "gemini" => Agent { npm: Some("@google/gemini-cli"), brew: Some("gemini-cli"), unix_script: None, windows_script: None },
        "cursor" => Agent {
            npm: None,
            brew: None,
            unix_script: Some("curl https://cursor.com/install -fsS | bash"),
            windows_script: Some("irm 'https://cursor.com/install?win32=true' | iex"),
        },
        _ => return None,
    })
}

fn has(scan: &SetupScan, id: &str) -> bool {
    scan.tools.iter().any(|t| t.id == id && t.installed && !t.outdated)
}

fn shell(tool: &str, script: &str) -> Recipe {
    if cfg!(windows) {
        Recipe {
            tool: tool.into(),
            display: script.into(),
            via: "script",
            program: "powershell".into(),
            args: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script].map(String::from).to_vec(),
        }
    } else {
        Recipe {
            tool: tool.into(),
            display: script.into(),
            via: "script",
            program: "/bin/sh".into(),
            args: vec!["-c".into(), script.into()],
        }
    }
}

fn brew(tool: &str, formula: &str) -> Recipe {
    Recipe {
        tool: tool.into(),
        display: format!("brew install {formula}"),
        via: "brew",
        program: "brew".into(),
        args: vec!["install".into(), formula.into()],
    }
}

/// `npm install -g`, into `~/.npm-global` when npm's own folder needs admin
/// rights (Node from the nodejs.org installer), so no password is asked.
fn npm(tool: &str, package: &str, user_prefix: bool) -> Recipe {
    let mut args: Vec<String> = ["install", "-g", package, "--no-fund", "--no-audit"].map(String::from).to_vec();
    let mut display = format!("npm install -g {package}");
    if user_prefix {
        if let Some(home) = dirs::home_dir() {
            args.push("--prefix".into());
            args.push(home.join(".npm-global").to_string_lossy().into_owned());
            display.push_str(" --prefix ~/.npm-global");
        }
    }
    Recipe { tool: tool.into(), display, via: "npm", program: "npm".into(), args }
}

/// Whether npm can write its global folder without admin rights.
pub fn npm_global_writable(npm_prefix: &Path) -> bool {
    let dir: PathBuf = if cfg!(windows) { npm_prefix.to_path_buf() } else { npm_prefix.join("lib").join("node_modules") };
    let probe = dir.join(format!(".mali-write-test-{}", std::process::id()));
    let ok = std::fs::create_dir_all(&dir).is_ok() && std::fs::write(&probe, b"").is_ok();
    let _ = std::fs::remove_file(probe);
    ok
}

/// How to install `tool` here. `node_coming` means Node.js is installed
/// earlier in the same run, so npm can be counted on.
pub fn recipe(tool: &str, scan: &SetupScan, node_coming: bool, npm_user_prefix: bool) -> Result<Recipe, Blocked> {
    let blocked = |reason: &str, help_url| Blocked { tool: tool.into(), reason: reason.into(), help_url };
    let mac = detect::platform() == "macos";
    let win = detect::platform() == "windows";
    let node = has(scan, "node") || node_coming;

    match tool {
        "node" => {
            if mac && has(scan, "brew") {
                Ok(brew("node", "node"))
            } else if win && has(scan, "winget") {
                Ok(Recipe {
                    tool: "node".into(),
                    display: "winget install -e --id OpenJS.NodeJS.LTS".into(),
                    via: "winget",
                    program: "winget".into(),
                    args: ["install", "-e", "--id", "OpenJS.NodeJS.LTS", "--accept-source-agreements", "--accept-package-agreements"]
                        .map(String::from)
                        .to_vec(),
                })
            } else {
                Err(blocked("Install Node.js 20 or newer from nodejs.org, then press Check again.", Some("https://nodejs.org/en/download")))
            }
        }
        "uv" => {
            if mac && has(scan, "brew") {
                Ok(brew("uv", "uv"))
            } else if win {
                Ok(shell("uv", "irm https://astral.sh/uv/install.ps1 | iex"))
            } else {
                Ok(shell("uv", "curl -LsSf https://astral.sh/uv/install.sh | sh"))
            }
        }
        _ => {
            let Some(a) = agent(tool) else {
                return Err(blocked("Unknown tool", None));
            };
            if let (Some(package), true) = (a.npm, node) {
                return Ok(npm(tool, package, npm_user_prefix));
            }
            if let (Some(formula), true) = (a.brew, mac && has(scan, "brew")) {
                return Ok(brew(tool, formula));
            }
            if let (Some(script), true) = (a.windows_script, win) {
                return Ok(shell(tool, script));
            }
            if let (Some(script), false) = (a.unix_script, win) {
                return Ok(shell(tool, script));
            }
            Err(blocked(
                "Needs Node.js 20 or newer. Install it first (it's added to the plan when possible).",
                Some("https://nodejs.org/en/download"),
            ))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::super::detect::ToolState;
    use super::*;

    fn scan(installed: &[&'static str]) -> SetupScan {
        let tools = detect::TOOLS
            .iter()
            .map(|(id, name)| ToolState {
                id,
                name,
                installed: installed.contains(id),
                path: None,
                version: None,
                outdated: false,
            })
            .collect();
        SetupScan { platform: detect::platform(), simulated: false, tools }
    }

    #[test]
    fn agents_use_npm_when_node_is_there_or_coming() {
        let r = recipe("codex", &scan(&["node"]), false, false).unwrap();
        assert_eq!(r.display, "npm install -g @openai/codex");
        assert_eq!(r.args[..3], ["install", "-g", "@openai/codex"]);
        let r = recipe("gemini", &scan(&[]), true, true).unwrap();
        assert!(r.display.ends_with("--prefix ~/.npm-global"));
    }

    #[test]
    #[cfg(target_os = "macos")]
    fn macos_falls_back_to_homebrew_then_scripts() {
        assert_eq!(recipe("gemini", &scan(&["brew"]), false, false).unwrap().display, "brew install gemini-cli");
        assert_eq!(recipe("node", &scan(&["brew"]), false, false).unwrap().via, "brew");
        assert!(recipe("node", &scan(&[]), false, false).is_err());
        let cursor = recipe("cursor", &scan(&[]), false, false).unwrap();
        assert_eq!(cursor.program, "/bin/sh");
        assert!(recipe("codex", &scan(&[]), false, false).is_err(), "codex needs node or brew");
        assert!(recipe("rm -rf /", &scan(&["node"]), false, false).is_err());
    }
}
