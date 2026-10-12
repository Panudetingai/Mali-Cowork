import { beforeEach, expect, mock, test } from "bun:test";
import type { ChatCompaction } from "@/features/chat-history";
import type { ChatMessage } from "./types";

// The model that writes the summary, stood in for.
let reply: string | Error = "Goal: a budget sheet.\nDone: columns set up.";
const asked: ChatMessage[][] = [];
// Only the call to the model is stood in for; the rest of the module is real (other test files use it).
const actual = await import("./summary");
mock.module(new URL("./summary.ts", import.meta.url).pathname, () => ({
  ...actual,
  summarizeConversation: async (messages: ChatMessage[]) => {
    asked.push(messages);
    if (reply instanceof Error) throw reply;
    return reply;
  },
}));

const { createChat, getChat, updateChat } = await import("@/features/chat-history");
const { canCompact, carriedSummary, compactChat, lastCompaction, liveMessages } = await import("./compaction");
const { chatContextUsage } = await import("./context-usage");

const msg = (id: string, role: "user" | "assistant", content: string): ChatMessage => ({ id, role, content });

function chatWith(messages: ChatMessage[]) {
  const chat = createChat("Budget");
  updateChat(chat.id, (s) => ({ ...s, messages, maliSessionId: "session-1", codexSessionId: "thread-1" }));
  return chat.id;
}

beforeEach(() => {
  reply = "Goal: a budget sheet.\nDone: columns set up.";
  asked.length = 0;
});

test("a summary takes the place of what came before it, in the same chat", async () => {
  const id = chatWith([msg("u1", "user", "Make a budget sheet"), msg("a1", "assistant", "Here are the columns…")]);
  expect(canCompact(getChat(id))).toBe(true);
  const done = await compactChat(id, "api:groq/llama", 100_000);
  expect(done).toMatchObject({ afterMessageId: "a1", messages: 2, summarizing: false });
  const chat = getChat(id)!;
  expect(chat.messages).toHaveLength(2); // still on screen
  expect(liveMessages(chat)).toEqual([]); // not sent again
  expect(carriedSummary(chat)).toContain("Goal: a budget sheet");
  // Agents with their own session start fresh, and hear the summary.
  expect(chat.maliSessionId).toBeUndefined();
  expect(chat.codexSessionId).toBeUndefined();
  expect(canCompact(chat)).toBe(false);

  // The chat goes on: the next summary covers only what's new, plus the one before.
  updateChat(id, (s) => ({ ...s, messages: [...s.messages, msg("u2", "user", "Add a savings row"), msg("a2", "assistant", "Added.")] }));
  expect(liveMessages(getChat(id)!).map((m) => m.id)).toEqual(["u2", "a2"]);
  await compactChat(id, "api:groq/llama", 100_000);
  expect(asked[1][0].content).toContain("Summary of the conversation before this point");
  expect(asked[1].slice(1).map((m) => m.id)).toEqual(["u2", "a2"]);
  expect(lastCompaction(getChat(id))?.afterMessageId).toBe("a2");
});

test("a failed summary leaves the chat as it was", async () => {
  const id = chatWith([msg("u1", "user", "Hi"), msg("a1", "assistant", "Hello")]);
  reply = new Error("rate limited");
  await expect(compactChat(id, "m", 1000)).rejects.toThrow("rate limited");
  const chat = getChat(id)!;
  expect(chat.compactions ?? []).toEqual([]);
  expect(chat.maliSessionId).toBe("session-1");
  reply = "   ";
  await expect(compactChat(id, "m", 1000)).rejects.toThrow("didn't write a summary");
});

test("a summary whose message was edited away no longer stands", () => {
  const compaction: ChatCompaction = { id: "c", afterMessageId: "a1", summary: "old", messages: 2, tokensBefore: 10, at: 1 };
  const kept = { messages: [msg("u1", "user", "x"), msg("a1", "assistant", "y"), msg("u2", "user", "z")], compactions: [compaction] };
  expect(liveMessages(kept).map((m) => m.id)).toEqual(["u2"]);
  const edited = { messages: [msg("u1", "user", "x edited")], compactions: [compaction] };
  expect(lastCompaction(edited)).toBeUndefined();
  expect(liveMessages(edited)).toHaveLength(1);
  expect(carriedSummary({ ...edited, continuedFrom: undefined })).toBeUndefined();
});

test("the context meter counts the summary and what came since, the cost counts everything", () => {
  const long = "word ".repeat(4000);
  const messages = [msg("u1", "user", long), { ...msg("a1", "assistant", long), usage: { inputTokens: 9000, outputTokens: 5000, cost: 0.02 } }, msg("u2", "user", "next")];
  const whole = chatContextUsage(messages, messages, undefined);
  const after = chatContextUsage(messages, messages.slice(2), "Short summary.");
  expect(after.usedTokens).toBeLessThan(whole.usedTokens / 5);
  expect(after.totals.cost).toBe(0.02);
});
