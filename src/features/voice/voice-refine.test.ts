import { describe, expect, test } from "bun:test";
import { refineVoiceTranscript, voiceConfirmNo, voiceConfirmYes } from "./voice-refine";

describe("refineVoiceTranscript", () => {
  test("I mean replaces the last word", () => {
    const r = refineVoiceTranscript("use cloud I mean claude");
    expect(r.text).toBe("use claude");
    expect(r.needsConfirm).toBe(true);
    expect(r.confirmHint).toBe("claude");
  });

  test("หมายถึง replaces the last word", () => {
    const r = refineVoiceTranscript("ใช้ cloud หมายถึง claude");
    expect(r.text).toBe("ใช้ claude");
    expect(r.needsConfirm).toBe(true);
  });

  test("plain text passes through", () => {
    const r = refineVoiceTranscript("hello world");
    expect(r).toEqual({ text: "hello world", needsConfirm: false });
  });

  test("no with short correction", () => {
    const r = refineVoiceTranscript("use cloud no claude");
    expect(r.text).toBe("use claude");
    expect(r.needsConfirm).toBe(true);
  });
});

describe("voiceConfirmYes", () => {
  test("accepts Thai and English", () => {
    expect(voiceConfirmYes("ใช่ครับ")).toBe(true);
    expect(voiceConfirmYes("yes")).toBe(true);
    expect(voiceConfirmYes("maybe")).toBe(false);
  });
});

describe("voiceConfirmNo", () => {
  test("rejects", () => {
    expect(voiceConfirmNo("ไม่ใช่")).toBe(true);
    expect(voiceConfirmNo("yes")).toBe(false);
  });
});
