//! Whether voice input (the webview's speech recognizer) may be used.
//!
//! macOS kills a process outright (TCC) when it touches the microphone or
//! speech recognition and the *responsible* app has no usage description.
//! A built Mali.app carries them in its Info.plist (`src-tauri/Info.plist`).
//! Under `tauri dev` the binary runs outside a bundle and macOS holds the
//! terminal or editor that launched it responsible — the plist Tauri embeds
//! in the dev binary doesn't count — so pressing the mic would crash the app
//! (crash reports show `responsibleProc` = the terminal, namespace TCC).

use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceStatus {
    pub available: bool,
    /// Why not, in words for the user.
    pub reason: Option<String>,
}

#[tauri::command]
pub fn voice_input_status() -> VoiceStatus {
    #[cfg(target_os = "macos")]
    if !runs_from_app_bundle() {
        return VoiceStatus {
            available: false,
            reason: Some(
                "Voice input works in the built app (Mali.app). While developing, macOS asks the \
                 terminal that started Mali for permission and would close the app."
                    .into(),
            ),
        };
    }
    VoiceStatus { available: true, reason: None }
}

#[cfg(target_os = "macos")]
fn runs_from_app_bundle() -> bool {
    std::env::current_exe()
        .map(|p| p.to_string_lossy().contains(".app/Contents/MacOS/"))
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn voice_input_status_matches_bundle() {
        // Test binaries run outside any .app, like `tauri dev`.
        let status = voice_input_status();
        if cfg!(target_os = "macos") {
            assert!(!status.available);
            assert!(status.reason.is_some());
        } else {
            assert!(status.available);
        }
    }
}
