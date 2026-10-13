import { expect, test } from "bun:test";
import { hasRecommendedSkill, RECOMMENDED_SKILLS, recommendedSkill, recommendedSkillsFor } from "./recommended";

test("a duty that names the work brings the skill for it", () => {
  const ids = (text: string) => recommendedSkillsFor(text, []).map((s) => s.id);
  expect(ids("Turn my notes into a PowerPoint deck")).toContain("pptx");
  expect(ids("สรุปยอดขายลงสเปรดชีต")).toContain("xlsx");
  expect(ids("Answer emails politely")).toEqual([]);
});

test("a skill already in the library isn't offered again", () => {
  const pdf = recommendedSkill("pdf")!;
  expect(hasRecommendedSkill(pdf, [{ name: "pdf" }])).toBe(true);
  expect(hasRecommendedSkill(pdf, [{ name: "Something", source: "https://github.com/anthropics/skills/tree/HEAD/skills/pdf/" }])).toBe(true);
  expect(hasRecommendedSkill(pdf, [{ name: "docx" }])).toBe(false);
  expect(recommendedSkillsFor("fill this PDF form", [{ name: "pdf" }])).toEqual([]);
});

test("every ready-made skill points at its own folder", () => {
  for (const s of RECOMMENDED_SKILLS) expect(s.url.endsWith(`/skills/${s.id}`)).toBe(true);
  expect(new Set(RECOMMENDED_SKILLS.map((s) => s.id)).size).toBe(RECOMMENDED_SKILLS.length);
});

test("words inside other words don't count", () => {
  expect(recommendedSkillsFor("Explain the special offer", []).map((s) => s.id)).toEqual([]);
});
