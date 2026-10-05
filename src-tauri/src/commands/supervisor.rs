//! Every child process tree the app starts, so none outlives it.
//!
//! Agents start MCP servers (`word_mcp_server`, …), which start helpers of
//! their own (`uvx` → `python`). Killing only the direct child orphans the
//! rest, and an MCP server whose client is gone can spin on its closed stdin.
//! So each supervised child leads a tree that is always stopped as a whole:
//!
//! - Unix: the child leads its own process group, started through a small
//!   `/bin/sh` watchdog that holds a pipe (the "lifeline") from the app. When
//!   the app lets go of the pipe — [`Tree`] dropped, app quit, crash,
//!   `kill -9`, a `tauri dev` rebuild — the kernel closes it and the watchdog
//!   sends SIGTERM to the group, then SIGKILL [`GRACE_SECS`] later. It blocks on
//!   the pipe, so it costs no CPU while waiting.
//! - Windows: the child joins its own Job Object with kill-on-close, so
//!   closing the handle, or the app dying, ends every process in it.
//!
//! Crashes need no hook of their own: release builds abort on panic, and a
//! dead process's pipes and handles are closed by the OS, which fires the
//! watchdogs and job objects above.
//!
//! Supervised programs get `/dev/null` as stdin; the lifeline takes its place.

use std::collections::HashMap;
use std::io;
use std::sync::{Mutex, OnceLock};

use tokio::process::{Child, Command};

/// Time a tree gets to exit after SIGTERM before the watchdog sends SIGKILL.
#[cfg(unix)]
const GRACE_SECS: u32 = 3;

/// Runs as the group leader with the lifeline on stdin. A background watcher
/// keeps a copy of the lifeline, then the shell `exec`s the real program with
/// `/dev/null` as stdin. The watcher ignores SIGTERM so it outlives the
/// program and can sweep up whatever the program left behind; its output goes
/// to `/dev/null` so it never holds the program's stdout pipe open.
#[cfg(unix)]
fn watchdog_script() -> String {
    format!(
        r#"exec 3<&0 </dev/null
(
  trap '' TERM INT HUP
  while read -r _; do :; done <&3
  kill -s TERM 0 2>/dev/null
  /bin/sleep {GRACE_SECS}
  kill -s KILL 0 2>/dev/null
) >/dev/null 2>&1 &
exec "$@" 3<&-"#
    )
}

/// Wrap a configured command so [`spawn`] can supervise it. Set stdout,
/// stderr and the working folder afterwards, as usual; stdin is taken.
pub fn command(inner: Command) -> Command {
    #[cfg(unix)]
    {
        let std = inner.as_std();
        let mut cmd = Command::new("/bin/sh");
        cmd.arg("-c")
            .arg(watchdog_script())
            .arg("mali-watchdog")
            .arg(std.get_program())
            .args(std.get_args());
        for (key, value) in std.get_envs() {
            match value {
                Some(value) => cmd.env(key, value),
                None => cmd.env_remove(key),
            };
        }
        if let Some(dir) = std.get_current_dir() {
            cmd.current_dir(dir);
        }
        cmd.process_group(0);
        cmd
    }
    #[cfg(windows)]
    {
        inner
    }
}

/// Start a command built with [`command`]. The returned [`Tree`] owns the
/// child's whole process tree: dropping it stops everything still running.
pub fn spawn(cmd: &mut Command, label: &'static str) -> io::Result<(Child, Tree)> {
    #[cfg(unix)]
    {
        let (lifeline_rx, lifeline) = io::pipe()?;
        cmd.stdin(lifeline_rx);
        let spawned = cmd.spawn();
        // Don't keep the read end open in the app.
        cmd.stdin(std::process::Stdio::null());
        let child = spawned?;
        let pid = child
            .id()
            .ok_or_else(|| io::Error::other("child exited at once"))?;
        registry().lock().unwrap().insert(pid, Entry { label });
        Ok((
            child,
            Tree {
                pid,
                lifeline: Some(lifeline),
            },
        ))
    }
    #[cfg(windows)]
    {
        cmd.stdin(std::process::Stdio::null());
        let child = cmd.spawn()?;
        let pid = child
            .id()
            .ok_or_else(|| io::Error::other("child exited at once"))?;
        // OpenCode owns the MCP child processes, so its Job Object is the
        // process-tree boundary that also contains every local MCP server.
        // Only kill-on-close: the MCP sandbox's 1 GB / 20-process limits made
        // Windows refuse memory to OpenCode (Bun) and to builds, which then
        // died with "out of memory". MCP servers get those limits from
        // `mali-mcp-runner`, which puts each one in a job of its own.
        let job = child.raw_handle().and_then(crate::mcp_runner::job::kill_on_close);
        if job.is_none() {
            eprintln!("[supervisor] {label} ({pid}) runs without a job object");
        }
        registry().lock().unwrap().insert(pid, Entry { label, job });
        Ok((child, Tree { pid }))
    }
}

/// A supervised process tree. Dropping it stops whatever is still running.
pub struct Tree {
    pid: u32,
    #[cfg(unix)]
    lifeline: Option<io::PipeWriter>,
}

impl Tree {
    pub fn pid(&self) -> u32 {
        self.pid
    }

    /// Stop the whole tree now instead of waiting for the drop.
    pub fn stop(&mut self) {
        terminate(self.pid);
        #[cfg(unix)]
        self.lifeline.take();
    }
}

impl Drop for Tree {
    fn drop(&mut self) {
        // Unix: the lifeline closes with `self` and the watchdog takes over.
        // Windows: the job handle closes with the entry and kills the tree.
        registry().lock().unwrap().remove(&self.pid);
    }
}

struct Entry {
    label: &'static str,
    #[cfg(windows)]
    job: Option<crate::mcp_runner::job::Job>,
}

/// Trees that are alive, by the pid of their leader.
fn registry() -> &'static Mutex<HashMap<u32, Entry>> {
    static TREES: OnceLock<Mutex<HashMap<u32, Entry>>> = OnceLock::new();
    TREES.get_or_init(Default::default)
}

/// Stop the tree led by `pid`, if the app still supervises it. The check
/// matters: while its [`Tree`] lives, the watchdog keeps the process group
/// alive, so the id can't have been handed to another program.
pub fn terminate(pid: u32) {
    if let Some(entry) = registry().lock().unwrap().get(&pid) {
        signal_tree(pid, entry);
    }
}

/// Stop every tree. Called when the app quits or is told to stop; the
/// watchdogs follow up with SIGKILL once the app is gone.
pub fn shutdown_all() {
    let trees = registry().lock().unwrap_or_else(|e| e.into_inner());
    for (pid, entry) in trees.iter() {
        eprintln!("[supervisor] stopping {} ({pid})", entry.label);
        signal_tree(*pid, entry);
    }
}

#[cfg(unix)]
fn signal_tree(pid: u32, _entry: &Entry) {
    if let Ok(pgid) = libc::pid_t::try_from(pid) {
        // SAFETY: plain syscall; `pgid` is a group this app created.
        unsafe { libc::killpg(pgid, libc::SIGTERM) };
    }
}

#[cfg(windows)]
fn signal_tree(pid: u32, entry: &Entry) {
    match &entry.job {
        Some(job) => job.terminate(),
        None => {
            let _ = crate::commands::process::std_command("taskkill")
                .args(["/PID", &pid.to_string(), "/T", "/F"])
                .status();
        }
    }
}

/// Stop every tree when the app gets SIGINT, SIGTERM or SIGHUP, then exit.
/// Without this, Ctrl+C in `tauri dev` or a `kill` ends the app without
/// running its exit hook.
pub fn exit_on_signals() {
    #[cfg(unix)]
    tauri::async_runtime::spawn(async {
        use tokio::signal::unix::{signal, SignalKind};
        let kinds = [
            (SignalKind::interrupt(), 130),
            (SignalKind::terminate(), 143),
            (SignalKind::hangup(), 129),
        ];
        let mut waits = Vec::new();
        for (kind, code) in kinds {
            match signal(kind) {
                Ok(mut stream) => waits.push(Box::pin(async move {
                    stream.recv().await;
                    code
                })),
                Err(e) => eprintln!("[supervisor] can't watch signal: {e}"),
            }
        }
        if waits.is_empty() {
            return;
        }
        let (code, _, _) = futures::future::select_all(waits).await;
        shutdown_all();
        std::process::exit(code);
    });
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::time::{Duration, Instant};

    fn group_alive(pgid: u32) -> bool {
        // SAFETY: signal 0 only checks that the group exists.
        unsafe { libc::killpg(pgid as libc::pid_t, 0) == 0 }
    }

    /// The watchdog itself stays in the group for the grace period.
    const SETTLE: Duration = Duration::from_secs(GRACE_SECS as u64 + 2);

    async fn gone_within(pgid: u32, limit: Duration) -> bool {
        let start = Instant::now();
        while start.elapsed() < limit {
            if !group_alive(pgid) {
                return true;
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        false
    }

    /// A program with a child of its own, like an agent with an MCP server.
    fn parent_with_grandchild(ignore_term: bool) -> Command {
        let script = if ignore_term {
            "trap '' TERM; /bin/sleep 60 & /bin/sleep 60"
        } else {
            "/bin/sleep 60 & /bin/sleep 60"
        };
        let mut inner = Command::new("/bin/sh");
        inner.args(["-c", script]);
        let mut cmd = command(inner);
        cmd.stdout(std::process::Stdio::null());
        cmd
    }

    #[tokio::test]
    async fn dropping_the_tree_ends_the_grandchildren_too() {
        let (mut child, tree) = spawn(&mut parent_with_grandchild(false), "test").unwrap();
        let pgid = tree.pid();
        tokio::time::sleep(Duration::from_millis(300)).await;
        assert!(group_alive(pgid));
        drop(tree);
        assert!(gone_within(pgid, SETTLE).await, "group still running");
        let _ = child.wait().await;
    }

    #[tokio::test]
    async fn programs_that_ignore_sigterm_are_killed_after_the_grace_period() {
        let (mut child, mut tree) = spawn(&mut parent_with_grandchild(true), "test").unwrap();
        let pgid = tree.pid();
        tokio::time::sleep(Duration::from_millis(300)).await;
        tree.stop();
        assert!(gone_within(pgid, SETTLE).await, "group survived SIGKILL");
        let _ = child.wait().await;
    }

    #[tokio::test]
    async fn leftovers_are_swept_after_the_program_exits() {
        let mut inner = Command::new("/bin/sh");
        // Exits at once, leaving a child behind, as a crashing agent would.
        inner.args(["-c", "/bin/sleep 60 &"]);
        let mut cmd = command(inner);
        let (mut child, tree) = spawn(&mut cmd, "test").unwrap();
        let pgid = tree.pid();
        assert!(child.wait().await.unwrap().success());
        assert!(group_alive(pgid), "the orphan is still in the group");
        drop(tree);
        assert!(gone_within(pgid, SETTLE).await, "orphan survived");
    }

    #[tokio::test]
    async fn output_and_exit_code_pass_through() {
        let mut inner = Command::new("/bin/sh");
        inner.args([
            "-c",
            "echo \"$0:$1\"; read x; echo \"stdin:$x\"; exit 7",
            "a b",
            "c",
        ]);
        let mut cmd = command(inner);
        cmd.stdout(std::process::Stdio::piped());
        let (child, _tree) = spawn(&mut cmd, "test").unwrap();
        let out = child.wait_with_output().await.unwrap();
        assert_eq!(out.status.code(), Some(7));
        assert_eq!(String::from_utf8_lossy(&out.stdout), "a b:c\nstdin:\n");
    }
}
