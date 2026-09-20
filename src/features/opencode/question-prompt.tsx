import { CoworkBot } from "@/components/anim/cowork-bot";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { QuestionItem, QuestionRequest } from "@/pages/chat/api/chat";
import { AnimatePresence, motion } from "motion/react";
import { CheckIcon, LoaderIcon } from "lucide-react";
import { useEffect, useState } from "react";

type Props = {
  requests: QuestionRequest[];
  /** One list of chosen labels per question; empty withdraws the question. */
  onAnswer: (request: QuestionRequest, answers: string[][]) => Promise<void>;
  /** Sits under the composer with only the top edge peeking out. */
  stacked?: boolean;
  className?: string;
};

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
  const ready = answers.every((answer) => answer.length > 0);

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
        <div className={cn("px-3 pt-2.5", stacked ? "pb-3.5" : "pb-2.5")}>
          <div className="flex items-center gap-2.5">
            <CoworkBot state="permission" size={46} />
            <span className="min-w-0 flex-1 text-sm font-medium text-foreground">
              {questions.length > 1 ? `${questions.length} questions for you` : "A question for you"}
            </span>
            {requests.length > 1 && (
              <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
                1/{requests.length}
              </span>
            )}
          </div>

          <div className="mt-2.5 flex max-h-[45vh] flex-col gap-3 overflow-y-auto">
            {questions.map((question, index) => (
              <Question
                key={`${request.id}:${index}`}
                question={question}
                picked={picked[index] ?? []}
                custom={custom[index] ?? ""}
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

          <div className="mt-2.5 flex items-center gap-1.5">
            <Button size="xs" disabled={!ready || busy} onClick={() => void send(answers)} className="gap-1.5">
              {busy ? <LoaderIcon className="size-3.5 animate-spin" /> : <CheckIcon className="size-3.5" />}
              Send answer
            </Button>
            <Button
              size="xs"
              variant="ghost"
              disabled={busy}
              onClick={() => void send([])}
              title="Let the agent decide and carry on"
            >
              Skip
            </Button>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

function Question({
  question,
  picked,
  custom,
  disabled,
  onToggle,
  onCustom,
}: {
  question: QuestionItem;
  picked: string[];
  custom: string;
  disabled?: boolean;
  onToggle: (label: string) => void;
  onCustom: (value: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      {question.header && (
        <span className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
          {question.header}
        </span>
      )}
      <p className="text-sm text-foreground">{question.question}</p>
      <div className="flex flex-wrap gap-1.5">
        {question.options.map((option) => {
          const active = picked.includes(option.label);
          return (
            <button
              key={option.label}
              type="button"
              disabled={disabled}
              onClick={() => onToggle(option.label)}
              title={option.description ?? undefined}
              aria-pressed={active}
              className={cn(
                "rounded-lg border px-2.5 py-1.5 text-left text-xs transition-colors disabled:opacity-60",
                active
                  ? "border-foreground/60 bg-foreground/10 text-foreground"
                  : "border-border bg-background/70 text-foreground/80 hover:bg-background",
              )}
            >
              <span className="font-medium">{option.label}</span>
              {option.description && (
                <span className="ml-1.5 text-muted-foreground">{option.description}</span>
              )}
            </button>
          );
        })}
      </div>
      {question.custom && (
        <Input
          value={custom}
          disabled={disabled}
          onChange={(event) => onCustom(event.target.value)}
          placeholder={question.options.length > 0 ? "Or answer in your own words" : "Your answer"}
          className="h-8 text-xs"
        />
      )}
    </div>
  );
}
