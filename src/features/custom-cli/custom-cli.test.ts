import { describe, expect, test } from "bun:test";
import { cliArgs, cliModels, normalizeCustomCliIcon, resolveCliModel, splitArgs } from ".";

describe("custom CLI arguments", () => {
  test("split like a shell, quotes kept together", () => {
    expect(splitArgs(`-p {prompt} --system "be brief" ''`)).toEqual(["-p", "{prompt}", "--system", "be brief", ""]);
  });

  test("the model fills {model}, or goes away with its flag", () => {
    const cli = { args: "-p {prompt} --model {model} --yes" };
    expect(cliArgs(cli, "opus")).toEqual(["-p", "{prompt}", "--model", "opus", "--yes"]);
    expect(cliArgs(cli)).toEqual(["-p", "{prompt}", "--yes"]);
    expect(cliArgs({ args: "--model={model}" })).toEqual([]);
  });

  test("models are a deduplicated list", () => {
    expect(cliModels({ models: " sonnet, opus,,sonnet " })).toEqual(["sonnet", "opus"]);
  });

  test("custom CLI icons accept HTTPS and data URLs only", () => {
    expect(normalizeCustomCliIcon("  https://example.com/a.png  ")).toBe("https://example.com/a.png");
    expect(normalizeCustomCliIcon("data:image/png;base64,abc")).toBe("data:image/png;base64,abc");
    expect(normalizeCustomCliIcon("javascript:alert(1)")).toBeUndefined();
    expect(normalizeCustomCliIcon("")).toBeUndefined();
  });

  test("a model picked before v2 gets its CLI provider back", () => {
    const kilo = { command: "kilo", models: "kilo/poolside/laguna-s-2.1:free, kilo/openai/gpt-5" };
    expect(resolveCliModel(kilo, "poolside/laguna-s-2.1:free")).toBe("kilo/poolside/laguna-s-2.1:free");
    expect(resolveCliModel(kilo, "kilo/openai/gpt-5")).toBe("kilo/openai/gpt-5");
    expect(resolveCliModel(kilo, undefined)).toBeUndefined();
    expect(resolveCliModel({ command: "gemini", models: "gemini-2.5-pro" }, "gemini-2.5-pro")).toBe("gemini-2.5-pro");
  });
});
