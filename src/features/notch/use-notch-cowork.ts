/**
 * Working in a folder from the notch. The main window runs it, as a Cowork
 * task (checkpoint, Files changed, Undo, the folder-access question), and the
 * relay sends its progress here; this keeps the notch's side of the thread:
 * what was asked, and what each answer came to.
 */
import type { Attachment } from "@/features/attachments";
import { useEffect, useRef, useState } from "react";
import { requestCowork } from "./bridge";
import type { NotchPhase, NotchSnapshot, NotchStep } from "./types";

export type CoworkTurn = {
  id: string;
  prompt: string;
  folder: string;
  files: Attachment[];
  /** Waiting for the folder question, waiting for the folder, at work, or ended. */
  status: "starting" | "queued" | "running" | "done" | "error";
  error?: string;
  /** The chat it runs in, once the main window says. */
  chatId?: string;
  /** The last progress heard for it. */
  steps: NotchStep[];
  reply?: string;
  phase?: NotchPhase;
  changed?: number;
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
      status: snapshot.phase === "done" ? "done" : "running",
      phase: snapshot.phase,
      steps: snapshot.steps.length ? snapshot.steps : t.steps,
      reply: snapshot.reply ?? t.reply,
      changed: snapshot.changed ?? t.changed,
    }));
  }, [snapshot]);

  const turnsRef = useRef(turns);
  turnsRef.current = turns;

  const running = turns.some((t) => t.status === "starting" || t.status === "queued" || t.status === "running");

  const send = async (prompt: string, { folder, modelId, files }: { folder: string; modelId?: string; files: Attachment[] }) => {
    const id = crypto.randomUUID();
    const earlier = turnsRef.current.filter((t) => t.folder === folder);
    const previous = earlier.at(-1);
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
    else update(id, (t) => ({ ...t, chatId: answer.chatId ?? t.chatId, status: t.status === "starting" ? (answer.taskId ? "queued" : "running") : t.status }));
  };

  const reset = () => setTurns([]);

  /** The chat to open in the app: the latest one this thread ran in. */
  const chatId = turns.filter((t) => t.chatId).at(-1)?.chatId;

  return { turns, running, send, reset, chatId };
}

function conversationOf(turns: CoworkTurn[]) {
  const lines = turns
    .filter((t) => t.reply)
    .map((t) => `User: ${t.prompt}\n\nAssistant: ${t.reply}`);
  return lines.length ? `\n\nEarlier in this conversation (from the notch):\n\n${lines.join("\n\n")}` : undefined;
}
