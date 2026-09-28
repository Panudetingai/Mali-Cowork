import { describe, expect, test } from "bun:test";
import { coworkInstructionsFor, extractCoworkBlock, looksLikeFileWork } from "./cowork-handoff";

describe("extractCoworkBlock", () => {
  test("hides the block and reads the task", () => {
    const reply = 'This needs Cowork.\n\n```cowork\n{"task": "สร้างไฟล์ notes.md"}\n```';
    const { text, suggestion } = extractCoworkBlock(reply);
    expect(text).toBe("This needs Cowork.");
    expect(suggestion).toEqual({ task: "สร้างไฟล์ notes.md" });
  });
  test("a block still streaming is hidden without a suggestion yet", () => {
    const { text, suggestion } = extractCoworkBlock('Sure.\n```cowork\n{"ta');
    expect(text).toBe("Sure.");
    expect(suggestion).toBeUndefined();
  });
  test("bad JSON still suggests, without a task", () => {
    expect(extractCoworkBlock("```cowork\nnot json\n```").suggestion).toEqual({ task: undefined });
  });
  test("a reply without a block is left alone", () => {
    expect(extractCoworkBlock("Hello")).toEqual({ text: "Hello" });
  });
});

describe("file-work detection", () => {
  test("Thai and English requests to do file work", () => {
    expect(looksLikeFileWork("สร้างไฟล์ใน folder นี้ให้หน่อย")).toBe(true);
    expect(looksLikeFileWork("save this as notes.md")).toBe(true);
    expect(looksLikeFileWork("Create a file with the summary")).toBe(true);
  });
  test("questions and chit-chat are not", () => {
    expect(looksLikeFileWork("how do I create a file in Python?")).toBe(false);
    expect(looksLikeFileWork("วิธีสร้างไฟล์ใน python ทำยังไง")).toBe(false);
    expect(looksLikeFileWork("tell me a joke")).toBe(false);
  });
  test("instructions only for prompts that might want files", () => {
    expect(coworkInstructionsFor("write a poem")).toBe("");
    expect(coworkInstructionsFor("บันทึกเป็นไฟล์ให้หน่อย")).toContain("```cowork");
  });
});
