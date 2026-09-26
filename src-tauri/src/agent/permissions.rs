//! The agent waiting on the user: a permission card in the app, answered
//! through [`reply`] (the `agent_reply_permission` command).

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

use tauri::ipc::Channel;
use tokio::sync::{oneshot, watch};

use crate::chat_stream::ChatStreamEvent;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Reply {
    Once,
    Always,
    Reject,
}

fn pending() -> &'static Mutex<HashMap<String, oneshot::Sender<Reply>>> {
    static PENDING: OnceLock<Mutex<HashMap<String, oneshot::Sender<Reply>>>> = OnceLock::new();
    PENDING.get_or_init(Default::default)
}

/// Answer a waiting request; false when nothing is waiting under that id.
pub fn reply(id: &str, reply: &str) -> bool {
    let reply = match reply {
        "always" => Reply::Always,
        "once" => Reply::Once,
        _ => Reply::Reject,
    };
    let sender = pending().lock().unwrap().remove(id);
    sender.map(|s| s.send(reply).is_ok()).unwrap_or(false)
}

pub struct Ask<'a> {
    pub directory: &'a str,
    /// `edit` or `bash`, like OpenCode's permission names the app already knows.
    pub permission: &'a str,
    pub pattern: String,
    /// "Action: target", split by the card into its two parts.
    pub title: String,
    pub detail: Option<String>,
}

/// Show the card and wait. Stopping the run counts as a refusal.
pub async fn ask(on_event: &Channel<ChatStreamEvent>, ask: Ask<'_>, cancel: &mut watch::Receiver<bool>) -> Reply {
    let id = format!("perm_{}", uuid::Uuid::new_v4().simple());
    let (tx, rx) = oneshot::channel();
    pending().lock().unwrap().insert(id.clone(), tx);
    let _ = on_event.send(ChatStreamEvent::Permission {
        id: id.clone(),
        directory: ask.directory.to_string(),
        permission: ask.permission.to_string(),
        patterns: vec![ask.pattern],
        title: ask.title,
        detail: ask.detail,
    });
    let answer = tokio::select! {
        answer = rx => answer.unwrap_or(Reply::Reject),
        _ = cancel.wait_for(|stopped| *stopped) => Reply::Reject,
    };
    pending().lock().unwrap().remove(&id);
    let _ = on_event.send(ChatStreamEvent::PermissionResolved { id });
    answer
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unknown_ids_are_not_answered() {
        assert!(!reply("nope", "once"));
    }

    #[tokio::test]
    async fn a_reply_reaches_the_waiting_request() {
        let (tx, rx) = oneshot::channel();
        pending().lock().unwrap().insert("t1".into(), tx);
        assert!(reply("t1", "always"));
        assert_eq!(rx.await.unwrap(), Reply::Always);
    }
}
