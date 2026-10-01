/**
 * Asking in the notch: the Quick bar's engine (`runQuickPrompt`, Chat mode,
 * the Quick bar's model) with the notch's own thread. Whether the thread is
 * kept as a chat follows Settings → "Save notch chats"; the main window
 * stores it (`saveQuickThread`), as it does for the Quick bar.
 */
import type { Attachment } from "@/features/attachments";
import { importAttachment, saveAttachment } from "@/features/attachments";
import {
  quickModelId,
  runQuickPrompt,
  saveQuickThread,
  type QuickRequest,
  type QuickThread,
  type QuickTurn,
} from "@/features/quick";
import { useCallback, useEffect, useRef, useState } from "react";
import { isNotchSaveChats } from "./settings";
import { askAs, type RosterBot } from "./team";

const MAX_FILES = 10;

export type NotchChat = ReturnType<typeof useNotchChat>;

/** `seed` is for the dev preview's sample thread. */
export function useNotchChat(seed: QuickTurn[] = []) {
  const [turns, setTurns] = useState<QuickTurn[]>(seed);
  const [files, setFiles] = useState<Attachment[]>([]);
  const [importing, setImporting] = useState(0);
  const [note, setNote] = useState<string>();
  const [chatId, setChatId] = useState(() => crypto.randomUUID());
  /** Which team bot answered each turn; Mali's own turns aren't listed. */
  const [answeredBy, setAnsweredBy] = useState<Record<string, RosterBot>>({});
  const thread = useRef<QuickThread>({ history: [] });
  const abortRef = useRef<AbortController | null>(null);
  const streaming = turns.at(-1)?.status === "streaming";

  const updateLast = (fn: (turn: QuickTurn) => QuickTurn) =>
    setTurns((prev) => (prev.length ? [...prev.slice(0, -1), fn(prev[prev.length - 1])] : prev));

  /** Dropped paths (Finder / Explorer), picked paths, or pasted files. */
  const addFiles = useCallback(async (sources: (string | File)[]) => {
    const accepted = sources.slice(0, MAX_FILES);
    if (sources.length > MAX_FILES) setNote(`แนบได้สูงสุด ${MAX_FILES} ไฟล์ต่อครั้ง`);
    setImporting((n) => n + accepted.length);
    await Promise.all(
      accepted.map(async (source) => {
        try {
          const file = typeof source === "string" ? await importAttachment(source) : await saveAttachment(source);
          setFiles((prev) => (prev.length >= MAX_FILES ? prev : [...prev, file]));
        } catch (error) {
          setNote(error instanceof Error ? error.message : String(error));
        } finally {
          setImporting((n) => n - 1);
        }
      }),
    );
  }, []);

  const removeFile = (id: string) => setFiles((prev) => prev.filter((f) => f.id !== id));

  /** A file that's already in the app's folder (a capture), added as it is. */
  const attach = (file: Attachment) =>
    setFiles((prev) => (prev.length >= MAX_FILES ? prev : [...prev.filter((f) => f.id !== file.id), file]));

  /** Hand the attached files to work done elsewhere (in a folder), clearing them here. */
  const takeFiles = () => {
    const taken = files;
    setFiles([]);
    return taken;
  };

  /**
   * `bot`: ask that team bot directly instead of Mali. `modelId`: answer
   * with this model (else the bot's, else the Quick bar's).
   */
  const send = async (text: string, { bot, modelId }: { bot?: RosterBot; modelId?: string } = {}) => {
    const typed = text.trim();
    if (streaming || importing > 0 || (!typed && files.length === 0)) return false;
    const persona = bot ? askAs(bot) : undefined;
    const request: QuickRequest = {
      prompt: typed,
      attachments: files,
      action: persona?.action,
      modelId: modelId ?? persona?.modelId,
    };
    const id = crypto.randomUUID();
    if (bot) setAnsweredBy((prev) => ({ ...prev, [id]: bot }));
    setTurns((prev) => [
      ...prev,
      {
        id,
        display: typed || "ช่วยดูไฟล์ที่แนบนี้ให้หน่อย",
        request,
        answer: "",
        status: "streaming",
        modelId: quickModelId(request),
      },
    ]);
    setFiles([]);
    setNote(undefined);
    const controller = new AbortController();
    abortRef.current = controller;
    const { sessionId } = await runQuickPrompt(
      request,
      (event) => {
        if (event.type === "text") updateLast((t) => ({ ...t, answer: t.answer + event.delta }));
        else if (event.type === "done") updateLast((t) => ({ ...t, status: "done" }));
        else updateLast((t) => ({ ...t, status: "error", error: event.message, errorFix: event.fix }));
      },
      { signal: controller.signal, thread: thread.current },
    );
    if (controller.signal.aborted) updateLast((t) => (t.status === "streaming" ? { ...t, status: "stopped" } : t));
    controller.abort();
    thread.current = { sessionId, history: thread.current.history };
    return true;
  };

  const stop = () => abortRef.current?.abort();

  /** A fresh thread; the old one stays in history if it was saved. */
  const reset = () => {
    stop();
    setTurns([]);
    setFiles([]);
    setNote(undefined);
    setAnsweredBy({});
    setChatId(crypto.randomUUID());
    thread.current = { history: [] };
  };

  // Record finished exchanges for providers without a session, and keep the
  // thread as a chat when that's on.
  useEffect(() => {
    const done = turns.filter((t) => t.status === "done");
    if (done.length === 0 || streaming) return;
    thread.current.history = done.flatMap((t) => [
      { role: "user" as const, content: t.display },
      { role: "assistant" as const, content: t.answer },
    ]);
    if (isNotchSaveChats()) void saveQuickThread({ chatId, turns: done, open: false }).catch(() => undefined);
  }, [turns, streaming, chatId]);

  /** The chat in the main window, if it was kept; undefined when there's nothing to open. */
  const savedChatId = () => (isNotchSaveChats() && turns.some((t) => t.status === "done") ? chatId : undefined);

  return {
    turns,
    answeredBy,
    files,
    importing,
    note,
    streaming,
    addFiles,
    attach,
    removeFile,
    takeFiles,
    send,
    stop,
    reset,
    savedChatId,
    setNote,
  };
}
