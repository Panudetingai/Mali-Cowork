import { ConfirmDialog, type ConfirmRequest } from "@/components/app/confirm-dialog";
import { cn } from "@/lib/utils";
import { CheckCircle2Icon, LoaderIcon, TriangleAlertIcon, XIcon } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { gitApi } from "./api";
import type { ChangedFile, GitStatus } from "./types";
import { useGitStatus } from "./use-git-status";

export type GitTab = "changes" | "commits" | "branches";

type Notice = { kind: "ok" | "error"; text: string };

type GitContextValue = {
  folder: string;
  /** Undefined until the first status arrives. */
  status?: GitStatus;
  /** Changed files with line counts; follows `status`. */
  changes: ChangedFile[];
  refresh: () => Promise<void>;
  /** Label of the action in progress. */
  busy?: string;
  /** Bumped after every action, so views reload what they show. */
  version: number;
  /** Run a git action: shows progress, then its message or error, then refreshes. */
  act: (label: string, work: () => Promise<string | void>) => Promise<void>;
  confirm: (request: ConfirmRequest) => void;
  panel: { open: boolean; tab: GitTab; wide: boolean };
  openPanel: (tab?: GitTab) => void;
  closePanel: () => void;
  setTab: (tab: GitTab) => void;
  toggleWide: () => void;
  agentRunning: boolean;
};

const GitContext = createContext<GitContextValue | null>(null);

export function useGit() {
  const value = useContext(GitContext);
  if (!value) throw new Error("useGit outside GitProvider");
  return value;
}

/** The Git state of a folder, or undefined outside a repository. */
export function useGitRepo() {
  const value = useContext(GitContext);
  return value?.status?.isRepo ? value : undefined;
}

const PANEL_KEY = "mali_git_panel";

function loadPanel(): GitContextValue["panel"] {
  try {
    const saved = JSON.parse(localStorage.getItem(PANEL_KEY) ?? "{}");
    return { open: !!saved.open, tab: saved.tab ?? "changes", wide: !!saved.wide };
  } catch {
    return { open: false, tab: "changes", wide: false };
  }
}

/** Git for one folder, shared by the side panel and the bar above the composer. */
export function GitProvider({
  folder,
  agentRunning,
  children,
}: {
  folder: string;
  agentRunning: boolean;
  children: ReactNode;
}) {
  const [panel, setPanelState] = useState(loadPanel);
  const { status, refresh } = useGitStatus(folder, { poll: panel.open });
  const [changes, setChanges] = useState<ChangedFile[]>([]);
  const [busy, setBusy] = useState<string>();
  const [notice, setNotice] = useState<Notice>();
  const [confirmRequest, setConfirmRequest] = useState<ConfirmRequest>();
  const [version, setVersion] = useState(0);

  const setPanel = useCallback((fn: (p: GitContextValue["panel"]) => GitContextValue["panel"]) => {
    setPanelState((prev) => {
      const next = fn(prev);
      try {
        localStorage.setItem(PANEL_KEY, JSON.stringify(next));
      } catch {
        // Not remembered; fine.
      }
      return next;
    });
  }, []);

  // Line counts only when the set of changes differs, not on every poll.
  const signature = status?.isRepo
    ? status.files.map((f) => `${f.path}:${f.staged ?? ""}${f.unstaged ?? ""}`).join("|")
    : "";
  useEffect(() => {
    if (!status?.isRepo) {
      setChanges([]);
      return;
    }
    let cancelled = false;
    gitApi
      .changes(folder)
      .then((list) => !cancelled && setChanges(list))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
    // `version` too: an edit keeps the signature but changes the counts.
  }, [folder, signature, version, status?.isRepo]);

  // The agent just finished: show its edits at once.
  const [wasRunning, setWasRunning] = useState(agentRunning);
  useEffect(() => {
    if (wasRunning && !agentRunning) {
      void refresh();
      setVersion((v) => v + 1);
    }
    setWasRunning(agentRunning);
  }, [agentRunning, wasRunning, refresh]);

  useEffect(() => {
    if (notice?.kind !== "ok") return;
    const timer = window.setTimeout(() => setNotice(undefined), 4000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const act = useCallback(
    async (label: string, work: () => Promise<string | void>) => {
      setBusy(label);
      setNotice(undefined);
      try {
        const message = await work();
        if (message) setNotice({ kind: "ok", text: message });
      } catch (e) {
        setNotice({ kind: "error", text: String(e) });
      } finally {
        setBusy(undefined);
        setVersion((v) => v + 1);
        await refresh();
      }
    },
    [refresh],
  );

  const value = useMemo<GitContextValue>(
    () => ({
      folder,
      status,
      changes,
      refresh,
      busy,
      version,
      act,
      confirm: setConfirmRequest,
      panel,
      openPanel: (tab) => setPanel((p) => ({ ...p, open: true, tab: tab ?? p.tab })),
      closePanel: () => setPanel((p) => ({ ...p, open: false })),
      setTab: (tab) => setPanel((p) => ({ ...p, tab })),
      toggleWide: () => setPanel((p) => ({ ...p, wide: !p.wide })),
      agentRunning,
    }),
    [folder, status, changes, refresh, busy, version, act, panel, setPanel, agentRunning],
  );

  return (
    <GitContext.Provider value={value}>
      {children}
      <ConfirmDialog request={confirmRequest} onClose={() => setConfirmRequest(undefined)} />
      {(busy || notice) && (
        <div
          role="status"
          className={cn(
            "fixed right-4 bottom-4 z-50 flex max-w-sm items-start gap-2 rounded-xl border bg-popover px-3 py-2 text-xs shadow-lg",
            notice?.kind === "error" && !busy && "border-red-300 text-red-700 dark:border-red-900 dark:text-red-300",
          )}
        >
          {busy ? (
            <>
              <LoaderIcon className="mt-0.5 size-3.5 shrink-0 animate-spin" />
              <span className="text-muted-foreground">{busy}</span>
            </>
          ) : notice?.kind === "ok" ? (
            <>
              <CheckCircle2Icon className="mt-0.5 size-3.5 shrink-0 text-emerald-500" />
              <span className="min-w-0 truncate">{notice.text}</span>
            </>
          ) : (
            <>
              <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0" />
              <span className="min-w-0 flex-1 whitespace-pre-wrap break-words">{notice?.text}</span>
              <button type="button" onClick={() => setNotice(undefined)} aria-label="Dismiss">
                <XIcon className="size-3.5" />
              </button>
            </>
          )}
        </div>
      )}
    </GitContext.Provider>
  );
}
