//! The user's own templates: `.docx` files with `{{fields}}`, kept in Mali's
//! folder so they work from any working folder, listed next to the built-in
//! ones and filled the same way.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use super::docx;
use crate::commands::secure_fs::write_private;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserTemplate {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: String,
    /// The `{{fields}}` found in the file, in order.
    #[serde(default)]
    pub fields: Vec<String>,
    #[serde(default = "yes")]
    pub enabled: bool,
    /// Unix seconds.
    #[serde(default)]
    pub added_at: u64,
}

fn yes() -> bool {
    true
}

/// Largest template accepted (pictures in a letterhead add up).
const MAX_BYTES: u64 = 20 * 1024 * 1024;

fn root() -> PathBuf {
    // Tests keep their templates away from the user's.
    if let Some(dir) = std::env::var_os("MALI_TEMPLATES_DIR") {
        return PathBuf::from(dir);
    }
    dirs::data_local_dir().unwrap_or_else(std::env::temp_dir).join("mali-cowork").join("templates")
}

fn index_path() -> PathBuf {
    root().join("index.json")
}

pub fn file_of(id: &str) -> PathBuf {
    root().join(format!("{id}.docx"))
}

pub fn load() -> Vec<UserTemplate> {
    std::fs::read_to_string(index_path())
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

fn save(list: &[UserTemplate]) -> Result<(), String> {
    std::fs::create_dir_all(root()).map_err(|e| format!("Can't create the templates folder: {e}"))?;
    write_private(&index_path(), &serde_json::to_string_pretty(list).map_err(|e| e.to_string())?)
}

fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 64 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
}

fn now() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

/// Read a `.docx` the user wants to add: its fields, and a preview of its text.
pub fn inspect(bytes: &[u8]) -> Result<(Vec<String>, String), String> {
    let fields = docx::placeholders(bytes)?;
    let text = docx::read_text(bytes)?;
    Ok((fields, text))
}

pub fn read_source(path: &Path) -> Result<Vec<u8>, String> {
    let meta = std::fs::metadata(path).map_err(|e| format!("Can't read {}: {e}", path.display()))?;
    if meta.len() > MAX_BYTES {
        return Err("That file is larger than 20 MB.".into());
    }
    if !path.extension().is_some_and(|e| e.eq_ignore_ascii_case("docx")) {
        return Err("Templates are Word files (.docx).".into());
    }
    std::fs::read(path).map_err(|e| format!("Can't read {}: {e}", path.display()))
}

/// Add a template from a `.docx`'s bytes.
pub fn add(bytes: &[u8], name: &str, description: &str) -> Result<UserTemplate, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("Give the template a name.".into());
    }
    let (fields, _) = inspect(bytes)?;
    let mut list = load();
    if super::find_builtin(name).is_some() || list.iter().any(|t| t.name == name) {
        return Err(format!("There's already a template called “{name}”. Pick another name."));
    }
    let id = format!("user-{}", &uuid::Uuid::new_v4().simple().to_string()[..12]);
    std::fs::create_dir_all(root()).map_err(|e| format!("Can't create the templates folder: {e}"))?;
    std::fs::write(file_of(&id), bytes).map_err(|e| format!("Can't save the template: {e}"))?;
    let template = UserTemplate {
        id,
        name: name.to_string(),
        description: description.trim().to_string(),
        fields,
        enabled: true,
        added_at: now(),
    };
    list.push(template.clone());
    save(&list)?;
    Ok(template)
}

pub fn update(id: &str, name: Option<&str>, description: Option<&str>, enabled: Option<bool>) -> Result<UserTemplate, String> {
    let mut list = load();
    if let Some(new_name) = name.map(str::trim).filter(|n| !n.is_empty()) {
        if super::find_builtin(new_name).is_some() || list.iter().any(|t| t.name == new_name && t.id != id) {
            return Err(format!("There's already a template called “{new_name}”."));
        }
    }
    let template = list.iter_mut().find(|t| t.id == id).ok_or("That template isn't there any more.")?;
    if let Some(n) = name.map(str::trim).filter(|n| !n.is_empty()) {
        template.name = n.to_string();
    }
    if let Some(d) = description {
        template.description = d.trim().to_string();
    }
    if let Some(e) = enabled {
        template.enabled = e;
    }
    let updated = template.clone();
    save(&list)?;
    Ok(updated)
}

/// Read the fields again, after the user changed the file in Word.
pub fn refresh(id: &str) -> Result<UserTemplate, String> {
    let bytes = bytes_of(id)?;
    let (fields, _) = inspect(&bytes)?;
    let mut list = load();
    let template = list.iter_mut().find(|t| t.id == id).ok_or("That template isn't there any more.")?;
    template.fields = fields;
    let updated = template.clone();
    save(&list)?;
    Ok(updated)
}

pub fn remove(id: &str) -> Result<(), String> {
    if !valid_id(id) {
        return Err("Unknown template.".into());
    }
    let mut list = load();
    list.retain(|t| t.id != id);
    save(&list)?;
    let _ = std::fs::remove_file(file_of(id));
    Ok(())
}

pub fn bytes_of(id: &str) -> Result<Vec<u8>, String> {
    if !valid_id(id) {
        return Err("Unknown template.".into());
    }
    std::fs::read(file_of(id)).map_err(|_| "The template's file is missing; add it again.".to_string())
}

/// A switched-on template by id or name.
pub fn find(name_or_id: &str) -> Option<UserTemplate> {
    let key = name_or_id.trim().trim_end_matches(".docx");
    load().into_iter().find(|t| t.enabled && (t.id == key || t.name == key))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids_never_reach_outside_the_folder() {
        assert!(valid_id("user-abc123"));
        assert!(!valid_id("../x"));
        assert!(bytes_of("../../etc/passwd").is_err());
    }

    #[test]
    fn a_template_is_added_found_renamed_switched_off_and_removed() {
        let dir = std::env::temp_dir().join(format!("mali-lib-{}", uuid::Uuid::new_v4().simple()));
        std::env::set_var("MALI_TEMPLATES_DIR", &dir);
        let doc = docx::build(&[docx::Block::Para(docx::Para::new("เรียน {{customer_name}} ยอด {{total}}"))]);

        let added = add(&doc, "ใบเสนอราคา ร้านเรา", "ใช้กับลูกค้าประจำ").unwrap();
        assert_eq!(added.fields, ["customer_name", "total"]);
        assert!(add(&doc, "ใบเสนอราคา ร้านเรา", "").is_err(), "names are unique");
        assert!(add(&doc, "ใบเสนอราคา", "").is_err(), "a built-in's name is taken");
        assert_eq!(find("ใบเสนอราคา ร้านเรา").unwrap().id, added.id);
        assert!(super::super::resolve(&added.id).is_some());

        update(&added.id, Some("ใบเสนอราคา v2"), None, Some(false)).unwrap();
        assert!(find("ใบเสนอราคา v2").is_none(), "switched off");
        update(&added.id, None, None, Some(true)).unwrap();
        assert!(find("ใบเสนอราคา v2").is_some());

        remove(&added.id).unwrap();
        assert!(load().is_empty());
        assert!(!file_of(&added.id).exists());
        std::env::remove_var("MALI_TEMPLATES_DIR");
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn only_docx_files_are_read() {
        let p = std::env::temp_dir().join(format!("mali-tpl-{}.txt", uuid::Uuid::new_v4().simple()));
        std::fs::write(&p, "hi").unwrap();
        assert!(read_source(&p).unwrap_err().contains(".docx"));
        let _ = std::fs::remove_file(p);
    }
}
