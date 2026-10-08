import { describe, expect, test } from "bun:test";
import type { ChatRun, ChatSession } from "@/features/chat-history";
import type { PermissionRequest } from "@/pages/chat/api/chat";
import type { ActivityItem, ChatMessage } from "@/pages/chat/types";
import { filesOf, remoteChat, remoteState } from "./snapshot";

const run = (permissions: PermissionRequest[] = []): ChatRun => ({ token: "t", modelId: "m", permissions, questions: [] });

const chat = (id: string, updatedAt: number, messages: ChatMessage[], extra: Partial<ChatSession> = {}): ChatSession => ({
  id,
  title: `Chat ${id}`,
  createdAt: 0,
  updatedAt,
  messages,
  ...extra,
});

const user = (content: string): ChatMessage => ({ id: `u-${content}`, role: "user", content, createdAt: 1 });
const reply = (content: string, extra: Partial<ChatMessage> = {}): ChatMessage => ({
  id: `a-${content}`,
  role: "assistant",
  content,
  ...extra,
});
const step = (title: string, done = true, detail?: string): ActivityItem => ({ kind: "tool", title, done, detail });

const DIFF = ["--- a/src/app.ts", "+++ b/src/app.ts", "@@ -1,2 +1,3 @@", " keep", "-old", "+new", "+more"].join("\n");

describe("remoteState", () => {
  test("running chats come first, with their steps and approvals", () => {
    const ask: PermissionRequest = { id: "p1", directory: "/r", permission: "bash", patterns: ["rm -rf dist"], title: "Run rm" };
    const state = remoteState(
      [
        chat("old", 50, [user("hi"), reply("hello")]),
        chat("busy", 10, [user("go"), reply("", { isStreaming: true, activities: [step("Read a.ts"), step("Run npm test", false)] })], {
          mode: "cowork",
          cwd: "/Users/me/repo",
        }),
      ],
      { busy: run([ask]) },
      () => true,
    );
    expect(state.sessions.map((s) => s.id)).toEqual(["busy", "old"]);
    expect(state.sessions[0]).toMatchObject({ running: true, waiting: true, folder: "repo", mode: "cowork" });
    expect(state.runs).toHaveLength(1);
    expect(state.runs[0].steps.map((s) => s.title)).toEqual(["Read a.ts", "Run npm test"]);
    expect(state.runs[0].permissions).toEqual([{ id: "p1", title: "Run rm", command: "rm -rf dist" }]);
  });

  test("streamed text alone doesn't change a chat's rev", () => {
    const at = (text: string) =>
      remoteState([chat("c", 1, [user("q"), reply(text, { isStreaming: true })])], { c: run() }, () => true).sessions[0].rev;
    expect(at("Hel")).toBe(at("Hello there"));
  });

  test("an unlisted chat shows only while it runs", () => {
    const task = chat("task", 1, [user("q")], { inboxTask: true });
    const listed = (c: ChatSession) => !c.inboxTask;
    expect(remoteState([task], {}, listed).sessions).toHaveLength(0);
    expect(remoteState([task], { task: run() }, listed).sessions).toHaveLength(1);
  });
});

describe("remoteChat", () => {
  test("an answer being written sends its steps, not its text", () => {
    const view = remoteChat(chat("c", 1, [user("q"), reply("partial text", { isStreaming: true, activities: [step("Edit x")] })]), run());
    expect(view.messages[1]).toMatchObject({ text: "", writing: true, stepCount: 1 });
  });

  test("a finished answer is clipped and says so", () => {
    const view = remoteChat(chat("c", 1, [user("q"), reply("x".repeat(7000))]), undefined);
    expect(view.messages[1].text.length).toBeLessThanOrEqual(6000);
    expect(view.messages[1].clipped).toBe(true);
    expect(view.running).toBe(false);
  });
});

describe("filesOf", () => {
  test("reads edit diffs and new files from steps, adding up repeats", () => {
    const files = filesOf(
      reply("", { activities: [step("Edit src/app.ts", true, DIFF), step("Edit src/app.ts", true, DIFF), step("Write notes.md"), step("Update todos")] }),
    );
    expect(files).toEqual([
      { path: "src/app.ts", kind: "modified", additions: 4, deletions: 2 },
      { path: "notes.md", kind: "added" },
    ]);
  });

  test("prefers what the checkpoint found once the turn ended", () => {
    const files = filesOf(
      reply("", {
        activities: [step("Edit src/app.ts", true, DIFF)],
        turn: {
          checkpointId: "k",
          state: "applied",
          changes: [{ path: "/r/out.csv", relative: "out.csv", kind: "added", restorable: true, additions: 3 }],
        },
      }),
    );
    expect(files).toEqual([{ path: "out.csv", kind: "added", additions: 3, deletions: undefined }]);
  });
});
