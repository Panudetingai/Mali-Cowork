"use client";

import { CoworkBot } from "@/components/anim/cowork-bot";
import type { BotState } from "@/features/cowork-bot";
import { cn } from "@/lib/utils";
import { AnimatePresence, motion } from "motion/react";
import { ArrowRightIcon, ListChecksIcon, PlugZapIcon, ScanSearchIcon, ShieldCheckIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { EASE } from "./onboarding-ui";

const LINES = ["Warming up Mali…", "Getting your workspace ready…", "Let's set things up."];

/** What setup will do, shown before it starts. */
const PREVIEW = [
  { icon: ScanSearchIcon, label: "Check your system" },
  { icon: ListChecksIcon, label: "Install what's missing" },
  { icon: PlugZapIcon, label: "Switch on tools" },
  { icon: ShieldCheckIcon, label: "Make sure it works" },
];

export function OnboardingIntro({ onDone }: { onDone: () => void }) {
  const [botState, setBotState] = useState<BotState>("thinking");
  const [line, setLine] = useState(0);

  useEffect(() => {
    const t1 = setTimeout(() => setBotState("welcome"), 900);
    const t2 = setTimeout(() => setBotState("tool"), 2200);
    const t3 = setTimeout(() => setBotState("done"), 3200);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
  }, []);

  useEffect(() => {
    const id = setInterval(() => setLine((n) => (n + 1) % LINES.length), 1600);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="relative flex w-full flex-col items-center justify-center px-2 py-4">
      <motion.div
        initial={{ opacity: 0, y: 24, scale: 0.94 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.6, ease: EASE }}
        className="flex w-full flex-col items-center gap-8 text-center"
      >
        <div className="relative">
          {/* Orbiting dots around the bot. */}
          <motion.div
            className="absolute -inset-8 rounded-full border border-dashed border-neutral-200"
            animate={{ rotate: 360 }}
            transition={{ duration: 24, repeat: Infinity, ease: "linear" }}
          >
            {["bg-sky-300", "bg-pink-300", "bg-violet-300"].map((color, i) => (
              <span
                key={color}
                className={cn("absolute size-2.5 rounded-full", color)}
                style={{
                  left: `${50 + 50 * Math.cos((i * 2 * Math.PI) / 3)}%`,
                  top: `${50 + 50 * Math.sin((i * 2 * Math.PI) / 3)}%`,
                  transform: "translate(-50%, -50%)",
                }}
              />
            ))}
          </motion.div>
          <div className="relative flex items-center justify-center rounded-[2rem] bg-white p-6 shadow-[0_20px_50px_-24px_rgba(15,23,42,0.2)] ring-1 ring-neutral-200/80">
            <motion.div animate={{ y: [0, -6, 0] }} transition={{ duration: 2.8, repeat: Infinity, ease: "easeInOut" }}>
              <CoworkBot state={botState} size={140} theme="light" />
            </motion.div>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <h1 className="text-3xl font-bold tracking-tight text-neutral-900 sm:text-4xl">Welcome to Mali Cowork</h1>
          <div className="relative h-6 overflow-hidden">
            <AnimatePresence mode="wait">
              <motion.p
                key={line}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.35 }}
                className="text-sm text-neutral-500 sm:text-base"
              >
                {LINES[line]}
              </motion.p>
            </AnimatePresence>
          </div>
        </div>

        <ol className="grid w-full grid-cols-2 gap-2 sm:grid-cols-4">
          {PREVIEW.map((item, i) => {
            const Icon = item.icon;
            return (
              <motion.li
                key={item.label}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.4 + i * 0.1, duration: 0.4, ease: EASE }}
                className="flex flex-col items-center gap-2 rounded-2xl border border-neutral-200/80 bg-white/80 px-3 py-3 shadow-sm backdrop-blur-sm"
              >
                <span className="flex size-8 items-center justify-center rounded-xl bg-neutral-100 text-neutral-800">
                  <Icon className="size-4" />
                </span>
                <span className="text-[11px] font-semibold leading-tight text-neutral-700">{item.label}</span>
              </motion.li>
            );
          })}
        </ol>

        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.9, duration: 0.4 }}
          className="flex flex-col items-center gap-2"
        >
          <motion.button
            type="button"
            onClick={onDone}
            whileHover={{ y: -2 }}
            whileTap={{ scale: 0.97 }}
            className="inline-flex h-12 min-w-[220px] items-center justify-center gap-2 rounded-2xl bg-neutral-900 px-8 text-[15px] font-semibold text-white shadow-lg transition-colors hover:bg-neutral-800"
          >
            Get started
            <ArrowRightIcon className="size-4" />
          </motion.button>
          <span className="text-xs text-neutral-500">Takes about 2 minutes</span>
        </motion.div>
      </motion.div>
    </div>
  );
}
