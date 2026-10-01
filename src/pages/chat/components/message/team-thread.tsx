import { CoworkBot } from "@/components/anim/cowork-bot";
import { MessageResponse } from "@/components/ai-elements/message";
import { TextShimmer } from "@/components/ui/text-shimmer";
import { BOTS, type BotState, type CoworkBotId } from "@/features/cowork-bot";
import { useTeam } from "@/features/team";
import { cn } from "@/lib/utils";
import { ChevronDownIcon, UsersIcon } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useState, type ReactNode } from "react";
import { AgentSteps } from "./agent-steps";
import { reportText, type TeamHandoff } from "./team-steps";

const pop = { type: "spring", stiffness: 420, damping: 30, mass: 0.8 } as const;
/** Folding and unfolding: quick, without a bounce. */
const fold = { type: "spring", stiffness: 380, damping: 38 } as const;
/** The avatars' column: the line between them runs down its middle. */
const AVATAR = 32;

/**
 * One hand-off in team mode, as a group chat: the lead briefs the bot, the
 * bot works and answers with its report. One card holds it all: the
 * messages are soft bubbles joined by a line (no box in a box), and the
 * bot's steps fold under its message rather than inside it. The header
 * folds the whole conversation.
 */
export function TeamThread({ handoff }: { handoff: TeamHandoff }) {
  const { mates } = useTeam();
  const mate = mates.find((m) => m.id === handoff.teammateId);
  const report = handoff.report;
  const name = mate?.name ?? report?.title.replace(/^Team:\s*/, "").replace(/ \(failed\)$/, "") ?? "Teammate";
  const failed = !!report && / \(failed\)$/.test(report.title);
  const working = !!report && !report.done;
  const text = reportText(report);
  const waitingForYou = working && !handoff.brief;
  const state: BotState = failed ? "alert" : working ? (handoff.steps.some((s) => !s.done) ? "tool" : "working") : "done";
  const color = mate ? BOTS.find((b) => b.id === mate.mascot)?.color : undefined;
  const [open, setOpen] = useState(true);
  const reduced = useReducedMotion();
  const running = working ? handoff.steps.findIndex((s) => !s.done) : -1;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={pop}
      className="not-prose my-3 overflow-hidden rounded-2xl border border-border/60 bg-muted/15"
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3.5 py-2.5 text-left text-xs transition-colors hover:bg-muted/30"
      >
        <span
          className="flex size-5 shrink-0 items-center justify-center rounded-full"
          style={{ background: color ? `${color}26` : undefined }}
        >
          <UsersIcon className="size-3" style={color ? { color } : undefined} />
        </span>
        <span className="font-medium text-foreground/90">Team chat</span>
        <span className="min-w-0 truncate text-muted-foreground">Lead → {name}</span>
        <span className="ml-auto flex shrink-0 items-center gap-2">
          <Status failed={failed} working={working} waitingForYou={waitingForYou} />
          <ChevronDownIcon
            className={cn("size-3.5 text-muted-foreground transition-transform duration-200", !open && "-rotate-90")}
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
            <div className="relative flex flex-col gap-4 px-3.5 pt-1 pb-3.5">
              {/* The thread: one line from the lead down to the bot. */}
              <span
                aria-hidden
                className="absolute w-px bg-gradient-to-b from-border via-border to-transparent"
                style={{ left: 14 + AVATAR / 2, top: AVATAR + 8, bottom: 24 }}
              />
              <Message name="Lead" state={waitingForYou ? "permission" : working ? "idle" : "done"} delay={0.05}>
                {handoff.brief?.detail ? (
                  <Brief text={handoff.brief.detail} />
                ) : (
                  <span className="text-muted-foreground">Wants {name} to take a job — allow it below.</span>
                )}
              </Message>

              {(handoff.brief || text || failed) && (
                <Message
                  name={name}
                  bot={mate?.mascot}
                  color={color}
                  state={state}
                  delay={0.18}
                  after={
                    handoff.steps.length > 0 && (
                      // The bot's own steps, flat: they carry team ids, and
                      // grouping them again drew this card inside itself.
                      <div className="-ml-1">
                        <AgentSteps steps={handoff.steps} runningIndex={running >= 0 ? running : undefined} flat />
                      </div>
                    )
                  }
                >
                  {text ? (
                    <div className={cn(failed && "text-red-700 dark:text-red-300")}>
                      <MessageResponse className="text-sm" isAnimating={working}>
                        {text}
                      </MessageResponse>
                    </div>
                  ) : (
                    <Typing />
                  )}
                </Message>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function Status({ failed, working, waitingForYou }: { failed: boolean; working: boolean; waitingForYou: boolean }) {
  return (
    <AnimatePresence mode="popLayout" initial={false}>
      <motion.span
        key={failed ? "failed" : working ? (waitingForYou ? "waiting" : "working") : "done"}
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -4 }}
        transition={{ duration: 0.18 }}
      >
        {failed ? (
          <span className="text-red-600 dark:text-red-400">Didn't finish</span>
        ) : working ? (
          <TextShimmer duration={2} className="font-normal">
            {waitingForYou ? "Waiting for your OK" : "Working"}
          </TextShimmer>
        ) : (
          <span className="text-emerald-600 dark:text-emerald-400">Done</span>
        )}
      </motion.span>
    </AnimatePresence>
  );
}

/** A message in the team chat: the bot, animated, what it says, and (under it) what it ran. */
function Message({
  name,
  bot,
  color,
  state,
  delay,
  after,
  children,
}: {
  name: string;
  /** Unset: the lead, which wears the bot picked for the app. */
  bot?: CoworkBotId;
  color?: string;
  state: BotState;
  delay: number;
  /** Under the bubble, outside it: the bot's steps. */
  after?: ReactNode;
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
        <CoworkBot bot={bot} state={state} size={AVATAR} title={name} />
      </motion.div>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="text-xs font-semibold" style={color ? { color } : undefined}>
          {name}
        </span>
        <div className="w-fit max-w-full rounded-2xl rounded-tl-md bg-muted/45 px-3.5 py-2 text-sm leading-relaxed">
          {children}
        </div>
        {after}
      </div>
    </motion.div>
  );
}

/** The lead's brief; long ones fold, and unfold smoothly. */
function Brief({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const clean = text.replace(/^Job from the lead:\s*/, "");
  const long = clean.length > 280 || clean.split("\n").length > 5;
  return (
    <div>
      <motion.div
        initial={false}
        animate={{ height: long && !open ? "6.2em" : "auto" }}
        transition={fold}
        className={cn("overflow-hidden", long && !open && "[mask-image:linear-gradient(to_bottom,black_60%,transparent)]")}
      >
        <p className="whitespace-pre-wrap">{clean}</p>
      </motion.div>
      {long && (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="mt-1 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ChevronDownIcon className={cn("size-3 transition-transform duration-200", open && "rotate-180")} />
          {open ? "Show less" : "Show the whole brief"}
        </button>
      )}
    </div>
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
