//! Install commands people copy from a skill's page, read rather than run.
//!
//! `npx skillfish add affaan-m/ecc quarkus-verification` names a GitHub
//! repository and the skills to take from it; so do `npx skills add … --skill
//! …` and `npx add-skill …`. Mali downloads those skills itself, the same way
//! as a pasted link — npm is never started and nothing is executed.

use super::source::{parse_source, Source};

/// What an install command asks for.
#[derive(Debug, PartialEq)]
pub struct SkillCommand {
    pub source: Source,
    /// Skills to take, by name; empty means every skill there.
    pub names: Vec<String>,
}

/// Package runners that may come first, and the words that go with them.
const RUNNERS: &[&[&str]] = &[&["npx"], &["bunx"], &["pnpx"], &["pnpm", "dlx"], &["yarn", "dlx"], &["npm", "exec"], &["bun", "x"]];

/// Flags that take a value we don't need (`--agent Cursor`).
const VALUE_FLAGS: &[&str] = &["--agent", "-a", "--ref", "--branch", "--dir", "--target", "-t"];

/// Read an install command. `Ok(None)` when the text isn't one, so the
/// caller can treat it as a link instead.
pub fn parse(input: &str) -> Result<Option<SkillCommand>, String> {
    let words = split(input.trim().trim_start_matches('$').trim());
    let mut rest: &[String] = &words;

    // `npx -y skillfish@latest add …`
    if let Some(runner) = RUNNERS.iter().find(|r| rest.len() >= r.len() && r.iter().zip(rest).all(|(a, b)| *a == b.as_str())) {
        rest = &rest[runner.len()..];
        while rest.first().is_some_and(|w| w.starts_with('-')) {
            rest = &rest[1..];
        }
    }
    let Some(tool) = rest.first() else { return Ok(None) };
    let tool = strip_version(tool);
    rest = &rest[1..];
    match tool {
        // `add-skill owner/repo` has no sub-command.
        "add-skill" => {}
        "skillfish" | "skills" | "openskills" => match rest.first().map(String::as_str) {
            Some("add" | "install" | "i") => rest = &rest[1..],
            _ => return Err(format!("Only “{tool} add …” can be used here: it says which skills to install.")),
        },
        _ => return Ok(None),
    }

    let mut positional = Vec::new();
    let mut names = Vec::new();
    let mut path = None;
    let mut iter = rest.iter();
    while let Some(word) = iter.next() {
        if let Some((flag, value)) = word.split_once('=').filter(|(f, _)| f.starts_with('-')) {
            take_flag(flag, Some(value.to_string()), &mut names, &mut path);
        } else if word == "--skill" || word == "-s" || word == "--path" {
            take_flag(word, iter.next().cloned(), &mut names, &mut path);
        } else if VALUE_FLAGS.contains(&word.as_str()) {
            iter.next();
        } else if word.starts_with('-') {
            // --all, --yes, --global, --project, --force…: about where it
            // goes in other agents, not which skills.
        } else {
            positional.push(word.clone());
        }
    }
    let Some(first) = positional.first() else {
        return Err("The command doesn't say which repository to install from.".into());
    };
    names.extend(positional[1..].iter().cloned());

    let mut source = repo_source(first)?;
    if let (Some(extra), Source::GithubRepo { dir, .. }) = (path, &mut source) {
        *dir = join(dir, &extra);
    }
    names.retain(|n| !n.trim().is_empty());
    names.dedup();
    Ok(Some(SkillCommand { source, names }))
}

fn take_flag(flag: &str, value: Option<String>, names: &mut Vec<String>, path: &mut Option<String>) {
    let Some(value) = value else { return };
    match flag {
        "--skill" | "-s" => names.extend(value.split(',').map(|s| s.trim().to_string())),
        "--path" => *path = Some(value),
        _ => {}
    }
}

/// `skillfish@1.2.0` → `skillfish`; a scoped `@org/tool` keeps its scope.
fn strip_version(word: &str) -> &str {
    match word.rfind('@') {
        Some(at) if at > 0 => &word[..at],
        _ => word,
    }
}

/// `owner/repo`, `owner/repo@ref`, `owner/repo/path/to/skill`,
/// `owner/repo@ref/path`, or a GitHub link.
fn repo_source(spec: &str) -> Result<Source, String> {
    if spec.contains("://") || spec.starts_with("git@") || spec.starts_with("github.com/") {
        let link = if spec.starts_with("github.com/") { format!("https://{spec}") } else { spec.to_string() };
        return match parse_source(&link)? {
            source @ Source::GithubRepo { .. } => Ok(source),
            Source::File(_) => Err("Install commands work with GitHub repositories.".into()),
        };
    }
    let parts: Vec<&str> = spec.trim_matches('/').split('/').collect();
    let [owner, repo, path @ ..] = parts.as_slice() else {
        return Err(format!("“{spec}” isn't a repository: write it as owner/repo."));
    };
    let (repo, git_ref) = match repo.split_once('@') {
        Some((repo, git_ref)) if !git_ref.is_empty() => (repo, Some(git_ref.to_string())),
        _ => (*repo, None),
    };
    let repo = repo.trim_end_matches(".git");
    let ok = |s: &str| !s.is_empty() && !s.starts_with('.') && s.len() <= 100 && s.chars().all(|c| c.is_ascii_alphanumeric() || "-_.".contains(c));
    if !ok(owner) || !ok(repo) || path.iter().any(|p| p.is_empty() || *p == "..") {
        return Err(format!("“{spec}” isn't a repository: write it as owner/repo."));
    }
    Ok(Source::GithubRepo { owner: owner.to_string(), repo: repo.to_string(), git_ref, dir: path.join("/") })
}

fn join(dir: &str, more: &str) -> String {
    [dir.trim_matches('/'), more.trim_matches('/')].iter().filter(|p| !p.is_empty()).cloned().collect::<Vec<_>>().join("/")
}

/// Words, with quotes keeping spaces together. No shell is involved.
fn split(line: &str) -> Vec<String> {
    let mut words = Vec::new();
    let mut current = String::new();
    let mut quote = None;
    let mut started = false;
    for ch in line.chars() {
        match quote {
            Some(q) if ch == q => quote = None,
            Some(_) => current.push(ch),
            None if ch == '"' || ch == '\'' => {
                quote = Some(ch);
                started = true;
            }
            None if ch.is_whitespace() => {
                if started || !current.is_empty() {
                    words.push(std::mem::take(&mut current));
                }
                started = false;
            }
            None => current.push(ch),
        }
    }
    if started || !current.is_empty() {
        words.push(current);
    }
    words
}

#[cfg(test)]
mod tests {
    use super::*;

    fn repo(owner: &str, repo: &str, git_ref: Option<&str>, dir: &str) -> Source {
        Source::GithubRepo { owner: owner.into(), repo: repo.into(), git_ref: git_ref.map(Into::into), dir: dir.into() }
    }

    fn cmd(input: &str) -> SkillCommand {
        parse(input).unwrap().unwrap_or_else(|| panic!("not read as a command: {input}"))
    }

    #[test]
    fn reads_skillfish_with_skill_names() {
        let c = cmd("npx skillfish add affaan-m/ecc quarkus-verification");
        assert_eq!(c.source, repo("affaan-m", "ecc", None, ""));
        assert_eq!(c.names, ["quarkus-verification"]);

        let c = cmd("$ npx -y skillfish@latest add owner/repo one two --yes --agent Cursor");
        assert_eq!(c.names, ["one", "two"]);
        assert_eq!(cmd("skillfish add owner/repo --all").names, Vec::<String>::new());
    }

    #[test]
    fn reads_paths_and_refs() {
        assert_eq!(cmd("npx skillfish add owner/repo/path/to/skill").source, repo("owner", "repo", None, "path/to/skill"));
        assert_eq!(cmd("skillfish add owner/repo@v1.0.0").source, repo("owner", "repo", Some("v1.0.0"), ""));
        assert_eq!(cmd("skillfish add owner/repo@main/skills/x").source, repo("owner", "repo", Some("main"), "skills/x"));
        assert_eq!(cmd("skillfish add owner/repo --path skills/foo").source, repo("owner", "repo", None, "skills/foo"));
    }

    #[test]
    fn reads_other_installers() {
        let c = cmd("npx skills add https://github.com/vercel-labs/agent-skills --skill frontend-design");
        assert_eq!(c.source, repo("vercel-labs", "agent-skills", None, ""));
        assert_eq!(c.names, ["frontend-design"]);
        assert_eq!(cmd("pnpm dlx skills add o/r -s a,b").names, ["a", "b"]);
        assert_eq!(cmd("bunx add-skill o/r").source, repo("o", "r", None, ""));
    }

    #[test]
    fn leaves_links_and_other_commands_alone() {
        assert_eq!(parse("https://github.com/o/r").unwrap(), None);
        assert_eq!(parse("o/r").unwrap(), None);
        assert_eq!(parse("npx some-other-tool o/r").unwrap(), None);
        assert!(parse("npx skillfish search github").is_err());
        assert!(parse("npx skillfish add ../etc").is_err());
        assert!(parse("npx skillfish add").is_err());
    }
}
