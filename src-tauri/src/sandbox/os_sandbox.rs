//! Run an agent's shell command inside the operating system's own sandbox.
//!
//! The command can read the disk and use the network (installs and builds
//! need both), but it can only *write* inside the folders the user granted
//! read & write, the temp folder and package-manager caches, and it can't
//! read credential folders at all. API keys in the app's environment aren't
//! passed on.
//!
//! - macOS: Seatbelt (`sandbox-exec`), built into the system.
//! - Linux: bubblewrap (`bwrap`), when it is installed.
//! - Windows: no sandbox yet; the command runs as before, still behind the
//!   risk check and the approval card.

use std::path::{Path, PathBuf};

/// Which sandbox this machine has, for Settings to show.
#[tauri::command]
pub fn sandbox_engine() -> Option<&'static str> {
    engine()
}

pub fn engine() -> Option<&'static str> {
    #[cfg(target_os = "macos")]
    {
        Path::new(SANDBOX_EXEC).is_file().then_some("macOS Seatbelt")
    }
    #[cfg(target_os = "linux")]
    {
        bwrap().map(|_| "bubblewrap")
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    {
        None
    }
}

#[cfg(target_os = "macos")]
const SANDBOX_EXEC: &str = "/usr/bin/sandbox-exec";

#[cfg(target_os = "linux")]
fn bwrap() -> Option<PathBuf> {
    ["/usr/bin/bwrap", "/usr/local/bin/bwrap", "/bin/bwrap"]
        .iter()
        .map(PathBuf::from)
        .find(|p| p.is_file())
}

/// Folders under the home folder the command may never read.
const SECRET_DIRS: &[&str] = &[
    ".ssh", ".aws", ".azure", ".gnupg", ".kube", ".docker", ".config/gcloud", ".config/gh",
    "Library/Keychains", ".password-store", ".codex", ".cursor", ".gemini", ".antigravity",
];

/// Caches package managers write to while installing.
const CACHE_DIRS: &[&str] = &[
    ".npm", ".cache", ".bun", ".pnpm-store", ".yarn", ".cargo/registry", ".cargo/git", ".rustup/tmp",
    ".gradle", ".m2", "go/pkg", ".local/share/pnpm", "Library/Caches", "Library/pnpm", ".deno", ".nuget",
];

/// Environment variables that are credentials; the command doesn't need them.
pub fn is_secret_env(name: &str) -> bool {
    let upper = name.to_ascii_uppercase();
    upper.ends_with("_API_KEY")
        || upper.ends_with("_TOKEN")
        || upper.ends_with("_SECRET")
        || upper.ends_with("_SECRET_KEY")
        || upper.ends_with("_PASSWORD")
        || upper.starts_with("AWS_")
        || upper.starts_with("AZURE_")
        || matches!(upper.as_str(), "GOOGLE_APPLICATION_CREDENTIALS" | "NPM_TOKEN" | "HF_TOKEN" | "GH_TOKEN")
}

fn existing(paths: impl IntoIterator<Item = PathBuf>) -> Vec<PathBuf> {
    paths
        .into_iter()
        .filter(|p| p.exists())
        .map(|p| std::fs::canonicalize(&p).unwrap_or(p))
        .collect()
}

fn temp_dirs() -> Vec<PathBuf> {
    let mut dirs = vec![std::env::temp_dir(), PathBuf::from("/tmp"), PathBuf::from("/var/tmp")];
    #[cfg(target_os = "macos")]
    dirs.push(PathBuf::from("/private/var/folders"));
    existing(dirs)
}

/// `program args…` wrapped to run inside the sandbox, or `None` when this
/// machine has none (the caller then runs it as is).
///
/// `read_only` are granted folders nested inside a writable one; they stay
/// read-only.
pub fn wrap(program: &Path, args: &[String], writable: &[PathBuf], read_only: &[PathBuf]) -> Option<(PathBuf, Vec<String>)> {
    let home = dirs::home_dir();
    let mut write: Vec<PathBuf> = existing(writable.iter().cloned());
    write.extend(temp_dirs());
    if let Some(home) = &home {
        write.extend(existing(CACHE_DIRS.iter().map(|d| home.join(d))));
    }
    let read_only: Vec<PathBuf> = existing(read_only.iter().cloned());
    let secrets: Vec<PathBuf> = home
        .as_ref()
        .map(|h| existing(SECRET_DIRS.iter().map(|d| h.join(d))))
        .unwrap_or_default();

    #[cfg(target_os = "macos")]
    {
        if !Path::new(SANDBOX_EXEC).is_file() {
            return None;
        }
        let mut out = vec!["-p".to_string(), seatbelt_profile(write.len(), read_only.len(), secrets.len())];
        for (i, dir) in write.iter().enumerate() {
            out.push("-D".into());
            out.push(format!("W{i}={}", dir.display()));
        }
        for (i, dir) in read_only.iter().enumerate() {
            out.push("-D".into());
            out.push(format!("R{i}={}", dir.display()));
        }
        for (i, dir) in secrets.iter().enumerate() {
            out.push("-D".into());
            out.push(format!("S{i}={}", dir.display()));
        }
        out.push(program.to_string_lossy().into_owned());
        out.extend(args.iter().cloned());
        Some((PathBuf::from(SANDBOX_EXEC), out))
    }
    #[cfg(target_os = "linux")]
    {
        let bwrap = bwrap()?;
        let mut out: Vec<String> = ["--ro-bind", "/", "/", "--dev", "/dev", "--proc", "/proc", "--die-with-parent"]
            .iter()
            .map(|s| s.to_string())
            .collect();
        for dir in &write {
            let dir = dir.display().to_string();
            out.extend(["--bind".to_string(), dir.clone(), dir]);
        }
        for dir in &read_only {
            let dir = dir.display().to_string();
            out.extend(["--ro-bind".to_string(), dir.clone(), dir]);
        }
        for dir in &secrets {
            out.extend(["--tmpfs".to_string(), dir.display().to_string()]);
        }
        out.push("--".into());
        out.push(program.to_string_lossy().into_owned());
        out.extend(args.iter().cloned());
        Some((bwrap, out))
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    {
        let _ = (program, args, write, read_only, secrets);
        None
    }
}

/// Everything allowed except writing outside the `W*` folders and reading
/// the `S*` ones. Paths come in as parameters, so no quoting can break out.
#[cfg(target_os = "macos")]
fn seatbelt_profile(writable: usize, read_only: usize, secrets: usize) -> String {
    let mut p = String::from("(version 1)\n(allow default)\n(deny file-write*)\n(allow file-write*\n");
    for i in 0..writable {
        p.push_str(&format!("  (subpath (param \"W{i}\"))\n"));
    }
    p.push_str(
        "  (literal \"/dev/null\") (literal \"/dev/zero\") (literal \"/dev/dtracehelper\")\n  (regex #\"^/dev/tty\") (regex #\"^/dev/fd/\"))\n",
    );
    // Later rules win: a read-only folder inside a writable one stays read-only.
    for i in 0..read_only {
        p.push_str(&format!("(deny file-write* (subpath (param \"R{i}\")))\n"));
    }
    if secrets > 0 {
        p.push_str("(deny file-read* file-write*\n");
        for i in 0..secrets {
            p.push_str(&format!("  (subpath (param \"S{i}\"))\n"));
        }
        p.push_str(")\n");
    }
    p
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::*;
    use std::process::Command;

    fn run(writable: &Path, script: &str) -> std::process::Output {
        let (program, args) = wrap(Path::new("/bin/sh"), &["-c".into(), script.into()], &[writable.to_path_buf()], &[]).expect("seatbelt");
        Command::new(program).args(args).current_dir(writable).output().unwrap()
    }

    #[test]
    fn writes_stay_inside_the_granted_folder() {
        let root = std::env::temp_dir().join(format!("mali-sb-{}", uuid::Uuid::new_v4().simple()));
        let work = root.join("work");
        std::fs::create_dir_all(&work).unwrap();
        let work = std::fs::canonicalize(&work).unwrap();

        assert!(run(&work, "echo hi > inside.txt && cat inside.txt").status.success());
        assert!(work.join("inside.txt").exists());

        // Home is outside the granted folder (and not a temp or cache folder).
        let home = dirs::home_dir().unwrap();
        let outside = home.join(format!(".mali-sandbox-probe-{}", uuid::Uuid::new_v4().simple()));
        let out = run(&work, &format!("echo x > '{}'", outside.display()));
        assert!(!out.status.success(), "writing to the home folder must fail");
        assert!(!outside.exists());

        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn everyday_commands_still_work_and_secrets_stay_out_of_reach() {
        let work = std::fs::canonicalize(std::env::temp_dir()).unwrap();
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
        let (program, args) =
            wrap(Path::new(&shell), &["-lc".into(), "ls >/dev/null && git --version && mkdir -p x-sb && rmdir x-sb".into()], &[work.clone()], &[])
                .unwrap();
        let out = Command::new(program).args(args).current_dir(&work).output().unwrap();
        assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));

        let ssh = dirs::home_dir().unwrap().join(".ssh");
        if ssh.is_dir() {
            let out = run(&work, &format!("ls '{}'", ssh.display()));
            assert!(!out.status.success(), "~/.ssh must not be readable");
        }
    }
}
