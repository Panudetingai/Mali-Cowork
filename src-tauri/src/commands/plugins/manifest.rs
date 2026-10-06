//! Reading a plugin: its manifest, then each part it offers.

use futures::StreamExt;
use serde_json::{Map, Value};

use super::{plugin_id, PluginDoc, PluginFile, PluginMcp, PluginPackage, PluginPanel, PluginSource};
use crate::commands::storage::skills::tree::{prefix_of, Listing, Origin};
use crate::commands::storage::skills::{safe_relative, MAX_SKILLS, MAX_SKILL_BYTES};

const PARALLEL: usize = 16;
const MAX_JSON_BYTES: u64 = 512 * 1024;
const MAX_DOCS: usize = 300;
const MAX_SERVERS: usize = 30;
const MAX_INSTRUCTIONS_BYTES: u64 = 32 * 1024;
const MAX_TEMPLATES: usize = 30;
const MAX_TEMPLATE_BYTES: u64 = 20 * 1024 * 1024;
const MAX_PANELS: usize = 12;
const MAX_PANEL_FILES: usize = 60;
const MAX_PANEL_FILE_BYTES: u64 = 2 * 1024 * 1024;
const MAX_PANELS_BYTES: u64 = 8 * 1024 * 1024;

/// What the manifest says about the plugin itself.
pub struct Head {
    pub name: String,
    pub version: Option<String>,
}

impl Head {
    pub fn from(manifest: &Value, listing: &Listing, dir: &str) -> Head {
        let name = text(manifest, "name").unwrap_or_else(|| {
            let last = dir.rsplit('/').next().unwrap_or_default();
            if last.is_empty() { listing.name() } else { last.to_string() }
        });
        Head { name, version: text(manifest, "version") }
    }
}

/// A JSON file at `path` inside the plugin's folder, if there is one.
pub async fn read_json(
    http: &reqwest::Client,
    listing: &Listing,
    dir: &str,
    path: &str,
) -> Result<Option<Value>, String> {
    let full = join(dir, path);
    let Some(entry) = listing.find(&full) else { return Ok(None) };
    let text = listing.origin.read_text(http, &entry.path, MAX_JSON_BYTES).await?;
    serde_json::from_str(&text).map(Some).map_err(|e| format!("{path} isn't valid JSON: {e}"))
}

/// Everything the plugin at `dir` offers.
pub async fn read_plugin(
    http: &reqwest::Client,
    listing: &Listing,
    dir: &str,
    source: &PluginSource,
    overlay: Option<Value>,
) -> Result<PluginPackage, String> {
    let mut manifest = read_json(http, listing, dir, ".claude-plugin/plugin.json").await?.unwrap_or(Value::Null);
    // A marketplace entry fills in what the plugin's own manifest leaves out.
    if let Some(Value::Object(extra)) = overlay {
        let own = manifest.as_object().cloned().unwrap_or_default();
        let mut merged = extra;
        merged.remove("source");
        merged.extend(own);
        manifest = Value::Object(merged);
    }
    let head = Head::from(&manifest, listing, dir);

    // Skills: `skills/` plus any folders the manifest adds.
    let mut roots = Vec::new();
    for path in component_paths(&manifest, "skills", dir, "skills") {
        for root in listing.skill_roots(&path) {
            if !roots.contains(&root) {
                roots.push(root);
            }
        }
    }
    roots.truncate(MAX_SKILLS);
    let skills = listing.skill_packages(http, &roots).await;

    let commands = read_docs(http, listing, &md_files(listing, &component_paths(&manifest, "commands", dir, "commands"))).await;
    let agents = read_docs(http, listing, &md_files(listing, &component_paths(&manifest, "agents", dir, "agents"))).await;
    let mcp_servers = read_servers(http, listing, dir, &manifest).await;

    let mali = manifest.get("mali").cloned().unwrap_or(Value::Null);
    let instructions = {
        let path = text(&mali, "instructions").map(|p| join(dir, &clean(&p).unwrap_or_default())).unwrap_or_else(|| join(dir, "mali/instructions.md"));
        match listing.find(&path) {
            Some(entry) => listing.origin.read_text(http, &entry.path, MAX_INSTRUCTIONS_BYTES).await.ok(),
            None => None,
        }
        .map(|t| t.trim().to_string())
        .filter(|t| !t.is_empty())
    };
    let templates = templates_in(listing, &component_paths(&mali, "templates", dir, "mali/templates"));
    let (panels, panel_files) = panels_in(listing, dir, &mali);

    let has_anything = !skills.is_empty()
        || !commands.is_empty()
        || !agents.is_empty()
        || !mcp_servers.is_empty()
        || instructions.is_some()
        || !templates.is_empty()
        || !panels.is_empty();
    if !has_anything {
        return Err(format!(
            "{} doesn't look like a plugin: there's no skills/, commands/, agents/, .mcp.json or mali/ folder to install. \
             To add only skills from it, use Settings → Skills → Import.",
            source.label()
        ));
    }

    Ok(PluginPackage {
        id: plugin_id(&head.name),
        name: head.name,
        version: head.version,
        description: text(&manifest, "description").unwrap_or_default(),
        author: person(manifest.get("author")),
        homepage: text(&manifest, "homepage").filter(|u| u.starts_with("https://")),
        repository: match manifest.get("repository") {
            Some(Value::Object(o)) => o.get("url").and_then(Value::as_str).map(String::from),
            other => other.and_then(Value::as_str).map(String::from),
        }
        .filter(|u| u.starts_with("https://")),
        license: text(&manifest, "license"),
        keywords: manifest
            .get("keywords")
            .and_then(Value::as_array)
            .map(|k| k.iter().filter_map(Value::as_str).take(12).map(String::from).collect())
            .unwrap_or_default(),
        source: source.clone(),
        source_label: source.label(),
        revision: listing.revision(dir),
        unsupported: unsupported(listing, dir, &manifest),
        skills,
        commands,
        agents,
        mcp_servers,
        templates,
        panels,
        panel_files,
        instructions,
    })
}

/// The folders (or files) a part comes from: its default folder, plus what
/// the manifest adds — Claude Code's rule that custom paths add to the
/// defaults rather than replace them.
fn component_paths(manifest: &Value, key: &str, dir: &str, default: &str) -> Vec<String> {
    let mut paths = vec![join(dir, default)];
    for path in strings(manifest.get(key)) {
        if let Some(path) = clean(&path) {
            let full = join(dir, &path);
            if !paths.contains(&full) {
                paths.push(full);
            }
        }
    }
    paths
}

/// The Markdown files at or under these paths, one level of sub-folders deep
/// at most beyond the second, skipping READMEs.
fn md_files(listing: &Listing, paths: &[String]) -> Vec<String> {
    let mut found = Vec::new();
    for path in paths {
        let is_md = |p: &str| p.to_ascii_lowercase().ends_with(".md") && !p.rsplit('/').next().unwrap_or(p).eq_ignore_ascii_case("README.md");
        if let Some(file) = listing.find(path).filter(|f| is_md(&f.path)) {
            found.push(file.path.clone());
            continue;
        }
        let prefix = prefix_of(path);
        for file in listing.under(path) {
            let rest = &file.path[prefix.len()..];
            if is_md(rest) && rest.matches('/').count() <= 2 && !found.contains(&file.path) {
                found.push(file.path.clone());
            }
        }
    }
    found.truncate(MAX_DOCS);
    found
}

async fn read_docs(http: &reqwest::Client, listing: &Listing, paths: &[String]) -> Vec<PluginDoc> {
    let reads: Vec<_> = paths
        .iter()
        .map(|path| async move {
            let content = listing.origin.read_text(http, path, MAX_SKILL_BYTES as u64).await.ok()?;
            let file = path.rsplit('/').next().unwrap_or(path);
            let name = file.rsplit_once('.').map_or(file, |(stem, _)| stem).to_string();
            Some(PluginDoc { name, path: path.clone(), content })
        })
        .collect();
    let docs: Vec<Option<PluginDoc>> = futures::stream::iter(reads).buffered(PARALLEL).collect().await;
    docs.into_iter().flatten().collect()
}

/// Connectors: the manifest's `mcpServers` (a path, several, or the servers
/// themselves) or else `.mcp.json`. A manifest that says `"mcpServers": {}`
/// has none, whatever `.mcp.json` the repository keeps for itself.
async fn read_servers(http: &reqwest::Client, listing: &Listing, dir: &str, manifest: &Value) -> Vec<PluginMcp> {
    let mut maps: Vec<Map<String, Value>> = Vec::new();
    let declared = manifest.get("mcpServers");
    let mut files: Vec<String> = Vec::new();
    match declared {
        None => files.push(".mcp.json".into()),
        Some(Value::Object(map)) => maps.push(servers_of(&Value::Object(map.clone()))),
        Some(Value::String(path)) => files.extend(clean(path)),
        Some(Value::Array(items)) => {
            for item in items {
                match item {
                    Value::String(path) => files.extend(clean(path)),
                    Value::Object(_) => maps.push(servers_of(item)),
                    _ => {}
                }
            }
        }
        _ => {}
    }
    for file in files {
        if let Ok(Some(json)) = read_json(http, listing, dir, &file).await {
            maps.push(servers_of(&json));
        }
    }

    let root = match &listing.origin {
        Origin::Folder(path) => Some(path.join(dir).to_string_lossy().to_string()),
        Origin::Github { .. } => None,
    };
    let mut servers = Vec::new();
    for (name, config) in maps.into_iter().flatten() {
        if servers.len() >= MAX_SERVERS || servers.iter().any(|s: &PluginMcp| s.name == name) {
            continue;
        }
        servers.push(vet_server(name, config, root.as_deref()));
    }
    servers
}

/// `{ "mcpServers": {...} }`, or the servers map itself.
fn servers_of(json: &Value) -> Map<String, Value> {
    let map = json.get("mcpServers").unwrap_or(json);
    map.as_object()
        .map(|m| m.iter().filter(|(_, v)| v.is_object()).map(|(k, v)| (k.clone(), v.clone())).collect())
        .unwrap_or_default()
}

const PLUGIN_ROOT: &str = "${CLAUDE_PLUGIN_ROOT}";

fn vet_server(name: String, mut config: Value, root: Option<&str>) -> PluginMcp {
    let raw = config.to_string();
    let mut skipped = None;
    if raw.contains(PLUGIN_ROOT) || raw.contains("${CLAUDE_PLUGIN_DATA}") {
        match root {
            // From a folder on this computer the plugin's own files are right there.
            Some(root) if !raw.contains("${CLAUDE_PLUGIN_DATA}") => {
                let replaced = raw.replace(PLUGIN_ROOT, &root.replace('\\', "\\\\").replace('"', "\\\""));
                config = serde_json::from_str(&replaced).unwrap_or(config);
            }
            _ => skipped = Some("It runs a program from inside the plugin, which Mali doesn't download. Install the plugin from a folder on this computer to use it.".into()),
        }
    }
    if skipped.is_none() {
        let command = config.get("command");
        let url = config.get("url").or_else(|| config.get("serverUrl")).and_then(Value::as_str);
        let has_command = matches!(command, Some(Value::String(c)) if !c.trim().is_empty())
            || matches!(command, Some(Value::Array(a)) if !a.is_empty());
        skipped = match url {
            Some(u) if u.starts_with("https://") || u.starts_with("http://localhost") || u.starts_with("http://127.0.0.1") => None,
            Some(_) => Some("Its address isn't https://".into()),
            None if has_command => None,
            None => Some("It has neither a command nor an address".into()),
        };
    }
    PluginMcp { name, config, skipped }
}

fn templates_in(listing: &Listing, paths: &[String]) -> Vec<PluginFile> {
    let mut found: Vec<PluginFile> = Vec::new();
    for path in paths {
        let candidates: Vec<_> = match listing.find(path) {
            Some(file) => vec![file],
            None => listing.under(path).collect(),
        };
        for file in candidates {
            let name = file.path.rsplit('/').next().unwrap_or(&file.path);
            let Some(stem) = name.strip_suffix(".docx").or_else(|| name.strip_suffix(".DOCX")) else { continue };
            if stem.starts_with('~') || found.iter().any(|f| f.path == file.path) {
                continue;
            }
            found.push(PluginFile {
                name: stem.replace(['-', '_'], " "),
                path: file.path.clone(),
                url: listing.origin.url(&file.path),
                bytes: file.bytes,
                skipped: (file.bytes > MAX_TEMPLATE_BYTES).then(|| "It's larger than 20 MB".into()),
            });
        }
    }
    found.truncate(MAX_TEMPLATES);
    found
}

/// Panels and the files they load. Declared panels may live anywhere under
/// `mali/`; otherwise each `.html` file in `mali/panels/` is one.
fn panels_in(listing: &Listing, dir: &str, mali: &Value) -> (Vec<PluginPanel>, Vec<PluginFile>) {
    let base = join(dir, "mali/panels");
    let mut panels = Vec::new();
    if let Some(items) = mali.get("panels").and_then(Value::as_array) {
        for item in items {
            let (entry, title, icon, id) = match item {
                Value::String(path) => (path.clone(), None, None, None),
                Value::Object(_) => (
                    text(item, "entry").or_else(|| text(item, "path")).unwrap_or_default(),
                    text(item, "title"),
                    text(item, "icon"),
                    text(item, "id"),
                ),
                _ => continue,
            };
            let Some(entry) = clean(&entry) else { continue };
            // Declared relative to the plugin; kept relative to the panels folder.
            let entry = entry.strip_prefix("mali/panels/").unwrap_or(&entry).to_string();
            panels.push(panel(entry, title, icon, id));
        }
    } else {
        let prefix = prefix_of(&base);
        for file in listing.under(&base) {
            let rest = &file.path[prefix.len()..];
            if !rest.contains('/') && rest.to_ascii_lowercase().ends_with(".html") {
                panels.push(panel(rest.to_string(), None, None, None));
            }
        }
    }
    panels.retain(|p| listing.find(&join(&base, &p.entry)).is_some());
    panels.truncate(MAX_PANELS);
    if panels.is_empty() {
        return (panels, Vec::new());
    }

    let prefix = prefix_of(&base);
    let mut total = 0u64;
    let files = listing
        .under(&base)
        .take(MAX_PANEL_FILES)
        .map(|file| {
            let name = file.path[prefix.len()..].to_string();
            let skipped = if safe_relative(&name).is_err() {
                Some("Its path can't be used".to_string())
            } else if file.bytes > MAX_PANEL_FILE_BYTES {
                Some("It's larger than 2 MB".into())
            } else {
                total += file.bytes;
                (total > MAX_PANELS_BYTES).then(|| "The panels are over 8 MB".into())
            };
            PluginFile { name, path: file.path.clone(), url: listing.origin.url(&file.path), bytes: file.bytes, skipped }
        })
        .collect();
    (panels, files)
}

fn panel(entry: String, title: Option<String>, icon: Option<String>, id: Option<String>) -> PluginPanel {
    let stem = entry.rsplit('/').next().unwrap_or(&entry).trim_end_matches(".html").to_string();
    let title = title.unwrap_or_else(|| {
        let words = stem.replace(['-', '_'], " ");
        let mut chars = words.chars();
        chars.next().map(|c| c.to_uppercase().collect::<String>() + chars.as_str()).unwrap_or_default()
    });
    PluginPanel { id: plugin_id(&id.unwrap_or(stem)), title, icon, entry }
}

/// What the plugin has that Mali doesn't use, so the user knows.
fn unsupported(listing: &Listing, dir: &str, manifest: &Value) -> Vec<String> {
    let mut notes = Vec::new();
    let has = |path: &str| listing.find(&join(dir, path)).is_some();
    if manifest.get("hooks").is_some() || has("hooks/hooks.json") {
        notes.push("Hooks — Mali never runs a plugin's hooks. Its skills, commands and agents work without them.".into());
    }
    if manifest.get("outputStyles").is_some() || listing.under(&join(dir, "output-styles")).next().is_some() {
        notes.push("Output styles".into());
    }
    if manifest.get("lspServers").is_some() || has(".lsp.json") {
        notes.push("Language servers (LSP)".into());
    }
    if manifest.get("userConfig").is_some() {
        notes.push("Plugin settings (userConfig) — what they switch is left at its default".into());
    }
    notes
}

/// A path inside the plugin: relative, without `..`, `./` and trailing `/` gone.
fn clean(path: &str) -> Option<String> {
    let path = path.trim().trim_start_matches("./").trim_end_matches('/');
    if path.starts_with('/') || path.contains('\\') || path.split('/').any(|p| p == "..") {
        return None;
    }
    Some(path.to_string())
}

fn join(dir: &str, path: &str) -> String {
    let dir = dir.trim_matches('/');
    let path = path.trim_start_matches("./").trim_matches('/');
    match (dir.is_empty(), path.is_empty()) {
        (true, _) => path.to_string(),
        (_, true) => dir.to_string(),
        _ => format!("{dir}/{path}"),
    }
}

fn strings(value: Option<&Value>) -> Vec<String> {
    match value {
        Some(Value::String(s)) => vec![s.clone()],
        Some(Value::Array(items)) => items.iter().filter_map(Value::as_str).map(String::from).collect(),
        _ => Vec::new(),
    }
}

fn text(value: &Value, key: &str) -> Option<String> {
    value.get(key).and_then(Value::as_str).map(str::trim).filter(|s| !s.is_empty()).map(String::from)
}

/// `"Ann"` or `{ "name": "Ann", "email": … }` → `Ann`.
fn person(value: Option<&Value>) -> Option<String> {
    match value? {
        Value::String(s) => Some(s.clone()),
        v @ Value::Object(_) => text(v, "name"),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn manifest_paths_add_to_the_defaults() {
        let m = json!({ "commands": ["./extra/cmds/", "./one.md"], "skills": "./more-skills" });
        assert_eq!(component_paths(&m, "commands", "", "commands"), ["commands", "extra/cmds", "one.md"]);
        assert_eq!(component_paths(&m, "skills", "plugins/x", "skills"), ["plugins/x/skills", "plugins/x/more-skills"]);
        assert_eq!(component_paths(&json!({ "agents": "../escape" }), "agents", "", "agents"), ["agents"]);
    }

    #[test]
    fn finds_command_files() {
        let l = Listing::for_test(&["commands/a.md", "commands/README.md", "commands/sub/b.md", "commands/x.txt", "one.md"]);
        assert_eq!(md_files(&l, &["commands".into(), "one.md".into()]), ["commands/a.md", "commands/sub/b.md", "one.md"]);
    }

    #[test]
    fn servers_from_a_folder_find_their_files() {
        let s = vet_server("db".into(), json!({ "command": "${CLAUDE_PLUGIN_ROOT}/bin/db", "args": [] }), Some("/plugins/x"));
        assert!(s.skipped.is_none());
        assert_eq!(s.config["command"], "/plugins/x/bin/db");

        let s = vet_server("db".into(), json!({ "command": "${CLAUDE_PLUGIN_ROOT}/bin/db" }), None);
        assert!(s.skipped.is_some(), "a downloaded plugin has no files to run");

        assert!(vet_server("w".into(), json!({ "url": "https://x.dev/mcp" }), None).skipped.is_none());
        assert!(vet_server("w".into(), json!({ "url": "http://x.dev/mcp" }), None).skipped.is_some());
        assert!(vet_server("w".into(), json!({ "type": "stdio" }), None).skipped.is_some());
        assert!(vet_server("n".into(), json!({ "command": "npx", "args": ["-y", "x"] }), None).skipped.is_none());
    }

    #[test]
    fn servers_maps_take_both_shapes() {
        assert_eq!(servers_of(&json!({ "mcpServers": { "a": {}, "b": 1 } })).len(), 1);
        assert_eq!(servers_of(&json!({ "a": { "command": "x" } })).len(), 1);
    }

    #[test]
    fn panels_come_from_their_folder() {
        let l = Listing::for_test(&["mali/panels/notes-board.html", "mali/panels/app.js", "mali/panels/img/logo.png", "mali/other.html"]);
        let (panels, files) = panels_in(&l, "", &Value::Null);
        assert_eq!(panels.len(), 1);
        assert_eq!(panels[0].title, "Notes board");
        assert_eq!(panels[0].entry, "notes-board.html");
        let mut names: Vec<&str> = files.iter().map(|f| f.name.as_str()).collect();
        names.sort();
        assert_eq!(names, ["app.js", "img/logo.png", "notes-board.html"]);

        let declared = json!({ "panels": [{ "id": "Board", "title": "Board", "entry": "./mali/panels/notes-board.html", "icon": "kanban" }, { "entry": "missing.html" }] });
        let (panels, _) = panels_in(&l, "", &declared);
        assert_eq!(panels.len(), 1, "a panel whose page is missing is left out");
        assert_eq!(panels[0].id, "board");
        assert_eq!(panels[0].icon.as_deref(), Some("kanban"));
    }

    #[test]
    fn templates_are_docx_files() {
        let l = Listing::for_test(&["mali/templates/quote_form.docx", "mali/templates/~$lock.docx", "mali/templates/notes.md"]);
        let found = templates_in(&l, &["mali/templates".into()]);
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].name, "quote form");
    }

    #[test]
    fn notes_what_mali_leaves_out() {
        let l = Listing::for_test(&["hooks/hooks.json"]);
        let notes = unsupported(&l, "", &json!({ "userConfig": {} }));
        assert_eq!(notes.len(), 2);
    }
}
