import { expect, test } from "bun:test";
import { addInstructionSource, buildInstructions, filterSkills, skillsInPrompt, type Skill } from "@/features/instructions/store";
import { agentToTeammate, commandToSkill, dutyOf, mcpToConnector, toolScopeOf } from "./convert";

test("a slash command becomes a skill called only by name", () => {
  const skill = commandToSkill(
    {
      name: "review",
      path: "commands/review.md",
      content: "---\ndescription: Review the current diff\nargument-hint: [files]\n---\nReview $ARGUMENTS carefully.",
    },
    "ECC",
  );
  expect(skill.name).toBe("review");
  expect(skill.description).toBe("Review the current diff");
  expect(skill.slashOnly).toBe(true);
  expect(skill.instructions).toContain("/review command from the ECC plugin");
  expect(skill.instructions).toContain("(expected: [files])");
  expect(skill.instructions).toContain("Review $ARGUMENTS carefully.");
});

test("a command without front matter is described by its first line", () => {
  const skill = commandToSkill({ name: "Plan", path: "commands/plan.md", content: "# Plan\nWrite a plan for $ARGUMENTS." }, "P");
  expect(skill.name).toBe("plan");
  expect(skill.description).toBe("Write a plan for $ARGUMENTS.");
});

test("slash commands stay out of the prompt until called, and can't be called while off", () => {
  const base = { id: "1", description: "d", instructions: "do it", enabled: true } as const;
  const command: Skill = { ...base, id: "c", name: "review", slashOnly: true };
  const normal: Skill = { ...base, id: "n", name: "weekly" };
  const text = buildInstructions({ custom: "", skills: [command, normal] }, undefined, "chat");
  expect(text).toContain("## weekly");
  expect(text).not.toContain("## review");
  expect(skillsInPrompt("/review the diff", [command])).toEqual([command]);

  const off = { ...command, enabled: false };
  expect(skillsInPrompt("/review the diff", [off])).toEqual([]);
  expect(filterSkills([off], "rev")).toEqual([]);
  // A switched-off ordinary skill can still be called on purpose, as before.
  expect(skillsInPrompt("/weekly", [{ ...normal, enabled: false }]).length).toBe(1);
});

test("plugin instructions join every prompt while their source says so", () => {
  let on = true;
  const stop = addInstructionSource(() => (on ? "# Instructions from plugins\nBe brief." : undefined));
  expect(buildInstructions({ custom: "", skills: [] })).toContain("Be brief.");
  on = false;
  expect(buildInstructions({ custom: "", skills: [] })).not.toContain("Be brief.");
  stop();
});

test("an agent's tools come down to Mali's scopes, reading when it says nothing", () => {
  expect(toolScopeOf(undefined)).toBe("read");
  expect(toolScopeOf("Read, Grep, Glob")).toBe("read");
  expect(toolScopeOf("Read, Edit, Write")).toBe("files");
  expect(toolScopeOf("Bash, Read")).toBe("all");
  expect(toolScopeOf("mcp__github__create_issue")).toBe("none");
});

test("an agent becomes a bot the lead asks about first", () => {
  const draft = agentToTeammate(
    {
      name: "code-reviewer",
      path: "agents/code-reviewer.md",
      content:
        "---\nname: code-reviewer\ndescription: Reviews code for bugs. <example>user: review this</example>\ntools: Read, Grep\n---\nYou review code.",
    },
    { modelId: "api:anthropic/claude", mascot: "mochi", pluginId: "ecc" },
  );
  expect(draft.name).toBe("Code reviewer");
  expect(draft.role).toBe("Reviews code for bugs.");
  expect(draft.instructions).toBe("You review code.");
  expect(draft.tools).toBe("read");
  expect(draft.onTeam).toBe(false);
  expect(draft.plugin).toBe("ecc");
});

test("a long duty is cut at a sentence", () => {
  const long = `${"Does careful things. ".repeat(20)}`;
  const duty = dutyOf(long);
  expect(duty.length).toBeLessThanOrEqual(281);
  expect(duty.endsWith(".")).toBe(true);
});

test("a server's placeholders become settings the user fills in", () => {
  const { connector, env } = mcpToConnector(
    {
      name: "github",
      config: { command: "npx", args: ["-y", "@x/github mcp"], env: { GITHUB_TOKEN: "${GITHUB_TOKEN}", MODE: "fast" } },
    },
    { id: "custom-ecc-github", pluginId: "ecc", pluginName: "ECC" },
  );
  expect(connector.kind).toBe("local");
  expect(connector.command).toBe('npx -y "@x/github mcp"');
  expect(connector.plugin).toBe("ecc");
  expect(env).toEqual({ MODE: "fast" });
  expect(connector.envVars).toEqual([{ var: "GITHUB_TOKEN", label: "Github token", required: true, secret: true }]);

  const remote = mcpToConnector(
    { name: "docs", config: { type: "http", url: "https://docs.dev/mcp", headers: { "X-Key": "1" } } },
    { id: "custom-docs", pluginId: "p", pluginName: "P" },
  ).connector;
  expect(remote.kind).toBe("remote");
  expect(remote.url).toBe("https://docs.dev/mcp");
  expect(remote.headers).toEqual({ "X-Key": "1" });
});
