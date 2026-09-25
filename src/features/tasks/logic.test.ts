import { describe, expect, test } from "bun:test";
import { busyFolders, foldersOverlap, nextToStart, taskStatus } from "./logic";
import type { TaskRecord } from "./types";

const task = (id: string, folder: string, phase: TaskRecord["phase"] = "queued", createdAt = Number(id.slice(1))): TaskRecord => ({
  id,
  folder,
  phase,
  createdAt,
  title: id,
  modelId: "m",
  modelName: "m",
  input: { prompt: id, resend: { modelId: "m", modelName: "m", maxTokens: 1, autoNewChat: false } },
});

describe("foldersOverlap", () => {
  test("same, nested either way, but not siblings with a shared prefix", () => {
    expect(foldersOverlap("/a/app", "/a/app")).toBe(true);
    expect(foldersOverlap("/a/app/src", "/a/app")).toBe(true);
    expect(foldersOverlap("/a/app", "/a/app/src")).toBe(true);
    expect(foldersOverlap("/a/app", "/a/app-2")).toBe(false);
  });
});

describe("nextToStart", () => {
  test("oldest first, up to the cap", () => {
    const tasks = [task("t3", "/c"), task("t1", "/a"), task("t2", "/b")];
    expect(nextToStart(tasks, [], 2).map((t) => t.id)).toEqual(["t1", "t2"]);
  });

  test("never two in the same folder; the next folder isn't held up", () => {
    const tasks = [task("t1", "/a"), task("t2", "/a/sub"), task("t3", "/b")];
    expect(nextToStart(tasks, [], 3).map((t) => t.id)).toEqual(["t1", "t3"]);
  });

  test("waits for a folder the user's own chat is working in", () => {
    expect(nextToStart([task("t1", "/a"), task("t2", "/b")], ["/a"], 3).map((t) => t.id)).toEqual(["t2"]);
  });

  test("running tasks count against the cap", () => {
    const tasks = [task("t1", "/a", "running"), task("t2", "/b"), task("t3", "/c")];
    expect(nextToStart(tasks, busyFolders({}, () => undefined, tasks), 2).map((t) => t.id)).toEqual(["t2"]);
  });
});

describe("busyFolders", () => {
  test("Cowork runs and running tasks; Chat runs don't hold a folder", () => {
    const chats: Record<string, { mode: "chat" | "cowork"; cwd?: string; folders?: string[] }> = {
      c1: { mode: "cowork", cwd: "/a", folders: ["/x"] },
      c2: { mode: "chat", cwd: "/b" },
    };
    const runs = { c1: { token: "", modelId: "", permissions: [], questions: [] }, c2: { token: "", modelId: "", permissions: [], questions: [] } };
    expect(busyFolders(runs, (id) => chats[id], [task("t1", "/r", "running"), task("t2", "/q")])).toEqual(["/a", "/x", "/r"]);
  });
});

describe("taskStatus", () => {
  const turn = (state: "applied" | "undone") => ({
    messages: [{ id: "a", role: "assistant" as const, content: "", turn: { checkpointId: "cp", changes: [], state } }],
  });
  const noRun = undefined;

  test("running vs needs you", () => {
    const t = task("t1", "/a", "running");
    expect(taskStatus(t, { permissions: [], questions: [] }, undefined)).toBe("running");
    expect(taskStatus(t, { permissions: [{} as never], questions: [] }, undefined)).toBe("needs-you");
  });

  test("a finished task with changes waits for review until accepted or undone", () => {
    const t = task("t1", "/a", "finished");
    expect(taskStatus(t, noRun, turn("applied"))).toBe("ready");
    expect(taskStatus({ ...t, accepted: true }, noRun, turn("applied"))).toBe("accepted");
    expect(taskStatus(t, noRun, turn("undone"))).toBe("undone");
    expect(taskStatus(t, noRun, { messages: [] })).toBe("done");
  });
});
