//! A marketplace: `.claude-plugin/marketplace.json`, a list of plugins and
//! where each one lives.

use std::path::{Component, Path};

use serde::Serialize;
use serde_json::Value;

use super::PluginSource;
use crate::commands::storage::skills::source::{parse_source, Source};

const MAX_ENTRIES: usize = 500;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Marketplace {
    pub name: String,
    pub description: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub owner: Option<String>,
    /// Where the marketplace itself lives, to read it again later.
    pub source: PluginSource,
    pub source_label: String,
    pub plugins: Vec<MarketplaceEntry>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MarketplaceEntry {
    pub name: String,
    pub description: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub author: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub category: Option<String>,
    pub keywords: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub homepage: Option<String>,
    /// Where to read the plugin from; none when Mali can't (see `unsupported`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<PluginSource>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub unsupported: Option<String>,
    /// The entry as written, which may describe the plugin's parts itself.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub entry: Option<Value>,
}

/// Read a marketplace found at `dir` inside `base`.
pub fn parse(json: &Value, base: &PluginSource, dir: &str) -> Result<Marketplace, String> {
    let plugins = json.get("plugins").and_then(Value::as_array).ok_or("The marketplace lists no plugins")?;
    let root = json.pointer("/metadata/pluginRoot").and_then(Value::as_str).unwrap_or("");
    let entries = plugins
        .iter()
        .filter(|p| p.get("name").and_then(Value::as_str).is_some())
        .take(MAX_ENTRIES)
        .map(|p| {
            let (source, unsupported) = match resolve(p.get("source"), base, dir, root) {
                Ok(source) => (Some(source), None),
                Err(why) => (None, Some(why)),
            };
            MarketplaceEntry {
                name: text(p, "name").unwrap_or_default(),
                description: text(p, "description").unwrap_or_default(),
                version: text(p, "version"),
                author: match p.get("author") {
                    Some(Value::String(s)) => Some(s.clone()),
                    Some(a @ Value::Object(_)) => text(a, "name"),
                    _ => None,
                },
                category: text(p, "category"),
                keywords: p
                    .get("keywords")
                    .or_else(|| p.get("tags"))
                    .and_then(Value::as_array)
                    .map(|k| k.iter().filter_map(Value::as_str).take(8).map(String::from).collect())
                    .unwrap_or_default(),
                homepage: text(p, "homepage").filter(|u| u.starts_with("https://")),
                source,
                unsupported,
                entry: Some(p.clone()),
            }
        })
        .collect();
    let owner = match json.get("owner") {
        Some(Value::String(s)) => Some(s.clone()),
        Some(o @ Value::Object(_)) => text(o, "name"),
        _ => None,
    };
    let here = with_dir(base, dir);
    Ok(Marketplace {
        name: text(json, "name").unwrap_or_else(|| here.label()),
        description: json
            .pointer("/metadata/description")
            .and_then(Value::as_str)
            .or_else(|| json.get("description").and_then(Value::as_str))
            .unwrap_or_default()
            .to_string(),
        owner,
        source_label: here.label(),
        source: here,
        plugins: entries,
    })
}

/// Where one plugin lives, from its entry's `source`.
fn resolve(source: Option<&Value>, base: &PluginSource, dir: &str, plugin_root: &str) -> Result<PluginSource, String> {
    match source {
        Some(Value::String(s)) if s.contains("://") || s.starts_with("git@") => github(s, None, None),
        Some(Value::String(s)) => relative(base, &[dir, plugin_root, s]),
        Some(v @ Value::Object(_)) => {
            let kind = text(v, "source").unwrap_or_default();
            let git_ref = text(v, "sha").or_else(|| text(v, "ref"));
            let path = text(v, "path");
            match kind.as_str() {
                "github" => {
                    let repo = text(v, "repo").ok_or("The entry names no repository")?;
                    github(&format!("https://github.com/{repo}"), git_ref, path)
                }
                "url" | "git" | "git-subdir" => {
                    let url = text(v, "url").ok_or("The entry has no address")?;
                    github(&url, git_ref, path)
                }
                "npm" | "pip" => Err(format!("Plugins published on {kind} aren't supported yet")),
                other => Err(format!("Mali can't read a “{other}” plugin source")),
            }
        }
        _ => Err("The entry doesn't say where the plugin is".into()),
    }
}

/// A GitHub repository, at a ref and folder when given.
fn github(url: &str, git_ref: Option<String>, path: Option<String>) -> Result<PluginSource, String> {
    match parse_source(url) {
        Ok(Source::GithubRepo { owner, repo, git_ref: linked_ref, dir }) => {
            let extra = path.unwrap_or_default();
            let dir = [dir.as_str(), extra.trim_start_matches("./")]
                .iter()
                .map(|p| p.trim_matches('/'))
                .filter(|p| !p.is_empty())
                .collect::<Vec<_>>()
                .join("/");
            if dir.split('/').any(|p| p == "..") {
                return Err("The plugin's path leaves its repository".into());
            }
            Ok(PluginSource::Github { owner, repo, git_ref: git_ref.or(linked_ref), dir })
        }
        _ => Err("Only plugins on GitHub or in a folder on this computer are supported".into()),
    }
}

/// A plugin in the marketplace's own repository or folder.
fn relative(base: &PluginSource, parts: &[&str]) -> Result<PluginSource, String> {
    let mut segments: Vec<&str> = Vec::new();
    for part in parts.iter().flat_map(|p| p.split('/')) {
        match part {
            "" | "." => {}
            ".." => return Err("The plugin's path leaves the marketplace".into()),
            other => segments.push(other),
        }
    }
    let joined = segments.join("/");
    Ok(match base {
        PluginSource::Github { owner, repo, git_ref, .. } => {
            PluginSource::Github { owner: owner.clone(), repo: repo.clone(), git_ref: git_ref.clone(), dir: joined }
        }
        PluginSource::Folder { path } if joined.is_empty() => PluginSource::Folder { path: path.clone() },
        PluginSource::Folder { path } => {
            let full = Path::new(path).join(&joined);
            if full.components().any(|c| matches!(c, Component::ParentDir)) {
                return Err("The plugin's path leaves the marketplace".into());
            }
            PluginSource::Folder { path: full.to_string_lossy().to_string() }
        }
    })
}

/// `base`, pointed at `dir` inside it.
fn with_dir(base: &PluginSource, dir: &str) -> PluginSource {
    match base {
        PluginSource::Github { .. } => relative(base, &[dir]).unwrap_or_else(|_| base.clone()),
        PluginSource::Folder { .. } => base.clone(),
    }
}

fn text(value: &Value, key: &str) -> Option<String> {
    value.get(key).and_then(Value::as_str).map(str::trim).filter(|s| !s.is_empty()).map(String::from)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn gh(owner: &str, repo: &str, git_ref: Option<&str>, dir: &str) -> PluginSource {
        PluginSource::Github { owner: owner.into(), repo: repo.into(), git_ref: git_ref.map(Into::into), dir: dir.into() }
    }

    #[test]
    fn resolves_every_kind_of_source() {
        let base = gh("acme", "market", None, "");
        let json = json!({
            "name": "acme",
            "owner": { "name": "Acme" },
            "metadata": { "description": "Tools", "pluginRoot": "./plugins" },
            "plugins": [
                { "name": "here", "source": "./" },
                { "name": "fmt", "source": "formatter", "version": "1.0.0", "author": { "name": "Ann" } },
                { "name": "remote", "source": { "source": "github", "repo": "o/r", "ref": "v2" } },
                { "name": "sub", "source": { "source": "git-subdir", "url": "https://github.com/o/mono.git", "path": "tools/x" } },
                { "name": "npm", "source": { "source": "npm", "package": "@x/y" } },
                { "name": "elsewhere", "source": { "source": "url", "url": "https://gitlab.com/o/r.git" } },
                { "name": "escape", "source": "../../etc" },
                { "description": "no name" }
            ]
        });
        let m = parse(&json, &base, "").unwrap();
        assert_eq!(m.name, "acme");
        assert_eq!(m.owner.as_deref(), Some("Acme"));
        assert_eq!(m.plugins.len(), 7);
        let src = |i: usize| m.plugins[i].source.clone();
        assert_eq!(src(0), Some(gh("acme", "market", None, "plugins")), "pluginRoot is prepended");
        assert_eq!(src(1), Some(gh("acme", "market", None, "plugins/formatter")));
        assert_eq!(m.plugins[1].author.as_deref(), Some("Ann"));
        assert_eq!(src(2), Some(gh("o", "r", Some("v2"), "")));
        assert_eq!(src(3), Some(gh("o", "mono", None, "tools/x")));
        assert!(m.plugins[4].unsupported.as_deref().unwrap().contains("npm"));
        assert!(m.plugins[5].source.is_none());
        assert!(m.plugins[6].source.is_none(), "a path can't leave the marketplace");
    }

    #[test]
    fn a_plugin_at_the_top_is_the_marketplace_itself() {
        let base = gh("affaan-m", "ecc", None, "");
        let m = parse(&json!({ "name": "ecc", "plugins": [{ "name": "ecc", "source": "./" }] }), &base, "").unwrap();
        assert_eq!(m.plugins[0].source.as_ref(), Some(&base));
    }

    #[test]
    fn folders_resolve_inside_the_folder() {
        let base = PluginSource::Folder { path: "/Users/me/market".into() };
        let m = parse(&json!({ "plugins": [{ "name": "a", "source": "./plugins/a" }] }), &base, "").unwrap();
        assert_eq!(m.plugins[0].source, Some(PluginSource::Folder { path: "/Users/me/market/plugins/a".into() }));
    }
}
