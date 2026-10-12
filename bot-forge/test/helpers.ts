import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseSpec, type BotSpec } from "../src/schema";

export const tempDir = () => mkdtempSync(join(tmpdir(), "bot-forge-test-"));

export function sampleSpec(overrides: Partial<BotSpec> = {}): BotSpec {
  return parseSpec({
    slug: "pr-reviewer",
    name: "PR Reviewer",
    duty: "Reviews GitHub pull requests and lists what to fix.",
    instructions: "You review pull requests.\n\n1. Read the diff.\n2. List issues by severity.",
    tools: "read",
    capabilities: ["Reads pull requests", "Writes a review checklist"],
    examples: ["Review PR #12"],
    connectors: [
      {
        kind: "local",
        name: "github",
        title: "GitHub",
        description: "Repos, issues, PRs",
        catalogId: "github",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-github@2025.4.8"],
        env: [{ var: "GITHUB_PERSONAL_ACCESS_TOKEN", label: "Token", required: true, secret: true }],
      },
      { kind: "remote", name: "docs", title: "Docs", url: "https://example.com/mcp", headers: { Authorization: "Bearer ${DOCS_TOKEN}" }, env: [{ var: "DOCS_TOKEN" }] },
    ],
    skills: [{ name: "review-checklist", description: "The checklist every review follows", body: "- Tests?\n- Names?" }],
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    ...overrides,
  });
}
