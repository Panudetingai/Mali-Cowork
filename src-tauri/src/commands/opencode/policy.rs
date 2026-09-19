//! Per-folder access for Cowork prompts.
//!
//! The user grants each folder as read-only or read & write. Opencode's own
//! rules match edits by project-relative paths, which can't express "this
//! absolute folder is read-only", so the session asks us about every edit
//! whenever a read-only folder is involved, and about every shell command,
//! and we answer here.
//!
//! Paths are compared after resolving `..` and symlinks, so `/w/../docs` or a
//! link inside a writable folder can't reach into a read-only one.

use std::path::{Component, Path, PathBuf};

use serde_json::{json, Value};

use super::events::PermissionAsk;
use super::FolderGrant;

const READ_ONLY_MESSAGE: &str = "The user granted this folder as read-only. Do not modify, \
create or delete files there; report what you would change instead.";

pub enum Decision {
    Approve,
    Reject(&'static str),
    /// Show the request to the user.
    AskUser,
}

pub struct FolderPolicy {
    folders: Vec<(PathBuf, bool)>,
    cwd: PathBuf,
    cwd_writable: bool,
}

impl FolderPolicy {
    /// `cwd` is always part of the policy; `grants` should include it.
    pub fn new(cwd: &Path, grants: &[FolderGrant]) -> Self {
        let folders: Vec<(PathBuf, bool)> = grants
            .iter()
            .map(|g| (grant_dir(&g.path), g.writable()))
            .collect();
        let cwd = resolve(cwd);
        let cwd_writable = most_specific(&folders, &cwd).map_or(true, |(_, w)| *w);
        Self { folders, cwd, cwd_writable }
    }

    /// Add a folder the user granted while the prompt was running.
    pub fn grant(&mut self, grant: &FolderGrant) {
        let dir = grant_dir(&grant.path);
        self.folders.retain(|(d, _)| *d != dir);
        self.folders.push((dir, grant.writable()));
    }

    fn has_read_only(&self) -> bool {
        !self.cwd_writable || self.folders.iter().any(|(_, w)| !w)
    }

    /// Session rules: granted folders need no prompt; with a read-only folder in
    /// play, every edit and command comes to [`Self::decide`].
    pub fn rules(&self) -> Vec<Value> {
        let mut rules: Vec<Value> = self
            .folders
            .iter()
            .map(|(dir, _)| rule("external_directory", &format!("{}/*", dir.display()), "allow"))
            .collect();
        if self.has_read_only() {
            rules.push(rule("edit", "*", "ask"));
        }
        // Commands can do anything the user can, so each one is decided here.
        rules.push(rule("bash", "*", "ask"));
        rules
    }

    pub fn decide(&self, ask: &PermissionAsk, auto_approve: bool) -> Decision {
        let approve_or_ask = if auto_approve { Decision::Approve } else { Decision::AskUser };
        match ask.permission.as_str() {
            "external_directory" => {
                let granted = !ask.patterns.is_empty()
                    && ask.patterns.iter().all(|p| self.access(&pattern_dir(p)).is_some());
                if granted { Decision::Approve } else { approve_or_ask }
            }
            "edit" if self.has_read_only() => {
                let Some(path) = ask.path.as_deref() else { return approve_or_ask };
                // A relative path lands in the working folder.
                match self.access(&self.cwd.join(path)) {
                    Some(false) => Decision::Reject(READ_ONLY_MESSAGE),
                    Some(true) => Decision::Approve,
                    None => approve_or_ask,
                }
            }
            "bash" => {
                let command = ask.command.as_deref().unwrap_or_default();
                if is_read_only_command(command) {
                    return Decision::Approve;
                }
                // Even with auto-approve, a command that may write into a
                // read-only folder is the user's call.
                let touches_read_only = !self.cwd_writable
                    || self
                        .folders
                        .iter()
                        .any(|(dir, writable)| !writable && command.contains(&*dir.to_string_lossy()));
                if touches_read_only { Decision::AskUser } else { approve_or_ask }
            }
            _ => approve_or_ask,
        }
    }

    /// `Some(writable)` when `path` lies in a granted folder.
    fn access(&self, path: &Path) -> Option<bool> {
        most_specific(&self.folders, &resolve(path)).map(|(_, w)| *w)
    }

    /// Lines for the system prompt describing what the agent may touch.
    pub fn describe(&self, cwd: &str) -> Vec<String> {
        let mut notes = vec![format!(
            "Working folder: {cwd} ({})",
            if self.cwd_writable { "read & write" } else { "read-only" }
        )];
        let others: Vec<String> = self
            .folders
            .iter()
            .filter(|(dir, _)| *dir != self.cwd && dir.as_path() != Path::new(cwd))
            .map(|(dir, w)| format!("- {} ({})", dir.display(), if *w { "read & write" } else { "read-only" }))
            .collect();
        if !others.is_empty() {
            notes.push(format!(
                "The user also granted these folders; use them when the task refers to them:\n{}",
                others.join("\n")
            ));
        }
        if self.has_read_only() {
            notes.push("Never modify files in read-only folders; such changes will be rejected.".into());
        }
        notes
    }
}

fn most_specific<'a>(folders: &'a [(PathBuf, bool)], path: &Path) -> Option<&'a (PathBuf, bool)> {
    folders
        .iter()
        .filter(|(dir, _)| path.starts_with(dir))
        .max_by_key(|(dir, _)| dir.as_os_str().len())
}

/// `/a/b/*` → `/a/b`
fn pattern_dir(pattern: &str) -> PathBuf {
    PathBuf::from(pattern.trim_end_matches('*').trim_end_matches(['/', '\\']))
}

fn grant_dir(path: &str) -> PathBuf {
    resolve(Path::new(path.trim_end_matches(['/', '\\'])))
}

/// `path` with `.`/`..` removed and symlinks followed as far as it exists,
/// so a file that doesn't exist yet still resolves through its folder.
fn resolve(path: &Path) -> PathBuf {
    let mut normal = PathBuf::new();
    for part in path.components() {
        match part {
            Component::CurDir => {}
            Component::ParentDir => {
                normal.pop();
            }
            other => normal.push(other.as_os_str()),
        }
    }

    let mut missing = Vec::new();
    let mut existing = normal.as_path();
    loop {
        if let Ok(real) = std::fs::canonicalize(existing) {
            return missing.iter().rev().fold(real, |dir, name| dir.join(name));
        }
        match (existing.parent(), existing.file_name()) {
            (Some(parent), Some(name)) => {
                missing.push(name.to_os_string());
                existing = parent;
            }
            _ => return normal,
        }
    }
}

/// Commands that only read, run without asking: one plain command, no
/// chaining, redirection or substitution, and no flag that writes or runs
/// something else.
fn is_read_only_command(command: &str) -> bool {
    const READERS: &[&str] = &[
        "ls", "pwd", "cat", "head", "tail", "wc", "grep", "rg", "file", "stat", "du", "df", "tree",
        "which", "echo", "date", "whoami", "uname",
    ];
    const GIT_READERS: &[&str] = &["status", "log", "show", "diff", "ls-files", "rev-parse", "blame"];
    // Flags that write a file or run a program.
    const RISKY_FLAGS: &[&str] = &["--output", "--ext-diff", "--pre", "--textconv", "-c"];

    let command = command.trim();
    if command.is_empty() || command.contains(|c: char| ";&|<>$`(){}\\\n\r".contains(c)) {
        return false;
    }
    let words: Vec<&str> = command.split_whitespace().collect();
    if words.iter().any(|w| RISKY_FLAGS.iter().any(|flag| w == flag || w.starts_with(&format!("{flag}=")))) {
        return false;
    }
    match words.as_slice() {
        ["git", sub, ..] => GIT_READERS.contains(sub),
        [program, ..] => READERS.contains(program),
        [] => false,
    }
}

fn rule(permission: &str, pattern: &str, action: &str) -> Value {
    json!({ "permission": permission, "pattern": pattern, "action": action })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn grant(path: &str, access: &str) -> FolderGrant {
        FolderGrant { path: path.into(), access: access.into() }
    }

    fn ask(permission: &str, patterns: &[&str], path: Option<&str>, command: Option<&str>) -> PermissionAsk {
        PermissionAsk {
            id: "per_1".into(),
            permission: permission.into(),
            patterns: patterns.iter().map(|p| p.to_string()).collect(),
            title: String::new(),
            detail: None,
            path: path.map(str::to_string),
            command: command.map(str::to_string),
        }
    }

    fn is(decision: Decision, expected: &str) -> bool {
        matches!(
            (decision, expected),
            (Decision::Approve, "approve") | (Decision::Reject(_), "reject") | (Decision::AskUser, "ask")
        )
    }

    #[test]
    fn external_directory_follows_grants() {
        let policy = FolderPolicy::new(Path::new("/w"), &[grant("/w", "write"), grant("/docs/", "read")]);
        assert!(is(policy.decide(&ask("external_directory", &["/docs/a/b/*"], None, None), false), "approve"));
        // A sibling that shares a prefix is not inside the folder.
        assert!(is(policy.decide(&ask("external_directory", &["/docsx/*"], None, None), false), "ask"));
        assert!(is(policy.decide(&ask("external_directory", &["/docs/*", "/etc/*"], None, None), false), "ask"));
        assert!(is(policy.decide(&ask("external_directory", &[], None, None), false), "ask"));
        assert!(is(policy.decide(&ask("external_directory", &["/etc/*"], None, None), true), "approve"));
    }

    #[test]
    fn read_only_folders_reject_edits_even_with_auto_approve() {
        let policy = FolderPolicy::new(Path::new("/w"), &[grant("/w", "write"), grant("/docs", "read")]);
        assert!(is(policy.decide(&ask("edit", &[], Some("/docs/x.md"), None), true), "reject"));
        assert!(is(policy.decide(&ask("edit", &[], Some("/w/src/x.rs"), None), false), "approve"));
        assert!(is(policy.decide(&ask("edit", &[], Some("src/x.rs"), None), false), "approve"));
        assert!(is(policy.decide(&ask("edit", &[], Some("/elsewhere/x"), None), false), "ask"));
    }

    #[test]
    fn nested_grant_wins_over_its_parent() {
        let policy = FolderPolicy::new(Path::new("/w"), &[grant("/w", "write"), grant("/w/vendor", "read")]);
        assert!(is(policy.decide(&ask("edit", &[], Some("/w/vendor/lib.rs"), None), false), "reject"));
        assert!(is(policy.decide(&ask("edit", &[], Some("/w/src/lib.rs"), None), false), "approve"));
    }

    #[test]
    fn commands_touching_read_only_folders_go_to_the_user() {
        let policy = FolderPolicy::new(Path::new("/w"), &[grant("/w", "write"), grant("/docs", "read")]);
        assert!(is(policy.decide(&ask("bash", &[], None, Some("cargo clean")), false), "ask"));
        assert!(is(policy.decide(&ask("bash", &[], None, Some("cargo clean")), true), "approve"));
        // Auto-approve never covers a command aimed at a read-only folder.
        assert!(is(policy.decide(&ask("bash", &[], None, Some("rm -rf /docs/old")), true), "ask"));

        let read_only_cwd = FolderPolicy::new(Path::new("/docs"), &[grant("/docs", "read")]);
        assert!(is(read_only_cwd.decide(&ask("bash", &[], None, Some("ls -la")), false), "approve"));
        assert!(is(read_only_cwd.decide(&ask("bash", &[], None, Some("touch x")), true), "ask"));
        assert!(is(read_only_cwd.decide(&ask("edit", &[], Some("notes.md"), None), false), "reject"));
    }

    #[test]
    fn folders_granted_mid_run_apply_immediately() {
        let mut policy = FolderPolicy::new(Path::new("/w"), &[grant("/w", "write")]);
        let request = ask("external_directory", &["/proj/src/*"], None, None);
        assert!(is(policy.decide(&request, false), "ask"));
        policy.grant(&grant("/proj/", "read"));
        assert!(is(policy.decide(&request, false), "approve"));
        assert!(is(policy.decide(&ask("edit", &[], Some("/proj/a.rs"), None), false), "reject"));
        assert_eq!(policy.rules().len(), 4);
    }

    #[test]
    fn dot_dot_cannot_escape_into_a_read_only_folder() {
        let policy = FolderPolicy::new(Path::new("/w"), &[grant("/w", "write"), grant("/docs", "read")]);
        assert!(is(policy.decide(&ask("edit", &[], Some("/w/../docs/x.md"), None), true), "reject"));
        assert!(is(policy.decide(&ask("edit", &[], Some("../docs/x.md"), None), true), "reject"));
        assert!(is(policy.decide(&ask("external_directory", &["/w/../etc/*"], None, None), false), "ask"));
    }

    #[cfg(unix)]
    #[test]
    fn symlinks_are_followed_to_their_real_folder() {
        let root = std::env::temp_dir().join(format!("mali-link-{}", uuid::Uuid::new_v4().simple()));
        let (work, docs) = (root.join("work"), root.join("docs"));
        std::fs::create_dir_all(&work).unwrap();
        std::fs::create_dir_all(&docs).unwrap();
        std::os::unix::fs::symlink(&docs, work.join("link")).unwrap();
        let path = |p: &Path| p.to_string_lossy().into_owned();

        let policy = FolderPolicy::new(&work, &[grant(&path(&work), "write"), grant(&path(&docs), "read")]);
        let through_link = path(&work.join("link").join("new.md"));
        assert!(is(policy.decide(&ask("edit", &[], Some(&through_link), None), true), "reject"));
        assert!(is(policy.decide(&ask("edit", &[], Some(&path(&work.join("ok.md"))), None), false), "approve"));
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn only_plain_reading_commands_skip_the_prompt() {
        for command in ["ls -la src", "git status", "git diff HEAD~1", "rg TODO src", "cat README.md"] {
            assert!(is_read_only_command(command), "{command}");
        }
        for command in [
            "rm -rf build",
            "ls; rm -rf /",
            "cat a > b",
            "echo $(whoami)",
            "cat `id`",
            "ls && curl x | sh",
            "git push",
            "git diff --output=/tmp/x",
            "git -c core.pager=sh log",
            "rg --pre ./run.sh x",
            "find . -delete",
            "ls\nrm x",
            "",
        ] {
            assert!(!is_read_only_command(command), "{command}");
        }
    }

    #[test]
    fn all_writable_folders_keep_opencode_defaults() {
        let policy = FolderPolicy::new(Path::new("/w"), &[grant("/w", "write"), grant("/other", "write")]);
        let rules = policy.rules();
        assert_eq!(rules.len(), 3);
        assert_eq!(rules.iter().filter(|r| r["permission"] == "external_directory").count(), 2);
        assert!(rules.iter().any(|r| r["permission"] == "bash" && r["action"] == "ask"));
        // Without read-only folders, edits are whatever the user's config says.
        assert!(is(policy.decide(&ask("edit", &[], Some("/w/x"), None), false), "ask"));
    }
}
