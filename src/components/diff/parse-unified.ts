import type { DiffHunk, FileDiff } from "./types";

export type ParsedFileDiff = { path: string; created: boolean; deleted: boolean; diff: FileDiff };

const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/** `a/src/x.ts` → `src/x.ts`; `/dev/null` stays as is. */
function cleanPath(raw: string) {
  const path = raw.trim().split("\t")[0];
  return path.replace(/^[ab]\//, "");
}

/**
 * Unified diff text (`git diff`, or what an agent's edit step reports) as
 * one `FileDiff` per file. Text that isn't a diff gives an empty list.
 */
export function parseUnifiedDiff(text: string): ParsedFileDiff[] {
  const files: ParsedFileDiff[] = [];
  let file: ParsedFileDiff | undefined;
  let hunk: DiffHunk | undefined;
  let oldLine = 0;
  let newLine = 0;
  let oldPath = "";

  const start = (path: string) => {
    file = { path, created: false, deleted: false, diff: { kind: "text", hunks: [], additions: 0, deletions: 0 } };
    files.push(file);
    hunk = undefined;
  };

  for (const line of text.replace(/\r\n/g, "\n").split("\n")) {
    if (line.startsWith("diff --git ")) {
      const match = / b\/(.+)$/.exec(line);
      start(match?.[1] ?? line.slice(11));
      continue;
    }
    if (line.startsWith("--- ") && !hunk?.lines.length) {
      oldPath = cleanPath(line.slice(4));
      continue;
    }
    if (line.startsWith("+++ ") && (!hunk || hunk.lines.length === 0)) {
      const newPath = cleanPath(line.slice(4));
      const path = newPath === "/dev/null" ? oldPath : newPath;
      if (!file || file.diff.hunks.length > 0 || (file.path !== path && !line.includes(file.path))) start(path);
      else file.path = path;
      if (file) {
        file.created = oldPath === "/dev/null";
        file.deleted = newPath === "/dev/null";
      }
      continue;
    }
    const header = HUNK.exec(line);
    if (header) {
      if (!file) start(oldPath || "file");
      oldLine = Number(header[1]);
      newLine = Number(header[2]);
      hunk = { header: line, lines: [] };
      file!.diff.hunks.push(hunk);
      continue;
    }
    if (!hunk || !file) continue;
    if (line.startsWith("+")) {
      hunk.lines.push({ tag: "add", text: line.slice(1), newLine: newLine++ });
      file.diff.additions++;
    } else if (line.startsWith("-")) {
      hunk.lines.push({ tag: "del", text: line.slice(1), oldLine: oldLine++ });
      file.diff.deletions++;
    } else if (line.startsWith(" ")) {
      hunk.lines.push({ tag: "ctx", text: line.slice(1), oldLine: oldLine++, newLine: newLine++ });
    }
    // "\ No newline at end of file" and clipped-output notes are skipped.
  }
  // An empty old side means the file is new, whatever the header said.
  for (const f of files) {
    if (f.diff.deletions === 0 && f.diff.hunks.length === 1 && /^@@ -0,0 /.test(f.diff.hunks[0].header)) f.created = true;
  }
  return files.filter((f) => f.diff.hunks.length > 0);
}
