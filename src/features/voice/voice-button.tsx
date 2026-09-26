"use client";

import { cn } from "@/lib/utils";
import { AnimatePresence, motion } from "motion/react";
import { MicIcon, MicOffIcon } from "lucide-react";
import type { useSpeechInput } from "./use-speech-input";

type Voice = ReturnType<typeof useSpeechInput>;

/** Mic toggle for dictation; while listening it shows live bars and the language, tap to switch. */
export function VoiceButton({
  voice,
  disabled,
  size = "md",
  className,
}: {
  voice: Voice;
  disabled?: boolean;
  size?: "sm" | "md";
  className?: string;
}) {
  if (!voice.supported) return null;
  const { listening, lang } = voice;
  const box = size === "sm" ? "h-7" : "h-8";

  return (
    <div className={cn("flex items-center gap-1", className)}>
      <AnimatePresence initial={false}>
        {listening && (
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
        disabled={disabled && !listening}
        onClick={voice.toggle}
        aria-pressed={listening}
        aria-label={listening ? "Stop voice input" : "Voice input"}
        title={listening ? "Listening… click to stop" : "Voice input — speak to type"}
        className={cn(
          box,
          "relative inline-flex items-center justify-center gap-1 rounded-full text-muted-foreground transition-all",
          listening
            ? "bg-red-500 px-2.5 text-white shadow-[0_0_0_4px] shadow-red-500/15 hover:bg-red-600"
            : "w-8 hover:bg-accent hover:text-foreground disabled:opacity-40",
          size === "sm" && !listening && "w-7",
        )}
      >
        {listening ? (
          <>
            <MicOffIcon className="size-3.5" />
            <span className="flex h-3 items-center gap-[2px]" aria-hidden>
              {[0, 0.15, 0.3, 0.45].map((delay) => (
                <span
                  key={delay}
                  className="h-full w-[2px] origin-center animate-[voice-bar_0.9s_ease-in-out_infinite] rounded-full bg-white"
                  style={{ animationDelay: `${delay}s` }}
                />
              ))}
            </span>
          </>
        ) : (
          <MicIcon className="size-4" />
        )}
      </button>
    </div>
  );
}
