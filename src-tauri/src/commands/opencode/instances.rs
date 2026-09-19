//! The folders the opencode server holds an instance for, so idle ones close.
//!
//! opencode keeps one instance per folder it is asked about, and every
//! instance starts its own copy of each MCP server (`word_mcp_server`, …).
//! Left alone, every folder the user ever opened keeps a full set of MCP
//! servers running until the app quits. Here each request marks its folder
//! as used, and a sweep closes instances that sat idle for [`IDLE_TTL`], or
//! the least recently used ones beyond [`MAX_IDLE`]. A folder with a running
//! prompt holds a [`Lease`] and is never closed; the next request to a
//! closed folder simply opens it again.

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use super::client::OpencodeClient;

const IDLE_TTL: Duration = Duration::from_secs(15 * 60);
const MAX_IDLE: usize = 3;
const SWEEP_EVERY: Duration = Duration::from_secs(60);

/// The key of the instance opencode serves when a request names no folder.
pub const DEFAULT: &str = "";

struct Slot {
    last_used: Instant,
    leases: usize,
}

fn slots() -> &'static Mutex<HashMap<String, Slot>> {
    static SLOTS: OnceLock<Mutex<HashMap<String, Slot>>> = OnceLock::new();
    SLOTS.get_or_init(Default::default)
}

/// Held by the sweep while it closes instances, so a lease taken meanwhile
/// waits until its folder is closed and then opens a fresh instance.
fn closing() -> &'static tokio::sync::Mutex<()> {
    static CLOSING: OnceLock<tokio::sync::Mutex<()>> = OnceLock::new();
    CLOSING.get_or_init(Default::default)
}

/// Mark `directory` as just used.
pub fn touch(directory: &str) {
    let mut slots = slots().lock().unwrap();
    slots
        .entry(directory.to_string())
        .and_modify(|slot| slot.last_used = Instant::now())
        .or_insert(Slot { last_used: Instant::now(), leases: 0 });
}

/// Keeps `directory`'s instance open while held.
pub struct Lease(String);

/// Keep `directory` open until the returned [`Lease`] is dropped.
pub async fn lease(directory: &str) -> Lease {
    {
        let mut slots = slots().lock().unwrap();
        let slot = slots
            .entry(directory.to_string())
            .or_insert(Slot { last_used: Instant::now(), leases: 0 });
        slot.leases += 1;
        slot.last_used = Instant::now();
    }
    drop(closing().lock().await);
    Lease(directory.to_string())
}

impl Drop for Lease {
    fn drop(&mut self) {
        if let Some(slot) = slots().lock().unwrap().get_mut(&self.0) {
            slot.leases = slot.leases.saturating_sub(1);
            slot.last_used = Instant::now();
        }
    }
}

/// Forget every folder: the server restarted and holds no instance.
pub fn reset() {
    slots().lock().unwrap().clear();
}

/// Close idle instances every [`SWEEP_EVERY`] until the task is aborted.
pub fn spawn_sweeper(client: OpencodeClient) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        let mut tick = tokio::time::interval(SWEEP_EVERY);
        tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        tick.tick().await;
        loop {
            tick.tick().await;
            let _closing = closing().lock().await;
            let idle = take_idle(&mut slots().lock().unwrap(), Instant::now());
            for directory in idle {
                let target = (directory != DEFAULT).then_some(directory.as_str());
                match client.dispose_instance(target).await {
                    Ok(()) => eprintln!("[opencode] closed idle instance {directory:?}"),
                    Err(e) => eprintln!("[opencode] can't close instance {directory:?}: {e}"),
                }
            }
        }
    })
}

/// Remove and return the folders to close: those idle past [`IDLE_TTL`], then
/// the least recently used idle ones beyond [`MAX_IDLE`].
fn take_idle(slots: &mut HashMap<String, Slot>, now: Instant) -> Vec<String> {
    let mut idle: Vec<(&String, Instant)> = slots
        .iter()
        .filter(|(_, slot)| slot.leases == 0)
        .map(|(dir, slot)| (dir, slot.last_used))
        .collect();
    idle.sort_by_key(|(_, last_used)| std::cmp::Reverse(*last_used));
    let victims: Vec<String> = idle
        .iter()
        .enumerate()
        .filter(|(rank, (_, last_used))| {
            *rank >= MAX_IDLE || now.saturating_duration_since(*last_used) >= IDLE_TTL
        })
        .map(|(_, (dir, _))| (*dir).clone())
        .collect();
    for dir in &victims {
        slots.remove(dir);
    }
    victims
}

#[cfg(test)]
mod tests {
    use super::*;

    fn slot(age: Duration, leases: usize, now: Instant) -> Slot {
        Slot { last_used: now - age, leases }
    }

    #[test]
    fn closes_stale_and_surplus_idle_folders_but_never_leased_ones() {
        let now = Instant::now() + IDLE_TTL * 2;
        let minute = Duration::from_secs(60);
        let mut slots = HashMap::from([
            ("stale".to_string(), slot(IDLE_TTL + minute, 0, now)),
            ("busy-stale".to_string(), slot(IDLE_TTL * 2, 1, now)),
            ("a".to_string(), slot(minute, 0, now)),
            ("b".to_string(), slot(minute * 2, 0, now)),
            ("c".to_string(), slot(minute * 3, 0, now)),
            ("d".to_string(), slot(minute * 4, 0, now)),
        ]);
        let mut closed = take_idle(&mut slots, now);
        closed.sort();
        assert_eq!(closed, ["d", "stale"]);
        let mut kept: Vec<&String> = slots.keys().collect();
        kept.sort();
        assert_eq!(kept, ["a", "b", "busy-stale", "c"]);
    }
}
