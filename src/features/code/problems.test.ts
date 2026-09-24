import { describe, expect, test } from "bun:test";
import { parseProblems, problemPath } from "./problems";

describe("parseProblems", () => {
  test("tsc plain and pretty", () => {
    const problems = parseProblems([
      "src/a.ts(12,5): error TS2322: Type 'string' is not assignable to type 'number'.",
      "src/b.tsx:3:10 - error TS2304: Cannot find name 'foo'.",
    ]);
    expect(problems).toEqual([
      { file: "src/a.ts", line: 12, column: 5, severity: "error", message: "Type 'string' is not assignable to type 'number'." },
      { file: "src/b.tsx", line: 3, column: 10, severity: "error", message: "Cannot find name 'foo'." },
    ]);
  });

  test("cargo short and long form", () => {
    const problems = parseProblems([
      "src/main.rs:4:9: warning: unused variable: `x`",
      "error[E0308]: mismatched types",
      "  --> src/lib.rs:10:5",
    ]);
    expect(problems.map((p) => [p.file, p.line, p.severity])).toEqual([
      ["src/main.rs", 4, "warning"],
      ["src/lib.rs", 10, "error"],
    ]);
    expect(problems[1].message).toBe("mismatched types");
  });

  test("go and python", () => {
    const problems = parseProblems([
      "./main.go:12:2: undefined: foo",
      'Traceback (most recent call last):',
      '  File "app/x.py", line 7, in <module>',
      "NameError: name 'y' is not defined",
    ]);
    expect(problems.map((p) => [p.file, p.line])).toEqual([
      ["./main.go", 12],
      ["app/x.py", 7],
    ]);
  });

  test("ignores urls, noise and duplicates", () => {
    const problems = parseProblems([
      "  VITE ready at http://localhost:5173/",
      "12:30:01 compiled",
      "src/a.ts(1,1): error TS1: x",
      "src/a.ts(1,1): error TS1: x",
    ]);
    expect(problems).toHaveLength(1);
  });
});

describe("problemPath", () => {
  test("relative to the task folder", () => {
    expect(problemPath({ file: "src/lib.rs", line: 1, severity: "error", message: "" }, "/p", "src-tauri")).toBe(
      "src-tauri/src/lib.rs",
    );
    expect(problemPath({ file: "./main.go", line: 1, severity: "error", message: "" }, "/p", "")).toBe("main.go");
  });

  test("absolute inside and outside the project", () => {
    expect(problemPath({ file: "/p/src/a.ts", line: 1, severity: "error", message: "" }, "/p", "")).toBe("src/a.ts");
    expect(problemPath({ file: "/other/a.ts", line: 1, severity: "error", message: "" }, "/p", "")).toBeUndefined();
  });
});
