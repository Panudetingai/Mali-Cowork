/** Block common DevTools shortcuts in packaged Tauri builds (release frontend). */
export function applyProductionHardening() {
  if (!import.meta.env.PROD) return;
  const inTauri = "__TAURI__" in window || "__TAURI_INTERNALS__" in window;
  if (!inTauri) return;

  window.addEventListener(
    "keydown",
    (e) => {
      if (e.key === "F12") {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if (!e.ctrlKey || !e.shiftKey) return;
      const k = e.key.toLowerCase();
      if (k === "i" || k === "j" || k === "c") {
        e.preventDefault();
        e.stopPropagation();
      }
    },
    true,
  );
}
