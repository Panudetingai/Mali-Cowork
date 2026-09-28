import { describe, expect, test } from "bun:test";
import { skillSlug } from "./store";
import { THAI_TEMPLATE_SKILLS } from "./thai-templates";

describe("Thai template skills", () => {
  test("are called with a Thai slash command", () => {
    const slugs = THAI_TEMPLATE_SKILLS.map((s) => skillSlug(s));
    expect(slugs).toContain("ใบเสนอราคา");
    expect(slugs).toContain("หนังสือราชการ");
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  test("document skills point at the right built-in template", () => {
    const byName = Object.fromEntries(THAI_TEMPLATE_SKILLS.map((s) => [s.name, s.instructions]));
    expect(byName["ใบเสนอราคา"]).toContain('template "quotation"');
    expect(byName["ใบแจ้งหนี้"]).toContain('template "invoice"');
    expect(byName["หนังสือราชการ"]).toContain('template "official-letter"');
    expect(byName["บันทึกการประชุม"]).toContain('template "meeting-minutes"');
  });
});

describe("skills from older versions", () => {
  test("no longer say the templates need an API-key model", async () => {
    const { seedThaiTemplateSkills, OLD_NEEDS_COWORK, NEEDS_COWORK } = await import("./thai-templates");
    const saved: { id?: string; instructions: string }[] = [];
    seedThaiTemplateSkills(
      [{ id: "s1", name: "ใบเสนอราคา", description: "", enabled: true, instructions: `# ใบเสนอราคา\n- ${OLD_NEEDS_COWORK}` }],
      (skill) => saved.push(skill),
    );
    expect(saved[0]?.id).toBe("s1");
    expect(saved[0]?.instructions).toContain(NEEDS_COWORK);
    expect(saved[0]?.instructions).not.toContain("Your API keys");
  });
});
