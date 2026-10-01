import { describe, expect, test } from "bun:test";
import { suggestTasks } from "./suggestions";

describe("suggestTasks", () => {
  test("a code project gets code work first", () => {
    const ideas = suggestTasks(["package.json", "src/index.ts", "README.md"], "th");
    expect(ideas[0].id).toBe("project-review");
  });

  test("counts files of a kind and never names them", () => {
    const files = ["สัญญา-ลูกค้า-ลับ.pdf", "report 2569.pdf", "scan.pdf", ".env"];
    const ideas = suggestTasks(files, "th");
    expect(ideas[0].title).toBe("สรุป PDF 3 ไฟล์เป็นตาราง");
    const everything = ideas.map((i) => `${i.title} ${i.prompt}`).join(" ");
    for (const name of ["สัญญา", "report 2569", "scan", ".env"]) expect(everything).not.toContain(name);
  });

  test("an empty folder still gets the document templates", () => {
    const ideas = suggestTasks([], "en");
    expect(ideas.map((i) => i.skill)).toEqual(["ใบเสนอราคา", "หนังสือราชการ"]);
  });

  test("a messy folder is offered a tidy-up, and there are never more than four cards", () => {
    const files = Array.from({ length: 20 }, (_, i) => `file${i}.${["pdf", "jpg", "xlsx", "docx", "zip"][i % 5]}`);
    const ideas = suggestTasks(files, "en");
    expect(ideas.length).toBe(4);
    expect(suggestTasks(files, "en", 10).some((i) => i.id === "tidy")).toBe(true);
  });
});

describe("pickSuggestions", () => {
  const seeded = (seed: number) => () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };

  test("one folder idea at most, the rest drawn from everything, never twice", async () => {
    const { coworkIdeas, pickSuggestions } = await import("./suggestions");
    const folder = suggestTasks(["package.json"], "en", 8);
    const general = coworkIdeas("en");
    for (let seed = 1; seed < 40; seed++) {
      const cards = pickSuggestions(folder, general, 3, seeded(seed));
      expect(cards).toHaveLength(3);
      expect(new Set(cards.map((c) => c.id)).size).toBe(3);
    }
  });

  test("different visits show different cards", async () => {
    const { coworkIdeas, pickSuggestions } = await import("./suggestions");
    const folder = suggestTasks(["package.json"], "en", 8);
    const seen = new Set<string>();
    for (let seed = 1; seed < 20; seed++) {
      pickSuggestions(folder, coworkIdeas("en"), 3, seeded(seed)).forEach((c) => seen.add(c.id));
    }
    expect(seen.size).toBeGreaterThan(8);
  });

  test("every idea reads in Thai and English", async () => {
    const { chatIdeas, coworkIdeas } = await import("./suggestions");
    for (const lang of ["th", "en"] as const) {
      for (const idea of [...coworkIdeas(lang), ...chatIdeas(lang)]) {
        expect(idea.title.trim().length).toBeGreaterThan(3);
        expect(idea.prompt.trim().length).toBeGreaterThan(10);
      }
    }
  });
});
