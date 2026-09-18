"use client";

import { join } from "@tauri-apps/api/path";
import { readDir } from "@tauri-apps/plugin-fs";
import { useEffect, useState } from "react";

export type WorkspaceEntry = {
  /** Path relative to the workspace root, with `/` separators. */
  rel: string;
  isDirectory: boolean;
};

const MAX_DEPTH = 4;
const MAX_FILES = 400;
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "target",
  "dist",
  "build",
  ".next",
  "out",
  "coverage",
  ".venv",
  "venv",
  "__pycache__",
  ".idea",
  ".vscode",
]);

function toRel(root: string, abs: string) {
  const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "");
  const r = norm(root);
  const a = norm(abs);
  return a === r ? "" : a.startsWith(`${r}/`) ? a.slice(r.length + 1) : null;
}

async function crawl(root: string): Promise<WorkspaceEntry[]> {
  const out: WorkspaceEntry[] = [];
  const queue: { dir: string; depth: number }[] = [{ dir: root, depth: 0 }];
  while (queue.length > 0 && out.length < MAX_FILES) {
    const current = queue.shift()!;
    if (current.depth > MAX_DEPTH) continue;
    let entries;
    try {
      entries = await readDir(current.dir);
    } catch {
      continue;
    }
    const sorted = [...entries].sort((a, b) => {
      const dirDelta = Number(b.isDirectory) - Number(a.isDirectory);
      return dirDelta !== 0 ? dirDelta : (a.name ?? "").localeCompare(b.name ?? "");
    });
    for (const entry of sorted) {
      if (!entry.name || out.length >= MAX_FILES) break;
      const abs = await join(current.dir, entry.name);
      const rel = toRel(root, abs);
      if (rel == null) continue;
      if (entry.isDirectory) {
        if (entry.name.startsWith(".") || SKIP_DIRS.has(entry.name)) continue;
        out.push({ rel, isDirectory: true });
        queue.push({ dir: abs, depth: current.depth + 1 });
      } else if (entry.isFile) {
        if (entry.name.startsWith(".")) continue;
        out.push({ rel, isDirectory: false });
      }
    }
  }
  return out;
}

/** Files and folders under the workspace root, for `@` mentions. */
export function useWorkspaceFiles(root: string | undefined) {
  const [entries, setEntries] = useState<WorkspaceEntry[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!root) {
      setEntries([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    // Debounce: the root changes while the user picks folders.
    const id = window.setTimeout(() => {
      void crawl(root)
        .then((list) => {
          if (!cancelled) setEntries(list);
        })
        .catch(() => {
          if (!cancelled) setEntries([]);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(id);
    };
  }, [root]);

  return { entries, loading };
}
