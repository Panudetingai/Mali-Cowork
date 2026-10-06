//! A repository or folder as a flat list of files, so skills (and the
//! plugins that bundle them) are found the same way wherever they live.
//!
//! GitHub costs one API call for the whole tree; the files themselves come
//! from raw.githubusercontent.com, which has no API rate limit. A folder on
//! this Mac is walked once.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use futures::StreamExt;
use serde::Deserialize;

use super::remote::{fetch_text, github_json};
use super::{
    blocked_reason, folder_of, is_skill_file, skip_dir, vet_assets, SkillAsset, SkillPackage,
    MAX_SKILL_BYTES,
};

/// How many files are downloaded at once.
const PARALLEL: usize = 16;
/// A folder this big is not a skill collection or a plugin.
const MAX_FOLDER_FILES: usize = 20_000;
const MAX_FOLDER_DEPTH: usize = 10;

/// One file, by its path from the top of the repository or folder.
#[derive(Debug, Clone)]
pub struct FileEntry {
    pub path: String,
    pub bytes: u64,
}

/// Where the files are read from.
#[derive(Debug, Clone)]
pub enum Origin {
    Github { owner: String, repo: String, git_ref: String },
    Folder(PathBuf),
}

impl Origin {
    /// Where a file is downloaded or copied from: a raw URL or an absolute path.
    pub fn url(&self, path: &str) -> String {
        match self {
            Origin::Github { owner, repo, git_ref } => {
                format!("https://raw.githubusercontent.com/{owner}/{repo}/{git_ref}/{path}")
            }
            Origin::Folder(root) => root.join(path).to_string_lossy().to_string(),
        }
    }

    /// Where a person would look at the file.
    pub fn page(&self, path: &str) -> String {
        match self {
            Origin::Github { owner, repo, git_ref } => {
                format!("https://github.com/{owner}/{repo}/blob/{git_ref}/{path}")
            }
            Origin::Folder(root) => root.join(path).to_string_lossy().to_string(),
        }
    }

    pub async fn read_text(&self, client: &reqwest::Client, path: &str, max: u64) -> Result<String, String> {
        match self {
            Origin::Github { .. } => fetch_text(client, &self.url(path), max).await,
            Origin::Folder(root) => {
                let file = root.join(path);
                let bytes = tokio::fs::metadata(&file).await.map(|m| m.len()).unwrap_or(0);
                if bytes > max {
                    return Err(format!("{path} is too large"));
                }
                tokio::fs::read_to_string(&file).await.map_err(|e| format!("Cannot read {path}: {e}"))
            }
        }
    }
}

/// Every file in a repository or folder.
#[derive(Debug, Clone)]
pub struct Listing {
    pub origin: Origin,
    pub files: Vec<FileEntry>,
    /// GitHub left files out (very large repositories).
    pub truncated: bool,
    /// GitHub's hash of each folder ("" is the top), which changes whenever
    /// anything inside it does — how an update is noticed.
    trees: HashMap<String, String>,
}

#[derive(Deserialize)]
struct RepoInfo {
    default_branch: String,
}

#[derive(Deserialize)]
struct Tree {
    sha: String,
    tree: Vec<TreeEntry>,
    #[serde(default)]
    truncated: bool,
}

#[derive(Deserialize)]
struct TreeEntry {
    path: String,
    #[serde(rename = "type")]
    kind: String,
    #[serde(default)]
    size: u64,
    #[serde(default)]
    sha: String,
}

impl Listing {
    /// A GitHub repository at `git_ref` (its default branch when none).
    pub async fn github(
        client: &reqwest::Client,
        owner: &str,
        repo: &str,
        git_ref: Option<String>,
    ) -> Result<Listing, String> {
        let git_ref = match git_ref {
            Some(r) => r,
            None => {
                github_json::<RepoInfo>(client, &format!("https://api.github.com/repos/{owner}/{repo}"))
                    .await?
                    .default_branch
            }
        };
        let tree: Tree = github_json(
            client,
            &format!("https://api.github.com/repos/{owner}/{repo}/git/trees/{git_ref}?recursive=1"),
        )
        .await?;
        let mut trees = HashMap::from([(String::new(), tree.sha)]);
        let mut files = Vec::new();
        for entry in tree.tree {
            match entry.kind.as_str() {
                "blob" => files.push(FileEntry { path: entry.path, bytes: entry.size }),
                "tree" => {
                    trees.insert(entry.path, entry.sha);
                }
                _ => {}
            }
        }
        Ok(Listing {
            origin: Origin::Github { owner: owner.into(), repo: repo.into(), git_ref },
            files,
            truncated: tree.truncated,
            trees,
        })
    }

    /// A folder on this Mac. Links are not followed, so nothing outside it is read.
    pub fn folder(root: &Path) -> Result<Listing, String> {
        if !root.is_dir() {
            return Err(format!("{} is not a folder", root.display()));
        }
        let mut files = Vec::new();
        let mut truncated = false;
        for entry in walkdir::WalkDir::new(root)
            .max_depth(MAX_FOLDER_DEPTH)
            .follow_links(false)
            .into_iter()
            .filter_entry(|e| !(e.file_type().is_dir() && e.depth() > 0 && skip_dir(&e.file_name().to_string_lossy())))
            .filter_map(Result::ok)
            .filter(|e| e.file_type().is_file())
        {
            if files.len() >= MAX_FOLDER_FILES {
                truncated = true;
                break;
            }
            let Ok(relative) = entry.path().strip_prefix(root) else { continue };
            files.push(FileEntry {
                path: relative.to_string_lossy().replace('\\', "/"),
                bytes: entry.metadata().map(|m| m.len()).unwrap_or(0),
            });
        }
        files.sort_by(|a, b| a.path.cmp(&b.path));
        Ok(Listing { origin: Origin::Folder(root.to_path_buf()), files, truncated, trees: HashMap::new() })
    }

    /// A listing of these paths on GitHub, each 10 bytes.
    #[cfg(test)]
    pub fn for_test(paths: &[&str]) -> Listing {
        Listing {
            origin: Origin::Github { owner: "o".into(), repo: "r".into(), git_ref: "main".into() },
            files: paths.iter().map(|p| FileEntry { path: p.to_string(), bytes: 10 }).collect(),
            truncated: false,
            trees: HashMap::new(),
        }
    }

    /// The version of a folder's contents, when the source has one.
    pub fn revision(&self, dir: &str) -> Option<String> {
        self.trees.get(dir.trim_end_matches('/')).cloned()
    }

    /// The file at `path`, matched without regard to case the way GitHub
    /// keeps whatever case a repository used.
    pub fn find(&self, path: &str) -> Option<&FileEntry> {
        self.files.iter().find(|f| f.path == path).or_else(|| self.files.iter().find(|f| f.path.eq_ignore_ascii_case(path)))
    }

    /// Files under a folder (`""` for everything).
    pub fn under<'a>(&'a self, dir: &str) -> impl Iterator<Item = &'a FileEntry> {
        let prefix = prefix_of(dir);
        self.files.iter().filter(move |f| f.path.starts_with(&prefix))
    }

    /// The folders under `dir` that hold a `SKILL.md`, sorted.
    pub fn skill_roots(&self, dir: &str) -> Vec<String> {
        let mut roots: Vec<String> = self
            .under(dir)
            .filter(|e| e.path.rsplit('/').next().is_some_and(is_skill_file))
            .map(|e| e.path.rsplit_once('/').map_or(String::new(), |(d, _)| d.to_string()))
            .collect();
        roots.sort();
        roots.dedup();
        roots
    }

    /// Download each skill's `SKILL.md` and list the files beside it. A skill
    /// that can't be read is left out rather than failing the rest.
    pub async fn skill_packages(&self, client: &reqwest::Client, roots: &[String]) -> Vec<SkillPackage> {
        let fetches: Vec<_> = roots.iter().map(|root| {
            let wanted = if root.is_empty() { "SKILL.md".to_string() } else { format!("{root}/SKILL.md") };
            let skill_path = self.find(&wanted).map_or(wanted, |e| e.path.clone());
            let files = self.assets_under(root, roots);
            async move {
                let content = self.origin.read_text(client, &skill_path, MAX_SKILL_BYTES as u64).await.ok()?;
                let folder = folder_of(&skill_path);
                Some(SkillPackage {
                    source: self.origin.page(&skill_path),
                    folder: if folder.is_empty() { self.name() } else { folder },
                    content,
                    files,
                })
            }
        }).collect();
        // Kept in the order asked for, so the list reads like the repository.
        let found: Vec<Option<SkillPackage>> = futures::stream::iter(fetches).buffered(PARALLEL).collect().await;
        found.into_iter().flatten().collect()
    }

    /// The files belonging to the skill rooted at `root`: everything under it
    /// except its own `SKILL.md` and anything a nested skill owns.
    fn assets_under(&self, root: &str, roots: &[String]) -> Vec<SkillAsset> {
        let prefix = prefix_of(root);
        let nested: Vec<String> = roots
            .iter()
            .filter(|r| r.as_str() != root && r.starts_with(&prefix))
            .map(|r| format!("{r}/"))
            .collect();
        let assets = self
            .under(root)
            .filter(|e| !nested.iter().any(|n| e.path.starts_with(n)))
            .filter_map(|e| {
                let path = e.path[prefix.len()..].to_string();
                (!is_skill_file(&path)).then(|| SkillAsset {
                    url: self.origin.url(&e.path),
                    bytes: e.bytes,
                    skipped: blocked_reason(&path, e.bytes),
                    path,
                })
            })
            .collect();
        vet_assets(assets)
    }

    /// The repository's or folder's own name.
    pub fn name(&self) -> String {
        match &self.origin {
            Origin::Github { repo, .. } => repo.clone(),
            Origin::Folder(root) => root.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default(),
        }
    }
}

/// `dir/`, or nothing for the top.
pub fn prefix_of(dir: &str) -> String {
    let dir = dir.trim_matches('/');
    if dir.is_empty() { String::new() } else { format!("{dir}/") }
}

/// The skill folders named `names`, matched by folder name. When a name
/// appears more than once (translations, mirrors), the shallowest wins —
/// `skills/x` over `docs/es/skills/x`. Returns what was found and the names
/// that weren't.
pub fn pick_named(roots: &[String], names: &[String]) -> (Vec<String>, Vec<String>) {
    let mut picked = Vec::new();
    let mut missing = Vec::new();
    for name in names {
        let best = roots
            .iter()
            .filter(|r| r.rsplit('/').next().is_some_and(|last| last.eq_ignore_ascii_case(name)))
            .min_by_key(|r| (r.matches('/').count(), r.len(), r.to_string()));
        match best {
            Some(root) if !picked.contains(root) => picked.push(root.clone()),
            Some(_) => {}
            None => missing.push(name.clone()),
        }
    }
    (picked, missing)
}

/// The `name:` in a `SKILL.md`'s front matter.
pub fn front_name(content: &str) -> Option<String> {
    let body = content.trim_start().strip_prefix("---")?;
    let end = body.find("\n---")?;
    body[..end].lines().find_map(|line| {
        let value = line.trim().strip_prefix("name:")?.trim();
        let value = value.trim_matches(|c| c == '"' || c == '\'').trim();
        (!value.is_empty()).then(|| value.to_string())
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn listing(paths: &[&str]) -> Listing {
        Listing::for_test(paths)
    }

    #[test]
    fn finds_skill_folders_under_a_folder() {
        let l = listing(&["skills/a/SKILL.md", "skills/a/run.sh", "skills/b/skill.md", "docs/c/SKILL.md", "README.md"]);
        assert_eq!(l.skill_roots("skills"), ["skills/a", "skills/b"]);
        assert_eq!(l.skill_roots(""), ["docs/c", "skills/a", "skills/b"]);
        let assets = l.assets_under("skills/a", &l.skill_roots(""));
        assert_eq!(assets.iter().map(|a| a.path.as_str()).collect::<Vec<_>>(), ["run.sh"]);
        assert_eq!(assets[0].url, "https://raw.githubusercontent.com/o/r/main/skills/a/run.sh");
    }

    #[test]
    fn a_name_picks_the_shallowest_folder() {
        let roots: Vec<String> = [
            "docs/es/skills/quarkus-verification",
            "pi/core/skills/quarkus-verification",
            "skills/quarkus-verification",
            "skills/other",
        ]
        .map(String::from)
        .to_vec();
        let (picked, missing) = pick_named(&roots, &["quarkus-verification".into(), "nope".into()]);
        assert_eq!(picked, ["skills/quarkus-verification"]);
        assert_eq!(missing, ["nope"]);
    }

    #[test]
    fn reads_the_name_from_front_matter() {
        assert_eq!(front_name("---\nname: \"pdf\"\ndescription: x\n---\nbody").as_deref(), Some("pdf"));
        assert_eq!(front_name("no front matter"), None);
    }
}
