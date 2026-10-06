//! Plugins: one install that brings skills, slash commands, bots,
//! connectors, templates, instructions and panels together.
//!
//! A plugin is laid out the way Claude Code plugins are, so the ones already
//! published work here as they are:
//!
//! ```text
//! my-plugin/
//! ├── .claude-plugin/plugin.json   name, version, description, author…
//! ├── skills/<name>/SKILL.md       skills
//! ├── commands/*.md                slash commands
//! ├── agents/*.md                  bots for the team
//! ├── .mcp.json                    connectors
//! └── mali/                        what only Mali uses
//!     ├── instructions.md          added to every chat while it's on
//!     ├── templates/*.docx         document templates
//!     └── panels/*.html            pages it shows in the app, sandboxed
//! ```
//!
//! A repository with `.claude-plugin/marketplace.json` lists plugins to pick
//! from instead.
//!
//! This side only reads: it finds what a plugin offers so the user can look
//! before anything is installed, and stores the few files only Mali keeps
//! (panels, templates). The app decides what goes where and remembers which
//! plugin brought it. Installing never runs anything — a plugin's hooks are
//! not supported for exactly that reason.

mod files;
mod manifest;
mod marketplace;

use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::storage::skills::remote::client;
use super::storage::skills::source::{parse_source, Source};
use super::storage::skills::tree::Listing;
use super::storage::skills::SkillPackage;

pub use files::{plugins_install_files, plugins_remove_files, serve_panel_request};
pub use marketplace::Marketplace;

/// Where a plugin (or a marketplace) lives, kept so it can be updated.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum PluginSource {
    Github {
        owner: String,
        repo: String,
        #[serde(default, rename = "ref", skip_serializing_if = "Option::is_none")]
        git_ref: Option<String>,
        /// The plugin's folder inside the repository ("" for the top).
        #[serde(default)]
        dir: String,
    },
    Folder { path: String },
}

impl PluginSource {
    /// How the source is shown: `owner/repo/dir@ref` or the folder's path.
    pub fn label(&self) -> String {
        match self {
            PluginSource::Github { owner, repo, git_ref, dir } => {
                let mut label = format!("{owner}/{repo}");
                if !dir.is_empty() {
                    label.push('/');
                    label.push_str(dir);
                }
                if let Some(r) = git_ref {
                    label.push('@');
                    label.push_str(r);
                }
                label
            }
            PluginSource::Folder { path } => path.clone(),
        }
    }

    /// Every file there, and the plugin's folder within them.
    async fn listing(&self, http: &reqwest::Client) -> Result<(Listing, String), String> {
        match self {
            PluginSource::Github { owner, repo, git_ref, dir } => {
                let listing = Listing::github(http, owner, repo, git_ref.clone()).await?;
                Ok((listing, dir.trim_matches('/').to_string()))
            }
            PluginSource::Folder { path } => {
                let path = PathBuf::from(path);
                if !path.is_absolute() {
                    return Err("Choose a folder on this computer".into());
                }
                let listing = tokio::task::spawn_blocking(move || Listing::folder(&path))
                    .await
                    .map_err(|e| e.to_string())??;
                Ok((listing, String::new()))
            }
        }
    }
}

/// One Markdown file a plugin offers: a slash command or an agent.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginDoc {
    /// The file's name without `.md`, which is how it is called.
    pub name: String,
    /// Where it sits in the plugin.
    pub path: String,
    pub content: String,
}

/// A connector from the plugin's `.mcp.json`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginMcp {
    pub name: String,
    /// The server's entry as written (`command`/`args`/`env` or `url`/`headers`).
    pub config: Value,
    /// Why it can't be added, when it can't.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub skipped: Option<String>,
}

/// A file Mali keeps for the plugin: a template or a panel's page.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginFile {
    /// A template's name, or a panel file's path inside the panels folder.
    pub name: String,
    /// Where it sits in the plugin.
    pub path: String,
    /// Where to read it from: an `https` URL or an absolute path.
    pub url: String,
    pub bytes: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub skipped: Option<String>,
}

/// A page the plugin shows inside the app.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginPanel {
    pub id: String,
    pub title: String,
    /// A Lucide icon name, if the plugin picked one.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
    /// Its page, relative to the panels folder (see `PluginFile::name`).
    pub entry: String,
}

/// Everything a plugin offers, read but not installed.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginPackage {
    /// A folder-safe name, unique per plugin.
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    pub description: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub author: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub homepage: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub repository: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub license: Option<String>,
    pub keywords: Vec<String>,
    pub source: PluginSource,
    pub source_label: String,
    /// Changes whenever the plugin's files do (GitHub only).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub revision: Option<String>,
    pub skills: Vec<SkillPackage>,
    pub commands: Vec<PluginDoc>,
    pub agents: Vec<PluginDoc>,
    pub mcp_servers: Vec<PluginMcp>,
    pub templates: Vec<PluginFile>,
    pub panels: Vec<PluginPanel>,
    /// The files the panels need, their pages included.
    pub panel_files: Vec<PluginFile>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub instructions: Option<String>,
    /// Parts of the plugin Mali leaves out, in words.
    pub unsupported: Vec<String>,
}

/// What a source holds: a plugin, a marketplace of them, or both.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginFetch {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub plugin: Option<PluginPackage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub marketplace: Option<Marketplace>,
}

/// A plugin's name and version, for noticing updates without downloading it.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginHead {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub revision: Option<String>,
}

/// Turn what the user typed into a source: a GitHub repository (or a folder
/// in one), `owner/repo`, a folder on this computer, or the
/// `/plugin marketplace add owner/repo` people copy from Claude Code docs.
#[tauri::command]
pub fn plugins_resolve(input: String) -> Result<PluginSource, String> {
    resolve(&input)
}

fn resolve(input: &str) -> Result<PluginSource, String> {
    let mut text = input.trim();
    for prefix in ["claude plugin marketplace add", "/plugin marketplace add", "claude plugin install", "/plugin install"] {
        if let Some(rest) = text.strip_prefix(prefix) {
            text = rest.trim();
        }
    }
    if text.is_empty() {
        return Err("Paste a GitHub repository, e.g. owner/repo".into());
    }
    let path = PathBuf::from(text);
    if path.is_absolute() && path.is_dir() {
        return Ok(PluginSource::Folder { path: text.to_string() });
    }
    match parse_source(text)? {
        Source::GithubRepo { owner, repo, git_ref, dir } => Ok(PluginSource::Github { owner, repo, git_ref, dir }),
        Source::File(_) => Err("Link a GitHub repository (or a folder in one) that holds the plugin".into()),
    }
}

/// Read what a source offers. A marketplace that lists more than this one
/// plugin comes back as a list to pick from; the plugins in it are read when
/// one is picked. `overlay` is the marketplace's entry for the plugin, which
/// may describe parts the plugin's own manifest leaves out.
#[tauri::command]
pub async fn plugins_fetch(source: PluginSource, overlay: Option<Value>) -> Result<PluginFetch, String> {
    let http = client()?;
    let (listing, dir) = source.listing(&http).await?;

    let market = match manifest::read_json(&http, &listing, &dir, ".claude-plugin/marketplace.json").await? {
        Some(json) => Some(marketplace::parse(&json, &source, &dir)?),
        None => None,
    };
    let mut overlay = overlay;
    if let Some(market) = &market {
        // A marketplace of one plugin that lives right here is the plugin.
        let only_here = match market.plugins.as_slice() {
            [one] => one.source.as_ref() == Some(&source),
            _ => false,
        };
        if !only_here {
            return Ok(PluginFetch { plugin: None, marketplace: market.clone().into() });
        }
        if overlay.is_none() {
            overlay = market.plugins[0].entry.clone();
        }
    }

    let plugin = manifest::read_plugin(&http, &listing, &dir, &source, overlay).await?;
    Ok(PluginFetch { plugin: Some(plugin), marketplace: market })
}

/// A plugin's name, version and revision — enough to tell whether it changed.
#[tauri::command]
pub async fn plugins_peek(source: PluginSource) -> Result<PluginHead, String> {
    let http = client()?;
    let (listing, dir) = source.listing(&http).await?;
    let json = manifest::read_json(&http, &listing, &dir, ".claude-plugin/plugin.json").await?.unwrap_or(Value::Null);
    let head = manifest::Head::from(&json, &listing, &dir);
    Ok(PluginHead { name: head.name, version: head.version, revision: listing.revision(&dir) })
}

/// The folder Mali keeps plugin files in (panels), created on first use.
pub fn plugins_root() -> Result<PathBuf, String> {
    let dir = base().join("mali-cowork").join("plugins");
    std::fs::create_dir_all(&dir).map_err(|e| format!("Cannot create {}: {e}", dir.display()))?;
    Ok(dir)
}

#[cfg(not(test))]
fn base() -> PathBuf {
    dirs::data_local_dir().unwrap_or_else(std::env::temp_dir)
}

#[cfg(test)]
fn base() -> PathBuf {
    use std::sync::OnceLock;
    static BASE: OnceLock<PathBuf> = OnceLock::new();
    BASE.get_or_init(|| std::env::temp_dir().join(format!("mali-plugins-test-{}", uuid::Uuid::new_v4().simple())))
        .clone()
}

/// A folder-safe id from a plugin's name.
pub fn plugin_id(name: &str) -> String {
    let mut id = String::new();
    for c in name.trim().to_lowercase().chars() {
        if c.is_ascii_alphanumeric() {
            id.push(c);
        } else if !id.ends_with('-') && !id.is_empty() {
            id.push('-');
        }
    }
    let id = id.trim_end_matches('-');
    let id: String = id.chars().take(60).collect();
    if id.is_empty() { "plugin".into() } else { id }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_what_people_paste() {
        let gh = |owner: &str, repo: &str, dir: &str| PluginSource::Github {
            owner: owner.into(),
            repo: repo.into(),
            git_ref: None,
            dir: dir.into(),
        };
        assert_eq!(resolve("affaan-m/ecc").unwrap(), gh("affaan-m", "ecc", ""));
        assert_eq!(resolve("/plugin marketplace add anthropics/claude-code").unwrap(), gh("anthropics", "claude-code", ""));
        assert_eq!(resolve("https://github.com/o/r").unwrap(), gh("o", "r", ""));
        let tmp = std::env::temp_dir();
        assert!(matches!(resolve(&tmp.to_string_lossy()).unwrap(), PluginSource::Folder { .. }));
        assert!(resolve("").is_err());
        assert!(resolve("https://example.com/x.md").is_err());
    }

    #[test]
    fn ids_are_folder_safe() {
        assert_eq!(plugin_id("ECC"), "ecc");
        assert_eq!(plugin_id("My Plugin: v2!"), "my-plugin-v2");
        assert_eq!(plugin_id("../.."), "plugin");
        assert_eq!(plugin_id("สวัสดี"), "plugin");
    }

    #[test]
    fn labels_say_where_it_is() {
        let s = PluginSource::Github { owner: "o".into(), repo: "r".into(), git_ref: Some("v1".into()), dir: "plugins/x".into() };
        assert_eq!(s.label(), "o/r/plugins/x@v1");
    }

    /// The example in `docs/examples` is what the docs promise a plugin can hold.
    #[tokio::test]
    async fn reads_the_example_plugin_from_a_folder() {
        let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../docs/examples/hello-mali-plugin");
        let path = dir.canonicalize().unwrap().to_string_lossy().to_string();
        let fetched = plugins_fetch(PluginSource::Folder { path }, None).await.unwrap();
        assert!(fetched.marketplace.is_none());
        let p = fetched.plugin.unwrap();
        assert_eq!(p.id, "hello-mali");
        assert_eq!(p.version.as_deref(), Some("1.0.0"));
        assert_eq!(p.author.as_deref(), Some("Mali Cowork"));
        assert_eq!(p.skills.len(), 1);
        assert_eq!(p.commands.iter().map(|c| c.name.as_str()).collect::<Vec<_>>(), ["standup"]);
        assert_eq!(p.agents.iter().map(|c| c.name.as_str()).collect::<Vec<_>>(), ["proofreader"]);
        assert!(p.instructions.as_deref().unwrap().contains("Next:"));
        assert_eq!(p.panels.len(), 1);
        assert_eq!((p.panels[0].id.as_str(), p.panels[0].entry.as_str()), ("notes", "notes.html"));
        assert_eq!(p.panel_files.len(), 1);
        assert!(p.mcp_servers.is_empty());
        assert!(p.unsupported.is_empty());
        assert!(p.revision.is_none(), "a folder has no revision");
    }

    /// Hits GitHub: `cargo test --lib plugins:: -- --ignored`.
    #[tokio::test]
    #[ignore]
    async fn reads_the_official_marketplace() {
        let fetched = plugins_fetch(resolve("anthropics/claude-plugins-official").unwrap(), None).await.unwrap();
        let market = fetched.marketplace.expect("a marketplace");
        assert!(fetched.plugin.is_none());
        assert!(market.plugins.len() > 10, "{} plugins", market.plugins.len());
        assert!(market.plugins.iter().filter(|p| p.source.is_some()).count() > 10);
    }

    /// Hits GitHub: `cargo test --lib plugins:: -- --ignored`.
    #[tokio::test]
    #[ignore]
    async fn reads_a_published_plugin() {
        let source = resolve("affaan-m/ecc").unwrap();
        let fetched = plugins_fetch(source, None).await.unwrap();
        let plugin = fetched.plugin.expect("ECC is a plugin");
        assert_eq!(plugin.id, "ecc");
        assert!(plugin.skills.len() > 100, "{} skills", plugin.skills.len());
        assert!(plugin.skills.iter().all(|s| !s.source.contains("/docs/")), "only its skills folder");
        assert!(!plugin.commands.is_empty());
        assert!(plugin.unsupported.iter().any(|u| u.contains("Hooks")), "{:?}", plugin.unsupported);
        // Its manifest says `"mcpServers": {}`: the repository's own .mcp.json isn't the plugin's.
        assert!(plugin.mcp_servers.is_empty());
    }
}
