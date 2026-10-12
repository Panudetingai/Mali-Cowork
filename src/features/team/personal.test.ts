import { expect, test } from "bun:test";
import type { AiModel } from "@/pages/chat/models";
import { botModels } from "@/pages/chat/models";
import { botInstructions } from "./payload";
import { BOT_MODEL_PREFIX, botIdOf, personalBot, withTeammate, type TeamState, type TeammateDraft } from "./store";

const draft = (over: Partial<TeammateDraft> = {}): TeammateDraft => ({
  name: "News Digest",
  mascot: "momo",
  role: "Summarizes linked articles in Thai",
  instructions: "Five bullets, plain Thai.",
  modelId: "api:groq/llama-3.3-70b",
  skills: ["thai-brief"],
  connectors: ["fetch"],
  tools: "none",
  onTeam: false,
  personal: true,
  ...over,
});

const state = (mates = withTeammate([], draft(), 1)): TeamState => ({
  enabled: false,
  mates,
  proposals: [],
  declined: [],
  learning: true,
  notebook: [],
  forgotten: [],
  suggested: [],
});

const groq: AiModel = { id: "api:groq/llama-3.3-70b", name: "Llama 3.3 70B", provider: "groq", source: "api", group: "Groq", efforts: [] };

test("a personal bot is picked like a model and runs on its own", () => {
  const s = state();
  const id = s.mates[0].id;
  expect(botIdOf(`${BOT_MODEL_PREFIX}${id}`)).toBe(id);
  expect(botIdOf("api:groq/x")).toBeUndefined();
  expect(personalBot(`${BOT_MODEL_PREFIX}${id}`, s)?.modelId).toBe("api:groq/llama-3.3-70b");
  // Not personal (or paused with its plugin): not in the chat box.
  expect(personalBot(`${BOT_MODEL_PREFIX}${id}`, state(withTeammate([], draft({ personal: false }), 1)))).toBeUndefined();
});

test("the chat box lists personal bots on their model, and leaves out one whose model isn't here", () => {
  const s = state(withTeammate(withTeammate([], draft(), 1), draft({ name: "Team only", personal: false, skills: [], connectors: [] }), 2));
  const listed = botModels([groq], s.mates);
  expect(listed).toHaveLength(1);
  expect(listed[0]).toMatchObject({ name: "News Digest", source: "bot", group: "Your bots", runsOn: "Llama 3.3 70B", provider: "groq" });
  expect(listed[0].id.startsWith(BOT_MODEL_PREFIX)).toBe(true);
  expect(botModels([], s.mates)).toEqual([]);
});

test("a personal bot speaks for itself, with its skills", () => {
  const mate = state().mates[0];
  const text = botInstructions(mate, "chat", undefined, {
    custom: "Answer politely.",
    skills: [
      { id: "thai-brief", name: "thai-brief", description: "Five bullets", instructions: "1. Title\n2. Bullets", enabled: true },
      { id: "other", name: "other", description: "Not its own", instructions: "Something else", enabled: true },
    ],
  });
  expect(text).toContain("# You are News Digest");
  expect(text).toContain("Your duty: Summarizes linked articles in Thai");
  expect(text).toContain("Five bullets, plain Thai.");
  expect(text).toContain("Answer politely.");
  expect(text).toContain("thai-brief");
  expect(text).not.toContain("Something else");
});
