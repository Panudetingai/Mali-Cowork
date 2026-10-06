import { test, expect } from "bun:test";
import { parseChatInstall, stripPluginCommandPrefix } from "./parse";

test("plugin marketplace add from chat", () => {
  expect(parseChatInstall("/plugin marketplace add DietrichGebert/ponytail")).toEqual({
    kind: "plugin",
    input: "/plugin marketplace add DietrichGebert/ponytail",
  });
});

test("plugin install with marketplace ref", () => {
  expect(parseChatInstall("/plugin install ponytail@ponytail")).toEqual({
    kind: "plugin",
    input: "/plugin install ponytail@ponytail",
  });
});

test("npx skills add command", () => {
  const cmd = "npx skills add https://github.com/ibelick/ui-skills --skill ui-skills-root";
  expect(parseChatInstall(cmd)).toEqual({ kind: "skill", input: cmd });
});

test("skillfish without npx", () => {
  expect(parseChatInstall("skillfish add owner/repo my-skill")).toEqual({
    kind: "skill",
    input: "skillfish add owner/repo my-skill",
  });
});

test("normal chat is not an install command", () => {
  expect(parseChatInstall("please fix the bug in main.ts")).toBeNull();
  expect(parseChatInstall("anthropics/skills")).toBeNull();
});

test("strip plugin prefix", () => {
  expect(stripPluginCommandPrefix("/plugin install ponytail@ponytail")).toBe("ponytail@ponytail");
  expect(stripPluginCommandPrefix("$ /plugin marketplace add o/r")).toBe("o/r");
});
