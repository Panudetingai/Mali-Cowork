//! Connector tools on demand. A connector like Canva or Notion brings dozens
//! of tools with long schemas, and every step of a run used to send all of
//! them again — most of what a step cost, for tools the task never touched.
//!
//! When the connectors' schemas are large, the model gets one `load_tools`
//! tool whose description lists every connector tool in a line. The tools it
//! loads become ordinary tools, schema and all, from the next step on. What
//! a session has loaded is read back from its history (any connector tool it
//! called), so a later message doesn't load them again, and the tool list
//! only ever grows at its end, which keeps the provider's prompt cache warm.

use std::collections::HashMap;

use serde_json::{json, Value};

use super::wire::{Msg, ToolSpec};
use crate::mcp_hub::HubTool;

pub const NAME: &str = "load_tools";

/// Below this, the schemas cost less than the extra step to load them.
const MIN_CHARS: usize = 8_000;
/// One line per tool in the catalog.
const LINE_CHARS: usize = 110;

/// The token savers (this and trimming stale output); `MALI_TOKEN_SAVER=0`
/// turns them off, to compare with how runs went before.
pub fn saver_on() -> bool {
    std::env::var("MALI_TOKEN_SAVER").map(|v| v.trim() != "0").unwrap_or(true)
}

pub fn spec_of(tool: &HubTool) -> ToolSpec {
    ToolSpec {
        name: tool.name.clone(),
        description: if tool.description.is_empty() {
            format!("{} tool {}", tool.server, tool.tool)
        } else {
            tool.description.clone()
        },
        schema: tool.schema.clone(),
    }
}

fn size(tool: &HubTool) -> usize {
    tool.name.len() + tool.description.len() + tool.schema.to_string().len()
}

/// Whether this run loads connector tools on demand.
pub fn wanted(tools: &[HubTool]) -> bool {
    saver_on() && tools.iter().map(size).sum::<usize>() > MIN_CHARS
}

/// A tool's description cut to its first sentence, on one line.
fn gist(description: &str) -> String {
    let line = description.split_whitespace().collect::<Vec<_>>().join(" ");
    let first = line
        .find(". ")
        .map(|end| &line[..=end])
        .unwrap_or(&line)
        .trim();
    if first.chars().count() <= LINE_CHARS {
        return first.to_string();
    }
    let cut: String = first.chars().take(LINE_CHARS - 1).collect();
    format!("{}…", cut.trim_end())
}

/// The one tool the model starts with: the catalog, and how to load from it.
pub fn spec(tools: &[HubTool]) -> ToolSpec {
    let mut catalog = String::new();
    let mut server = "";
    for tool in tools {
        if tool.server != server {
            server = &tool.server;
            catalog.push_str(&format!("\n{server}:\n"));
        }
        catalog.push_str(&format!("- {}: {}\n", tool.name, gist(&tool.description)));
    }
    ToolSpec {
        name: NAME.into(),
        description: format!(
            "The user's connectors have these tools. Load the ones the task needs (all of them in one \
call); from your next step they are ordinary tools with their full parameters. Tools you loaded or used \
earlier in this chat are already there.\n{catalog}"
        ),
        schema: json!({
            "type": "object",
            "properties": {
                "names": {
                    "type": "array",
                    "items": { "type": "string" },
                    "description": "Tool names exactly as listed."
                }
            },
            "required": ["names"]
        }),
    }
}

/// The connector tools a session has used, in the order it first used them.
pub fn used_in(msgs: &[Msg], is_connector: impl Fn(&str) -> bool) -> Vec<String> {
    let mut used: Vec<String> = Vec::new();
    for msg in msgs {
        let Msg::Assistant { tool_calls, .. } = msg else { continue };
        for call in tool_calls {
            if is_connector(&call.name) && !used.contains(&call.name) {
                used.push(call.name.clone());
            }
        }
    }
    used
}

/// Adds the asked-for tools to `loaded`; the answer says what's ready and
/// what wasn't found.
pub fn load(args: &Value, names_known: &[&str], loaded: &mut Vec<String>) -> Result<String, String> {
    let names: Vec<String> = match &args["names"] {
        Value::Array(items) => items.iter().filter_map(|v| v.as_str()).map(|s| s.trim().to_string()).collect(),
        Value::String(one) => vec![one.trim().to_string()],
        _ => Vec::new(),
    };
    if names.is_empty() {
        return Err("Pass `names`: the tools to load, exactly as listed in this tool's description.".into());
    }
    let (mut ready, mut unknown) = (Vec::new(), Vec::new());
    for name in names {
        // A name without its connector prefix still finds its tool when that's unambiguous.
        let found = if names_known.contains(&name.as_str()) {
            Some(name.clone())
        } else {
            let mut matches = names_known.iter().filter(|key| key.ends_with(&format!("_{name}")));
            match (matches.next(), matches.next()) {
                (Some(only), None) => Some(only.to_string()),
                _ => None,
            }
        };
        match found {
            Some(name) => {
                if !loaded.contains(&name) {
                    loaded.push(name.clone());
                }
                ready.push(name);
            }
            None => unknown.push(name),
        }
    }
    if ready.is_empty() {
        return Err(format!("None of these are connector tools: {}. Use the names listed in this tool's description.", unknown.join(", ")));
    }
    let mut text = format!("Loaded: {}. Call them now.", ready.join(", "));
    if !unknown.is_empty() {
        text.push_str(&format!(" Not found: {}.", unknown.join(", ")));
    }
    Ok(text)
}

/// The tools for the next step: the fixed ones, the catalog, then what's loaded.
pub fn specs(base: &[ToolSpec], tools: &[HubTool], hub: &HashMap<String, &HubTool>, loaded: &[String]) -> Vec<ToolSpec> {
    let mut specs = base.to_vec();
    specs.push(spec(tools));
    specs.extend(loaded.iter().filter_map(|name| hub.get(name)).map(|tool| spec_of(tool)));
    specs
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_description_becomes_its_first_sentence() {
        assert_eq!(gist("Create a design. It takes a while."), "Create a design.");
        assert_eq!(gist("Search\n  designs"), "Search designs");
        let long = "x".repeat(300);
        assert_eq!(gist(&long).chars().count(), LINE_CHARS);
    }

    #[test]
    fn what_was_used_is_loaded_again_in_order() {
        use super::super::wire::ToolCall;
        let call = |id: &str, name: &str| ToolCall { id: id.into(), name: name.into(), args: json!({}) };
        let msgs = vec![
            Msg::Assistant { text: String::new(), tool_calls: vec![call("1", "b_x")] },
            Msg::Assistant { text: String::new(), tool_calls: vec![call("2", "read_file"), call("3", "a_y"), call("4", "b_x")] },
        ];
        let used = used_in(&msgs, |name| name == "a_y" || name == "b_x");
        assert_eq!(used, vec!["b_x", "a_y"]);
    }

    #[test]
    fn loading_takes_full_or_short_names_and_reports_the_rest() {
        let known = ["crm_find_customer", "crm_create_invoice", "docs_find_customer"];
        let mut loaded = vec!["crm_create_invoice".to_string()];
        let text = load(&json!({"names": ["crm_find_customer", "create_invoice", "nope"]}), &known, &mut loaded).unwrap();
        assert!(text.contains("Not found: nope"), "{text}");
        assert_eq!(loaded, vec!["crm_create_invoice", "crm_find_customer"]);
        // Ambiguous short names aren't guessed.
        assert!(load(&json!({"names": ["find_customer"]}), &known, &mut loaded).is_err());
        assert!(load(&json!({}), &known, &mut loaded).is_err());
    }
}
