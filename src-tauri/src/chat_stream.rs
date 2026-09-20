use serde::Serialize;

#[derive(Clone, Serialize)]
pub struct TodoItem {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    pub text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub done: Option<bool>,
}

#[derive(Clone, Serialize)]
pub struct AgentUsage {
    #[serde(rename = "inputTokens")]
    pub input_tokens: Option<u64>,
    #[serde(rename = "outputTokens")]
    pub output_tokens: Option<u64>,
    #[serde(rename = "cacheReadTokens")]
    pub cache_read_tokens: Option<u64>,
    #[serde(rename = "cacheWriteTokens")]
    pub cache_write_tokens: Option<u64>,
    #[serde(rename = "reasoningTokens")]
    pub reasoning_tokens: Option<u64>,
    #[serde(rename = "totalTokens")]
    pub total_tokens: Option<u64>,
    #[serde(rename = "cost")]
    pub cost: Option<f64>,
}

/// One choice the agent offers for a question.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuestionOption {
    pub label: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

/// One question the agent is waiting on.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuestionItem {
    pub question: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub header: Option<String>,
    pub options: Vec<QuestionOption>,
    /// More than one option may be picked.
    pub multiple: bool,
    /// An answer of the user's own is allowed.
    pub custom: bool,
}

#[derive(Clone, Serialize)]
#[serde(
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    tag = "event",
    content = "data"
)]
pub enum ChatStreamEvent {
    Started,
    Chunk { text: String },
    Reasoning { reasoning: String },
    Activity {
        /// Stable id so repeated updates of one step replace each other.
        #[serde(skip_serializing_if = "Option::is_none")]
        id: Option<String>,
        kind: String,
        title: String,
        detail: Option<String>,
        done: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        duration_ms: Option<u64>,
    },
    Metadata {
        session_id: Option<String>,
        usage: Option<AgentUsage>,
        duration_ms: Option<u64>,
        model: Option<String>,
    },
    /// The agent is waiting for the user to approve an action.
    Permission {
        id: String,
        directory: String,
        permission: String,
        patterns: Vec<String>,
        title: String,
        detail: Option<String>,
    },
    /// A pending permission was answered (by the user or automatically).
    PermissionResolved { id: String },
    /// The agent asked the user something and cannot continue until it is answered.
    Question {
        id: String,
        directory: String,
        questions: Vec<QuestionItem>,
    },
    /// A pending question was answered or withdrawn.
    QuestionResolved { id: String },
    /// Agent task plan / todo checklist update.
    Todos { items: Vec<TodoItem> },
    Done { model_id: String },
    Error { message: String },
}
