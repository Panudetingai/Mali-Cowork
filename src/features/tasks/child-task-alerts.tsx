/**
 * Above the composer of the chat that started background tasks: whatever one
 * of them is waiting on — a permission or a question — answered right here,
 * so the user doesn't have to go looking for the task that stalled.
 */
import { useChatRuns } from "@/features/chat-history";
import { PermissionPrompt, QuestionPrompt, type PermissionReply } from "@/features/opencode";
import { cn } from "@/lib/utils";
import type { PermissionRequest, QuestionRequest } from "@/pages/chat/api/chat";
import { allowFolderForRun, answerAgentQuestion, replyToPermission } from "@/pages/chat/turn";
import { ArrowUpRightIcon, BellRingIcon, ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useChildTaskRequests } from "./views";

const warn = (error: unknown) => console.warn("[tasks] reply from parent chat failed", error);

/** `chatId` undefined: a new chat, so tasks started without a source chat. */
export function ChildTaskAlerts({ chatId, className }: { chatId?: string; className?: string }) {
  const waiting = useChildTaskRequests(chatId);
  const runs = useChatRuns();
  const [index, setIndex] = useState(0);
  const current = waiting[Math.min(index, waiting.length - 1)];

  // A task that got its answer drops out; stay within the list.
  useEffect(() => {
    if (index > 0 && index >= waiting.length) setIndex(Math.max(0, waiting.length - 1));
  }, [index, waiting.length]);

  const run = current ? runs[current.chatId] : undefined;
  const permissions = run?.permissions ?? [];
  const questions = run?.questions ?? [];

  const reply = async (request: PermissionRequest, value: PermissionReply) => {
    if (current) await replyToPermission(current.chatId, request, value).catch(warn);
  };
  const allowFolder = async (request: PermissionRequest, folder: string) => {
    if (current) await allowFolderForRun(current.chatId, request, folder).catch(warn);
  };
  const answer = async (request: QuestionRequest, answers: string[][]) => {
    if (current) await answerAgentQuestion(current.chatId, request, answers).catch(warn);
  };

  return (
    <AnimatePresence initial={false}>
      {current && (permissions.length > 0 || questions.length > 0) && (
        <motion.div
          key="child-alerts"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 12 }}
          transition={{ type: "spring", stiffness: 380, damping: 32 }}
          className={cn("relative z-0 -mb-2.5", className)}
        >
          <div className="mx-3 flex items-center gap-2 rounded-t-lg border border-b-0 border-amber-500/40 bg-amber-50/95 px-2.5 py-1 text-[11px] text-amber-900 dark:bg-amber-950/70 dark:text-amber-100">
            <BellRingIcon className="size-3.5 shrink-0 animate-[wiggle_1.2s_ease-in-out_infinite]" />
            <span className="shrink-0 font-medium">Background task needs you</span>
            <span aria-hidden className="opacity-50">
              ·
            </span>
            <span className="min-w-0 flex-1 truncate" title={current.view.task.title}>
              {current.view.task.title}
            </span>
            {waiting.length > 1 && (
              <span className="flex shrink-0 items-center gap-0.5 tabular-nums">
                <button
                  type="button"
                  aria-label="Previous task"
                  disabled={index === 0}
                  onClick={() => setIndex((i) => Math.max(0, i - 1))}
                  className="rounded p-0.5 hover:bg-amber-500/15 disabled:opacity-40"
                >
                  <ChevronLeftIcon className="size-3" />
                </button>
                {Math.min(index, waiting.length - 1) + 1}/{waiting.length}
                <button
                  type="button"
                  aria-label="Next task"
                  disabled={index >= waiting.length - 1}
                  onClick={() => setIndex((i) => Math.min(waiting.length - 1, i + 1))}
                  className="rounded p-0.5 hover:bg-amber-500/15 disabled:opacity-40"
                >
                  <ChevronRightIcon className="size-3" />
                </button>
              </span>
            )}
            <Link
              to={`/chat/${current.chatId}`}
              className="flex shrink-0 items-center gap-0.5 rounded px-1 font-medium hover:bg-amber-500/15"
              title="Open the task's chat to see what it's doing"
            >
              Open
              <ArrowUpRightIcon className="size-3" />
            </Link>
          </div>
          {permissions.length > 0 ? (
            <PermissionPrompt
              key={current.chatId}
              stacked
              shortcuts={false}
              requests={permissions}
              onReply={reply}
              onAllowFolder={allowFolder}
              className="border-amber-500/40"
            />
          ) : (
            <QuestionPrompt key={current.chatId} stacked requests={questions} onAnswer={answer} />
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
