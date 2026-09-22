//! CLI argument parsing for the MCP runner.
//!
//! Keeps the runner dependency-free: no clap, no tokio required here.

use std::path::PathBuf;

#[derive(Debug, Clone)]
pub struct Args {
    /// Path to the JSON policy file produced by the main app.
    pub policy_path: PathBuf,
    /// Optional working directory; defaults to the policy's sandbox temp dir.
    pub work_dir: Option<PathBuf>,
    /// Arguments after `--`: the real MCP server command.
    pub command: Vec<String>,
}

impl Args {
    /// Parse `mali-mcp-runner --policy <file> [--work-dir <dir>] -- <cmd...>`.
    pub fn parse(mut raw: impl Iterator<Item = String>) -> Result<Self, String> {
        let program = raw.next().unwrap_or_else(|| "mali-mcp-runner".into());
        let mut policy_path = None;
        let mut work_dir = None;
        let mut seen_double_dash = false;
        let mut command = Vec::new();

        while let Some(arg) = raw.next() {
            if seen_double_dash {
                command.push(arg);
                continue;
            }
            if arg == "--" {
                seen_double_dash = true;
                continue;
            }
            if arg == "--policy" || arg == "-p" {
                policy_path = raw.next().map(PathBuf::from);
                if policy_path.is_none() {
                    return Err(format!("{program}: --policy requires a value"));
                }
            } else if arg == "--work-dir" || arg == "-w" {
                work_dir = raw.next().map(PathBuf::from);
                if work_dir.is_none() {
                    return Err(format!("{program}: --work-dir requires a value"));
                }
            } else {
                return Err(format!("{program}: unknown flag '{arg}'"));
            }
        }

        let policy_path = policy_path.ok_or_else(|| format!("{program}: --policy is required"))?;
        if command.is_empty() {
            return Err(format!("{program}: command is required after --"));
        }

        Ok(Self { policy_path, work_dir, command })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(args: &[&str]) -> Result<Args, String> {
        Args::parse(std::iter::once("mali-mcp-runner".into()).chain(args.iter().map(|s| s.to_string())))
    }

    #[test]
    fn parses_policy_and_command() {
        let a = parse(&["--policy", "/tmp/p.json", "--", "npx", "-y", "pkg"]).unwrap();
        assert_eq!(a.policy_path, PathBuf::from("/tmp/p.json"));
        assert_eq!(a.command, vec!["npx", "-y", "pkg"]);
        assert!(a.work_dir.is_none());
    }

    #[test]
    fn parses_optional_work_dir() {
        let a = parse(&["--policy", "p.json", "--work-dir", "/sandbox", "--", "cmd"]).unwrap();
        assert_eq!(a.work_dir, Some(PathBuf::from("/sandbox")));
    }

    #[test]
    fn rejects_missing_policy_and_command() {
        assert!(parse(&[]).is_err());
        assert!(parse(&["--policy", "p.json"]).is_err());
        assert!(parse(&["npx", "pkg"]).is_err());
    }
}
