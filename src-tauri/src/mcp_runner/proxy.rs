//! Bidirectional stdio proxy between the runner and the MCP child.
//!
//! The runner sits between OpenCode and the real MCP server: OpenCode's stdin
//! goes to the child, the child's stdout/stderr go back to OpenCode. When the
//! child exits the runner exits with the same status so OpenCode sees the real
//! exit code.

use std::io::{self, Read, Write};
use std::process::ExitStatus;
use std::thread;

use super::process::Child as SupervisedChild;

/// Proxy until the child exits. Returns the child's exit status.
pub fn run(supervised: SupervisedChild) -> Result<ExitStatus, String> {
    let mut process = supervised.process;
    let stdin = process.stdin.take().ok_or_else(|| "Missing child stdin".to_string())?;
    let stdout = process.stdout.take().ok_or_else(|| "Missing child stdout".to_string())?;
    let stderr = process.stderr.take().ok_or_else(|| "Missing child stderr".to_string())?;

    let stdin_thread = spawn_copy(io::stdin(), stdin, Direction::In);
    let stdout_thread = spawn_copy(stdout, io::stdout(), Direction::Out);
    let stderr_thread = spawn_copy(stderr, io::stderr(), Direction::Err);

    // Keep the job handle alive on this thread while the child runs.
    #[cfg(windows)]
    let _job = supervised.job;

    let status = process.wait().map_err(|e| format!("Failed to wait for MCP child: {e}"))?;

    // The child's last reply may still be in flight: wait for its pipes to
    // drain, or OpenCode loses the response to its final request. The stdin
    // copier is left to end on its own — it is blocked reading our stdin.
    let _ = stdout_thread.join();
    let _ = stderr_thread.join();
    drop(stdin_thread);

    Ok(status)
}

enum Direction {
    In,
    Out,
    Err,
}

fn spawn_copy<R, W>(mut reader: R, mut writer: W, dir: Direction) -> thread::JoinHandle<()>
where
    R: Read + Send + 'static,
    W: Write + Send + 'static,
{
    thread::spawn(move || {
        let mut buf = [0u8; 8192];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    if writer.write_all(&buf[..n]).is_err() {
                        break;
                    }
                    if writer.flush().is_err() {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
        // For stdout/stderr, closing the writer lets the other side see EOF.
        // For stdin, we drop the child's stdin so it receives EOF.
        match dir {
            Direction::In => {
                let _ = writer.flush();
            }
            _ => {}
        }
    })
}
