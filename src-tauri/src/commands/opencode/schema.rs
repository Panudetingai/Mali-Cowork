//! Tool input schemas that a model provider will not accept.
//!
//! Providers validate the *whole* tool list before they read the prompt, so
//! one schema they dislike — on a connector the chat was never going to use —
//! fails every prompt in that chat. It reads like "the MCP server broke my
//! chat", and no amount of rewording the prompt helps.
//!
//! There are two layers to this, because opencode only tells us about half of
//! the tools it offers:
//!
//! 1. The agent's own tools come back from `/experimental/tool` with their
//!    schemas, so the ones a provider would refuse are named here and left out
//!    before the prompt is sent (`unsupported`, used by `unusable_tools`).
//! 2. An MCP server's tools are *not* in that list, so nothing can be checked
//!    ahead of time. There the rejection is recognised after the fact
//!    (`is_tool_list_rejection`) and the prompt is sent again without the
//!    connector tools.
//!
//! Two shapes are known, each from a different provider:
//!
//! - **Recursive** (Anthropic, and anything routing to it):
//!   `[invalid_request_error] Recursive JSON schemas are not currently
//!   supported`. Recursion shows up as a `$ref` pointing at the schema root or
//!   at one of the ref's own ancestors (a tree whose children are the same
//!   node), or as a cycle between named `$defs` / `definitions`.
//! - **Empty choice** (Google): `…properties[link].any_of[0].enum[0]: cannot
//!   be empty`. An `enum` holding `""` is an ordinary way to say "or nothing"
//!   and every other provider takes it, so this one is only applied to
//!   requests that end up at Google.

use std::collections::{HashMap, HashSet};

use serde_json::Value;

/// Why a provider would turn down the request this tool is offered in.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Unsupported {
    /// The schema describes itself in terms of itself.
    Recursive,
    /// An `enum` with an empty (or no) choice in it.
    EmptyChoice,
}

impl Unsupported {
    /// What to tell the user, as the end of "… left out: {}".
    pub fn explanation(self) -> &'static str {
        match self {
            Unsupported::Recursive => "the model's provider rejects schemas that refer to themselves",
            Unsupported::EmptyChoice => "Google rejects a tool that offers an empty choice",
        }
    }

    pub fn detail(self) -> &'static str {
        match self {
            Unsupported::Recursive => {
                "These tools describe themselves in terms of themselves, which this provider \
                 answers with \"Recursive JSON schemas are not currently supported\" — and it \
                 turns down the whole request, not just the tool."
            }
            Unsupported::EmptyChoice => {
                "These tools offer a setting whose list of choices includes an empty one, which \
                 Gemini answers with \"enum[0]: cannot be empty\" — and it turns down the whole \
                 request, not just the tool. They work on other providers, so picking a \
                 non-Google model brings them back."
            }
        }
    }
}

/// Whether this request ends at Google's API, whoever it is booked through:
/// the Gemini provider itself, Vertex, or a Gemini model resold by OpenCode
/// Zen or OpenRouter.
pub fn goes_to_google(provider_id: &str, model_id: &str) -> bool {
    provider_id.starts_with("google")
        || provider_id.starts_with("vertex")
        || model_id.to_ascii_lowercase().contains("gemini")
}

/// Did the provider turn down the *tool list* rather than the message?
///
/// The checks above only reach the agent's own tools: opencode's
/// `/experimental/tool` does not report the tools of a connected MCP server,
/// so a schema a provider dislikes on a connector cannot be spotted before
/// the prompt is sent. It comes back as a validation error naming a field by
/// index — `function_declarations[26]…` — which says nothing about which
/// connector to switch off, and the message is never answered.
///
/// Recognising it lets the prompt be sent again without the connector tools
/// (see `run_prompt`), which is the difference between a chat that works
/// without one connector and a chat that answers nothing at all.
pub fn is_tool_list_rejection(message: &str) -> bool {
    let lower = message.to_ascii_lowercase();
    // Google names the request field it could not accept.
    lower.contains("generatecontentrequest.tools")
        || (lower.contains("function_declarations") && lower.contains("parameters"))
        // Anthropic, and anything routing to it.
        || lower.contains("recursive json schemas")
        // Our own wording, in case the raw text was too long to keep.
        || lower.contains("turned down the tool list")
}

/// Why this tool's schema would be turned down, if it would be.
pub fn unsupported(schema: &Value, google: bool) -> Option<Unsupported> {
    if is_recursive(schema) {
        return Some(Unsupported::Recursive);
    }
    if google && has_empty_choice(schema) {
        return Some(Unsupported::EmptyChoice);
    }
    None
}

/// Does this tool's schema describe itself in terms of itself?
pub fn is_recursive(schema: &Value) -> bool {
    ref_to_ancestor(schema, &mut Vec::new()) || defs_cycle(schema)
}

/// An `enum` anywhere in the schema with an empty string in it, or with
/// nothing in it at all — both are "cannot be empty" to Google.
fn has_empty_choice(node: &Value) -> bool {
    match node {
        Value::Object(fields) => {
            if let Some(choices) = fields.get("enum").and_then(Value::as_array) {
                let empty = choices.is_empty()
                    || choices.iter().any(|choice| match choice {
                        Value::String(text) => text.is_empty(),
                        Value::Null => true,
                        _ => false,
                    });
                if empty {
                    return true;
                }
            }
            // `const: ""` is the same statement in one value.
            if fields.get("const").and_then(Value::as_str) == Some("") {
                return true;
            }
            fields
                .iter()
                .any(|(key, value)| key != "enum" && key != "const" && has_empty_choice(value))
        }
        Value::Array(items) => items.iter().any(has_empty_choice),
        _ => false,
    }
}

/// A `$ref` whose target contains the `$ref` itself.
fn ref_to_ancestor(node: &Value, path: &mut Vec<String>) -> bool {
    match node {
        Value::Object(fields) => {
            if let Some(target) = fields.get("$ref").and_then(Value::as_str) {
                if let Some(pointer) = target.strip_prefix('#') {
                    // `#` alone is the whole schema; anything else is a path
                    // into it, and a ref sitting inside its own target repeats
                    // for ever.
                    let here = format!("/{}", path.join("/"));
                    if pointer.is_empty() || here.starts_with(pointer) {
                        return true;
                    }
                }
            }
            fields.iter().any(|(key, value)| {
                path.push(key.clone());
                let found = ref_to_ancestor(value, path);
                path.pop();
                found
            })
        }
        Value::Array(items) => items.iter().enumerate().any(|(index, value)| {
            path.push(index.to_string());
            let found = ref_to_ancestor(value, path);
            path.pop();
            found
        }),
        _ => false,
    }
}

/// `$defs` entries that reach themselves, directly or through each other.
fn defs_cycle(schema: &Value) -> bool {
    let mut edges: HashMap<String, HashSet<String>> = HashMap::new();
    collect_defs(schema, &mut edges);
    edges.keys().any(|name| reaches(name, name, &edges, &mut HashSet::new()))
}

fn collect_defs(node: &Value, edges: &mut HashMap<String, HashSet<String>>) {
    match node {
        Value::Object(fields) => {
            for key in ["$defs", "definitions"] {
                for (name, body) in fields.get(key).and_then(Value::as_object).into_iter().flatten() {
                    let mut names = HashSet::new();
                    named_refs(body, &mut names);
                    edges.entry(name.clone()).or_default().extend(names);
                }
            }
            for value in fields.values() {
                collect_defs(value, edges);
            }
        }
        Value::Array(items) => items.iter().for_each(|value| collect_defs(value, edges)),
        _ => {}
    }
}

/// The definition names a schema refers to, by the last segment of each `$ref`.
fn named_refs(node: &Value, out: &mut HashSet<String>) {
    match node {
        Value::Object(fields) => {
            if let Some(target) = fields.get("$ref").and_then(Value::as_str) {
                if let Some(name) = target.rsplit('/').next() {
                    out.insert(name.to_string());
                }
            }
            fields.values().for_each(|value| named_refs(value, out));
        }
        Value::Array(items) => items.iter().for_each(|value| named_refs(value, out)),
        _ => {}
    }
}

fn reaches(
    from: &str,
    goal: &str,
    edges: &HashMap<String, HashSet<String>>,
    seen: &mut HashSet<String>,
) -> bool {
    for next in edges.get(from).into_iter().flatten() {
        if next == goal {
            return true;
        }
        if seen.insert(next.clone()) && reaches(next, goal, edges, seen) {
            return true;
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn a_tree_whose_children_are_the_same_node_is_recursive() {
        // The shape Rive's `layout_editor` sends: `tree` contains itself.
        let schema = json!({
            "type": "object",
            "properties": {
                "data": { "properties": { "createLayout": { "properties": {
                    "tree": {
                        "type": "object",
                        "properties": {
                            "name": { "type": "string" },
                            "children": {
                                "type": "array",
                                "items": { "$ref": "#/properties/data/properties/createLayout/properties/tree" }
                            }
                        }
                    }
                }}}}
            }
        });
        assert!(is_recursive(&schema));
    }

    #[test]
    fn definitions_that_reach_themselves_are_recursive() {
        let direct = json!({
            "$defs": { "node": { "properties": { "child": { "$ref": "#/$defs/node" } } } },
            "properties": { "root": { "$ref": "#/$defs/node" } }
        });
        assert!(is_recursive(&direct));

        let indirect = json!({
            "$defs": {
                "a": { "properties": { "b": { "$ref": "#/$defs/b" } } },
                "b": { "properties": { "a": { "$ref": "#/$defs/a" } } }
            }
        });
        assert!(is_recursive(&indirect));
    }

    #[test]
    fn a_ref_to_the_whole_schema_is_recursive() {
        assert!(is_recursive(&json!({ "properties": { "self": { "$ref": "#" } } })));
    }

    #[test]
    fn ordinary_schemas_are_left_alone() {
        let plain = json!({
            "type": "object",
            "properties": {
                "path": { "type": "string" },
                "lines": { "type": "array", "items": { "type": "string" } },
                "mode": { "enum": ["read", "write"] }
            },
            "required": ["path"]
        });
        assert!(!is_recursive(&plain));

        // Shared definitions are fine as long as nothing loops back.
        let shared = json!({
            "$defs": { "point": { "properties": { "x": { "type": "number" } } } },
            "properties": {
                "from": { "$ref": "#/$defs/point" },
                "to": { "$ref": "#/$defs/point" }
            }
        });
        assert!(!is_recursive(&shared));

        // A sibling reference is not an ancestor reference.
        let sibling = json!({
            "properties": {
                "a": { "type": "string" },
                "b": { "$ref": "#/properties/a" }
            }
        });
        assert!(!is_recursive(&sibling));
    }

    /// The shape behind `…properties[link].any_of[0].enum[0]: cannot be
    /// empty`: "a link, or nothing", written as an enum of one empty string.
    #[test]
    fn an_empty_choice_is_found_however_deep_it_sits() {
        let schema = json!({
            "type": "object",
            "properties": {
                "operations": { "type": "array", "items": { "anyOf": [
                    { "properties": { "text": { "type": "string" } } },
                    { "properties": { "formatting": { "properties": {
                        "link": { "anyOf": [{ "enum": [""] }, { "type": "string" }] }
                    } } } }
                ] } }
            }
        });
        assert_eq!(unsupported(&schema, true), Some(Unsupported::EmptyChoice));
        // Only Google minds; the tool stays available everywhere else.
        assert_eq!(unsupported(&schema, false), None);
    }

    #[test]
    fn the_other_ways_of_writing_no_choice_count_too() {
        for schema in [
            json!({ "properties": { "a": { "enum": [] } } }),
            json!({ "properties": { "a": { "enum": ["x", ""] } } }),
            json!({ "properties": { "a": { "enum": [null] } } }),
            json!({ "properties": { "a": { "const": "" } } }),
        ] {
            assert_eq!(unsupported(&schema, true), Some(Unsupported::EmptyChoice), "{schema}");
        }
    }

    #[test]
    fn ordinary_choices_are_left_alone_on_google_too() {
        let plain = json!({
            "properties": {
                "mode": { "enum": ["read", "write"] },
                "level": { "enum": [1, 2, 3] },
                "kind": { "const": "image" },
                // A property actually named "enum" is a value, not a choice list.
                "settings": { "properties": { "enum": { "type": "string" } } }
            }
        });
        assert_eq!(unsupported(&plain, true), None);
    }

    /// Recursion breaks Anthropic, so it is left out whoever is answering.
    #[test]
    fn recursion_outranks_the_provider() {
        let schema = json!({ "properties": { "self": { "$ref": "#" } } });
        assert_eq!(unsupported(&schema, false), Some(Unsupported::Recursive));
        assert_eq!(unsupported(&schema, true), Some(Unsupported::Recursive));
    }

    #[test]
    fn the_rejections_worth_retrying_without_connectors_are_recognised() {
        for message in [
            "* GenerateContentRequest.tools[0].function_declarations[26].parameters\
              .properties[operations].items.any_of[8].properties[formatting]\
              .properties[link].any_of[0].enum[0]: cannot be empty",
            "[invalid_request_error] Recursive JSON schemas are not currently supported",
            "Gemini turned down the tool list from a connected MCP server",
        ] {
            assert!(is_tool_list_rejection(message), "{message}");
        }
        // An ordinary failure must not cost the user their connectors.
        for message in [
            "rate limit exceeded",
            "401 Unauthorized",
            "The model produced an invalid tool call",
            "",
        ] {
            assert!(!is_tool_list_rejection(message), "{message}");
        }
    }

    #[test]
    fn gemini_is_spotted_whoever_it_is_booked_through() {
        assert!(goes_to_google("google", "gemini-3-pro"));
        assert!(goes_to_google("google-vertex", "anything"));
        assert!(goes_to_google("opencode", "gemini-3.1-pro"));
        assert!(goes_to_google("openrouter", "google/gemini-3-flash"));
        assert!(!goes_to_google("anthropic", "claude-opus-5"));
        assert!(!goes_to_google("openai", "gpt-5.2"));
        assert!(!goes_to_google("groq", "openai/gpt-oss-120b"));
    }
}
