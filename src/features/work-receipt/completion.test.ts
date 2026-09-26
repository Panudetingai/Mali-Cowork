import { describe, expect, test } from "bun:test";
import { completionParts } from "./completion";
import type { WorkReceipt } from "./types";

const receipt = (over: Partial<WorkReceipt> = {}): WorkReceipt => ({
  chatId: "c",
  messageId: "m",
  files: { added: 2, modified: 6, deleted: 0, renamed: 0, additions: 10, deletions: 2, changes: [] },
  commands: ["npm test", "npm run build", "ls"],
  connectors: [{ serverId: "custom-notion", name: "Notion", calls: 2 }],
  steps: { total: 12, failed: 0 },
  durationMs: 190_000,
  usage: { cost: 0.0421 },
  state: "applied",
  partial: false,
  ...over,
});

describe("completionParts", () => {
  test("says what the turn did, in Thai", () => {
    expect(completionParts(receipt(), "th")).toEqual([
      "สร้าง 2 ไฟล์",
      "แก้ 6 ไฟล์",
      "รัน 3 คำสั่ง",
      "ใช้ Notion",
      "3 นาที 10 วิ",
      "$0.04",
    ]);
  });

  test("and in English, with singulars", () => {
    const one = receipt({ files: { added: 1, modified: 0, deleted: 0, renamed: 0, additions: 1, deletions: 0, changes: [] }, commands: ["ls"], connectors: [], durationMs: 42_000, usage: undefined });
    expect(completionParts(one, "en")).toEqual(["Created 1 file", "Ran 1 command", "42s"]);
  });

  test("a turn with nothing to show gets no line", () => {
    const quiet = receipt({ files: { added: 0, modified: 0, deleted: 0, renamed: 0, additions: 0, deletions: 0, changes: [] }, commands: [], connectors: [] });
    expect(completionParts(quiet, "th")).toEqual([]);
  });
});
