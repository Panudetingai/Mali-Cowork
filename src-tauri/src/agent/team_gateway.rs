//! A lead on a CLI agent (OpenCode, Codex, Cursor, Antigravity). Its loop
//! isn't Mali's, so it reaches the team through the `mali` MCP gateway: the
//! gateway offers it `delegate_task` and `propose_teammate`, and each hand-off
//! runs here, streaming into the chat on the channel the app opened for it.
//!
//! Duties stay apart here too: while a CLI lead runs, the gateway hides the
//! connectors a teammate owns, and opens them only while that teammate works.

use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
use std::future::Future;
use std::pin::Pin;
use std::sync::{Arc, Mutex, OnceLock};

use serde_json::Value;
use tauri::ipc::Channel;
use tokio::sync::watch;

use super::team::{self, Handoff};
use super::tools::Outcome;
use super::wire::{ToolCall, ToolSpec, Usage};
use super::AgentRequest;
use crate::chat_stream::ChatStreamEvent;

struct CliLead {
    request: AgentRequest,
    on_event: Channel<ChatStreamEvent>,
    stop: watch::Sender<bool>,
    /// Hand-offs run one at a time; the lead waits on each anyway.
    state: tokio::sync::Mutex<LeadState>,
    /// The teammate working right now: its connectors are open meanwhile.
    working: Mutex<Option<String>>,
}

#[derive(Default)]
struct LeadState {
    handoffs: usize,
}

/// Every CLI lead running now, oldest first. Each chat's run is its own: one
/// starting (another chat, the Quick bar) never stops another's hand-off.
fn leads() -> &'static Mutex<Vec<Arc<CliLead>>> {
    static LEADS: OnceLock<Mutex<Vec<Arc<CliLead>>>> = OnceLock::new();
    LEADS.get_or_init(Default::default)
}

/// Per chat, what outlives one run: teammates allowed with "Always", and each
/// teammate's session, so it remembers earlier jobs in the chat.
type Memory = (BTreeSet<String>, BTreeMap<String, String>);

fn memory() -> &'static Mutex<HashMap<String, Memory>> {
    static MEMORY: OnceLock<Mutex<HashMap<String, Memory>>> = OnceLock::new();
    MEMORY.get_or_init(Default::default)
}

/// The lead the gateway answers for: the newest run.
fn current() -> Option<Arc<CliLead>> {
    leads().lock().unwrap().last().cloned()
}

/// The teammates working right now, in any run.
fn working_now(leads: &[Arc<CliLead>]) -> HashSet<String> {
    leads.iter().filter_map(|lead| lead.working.lock().unwrap().clone()).collect()
}

/// A CLI lead starts: the gateway offers it the team until [`end`].
pub fn begin(mut request: AgentRequest, on_event: Channel<ChatStreamEvent>) {
    team::settle(&mut request.team);
    request.lead = true;
    let (stop, _) = watch::channel(false);
    let lead = Arc::new(CliLead {
        request,
        on_event,
        stop,
        state: Default::default(),
        working: Mutex::new(None),
    });
    let mut leads = leads().lock().unwrap();
    // The same run starting over replaces itself; other runs carry on.
    if let Some(at) = leads.iter().position(|l| l.request.run_id == lead.request.run_id) {
        let _ = leads.remove(at).stop.send(true);
    }
    leads.push(lead);
}

/// The CLI lead's run is over (finished or stopped): so is any hand-off in flight.
pub fn end(run_id: &str) {
    let mut leads = leads().lock().unwrap();
    if let Some(at) = leads.iter().position(|l| l.request.run_id == run_id) {
        let _ = leads.remove(at).stop.send(true);
    }
}

/// The team tools a CLI lead sees; none while a teammate works (that's the teammate listing).
pub fn specs() -> Vec<ToolSpec> {
    let Some(lead) = current() else { return Vec::new() };
    if !working_now(&leads().lock().unwrap()).is_empty() {
        return Vec::new();
    }
    let note = team::lead_note(&lead.request);
    team::specs(&lead.request)
        .into_iter()
        .map(|mut spec| {
            // A CLI lead has no system prompt of ours: the team and its rules ride on the tool.
            if spec.name == team::DELEGATE {
                spec.description.push_str(&note);
            }
            spec
        })
        .collect()
}

/// Connectors a lead may not use: the teammates', except those of a teammate working now.
pub fn hidden_connectors() -> HashSet<String> {
    let leads = leads().lock().unwrap();
    let working = working_now(&leads);
    let open: HashSet<String> = leads
        .iter()
        .flat_map(|lead| lead.request.team.iter())
        .filter(|m| working.contains(&m.id))
        .flat_map(|m| m.mcp.iter().map(|s| s.id.clone()))
        .collect();
    leads
        .iter()
        .flat_map(|lead| lead.request.team.iter())
        .filter(|m| !working.contains(&m.id))
        .flat_map(|m| m.mcp.iter().map(|s| s.id.clone()))
        .filter(|id| !open.contains(id))
        .collect()
}

/// Whether a gateway tool is one of the team's.
pub fn is_team_tool(name: &str) -> bool {
    current().is_some() && [team::DELEGATE, team::PROPOSE, team::COACH].contains(&name)
}

/// Run a team tool the CLI lead called through the gateway. Boxed: a hand-off
/// can start a CLI, which reaches the gateway, which lands here again.
pub fn call(name: String, args: Value) -> Pin<Box<dyn Future<Output = Outcome> + Send>> {
    Box::pin(async move { call_inner(&name, args).await })
}

async fn call_inner(name: &str, args: Value) -> Outcome {
    let Some(lead) = current() else { return Outcome::err("Team mode isn't on for this chat.") };
    let call = ToolCall { id: format!("gw_{}", &uuid::Uuid::new_v4().simple().to_string()[..12]), name: name.into(), args };
    if name == team::PROPOSE || name == team::COACH {
        let mut usage = Usage::default();
        let mut cancel = lead.stop.subscribe();
        return if name == team::PROPOSE {
            team::propose(&call, &lead.request, &lead.on_event, &mut usage, &mut cancel).await
        } else {
            team::coach(&call, &lead.request, &lead.on_event, &mut usage, &mut cancel).await
        };
    }
    let Some(mate) = team::teammate_of(&lead.request.team, &call.args).cloned() else {
        let ids: Vec<&str> = lead.request.team.iter().map(|m| m.id.as_str()).collect();
        return Outcome::err(format!("There's no teammate by that id. The team: {}.", ids.join(", ")));
    };
    let step = team::step_id(&mate.id, &call.id);
    let title = format!("Team: {}", mate.name);
    let started = std::time::Instant::now();
    let _ = lead.on_event.send(ChatStreamEvent::Activity {
        id: Some(step.clone()),
        kind: "tool".into(),
        title: title.clone(),
        detail: None,
        done: false,
        duration_ms: None,
    });

    let mut state = lead.state.lock().await;
    let out = if state.handoffs >= team::MAX_DELEGATIONS {
        Outcome::err(format!(
            "That's {} hand-offs for this request, the most allowed. Finish with what the team has.",
            team::MAX_DELEGATIONS
        ))
    } else {
        state.handoffs += 1;
        let run = lead.request.run_id.clone();
        let (mut always, mut sessions) = memory().lock().unwrap().remove(&run).unwrap_or_default();
        let mut cancel = lead.stop.subscribe();
        let mut usage = Usage::default();
        *lead.working.lock().unwrap() = Some(mate.id.clone());
        let out = team::delegate(
            &call,
            Handoff {
                lead: &lead.request,
                step: &step,
                always: &mut always,
                sessions: &mut sessions,
                usage: &mut usage,
                on_event: &lead.on_event,
                cancel: &mut cancel,
            },
        )
        .await;
        *lead.working.lock().unwrap() = None;
        memory().lock().unwrap().insert(run, (always, sessions));
        out
    };
    drop(state);

    let _ = lead.on_event.send(ChatStreamEvent::Activity {
        id: Some(step),
        kind: "tool".into(),
        title: if out.is_error { format!("{title} (failed)") } else { title },
        detail: out.detail.clone(),
        done: true,
        duration_ms: Some(started.elapsed().as_millis() as u64),
    });
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn request(run: &str) -> AgentRequest {
        let mut request: AgentRequest = serde_json::from_value(json!({
            "prompt": "", "provider": "", "model": "", "apiKey": null, "baseUrl": null,
            "instructions": null, "effort": null, "runId": run
        }))
        .unwrap();
        request.team = vec![serde_json::from_value(json!({
            "id": "momo", "name": "Momo", "role": "design in Canva", "tools": "none",
            "mcp": [{ "id": "custom-canva", "enabled": true }]
        }))
        .unwrap()];
        request
    }

    /// One test, since the lead is a single slot for the whole app.
    #[test]
    fn a_cli_lead_gets_the_team_and_loses_the_teammates_connectors() {
        begin(request("chat-a"), Channel::new(|_| Ok(())));
        let names: Vec<String> = specs().into_iter().map(|s| s.name).collect();
        assert_eq!(names, vec![team::DELEGATE.to_string(), team::PROPOSE.to_string()]);
        assert!(specs()[0].description.contains("`momo` Momo — duty: design in Canva"));
        assert!(hidden_connectors().contains("custom-canva"));
        assert!(is_team_tool(team::DELEGATE));

        // While Momo works, its connector opens and the team tools step aside.
        *current().unwrap().working.lock().unwrap() = Some("momo".into());
        assert!(hidden_connectors().is_empty());
        assert!(specs().is_empty());
        *current().unwrap().working.lock().unwrap() = None;

        end("another-chat");
        assert!(current().is_some(), "only its own run ends it");

        // Another run starting (a second chat, the Quick bar) leaves chat-a's hand-off alone.
        let mut stopped = current().unwrap().stop.subscribe();
        begin(request("chat-b"), Channel::new(|_| Ok(())));
        assert!(!*stopped.borrow_and_update(), "a new run must not stop another's hand-off");
        end("chat-b");
        assert_eq!(current().unwrap().request.run_id, "chat-a");
        assert!(!*stopped.borrow_and_update());

        end("chat-a");
        assert!(*stopped.borrow_and_update(), "its own end stops its hand-off");
        assert!(specs().is_empty() && hidden_connectors().is_empty() && !is_team_tool(team::DELEGATE));
    }
}
