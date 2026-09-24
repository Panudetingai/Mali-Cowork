import { describe, expect, test } from "bun:test";
import { buildQuickPrompt, DEFAULT_QUICK_ACTIONS } from "./actions";

const summarize = DEFAULT_QUICK_ACTIONS.find((a) => a.id === "summarize")!;

describe("buildQuickPrompt", () => {
  test("an action works on the clipboard", () => {
    const out = buildQuickPrompt({ prompt: "", action: summarize, clipboardText: "  รายงานไตรมาส 3  " });
    expect(out).toContain("รายงานไตรมาส 3");
    expect(out).not.toContain("{input}");
    expect(out).not.toContain("หมายเหตุ");
  });

  test("without a clipboard, the action works on what was typed", () => {
    expect(buildQuickPrompt({ prompt: "hello", action: summarize })).toContain("hello");
  });

  test("typed text with a clipboard becomes a note on the action", () => {
    const out = buildQuickPrompt({ prompt: "เน้นตัวเลข", action: summarize, clipboardText: "ข้อความ" });
    expect(out).toContain("ข้อความ");
    expect(out).toContain("หมายเหตุจากผู้ใช้: เน้นตัวเลข");
  });

  test("no action: the question, then the clipboard", () => {
    expect(buildQuickPrompt({ prompt: "นี่คืออะไร", clipboardText: "x = 1" })).toBe("นี่คืออะไร\n\n---\nx = 1");
    expect(buildQuickPrompt({ prompt: " hi " })).toBe("hi");
  });

  test("an action without {input} still gets the input", () => {
    const out = buildQuickPrompt({ prompt: "", action: { id: "c", label: "c", prompt: "ตรวจคำผิด" }, clipboardText: "ข้อความ" });
    expect(out).toBe("ตรวจคำผิด\n\nข้อความ");
  });
});
