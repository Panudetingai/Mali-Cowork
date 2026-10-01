import { describe, expect, test } from "bun:test";
import type { ChatRun, ChatSession } from "@/features/chat-history";
import type { PermissionRequest } from "@/pages/chat/api/chat";
import type { ActivityItem, ChatMessage } from "@/pages/chat/types";
import { hitArea, homeCards, mascotFrame, pillWindow, shapeSize, teamSlots, windowSize } from "./layout";
import { liveSnapshot, type MateInfo } from "./snapshot";

const run = (permissions: PermissionRequest[] = []): ChatRun => ({
  token: "t",
  modelId: "m",
  permissions,
  questions: [],
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

  test("a run whose chat isn't loaded still shows", () => {
    const snapshot = liveSnapshot({ ghost: run() }, lookup([]));
    expect(snapshot?.chatId).toBe("ghost");
    expect(snapshot?.title).toBe("");
  });
});

describe("layout", () => {
  const notched = { hasNotch: true, notchWidth: 185, barHeight: 32 };
  const windows = { hasNotch: false, notchWidth: 0, barHeight: 0 };

  test("collapsed, the pill wraps the notch with a wing either side", () => {
    expect(shapeSize("collapsed", notched)).toEqual({ width: 185 + 92, height: 32 });
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

  test("the team card: full-width rows for a small team, a grid for more, and room to add one", () => {
    const card = homeCards(notched, shapeSize("home", notched), true).right!;
    const one = teamSlots(card, 1);
    expect(one.bots).toHaveLength(1);
    expect(one.add).toBeDefined();
    expect(one.bots[0].chip.width).toBe(one.add!.width);
    const four = teamSlots(card, 4);
    expect(four.add).toBeUndefined();
    expect(four.bots[1].chip.x).toBeGreaterThan(four.bots[0].chip.x);
    expect(teamSlots(card, 9).bots).toHaveLength(4);
    for (const { chip, bot } of [...one.bots, ...four.bots]) {
      expect(chip.y).toBeGreaterThanOrEqual(card.y);
      expect(chip.y + chip.height).toBeLessThanOrEqual(card.y + card.height);
      expect(bot.y + bot.size).toBeLessThanOrEqual(chip.y + chip.height);
    }
  });

  test("the ask box grows for a thread and for files, and stays wider than the notch", () => {
    const empty = shapeSize("chat", notched, { thread: false, files: false });
    const files = shapeSize("chat", notched, { thread: false, files: true });
    const thread = shapeSize("chat", notched, { thread: true, files: false });
    expect(files.height).toBeGreaterThan(empty.height);
    expect(thread.height).toBeGreaterThan(files.height);
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
