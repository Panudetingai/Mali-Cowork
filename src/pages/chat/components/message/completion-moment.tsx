"use client";

/**
 * Under a finished Cowork turn (PRD v0.3 Q3): one line of what the agent did —
 * "แก้ 6 ไฟล์ · 3 นาที · $0.04" — and, when it has only just finished, the
 * mascot's short celebration. Opening an old chat shows the line, quietly.
 */
import { CoworkBot } from "@/components/anim/cowork-bot";
import { useTranslation } from "@/features/i18n";
import { completionParts, type WorkReceipt } from "@/features/work-receipt";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { CheckCircle2Icon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

/** How long the celebration stays before the line settles. */
const CELEBRATE_MS = 1600;

export function CompletionMoment({ receipt, onOpen }: { receipt?: WorkReceipt; onOpen?: () => void }) {
  const { lang } = useTranslation();
  const reduceMotion = useReducedMotion();
  const [celebrating, setCelebrating] = useState(false);
  // The receipt appears when the turn's files are saved, right as it finishes.
  const hadReceipt = useRef(!!receipt);

  useEffect(() => {
    if (!receipt || hadReceipt.current) return;
    hadReceipt.current = true;
    if (reduceMotion) return;
    setCelebrating(true);
    const timer = window.setTimeout(() => setCelebrating(false), CELEBRATE_MS);
    return () => window.clearTimeout(timer);
  }, [receipt, reduceMotion]);

  if (!receipt || receipt.state === "undone") return null;
  const parts = completionParts(receipt, lang === "th" ? "th" : "en");
  if (parts.length === 0) return null;

  return (
    <motion.button
      type="button"
      onClick={onOpen}
      initial={celebrating ? { opacity: 0, y: 6 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 420, damping: 30 }}
      title={lang === "th" ? "ดูสรุปงาน" : "Open the work receipt"}
      className="group mt-1 flex max-w-full items-center gap-2 rounded-full border border-emerald-500/25 bg-emerald-500/[0.06] py-1 pr-3 pl-1.5 text-xs text-emerald-800 transition-colors hover:bg-emerald-500/10 dark:text-emerald-200"
    >
      <AnimatePresence mode="wait" initial={false}>
        {celebrating ? (
          <motion.span key="bot" initial={{ scale: 0.6 }} animate={{ scale: 1 }} exit={{ scale: 0.6, opacity: 0 }} className="-my-2 flex">
            <CoworkBot size={30} state="done" />
          </motion.span>
        ) : (
          <motion.span key="check" initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="flex">
            <CheckCircle2Icon className="size-4 text-emerald-600 dark:text-emerald-400" />
          </motion.span>
        )}
      </AnimatePresence>
      <span className="truncate">{parts.join(" · ")}</span>
    </motion.button>
  );
}
