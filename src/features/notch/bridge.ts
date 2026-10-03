/**
 * Notch pill ⇄ main window. The main window owns the runs, so the pill only
 * shows what it is sent and hands Allow / Deny back.
 */
import { invoke, isTauri } from "@tauri-apps/api/core";
import { emitTo, listen } from "@tauri-apps/api/event";
import type {
  NotchAnswer,
  NotchCoworkRequest,
  NotchCoworkStarted,
  NotchGeometry,
  NotchLook,
  NotchOverview,
  NotchReply,
  NotchSetup,
  NotchSnapshot,
} from "./types";

const NOTCH = "notch";
const STATE = "notch:state";
const READY = "notch:ready";
const REPLY = "notch:reply";
const ANSWER = "notch:answer";
const GEOMETRY = "notch:geometry";

// ── window commands (notch.rs) ──

/** Show the pill; `focus` gives it the keyboard for an approval. */
export function showNotch(focus = false) {
  return invoke<NotchGeometry>("notch_show", { focus });
}

export function hideNotch() {
  return invoke<void>("notch_hide");
}

/** Fit the window to the pill's shape; `focusable` only while an approval wants keys. */
export function resizeNotch(width: number, height: number, focusable: boolean) {
  return invoke<void>("notch_resize", { width, height, focusable });
}

/**
 * Where the pill is in its window; the rest of the window lets clicks
 * through. `open`: more than the wings shows, so the pill stays on its screen.
 */
export function setNotchHitArea(
  area: { x: number; y: number; width: number; height: number },
  open: boolean,
) {
  return invoke<void>("notch_hit_area", { ...area, open });
}

/** Which screen the pill lives on: the pointer's, the Mac's own, or the main one. */
export type NotchScreen = "follow" | "builtin" | "main";

export function setNotchScreen(pref: NotchScreen) {
  return invoke<void>("notch_set_screen", { pref });
}

/** Mali starts at login, in the notch. */
export function getNotchLoginItem() {
  return invoke<boolean>("notch_login_item");
}

export function setNotchLoginItem(on: boolean) {
  return invoke<void>("notch_set_login_item", { on });
}

/** The main window, where the drop lands, in the pill's window. */
export type NotchDropTarget = {
  x: number;
  y: number;
  width: number;
  height: number;
};

/**
 * Ready the drop into the app: the pill's window covers the screen down to
 * the main window. `null` when the main window is up already.
 */
export function dropOut() {
  return invoke<NotchDropTarget | null>("notch_drop_out");
}

/** Hide the pill and bring the main window up on that chat. */
export function openMainFromNotch(chatId?: string) {
  return invoke<void>("notch_open_main", { chatId: chatId ?? null });
}

// ── main window side ──

export function sendNotchState(snapshot: NotchSnapshot | null) {
  return emitTo(NOTCH, STATE, snapshot);
}

/** The pill loaded (or reloaded) and needs the current state. */
export function onNotchReady(handler: () => void) {
  if (!isTauri()) return () => {};
  const stop = listen(READY, handler);
  return () => void stop.then((unlisten) => unlisten());
}

export function onNotchReply(handler: (reply: NotchReply) => void) {
  if (!isTauri()) return () => {};
  const stop = listen<NotchReply>(REPLY, (event) => handler(event.payload));
  return () => void stop.then((unlisten) => unlisten());
}

export function onNotchAnswer(handler: (answer: NotchAnswer) => void) {
  if (!isTauri()) return () => {};
  const stop = listen<NotchAnswer>(ANSWER, (event) => handler(event.payload));
  return () => void stop.then((unlisten) => unlisten());
}

// ── pill side ──

export function listenForNotchState(
  handler: (snapshot: NotchSnapshot | null) => void,
) {
  if (!isTauri()) return () => {};
  const stop = listen<NotchSnapshot | null>(STATE, (event) =>
    handler(event.payload),
  );
  // Ask only once listening, or the answer can arrive before anyone hears it.
  void stop.then(() => emitTo("main", READY)).catch(() => undefined);
  return () => void stop.then((unlisten) => unlisten());
}

/** The notch the pill hangs from: now, and again whenever it moves screens. */
export function listenForNotchGeometry(
  handler: (geometry: NotchGeometry) => void,
) {
  if (!isTauri()) return () => {};
  const stop = listen<NotchGeometry>(GEOMETRY, (event) =>
    handler(event.payload),
  );
  void invoke<NotchGeometry>("notch_geometry")
    .then(handler)
    .catch(() => undefined);
  return () => void stop.then((unlisten) => unlisten());
}

export function sendNotchReply(reply: NotchReply) {
  return emitTo("main", REPLY, reply);
}

/** The agent's question, answered in the notch. */
export function sendNotchAnswer(answer: NotchAnswer) {
  return emitTo("main", ANSWER, answer);
}

// ── notch mode ──

const MODE = "notch:mode";
const SUMMON = "notch:summon";
const HOVER = "notch:hover";
const INTRO = "notch:intro";
const MAIN_RETURN = "notch:main-return";

/** A point in the pill's window, in logical pixels. */
export type NotchPoint = { x: number; y: number };
/** How the pill appears: a dot flying up from `from`, or (none) the light along the top edge. */
export type NotchIntro = { from: NotchPoint | null };

/** Put the main window away and keep the pill at the top. */
export function enterNotchMode() {
  return invoke<NotchGeometry>("notch_enter_mode");
}

/** Back to the app, on `chatId` if given. */
export function exitNotchMode(chatId?: string) {
  return invoke<void>("notch_exit_mode", { chatId: chatId ?? null });
}

export function getNotchMode() {
  return invoke<boolean>("notch_mode");
}

/** The fly-in to play; once. */
export function takeNotchIntro() {
  return invoke<NotchIntro | null>("notch_take_intro");
}

/** The fly-in is over: the window goes back to the pill's own frame. */
export function finishNotchIntro() {
  return invoke<void>("notch_intro_done");
}

/** Relay: nothing to show. Hides the pill unless notch mode keeps it up. */
export function releaseNotch() {
  return invoke<void>("notch_release");
}

function on<T>(event: string, handler: (payload: T) => void) {
  if (!isTauri()) return () => {};
  const stop = listen<T>(event, (e) => handler(e.payload));
  return () => void stop.then((unlisten) => unlisten());
}

export const onNotchMode = (handler: (on: boolean) => void) =>
  on<boolean>(MODE, handler);
/** ⌥⌘M in notch mode. */
export const onNotchSummon = (handler: () => void) => on<null>(SUMMON, handler);
/** The cursor entered or left the pill (watched from Rust: works while Mali is in the background). */
export const onNotchHover = (handler: (inside: boolean) => void) =>
  on<boolean>(HOVER, handler);
/** The mouse wheel turned over the pill, as a `deltaY` (Windows: heard from Rust, since the pill's window never activates). */
export const onNotchWheel = (handler: (deltaY: number) => void) =>
  on<number>("notch:wheel", handler);
export const onNotchIntro = (handler: () => void) => on<null>(INTRO, handler);
/** A click landed off the open pill (watched from Rust): fold it at once. */
export const onNotchClickAway = (handler: () => void) =>
  on<null>("notch:click-away", handler);

/**
 * A system picker the pill opened: clicks in it land off the pill, and
 * mustn't fold it away while files are being picked.
 */
let pickers = 0;
export const pickerOpen = () => pickers > 0;
export async function whilePicking<T>(pick: () => Promise<T>): Promise<T> {
  pickers += 1;
  try {
    return await pick();
  } finally {
    pickers -= 1;
  }
}

/** The pill moved to another screen. */
export const onNotchMoved = (handler: () => void) =>
  on<null>("notch:moved", handler);
/** The app was asked for (the Dock, the tray): drop into it. */
export const onOpenApp = (handler: () => void) =>
  on<null>("notch:open-app", handler);
/** Main window: notch mode ended, play the way back in. */
export const onMainReturn = (handler: () => void) =>
  on<null>(MAIN_RETURN, handler);

// ── Cowork from the notch ──

const COWORK = "notch:cowork";
const COWORK_STARTED = "notch:cowork-started";
/** Long enough to answer the folder-access question. */
const COWORK_TIMEOUT_MS = 5 * 60_000;

/** Pill: ask the main window to work on this in a folder; resolves once it started or was queued. */
export function requestCowork(
  request: NotchCoworkRequest,
): Promise<NotchCoworkStarted> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (answer: NotchCoworkStarted) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      void stop.then((unlisten) => unlisten());
      resolve(answer);
    };
    const timer = setTimeout(
      () =>
        finish({
          id: request.id,
          error: "Mali didn't answer — is the app still running?",
        }),
      COWORK_TIMEOUT_MS,
    );
    const stop = listen<NotchCoworkStarted>(COWORK_STARTED, ({ payload }) => {
      if (payload.id === request.id) finish(payload);
    });
    void stop
      .then(() => emitTo("main", COWORK, request))
      .catch((error) => finish({ id: request.id, error: String(error) }));
  });
}

/** Pill → main: stop this work (a queued task is dropped, a running one stopped). */
export function requestStop(target: { chatId?: string; taskId?: string }) {
  return emitTo("main", "notch:stop", target);
}

/** Main window: the notch asked to stop work. */
export const onNotchStop = (
  handler: (target: { chatId?: string; taskId?: string }) => void,
) => on<{ chatId?: string; taskId?: string }>("notch:stop", handler);

/** Main window: work the notch asks for. */
export const onNotchCowork = (handler: (request: NotchCoworkRequest) => void) =>
  on<NotchCoworkRequest>(COWORK, handler);

export function sendCoworkStarted(answer: NotchCoworkStarted) {
  return emitTo(NOTCH, COWORK_STARTED, answer);
}

// ── drag & capture ──

/** Files are being dragged near the top of the screen (Rust watches the drag pasteboard). */
export const onNotchDrag = (handler: (near: boolean) => void) =>
  on<boolean>("notch:drag", handler);

/** A window captured for the ask box, and whose it was. */
export type NotchCapture = {
  attachment: import("@/features/attachments").Attachment;
  app: string;
  title: string;
};

/** The bot was let go: capture the window under the cursor; null when dropped back on the notch. */
export function captureAtCursor() {
  return invoke<NotchCapture | null>("notch_capture_at_cursor");
}

/** Pick a window to capture (Space switches to a region; Esc cancels). */
export function capturePick() {
  return invoke<NotchCapture | null>("notch_capture_pick");
}

/** Pill → main: open Settings → Team (with the new-bot form when `create`). */
export function openTeamInApp(create: boolean) {
  return emitTo("main", "notch:open-team", { create });
}

/** Main window: the notch asked for Settings → Team. */
export const onOpenTeam = (handler: (request: { create: boolean }) => void) =>
  on<{ create: boolean }>("notch:open-team", handler);

// ── sessions ──

const SESSIONS = "notch:sessions";
const SESSIONS_WANT = "notch:sessions-want";

/**
 * Pill → main: Home or the session list is on screen (true), or not any
 * more. The main window works out the overview (sessions, usage, the
 * week's recap) only while it's wanted.
 */
export function wantNotchSessions(on: boolean, week = 0) {
  return emitTo("main", SESSIONS_WANT, { on, week });
}

/** Main window: the pill wants the overview (with the recap of `week` weeks back), or is done with it. */
export const onNotchSessionsWant = (
  handler: (want: { on: boolean; week: number }) => void,
) => on<{ on: boolean; week: number }>(SESSIONS_WANT, handler);

export function sendNotchSessions(overview: NotchOverview) {
  return emitTo(NOTCH, SESSIONS, overview);
}

export const onNotchSessions = (handler: (overview: NotchOverview) => void) =>
  on<NotchOverview>(SESSIONS, handler);

// ── setup (onboarding) ──

const SETUP = "notch:setup";

/** Main window: setup scan or install progress for the pill. */
export function sendNotchSetup(setup: NotchSetup) {
  return emitTo(NOTCH, SETUP, setup);
}

export const onNotchSetup = (handler: (setup: NotchSetup) => void) =>
  on<NotchSetup>(SETUP, handler);

// ── look ──

export type BackdropRect = {
  x: number;
  y: number;
  width: number;
  height: number;
  radius: number;
};

/**
 * The frosted backdrop behind the open pill (macOS): `rect` is the pill in
 * its window, with its bottom corners' radius; coming into view it grows out
 * of `from` (the collapsed pill). `black` takes it away: with a rect it
 * shrinks there as it fades, without one at once. Resolves false where the
 * system can't blur behind a window.
 */
export function setNotchBackdrop(
  look: NotchLook,
  rect?: BackdropRect,
  from?: BackdropRect,
) {
  return invoke<boolean>("notch_backdrop", {
    look,
    rect: rect ?? null,
    from: from ?? null,
  });
}
