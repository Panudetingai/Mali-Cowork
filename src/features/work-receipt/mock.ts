/**
 * Sample Cowork chats for building Epic C screens without real history.
 * Feed them to `buildWorkReceipt` / `listOutputs` / `buildWeeklyRecap` in
 * dev only — never import this from production code paths.
 */
import type { ChatSession } from "@/features/chat-history";
import type { FileChange } from "@/features/checkpoints";

const HOUR = 60 * 60 * 1000;
const now = Date.now();
const DOCS = "/Users/demo/Documents/Reports";
const APP = "/Users/demo/workspace/shop-app";

const file = (root: string, relative: string, kind: FileChange["kind"], lines = 0): FileChange => ({
  path: `${root}/${relative}`,
  relative,
  kind,
  size: 1200 + lines * 40,
  additions: kind === "deleted" ? 0 : lines,
  deletions: kind === "added" ? 0 : Math.round(lines / 3),
  restorable: true,
});

export const MOCK_SESSIONS: ChatSession[] = [
  {
    id: "mock-chat-reports",
    title: "สรุปรายงานประจำเดือน",
    createdAt: now - 26 * HOUR,
    updatedAt: now - 2 * HOUR,
    mode: "cowork",
    cwd: DOCS,
    projectId: "mock-project-ops",
    messages: [
      { id: "m1", role: "user", content: "สรุป PDF ทั้งหมดในโฟลเดอร์นี้เป็นตาราง แล้วทำสไลด์ 5 หน้า", createdAt: now - 3 * HOUR },
      {
        id: "m2",
        role: "assistant",
        content: "สรุปไฟล์ 12 ไฟล์เรียบร้อย สร้างตารางและสไลด์ไว้ให้แล้ว",
        createdAt: now - 2 * HOUR,
        modelId: "anthropic/claude-sonnet-5",
        durationMs: 184_000,
        usage: { inputTokens: 48_200, outputTokens: 6_100, totalTokens: 54_300, cost: 0.31 },
        activities: [
          { kind: "tool", title: "Read: Q3-sales.pdf", done: true, durationMs: 1200 },
          { kind: "tool", title: "Read: Q3-costs.pdf", done: true, durationMs: 900 },
          { kind: "tool", title: "Run: python summarize.py", done: true, durationMs: 14_000 },
          { kind: "tool", title: "word_create_document", done: true, durationMs: 3_000 },
          { kind: "tool", title: "Write: summary.csv", done: true, durationMs: 300 },
        ],
        turn: {
          checkpointId: "mock-cp-1",
          state: "applied",
          changes: [
            file(DOCS, "summary.csv", "added", 40),
            file(DOCS, "summary.docx", "added"),
            file(DOCS, "slides/q3-review.pptx", "added"),
            file(DOCS, "index.md", "modified", 12),
          ],
        },
      },
    ],
  },
  {
    id: "mock-chat-app",
    title: "แก้ bug ตะกร้าสินค้า",
    createdAt: now - 50 * HOUR,
    updatedAt: now - 48 * HOUR,
    mode: "cowork",
    cwd: APP,
    messages: [
      { id: "m3", role: "user", content: "ตะกร้าคำนวณส่วนลดผิด แก้ให้หน่อยพร้อม test", createdAt: now - 49 * HOUR },
      {
        id: "m4",
        role: "assistant",
        content: "แก้การปัดเศษส่วนลดและเพิ่ม test 3 เคส ผ่านทั้งหมด",
        createdAt: now - 48 * HOUR,
        modelId: "codex/gpt-5.3-codex",
        durationMs: 96_000,
        usage: { inputTokens: 31_000, outputTokens: 4_200, totalTokens: 35_200, cost: 0.12 },
        activities: [
          { kind: "tool", title: "Read: src/cart.ts", done: true, durationMs: 400 },
          { kind: "tool", title: "Edit: src/cart.ts", done: true, durationMs: 700 },
          { kind: "tool", title: "Run: bun test (failed)", done: true, durationMs: 5_200 },
          { kind: "tool", title: "Run: bun test", done: true, durationMs: 4_900 },
        ],
        turn: {
          checkpointId: "mock-cp-2",
          state: "applied",
          changes: [file(APP, "src/cart.ts", "modified", 18), file(APP, "src/cart.test.ts", "added", 64)],
        },
      },
      { id: "m5", role: "user", content: "ลองเปลี่ยนเป็น decimal.js", createdAt: now - 47 * HOUR },
      {
        id: "m6",
        role: "assistant",
        content: "เปลี่ยนแล้ว แต่คุณกด Undo ไป",
        createdAt: now - 46 * HOUR,
        modelId: "codex/gpt-5.3-codex",
        durationMs: 40_000,
        usage: { totalTokens: 12_000, cost: 0.04 },
        activities: [{ kind: "tool", title: "Edit: src/cart.ts", done: true }],
        turn: {
          checkpointId: "mock-cp-3",
          state: "undone",
          changes: [file(APP, "src/cart.ts", "modified", 9), file(APP, "src/money.ts", "added", 20)],
        },
      },
    ],
  },
];
