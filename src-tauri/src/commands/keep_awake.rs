//! Keeps the computer from going to sleep on its own, while still letting the
//! display turn off: the mobile remote holds this so a phone can keep working
//! with the computer's screen dark.
//!
//! macOS: an `NSProcessInfo` activity (user-initiated), which stops idle
//! system sleep and App Nap — the main window, hidden or covered, keeps
//! answering the phone at full speed. Windows: `SetThreadExecutionState`
//! with `ES_SYSTEM_REQUIRED`, from a thread kept alive for the hold, since the
//! state belongs to the thread that set it. Elsewhere this does nothing.
//!
//! Neither costs CPU: they only tell the OS's power manager not to sleep. A
//! laptop with its lid closed on battery still sleeps, as it should.

use std::sync::{Mutex, PoisonError};

static HELD: Mutex<Option<Hold>> = Mutex::new(None);

/// Holds or lets go; repeating the same call does nothing.
pub fn set(on: bool) {
    let mut held = HELD.lock().unwrap_or_else(PoisonError::into_inner);
    if on && held.is_none() {
        *held = Hold::take();
    } else if !on {
        // Dropping the hold gives it back.
        held.take();
    }
}

pub fn held() -> bool {
    HELD.lock().unwrap_or_else(PoisonError::into_inner).is_some()
}

#[cfg(target_os = "macos")]
struct Hold(objc2::rc::Retained<objc2::runtime::ProtocolObject<dyn objc2::runtime::NSObjectProtocol>>);

// The activity token is an immutable Foundation object, safe to end from any thread.
#[cfg(target_os = "macos")]
unsafe impl Send for Hold {}

#[cfg(target_os = "macos")]
impl Hold {
    fn take() -> Option<Self> {
        use objc2_foundation::{NSActivityOptions, NSProcessInfo, NSString};
        let reason = NSString::from_str("Mali remote: a phone is using this computer");
        let activity = NSProcessInfo::processInfo()
            .beginActivityWithOptions_reason(NSActivityOptions::UserInitiated, &reason);
        Some(Hold(activity))
    }
}

#[cfg(target_os = "macos")]
impl Drop for Hold {
    fn drop(&mut self) {
        // SAFETY: the token is the one `beginActivityWithOptions_reason` returned.
        unsafe { objc2_foundation::NSProcessInfo::processInfo().endActivity(&self.0) };
    }
}

/// Dropping the sender wakes the holding thread, which gives the state back.
#[cfg(windows)]
struct Hold(#[allow(dead_code)] std::sync::mpsc::Sender<()>);

#[cfg(windows)]
impl Hold {
    fn take() -> Option<Self> {
        use windows_sys::Win32::System::Power::{SetThreadExecutionState, ES_CONTINUOUS, ES_SYSTEM_REQUIRED};
        let (tx, rx) = std::sync::mpsc::channel::<()>();
        std::thread::Builder::new()
            .name("mali-keep-awake".into())
            .spawn(move || {
                // SAFETY: plain Win32 calls with flag constants.
                unsafe { SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED) };
                // Blocks without waking until the hold is dropped.
                let _ = rx.recv();
                unsafe { SetThreadExecutionState(ES_CONTINUOUS) };
            })
            .ok()?;
        Some(Hold(tx))
    }
}

#[cfg(not(any(target_os = "macos", windows)))]
struct Hold;

#[cfg(not(any(target_os = "macos", windows)))]
impl Hold {
    fn take() -> Option<Self> {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn holds_and_lets_go() {
        set(true);
        set(true);
        assert_eq!(held(), cfg!(any(target_os = "macos", windows)));
        set(false);
        assert!(!held());
    }
}
