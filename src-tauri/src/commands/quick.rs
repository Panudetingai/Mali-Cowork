//! Epic A — Mali Anywhere (docs/PRD-delight-v0.3.md §6.2): a global shortcut
//! that opens a small Quick bar window over any app, plus tray mode so the
//! shortcut keeps working after the main window is closed.
//!
//! Privacy rule this module owns: the clipboard is read here, in Rust, only
//! at the moment the user presses the shortcut, and handed to the Quick bar
//! once. There is no command that reads the clipboard on demand.

use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, Runtime, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutEvent, ShortcutState};

use super::attachments::{attachment_import, Attachment};

pub const QUICK_LABEL: &str = "quick";
const MAIN_LABEL: &str = "main";
const TRAY_ID: &str = "mali-tray";
/// ⌥⌘M on macOS, Ctrl+Alt+M elsewhere. ⌥Space clashes with Raycast/ChatGPT.
pub const DEFAULT_SHORTCUT: &str = "CommandOrControl+Alt+M";
/// Enough for a long email or a page of code; more is almost always a mistake.
const MAX_CLIPBOARD_BYTES: usize = 20_000;

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuickConfig {
    pub enabled: bool,
    /// Tauri accelerator syntax, e.g. `CommandOrControl+Alt+M`.
    pub shortcut: String,
    /// Closing the main window hides it to the tray instead of quitting.
    pub tray_mode: bool,
}

impl Default for QuickConfig {
    fn default() -> Self {
        Self { enabled: true, shortcut: DEFAULT_SHORTCUT.into(), tray_mode: false }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuickStatus {
    /// The shortcut is live system-wide.
    pub registered: bool,
    pub shortcut: String,
    /// Why it isn't, e.g. another app already owns it or the text is invalid.
    pub error: Option<String>,
}

/// What the Quick bar starts with; taken once per shortcut press.
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuickContext {
    pub clipboard_text: Option<String>,
    /// The clipboard was longer than the Quick bar accepts and was cut.
    pub clipboard_truncated: bool,
    /// Epoch ms of the shortcut press.
    pub opened_at: i64,
}

#[derive(Default)]
pub struct QuickState {
    config: Mutex<QuickConfig>,
    registered: Mutex<Option<Shortcut>>,
    pending: Mutex<Option<QuickContext>>,
}

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

// ── plugin wiring (called from lib.rs) ──

pub fn shortcut_plugin<R: Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri_plugin_global_shortcut::Builder::new()
        .with_handler(|app, _shortcut, event: ShortcutEvent| {
            // Only one shortcut is ever registered, and it's ours.
            if event.state() == ShortcutState::Pressed {
                toggle_quick(app);
            }
        })
        .build()
}

/// Main: closing hides to the tray in tray mode. Quick: hides when it loses
/// focus, like Spotlight, so it never lingers over the user's work.
pub fn on_window_event<R: Runtime>(window: &tauri::Window<R>, event: &WindowEvent) {
    match (window.label(), event) {
        (MAIN_LABEL, WindowEvent::CloseRequested { api, .. }) => {
            let tray_mode = lock(&window.state::<QuickState>().config).tray_mode;
            if tray_mode {
                api.prevent_close();
                let _ = window.hide();
            }
        }
        (QUICK_LABEL, WindowEvent::Focused(false)) => {
            let _ = window.hide();
        }
        _ => {}
    }
}

/// macOS dock click after the main window was hidden to the tray.
pub fn show_main<R: Runtime>(app: &AppHandle<R>) {
    if let Some(main) = app.get_webview_window(MAIN_LABEL) {
        let _ = main.unminimize();
        let _ = main.show();
        let _ = main.set_focus();
    }
}

// ── Quick bar window ──

fn read_clipboard<R: Runtime>(app: &AppHandle<R>) -> (Option<String>, bool) {
    let Ok(text) = app.clipboard().read_text() else { return (None, false) };
    if text.trim().is_empty() {
        return (None, false);
    }
    let cut = crate::commands::truncate_chars(&text, MAX_CLIPBOARD_BYTES);
    (Some(cut.to_string()), cut.len() < text.len())
}

fn quick_window<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<WebviewWindow<R>> {
    if let Some(window) = app.get_webview_window(QUICK_LABEL) {
        return Ok(window);
    }
    // Same bundle as the main window; main.tsx renders the Quick bar root
    // for `?window=quick` instead of the full app.
    let builder = WebviewWindowBuilder::new(app, QUICK_LABEL, WebviewUrl::App("index.html?window=quick".into()))
        .title("Mali Quick")
        .inner_size(720.0, 480.0)
        .decorations(false)
        .shadow(true)
        .resizable(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .visible(false)
        .center();
    // Rounded like the main window: #root draws the rounded background.
    #[cfg(target_os = "macos")]
    let builder = builder.transparent(true);
    builder.build()
}

fn toggle_quick<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window(QUICK_LABEL) {
        if window.is_visible().unwrap_or(false) && window.is_focused().unwrap_or(false) {
            let _ = window.hide();
            return;
        }
    }
    open_quick(app);
}

fn open_quick<R: Runtime>(app: &AppHandle<R>) {
    let (clipboard_text, clipboard_truncated) = read_clipboard(app);
    let context = QuickContext {
        clipboard_text,
        clipboard_truncated,
        opened_at: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as i64)
            .unwrap_or_default(),
    };
    *lock(&app.state::<QuickState>().pending) = Some(context);
    match quick_window(app) {
        Ok(window) => {
            let _ = window.center();
            let _ = window.show();
            let _ = window.set_focus();
            // An already-loaded Quick bar re-reads its context on this event.
            let _ = window.emit("quick:opened", ());
        }
        Err(e) => eprintln!("[quick] cannot open the Quick bar: {e}"),
    }
}

// ── tray ──

fn set_tray<R: Runtime>(app: &AppHandle<R>, on: bool) -> tauri::Result<()> {
    if !on {
        let _ = app.remove_tray_by_id(TRAY_ID);
        return Ok(());
    }
    if app.tray_by_id(TRAY_ID).is_some() {
        return Ok(());
    }
    let open = MenuItem::with_id(app, "tray-open", "Open Mali Cowork", true, None::<&str>)?;
    let quick = MenuItem::with_id(app, "tray-quick", "Quick bar", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "tray-quit", "Quit Mali Cowork", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &quick, &quit])?;
    let mut tray = TrayIconBuilder::with_id(TRAY_ID)
        .tooltip("Mali Cowork")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "tray-open" => show_main(app),
            "tray-quick" => open_quick(app),
            "tray-quit" => app.exit(0),
            _ => {}
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}

// ── commands ──

/// Apply Settings → Shortcuts. The frontend owns the saved config and calls
/// this at startup and on every change; the result says whether the shortcut
/// is actually live, so the UI can show a clash instead of failing silently.
#[tauri::command]
pub fn quick_configure<R: Runtime>(app: AppHandle<R>, config: QuickConfig) -> Result<QuickStatus, String> {
    let state = app.state::<QuickState>();
    let shortcuts = app.global_shortcut();
    if let Some(old) = lock(&state.registered).take() {
        let _ = shortcuts.unregister(old);
    }
    set_tray(&app, config.tray_mode).map_err(|e| format!("Cannot show the tray icon: {e}"))?;
    *lock(&state.config) = config.clone();

    if !config.enabled {
        return Ok(QuickStatus { registered: false, shortcut: config.shortcut, error: None });
    }
    let parsed = match config.shortcut.parse::<Shortcut>() {
        Ok(parsed) => parsed,
        Err(e) => {
            return Ok(QuickStatus {
                registered: false,
                shortcut: config.shortcut,
                error: Some(format!("Not a valid shortcut: {e}")),
            })
        }
    };
    match shortcuts.register(parsed) {
        Ok(()) => {
            *lock(&state.registered) = Some(parsed);
            Ok(QuickStatus { registered: true, shortcut: config.shortcut, error: None })
        }
        Err(e) => Ok(QuickStatus {
            registered: false,
            shortcut: config.shortcut,
            error: Some(format!("Another app may already use this shortcut ({e})")),
        }),
    }
}

/// The context captured at the last shortcut press, once. Only the Quick bar
/// window may take it.
#[tauri::command]
pub fn quick_take_context<R: Runtime>(window: WebviewWindow<R>) -> Result<QuickContext, String> {
    if window.label() != QUICK_LABEL {
        return Err("Only the Quick bar can read its context".into());
    }
    Ok(lock(&window.state::<QuickState>().pending).take().unwrap_or_default())
}

/// Esc, or after Copy.
#[tauri::command]
pub fn quick_hide<R: Runtime>(app: AppHandle<R>) {
    if let Some(window) = app.get_webview_window(QUICK_LABEL) {
        let _ = window.hide();
    }
}

/// "Open in Mali": bring the main window up on that chat.
#[tauri::command]
pub fn quick_open_main<R: Runtime>(app: AppHandle<R>, chat_id: Option<String>) {
    quick_hide(app.clone());
    show_main(&app);
    if let Some(chat_id) = chat_id {
        let _ = app.emit_to(MAIN_LABEL, "quick:open-chat", chat_id);
    }
}

/// Let the user drag a region of the screen and attach it. Resolves `None`
/// when they press Esc. The Quick bar hides while they pick, then comes back.
#[tauri::command]
pub async fn quick_capture_screen<R: Runtime>(app: AppHandle<R>) -> Result<Option<Attachment>, String> {
    let quick = app.get_webview_window(QUICK_LABEL);
    if let Some(window) = &quick {
        let _ = window.hide();
    }
    let result = capture_region().await;
    if let Some(window) = &quick {
        let _ = window.show();
        let _ = window.set_focus();
    }
    result
}

#[cfg(target_os = "macos")]
async fn capture_region() -> Result<Option<Attachment>, String> {
    let path = std::env::temp_dir().join(format!("mali-capture-{}.png", uuid::Uuid::new_v4().simple()));
    // -i: the user drags a region (Esc cancels) · -x: no shutter sound.
    // The first capture asks for Screen Recording permission.
    let status = tokio::process::Command::new("/usr/sbin/screencapture")
        .arg("-i")
        .arg("-x")
        .arg(&path)
        .status()
        .await
        .map_err(|e| format!("Cannot start screen capture: {e}"))?;
    if !status.success() || !path.exists() {
        return Ok(None);
    }
    let attachment = attachment_import(path.to_string_lossy().into_owned());
    let _ = std::fs::remove_file(&path);
    attachment.map(Some)
}

#[cfg(not(target_os = "macos"))]
async fn capture_region() -> Result<Option<Attachment>, String> {
    Err("Screen capture from the Quick bar is macOS-only for now.".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_shortcut_parses() {
        assert!(DEFAULT_SHORTCUT.parse::<Shortcut>().is_ok());
    }

    #[test]
    fn default_config_keeps_the_app_quitting_on_close() {
        let config = QuickConfig::default();
        assert!(config.enabled);
        assert!(!config.tray_mode);
    }
}
