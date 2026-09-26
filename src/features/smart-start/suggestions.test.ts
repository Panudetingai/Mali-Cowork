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
