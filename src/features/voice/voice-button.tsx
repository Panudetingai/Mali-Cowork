"use client";

import { cn } from "@/lib/utils";
import { AnimatePresence, motion } from "motion/react";
import { LoaderIcon, MicIcon, SquareIcon } from "lucide-react";
import type { VoiceInput } from "./use-voice-input";
import { Waveform } from "./waveform";

/**
 * Mic toggle. Listening: red, with bars that follow the voice (and the
 * language, tap to switch, for system dictation). A model then shows it's
 * writing the words down.
 */
export function VoiceButton({
  voice,
  disabled,
  size = "md",
  className,
}: {
  voice: VoiceInput;
  disabled?: boolean;
  size?: "sm" | "md";
  className?: string;
}) {
  if (!voice.supported) return null;
  const { listening, lang, phase } = voice;
  const box = size === "sm" ? "h-7" : "h-8";
  const transcribing = phase === "transcribing";

  return (
    <div className={cn("flex items-center gap-1", className)}>
      <AnimatePresence initial={false}>
        {listening && voice.engine === "system" && (
          <motion.button
            key="lang"
            type="button"
            initial={{ opacity: 0, x: 6, scale: 0.9 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 6, scale: 0.9 }}
            transition={{ duration: 0.15 }}
            onClick={() => voice.setLang(lang === "th-TH" ? "en-US" : "th-TH")}
            title="Dictation language — click to switch"
            className={cn(
              box,
              "rounded-full border border-red-500/30 bg-red-500/10 px-2 text-[10px] font-semibold tracking-wide text-red-600 transition-colors hover:bg-red-500/20 dark:text-red-400",
            )}
          >
            {lang === "th-TH" ? "TH" : "EN"}
          </motion.button>
        )}
      </AnimatePresence>
      <button
        type="button"
        disabled={(disabled && !listening) || transcribing}
        onClick={voice.toggle}
        aria-pressed={listening}
        aria-label={listening ? "Stop voice input" : transcribing ? "Writing down what you said" : "Voice input"}
        title={listening ? "Listening… click to stop" : transcribing ? "Writing it down…" : "Voice input — speak to type"}
        className={cn(
          box,
          "relative inline-flex items-center justify-center gap-1.5 rounded-full text-muted-foreground transition-all",
          listening
            ? "bg-red-500 px-2.5 text-white shadow-[0_0_0_4px] shadow-red-500/15 hover:bg-red-600"
            : transcribing
              ? "bg-muted px-2.5 text-foreground"
              : "w-8 hover:bg-accent hover:text-foreground disabled:opacity-40",
          size === "sm" && !listening && !transcribing && "w-7",
        )}
      >
        {listening ? (
          <>
            <SquareIcon className="size-2.5 fill-current" />
            <Waveform level={voice.level} bars={4} className="h-3 gap-[2px]" barClassName="w-[2px] bg-white" />
          </>
        ) : transcribing ? (
          <>
            <LoaderIcon className="size-3.5 animate-spin" />
            <span className="text-[11px] font-medium">Writing…</span>
          </>
        ) : (
          <MicIcon className="size-4" />
        )}
      </button>
    </div>
  );
}
