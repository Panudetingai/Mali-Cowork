//! Notifications the user can answer without coming back to the window.
//!
//! The notification plugin only carries title, body and sound on desktop, so
//! an approval it delivers still costs the user a trip to the app. On macOS
//! this goes to `mac-notification-sys` (already in the tree, under the plugin)
//! which draws real action buttons and reports what was pressed. Everywhere
//! else the command answers `None` straight away and the caller falls back to
//! the plain plugin notification.

use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AlertRequest {
    pub title: String,
    #[serde(default)]
    pub subtitle: Option<String>,
    pub body: String,
    /// Buttons, most wanted first. macOS shows one inline and the rest in a
    /// dropdown, so keep the list short.
    #[serde(default)]
    pub actions: Vec<String>,
    /// The dismissing button (macOS draws it on the left).
    #[serde(default)]
    pub close_label: Option<String>,
    /// A system sound name, e.g. "Ping". Silent when unset.
    #[serde(default)]
    pub sound: Option<String>,
}

#[derive(Debug, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AlertResponse {
    /// The action button that was pressed, if any.
    pub action: Option<String>,
    /// The user clicked the notification body: bring the window forward.
    pub clicked: bool,
    /// The close button was pressed — an explicit "no".
    pub dismissed: bool,
    /// No native alert here — the caller should use the plugin instead.
    pub unsupported: bool,
}

#[cfg(target_os = "macos")]
mod imp {
    use super::{AlertRequest, AlertResponse};
    use mac_notification_sys::{MainButton, Notification, NotificationResponse};
    use std::sync::atomic::{AtomicBool, Ordering};

    /// `send_notification` parks a thread until the user answers, so only one
    /// is ever in flight — a queue of stale approvals helps nobody.
    static BUSY: AtomicBool = AtomicBool::new(false);

    pub fn set_app(bundle_id: &str) {
        // `set_application` can only be answered once, and a failed attempt
        // still burns it — so only claim the identifier when the app really is
        // the bundle that owns it. Under `tauri dev` the binary is loose on
        // disk and the identifier isn't registered with Launch Services, so
        // Finder's is used — the library's own fallback. Set it here: left
        // unset, the library first runs AppleScript `get id of application
        // "use_default"`, and macOS pops a "Where is use_default?" picker.
        let bundled = std::env::current_exe()
            .ok()
            .is_some_and(|path| path.to_string_lossy().contains("/Contents/MacOS/"));
        let identity = if bundled { bundle_id } else { "com.apple.Finder" };
        if let Err(e) = mac_notification_sys::set_application(identity) {
            eprintln!("[notify] keeping the default notification identity: {e}");
        }
    }

    pub fn show(request: AlertRequest) -> Result<AlertResponse, String> {
        if BUSY.swap(true, Ordering::SeqCst) {
            return Ok(AlertResponse { unsupported: true, ..Default::default() });
        }
        let result = send(&request);
        BUSY.store(false, Ordering::SeqCst);
        result
    }

    fn send(request: &AlertRequest) -> Result<AlertResponse, String> {
        let mut options = Notification::new();
        if let Some(sound) = request.sound.as_deref() {
            options.sound(sound);
        }
        if let Some(close) = request.close_label.as_deref() {
            options.close_button(close);
        }
        // `main_button` borrows, so the slice has to outlive the send below.
        let labels: Vec<&str> = request.actions.iter().map(String::as_str).collect();
        match labels.as_slice() {
            [] => {}
            [only] => {
                options.main_button(MainButton::SingleAction(only));
            }
            many => {
                options.main_button(MainButton::DropdownActions("Choose", many));
            }
        }

        let response = mac_notification_sys::send_notification(
            &request.title,
            request.subtitle.as_deref(),
            &request.body,
            Some(&options),
        )
        .map_err(|e| e.to_string())?;

        Ok(match response {
            NotificationResponse::ActionButton(name) => {
                AlertResponse { action: Some(name), ..Default::default() }
            }
            NotificationResponse::Click => AlertResponse { clicked: true, ..Default::default() },
            NotificationResponse::CloseButton(_) => {
                AlertResponse { dismissed: true, ..Default::default() }
            }
            NotificationResponse::Reply(text) => {
                AlertResponse { action: Some(text), ..Default::default() }
            }
            // Swiped away, or never looked at: the agent keeps waiting, and
            // the card in the window is still there to answer. Reporting this
            // as a dismissal would deny requests the user never saw.
            NotificationResponse::None => AlertResponse::default(),
        })
    }
}

#[cfg(not(target_os = "macos"))]
mod imp {
    use super::{AlertRequest, AlertResponse};

    pub fn set_app(_bundle_id: &str) {}

    pub fn show(_request: AlertRequest) -> Result<AlertResponse, String> {
        Ok(AlertResponse { unsupported: true, ..Default::default() })
    }
}

/// Register the app so notifications carry its name and icon, not Finder's.
pub fn init(bundle_id: &str) {
    imp::set_app(bundle_id);
}

/// Show an alert with buttons and wait for the answer.
///
/// Resolves with `unsupported: true` when this platform (or a notification
/// already on screen) can't take it, so the caller can fall back.
#[tauri::command]
pub async fn native_alert(request: AlertRequest) -> Result<AlertResponse, String> {
    // The answer arrives on the app's run loop, so the wait cannot happen on
    // the main thread.
    tauri::async_runtime::spawn_blocking(move || imp::show(request))
        .await
        .map_err(|e| e.to_string())?
}
