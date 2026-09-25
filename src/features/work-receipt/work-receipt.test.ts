import { describe, expect, test } from "bun:test";
import { MOCK_SESSIONS } from "./mock";
import { listOutputs, outputKindOf } from "./outputs";
import { buildWorkReceipt, estimateMinutesSaved } from "./receipt";
import { buildWeeklyRecap, startOfWeek } from "./recap";

const [reports, app] = MOCK_SESSIONS;
const word = (title: string) =>
  title.startsWith("word_") ? { serverId: "word", serverName: "Word" } : undefined;

describe("buildWorkReceipt", () => {
  test("sums files, commands and connectors of a turn", () => {
    const receipt = buildWorkReceipt(reports, reports.messages[1], word)!;
    expect(receipt.files).toMatchObject({ added: 3, modified: 1, deleted: 0, additions: 52 });
    expect(receipt.commands).toEqual(["python summarize.py"]);
    expect(receipt.connectors).toEqual([{ serverId: "word", name: "Word", calls: 1 }]);
    expect(receipt.checkpointId).toBe("mock-cp-1");
  });

  test("counts failed steps and keeps the failed command", () => {
    const receipt = buildWorkReceipt(app, app.messages[1], word)!;
    expect(receipt.steps).toEqual({ total: 4, failed: 1 });
    expect(receipt.commands).toEqual(["bun test", "bun test"]);
  });

  test("skips user messages and replies without agent work", () => {
    expect(buildWorkReceipt(reports, reports.messages[0], word)).toBeUndefined();
    expect(buildWorkReceipt(reports, { id: "x", role: "assistant", content: "hi" }, word)).toBeUndefined();
  });

  test("an undone turn saved no time", () => {
    expect(estimateMinutesSaved(buildWorkReceipt(app, app.messages[3], word)!)).toBe(0);
    expect(estimateMinutesSaved(buildWorkReceipt(reports, reports.messages[1], word)!)).toBe(3 * 10 + 5 + 1 + 2);
  });
});

describe("listOutputs", () => {
  test("lists created files newest first, without undone turns", () => {
    const paths = listOutputs(MOCK_SESSIONS).map((o) => o.relative);
    expect(paths).toEqual(["summary.csv", "summary.docx", "slides/q3-review.pptx", "src/cart.test.ts"]);
  });

  test("filters by project, kind and search", () => {
    expect(listOutputs(MOCK_SESSIONS, { projectId: "mock-project-ops" })).toHaveLength(3);
    expect(listOutputs(MOCK_SESSIONS, { kinds: ["slides"] }).map((o) => o.name)).toEqual(["q3-review.pptx"]);
    expect(listOutputs(MOCK_SESSIONS, { search: "CART" }).map((o) => o.name)).toEqual(["cart.test.ts"]);
    expect(listOutputs(MOCK_SESSIONS, { includeUndone: true }).some((o) => o.undone)).toBe(true);
  });

  test("reads the kind from the extension", () => {
    expect(outputKindOf("/a/Report.PDF")).toBe("pdf");
    expect(outputKindOf("/a/Makefile")).toBe("other");
    expect(outputKindOf("/a/.env")).toBe("other");
  });
});

describe("buildWeeklyRecap", () => {
  test("weeks start on Monday", () => {
    expect(new Date(startOfWeek(new Date(2026, 8, 24))).getDay()).toBe(1); // Thursday → Monday
    expect(startOfWeek(new Date(2026, 8, 21, 0, 0))).toBe(new Date(2026, 8, 21).getTime());
  });

  test("sums only turns inside the week", () => {
    const at = reports.messages[1].createdAt!;
    const recap = buildWeeklyRecap(MOCK_SESSIONS, startOfWeek(at));
    const inWeek = MOCK_SESSIONS.flatMap((s) => s.messages).filter(
      (m) => m.role === "assistant" && m.createdAt! >= recap.weekStart && m.createdAt! < recap.weekEnd,
    );
    expect(recap.tasks).toBe(inWeek.length);
    expect(buildWeeklyRecap(MOCK_SESSIONS, startOfWeek(at) - 7 * 86_400_000 * 10).tasks).toBe(0);
  });
});

describe("renames and moves", () => {
  const change = (path: string, kind: "added" | "deleted", size: number, lines: number) => ({
    path,
    relative: path.slice(1),
    kind,
    size,
    additions: kind === "added" ? lines : 0,
    deletions: kind === "deleted" ? lines : 0,
    restorable: true,
  });
  const turnWith = (changes: ReturnType<typeof change>[], activities = [{ kind: "tool", title: "Run: mv", done: true, durationMs: 19_700 }]) => ({
    id: "r",
    role: "assistant" as const,
    content: "",
    createdAt: 1,
    activities,
    turn: { checkpointId: "cp", state: "applied" as const, changes },
  });

  test("a rename is one modified file, not created + deleted", () => {
    const msg = turnWith([change("/d/hello.md", "added", 6, 1), change("/d/hello.txt", "deleted", 6, 1)]);
    const receipt = buildWorkReceipt({ id: "c" }, msg, word)!;
    expect(receipt.files).toMatchObject({ added: 0, modified: 1, deleted: 0, renamed: 1, additions: 0, deletions: 0 });
    expect(estimateMinutesSaved(receipt)).toBe(5 + 1);
    expect(listOutputs([{ id: "c", title: "t", createdAt: 1, updatedAt: 1, messages: [msg] }])).toHaveLength(0);
  });

  test("a move into another folder keeps the name", () => {
    const msg = turnWith([change("/d/pdf/a.pdf", "added", 900, 0), change("/d/a.pdf", "deleted", 900, 0)]);
    expect(buildWorkReceipt({ id: "c" }, msg, word)!.files.renamed).toBe(1);
  });

  test("different content is still created + deleted", () => {
    const msg = turnWith([change("/d/new.md", "added", 40, 3), change("/x/old.txt", "deleted", 12, 1)]);
    expect(buildWorkReceipt({ id: "c" }, msg, word)!.files).toMatchObject({ added: 1, deleted: 1, renamed: 0 });
  });

  test("duration falls back to the steps' time", () => {
    const msg = turnWith([]);
    expect(buildWorkReceipt({ id: "c" }, msg, word)!.durationMs).toBe(19_700);
  });
});
