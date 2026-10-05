"use client";

import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { getProvider, hasKey, ProviderLogo, useEnvKeys, useProviderConfigs } from "@/features/providers";
import {
  INPUT_MODELS,
  inputModel,
  patchVoiceSettings,
  speak,
  speakerState,
  stopSpeaking,
  subscribeSpeaker,
  useVoiceInput,
  useVoiceSettings,
  voicesFor,
  VoiceButton,
  Waveform,
  type InputEngine,
  type OutputEngine,
  type PuterVoices,
  type VoiceSettings,
} from "@/features/voice";
import { useToastError } from "@/components/ui/sonner";
import { MALI_EASE } from "@/lib/motion-presets";
import { cn } from "@/lib/utils";
import { CheckIcon, CpuIcon, MessageSquareTextIcon, MicIcon, PlayIcon, SendIcon, SquareIcon, Volume2Icon } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { SectionHeader, Segmented, SettingRow, SettingsGroup } from "./ui";

type Choice<T extends string> = {
  id: T;
  name: string;
  logo?: string;
  icon?: ReactNode;
  /** What makes it a good pick, at a glance. */
  tags: { label: string; tone?: "free" | "best" | "paid" }[];
  blurb: string;
  /** The provider in Settings → Models whose key it needs. */
  keyOf?: string;
};

const INPUTS: Choice<InputEngine>[] = [
  {
    id: "groq",
    name: "Groq · Whisper",
    logo: "groq",
    tags: [{ label: "Free", tone: "free" }, { label: "Recommended", tone: "best" }, { label: "Fast" }],
    blurb: "Whisper large v3 turbo on Groq's free tier. Strong at Thai and English, back in about a second.",
    keyOf: "groq",
  },
  {
    id: "puter",
    name: "Puter",
    logo: "puter",
    tags: [{ label: "Free plan", tone: "free" }],
    blurb: "OpenAI's transcribe models through your Puter account's credits.",
    keyOf: "puter",
  },
  {
    id: "system",
    name: "System dictation",
    icon: <CpuIcon className="size-5" />,
    tags: [{ label: "Free", tone: "free" }, { label: "Offline" }],
    blurb: "Built into macOS. Words appear while you speak; less accurate with Thai and noise.",
  },
  {
    id: "openai",
    name: "OpenAI",
    logo: "openai",
    tags: [{ label: "Paid", tone: "paid" }],
    blurb: "GPT-4o transcribe: the most accurate, billed to your OpenAI key.",
    keyOf: "openai",
  },
];

const OUTPUTS: Choice<OutputEngine>[] = [
  {
    id: "puter",
    name: "Puter voices",
    logo: "puter",
    tags: [{ label: "Free plan", tone: "free" }, { label: "Recommended", tone: "best" }],
    blurb: "Natural voices from Gemini (speaks Thai well), OpenAI, ElevenLabs or Polly, on your Puter credits.",
    keyOf: "puter",
  },
  {
    id: "system",
    name: "System voice",
    icon: <CpuIcon className="size-5" />,
    tags: [{ label: "Free", tone: "free" }, { label: "Offline" }],
    blurb: "The voices built into macOS. Instant and private; add Premium voices in System Settings → Accessibility → Spoken Content.",
  },
  {
    id: "openai",
    name: "OpenAI",
    logo: "openai",
    tags: [{ label: "Paid", tone: "paid" }],
    blurb: "GPT-4o mini TTS: expressive voices, billed to your OpenAI key.",
    keyOf: "openai",
  },
];

const PUTER_VOICES: { value: PuterVoices; label: string }[] = [
  { value: "gemini", label: "Gemini" },
  { value: "openai", label: "OpenAI" },
  { value: "elevenlabs", label: "ElevenLabs" },
  { value: "aws-polly", label: "Polly" },
];

const SAMPLE = {
  th: "สวัสดีครับ ผมคือ Mali พร้อมช่วยงานแล้ว บอกได้เลยว่าอยากให้ทำอะไร",
  en: "Hi, I'm Mali. Tell me what you'd like done and I'll get on it.",
};

/** The OS voices for a language, best first (Premium and Enhanced sound far better). */
function useSystemVoices(lang: string) {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  useEffect(() => {
    if (typeof speechSynthesis === "undefined") return;
    const load = () => setVoices(speechSynthesis.getVoices());
    load();
    speechSynthesis.addEventListener("voiceschanged", load);
    return () => speechSynthesis.removeEventListener("voiceschanged", load);
  }, []);
  const rank = (v: SpeechSynthesisVoice) => (/premium/i.test(v.name) ? 0 : /enhanced/i.test(v.name) ? 1 : 2);
  return voices.filter((v) => v.lang.toLowerCase().startsWith(lang)).sort((a, b) => rank(a) - rank(b));
}

export function VoiceSettings() {
  const settings = useVoiceSettings();
  const configs = useProviderConfigs();
  const envKeys = useEnvKeys();
  const ready = (keyOf?: string) => {
    if (!keyOf) return true;
    const provider = getProvider(keyOf);
    return !!provider && hasKey(provider, configs[keyOf], envKeys);
  };
  const lang = settings.language === "en" ? "en" : "th";

  return (
    <div className="flex flex-col gap-8">
      <SectionHeader
        title="Voice"
        description="Talk to Mali — in the notch, the chat box and the Quick bar — and hear it answer. Everything runs in the cloud or in macOS itself: no model is loaded into this computer's memory."
      />

      <SettingsGroup
        title="Listening"
        description="What turns your voice into text."
        footer="Free pick: Groq — add a free key from console.groq.com in Settings → Models."
      >
        <EngineGrid
          choices={INPUTS}
          value={settings.input.engine}
          ready={ready}
          onPick={(engine) => patchVoiceSettings({ input: { engine, model: "" } })}
        />
        {settings.input.engine !== "system" && (
          <SettingRow
            label="Model"
            control={
              <select
                value={inputModel(settings)}
                onChange={(e) => patchVoiceSettings({ input: { ...settings.input, model: e.target.value } })}
                className="h-8 rounded-lg border border-input bg-background px-2 text-xs"
              >
                {INPUT_MODELS[settings.input.engine].map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            }
          />
        )}
        <SettingRow
          label="Language"
          description="Naming it helps with short phrases; Auto tells Thai from English by itself."
          control={
            <Segmented
              label="Spoken language"
              value={settings.language}
              onChange={(language) => patchVoiceSettings({ language })}
              options={[
                { value: "auto", label: "Auto" },
                { value: "th", label: "ไทย" },
                { value: "en", label: "English" },
              ]}
            />
          }
        />
        <TryListening />
      </SettingsGroup>

      <SettingsGroup title="Speaking" description="The voice Mali answers with.">
        <EngineGrid
          choices={OUTPUTS}
          value={settings.output.engine}
          ready={ready}
          onPick={(engine) =>
            patchVoiceSettings({
              output: {
                ...settings.output,
                engine,
                voice: engine === "openai" ? "coral" : engine === "puter" ? voicesFor({ ...settings.output, engine })[0]! : settings.output.voice,
              },
            })
          }
        />
        <VoicePicker settings={settings} lang={lang} />
        <TrySpeaking settings={settings} lang={lang} />
      </SettingsGroup>

      <SettingsGroup title="In the notch" description="Tap the mic where the send button is, and say what you need.">
        <SettingRow
          icon={<SendIcon />}
          label="Send when I stop talking"
          description="A short pause ends it. Off: tap ✓ when you're done, and check the words first."
          control={<Switch checked={settings.autoSend} onCheckedChange={(autoSend) => patchVoiceSettings({ autoSend })} />}
        />
        <SettingRow
          icon={<MessageSquareTextIcon />}
          label="Read replies aloud"
          description="Only the gist of a long reply is read, without code or links."
          control={
            <Segmented
              label="Read replies aloud"
              value={settings.speakReplies}
              onChange={(speakReplies) => patchVoiceSettings({ speakReplies })}
              options={[
                { value: "voice", label: "When I speak" },
                { value: "always", label: "Always" },
                { value: "never", label: "Never" },
              ]}
            />
          }
        />
      </SettingsGroup>
    </div>
  );
}

function EngineGrid<T extends string>({
  choices,
  value,
  ready,
  onPick,
}: {
  choices: Choice<T>[];
  value: T;
  ready: (keyOf?: string) => boolean;
  onPick: (id: T) => void;
}) {
  return (
    <div role="radiogroup" className="grid grid-cols-1 gap-2 p-3 sm:grid-cols-2">
      {choices.map((choice) => {
        const on = choice.id === value;
        const hasKey = ready(choice.keyOf);
        return (
          <button
            key={choice.id}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onPick(choice.id)}
            className={cn(
              "relative flex flex-col gap-2 rounded-2xl p-3.5 text-left ring-1 transition-all",
              on ? "bg-muted/60 ring-2 ring-foreground/70" : "ring-border/70 hover:bg-muted/30 hover:ring-border",
            )}
          >
            <span className="flex items-center gap-2.5">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-background ring-1 ring-border/70">
                {choice.logo ? <ProviderLogo logo={choice.logo} name={choice.name} className="size-5" /> : choice.icon}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm font-semibold">{choice.name}</span>
              <AnimatePresence>
                {on && (
                  <motion.span
                    initial={{ scale: 0.4, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.4, opacity: 0 }}
                    transition={{ duration: 0.2, ease: MALI_EASE }}
                    className="flex size-5 items-center justify-center rounded-full bg-foreground text-background"
                  >
                    <CheckIcon className="size-3" strokeWidth={3} />
                  </motion.span>
                )}
              </AnimatePresence>
            </span>
            <span className="flex flex-wrap gap-1">
              {choice.tags.map((tag) => (
                <span
                  key={tag.label}
                  className={cn(
                    "rounded-full px-2 py-0.5 text-[10px] font-medium",
                    tag.tone === "free"
                      ? "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300"
                      : tag.tone === "best"
                        ? "bg-foreground text-background"
                        : tag.tone === "paid"
                          ? "bg-amber-500/12 text-amber-800 dark:text-amber-300"
                          : "bg-muted text-muted-foreground",
                  )}
                >
                  {tag.label}
                </span>
              ))}
            </span>
            <span className="text-xs leading-relaxed text-muted-foreground">{choice.blurb}</span>
            {choice.keyOf && (
              <span className={cn("text-[11px] font-medium", hasKey ? "text-emerald-700 dark:text-emerald-400" : "text-amber-700 dark:text-amber-400")}>
                {hasKey ? "✓ Connected" : `Needs ${getProvider(choice.keyOf)?.name ?? choice.keyOf} in Settings → Models`}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function VoicePicker({ settings, lang }: { settings: VoiceSettings; lang: string }) {
  const { output } = settings;
  const systemVoices = useSystemVoices(lang);
  if (output.engine === "system") {
    return (
      <SettingRow
        label="Voice"
        description={systemVoices.length ? undefined : "No voice for this language yet — add one in System Settings → Accessibility → Spoken Content."}
        control={
          <select
            value={output.systemVoice ?? ""}
            onChange={(e) => patchVoiceSettings({ output: { ...output, systemVoice: e.target.value || undefined } })}
            className="h-8 max-w-56 rounded-lg border border-input bg-background px-2 text-xs"
          >
            <option value="">Default</option>
            {systemVoices.map((v) => (
              <option key={v.name} value={v.name}>
                {v.name}
              </option>
            ))}
          </select>
        }
      />
    );
  }
  return (
    <SettingRow
      label="Voice"
      control={
        <div className="flex flex-wrap items-center justify-end gap-2">
          {output.engine === "puter" && (
            <Segmented
              label="Whose voices"
              value={output.puterVoices}
              onChange={(puterVoices) =>
                patchVoiceSettings({ output: { ...output, puterVoices, voice: voicesFor({ ...output, puterVoices })[0]! } })
              }
              options={PUTER_VOICES}
            />
          )}
          <select
            value={output.voice}
            onChange={(e) => patchVoiceSettings({ output: { ...output, voice: e.target.value } })}
            className="h-8 rounded-lg border border-input bg-background px-2 text-xs"
          >
            {voicesFor(output).map((v) => (
              <option key={v} value={v}>
                {v === "21m00Tcm4TlvDq8ikWAM" ? "Rachel" : v}
              </option>
            ))}
          </select>
        </div>
      }
    />
  );
}

/** Speak once with what's set, and see the words. */
function TryListening() {
  const [heard, setHeard] = useState("");
  const voice = useVoiceInput({ onText: (text) => setHeard(text), onStart: () => setHeard(""), autoStop: true });
  useToastError(voice.error, voice.clearError);
  return (
    <SettingRow
      icon={<MicIcon />}
      label="Try it"
      description={voice.listening ? "Speak now — it stops when you pause." : "Say something to see what Mali hears."}
      control={<VoiceButton voice={voice} />}
    >
      <AnimatePresence initial={false}>
        {heard && (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2, ease: MALI_EASE }}
          >
            <p className="rounded-xl bg-muted/40 px-3 py-2 text-sm">“{heard}”</p>
          </motion.div>
        )}
      </AnimatePresence>
    </SettingRow>
  );
}

function TrySpeaking({ settings, lang }: { settings: VoiceSettings; lang: "th" | "en" }) {
  const state = useSyncExternalStore(subscribeSpeaker, speakerState);
  const busy = state.speaking || state.loading;
  useToastError(state.error && !busy ? state.error : undefined);
  return (
    <SettingRow
      icon={<Volume2Icon />}
      label="Hear it"
      description={state.error ?? "A short line in the voice above."}
      control={
        <Button
          type="button"
          variant={busy ? "secondary" : "outline"}
          size="sm"
          className="h-8 min-w-24 gap-1.5 rounded-xl text-xs"
          onClick={() => (busy ? stopSpeaking() : void speak(SAMPLE[lang], settings))}
        >
          {state.loading ? (
            <>
              <Waveform bars={4} className="h-3 gap-[2px]" barClassName="w-[2px]" /> Preparing
            </>
          ) : state.speaking ? (
            <>
              <SquareIcon className="size-3 fill-current" /> Stop
            </>
          ) : (
            <>
              <PlayIcon className="size-3.5" /> Play
            </>
          )}
        </Button>
      }
    >
    </SettingRow>
  );
}
