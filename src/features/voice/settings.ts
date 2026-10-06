/**
 * How Mali listens and speaks. Both sides are either the system's own
 * (dictation and voices built into the OS: offline, free) or a model in the
 * cloud on a key from Settings → Models — nothing is loaded into this
 * machine's memory either way.
 */
import { createStore } from "@/lib/local-store";

/**
 * Any provider from Settings → Models — one the user added included — whose
 * API serves the OpenAI-compatible `/audio/transcriptions` or `/audio/speech`.
 * The user names the model, so a service that starts offering speech (free
 * voices on OpenRouter, say) works the day it does.
 */
export type ViaEngine = `via:${string}`;
/** Who turns speech into text. */
export type InputEngine = "system" | "groq" | "puter" | "openai" | "elevenlabs" | "fishaudio" | ViaEngine;
/** Who reads replies aloud. */
export type OutputEngine = "system" | "puter" | "openai" | "elevenlabs" | "fishaudio" | ViaEngine;

export const VIA_PREFIX = "via:";

export function viaEngine(providerId: string): ViaEngine {
  return `${VIA_PREFIX}${providerId}`;
}

/** The provider behind a `via:` engine, or undefined for the built-in ones. */
export function viaProvider(engine: string): string | undefined {
  return engine.startsWith(VIA_PREFIX) ? engine.slice(VIA_PREFIX.length) || undefined : undefined;
}

type BuiltInInput = Exclude<InputEngine, "system" | ViaEngine>;
/** Puter speaks with one of these vendors' voices. */
export type PuterVoices = "openai" | "gemini" | "elevenlabs" | "aws-polly";

export type VoiceSettings = {
  input: { engine: InputEngine; model: string };
  output: {
    engine: OutputEngine;
    /** Puter only: whose voices. */
    puterVoices: PuterVoices;
    voice: string;
    /** ElevenLabs and Fish Audio: the voice's name, for the picker before its list loads. */
    voiceName?: string;
    /** ElevenLabs and Fish Audio: which of their models speaks; empty for the default. */
    model?: string;
    /** The system voice's name (`speechSynthesis`), when one was picked. */
    systemVoice?: string;
  };
  /** When replies are read aloud: after a question asked by voice, always, or never. */
  speakReplies: "voice" | "always" | "never";
  /** Listening ends by itself when the user stops talking, and what was said is sent. */
  autoSend: boolean;
  /** What's spoken: `auto` lets the model tell. */
  language: "auto" | "th" | "en";
};

export const INPUT_MODELS: Record<BuiltInInput, { id: string; name: string }[]> = {
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
  elevenlabs: [
    { id: "scribe_v2", name: "Scribe v2" },
    { id: "scribe_v1", name: "Scribe v1" },
  ],
  fishaudio: [
    { id: "transcribe-1-pro", name: "Transcribe 1 Pro" },
    { id: "transcribe-1", name: "Transcribe 1" },
  ],
};

/** The models that speak, for the engines that offer a choice (first is the default). */
export const OUTPUT_MODELS: Partial<Record<string, { id: string; name: string; note?: string }[]>> = {
  openai: [
    { id: "gpt-4o-mini-tts", name: "GPT-4o mini TTS" },
    { id: "tts-1-hd", name: "TTS-1 HD" },
    { id: "tts-1", name: "TTS-1" },
  ],
  elevenlabs: [
    { id: "eleven_v3", name: "Eleven v3", note: "Speaks Thai" },
    { id: "eleven_flash_v2_5", name: "Flash v2.5", note: "Fastest · no Thai" },
    { id: "eleven_multilingual_v2", name: "Multilingual v2", note: "No Thai" },
  ],
  fishaudio: [
    { id: "s2.1-pro", name: "S2.1 Pro" },
    { id: "s1", name: "S1" },
  ],
};

export function outputModel(output: VoiceSettings["output"]) {
  return output.model || OUTPUT_MODELS[output.engine]?.[0]?.id || "";
}

const OPENAI_VOICES = ["alloy", "ash", "ballad", "coral", "echo", "fable", "nova", "onyx", "sage", "shimmer"];

/** Voices each cloud choice offers (Gemini's speak Thai well). */
export const VOICES: Record<PuterVoices | "openai-direct", string[]> = {
  openai: OPENAI_VOICES,
  "openai-direct": OPENAI_VOICES,
  gemini: ["Kore", "Puck", "Charon", "Aoede", "Fenrir", "Leda", "Orus", "Zephyr"],
  elevenlabs: ["21m00Tcm4TlvDq8ikWAM"],
  "aws-polly": ["Joanna", "Matthew", "Amy", "Brian"],
};

/** What the fixed voices sound like, for the picker (the services list the rest themselves). */
export const VOICE_TAGS: Record<string, string[]> = {
  alloy: ["neutral", "balanced"],
  ash: ["male", "clear"],
  ballad: ["male", "soft"],
  coral: ["female", "warm"],
  echo: ["male", "calm"],
  fable: ["neutral", "british"],
  nova: ["female", "bright"],
  onyx: ["male", "deep"],
  sage: ["female", "calm"],
  shimmer: ["female", "light"],
  Kore: ["female", "firm"],
  Puck: ["male", "upbeat"],
  Charon: ["male", "informative"],
  Aoede: ["female", "breezy"],
  Fenrir: ["male", "excitable"],
  Leda: ["female", "youthful"],
  Orus: ["male", "firm"],
  Zephyr: ["female", "bright"],
  Joanna: ["female", "american"],
  Matthew: ["male", "american"],
  Amy: ["female", "british"],
  Brian: ["male", "british"],
  "21m00Tcm4TlvDq8ikWAM": ["female", "american"],
};

/** Voices whose id isn't their name. */
export const VOICE_NAMES: Record<string, string> = { "21m00Tcm4TlvDq8ikWAM": "Rachel" };

/** The fixed voices of OpenAI and Puter; ElevenLabs and Fish Audio list the account's own. */
export function voicesFor(output: VoiceSettings["output"]) {
  // An OpenAI-compatible speech API most often takes OpenAI's voice names.
  if (output.engine === "openai" || viaProvider(output.engine)) return VOICES["openai-direct"];
  return VOICES[output.puterVoices];
}

/** The models a built-in listening engine offers; a `via:` one has only what the user typed. */
export function inputModelsFor(engine: InputEngine): { id: string; name: string }[] {
  if (engine === "system" || viaProvider(engine)) return [];
  return INPUT_MODELS[engine as BuiltInInput] ?? [];
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
  return model || inputModelsFor(engine)[0]?.id || "";
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
