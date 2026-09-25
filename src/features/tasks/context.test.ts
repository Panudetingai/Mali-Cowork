import { describe, expect, test } from "bun:test";
import { carriedConversation } from "./context";

describe("carriedConversation", () => {
  test("brings the source chat's content to the task", () => {
    const out = carriedConversation(
      [
        { id: "1", role: "user", content: "นี่คือเนื้อหาเรื่องแผนการตลาด Q4" },
        { id: "2", role: "assistant", content: "สรุป: เน้นลูกค้าเดิม 3 กลุ่ม" },
      ],
      "แผนการตลาด",
      8000,
    );
    expect(out).toContain("<conversation_so_far>");
    expect(out).toContain("แผนการตลาด Q4");
    expect(out).toContain("เน้นลูกค้าเดิม 3 กลุ่ม");
    expect(out).toContain("“แผนการตลาด”");
  });

  test("nothing to carry from an empty chat", () => {
    expect(carriedConversation([], "x", 8000)).toBe("");
    expect(carriedConversation([{ id: "e", role: "error", content: "boom" }], "x", 8000)).toBe("");
  });
});
