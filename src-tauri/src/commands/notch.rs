//! Notch pill: a small always-on-top window that mirrors what the agent is
//! doing while the main window is away — the step it is on, its team, an
//! approval with Allow / Deny, then a done state that opens the chat.
//!
//! The main window drives it (`features/notch/relay.ts`): it watches its own
//! run store and shows or hides the pill. The pill's page owns its shape: it
//! animates inside a window of fixed size (`notch_resize`), and only the
//! pill's own area takes clicks (`notch_hit_area`).
//!
//! On a Mac the window sits at the very top of the screen, above the menu
//! bar, so the pill grows out of the notch; without a notch it hangs from
//! the menu bar the same way. On Windows it hangs from the top of the work
//! area.
//!
//! With more than one screen the pill lives on one of them (Settings →
//! Notch): the one the pointer is on (it follows you across), the Mac's own
//! display, or the main display. Screens plugged in or out move it.
//!
//! Notch mode puts the main window away and keeps the pill at the top for
//! good: ⌥⌘M (the Quick bar's shortcut) or the cursor at the top of the
//! screen opens it, ready to ask. Mali can also start that way at login
//! (`--notch`) and stay there until the app is opened. See "notch mode".

use std::sync::atomic::{AtomicBool, AtomicU64, AtomicU8, Ordering};
use std::sync::{Mutex, RwLock};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, Runtime, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

use super::quick::{show_main, MAIN_LABEL};

pub const NOTCH_LABEL: &str = "notch";
const GEOMETRY: &str = "notch:geometry";
const MODE: &str = "notch:mode";
const SUMMON: &str = "notch:summon";
const HOVER: &str = "notch:hover";
const INTRO: &str = "notch:intro";
/// Files are being dragged near the top of the screen (true), or not any more.
const DRAG: &str = "notch:drag";
/// The pill moved to another screen: the page plays its arrival.
const MOVED: &str = "notch:moved";
/// The app was asked for (the Dock, the tray): the pill drops into it.
const OPEN_APP: &str = "notch:open-app";
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

// ── screens ──

/// A rectangle in screen units: points on a Mac, in CoreGraphics' global
/// space (top-left origin, one space across displays of any scale), and
/// physical pixels elsewhere.
#[derive(Debug, Clone, Copy, Default, PartialEq)]
struct Rect {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

impl Rect {
    fn contains(&self, (x, y): (f64, f64)) -> bool {
        x >= self.x && x < self.x + self.width && y >= self.y && y < self.y + self.height
    }

    fn center(&self) -> (f64, f64) {
        (self.x + self.width / 2.0, self.y + self.height / 2.0)
    }
}

/// A screen the pill can hang from: the whole display on a Mac (the pill
/// sits over the menu bar), the work area elsewhere.
#[derive(Debug, Clone, Copy, PartialEq)]
struct Screen {
    id: u64,
    area: Rect,
    /// Screen units per logical pixel: 1 on a Mac, the scale elsewhere.
    unit: f64,
    /// The Mac's own display, the one with the notch.
    builtin: bool,
    /// The display with the menu bar (the primary one on Windows).
    main: bool,
}

/// Which screen the pill lives on (Settings → Notch).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ScreenPref {
    /// The screen the pointer is on: the pill follows you across.
    #[default]
    Follow,
    /// The Mac's own display (with the notch), else the main one.
    Builtin,
    /// The display with the menu bar.
    Main,
}

impl ScreenPref {
    fn from_u8(value: u8) -> Self {
        match value {
            1 => Self::Builtin,
            2 => Self::Main,
            _ => Self::Follow,
        }
    }

    fn to_u8(self) -> u8 {
        match self {
            Self::Follow => 0,
            Self::Builtin => 1,
            Self::Main => 2,
        }
    }
}

fn screen_at(screens: &[Screen], point: (f64, f64)) -> Option<Screen> {
    screens.iter().find(|s| s.area.contains(point)).copied()
}

/// Where the pill belongs: under the pointer, on the Mac's own display, or
/// on the main one — whichever is there.
fn home_screen(screens: &[Screen], pref: ScreenPref, cursor: Option<(f64, f64)>) -> Option<Screen> {
    let main = || screens.iter().find(|s| s.main).or(screens.first()).copied();
    match pref {
        ScreenPref::Follow => cursor.and_then(|c| screen_at(screens, c)).or_else(main),
        ScreenPref::Builtin => screens.iter().find(|s| s.builtin).copied().or_else(main),
        ScreenPref::Main => main(),
    }
}

/// The pill's window on `screen`: centered, against the top edge.
fn frame_on(screen: &Screen, (width, height): (f64, f64)) -> Rect {
    let (width, height) = (width * screen.unit, height * screen.unit);
    Rect { x: screen.area.x + (screen.area.width - width) / 2.0, y: screen.area.y, width, height }
}

/// The pointer is near the top of `screen`, around its middle: within
/// `half` logical pixels either side and `depth` down.
fn near_top(screen: &Screen, (x, y): (f64, f64), half: f64, depth: f64) -> bool {
    let center = screen.area.x + screen.area.width / 2.0;
    y >= screen.area.y && y <= screen.area.y + depth * screen.unit && (x - center).abs() <= half * screen.unit
}

/// The strip along the top of the screen, around the notch: reaching for it
/// brings the pill.
fn at_top(screen: &Screen, point: (f64, f64)) -> bool {
    near_top(screen, point, 220.0, 3.0)
}

/// The top of `screen` at `x` is the edge of the desktop: no screen above
/// it. With one above, the pointer passes through on its way up, so reaching
/// the top there takes a moment's pause instead (`REACH_DWELL`).
fn edge_open(screens: &[Screen], screen: &Screen, (x, _): (f64, f64)) -> bool {
    let above = (x, screen.area.y - 1.0);
    !screens.iter().any(|s| s.id != screen.id && s.area.contains(above))
}

/// Where the pill's own area is, in screen units.
fn pill_rect(frame: Rect, unit: f64, area: Area) -> Rect {
    Rect { x: frame.x + area.x * unit, y: frame.y + area.y * unit, width: area.width * unit, height: area.height * unit }
}

#[cfg(target_os = "macos")]
fn screens<R: Runtime>(_app: &AppHandle<R>) -> Vec<Screen> {
    mac::screens()
}

/// Monitors from the window system (a call to the event loop: the watch
/// asks about once a second).
#[cfg(not(target_os = "macos"))]
fn screens<R: Runtime>(app: &AppHandle<R>) -> Vec<Screen> {
    use std::hash::{Hash, Hasher};
    let primary = app.primary_monitor().ok().flatten().map(|m| *m.position());
    app.available_monitors()
        .unwrap_or_default()
        .iter()
        .map(|m| {
            let mut hash = std::collections::hash_map::DefaultHasher::new();
            m.name().hash(&mut hash);
            (m.position().x, m.position().y).hash(&mut hash);
            let work = m.work_area();
            Screen {
                id: hash.finish(),
                area: Rect {
                    x: work.position.x as f64,
                    y: work.position.y as f64,
                    width: work.size.width as f64,
                    height: work.size.height as f64,
                },
                unit: m.scale_factor(),
                builtin: false,
                main: primary == Some(*m.position()),
            }
        })
        .collect()
}

/// The pointer, in screen units. On a Mac from CoreGraphics, from any thread
/// and without waking the main one.
fn cursor<R: Runtime>(app: &AppHandle<R>) -> Option<(f64, f64)> {
    #[cfg(target_os = "macos")]
    {
        let _ = app;
        mac::cursor()
    }
    #[cfg(not(target_os = "macos"))]
    app.cursor_position().ok().map(|p| (p.x, p.y))
}

// ── the window ──

fn notch_window<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<WebviewWindow<R>> {
    if let Some(window) = app.get_webview_window(NOTCH_LABEL) {
        return Ok(window);
    }
    // Same bundle as the main window; main.tsx renders the pill for
    // `?window=notch` and loads only the pill's code.
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

/// Move and size a window in screen units, in one step.
fn apply_frame<R: Runtime>(window: &WebviewWindow<R>, rect: Rect) {
    #[cfg(target_os = "macos")]
    {
        let ns = window.clone();
        let _ = window.run_on_main_thread(move || mac::set_frame(&ns, rect));
    }
    #[cfg(not(target_os = "macos"))]
    {
        use tauri::{PhysicalPosition, PhysicalSize, Position, Size};
        let _ = window.set_position(Position::Physical(PhysicalPosition { x: rect.x.round() as i32, y: rect.y.round() as i32 }));
        let _ = window.set_size(Size::Physical(PhysicalSize {
            width: rect.width.round() as u32,
            height: rect.height.round() as u32,
        }));
    }
}

/// Hang the pill from `screen` at the size the page asked for.
fn put<R: Runtime>(window: &WebviewWindow<R>, screen: Screen) {
    let state = window.state::<NotchState>();
    let frame = {
        let mut placed = state.placed.lock().unwrap();
        placed.screen = Some(screen);
        placed.frame = frame_on(&screen, placed.size);
        placed.stretched = false;
        placed.frame
    };
    apply_frame(window, frame);
}

/// Cover part of the screen for an animation (the fly-in, the drop into the
/// app); clicks go through it meanwhile.
fn stretch<R: Runtime>(window: &WebviewWindow<R>, rect: Rect) {
    let state = window.state::<NotchState>();
    let _ = window.set_ignore_cursor_events(true);
    state.inside.store(false, Ordering::SeqCst);
    {
        let mut placed = state.placed.lock().unwrap();
        placed.frame = rect;
        placed.stretched = true;
    }
    apply_frame(window, rect);
}

/// Back to the pill's own frame after an animation, on the screen it was on.
fn unstretch<R: Runtime>(window: &WebviewWindow<R>) {
    let placed = window.state::<NotchState>().placed.lock().unwrap().clone();
    if let (true, Some(screen)) = (placed.stretched, placed.screen) {
        put(window, screen);
    }
}

/// To another screen: the page hears the new notch and plays the arrival.
fn move_to<R: Runtime>(window: &WebviewWindow<R>, screen: Screen) {
    put(window, screen);
    let _ = window.emit(MOVED, ());
    emit_geometry(window);
}

/// The screen the pill should be on now, for showing it.
fn home_now<R: Runtime>(app: &AppHandle<R>) -> Option<Screen> {
    home_screen(&screens(app), pref(app), cursor(app))
}

fn pref<R: Runtime>(app: &AppHandle<R>) -> ScreenPref {
    ScreenPref::from_u8(app.state::<NotchState>().pref.load(Ordering::SeqCst))
}

/// AppKit is only read on the main thread; the commands that ask run off it.
/// When the screen can't be read, the last good reading stands.
async fn geometry<R: Runtime>(window: &WebviewWindow<R>) -> NotchGeometry {
    #[cfg(target_os = "macos")]
    let read = {
        let at = window.state::<NotchState>().placed.lock().unwrap().screen.map(|s| s.area);
        let (tx, rx) = tokio::sync::oneshot::channel();
        let ns = window.clone();
        match window.run_on_main_thread(move || {
            let _ = tx.send(mac::geometry(&ns, at));
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

fn emit_geometry<R: Runtime>(window: &WebviewWindow<R>) {
    let window = window.clone();
    tauri::async_runtime::spawn(async move {
        let geometry = geometry(&window).await;
        let _ = window.emit(GEOMETRY, geometry);
    });
}

/// Bring the pill up: above the menu bar again (in case anything lowered
/// it), on its screen, then tell the page which notch it is under now.
fn show_pill<R: Runtime>(window: &WebviewWindow<R>) {
    #[cfg(target_os = "macos")]
    {
        let ns = window.clone();
        let _ = window.run_on_main_thread(move || mac::float_above_menu_bar(&ns));
    }
    let state = window.state::<NotchState>();
    let unplaced = state.placed.lock().unwrap().screen.is_none();
    if unplaced {
        if let Some(screen) = home_now(window.app_handle()) {
            put(window, screen);
        }
    }
    // Clicks go through until the cursor is on the pill itself.
    let _ = window.set_ignore_cursor_events(true);
    state.inside.store(false, Ordering::SeqCst);
    let _ = window.show();
    state.visible.store(true, Ordering::SeqCst);
    watch_cursor(window.app_handle().clone());
    emit_geometry(window);
}

fn hide_pill<R: Runtime>(window: &WebviewWindow<R>) {
    let _ = window.hide();
    let state = window.state::<NotchState>();
    state.visible.store(false, Ordering::SeqCst);
    state.inside.store(false, Ordering::SeqCst);
}

/// Show the pill (on its screen, if it was hidden) and tell its page which
/// notch it hangs from. `focus` is for an approval waiting on Y / N.
///
/// Async: creating a window from a synchronous command deadlocks on Windows.
#[tauri::command]
pub async fn notch_show<R: Runtime>(app: AppHandle<R>, focus: Option<bool>) -> Result<NotchGeometry, String> {
    let window = notch_window(&app).map_err(|e| format!("Cannot open the notch pill: {e}"))?;
    if !app.state::<NotchState>().visible.load(Ordering::SeqCst) {
        if let Some(screen) = home_now(&app) {
            put(&window, screen);
        }
    }
    let focus = focus.unwrap_or(false);
    if focus {
        let _ = window.set_focusable(true);
    }
    show_pill(&window);
    if focus {
        let _ = window.set_focus();
    }
    Ok(geometry(&window).await)
}

#[tauri::command]
pub fn notch_hide<R: Runtime>(app: AppHandle<R>) {
    if let Some(window) = app.get_webview_window(NOTCH_LABEL) {
        hide_pill(&window);
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

/// Size the window, centered under the notch and against the top. The page
/// asks only when the notch changes: the pill animates inside a window of
/// fixed size, because resizing a web view blanks it for a moment (the
/// flicker). `focusable` is on only while the pill wants keys.
#[tauri::command]
pub fn notch_resize<R: Runtime>(app: AppHandle<R>, width: f64, height: f64, focusable: Option<bool>) {
    let Some(window) = app.get_webview_window(NOTCH_LABEL) else { return };
    let state = app.state::<NotchState>();
    if let Some(focusable) = focusable {
        let was = state.keys.load(Ordering::SeqCst);
        if was != focusable {
            let _ = window.set_focusable(focusable);
            state.keys.store(focusable, Ordering::SeqCst);
        }
        if focusable {
            let _ = window.set_focus();
        }
    }
    let screen = {
        let mut placed = state.placed.lock().unwrap();
        let same = (placed.size.0 - width).abs() < 1.0 && (placed.size.1 - height).abs() < 1.0;
        if same && !placed.stretched && placed.screen.is_some() {
            return;
        }
        placed.size = (width, height);
        placed.screen
    };
    if let Some(screen) = screen.or_else(|| home_now(&app)) {
        put(&window, screen);
    }
}

/// Where the pill is in its window (logical pixels); outside it, the window
/// lets clicks through to the apps below (`watch_cursor`). `open`: the pill
/// shows more than its wings, so it stays on its screen.
#[tauri::command]
pub fn notch_hit_area<R: Runtime>(app: AppHandle<R>, x: f64, y: f64, width: f64, height: f64, open: Option<bool>) {
    let state = app.state::<NotchState>();
    *state.hit.write().unwrap() = Some(Area { x, y, width, height });
    if let Some(open) = open {
        state.open.store(open, Ordering::SeqCst);
    }
}

/// Which screen the pill lives on; it moves there now if it should.
#[tauri::command]
pub fn notch_set_screen<R: Runtime>(app: AppHandle<R>, pref: ScreenPref) {
    let state = app.state::<NotchState>();
    if state.pref.swap(pref.to_u8(), Ordering::SeqCst) == pref.to_u8() {
        return;
    }
    let Some(window) = app.get_webview_window(NOTCH_LABEL) else { return };
    let placed = state.placed.lock().unwrap().clone();
    if !state.visible.load(Ordering::SeqCst) || placed.stretched {
        return;
    }
    if let Some(home) = home_now(&app) {
        if placed.screen.map(|s| s.id) != Some(home.id) {
            move_to(&window, home);
        }
    }
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
    /// Counts each time notch mode starts or ends: work left waiting from
    /// one round (hiding the pill after the drop, the Dock's fallback) must
    /// not act in the next.
    round: AtomicU64,
    watching: AtomicBool,
    /// The pill is on screen, as last shown or hidden (checked against the
    /// window now and then: ⌘H hides it behind our back).
    visible: AtomicBool,
    /// The fly-in to play, taken once by the page.
    intro: Mutex<Option<Intro>>,
    /// The last notch read from the screen.
    geometry: Mutex<Option<NotchGeometry>>,
    /// The pill's area in its window; the rest lets clicks through.
    hit: RwLock<Option<Area>>,
    /// The cursor is on the pill (it takes clicks) — as last told to the window.
    inside: AtomicBool,
    /// The pill shows more than its wings (Home, the ask box…).
    open: AtomicBool,
    /// `ScreenPref`, as a number.
    pref: AtomicU8,
    /// The pill wants Y / N while an approval is showing (`notch_resize`).
    keys: AtomicBool,
    placed: Mutex<Placed>,
}

/// Where the pill's window is.
#[derive(Debug, Clone)]
struct Placed {
    screen: Option<Screen>,
    /// The window, in screen units.
    frame: Rect,
    /// The size the page asked for, in logical pixels.
    size: (f64, f64),
    /// An animation (`stretch`) has the window; the pill's frame comes back after.
    stretched: bool,
}

impl Default for Placed {
    fn default() -> Self {
        Self { screen: None, frame: Rect::default(), size: START_SIZE, stretched: false }
    }
}

/// A point in the pill's window, in logical pixels.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
pub struct Point {
    pub x: f64,
    pub y: f64,
}

/// The way the pill appears in notch mode: a dot flying up from where the
/// main window shrank to, or (`from` empty: at login, or from another
/// screen) just the light along the top edge.
#[derive(Debug, Clone, Copy, Serialize, PartialEq)]
pub struct Intro {
    pub from: Option<Point>,
}

fn mode_on<R: Runtime>(app: &AppHandle<R>) -> bool {
    app.state::<NotchState>().on.load(Ordering::SeqCst)
}

fn round<R: Runtime>(app: &AppHandle<R>) -> u64 {
    app.state::<NotchState>().round.load(Ordering::SeqCst)
}

fn set_mode<R: Runtime>(app: &AppHandle<R>, on: bool) {
    let state = app.state::<NotchState>();
    if state.on.swap(on, Ordering::SeqCst) != on {
        state.round.fetch_add(1, Ordering::SeqCst);
    }
    let _ = app.emit_to(NOTCH_LABEL, MODE, on);
    let _ = app.emit_to(MAIN_LABEL, MODE, on);
}

/// The main window's frame in screen units, hidden or not.
async fn main_rect<R: Runtime>(app: &AppHandle<R>) -> Option<Rect> {
    let main = app.get_webview_window(MAIN_LABEL)?;
    #[cfg(target_os = "macos")]
    {
        let (tx, rx) = tokio::sync::oneshot::channel();
        let ns = main.clone();
        main.run_on_main_thread(move || {
            let _ = tx.send(mac::window_rect(&ns));
        })
        .ok()?;
        rx.await.ok().flatten()
    }
    #[cfg(not(target_os = "macos"))]
    {
        if main.is_minimized().unwrap_or(false) {
            return None;
        }
        let (pos, size) = (main.outer_position().ok()?, main.outer_size().ok()?);
        Some(Rect { x: pos.x as f64, y: pos.y as f64, width: size.width as f64, height: size.height as f64 })
    }
}

/// The light along the top edge needs this much of the screen.
const GLOW_HEIGHT: f64 = 140.0;

/// Cover the top of `screen` for the intro; the dot flies up from `from`
/// (screen units) when it is on this screen.
fn play_intro<R: Runtime>(window: &WebviewWindow<R>, screen: Screen, from: Option<(f64, f64)>) {
    let area = screen.area;
    let from = from.filter(|&p| area.contains(p));
    let height = match from {
        Some((_, y)) => ((y - area.y) / screen.unit + 80.0).max(120.0),
        None => GLOW_HEIGHT,
    };
    window.state::<NotchState>().placed.lock().unwrap().screen = Some(screen);
    stretch(window, Rect { x: area.x, y: area.y, width: area.width, height: height * screen.unit });
    *window.state::<NotchState>().intro.lock().unwrap() = Some(Intro {
        from: from.map(|(x, y)| Point { x: (x - area.x) / screen.unit, y: (y - area.y) / screen.unit }),
    });
}

/// Put the main window away and keep the pill at the top: the window has
/// shrunk to a dot where it is, and the dot flies up into the notch.
#[tauri::command]
pub async fn notch_enter_mode<R: Runtime>(app: AppHandle<R>) -> Result<NotchGeometry, String> {
    let center = main_rect(&app).await.map(|r| r.center());
    if let Some(main) = app.get_webview_window(MAIN_LABEL) {
        let _ = main.hide();
    }
    let window = notch_window(&app).map_err(|e| format!("Cannot open the notch pill: {e}"))?;
    let screens = screens(&app);
    // The dot flies up on the screen the window was on, unless the pill lives elsewhere.
    let home = match pref(&app) {
        ScreenPref::Follow => center.and_then(|c| screen_at(&screens, c)),
        _ => None,
    }
    .or_else(|| home_screen(&screens, pref(&app), cursor(&app)));
    if let Some(screen) = home {
        play_intro(&window, screen, center);
    }
    let _ = window.set_focusable(false);
    show_pill(&window);
    set_mode(&app, true);
    let _ = window.emit(INTRO, ());
    Ok(geometry(&window).await)
}

/// Started at login (`--notch`): no app, only the pill, which lights up the
/// top edge and says hello. The main window stays hidden until it's opened.
pub fn start_in_notch<R: Runtime>(app: &AppHandle<R>) {
    set_mode(app, true);
    let Ok(window) = notch_window(app) else {
        // No pill, no way in: open the app as usual.
        app.state::<NotchState>().on.store(false, Ordering::SeqCst);
        show_main(app);
        return;
    };
    if let Some(screen) = home_now(app) {
        play_intro(&window, screen, None);
    }
    show_pill(&window);
}

/// The fly-in to play, once; the page asks when it loads or is told.
#[tauri::command]
pub fn notch_take_intro<R: Runtime>(app: AppHandle<R>) -> Option<Intro> {
    app.state::<NotchState>().intro.lock().unwrap().take()
}

#[tauri::command]
pub fn notch_mode<R: Runtime>(app: AppHandle<R>) -> bool {
    mode_on(&app)
}

/// The main window, where the drop lands, in the pill's window (logical pixels).
#[derive(Debug, Clone, Copy, Serialize, PartialEq)]
pub struct DropTarget {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// Opening the app from the pill: a drop falls from the notch into the
/// middle of the main window, which opens from it. This readies it: the
/// main window comes to the pill's screen if it was on another, and the
/// pill's window covers the screen down to it. `None` when the main window
/// is already up (it just comes forward).
#[tauri::command]
pub async fn notch_drop_out<R: Runtime>(app: AppHandle<R>) -> Option<DropTarget> {
    let main = app.get_webview_window(MAIN_LABEL)?;
    if main.is_visible().unwrap_or(false) && !main.is_minimized().unwrap_or(false) {
        return None;
    }
    let window = app.get_webview_window(NOTCH_LABEL)?;
    let state = app.state::<NotchState>();
    if !state.visible.load(Ordering::SeqCst) {
        return None;
    }
    let screen = state.placed.lock().unwrap().screen?;
    let area = screen.area;
    let mut rect = main_rect(&app).await?;
    if !area.contains(rect.center()) {
        // The app opens where the drop lands: this screen, in the middle.
        let width = rect.width.min(area.width - 40.0 * screen.unit);
        let height = rect.height.min(area.height - 80.0 * screen.unit);
        rect = Rect { x: area.x + (area.width - width) / 2.0, y: area.y + (area.height - height) / 2.0, width, height };
        apply_frame(&main, rect);
    }
    let bottom = (rect.y + rect.height - area.y + 24.0 * screen.unit).min(area.height);
    let _ = window.set_focusable(false);
    stretch(&window, Rect { x: area.x, y: area.y, width: area.width, height: bottom });
    Some(DropTarget {
        x: (rect.x - area.x) / screen.unit,
        y: (rect.y - area.y) / screen.unit,
        width: rect.width / screen.unit,
        height: rect.height / screen.unit,
    })
}

/// After the drop lands, the pill stays this long over the app as it opens.
const LINGER_MS: u64 = 420;

/// The main window comes up; the pill leaves after the drop's ripple.
fn hand_over<R: Runtime>(app: &AppHandle<R>, chat_id: Option<String>) {
    let _ = app.emit_to(MAIN_LABEL, MAIN_RETURN, ());
    show_main(app);
    if let Some(chat_id) = chat_id {
        let _ = app.emit_to(MAIN_LABEL, "quick:open-chat", chat_id);
    }
    let Some(window) = app.get_webview_window(NOTCH_LABEL) else { return };
    let stretched = app.state::<NotchState>().placed.lock().unwrap().stretched;
    if !stretched {
        hide_pill(&window);
        return;
    }
    let app = app.clone();
    let started = round(&app);
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(LINGER_MS));
        // Back in notch mode meanwhile: the pill is the new round's now.
        if round(&app) != started {
            return;
        }
        let Some(window) = app.get_webview_window(NOTCH_LABEL) else { return };
        if !mode_on(&app) {
            hide_pill(&window);
        }
        unstretch(&window);
    });
}

/// Back to the app: the main window comes up (on `chat_id` if given).
#[tauri::command]
pub fn notch_exit_mode<R: Runtime>(app: AppHandle<R>, chat_id: Option<String>) {
    set_mode(&app, false);
    hand_over(&app, chat_id);
}

/// The relay's "nothing to show": hide, unless notch mode keeps the pill up
/// (or the drop into the app is still playing; it hides after).
#[tauri::command]
pub fn notch_release<R: Runtime>(app: AppHandle<R>) {
    let stretched = app.state::<NotchState>().placed.lock().unwrap().stretched;
    if !mode_on(&app) && !stretched {
        notch_hide(app);
    }
}

/// The pill's chat, or its done state: bring the main window up on that chat.
#[tauri::command]
pub fn notch_open_main<R: Runtime>(app: AppHandle<R>, chat_id: Option<String>) {
    hand_over(&app, chat_id);
}

/// ⌥⌘M in notch mode: open the pill ready to type, or close it if it is.
/// Returns false outside notch mode, so the Quick bar opens instead.
pub fn summon<R: Runtime>(app: &AppHandle<R>) -> bool {
    if !mode_on(app) {
        return false;
    }
    let Ok(window) = notch_window(app) else { return false };
    let state = app.state::<NotchState>();
    let placed = state.placed.lock().unwrap().clone();
    if !placed.stretched {
        // Where you are: the pill comes to the pointer's screen if it follows you.
        let here = home_now(app);
        let visible = state.visible.load(Ordering::SeqCst);
        if let Some(here) = here.filter(|h| !visible || placed.screen.map(|s| s.id) != Some(h.id)) {
            if visible {
                move_to(&window, here);
            } else {
                put(&window, here);
            }
        }
    }
    let _ = window.set_focusable(true);
    show_pill(&window);
    let _ = window.set_focus();
    let _ = window.emit(SUMMON, ());
    true
}

/// The app was asked for (the Dock, the tray). In notch mode the pill drops
/// into it; the page ends notch mode as the drop lands, and if it doesn't
/// (it's busy or gone), the app opens anyway.
pub fn reopen<R: Runtime>(app: &AppHandle<R>) {
    let pill = app.get_webview_window(NOTCH_LABEL);
    let visible = app.state::<NotchState>().visible.load(Ordering::SeqCst);
    let Some(pill) = pill.filter(|_| mode_on(app) && visible) else {
        show_main(app);
        return;
    };
    let _ = pill.emit(OPEN_APP, ());
    let app = app.clone();
    let started = round(&app);
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(1800));
        if mode_on(&app) && round(&app) == started {
            notch_exit_mode(app, None);
        }
    });
}

/// The main window came back by another way: notch mode is over; the relay
/// hides the pill while the main window has focus.
pub fn main_focused<R: Runtime>(app: &AppHandle<R>) {
    if mode_on(app) {
        set_mode(app, false);
    }
}

// ── at login ──

/// The login item's argument: start in the notch, without the app.
pub const START_IN_NOTCH: &str = "--notch";

pub fn started_in_notch() -> bool {
    std::env::args().any(|arg| arg == START_IN_NOTCH)
}

#[cfg(target_os = "macos")]
fn login_agent<R: Runtime>(app: &AppHandle<R>) -> Option<std::path::PathBuf> {
    let name = format!("{}.notch.plist", app.config().identifier);
    dirs::home_dir().map(|home| home.join("Library/LaunchAgents").join(name))
}

#[cfg(windows)]
const RUN_KEY: &str = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run";

#[cfg(windows)]
fn run_value<R: Runtime>(app: &AppHandle<R>) -> String {
    app.config().product_name.clone().unwrap_or_else(|| "Mali Cowork".into())
}

#[cfg(windows)]
fn reg(args: &[&str]) -> std::io::Result<std::process::ExitStatus> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    std::process::Command::new("reg").args(args).creation_flags(CREATE_NO_WINDOW).status()
}

/// A LaunchAgent that starts Mali in the notch when you log in.
#[cfg(target_os = "macos")]
fn login_agent_plist(label: &str, exe: &str) -> String {
    let escape = |s: &str| {
        s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
    };
    format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>{}</string>
  <key>ProgramArguments</key>
  <array>
    <string>{}</string>
    <string>{START_IN_NOTCH}</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>ProcessType</key>
  <string>Interactive</string>
</dict>
</plist>
"#,
        escape(label),
        escape(exe)
    )
}

/// Mali starts at login, in the notch.
#[tauri::command]
pub fn notch_login_item<R: Runtime>(app: AppHandle<R>) -> bool {
    #[cfg(target_os = "macos")]
    return login_agent(&app).is_some_and(|path| path.exists());
    #[cfg(windows)]
    return reg(&["query", RUN_KEY, "/v", &run_value(&app)]).is_ok_and(|s| s.success());
    #[cfg(not(any(target_os = "macos", windows)))]
    {
        let _ = app;
        false
    }
}

#[tauri::command]
pub fn notch_set_login_item<R: Runtime>(app: AppHandle<R>, on: bool) -> Result<(), String> {
    let exe = std::env::current_exe().map_err(|e| format!("Cannot find Mali's program: {e}"))?;
    #[cfg(target_os = "macos")]
    {
        let path = login_agent(&app).ok_or("Cannot find your Library folder")?;
        if !on {
            return match std::fs::remove_file(&path) {
                Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(format!("Cannot remove the login item: {e}")),
                _ => Ok(()),
            };
        }
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir).map_err(|e| format!("Cannot add the login item: {e}"))?;
        }
        let label = format!("{}.notch", app.config().identifier);
        std::fs::write(&path, login_agent_plist(&label, &exe.to_string_lossy()))
            .map_err(|e| format!("Cannot add the login item: {e}"))
    }
    #[cfg(windows)]
    {
        let name = run_value(&app);
        let status = if on {
            let command = format!("\"{}\" {START_IN_NOTCH}", exe.display());
            reg(&["add", RUN_KEY, "/v", &name, "/t", "REG_SZ", "/d", &command, "/f"])
        } else {
            reg(&["delete", RUN_KEY, "/v", &name, "/f"])
        };
        match status {
            Ok(s) if s.success() || !on => Ok(()),
            Ok(_) => Err("Windows didn't add the login item".into()),
            Err(e) => Err(format!("Cannot change the login item: {e}")),
        }
    }
    #[cfg(not(any(target_os = "macos", windows)))]
    {
        let _ = (app, on, exe);
        Err("Starting at login works on macOS and Windows for now".into())
    }
}

// ── watching the pointer ──

/// While the pill is up (or notch mode keeps it ready), watch the cursor.
/// On the pill, the window takes clicks; off it, clicks go through to the
/// apps below, so the fixed-size window never gets in the way. The page is
/// told when the cursor enters or leaves (it can't see the mouse itself while
/// Mali isn't the active app). In notch mode, the cursor at the top of the
/// screen near the notch brings a hidden pill back; following the pointer,
/// the pill moves to the screen it settles on.
///
/// Cheap by design: on a Mac each look is a CoreGraphics read from this
/// thread, with no trip to the main thread unless something changes, and it
/// looks less often the farther the pointer is from the pill.
const POLL_ON_PILL_MS: u64 = 40;
/// Near the top strip (hover, drag-to-notch).
const POLL_NEAR_TOP_MS: u64 = 60;
/// Pill visible but the pointer is elsewhere on the screen.
const POLL_AWAY_MS: u64 = 120;
/// Pill hidden; notch mode waits for the pointer at the top edge.
const POLL_HIDDEN_MODE_MS: u64 = 90;
/// Screens plugged in or out, and the window's visibility, are checked this often.
const RESYNC: Duration = Duration::from_millis(1000);
/// The pointer stays on another screen this long before the pill follows it.
const FOLLOW_AFTER: Duration = Duration::from_millis(700);
/// At the top of a screen with another one above it, the pointer rests this long to count.
const REACH_DWELL: Duration = Duration::from_millis(300);

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
        let mut all = screens(&app);
        let mut synced = Instant::now();
        // The pointer on another screen than the pill's, since when.
        let mut away: Option<(u64, Instant)> = None;
        // The pointer at the top of a screen, since when.
        let mut topped: Option<(u64, Instant)> = None;
        loop {
            std::thread::sleep(Duration::from_millis(sleep_ms));
            let Some(window) = app.get_webview_window(NOTCH_LABEL) else {
                if mode_on(&app) {
                    sleep_ms = POLL_HIDDEN_MODE_MS;
                    continue;
                }
                break;
            };
            let state = app.state::<NotchState>();
            if synced.elapsed() >= RESYNC {
                synced = Instant::now();
                state.visible.store(window.is_visible().unwrap_or(false), Ordering::SeqCst);
                let now = screens(&app);
                if now != all {
                    all = now;
                    rehome(&window, &all);
                }
            }
            let visible = state.visible.load(Ordering::SeqCst);
            let Some(point) = cursor(&app) else {
                sleep_ms = POLL_AWAY_MS;
                continue;
            };
            let placed = state.placed.lock().unwrap().clone();
            let pref = pref(&app);
            let under = screen_at(&all, point);
            // The screen the pill belongs on with the pointer where it is.
            let target = match pref {
                ScreenPref::Follow => under.or(placed.screen),
                _ => home_screen(&all, pref, Some(point)),
            };
            let near_strip = target.is_some_and(|s| near_top(&s, point, 540.0, 280.0));
            // Reaching for the top of the screen under the pointer.
            let reached = match under.filter(|s| at_top(s, point)) {
                Some(s) => {
                    let since = match topped {
                        Some((id, since)) if id == s.id => since,
                        _ => topped.insert((s.id, Instant::now())).1,
                    };
                    (edge_open(&all, &s, point) || since.elapsed() >= REACH_DWELL).then_some(s)
                }
                None => {
                    topped = None;
                    None
                }
            };
            #[cfg(target_os = "macos")]
            if dragging || near_strip || sleep_ms <= POLL_NEAR_TOP_MS {
                match drags.poll() {
                    Some(mac::Drag::Started) => dragging = true,
                    Some(mac::Drag::Ended) => dragging = false,
                    None => {}
                }
            }
            // Files dragged toward the top: open the drop zone while they're
            // still well below the edge, since a drag that reaches the edge
            // makes macOS open Mission Control instead.
            let near = dragging && target.is_some_and(|s| near_top(&s, point, 520.0, 260.0));
            if near != offered && (visible || mode_on(&app)) && !placed.stretched {
                offered = near;
                if let Some(target) = target.filter(|_| near) {
                    if !visible {
                        put(&window, target);
                        show_pill(&window);
                    } else if placed.screen.map(|s| s.id) != Some(target.id) {
                        move_to(&window, target);
                    }
                }
                let _ = window.emit(DRAG, near);
            }
            if !visible {
                if !mode_on(&app) {
                    break;
                }
                sleep_ms = POLL_HIDDEN_MODE_MS;
                if let Some(target) = target.filter(|t| reached.is_some_and(|r| r.id == t.id)) {
                    put(&window, target);
                    show_pill(&window);
                }
                continue;
            }
            // The fly-in or the drop into the app has the window.
            if placed.stretched {
                sleep_ms = POLL_NEAR_TOP_MS;
                continue;
            }
            // Following the pointer: once it settles on another screen (or
            // reaches for its top), the pill goes there — never while it's
            // open or in use.
            let idle = !state.open.load(Ordering::SeqCst) && !state.inside.load(Ordering::SeqCst) && !dragging;
            match (pref, under, placed.screen) {
                (ScreenPref::Follow, Some(under), Some(on)) if idle && under.id != on.id => {
                    let since = match away {
                        Some((id, since)) if id == under.id => since,
                        _ => {
                            let now = Instant::now();
                            away = Some((under.id, now));
                            now
                        }
                    };
                    if reached.is_some_and(|r| r.id == under.id) || since.elapsed() >= FOLLOW_AFTER {
                        away = None;
                        move_to(&window, under);
                        sleep_ms = POLL_NEAR_TOP_MS;
                        continue;
                    }
                }
                _ => away = None,
            }
            let area = *state.hit.read().unwrap();
            let unit = placed.screen.map_or(1.0, |s| s.unit);
            let now = area.is_some_and(|area| pill_rect(placed.frame, unit, area).contains(point));
            if state.inside.swap(now, Ordering::SeqCst) != now {
                let _ = window.set_ignore_cursor_events(!now);
                let _ = window.emit(HOVER, now);
            }
            sleep_ms = if now {
                POLL_ON_PILL_MS
            } else if near_strip {
                POLL_NEAR_TOP_MS
            } else {
                POLL_AWAY_MS
            };
        }
        app.state::<NotchState>().watching.store(false, Ordering::SeqCst);
    });
}

/// Screens were plugged in or out, or rearranged: keep the pill on its
/// screen if it's still there (where it is now), else take it home.
fn rehome<R: Runtime>(window: &WebviewWindow<R>, screens: &[Screen]) {
    let app = window.app_handle();
    let placed = app.state::<NotchState>().placed.lock().unwrap().clone();
    let pref = pref(app);
    let kept = placed
        .screen
        .and_then(|on| screens.iter().find(|s| s.id == on.id).copied())
        .filter(|_| pref == ScreenPref::Follow);
    let Some(screen) = kept.or_else(|| home_screen(screens, pref, cursor(app))) else { return };
    if placed.screen == Some(screen) && !placed.stretched {
        return;
    }
    eprintln!("[notch] screens changed; the pill is on {:?}", screen.area);
    if placed.stretched {
        // An animation has the window; it comes back to this screen after.
        app.state::<NotchState>().placed.lock().unwrap().screen = Some(screen);
        return;
    }
    move_to(window, screen);
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
    use std::ffi::c_void;

    use objc2::rc::Retained;
    use objc2::runtime::AnyObject;
    use objc2::MainThreadMarker;
    use objc2_app_kit::{
        NSEvent, NSMainMenuWindowLevel, NSPasteboard, NSPasteboardNameDrag, NSPasteboardTypeFileURL, NSScreen,
        NSWindow, NSWindowCollectionBehavior,
    };
    use objc2_foundation::{ns_string, NSArray, NSDictionary, NSNumber, NSPoint, NSRect, NSSize, NSString};
    use tauri::{Runtime, WebviewWindow};

    use super::{NotchGeometry, Rect, Screen};

    // CoreGraphics' display and event reads are safe from any thread, which
    // lets the cursor watch run without waking the main thread.
    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGWindowListCopyWindowInfo(option: u32, relative_to: u32) -> *mut AnyObject;
        fn CGGetActiveDisplayList(max: u32, displays: *mut u32, count: *mut u32) -> i32;
        fn CGDisplayBounds(display: u32) -> NSRect;
        fn CGDisplayIsBuiltin(display: u32) -> u32;
        fn CGDisplayMirrorsDisplay(display: u32) -> u32;
        fn CGMainDisplayID() -> u32;
        fn CGEventCreate(source: *const c_void) -> *mut c_void;
        fn CGEventGetLocation(event: *const c_void) -> NSPoint;
    }
    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {
        fn CFRelease(object: *const c_void);
    }

    /// The displays, in CoreGraphics' global points (top-left origin); a
    /// display mirroring another is the same screen.
    pub fn screens() -> Vec<Screen> {
        let mut ids = [0u32; 16];
        let mut count = 0u32;
        // SAFETY: the buffer holds `ids.len()` displays; CG writes at most that many.
        if unsafe { CGGetActiveDisplayList(ids.len() as u32, ids.as_mut_ptr(), &mut count) } != 0 {
            return Vec::new();
        }
        let main = unsafe { CGMainDisplayID() };
        ids[..count as usize]
            .iter()
            .filter(|&&id| unsafe { CGDisplayMirrorsDisplay(id) } == 0)
            .map(|&id| {
                let b = unsafe { CGDisplayBounds(id) };
                Screen {
                    id: id as u64,
                    area: Rect { x: b.origin.x, y: b.origin.y, width: b.size.width, height: b.size.height },
                    unit: 1.0,
                    builtin: unsafe { CGDisplayIsBuiltin(id) } != 0,
                    main: id == main,
                }
            })
            .collect()
    }

    /// The pointer in global points, top-left origin.
    pub fn cursor() -> Option<(f64, f64)> {
        // SAFETY: a null source makes a plain event, released below.
        let event = unsafe { CGEventCreate(std::ptr::null()) };
        if event.is_null() {
            return None;
        }
        let at = unsafe { CGEventGetLocation(event) };
        unsafe { CFRelease(event) };
        Some((at.x, at.y))
    }

    /// Cocoa frames start at the bottom left of the main display; CoreGraphics
    /// at its top left.
    fn primary_height() -> f64 {
        unsafe { CGDisplayBounds(CGMainDisplayID()) }.size.height
    }

    fn to_cocoa(rect: Rect) -> NSRect {
        NSRect::new(NSPoint::new(rect.x, primary_height() - rect.y - rect.height), NSSize::new(rect.width, rect.height))
    }

    fn from_cocoa(frame: NSRect) -> Rect {
        Rect {
            x: frame.origin.x,
            y: primary_height() - frame.origin.y - frame.size.height,
            width: frame.size.width,
            height: frame.size.height,
        }
    }

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
        // Part of the screen, not of the app: hiding Mali (⌘H) leaves it.
        ns_window.setCanHide(false);
    }

    /// Move and size in one step: moving, then resizing, shows a frame where
    /// the pill sits off-center, which reads as a flicker.
    pub fn set_frame<R: Runtime>(window: &WebviewWindow<R>, rect: Rect) {
        let Some(ns_window) = ns_window(window) else { return };
        ns_window.setFrame_display(to_cocoa(rect), true);
    }

    pub fn window_rect<R: Runtime>(window: &WebviewWindow<R>) -> Option<Rect> {
        Some(from_cocoa(ns_window(window)?.frame()))
    }

    /// The notch of the screen at `at` (else the window's, else the main
    /// one): the top safe-area inset is its height, and the areas either
    /// side of it leave its width. Without a notch, the menu bar's height is
    /// the gap between the frame and the visible frame.
    pub fn geometry<R: Runtime>(window: &WebviewWindow<R>, at: Option<Rect>) -> Option<NotchGeometry> {
        let mtm = MainThreadMarker::new()?;
        let all = NSScreen::screens(mtm);
        let matching = at.and_then(|at| {
            (0..all.count()).map(|i| all.objectAtIndex(i)).find(|s| {
                let r = from_cocoa(s.frame());
                (r.x - at.x).abs() < 1.0 && (r.y - at.y).abs() < 1.0 && (r.width - at.width).abs() < 1.0
            })
        });
        let screen = matching
            .or_else(|| ns_window(window).and_then(|w| w.screen()))
            .or_else(|| NSScreen::mainScreen(mtm))?;
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

    /// A MacBook (main, with the notch) and a 4K display to its right, raised a little.
    fn desk() -> Vec<Screen> {
        vec![
            Screen {
                id: 1,
                area: Rect { x: 0.0, y: 0.0, width: 1512.0, height: 982.0 },
                unit: 1.0,
                builtin: true,
                main: true,
            },
            Screen {
                id: 2,
                area: Rect { x: 1512.0, y: -300.0, width: 2560.0, height: 1440.0 },
                unit: 1.0,
                builtin: false,
                main: false,
            },
        ]
    }

    #[test]
    fn the_pill_lives_where_the_setting_says() {
        let screens = desk();
        let on_external = Some((2500.0, 400.0));
        assert_eq!(home_screen(&screens, ScreenPref::Follow, on_external).unwrap().id, 2);
        assert_eq!(home_screen(&screens, ScreenPref::Builtin, on_external).unwrap().id, 1);
        assert_eq!(home_screen(&screens, ScreenPref::Main, on_external).unwrap().id, 1);
        // Off every screen (between them), following falls back to the main one.
        assert_eq!(home_screen(&screens, ScreenPref::Follow, Some((-50.0, -50.0))).unwrap().id, 1);
    }

    #[test]
    fn with_the_lid_closed_the_mac_display_falls_back_to_the_main_one() {
        let mut screens = desk();
        screens.remove(0);
        screens[0].main = true;
        assert_eq!(home_screen(&screens, ScreenPref::Builtin, None).unwrap().id, 2);
        assert!(home_screen(&[], ScreenPref::Follow, None).is_none());
    }

    #[test]
    fn the_pill_hangs_centered_from_the_top_of_its_screen() {
        let external = desk()[1];
        let frame = frame_on(&external, (700.0, 400.0));
        assert_eq!(frame, Rect { x: 1512.0 + (2560.0 - 700.0) / 2.0, y: -300.0, width: 700.0, height: 400.0 });
        // Windows: screen units are physical pixels, the size is logical.
        let scaled = Screen { unit: 1.5, area: Rect { x: 0.0, y: 0.0, width: 3000.0, height: 1900.0 }, ..external };
        assert_eq!(frame_on(&scaled, (200.0, 40.0)), Rect { x: 1350.0, y: 0.0, width: 300.0, height: 60.0 });
    }

    #[test]
    fn reaching_the_top_counts_on_each_screen() {
        let screens = desk();
        let external = screens[1];
        let top_center = (1512.0 + 1280.0, -300.0);
        assert!(at_top(&external, top_center));
        assert!(!at_top(&external, (1512.0 + 1280.0, -200.0)));
        assert!(!at_top(&external, (1512.0 + 100.0, -300.0)));
        assert!(!at_top(&screens[0], top_center));
        assert_eq!(screen_at(&screens, top_center).unwrap().id, 2);
    }

    #[test]
    fn a_screen_above_makes_the_top_a_crossing_not_an_edge() {
        // This desk: a 1080p display above the MacBook, a little to the left.
        let mac = desk()[0];
        let above = Screen {
            id: 3,
            area: Rect { x: -247.0, y: -1080.0, width: 1920.0, height: 1080.0 },
            unit: 1.0,
            builtin: false,
            main: false,
        };
        let screens = [mac, above];
        assert!(!edge_open(&screens, &mac, (735.0, 0.0)));
        assert!(edge_open(&screens, &above, (735.0, -1080.0)));
        assert!(edge_open(&desk(), &mac, (735.0, 0.0)));
    }

    #[test]
    fn the_pill_takes_clicks_only_on_its_own_area() {
        let frame = Rect { x: 100.0, y: 0.0, width: 700.0, height: 400.0 };
        let area = Area { x: 200.0, y: 0.0, width: 300.0, height: 38.0 };
        let pill = pill_rect(frame, 1.0, area);
        assert!(pill.contains((350.0, 10.0)));
        assert!(!pill.contains((350.0, 60.0)));
        assert!(!pill.contains((150.0, 10.0)));
    }

    #[test]
    fn the_screen_setting_reads_from_the_page() {
        let pref: ScreenPref = serde_json::from_str("\"builtin\"").unwrap();
        assert_eq!(pref, ScreenPref::Builtin);
        for pref in [ScreenPref::Follow, ScreenPref::Builtin, ScreenPref::Main] {
            assert_eq!(ScreenPref::from_u8(pref.to_u8()), pref);
        }
    }

    #[test]
    fn the_intro_says_where_the_dot_starts() {
        let json = serde_json::to_value(Intro { from: None }).unwrap();
        assert!(json["from"].is_null());
        let json = serde_json::to_value(Intro { from: Some(Point { x: 1.0, y: 2.0 }) }).unwrap();
        assert_eq!(json["from"]["y"], 2.0);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn the_login_item_starts_mali_in_the_notch() {
        let plist = login_agent_plist("com.example.notch", "/Applications/A & B.app/Contents/MacOS/a");
        assert!(plist.contains("<string>/Applications/A &amp; B.app/Contents/MacOS/a</string>"));
        assert!(plist.contains("<string>--notch</string>"));
        assert!(plist.contains("<key>RunAtLoad</key>"));
    }
}
