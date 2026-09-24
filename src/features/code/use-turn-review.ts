"use client";

import { updateChatMessages } from "@/features/chat-history";
import { restoreCheckpointFile, type FileChange, type TurnFiles } from "@/features/checkpoints";
import { isWithin, normalizeFolder } from "@/features/workspace";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { CodeWorkspace } from "./use-code-workspace";

export type ReviewDecision = "kept" | "undone";

export type ReviewFile = FileChange & {
  /** Path inside the project, as the editor names it. */
  rel: string;
  decision?: ReviewDecision;
};

type Target = { chatId: string; messageId: string; turn: TurnFiles };

const storageKey = (checkpointId: string) => `code_review:${checkpointId}`;

function readDecisions(checkpointId: string): Record<string, ReviewDecision> {
  try {
    return JSON.parse(localStorage.getItem(storageKey(checkpointId)) ?? "{}");
  } catch {
    return {};
  }
}

function relativeTo(root: string, path: string) {
  const base = normalizeFolder(root);
  return path.slice(base.length).replace(/\\/g, "/").replace(/^\/+/, "");
}

/**
 * Review what the agent's last turn changed, one file at a time: keep it,
 * undo it (from the turn's checkpoint), or move to the next. Decisions are
 * remembered per turn, so reopening the chat picks up where review stopped.
 */
export function useTurnReview(target: Target | undefined, root: string | undefined, workspace: CodeWorkspace) {
  const checkpointId = target?.turn.checkpointId;
  const [decisions, setDecisions] = useState<Record<string, ReviewDecision>>({});
  const [busy, setBusy] = useState(false);
  /** A file changed again since the turn: undoing it would drop those edits. */
  const [conflict, setConflict] = useState<string[]>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    setDecisions(checkpointId ? readDecisions(checkpointId) : {});
    setConflict(undefined);
    setError(undefined);
  }, [checkpointId]);

  const decide = useCallback(
    (paths: string[], decision: ReviewDecision) => {
      if (!checkpointId || paths.length === 0) return;
      setDecisions((prev) => {
        const next = { ...prev };
        for (const path of paths) next[path] = decision;
        try {
          localStorage.setItem(storageKey(checkpointId), JSON.stringify(next));
        } catch {
          // Lasts for this session only.
        }
        return next;
      });
    },
    [checkpointId],
  );

  const files: ReviewFile[] = useMemo(() => {
    if (!target || !root || target.turn.state !== "applied") return [];
    return target.turn.changes
      .filter((change) => isWithin(change.path, root))
      .map((change) => ({ ...change, rel: relativeTo(root, change.path), decision: decisions[change.path] }));
  }, [target, root, decisions]);

  const pending = files.filter((f) => !f.decision);
  const byRel = useMemo(() => new Map(files.map((f) => [f.rel, f])), [files]);
  const activeFile = workspace.active ? byRel.get(workspace.active) : undefined;
  const current = activeFile && !activeFile.decision ? activeFile : undefined;

  // Every file undone: the turn as a whole reads as undone (Redo in the chat).
  useEffect(() => {
    if (!target || files.length === 0 || target.turn.state !== "applied") return;
    if (files.every((f) => f.decision === "undone")) {
      updateChatMessages(target.chatId, (prev) =>
        prev.map((m) => (m.id === target.messageId && m.turn ? { ...m, turn: { ...m.turn, state: "undone" } } : m)),
      );
    }
  }, [files, target]);

  const go = useCallback(
    (step: 1 | -1) => {
      const list = pending.length ? pending : files;
      if (list.length === 0) return;
      const index = list.findIndex((f) => f.rel === workspace.active);
      const next = list[index < 0 ? (step > 0 ? 0 : list.length - 1) : (index + step + list.length) % list.length];
      workspace.open(next.rel);
    },
    [pending, files, workspace],
  );

  /** After deciding on `rel`, show the next file still waiting. */
  const advance = useCallback(
    (done: string[]) => {
      const rest = pending.filter((f) => !done.includes(f.path));
      if (rest.length === 0) return;
      const index = pending.findIndex((f) => f.rel === workspace.active);
      workspace.open(rest[Math.min(Math.max(index, 0), rest.length - 1)].rel);
    },
    [pending, workspace],
  );

  const keep = useCallback(
    async (file: ReviewFile | undefined = current) => {
      if (!file) return;
      // Manual edits during review only count once saved.
      const open = workspace.files.find((f) => f.rel === file.rel);
      if (open && open.text !== open.saved) await workspace.save(file.rel);
      decide([file.path], "kept");
      advance([file.path]);
    },
    [current, workspace, decide, advance],
  );

  const undoFiles = useCallback(
    async (targets: ReviewFile[], force = false) => {
      if (!checkpointId || targets.length === 0) return;
      setBusy(true);
      setError(undefined);
      try {
        const results = await Promise.all(
          targets.filter((f) => f.restorable).map((f) => restoreCheckpointFile(checkpointId, f.path, "before", force)),
        );
        const conflicts = results.flatMap((r) => r.conflicts);
        const errors = results.flatMap((r) => r.errors);
        if (conflicts.length && !force) {
          setConflict(targets.map((f) => f.path));
          return;
        }
        setConflict(undefined);
        if (errors.length) setError(errors.join("\n"));
        const done = targets.filter((f) => f.restorable && !errors.some((e) => e.startsWith(f.path))).map((f) => f.path);
        decide(done, "undone");
        for (const file of targets) {
          if (!done.includes(file.path)) continue;
          // An added file is gone after undo; otherwise show the old text now.
          if (file.kind === "added") workspace.close(file.rel);
          else if (workspace.files.some((f) => f.rel === file.rel)) void workspace.reload(file.rel);
        }
        advance(done);
      } catch (e) {
        setError(String(e));
      } finally {
        setBusy(false);
      }
    },
    [checkpointId, decide, workspace, advance],
  );

  return {
    active: files.length > 0,
    files,
    pending,
    current,
    checkpointId,
    busy,
    conflict,
    error,
    next: () => go(1),
    prev: () => go(-1),
    keep,
    undo: (file: ReviewFile | undefined = current) => (file ? undoFiles([file]) : Promise.resolve()),
    keepAll: () => {
      decide(
        pending.map((f) => f.path),
        "kept",
      );
      void Promise.all(
        workspace.files.filter((f) => f.text !== f.saved && byRel.get(f.rel)).map((f) => workspace.save(f.rel)),
      );
    },
    undoAll: () => undoFiles(pending),
    /** Undo anyway, dropping edits made since the turn. */
    forceUndo: () =>
      conflict ? undoFiles(files.filter((f) => conflict.includes(f.path)), true) : Promise.resolve(),
    dismissConflict: () => setConflict(undefined),
  };
}

export type TurnReview = ReturnType<typeof useTurnReview>;
