/**
 * Notch pill ⇄ main window. The main window owns the runs, so the pill only
 * shows what it is sent and hands Allow / Deny back.
 */
import { invoke, isTauri } from "@tauri-apps/api/core";
import { emitTo, listen } from "@tauri-apps/api/event";
import type { NotchCoworkRequest, NotchCoworkStarted, NotchGeometry, NotchReply, NotchSnapshot } from "./types";

const NOTCH = "notch";
const STATE = "notch:state";
const READY = "notch:ready";
const REPLY = "notch:reply";
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

/** Where the pill is in its window; the rest of the window lets clicks through. */
export function setNotchHitArea(area: { x: number; y: number; width: number; height: number }) {
  return invoke<void>("notch_hit_area", area);
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

// ── pill side ──

export function listenForNotchState(handler: (snapshot: NotchSnapshot | null) => void) {
  if (!isTauri()) return () => {};
  const stop = listen<NotchSnapshot | null>(STATE, (event) => handler(event.payload));
  // Ask only once listening, or the answer can arrive before anyone hears it.
  void stop.then(() => emitTo("main", READY)).catch(() => undefined);
  return () => void stop.then((unlisten) => unlisten());
}

/** The notch the pill hangs from: now, and again whenever it moves screens. */
export function listenForNotchGeometry(handler: (geometry: NotchGeometry) => void) {
  if (!isTauri()) return () => {};
  const stop = listen<NotchGeometry>(GEOMETRY, (event) => handler(event.payload));
  void invoke<NotchGeometry>("notch_geometry").then(handler).catch(() => undefined);
  return () => void stop.then((unlisten) => unlisten());
}

export function sendNotchReply(reply: NotchReply) {
  return emitTo("main", REPLY, reply);
}

// ── notch mode ──

const MODE = "notch:mode";
const SUMMON = "notch:summon";
const HOVER = "notch:hover";
const INTRO = "notch:intro";
const MAIN_RETURN = "notch:main-return";

/** A point in physical screen pixels (where the main window shrank to) or in the pill's window. */
export type NotchPoint = { x: number; y: number };

/** Put the main window away and keep the pill at the top. */
export function enterNotchMode(from?: NotchPoint) {
  return invoke<NotchGeometry>("notch_enter_mode", { from: from ?? null });
}

/** Back to the app, on `chatId` if given. */
export function exitNotchMode(chatId?: string) {
  return invoke<void>("notch_exit_mode", { chatId: chatId ?? null });
}

export function getNotchMode() {
  return invoke<boolean>("notch_mode");
}

/** Where the fly-in starts, in the pill's window; once. */
export function takeNotchIntro() {
  return invoke<NotchPoint | null>("notch_take_intro");
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

export const onNotchMode = (handler: (on: boolean) => void) => on<boolean>(MODE, handler);
/** ⌥⌘M in notch mode. */
export const onNotchSummon = (handler: () => void) => on<null>(SUMMON, handler);
/** The cursor entered or left the pill (watched from Rust: works while Mali is in the background). */
export const onNotchHover = (handler: (inside: boolean) => void) => on<boolean>(HOVER, handler);
export const onNotchIntro = (handler: () => void) => on<null>(INTRO, handler);
/** Main window: notch mode ended, play the way back in. */
export const onMainReturn = (handler: () => void) => on<null>(MAIN_RETURN, handler);

// ── Cowork from the notch ──

const COWORK = "notch:cowork";
const COWORK_STARTED = "notch:cowork-started";
/** Long enough to answer the folder-access question. */
const COWORK_TIMEOUT_MS = 5 * 60_000;

/** Pill: ask the main window to work on this in a folder; resolves once it started or was queued. */
export function requestCowork(request: NotchCoworkRequest): Promise<NotchCoworkStarted> {
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
      () => finish({ id: request.id, error: "Mali didn't answer — is the app still running?" }),
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

/** Main window: work the notch asks for. */
export const onNotchCowork = (handler: (request: NotchCoworkRequest) => void) => on<NotchCoworkRequest>(COWORK, handler);

export function sendCoworkStarted(answer: NotchCoworkStarted) {
  return emitTo(NOTCH, COWORK_STARTED, answer);
}

// ── drag & capture ──

/** Files are being dragged near the top of the screen (Rust watches the drag pasteboard). */
export const onNotchDrag = (handler: (near: boolean) => void) => on<boolean>("notch:drag", handler);

/** A window captured for the ask box, and whose it was. */
export type NotchCapture = { attachment: import("@/features/attachments").Attachment; app: string; title: string };

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
