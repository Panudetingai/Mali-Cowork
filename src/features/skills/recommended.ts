/**
 * Single skills a bot can be given in one click: each is a folder in one of
 * the featured collections (see `catalog.ts`), so installing it goes through
 * the usual importer — the user reads it before anything is saved.
 */
import type { Skill } from "@/features/instructions";

export type RecommendedSkill = {
  /** Its folder name, which is also the name it installs under. */
  id: string;
  name: string;
  description: string;
  /** `owner/repo` it comes from. */
  repo: string;
  /** The skill's folder: what the importer is handed. */
  url: string;
  /** Words in a bot's duty that mean it would want this skill. */
  keywords: string[];
};

const anthropic = (id: string, name: string, description: string, keywords: string[] = []): RecommendedSkill => ({
  id,
  name,
  description,
  keywords,
  repo: "anthropics/skills",
  url: `https://github.com/anthropics/skills/tree/HEAD/skills/${id}`,
});
const superpowers = (id: string, name: string, description: string, keywords: string[] = []): RecommendedSkill => ({
  id,
  name,
  description,
  keywords,
  repo: "obra/superpowers",
  url: `https://github.com/obra/superpowers/tree/HEAD/skills/${id}`,
});

export const RECOMMENDED_SKILLS: RecommendedSkill[] = [
  anthropic("docx", "Word documents", "Create and edit .docx files: headings, tables, tracked changes, comments.", ["word", "docx", "เอกสาร", "ไฟล์ word"]),
  anthropic("xlsx", "Spreadsheets", "Build and edit .xlsx files with formulas, formatting and charts.", ["excel", "spreadsheet", "xlsx", "csv", "สเปรดชีต", "ตาราง"]),
  anthropic("pptx", "Slide decks", "Make and edit PowerPoint presentations and their layouts.", ["powerpoint", "pptx", "slide", "presentation", "สไลด์", "นำเสนอ"]),
  anthropic("pdf", "PDF files", "Read, fill, merge, split and create PDF documents.", ["pdf"]),
  anthropic("doc-coauthoring", "Co-writing documents", "Write proposals, specs and docs together, section by section.", ["proposal", "specification", "draft a doc", "ข้อเสนอ"]),
  anthropic("internal-comms", "Internal updates", "Status reports, newsletters, FAQs and announcements in a house style.", ["status report", "newsletter", "announcement", "รายงาน", "ประกาศ"]),
  anthropic("brand-guidelines", "Brand guidelines", "Keep colors, type and tone on brand in anything it makes.", ["brand", "แบรนด์"]),
  anthropic("frontend-design", "Front-end design", "Distinctive, production-ready web pages and components.", ["website", "web page", "landing page", "frontend", "หน้าเว็บ"]),
  anthropic("canvas-design", "Posters and visuals", "Design posters, covers and visual pieces as images or PDFs.", ["poster", "design", "visual", "โปสเตอร์", "ออกแบบ"]),
  anthropic("webapp-testing", "Web app testing", "Test a local web app in a real browser and report what broke.", ["test the app", "browser test", "e2e", "playwright"]),
  anthropic("mcp-builder", "MCP server builder", "Plan and build MCP servers that connect apps to agents.", ["mcp server"]),
  anthropic("skill-creator", "Skill creator", "Write and improve skills of your own."),
  superpowers("brainstorming", "Brainstorming", "Turn a rough idea into a clear design by asking the right questions.", ["brainstorm", "idea", "ไอเดีย", "ระดมความคิด"]),
  superpowers("writing-plans", "Writing plans", "Break work into a step-by-step plan before starting.", ["a plan", "planning", "step-by-step plan", "วางแผน"]),
  superpowers("systematic-debugging", "Systematic debugging", "Find the root cause of a bug before fixing it.", ["bug", "debug", "error", "บั๊ก"]),
  superpowers("test-driven-development", "Test-driven development", "Write the failing test first, then the code.", ["unit test", "tdd", "write tests"]),
  superpowers("verification-before-completion", "Check before done", "Prove the work is finished before saying so.", ["verify", "check its work", "ตรวจสอบ"]),
];

export function recommendedSkill(id: string) {
  return RECOMMENDED_SKILLS.find((s) => s.id === id);
}

/** Already in the library: brought from that folder, or under that name. */
export function hasRecommendedSkill(skill: RecommendedSkill, library: Pick<Skill, "name" | "source">[]) {
  return library.some(
    (k) =>
      k.name.trim().toLowerCase() === skill.id ||
      k.name.trim().toLowerCase() === skill.name.toLowerCase() ||
      (!!k.source && k.source.replace(/\/+$/, "").endsWith(`/skills/${skill.id}`)),
  );
}

/** Not in the library yet, and named by the bot's duty. */
export function recommendedSkillsFor(text: string, library: Pick<Skill, "name" | "source">[]): RecommendedSkill[] {
  const t = text.toLowerCase();
  return RECOMMENDED_SKILLS.filter((s) => !hasRecommendedSkill(s, library) && s.keywords.some((k) => t.includes(k)));
}
