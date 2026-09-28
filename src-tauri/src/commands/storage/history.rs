//! Chat history and projects in SQLite, instead of the webview's
//! localStorage (which holds only ~5–10 MB and loses everything when full).
//!
//! Each chat is one row: the columns the app sorts and filters by, plus the
//! whole chat as JSON, so the frontend's chat shape can grow without a schema
//! change. Projects work the same way.

use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Bumped whenever `migrate` gains a step.
const SCHEMA_VERSION: i64 = 2;
const MAX_ID_LEN: usize = 128;
/// One chat's JSON; far above a real conversation, so only junk is refused.
const MAX_ROW_BYTES: usize = 64 * 1024 * 1024;
const LEGACY_IMPORTED: &str = "legacy_local_storage_imported";

static DB: OnceLock<Mutex<Connection>> = OnceLock::new();

pub fn db_path() -> PathBuf {
    dirs::data_local_dir()
        .unwrap_or_else(std::env::temp_dir)
        .join("mali-cowork")
        .join("history.sqlite3")
}

fn open(path: &Path) -> Result<Connection, String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Cannot create {}: {e}", parent.display()))?;
    }
    let fresh = !path.exists();
    let conn = Connection::open(path).map_err(|e| format!("Cannot open chat history: {e}"))?;
    if fresh {
        make_private(path);
    }
    conn.execute_batch(
        "PRAGMA journal_mode = WAL;
         PRAGMA synchronous = NORMAL;
         PRAGMA busy_timeout = 5000;",
    )
    .map_err(|e| e.to_string())?;
    migrate(&conn)?;
    Ok(conn)
}

/// Chats can quote files and code, so only the owner may read the database.
/// SQLite gives its `-wal`/`-shm` files the same mode.
fn make_private(path: &Path) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600));
    }
    #[cfg(not(unix))]
    let _ = path;
}

pub(super) fn migrate(conn: &Connection) -> Result<(), String> {
    let version: i64 = conn
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .map_err(|e| e.to_string())?;
    if version > SCHEMA_VERSION {
        return Err("Chat history was saved by a newer version of Mali Cowork. Please update the app.".into());
    }
    if version < 1 {
        conn.execute_batch(
            "BEGIN;
             CREATE TABLE IF NOT EXISTS chats (
               id TEXT PRIMARY KEY,
               project_id TEXT,
               title TEXT NOT NULL DEFAULT '',
               pinned INTEGER NOT NULL DEFAULT 0,
               created_at INTEGER NOT NULL DEFAULT 0,
               updated_at INTEGER NOT NULL DEFAULT 0,
               data TEXT NOT NULL
             );
             CREATE INDEX IF NOT EXISTS chats_by_update ON chats (updated_at DESC);
             CREATE INDEX IF NOT EXISTS chats_by_project ON chats (project_id);
             CREATE TABLE IF NOT EXISTS projects (
               id TEXT PRIMARY KEY,
               updated_at INTEGER NOT NULL DEFAULT 0,
               data TEXT NOT NULL
             );
             CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
             PRAGMA user_version = 1;
             COMMIT;",
        )
        .map_err(|e| format!("Cannot set up chat history: {e}"))?;
    }
    if version < 2 {
        // `unchecked`: `migrate` only has a shared borrow; the step is still atomic.
        let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
        super::usage::create_table(&tx).map_err(|e| format!("Cannot set up usage: {e}"))?;
        super::usage::backfill(&tx)?;
        tx.execute_batch("PRAGMA user_version = 2;").map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn with_db<T>(work: impl FnOnce(&mut Connection) -> Result<T, String>) -> Result<T, String> {
    if DB.get().is_none() {
        let conn = open(&db_path())?;
        let _ = DB.set(Mutex::new(conn));
    }
    let mut conn = DB
        .get()
        .expect("database was just opened")
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    work(&mut conn)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistorySnapshot {
    pub chats: Vec<Value>,
    pub projects: Vec<Value>,
    /// localStorage history was already copied in, so it can be dropped.
    pub legacy_imported: bool,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryChanges {
    #[serde(default)]
    pub chats: Vec<Value>,
    #[serde(default)]
    pub deleted_chats: Vec<String>,
    #[serde(default)]
    pub projects: Vec<Value>,
    #[serde(default)]
    pub deleted_projects: Vec<String>,
}

/// The columns kept next to a chat's JSON.
struct ChatRow {
    id: String,
    project_id: Option<String>,
    title: String,
    pinned: bool,
    created_at: i64,
    updated_at: i64,
    data: String,
}

fn valid_id(id: &str) -> Result<&str, String> {
    let ok = !id.is_empty()
        && id.len() <= MAX_ID_LEN
        && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_');
    ok.then_some(id).ok_or_else(|| format!("Invalid id: {id:?}"))
}

fn json_id(value: &Value) -> Result<String, String> {
    let id = value["id"].as_str().ok_or("Every chat and project needs an id")?;
    valid_id(id).map(str::to_string)
}

fn serialize(value: &Value) -> Result<String, String> {
    let data = serde_json::to_string(value).map_err(|e| e.to_string())?;
    if data.len() > MAX_ROW_BYTES {
        return Err("A chat is too large to save".into());
    }
    Ok(data)
}

fn chat_row(value: &Value) -> Result<ChatRow, String> {
    let project_id = match value["projectId"].as_str() {
        Some(id) => Some(valid_id(id)?.to_string()),
        None => None,
    };
    Ok(ChatRow {
        id: json_id(value)?,
        project_id,
        title: value["title"].as_str().unwrap_or_default().chars().take(500).collect(),
        pinned: value["pinned"].as_bool().unwrap_or(false),
        created_at: value["createdAt"].as_i64().unwrap_or(0),
        updated_at: value["updatedAt"].as_i64().unwrap_or(0),
        data: serialize(value)?,
    })
}

fn upsert_chat(conn: &Connection, row: &ChatRow, replace: bool) -> rusqlite::Result<usize> {
    let sql = if replace {
        "INSERT INTO chats (id, project_id, title, pinned, created_at, updated_at, data)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT (id) DO UPDATE SET project_id = ?2, title = ?3, pinned = ?4,
           created_at = ?5, updated_at = ?6, data = ?7"
    } else {
        "INSERT OR IGNORE INTO chats (id, project_id, title, pinned, created_at, updated_at, data)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)"
    };
    conn.execute(
        sql,
        params![row.id, row.project_id, row.title, row.pinned, row.created_at, row.updated_at, row.data],
    )
}

fn read_json_rows(conn: &Connection, sql: &str) -> Result<Vec<Value>, String> {
    let mut statement = conn.prepare(sql).map_err(|e| e.to_string())?;
    let rows = statement
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|e| e.to_string())?;
    // A row that no longer parses is skipped rather than hiding every chat.
    Ok(rows
        .filter_map(Result::ok)
        .filter_map(|raw| serde_json::from_str(&raw).ok())
        .collect())
}

pub fn load(conn: &Connection) -> Result<HistorySnapshot, String> {
    let chats = read_json_rows(conn, "SELECT data FROM chats ORDER BY updated_at DESC")?;
    let projects = read_json_rows(conn, "SELECT data FROM projects ORDER BY updated_at DESC")?;
    let legacy_imported = conn
        .query_row("SELECT value FROM meta WHERE key = ?1", [LEGACY_IMPORTED], |row| {
            row.get::<_, String>(0)
        })
        .optional()
        .map_err(|e| e.to_string())?
        .is_some();
    Ok(HistorySnapshot { chats, projects, legacy_imported })
}

pub fn save(conn: &mut Connection, changes: &HistoryChanges) -> Result<(), String> {
    // Validate everything first, so a bad row can't leave a half-saved batch.
    let chats = changes.chats.iter().map(chat_row).collect::<Result<Vec<_>, _>>()?;
    let projects = changes
        .projects
        .iter()
        .map(|p| Ok((json_id(p)?, p["updatedAt"].as_i64().unwrap_or(0), serialize(p)?)))
        .collect::<Result<Vec<_>, String>>()?;
    for id in changes.deleted_chats.iter().chain(&changes.deleted_projects) {
        valid_id(id)?;
    }

    let tx = conn.transaction().map_err(|e| e.to_string())?;
    for row in &chats {
        upsert_chat(&tx, row, true).map_err(|e| e.to_string())?;
    }
    for id in &changes.deleted_chats {
        tx.execute("DELETE FROM chats WHERE id = ?1", [id]).map_err(|e| e.to_string())?;
    }
    for (id, updated_at, data) in &projects {
        tx.execute(
            "INSERT INTO projects (id, updated_at, data) VALUES (?1, ?2, ?3)
             ON CONFLICT (id) DO UPDATE SET updated_at = ?2, data = ?3",
            params![id, updated_at, data],
        )
        .map_err(|e| e.to_string())?;
    }
    for id in &changes.deleted_projects {
        tx.execute("DELETE FROM projects WHERE id = ?1", [id]).map_err(|e| e.to_string())?;
        // Chats outlive their project; they go back to the plain history.
        tx.execute("UPDATE chats SET project_id = NULL WHERE project_id = ?1", [id])
            .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())
}

/// Copy chats saved by older versions (localStorage) in, once. Chats already
/// in the database win, so running it twice never overwrites anything.
pub fn import_legacy(conn: &mut Connection, chats: &[Value]) -> Result<usize, String> {
    let rows: Vec<ChatRow> = chats.iter().filter_map(|c| chat_row(c).ok()).collect();
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let mut imported = 0;
    for row in &rows {
        imported += upsert_chat(&tx, row, false).map_err(|e| e.to_string())?;
    }
    tx.execute(
        "INSERT OR REPLACE INTO meta (key, value) VALUES (?1, ?2)",
        params![LEGACY_IMPORTED, imported.to_string()],
    )
    .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(imported)
}

pub(super) async fn blocking<T: Send + 'static>(
    work: impl FnOnce(&mut Connection) -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tokio::task::spawn_blocking(move || with_db(work))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn history_load() -> Result<HistorySnapshot, String> {
    blocking(|conn| load(conn)).await
}

#[tauri::command]
pub async fn history_save(changes: HistoryChanges) -> Result<(), String> {
    blocking(move |conn| save(conn, &changes)).await
}

#[tauri::command]
pub async fn history_import_legacy(chats: Vec<Value>) -> Result<usize, String> {
    blocking(move |conn| import_legacy(conn, &chats)).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn temp_db() -> (Connection, PathBuf) {
        let dir = std::env::temp_dir().join(format!("mali-history-{}", uuid::Uuid::new_v4().simple()));
        let path = dir.join("history.sqlite3");
        (open(&path).unwrap(), dir)
    }

    fn chat(id: &str, title: &str, updated: i64) -> Value {
        json!({ "id": id, "title": title, "createdAt": 1, "updatedAt": updated, "messages": [] })
    }

    #[test]
    fn saves_updates_and_deletes_chats() {
        let (mut conn, dir) = temp_db();
        let changes = HistoryChanges {
            chats: vec![chat("a", "First", 10), chat("b", "Second", 20)],
            ..Default::default()
        };
        save(&mut conn, &changes).unwrap();
        let snapshot = load(&conn).unwrap();
        assert_eq!(snapshot.chats.len(), 2);
        assert_eq!(snapshot.chats[0]["id"], "b", "newest first");

        let rename = HistoryChanges {
            chats: vec![chat("a", "Renamed", 30)],
            deleted_chats: vec!["b".into()],
            ..Default::default()
        };
        save(&mut conn, &rename).unwrap();
        let snapshot = load(&conn).unwrap();
        assert_eq!(snapshot.chats.len(), 1);
        assert_eq!(snapshot.chats[0]["title"], "Renamed");
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn deleting_a_project_keeps_its_chats() {
        let (mut conn, dir) = temp_db();
        let mut in_project = chat("c", "Chat", 1);
        in_project["projectId"] = json!("p1");
        save(
            &mut conn,
            &HistoryChanges {
                chats: vec![in_project],
                projects: vec![json!({ "id": "p1", "name": "Reports", "updatedAt": 1 })],
                ..Default::default()
            },
        )
        .unwrap();
        save(&mut conn, &HistoryChanges { deleted_projects: vec!["p1".into()], ..Default::default() })
            .unwrap();
        let snapshot = load(&conn).unwrap();
        assert!(snapshot.projects.is_empty());
        assert_eq!(snapshot.chats.len(), 1);
        let project: Option<String> = conn
            .query_row("SELECT project_id FROM chats WHERE id = 'c'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(project, None);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn legacy_import_never_overwrites() {
        let (mut conn, dir) = temp_db();
        save(&mut conn, &HistoryChanges { chats: vec![chat("a", "Newer", 50)], ..Default::default() })
            .unwrap();
        let imported = import_legacy(&mut conn, &[chat("a", "Older", 5), chat("z", "Old only", 4)]).unwrap();
        assert_eq!(imported, 1);
        let snapshot = load(&conn).unwrap();
        assert!(snapshot.legacy_imported);
        assert_eq!(snapshot.chats[0]["title"], "Newer");
        assert_eq!(snapshot.chats.len(), 2);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn rejects_bad_ids_without_saving_anything() {
        let (mut conn, dir) = temp_db();
        let changes = HistoryChanges {
            chats: vec![chat("ok", "Fine", 1), chat("../x", "Bad", 2)],
            ..Default::default()
        };
        assert!(save(&mut conn, &changes).is_err());
        assert!(load(&conn).unwrap().chats.is_empty());
        let _ = std::fs::remove_dir_all(dir);
    }

    #[cfg(unix)]
    #[test]
    fn database_is_owner_only() {
        use std::os::unix::fs::PermissionsExt;
        let (_conn, dir) = temp_db();
        let mode = std::fs::metadata(dir.join("history.sqlite3")).unwrap().permissions().mode();
        assert_eq!(mode & 0o777, 0o600);
        let _ = std::fs::remove_dir_all(dir);
    }
}
