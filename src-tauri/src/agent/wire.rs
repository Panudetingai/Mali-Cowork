//! What the agent says to a model, in a shape of its own: turned into the
//! OpenAI-compatible or the Anthropic wire format only when a request goes out.

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// One entry of a conversation, as the agent keeps it on disk.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "role", rename_all = "lowercase")]
pub enum Msg {
    User {
        text: String,
        /// Pictures sent with the prompt (attachment paths); only the latest
        /// turns carry them to the model, older ones are mentioned by name.
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        images: Vec<String>,
    },
    Assistant {
        #[serde(default)]
        text: String,
        #[serde(default, rename = "toolCalls")]
        tool_calls: Vec<ToolCall>,
    },
    Tool {
        #[serde(rename = "callId")]
        call_id: String,
        name: String,
        content: String,
        #[serde(default, rename = "isError")]
        is_error: bool,
        /// Pictures the tool returned (a screenshot, a picture it was asked to
        /// look at); shown to models that can see, while they're recent.
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        images: Vec<ToolImage>,
    },
}

/// A picture, ready to send: JPEG or PNG as base64, already scaled down.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ToolImage {
    pub mime: String,
    pub data: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolCall {
    pub id: String,
    pub name: String,
    pub args: Value,
}

/// A tool as the model sees it.
pub struct ToolSpec {
    pub name: String,
    pub description: String,
    pub schema: Value,
}

/// Tokens one model call used.
#[derive(Debug, Clone, Default)]
pub struct Usage {
    pub input: u64,
    pub output: u64,
    pub cache_read: u64,
    pub cache_write: u64,
    pub reasoning: u64,
}

impl Usage {
    pub fn add(&mut self, other: &Usage) {
        self.input += other.input;
        self.output += other.output;
        self.cache_read += other.cache_read;
        self.cache_write += other.cache_write;
        self.reasoning += other.reasoning;
    }
}

/// Streamed while a model writes.
pub enum Delta {
    Text(String),
    Reasoning(String),
}

/// What one model call came back with.
#[derive(Debug, Default)]
pub struct StepResult {
    pub text: String,
    pub tool_calls: Vec<ToolCall>,
    pub usage: Usage,
}

/// Which wire format a provider speaks.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Wire {
    OpenAi,
    Anthropic,
}

/// Everything needed to call one model.
#[derive(Debug, Clone)]
pub struct ModelTarget {
    pub wire: Wire,
    pub provider: String,
    pub model: String,
    pub base_url: String,
    pub api_key: String,
    pub effort: Option<String>,
}

/// Tool arguments as the model sent them; text that isn't JSON is kept so the
/// tool can say what was wrong with it.
pub fn parse_args(raw: &str) -> Value {
    let raw = raw.trim();
    if raw.is_empty() {
        return Value::Object(Default::default());
    }
    serde_json::from_str(raw).unwrap_or_else(|_| Value::String(raw.to_string()))
}

/// Read a server-sent event stream line by line; `on_data` gets each `data:` payload.
pub struct SseLines {
    buffer: Vec<u8>,
}

impl SseLines {
    pub fn new() -> Self {
        Self { buffer: Vec::new() }
    }

    /// Feed bytes; returns every complete `data:` payload they finish.
    pub fn push(&mut self, bytes: &[u8]) -> Vec<String> {
        self.buffer.extend_from_slice(bytes);
        let mut out = Vec::new();
        while let Some(pos) = self.buffer.iter().position(|&b| b == b'\n') {
            let line: Vec<u8> = self.buffer.drain(..=pos).collect();
            let line = String::from_utf8_lossy(&line);
            let line = line.trim_end_matches(['\r', '\n']);
            if let Some(data) = line.strip_prefix("data:") {
                out.push(data.trim_start().to_string());
            }
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sse_lines_across_chunks() {
        let mut sse = SseLines::new();
        assert!(sse.push(b"event: x\ndata: {\"a\"").is_empty());
        assert_eq!(sse.push(b":1}\n\ndata: [DONE]\n"), vec!["{\"a\":1}", "[DONE]"]);
    }

    #[test]
    fn args_fall_back_to_text() {
        assert_eq!(parse_args(""), serde_json::json!({}));
        assert_eq!(parse_args("{\"p\":1}"), serde_json::json!({"p": 1}));
        assert_eq!(parse_args("{oops"), Value::String("{oops".into()));
    }
}
