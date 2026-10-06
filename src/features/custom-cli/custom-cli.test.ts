import { describe, expect, test } from "bun:test";
import { cliArgs, cliModels, splitArgs } from ".";

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
});
