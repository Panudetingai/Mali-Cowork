//! What a pasted link points at.

/// A link to skills: a GitHub repository (optionally at a ref and under a
/// sub-folder) or a single file.
#[derive(Debug, PartialEq)]
pub enum Source {
    GithubRepo { owner: String, repo: String, git_ref: Option<String>, dir: String },
    File(String),
}

pub fn parse_source(input: &str) -> Result<Source, String> {
    let input = input.trim();
    // `git@github.com:owner/repo.git`
    let input = match input.strip_prefix("git@github.com:") {
        Some(rest) => format!("https://github.com/{rest}"),
        None => input.to_string(),
    };
    // A bare `owner/repo` is how people say it out loud.
    let input = if !input.contains("://") && short_repo(&input) {
        format!("https://github.com/{input}")
    } else {
        input
    };
    let url = reqwest::Url::parse(&input)
        .map_err(|_| "Enter a link that starts with https://".to_string())?;
    if url.scheme() != "https" {
        return Err("Only https:// links are supported".into());
    }
    let host = url.host_str().unwrap_or_default();
    if host != "github.com" && host != "www.github.com" {
        return Ok(Source::File(url.to_string()));
    }

    let segments: Vec<&str> =
        url.path_segments().map(|s| s.filter(|p| !p.is_empty()).collect()).unwrap_or_default();
    let [owner, repo, rest @ ..] = segments.as_slice() else {
        return Err("Paste a GitHub repository link, e.g. https://github.com/owner/repo".into());
    };
    let repo = repo.trim_end_matches(".git").to_string();
    let owner = owner.to_string();
    match rest {
        [] => Ok(Source::GithubRepo { owner, repo, git_ref: None, dir: String::new() }),
        ["tree", git_ref, dir @ ..] => Ok(Source::GithubRepo {
            owner,
            repo,
            git_ref: Some(git_ref.to_string()),
            dir: dir.join("/"),
        }),
        ["blob", git_ref, path @ ..] if !path.is_empty() => {
            let path = path.join("/");
            if path.to_ascii_lowercase().ends_with(".md") {
                // A SKILL.md link is really a link to its folder: the skill's
                // scripts and references live beside it.
                match path.rsplit_once('/') {
                    Some((dir, name)) if super::is_skill_file(name) => Ok(Source::GithubRepo {
                        owner,
                        repo,
                        git_ref: Some(git_ref.to_string()),
                        dir: dir.to_string(),
                    }),
                    _ => Ok(Source::File(format!(
                        "https://raw.githubusercontent.com/{owner}/{repo}/{git_ref}/{path}"
                    ))),
                }
            } else {
                Err("That file isn't Markdown. Link a SKILL.md or a folder.".into())
            }
        }
        _ => Err("Paste a link to a repository, a folder (…/tree/…) or a SKILL.md file".into()),
    }
}

/// `owner/repo`, typed without the https://github.com/ in front.
fn short_repo(input: &str) -> bool {
    let parts: Vec<&str> = input.split('/').collect();
    parts.len() == 2
        && parts.iter().all(|p| {
            !p.is_empty()
                && p.len() <= 100
                && p.chars().all(|c| c.is_ascii_alphanumeric() || "-_.".contains(c))
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn repo(owner: &str, repo: &str, git_ref: Option<&str>, dir: &str) -> Source {
        Source::GithubRepo {
            owner: owner.into(),
            repo: repo.into(),
            git_ref: git_ref.map(Into::into),
            dir: dir.into(),
        }
    }

    #[test]
    fn understands_github_links() {
        assert_eq!(parse_source("https://github.com/anthropics/skills").unwrap(), repo("anthropics", "skills", None, ""));
        assert_eq!(parse_source("https://github.com/anthropics/skills.git").unwrap(), repo("anthropics", "skills", None, ""));
        assert_eq!(parse_source("git@github.com:anthropics/skills.git").unwrap(), repo("anthropics", "skills", None, ""));
        assert_eq!(parse_source("anthropics/skills").unwrap(), repo("anthropics", "skills", None, ""));
        assert_eq!(
            parse_source("https://github.com/o/r/tree/main/skills/pdf").unwrap(),
            repo("o", "r", Some("main"), "skills/pdf")
        );
    }

    /// The scripts a skill needs sit beside its SKILL.md, so a link to the
    /// file brings in the folder.
    #[test]
    fn a_skill_file_link_brings_its_folder() {
        assert_eq!(
            parse_source("https://github.com/o/r/blob/main/skills/pdf/SKILL.md").unwrap(),
            repo("o", "r", Some("main"), "skills/pdf")
        );
        assert_eq!(
            parse_source("https://github.com/o/r/blob/main/docs/readme.md").unwrap(),
            Source::File("https://raw.githubusercontent.com/o/r/main/docs/readme.md".into())
        );
        assert!(parse_source("https://github.com/o/r/blob/main/run.sh").is_err());
    }

    #[test]
    fn refuses_plain_http_and_junk() {
        assert!(parse_source("http://example.com/SKILL.md").is_err());
        assert!(parse_source("file:///etc/passwd").is_err());
        assert!(parse_source("not a url").is_err());
        assert_eq!(
            parse_source("https://example.com/team/SKILL.md").unwrap(),
            Source::File("https://example.com/team/SKILL.md".into())
        );
    }
}
