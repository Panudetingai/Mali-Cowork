//! A pretend new computer, for trying onboarding without installing
//! anything: `MALI_SIMULATE_NEW_USER=1` in `.env` (debug builds only).
//!
//! Every tool looks missing until onboarding "installs" it, which prints a
//! believable log and changes nothing on disk.

use std::collections::HashSet;
use std::sync::Mutex;
use std::time::Duration;

static INSTALLED: Mutex<Option<HashSet<String>>> = Mutex::new(None);

pub fn enabled() -> bool {
    cfg!(debug_assertions)
        && std::env::var("MALI_SIMULATE_NEW_USER").is_ok_and(|v| matches!(v.trim(), "1" | "true" | "yes"))
}

pub fn installed(id: &str) -> bool {
    INSTALLED.lock().unwrap().as_ref().is_some_and(|set| set.contains(id))
}

/// Play an install: a few log lines over a few seconds, then mark it installed.
pub async fn install(id: &str, command: &str, mut log: impl FnMut(String)) -> Result<(), String> {
    let lines = [
        format!("[simulated] $ {command}"),
        "[simulated] resolving packages…".into(),
        "[simulated] downloading…".into(),
        "[simulated] added 1 package in 2s".into(),
    ];
    for line in lines {
        log(line);
        tokio::time::sleep(Duration::from_millis(700)).await;
    }
    INSTALLED.lock().unwrap().get_or_insert_with(HashSet::new).insert(id.to_string());
    Ok(())
}
