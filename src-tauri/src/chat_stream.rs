use serde::Serialize;

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

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase", tag = "event", content = "data")]
pub enum ChatStreamEvent {
    Started,
    Chunk { text: String },
    Reasoning { reasoning: String },
    Activity {
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
    Done { model_id: String },
    Error { message: String },
}
