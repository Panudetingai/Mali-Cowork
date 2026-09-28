"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { codeApi, isConflict, type CodeEntry } from "./api";

export type OpenFile = {
  rel: string;
  /** What the editor shows, including unsaved edits. */
  text: string;
  /** The file as last read from or written to disk. */
  saved: string;
  mtime: number;
  status: "loading" | "ready" | "binary" | "too-large" | "error";
  error?: string;
  /** Changed on disk while it had unsaved edits: the user picks a side. */
  conflict?: boolean;
  deleted?: boolean;
  /** Lines (1-based) the last outside change touched, to flash in the editor. */
  flash?: { from: number; to: number; at: number };
};

export const isDirty = (file: OpenFile) => file.status === "ready" && file.text !== file.saved;

/** How long a file counts as "just changed" in the tree. */
export const RECENT_MS = 45_000;
const POLL_AGENT_MS = 900;
const POLL_IDLE_MS = 2500;

/** Lines that differ between two versions: the span between the common start and end. */
export function changedLines(before: string, after: string): { from: number; to: number } | undefined {
  if (before === after) return undefined;
  const a = before.split("\n");
  const b = after.split("\n");
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length - 1;
  let endB = b.length - 1;
  while (endA >= start && endB >= start && a[endA] === b[endB]) {
    endA--;
    endB--;
  }
  // Pure deletion: flash the line where the text used to be.
  return { from: start + 1, to: Math.max(start + 1, endB + 1) };
}

function readBool(key: string, fallback: boolean) {
  try {
    const value = localStorage.getItem(key);
    return value == null ? fallback : value === "true";
  } catch {
    return fallback;
  }
}

export function useStoredBool(key: string, fallback: boolean) {
  const [value, setValue] = useState(() => readBool(key, fallback));
  const set = useCallback(
    (next: boolean) => {
      setValue(next);
      try {
        localStorage.setItem(key, String(next));
      } catch {
        // Lasts for this session only.
      }
    },
    [key],
  );
  return [value, set] as const;
}

/**
 * Open tabs per project, kept while the app runs: sending the first message
 * moves a new chat to its own page, and the tabs should come along.
 */
const tabCache = new Map<string, { files: OpenFile[]; active?: string }>();

/**
 * A project folder as the editor sees it: the file tree (polled, so the
 * agent's edits show up live), open files with unsaved edits, and which
 * files changed a moment ago.
 */
export function useCodeWorkspace(root: string | undefined, agentRunning: boolean) {
  const [entries, setEntries] = useState<CodeEntry[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [scanError, setScanError] = useState<string>();
  const [scanned, setScanned] = useState(false);
  const [files, setFiles] = useState<OpenFile[]>(() => (root && tabCache.get(root)?.files) || []);
  const [active, setActive] = useState<string | undefined>(() => (root ? tabCache.get(root)?.active : undefined));
  /** The project `files` belong to; differs from `root` for one render after a switch. */
  const ownerRef = useRef(root);
  /** rel → when it last changed on disk (while the editor was open). */
  const [recent, setRecent] = useState<Record<string, number>>({});
  const [follow, setFollow] = useStoredBool("code_follow_agent", true);

  const filesRef = useRef(files);
  filesRef.current = files;
  const agentRef = useRef(agentRunning);
  agentRef.current = agentRunning;
  const followRef = useRef(follow);
  followRef.current = follow;

  const patch = useCallback((rel: string, fn: (file: OpenFile) => OpenFile) => {
    setFiles((prev) => prev.map((f) => (f.rel === rel ? fn(f) : f)));
  }, []);

  /** Read `rel` from disk into its tab. Unsaved edits are kept unless `force`. */
  const load = useCallback(
    async (rel: string, force = false) => {
      if (!root) return;
      try {
        const file = await codeApi.read(root, rel);
        patch(rel, (f) => {
          const status: OpenFile["status"] = file.binary ? "binary" : file.tooLarge ? "too-large" : "ready";
          const text = file.text ?? "";
          if (f.status === "loading" || force || !isDirty(f)) {
            const range = f.status === "ready" && !force ? changedLines(f.saved, text) : undefined;
            return {
              ...f,
              text,
              saved: text,
              mtime: file.mtime,
              status,
              error: undefined,
              conflict: false,
              deleted: false,
              flash: range ? { ...range, at: Date.now() } : f.flash,
            };
          }
          return text === f.saved ? { ...f, mtime: file.mtime } : { ...f, conflict: true, deleted: false };
        });
      } catch (error) {
        patch(rel, (f) => ({ ...f, status: f.status === "loading" ? "error" : f.status, error: String(error) }));
      }
    },
    [root, patch],
  );

  const open = useCallback(
    (rel: string) => {
      setActive(rel);
      if (filesRef.current.some((f) => f.rel === rel)) return;
      setFiles((prev) => [...prev, { rel, text: "", saved: "", mtime: 0, status: "loading" }]);
      void load(rel);
    },
    [load],
  );

  const close = useCallback((rel: string) => {
    const index = filesRef.current.findIndex((f) => f.rel === rel);
    const rest = filesRef.current.filter((f) => f.rel !== rel);
    setFiles((prev) => prev.filter((f) => f.rel !== rel));
    setActive((current) => (current === rel ? rest[Math.min(index, rest.length - 1)]?.rel : current));
  }, []);

  const edit = useCallback((rel: string, text: string) => patch(rel, (f) => ({ ...f, text })), [patch]);

  /** Save one file. With `overwrite`, replaces a version changed on disk. */
  const save = useCallback(
    async (rel: string, overwrite = false): Promise<boolean> => {
      const file = filesRef.current.find((f) => f.rel === rel);
      if (!root || !file || file.status !== "ready") return false;
      try {
        const mtime = await codeApi.write(root, rel, file.text, overwrite || file.deleted ? undefined : file.mtime);
        patch(rel, (f) => ({ ...f, saved: file.text, mtime, conflict: false, deleted: false, error: undefined }));
        return true;
      } catch (error) {
        if (isConflict(error)) patch(rel, (f) => ({ ...f, conflict: true }));
        else patch(rel, (f) => ({ ...f, error: String(error) }));
        return false;
      }
    },
    [root, patch],
  );

  /** Save every file with edits that can be saved safely; true if all went. */
  const saveAll = useCallback(async () => {
    const dirty = filesRef.current.filter((f) => isDirty(f) && !f.conflict);
    const results = await Promise.all(dirty.map((f) => save(f.rel)));
    return results.every(Boolean);
  }, [save]);

  // Declared before the reset below, so a switch saves the old project's tabs under its own name.
  useEffect(() => {
    if (ownerRef.current) tabCache.set(ownerRef.current, { files, active });
  }, [files, active]);

  // Switch to another project's tabs.
  useEffect(() => {
    if (ownerRef.current !== root) {
      const saved = root ? tabCache.get(root) : undefined;
      ownerRef.current = root;
      setFiles(saved?.files ?? []);
      setActive(saved?.active);
    }
    // Tabs kept from before may be stale (or were still loading); unsaved edits stay.
    for (const file of (root ? tabCache.get(root)?.files : undefined) ?? []) void load(file.rel);
    setEntries([]);
    setRecent({});
    setScanned(false);
    setScanError(undefined);
  }, [root, load]);

  // Poll the tree; quicker while the agent works so its edits show at once.
  useEffect(() => {
    if (!root) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let known: Map<string, CodeEntry> | undefined;

    const tick = async () => {
      if (!document.hidden) {
        try {
          const result = await codeApi.scan(root);
          if (cancelled) return;
          const next = new Map(result.entries.map((e) => [e.rel, e]));
          const touched: string[] = [];
          const removed: string[] = [];
          let listChanged = !known || known.size !== next.size;
          if (known) {
            for (const [rel, entry] of next) {
              const before = known.get(rel);
              if (!before) listChanged = true;
              if (!entry.dir && (!before || before.mtime !== entry.mtime)) touched.push(rel);
            }
            for (const rel of known.keys()) if (!next.has(rel)) removed.push(rel);
          }
          known = next;
          if (listChanged || touched.length || removed.length) {
            setEntries(result.entries);
            setTruncated(result.truncated);
          }
          setScanned(true);
          setScanError(undefined);

          if (touched.length) {
            const now = Date.now();
            setRecent((prev) => {
              const out: Record<string, number> = {};
              for (const [rel, at] of Object.entries(prev)) if (now - at < RECENT_MS && next.has(rel)) out[rel] = at;
              for (const rel of touched) out[rel] = now;
              return out;
            });
            const openRels = new Set(filesRef.current.map((f) => f.rel));
            for (const rel of touched) if (openRels.has(rel)) void load(rel);
            // Follow the agent: show the file it is writing right now.
            if (agentRef.current && followRef.current) {
              const target = touched[touched.length - 1];
              if (!openRels.has(target)) {
                setFiles((prev) => [...prev, { rel: target, text: "", saved: "", mtime: 0, status: "loading" }]);
                void load(target);
              }
              setActive(target);
            }
          }
          if (removed.length) {
            const gone = new Set(removed);
            setFiles((prev) => prev.map((f) => (gone.has(f.rel) ? { ...f, deleted: true } : f)));
          }
        } catch (error) {
          if (!cancelled) setScanError(String(error));
        }
      }
      if (!cancelled) timer = setTimeout(tick, agentRef.current ? POLL_AGENT_MS : POLL_IDLE_MS);
    };
    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [root, load]);

  const rename = useCallback(
    async (rel: string, newRel: string) => {
      if (!root) return;
      await codeApi.rename(root, rel, newRel);
      const prefix = `${rel}/`;
      setFiles((prev) =>
        prev.map((f) => {
          if (f.rel === rel) return { ...f, rel: newRel };
          if (f.rel.startsWith(prefix)) return { ...f, rel: newRel + f.rel.slice(rel.length) };
          return f;
        }),
      );
      setActive((current) => {
        if (current === rel) return newRel;
        if (current?.startsWith(prefix)) return newRel + current.slice(rel.length);
        return current;
      });
    },
    [root],
  );

  const remove = useCallback(
    async (rel: string) => {
      if (!root) return;
      await codeApi.delete(root, rel);
      const prefix = `${rel}/`;
      setFiles((prev) => prev.filter((f) => f.rel !== rel && !f.rel.startsWith(prefix)));
      setActive((current) => (current === rel || current?.startsWith(prefix) ? undefined : current));
    },
    [root],
  );

  return {
    entries,
    truncated,
    scanned,
    scanError,
    files,
    active,
    setActive,
    recent,
    follow,
    setFollow,
    open,
    close,
    edit,
    save,
    saveAll,
    rename,
    remove,
    reload: (rel: string) => load(rel, true),
  };
}

export type CodeWorkspace = ReturnType<typeof useCodeWorkspace>;
