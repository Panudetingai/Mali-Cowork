use std::path::Path;
use tokio::process::Command as TokioCommand;

/// Find the opencode binary on this machine.
///
/// Search order:
/// 1. `OPENCODE_BIN` / `OPENCODE_PATH` env vars
/// 2. `where.exe opencode` (Windows) / `which opencode` (Unix)
/// 3. PATH directories, respecting `PATHEXT` on Windows
/// 4. Common npm/bun/cursor install locations on Windows
pub fn resolve_opencode_bin() -> Option<String> {
    // 1) explicit env overrides
    for key in ["OPENCODE_BIN", "OPENCODE_PATH"] {
        if let Ok(p) = std::env::var(key) {
            let trimmed = p.trim();
            if !trimmed.is_empty() && Path::new(trimmed).exists() {
                return Some(trimmed.to_string());
            }
        }
    }

    // 2) system lookup
    #[cfg(windows)]
    {
        let mut candidates: Vec<String> = Vec::new();
        for query in ["opencode", "opencode.cmd", "opencode.exe"] {
            if let Ok(out) = std::process::Command::new("where.exe").arg(query).output() {
                if out.status.success() {
                    for line in String::from_utf8_lossy(&out.stdout).lines() {
                        let p = line.trim();
                        if !p.is_empty() && Path::new(p).exists() {
                            candidates.push(p.to_string());
                        }
                    }
                }
            }
        }
        if !candidates.is_empty() {
            candidates.sort_by_key(|p| {
                let l = p.to_lowercase();
                if l.ends_with(".cmd") { 0 }
                else if l.ends_with(".exe") { 1 }
                else { 10 }
            });
            return Some(candidates[0].clone());
        }
    }

    #[cfg(not(windows))]
    {
        if let Ok(out) = std::process::Command::new("which").arg("opencode").output() {
            if out.status.success() {
                let p = String::from_utf8_lossy(&out.stdout).trim().to_string();
                if !p.is_empty() && Path::new(&p).exists() {
                    return Some(p);
                }
            }
        }
    }

    // 3) manual PATH scan
    if let Ok(path_var) = std::env::var("PATH") {
        let sep = if cfg!(windows) { ';' } else { ':' };
        let exts: Vec<String> = if cfg!(windows) {
            std::env::var("PATHEXT")
                .unwrap_or_else(|_| ".EXE;.CMD;.BAT;.COM".into())
                .split(';')
                .map(|s| s.to_string())
                .collect()
        } else {
            vec!["".into()]
        };

        for dir in path_var.split(sep) {
            if dir.is_empty() { continue; }
            for ext in &exts {
                let candidate = Path::new(dir).join(format!("opencode{ext}"));
                if candidate.exists() {
                    return Some(candidate.to_string_lossy().to_string());
                }
            }
        }
    }

    // 4) common Windows install paths
    #[cfg(windows)]
    {
        let home = std::env::var("USERPROFILE").unwrap_or_default();
        let appdata = std::env::var("APPDATA").unwrap_or_default();
        for candidate in [
            format!(r"{appdata}\npm\opencode.cmd"),
            format!(r"{appdata}\npm\opencode"),
            format!(r"{home}\.bun\bin\opencode.exe"),
        ] {
            if Path::new(&candidate).exists() {
                return Some(candidate);
            }
        }
    }

    None
}

/// Build a tokio Command that correctly invokes the binary.
///
/// On Windows, `.cmd` and `.bat` files need `cmd /D /S /C`, and shebang scripts
/// need `node`.
pub fn build_opencode_command(bin_path: &str, args: &[String]) -> TokioCommand {
    #[cfg(windows)]
    {
        let lower = bin_path.to_lowercase();
        if lower.ends_with(".cmd") || lower.ends_with(".bat") {
            let mut cmd = TokioCommand::new("cmd");
            cmd.args(["/D", "/S", "/C", bin_path]);
            cmd.args(args);
            return cmd;
        }

        if !lower.contains('.') {
            if Path::new(bin_path).exists() {
                if let Ok(content) = std::fs::read_to_string(bin_path) {
                    if content.starts_with("#!") && content.contains("node") {
                        let mut cmd = TokioCommand::new("node");
                        cmd.arg(bin_path);
                        cmd.args(args);
                        return cmd;
                    }
                }
            }
        }
    }

    let mut cmd = TokioCommand::new(bin_path);
    cmd.args(args);
    cmd
}

/// Append package-manager paths so the spawned process can find `node`, `bun`, etc.
pub fn augment_path(mut cmd: TokioCommand) -> TokioCommand {
    let Ok(cur) = std::env::var("PATH") else { return cmd; };

    #[cfg(windows)]
    {
        let home = std::env::var("USERPROFILE").unwrap_or_default();
        let appdata = std::env::var("APPDATA").unwrap_or_default();
        let extras = [format!(r"{appdata}\npm"), format!(r"{home}\.bun\bin")];
        let mut new_path = cur.clone();
        for extra in extras {
            if !cur.contains(&extra) && Path::new(&extra).exists() {
                new_path.push(';');
                new_path.push_str(&extra);
            }
        }
        cmd.env("PATH", new_path);
    }

    #[cfg(not(windows))]
    {
        let home = std::env::var("HOME").unwrap_or_default();
        let extras = [format!("{home}/.bun/bin"), format!("{home}/.local/bin")];
        for extra in extras {
            if !cur.contains(&extra) && Path::new(&extra).exists() {
                let mut p = cur.clone();
                p.push(':');
                p.push_str(&extra);
                cmd.env("PATH", p);
            }
        }
    }

    cmd
}
