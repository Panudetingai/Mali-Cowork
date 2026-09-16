import {
  Effect,
  EffectState,
  getCurrentWindow,
} from "@tauri-apps/api/window";

const WINDOW_RADIUS = 12;

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

  try {
    await win.setShadow(true);
  } catch {
    // Windows/Linux may ignore on some builds
  }

  try {
    await win.setEffects({
      effects: [Effect.HudWindow],
      state: EffectState.Active,
      radius: WINDOW_RADIUS,
    });
  } catch {
    // radius applies on macOS only
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
