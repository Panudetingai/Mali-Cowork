import { CoworkBot } from "@/components/anim/cowork-bot";
import { MessageResponse } from "@/components/ai-elements/message";
import { TextShimmer } from "@/components/ui/text-shimmer";
import { useResolvedBot } from "@/features/bot-studio/resolve";
import { BOTS, useCoworkBot, type BotChoice, type BotState, type CoworkBotId } from "@/features/cowork-bot";
import { useTeam } from "@/features/team";
import { MALI_EASE } from "@/lib/motion-presets";
import { cn } from "@/lib/utils";
import { CheckIcon, ChevronDownIcon, CircleAlertIcon, SquareIcon } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useState, type ReactNode } from "react";
import { AgentSteps } from "./agent-steps";
import { briefParts, reportText, type TeamHandoff } from "./team-steps";

const pop = { type: "spring", stiffness: 420, damping: 30, mass: 0.8 } as const;
/** Folding and unfolding: quick, without a bounce. */
const fold = { type: "spring", stiffness: 380, damping: 38 } as const;
/** The avatars' column: the line between them runs down its middle. */
const AVATAR = 28;
/** Back bot peeks out to the left; front sits ~`STACK_STEP` px over. */
const STACK_SIZE = 28;
const STACK_STEP = 18;
/** What the agent says when the user stopped the run (`src-tauri/src/agent`). */
const STOPPED = /^stopped by the user\.?$/i;

type Phase = "waiting" | "working" | "done" | "stopped" | "failed";

/**
 * One hand-off in team mode, as a group chat in a card of its own: the lead
 * briefs the bot, the bot works, then answers with its report — top to
 * bottom in that order. The header says who handed what to whom and how it
 * went, so a folded card still reads at a glance.
 */
export function TeamThread({ handoff }: { handoff: TeamHandoff }) {
  const { mates } = useTeam();
  const { bot: leadBot } = useCoworkBot();
  const leadName = useResolvedBot(leadBot).name;
  const mate = mates.find((m) => m.id === handoff.teammateId);
  const report = handoff.report;
  const name = mate?.name ?? report?.title.replace(/^Team:\s*/, "").replace(/ \(failed\)$/, "") ?? "Teammate";
  const text = reportText(report);
  const working = !!report && !report.done;
  const failedRun = !!report && / \(failed\)$/.test(report.title);
  const phase: Phase = failedRun
    ? STOPPED.test(text)
      ? "stopped"
      : "failed"
    : working
      ? handoff.brief
        ? "working"
        : "waiting"
      : "done";
  const brief = briefParts(handoff.brief?.detail);
  const state: BotState =
    phase === "failed" ? "alert" : phase === "working" ? (handoff.steps.some((s) => !s.done) ? "tool" : "working") : phase === "stopped" ? "idle" : "done";
  const color = mate ? BOTS.find((b) => b.id === mate.mascot)?.color : undefined;
  const mateBot = mate?.mascot ?? "momo";
  const leadState: BotState = phase === "waiting" ? "permission" : phase === "working" ? "idle" : "done";
  const live = phase === "waiting" || phase === "working";
  const [open, setOpen] = useState(true);
  const reduced = useReducedMotion();
  const running = working ? handoff.steps.findIndex((s) => !s.done) : -1;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={pop}
      className={cn(
        "not-prose my-3 overflow-hidden rounded-xl border bg-card/40 transition-colors",
        phase === "waiting" ? "border-amber-500/40" : phase === "failed" ? "border-red-500/30" : "border-border/70",
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left transition-colors hover:bg-muted/30"
      >
        <TeamBotStack
          leadBot={leadBot}
          mateBot={mateBot}
          front={phase === "waiting" ? "lead" : "mate"}
          leadState={leadState}
          mateState={state}
          live={live}
        />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex min-w-0 items-center gap-1.5 text-[13px]">
            <span className="shrink-0 font-medium text-foreground/90">{leadName}</span>
            <span className="shrink-0 text-muted-foreground/70" aria-label="handed a job to">
              →
            </span>
            <span className="min-w-0 truncate font-semibold" style={color ? { color } : undefined}>
              {name}
            </span>
          </span>
          {/* Folded, the job still says what this was about; open, the brief below does. */}
          {!open && brief.job && <span className="truncate text-xs text-muted-foreground">{firstLine(brief.job)}</span>}
        </span>
        <span className="flex shrink-0 items-center gap-1.5">
          <Status phase={phase} />
          <ChevronDownIcon
            className={cn("size-4 text-muted-foreground/80 transition-transform duration-200", !open && "-rotate-90")}
          />
        </span>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="body"
            initial={reduced ? false : { height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={reduced ? undefined : { height: 0, opacity: 0 }}
            transition={fold}
            className="overflow-hidden"
          >
            <div className="relative flex flex-col gap-4 border-t border-border/50 px-3.5 pt-3.5 pb-4">
              {/* The thread: one line from the lead down to the bot. */}
              <span
                aria-hidden
                className="absolute w-px bg-gradient-to-b from-border via-border to-transparent"
                style={{ left: 14 + AVATAR / 2, top: 14 + AVATAR + 6, bottom: 28 }}
              />
              <Message name={leadName} role="Lead" bot={leadBot} state={leadState} live={live} delay={0.05}>
                {handoff.brief ? (
                  <Brief job={brief.job} context={brief.context} />
                ) : (
                  <span className="text-muted-foreground">Wants {name} to take a job — allow it below.</span>
                )}
              </Message>

              {(handoff.brief || text || phase === "failed" || phase === "stopped") && (
                <Message name={name} role="Teammate" bot={mate?.mascot} color={color} state={state} live={live} delay={0.18}>
                  {handoff.steps.length > 0 && (
                    // The bot's own steps, flat: they carry team ids, and
                    // grouping them again drew this card inside itself.
                    <div className="-ml-1">
                      <AgentSteps steps={handoff.steps} runningIndex={running >= 0 ? running : undefined} flat />
                    </div>
                  )}
                  <Report phase={phase} text={text} />
                </Message>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function firstLine(text: string) {
  return text.split("\n").find((line) => line.trim())?.trim() ?? "";
}

/** What the bot came back with: its report, a stop, a failure — or that it's still writing. */
function Report({ phase, text }: { phase: Phase; text: string }) {
  if (phase === "stopped") {
    return (
      <p className="flex w-fit items-center gap-1.5 rounded-lg bg-muted/40 px-3 py-1.5 text-xs text-muted-foreground">
        <SquareIcon className="size-3 fill-current" />
        Stopped before it finished.
      </p>
    );
  }
  if (!text) return phase === "working" || phase === "waiting" ? <Bubble><Typing /></Bubble> : null;
  if (phase === "failed") {
    return (
      <div className="flex w-fit max-w-full items-start gap-2 rounded-2xl rounded-tl-md border border-red-500/25 bg-red-500/[0.07] px-3.5 py-2 text-sm text-red-700 dark:text-red-300">
        <CircleAlertIcon className="mt-0.5 size-4 shrink-0" />
        <MessageResponse className="text-sm text-inherit">{text}</MessageResponse>
      </div>
    );
  }
  return (
    <Bubble>
      <MessageResponse className="text-sm" isAnimating={phase === "working"}>
        {text}
      </MessageResponse>
    </Bubble>
  );
}

function Bubble({ children }: { children: ReactNode }) {
  return (
    <div className="w-fit max-w-full rounded-2xl rounded-tl-md bg-muted/50 px-3.5 py-2 text-sm leading-relaxed">
      {children}
    </div>
  );
}

/** Lead + teammate in one stack; whoever is active slides to the front. */
function TeamBotStack({
  leadBot,
  mateBot,
  front,
  leadState,
  mateState,
  live,
}: {
  leadBot: BotChoice;
  mateBot: BotChoice;
  front: "lead" | "mate";
  leadState: BotState;
  mateState: BotState;
  /** Still going: the front bot moves; a finished one rests on a still frame. */
  live: boolean;
}) {
  const slots = [
    { key: "lead" as const, bot: leadBot, state: leadState, title: "Lead" },
    { key: "mate" as const, bot: mateBot, state: mateState, title: "Teammate" },
  ];

  const ordered = [...slots].sort((a, b) => (a.key === front ? 1 : 0) - (b.key === front ? 1 : 0));

  return (
    <div
      className="relative shrink-0 overflow-visible"
      style={{ width: STACK_SIZE + STACK_STEP, height: STACK_SIZE }}
      aria-hidden
    >
      {ordered.map(({ key, bot, state, title }) => {
        const onTop = key === front;
        return (
          <motion.div
            key={key}
            layout
            className="absolute top-0 overflow-visible rounded-full"
            title={title}
            animate={{
              left: onTop ? STACK_STEP : 0,
              scale: onTop ? 1 : 0.92,
            }}
            transition={{ duration: 0.32, ease: MALI_EASE }}
            style={{ width: STACK_SIZE, height: STACK_SIZE, zIndex: onTop ? 2 : 1 }}
          >
            <CoworkBot bot={bot} state={state} size={STACK_SIZE} paused={!onTop || !live} />
          </motion.div>
        );
      })}
    </div>
  );
}

const STATUS: Record<Phase, { label: string; className: string }> = {
  waiting: { label: "Waiting for your OK", className: "bg-amber-500/12 text-amber-700 dark:text-amber-300" },
  working: { label: "Working", className: "bg-muted/60 text-foreground/80" },
  done: { label: "Done", className: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" },
  stopped: { label: "Stopped", className: "bg-muted/60 text-muted-foreground" },
  failed: { label: "Didn't finish", className: "bg-red-500/10 text-red-600 dark:text-red-400" },
};

function Status({ phase }: { phase: Phase }) {
  const { label, className } = STATUS[phase];
  const live = phase === "waiting" || phase === "working";
  return (
    <AnimatePresence mode="popLayout" initial={false}>
      <motion.span
        key={phase}
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -4 }}
        transition={{ duration: 0.18 }}
        className={cn(
          "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap tabular-nums",
          className,
        )}
      >
        {live ? (
          <>
            <span
              className={cn(
                "size-1.5 animate-pulse rounded-full",
                phase === "waiting" ? "bg-amber-500" : "bg-sky-500",
              )}
            />
            <TextShimmer duration={2} className="font-medium">
              {label}
            </TextShimmer>
          </>
        ) : (
          <>
            {phase === "done" && <CheckIcon className="size-3" />}
            {phase === "stopped" && <SquareIcon className="size-2.5 fill-current" />}
            {phase === "failed" && <CircleAlertIcon className="size-3" />}
            {label}
          </>
        )}
      </motion.span>
    </AnimatePresence>
  );
}

/** A message in the team chat: the bot, who it is, and what it says (its steps first, for the teammate). */
function Message({
  name,
  role,
  bot,
  color,
  state,
  live,
  delay,
  children,
}: {
  name: string;
  role: string;
  bot?: BotChoice | CoworkBotId;
  color?: string;
  state: BotState;
  /** Still going: the avatar moves; afterwards it rests on a still frame. */
  live: boolean;
  delay: number;
  children: ReactNode;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, x: -10, y: 6 }}
      animate={{ opacity: 1, x: 0, y: 0 }}
      transition={{ ...pop, delay }}
      className="relative flex items-start gap-2.5"
    >
      <motion.div
        initial={{ scale: 0.4, rotate: -12 }}
        animate={{ scale: 1, rotate: 0 }}
        transition={{ type: "spring", stiffness: 500, damping: 18, delay }}
        className="relative z-10 shrink-0 rounded-full bg-background"
      >
        <CoworkBot bot={bot} state={state} size={AVATAR} title={name} paused={!live} />
      </motion.div>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <span className="flex min-w-0 items-baseline gap-1.5 leading-[28px]">
          <span className="truncate text-xs font-semibold" style={color ? { color } : undefined}>
            {name}
          </span>
          <span className="shrink-0 text-[11px] text-muted-foreground/80">{role}</span>
        </span>
        {children}
      </div>
    </motion.div>
  );
}

/** The lead's brief: the job up front, the context it passed along folded under it. */
function Brief({ job, context }: { job: string; context?: string }) {
  const [open, setOpen] = useState(false);
  const long = job.length > 280 || job.split("\n").length > 5;
  const folds = !!context || long;
  return (
    <Bubble>
      <motion.div
        initial={false}
        animate={{ height: long && !open ? "6.2em" : "auto" }}
        transition={fold}
        className={cn("overflow-hidden", long && !open && "[mask-image:linear-gradient(to_bottom,black_60%,transparent)]")}
      >
        <p className="whitespace-pre-wrap">{job}</p>
      </motion.div>
      <AnimatePresence initial={false}>
        {open && context && (
          <motion.div
            key="context"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={fold}
            className="overflow-hidden"
          >
            <div className="mt-2 border-t border-border/60 pt-2 text-[13px] text-muted-foreground">
              <p className="mb-0.5 text-[11px] font-medium tracking-wide uppercase">Context</p>
              <p className="whitespace-pre-wrap">{context}</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      {folds && (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="mt-1.5 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ChevronDownIcon className={cn("size-3 transition-transform duration-200", open && "rotate-180")} />
          {open ? "Show less" : context ? "Show context" : "Show the whole brief"}
        </button>
      )}
    </Bubble>
  );
}

/** The bot is writing. */
function Typing() {
  return (
    <span className="flex h-5 items-center gap-1" aria-label="Working">
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className="size-1.5 rounded-full bg-muted-foreground/60"
          animate={{ y: [0, -4, 0], opacity: [0.4, 1, 0.4] }}
          transition={{ duration: 0.9, repeat: Infinity, delay: i * 0.15 }}
        />
      ))}
    </span>
  );
}
