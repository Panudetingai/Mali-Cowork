/**
 * Tauri accelerators (`CommandOrControl+Alt+M`) ⇄ what the user presses and
 * sees. `CommandOrControl` is ⌘ on macOS and Ctrl elsewhere, so a shortcut
 * recorded on one system reads naturally on the other.
 */

type KeyEventLike = Pick<KeyboardEvent, "key" | "code" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">;

const MODIFIER_KEYS = new Set(["Meta", "Control", "Alt", "Shift", "OS", "CapsLock", "Fn"]);

/** `KeyM` → `M`, `Digit4` → `4`, `ArrowUp` → `Up`; undefined for keys we don't bind. */
function keyOf(code: string): string | undefined {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^F([1-9]|1[0-2])$/.test(code)) return code;
  const named: Record<string, string> = {
    Space: "Space",
    Enter: "Enter",
    Backquote: "`",
    Minus: "-",
    Equal: "=",
    BracketLeft: "[",
    BracketRight: "]",
    Semicolon: ";",
    Quote: "'",
    Comma: ",",
    Period: ".",
    Slash: "/",
    Backslash: "\\",
    ArrowUp: "Up",
    ArrowDown: "Down",
    ArrowLeft: "Left",
    ArrowRight: "Right",
  };
  return named[code];
}

export type RecordResult =
  | { status: "incomplete" }
  | { status: "invalid"; reason: string }
  | { status: "ok"; accelerator: string };

/**
 * Read a keydown as a shortcut. Uses `code`, not `key`, so a Thai keyboard
 * layout (or ⌥ turning M into µ on macOS) still records `M`.
 */
export function recordShortcut(event: KeyEventLike, mac: boolean): RecordResult {
  if (MODIFIER_KEYS.has(event.key)) return { status: "incomplete" };
  const key = keyOf(event.code);
  if (!key) return { status: "invalid", reason: "This key can't be part of a shortcut." };
  const primary = mac ? event.metaKey : event.ctrlKey;
  const secondary = mac ? event.ctrlKey : event.metaKey;
  const parts = [
    primary && "CommandOrControl",
    secondary && (mac ? "Control" : "Super"),
    event.altKey && "Alt",
    event.shiftKey && "Shift",
  ].filter(Boolean) as string[];
  // Shift alone still types a character; it can't be a global shortcut.
  if (parts.length === 0 || (parts.length === 1 && event.shiftKey)) {
    return { status: "invalid", reason: mac ? "Add ⌘, ⌥ or ⌃." : "Add Ctrl, Alt or Win." };
  }
  return { status: "ok", accelerator: [...parts, key].join("+") };
}

const MAC_SYMBOL: Record<string, string> = {
  commandorcontrol: "⌘",
  cmdorctrl: "⌘",
  command: "⌘",
  cmd: "⌘",
  super: "⌘",
  control: "⌃",
  ctrl: "⌃",
  alt: "⌥",
  option: "⌥",
  shift: "⇧",
};
const MAC_ORDER = ["⌃", "⌥", "⇧", "⌘"];

const PC_NAME: Record<string, string> = {
  commandorcontrol: "Ctrl",
  cmdorctrl: "Ctrl",
  control: "Ctrl",
  ctrl: "Ctrl",
  alt: "Alt",
  option: "Alt",
  shift: "Shift",
  super: "Win",
  command: "Win",
  cmd: "Win",
};
const PC_ORDER = ["Ctrl", "Win", "Alt", "Shift"];

/** Keycaps to draw: `["⌥", "⌘", "M"]` on macOS, `["Ctrl", "Alt", "M"]` elsewhere. */
export function shortcutKeys(accelerator: string, mac: boolean): string[] {
  const parts = accelerator.split("+").map((p) => p.trim()).filter(Boolean);
  const key = parts.pop() ?? "";
  const names = mac ? MAC_SYMBOL : PC_NAME;
  const order = mac ? MAC_ORDER : PC_ORDER;
  const mods = [...new Set(parts.map((p) => names[p.toLowerCase()] ?? p))].sort(
    (a, b) => order.indexOf(a) - order.indexOf(b),
  );
  return [...mods, key.length === 1 ? key.toUpperCase() : key];
}

export const isMacPlatform = () => typeof navigator !== "undefined" && /Mac/i.test(navigator.platform);
