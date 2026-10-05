/**
 * The model side of voice: a recording into text, and a reply read aloud.
 * Cloud engines go through the backend (`commands/speech.rs`) on the keys in
 * Settings → Models; the system voice runs right here, offline.
 */
import { requestConfigFor } from "@/features/providers";
import { invoke } from "@tauri-apps/api/core";
import { isVoiceService, voiceKey, type VoiceService } from "./keys";
import { toBase64, type Recording } from "./recorder";
import { getVoiceSettings, inputModel, outputModel, type VoiceSettings } from "./settings";

/** The key an engine is called with: Settings → Voice for the voice-only services, else Settings → Models. */
function keyFor(engine: string): { apiKey: string | null; baseUrl: string | null } {
  if (isVoiceService(engine)) return { apiKey: voiceKey(engine), baseUrl: null };
  return requestConfigFor(engine);
}

export type VoiceOption = {
  id: string;
  name: string;
  /** The user's own voice (a clone) rather than one from the library. */
  mine: boolean;
  /** An https link to a short sample, when the service has one. */
  preview?: string | null;
  /** Gender, accent, age, language… */
  tags: string[];
  description?: string | null;
};

/**
 * The voices an ElevenLabs or Fish Audio key can use (its own clones first),
 * straight from the service; `query` searches their names there.
 */
export function listVoices(
  engine: "elevenlabs" | "fishaudio",
  { language, query }: { language?: string; query?: string } = {},
): Promise<VoiceOption[]> {
  return invoke<VoiceOption[]>("speech_voices", {
    request: { engine, apiKey: voiceKey(engine), language: language ?? null, query: query?.trim() || null },
  });
}

/** A speech model the service lists itself (TTS speaks, STT transcribes). */
export type SpeechModelOption = {
  id: string;
  name: string;
  description?: string | null;
  /** Language ids the service lists, e.g. `["en", "th"]`. */
  languages: string[];
  /** Listed (or known) to handle Thai. */
  thai: boolean;
};

/**
 * The models an engine offers right now, from the service itself —
 * ElevenLabs' TTS models and Scribe, or an OpenAI-compatible `/v1/models`
 * page narrowed to speech. Rejects when the service can't be reached, so the
 * caller can fall back to its built-in list.
 */
export function listSpeechModels(engine: string, kind: "tts" | "stt"): Promise<SpeechModelOption[]> {
  const { apiKey, baseUrl } = keyFor(engine);
  return invoke<SpeechModelOption[]>("speech_models", { request: { engine, kind, apiKey, baseUrl } });
}

/** A voice in a service's public library. */
export type LibraryVoice = {  id: string;
  /** ElevenLabs: whose it is, to add it to the account. */
  ownerId?: string | null;
  name: string;
  description?: string | null;
  preview?: string | null;
  language?: string | null;
  accent?: string | null;
  gender?: string | null;
  useCase?: string | null;
  /** How many people added or used it. */
  users?: number | null;
  /** ElevenLabs: days it's promised to stay available. */
  noticeDays?: number | null;
};

export type LibraryFilters = {
  query?: string;
  language?: string;
  accent?: string;
  useCase?: string;
  sort?: "trending" | "usage" | "newest";
  page?: number;
};

/** One page of the service's public library, filtered by the service. */
export function voiceLibrary(engine: VoiceService, filters: LibraryFilters = {}) {
  return invoke<{ voices: LibraryVoice[]; hasMore: boolean }>("speech_voice_library", {
    request: {
      engine,
      apiKey: voiceKey(engine),
      query: filters.query?.trim() || null,
      language: filters.language || null,
      accent: filters.accent || null,
      useCase: filters.useCase || null,
      sort: filters.sort ?? "trending",
      page: filters.page ?? 0,
    },
  });
}

/**
 * Make a library voice speakable: ElevenLabs needs it added to the account
 * first (the id to speak with comes back); Fish Audio speaks any of them.
 */
export async function adoptLibraryVoice(engine: VoiceService, voice: LibraryVoice): Promise<string> {
  if (engine !== "elevenlabs" || !voice.ownerId) return voice.id;
  return invoke<string>("speech_voice_add", {
    apiKey: voiceKey(engine),
    ownerId: voice.ownerId,
    voiceId: voice.id,
    name: voice.name,
  });
}

export async function transcribe(recording: Recording, settings: VoiceSettings = getVoiceSettings()): Promise<string> {
  const { engine } = settings.input;
  if (engine === "system") throw new Error("System dictation doesn't take recordings.");
  return invoke<string>("speech_transcribe", {
    request: {
      engine,
      model: inputModel(settings),
      ...keyFor(engine),
      audio: await toBase64(recording.blob),
      mime: recording.mime,
      language: settings.language === "auto" ? null : settings.language,
    },
  });
}

// ── reading aloud ──

/** Longest stretch read aloud: a reply's gist, not a document. */
const MAX_SPOKEN = 700;

/**
 * What a reply sounds like read aloud: no code, no markdown marks, links as
 * their words, and only its first part when it's long (cut at a sentence).
 */
export function speakable(markdown: string): string {
  let text = markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\s*\|.*\|\s*$/gm, " ")
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, "")
    .replace(/[*_~]{1,3}([^*_~]+)[*_~]{1,3}/g, "$1")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length > MAX_SPOKEN) {
    const cut = text.slice(0, MAX_SPOKEN);
    // At a sentence's end when there is one far enough in; else between words
    // (Thai marks no sentence ends); else wherever the limit falls.
    const sentence = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
    const word = cut.lastIndexOf(" ");
    const end = sentence > MAX_SPOKEN / 2 ? sentence + 1 : word > MAX_SPOKEN / 2 ? word : MAX_SPOKEN;
    text = `${cut.slice(0, end).trim()}…`;
  }
  return text;
}

type SpeakerState = {
  speaking: boolean;
  loading: boolean;
  error?: string;
  /** What's being read: the `id` given to `speak`, e.g. a message's. */
  id?: string;
  /** `speakerLevel` follows this voice (cloud voices whose sound could be measured). */
  metered?: boolean;
};

let state: SpeakerState = { speaking: false, loading: false };
const listeners = new Set<() => void>();
const set = (next: SpeakerState) => {
  state = next;
  listeners.forEach((l) => l());
};
export const speakerState = () => state;
export function subscribeSpeaker(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * How loud the voice being played is now (0–1), for animations; read it each
 * frame like the recorder's level. Only cloud voices have one: the system's
 * speech can't be listened to, so it stays 0.
 */
export const speakerLevel = { current: 0 };
let levelContext: AudioContext | undefined;
let levelTimer: ReturnType<typeof setInterval> | undefined;

/**
 * Listen to `element` as it plays. Routed through an analyser, its sound only
 * comes out while the audio context runs, and WebKit may keep one created
 * without a click suspended: then it's left alone, and plays as usual.
 */
async function followLevel(element: HTMLAudioElement): Promise<boolean> {
  try {
    levelContext ??= new AudioContext();
    if (levelContext.state !== "running") {
      await Promise.race([levelContext.resume(), new Promise((resolve) => setTimeout(resolve, 300))]);
    }
    if (levelContext.state !== "running") return false;
    const analyser = levelContext.createAnalyser();
    analyser.fftSize = 512;
    levelContext.createMediaElementSource(element).connect(analyser);
    analyser.connect(levelContext.destination);
    const samples = new Uint8Array(analyser.fftSize);
    clearInterval(levelTimer);
    levelTimer = setInterval(() => {
      analyser.getByteTimeDomainData(samples);
      let sum = 0;
      for (const v of samples) sum += ((v - 128) / 128) ** 2;
      speakerLevel.current = Math.min(1, Math.sqrt(sum / samples.length) * 4);
    }, 50);
    return true;
  } catch {
    // No analyser: the audio still plays, the animation just breathes.
    return false;
  }
}

function stopLevel() {
  clearInterval(levelTimer);
  levelTimer = undefined;
  speakerLevel.current = 0;
}

/** One audio element for the whole app: a new reply replaces the last. */
let audio: HTMLAudioElement | undefined;
let audioUrl: string | undefined;
let run = 0;
/** Ends the wait of the `speak` playing now; pausing fires neither `ended` nor `error`. */
let settle: (() => void) | undefined;

export function stopSpeaking() {
  run++;
  settle?.();
  settle = undefined;
  audio?.pause();
  stopLevel();
  if (audioUrl) URL.revokeObjectURL(audioUrl);
  audio = undefined;
  audioUrl = undefined;
  if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
  set({ speaking: false, loading: false });
}

function systemVoice(name: string | undefined, lang: string) {
  const voices = speechSynthesis.getVoices();
  return voices.find((v) => v.name === name) ?? voices.find((v) => v.lang.toLowerCase().startsWith(lang));
}

/** The text's language, near enough to pick a voice: Thai script or not. */
function languageOf(text: string, setting: VoiceSettings["language"]) {
  if (setting !== "auto") return setting;
  return /[฀-๿]/.test(text) ? "th" : "en";
}

/**
 * Read `markdown` aloud with the voice in Settings. Resolves when it has
 * finished: `true` if it was read to the end, `false` if it was stopped, cut
 * off by another, or failed. `id` names what's read, so a button can tell
 * it's the one playing.
 */
export async function speak(
  markdown: string,
  settings: VoiceSettings = getVoiceSettings(),
  { id }: { id?: string } = {},
): Promise<boolean> {
  const text = speakable(markdown);
  if (!text) return false;
  stopSpeaking();
  const mine = ++run;
  const { output } = settings;
  const lang = languageOf(text, settings.language);

  if (output.engine === "system") {
    if (typeof speechSynthesis === "undefined") return false;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = lang === "th" ? "th-TH" : "en-US";
    const voice = systemVoice(output.systemVoice, lang);
    if (voice) utterance.voice = voice;
    set({ speaking: true, loading: false, id });
    await new Promise<void>((resolve) => {
      settle = resolve;
      utterance.onend = utterance.onerror = () => resolve();
      speechSynthesis.speak(utterance);
    });
    if (mine !== run) return false;
    set({ speaking: false, loading: false });
    return true;
  }

  set({ speaking: false, loading: true, id });
  try {
    const { audio: data, mime } = await invoke<{ audio: string; mime: string }>("speech_synthesize", {
      request: {
        engine: output.engine,
        model: outputModel(output) || null,
        voice: output.voice || null,
        provider: output.engine === "puter" ? output.puterVoices : null,
        ...keyFor(output.engine),
        text,
        language: lang,
        instructions: "Friendly, natural and brief, like a helpful coworker.",
      },
    });
    return await play(data, mime, mine, id);
  } catch (e) {
    if (mine === run) set({ speaking: false, loading: false, error: e instanceof Error ? e.message : String(e), id });
    return false;
  }
}

/**
 * Play a voice's sample from its service (a link, fetched by the backend: the
 * page may only play its own audio). Shares `speak`'s player, so starting one
 * stops the other and `speakerState` follows both.
 */
export async function playClip(url: string, { id }: { id?: string } = {}): Promise<boolean> {
  stopSpeaking();
  const mine = ++run;
  set({ speaking: false, loading: true, id });
  try {
    const { audio: data, mime } = await invoke<{ audio: string; mime: string }>("speech_preview", { url });
    return await play(data, mime, mine, id);
  } catch (e) {
    if (mine === run) set({ speaking: false, loading: false, error: e instanceof Error ? e.message : String(e), id });
    return false;
  }
}

/** Play base64 audio to the end; `false` when stopped or replaced on the way. */
async function play(data: string, mime: string, mine: number, id: string | undefined): Promise<boolean> {
  if (mine !== run) return false;
  const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
  audioUrl = URL.createObjectURL(new Blob([bytes], { type: mime }));
  audio = new Audio(audioUrl);
  const metered = await followLevel(audio);
  if (mine !== run) return false;
  set({ speaking: true, loading: false, id, metered });
  const played = await new Promise<boolean>((resolve) => {
    settle = () => resolve(false);
    audio!.onended = () => resolve(true);
    audio!.onerror = () => resolve(false);
    void audio!.play().catch(() => resolve(false));
  });
  if (mine !== run) return false;
  stopSpeaking();
  return played;
}
