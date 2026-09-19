//! Running `git`: the one place that builds a git command line.
//!
//! Every call gets settings that keep a repository's own config from running
//! programs or waiting for input the app can't give:
//! - `core.fsmonitor=false`: a repo's config could otherwise name a program
//!   that `git status` runs.
//! - diffs pass `--no-ext-diff --no-textconv` (see [`DIFF_FLAGS`]).
//! - `--literal-pathspecs`: file names are never globs or pathspec magic.
//! - no prompts (`GIT_TERMINAL_PROMPT=0`, SSH in batch mode), no pager, no
//!   colors; output is read with a size cap and the process is killed on
//!   timeout.

use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::OnceLock;
use std::time::Duration;

use tokio::io::{AsyncReadExt, AsyncWriteExt};

/// Local commands (status, diff, log…).
pub const LOCAL: Duration = Duration::from_secs(30);
/// Fetch, pull and push.
pub const NETWORK: Duration = Duration::from_secs(180);
/// Output kept from one command; more means "too large".
pub const MAX_OUTPUT: usize = 8 * 1024 * 1024;

/// Flags for every command that prints a diff.
pub const DIFF_FLAGS: &[&str] = &["--no-ext-diff", "--no-textconv", "--no-color"];

pub struct Output {
    pub stdout: String,
    /// Output hit [`MAX_OUTPUT`] and was cut.
    pub truncated: bool,
}

pub struct Git {
    pub root: PathBuf,
}

impl Git {
    pub fn new(root: impl Into<PathBuf>) -> Self {
        Self { root: root.into() }
    }

    /// Run a read-only command; fails on a non-zero exit.
    pub async fn read(&self, args: &[&str]) -> Result<Output, String> {
        run(&self.root, args, None, LOCAL, true).await
    }

    /// Run a command that may change the repository.
    pub async fn write(&self, args: &[&str]) -> Result<Output, String> {
        run(&self.root, args, None, LOCAL, false).await
    }

    /// Like [`Git::write`], with `input` on stdin (commit messages).
    pub async fn write_with_input(&self, args: &[&str], input: &str) -> Result<Output, String> {
        run(&self.root, args, Some(input), LOCAL, false).await
    }

    /// Fetch, pull, push: longer timeout.
    pub async fn network(&self, args: &[&str]) -> Result<Output, String> {
        run(&self.root, args, None, NETWORK, false).await
    }
}

/// The `git` executable: `PATH`, then the usual install folders a GUI app's
/// short `PATH` misses.
pub fn git_bin() -> Option<&'static str> {
    static BIN: OnceLock<Option<String>> = OnceLock::new();
    BIN.get_or_init(|| {
        let names: &[&str] = if cfg!(windows) { &["git.exe", "git.cmd"] } else { &["git"] };
        let mut dirs: Vec<PathBuf> = std::env::var_os("PATH")
            .map(|p| std::env::split_paths(&p).collect())
            .unwrap_or_default();
        if cfg!(windows) {
            dirs.push(PathBuf::from(r"C:\Program Files\Git\cmd"));
        } else {
            dirs.extend(["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"].map(PathBuf::from));
        }
        dirs.iter()
            .flat_map(|dir| names.iter().map(move |name| dir.join(name)))
            .find(|candidate| candidate.is_file())
            .map(|p| p.to_string_lossy().into_owned())
    })
    .as_deref()
}

async fn run(
    dir: &Path,
    args: &[&str],
    input: Option<&str>,
    timeout: Duration,
    read_only: bool,
) -> Result<Output, String> {
    let bin = git_bin().ok_or("Git isn't installed. Install it from https://git-scm.com, then restart the app.")?;
    let dir_arg = dir.to_string_lossy();
    let mut full: Vec<&str> = vec![
        "-C",
        &dir_arg,
        "--literal-pathspecs",
        "-c",
        "core.fsmonitor=false",
        "-c",
        "core.quotepath=false",
        "-c",
        "color.ui=false",
        "-c",
        "log.showSignature=false",
    ];
    if read_only {
        // Don't take the index lock just to refresh it; the agent may be busy.
        full.insert(0, "--no-optional-locks");
    }
    full.extend_from_slice(args);

    let mut cmd = crate::commands::process::command(bin, &full);
    // English messages, so the hints in `friendly` match.
    cmd.env("LANGUAGE", "en")
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GCM_INTERACTIVE", "never")
        .env("GIT_PAGER", "cat")
        .env("GIT_EDITOR", "true")
        .stdin(if input.is_some() { Stdio::piped() } else { Stdio::null() })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    // SSH must fail instead of asking for a passphrase nobody can type.
    if std::env::var_os("GIT_SSH_COMMAND").is_none() {
        cmd.env("GIT_SSH_COMMAND", "ssh -o BatchMode=yes");
    }

    let mut child = cmd.spawn().map_err(|e| format!("Can't run git: {e}"))?;
    if let (Some(text), Some(mut stdin)) = (input, child.stdin.take()) {
        stdin.write_all(text.as_bytes()).await.map_err(|e| e.to_string())?;
        drop(stdin);
    }
    let mut stdout = child.stdout.take().ok_or("git has no stdout")?;
    let mut stderr = child.stderr.take().ok_or("git has no stderr")?;

    let work = async {
        let mut out = Vec::new();
        let mut truncated = false;
        let mut buf = vec![0u8; 64 * 1024];
        loop {
            let n = stdout.read(&mut buf).await.map_err(|e| e.to_string())?;
            if n == 0 {
                break;
            }
            let room = MAX_OUTPUT.saturating_sub(out.len());
            out.extend_from_slice(&buf[..n.min(room)]);
            if n > room {
                truncated = true;
                break;
            }
        }
        if truncated {
            let _ = child.start_kill();
        }
        let mut err = Vec::new();
        let _ = (&mut stderr).take(64 * 1024).read_to_end(&mut err).await;
        let status = child.wait().await.map_err(|e| e.to_string())?;
        Ok::<_, String>((out, err, status, truncated))
    };
    let (out, err, status, truncated) = tokio::time::timeout(timeout, work)
        .await
        .map_err(|_| format!("git {} took too long and was stopped", args.first().unwrap_or(&"")))??;

    if !status.success() && !truncated {
        let message = String::from_utf8_lossy(&err).trim().to_string();
        let message = if message.is_empty() { String::from_utf8_lossy(&out).trim().to_string() } else { message };
        return Err(friendly(&message));
    }
    Ok(Output { stdout: String::from_utf8_lossy(&out).into_owned(), truncated })
}

/// Git's messages, with the fix spelled out for the common ones.
fn friendly(message: &str) -> String {
    let text = message.strip_prefix("fatal: ").unwrap_or(message).trim();
    let hint = if text.contains("Please tell me who you are") || text.contains("Author identity unknown") {
        Some("Set your name and email once in a terminal: git config --global user.name \"Your Name\" && git config --global user.email you@example.com")
    } else if text.contains("could not read Username") || text.contains("Authentication failed") {
        Some("Git needs credentials for this remote. Sign in once from a terminal (e.g. `git push`) or with GitHub Desktop / `gh auth login`, then try again.")
    } else if text.contains("Permission denied (publickey)") || text.contains("Host key verification failed") {
        Some("SSH couldn't sign in. Check that your SSH key is loaded (`ssh-add`) and the host is trusted (`ssh -T git@github.com`).")
    } else if text.contains("Not possible to fast-forward") || text.contains("diverged") {
        Some("Your branch and the remote both have new commits. Merge or rebase in a terminal, then try again.")
    } else if text.contains("has no upstream branch") || text.contains("no tracking information") {
        Some("This branch isn't linked to a remote branch yet. Push it first.")
    } else if text.contains("would be overwritten by checkout") || text.contains("would be overwritten by merge") {
        Some("Commit or discard your changes first.")
    } else {
        None
    };
    match hint {
        Some(hint) => format!("{text}\n\n{hint}"),
        None => text.to_string(),
    }
}
