use serde::Deserialize;
use tauri::ipc::Channel;

use crate::ai;
use crate::chat_stream::ChatStreamEvent;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatRequest {
    pub prompt: String,
    pub model_id: String,
}

#[tauri::command]
pub async fn chat_generate(
    request: ChatRequest,
    on_event: Channel<ChatStreamEvent>,
) -> Result<(), String> {
    ai::stream_chat_response(&request.prompt, &request.model_id, on_event).await
}
