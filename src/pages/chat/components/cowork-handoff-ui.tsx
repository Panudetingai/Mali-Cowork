"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { getChat, updateChat, useChatSessions } from "@/features/chat-history";
import { loadOpencodeSettings } from "@/features/opencode";
import { folderName, normalizeFolder } from "@/features/workspace";
import { cn } from "@/lib/utils";
import { open } from "@tauri-apps/plugin-dialog";
import { ArrowRightIcon, FolderIcon, SparklesIcon, XIcon } from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useState } from "react";
import {
  closeMoveToCowork,
  coworkResend,
  lastRequestOf,
  moveChatToCowork,
  requestMoveToCowork,
  useMoveToCoworkRequest,
} from "../move-to-cowork";

/**
 * Under a Chat-mode reply that needs files: move this chat to Cowork. `quiet`
 * is the one-line form, for when the model didn't ask for it itself.
 */
export function CoworkSuggestionCard({
  chatId,
  messageId,
  task,
  quiet,
}: {
  chatId: string;
  messageId: string;
  task?: string;
  quiet?: boolean;
}) {
  const dismiss = () => updateChat(chatId, (s) => ({ ...s, coworkHintDismissed: messageId }));
  const move = () => requestMoveToCowork({ chatId, task });

  if (quiet) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, delay: 0.1 }}
        className="mt-1 flex items-center gap-2 text-xs text-muted-foreground"
      >
        <SparklesIcon className="size-3.5 shrink-0 text-amber-500" />
        <span>Want Mali to do this in a folder?</span>
        <button type="button" onClick={move} className="inline-flex items-center gap-0.5 font-medium text-foreground hover:underline">
          Continue in Cowork <ArrowRightIcon className="size-3" />
        </button>
        <button type="button" onClick={dismiss} aria-label="Dismiss" className="ml-1 rounded p-0.5 hover:text-foreground">
          <XIcon className="size-3" />
        </button>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8, scale: 0.99 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1], delay: 0.1 }}
      className="mt-3 flex flex-col gap-3 rounded-2xl bg-amber-500/[0.07] p-4 ring-1 ring-amber-500/20 sm:flex-row sm:items-center"
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-amber-500/15 text-amber-600 dark:text-amber-400">
        <SparklesIcon className="size-4" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="text-sm font-medium">{task ? `Cowork can do this: ${task}` : "This needs Cowork"}</p>
        <p className="text-xs leading-relaxed text-muted-foreground">
          Cowork works in a folder you choose — it can create and edit files there. This conversation comes along.
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <Button variant="ghost" size="sm" className="h-8 text-xs text-muted-foreground" onClick={dismiss}>
          Not now
        </Button>
        <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={move}>
          Continue in Cowork
          <ArrowRightIcon className="size-3.5" />
        </Button>
      </div>
    </motion.div>
  );
}

/** Where a chat moved from Chat to Cowork. */
export function MovedToCoworkDivider({ folder }: { folder: string }) {
  return (
    <div className="my-2 flex items-center gap-3 text-[11px] text-muted-foreground" role="separator">
      <span className="h-px flex-1 bg-border" />
      <span className="inline-flex items-center gap-1.5">
        <SparklesIcon className="size-3 text-amber-500" />
        Moved to Cowork · working in
        <span className="inline-flex items-center gap-1 font-medium text-foreground" title={folder}>
          <FolderIcon className="size-3" />
          {folderName(folder)}
        </span>
      </span>
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}

const REFUSALS: Record<string, string> = {
  running: "A reply is still being written. Wait for it to finish, then move.",
  "no-access": "Cowork needs access to this folder. Allow it, or choose another folder.",
  gone: "This chat no longer exists.",
};

/** Confirm the move: which folder, and whether to start on the last request now. */
export function MoveToCoworkDialog({ onNewCoworkChat }: { onNewCoworkChat: () => void }) {
  const request = useMoveToCoworkRequest();
  useChatSessions(); // re-read the chat when it changes
  const chat = request ? getChat(request.chatId) : undefined;
  const [folder, setFolder] = useState("");
  const [runLast, setRunLast] = useState(true);
  const [moving, setMoving] = useState(false);
  const [problem, setProblem] = useState<string>();

  useEffect(() => {
    if (!request) return;
    setFolder(normalizeFolder(loadOpencodeSettings().cwd || ""));
    setRunLast(true);
    setMoving(false);
    setProblem(undefined);
  }, [request]);

  const last = chat ? lastRequestOf(chat.messages) : undefined;
  const resend = request ? coworkResend() : undefined;

  const pick = async () => {
    const picked = await open({
      directory: true,
      multiple: false,
      defaultPath: folder || undefined,
      title: "Choose the folder Cowork works in",
    });
    if (typeof picked === "string" && picked) setFolder(normalizeFolder(picked));
  };

  const confirm = async () => {
    if (!request || !folder) return;
    setMoving(true);
    setProblem(undefined);
    const result = await moveChatToCowork(request.chatId, folder, { runLast: runLast && !!last && !!resend }).catch(
      (error) => String(error),
    );
    setMoving(false);
    if (result === true || result === "already-cowork") {
      closeMoveToCowork();
      return;
    }
    setProblem(REFUSALS[result] ?? result);
  };

  return (
    <Dialog open={!!request} onOpenChange={(value) => !value && !moving && closeMoveToCowork()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <SparklesIcon className="size-4 text-amber-500" />
            Continue in Cowork
          </DialogTitle>
          <DialogDescription>
            This chat switches to Cowork and keeps everything said so far. Cowork can read, create and edit files in
            the folder you choose.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-3 rounded-xl bg-muted/50 px-3 py-2.5">
            <FolderIcon className="size-4 shrink-0 text-muted-foreground" />
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-sm font-medium">{folder ? folderName(folder) : "No folder chosen"}</span>
              {folder && (
                <span className="truncate text-[11px] text-muted-foreground" title={folder}>
                  {folder}
                </span>
              )}
            </div>
            <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => void pick()}>
              {folder ? "Change…" : "Choose…"}
            </Button>
          </div>

          {last && (
            <label
              className={cn(
                "flex cursor-pointer items-start gap-3 rounded-xl px-3 py-2.5 transition-colors hover:bg-muted/40",
                !resend && "cursor-not-allowed opacity-60",
              )}
            >
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-sm">Start on my last request right away</span>
                <span className="line-clamp-2 text-xs text-muted-foreground">
                  {request?.task ?? `“${last.content.trim()}”`}
                </span>
                {resend && (
                  <span className="text-[11px] text-muted-foreground/80">Runs on {resend.modelName}</span>
                )}
                {!resend && (
                  <span className="text-[11px] text-amber-700 dark:text-amber-400">
                    Pick a Cowork model first — the one selected can't work in folders.
                  </span>
                )}
              </div>
              <Switch checked={runLast && !!resend} disabled={!resend} onCheckedChange={setRunLast} />
            </label>
          )}
        </div>

        {problem && (
          <p role="alert" className="rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-700 dark:text-red-400">
            {problem}
          </p>
        )}

        <DialogFooter className="items-center gap-2 sm:justify-between">
          {request?.fromSwitch ? (
            <button
              type="button"
              className="text-xs text-muted-foreground hover:text-foreground hover:underline"
              onClick={() => {
                closeMoveToCowork();
                onNewCoworkChat();
              }}
            >
              Start a new Cowork chat instead
            </button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="ghost" onClick={closeMoveToCowork} disabled={moving}>
              Cancel
            </Button>
            <Button onClick={() => void confirm()} disabled={!folder || moving}>
              {moving ? "Moving…" : "Move to Cowork"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
