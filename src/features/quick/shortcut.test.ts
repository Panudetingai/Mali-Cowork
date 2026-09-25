import { describe, expect, test } from "bun:test";
import { recordShortcut, shortcutKeys } from "./shortcut";

const press = (code: string, mods: Partial<Record<"metaKey" | "ctrlKey" | "altKey" | "shiftKey", boolean>> = {}, key = "x") => ({
  code,
  key,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...mods,
});

describe("recordShortcut", () => {
  test("⌥⌘M on macOS records the portable accelerator", () => {
    expect(recordShortcut(press("KeyM", { metaKey: true, altKey: true }, "µ"), true)).toEqual({
      status: "ok",
      accelerator: "CommandOrControl+Alt+M",
    });
  });

  test("Ctrl+Alt+M on Windows records the same accelerator", () => {
    expect(recordShortcut(press("KeyM", { ctrlKey: true, altKey: true }), false)).toEqual({
      status: "ok",
      accelerator: "CommandOrControl+Alt+M",
    });
  });

  test("a Thai layout still records the physical key", () => {
    expect(recordShortcut(press("KeyM", { metaKey: true, shiftKey: true }, "ท"), true)).toMatchObject({
      accelerator: "CommandOrControl+Shift+M",
    });
  });

  test("waits while only modifiers are down", () => {
    expect(recordShortcut(press("MetaLeft", { metaKey: true }, "Meta"), true).status).toBe("incomplete");
  });

  test("needs a real modifier", () => {
    expect(recordShortcut(press("KeyM"), true).status).toBe("invalid");
    expect(recordShortcut(press("KeyM", { shiftKey: true }), true).status).toBe("invalid");
    expect(recordShortcut(press("Tab", { metaKey: true }, "Tab"), true).status).toBe("invalid");
  });
});

describe("shortcutKeys", () => {
  test("macOS symbols in Apple's order", () => {
    expect(shortcutKeys("CommandOrControl+Alt+M", true)).toEqual(["⌥", "⌘", "M"]);
    expect(shortcutKeys("Shift+Control+Space", true)).toEqual(["⌃", "⇧", "Space"]);
  });

  test("names elsewhere", () => {
    expect(shortcutKeys("CommandOrControl+Alt+M", false)).toEqual(["Ctrl", "Alt", "M"]);
  });
});
