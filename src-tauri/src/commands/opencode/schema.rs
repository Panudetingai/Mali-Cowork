//! Tool input schemas that a model provider will not accept.
//!
//! Anthropic — and every provider routing to it — answers a request whose
//! tools contain a self-referencing schema with
//! `[invalid_request_error] Recursive JSON schemas are not currently
//! supported`, and refuses the *whole* request. One such tool on an MCP
//! server therefore breaks every prompt in the chat, not just the calls that
//! would have used it, which reads like "the MCP server broke my chat".
//!
//! Recursion shows up two ways: a `$ref` pointing at the schema root or at one
//! of the ref's own ancestors (a tree whose children are the same node), and a
//! cycle between named definitions in `$defs` / `definitions`.

use std::collections::{HashMap, HashSet};

use serde_json::Value;

/// Does this tool's schema describe itself in terms of itself?
pub fn is_recursive(schema: &Value) -> bool {
    ref_to_ancestor(schema, &mut Vec::new()) || defs_cycle(schema)
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
}
