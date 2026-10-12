/**
 * The agent's question, answered in the notch: one question at a time, its
 * options a row each with a number key, and a line to write your own when
 * the question allows it. A single pick answers at once (and moves on to
 * the next question); several picks, or words of your own, go with Send.
 * Skip withdraws the question and the agent decides by itself.
 */
import { MessageResponse } from "@/components/ai-elements/message";
import { MarkdownSurface } from "@/components/chat/markdown-surface";
import { cn } from "@/lib/utils";
import type { QuestionItem, QuestionRequest } from "@/pages/chat/api/chat";
import { CheckIcon, ChevronLeftIcon, CircleHelpIcon, CornerDownLeftIcon, Loader2Icon, PencilLineIcon } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { useNotchText } from "./text";

/** The accent for what's picked, like the page dots. */
const PICK = "#0a84ff";
/** Long enough to see the pick land before the card moves on. */
const ADVANCE_MS = 200;
/** Number keys pick the first nine options. */
const KEYED = 9;

type Props = {
  request: QuestionRequest;
  /** Who asks: the bot's name. */
  asker: string;
  /** The answer is on its way. */
  busy: boolean;
  /** One list of labels per question; empty withdraws the question. */
  onAnswer: (answers: string[][]) => void;
  /** Number keys and Enter answer while no text field has the keys. */
  keys?: boolean;
  className?: string;
};

function editable(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
}

export function NotchQuestion({ request, asker, busy, onAnswer, keys, className }: Props) {
  const t = useNotchText();
  const questions = request.questions;
  const [index, setIndex] = useState(0);
  /** Which way the last step went, for the slide. */
  const [dir, setDir] = useState<1 | -1>(1);
  const [picked, setPickedState] = useState<string[][]>([]);
  const [custom, setCustomState] = useState<string[]>([]);
  // Read back at once: two quick picks (or keys) between renders both count.
  const pickedRef = useRef(picked);
  const customRef = useRef(custom);
  const setPicked = (next: string[][]) => {
    pickedRef.current = next;
    setPickedState(next);
  };
  const setCustom = (next: string[]) => {
    customRef.current = next;
    setCustomState(next);
  };
  const advance = useRef<ReturnType<typeof setTimeout>>(undefined);

  // A new question starts clean; the same one re-sent keeps what's picked.
  useEffect(() => {
    setIndex(0);
    setDir(1);
    setPicked([]);
    setCustom([]);
    clearTimeout(advance.current);
  }, [request.id]);
  useEffect(() => () => clearTimeout(advance.current), []);

  const item = questions[Math.min(index, questions.length - 1)];
  const answerAt = (i: number, pickedNow = pickedRef.current, customNow = customRef.current) => {
    const written = customNow[i]?.trim();
    const chosen = pickedNow[i] ?? [];
    return written ? [...chosen, written] : chosen;
  };
  const ready = !!item && answerAt(index).length > 0;
  const last = index >= questions.length - 1;

  /** On to the next question, or send them all after the last. */
  const forward = (pickedNow = pickedRef.current, customNow = customRef.current) => {
    if (busy) return;
    if (!last) {
      setDir(1);
      setIndex(index + 1);
      return;
    }
    onAnswer(questions.map((_, i) => answerAt(i, pickedNow, customNow)));
  };

  const choose = (label: string) => {
    if (busy || !item) return;
    const current = pickedRef.current[index] ?? [];
    const next = [...pickedRef.current];
    if (item.multiple) {
      next[index] = current.includes(label) ? current.filter((l) => l !== label) : [...current, label];
      setPicked(next);
      return;
    }
    next[index] = [label];
    // A pick replaces words written for the same question.
    const customNow = [...customRef.current];
    customNow[index] = "";
    setPicked(next);
    setCustom(customNow);
    clearTimeout(advance.current);
    advance.current = setTimeout(() => forward(next, customNow), ADVANCE_MS);
  };

  const write = (value: string) => {
    const next = [...customRef.current];
    next[index] = value;
    setCustom(next);
    // Writing your own answer instead of a single pick.
    if (item && !item.multiple && value.trim() && pickedRef.current[index]?.length) {
      const cleared = [...pickedRef.current];
      cleared[index] = [];
      setPicked(cleared);
    }
  };

  const back = () => {
    if (index === 0 || busy) return;
    clearTimeout(advance.current);
    setDir(-1);
    setIndex(index - 1);
  };

  const keysRef = useRef({ choose, forward, ready, item });
  keysRef.current = { choose, forward, ready, item };
  useEffect(() => {
    if (!keys) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || event.repeat || editable(event.target)) return;
      const { choose, forward, ready, item } = keysRef.current;
      if (!item) return;
      // Physical digits, so a Thai keyboard picks too.
      const digit = /^Digit([1-9])$/.exec(event.code) ?? /^Numpad([1-9])$/.exec(event.code);
      if (digit) {
        const option = item.options[Number(digit[1]) - 1];
        if (!option) return;
        event.preventDefault();
        choose(option.label);
      } else if (event.key === "Enter" && ready) {
        event.preventDefault();
        forward();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [keys]);

  if (!item) return null;
  const many = questions.length > 1;
  // A single pick sends itself; Send is for several picks or written words.
  const needsSend = item.multiple || item.custom || item.options.length === 0;
  const showKeys = keys && item.options.length > 0;
  return (
    <div
      role="alertdialog"
      aria-label={t("asks", { name: asker })}
      className={cn(
        // min-w-0: in the notch's flex row the card takes the room it's given, never its content's width.
        "relative flex min-h-0 min-w-0 flex-col overflow-hidden rounded-[20px] p-3.5",
        "bg-gradient-to-b from-white/[0.09] to-white/[0.035] shadow-[0_8px_30px_-12px_rgba(10,132,255,0.35)] ring-1 ring-white/[0.09]",
        className,
      )}
    >
      {/* A soft wash of the accent behind the header, so the card reads as a question at a glance. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-16"
        style={{ background: `radial-gradient(120% 100% at 0% 0%, ${PICK}26, transparent 70%)` }}
      />
      <div className="relative flex h-[26px] min-w-0 shrink-0 items-center gap-2 text-[11.5px]">
        <span
          className="flex size-[22px] shrink-0 items-center justify-center rounded-full"
          style={{ background: `${PICK}33`, color: PICK, boxShadow: `inset 0 0 0 1px ${PICK}55` }}
        >
          <CircleHelpIcon className="size-3.5" />
        </span>
        <span className="min-w-0 shrink truncate font-semibold text-white/90">{t("asks", { name: asker })}</span>
        {item.header && (
          <span className="min-w-0 max-w-[40%] shrink truncate rounded-full bg-white/[0.09] px-2 py-0.5 text-[11px] font-medium text-white/70">
            {item.header}
          </span>
        )}
        <span className="shrink-0 rounded-full px-1.5 py-0.5 text-[10.5px] font-medium text-white/45 ring-1 ring-white/[0.1]">
          {item.multiple ? t("pickAny") : t("pickOne")}
        </span>
        {many && (
          <span className="ml-auto flex shrink-0 items-center gap-1.5 text-white/45 tabular-nums">
            {questions.map((_, i) => (
              <span
                key={i}
                className="h-[5px] rounded-full transition-all duration-300"
                style={{
                  width: i === index ? 14 : 5,
                  background: i === index ? PICK : answerAt(i).length ? "rgba(255,255,255,0.55)" : "rgba(255,255,255,0.18)",
                }}
              />
            ))}
            <span className="ml-0.5">{t("questionStep", { n: index + 1, total: questions.length })}</span>
          </span>
        )}
      </div>
      <div className="relative mt-2 flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <AnimatePresence mode="popLayout" initial={false} custom={dir}>
          <motion.div
            key={`${request.id}:${index}`}
            custom={dir}
            className="flex min-h-0 min-w-0 flex-1 flex-col"
            initial={{ opacity: 0, x: dir * 24, filter: "blur(4px)" }}
            animate={{ opacity: 1, x: 0, filter: "blur(0px)", transitionEnd: { filter: "none" } }}
            exit={{ opacity: 0, x: dir * -24, filter: "blur(4px)" }}
            transition={{ type: "spring", stiffness: 420, damping: 36 }}
          >
            <Body
              item={item}
              picked={picked[index] ?? []}
              custom={custom[index] ?? ""}
              busy={busy}
              onChoose={choose}
              onWrite={write}
              onSubmit={() => ready && forward()}
            />
          </motion.div>
        </AnimatePresence>
      </div>
      <div className="relative mt-2.5 flex h-8 min-w-0 shrink-0 items-center gap-1.5 border-t border-white/[0.06] pt-2">
        <button
          type="button"
          onClick={() => onAnswer([])}
          disabled={busy}
          title={t("skipHint")}
          className="h-7 shrink-0 rounded-full px-2.5 text-[12px] text-white/45 transition-colors hover:bg-white/[0.08] hover:text-white/80 disabled:opacity-40"
        >
          {t("skip")}
        </button>
        {index > 0 && (
          <button
            type="button"
            onClick={back}
            disabled={busy}
            className="flex h-7 shrink-0 items-center gap-0.5 rounded-full px-2 text-[12px] text-white/55 transition-colors hover:bg-white/[0.08] hover:text-white"
          >
            <ChevronLeftIcon className="size-3.5" />
            {t("back")}
          </button>
        )}
        {showKeys && (
          <span className="ml-auto min-w-0 truncate text-[11px] text-white/30">
            {t("keysHint", { n: Math.min(item.options.length, KEYED) })}
          </span>
        )}
        {(needsSend || !last || busy) && (
          <motion.button
            type="button"
            onClick={() => forward()}
            disabled={!ready || busy}
            whileTap={{ scale: 0.95 }}
            className={cn(
              "flex h-7 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-[12px] font-semibold text-white transition-opacity disabled:opacity-30",
              !showKeys && "ml-auto",
            )}
            style={{ background: PICK, boxShadow: `0 4px 14px -4px ${PICK}aa` }}
          >
            {busy ? <Loader2Icon className="size-3.5 animate-spin" /> : null}
            {last ? t("sendAnswer") : t("next")}
            {!busy && <CornerDownLeftIcon className="size-3 opacity-60" />}
          </motion.button>
        )}
      </div>
    </div>
  );
}

function Body({
  item,
  picked,
  custom,
  busy,
  onChoose,
  onWrite,
  onSubmit,
}: {
  item: QuestionItem;
  picked: string[];
  custom: string;
  busy: boolean;
  onChoose: (label: string) => void;
  onWrite: (value: string) => void;
  onSubmit: () => void;
}) {
  const t = useNotchText();
  const writable = item.custom || item.options.length === 0;
  // More options below the fold: the list's edge fades, so it reads as a scroll, not a cut.
  const list = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState(false);
  const measure = () => {
    const el = list.current;
    setMore(!!el && el.scrollTop + el.clientHeight < el.scrollHeight - 2);
  };
  useEffect(() => {
    measure();
    const el = list.current;
    if (!el) return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [item]);
  return (
    <>
      {/* A long question scrolls rather than being cut off. */}
      <div className="scroll-hidden max-h-[5.25rem] min-w-0 shrink-0 overflow-y-auto pr-1" title={item.question}>
        <MarkdownSurface>
          <MessageResponse className="text-[14.5px] leading-[20px] font-semibold tracking-[-0.005em] break-words text-white [&_a]:text-sky-300 [&_code]:rounded [&_code]:bg-white/10 [&_code]:px-1 [&_p]:my-0">
            {item.question}
          </MessageResponse>
        </MarkdownSurface>
      </div>
      {item.options.length > 0 && (
        <div
          ref={list}
          onScroll={measure}
          role={item.multiple ? "group" : "radiogroup"}
          className={cn(
            "scroll-hidden mt-2.5 flex min-h-0 min-w-0 flex-col gap-1.5 overflow-y-auto",
            more && "[mask-image:linear-gradient(to_bottom,black_calc(100%-28px),transparent)]",
          )}
        >
          {item.options.map((option, i) => {
            const on = picked.includes(option.label);
            return (
              <motion.button
                key={option.label}
                type="button"
                role={item.multiple ? "checkbox" : "radio"}
                aria-checked={on}
                disabled={busy}
                onClick={() => onChoose(option.label)}
                title={option.description ? `${option.label}\n${option.description}` : option.label}
                className={cn(
                  "group flex w-full min-w-0 shrink-0 items-center gap-2.5 rounded-xl px-2.5 text-left transition-colors disabled:opacity-60",
                  option.description ? "min-h-[52px] py-2" : "min-h-[38px] py-1.5",
                  on ? "text-white" : "bg-white/[0.045] text-white/85 ring-1 ring-white/[0.04] hover:bg-white/[0.09] hover:text-white",
                )}
                style={on ? { background: `${PICK}2b`, boxShadow: `inset 0 0 0 1px ${PICK}aa` } : undefined}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0, transition: { delay: 0.03 * i, duration: 0.2 } }}
                whileTap={{ scale: 0.985 }}
              >
                <span
                  className={cn(
                    "flex size-5 shrink-0 items-center justify-center text-[10.5px] font-semibold tabular-nums transition-colors",
                    item.multiple ? "rounded-[6px]" : "rounded-full",
                    on ? "text-white" : "bg-white/[0.08] text-white/55 group-hover:bg-white/[0.14] group-hover:text-white/85",
                  )}
                  style={on ? { background: PICK } : undefined}
                >
                  {on ? (
                    <motion.span initial={{ scale: 0.4 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 600, damping: 20 }}>
                      <CheckIcon className="size-3" strokeWidth={3} />
                    </motion.span>
                  ) : i < KEYED ? (
                    i + 1
                  ) : null}
                </span>
                {/* Label over its description: both stay readable at any length. */}
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate text-[13px] leading-[17px] font-medium">{option.label}</span>
                  {option.description && (
                    <span className={cn("line-clamp-2 text-[11.5px] leading-[15px] break-words", on ? "text-white/65" : "text-white/45")}>
                      {option.description}
                    </span>
                  )}
                </span>
              </motion.button>
            );
          })}
        </div>
      )}
      {writable && (
        <label className="mt-2.5 flex h-9 min-w-0 shrink-0 items-center gap-2 rounded-xl bg-white/[0.04] px-2.5 ring-1 ring-white/[0.07] transition-shadow focus-within:bg-white/[0.06] focus-within:ring-[#0a84ff]/60">
          <PencilLineIcon className="size-3.5 shrink-0 text-white/40" />
          <input
            value={custom}
            disabled={busy}
            onChange={(event) => onWrite(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                event.preventDefault();
                onSubmit();
              }
            }}
            placeholder={item.options.length ? t("orWrite") : t("typeAnswer")}
            className="min-w-0 flex-1 bg-transparent text-[13px] text-white outline-none placeholder:text-white/30"
            spellCheck={false}
          />
        </label>
      )}
    </>
  );
}
