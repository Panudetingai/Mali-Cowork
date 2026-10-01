//! Notch pill: a small always-on-top window that mirrors what the agent is
//! doing while the main window is away — the step it is on, its team, an
//! approval with Allow / Deny, then a done state that opens the chat.
//!
//! The main window drives it (`features/notch/relay.ts`): it watches its own
//! run store and shows or hides the pill. The pill's page owns its shape: it
//! animates inside the window and sizes the window to fit (`notch_resize`).
//!
//! On a Mac the window sits at the very top of the screen, above the menu
//! bar, so the pill grows out of the notch; without a notch it hangs from
//! the menu bar the same way. On Windows it hangs from the top of the work
//! area.
//!
//! Notch mode puts the main window away and keeps the pill at the top for
//! good: ⌥⌘M (the Quick bar's shortcut) or the cursor at the top of the
//! screen opens it, ready to ask. See "notch mode" below.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, RwLock};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{
    AppHandle, Emitter, LogicalSize, Manager, PhysicalPosition, Position, Runtime, Size, WebviewUrl,
    WebviewWindow, WebviewWindowBuilder,
};

use super::quick::{show_main, MAIN_LABEL};

pub const NOTCH_LABEL: &str = "notch";
const GEOMETRY: &str = "notch:geometry";
const MODE: &str = "notch:mode";
const SUMMON: &str = "notch:summon";
const HOVER: &str = "notch:hover";
const INTRO: &str = "notch:intro";
/// Files are being dragged near the top of the screen (true), or not any more.
const DRAG: &str = "notch:drag";
/// The main window plays its way back in when notch mode ends.
const MAIN_RETURN: &str = "notch:main-return";
/// Before the page sizes it: about the collapsed pill.
const START_SIZE: (f64, f64) = (300.0, 38.0);

/// The notch (or menu bar) the pill hangs from, in logical pixels.
#[derive(Debug, Clone, Copy, Default, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NotchGeometry {
    /// The screen has a camera notch; the pill wraps around it.
    pub has_notch: bool,
    /// Width of the notch; 0 without one.
    pub notch_width: f64,
    /// Height of the menu bar (the notch's height on a notched Mac); 0 on Windows.
    pub bar_height: f64,
}

fn notch_window<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<WebviewWindow<R>> {
    if let Some(window) = app.get_webview_window(NOTCH_LABEL) {
        return Ok(window);
    }
    // Same bundle as the main window; main.tsx renders the pill for
    // `?window=notch` and skips the history load.
    let window = WebviewWindowBuilder::new(app, NOTCH_LABEL, WebviewUrl::App("index.html?window=notch".into()))
        .title("Mali Notch")
        .inner_size(START_SIZE.0, START_SIZE.1)
        .decorations(false)
        .resizable(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .visible_on_all_workspaces(true)
        .visible(false)
        // Showing the pill must not take the keyboard from what the user is
        // typing in; only an approval makes it focusable (`notch_resize`).
        .focused(false)
        .focusable(false)
        // A click on the pill acts even while Mali is in the background.
        .accept_first_mouse(true)
        .transparent(true)
        .background_color(tauri::window::Color(0, 0, 0, 0))
        // The page draws the shadow: a system shadow lags behind the
        // animated shape.
        .shadow(false)
        .build()?;
    #[cfg(target_os = "macos")]
    {
        let ns = window.clone();
        let _ = window.run_on_main_thread(move || mac::float_above_menu_bar(&ns));
    }
    Ok(window)
}

/// Top-center of the screen the cursor is on: the screen's top edge on a Mac
/// (the window is above the menu bar), the work area's top on Windows (below
/// a taskbar docked at the top).
fn place<R: Runtime>(app: &AppHandle<R>, window: &WebviewWindow<R>) {
    let Some((left, top, span)) = top_edge(app, None) else { return };
    let width = window.outer_size().map(|s| s.width as i32).unwrap_or(0);
    let x = left + (span - width) / 2;
    let _ = window.set_position(Position::Physical(PhysicalPosition { x, y: top }));
}

/// The top edge the pill hangs from on the screen holding `point` (else the
/// cursor), in physical pixels: its left, its top and its width.
fn top_edge<R: Runtime>(app: &AppHandle<R>, point: Option<(f64, f64)>) -> Option<(i32, i32, i32)> {
    let point = point.or_else(|| app.cursor_position().ok().map(|p| (p.x, p.y)));
    let monitor = point
        .and_then(|(x, y)| app.monitor_from_point(x, y).ok().flatten())
        .or_else(|| app.primary_monitor().ok().flatten())?;
    Some(if cfg!(target_os = "macos") {
        (monitor.position().x, monitor.position().y, monitor.size().width as i32)
    } else {
        let area = monitor.work_area();
        (area.position.x, area.position.y, area.size.width as i32)
    })
}

/// AppKit is only read on the main thread; the commands that ask run off it.
/// When the screen can't be read, the last good reading stands.
async fn geometry<R: Runtime>(window: &WebviewWindow<R>) -> NotchGeometry {
    #[cfg(target_os = "macos")]
    let read = {
        let (tx, rx) = tokio::sync::oneshot::channel();
        let ns = window.clone();
        match window.run_on_main_thread(move || {
            let _ = tx.send(mac::geometry(&ns));
        }) {
            Ok(()) => rx.await.ok().flatten(),
            Err(_) => None,
        }
    };
    #[cfg(not(target_os = "macos"))]
    let read = Some(NotchGeometry::default());
    let state = window.state::<NotchState>();
    let mut last = state.geometry.lock().unwrap();
    if let Some(read) = read {
        if *last != Some(read) {
            eprintln!("[notch] screen: {read:?}");
        }
        *last = Some(read);
    }
    last.unwrap_or_default()
}

/// Bring the pill up: above the menu bar again (in case anything lowered
/// it), then tell the page which notch it is under now, since the pill may
/// have moved to another screen.
fn show_pill<R: Runtime>(window: &WebviewWindow<R>) {
    #[cfg(target_os = "macos")]
    {
        let ns = window.clone();
        let _ = window.run_on_main_thread(move || mac::float_above_menu_bar(&ns));
    }
    // Clicks go through until the cursor is on the pill itself.
    let _ = window.set_ignore_cursor_events(true);
    window.state::<NotchState>().inside.store(false, Ordering::SeqCst);
    let _ = window.show();
    watch_cursor(window.app_handle().clone());
    let window = window.clone();
    tauri::async_runtime::spawn(async move {
        let geometry = geometry(&window).await;
        let _ = window.emit(GEOMETRY, geometry);
    });
}

/// Show the pill (placing it on the cursor's screen if it was hidden) and
/// tell its page which notch it hangs from. `focus` is for an approval
/// waiting on Y / N.
///
/// Async: creating a window from a synchronous command deadlocks on Windows.
#[tauri::command]
pub async fn notch_show<R: Runtime>(app: AppHandle<R>, focus: Option<bool>) -> Result<NotchGeometry, String> {
    let window = notch_window(&app).map_err(|e| format!("Cannot open the notch pill: {e}"))?;
    if !window.is_visible().unwrap_or(false) {
        place(&app, &window);
    }
    let focus = focus.unwrap_or(false);
    if focus {
        let _ = window.set_focusable(true);
    }
    show_pill(&window);
    if focus {
        let _ = window.set_focus();
    }
    let geometry = geometry(&window).await;
    let _ = window.emit(GEOMETRY, geometry);
    Ok(geometry)
}

#[tauri::command]
pub fn notch_hide<R: Runtime>(app: AppHandle<R>) {
    if let Some(window) = app.get_webview_window(NOTCH_LABEL) {
        let _ = window.hide();
    }
}

/// The page asks for the notch it hangs from when it loads.
#[tauri::command]
pub async fn notch_geometry<R: Runtime>(app: AppHandle<R>) -> NotchGeometry {
    match app.get_webview_window(NOTCH_LABEL) {
        Some(window) => geometry(&window).await,
        None => NotchGeometry::default(),
    }
}

/// Size the window, keeping it centered under the notch and against the top.
/// The page asks only when the notch changes: the pill animates inside a
/// window of fixed size, because resizing a web view blanks it for a moment
/// (the flicker). `focusable` is on only while the pill wants keys.
#[tauri::command]
pub fn notch_resize<R: Runtime>(app: AppHandle<R>, width: f64, height: f64, focusable: Option<bool>) {
    let Some(window) = app.get_webview_window(NOTCH_LABEL) else { return };
    if let Some(focusable) = focusable {
        let _ = window.set_focusable(focusable);
    }
    let scale = window.scale_factor().unwrap_or(1.0);
    if let Ok(size) = window.inner_size() {
        let same = (size.width as f64 / scale - width).abs() < 1.0 && (size.height as f64 / scale - height).abs() < 1.0;
        if same {
            return;
        }
    }
    // On a Mac the frame changes in one step: moving, then resizing, shows a
    // frame where the pill sits off-center, which reads as a flicker.
    #[cfg(target_os = "macos")]
    {
        let ns = window.clone();
        let _ = window.run_on_main_thread(move || mac::set_frame(&ns, width, height));
    }
    #[cfg(not(target_os = "macos"))]
    {
        let scale = window.scale_factor().unwrap_or(1.0);
        if let (Ok(pos), Ok(size)) = (window.outer_position(), window.outer_size()) {
            let center = pos.x + size.width as i32 / 2;
            let x = center - (width * scale).round() as i32 / 2;
            let _ = window.set_position(Position::Physical(PhysicalPosition { x, y: pos.y }));
        }
        let _ = window.set_size(Size::Logical(LogicalSize { width, height }));
    }
}

/// Where the pill is in its window (logical pixels). Outside it, the window
/// lets clicks through to the apps below (`watch_cursor`).
#[tauri::command]
pub fn notch_hit_area<R: Runtime>(app: AppHandle<R>, x: f64, y: f64, width: f64, height: f64) {
    *app.state::<NotchState>().hit.write().unwrap() = Some(Area { x, y, width, height });
}

#[derive(Debug, Clone, Copy)]
struct Area {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

// ── capture ──

/// A window captured for the ask box: the picture, and whose window it was.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Capture {
    pub attachment: super::attachments::Attachment,
    pub app: String,
    pub title: String,
}

/// A file name people can read in the ask box: "Warp — README.md.png".
fn capture_name(app: &str, title: &str) -> String {
    let base = match (app.trim(), title.trim()) {
        ("", "") => "Screen capture".to_string(),
        (app, "") => app.to_string(),
        ("", title) => title.to_string(),
        (app, title) => format!("{app} — {title}"),
    };
    let clean: String = base
        .chars()
        .map(|c| if matches!(c, '/' | '\\' | ':' | '\n' | '\r') { ' ' } else { c })
        .take(60)
        .collect();
    format!("{}.png", clean.trim())
}

async fn screencapture(args: &[String], name: &str) -> Result<Option<super::attachments::Attachment>, String> {
    // Its own folder, so the file can carry a readable name without clashing.
    let dir = std::env::temp_dir().join(format!("mali-notch-{}", uuid::Uuid::new_v4().simple()));
    std::fs::create_dir_all(&dir).map_err(|e| format!("Cannot save the capture: {e}"))?;
    let path = dir.join(name);
    let status = tokio::process::Command::new("/usr/sbin/screencapture")
        .args(args)
        .arg(&path)
        .status()
        .await
        .map_err(|e| format!("Cannot start screen capture: {e}"))?;
    if !status.success() || !path.exists() {
        return Ok(None);
    }
    let attachment = super::attachments::attachment_import(path.to_string_lossy().into_owned());
    let _ = std::fs::remove_dir_all(&dir);
    attachment.map(Some)
}

/// The bot was dragged out of the notch and let go: capture the window it
/// was dropped on. `None` when it was dropped back on the notch.
#[tauri::command]
pub async fn notch_capture_at_cursor<R: Runtime>(app: AppHandle<R>) -> Result<Option<Capture>, String> {
    if app.state::<NotchState>().inside.load(Ordering::SeqCst) {
        return Ok(None);
    }
    #[cfg(target_os = "macos")]
    {
        let window = app.get_webview_window(NOTCH_LABEL).ok_or("The notch isn't open")?;
        let (tx, rx) = tokio::sync::oneshot::channel();
        window
            .run_on_main_thread(move || {
                let under = objc2::MainThreadMarker::new().and_then(mac::cursor_point).and_then(mac::window_at);
                let _ = tx.send(under);
            })
            .map_err(|e| e.to_string())?;
        let under = rx.await.map_err(|e| e.to_string())?.ok_or("There's no window there to capture")?;
        let name = capture_name(&under.app, &under.title);
        let attachment = screencapture(&["-x".into(), "-o".into(), format!("-l{}", under.number)], &name)
            .await?
            .ok_or("macOS didn't capture the window — allow Mali in System Settings → Privacy → Screen Recording")?;
        Ok(Some(Capture { attachment, app: under.app, title: under.title }))
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        Err("Capturing a window by dropping the bot works on macOS for now".into())
    }
}

/// The camera button: pick a window (Space switches to a region), Esc cancels.
#[tauri::command]
pub async fn notch_capture_pick() -> Result<Option<Capture>, String> {
    #[cfg(target_os = "macos")]
    {
        let attachment =
            screencapture(&["-i".into(), "-W".into(), "-x".into(), "-o".into()], &capture_name("", "")).await?;
        Ok(attachment.map(|attachment| Capture { attachment, app: String::new(), title: String::new() }))
    }
    #[cfg(not(target_os = "macos"))]
    Err("Picking a window works on macOS for now; use the Quick bar's capture".into())
}

// ── notch mode ──

#[derive(Default)]
pub struct NotchState {
    on: AtomicBool,
    watching: AtomicBool,
    /// Where the main window shrank to, for the pill's fly-in; taken once.
    intro: Mutex<Option<Point>>,
    /// The last notch read from the screen.
    geometry: Mutex<Option<NotchGeometry>>,
    /// The pill's area in its window; the rest lets clicks through.
    hit: RwLock<Option<Area>>,
    /// The cursor is on the pill (it takes clicks) — as last told to the window.
    inside: AtomicBool,
}

/// A point in the pill's window, in logical pixels.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
pub struct Point {
    pub x: f64,
    pub y: f64,
}

fn mode_on<R: Runtime>(app: &AppHandle<R>) -> bool {
    app.state::<NotchState>().on.load(Ordering::SeqCst)
}

fn set_mode<R: Runtime>(app: &AppHandle<R>, on: bool) {
    app.state::<NotchState>().on.store(on, Ordering::SeqCst);
    let _ = app.emit_to(NOTCH_LABEL, MODE, on);
    let _ = app.emit_to(MAIN_LABEL, MODE, on);
}

/// Put the main window away and keep the pill at the top. `from` is where
/// the main window shrank to (physical screen pixels): the pill's window
/// covers the screen down to it for a moment, without taking clicks, so the
/// dot can fly up into the notch.
#[tauri::command]
pub async fn notch_enter_mode<R: Runtime>(app: AppHandle<R>, from: Option<Point>) -> Result<NotchGeometry, String> {
    if let Some(main) = app.get_webview_window(MAIN_LABEL) {
        let _ = main.hide();
    }
    let window = notch_window(&app).map_err(|e| format!("Cannot open the notch pill: {e}"))?;
    let edge = top_edge(&app, from.map(|p| (p.x, p.y)));
    let scale = window.scale_factor().unwrap_or(1.0);
    if let (Some(from), Some((left, top, span))) = (from, edge) {
        let below = ((from.y - top as f64) / scale + 80.0).max(120.0);
        let _ = window.set_ignore_cursor_events(true);
        let _ = window.set_position(Position::Physical(PhysicalPosition { x: left, y: top }));
        let _ = window.set_size(Size::Logical(LogicalSize { width: span as f64 / scale, height: below }));
        *app.state::<NotchState>().intro.lock().unwrap() =
            Some(Point { x: (from.x - left as f64) / scale, y: (from.y - top as f64) / scale });
    } else {
        place(&app, &window);
    }
    let _ = window.set_focusable(false);
    show_pill(&window);
    set_mode(&app, true);
    let _ = window.emit(INTRO, ());
    watch_cursor(app.clone());
    let geometry = geometry(&window).await;
    let _ = window.emit(GEOMETRY, geometry);
    Ok(geometry)
}

/// The fly-in's starting point, once; the page asks when it loads or is told.
#[tauri::command]
pub fn notch_take_intro<R: Runtime>(app: AppHandle<R>) -> Option<Point> {
    app.state::<NotchState>().intro.lock().unwrap().take()
}

#[tauri::command]
pub fn notch_mode<R: Runtime>(app: AppHandle<R>) -> bool {
    mode_on(&app)
}

/// Back to the app: the main window comes up (on `chat_id` if given).
#[tauri::command]
pub fn notch_exit_mode<R: Runtime>(app: AppHandle<R>, chat_id: Option<String>) {
    set_mode(&app, false);
    notch_hide(app.clone());
    let _ = app.emit_to(MAIN_LABEL, MAIN_RETURN, ());
    show_main(&app);
    if let Some(chat_id) = chat_id {
        let _ = app.emit_to(MAIN_LABEL, "quick:open-chat", chat_id);
    }
}

/// The relay's "nothing to show": hide, unless notch mode keeps the pill up.
#[tauri::command]
pub fn notch_release<R: Runtime>(app: AppHandle<R>) {
    if !mode_on(&app) {
        notch_hide(app);
    }
}

/// ⌥⌘M in notch mode: open the pill ready to type, or close it if it is.
/// Returns false outside notch mode, so the Quick bar opens instead.
pub fn summon<R: Runtime>(app: &AppHandle<R>) -> bool {
    if !mode_on(app) {
        return false;
    }
    let Ok(window) = notch_window(app) else { return false };
    if !window.is_visible().unwrap_or(false) {
        place(app, &window);
    }
    let _ = window.set_focusable(true);
    show_pill(&window);
    let _ = window.set_focus();
    let _ = window.emit(SUMMON, ());
    true
}

/// The main window came back by another way (the Dock, the tray): notch
/// mode is over; the relay hides the pill while the main window has focus.
pub fn main_focused<R: Runtime>(app: &AppHandle<R>) {
    if mode_on(app) {
        set_mode(app, false);
    }
}

/// While the pill is up (or notch mode keeps it ready), watch the cursor.
/// On the pill, the window takes clicks; off it, clicks go through to the
/// apps below, so the fixed-size window never gets in the way. The page is
/// told when the cursor enters or leaves (it can't see the mouse itself while
/// Mali isn't the active app). In notch mode, the cursor at the top of the
/// screen near the notch brings a hidden pill back.
/// Cursor poll while the pill is visible and the pointer is on it.
const POLL_ON_PILL_MS: u64 = 40;
/// Near the top strip (hover, drag-to-notch).
const POLL_NEAR_TOP_MS: u64 = 60;
/// Pill visible but the pointer is elsewhere on the screen.
const POLL_AWAY_MS: u64 = 120;
/// Pill hidden; notch mode waits for the pointer at the top edge.
const POLL_HIDDEN_MODE_MS: u64 = 90;

fn watch_cursor<R: Runtime>(app: AppHandle<R>) {
    if app.state::<NotchState>().watching.swap(true, Ordering::SeqCst) {
        return;
    }
    std::thread::spawn(move || {
        #[cfg(target_os = "macos")]
        let mut drags = mac::DragWatch::default();
        let mut dragging = false;
        let mut offered = false;
        let mut sleep_ms = POLL_NEAR_TOP_MS;
        loop {
            std::thread::sleep(Duration::from_millis(sleep_ms));
            let Some(window) = app.get_webview_window(NOTCH_LABEL) else {
                if mode_on(&app) {
                    sleep_ms = POLL_HIDDEN_MODE_MS;
                    continue;
                }
                break;
            };
            let visible = window.is_visible().unwrap_or(false);
            let Ok(cursor) = app.cursor_position() else {
                sleep_ms = POLL_AWAY_MS;
                continue;
            };
            let point = (cursor.x, cursor.y);
            let near_top_strip = cursor_near_top_strip(&app, point);
            #[cfg(target_os = "macos")]
            if dragging || near_top_strip || sleep_ms <= POLL_NEAR_TOP_MS {
                match drags.poll() {
                    Some(mac::Drag::Started) => dragging = true,
                    Some(mac::Drag::Ended) => dragging = false,
                    None => {}
                }
            }
            // Files dragged toward the top: open the drop zone while they're
            // still well below the edge, since a drag that reaches the edge
            // makes macOS open Mission Control instead.
            let near = dragging && near_top(&app, point);
            if near != offered && (visible || mode_on(&app)) {
                offered = near;
                if near && !visible {
                    place(&app, &window);
                    show_pill(&window);
                }
                let _ = window.emit(DRAG, near);
            }
            if !visible {
                if !mode_on(&app) {
                    break;
                }
                sleep_ms = POLL_HIDDEN_MODE_MS;
                if at_top(&app, point) {
                    place(&app, &window);
                    show_pill(&window);
                }
                continue;
            }
            let state = app.state::<NotchState>();
            let area = *state.hit.read().unwrap();
            let now = area.is_some_and(|area| on_pill(&window, area, point));
            if state.inside.swap(now, Ordering::SeqCst) != now {
                let _ = window.set_ignore_cursor_events(!now);
                let _ = window.emit(HOVER, now);
            }
            sleep_ms = if now {
                POLL_ON_PILL_MS
            } else if near_top_strip {
                POLL_NEAR_TOP_MS
            } else {
                POLL_AWAY_MS
            };
        }
        app.state::<NotchState>().watching.store(false, Ordering::SeqCst);
    });
}

/// The pointer is in the band under the menu bar where hover and drags matter.
fn cursor_near_top_strip<R: Runtime>(app: &AppHandle<R>, (x, y): (f64, f64)) -> bool {
    let Some((left, top, span)) = top_edge(app, Some((x, y))) else { return false };
    let scale = app
        .monitor_from_point(x, y)
        .ok()
        .flatten()
        .map(|m| m.scale_factor())
        .unwrap_or(1.0);
    let center = left as f64 + span as f64 / 2.0;
    y <= top as f64 + 280.0 * scale && (x - center).abs() <= 540.0 * scale
}

/// The upper part of the screen around the notch, where a file drag opens the drop zone.
fn near_top<R: Runtime>(app: &AppHandle<R>, (x, y): (f64, f64)) -> bool {
    let Some((left, top, span)) = top_edge(app, Some((x, y))) else { return false };
    let scale = app.monitor_from_point(x, y).ok().flatten().map(|m| m.scale_factor()).unwrap_or(1.0);
    let center = left as f64 + span as f64 / 2.0;
    y <= top as f64 + 260.0 * scale && (x - center).abs() <= 520.0 * scale
}

/// The strip along the top of the screen, around the notch.
fn at_top<R: Runtime>(app: &AppHandle<R>, (x, y): (f64, f64)) -> bool {
    let Some((left, top, span)) = top_edge(app, Some((x, y))) else { return false };
    let scale = app
        .monitor_from_point(x, y)
        .ok()
        .flatten()
        .map(|m| m.scale_factor())
        .unwrap_or(1.0);
    let center = left as f64 + span as f64 / 2.0;
    y <= top as f64 + 3.0 * scale && (x - center).abs() <= 220.0 * scale
}

/// The cursor (physical screen pixels) is on the pill's area of the window.
fn on_pill<R: Runtime>(window: &WebviewWindow<R>, area: Area, (x, y): (f64, f64)) -> bool {
    let (Ok(pos), Ok(scale)) = (window.inner_position(), window.scale_factor()) else { return false };
    let left = pos.x as f64 + area.x * scale;
    let top = pos.y as f64 + area.y * scale;
    x >= left && x <= left + area.width * scale && y >= top && y <= top + area.height * scale
}

/// The pill's chat, or its done state: bring the main window up on that chat.
#[tauri::command]
pub fn notch_open_main<R: Runtime>(app: AppHandle<R>, chat_id: Option<String>) {
    notch_hide(app.clone());
    show_main(&app);
    if let Some(chat_id) = chat_id {
        let _ = app.emit_to(MAIN_LABEL, "quick:open-chat", chat_id);
    }
}

/// The notch from what NSScreen reports, in points: the areas either side of
/// the camera leave its width. A gap that's missing, tiny or most of the
/// screen means no notch (an external display, a Mac without one). The bar
/// is the taller of the notch inset and the menu bar.
fn read_notch(width: f64, inset_top: f64, left: f64, right: f64, menu_bar: f64) -> NotchGeometry {
    let gap = width - left - right;
    let bar_height = inset_top.max(menu_bar).max(0.0);
    if left > 0.0 && right > 0.0 && gap > 40.0 && gap < width * 0.4 {
        NotchGeometry { has_notch: true, notch_width: gap, bar_height }
    } else {
        NotchGeometry { has_notch: false, notch_width: 0.0, bar_height }
    }
}

#[cfg(target_os = "macos")]
mod mac {
    use objc2::rc::Retained;
    use objc2::runtime::AnyObject;
    use objc2::MainThreadMarker;
    use objc2_app_kit::{
        NSEvent, NSMainMenuWindowLevel, NSPasteboard, NSPasteboardNameDrag, NSPasteboardTypeFileURL, NSScreen,
        NSWindow, NSWindowCollectionBehavior,
    };
    use objc2_foundation::{ns_string, NSArray, NSDictionary, NSNumber, NSPoint, NSRect, NSSize, NSString};

    /// Files being dragged anywhere on screen, seen from the drag pasteboard:
    /// it changes when a drag starts, while the mouse button is down.
    #[derive(Default)]
    pub struct DragWatch {
        baseline: Option<isize>,
        active: bool,
    }

    pub enum Drag {
        Started,
        Ended,
    }

    impl DragWatch {
        pub fn poll(&mut self) -> Option<Drag> {
            let pasteboard = unsafe { NSPasteboard::pasteboardWithName(NSPasteboardNameDrag) };
            let change = pasteboard.changeCount();
            let pressed = NSEvent::pressedMouseButtons() & 1 == 1;
            if !pressed {
                self.baseline = Some(change);
                if self.active {
                    self.active = false;
                    return Some(Drag::Ended);
                }
                return None;
            }
            if self.active || self.baseline == Some(change) {
                return None;
            }
            // A new drag. Only files open the drop zone (not text, nor the bot).
            self.baseline = Some(change);
            let files = pasteboard
                .types()
                .is_some_and(|types| types.containsObject(unsafe { NSPasteboardTypeFileURL }));
            if files {
                self.active = true;
                return Some(Drag::Started);
            }
            None
        }
    }

    /// A window the user can see and capture: its number, app and title.
    pub struct Under {
        pub number: i64,
        pub app: String,
        pub title: String,
    }

    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGWindowListCopyWindowInfo(option: u32, relative_to: u32) -> *mut AnyObject;
    }
    const ON_SCREEN_ONLY: u32 = 1 << 0;
    const EXCLUDE_DESKTOP: u32 = 1 << 4;

    fn number(dict: &NSDictionary<NSString, AnyObject>, key: &NSString) -> Option<f64> {
        dict.objectForKey(key)?.downcast::<NSNumber>().ok().map(|n| n.doubleValue())
    }

    fn text(dict: &NSDictionary<NSString, AnyObject>, key: &NSString) -> String {
        dict.objectForKey(key)
            .and_then(|v| v.downcast::<NSString>().ok())
            .map(|s| s.to_string())
            .unwrap_or_default()
    }

    /// The cursor in global points, top-left origin (as window bounds are).
    pub fn cursor_point(mtm: MainThreadMarker) -> Option<(f64, f64)> {
        let at = NSEvent::mouseLocation();
        let screens = NSScreen::screens(mtm);
        if screens.count() == 0 {
            return None;
        }
        let primary = screens.objectAtIndex(0).frame();
        Some((at.x, primary.size.height - at.y))
    }

    /// The front-most ordinary window under a point, not Mali's own.
    pub fn window_at((x, y): (f64, f64)) -> Option<Under> {
        let raw = unsafe { CGWindowListCopyWindowInfo(ON_SCREEN_ONLY | EXCLUDE_DESKTOP, 0) };
        // SAFETY: a CFArray of CFDictionary, handed over retained (+1); both
        // are toll-free bridged to NSArray / NSDictionary.
        let list: Retained<NSArray<NSDictionary<NSString, AnyObject>>> = unsafe { Retained::from_raw(raw.cast())? };
        let own = std::process::id() as f64;
        (0..list.count()).find_map(|i| {
            let info = list.objectAtIndex(i);
            if number(&info, ns_string!("kCGWindowLayer")) != Some(0.0)
                || number(&info, ns_string!("kCGWindowOwnerPID")) == Some(own)
            {
                return None;
            }
            let bounds = info.objectForKey(ns_string!("kCGWindowBounds"))?;
            // SAFETY: kCGWindowBounds is a CFDictionary of numbers.
            let bounds: Retained<NSDictionary<NSString, AnyObject>> = unsafe { Retained::cast_unchecked(bounds) };
            let (bx, by) = (number(&bounds, ns_string!("X"))?, number(&bounds, ns_string!("Y"))?);
            let (bw, bh) = (number(&bounds, ns_string!("Width"))?, number(&bounds, ns_string!("Height"))?);
            if x < bx || x > bx + bw || y < by || y > by + bh || bw < 40.0 || bh < 40.0 {
                return None;
            }
            Some(Under {
                number: number(&info, ns_string!("kCGWindowNumber"))? as i64,
                app: text(&info, ns_string!("kCGWindowOwnerName")),
                title: text(&info, ns_string!("kCGWindowName")),
            })
        })
    }
    use tauri::{Runtime, WebviewWindow};

    use super::NotchGeometry;

    /// AppKit objects are only touched on the main thread (callers use
    /// `run_on_main_thread`); off it this finds nothing.
    fn ns_window<R: Runtime>(window: &WebviewWindow<R>) -> Option<&NSWindow> {
        MainThreadMarker::new()?;
        let ptr = window.ns_window().ok()?;
        // SAFETY: Tauri hands back the live NSWindow behind this window, and
        // we are on the main thread (checked above).
        unsafe { (ptr as *const NSWindow).as_ref() }
    }

    /// Above the menu bar, so the pill can grow out of the notch, on every
    /// Space and over full-screen apps, and never in the ⌘` window cycle.
    ///
    /// Transient, not Stationary: a Stationary window is drawn with the
    /// desktop, so Mission Control (and its Spaces bar opening and closing)
    /// zoomed and dimmed the pill along with it, which flickered. A Transient
    /// window simply steps aside while Mission Control is up.
    pub fn float_above_menu_bar<R: Runtime>(window: &WebviewWindow<R>) {
        let Some(ns_window) = ns_window(window) else { return };
        ns_window.setLevel(NSMainMenuWindowLevel + 2);
        ns_window.setCollectionBehavior(
            NSWindowCollectionBehavior::CanJoinAllSpaces
                | NSWindowCollectionBehavior::Transient
                | NSWindowCollectionBehavior::FullScreenAuxiliary
                | NSWindowCollectionBehavior::IgnoresCycle,
        );
        // Never draggable: a window dragged to the top edge opens Mission Control.
        ns_window.setMovable(false);
    }

    /// Resize keeping the top edge and the horizontal center, in one step.
    /// Cocoa frames start at the bottom left, in points.
    pub fn set_frame<R: Runtime>(window: &WebviewWindow<R>, width: f64, height: f64) {
        let Some(ns_window) = ns_window(window) else { return };
        let frame = ns_window.frame();
        let top = frame.origin.y + frame.size.height;
        let center = frame.origin.x + frame.size.width / 2.0;
        let next = NSRect::new(NSPoint::new(center - width / 2.0, top - height), NSSize::new(width, height));
        ns_window.setFrame_display(next, true);
    }

    /// The screen's top safe-area inset is the notch's height; the areas
    /// either side of it leave its width. Without a notch, the menu bar's
    /// height is the gap between the frame and the visible frame.
    pub fn geometry<R: Runtime>(window: &WebviewWindow<R>) -> Option<NotchGeometry> {
        let mtm = MainThreadMarker::new()?;
        // A window that was never on screen has no screen yet: use the main one.
        let screen = ns_window(window).and_then(|w| w.screen()).or_else(|| NSScreen::mainScreen(mtm))?;
        let frame = screen.frame();
        let visible = screen.visibleFrame();
        let menu_bar = (frame.origin.y + frame.size.height) - (visible.origin.y + visible.size.height);
        Some(super::read_notch(
            frame.size.width,
            screen.safeAreaInsets().top,
            screen.auxiliaryTopLeftArea().size.width,
            screen.auxiliaryTopRightArea().size.width,
            menu_bar,
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn captures_get_names_people_can_read() {
        assert_eq!(capture_name("Warp", "README.md"), "Warp — README.md.png");
        assert_eq!(capture_name("Arc", ""), "Arc.png");
        assert_eq!(capture_name("", ""), "Screen capture.png");
        assert_eq!(capture_name("Finder", "a/b: c"), "Finder — a b  c.png");
    }

    #[test]
    fn a_notched_macbook_reads_its_notch() {
        // MacBook Air 13": 1470pt wide, the camera between two 642pt areas.
        let g = read_notch(1470.0, 32.0, 642.5, 642.5, 32.0);
        assert!(g.has_notch);
        assert_eq!(g.notch_width, 185.0);
        assert_eq!(g.bar_height, 32.0);
    }

    #[test]
    fn a_screen_without_a_notch_has_none() {
        // External display: no areas either side, a 24pt menu bar.
        let g = read_notch(2560.0, 0.0, 0.0, 0.0, 24.0);
        assert!(!g.has_notch);
        assert_eq!(g.bar_height, 24.0);
        // Nonsense areas (most of the screen "between") aren't a notch either.
        assert!(!read_notch(1470.0, 32.0, 100.0, 100.0, 32.0).has_notch);
    }

    #[test]
    fn geometry_reads_as_the_page_expects() {
        let json = serde_json::to_value(NotchGeometry { has_notch: true, notch_width: 185.0, bar_height: 32.0 }).unwrap();
        assert_eq!(json["hasNotch"], true);
        assert_eq!(json["notchWidth"], 185.0);
        assert_eq!(json["barHeight"], 32.0);
    }
}
