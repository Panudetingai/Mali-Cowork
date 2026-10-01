//! Making connector tools easy for an agent to get right.
//!
//! Long jobs: some connectors start work and answer "not yet" — Canva's
//! design generation hands back a job and a `polling_policy`, and its
//! status tool says `in_progress` until the design is ready, or
//! `polled_too_early` (with a wait of two billion seconds) when asked too
//! soon. Agents waited with `bash: sleep 30`, `sleep 90`…, asked too early,
//! got lost and started the design again: one design took half an hour. Here
//! a status call waits and asks again by itself, a few seconds at a time,
//! so the agent gets "done" (or still working, with the time it waited)
//! from a single call.
//!
//! Wrong arguments: a call the server turns down for its arguments gets the
//! tool's input schema with the error, so the next call is right, rather
//! than the same mistake eight times over.

use std::time::{Duration, Instant};

use serde_json::Value;

use super::client::ToolResult;

/// One status call waits at most this long before answering "still working".
const BUDGET: Duration = Duration::from_secs(45);
/// Between two asks, whatever the server suggests.
const MIN_WAIT: Duration = Duration::from_secs(2);
const MAX_WAIT: Duration = Duration::from_secs(12);
/// Asked too soon: the server's own number is nonsense (2^31 seconds).
const TOO_EARLY_WAIT: Duration = Duration::from_secs(6);

/// A job that isn't finished: how long to wait, and the token to ask with next.
#[derive(Debug, PartialEq)]
pub struct Pending {
    pub wait: Duration,
    pub continuation: Option<String>,
}

const UNFINISHED: &[&str] = &["pending", "in_progress", "queued", "running", "processing", "polled_too_early"];

/// The result says the job is still going (in JSON: `status`, or `job.status`).
pub fn pending(text: &str) -> Option<Pending> {
    let value: Value = serde_json::from_str(text.trim()).ok()?;
    let job = if value["status"].is_string() { &value } else { &value["job"] };
    let status = job["status"].as_str()?.to_ascii_lowercase();
    if !UNFINISHED.contains(&status.as_str()) {
        return None;
    }
    let wait = if status == "polled_too_early" {
        TOO_EARLY_WAIT
    } else {
        let policy = value["polling_policy"]["wait_seconds"].as_u64().or(job["polling_policy"]["wait_seconds"].as_u64());
        policy.map_or(MIN_WAIT * 2, |s| Duration::from_secs(s)).clamp(MIN_WAIT, MAX_WAIT)
    };
    let continuation = value["continuation_token"]
        .as_str()
        .or(job["continuation_token"].as_str())
        .map(str::to_string);
    Some(Pending { wait, continuation })
}

/// A call that asks how a job is doing (it names the job), as opposed to one that starts it.
pub fn polls_a_job(tool: &str, args: &Value) -> bool {
    let named = args.get("job_id").or_else(|| args.get("jobId")).is_some_and(|v| v.is_string());
    named && (tool.contains("job") || tool.contains("status") || !tool.contains("create"))
}

/// Ask again until the job is done or [`BUDGET`] is spent, then answer.
pub async fn wait_for_job<F, Fut>(tool: &str, mut args: Value, first: ToolResult, mut call: F) -> Result<ToolResult, String>
where
    F: FnMut(Value) -> Fut,
    Fut: std::future::Future<Output = Result<ToolResult, String>>,
{
    if first.is_error || !polls_a_job(tool, &args) {
        return Ok(first);
    }
    let started = Instant::now();
    let mut result = first;
    while let Some(pending) = pending(&result.text) {
        if started.elapsed() + pending.wait > BUDGET {
            result.text.push_str(&format!(
                "\n\n(Mali waited {}s for this job and it's still going. Call this tool again right away \
                 to keep waiting; don't sleep or start the job again.)",
                started.elapsed().as_secs()
            ));
            break;
        }
        // Tests wait a thousandth as long.
        tokio::time::sleep(if cfg!(test) { pending.wait / 1000 } else { pending.wait }).await;
        if let (Some(token), Some(fields)) = (pending.continuation, args.as_object_mut()) {
            fields.insert("continuation_token".into(), Value::String(token));
        }
        result = call(args.clone()).await?;
        if result.is_error {
            break;
        }
    }
    Ok(result)
}

/// Turned down for its arguments (an MCP `-32602`, or a schema check).
pub fn bad_arguments(text: &str) -> bool {
    let lower = text.to_ascii_lowercase();
    lower.contains("-32602")
        || lower.contains("invalid arguments")
        || lower.contains("input validation")
        || lower.contains("invalid_type")
}

/// The error, then the schema the arguments must follow.
pub fn with_schema(error: &str, schema: &Value) -> String {
    let mut shown = serde_json::to_string(schema).unwrap_or_default();
    if shown.len() > 3000 {
        shown = format!("{}…", shown.chars().take(3000).collect::<String>());
    }
    format!(
        "{error}\n\nThe arguments must follow this tool's input schema exactly (an `object` means a JSON \
         object, not a string). Fix them and call once more:\n{shown}"
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn result(text: Value) -> ToolResult {
        ToolResult { text: text.to_string(), is_error: false, images: vec![] }
    }

    #[test]
    fn canvas_answers_read_as_waiting_or_done() {
        let working = json!({ "job_id": "j", "status": "in_progress", "continuation_token": "t2", "polling_policy": { "wait_seconds": 10 } });
        assert_eq!(pending(&working.to_string()), Some(Pending { wait: Duration::from_secs(10), continuation: Some("t2".into()) }));
        let too_early = json!({ "status": "polled_too_early", "continuation_token": "t3", "polling_policy": { "wait_seconds": 2147483647u64 } });
        assert_eq!(pending(&too_early.to_string()).unwrap().wait, TOO_EARLY_WAIT);
        let done = json!({ "job_id": "j", "status": "completed", "design": { "id": "D" } });
        assert!(pending(&done.to_string()).is_none());
        assert!(pending("not json").is_none());
        // An export job nests it.
        assert!(pending(&json!({ "job": { "id": "e", "status": "in_progress" } }).to_string()).is_some());
    }

    #[test]
    fn only_a_status_call_waits() {
        let args = json!({ "job_id": "j", "continuation_token": "t" });
        assert!(polls_a_job("get-create-design-async-job", &args));
        assert!(!polls_a_job("create-design", &json!({ "query": "poster" })));
        assert!(!polls_a_job("search-designs", &json!({ "query": "x" })));
    }

    #[tokio::test]
    async fn a_status_call_waits_until_the_design_is_ready() {
        let first = result(json!({ "status": "in_progress", "continuation_token": "t1", "polling_policy": { "wait_seconds": 10 } }));
        let mut asked = Vec::new();
        let mut answers = vec![
            result(json!({ "status": "completed", "design": { "id": "D" } })),
            result(json!({ "status": "polled_too_early", "continuation_token": "t2", "polling_policy": { "wait_seconds": 2147483647u64 } })),
        ];
        let out = wait_for_job("get-create-design-async-job", json!({ "job_id": "j", "continuation_token": "t0" }), first, |args| {
            asked.push(args["continuation_token"].as_str().unwrap().to_string());
            let next = answers.pop().unwrap();
            async move { Ok(next) }
        })
        .await
        .unwrap();
        assert!(out.text.contains("completed"));
        assert_eq!(asked, ["t1", "t2"]);
    }

    #[test]
    fn a_wrong_argument_comes_back_with_the_schema() {
        let error = "MCP error -32602: Input validation error: Invalid arguments for tool resize-design: expected object, received string";
        assert!(bad_arguments(error));
        assert!(!bad_arguments("Design not found"));
        let schema = json!({ "type": "object", "properties": { "design_type": { "type": "object" } } });
        assert!(with_schema(error, &schema).contains("\"design_type\":{\"type\":\"object\"}"));
    }
}
