/**
 * Main window ⇄ notch mode. Going in, the window shrinks to a glowing dot
 * where it is, then hides; the pill's window flies the dot up to the notch
 * (`notch-intro.tsx`). Coming back, the window drops in from the top.
 *
 * The shrink needs the window to be see-through around the page, which it
 * is on macOS only; elsewhere the window just goes.
 */
import { getCurrentWindow } from "@tauri-apps/api/window";
import { enterNotchMode, onMainReturn } from "./bridge";

const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const isMac = () => navigator.userAgent.includes("Mac");

export async function goToNotchMode() {
  const win = getCurrentWindow();
  const [pos, size] = await Promise.all([win.outerPosition(), win.outerSize()]);
  const from = { x: pos.x + size.width / 2, y: pos.y + size.height / 2 };
  const root = document.getElementById("root");
  if (root && isMac() && !reduced()) {
    const shrink = root.animate(
      [
        { clipPath: "circle(75% at 50% 50%)", filter: "brightness(1) blur(0px)" },
        { clipPath: "circle(20px at 50% 50%)", filter: "brightness(1.5) blur(1px)", offset: 0.75 },
        { clipPath: "circle(13px at 50% 50%)", filter: "brightness(3) blur(2px)" },
      ],
      { duration: 520, easing: "cubic-bezier(0.6, 0, 0.3, 1)", fill: "forwards" },
    );
    await shrink.finished.catch(() => undefined);
  }
  try {
    await enterNotchMode(from);
  } finally {
    // The window is hidden now; put the page back for when it returns.
    setTimeout(() => root?.getAnimations().forEach((a) => a.cancel()), 80);
  }
}

/** Main window: when notch mode ends, drop back in from the top. */
export function playMainReturn() {
  return onMainReturn(() => {
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
}
