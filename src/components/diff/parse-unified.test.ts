import { describe, expect, test } from "bun:test";
import { parseUnifiedDiff } from "./parse-unified";

describe("parseUnifiedDiff", () => {
  test("reads an agent's edit with line numbers", () => {
    const [file] = parseUnifiedDiff(
      ["--- src/a.ts", "+++ src/a.ts", "@@ -3,3 +3,4 @@", " keep", "-old", "+new", "+more", " tail"].join("\n"),
    );
    expect(file.path).toBe("src/a.ts");
    expect(file.diff.additions).toBe(2);
    expect(file.diff.deletions).toBe(1);
    const lines = file.diff.hunks[0].lines;
    expect(lines[0]).toEqual({ tag: "ctx", text: "keep", oldLine: 3, newLine: 3 });
    expect(lines[1]).toEqual({ tag: "del", text: "old", oldLine: 4 });
    expect(lines[2]).toEqual({ tag: "add", text: "new", newLine: 4 });
  });

  test("splits a git diff into files and spots new ones", () => {
    const files = parseUnifiedDiff(
      [
        "diff --git a/x.md b/x.md",
        "--- a/x.md",
        "+++ b/x.md",
        "@@ -1 +1 @@",
        "-a",
        "+b",
        "diff --git a/new.ts b/new.ts",
        "new file mode 100644",
        "--- /dev/null",
        "+++ b/new.ts",
        "@@ -0,0 +1,2 @@",
        "+one",
        "+two",
      ].join("\n"),
    );
    expect(files.map((f) => f.path)).toEqual(["x.md", "new.ts"]);
    expect(files[1].created).toBe(true);
    expect(files[1].diff.additions).toBe(2);
  });

  test("plain text is not a diff", () => {
    expect(parseUnifiedDiff("$ ls\nsrc\nREADME.md")).toEqual([]);
  });
});
