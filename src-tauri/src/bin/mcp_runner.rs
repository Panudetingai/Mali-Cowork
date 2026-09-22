//! `mali-mcp-runner` — sandboxed launcher for local MCP servers.
//!
//! OpenCode spawns this executable instead of the MCP server directly. The
//! runner loads a JSON policy written by the main app, sanitises the
//! environment, constrains the process tree with a Windows Job Object, and
//! proxies stdio. When the runner exits, its Job Object kills any remaining
//! MCP helpers.

use std::process::ExitCode;

fn main() -> ExitCode {
    let args = match mali_cowork_lib::mcp_runner::Args::parse(std::env::args()) {
        Ok(a) => a,
        Err(e) => {
            eprintln!("{e}");
            return ExitCode::from(2);
        }
    };

    match mali_cowork_lib::mcp_runner::run(args) {
        Ok(status) => {
            if let Some(code) = status.code() {
                // Normalize to u8; if the child used a large code we still
                // signal failure without wrapping.
                ExitCode::from(code.clamp(0, 255) as u8)
            } else {
                ExitCode::from(1)
            }
        }
        Err(e) => {
            eprintln!("[mcp-runner] {e}");
            ExitCode::from(1)
        }
    }
}
