//! Where a CLI lives, remembered once found.

use std::sync::Mutex;

/// A binary's path, looked up on demand. A path that was found is kept for
/// the app's lifetime; a missing one is looked up again next time, so a CLI
/// installed while the app runs (e.g. from onboarding) works right away.
pub struct BinCache(Mutex<Option<&'static str>>);

impl BinCache {
    pub const fn new() -> Self {
        Self(Mutex::new(None))
    }

    pub fn get(&self, resolve: impl FnOnce() -> Option<String>) -> Option<&'static str> {
        let mut slot = self.0.lock().unwrap_or_else(|e| e.into_inner());
        if slot.is_none() {
            // Leaked once per binary: callers keep `&'static str` like before.
            *slot = resolve().map(|path| &*Box::leak(path.into_boxed_str()));
        }
        *slot
    }
}
