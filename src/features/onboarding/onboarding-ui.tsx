"use client";

import { CoworkBot } from "@/components/anim/cowork-bot";
import type { BotState } from "@/features/cowork-bot";
import { cn } from "@/lib/utils";
import { AnimatePresence, motion } from "motion/react";
import {
  AlertTriangleIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckIcon,
  LoaderIcon,
  MinusIcon,
  SparklesIcon,
  XIcon,
} from "lucide-react";
import type { ReactNode } from "react";

export type OnboardingStepId = "check" | "agents" | "tools" | "plan" | "install" | "verify" | "guide";

import { MALI_EASE as EASE } from "@/lib/motion-presets";

export { EASE };

export type StepMeta = {
  id: OnboardingStepId;
  /** Short name in the step rail. */
  label: string;
  /** One line under the label in the rail. */
  hint: string;
  title: string;
  subtitle: string;
  bot: BotState;
};

/** In order, for the rail, the header and Back. */
export const STEPS: StepMeta[] = [
  {
    id: "check",
    label: "System check",
    hint: "What's on this computer",
    title: "Checking your system",
    subtitle: "Mali looks for the runtimes and agents it works with, so it only installs what's missing.",
    bot: "thinking",
  },
  {
    id: "agents",
    label: "Agent",
    hint: "Who does the work",
    title: "Choose your agent",
    subtitle: "Agents read and edit files in folders you allow. OpenCode comes with free models.",
    bot: "welcome",
  },
  {
    id: "tools",
    label: "Tools",
    hint: "Optional power-ups",
    title: "Add some tools",
    subtitle: "MCP tools let the agent browse, write documents and remember. Turn any on or off later.",
    bot: "tool",
  },
  {
    id: "plan",
    label: "Review",
    hint: "Commands that will run",
    title: "Review the plan",
    subtitle: "Every command is listed here. Nothing runs on your machine until you press Install.",
    bot: "question",
  },
  {
    id: "install",
    label: "Install",
    hint: "Download and set up",
    title: "Installing",
    subtitle: "Keep Mali open. Progress also shows in the notch at the top of your screen.",
    bot: "working",
  },
  {
    id: "verify",
    label: "Verify",
    hint: "Make sure it all works",
    title: "Final check",
    subtitle: "Mali makes sure the agent starts, models are there and your tools are switched on.",
    bot: "done",
  },
  {
    id: "guide",
    label: "How to use",
    hint: "Four things to know",
    title: "How Mali works",
    subtitle: "A quick tour before your first chat.",
    bot: "welcome",
  },
];

/** Soft gradient behind each step's header. */
const STEP_GRADIENT: Record<OnboardingStepId, string> = {
  check: "linear-gradient(135deg, #fbcfe8 0%, #ddd6fe 38%, #bae6fd 100%)",
  agents: "linear-gradient(135deg, #a7f3d0 0%, #bae6fd 45%, #c4b5fd 100%)",
  tools: "linear-gradient(135deg, #99f6e4 0%, #7dd3fc 50%, #a5b4fc 100%)",
  plan: "linear-gradient(135deg, #e9d5ff 0%, #bfdbfe 50%, #fecdd3 100%)",
  install: "linear-gradient(135deg, #fde68a 0%, #93c5fd 55%, #c4b5fd 100%)",
  verify: "linear-gradient(135deg, #bbf7d0 0%, #7dd3fc 45%, #ddd6fe 100%)",
  guide: "linear-gradient(135deg, #fde68a 0%, #fbcfe8 45%, #ddd6fe 100%)",
};

/** Slides in from the side the user is heading to. */
export const slide = {
  enter: (dir: number) => ({ opacity: 0, x: dir * 28 }),
  center: { opacity: 1, x: 0 },
  exit: (dir: number) => ({ opacity: 0, x: dir * -20 }),
};

/** White canvas with slowly drifting pastel light. */
export function OnboardingBackdrop() {
  const blobs = [
    { color: "rgba(186,230,253,0.55)", className: "-top-40 left-1/2 size-[640px] -translate-x-1/2", drift: [0, 40, 0] },
    { color: "rgba(251,207,232,0.45)", className: "-bottom-48 -right-32 size-[520px]", drift: [0, -36, 0] },
    { color: "rgba(233,213,255,0.5)", className: "-left-40 bottom-0 size-[480px]", drift: [0, 30, 0] },
  ];
  return (
    <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden bg-white" aria-hidden>
      {blobs.map((blob, i) => (
        <motion.div
          key={i}
          className={cn("absolute rounded-full blur-3xl", blob.className)}
          style={{ background: `radial-gradient(circle, ${blob.color} 0%, transparent 70%)` }}
          animate={{ y: blob.drift, x: blob.drift.map((v) => v / 2) }}
          transition={{ duration: 14 + i * 3, repeat: Infinity, ease: "easeInOut" }}
        />
      ))}
    </div>
  );
}

/**
 * Setup fills the window: the step rail down the left, the current step on
 * the right with its header, scrolling body and footer.
 */
export function OnboardingFrame({
  step,
  dir,
  footer,
  children,
}: {
  step: OnboardingStepId;
  dir: number;
  footer: ReactNode;
  children: ReactNode;
}) {
  const index = STEPS.findIndex((s) => s.id === step);
  const meta = STEPS[index]!;
  const column = "mx-auto w-full max-w-[880px] px-6 lg:px-10";

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.5, ease: EASE }}
      className="relative flex h-full w-full overflow-hidden"
    >
      <StepRail index={index} />

      <section className="relative flex min-w-0 flex-1 flex-col">
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-80 overflow-hidden"
          style={{ maskImage: "linear-gradient(to bottom, black 0%, rgba(0,0,0,0.55) 45%, transparent 100%)" }}
        >
          <AnimatePresence initial={false}>
            <motion.div
              key={step}
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.85 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.7 }}
              className="absolute inset-0"
              style={{ background: STEP_GRADIENT[step] }}
            />
          </AnimatePresence>
        </div>

        <div className={cn("relative z-10 shrink-0 pt-16", column)}>
          <MobileProgress index={index} />

          <AnimatePresence mode="wait" custom={dir}>
            <motion.header
              key={step}
              custom={dir}
              variants={slide}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.3, ease: EASE }}
              className="flex items-center gap-5"
            >
              <motion.div
                initial={{ scale: 0.7, rotate: -8 }}
                animate={{ scale: 1, rotate: 0 }}
                transition={{ type: "spring", stiffness: 320, damping: 18 }}
                className="flex size-[72px] shrink-0 items-center justify-center rounded-[1.4rem] bg-white shadow-[0_12px_30px_-14px_rgba(15,23,42,0.25)] ring-1 ring-neutral-200/80"
              >
                <CoworkBot state={meta.bot} size={56} theme="light" />
              </motion.div>
              <div className="flex min-w-0 flex-col gap-1">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
                  Step {index + 1} of {STEPS.length}
                </span>
                <h1 className="text-2xl font-bold leading-tight tracking-tight text-neutral-900 lg:text-[28px]">
                  {meta.title}
                </h1>
                <p className="text-sm leading-relaxed text-neutral-600 lg:text-[15px]">{meta.subtitle}</p>
              </div>
            </motion.header>
          </AnimatePresence>
        </div>

        <div
          className={cn(
            "relative z-10 mt-6 min-h-0 flex-1 overflow-y-auto overscroll-contain",
            "[scrollbar-width:thin] [scrollbar-color:rgba(115,115,115,0.35)_transparent]",
          )}
        >
          <div className={cn("pb-8", column)}>
            <AnimatePresence mode="wait" custom={dir}>
              <motion.div
                key={step}
                custom={dir}
                variants={slide}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{ duration: 0.32, ease: EASE }}
              >
                {children}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>

        <footer className="relative z-10 shrink-0 border-t border-neutral-200/70 bg-white/75 backdrop-blur-xl">
          <div className={cn("flex items-center gap-3 py-4", column)}>{footer}</div>
        </footer>
      </section>
    </motion.div>
  );
}

/** Every step, with what's done, what's now and what's next. */
function StepRail({ index }: { index: number }) {
  const pct = Math.round((index / (STEPS.length - 1)) * 100);
  return (
    <aside className="relative hidden w-[272px] shrink-0 flex-col border-r border-neutral-200/70 bg-white/60 px-5 pb-6 pt-10 backdrop-blur-xl md:flex">
      <div className="flex items-center gap-2.5 px-2">
        <CoworkBot state="idle" size={32} theme="light" />
        <div className="flex flex-col leading-tight">
          <span className="text-sm font-bold tracking-tight text-neutral-900">Mali Cowork</span>
          <span className="text-[11px] text-neutral-500">First-time setup</span>
        </div>
      </div>

      <ol className="mt-7 flex flex-col">
        {STEPS.map((s, i) => {
          const state = i < index ? "done" : i === index ? "active" : "next";
          return (
            <li key={s.id} className="relative">
              {i < STEPS.length - 1 && (
                <span className="absolute left-[23px] top-[40px] h-[calc(100%-32px)] w-px overflow-hidden bg-neutral-200">
                  <motion.span
                    className="absolute inset-x-0 top-0 h-full origin-top bg-emerald-400"
                    initial={false}
                    animate={{ scaleY: i < index ? 1 : 0 }}
                    transition={{ duration: 0.45, ease: EASE }}
                  />
                </span>
              )}
              <div className="relative flex items-center gap-3 rounded-xl px-2 py-2">
                {state === "active" && (
                  <motion.span
                    layoutId="onboarding-rail-active"
                    className="absolute inset-0 rounded-xl bg-white shadow-sm ring-1 ring-neutral-200/80"
                    transition={{ type: "spring", stiffness: 380, damping: 32 }}
                  />
                )}
                <RailDot state={state} n={i + 1} />
                <div className="relative flex min-w-0 flex-col leading-tight">
                  <span
                    className={cn(
                      "truncate text-[13px] font-semibold transition-colors",
                      state === "next" ? "text-neutral-400" : "text-neutral-900",
                    )}
                  >
                    {s.label}
                  </span>
                  <span className="truncate text-[11px] text-neutral-500">{s.hint}</span>
                </div>
              </div>
            </li>
          );
        })}
      </ol>

      <div className="mt-auto flex flex-col gap-2 px-2">
        <div className="flex items-center justify-between text-[11px] font-medium text-neutral-500">
          <span>Progress</span>
          <span className="tabular-nums text-neutral-900">{pct}%</span>
        </div>
        <ProgressBar value={pct} />
        <p className="text-[11px] leading-relaxed text-neutral-500">
          You can run setup again any time from Settings → Agents.
        </p>
      </div>
    </aside>
  );
}

function RailDot({ state, n }: { state: "done" | "active" | "next"; n: number }) {
  return (
    <span className="relative flex size-8 shrink-0 items-center justify-center">
      {state === "active" && (
        <motion.span
          className="absolute inset-0 rounded-full bg-neutral-900/15"
          animate={{ scale: [1, 1.35, 1], opacity: [0.7, 0, 0.7] }}
          transition={{ duration: 2, repeat: Infinity, ease: "easeOut" }}
        />
      )}
      <motion.span
        initial={false}
        animate={{ scale: state === "active" ? 1 : 0.92 }}
        className={cn(
          "relative flex size-7 items-center justify-center rounded-full text-[11px] font-bold tabular-nums transition-colors",
          state === "done" && "bg-emerald-500 text-white",
          state === "active" && "bg-neutral-900 text-white",
          state === "next" && "bg-white text-neutral-400 ring-1 ring-neutral-200",
        )}
      >
        <AnimatePresence mode="wait" initial={false}>
          {state === "done" ? (
            <motion.span
              key="check"
              initial={{ scale: 0, rotate: -45 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ type: "spring", stiffness: 500, damping: 22 }}
            >
              <CheckIcon className="size-3.5" strokeWidth={3} />
            </motion.span>
          ) : (
            <motion.span key="n" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              {n}
            </motion.span>
          )}
        </AnimatePresence>
      </motion.span>
    </span>
  );
}

/** The rail folds into segments on narrow windows. */
function MobileProgress({ index }: { index: number }) {
  return (
    <div className="mb-4 flex flex-col gap-1.5 pr-12 md:hidden">
      <span className="text-[11px] font-semibold text-neutral-500">{STEPS[index]!.label}</span>
      <div className="flex gap-1" aria-hidden>
        {STEPS.map((s, i) => (
          <span key={s.id} className="h-1 flex-1 overflow-hidden rounded-full bg-neutral-200">
            <motion.span
              className={cn("block h-full origin-left", i < index ? "bg-emerald-400" : "bg-neutral-900")}
              initial={false}
              animate={{ scaleX: i <= index ? 1 : 0 }}
              transition={{ duration: 0.4, ease: EASE }}
            />
          </span>
        ))}
      </div>
    </div>
  );
}

export function PrimaryButton({
  children,
  onClick,
  disabled,
  loading,
  className,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
  className?: string;
}) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      disabled={disabled || loading}
      whileHover={{ y: -1 }}
      whileTap={{ y: 0 }}
      className={cn(
        "inline-flex h-11 items-center justify-center gap-2 rounded-2xl px-5 text-sm font-semibold",
        "bg-neutral-900 text-white shadow-md transition-[background-color,box-shadow] duration-300 hover:bg-neutral-800 hover:shadow-lg",
        "disabled:pointer-events-none disabled:opacity-40",
        className,
      )}
    >
      {loading && <LoaderIcon className="size-4 animate-spin" />}
      {children}
      {!loading && <ArrowRightIcon className="size-4" />}
    </motion.button>
  );
}

export function BackButton({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  return (
    <AnimatePresence initial={false}>
      {!disabled && (
        <motion.button
          type="button"
          onClick={onClick}
          initial={{ opacity: 0, x: -8 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -8 }}
          whileTap={{ scale: 0.97 }}
          className="inline-flex h-11 items-center justify-center gap-1.5 rounded-2xl bg-neutral-100 px-4 text-sm font-semibold text-neutral-800 transition-colors hover:bg-neutral-200/90"
        >
          <ArrowLeftIcon className="size-4" />
          Back
        </motion.button>
      )}
    </AnimatePresence>
  );
}

export function TextButton({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-lg px-2 py-1 text-xs font-medium text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-900"
    >
      {children}
    </button>
  );
}

export function ProgressBar({ value, tone = "dark" }: { value: number; tone?: "dark" | "ok" | "primary" }) {
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-neutral-200/80">
      <motion.div
        initial={false}
        animate={{ width: `${Math.max(0, Math.min(100, value))}%` }}
        transition={{ duration: 0.5, ease: EASE }}
        className={cn(
          "h-full rounded-full",
          value >= 100 || tone === "ok" ? "bg-emerald-500" : tone === "primary" ? "bg-primary" : "bg-neutral-900",
        )}
      />
    </div>
  );
}

/** A ring that fills to `value / max`, with the count in the middle. */
export function ReadinessRing({
  value,
  max,
  checking,
  size = 104,
}: {
  value: number;
  max: number;
  checking?: boolean;
  size?: number;
}) {
  const stroke = 9;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = max ? value / max : 0;
  const full = pct >= 1;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#f5f5f5" strokeWidth={stroke} />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          initial={{ strokeDashoffset: c }}
          animate={{ strokeDashoffset: c * (1 - pct) }}
          transition={{ duration: 0.6, ease: EASE }}
          className={cn("transition-colors", full ? "stroke-emerald-500" : "stroke-primary")}
        />
      </svg>
      {checking && (
        <motion.span
          className="absolute inset-0 rounded-full border-[3px] border-transparent border-t-neutral-900/60"
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
        />
      )}
      <div className="absolute inset-0 flex flex-col items-center justify-center leading-none">
        <motion.span
          key={value}
          initial={{ scale: 1.25, opacity: 0.4 }}
          animate={{ scale: 1, opacity: 1 }}
          className="text-2xl font-bold tabular-nums text-neutral-900"
        >
          {value}
        </motion.span>
        <span className="mt-1 text-[11px] font-medium text-neutral-500">of {max}</span>
      </div>
    </div>
  );
}

export type CheckState = "checking" | "ok" | "warn" | "missing" | "error";

/** One line of a readiness check: what, why, and how it went. */
export function CheckRow({
  icon,
  title,
  detail,
  state,
  label,
  action,
}: {
  icon: ReactNode;
  title: string;
  detail?: ReactNode;
  state: CheckState;
  /** Text next to the status mark, e.g. "Ready" or a version. */
  label?: string;
  action?: ReactNode;
}) {
  return (
    <motion.div
      layout
      className={cn(
        "flex items-center gap-3 rounded-2xl border px-3 py-2.5 transition-colors duration-300",
        state === "ok" && "border-emerald-200/70 bg-emerald-50/50",
        state === "warn" && "border-amber-200/70 bg-amber-50/50",
        state === "error" && "border-red-200/70 bg-red-50/50",
        (state === "missing" || state === "checking") && "border-neutral-200/90 bg-neutral-50/80",
      )}
    >
      <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-white ring-1 ring-neutral-200/80">
        {icon}
      </div>
      <div className="flex min-w-0 flex-1 flex-col leading-tight">
        <span className="truncate text-sm font-semibold text-neutral-900">{title}</span>
        {detail ? <span className="mt-0.5 truncate text-xs text-neutral-500">{detail}</span> : null}
      </div>
      {action}
      <StatusMark state={state} label={label} />
    </motion.div>
  );
}

function StatusMark({ state, label }: { state: CheckState; label?: string }) {
  const tone = {
    checking: "text-neutral-500",
    ok: "text-emerald-700",
    warn: "text-amber-800",
    missing: "text-neutral-500",
    error: "text-red-600",
  }[state];
  return (
    <span className={cn("flex shrink-0 items-center gap-1.5 text-[11px] font-semibold", tone)}>
      {label && <span className="hidden sm:inline">{label}</span>}
      <span className="relative flex size-5 items-center justify-center">
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span
            key={state}
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0, opacity: 0 }}
            transition={{ type: "spring", stiffness: 520, damping: 26 }}
            className={cn(
              "flex size-5 items-center justify-center rounded-full",
              state === "ok" && "bg-emerald-500 text-white",
              state === "warn" && "bg-amber-400 text-white",
              state === "error" && "bg-red-500 text-white",
              state === "missing" && "bg-neutral-200 text-neutral-500",
            )}
          >
            {state === "checking" && <LoaderIcon className="size-4 animate-spin" />}
            {state === "ok" && <CheckIcon className="size-3" strokeWidth={3.5} />}
            {state === "warn" && <AlertTriangleIcon className="size-3" strokeWidth={3} />}
            {state === "error" && <XIcon className="size-3" strokeWidth={3.5} />}
            {state === "missing" && <MinusIcon className="size-3" strokeWidth={3.5} />}
          </motion.span>
        </AnimatePresence>
      </span>
    </span>
  );
}

export function CheckGroup({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between px-1">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">{title}</h3>
        {aside}
      </div>
      <div className="flex flex-col gap-1.5">{children}</div>
    </section>
  );
}

export type GuideCardAccent = {
  icon: string;
  hoverBorder: string;
  hoverGlow: string;
};

/** 2×2 feature tiles on the guide step — lift, glow, and accent on hover. */
export function GuideFeatureCard({
  index,
  icon: Icon,
  title,
  text,
  accent,
  active,
  onActivate,
  delay = 0,
}: {
  index: number;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  text: string;
  accent: GuideCardAccent;
  active: boolean;
  onActivate: () => void;
  delay?: number;
}) {
  return (
    <motion.button
      type="button"
      onMouseEnter={onActivate}
      onFocus={onActivate}
      initial={{ opacity: 0, y: 0 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: 0 }}
      whileTap={{ y: -2 }}
      transition={{ delay, duration: 0.4, ease: EASE }}
      className={cn(
        "group relative flex flex-col gap-3 overflow-hidden rounded-[1.35rem] border p-4 text-left sm:rounded-[1.5rem] sm:p-[1.125rem]",
        "transition-[box-shadow,border-color,background-color] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
        active
          ? cn("border-neutral-300/90 bg-white shadow-[0_14px_44px_-18px_rgba(15,23,42,0.2)]", accent.hoverBorder)
          : "border-neutral-200/80 bg-neutral-50/90 shadow-[0_2px_14px_-6px_rgba(15,23,42,0.1)]",
        !active && cn("hover:border-neutral-300/90 hover:bg-white hover:shadow-[0_18px_52px_-22px_rgba(15,23,42,0.24)]", accent.hoverBorder),
      )}
    >
      <div
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-0 bg-gradient-to-br opacity-0 transition-opacity duration-300",
          accent.hoverGlow,
          "group-hover:opacity-100",
          active && "opacity-70",
        )}
      />
      <div className="relative flex items-center gap-3">
        <span
          className={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br shadow-sm ring-1 ring-white/60",
            "transition-shadow duration-300 ease-out group-hover:shadow-md",
            accent.icon,
          )}
        >
          <Icon className="size-5" />
        </span>
        <span className="text-[11px] font-bold tabular-nums tracking-wider text-neutral-400 transition-colors duration-300 group-hover:text-neutral-500">
          {String(index + 1).padStart(2, "0")}
        </span>
      </div>
      <div className="relative flex flex-col gap-1">
        <p className="text-sm font-semibold text-neutral-900 transition-colors group-hover:text-neutral-950">{title}</p>
        <p className="text-xs leading-relaxed text-neutral-600 transition-colors group-hover:text-neutral-700">{text}</p>
      </div>
    </motion.button>
  );
}

/** A card the user toggles on and off. */
export function SelectCard({
  active,
  onClick,
  icon,
  title,
  detail,
  meta,
  badge,
}: {
  active: boolean;
  onClick: () => void;
  icon: ReactNode;
  title: string;
  detail?: string;
  meta?: ReactNode;
  badge?: ReactNode;
}) {
  return (
    <motion.button
      type="button"
      role="checkbox"
      aria-checked={active}
      onClick={onClick}
      whileHover={{ y: -3 }}
      whileTap={{ y: -1 }}
      transition={{ type: "spring", stiffness: 420, damping: 28 }}
      className={cn(
        "group relative flex h-full w-full flex-col gap-3 overflow-hidden rounded-[1.25rem] border p-3.5 text-left",
        "shadow-[0_2px_14px_-6px_rgba(15,23,42,0.1)] transition-[box-shadow,border-color,background-color] duration-300",
        active
          ? "border-primary/45 bg-white shadow-[0_12px_36px_-16px_rgba(15,23,42,0.18)] ring-1 ring-primary/20"
          : "border-neutral-200/85 bg-neutral-50/85 hover:border-neutral-300 hover:bg-white hover:shadow-[0_16px_44px_-18px_rgba(15,23,42,0.2)]",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-white shadow-sm ring-1 ring-neutral-200/80 transition-transform duration-300 group-hover:scale-[1.05] group-hover:shadow-md">
          {icon}
        </div>
        <div className="flex items-center gap-1.5">
          {badge}
          <span
            className={cn(
              "flex size-5 items-center justify-center rounded-full transition-colors",
              active ? "bg-neutral-900 text-white" : "bg-white ring-1 ring-neutral-300",
            )}
          >
            <AnimatePresence initial={false}>
              {active && (
                <motion.span
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  exit={{ scale: 0 }}
                  transition={{ type: "spring", stiffness: 600, damping: 26 }}
                >
                  <CheckIcon className="size-3" strokeWidth={3.5} />
                </motion.span>
              )}
            </AnimatePresence>
          </span>
        </div>
      </div>
      <div className="flex flex-col gap-0.5">
        <p className="text-sm font-semibold leading-snug text-neutral-900">{title}</p>
        {detail ? <p className="line-clamp-2 text-xs leading-relaxed text-neutral-500">{detail}</p> : null}
      </div>
      {meta ? <div className="mt-auto text-[11px] text-neutral-500">{meta}</div> : null}
    </motion.button>
  );
}

export function StatusChip({
  tone,
  children,
}: {
  tone: "ok" | "warn" | "muted" | "accent" | "error";
  children: ReactNode;
}) {
  const styles = {
    ok: "bg-emerald-500/15 text-emerald-700",
    warn: "bg-amber-500/15 text-amber-800",
    muted: "bg-neutral-100 text-neutral-600",
    accent: "bg-primary/15 text-primary-foreground",
    error: "bg-red-500/10 text-red-600",
  }[tone];
  return (
    <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold", styles)}>{children}</span>
  );
}

export function MiniBadge({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-violet-500/15 px-2 py-0.5 text-[10px] font-medium text-violet-700">
      <SparklesIcon className="size-3" />
      {children}
    </span>
  );
}

/** A soft note box: info, warning or problem. */
export function Note({
  tone = "muted",
  icon,
  children,
  action,
}: {
  tone?: "muted" | "warn" | "error" | "ok";
  icon?: ReactNode;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        "flex items-start gap-2.5 rounded-2xl px-3.5 py-3 text-xs leading-relaxed",
        tone === "muted" && "bg-neutral-100/80 text-neutral-600",
        tone === "warn" && "bg-amber-500/10 text-amber-800",
        tone === "error" && "bg-red-500/10 text-red-700",
        tone === "ok" && "bg-emerald-500/10 text-emerald-800",
      )}
    >
      {icon && <span className="mt-0.5 shrink-0">{icon}</span>}
      <div className="min-w-0 flex-1">{children}</div>
      {action}
    </motion.div>
  );
}
