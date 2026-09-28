//! The document tools — list, read, fill, save and make templates — shared by
//! Mali's own agent and the `mali` gateway, so every model gets them: an API
//! model on Mali's agent, and every CLI agent (OpenCode, Codex, Cursor,
//! Antigravity) through the gateway.
//!
//! A call is planned first (read, fill, compute) and carried out second, so
//! Mali's agent can show its approval card in between; the gateway carries it
//! out directly, as the CLI already asked its own user.

use std::path::{Path, PathBuf};

use serde_json::{json, Value};

use super::{docx, library};
use crate::agent::paths::Scope;
use crate::agent::wire::ToolSpec;

pub const NAMES: [&str; 5] = ["list_templates", "read_document", "fill_template", "save_template", "make_template"];

pub fn is_template_tool(name: &str) -> bool {
    NAMES.contains(&name)
}

const MAX_BYTES: u64 = 20 * 1024 * 1024;
const MAX_TEXT: usize = 30_000;

pub fn specs() -> Vec<ToolSpec> {
    vec![
        ToolSpec {
            name: "list_templates".into(),
            description: "List the document templates: built-in Thai ones (quotation, invoice, official letter, meeting minutes) and the user's own, with the fields each needs.".into(),
            schema: json!({ "type": "object", "properties": {} }),
        },
        ToolSpec {
            name: "read_document".into(),
            description: "Read a Word (.docx) file as text — paragraphs and tables — and list the {{fields}} it has if it's a template.".into(),
            schema: json!({
                "type": "object",
                "properties": { "path": { "type": "string", "description": "The .docx, relative to the working folder or absolute." } },
                "required": ["path"]
            }),
        },
        ToolSpec {
            name: "fill_template".into(),
            description: "Create a .docx from a template: a name or id from list_templates, or the path of a .docx with {{fields}}. Keeps the template's exact layout and Thai font. Quotations and invoices compute amounts, VAT 7% and the total in Thai words — don't calculate them yourself.".into(),
            schema: json!({
                "type": "object",
                "properties": {
                    "template": { "type": "string", "description": "Template id or name, e.g. \"quotation\", or a .docx path." },
                    "output": { "type": "string", "description": "Where to save the new .docx in the working folder, e.g. \"ใบเสนอราคา-QT-001.docx\"." },
                    "values": { "type": "object", "description": "Field values by name (without the ? of optional fields)." },
                    "items": { "type": "array", "items": { "type": "object" }, "description": "Table rows, e.g. [{\"description\": \"…\", \"qty\": 2, \"unit\": \"ชิ้น\", \"unit_price\": 150}]." },
                    "vat": { "type": "string", "description": "\"add\" (default, 7%) or \"none\"." }
                },
                "required": ["template", "output"]
            }),
        },
        ToolSpec {
            name: "save_template".into(),
            description: "Save a template as a blank .docx in the folder, so the user can change its look in Word (logo, colours) and use it with fill_template.".into(),
            schema: json!({
                "type": "object",
                "properties": { "template": { "type": "string" }, "output": { "type": "string" } },
                "required": ["template", "output"]
            }),
        },
        ToolSpec {
            name: "make_template".into(),
            description: "Turn a document into a reusable template: each piece of sample text you name becomes a {{field}} (e.g. the customer's name → {{customer_name}}, the total → {{total}}). Show the user which parts you'll turn into fields and get their OK first. save_to_library keeps it in the user's template library for every folder; otherwise it's saved as `output` in this folder.".into(),
            schema: json!({
                "type": "object",
                "properties": {
                    "source": { "type": "string", "description": "The .docx to start from." },
                    "fields": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "text": { "type": "string", "description": "Exact text in the document, as read_document shows it." },
                                "field": { "type": "string", "description": "Field name: letters, digits, _ (prefix ? for optional). For table rows use item.<name>." }
                            },
                            "required": ["text", "field"]
                        }
                    },
                    "save_to_library": { "type": "boolean" },
                    "name": { "type": "string", "description": "The template's name in the library." },
                    "description": { "type": "string", "description": "When to use it." },
                    "output": { "type": "string", "description": "Where to save it in the folder when not saving to the library." }
                },
                "required": ["source", "fields"]
            }),
        },
    ]
}

/// What a call comes to, before anything is written.
pub enum Plan {
    /// Nothing to write: the answer for the model.
    Text(String),
    /// A new `.docx` in the folder.
    Write { path: PathBuf, bytes: Vec<u8>, title: String, preview: String, report: String },
    /// A template for the user's library.
    Library { bytes: Vec<u8>, name: String, description: String, title: String, preview: String, report: String },
}

fn str_arg<'a>(args: &'a Value, key: &str) -> Option<&'a str> {
    args.get(key).and_then(Value::as_str)
}

fn clip(text: &str, max: usize) -> String {
    if text.chars().count() <= max {
        return text.to_string();
    }
    format!("{}…", text.chars().take(max).collect::<String>())
}

fn docx_bytes(path: &Path) -> Result<Vec<u8>, String> {
    let meta = std::fs::metadata(path).map_err(|e| format!("Can't read {}: {e}", path.display()))?;
    if meta.len() > MAX_BYTES {
        return Err(format!("{} is larger than 20 MB.", path.display()));
    }
    std::fs::read(path).map_err(|e| format!("Can't read {}: {e}", path.display()))
}

fn output(args: &Value, scope: &Scope) -> Result<PathBuf, String> {
    let raw = str_arg(args, "output").map(str::trim).filter(|o| !o.is_empty()).ok_or("Say where to save the new document.")?;
    let raw = if raw.to_ascii_lowercase().ends_with(".docx") { raw.to_string() } else { format!("{raw}.docx") };
    scope.resolve(&raw, true)
}

/// A template's bytes, whether it computes money, and what to call it.
fn source(args: &Value, scope: &Scope) -> Result<(Vec<u8>, bool, String), String> {
    let name = str_arg(args, "template").map(str::trim).filter(|t| !t.is_empty()).ok_or("Say which template to use.")?;
    if let Some(found) = super::resolve(name) {
        let money = match found.money {
            Some(money) => money,
            None => super::money_for(&docx::placeholders(&found.bytes)?, &args["items"]),
        };
        return Ok((found.bytes, money, found.name));
    }
    let path = scope.resolve(name, false).map_err(|e| format!("{e} (templates by name: see list_templates)"))?;
    let bytes = docx_bytes(&path)?;
    let fields = docx::placeholders(&bytes)?;
    Ok((bytes, super::money_for(&fields, &args["items"]), scope.show(&path)))
}

fn valid_field(name: &str) -> bool {
    let name = name.trim_start_matches('?');
    !name.is_empty() && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '.' || c == '-')
}

/// Work out a call: read, fill and compute, but write nothing yet.
pub fn plan(name: &str, args: &Value, scope: &Scope) -> Result<Plan, String> {
    match name {
        "list_templates" => Ok(Plan::Text(super::describe_catalog())),
        "read_document" => {
            let path = scope.resolve(str_arg(args, "path").unwrap_or_default(), false)?;
            let bytes = docx_bytes(&path)?;
            let mut text = clip(&docx::read_text(&bytes)?, MAX_TEXT);
            let fields = docx::placeholders(&bytes)?;
            if !fields.is_empty() {
                text.push_str(&format!("\n\nTemplate fields: {}", fields.join(", ")));
            }
            Ok(Plan::Text(text))
        }
        "fill_template" => {
            let (template, money, label) = source(args, scope)?;
            let path = output(args, scope)?;
            let prepared = super::prepare(money, &args["values"], &args["items"], str_arg(args, "vat"))?;
            let (bytes, missing) = docx::fill(&template, &prepared.values, &prepared.items, super::BLANK)?;
            let shown = scope.show(&path);
            let preview = clip(&docx::read_text(&bytes).unwrap_or_default(), 4_000);
            let mut report = format!("Created {shown} from {label}.");
            for line in &prepared.summary {
                report.push_str(&format!("\n{line}"));
            }
            if !missing.is_empty() {
                report.push_str(&format!(
                    "\nNo value for: {} — shown as {} in the document. Ask the user for them, then fill the template again.",
                    missing.join(", "),
                    super::BLANK
                ));
            }
            Ok(Plan::Write { title: format!("Create: {shown}"), path, bytes, preview, report })
        }
        "save_template" => {
            let wanted = str_arg(args, "template").unwrap_or_default();
            let found = super::resolve(wanted).ok_or_else(|| format!("There's no template called {wanted} (see list_templates)."))?;
            let path = output(args, scope)?;
            let shown = scope.show(&path);
            Ok(Plan::Write {
                title: format!("Create: {shown}"),
                preview: format!("Blank {} template", found.name),
                report: format!(
                    "Saved the blank {} template as {shown}. The user can change its look in Word; keep the {{{{fields}}}} as they are, then use it with fill_template (or make_template with save_to_library to keep it).",
                    found.name
                ),
                bytes: found.bytes,
                path,
            })
        }
        "make_template" => {
            let from = scope.resolve(str_arg(args, "source").unwrap_or_default(), false)?;
            let original = docx_bytes(&from)?;
            let pairs: Vec<(String, String)> = args["fields"]
                .as_array()
                .ok_or("List the fields: [{\"text\": \"…\", \"field\": \"…\"}].")?
                .iter()
                .filter_map(|f| Some((f["text"].as_str()?.to_string(), f["field"].as_str()?.trim().to_string())))
                .collect();
            if let Some((_, bad)) = pairs.iter().find(|(_, field)| !valid_field(field)) {
                return Err(format!("“{bad}” isn't a usable field name: letters, digits and _ only."));
            }
            let (bytes, counts) = docx::replace_text(&original, &pairs)?;
            let fields = docx::placeholders(&bytes)?;
            if fields.is_empty() {
                return Err("None of that text was found in the document, so nothing became a field. Copy it exactly as read_document shows it.".into());
            }
            let not_found: Vec<&str> = pairs.iter().zip(&counts).filter(|(_, n)| **n == 0).map(|((t, _), _)| t.as_str()).collect();
            let mut report = format!("Fields: {}", fields.join(", "));
            if !not_found.is_empty() {
                report.push_str(&format!("\nNot found in the document (left as they were): {}", not_found.join(" · ")));
            }
            if args["save_to_library"].as_bool() == Some(true) {
                let name = str_arg(args, "name").map(str::trim).filter(|n| !n.is_empty()).ok_or("Give the template a name.")?.to_string();
                Ok(Plan::Library {
                    title: format!("Create: template {name}"),
                    preview: format!("Template “{name}” with fields: {}", fields.join(", ")),
                    description: str_arg(args, "description").unwrap_or_default().to_string(),
                    bytes,
                    name,
                    report,
                })
            } else {
                let path = output(args, scope)?;
                let shown = scope.show(&path);
                Ok(Plan::Write {
                    title: format!("Create: {shown}"),
                    preview: format!("Fields: {}", fields.join(", ")),
                    report: format!("Saved the template as {shown}.\n{report}"),
                    bytes,
                    path,
                })
            }
        }
        other => Err(format!("There is no tool named {other}.")),
    }
}

/// Carry a plan out; the text for the model.
pub fn execute(plan: Plan) -> Result<String, String> {
    match plan {
        Plan::Text(text) => Ok(text),
        Plan::Write { path, bytes, report, .. } => {
            if let Some(parent) = path.parent() {
                std::fs::create_dir_all(parent).map_err(|e| format!("Can't create {}: {e}", parent.display()))?;
            }
            std::fs::write(&path, bytes).map_err(|e| format!("Can't write {}: {e}", path.display()))?;
            Ok(report)
        }
        Plan::Library { bytes, name, description, report, .. } => {
            let saved = library::add(&bytes, &name, &description)?;
            Ok(format!(
                "Added “{}” to the user's templates ({}); it's also a / command in the chat box now. Fill it with fill_template using that name.\n{report}",
                saved.name, saved.id
            ))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plans_then_writes_a_quotation() {
        let dir = std::env::temp_dir().join(format!("mali-ttools-{}", uuid::Uuid::new_v4().simple()));
        std::fs::create_dir_all(&dir).unwrap();
        let scope = Scope::new(dir.to_str().unwrap(), &[]).unwrap();
        let args = json!({
            "template": "quotation", "output": "qt",
            "values": { "company_name": "ร้าน", "company_address": "กทม.", "doc_no": "1", "customer_name": "เอ" },
            "items": [{ "description": "กาแฟ", "qty": 1, "unit_price": 100 }]
        });
        let planned = plan("fill_template", &args, &scope).unwrap();
        assert!(!dir.join("qt.docx").exists(), "planning writes nothing");
        let report = execute(planned).unwrap();
        assert!(report.contains("107.00"), "{report}");
        assert!(dir.join("qt.docx").exists());
        assert!(plan("fill_template", &json!({ "template": "quotation", "output": "/etc/x" }), &scope).is_err());
        let _ = std::fs::remove_dir_all(dir);
    }
}
