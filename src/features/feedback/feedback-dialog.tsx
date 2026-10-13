"use client";

import { CoworkBot } from "@/components/anim/cowork-bot";
import { Button } from "@/components/ui/button";
import type { BotState } from "@/features/cowork-bot/store";
import { MALI_EASE } from "@/lib/motion-presets";
import { cn } from "@/lib/utils";
import { Github } from "@lobehub/icons";
import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  ArrowUpRightIcon,
  CheckIcon,
  LightbulbIcon,
  MailIcon,
  MessageSquareTextIcon,
  SendIcon,
  StarIcon,
  XIcon,
} from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useId, useState, type ReactNode } from "react";
import {
  closeFeedback,
  dismissFeedback,
  submitFeedbackRating,
  useFeedbackOpen,
} from "./feedback-store";

// ── Where people can follow and reach the team: change these. ─────────────
export const GITHUB_URL = "https://github.com/Panudetingai/Mali-Cowork";
export const GITHUB_ISSUES_URL = `${GITHUB_URL}/issues/new`;
export const LINE_OA_URL = "";
export const CONTACT_EMAIL = "panudetingai@gmail.com";

/** What each star says, so a rating reads as words too. */
const STAR_LABELS = ["", "Not great", "Could be better", "It's okay", "I like it", "I love it"];
/** From this many stars, a rating is happy: ask for a GitHub star, not for what's wrong. */
const HAPPY = 4;
/** What a low rating is usually about: one tap instead of typing. */
export const FEEDBACK_TOPICS = ["Slow", "Bugs or crashes", "Hard to use", "Missing a feature", "AI answers", "Setup"] as const;

async function openExternal(url: string) {
  if (!url) return;
  try {
    await openUrl(url);
  } catch {
    window.open(url, "_blank", "noopener");
  }
}

function LineIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden className="shrink-0">
      <rect width="24" height="24" rx="6" fill="#06C755" />
      <path
        fill="#fff"
        d="M19.5 10.8c0-3.6-3.6-6.5-8-6.5s-8 2.9-8 6.5c0 3.2 2.8 5.9 6.6 6.4.26.06.61.18.7.41.08.2.05.51.02.71l-.11.67c-.03.2-.16.78.68.43.85-.35 4.58-2.69 6.24-4.61 1.15-1.26 1.7-2.54 1.7-4.11z"
      />
    </svg>
  );
}

/** A compact way out to GitHub, LINE or email. */
function LinkChip({ icon, label, onClick }: { icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group inline-flex h-8 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-lg border border-border/70 bg-background px-2.5 text-xs font-medium text-foreground transition-[background-color,border-color] hover:border-foreground/20 hover:bg-muted/50"
    >
      {icon}
      <span className="truncate">{label}</span>
      <ArrowUpRightIcon className="size-3 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-px group-hover:-translate-y-px" />
    </button>
  );
}

function FollowLinks() {
  return (
    <div className="flex flex-wrap gap-1.5">
      <LinkChip icon={<Github size={14} aria-hidden />} label="Star on GitHub" onClick={() => void openExternal(GITHUB_URL)} />
      <LinkChip
        icon={<LightbulbIcon className="size-3.5 text-amber-500" />}
        label="Share an idea"
        onClick={() => void openExternal(GITHUB_ISSUES_URL)}
      />
      {LINE_OA_URL && <LinkChip icon={<LineIcon size={14} />} label="LINE" onClick={() => void openExternal(LINE_OA_URL)} />}
      {CONTACT_EMAIL && (
        <LinkChip
          icon={<MailIcon className="size-3.5 text-muted-foreground" />}
          label="Email"
          onClick={() => void openExternal(`mailto:${CONTACT_EMAIL}`)}
        />
      )}
    </div>
  );
}

function StarRating({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  const [hover, setHover] = useState(0);
  const reduced = useReducedMotion();
  const active = hover || value;

  return (
    <div className="flex items-center justify-between gap-3" onMouseLeave={() => setHover(0)}>
      <div className="-ml-1 flex items-center" role="radiogroup" aria-label="Rating">
        {[1, 2, 3, 4, 5].map((n) => {
          const on = n <= active;
          return (
            <motion.button
              key={n}
              type="button"
              role="radio"
              aria-checked={value === n}
              aria-label={`${n} star${n === 1 ? "" : "s"} — ${STAR_LABELS[n]}`}
              onMouseEnter={() => setHover(n)}
              onFocus={() => setHover(n)}
              onBlur={() => setHover(0)}
              onClick={() => onChange(n)}
              whileHover={reduced ? undefined : { scale: 1.15 }}
              whileTap={reduced ? undefined : { scale: 0.88 }}
              transition={{ type: "spring", stiffness: 500, damping: 22 }}
              className="rounded-md p-1 outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              <motion.span
                className="block"
                // A pick makes the stars up to it pop, one after another.
                animate={value >= n && !reduced ? { scale: [1, 1.25, 1] } : { scale: 1 }}
                transition={{ duration: 0.32, delay: value >= n ? (n - 1) * 0.035 : 0, ease: MALI_EASE }}
                key={value >= n ? `on-${value}` : "off"}
              >
                <StarIcon
                  className={cn(
                    "size-7 transition-[color,fill] duration-150",
                    on ? "fill-amber-400 text-amber-400" : "fill-transparent text-muted-foreground/30",
                  )}
                  strokeWidth={1.5}
                />
              </motion.span>
            </motion.button>
          );
        })}
      </div>
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={active}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.15 }}
          className={cn("shrink-0 text-xs font-medium", active ? "text-foreground" : "text-muted-foreground")}
        >
          {active ? STAR_LABELS[active] : "Tap to rate"}
        </motion.span>
      </AnimatePresence>
    </div>
  );
}

export type FeedbackViewProps = {
  stars: number;
  comment: string;
  sent: boolean;
  /** Topics picked for a low rating (see `FEEDBACK_TOPICS`). */
  topics?: string[];
  onStars: (stars: number) => void;
  onComment: (comment: string) => void;
  onTopics?: (topics: string[]) => void;
  onLater: () => void;
  onSend: () => void;
  onClose: () => void;
};

/**
 * The review prompt as it looks: a small card in the bottom-left corner
 * that never blocks the app. Pure UI, no store calls (the dev preview uses
 * it too); `FeedbackDialog` mounts it and animates it in and out.
 */
export function FeedbackDialogView({
  stars,
  comment,
  sent,
  topics = [],
  onStars,
  onComment,
  onTopics,
  onLater,
  onSend,
  onClose,
}: FeedbackViewProps) {
  const titleId = useId();
  const reduced = useReducedMotion();
  const dismiss = sent ? onClose : onLater;
  const happy = stars >= HAPPY;
  const step = sent ? "sent" : stars === 0 ? "rate" : happy ? "happy" : "improve";
  // The user's own Cowork bot asks, and reacts to the rating.
  const pose: BotState =
    step === "rate" ? "welcome" : step === "happy" || (step === "sent" && happy) ? "done" : step === "improve" ? (comment.trim() ? "listening" : "question") : "idle";

  // Escape puts it away, like any popup.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && dismiss();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dismiss]);

  const swap = {
    initial: { opacity: 0, y: reduced ? 0 : 6 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: reduced ? 0 : -4 },
    transition: { duration: 0.2, ease: MALI_EASE },
  };

  return (
    <motion.section
      role="dialog"
      aria-labelledby={titleId}
      initial={{ opacity: 0, y: reduced ? 0 : 16, scale: reduced ? 1 : 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: reduced ? 0 : 12, scale: reduced ? 1 : 0.97 }}
      transition={{ type: "spring", stiffness: 380, damping: 32, mass: 0.8 }}
      style={{ transformOrigin: "bottom left" }}
      className="fixed bottom-4 left-4 z-50 w-[min(340px,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-border/70 bg-popover/95 text-popover-foreground shadow-[0_16px_40px_-12px_rgb(0_0_0/0.28),0_2px_6px_-2px_rgb(0_0_0/0.08)] backdrop-blur-xl"
    >
      {/* Height follows the step, so the card grows and shrinks instead of jumping. */}
      <motion.div layout={!reduced} transition={{ duration: 0.28, ease: MALI_EASE }} className="flex flex-col gap-3.5 p-4">
        <header className="flex items-start gap-3">
          <span className="relative flex size-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500/10 to-amber-400/10 ring-1 ring-border/50">
            <CoworkBot size={38} state={pose} fps={30} title="Your Cowork bot" />
            <AnimatePresence>
              {sent && (
                <motion.span
                  initial={{ scale: 0, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0, opacity: 0 }}
                  transition={{ type: "spring", stiffness: 520, damping: 24 }}
                  className="absolute -right-1 -bottom-1 flex size-4.5 items-center justify-center rounded-full bg-emerald-500 text-white ring-2 ring-popover"
                >
                  <CheckIcon className="size-2.5" strokeWidth={3.5} />
                </motion.span>
              )}
            </AnimatePresence>
          </span>
          <div className="min-w-0 flex-1 pt-1">
            <h2 id={titleId} className="text-sm leading-snug font-semibold tracking-tight">
              {sent ? (happy ? "Thank you!" : "Thanks for telling us") : "Enjoying Mali Cowork?"}
            </h2>
            <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
              {sent
                ? happy
                  ? "A star on GitHub helps others find Mali."
                  : "We read every note and use it to decide what to fix next."
                : "Rate it in a tap — it helps us decide what to build next."}
            </p>
          </div>
          <button
            type="button"
            onClick={dismiss}
            aria-label={sent ? "Close" : "Not now"}
            className="-mt-1 -mr-1 flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <XIcon className="size-4" />
          </button>
        </header>

        {!sent && <StarRating value={stars} onChange={onStars} />}

        <AnimatePresence mode="popLayout" initial={false}>
          {step === "improve" && (
            <motion.div key="improve" {...swap} className="flex flex-col gap-2.5">
              {onTopics && (
                <div className="flex flex-wrap gap-1.5" role="group" aria-label="What was it about?">
                  {FEEDBACK_TOPICS.map((topic) => {
                    const on = topics.includes(topic);
                    return (
                      <motion.button
                        key={topic}
                        type="button"
                        aria-pressed={on}
                        whileTap={reduced ? undefined : { scale: 0.94 }}
                        onClick={() => onTopics(on ? topics.filter((t) => t !== topic) : [...topics, topic])}
                        className={cn(
                          "inline-flex h-7 items-center gap-1 rounded-full border px-2.5 text-xs transition-colors",
                          on
                            ? "border-violet-500/50 bg-violet-500/10 font-medium text-violet-700 dark:text-violet-300"
                            : "border-border/70 text-muted-foreground hover:border-foreground/20 hover:text-foreground",
                        )}
                      >
                        {on && <CheckIcon className="size-3" strokeWidth={3} />}
                        {topic}
                      </motion.button>
                    );
                  })}
                </div>
              )}
              <div className="relative">
                <MessageSquareTextIcon className="pointer-events-none absolute top-2.5 left-2.5 size-3.5 text-muted-foreground/60" />
                <textarea
                  value={comment}
                  onChange={(e) => onComment(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) onSend();
                  }}
                  placeholder="Tell us more (optional)"
                  rows={3}
                  className="w-full resize-none rounded-xl border border-border/70 bg-muted/25 py-2 pr-2.5 pl-8 text-[13px] leading-relaxed outline-none transition-[border-color,box-shadow,background-color] placeholder:text-muted-foreground/60 focus:border-violet-500/40 focus:bg-background focus:ring-3 focus:ring-violet-500/12"
                />
              </div>
              <p className="text-[11px] leading-snug text-muted-foreground">
                {CONTACT_EMAIL
                  ? "Sending opens your email app with a draft to us — you can edit it before it goes out."
                  : "Sending opens a GitHub issue with your note — you review it before anything is posted."}
              </p>
            </motion.div>
          )}
          {step === "happy" && (
            <motion.div key="happy" {...swap}>
              <FollowLinks />
            </motion.div>
          )}
          {step === "sent" && (
            <motion.div key="sent" {...swap}>
              <FollowLinks />
            </motion.div>
          )}
        </AnimatePresence>

        {!sent && (
          <footer className="flex items-center justify-between gap-2 border-t border-border/60 pt-3">
            <button
              type="button"
              onClick={onLater}
              className="rounded-md px-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              Not now
            </button>
            <Button size="sm" className="h-8 gap-1.5 px-3" disabled={stars === 0} onClick={onSend}>
              <SendIcon className="size-3.5" />
              {stars > 0 && !happy && (comment.trim() || topics.length) ? "Send feedback" : "Submit"}
            </Button>
          </footer>
        )}
      </motion.div>
    </motion.section>
  );
}

async function feedbackMeta(stars: number, topics: string[], comment: string) {
  let version = "";
  try {
    version = await getVersion();
  } catch {
    // Not in the app (a browser preview): leave it out.
  }
  const body = [
    `Rating: ${"★".repeat(stars)}${"☆".repeat(5 - stars)} (${stars}/5)`,
    topics.length ? `About: ${topics.join(", ")}` : "",
    comment.trim() ? `\n${comment.trim()}` : "",
    `\n---\nMali Cowork ${version || "(unknown version)"} · ${navigator.userAgent.includes("Mac") ? "macOS" : navigator.platform}`,
  ]
    .filter(Boolean)
    .join("\n");
  const title = `Mali Cowork review: ${stars}/5 — ${topics[0] ?? STAR_LABELS[stars]}`;
  return { title, body };
}

/** Opens the user's mail app with a draft to the team. */
async function mailtoFeedbackUrl(stars: number, topics: string[], comment: string) {
  const { title, body } = await feedbackMeta(stars, topics, comment);
  return `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
}

/** A GitHub issue ready to post when no contact email is configured. */
async function issueUrl(stars: number, topics: string[], comment: string) {
  const { title, body } = await feedbackMeta(stars, topics, comment);
  const ghTitle = `Feedback: ${topics[0] ?? STAR_LABELS[stars]} (${stars}★)`;
  return `${GITHUB_ISSUES_URL}?title=${encodeURIComponent(ghTitle)}&body=${encodeURIComponent(body)}&labels=feedback`;
}

async function feedbackDeliveryUrl(stars: number, topics: string[], comment: string) {
  if (CONTACT_EMAIL) return mailtoFeedbackUrl(stars, topics, comment);
  if (stars < 4 && (comment.trim() || topics.length)) return issueUrl(stars, topics, comment);
  return "";
}

/** After this long, the thank-you card puts itself away. */
const THANKS_MS = 6000;

/**
 * Review + follow card. Opens by itself after a few launches (see
 * `useFeedbackAutoOpen`), or with `requestFeedbackOpen()`.
 */
export function FeedbackDialog() {
  const open = useFeedbackOpen();
  const [stars, setStars] = useState(0);
  const [comment, setComment] = useState("");
  const [topics, setTopics] = useState<string[]>([]);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    if (open) {
      setStars(0);
      setComment("");
      setTopics([]);
      setSent(false);
    }
  }, [open]);

  useEffect(() => {
    if (!sent) return;
    const id = window.setTimeout(closeFeedback, THANKS_MS);
    return () => window.clearTimeout(id);
  }, [sent]);

  const send = async () => {
    submitFeedbackRating(stars);
    setSent(true);
    const url = await feedbackDeliveryUrl(stars, topics, comment);
    if (url) void openExternal(url);
  };

  // Closed after picking stars: the rating still counts, and it won't ask again.
  const later = () => {
    if (stars > 0) {
      submitFeedbackRating(stars);
      closeFeedback();
    } else {
      dismissFeedback();
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <FeedbackDialogView
          key="feedback"
          stars={stars}
          comment={comment}
          sent={sent}
          topics={topics}
          onStars={setStars}
          onComment={setComment}
          onTopics={setTopics}
          onLater={later}
          onSend={() => void send()}
          onClose={closeFeedback}
        />
      )}
    </AnimatePresence>
  );
}
