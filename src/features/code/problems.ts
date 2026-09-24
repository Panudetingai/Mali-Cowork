/** A compiler / linter / test message pointing at a place in the code. */
export type Problem = {
  /** Path as printed, relative to where the command ran (or absolute). */
  file: string;
  line: number;
  column?: number;
  severity: "error" | "warning";
  message: string;
};

const MAX_PROBLEMS = 200;

// src/a.ts(12,5): error TS2322: Type 'x' is not assignable…
const TSC = /^(.+?)\((\d+),(\d+)\):\s+(error|warning)\s+(?:TS\d+:\s*)?(.*)$/;
// src/a.ts:12:5 - error TS2322: …   (tsc --pretty)
const TSC_PRETTY = /^(.+?):(\d+):(\d+)\s+-\s+(error|warning)\s+(?:TS\d+:\s*)?(.*)$/;
// src/main.rs:12:5: error[E0308]: mismatched types   (cargo --message-format short)
// main.go:12:5: undefined: foo   /   gcc, eslint unix, ruff, mypy
const UNIX = /^([^\s:][^:]*?\.[A-Za-z0-9]+):(\d+)(?::(\d+))?:?\s+(?:(error|warning|warn|note)(?:\[[^\]]*\])?:?\s*)?(.*)$/;
// Rust long form:  --> src/main.rs:12:5  (message is on the line before)
const RUST_ARROW = /^\s*-->\s+(.+?):(\d+):(\d+)\s*$/;
const RUST_HEAD = /^(error|warning)(?:\[[^\]]*\])?:\s*(.*)$/;
// Python traceback:  File "app/x.py", line 12, in foo
const PY = /^\s*File "(.+?)", line (\d+)/;

function severityOf(word: string | undefined, line: string): Problem["severity"] {
  if (word) return /^warn/i.test(word) || word === "note" ? "warning" : "error";
  return /\bwarning\b/i.test(line) ? "warning" : "error";
}

/** Only paths that look like source files, not URLs or timestamps. */
function plausibleFile(file: string) {
  return !/^[a-z]+:\/\//i.test(file) && !/^\d+$/.test(file) && !file.includes(" at ");
}

/** Pull problems out of build/test output, in order, without duplicates. */
export function parseProblems(output: string[]): Problem[] {
  const problems: Problem[] = [];
  const seen = new Set<string>();
  let rustHead: { severity: Problem["severity"]; message: string } | undefined;
  let pythonError: Problem | undefined;

  const add = (problem: Problem) => {
    const key = `${problem.file}:${problem.line}:${problem.column ?? ""}:${problem.message}`;
    if (seen.has(key) || problems.length >= MAX_PROBLEMS) return;
    seen.add(key);
    problems.push(problem);
  };

  for (const raw of output) {
    const line = raw.replace(/\x1b\[[0-9;]*m/g, "").trimEnd();
    let m: RegExpMatchArray | null;

    if ((m = line.match(RUST_HEAD))) {
      rustHead = { severity: m[1] === "warning" ? "warning" : "error", message: m[2] };
      continue;
    }
    if ((m = line.match(RUST_ARROW)) && rustHead) {
      add({ file: m[1], line: +m[2], column: +m[3], ...rustHead });
      rustHead = undefined;
      continue;
    }
    if ((m = line.match(PY))) {
      pythonError = { file: m[1], line: +m[2], severity: "error", message: "" };
      continue;
    }
    if (pythonError && /^[A-Za-z_.]*(Error|Exception)\b/.test(line)) {
      add({ ...pythonError, message: line });
      pythonError = undefined;
      continue;
    }
    if ((m = line.match(TSC)) || (m = line.match(TSC_PRETTY))) {
      add({ file: m[1].trim(), line: +m[2], column: +m[3], severity: severityOf(m[4], line), message: m[5] });
      continue;
    }
    if ((m = line.match(UNIX)) && plausibleFile(m[1])) {
      const message = m[5].trim();
      if (!message) continue;
      add({
        file: m[1].trim(),
        line: +m[2],
        column: m[3] ? +m[3] : undefined,
        severity: severityOf(m[4], line),
        message,
      });
    }
  }
  return problems;
}

/**
 * The project-relative path a problem points at, given the folder the
 * command ran in (`cwd`, relative) and the project root (absolute).
 */
export function problemPath(problem: Problem, root: string, cwd: string): string | undefined {
  const norm = (p: string) => p.replace(/\\/g, "/").replace(/^\.\//, "");
  const file = norm(problem.file);
  const base = norm(root).replace(/\/+$/, "");
  if (file.startsWith("/") || /^[A-Za-z]:\//.test(file)) {
    return file.startsWith(`${base}/`) ? file.slice(base.length + 1) : undefined;
  }
  const joined = cwd ? `${norm(cwd).replace(/\/+$/, "")}/${file}` : file;
  // Resolve `a/../b` the way the shell would.
  const parts: string[] = [];
  for (const part of joined.split("/")) {
    if (part === "..") parts.pop();
    else if (part && part !== ".") parts.push(part);
  }
  return parts.join("/");
}

/** The tail of the output worth sending to the model: errors plus a bit of context. */
export function outputForModel(output: string[], maxChars = 6000) {
  const text = output.join("\n");
  return text.length <= maxChars ? text : `…(earlier output trimmed)\n${text.slice(-maxChars)}`;
}
