import { getCurrentWindow } from "@tauri-apps/api/window";

function isTauri() {
  return "__TAURI__" in window || "__TAURI_INTERNALS__" in window;
}

function syncMaximizedClass(isMaximized: boolean) {
  document.documentElement.dataset.windowMaximized = isMaximized
    ? "true"
    : "false";
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
    syncMaximizedClass(await win.isMaximized());
    await win.onResized(async () => {
      syncMaximizedClass(await win.isMaximized());
    });
  } catch {
    // browser preview
  }
}
