/**
 * The model side of voice: a recording into text, and a reply read aloud.
 * Cloud engines go through the backend (`commands/speech.rs`) on the keys in
 * Settings → Models; the system voice runs right here, offline.
 */
import { requestConfigFor } from "@/features/providers";
import { invoke } from "@tauri-apps/api/core";
import { toBase64, type Recording } from "./recorder";
import { getVoiceSettings, inputModel, type VoiceSettings } from "./settings";

/** Which provider config holds an engine's key. */
const KEY_OF: Record<string, string> = { groq: "groq", openai: "openai", puter: "puter" };

export async function transcribe(recording: Recording, settings: VoiceSettings = getVoiceSettings()): Promise<string> {
  const { engine } = settings.input;
  if (engine === "system") throw new Error("System dictation doesn't take recordings.");
  return invoke<string>("speech_transcribe", {
    request: {
      engine,
      model: inputModel(settings),
      ...requestConfigFor(KEY_OF[engine]!),
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

type SpeakerState = { speaking: boolean; loading: boolean; error?: string };

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

/** Read `markdown` aloud with the voice in Settings. Resolves when it has finished (or was stopped). */
export async function speak(markdown: string, settings: VoiceSettings = getVoiceSettings()): Promise<void> {
  const text = speakable(markdown);
  if (!text) return;
  stopSpeaking();
  const mine = ++run;
  const { output } = settings;
  const lang = languageOf(text, settings.language);

  if (output.engine === "system") {
    if (typeof speechSynthesis === "undefined") return;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = lang === "th" ? "th-TH" : "en-US";
    const voice = systemVoice(output.systemVoice, lang);
    if (voice) utterance.voice = voice;
    set({ speaking: true, loading: false });
    await new Promise<void>((resolve) => {
      settle = resolve;
      utterance.onend = utterance.onerror = () => resolve();
      speechSynthesis.speak(utterance);
    });
    if (mine === run) set({ speaking: false, loading: false });
    return;
  }

  set({ speaking: false, loading: true });
  try {
    const { audio: data, mime } = await invoke<{ audio: string; mime: string }>("speech_synthesize", {
      request: {
        engine: output.engine,
        voice: output.voice || null,
        provider: output.engine === "puter" ? output.puterVoices : null,
        ...requestConfigFor(KEY_OF[output.engine]!),
        text,
        language: lang,
        instructions: "Friendly, natural and brief, like a helpful coworker.",
      },
    });
    if (mine !== run) return;
    const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
    audioUrl = URL.createObjectURL(new Blob([bytes], { type: mime }));
    audio = new Audio(audioUrl);
    set({ speaking: true, loading: false });
    await new Promise<void>((resolve) => {
      settle = resolve;
      audio!.onended = audio!.onerror = () => resolve();
      void audio!.play().catch(() => resolve());
    });
    if (mine === run) stopSpeaking();
  } catch (e) {
    if (mine === run) set({ speaking: false, loading: false, error: e instanceof Error ? e.message : String(e) });
  }
}
