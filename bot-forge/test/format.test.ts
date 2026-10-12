import { describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { strToU8, zipSync } from "fflate";
import { unzipFiles } from "../src/archive";
import { splitFrontMatter } from "../src/frontmatter";
import { fromFiles, scopeOf, toFiles, toolsLine } from "../src/plugin";
import { BotSpec, slugify, specProblems } from "../src/schema";
import { Workspace } from "../src/store";
import { sampleSpec, tempDir } from "./helpers";

describe("the plugin folder", () => {
  test("has the layout Mali Cowork and Claude Code read", () => {
    const files = toFiles(sampleSpec());
    expect([...files.keys()].sort()).toEqual([
      ".claude-plugin/plugin.json",
      ".mcp.json",
      "README.md",
      "agents/pr-reviewer.md",
      "bot.json",
      "skills/review-checklist/SKILL.md",
    ]);
    const { meta, body } = splitFrontMatter(files.get("agents/pr-reviewer.md")!);
    expect(meta.name).toBe("pr-reviewer");
    expect(meta["mali-connectors"]).toBe("github, docs");
    expect(meta["mali-skills"]).toBe("review-checklist");
    expect(scopeOf(meta.tools)).toBe("read");
    expect(body).toContain("1. Read the diff.");
  });

  test("never writes a secret: connectors carry variables only", () => {
    const mcp = JSON.parse(toFiles(sampleSpec()).get(".mcp.json")!);
    expect(mcp.mcpServers.github.env).toEqual({ GITHUB_PERSONAL_ACCESS_TOKEN: "${GITHUB_PERSONAL_ACCESS_TOKEN}" });
    expect(mcp.mcpServers.docs).toEqual({ type: "http", url: "https://example.com/mcp", headers: { Authorization: "Bearer ${DOCS_TOKEN}" } });
  });

  test("comes back as the same bot", () => {
    const spec = sampleSpec();
    expect(fromFiles(toFiles(spec))).toEqual(spec);
  });

  test("a plain Claude Code plugin with an agent comes in as a bot", () => {
    const spec = sampleSpec();
    const files = toFiles(spec);
    files.delete("bot.json");
    const back = fromFiles(files);
    expect(back.slug).toBe("pr-reviewer");
    expect(back.name).toBe("PR Reviewer");
    expect(back.tools).toBe("read");
    expect(back.connectors.map((c) => c.name)).toEqual(["github", "docs"]);
    expect(back.connectors[0].env.map((v) => v.var)).toEqual(["GITHUB_PERSONAL_ACCESS_TOKEN"]);
    expect(back.skills[0]).toMatchObject({ name: "review-checklist", body: "- Tests?\n- Names?" });
  });

  test("access maps to tool lists both ways", () => {
    for (const tools of ["none", "read", "files", "all"] as const) {
      expect(scopeOf(toolsLine({ tools, connectors: sampleSpec().connectors }))).toBe(tools);
    }
  });

  test("a Mali Bot Studio export becomes a bot", () => {
    const studio = { version: 1, exportedAt: 1, bot: { name: "Momo", role: "Designs posters in Canva", styleNotes: "Bright colours", knowledge: [{ title: "Brand", body: "Pink and white" }] } };
    const bot = fromFiles(new Map([["bot.json", JSON.stringify(studio)]]));
    expect(bot).toMatchObject({ slug: "momo", name: "Momo", duty: "Designs posters in Canva" });
    expect(bot.instructions).toContain("Bright colours");
    expect(bot.instructions).toContain("### Brand");
  });

  test("names", () => {
    expect(slugify("Email Manager!")).toBe("email-manager");
    expect(slugify("ผู้ช่วยอีเมล")).toBe("bot");
    const skill = sampleSpec().skills[0];
    expect(() => sampleSpec({ skills: [skill, skill] })).toThrow("Two skills");
    expect(specProblems(BotSpec.parse({ ...sampleSpec(), skills: [skill, skill] }))).toEqual(['Two skills are named "review-checklist".']);
  });
});

describe("archives", () => {
  test("a zip can't write outside its folder", () => {
    const evil = zipSync({ "../../etc/passwd": strToU8("x") });
    expect(() => unzipFiles(evil)).toThrow("Unsafe path");
    const absolute = zipSync({ "/tmp/x": strToU8("x") });
    expect(() => unzipFiles(absolute)).toThrow();
  });

  test("the single top folder of an export is stripped", () => {
    const files = unzipFiles(zipSync({ "pr-reviewer/bot.json": strToU8("{}"), "pr-reviewer/agents/a.md": strToU8("x"), "__MACOSX/._x": strToU8("") }));
    expect([...files.keys()].sort()).toEqual(["agents/a.md", "bot.json"]);
  });
});

describe("the workspace", () => {
  test("saves, exports and imports a bot; a taken name gets a new one", () => {
    const ws = new Workspace(tempDir());
    ws.save(sampleSpec());
    expect(ws.list().map((b) => b.slug)).toEqual(["pr-reviewer"]);
    const zip = ws.exportZip("pr-reviewer");
    const out = join(tempDir(), "pr.zip");
    writeFileSync(out, zip);
    const { spec } = ws.importFrom(out);
    expect(spec.slug).toBe("pr-reviewer-2");
    expect(readFileSync(join(ws.root, "pr-reviewer-2", "agents", "pr-reviewer-2.md"), "utf8")).toContain("name: pr-reviewer-2");
  });

  test("a removed skill's folder goes with it", () => {
    const ws = new Workspace(tempDir());
    const spec = ws.save(sampleSpec());
    ws.save({ ...spec, skills: [] });
    expect(() => readFileSync(join(ws.root, "pr-reviewer", "skills", "review-checklist", "SKILL.md"))).toThrow();
  });

  test("values written into an imported .mcp.json are left behind", () => {
    const ws = new Workspace(tempDir());
    const dir = join(tempDir(), "plugin");
    mkdirSync(join(dir, "agents"), { recursive: true });
    writeFileSync(join(dir, "agents", "helper.md"), "---\nname: helper\ndescription: Helps\n---\nHelp.");
    writeFileSync(join(dir, ".mcp.json"), JSON.stringify({ mcpServers: { svc: { command: "svc-mcp", env: { API_KEY: "sk-live-123", MODE: "${MODE}" } } } }));
    const { spec, dropped } = ws.importFrom(dir);
    expect(dropped).toEqual(["svc: API_KEY"]);
    expect(readFileSync(join(ws.root, spec.slug, ".mcp.json"), "utf8")).not.toContain("sk-live-123");
  });
});
