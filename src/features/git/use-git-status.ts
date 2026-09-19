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

  const refresh = useCallback(async () => {
    if (!folder || !isTauri()) return;
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

export type GitStatusState = ReturnType<typeof useGitStatus>;
