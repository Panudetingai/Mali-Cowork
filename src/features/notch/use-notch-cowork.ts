/**
 * Working in a folder from the notch. The main window runs it, as a Cowork
 * task (checkpoint, Files changed, Undo, the folder-access question), and the
 * relay sends its progress here; this keeps the notch's side of the thread:
 * what was asked, and what each answer came to.
 */
import type { Attachment } from "@/features/attachments";
import { useEffect, useRef, useState } from "react";
import { requestCowork, requestStop } from "./bridge";
import type { NotchEdit, NotchPhase, NotchShowcase, NotchSnapshot, NotchStep } from "./types";

export type CoworkTurn = {
  id: string;
  prompt: string;
  folder: string;
  files: Attachment[];
  /** Waiting for the folder question, waiting for the folder, at work, or ended (or stopped). */
  status: "starting" | "queued" | "running" | "done" | "error" | "stopped";
  /** Its Inbox task, when it went through the queue. */
  taskId?: string;
  error?: string;
  /** The chat it runs in, once the main window says. */
  chatId?: string;
  /** The last progress heard for it. */
  steps: NotchStep[];
  reply?: string;
  phase?: NotchPhase;
  changed?: number;
  /** What it made, to preview under the answer; grows as pages arrive. */
  showcase?: NotchShowcase[];
  /** Files it wrote, with a few lines of each diff. */
  edits?: NotchEdit[];
  /** It ended on an error (the run's own, not the notch's). */
  failed?: string;
  /** When it finished: an answer that lands whole with the finish still writes itself out. */
  endedAt?: number;
};

export function useNotchCowork(snapshot: NotchSnapshot | null) {
  const [turns, setTurns] = useState<CoworkTurn[]>([]);
  const update = (id: string, fn: (turn: CoworkTurn) => CoworkTurn) =>
    setTurns((prev) => prev.map((t) => (t.id === id ? fn(t) : t)));

  // Progress for the turn the relay is following.
  useEffect(() => {
    const key = snapshot?.taskId;
    if (!snapshot || !key) return;
    update(key, (t) => ({
      ...t,
      chatId: snapshot.chatId,
      // A stopped turn stays stopped, whatever the run says on its way out.
      status: t.status === "stopped" ? "stopped" : snapshot.phase === "done" ? "done" : "running",
      endedAt: snapshot.phase === "done" ? (t.endedAt ?? Date.now()) : undefined,
      phase: snapshot.phase,
      steps: snapshot.steps.length ? snapshot.steps : t.steps,
      reply: snapshot.reply ?? t.reply,
      changed: snapshot.changed ?? t.changed,
      showcase: snapshot.showcase ?? t.showcase,
      edits: snapshot.edits ?? t.edits,
      failed: snapshot.phase === "done" ? snapshot.failed : undefined,
    }));
  }, [snapshot]);

  const turnsRef = useRef(turns);
  turnsRef.current = turns;

  const running = turns.some((t) => t.status === "starting" || t.status === "queued" || t.status === "running");

  /**
   * `session`: continue that chat as it is (picked from the notch's list);
   * otherwise work in `folder`, following up this thread's last chat there.
   */
  const send = async (
    prompt: string,
    {
      folder,
      modelId,
      files,
      session,
    }: { folder: string; modelId?: string; files: Attachment[]; session?: string },
  ) => {
    const id = crypto.randomUUID();
    const earlier = turnsRef.current.filter((t) => t.folder === folder);
    const previous = earlier.at(-1);
    if (session) {
      setTurns((prev) => [...prev, { id, prompt, folder, files, status: "starting", steps: [], chatId: session }]);
      const answer = await requestCowork({ id, prompt, folder, modelId, attachments: files, chatId: session, session: true });
      if (answer.error) update(id, (t) => ({ ...t, status: "error", error: answer.error }));
      else update(id, (t) => ({ ...t, status: t.status === "starting" ? "running" : t.status }));
      return;
    }
    setTurns((prev) => [...prev, { id, prompt, folder, files, status: "starting", steps: [] }]);
    const answer = await requestCowork({
      id,
      prompt,
      folder,
      modelId,
      attachments: files,
      // A follow-up continues its chat; if that chat is gone, it takes the conversation along.
      chatId: previous?.chatId,
      context: previous?.chatId ? undefined : conversationOf(earlier),
    });
    if (answer.error) update(id, (t) => ({ ...t, status: "error", error: answer.error }));
    else
      update(id, (t) => ({
        ...t,
        chatId: answer.chatId ?? t.chatId,
        taskId: answer.taskId,
        status: t.status === "starting" ? (answer.taskId ? "queued" : "running") : t.status,
      }));
  };

  const reset = () => setTurns([]);

  /** Stop the turn at work (or drop it from the queue); the app keeps what it did. */
  const stop = () => {
    const turn = turnsRef.current.filter((t) => t.status === "queued" || t.status === "running").at(-1);
    if (!turn || (!turn.taskId && !turn.chatId)) return;
    update(turn.id, (t) => ({ ...t, status: "stopped" }));
    void requestStop({ taskId: turn.taskId, chatId: turn.chatId }).catch(() => undefined);
  };

  /** The chat to open in the app: the latest one this thread ran in. */
  const chatId = turns.filter((t) => t.chatId).at(-1)?.chatId;

  return { turns, running, send, reset, stop, chatId };
}

function conversationOf(turns: CoworkTurn[]) {
  const lines = turns
    .filter((t) => t.reply)
    .map((t) => `User: ${t.prompt}\n\nAssistant: ${t.reply}`);
  return lines.length ? `\n\nEarlier in this conversation (from the notch):\n\n${lines.join("\n\n")}` : undefined;
}
