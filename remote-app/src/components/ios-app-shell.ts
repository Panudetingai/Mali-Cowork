/** Pinch/double-tap zoom off + fewer iOS keyboard accessory targets (inert hidden UI). */

const passiveFalse: AddEventListenerOptions = { passive: false };

function preventPinchZoom() {
  document.addEventListener("gesturestart", (e) => e.preventDefault(), passiveFalse);
  document.addEventListener("gesturechange", (e) => e.preventDefault(), passiveFalse);
  document.addEventListener("gestureend", (e) => e.preventDefault(), passiveFalse);

  let lastTouchEnd = 0;
  document.addEventListener(
    "touchend",
    (e) => {
      const now = Date.now();
      if (now - lastTouchEnd <= 320) e.preventDefault();
      lastTouchEnd = now;
    },
    passiveFalse,
  );
}

export function installIosAppShell() {
  preventPinchZoom();
  setSheetOpen(false);
}

export function setActiveScreen(which: "connect" | "app") {
  const connect = document.getElementById("connect");
  const app = document.getElementById("app");
  if (which === "app") {
    connect?.setAttribute("inert", "");
    app?.removeAttribute("inert");
  } else {
    app?.setAttribute("inert", "");
    connect?.removeAttribute("inert");
  }
}

export function setSheetOpen(open: boolean) {
  const sheet = document.getElementById("sheet");
  const scrim = document.getElementById("scrim");
  if (open) {
    sheet?.removeAttribute("inert");
    scrim?.removeAttribute("inert");
  } else {
    sheet?.setAttribute("inert", "");
    scrim?.setAttribute("inert", "");
  }
}
