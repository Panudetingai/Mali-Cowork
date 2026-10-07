"use client";

/**
 * Talking with Mali: a full-window voice conversation over the chat. Speak,
 * and a pause sends it; the reply is read back in the voice from Settings →
 * Voice; then it listens again — hands-free until ✕. Every turn goes through
 * the chat as usual, so when the call ends the whole conversation is there as
 * text.
 *
 * Your cowork bot sits in the middle and acts the call out: ears up while it
 * listens, thinking while it waits, its mouth moving with Mali's voice while it
 * speaks. The same light 2D bot as everywhere else: no WebGL.
 */
import { CoworkBot } from "@/components/anim/cowork-bot";
import type { BotState } from "@/features/cowork-bot";
import { useTranslation } from "@/features/i18n";
import { PermissionPrompt, type PermissionReply } from "@/features/opencode";
import type { PermissionRequest } from "@/pages/chat/api/chat";
import { cn } from "@/lib/utils";
import { MALI_EASE } from "@/lib/motion-presets";
import { MicIcon, PauseIcon, PlayIcon, Volume2Icon, XIcon } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useTheme } from "next-themes";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type RefObject } from "react";
import { createPortal } from "react-dom";
import { speak, speakable, speakerLevel, speakerState, stopSpeaking, subscribeSpeaker } from "./speech";
import { useVoiceSettings } from "./settings";
import { useVoiceInput } from "./use-voice-input";
import { refineVoiceTranscript, voiceConfirmNo, voiceConfirmYes } from "./voice-refine";

/** The latest assistant message in the chat. */
export type VoiceModeReply = { id: string; text: string; streaming: boolean };

type Phase = "listening" | "thinking" | "speaking" | "paused" | "permission" | "confirming";

/** Map spoken approval/denial to a permission reply. */
function voicePermissionIntent(text: string): PermissionReply | null {
  const plain = text
    .trim()
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[.!?,…]/g, "")
    .trim();
  if (!plain) return null;
  if (/^(deny|no|reject|cancel|stop|nope|ไม่|ปฏิเสธ|ยกเลิก|ไม่เอา|ไม่อนุญาต)/.test(plain)) return "reject";
  if (/^(always|always allow|อนุญาตเสมอ|อนุญาตตลอด)/.test(plain)) return "always";
  if (/^(allow|yes|yeah|yep|ok|okay|approve|sure|go ahead|อนุญาต|ตกลง|โอเค|ได้|เอา|ใช่)/.test(plain)) return "once";
  return null;
}

/** A listening session that ends with nothing said this soon failed, rather than heard silence. */
const FAILED_WITHIN_MS = 1_000;
/** Nothing said for this long: stop listening until the user taps. */
const IDLE_MS = 45_000;
/** After the last word: wait this long before sending (room to breathe or correct). */
const TURN_SILENCE_MS = 3_200;
/** Shorter pause when answering yes/no to a correction check. */
const CONFIRM_SILENCE_MS = 2_400;

export function VoiceMode({
  onClose,
  send,
  reply,
  busy,
  permissions = [],
  onReplyPermission,
  onAllowFolder,
}: {
  onClose: () => void;
  /** Send what was said to the chat; false if it couldn't go. */
  send: (text: string) => Promise<boolean>;
  reply: VoiceModeReply | undefined;
  /** The chat is answering (or working). */
  busy: boolean;
  permissions?: PermissionRequest[];
  onReplyPermission?: (request: PermissionRequest, reply: PermissionReply) => Promise<void>;
  onAllowFolder?: (request: PermissionRequest, folder: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  const settings = useVoiceSettings();
  const speaker = useSyncExternalStore(subscribeSpeaker, speakerState);
  const [phase, setPhase] = useState<Phase>("listening");
  const [heard, setHeard] = useState("");
  const [answer, setAnswer] = useState("");
  const [note, setNote] = useState<string>();
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const closed = useRef(false);
  /** The reply that was last there when something was sent: the next one answers it. */
  const before = useRef<string | undefined>(undefined);
  /** When listening started, and whether the mic actually came on since. */
  const listenStarted = useRef(0);
  const armed = useRef(false);
  const permissionRef = useRef(permissions);
  permissionRef.current = permissions;
  const permissionRequest = permissions[0];
  const permissionRisky = !!permissionRequest?.detail?.startsWith("⚠");
  /** Message waiting for “yes” after a self-correction. */
  const pendingSend = useRef<string | null>(null);

  const voice = useVoiceInput({
    autoStop: true,
    idleMs: IDLE_MS,
    silenceMs: TURN_SILENCE_MS,
    onStart: () => setHeard(""),
    onText: (text) => setHeard(text),
    onEnd: (text) => {
      if (closed.current) return;
      if (phaseRef.current === "permission") {
        void answerPermissionByVoice(text);
        return;
      }
      if (phaseRef.current === "confirming") {
        void answerConfirmByVoice(text);
        return;
      }
      if (phaseRef.current !== "listening") return;
      const said = text.trim();
      if (said) {
        void finishTurn(said);
        return;
      }
      // Silence (or a cough) just listens on; a session that died at once
      // didn't hear anything at all, and would only fail again.
      if (performance.now() - listenStarted.current < FAILED_WITHIN_MS) {
        setPhase("paused");
        return;
      }
      void listen();
    },
  });
  const voiceRef = useRef(voice);
  voiceRef.current = voice;

  const listen = useCallback(async () => {
    if (closed.current) return;
    pendingSend.current = null;
    stopSpeaking();
    setNote(undefined);
    setPhase("listening");
    armed.current = false;
    listenStarted.current = performance.now();
    await voiceRef.current.start({ silenceMs: TURN_SILENCE_MS });
  }, []);

  const listenForConfirm = useCallback(async () => {
    if (closed.current) return;
    stopSpeaking();
    setNote(undefined);
    setPhase("confirming");
    armed.current = false;
    listenStarted.current = performance.now();
    await voiceRef.current.start({ silenceMs: CONFIRM_SILENCE_MS });
  }, []);

  const finishTurn = async (said: string) => {
    const refined = refineVoiceTranscript(said);
    const toSend = refined.text.trim();
    if (!toSend) {
      void listen();
      return;
    }
    if (refined.needsConfirm && refined.confirmHint) {
      pendingSend.current = toSend;
      setHeard(toSend);
      setPhase("confirming");
      const line = t("voiceModeConfirmSay", { word: refined.confirmHint });
      await speak(line, settings, { id: "voice-mode-confirm" });
      if (closed.current || phaseRef.current !== "confirming") return;
      void listenForConfirm();
      return;
    }
    void ask(toSend);
  };

  const answerConfirmByVoice = async (text: string) => {
    const plain = text.trim();
    const queued = pendingSend.current;
    if (!queued) {
      void listen();
      return;
    }
    if (voiceConfirmYes(plain)) {
      pendingSend.current = null;
      void ask(queued);
      return;
    }
    if (voiceConfirmNo(plain)) {
      pendingSend.current = null;
      setNote(undefined);
      void listen();
      return;
    }
    if (plain) {
      pendingSend.current = null;
      void finishTurn(plain);
      return;
    }
    void listenForConfirm();
  };

  const ask = async (text: string) => {
    setPhase("thinking");
    setHeard(text);
    setAnswer("");
    before.current = reply?.id;
    const sent = await send(text);
    if (!sent && !closed.current) {
      setNote(t("voiceModeNotSent"));
      setPhase("paused");
    }
  };

  const answerPermissionByVoice = async (text: string) => {
    const request = permissionRef.current[0];
    if (!request || !onReplyPermission) {
      void listen();
      return;
    }
    let intent = voicePermissionIntent(text);
    if (intent === "always" && permissionRisky) intent = "once";
    if (!intent) {
      setNote(t("voiceModePermissionUnknown"));
      void listen();
      return;
    }
    setNote(undefined);
    setHeard(text.trim());
    await onReplyPermission(request, intent);
    if (!closed.current) setPhase("thinking");
  };

  const listenForPermission = useCallback(async () => {
    if (closed.current) return;
    stopSpeaking();
    setNote(undefined);
    setPhase("permission");
    setHeard("");
    armed.current = false;
    listenStarted.current = performance.now();
    await voiceRef.current.start();
  }, []);

  // Agent needs approval: show the card and listen for “allow” / “อนุญาต”.
  useEffect(() => {
    if (permissions.length === 0) {
      if (phaseRef.current === "permission") setPhase("thinking");
      return;
    }
    if (phaseRef.current === "permission") return;
    voiceRef.current.cancel();
    stopSpeaking();
    void listenForPermission();
  }, [permissions.length, permissions[0]?.id, listenForPermission]);

  // Start listening as soon as it opens; end everything when it closes.
  useEffect(() => {
    closed.current = false;
    void listen();
    return () => {
      closed.current = true;
      voiceRef.current.cancel();
      stopSpeaking();
    };
  }, [listen]);

  // The mic went off without a word (gave up after a long silence): wait for a tap.
  useEffect(() => {
    if (voice.listening) armed.current = true;
    else if (armed.current && voice.phase === "idle" && phase === "listening") {
      armed.current = false;
      const timer = setTimeout(() => {
        if (phaseRef.current === "listening" && voiceRef.current.phase === "idle") setPhase("paused");
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [voice.listening, voice.phase, phase]);

  // A mic or transcription error pauses the call and says why.
  useEffect(() => {
    if (!voice.error) return;
    setNote(voice.error);
    setPhase("paused");
    voice.clearError();
  }, [voice.error]);

  // The answer is in: read it out, then listen again.
  useEffect(() => {
    if (phase !== "thinking" || busy) return;
    if (!reply || reply.id === before.current || reply.streaming) {
      // The chat stopped without answering (an error, or Stop).
      const timer = setTimeout(() => {
        if (phaseRef.current === "thinking" && !closed.current) {
          setNote(t("voiceModeNoAnswer"));
          setPhase("paused");
        }
      }, 1_500);
      return () => clearTimeout(timer);
    }
    const text = reply.text;
    if (!speakable(text)) {
      void listen();
      return;
    }
    setAnswer(speakable(text));
    setPhase("speaking");
    void speak(text, settings, { id: "voice-mode" }).then((finished) => {
      if (closed.current || phaseRef.current !== "speaking") return;
      if (!finished && speakerState().error) setNote(speakerState().error);
      void listen();
    });
  }, [phase, busy, reply?.id, reply?.streaming]);

  const tapBot = () => {
    if (phase === "permission") {
      if (!voice.listening) void listenForPermission();
      else voice.stop();
      return;
    }
    if (phase === "confirming") {
      if (!voice.listening) void listenForConfirm();
      else voice.stop();
      return;
    }
    if (phase === "speaking" || phase === "paused") void listen();
    else if (phase === "listening" && voice.listening) voice.stop();
  };

  const togglePause = () => {
    if (phase === "permission" || phase === "confirming") return;
    if (phase === "paused") {
      void listen();
      return;
    }
    voice.cancel();
    stopSpeaking();
    setPhase("paused");
  };

  // Esc ends the call; Space pauses or resumes.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (permissions.length > 0) {
        // PermissionPrompt owns Esc / ⌘↵ while the agent waits.
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      } else if (event.key === " " && !(event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLInputElement)) {
        event.preventDefault();
        togglePause();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const transcribing = phase === "listening" && voice.phase === "transcribing";
  const preparing = phase === "speaking" && speaker.loading;
  const status =
    phase === "confirming"
      ? transcribing
        ? t("voiceModeWriting")
        : heard
          ? t("voiceModeConfirmListen")
          : t("voiceModeConfirming")
      : phase === "permission"
      ? transcribing
        ? t("voiceModeWriting")
        : heard
          ? t("voiceModePermissionListen")
          : t("voiceModePermission")
      : phase === "paused"
      ? t("voiceModePaused")
      : phase === "thinking"
        ? t("voiceModeThinking")
        : phase === "speaking"
          ? preparing
            ? t("voiceModePreparing")
            : t("voiceModeSpeaking")
          : transcribing
            ? t("voiceModeWriting")
            : heard
              ? t("voiceModeListening")
              : t("voiceModeStart");
  const level =
    phase === "speaking" && speaker.metered ? speakerLevel : phase === "listening" && voice.level ? voice.level : undefined;
  // Writing down what you said, or getting the voice ready, is thinking too.
  const pose: BotState =
    phase === "permission"
      ? "permission"
      : phase === "confirming"
        ? transcribing
          ? "thinking"
          : "listening"
      : phase === "paused"
      ? "idle"
      : phase === "thinking" || transcribing || preparing
        ? "thinking"
        : phase === "speaking"
          ? "speaking"
          : "listening";
  const caption = phase === "speaking" || (phase === "paused" && answer) ? answer : heard;
  const { resolvedTheme } = useTheme();
  const dark = resolvedTheme !== "light";
  const reduceMotion = useReducedMotion();
  const botTheme = dark ? "dark" : "light";
  const listeningLive =
    (phase === "listening" || phase === "permission" || phase === "confirming") &&
    voice.listening &&
    !transcribing;

  const ink = dark
    ? {
        panel:
          "border-white/[0.08] bg-[#141418]/82 shadow-[0_24px_80px_-24px_rgba(0,0,0,0.75)] ring-1 ring-white/[0.06]",
        caption: phase === "speaking" ? "text-white/88" : "text-white/58",
        status: "text-white/72",
        hint: "text-white/38",
        icon: "text-white/78",
        orbA: "bg-white/10",
        orbB: "bg-white/8",
        orbC: "bg-white/6",
        pauseBtn: "text-white/88 ring-white/22 hover:bg-white/10",
        focusRing: "focus-visible:ring-white/50 focus-visible:ring-offset-[#141418]",
      }
    : {
        panel:
          "border-black/[0.06] bg-background/88 shadow-[0_24px_80px_-28px_rgba(15,23,42,0.22)] ring-1 ring-black/[0.04]",
        caption: phase === "speaking" ? "text-foreground/90" : "text-muted-foreground",
        status: "text-muted-foreground",
        hint: "text-muted-foreground/55",
        icon: "text-foreground/75",
        orbA: "bg-foreground/8",
        orbB: "bg-foreground/6",
        orbC: "bg-foreground/5",
        pauseBtn: "text-foreground/85 ring-border/80 hover:bg-muted/80",
        focusRing: "focus-visible:ring-foreground/25 focus-visible:ring-offset-background",
      };

  return createPortal(
    <motion.div
      role="dialog"
      aria-modal="true"
      aria-label={t("voiceModeOpen")}
      className="fixed inset-0 z-[80] flex items-stretch justify-center p-0 sm:p-0"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: reduceMotion ? 0.12 : 0.28, ease: MALI_EASE }}
    >
      <motion.div
        aria-hidden
        className={cn(
          "absolute inset-0 rounded-[var(--window-radius)] backdrop-blur-xl backdrop-saturate-150",
          dark ? "bg-black/48" : "bg-background/55",
        )}
        initial={{ opacity: 0, backdropFilter: "blur(0px)" }}
        animate={{ opacity: 1, backdropFilter: "blur(20px)" }}
        exit={{ opacity: 0 }}
        transition={{ duration: reduceMotion ? 0.12 : 0.35, ease: MALI_EASE }}
      />

      <motion.div
        className={cn(
          "relative flex min-h-0 w-full max-w-none flex-1 flex-col overflow-hidden rounded-none border-0 backdrop-blur-2xl sm:rounded-none",
          ink.panel,
        )}
        initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 14, scale: 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 10, scale: 0.99 }}
        transition={{ duration: reduceMotion ? 0.12 : 0.38, ease: MALI_EASE }}
      >
        {!reduceMotion && (
          <>
            <motion.div
              aria-hidden
              className={cn("pointer-events-none absolute -top-24 left-1/4 size-72 rounded-full blur-3xl", ink.orbA)}
              animate={{ x: [0, 24, 0], y: [0, 18, 0], opacity: [0.45, 0.7, 0.45] }}
              transition={{ duration: 9, repeat: Infinity, ease: "easeInOut" }}
            />
            <motion.div
              aria-hidden
              className={cn("pointer-events-none absolute -bottom-20 right-0 size-80 rounded-full blur-3xl", ink.orbB)}
              animate={{ x: [0, -20, 0], y: [0, -14, 0], opacity: [0.35, 0.55, 0.35] }}
              transition={{ duration: 11, repeat: Infinity, ease: "easeInOut" }}
            />
            <motion.div
              aria-hidden
              className={cn("pointer-events-none absolute top-1/3 -right-16 size-56 rounded-full blur-3xl", ink.orbC)}
              animate={{ scale: [1, 1.12, 1], opacity: [0.25, 0.45, 0.25] }}
              transition={{ duration: 7, repeat: Infinity, ease: "easeInOut" }}
            />
          </>
        )}

        <div className="relative flex min-h-0 w-full flex-1 flex-col items-center justify-center gap-8 px-5 pt-6">
          <div className="relative flex items-center justify-center">
            {listeningLive && !reduceMotion && (
              <>
                <motion.span
                  aria-hidden
                  className={cn(
                    "absolute size-[min(20rem,38vh)] rounded-full",
                    dark ? "bg-white/[0.04]" : "bg-foreground/[0.04]",
                  )}
                  animate={{ scale: [1, 1.06, 1], opacity: [0.5, 0.15, 0.5] }}
                  transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
                />
                <motion.span
                  aria-hidden
                  className={cn(
                    "absolute size-[min(18rem,34vh)] rounded-full ring-1",
                    dark ? "ring-white/15" : "ring-foreground/10",
                  )}
                  animate={{ scale: [1, 1.04, 1], opacity: [0.35, 0.7, 0.35] }}
                  transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut", delay: 0.2 }}
                />
              </>
            )}
            <motion.button
              type="button"
              onClick={tapBot}
              aria-label={status}
              className={cn("relative rounded-full outline-none focus-visible:ring-2 focus-visible:ring-offset-4", ink.focusRing)}
              whileTap={reduceMotion ? undefined : { scale: 0.97 }}
              animate={
                reduceMotion || phase === "paused"
                  ? { scale: 1 }
                  : phase === "listening"
                    ? { scale: [1, 1.015, 1] }
                    : phase === "speaking"
                      ? { scale: [1, 1.008, 1] }
                      : { scale: 1 }
              }
              transition={
                phase === "listening" || phase === "speaking"
                  ? { duration: phase === "listening" ? 2.2 : 1.6, repeat: Infinity, ease: "easeInOut" }
                  : { duration: 0.2 }
              }
            >
              <CoworkBot
                size="min(18rem, 34vh)"
                theme={botTheme}
                state={pose}
                level={level}
                className={cn("transition-opacity duration-300", phase === "paused" && "opacity-55 saturate-[0.85]")}
              />
            </motion.button>
          </div>

          <AnimatePresence mode="wait">
            <motion.p
              key={caption || "empty"}
              className={cn("line-clamp-4 min-h-[3lh] max-w-xl text-center text-[15px] leading-relaxed", ink.caption)}
              aria-live="polite"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: reduceMotion ? 0.1 : 0.22, ease: MALI_EASE }}
            >
              {caption}
            </motion.p>
          </AnimatePresence>
        </div>

        <div className="relative flex w-full flex-col items-center gap-5 px-5 pb-7 pt-2">
          {permissionRequest && onReplyPermission && (
            <div className="w-full max-w-lg shrink-0">
              <PermissionPrompt
                requests={permissions}
                onReply={onReplyPermission}
                onAllowFolder={onAllowFolder}
                className="rounded-xl border-border/80 bg-card/95 shadow-lg"
              />
            </div>
          )}
          <div
            className={cn(
              "flex w-full max-w-md flex-col items-center gap-2 rounded-[22px] px-4 py-3",
              dark ? "bg-white/[0.04] ring-1 ring-white/[0.06]" : "bg-muted/45 ring-1 ring-border/60",
            )}
            role="status"
            aria-live="polite"
          >
            <span className={cn("flex items-center gap-1.5", ink.icon)}>
              <motion.span
                key={phase === "speaking" ? "vol" : "mic"}
                initial={{ opacity: 0, scale: 0.85 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.18, ease: MALI_EASE }}
              >
                {phase === "speaking" ? <Volume2Icon className="size-3.5" /> : <MicIcon className="size-3.5" />}
              </motion.span>
              <Dots level={level} active={phase === "listening" || phase === "speaking"} dark={dark} />
            </span>
            <AnimatePresence mode="wait">
              <motion.span
                key={status}
                className={cn("text-xs", ink.status)}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -3 }}
                transition={{ duration: reduceMotion ? 0.1 : 0.2, ease: MALI_EASE }}
              >
                {status}
              </motion.span>
            </AnimatePresence>
            <AnimatePresence>
              {note && (
                <motion.span
                  className="max-w-md text-center text-xs text-muted-foreground"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.22, ease: MALI_EASE }}
                >
                  {note}
                </motion.span>
              )}
            </AnimatePresence>
          </div>

          <div className="flex items-center gap-14">
            <motion.button
              type="button"
              onClick={togglePause}
              title={phase === "paused" ? t("voiceModeResume") : t("voiceModePause")}
              aria-label={phase === "paused" ? t("voiceModeResume") : t("voiceModePause")}
              className={cn(
                "flex size-11 items-center justify-center rounded-full ring-1 transition-colors",
                ink.pauseBtn,
              )}
              whileHover={reduceMotion ? undefined : { scale: 1.05 }}
              whileTap={reduceMotion ? undefined : { scale: 0.94 }}
            >
              {phase === "paused" ? <PlayIcon className="size-4 fill-current" /> : <PauseIcon className="size-4 fill-current" />}
            </motion.button>
            <motion.button
              type="button"
              onClick={onClose}
              title={t("voiceModeEnd")}
              aria-label={t("voiceModeEnd")}
              className="flex size-14 items-center justify-center rounded-full bg-[#f2706b] text-white shadow-lg shadow-black/25 transition-colors hover:bg-[#e85f5a]"
              whileHover={reduceMotion ? undefined : { scale: 1.04 }}
              whileTap={reduceMotion ? undefined : { scale: 0.92 }}
            >
              <XIcon className="size-6" strokeWidth={2.5} />
            </motion.button>
          </div>
          <span className={cn("text-[11px]", ink.hint)}>{t("voiceModeHint")}</span>
        </div>
      </motion.div>
    </motion.div>,
    document.body,
  );
}

/** Four dots that grow with the voice, as under the bot in a call. */
function Dots({ level, active, dark }: { level?: RefObject<number>; active: boolean; dark: boolean }) {
  const box = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const dots = Array.from(el.children) as HTMLElement[];
    let frame = 0;
    let smooth = 0;
    const draw = (now: number) => {
      const target = !active ? 0 : level ? level.current : 0.25 + 0.2 * Math.sin(now / 300);
      smooth += (target - smooth) * (target > smooth ? 0.5 : 0.12);
      dots.forEach((dot, i) => {
        const wobble = 0.6 + 0.4 * Math.sin(now / 150 + i * 1.4);
        dot.style.transform = `scale(${(0.7 + Math.min(0.6, smooth * wobble)).toFixed(3)})`;
      });
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [level, active]);
  return (
    <span ref={box} className="flex items-center gap-1" aria-hidden>
      {[0, 1, 2, 3].map((i) => (
        <span
          key={i}
          className={cn(
            "size-2.5 rounded-full",
            dark ? "bg-white" : "bg-foreground/80",
            !active && "opacity-45",
          )}
        />
      ))}
    </span>
  );
}
