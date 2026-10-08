import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  customProviderDef,
  getProvider,
  hasKey,
  PROVIDERS,
  ProviderLogo,
  usableModels,
  useCustomProviders,
  useEnvKeys,
  useProviderConfigs,
} from "@/features/providers";
import {
  inputModel,
  inputModelsFor,
  isVoiceService,
  listSpeechModels,
  listVoices,
  OUTPUT_MODELS,
  outputModel,
  patchVoiceInput,
  patchVoiceOutput,
  patchVoiceSettings,
  pickInputEngine,
  pickOutputEngine,
  setVoiceKey,
  speak,
  speakerState,
  stopSpeaking,
  subscribeSpeaker,
  useVoiceInput,
  useVoiceKeys,
  useVoiceSettings,
  VOICE_NAMES,
  VOICE_SERVICES,
  VOICE_TAGS,
  VoiceButton,
  viaEngine,
  viaProvider,
  voicesFor,
  Waveform,
  type InputEngine,
  type OutputEngine,
  type PuterVoices,
  type VoiceOption,
  type VoiceService,
  updateVoiceOutput,
  type ViaEngine,
  type VoiceSettings,
} from "@/features/voice";
import { useToastError } from "@/components/ui/sonner";
import { MALI_EASE } from "@/lib/motion-presets";
import { cn } from "@/lib/utils";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  CheckIcon,
  ChevronRightIcon,
  CpuIcon,
  ExternalLinkIcon,
  LoaderIcon,
  MessageSquareTextIcon,
  MicIcon,
  PlayIcon,
  PlusIcon,
  RefreshCwIcon,
  SendIcon,
  SquareIcon,
  Volume2Icon,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { settingsPath, useSettingsSub } from "./route";
import { RowButton, VoiceLibrary, VoiceRow } from "./voice-library";
import {
  Dot,
  FlatRows,
  HelpHint,
  PageEnter,
  PageHeader,
  Pills,
  SearchField,
  SectionLabel,
  Segmented,
  SettingRow,
  Tile,
  TileBadge,
  TileButton,
  TileGrid,
} from "./ui";

type Choice<T extends string> = {
  id: T;
  name: string;
  logo?: string;
  icon?: ReactNode;
  /** What makes it a good pick, at a glance. */
  tags: { label: string; tone?: "free" | "best" | "paid" }[];
  blurb: string;
  /** The provider in Settings → Models whose key it needs, or a voice service (key on this page). */
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
  {
    id: "elevenlabs",
    name: "ElevenLabs · Scribe",
    logo: "elevenlabs",
    tags: [{ label: "Free tier", tone: "free" }, { label: "Thai" }],
    blurb: "Scribe v2: very accurate in 90+ languages including Thai, on your ElevenLabs key.",
    keyOf: "elevenlabs",
  },
  {
    id: "fishaudio",
    name: "Fish Audio",
    logo: "fishaudio",
    tags: [{ label: "Paid", tone: "paid" }],
    blurb: "Fish Audio's transcription, on your Fish Audio key.",
    keyOf: "fishaudio",
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
  {
    id: "elevenlabs",
    name: "ElevenLabs",
    logo: "elevenlabs",
    tags: [{ label: "Free tier", tone: "free" }, { label: "Most natural", tone: "best" }],
    blurb: "Lifelike voices, and your own cloned ones. Eleven v3 speaks Thai.",
    keyOf: "elevenlabs",
  },
  {
    id: "fishaudio",
    name: "Fish Audio",
    logo: "fishaudio",
    tags: [{ label: "Paid", tone: "paid" }, { label: "Huge voice library" }],
    blurb: "Thousands of community voices in many languages, and your own clones.",
    keyOf: "fishaudio",
  },
];

/** A fresh pick's voice: one every account has, or the first of the account's list. */
const FIRST_VOICE: Partial<Record<OutputEngine, { voice: string; voiceName?: string }>> = {
  openai: { voice: "coral" },
  elevenlabs: { voice: "21m00Tcm4TlvDq8ikWAM", voiceName: "Rachel" },
  fishaudio: { voice: "" },
};

/** Engines with a tile of their own; the rest of the providers come in through `via:`. */
const NATIVE_ENGINES = { stt: new Set(["groq", "openai", "puter"]), tts: new Set(["openai", "puter"]) };

/**
 * Every provider connected in Settings → Models — ones the user added
 * included — as a speech engine over the OpenAI-compatible audio API. The
 * engine in use stays listed even once its provider is gone, so the page can
 * say what's missing.
 */
function useViaChoices(kind: "stt" | "tts", current: string): Choice<ViaEngine>[] {
  const configs = useProviderConfigs();
  const envKeys = useEnvKeys();
  const custom = useCustomProviders();
  return useMemo(() => {
    const providers = [...PROVIDERS, ...custom.map(customProviderDef)];
    const picked = viaProvider(current);
    return providers
      .filter((p) => !NATIVE_ENGINES[kind].has(p.id))
      .filter((p) => p.id === picked || usableModels(p, configs[p.id], envKeys).length > 0)
      .map((p) => ({
        id: viaEngine(p.id),
        name: p.name,
        logo: p.logo,
        tags: [{ label: p.custom ? "Yours" : "OpenAI-compatible" }],
        blurb:
          kind === "stt"
            ? `Its /audio/transcriptions on your ${p.name} key — type the model it offers.`
            : `Its /audio/speech on your ${p.name} key — type the model and voice it offers.`,
        keyOf: p.id,
      }));
  }, [kind, current, configs, envKeys, custom]);
}

/** The picked engine's tile, among the built-in ones and the providers'. */
function findChoice<T extends string>(choices: Choice<T>[], via: Choice<ViaEngine>[], engine: string): Choice<string> | undefined {
  return choices.find((c) => c.id === engine) ?? via.find((c) => c.id === engine);
}

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

/** Whether an engine's key is in place: Settings → Voice for the voice services, else Settings → Models. */
function useKeyReady() {
  const configs = useProviderConfigs();
  const envKeys = useEnvKeys();
  const voiceKeys = useVoiceKeys();
  return (keyOf?: string) => {
    if (!keyOf) return true;
    if (isVoiceService(keyOf)) return !!voiceKeys[keyOf]?.trim();
    const provider = getProvider(keyOf);
    return !!provider && hasKey(provider, configs[keyOf], envKeys);
  };
}

function spokenLang(settings: VoiceSettings): "th" | "en" {
  return settings.language === "en" ? "en" : "th";
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** The voice speaking now, in words. */
function voiceLabel(output: VoiceSettings["output"]) {
  if (output.engine === "system") return output.systemVoice ?? "System default";
  if (output.engine === "elevenlabs" || output.engine === "fishaudio") return output.voiceName ?? (output.voice ? "Custom voice" : "No voice yet");
  return VOICE_NAMES[output.voice] ?? capitalize(output.voice);
}

function EngineIcon({ choice, className }: { choice: Choice<string>; className?: string }) {
  return choice.logo ? <ProviderLogo logo={choice.logo} name={choice.name} className={cn("size-7", className)} /> : <>{choice.icon}</>;
}

/**
 * Settings → Voice: an overview of how Mali listens and speaks, with each
 * side's setup on a page of its own (`/settings/voice/listening`,
 * `/settings/voice/speaking`), where voices come straight from the service.
 */
export function VoiceSettings() {
  const { sub, open, back } = useSettingsSub();
  if (sub === "listening") {
    return (
      <PageEnter key="listening">
        <ListeningPage onBack={back} />
      </PageEnter>
    );
  }
  if (sub === "speaking") {
    return (
      <PageEnter key="speaking">
        <SpeakingPage onBack={back} />
      </PageEnter>
    );
  }
  return <VoiceOverview onOpen={open} />;
}

function VoiceOverview({ onOpen }: { onOpen: (sub: string) => void }) {
  const settings = useVoiceSettings();
  const ready = useKeyReady();
  const viaInputs = useViaChoices("stt", settings.input.engine);
  const viaOutputs = useViaChoices("tts", settings.output.engine);
  const input = findChoice(INPUTS, viaInputs, settings.input.engine) ?? INPUTS[0]!;
  const output = findChoice(OUTPUTS, viaOutputs, settings.output.engine) ?? OUTPUTS[0]!;
  const inputModelName =
    settings.input.engine === "system"
      ? "Built in"
      : (inputModelsFor(settings.input.engine).find((m) => m.id === inputModel(settings))?.name ?? (inputModel(settings) || undefined));

  return (
    <div className="flex flex-col gap-10">
      <PageHeader
        title="Voice"
        description="Talk to Mali — in the chat box, a voice chat, the notch and the Quick bar — and hear it answer. Everything runs in the cloud or in the system itself: no model is loaded into this computer’s memory."
      />

      <section className="flex flex-col gap-3">
        <SectionLabel>Setup</SectionLabel>
        <TileGrid className="xl:grid-cols-2">
          <Tile
            icon={<EngineIcon choice={input} />}
            title="Listening"
            description={`${input.name} turns your voice into text${inputModelName ? ` · ${inputModelName}` : ""}.`}
            meta={<KeyDot keyOf={input.keyOf} ready={ready(input.keyOf)} />}
            onOpen={() => onOpen("listening")}
            action={
              <TileButton label="Change how Mali listens" onClick={() => onOpen("listening")}>
                <ChevronRightIcon />
              </TileButton>
            }
          />
          <Tile
            icon={<EngineIcon choice={output} />}
            title="Speaking"
            description={`Answers in ${voiceLabel(settings.output)} from ${output.name}.`}
            meta={<KeyDot keyOf={output.keyOf} ready={ready(output.keyOf)} />}
            onOpen={() => onOpen("speaking")}
            action={
              <>
                <HearButton settings={settings} />
                <TileButton label="Change the voice" onClick={() => onOpen("speaking")}>
                  <ChevronRightIcon />
                </TileButton>
              </>
            }
          />
        </TileGrid>
      </section>

      <section className="flex flex-col gap-3">
        <SectionLabel>Try it</SectionLabel>
        <FlatRows>
          <TryListening />
          <TrySpeaking settings={settings} />
        </FlatRows>
      </section>

      <section className="flex flex-col gap-3">
        <SectionLabel>While talking</SectionLabel>
        <FlatRows>
          <SettingRow
            icon={<SendIcon />}
            label="Send when I stop talking"
            description="A short pause turns the mic off and sends what you said. Off: tap the mic (or ✓) when you’re done, and check the words first."
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
        </FlatRows>
      </section>
    </div>
  );
}

function KeyDot({ keyOf, ready }: { keyOf?: string; ready: boolean }) {
  if (!keyOf) return <Dot tone="success">Built in · offline</Dot>;
  if (ready) return <Dot tone="success">Connected</Dot>;
  const name = isVoiceService(keyOf) ? VOICE_SERVICES[keyOf].name : (getProvider(keyOf)?.name ?? keyOf);
  return <Dot tone="warning">Connect {name} to use it</Dot>;
}

/** The engines as tiles to pick from, one of them chosen. */
function EngineTiles<T extends string>({
  choices,
  value,
  onPick,
  label,
}: {
  choices: Choice<T>[];
  value: T;
  onPick: (id: T) => void;
  label: string;
}) {
  const ready = useKeyReady();
  return (
    <div role="radiogroup" aria-label={label}>
      <TileGrid>
        {choices.map((choice) => {
          const on = choice.id === value;
          const best = choice.tags.find((t) => t.tone === "best");
          const free = choice.tags.find((t) => t.tone === "free");
          const rest = choice.tags.filter((t) => t !== best && t !== free).map((t) => t.label);
          return (
            <Tile
              key={choice.id}
              radio
              selected={on}
              icon={<EngineIcon choice={choice} />}
              title={choice.name}
              badge={best ? <TileBadge>{best.label}</TileBadge> : free ? <TileBadge tone="free">{free.label}</TileBadge> : undefined}
              description={choice.blurb}
              meta={
                <>
                  <KeyDot keyOf={choice.keyOf} ready={ready(choice.keyOf)} />
                  {[best && free ? free.label : null, ...rest].filter(Boolean).map((tag) => (
                    <span key={tag} className="shrink-0">
                      · {tag}
                    </span>
                  ))}
                </>
              }
              onOpen={() => onPick(choice.id)}
              action={
                <AnimatePresence initial={false}>
                  {on && (
                    <motion.span
                      initial={{ scale: 0.4, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      exit={{ scale: 0.4, opacity: 0 }}
                      transition={{ duration: 0.2, ease: MALI_EASE }}
                      className="flex size-6 items-center justify-center rounded-full bg-violet-600 text-white"
                    >
                      <CheckIcon className="size-3.5" strokeWidth={3} />
                    </motion.span>
                  )}
                </AnimatePresence>
              }
            />
          );
        })}
      </TileGrid>
    </div>
  );
}

/**
 * What the picked engine needs before it works: a voice service's key right
 * here, or a provider connected in Settings → Models (one click away).
 */
function ConnectEngine({ keyOf }: { keyOf?: string }) {
  const ready = useKeyReady();
  const navigate = useNavigate();
  if (!keyOf) return null;
  if (isVoiceService(keyOf)) return <VoiceServiceKey service={keyOf} />;
  if (ready(keyOf)) return null;
  const provider = getProvider(keyOf);
  return (
    <div className="flex flex-col gap-3 border-y border-amber-500/30 py-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-center gap-3">
        <ProviderLogo logo={provider?.logo ?? keyOf} name={provider?.name ?? keyOf} className="size-6" />
        <p className="text-sm">
          <span className="font-medium">{provider?.name ?? keyOf} isn’t connected yet.</span>{" "}
          <span className="text-muted-foreground">It uses the same key as your chat models.</span>
        </p>
      </div>
      <Button type="button" className="shrink-0 gap-1.5" onClick={() => navigate(settingsPath("models", keyOf))}>
        Connect {provider?.name ?? keyOf}
        <ChevronRightIcon className="size-4" />
      </Button>
    </div>
  );
}

/** Paste a voice service's key and check it at once by listing its voices. */
function VoiceServiceKey({ service }: { service: VoiceService }) {
  const { name, keyUrl } = VOICE_SERVICES[service];
  const saved = useVoiceKeys()[service]?.trim() ?? "";
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [state, setState] = useState<{ checking?: boolean; error?: string; voices?: number }>({});

  const connect = async () => {
    if (!draft.trim()) return;
    setVoiceKey(service, draft);
    setState({ checking: true });
    try {
      const voices = await listVoices(service);
      setState({ voices: voices.length });
      setEditing(false);
      setDraft("");
    } catch (e) {
      setState({ error: String(e) });
    }
  };

  if (saved && !editing) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 border-y border-border/60 py-3 text-sm">
        <span className="flex items-center gap-2">
          <ProviderLogo logo={service} name={name} className="size-5" />
          <Dot tone="success">
            Connected to {name}
            {state.voices !== undefined && ` · ${state.voices} voices`}
          </Dot>
          <span className="font-mono text-xs text-muted-foreground">••••{saved.slice(-4)}</span>
        </span>
        <span className="flex items-center gap-1">
          <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setEditing(true)}>
            Change key
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 text-xs text-muted-foreground hover:text-destructive"
            onClick={() => {
              setVoiceKey(service, "");
              setState({});
            }}
          >
            Disconnect
          </Button>
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 border-y border-border/60 py-4">
      <div className="flex items-center gap-3">
        <ProviderLogo logo={service} name={name} className="size-6" />
        <div className="flex min-w-0 flex-col">
          <p className="text-sm font-medium">Connect {name}</p>
          <p className="text-xs text-muted-foreground">
            Paste an API key — its voices load from {name} straight away. Kept in the system keychain.
          </p>
        </div>
      </div>
      <form
        className="flex max-w-xl flex-col gap-2 sm:flex-row"
        onSubmit={(e) => {
          e.preventDefault();
          void connect();
        }}
      >
        <input
          type="password"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={`${name} API key`}
          autoComplete="off"
          spellCheck={false}
          aria-label={`${name} API key`}
          className="h-9 min-w-0 flex-1 rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        />
        <Button type="submit" className="h-9 gap-1.5" disabled={!draft.trim() || state.checking}>
          {state.checking && <LoaderIcon className="size-3.5 animate-spin" />}
          Connect
        </Button>
        <Button type="button" variant="outline" className="h-9 gap-1" onClick={() => void openUrl(keyUrl)}>
          Get a key <ExternalLinkIcon className="size-3" />
        </Button>
        {saved && (
          <Button type="button" variant="ghost" className="h-9" onClick={() => setEditing(false)}>
            Cancel
          </Button>
        )}
      </form>
      {state.error && <p className="text-xs leading-relaxed text-red-600 wrap-anywhere dark:text-red-400">{state.error}</p>}
    </div>
  );
}

type StaticModel = { id: string; name: string; note?: string };

/** Only these engines list their speech models (and any `via:` provider); the rest keep a built-in list. */
const FETCHABLE_MODELS = new Set(["elevenlabs", "openai", "groq"]);

/** "gpt-4o-mini-tts" → "Gpt 4o Mini Tts" for models the built-in list never named. */
function prettyModel(id: string) {
  return id
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** The pill that opens a field for a model id the list doesn't have. */
const CUSTOM_MODEL = "__custom";

/**
 * The MODEL pills, fetched live from the service (like the voices below
 * them) with the built-in list as fallback — so "Eleven v3 · Speaks Thai"
 * is what the service offers right now, not what shipped with the app.
 * Custom takes any model id the service accepts, for one too new for the list.
 */
function ModelPills({
  engine,
  kind,
  staticModels,
  value,
  onChange,
}: {
  engine: string;
  kind: "tts" | "stt";
  staticModels: StaticModel[];
  value: string;
  onChange: (id: string) => void;
}) {
  const [live, setLive] = useState<StaticModel[]>();
  const [loading, setLoading] = useState(false);
  const [stale, setStale] = useState(false);
  const [round, setRound] = useState(0);
  const [customOpen, setCustomOpen] = useState(false);
  const via = viaProvider(engine);
  const fetchable = FETCHABLE_MODELS.has(engine) || !!via;
  useEffect(() => setCustomOpen(false), [engine]);

  useEffect(() => {
    if (!fetchable) return;
    let on = true;
    setLoading(true);
    setStale(false);
    listSpeechModels(engine, kind)
      .then((models) => {
        if (!on) return;
        const friendly = new Map(staticModels.map((m) => [m.id, m]));
        setLive(
          models.map((m) => {
            const known = friendly.get(m.id);
            if (known) return known;
            return {
              id: m.id,
              name: m.name && m.name !== m.id ? m.name : prettyModel(m.id),
              note: kind === "tts" && engine === "elevenlabs" ? (m.thai ? "Speaks Thai" : "No Thai") : undefined,
            };
          }),
        );
      })
      .catch(() => on && setStale(true))
      .finally(() => on && setLoading(false));
    return () => {
      on = false;
    };
    // staticModels is fixed per engine; round refetches on demand.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, kind, fetchable, round]);

  const options = live ?? staticModels;
  // The pick still shows when the service renamed its list under it.
  const renamed = value && !options.some((m) => m.id === value) ? staticModels.find((m) => m.id === value) : undefined;
  const shown = renamed ? [...options, renamed] : options;
  // Neither listed nor built in: an id typed under Custom.
  const custom = !!value && !shown.some((m) => m.id === value);
  // A provider that lists no speech models: the id is typed, nothing to pick from.
  const typedOnly = shown.length === 0;
  if (typedOnly && !via) return null;

  const service =
    engine === "elevenlabs" ? "ElevenLabs" : engine === "groq" ? "Groq" : via ? (getProvider(via)?.name ?? via) : "OpenAI";
  return (
    <section className="flex flex-col gap-3">
      <SectionLabel
        action={
          <>
            {live && !loading && (
              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                <span className="size-1.5 rounded-full bg-current" />
                Live
              </span>
            )}
            {stale && <span className="text-[11px] text-muted-foreground">Built-in list</span>}
            <HelpHint
              label="About these models"
              text={`Fetched from ${service} right now — "Speaks Thai" means Thai was in what it listed. Pick one and it speaks (or listens) at once.`}
            />
            {fetchable && (
              <button
                type="button"
                onClick={() => setRound((n) => n + 1)}
                disabled={loading}
                aria-label="Refresh models"
                title="Fetch the models again"
                className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
              >
                <RefreshCwIcon className={cn("size-3.5", loading && "animate-spin")} />
              </button>
            )}
          </>
        }
      >
        Model
      </SectionLabel>
      {loading && !live ? (
        <p className="flex items-center gap-2 py-1 text-[13px] text-muted-foreground">
          <LoaderIcon className="size-3.5 animate-spin" /> Loading models from {service}…
        </p>
      ) : typedOnly ? (
        <p className="text-[13px] text-muted-foreground">
          {service} didn’t list a {kind === "tts" ? "speech" : "transcription"} model — type the id it gives in its docs.
        </p>
      ) : (
        <Pills
          label={kind === "tts" ? "Speech model" : "Transcription model"}
          value={customOpen || custom ? CUSTOM_MODEL : value}
          onChange={(id) => {
            setCustomOpen(id === CUSTOM_MODEL);
            if (id !== CUSTOM_MODEL) onChange(id);
          }}
          options={[
            ...shown.map((m) => ({ value: m.id, label: m.note ? `${m.name} · ${m.note}` : m.name })),
            { value: CUSTOM_MODEL, label: "Custom" },
          ]}
        />
      )}
      {(customOpen || custom || typedOnly) && (
        <CustomModelField
          key={engine}
          value={custom ? value : ""}
          example={staticModels[0]?.id ?? shown[0]?.id}
          onSave={(id) => {
            onChange(id);
            setCustomOpen(false);
          }}
        />
      )}
    </section>
  );
}

/** A model id typed by hand: saved on Enter or when the field is left. */
function CustomModelField({
  value,
  example,
  onSave,
  label = "Custom model id",
  hint = "Any model id the service accepts — sent exactly as typed. Press Enter to use it.",
  autoFocus = !value,
}: {
  value: string;
  example?: string;
  onSave: (id: string) => void;
  label?: string;
  hint?: string;
  autoFocus?: boolean;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const save = () => {
    const id = draft.trim();
    if (id && id !== value) onSave(id);
  };
  return (
    <div className="flex flex-col gap-1.5">
      <Input
        autoFocus={autoFocus}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={save}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            save();
          } else if (event.key === "Escape") setDraft(value);
        }}
        placeholder={example ? `${label.replace(/^Custom /, "")}, e.g. ${example}` : label}
        aria-label={label}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        className="h-9 font-mono text-[13px]"
      />
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}

function ListeningPage({ onBack }: { onBack: () => void }) {
  const settings = useVoiceSettings();
  const engine = settings.input.engine;
  const via = useViaChoices("stt", engine);
  const choice = findChoice(INPUTS, via, engine);
  const models = inputModelsFor(engine);
  return (
    <>
      <PageHeader
        back={{ label: "Voice", onClick: onBack }}
        title="Listening"
        description="What turns your voice into text. Free pick: Groq — its key from console.groq.com works here and for chat."
      />

      <section className="flex flex-col gap-3">
        <SectionLabel>Engine</SectionLabel>
        <EngineTiles
          label="Listening engine"
          choices={INPUTS}
          value={engine}
          onPick={pickInputEngine}
        />
      </section>

      <ViaEngines
        kind="stt"
        choices={via}
        value={engine}
        onPick={pickInputEngine}
      />

      <ConnectEngine keyOf={choice?.keyOf} />

      <ModelPills
        engine={engine}
        kind="stt"
        staticModels={models}
        value={inputModel(settings)}
        onChange={(model) => patchVoiceInput({ model })}
      />

      <section className="flex flex-col gap-3">
        <SectionLabel>Try it</SectionLabel>
        <FlatRows>
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
        </FlatRows>
      </section>
    </>
  );
}

function SpeakingPage({ onBack }: { onBack: () => void }) {
  const settings = useVoiceSettings();
  const { output } = settings;
  const via = useViaChoices("tts", output.engine);
  const choice = findChoice(OUTPUTS, via, output.engine);
  const models = OUTPUT_MODELS[output.engine] ?? [];
  const ready = useKeyReady()(choice?.keyOf);

  // Back on an engine set up before: its voice and model return; else a fresh start.
  const pickEngine = (engine: OutputEngine) =>
    pickOutputEngine(
      engine,
      engine === "puter"
        ? { voice: voicesFor({ ...output, engine })[0]! }
        : (FIRST_VOICE[engine] ?? { voice: viaProvider(engine) ? "alloy" : output.voice }),
    );

  return (
    <>
      <PageHeader
        back={{ label: "Voice", onClick: onBack }}
        title="Speaking"
        description="The voice Mali answers with. Voices are listed by the service itself — press ▶ to hear one, click it to use it."
        actions={<HearButton settings={settings} labelled />}
      />

      <section className="flex flex-col gap-3">
        <SectionLabel>Engine</SectionLabel>
        <EngineTiles label="Speaking engine" choices={OUTPUTS} value={output.engine} onPick={pickEngine} />
      </section>

      <ViaEngines kind="tts" choices={via} value={output.engine} onPick={pickEngine} />

      <ConnectEngine keyOf={choice?.keyOf} />

      <ModelPills
        engine={output.engine}
        kind="tts"
        staticModels={models}
        value={outputModel(output)}
        onChange={(model) => patchVoiceOutput({ model })}
      />

      {ready && <VoiceGallery key={output.engine} settings={settings} />}
    </>
  );
}

/** Where a voice in the gallery came from, so a preview knows how to play. */
type GalleryVoice = VoiceOption;

/**
 * Every voice the engine offers, as a gallery: the service's own list (with
 * its samples and labels) for ElevenLabs and Fish Audio, the fixed sets for
 * OpenAI and Puter, the system's for the system voice.
 */
function VoiceGallery({ settings }: { settings: VoiceSettings }) {
  const { output } = settings;
  const engine = output.engine;
  const lang = spokenLang(settings);
  const remote = engine === "elevenlabs" || engine === "fishaudio";
  const systemVoices = useSystemVoices(lang);
  const [tab, setTab] = useState<"library" | "yours">("library");
  const [query, setQuery] = useState("");
  const [voices, setVoices] = useState<GalleryVoice[]>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [round, setRound] = useState(0);

  // The services search their own libraries; wait for typing to settle.
  const remoteQuery = remote ? query.trim() : "";
  useEffect(() => {
    if (!remote) return;
    let live = true;
    const timer = setTimeout(() => {
      setLoading(true);
      setError(undefined);
      listVoices(engine, { language: lang, query: remoteQuery })
        .then((list) => {
          if (!live) return;
          setVoices(list);
          // Nothing picked yet (Fish Audio has no voice every account shares): take the first.
          const first = list[0];
          if (first) updateVoiceOutput((o) => (o.engine === engine && !o.voice ? { ...o, voice: first.id, voiceName: first.name } : o));
        })
        .catch((e) => live && setError(String(e)))
        .finally(() => live && setLoading(false));
    }, remoteQuery ? 450 : 0);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [engine, remote, lang, remoteQuery, round]);

  const fixed = (ids: string[]): GalleryVoice[] =>
    ids.map((id) => ({ id, name: VOICE_NAMES[id] ?? capitalize(id), mine: false, tags: VOICE_TAGS[id] ?? [] }));

  const all: GalleryVoice[] = remote
    ? // Fish Audio's list mixes in popular voices; the library tab has those.
      (voices ?? []).filter((v) => engine === "elevenlabs" || v.mine)
    : engine === "system"
      ? [
          { id: "", name: "System default", mine: false, tags: ["follows macOS"] },
          ...systemVoices.map((v) => ({
            id: v.name,
            name: v.name.replace(/\s*\((premium|enhanced)\)/i, ""),
            mine: false,
            tags: [v.lang, ...(/premium/i.test(v.name) ? ["premium"] : /enhanced/i.test(v.name) ? ["enhanced"] : [])],
          })),
        ]
      : fixed(voicesFor(output));

  const q = query.trim().toLowerCase();
  const shown = remote || !q ? all : all.filter((v) => `${v.name} ${v.tags.join(" ")}`.toLowerCase().includes(q));
  const selectedId = engine === "system" ? (output.systemVoice ?? "") : output.voice;

  const pick = (voice: GalleryVoice) =>
    patchVoiceOutput(
      engine === "system" ? { systemVoice: voice.id || undefined } : { voice: voice.id, voiceName: remote ? voice.name : undefined },
    );

  const preview = (voice: GalleryVoice) => () => {
    // No sample from the service: say a line in this voice.
    const trial: VoiceSettings = {
      ...settings,
      output:
        engine === "system"
          ? { ...output, systemVoice: voice.id || undefined }
          : { ...output, voice: voice.id, voiceName: voice.name },
    };
    void speak(SAMPLE[lang], trial, { id: `voice-preview:${engine}:${voice.id}` });
  };

  return (
    <section className="flex flex-col gap-4">
      <SectionLabel
        action={
          remote &&
          tab === "yours" && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setRound((n) => n + 1)}
              disabled={loading}
              className="h-7 gap-1.5 px-2 text-xs text-muted-foreground"
            >
              <RefreshCwIcon className={cn("size-3.5", loading && "animate-spin")} />
              Refresh
            </Button>
          )
        }
      >
        Voice
      </SectionLabel>

      {remote && (
        <Pills
          label="Voices"
          value={tab}
          onChange={setTab}
          options={[
            { value: "library", label: "Voice library" },
            { value: "yours", label: "Your voices", count: voices ? all.length : undefined },
          ]}
        />
      )}

      {remote && tab === "library" ? (
        <VoiceLibrary engine={engine} settings={settings} />
      ) : (
        <>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            {engine === "puter" ? (
              <Pills
                label="Whose voices"
                value={output.puterVoices}
                onChange={(puterVoices: PuterVoices) =>
                  patchVoiceOutput({ puterVoices, voice: voicesFor({ ...output, puterVoices })[0]! })
                }
                options={PUTER_VOICES}
              />
            ) : (
              <p className="text-[13px] text-muted-foreground">
                {remote
                  ? `Voices in your ${VOICE_SERVICES[engine].name} account${engine === "elevenlabs" ? ", including ones added from the library" : ""}.`
                  : engine === "system"
                    ? "Add Premium voices in System Settings → Accessibility → Spoken Content."
                    : viaProvider(engine)
                      ? "OpenAI’s voice names, which most compatible services take — or type the one yours offers below."
                      : "OpenAI’s voices all speak Thai and English."}
              </p>
            )}
            {(remote || all.length > 8) && (
              <SearchField
                value={query}
                onChange={setQuery}
                placeholder={remote ? `Search your ${VOICE_SERVICES[engine].name} voices…` : "Search voices…"}
                busy={loading && !!remoteQuery}
              />
            )}
          </div>

          {error ? (
            <p className="text-[13px] leading-relaxed text-red-600 wrap-anywhere dark:text-red-400">{error}</p>
          ) : remote && !voices ? (
            <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
              <LoaderIcon className="size-3.5 animate-spin" /> Loading voices from {VOICE_SERVICES[engine].name}…
            </p>
          ) : shown.length === 0 ? (
            <p className="py-6 text-center text-[13px] text-muted-foreground">
              {q
                ? `No voice matches “${query.trim()}”.`
                : remote
                  ? "No voices of your own yet — pick one from the Voice library."
                  : "No voices for this language yet."}
            </p>
          ) : (
            <ul className="flex flex-col">
              {shown.map((voice) => {
                const on = voice.id === selectedId;
                return (
                  <VoiceRow
                    key={voice.id || "default"}
                    name={voice.name}
                    description={voice.tags.length > 0 ? voice.tags.map(capitalize).join(" · ") : voice.description}
                    preview={voice.preview}
                    previewId={`voice-preview:${engine}:${voice.id}`}
                    onPreview={preview(voice)}
                    selected={on}
                    badge={voice.mine && engine === "fishaudio" ? <TileBadge tone="muted">Yours</TileBadge> : undefined}
                    actions={
                      <RowButton label={on ? "Mali’s voice" : `Use ${voice.name}`} onClick={() => pick(voice)} active={on}>
                        {on ? <CheckIcon /> : <PlusIcon />}
                      </RowButton>
                    }
                  />
                );
              })}
            </ul>
          )}
          {(viaProvider(engine) || (remote && voices)) && (
            <CustomModelField
              key={`voice:${engine}`}
              value={all.some((v) => v.id === output.voice) ? "" : output.voice}
              example={remote ? undefined : "alloy"}
              label="Custom voice id"
              autoFocus={false}
              hint={
                remote
                  ? `A voice id from ${VOICE_SERVICES[engine].name} — sent exactly as typed, and kept for this engine. Press Enter to use it.`
                  : "Any voice the service accepts — sent exactly as typed. Press Enter to use it."
              }
              onSave={(voice) => patchVoiceOutput({ voice, voiceName: undefined })}
            />
          )}
        </>
      )}
    </section>
  );
}

/**
 * The providers connected in Settings → Models, as engines: whatever speaks
 * the OpenAI-compatible audio API — a service that just started offering
 * speech, or a server on this computer.
 */
function ViaEngines({
  kind,
  choices,
  value,
  onPick,
}: {
  kind: "stt" | "tts";
  choices: Choice<ViaEngine>[];
  value: string;
  onPick: (engine: ViaEngine) => void;
}) {
  const navigate = useNavigate();
  return (
    <section className="flex flex-col gap-3">
      <SectionLabel
        action={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 px-2 text-xs text-muted-foreground"
            onClick={() => navigate(settingsPath("models", "new"))}
          >
            <PlusIcon className="size-3.5" />
            Add provider
          </Button>
        }
      >
        Your providers
      </SectionLabel>
      {choices.length === 0 ? (
        <p className="text-[13px] leading-relaxed text-muted-foreground">
          Any provider connected in Settings → Models whose API offers {kind === "tts" ? "/audio/speech" : "/audio/transcriptions"} can{" "}
          {kind === "tts" ? "speak" : "listen"} here too — connect one (or add your own) and it shows up.
        </p>
      ) : (
        <EngineTiles
          label={kind === "tts" ? "Speaking engine from your providers" : "Listening engine from your providers"}
          choices={choices}
          value={value as ViaEngine}
          onPick={onPick}
        />
      )}
    </section>
  );
}

/** Play a short line in the voice that's set. */
function HearButton({ settings, labelled }: { settings: VoiceSettings; labelled?: boolean }) {
  const state = useSyncExternalStore(subscribeSpeaker, speakerState);
  const id = "voice-hear";
  const busy = state.id === id && (state.speaking || state.loading);
  const run = () => (busy ? stopSpeaking() : void speak(SAMPLE[spokenLang(settings)], settings, { id }));
  if (!labelled) {
    return (
      <TileButton label={busy ? "Stop" : "Hear the voice"} onClick={run} active={busy}>
        {busy ? <SquareIcon className="fill-current" /> : <PlayIcon className="fill-current" />}
      </TileButton>
    );
  }
  return (
    <Button type="button" variant={busy ? "secondary" : "outline"} className="gap-1.5" onClick={run}>
      {busy ? <SquareIcon className="size-3 fill-current" /> : <Volume2Icon className="size-4" />}
      {busy ? "Stop" : "Hear it"}
    </Button>
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
      label="Say something"
      description={voice.listening ? "Speak now — it stops when you pause." : "See what Mali hears."}
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
            <p className="rounded-lg bg-muted/50 px-3 py-2 text-sm">“{heard}”</p>
          </motion.div>
        )}
      </AnimatePresence>
    </SettingRow>
  );
}

function TrySpeaking({ settings }: { settings: VoiceSettings }) {
  const state = useSyncExternalStore(subscribeSpeaker, speakerState);
  const id = "voice-try";
  const mine = state.id === id;
  const busy = mine && (state.speaking || state.loading);
  useToastError(mine && state.error && !busy ? state.error : undefined);
  return (
    <SettingRow
      icon={<Volume2Icon />}
      label="Hear Mali"
      description={(mine && state.error) || `A short line in ${voiceLabel(settings.output)}.`}
      control={
        <Button
          type="button"
          variant={busy ? "secondary" : "outline"}
          size="sm"
          className="h-8 min-w-24 gap-1.5 rounded-xl text-xs"
          onClick={() => (busy ? stopSpeaking() : void speak(SAMPLE[spokenLang(settings)], settings, { id }))}
        >
          {state.loading && mine ? (
            <>
              <Waveform bars={4} className="h-3 gap-[2px]" barClassName="w-[2px]" /> Preparing
            </>
          ) : busy ? (
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
    />
  );
}
