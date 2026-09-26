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

// ── Antigravity tool permissions ──

/// Where the Antigravity CLI keeps `permissions.allow` (its only settings file).
pub(crate) fn antigravity_settings_path() -> Option<PathBuf> {
    dirs::home_dir().map(|home| home.join(".gemini").join("antigravity-cli").join("settings.json"))
}

/// Manifest key for the allow-rules the app owns in that file.
const AGY_RULES: &str = "antigravity:permissions";

fn mcp_allow_rule(id: &str) -> String {
    format!("mcp({id}/*)")
}

/// Let `agy` call the connectors the app set up for it.
///
/// A headless `agy -p` run cannot prompt, so every tool it has no standing
/// approval for is auto-denied — including MCP tools. Chat and read-only
/// folders deliberately run without `--dangerously-skip-permissions`, which
/// left the connectors listed but unusable: the model, denied the call, would
/// answer from memory and invent a CLI command instead.
///
/// So each shared connector gets `mcp(<id>/*)` in `permissions.allow`. That is
/// the narrowest rule that covers it: no file writes, no shell commands, and
/// nothing granted for a connector the user has switched off.
pub(crate) fn merge_allow_rules(
    settings: &mut Value,
    ids: &[String],
    owned_before: &[String],
) -> Result<Vec<String>, String> {
    if !settings.is_object() {
        return Err("not a JSON object".into());
    }
    let wanted: Vec<String> = ids.iter().map(|id| mcp_allow_rule(id)).collect();
    let drop: HashSet<&str> = owned_before
        .iter()
        .map(String::as_str)
        .filter(|rule| !wanted.iter().any(|w| w == rule))
        .collect();

    let permissions = settings
        .as_object_mut()
        .expect("checked above")
        .entry("permissions")
        .or_insert_with(|| json!({}));
    let permissions = permissions
        .as_object_mut()
        .ok_or("permissions is not an object")?;
    let allow = permissions.entry("allow").or_insert_with(|| json!([]));
    let allow = allow.as_array_mut().ok_or("permissions.allow is not a list")?;

    // Rules the app added for connectors that are gone; the user's own stay.
    allow.retain(|rule| !rule.as_str().is_some_and(|rule| drop.contains(rule)));
    for rule in &wanted {
        if !allow.iter().any(|existing| existing.as_str() == Some(rule.as_str())) {
            allow.push(json!(rule));
        }
    }
    Ok(wanted)
}

fn write_antigravity_permissions(
    ids: &[String],
    owned_before: &[String],
    warnings: &mut Vec<String>,
) -> Option<Vec<String>> {
    let path = antigravity_settings_path()?;
    let mut settings: Value = match std::fs::read_to_string(&path) {
        Ok(raw) if raw.trim().is_empty() => json!({}),
        Ok(raw) => match serde_json::from_str(&raw) {
            Ok(value) => value,
            Err(_) => {
                warnings.push(format!("{} isn't plain JSON; not changed", path.display()));
                return None;
            }
        },
        // No settings file yet: the CLI writes one the first time it runs, and
        // adding rules for a CLI that was never started helps nobody.
        Err(_) => return None,
    };

    match merge_allow_rules(&mut settings, ids, owned_before) {
        Ok(owned) => {
            let pretty = serde_json::to_string_pretty(&settings).unwrap_or_default();
            match write_private(&path, &pretty) {
                Ok(()) => Some(owned),
                Err(e) => {
                    warnings.push(e);
                    None
                }
            }
        }
        Err(e) => {
            warnings.push(format!("{}: {e}; not changed", path.display()));
            None
        }
    }
}

pub(crate) fn manifest_path() -> PathBuf {
    dirs::data_local_dir()
        .unwrap_or_else(std::env::temp_dir)
        .join("mali-cowork")
        .join("mcp-clients.json")
}

pub(crate) type Manifest = BTreeMap<String, Vec<String>>;

pub(crate) fn read_manifest() -> Manifest {
    std::fs::read_to_string(manifest_path())
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

/// Connectors the app last wrote into one CLI's config, by its manifest name.
pub fn shared_with(client: &str) -> Vec<String> {
    read_manifest().remove(client).unwrap_or_default()
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

        // Writing the connectors is only half of it for Antigravity: without an
        // allow-rule a headless run denies every MCP call it cannot prompt for.
        if target.name == "antigravity" {
            let ids: Vec<String> = manifest.get(target.name).cloned().unwrap_or_default();
            let owned_before = manifest.get(AGY_RULES).cloned().unwrap_or_default();
            if let Some(rules) = write_antigravity_permissions(&ids, &owned_before, &mut warnings) {
                manifest.insert(AGY_RULES.to_string(), rules);
            }
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

    #[test]
    fn allows_the_connectors_headless_agy_would_otherwise_deny() {
        let mut settings = json!({ "trustedWorkspaces": ["/w"] });
        let ids = ["word".to_string(), "custom-canva".to_string()];
        let owned = merge_allow_rules(&mut settings, &ids, &[]).unwrap();
        assert_eq!(owned, ["mcp(word/*)", "mcp(custom-canva/*)"]);
        assert_eq!(
            settings["permissions"]["allow"],
            json!(["mcp(word/*)", "mcp(custom-canva/*)"])
        );
        // Nothing beyond the connectors: no file writes, no shell commands.
        assert_eq!(settings["trustedWorkspaces"], json!(["/w"]));
        assert!(settings["permissions"].get("deny").is_none());
    }

    #[test]
    fn keeps_the_users_own_rules_and_drops_only_its_own() {
        let mut settings = json!({
            "permissions": { "allow": ["command(git)", "mcp(word/*)", "mcp(github/*)"] }
        });
        let owned_before = ["mcp(word/*)".to_string(), "mcp(github/*)".to_string()];
        let owned =
            merge_allow_rules(&mut settings, &["word".to_string()], &owned_before).unwrap();
        assert_eq!(owned, ["mcp(word/*)"]);
        assert_eq!(
            settings["permissions"]["allow"],
            json!(["command(git)", "mcp(word/*)"])
        );
    }

    #[test]
    fn a_rule_the_user_wrote_themselves_is_never_duplicated() {
        let mut settings = json!({ "permissions": { "allow": ["mcp(word/*)"] } });
        merge_allow_rules(&mut settings, &["word".to_string()], &[]).unwrap();
        assert_eq!(settings["permissions"]["allow"], json!(["mcp(word/*)"]));
    }

    #[test]
    fn leaves_settings_it_cannot_understand_alone() {
        let mut list = json!([1, 2]);
        assert!(merge_allow_rules(&mut list, &[], &[]).is_err());
        let mut wrong_shape = json!({ "permissions": { "allow": "everything" } });
        assert!(merge_allow_rules(&mut wrong_shape, &[], &[]).is_err());
    }
}
