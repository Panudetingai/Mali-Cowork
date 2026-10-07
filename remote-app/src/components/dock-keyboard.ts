/**
 * Mobile composer UX: hide the model chip while typing and keep iOS from
 * showing the prev/next field bar (fewer tab stops in the dock).
 */
export function attachDockKeyboardUX() {
  const dock = document.getElementById("dock");
  const input = document.getElementById("input") as HTMLTextAreaElement | null;
  const ctx = document.getElementById("ctx");
  if (!dock || !input || !ctx) return;

  const setTyping = (on: boolean) => {
    dock.classList.toggle("typing", on);
    ctx.setAttribute("aria-hidden", on ? "true" : "false");
  };

  input.addEventListener("focus", () => setTyping(true));
  input.addEventListener("blur", () => {
    // Defer so taps on send still register before we expand the dock again.
    setTimeout(() => {
      if (document.activeElement !== input) setTyping(false);
    }, 80);
  });

  if (window.visualViewport) {
    const vv = window.visualViewport;
    const onResize = () => {
      const keyboard = vv.height < window.innerHeight * 0.75;
      dock.classList.toggle("keyboard", keyboard);
    };
    vv.addEventListener("resize", onResize);
    vv.addEventListener("scroll", onResize);
    onResize();
  }
}
