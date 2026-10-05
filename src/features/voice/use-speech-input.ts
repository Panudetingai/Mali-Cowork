/**
 * Dictation through the webview's own speech recognizer (Web Speech API):
 * Apple's on macOS, so nothing is sent to a service Mali runs. The words
 * stream in while the user speaks; what's final stays, what's interim is
 * replaced as the recognizer changes its mind.
 */
import { getLanguage } from "@/features/i18n";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";

export type VoiceLang = "th-TH" | "en-US";

type Alternative = { transcript: string };
type Result = { isFinal: boolean; 0: Alternative; length: number };
type ResultEvent = { resultIndex: number; results: ArrayLike<Result> };
type ErrorEvent = { error: string; message?: string };

type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: ResultEvent) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
};

type RecognitionCtor = new () => Recognition;

/** No new words for this long after some were heard, and dictation ends. */
const SILENCE_MS = 1_500;

function recognizer(): RecognitionCtor | undefined {
  if (typeof window === "undefined") return undefined;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

export function speechSupported() {
  return !!recognizer();
}

type VoiceStatus = { available: boolean; reason?: string | null };

let statusPromise: Promise<VoiceStatus> | undefined;

/** Asked once; macOS needs usage strings in the app binary (see `commands/voice.rs`). */
function voiceStatus(): Promise<VoiceStatus> {
  if (!isTauri()) return Promise.resolve({ available: true });
  statusPromise ??= invoke<VoiceStatus>("voice_input_status").catch(() => ({
    available: false,
    reason: "Voice input couldn't be checked on this device.",
  }));
  return statusPromise;
}

const LANG_KEY = "mali.voice.lang";

export function loadVoiceLang(): VoiceLang {
  try {
    const saved = localStorage.getItem(LANG_KEY);
    if (saved === "th-TH" || saved === "en-US") return saved;
  } catch {
    // Falls back to the app language.
  }
  return getLanguage() === "th" ? "th-TH" : "en-US";
}

function saveVoiceLang(lang: VoiceLang) {
  try {
    localStorage.setItem(LANG_KEY, lang);
  } catch {
    // Lasts for this session only.
  }
}

const ERRORS: Record<string, string> = {
  "not-allowed": "Microphone access was denied — allow Mali in System Settings → Privacy & Security → Microphone and Speech Recognition.",
  "service-not-allowed": "Speech recognition is turned off — allow Mali in System Settings → Privacy & Security → Speech Recognition.",
  "audio-capture": "No microphone was found.",
  network: "Speech recognition isn't available on this device right now.",
  "language-not-supported": "This language isn't supported for dictation on this device.",
};

type Options = {
  /** Called as words arrive: `text` is everything heard since start (final + interim). */
  onText: (text: string, final: boolean) => void;
  /** A session starts (also after a language switch): a good time to note what's already typed. */
  onStart?: () => void;
  /** Dictation ended by itself or by `stop` (not `cancel`), with everything heard. */
  onEnd?: (text: string) => void;
  /** End by itself once the user stops talking. */
  autoStop?: boolean;
  /** Give up when nothing is heard for this long. */
  idleMs?: number;
};

export function useSpeechInput({ onText, onStart, onEnd, autoStop = false, idleMs }: Options) {
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string>();
  const [lang, setLangState] = useState<VoiceLang>(loadVoiceLang);
  const recRef = useRef<Recognition | null>(null);
  const onTextRef = useRef(onText);
  onTextRef.current = onText;
  const onStartRef = useRef(onStart);
  onStartRef.current = onStart;
  const onEndRef = useRef(onEnd);
  onEndRef.current = onEnd;
  /** Sessions ended with `cancel` (or replaced): their end isn't reported. */
  const dropped = useRef(new WeakSet<Recognition>());

  const stop = useCallback(() => {
    recRef.current?.stop();
  }, []);

  const start = useCallback(
    async (withLang: VoiceLang = lang) => {
      const status = await voiceStatus();
      if (!status.available) {
        setError(status.reason ?? "Voice input isn't available here.");
        return;
      }
      const Ctor = recognizer();
      if (!Ctor) {
        setError("Voice input isn't supported in this version of the app's web view.");
        return;
      }
      if (recRef.current) {
        dropped.current.add(recRef.current);
        recRef.current.abort();
      }
      setError(undefined);
      onStartRef.current?.();
      const rec = new Ctor();
      rec.lang = withLang;
      rec.continuous = true;
      rec.interimResults = true;
      rec.maxAlternatives = 1;
      let finalText = "";
      let heard = "";
      const started = Date.now();
      let lastWord = 0;
      // The recognizer never stops on its own while `continuous`: a pause
      // after words ends it here, as the mic button did by hand before.
      const watch = setInterval(() => {
        const now = Date.now();
        if (autoStop && heard && lastWord && now - lastWord > SILENCE_MS) rec.stop();
        else if (idleMs && !heard && now - started > idleMs) {
          dropped.current.add(rec);
          rec.abort();
        }
      }, 200);
      rec.onstart = () => setListening(true);
      rec.onresult = (event) => {
        let interim = "";
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i];
          const piece = result[0]?.transcript ?? "";
          if (result.isFinal) finalText += piece;
          else interim += piece;
        }
        heard = (finalText + interim).replace(/\s+/g, " ").trimStart();
        lastWord = Date.now();
        onTextRef.current(heard, !interim);
      };
      rec.onerror = (event) => {
        // Silence and a deliberate stop aren't failures.
        if (event.error === "no-speech" || event.error === "aborted") return;
        setError(ERRORS[event.error] ?? `Voice input stopped (${event.error}).`);
      };
      rec.onend = () => {
        clearInterval(watch);
        if (recRef.current === rec) {
          recRef.current = null;
          setListening(false);
        }
        if (!dropped.current.has(rec)) onEndRef.current?.(heard.trim());
      };
      recRef.current = rec;
      try {
        rec.start();
      } catch (e) {
        clearInterval(watch);
        recRef.current = null;
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [lang, autoStop, idleMs],
  );

  /** Stop at once, dropping words not yet final (e.g. the prompt was just sent). */
  const cancel = useCallback(() => {
    const rec = recRef.current;
    recRef.current = null;
    if (rec) {
      dropped.current.add(rec);
      rec.abort();
    }
    setListening(false);
  }, []);

  const toggle = useCallback(() => {
    if (recRef.current) stop();
    else void start();
  }, [start, stop]);

  /** Switch language; a session in progress restarts in the new one. */
  const setLang = useCallback(
    (next: VoiceLang) => {
      setLangState(next);
      saveVoiceLang(next);
      if (recRef.current) void start(next);
    },
    [start],
  );

  useEffect(
    () => () => {
      const rec = recRef.current;
      if (rec) {
        dropped.current.add(rec);
        rec.abort();
      }
    },
    [],
  );

  return {
    supported: speechSupported(),
    listening,
    error,
    clearError: () => setError(undefined),
    lang,
    setLang,
    start,
    stop,
    cancel,
    toggle,
  };
}
