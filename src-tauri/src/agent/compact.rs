//! Keeping a long agent conversation inside the model's context window:
//! first old tool output is cut short (the agent can always run the tool
//! again), then, if that isn't enough, everything before the current prompt
//! is replaced by a summary the model writes itself.

use super::wire::Msg;

/// Tool results among the newest messages stay whole; the agent is working with them.
const KEEP_WHOLE: usize = 8;
const OLD_TOOL_CHARS: usize = 1_500;
/// When nothing else is left to cut, even recent output is shortened to this.
const TIGHT_TOOL_CHARS: usize = 400;
/// Compact once the conversation fills this share of the window.
pub const TRIGGER: f64 = 0.75;

pub const SUMMARY_SYSTEM: &str = "You summarise a working session between a user and an AI agent so the \
agent can carry on without the full history. Keep: what the user wants and any preferences they stated; \
decisions made; files, commands and connectors involved (with exact paths and names); what is done and \
what is still open; errors met and how they were handled. Leave out chit-chat and raw tool output. \
Write compact bullet points in the user's language.";

/// A rough count: about four characters a token, plus a flat cost per picture.
pub fn estimate_tokens(system: &str, msgs: &[Msg], tools_chars: usize) -> u64 {
    let mut chars = system.len() + tools_chars;
    let mut pictures = 0;
    for msg in msgs {
        chars += match msg {
            Msg::User { text, images } => {
                pictures += images.len();
                text.len()
            }
            Msg::Assistant { text, tool_calls } => {
                text.len() + tool_calls.iter().map(|c| c.name.len() + c.args.to_string().len()).sum::<usize>()
            }
            Msg::Tool { content, images, .. } => {
                pictures += images.len();
                content.len()
            }
        };
    }
    (chars / 4) as u64 + pictures as u64 * 1_000
}

const SHORTENED: &str = "\n… (earlier output shortened to save room; run the tool again if you need all of it)";

fn shorten(content: &mut String, max: usize) -> bool {
    // Already shortened to this size or less: leave it, or the note would pile up.
    let body = content.strip_suffix(SHORTENED).unwrap_or(content);
    if body.chars().count() <= max {
        return false;
    }
    let head: String = body.chars().take(max).collect();
    *content = format!("{head}{SHORTENED}");
    true
}

/// Shorten tool output outside the newest `keep_whole` messages. True when anything changed.
pub fn trim_tool_output(msgs: &mut [Msg], keep_whole: usize, max: usize) -> bool {
    let cut = msgs.len().saturating_sub(keep_whole);
    let mut changed = false;
    for msg in &mut msgs[..cut] {
        if let Msg::Tool { content, images, .. } = msg {
            changed |= shorten(content, max);
            if !images.is_empty() {
                images.clear();
                content.push_str("\n[The picture it returned was dropped to save room.]");
                changed = true;
            }
        }
    }
    changed
}

pub fn trim_old(msgs: &mut [Msg]) -> bool {
    trim_tool_output(msgs, KEEP_WHOLE, OLD_TOOL_CHARS)
}

pub fn trim_tight(msgs: &mut [Msg]) -> bool {
    trim_tool_output(msgs, 2, TIGHT_TOOL_CHARS)
}

/// Everything before the current prompt can be summarised; `None` when there's nothing before it.
pub fn split_point(msgs: &[Msg]) -> Option<usize> {
    let last_user = msgs.iter().rposition(|m| matches!(m, Msg::User { .. }))?;
    (last_user > 0).then_some(last_user)
}

fn clip(text: &str, max: usize) -> String {
    if text.chars().count() <= max {
        return text.to_string();
    }
    format!("{}…", text.chars().take(max).collect::<String>())
}

/// The part to summarise, as text for the summarising call.
pub fn transcript(msgs: &[Msg]) -> String {
    let mut out = Vec::new();
    for msg in msgs {
        match msg {
            Msg::User { text, images } => {
                let pics = if images.is_empty() { String::new() } else { format!(" [{} picture(s)]", images.len()) };
                out.push(format!("USER{pics}: {}", clip(text, 4_000)));
            }
            Msg::Assistant { text, tool_calls } => {
                if !text.trim().is_empty() {
                    out.push(format!("AGENT: {}", clip(text, 4_000)));
                }
                for call in tool_calls {
                    out.push(format!("AGENT used {} {}", call.name, clip(&call.args.to_string(), 300)));
                }
            }
            Msg::Tool { name, content, is_error, .. } => {
                let tag = if *is_error { "failed" } else { "result" };
                out.push(format!("{name} {tag}: {}", clip(content, 600)));
            }
        }
    }
    out.join("\n")
}

/// Swap everything before `cut` for the summary.
pub fn replace_with_summary(msgs: &mut Vec<Msg>, cut: usize, summary: &str) {
    let rest = msgs.split_off(cut);
    *msgs = vec![
        Msg::User {
            text: format!("<earlier_conversation_summary>\n{}\n</earlier_conversation_summary>", summary.trim()),
            images: Vec::new(),
        },
        Msg::Assistant { text: "Understood — I'll carry on from that summary.".into(), tool_calls: Vec::new() },
    ];
    msgs.extend(rest);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::wire::ToolCall;

    fn convo() -> Vec<Msg> {
        vec![
            Msg::User { text: "first".into(), images: vec![] },
            Msg::Assistant {
                text: String::new(),
                tool_calls: vec![ToolCall { id: "c".into(), name: "read_file".into(), args: serde_json::json!({"path": "a"}) }],
            },
            Msg::Tool { call_id: "c".into(), name: "read_file".into(), content: "x".repeat(5_000), is_error: false, images: Vec::new() },
            Msg::Assistant { text: "done".into(), tool_calls: vec![] },
            Msg::User { text: "second".into(), images: vec![] },
        ]
    }

    #[test]
    fn old_output_is_shortened_and_recent_kept() {
        let mut msgs = convo();
        assert!(trim_tool_output(&mut msgs, 1, 100));
        let Msg::Tool { content, .. } = &msgs[2] else { panic!() };
        assert!(content.len() < 300);
        assert!(!trim_tool_output(&mut msgs, 1, 100), "a second pass changes nothing");
        let mut recent = convo();
        assert!(!trim_tool_output(&mut recent, 8, 100));
    }

    #[test]
    fn summary_replaces_what_came_before_the_current_prompt() {
        let mut msgs = convo();
        let cut = split_point(&msgs).unwrap();
        assert_eq!(cut, 4);
        assert!(transcript(&msgs[..cut]).contains("AGENT used read_file"));
        replace_with_summary(&mut msgs, cut, "- read a");
        assert_eq!(msgs.len(), 3);
        assert!(matches!(&msgs[0], Msg::User { text, .. } if text.contains("- read a")));
        assert!(matches!(&msgs[2], Msg::User { text, .. } if text == "second"));
        // A single prompt has nothing before it to summarise.
        assert_eq!(split_point(&msgs[2..]), None);
    }

    #[test]
    fn estimates_grow_with_content() {
        let small = estimate_tokens("s", &convo()[..1], 0);
        let big = estimate_tokens("s", &convo(), 0);
        assert!(big > small + 1_000);
    }
}
