//! MCP Runner: the wrapper that the main app puts between OpenCode and each
//! local MCP server so that OS-level restrictions can be applied even though
//! OpenCode owns the stdio protocol.

mod args;
pub mod job;
mod policy;
mod process;
mod proxy;

pub use args::Args;

use std::path::PathBuf;
use std::process::ExitStatus;

/// Run one MCP server to completion. Used by the `mali-mcp-runner` binary.
pub fn run(args: Args) -> Result<ExitStatus, String> {
    let supervised = process::spawn(&args.policy_path, &args.command, args.work_dir.as_deref())?;
    proxy::run(supervised)
}

/// Return the absolute path to the runner binary next to the current process.
/// In a Tauri bundle the runner is shipped beside the main executable.
pub fn runner_binary_path() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let dir = exe.parent()?;
    #[cfg(windows)]
    let name = "mali-mcp-runner.exe";
    #[cfg(not(windows))]
    let name = "mali-mcp-runner";
    let candidate = dir.join(name);
    if candidate.is_file() {
        return Some(candidate);
    }
    // Said once: without the runner beside the app, MCP servers start
    // unwrapped — no environment scoping and no process-tree containment. It is
    // built next to the app by cargo, but a bundle only ships it when it is
    // listed in `bundle.externalBin`.
    static WARNED: std::sync::OnceLock<()> = std::sync::OnceLock::new();
    WARNED.get_or_init(|| {
        eprintln!("[mcp] {} is not next to the app: MCP servers run unsandboxed", candidate.display());
    });
    None
}
