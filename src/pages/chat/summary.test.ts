import { expect, test } from "bun:test";
import { chatIssueOf } from "./models";
import { summaryRunFor } from "./summary";

const zenFree = "opencode:opencode/big-pickle";
const answers = (id: string) => id !== zenFree;

test("a model that answers in Chat summarizes there", () => {
  expect(summaryRunFor("api:groq/llama", { mode: "cowork", cwd: "/w" }, { answers, others: [] })).toEqual({ modelId: "api:groq/llama", mode: "chat" });
});

test("OpenCode Zen's free model summarizes in Cowork, its folder read-only", () => {
  expect(summaryRunFor(zenFree, { mode: "cowork", cwd: "/work" }, { answers, others: [] })).toEqual({
    modelId: zenFree,
    mode: "cowork",
    cwd: "/work",
    folders: [{ path: "/work", access: "read" }],
  });
});

test("in a Chat-mode chat it falls back to a model that answers in Chat, or there's none", () => {
  expect(summaryRunFor(zenFree, { mode: "chat" }, { answers, others: [undefined, "api:anthropic/claude-haiku-5-5"] })).toEqual({
    modelId: "api:anthropic/claude-haiku-5-5",
    mode: "chat",
  });
  expect(summaryRunFor(zenFree, { mode: "chat" }, { answers, others: [zenFree] })).toBeUndefined();
});

test("Zen's free tier is the one that can't answer in Chat", () => {
  expect(chatIssueOf({ provider: "opencode", source: "opencode", free: true })).toBeTruthy();
  expect(chatIssueOf({ provider: "opencode", source: "opencode", free: false })).toBeUndefined();
  expect(chatIssueOf({ provider: "groq", source: "api", free: false })).toBeUndefined();
});
