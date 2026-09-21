import { expect, test } from "bun:test";
import { buildInstructions, type InstructionsState, type Skill } from "./store";

const skill = (over: Partial<Skill>): Skill => ({
  id: crypto.randomUUID(),
  name: "Weekly report",
  description: "the user asks for a weekly status report",
  instructions: "X".repeat(5000),
  enabled: true,
  ...over,
});

const state = (skills: Skill[]): InstructionsState => ({ custom: "", skills });

test("cowork points at the folder instead of carrying the text", () => {
  const s = skill({
    install: { slug: "weekly-report", dir: "/lib/weekly-report", files: ["scripts/build.py"], at: "" },
  });
  const out = buildInstructions(state([s]), undefined, "cowork");
  expect(out).toContain("/lib/weekly-report/SKILL.md");
  expect(out).toContain("also has: scripts/build.py");
  expect(out).not.toContain("XXXX");
  expect(out.length).toBeLessThan(700);
});

test("chat carries the text, since it has no file tools", () => {
  const s = skill({ install: { slug: "w", dir: "/lib/w", files: [], at: "" } });
  const out = buildInstructions(state([s]), undefined, "chat");
  expect(out).toContain("X".repeat(4000));
});

test("a library that would not fit still lists every skill in cowork", () => {
  const many = Array.from({ length: 50 }, (_, i) =>
    skill({ name: `Skill ${i}`, install: { slug: `s${i}`, dir: `/lib/s${i}`, files: [], at: "" } }),
  );
  const out = buildInstructions(state(many), undefined, "cowork");
  for (let i = 0; i < 50; i++) expect(out).toContain(`Skill ${i} — use when:`);
  // 250,000 characters of instructions cost about three lines each instead.
  expect(out.length).toBeLessThan(6000);
});

test("a skill not on disk still travels with the prompt in cowork", () => {
  const out = buildInstructions(state([skill({ instructions: "Do the thing" })]), undefined, "cowork");
  expect(out).toContain("Do the thing");
});

test("chat truncates past the limit rather than dropping skills", () => {
  const many = Array.from({ length: 10 }, (_, i) => skill({ name: `Skill ${i}` }));
  const out = buildInstructions(state(many), undefined, "chat");
  expect(out).toContain("Skill 9");
  expect(out).toContain("too long to include here");
});

test("disabled skills are never mentioned", () => {
  const out = buildInstructions(
    state([skill({ name: "Off", enabled: false, install: { slug: "off", dir: "/lib/off", files: [], at: "" } })]),
    undefined,
    "cowork",
  );
  expect(out).not.toContain("Off");
});
