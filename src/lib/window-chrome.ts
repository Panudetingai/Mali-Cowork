import { getCurrentWindow } from "@tauri-apps/api/window";

function isTauri() {
  return "__TAURI__" in window || "__TAURI_INTERNALS__" in window;
}

function syncMaximizedClass(isMaximized: boolean) {
  document.documentElement.dataset.windowMaximized = isMaximized
    ? "true"
    : "false";
}

/**
 * Maximize / restore using the OS animation (instant setSize has no transition).
 * Corner radius is animated in CSS when `data-window-maximized` toggles.
 */
export async function toggleFillScreen(): Promise<boolean> {
  if (!isTauri()) return false;

  const win = getCurrentWindow();
  const max = await win.isMaximized();

  if (max) {
    syncMaximizedClass(false);
    await win.unmaximize();
    return false;
  }

  syncMaximizedClass(true);
  await win.maximize();
  return true;
}

/** @deprecated Native maximize only; kept for titlebar resize listener. */
export function isFillScreenActive() {
  return false;
}

export async function applyWindowChrome() {
  if (!isTauri()) return;

  const win = getCurrentWindow();

  // The system shadow follows the rounded #root (index.css) on the transparent
  // macOS window. No vibrancy effect: #root is opaque, so it only ever showed
  // as a dark rim around the corners, worst in light mode.
  try {
    await win.setShadow(true);
  } catch {
    // Windows/Linux may ignore on some builds
  }

  try {
    const sync = async () => {
      syncMaximizedClass(await win.isMaximized());
    };
    await sync();
    await win.onResized(async () => {
      await sync();
    });
  } catch {
    // browser preview
  }
}
