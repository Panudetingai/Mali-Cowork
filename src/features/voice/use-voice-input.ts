/**
 * Voice input, whichever engine Settings → Voice names: the system's own
 * dictation (words stream in as you speak), or a model (you speak, then the
 * words arrive at once — better at Thai and at noise). Same shape either way,
 * so the prompt, the Quick bar and the notch don't care which.
 */
import { useCallback, useRef, useState } from "react";
import { isTauri, invoke } from "@tauri-apps/api/core";
import { useRecorder, recordingSupported } from "./recorder";
import { useVoiceSettings } from "./settings";
import { transcribe } from "./speech";
import { useSpeechInput, type VoiceLang } from "./use-speech-input";

export type VoicePhase = "idle" | "listening" | "transcribing";

type Options = {
  /** `text` is everything heard since start; `final` once it won't change. */
  onText: (text: string, final: boolean) => void;
  onStart?: () => void;
  /**
   * Listening is over and this is what was said, whichever engine: after
   * system dictation stops, or once a model has written the words down. `""`
   * when nothing was said. Not called after `cancel`, nor on an error.
   */
  onEnd?: (text: string) => void;
  /** Stop by itself when the user stops talking. */
  autoStop?: boolean;
  /** Give up when nothing is said for this long after starting. */
  idleMs?: number;
  /** Pause after the last word before auto-stop (system dictation or model recording). */
  silenceMs?: number;
};

/** macOS closes a dev build that touches the mic (see `commands/voice.rs`). */
type MicStatus = { available: boolean; reason?: string | null };
let micStatus: Promise<MicStatus> | undefined;
function micAllowed(): Promise<MicStatus> {
  if (!isTauri()) return Promise.resolve({ available: true });
  micStatus ??= invoke<{ available: boolean; reason?: string | null }>("voice_input_status").catch(() => ({
    available: false,
    reason: "Voice input couldn't be checked on this device.",
  }));
  return micStatus;
}

export function useVoiceInput({ onText, onStart, onEnd, autoStop = false, idleMs, silenceMs }: Options) {
  const settings = useVoiceSettings();
  const system = useSpeechInput({ onText, onStart, onEnd, autoStop, idleMs, silenceMs });
  const onTextRef = useRef(onText);
  onTextRef.current = onText;
  const onEndRef = useRef(onEnd);
  onEndRef.current = onEnd;
  const [transcribing, setTranscribing] = useState(false);
  const [error, setError] = useState<string>();
  const usesModel = settings.input.engine !== "system";

  const recorder = useRecorder({
    autoStop,
    idleMs,
    silenceMs,
    onDone: async (recording) => {
      // A tap with nothing said isn't worth a call.
      if (recording.ms < 400) {
        onEndRef.current?.("");
        return;
      }
      setTranscribing(true);
      try {
        const text = await transcribe(recording, settings);
        if (text) onTextRef.current(text, true);
        else if (!onEndRef.current) setError("Nothing was heard. Try again a little closer to the mic.");
        onEndRef.current?.(text);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setTranscribing(false);
      }
    },
  });

  const start = useCallback(async (options?: { silenceMs?: number }) => {
    if (!usesModel) return system.start(undefined, options);
    const status = await micAllowed();
    if (!status.available) {
      setError(status.reason ?? "Voice input isn't available here.");
      return;
    }
    setError(undefined);
    onStart?.();
    await recorder.start(options);
  }, [usesModel, system, recorder, onStart]);

  const toggle = useCallback(() => {
    if (!usesModel) return system.toggle();
    if (recorder.recording) recorder.stop();
    else if (!transcribing) void start();
  }, [usesModel, system, recorder, transcribing, start]);

  if (!usesModel) {
    return {
      ...system,
      engine: "system" as const,
      phase: (system.listening ? "listening" : "idle") as VoicePhase,
      level: undefined,
      start,
    };
  }

  const phase: VoicePhase = recorder.recording ? "listening" : transcribing ? "transcribing" : "idle";
  return {
    supported: recordingSupported(),
    engine: settings.input.engine,
    listening: recorder.recording,
    phase,
    /** How loud the voice is now (0–1), read by the waveform each frame. */
    level: recorder.level,
    error: error ?? recorder.error,
    clearError: () => {
      setError(undefined);
      recorder.clearError();
    },
    lang: (settings.language === "en" ? "en-US" : "th-TH") as VoiceLang,
    setLang: (_: VoiceLang) => {},
    start,
    stop: recorder.stop,
    cancel: recorder.cancel,
    toggle,
  };
}

export type VoiceInput = ReturnType<typeof useVoiceInput>;
