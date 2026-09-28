//! The usage ledger: one row per model reply, kept apart from the chats so
//! deleting a chat never takes the tokens it spent out of the totals.
//!
//! It lives in the chat history database (see `history::migrate`), which
//! backfills it once from the chats that exist when the table is created.

use rusqlite::{params, Connection, Transaction};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::history;

const MAX_TEXT: usize = 200;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageEvent {
    pub id: String,
    /// Unix milliseconds.
    pub created_at: i64,
    /// The id the reply was requested with, e.g. `api:openai/gpt-5`.
    pub model_id: String,
    #[serde(default)]
    pub chat_id: Option<String>,
    /// The start of the prompt, so a costly reply can be recognised.
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub input_tokens: u64,
    #[serde(default)]
    pub output_tokens: u64,
    #[serde(default)]
    pub reasoning_tokens: u64,
    #[serde(default)]
    pub cache_read_tokens: u64,
    #[serde(default)]
    pub cache_write_tokens: u64,
    #[serde(default)]
    pub total_tokens: u64,
    /// USD, as the provider reported it; `None` when it didn't.
    #[serde(default)]
    pub cost: Option<f64>,
    #[serde(default)]
    pub duration_ms: Option<u64>,
    #[serde(default)]
    pub first_token_ms: Option<u64>,
}

fn clip(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ").chars().take(MAX_TEXT).collect()
}

pub(super) fn create_table(tx: &Transaction) -> rusqlite::Result<()> {
    tx.execute_batch(
        "CREATE TABLE IF NOT EXISTS usage_events (
           id TEXT PRIMARY KEY,
           created_at INTEGER NOT NULL,
           model_id TEXT NOT NULL DEFAULT '',
           chat_id TEXT,
           title TEXT NOT NULL DEFAULT '',
           input_tokens INTEGER NOT NULL DEFAULT 0,
           output_tokens INTEGER NOT NULL DEFAULT 0,
           reasoning_tokens INTEGER NOT NULL DEFAULT 0,
           cache_read_tokens INTEGER NOT NULL DEFAULT 0,
           cache_write_tokens INTEGER NOT NULL DEFAULT 0,
           total_tokens INTEGER NOT NULL DEFAULT 0,
           cost REAL,
           duration_ms INTEGER,
           first_token_ms INTEGER
         );
         CREATE INDEX IF NOT EXISTS usage_by_time ON usage_events (created_at);",
    )
}

fn insert(conn: &Connection, event: &UsageEvent) -> rusqlite::Result<usize> {
    let as_i64 = |n: u64| i64::try_from(n).unwrap_or(i64::MAX);
    conn.execute(
        "INSERT OR IGNORE INTO usage_events (id, created_at, model_id, chat_id, title,
           input_tokens, output_tokens, reasoning_tokens, cache_read_tokens, cache_write_tokens,
           total_tokens, cost, duration_ms, first_token_ms)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
        params![
            event.id,
            event.created_at,
            event.model_id,
            event.chat_id,
            clip(&event.title),
            as_i64(event.input_tokens),
            as_i64(event.output_tokens),
            as_i64(event.reasoning_tokens),
            as_i64(event.cache_read_tokens),
            as_i64(event.cache_write_tokens),
            as_i64(event.total_tokens),
            event.cost.filter(|c| c.is_finite() && *c >= 0.0),
            event.duration_ms.map(as_i64),
            event.first_token_ms.map(as_i64),
        ],
    )
}

/// Replies already in the history when the ledger is created, so the totals
/// don't start from zero. Uses the message id, so it never counts one twice.
pub(super) fn backfill(tx: &Transaction) -> Result<usize, String> {
    let chats: Vec<String> = {
        let mut statement = tx.prepare("SELECT data FROM chats").map_err(|e| e.to_string())?;
        let rows = statement
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(|e| e.to_string())?;
        rows.filter_map(Result::ok).collect()
    };
    let mut added = 0;
    for raw in chats {
        let Ok(chat) = serde_json::from_str::<Value>(&raw) else { continue };
        for event in events_in_chat(&chat) {
            added += insert(tx, &event).map_err(|e| e.to_string())?;
        }
    }
    Ok(added)
}

fn events_in_chat(chat: &Value) -> Vec<UsageEvent> {
    let Some(messages) = chat["messages"].as_array() else { return Vec::new() };
    let chat_time = chat["updatedAt"].as_i64().or(chat["createdAt"].as_i64()).unwrap_or(0);
    let count = |usage: &Value, key: &str| usage[key].as_f64().filter(|n| *n > 0.0).map_or(0, |n| n as u64);
    let mut events = Vec::new();
    for (index, message) in messages.iter().enumerate() {
        let usage = &message["usage"];
        if message["role"] != "assistant" || !usage.is_object() {
            continue;
        }
        let Some(id) = message["id"].as_str() else { continue };
        let asked = index.checked_sub(1).map(|i| &messages[i]).filter(|m| m["role"] == "user");
        // The id the user picked is prefixed (`api:`, `opencode:`…); the one the
        // reply reports may not be.
        let model_id = asked
            .and_then(|m| m["resend"]["modelId"].as_str())
            .or(message["modelId"].as_str())
            .unwrap_or("unknown");
        let input = count(usage, "inputTokens");
        let output = count(usage, "outputTokens");
        let reasoning = count(usage, "reasoningTokens");
        let total = match count(usage, "totalTokens") {
            0 => input + output + reasoning,
            n => n,
        };
        if total == 0 && usage["cost"].as_f64().unwrap_or(0.0) <= 0.0 {
            continue;
        }
        events.push(UsageEvent {
            id: id.to_string(),
            created_at: message["createdAt"].as_i64().unwrap_or(chat_time),
            model_id: model_id.to_string(),
            chat_id: chat["id"].as_str().map(str::to_string),
            title: asked.and_then(|m| m["content"].as_str()).unwrap_or_default().to_string(),
            input_tokens: input,
            output_tokens: output,
            reasoning_tokens: reasoning,
            cache_read_tokens: count(usage, "cacheReadTokens"),
            cache_write_tokens: count(usage, "cacheWriteTokens"),
            total_tokens: total,
            cost: usage["cost"].as_f64(),
            duration_ms: message["durationMs"].as_f64().map(|n| n as u64),
            first_token_ms: None,
        });
    }
    events
}

pub fn load(conn: &Connection, since: i64) -> Result<Vec<UsageEvent>, String> {
    let mut statement = conn
        .prepare(
            "SELECT id, created_at, model_id, chat_id, title, input_tokens, output_tokens,
               reasoning_tokens, cache_read_tokens, cache_write_tokens, total_tokens, cost,
               duration_ms, first_token_ms
             FROM usage_events WHERE created_at >= ?1 ORDER BY created_at",
        )
        .map_err(|e| e.to_string())?;
    let rows = statement
        .query_map([since], |row| {
            let n = |i: usize| row.get::<_, i64>(i).map(|v| v.max(0) as u64);
            let opt = |i: usize| row.get::<_, Option<i64>>(i).map(|v| v.map(|v| v.max(0) as u64));
            Ok(UsageEvent {
                id: row.get(0)?,
                created_at: row.get(1)?,
                model_id: row.get(2)?,
                chat_id: row.get(3)?,
                title: row.get(4)?,
                input_tokens: n(5)?,
                output_tokens: n(6)?,
                reasoning_tokens: n(7)?,
                cache_read_tokens: n(8)?,
                cache_write_tokens: n(9)?,
                total_tokens: n(10)?,
                cost: row.get(11)?,
                duration_ms: opt(12)?,
                first_token_ms: opt(13)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<_, _>>().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn usage_record(event: UsageEvent) -> Result<(), String> {
    if event.id.is_empty() || event.id.len() > 128 {
        return Err("Invalid usage id".into());
    }
    history::blocking(move |conn| insert(conn, &event).map(|_| ()).map_err(|e| e.to_string())).await
}

/// Every reply since `since` (Unix ms), oldest first.
#[tauri::command]
pub async fn usage_load(since: Option<i64>) -> Result<Vec<UsageEvent>, String> {
    history::blocking(move |conn| load(conn, since.unwrap_or(0))).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn backfill_reads_replies_and_skips_ones_without_usage() {
        let chat = json!({
            "id": "c1",
            "updatedAt": 5,
            "messages": [
                { "id": "u1", "role": "user", "content": "Summarise   this\nreport",
                  "resend": { "modelId": "api:openai/gpt-5" } },
                { "id": "a1", "role": "assistant", "modelId": "openai/gpt-5", "createdAt": 9,
                  "usage": { "inputTokens": 100, "outputTokens": 20, "cost": 0.01 } },
                { "id": "u2", "role": "user", "content": "again" },
                { "id": "a2", "role": "assistant", "content": "no usage" }
            ]
        });
        let events = events_in_chat(&chat);
        assert_eq!(events.len(), 1);
        let event = &events[0];
        assert_eq!(event.id, "a1");
        assert_eq!(event.model_id, "api:openai/gpt-5");
        assert_eq!(event.total_tokens, 120);
        assert_eq!(event.created_at, 9);
        assert_eq!(event.cost, Some(0.01));
        assert_eq!(clip(&event.title), "Summarise this report");
    }

    #[test]
    fn ledger_survives_deleting_the_chat() {
        let mut conn = Connection::open_in_memory().unwrap();
        history::migrate(&conn).unwrap();
        let chat = json!({
            "id": "c1", "title": "t", "createdAt": 1, "updatedAt": 2,
            "messages": [{ "id": "a1", "role": "assistant", "usage": { "totalTokens": 50 } }]
        });
        history::save(&mut conn, &serde_json::from_value(json!({ "chats": [chat] })).unwrap()).unwrap();
        insert(&conn, &UsageEvent { id: "a1".into(), total_tokens: 50, ..Default::default() }).unwrap();
        // Recording the same reply again is a no-op.
        insert(&conn, &UsageEvent { id: "a1".into(), total_tokens: 50, ..Default::default() }).unwrap();
        history::save(&mut conn, &serde_json::from_value(json!({ "deletedChats": ["c1"] })).unwrap()).unwrap();
        let events = load(&conn, 0).unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].total_tokens, 50);
    }
}
