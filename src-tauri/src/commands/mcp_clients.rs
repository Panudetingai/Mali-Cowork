//! Share the app's connectors with other agent CLIs on this computer:
//! Antigravity CLI (`~/.gemini/config/mcp_config.json`) and Cursor (`~/.cursor/mcp.json`),
//! next to OpenCode and Codex (see `mcp.rs`).
//!
//! - Only CLIs that are set up (their folder exists) get a file.
//! - Only connectors that are on are written, and only entries the app wrote
//!   before are removed (tracked in `mcp-clients.json`): servers the user
//!   added to those files by hand are never touched, even with the same name.
//! - Files the app can't parse (e.g. JSON with comments) are left alone.
//! - Filesystem and Exec are not shared: they exist for the app's own agent,
//!   and those CLIs have their own file and shell tools.
//!
//! Sign-in (OAuth) is per client: those CLIs sign in to remote servers
//! themselves the first time they use them.

use std::collections::{BTreeMap, HashSet};
use std::path::PathBuf;

use serde_json::{json, Map, Value};

use super::mcp::McpServerEntry;
use super::secure_fs::write_private;

/// App-only servers that other CLIs don't get.
const NOT_SHARED: &[&str] = &["filesystem", "exec"];

struct Target {
    /// Key in the manifest.
    name: &'static str,
    /// The CLI's own folder; no folder, no file.
    dir: PathBuf,
    file: PathBuf,
    entry: fn(&McpServerEntry, &[String], Option<&str>) -> Value,
}

fn targets() -> Vec<Target> {
    let Some(home) = dirs::home_dir() else {
        return Vec::new();
    };
    vec![
        Target {
            name: "antigravity",
            // The CLI only exists here once it has been run; its global MCP
            // servers live in their own file, not in settings.json.
            // Ref: https://antigravity.google/docs/cli/gcli-migration/
            dir: home.join(".gemini").join("antigravity-cli"),
            file: home.join(".gemini").join("config").join("mcp_config.json"),
            entry: antigravity_entry,
        },
        Target {
            name: "cursor",
            dir: home.join(".cursor"),
            file: home.join(".cursor").join("mcp.json"),
            entry: cursor_entry,
        },
    ]
}

fn local_env(server: &McpServerEntry, path: Option<&str>) -> Map<String, Value> {
    let mut env: Map<String, Value> = server.environment.iter().map(|(k, v)| (k.clone(), json!(v))).collect();
    if let Some(path) = path {
        env.entry("PATH").or_insert_with(|| json!(path));
    }
    env
}

/// Only the keys Antigravity documents are written, so a stricter parser in a
/// newer CLI can still read the file.
fn antigravity_entry(server: &McpServerEntry, argv: &[String], path: Option<&str>) -> Value {
    if server.kind == "remote" {
        // Antigravity replaced the legacy `url` / `httpUrl` keys with `serverUrl`.
        let mut entry = json!({ "serverUrl": server.url.as_deref().unwrap_or_default() });
        if !server.headers.is_empty() {
            entry["headers"] = json!(server.headers);
        }
        return entry;
    }
    json!({
        "command": argv.first().cloned().unwrap_or_default(),
        "args": argv.get(1..).unwrap_or_default(),
        "env": local_env(server, path),
    })
}

fn cursor_entry(server: &McpServerEntry, argv: &[String], path: Option<&str>) -> Value {
    if server.kind == "remote" {
        let mut entry = json!({ "url": server.url.as_deref().unwrap_or_default() });
        if !server.headers.is_empty() {
            entry["headers"] = json!(server.headers);
        }
        return entry;
    }
    json!({
        "command": argv.first().cloned().unwrap_or_default(),
        "args": argv.get(1..).unwrap_or_default(),
        "env": local_env(server, path),
    })
}

fn manifest_path() -> PathBuf {
    dirs::data_local_dir()
        .unwrap_or_else(std::env::temp_dir)
        .join("mali-cowork")
        .join("mcp-clients.json")
}

type Manifest = BTreeMap<String, Vec<String>>;

fn read_manifest() -> Manifest {
    std::fs::read_to_string(manifest_path())
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

/// Merge the app's servers into one CLI's `mcpServers`, keeping the user's own.
/// Returns the ids the app now owns there.
pub(crate) fn merge(
    config: &mut Value,
    servers: &[(String, Value)],
    owned_before: &HashSet<String>,
) -> Result<Vec<String>, String> {
    if !config.is_object() {
        return Err("not a JSON object".into());
    }
    let mcp = config
        .as_object_mut()
        .expect("checked above")
        .entry("mcpServers")
        .or_insert_with(|| json!({}));
    let mcp = mcp.as_object_mut().ok_or("mcpServers is not an object")?;
    for id in owned_before {
        mcp.remove(id);
    }
    let mut owned = Vec::new();
    for (id, entry) in servers {
        if mcp.contains_key(id) {
            // The user's own server with this name wins.
            continue;
        }
        mcp.insert(id.clone(), entry.clone());
        owned.push(id.clone());
    }
    Ok(owned)
}

/// Write the enabled connectors to every CLI that is set up. Best effort:
/// a problem with one file is reported and the rest still sync.
pub fn write_all(
    servers: &[McpServerEntry],
    resolve: impl Fn(&[String]) -> Vec<String>,
    path: Option<String>,
) -> Vec<String> {
    let mut warnings = Vec::new();
    let mut manifest = read_manifest();
    let shared: Vec<&McpServerEntry> = servers
        .iter()
        .filter(|s| s.enabled && !NOT_SHARED.contains(&s.id.as_str()))
        .collect();

    for target in targets() {
        if !target.dir.is_dir() {
            continue;
        }
        let owned_before: HashSet<String> = manifest.get(target.name).cloned().unwrap_or_default().into_iter().collect();
        let entries: Vec<(String, Value)> = shared
            .iter()
            .map(|s| {
                let argv = if s.kind == "remote" { Vec::new() } else { resolve(&s.command) };
                (s.id.clone(), (target.entry)(s, &argv, path.as_deref()))
            })
            .collect();
        if entries.is_empty() && owned_before.is_empty() {
            continue;
        }
        let mut config: Value = match std::fs::read_to_string(&target.file) {
            Ok(raw) if raw.trim().is_empty() => json!({}),
            Ok(raw) => match serde_json::from_str(&raw) {
                Ok(value) => value,
                Err(_) => {
                    warnings.push(format!("{} isn't plain JSON; not changed", target.file.display()));
                    continue;
                }
            },
            Err(_) => json!({}),
        };
        match merge(&mut config, &entries, &owned_before) {
            Ok(owned) => {
                let pretty = serde_json::to_string_pretty(&config).unwrap_or_default();
                match write_private(&target.file, &pretty) {
                    Ok(()) => {
                        manifest.insert(target.name.to_string(), owned);
                    }
                    Err(e) => warnings.push(e),
                }
            }
            Err(e) => warnings.push(format!("{}: {e}; not changed", target.file.display())),
        }
    }

    if let Ok(json) = serde_json::to_string_pretty(&manifest) {
        if let Err(e) = write_private(&manifest_path(), &json) {
            warnings.push(e);
        }
    }
    warnings
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_the_users_own_servers() {
        let mut config = json!({
            "theme": "dark",
            "mcpServers": {
                "github": { "command": "my-own-github" },
                "old-app-server": { "command": "x" }
            }
        });
        let owned_before: HashSet<String> = ["old-app-server".to_string()].into();
        let servers = vec![
            ("github".to_string(), json!({ "command": "npx" })),
            ("memory".to_string(), json!({ "command": "npx" })),
        ];
        let owned = merge(&mut config, &servers, &owned_before).unwrap();
        assert_eq!(owned, vec!["memory"]);
        assert_eq!(config["mcpServers"]["github"]["command"], "my-own-github");
        assert!(config["mcpServers"].get("old-app-server").is_none());
        assert_eq!(config["theme"], "dark");
    }

    #[test]
    fn refuses_non_objects() {
        let mut config = json!([1, 2]);
        assert!(merge(&mut config, &[], &HashSet::new()).is_err());
    }
}
