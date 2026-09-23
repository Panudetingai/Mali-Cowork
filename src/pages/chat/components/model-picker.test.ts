import { describe, expect, test } from "bun:test";
import type { AiModel } from "../models";
import { buildGroups } from "./model-picker";

function model(overrides: Partial<AiModel> & Pick<AiModel, "id">): AiModel {
  return {
    name: overrides.id,
    provider: "openai",
    source: "opencode",
    group: "OpenAI",
    ...overrides,
  };
}

const sectionOf = (groups: ReturnType<typeof buildGroups>, id: string) =>
  groups.find((g) => g.items.some((m) => m.id === id))?.section;

describe("the model list", () => {
  test("keeps what can answer now apart from what still needs setting up", () => {
    const groups = buildGroups([
      model({ id: "ready", group: "OpenAI" }),
      model({ id: "no-key", group: "Mistral", needsKey: true }),
      model({ id: "signed-in", source: "cli", group: "Codex CLI" }),
      model({ id: "signed-out", source: "cli", group: "Cursor CLI", needsLogin: true }),
    ]);
    expect(sectionOf(groups, "ready")).toBe("opencode");
    expect(sectionOf(groups, "signed-in")).toBe("cli");
    expect(sectionOf(groups, "no-key")).toBe("setup");
    expect(sectionOf(groups, "signed-out")).toBe("setup");
  });

  test("everything that needs setting up sorts below everything that works", () => {
    const groups = buildGroups([
      model({ id: "no-key", group: "Mistral", needsKey: true }),
      model({ id: "ready", group: "OpenAI" }),
    ]);
    expect(groups.map((g) => g.section)).toEqual(["opencode", "setup"]);
  });

  test("a model that can't work in this mode is not offered at all", () => {
    const groups = buildGroups([
      model({ id: "zen-free", group: "OpenCode Zen", issue: "free tier needs Cowork" }),
      model({ id: "ready", group: "OpenAI" }),
    ]);
    expect(groups.flatMap((g) => g.items.map((m) => m.id))).toEqual(["ready"]);
  });

  test("a provider whose only models are unusable disappears from the rail", () => {
    const groups = buildGroups([model({ id: "zen-free", group: "OpenCode Zen", issue: "no" })]);
    expect(groups).toHaveLength(0);
  });

  // Under "Not set up yet" a CLI agent and an OpenCode provider sit together,
  // so the heading no longer says which is which.
  test("mixed-up rows still say where they would run", () => {
    const groups = buildGroups([
      model({ id: "signed-out", source: "cli", group: "Cursor CLI", needsLogin: true }),
      model({ id: "no-key", group: "Mistral", needsKey: true }),
    ]);
    const noteOf = (label: string) => groups.find((g) => g.label === label)?.note;
    expect(noteOf("Cursor CLI")).toContain("CLI agent");
    expect(noteOf("Mistral")).toContain("OpenCode");
  });
});
