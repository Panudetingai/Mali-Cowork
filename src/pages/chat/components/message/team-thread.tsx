import { CoworkBot } from "@/components/anim/cowork-bot";
import { MessageResponse } from "@/components/ai-elements/message";
import { TextShimmer } from "@/components/ui/text-shimmer";
import { BOTS, type BotState, type CoworkBotId } from "@/features/cowork-bot";
import { useTeam } from "@/features/team";
import { cn } from "@/lib/utils";
import { ChevronRightIcon, UsersIcon } from "lucide-react";
import { motion } from "motion/react";
import { useState, type ReactNode } from "react";
import { AgentSteps } from "./agent-steps";
import { reportText, type TeamHandoff } from "./team-steps";

const pop = { type: "spring", stiffness: 420, damping: 30, mass: 0.8 } as const;

/**
 * One hand-off in team mode, as a group chat: the lead briefs the bot, the
 * bot works (its own steps fold under it) and answers with its report.
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

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={pop}
      className="not-prose my-3 overflow-hidden rounded-2xl border border-border/70 bg-muted/20"
    >
      <div className="flex items-center gap-2 border-b border-border/60 px-3 py-2 text-xs">
        <UsersIcon className="size-3.5 text-muted-foreground" />
        <span className="font-medium text-foreground/90">Team chat</span>
        <span className="min-w-0 truncate text-muted-foreground">Lead → {name}</span>
        <span className="ml-auto shrink-0">
          {failed ? (
            <span className="text-red-600 dark:text-red-400">Didn't finish</span>
          ) : working ? (
            <TextShimmer duration={2} className="font-normal">
              {waitingForYou ? "Waiting for your OK" : "Working"}
            </TextShimmer>
          ) : (
            <span className="text-emerald-600 dark:text-emerald-400">Done</span>
          )}
        </span>
      </div>

      <div className="flex flex-col gap-3 p-3">
        <Bubble name="Lead" state={waitingForYou ? "permission" : working ? "idle" : "done"} delay={0.05}>
          {handoff.brief?.detail ? (
            <Brief text={handoff.brief.detail} />
          ) : (
            <span className="text-muted-foreground">Wants {name} to take a job — allow it below.</span>
          )}
        </Bubble>

        {(handoff.brief || text || failed) && (
          <Bubble name={name} bot={mate?.mascot} state={state} delay={0.2}>
            {text ? (
              <div className={cn(failed && "text-red-700 dark:text-red-300")}>
                <MessageResponse className="text-sm" isAnimating={working}>
                  {text}
                </MessageResponse>
              </div>
            ) : (
              <Typing />
            )}
            {handoff.steps.length > 0 && <Steps steps={handoff.steps} working={working} />}
          </Bubble>
        )}
      </div>
    </motion.div>
  );
}

/** A message in the team chat: the bot, animated, and what it says. */
function Bubble({
  name,
  bot,
  state,
  delay,
  children,
}: {
  name: string;
  /** Unset: the lead, which wears the bot picked for the app. */
  bot?: CoworkBotId;
  state: BotState;
  delay: number;
  children: ReactNode;
}) {
  const color = bot ? BOTS.find((b) => b.id === bot)?.color : undefined;
  return (
    <motion.div
      initial={{ opacity: 0, x: -10, y: 6 }}
      animate={{ opacity: 1, x: 0, y: 0 }}
      transition={{ ...pop, delay }}
      className="flex items-start gap-2.5"
    >
      <motion.div
        initial={{ scale: 0.4, rotate: -12 }}
        animate={{ scale: 1, rotate: 0 }}
        transition={{ type: "spring", stiffness: 500, damping: 18, delay }}
        className="shrink-0"
      >
        <CoworkBot bot={bot} state={state} size={38} title={name} />
      </motion.div>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="text-xs font-semibold" style={color ? { color } : undefined}>
          {name}
        </span>
        <div className="w-fit max-w-full rounded-2xl rounded-tl-sm border border-border/60 bg-background px-3 py-2 text-sm leading-relaxed">
          {children}
        </div>
      </div>
    </motion.div>
  );
}

/** The lead's brief; long ones fold. */
function Brief({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const clean = text.replace(/^Job from the lead:\s*/, "");
  const long = clean.length > 280 || clean.split("\n").length > 5;
  return (
    <div>
      <p className={cn("whitespace-pre-wrap", long && !open && "line-clamp-4")}>{clean}</p>
      {long && (
        <button type="button" onClick={() => setOpen((v) => !v)} className="mt-1 text-xs text-muted-foreground hover:text-foreground">
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

/** What the bot ran, folded under its message. */
function Steps({ steps, working }: { steps: TeamHandoff["steps"]; working: boolean }) {
  const [open, setOpen] = useState(false);
  const running = working ? steps.findIndex((s) => !s.done) : -1;
  return (
    <div className="mt-2 border-t border-border/50 pt-1.5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="group flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        aria-expanded={open}
      >
        <ChevronRightIcon className={cn("size-3.5 transition", open && "rotate-90")} />
        {working ? `Working · ${steps.length} steps` : `Ran ${steps.length} steps`}
      </button>
      {open && <AgentSteps steps={steps} runningIndex={running >= 0 ? running : undefined} />}
    </div>
  );
}
