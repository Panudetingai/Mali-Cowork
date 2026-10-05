import { isTauri } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { gitApi } from "./api";
import type { GitStatus } from "./types";

/** How often the status refreshes while the panel is open and visible. */
const POLL_MS = 15_000;

/**
 * Git status of `folder`, refreshed when the folder changes, when the
 * window gets focus, and every [`POLL_MS`] while `poll` is on. Git runs only
 * on those events, never in a tight loop.
 */
export function useGitStatus(folder: string | undefined, { poll }: { poll: boolean }) {
  const [status, setStatus] = useState<GitStatus>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);
  // Only the latest request may update the state.
  const latest = useRef(0);
  const reading = useRef<Reading | undefined>(undefined);

  const read = useCallback(async () => {
    if (!folder) return;
    const id = ++latest.current;
    setLoading(true);
    try {
      const next = await gitApi.status(folder);
      if (id === latest.current) {
        setStatus(next);
        setError(undefined);
      }
    } catch (e) {
      if (id === latest.current) setError(String(e));
    } finally {
      if (id === latest.current) setLoading(false);
    }
  }, [folder]);

  /**
   * One `git status` per folder at a time. On a big repo or a slow Windows
   * disk a read can outlast [`POLL_MS`], and starting another on every tick
   * and focus piled up git processes (~130 MB each). Calls made while one
   * runs share a single read after it, so each still sees fresh status.
   */
  const refresh = useCallback((): Promise<void> => {
    if (!folder || !isTauri()) return Promise.resolve();
    const run = (slot: Reading): Promise<void> => {
      const done: Promise<void> = read().finally(() => {
        if (reading.current === slot && slot.current === done && !slot.next) reading.current = undefined;
      });
      slot.current = done;
      return done;
    };
    const slot = reading.current;
    if (slot?.folder === folder) {
      slot.next ??= slot.current.then(() => {
        slot.next = undefined;
        return run(slot);
      });
      return slot.next;
    }
    const fresh: Reading = { folder, current: Promise.resolve() };
    reading.current = fresh;
    return run(fresh);
  }, [folder, read]);

  useEffect(() => {
    setStatus(undefined);
    setError(undefined);
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);

  useEffect(() => {
    if (!poll) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [poll, refresh]);

  return { status, error, loading, refresh };
}

/** The status read running for a folder, and the one queued after it. */
type Reading = { folder: string; current: Promise<void>; next?: Promise<void> };

export type GitStatusState = ReturnType<typeof useGitStatus>;
