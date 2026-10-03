import { describe, expect, test } from "bun:test";
import type { ChatRun, ChatSession } from "@/features/chat-history";
import type { PermissionRequest, QuestionRequest } from "@/pages/chat/api/chat";
import type { ActivityItem, ChatMessage } from "@/pages/chat/types";
import {
  hitArea,
  homeCards,
  mascotFrame,
  pillWindow,
  QUESTION,
  questionHeight,
  shapeSize,
  teamSlots,
  UNDER_NOTCH,
  windowSize,
} from "./layout";
import { minutesSaved } from "./recap";
import { editsOf, liveSnapshot, pillSyncKey, recapOf, sessionsOf, usageOf, weekStart, type MateInfo } from "./snapshot";
import type { NotchSnapshot } from "./types";

const run = (permissions: PermissionRequest[] = [], questions: QuestionRequest[] = []): ChatRun => ({
  token: "t",
  modelId: "m",
  permissions,
  questions,
});

const question = (id: string, options = ["Espresso", "Latte"]): QuestionRequest => ({
  id,
  directory: "/repo",
  questions: [{ question: "Which one?", options: options.map((label) => ({ label })), multiple: false, custom: true }],
});

const chat = (id: string, updatedAt: number, messages: ChatMessage[] = []): ChatSession => ({
  id,
  title: `Chat ${id}`,
  createdAt: 0,
  updatedAt,
  messages,
});

const ask = (id: string, title = "git push", patterns = [title]): PermissionRequest => ({
  id,
  directory: "/repo",
  permission: "bash",
  patterns,
  title,
});

const reply = (patch: Partial<ChatMessage>): ChatMessage => ({ id: "r", role: "assistant", content: "", ...patch });
const step = (title: string, done: boolean, id?: string): ActivityItem => ({ id, kind: "tool", title, done });

const lookup = (chats: ChatSession[]) => (id: string) => chats.find((c) => c.id === id);

const MATES: MateInfo[] = [
  { id: "res", name: "Researcher", mascot: "jelly", color: "#34c77b" },
  { id: "mail", name: "Mailer", mascot: "momo", color: "#f7609f" },
];

describe("liveSnapshot", () => {
  test("nothing running shows nothing", () => {
    expect(liveSnapshot({}, lookup([]))).toBeNull();
  });

  test("the run whose chat moved last is the one on the pill", () => {
    const snapshot = liveSnapshot({ a: run(), b: run() }, lookup([chat("a", 10), chat("b", 20)]));
    expect(snapshot?.chatId).toBe("b");
    expect(snapshot?.phase).toBe("working");
    expect(snapshot?.running).toBe(2);
  });

  test("an approval wins over a busier run, and counts every waiting one", () => {
    const snapshot = liveSnapshot(
      { a: run([ask("p1"), ask("p2")]), b: run() },
      lookup([chat("a", 10), chat("b", 20)]),
    );
    expect(snapshot?.chatId).toBe("a");
    expect(snapshot?.phase).toBe("permission");
    expect(snapshot?.permission?.id).toBe("p1");
    expect(snapshot?.command).toBe("git push");
    expect(snapshot?.waiting).toBe(2);
  });

  test("a question brings its run to the pill, and counts as waiting", () => {
    const snapshot = liveSnapshot({ a: run([], [question("q1")]), b: run() }, lookup([chat("a", 10), chat("b", 20)]));
    expect(snapshot?.chatId).toBe("a");
    expect(snapshot?.phase).toBe("working");
    expect(snapshot?.question?.id).toBe("q1");
    expect(snapshot?.waiting).toBe(1);
  });

  test("an approval still comes before a question", () => {
    const snapshot = liveSnapshot(
      { a: run([], [question("q1")]), b: run([ask("p1")]) },
      lookup([chat("a", 20), chat("b", 10)]),
    );
    expect(snapshot?.chatId).toBe("b");
    expect(snapshot?.permission?.id).toBe("p1");
    expect(snapshot?.question).toBeUndefined();
  });

  test("a new question is news for the pill", () => {
    const base = liveSnapshot({ a: run() }, lookup([chat("a", 10)]));
    const asked = liveSnapshot({ a: run([], [question("q1")]) }, lookup([chat("a", 10)]));
    expect(pillSyncKey(asked)).not.toBe(pillSyncKey(base));
  });

  test("steps are the lead's latest few, from the latest reply", () => {
    const old = reply({ id: "old", activities: [step("Old", true)] });
    const user: ChatMessage = { id: "u", role: "user", content: "again" };
    const latest = reply({
      id: "new",
      todos: [{ text: "new" }],
      activities: [
        step("One", true),
        step("Two", true),
        step("Ask research", false, "team:res:c1:step:1"),
        step("Three", true),
        step("Four", true),
        step("Prep workspace", false),
      ],
    });
    const snapshot = liveSnapshot({ a: run() }, lookup([chat("a", 1, [old, user, latest])]));
    expect(snapshot?.steps.map((s) => s.title)).toEqual(["Two", "Three", "Four", "Prep workspace"]);
    expect(snapshot?.todos).toEqual([{ text: "new" }]);
  });

  test("each team bot shows once with what it's on, and done once it reported", () => {
    const activities = [
      step("Brief", true, "team:res:c1:brief"),
      step("Search the web", true, "team:res:c1:step:1"),
      step("Asking research", false, "team:res:c1:step:2"),
      step("Team: Mailer", true, "team:mail:c2"),
      step("Team: Ghost", false, "team:ghost:c3:step:1"),
    ];
    const snapshot = liveSnapshot({ a: run() }, lookup([chat("a", 1, [reply({ activities })])]), MATES);
    expect(snapshot?.team.map((m) => [m.id, m.status, m.done])).toEqual([
      ["res", "Asking research", false],
      ["mail", "Done", true],
    ]);
    expect(snapshot?.team[0].color).toBe("#34c77b");
  });

  test("a team bot's approval names the bot and drops it from the command", () => {
    const snapshot = liveSnapshot(
      { a: run([ask("p", "Mailer · Send the quote", [])]) },
      lookup([chat("a", 1)]),
      MATES,
    );
    expect(snapshot?.asker).toEqual({ id: "mail", name: "Mailer", mascot: "momo" });
    expect(snapshot?.command).toBe("Send the quote");
  });

  test("the chat the notch follows wins over a busier one, but an approval still comes first", () => {
    const chats = lookup([chat("mine", 1), chat("busy", 50), chat("asks", 2)]);
    expect(liveSnapshot({ mine: run(), busy: run() }, chats, [], "mine")?.chatId).toBe("mine");
    expect(liveSnapshot({ mine: run(), asks: run([ask("p")]) }, chats, [], "mine")?.chatId).toBe("asks");
    // Following a chat that isn't running changes nothing.
    expect(liveSnapshot({ busy: run() }, chats, [], "mine")?.chatId).toBe("busy");
  });

  test("a Cowork reply brings its text, folder and the files it changed", () => {
    const long = "x".repeat(3000);
    const done = reply({
      content: long,
      turn: { checkpointId: "c", changes: [{ path: "a" }, { path: "b" }] as never, state: "applied" },
    });
    const snapshot = liveSnapshot({ a: run() }, lookup([{ ...chat("a", 1, [done]), cwd: "/repo" }]));
    expect(snapshot?.folder).toBe("/repo");
    expect(snapshot?.changed).toBe(2);
    expect(snapshot?.reply?.startsWith("…")).toBe(true);
    expect(snapshot!.reply!.length).toBeLessThan(long.length);
  });

  test("what a reply made comes out whole, before a long reply is cut", () => {
    const gallery = {
      source: "canva",
      title: "Launch posts",
      url: "https://www.canva.com/design/x/edit",
      items: [
        { image: "https://cdn.example/p1.png", width: 1080, height: 1350 },
        { image: "https://cdn.example/p2.png", width: 1080, height: 1350 },
      ],
    };
    const content = ["```gallery", JSON.stringify(gallery), "```", "x".repeat(3000)].join("\n");
    const snapshot = liveSnapshot({ a: run() }, lookup([chat("a", 1, [reply({ content })])]));
    expect(snapshot?.showcase).toEqual([
      {
        source: "canva",
        title: "Launch posts",
        url: "https://www.canva.com/design/x/edit",
        items: gallery.items.map((i) => ({ ...i, title: undefined })),
      },
    ]);
    // The block itself never shows as text.
    expect(snapshot?.reply).not.toContain("```gallery");
  });

  test("a gallery still being written isn't shown, nor its half", () => {
    const content = 'Here it is\n```gallery\n{"source": "canva", "items": [{"image": "https://cdn.example/p1';
    const snapshot = liveSnapshot({ a: run() }, lookup([chat("a", 1, [reply({ content })])]));
    expect(snapshot?.showcase).toBeUndefined();
    expect(snapshot?.reply).toBe("Here it is");
  });

  test("a run whose chat isn't loaded still shows", () => {
    const snapshot = liveSnapshot({ ghost: run() }, lookup([]));
    expect(snapshot?.chatId).toBe("ghost");
    expect(snapshot?.title).toBe("");
  });

  test("pillSyncKey ignores streaming reply text until done or the notch follows Cowork", () => {
    const base: NotchSnapshot = {
      phase: "working",
      chatId: "a",
      title: "Task",
      steps: [{ id: "s1", kind: "tool", title: "Read file", done: false }],
      todos: [],
      team: [],
      waiting: 0,
      running: 1,
      reply: "hello",
    };
    expect(pillSyncKey({ ...base, reply: "hello" })).toBe(pillSyncKey({ ...base, reply: "hello world" }));
    expect(pillSyncKey({ ...base, phase: "done", reply: "hello world" })).not.toBe(
      pillSyncKey({ ...base, phase: "done", reply: "hello" }),
    );
    // The notch's own task streams: every bit of its answer counts.
    expect(pillSyncKey({ ...base, reply: "hello" }, true)).not.toBe(pillSyncKey({ ...base, reply: "hello world" }, true));
  });
});

describe("layout", () => {
  const notched = { hasNotch: true, notchWidth: 185, barHeight: 32 };
  const windows = { hasNotch: false, notchWidth: 0, barHeight: 0 };

  test("collapsed, the pill wraps the notch with a wing either side and a step row under the camera", () => {
    expect(shapeSize("collapsed", notched)).toEqual({ width: 185 + 92, height: 32 + UNDER_NOTCH });
  });

  test("without a notch the step sits in the bar itself", () => {
    expect(shapeSize("collapsed", { hasNotch: false, notchWidth: 0, barHeight: 24 }).height).toBe(24);
  });

  test("without a menu bar the pill is an island of its own height", () => {
    expect(shapeSize("collapsed", windows).height).toBe(34);
  });

  test("open, the pill is wider than the notch and taller than the bar", () => {
    const open = shapeSize("home", notched);
    expect(open.width).toBeGreaterThan(185 + 92);
    expect(open.height).toBeGreaterThan(32);
  });

  test("the window always holds the shape", () => {
    for (const view of ["collapsed", "home", "permission", "chat", "drop", "welcome"] as const) {
      const shape = shapeSize(view, notched);
      const win = windowSize(view, shape);
      expect(win.width).toBeGreaterThan(shape.width);
      expect(win.height).toBeGreaterThanOrEqual(shape.height);
    }
  });

  test("one fixed window holds every view, so the window never resizes as the pill moves", () => {
    for (const geometry of [notched, windows]) {
      const frame = pillWindow(geometry);
      for (const view of ["collapsed", "home", "permission", "chat", "drop", "welcome"] as const) {
        const shape = shapeSize(view, geometry, { thread: true, files: true });
        expect(frame.width).toBeGreaterThanOrEqual(shape.width);
        expect(frame.height).toBeGreaterThanOrEqual(shape.height);
        // Only the pill (and its ears) takes clicks, centered at the top.
        const area = hitArea(frame, shape);
        expect(area.x).toBeGreaterThanOrEqual(0);
        expect(area.x + area.width).toBeLessThanOrEqual(frame.width);
        expect(area.y).toBe(0);
      }
    }
  });

  test("the question card grows with its options, up to a cap, and the window holds it", () => {
    const two = questionHeight(question("q", ["A", "B"]));
    const four = questionHeight(question("q", ["A", "B", "C", "D"]));
    const many = questionHeight(question("q", Array.from({ length: 30 }, (_, i) => `Option ${i}`)));
    expect(four).toBeGreaterThan(two);
    expect(many).toBeLessThanOrEqual(QUESTION.max);
    expect(questionHeight(undefined)).toBe(0);
    for (const geometry of [notched, windows]) {
      const frame = pillWindow(geometry);
      for (const shape of [
        shapeSize("question", geometry, { question: many }),
        shapeSize("chat", geometry, { thread: true, files: true, note: true, question: many }),
      ]) {
        expect(frame.width).toBeGreaterThanOrEqual(shape.width);
        expect(frame.height).toBeGreaterThanOrEqual(shape.height);
      }
    }
  });

  test("the team card: the lead, the team as one row, and its bots in two columns when open", () => {
    const closed = shapeSize("home", notched, { team: 4, teamOpen: false });
    const open = shapeSize("home", notched, { team: 4, teamOpen: true });
    expect(open.height).toBeGreaterThan(closed.height);
    const card = homeCards(notched, open, true).right!;
    const slots = teamSlots(card, 4, true);
    expect(slots.chips).toHaveLength(4);
    expect(slots.chips[1].x).toBeGreaterThan(slots.chips[0].x);
    expect(slots.group.y).toBeGreaterThan(slots.lead.y);
    for (const chip of slots.chips) {
      expect(chip.y).toBeGreaterThan(slots.group.y);
      expect(chip.y + chip.height).toBeLessThanOrEqual(card.y + card.height);
    }
    expect(teamSlots(card, 4, false).chips).toHaveLength(0);
    expect(teamSlots(card, 9, true).chips).toHaveLength(6);
  });

  test("a peek opens out a little; one with a diff a little more", () => {
    const short = shapeSize("peek", notched, { peek: "done" });
    const edit = shapeSize("peek", notched, { peek: "edit" });
    expect(short.height).toBeGreaterThan(32);
    expect(edit.height).toBeGreaterThan(short.height);
  });

  test("the session list grows with its rows, then scrolls", () => {
    const one = shapeSize("sessions", notched, { sessions: 1 });
    const five = shapeSize("sessions", notched, { sessions: 5 });
    expect(five.height).toBeGreaterThan(one.height);
    expect(shapeSize("sessions", notched, { sessions: 8 }).height).toBe(five.height);
  });

  test("the ask box grows for a thread and for files, and stays wider than the notch", () => {
    const empty = shapeSize("chat", notched, { thread: false, files: false });
    const files = shapeSize("chat", notched, { thread: false, files: true });
    const thread = shapeSize("chat", notched, { thread: true, files: false });
    const note = shapeSize("chat", notched, { thread: false, files: false, note: true });
    expect(files.height).toBeGreaterThan(empty.height);
    expect(thread.height).toBeGreaterThan(files.height);
    expect(note.height).toBeGreaterThan(empty.height);
    expect(empty.width).toBeGreaterThan(185 + 92);
  });

  test("the mascot fits in the bar when collapsed and stays inside the open pill", () => {
    const small = mascotFrame("collapsed", notched, shapeSize("collapsed", notched));
    expect(small.y + small.size).toBeLessThanOrEqual(32);
    const shape = shapeSize("home", notched);
    const big = mascotFrame("home", notched, shape);
    expect(big.y).toBeGreaterThan(32);
    expect(big.y + big.size).toBeLessThan(shape.height);
  });
});

describe("edits", () => {
  test("an edit step's diff becomes a file with its first changed lines", () => {
    const diff = ["--- a/src/app.ts", "+++ b/src/app.ts", "@@ -1,3 +1,3 @@", " const a = 1;", "-const b = 2;", "+const b = 3;", " export { a, b };"].join("\n");
    const edits = editsOf([{ id: "e1", kind: "tool", title: "Edit src/app.ts", detail: diff, done: true }]);
    expect(edits).toHaveLength(1);
    expect(edits[0]).toMatchObject({ path: "src/app.ts", kind: "modified", additions: 1, deletions: 1 });
    expect(edits[0].lines.map((l) => l.tag)).toEqual(["ctx", "del", "add", "ctx"]);
  });

  test("a write without a diff is a new file, its lines added", () => {
    const edits = editsOf([{ id: "w", kind: "tool", title: "Write notes.md", detail: "# Notes\nhello", done: true }]);
    expect(edits[0]).toMatchObject({ path: "notes.md", kind: "added", additions: 2, deletions: 0 });
  });

  test("only the last few files are kept, and reads aren't edits", () => {
    const steps = [1, 2, 3, 4, 5].map((n) => ({ id: `w${n}`, kind: "tool", title: `Write f${n}.txt`, detail: "x", done: true }));
    const edits = editsOf([...steps, { id: "r", kind: "tool", title: "Read f1.txt", detail: "x", done: true }]);
    expect(edits.map((e) => e.path)).toEqual(["f3.txt", "f4.txt", "f5.txt"]);
  });
});

describe("sessions", () => {
  const chat = (id: string, updatedAt: number, extra: Partial<ChatSession> = {}): ChatSession => ({
    id,
    title: `Chat ${id}`,
    createdAt: 0,
    updatedAt,
    messages: [
      { id: `${id}-u`, role: "user", content: "Refactor   the\nscheduler" },
      { id: `${id}-a`, role: "assistant", content: "On it.", activities: [{ id: "s", kind: "tool", title: "Bash cargo test", done: false }] },
    ],
    ...extra,
  });
  const run = { token: "t", modelId: "m", permissions: [], questions: [] } as ChatRun;

  test("running chats first, then the latest; tasks left out", () => {
    const list = sessionsOf(
      [chat("old", 1), chat("new", 3), chat("busy", 2, { cwd: "/w/agent-runtime", mode: "cowork" }), chat("task", 9, { inboxTask: true })],
      { busy: run },
      (c) => !c.inboxTask,
    );
    expect(list.map((s) => s.id)).toEqual(["busy", "new", "old"]);
    expect(list[0]).toMatchObject({ folder: "agent-runtime", mode: "cowork", running: true, asked: "Refactor the scheduler" });
    expect(list[0].step).toEqual({ kind: "Bash", title: "Bash cargo test" });
    expect(list[1].step).toBeUndefined();
  });
});

describe("usage and recap", () => {
  const now = new Date(2026, 9, 2, 15, 0).getTime();
  const hour = 3_600_000;
  const reply = (id: string, createdAt: number, extra: Partial<ChatMessage> = {}): ChatMessage => ({
    id,
    role: "assistant",
    content: "done",
    createdAt,
    durationMs: 90_000,
    usage: { inputTokens: 1000, outputTokens: 500, cost: 0.02 },
    ...extra,
  });
  const change = (relative: string, additions: number, deletions: number) => ({
    path: `/w/${relative}`,
    relative,
    kind: "modified" as const,
    additions,
    deletions,
    restorable: true,
  });

  test("today's runs, time, tokens and files; runs a day across the week", () => {
    const chats: ChatSession[] = [
      {
        id: "a",
        title: "A",
        createdAt: 0,
        updatedAt: now,
        messages: [
          reply("r1", now - hour, { turn: { checkpointId: "c", state: "applied", changes: [change("x.ts", 3, 1)] } }),
          reply("r2", now - 2 * hour),
          reply("r3", now - 3 * 24 * hour),
        ],
      },
      { id: "old", title: "Old", createdAt: 0, updatedAt: now - 30 * 24 * hour, messages: [reply("r9", now - 30 * 24 * hour)] },
    ];
    const usage = usageOf(chats, now);
    expect(usage).toMatchObject({ runs: 2, seconds: 180, tokens: 3000, files: 1 });
    expect(usage.cost).toBeCloseTo(0.04);
    expect(usage.days).toHaveLength(7);
    expect(usage.days[6]).toBe(2);
    expect(usage.days[3]).toBe(1);
  });

  test("a week runs Monday to Sunday; its recap counts tasks, files, commands and models", () => {
    // Friday 2 October 2026: the week began Monday 28 September.
    expect(new Date(weekStart(now)).toDateString()).toBe(new Date(2026, 8, 28).toDateString());
    expect(new Date(weekStart(now, 1)).toDateString()).toBe(new Date(2026, 8, 21).toDateString());
    const added = { ...change("new.ts", 9, 0), kind: "added" as const };
    const chats: ChatSession[] = [
      {
        id: "a",
        title: "A",
        createdAt: 0,
        updatedAt: now,
        messages: [
          { id: "u", role: "user", content: "go", resend: { modelId: "m", modelName: "big-pickle", maxTokens: 1, autoNewChat: false } },
          reply("r1", now - hour, {
            activities: [
              { kind: "tool", title: "Edit a.ts", done: true },
              { kind: "tool", title: "Bash npm test", done: true },
              { kind: "tool", title: "Run cargo build", done: true },
            ],
            turn: { checkpointId: "c", state: "applied", changes: [change("a.ts", 5, 1), added] },
          }),
          reply("r2", now - 2 * hour),
        ],
      },
      // Last week's work counts in last week's recap, not this one.
      { id: "b", title: "B", createdAt: 0, updatedAt: now, messages: [reply("r3", now - 6 * 24 * hour)] },
    ];
    const recap = recapOf(chats, 0, now);
    expect(recap).toMatchObject({ week: 0, tasks: 2, chats: 1, created: 1, edited: 1, commands: 2, seconds: 180, tokens: 3000 });
    expect(recap.models).toEqual([{ name: "big-pickle", tasks: 2 }]);
    expect(recap.days[4]).toBe(2);
    expect(recapOf(chats, 1, now)).toMatchObject({ tasks: 1, chats: 1 });
    expect(minutesSaved(recap, { task: 3, created: 10, edited: 5, command: 1 })).toBe(6 + 10 + 5 + 2);
  });
});
