import { Channel, invoke } from "@tauri-apps/api/core";

export type CodeEntry = {
  /** Path inside the project, with `/` separators. */
  rel: string;
  dir: boolean;
  size: number;
  /** Milliseconds since the epoch. */
  mtime: number;
};

export type CodeScan = { entries: CodeEntry[]; truncated: boolean };

export type CodeFile = {
  text: string | null;
  binary: boolean;
  tooLarge: boolean;
  size: number;
  mtime: number;
};

export type CodeTaskKind = "check" | "build" | "test" | "lint" | "dev";

export type CodeTask = {
  id: string;
  label: string;
  command: string;
  kind: CodeTaskKind;
  /** Folder inside the project to run in; empty for the project itself. */
  cwd: string;
};

export type RunEvent =
  | { type: "line"; stream: "stdout" | "stderr"; text: string }
  | { type: "exit"; code: number | null; durationMs: number };

export const codeApi = {
  scan: (root: string) => invoke<CodeScan>("code_scan", { root }),
  read: (root: string, rel: string) => invoke<CodeFile>("code_read", { root, rel }),
  /** Resolves with the new mtime; rejects with `conflict: …` if the file changed since `expectedMtime`. */
  write: (root: string, rel: string, text: string, expectedMtime?: number) =>
    invoke<number>("code_write", { root, rel, text, expectedMtime: expectedMtime ?? null }),
  detect: (root: string) => invoke<CodeTask[]>("code_detect", { root }),
  kill: (runId: string) => invoke<void>("code_kill", { runId }),
  run(runId: string, root: string, command: string, cwd: string, onEvent: (event: RunEvent) => void) {
    const channel = new Channel<RunEvent>();
    channel.onmessage = onEvent;
    return invoke<number | null>("code_run", { runId, root, command, cwd, onEvent: channel });
  },
};

export function isConflict(error: unknown) {
  return String(error).startsWith("conflict:");
}
