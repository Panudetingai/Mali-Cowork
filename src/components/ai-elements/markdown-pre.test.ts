import { describe, expect, test } from "bun:test";
import { guessLanguage } from "./markdown-pre";

describe("guessLanguage", () => {
  test("recognises common snippets", () => {
    expect(guessLanguage('import { X } from "./x";\nexport default function F() {\n  return <a className="x" />;\n}')).toBe("tsx");
    expect(guessLanguage('{ "a": 1 }')).toBe("json");
    expect(guessLanguage("npm install streamdown")).toBe("bash");
    expect(guessLanguage("fn main() {\n  println!(\"hi\");\n}")).toBe("rust");
    expect(guessLanguage("def f(x):\n    return x")).toBe("python");
    expect(guessLanguage("const a = 1;")).toBe("typescript");
    expect(guessLanguage("just some words")).toBe("text");
  });
});
