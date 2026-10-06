/**
 * Main window ⇄ notch mode. Going in, the window shrinks to a glowing dot
 * where it is, then hides; the pill's window flies the dot up to the notch
 * (`notch-intro.tsx`). Coming back, a drop falls from the notch into the
 * window's middle (`notch-outro.tsx`) and the window opens out of it.
 *
 * The window stays shrunk to the dot while it's away, so however it comes
 * back (the drop, the Dock, the tray) it opens from the dot and never shows
 * a stale frame first. The shrink needs the window to be see-through around
 * the page, which it is on macOS only; elsewhere the window just goes, and
 * drops in from the top when it returns.
 *
 * Started at login in the notch, the window starts hidden and its pages
 * wait (`useMainAwake`): nothing of the app is drawn until it's opened.
 */
import { createStore } from "@/lib/local-store";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { enterNotchMode, onMainReturn } from "./bridge";

const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const isMac = () => navigator.userAgent.includes("Mac");
/** The window shrinks to this, and opens from it. */
const DOT = { clipPath: "circle(13px at 50% 50%)", filter: "brightness(3) blur(2px)" };
const FULL = { clipPath: "circle(75% at 50% 50%)", filter: "brightness(1) blur(0px)" };

/** The window is shrunk to the dot, waiting to open. */
let armed = false;

function shrinkable() {
  return isMac() && !reduced();
}

/** Hold the page at the dot while the window is away. */
function arm(root: HTMLElement) {
  clearRootClip(root);
  root.style.clipPath = DOT.clipPath;
  root.style.filter = DOT.filter;
  armed = true;
}

function clearRootClip(root: HTMLElement) {
  root.getAnimations().forEach((a) => a.cancel());
  root.style.clipPath = "";
  root.style.filter = "";
}

/** Drop notch shrink / clip so the full chat page paints (no stale setup frame at the edges). */
export function resetMainRootClip() {
  armed = false;
  const root = document.getElementById("root");
  if (root) clearRootClip(root);
}

/** Open out of the dot. */
function reveal() {
  if (!armed) return;
  armed = false;
  const root = document.getElementById("root");
  if (!root) return;
  clearRootClip(root);
  const anim = root.animate(
    [DOT, { clipPath: "circle(30px at 50% 50%)", filter: "brightness(1.8) blur(1px)", offset: 0.22 }, FULL],
    { duration: 560, easing: "cubic-bezier(0.3, 0, 0.15, 1)", fill: "forwards" },
  );
  void anim.finished
    .then(() => clearRootClip(root))
    .catch(() => clearRootClip(root));
}

export async function goToNotchMode() {
  const root = document.getElementById("root");
  if (root && shrinkable()) {
    const shrink = root.animate(
      [FULL, { clipPath: "circle(20px at 50% 50%)", filter: "brightness(1.5) blur(1px)", offset: 0.75 }, DOT],
      { duration: 520, easing: "cubic-bezier(0.6, 0, 0.3, 1)", fill: "forwards" },
    );
    await shrink.finished.catch(() => undefined);
  }
  try {
    await enterNotchMode();
  } finally {
    // The window is hidden now: it waits at the dot to open from it again.
    setTimeout(() => {
      if (root && shrinkable()) arm(root);
      else root?.getAnimations().forEach((a) => a.cancel());
    }, 80);
  }
}

/** Main window: when notch mode ends (or the window shows by any way), open back up. */
export function playMainReturn() {
  const stopReturn = onMainReturn(() => {
    if (armed) return reveal();
    const root = document.getElementById("root");
    if (!root || reduced()) return;
    root.animate(
      [
        { opacity: 0, transform: "translateY(-28px) scale(0.94)", filter: "blur(10px)" },
        { opacity: 1, transform: "translateY(0) scale(1)", filter: "blur(0px)" },
      ],
      { duration: 420, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" },
    );
  });
  // The Dock, the tray, "Open Mali" in the Quick bar: the window gets focus.
  const onFocus = () => reveal();
  window.addEventListener("focus", onFocus);
  return () => {
    stopReturn();
    window.removeEventListener("focus", onFocus);
  };
}

// ── started in the notch ──

const awakeStore = createStore<boolean>(true);

/** The main window's pages are drawn: it has been shown at least once. */
export const useMainAwake = awakeStore.use;
export const mainAwake = awakeStore.get;
export const onMainAwake = awakeStore.subscribe;

/**
 * Before the first render: a main window that starts hidden (Mali started
 * at login, in the notch) draws nothing until it's first shown. The stores,
 * the relay and the task queue run all the same.
 */
export async function checkMainAwake() {
  if (!isTauri()) return;
  let visible = true;
  try {
    visible = await getCurrentWindow().isVisible();
  } catch {
    return;
  }
  if (visible) return;
  awakeStore.set(false);
  const root = document.getElementById("root");
  if (root && shrinkable()) arm(root);
  const wake = () => {
    if (awakeStore.get()) return;
    awakeStore.set(true);
    stopReturn();
    window.removeEventListener("focus", wake);
    document.removeEventListener("visibilitychange", onVisible);
  };
  const onVisible = () => document.visibilityState === "visible" && wake();
  const stopReturn = onMainReturn(wake);
  window.addEventListener("focus", wake);
  document.addEventListener("visibilitychange", onVisible);
}
