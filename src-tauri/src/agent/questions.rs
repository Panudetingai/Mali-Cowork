//! The agent asking the user something: the app's question card, answered
//! through [`answer`] (the `agent_answer_question` command).

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

use serde_json::{json, Value};
use tauri::ipc::Channel;
use tokio::sync::{oneshot, watch};

use super::wire::ToolSpec;
use crate::chat_stream::{ChatStreamEvent, QuestionItem, QuestionOption};

type Answers = Vec<Vec<String>>;

fn pending() -> &'static Mutex<HashMap<String, oneshot::Sender<Answers>>> {
    static PENDING: OnceLock<Mutex<HashMap<String, oneshot::Sender<Answers>>>> = OnceLock::new();
    PENDING.get_or_init(Default::default)
}

/// Answer a waiting question; empty answers withdraw it. False when nothing waits under that id.
pub fn answer(id: &str, answers: Answers) -> bool {
    let sender = pending().lock().unwrap().remove(id);
    sender.map(|s| s.send(answers).is_ok()).unwrap_or(false)
}

pub const NAME: &str = "ask_user";

pub fn spec() -> ToolSpec {
    ToolSpec {
        name: NAME.into(),
        description: "Ask the user when you truly can't go on without their choice (which option, \
missing details). Offer short options; they can also type their own answer. Don't ask what you can find \
out yourself."
            .into(),
        schema: json!({
            "type": "object",
            "properties": {
                "questions": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "question": { "type": "string" },
                            "header": { "type": "string", "description": "A two- or three-word label." },
                            "options": {
                                "type": "array",
                                "items": {
                                    "type": "object",
                                    "properties": {
                                        "label": { "type": "string" },
                                        "description": { "type": "string" }
                                    },
                                    "required": ["label"]
                                }
                            },
                            "multiple": { "type": "boolean", "description": "More than one option may be picked." }
                        },
                        "required": ["question"]
                    }
                }
            },
            "required": ["questions"]
        }),
    }
}

fn items_of(args: &Value) -> Vec<QuestionItem> {
    args["questions"]
        .as_array()
        .into_iter()
        .flatten()
        .take(4)
        .filter_map(|q| {
            let question = q["question"].as_str()?.trim().to_string();
            (!question.is_empty()).then(|| QuestionItem {
                question,
                header: q["header"].as_str().map(str::to_string),
                options: q["options"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .take(6)
                    .filter_map(|o| {
                        Some(QuestionOption {
                            label: o["label"].as_str()?.to_string(),
                            description: o["description"].as_str().map(str::to_string),
                        })
                    })
                    .collect(),
                multiple: q["multiple"].as_bool().unwrap_or(false),
                custom: true,
            })
        })
        .collect()
}

/// Show the card and wait; the model gets the answers as text.
pub async fn ask(
    args: &Value,
    directory: &str,
    on_event: &Channel<ChatStreamEvent>,
    cancel: &mut watch::Receiver<bool>,
) -> Result<String, String> {
    let items = items_of(args);
    if items.is_empty() {
        return Err("No question to ask.".into());
    }
    let asked: Vec<String> = items.iter().map(|q| q.question.clone()).collect();
    let id = format!("question_{}", uuid::Uuid::new_v4().simple());
    let (tx, rx) = oneshot::channel();
    pending().lock().unwrap().insert(id.clone(), tx);
    let _ = on_event.send(ChatStreamEvent::Question { id: id.clone(), directory: directory.to_string(), questions: items });
    let answers = tokio::select! {
        answers = rx => answers.unwrap_or_default(),
        _ = cancel.wait_for(|stopped| *stopped) => Vec::new(),
    };
    pending().lock().unwrap().remove(&id);
    let _ = on_event.send(ChatStreamEvent::QuestionResolved { id });
    if answers.iter().all(|a| a.is_empty()) {
        return Err("The user didn't answer. Carry on with your best judgement and say what you assumed.".into());
    }
    Ok(asked
        .iter()
        .zip(answers.iter().chain(std::iter::repeat(&Vec::new())))
        .map(|(q, a)| format!("{q}\n→ {}", if a.is_empty() { "(no answer)".to_string() } else { a.join(", ") }))
        .collect::<Vec<_>>()
        .join("\n\n"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_questions_and_options() {
        let items = items_of(&json!({ "questions": [
            { "question": "Which format?", "header": "Format", "options": [{ "label": "PDF" }, { "label": "Word", "description": ".docx" }] },
            { "question": "  " },
        ]}));
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].options.len(), 2);
        assert_eq!(items[0].options[1].description.as_deref(), Some(".docx"));
        assert!(items[0].custom);
    }

    #[test]
    fn an_answer_reaches_the_waiting_question() {
        let (tx, mut rx) = oneshot::channel();
        pending().lock().unwrap().insert("q1".into(), tx);
        assert!(answer("q1", vec![vec!["PDF".into()]]));
        assert_eq!(rx.try_recv().unwrap(), vec![vec!["PDF".to_string()]]);
        assert!(!answer("q1", vec![]));
    }
}
