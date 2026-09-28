//! Document templates for Settings → Templates: the built-in Thai ones and
//! the user's own (see `crate::templates`).

use std::path::PathBuf;

use serde::Serialize;

use crate::templates::{self, library, TemplateInfo};

#[tauri::command]
pub fn templates_list() -> Vec<TemplateInfo> {
    templates::list_all()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Inspection {
    pub fields: Vec<String>,
    /// The start of the document's text, to show what was picked.
    pub preview: String,
    pub suggested_name: String,
}

/// What a `.docx` would give as a template, before adding it.
#[tauri::command]
pub fn templates_inspect(path: String) -> Result<Inspection, String> {
    let path = PathBuf::from(path);
    let bytes = library::read_source(&path)?;
    let (fields, text) = library::inspect(&bytes)?;
    let preview: String = text.chars().take(1_200).collect();
    let suggested_name = path.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
    Ok(Inspection { fields, preview, suggested_name })
}

#[tauri::command]
pub fn templates_add(path: String, name: String, description: String) -> Result<library::UserTemplate, String> {
    let bytes = library::read_source(&PathBuf::from(path))?;
    library::add(&bytes, &name, &description)
}

#[tauri::command]
pub fn templates_update(
    id: String,
    name: Option<String>,
    description: Option<String>,
    enabled: Option<bool>,
) -> Result<library::UserTemplate, String> {
    library::update(&id, name.as_deref(), description.as_deref(), enabled)
}

/// Read a template's fields again after the user edited it in Word.
#[tauri::command]
pub fn templates_refresh(id: String) -> Result<library::UserTemplate, String> {
    library::refresh(&id)
}

#[tauri::command]
pub fn templates_remove(id: String) -> Result<(), String> {
    library::remove(&id)
}

/// Save a copy of a template where the user chose (Settings → Save a copy).
#[tauri::command]
pub fn templates_export(id: String, path: String) -> Result<(), String> {
    let path = PathBuf::from(path);
    if !path.extension().is_some_and(|e| e.eq_ignore_ascii_case("docx")) {
        return Err("Save it as a .docx file.".into());
    }
    let bytes = match templates::find_builtin(&id) {
        Some(t) => t.bytes(),
        None => library::bytes_of(&id)?,
    };
    std::fs::write(&path, bytes).map_err(|e| format!("Can't save {}: {e}", path.display()))
}

/// Open the user's template in Word (or whatever opens .docx), to change its look.
#[tauri::command]
pub fn templates_open(app: tauri::AppHandle, id: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    library::bytes_of(&id)?; // checks the id and that the file is there
    app.opener()
        .open_path(library::file_of(&id).to_string_lossy(), None::<&str>)
        .map_err(|e| format!("Couldn't open it: {e}"))
}
