use serde::Serialize;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase", tag = "event", content = "data")]
pub enum ChatStreamEvent {
    Started,
    Chunk { text: String },
    Done { model_id: String },
    Error { message: String },
}
