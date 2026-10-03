/**
 * How Mali listens and speaks. Both sides are either the system's own
 * (dictation and voices built into the OS: offline, free) or a model in the
 * cloud on a key from Settings → Models — nothing is loaded into this
 * machine's memory either way.
 */
import { createStore } from "@/lib/local-store";

/** Who turns speech into text. */
export type InputEngine = "system" | "groq" | "puter" | "openai";
/** Who reads replies aloud. */
export type OutputEngine = "system" | "puter" | "openai";
/** Puter speaks with one of these vendors' voices. */
export type PuterVoices = "openai" | "gemini" | "elevenlabs" | "aws-polly";

export type VoiceSettings = {
  input: { engine: InputEngine; model: string };
  output: {
    engine: OutputEngine;
    /** Puter only: whose voices. */
    puterVoices: PuterVoices;
    voice: string;
    /** The system voice's name (`speechSynthesis`), when one was picked. */
    systemVoice?: string;
  };
  /** When replies are read aloud: after a question asked by voice, always, or never. */
  speakReplies: "voice" | "always" | "never";
  /** The notch sends a spoken task as soon as the user stops talking. */
  autoSend: boolean;
  /** What's spoken: `auto` lets the model tell. */
  language: "auto" | "th" | "en";
};

export const INPUT_MODELS: Record<Exclude<InputEngine, "system">, { id: string; name: string }[]> = {
  groq: [
    { id: "whisper-large-v3-turbo", name: "Whisper large v3 turbo" },
    { id: "whisper-large-v3", name: "Whisper large v3" },
  ],
  puter: [
    { id: "gpt-4o-mini-transcribe", name: "GPT-4o mini transcribe" },
    { id: "gpt-4o-transcribe", name: "GPT-4o transcribe" },
    { id: "whisper-1", name: "Whisper" },
  ],
  openai: [
    { id: "gpt-4o-mini-transcribe", name: "GPT-4o mini transcribe" },
    { id: "gpt-4o-transcribe", name: "GPT-4o transcribe" },
    { id: "whisper-1", name: "Whisper" },
  ],
};

const OPENAI_VOICES = ["alloy", "ash", "ballad", "coral", "echo", "fable", "nova", "onyx", "sage", "shimmer"];

/** Voices each cloud choice offers (Gemini's speak Thai well). */
export const VOICES: Record<PuterVoices | "openai-direct", string[]> = {
  openai: OPENAI_VOICES,
  "openai-direct": OPENAI_VOICES,
  gemini: ["Kore", "Puck", "Charon", "Aoede", "Fenrir", "Leda", "Orus", "Zephyr"],
  elevenlabs: ["21m00Tcm4TlvDq8ikWAM"],
  "aws-polly": ["Joanna", "Matthew", "Amy", "Brian"],
};

export function voicesFor(output: VoiceSettings["output"]) {
  return output.engine === "openai" ? VOICES["openai-direct"] : VOICES[output.puterVoices];
}

const DEFAULTS: VoiceSettings = {
  input: { engine: "system", model: "" },
  output: { engine: "system", puterVoices: "gemini", voice: "Kore" },
  speakReplies: "voice",
  autoSend: true,
  language: "auto",
};

const store = createStore<VoiceSettings>(DEFAULTS, {
  key: "mali.voice.settings",
  revive: (raw) => ({
    ...DEFAULTS,
    ...raw,
    input: { ...DEFAULTS.input, ...raw?.input },
    output: { ...DEFAULTS.output, ...raw?.output },
  }),
});

export const useVoiceSettings = store.use;
export const getVoiceSettings = store.get;

export function patchVoiceSettings(patch: Partial<VoiceSettings>) {
  store.set((s) => ({ ...s, ...patch }));
}

/** The model an engine uses: the one picked, or its first. */
export function inputModel(settings: VoiceSettings) {
  const { engine, model } = settings.input;
  if (engine === "system") return "";
  return model || INPUT_MODELS[engine][0]!.id;
}

// The notch is its own window: a choice made in Settings reaches it too.
if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key !== "mali.voice.settings" || !event.newValue) return;
    if (event.newValue === JSON.stringify(store.get())) return;
    try {
      const raw = JSON.parse(event.newValue) as Partial<VoiceSettings>;
      store.set({ ...DEFAULTS, ...raw, input: { ...DEFAULTS.input, ...raw.input }, output: { ...DEFAULTS.output, ...raw.output } });
    } catch {
      // Unreadable: keep what we have.
    }
  });
}
