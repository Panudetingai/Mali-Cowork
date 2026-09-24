import { CoworkBot } from "@/components/anim/cowork-bot";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollMore, useScrollFade } from "@/components/ui/scroll-fade";
import { cn } from "@/lib/utils";
import type { QuestionItem, QuestionRequest } from "@/pages/chat/api/chat";
import { AnimatePresence, motion } from "motion/react";
import { CheckIcon, LoaderIcon, PencilLineIcon } from "lucide-react";
import { useEffect, useState } from "react";

type Props = {
  requests: QuestionRequest[];
  /** One list of chosen labels per question; empty withdraws the question. */
  onAnswer: (request: QuestionRequest, answers: string[][]) => Promise<void>;
  /** Sits under the composer with only the top edge peeking out. */
  stacked?: boolean;
  className?: string;
};

/** What a question will accept, said before the user guesses wrong. */
function ruleFor(question: QuestionItem) {
  if (question.options.length === 0) return "Type an answer";
  if (question.multiple) return question.custom ? "Pick any, or write one" : "Pick any that apply";
  return question.custom ? "Pick one, or write one" : "Pick one";
}

/**
 * The agent's own question, answered in the chat.
 *
 * Without this the prompt simply stops: opencode holds the turn open until the
 * question is answered, so an unanswered one looks like a reply that never
 * arrives.
 */
export function QuestionPrompt({ requests, onAnswer, stacked, className }: Props) {
  const request = requests[0];
  const questions = request?.questions ?? [];
  const [picked, setPicked] = useState<string[][]>([]);
  const [custom, setCustom] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const fade = useScrollFade<HTMLDivElement>(request?.id);

  // A new question starts from a clean sheet; a re-render of the same one
  // must not wipe what the user has picked or typed so far.
  useEffect(() => {
    setPicked([]);
    setCustom([]);
    setBusy(false);
  }, [request?.id]);

  if (!request) return null;

  const answerFor = (index: number) => {
    const written = custom[index]?.trim();
    const chosen = picked[index] ?? [];
    return written ? [...chosen, written] : chosen;
  };
  const answers = questions.map((_, index) => answerFor(index));
  const answered = answers.filter((answer) => answer.length > 0).length;
  const ready = answered === questions.length;

  const toggle = (index: number, label: string, multiple: boolean) => {
    setPicked((prev) => {
      const next = [...prev];
      const current = next[index] ?? [];
      if (!multiple) {
        next[index] = current.includes(label) ? [] : [label];
        return next;
      }
      next[index] = current.includes(label)
        ? current.filter((item) => item !== label)
        : [...current, label];
      return next;
    });
  };

  const send = async (values: string[][]) => {
    setBusy(true);
    try {
      await onAnswer(request, values);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AnimatePresence initial={false}>
      <motion.div
        key={request.id}
        role="alertdialog"
        aria-label="The agent has a question"
        initial={{ opacity: 0, y: stacked ? 21 : 16, scale: stacked ? 0.97 : 1 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: stacked ? 24 : 8, scale: 0.98 }}
        transition={{ type: "spring", stiffness: 380, damping: 30, mass: 0.85 }}
        className={cn("w-full overflow-hidden rounded-t-xl border", className)}
      >
        <div className="flex items-center gap-2.5 px-3 pt-2.5 pb-2">
          <CoworkBot state="permission" size={46} />
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-sm font-medium text-foreground">
              {questions.length > 1 ? `${questions.length} questions for you` : "A question for you"}
            </span>
            <span className="truncate text-[11px] text-muted-foreground">
              {questions.length > 1
                ? `${answered} of ${questions.length} answered · the agent is waiting`
                : "The agent is waiting for your answer"}
            </span>
          </div>
          {requests.length > 1 && (
            <span
              title={`${requests.length} questions are queued`}
              className="shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground tabular-nums"
            >
              1 of {requests.length}
            </span>
          )}
        </div>

        <div className="relative">
          <div
            ref={fade.ref}
            onScroll={fade.onScroll}
            style={fade.style}
            className="scroll-hidden flex max-h-[45vh] flex-col divide-y divide-border/60 overflow-y-auto border-y border-border/60"
          >
            {questions.map((question, index) => (
              <Question
                key={`${request.id}:${index}`}
                question={question}
                index={index}
                total={questions.length}
                picked={picked[index] ?? []}
                custom={custom[index] ?? ""}
                answered={answers[index]!.length > 0}
                disabled={busy}
                onToggle={(label) => toggle(index, label, question.multiple)}
                onCustom={(value) =>
                  setCustom((prev) => {
                    const next = [...prev];
                    next[index] = value;
                    return next;
                  })
                }
              />
            ))}
          </div>
          <ScrollMore show={fade.more} />
        </div>

        <div className={cn("flex flex-wrap items-center gap-2 px-3 pt-2", stacked ? "pb-3.5" : "pb-2.5")}>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => void send([])}
            className="text-muted-foreground"
            title="Withdraw the question and let the agent decide"
          >
            Skip
          </Button>
          <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-2">
            {!ready && questions.length > 1 && (
              <span className="text-[11px] text-muted-foreground tabular-nums">
                {questions.length - answered} left
              </span>
            )}
            <Button
              size="sm"
              disabled={!ready || busy}
              onClick={() => void send(answers)}
              className="gap-1.5"
              title={ready ? "Send this answer to the agent" : "Answer every question first"}
            >
              {busy ? <LoaderIcon className="size-3.5 animate-spin" /> : <CheckIcon className="size-3.5" />}
              Send answer
            </Button>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

function Question({
  question,
  index,
  total,
  picked,
  custom,
  answered,
  disabled,
  onToggle,
  onCustom,
}: {
  question: QuestionItem;
  index: number;
  total: number;
  picked: string[];
  custom: string;
  answered: boolean;
  disabled?: boolean;
  onToggle: (label: string) => void;
  onCustom: (value: string) => void;
}) {
  const role = question.multiple ? "checkbox" : "radio";

  return (
    <div className="flex flex-col gap-2 px-3 py-2.5">
      <div className="flex items-center gap-1.5">
        <span className="min-w-0 truncate text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
          {question.header || (total > 1 ? `Question ${index + 1}` : "Question")}
        </span>
        <span className="text-muted-foreground/50" aria-hidden>
          ·
        </span>
        <span className="shrink-0 text-[11px] text-muted-foreground">{ruleFor(question)}</span>
        {answered && (
          <CheckIcon
            aria-label="Answered"
            className="ml-auto size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400"
          />
        )}
      </div>

      <p className="text-sm font-medium text-foreground">{question.question}</p>

      {question.options.length > 0 && (
        <div role={question.multiple ? "group" : "radiogroup"} className="flex flex-wrap gap-1.5">
          {question.options.map((option) => {
            const active = picked.includes(option.label);
            return (
              <button
                key={option.label}
                type="button"
                role={role}
                aria-checked={active}
                disabled={disabled}
                onClick={() => onToggle(option.label)}
                className={cn(
                  "flex min-w-32 max-w-full flex-1 flex-col gap-0.5 rounded-lg border px-2.5 py-1.5 text-left transition-colors sm:flex-none disabled:opacity-60",
                  active
                    ? "border-primary/60 bg-primary/10 ring-1 ring-primary/30"
                    : "border-border bg-background/70 hover:border-border hover:bg-muted/60",
                )}
              >
                <span className="flex items-start gap-1.5 text-xs font-medium text-foreground">
                  <span
                    className={cn(
                      "mt-px flex size-3.5 shrink-0 items-center justify-center border transition-colors",
                      question.multiple ? "rounded-[4px]" : "rounded-full",
                      active ? "border-primary bg-primary text-primary-foreground" : "border-border",
                    )}
                  >
                    {active && <CheckIcon className="size-2.5" />}
                  </span>
                  <span className="min-w-0 break-words">{option.label}</span>
                </span>
                {option.description && (
                  <span className="pl-5 text-[11px] leading-snug text-muted-foreground">
                    {option.description}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {question.custom && (
        <div className="relative">
          <PencilLineIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={custom}
            disabled={disabled}
            onChange={(event) => onCustom(event.target.value)}
            placeholder={
              question.options.length > 0 ? "Or answer in your own words" : "Type your answer"
            }
            className="h-8 pl-8 text-xs"
          />
        </div>
      )}
    </div>
  );
}
