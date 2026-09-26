//! Mali's own agent (see `crate::agent`), for Cowork on an API key.

use tauri::ipc::Channel;

use crate::agent::{self, AgentRequest};
use crate::chat_stream::ChatStreamEvent;

#[tauri::command]
pub async fn agent_generate(request: AgentRequest, on_event: Channel<ChatStreamEvent>) -> Result<(), String> {
    agent::generate(request, on_event).await
}

/// Answer a permission card: `once`, `always` or `reject`.
#[tauri::command]
pub fn agent_reply_permission(id: String, reply: String) -> bool {
    agent::reply_permission(&id, &reply)
}

/// Answer a question the agent asked; empty answers withdraw it.
#[tauri::command]
pub fn agent_answer_question(id: String, answers: Vec<Vec<String>>) -> bool {
    agent::answer_question(&id, answers)
}

/// Stop the run of a chat.
#[tauri::command]
pub fn agent_abort(run_id: String) -> bool {
    agent::abort(&run_id)
}
