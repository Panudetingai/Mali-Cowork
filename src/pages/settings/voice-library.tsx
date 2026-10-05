import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/animate-ui/primitives/radix/dropdown-menu";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import {
  adoptLibraryVoice,
  patchVoiceSettings,
  playClip,
  speakerState,
  stopSpeaking,
  subscribeSpeaker,
  voiceLibrary,
  VOICE_SERVICES,
  type LibraryFilters,
  type LibraryVoice,
  type VoiceService,
  type VoiceSettings,
} from "@/features/voice";
import { cn } from "@/lib/utils";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  ArrowDownWideNarrowIcon,
  BookOpenIcon,
  CheckIcon,
  ChevronDownIcon,
  CopyIcon,
  ExternalLinkIcon,
  GraduationCapIcon,
  HourglassIcon,
  LoaderIcon,
  MegaphoneIcon,
  MessageSquareIcon,
  MoreVerticalIcon,
  PlayIcon,
  PlusIcon,
  SmileIcon,
  SquareIcon,
  SquareUserIcon,
  TvIcon,
  UsersIcon,
  XIcon,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useState, useSyncExternalStore, type ComponentProps, type ReactNode } from "react";
import { SearchField } from "./ui";
import { menuClass, menuItemClass } from "./skills/skill-row";

/** Languages people pick most, flag first. */
export const LANGUAGES: { id: string; name: string; flag: string }[] = [
  { id: "th", name: "Thai", flag: "🇹🇭" },
  { id: "en", name: "English", flag: "🇺🇸" },
  { id: "ja", name: "Japanese", flag: "🇯🇵" },
  { id: "zh", name: "Chinese", flag: "🇨🇳" },
  { id: "ko", name: "Korean", flag: "🇰🇷" },
  { id: "vi", name: "Vietnamese", flag: "🇻🇳" },
  { id: "id", name: "Indonesian", flag: "🇮🇩" },
  { id: "ms", name: "Malay", flag: "🇲🇾" },
  { id: "fil", name: "Filipino", flag: "🇵🇭" },
  { id: "hi", name: "Hindi", flag: "🇮🇳" },
  { id: "fr", name: "French", flag: "🇫🇷" },
  { id: "de", name: "German", flag: "🇩🇪" },
  { id: "es", name: "Spanish", flag: "🇪🇸" },
  { id: "pt", name: "Portuguese", flag: "🇧🇷" },
  { id: "it", name: "Italian", flag: "🇮🇹" },
  { id: "ru", name: "Russian", flag: "🇷🇺" },
  { id: "ar", name: "Arabic", flag: "🇸🇦" },
];

const language = (id?: string | null) => LANGUAGES.find((l) => l.id === id?.toLowerCase());

/** ElevenLabs' use cases, as its library names them. */
const USE_CASES: { id: string; label: string; icon: LucideIcon }[] = [
  { id: "conversational", label: "Conversational", icon: MessageSquareIcon },
  { id: "narrative_story", label: "Narration", icon: BookOpenIcon },
  { id: "characters_animation", label: "Characters", icon: SmileIcon },
  { id: "social_media", label: "Social Media", icon: SquareUserIcon },
  { id: "informative_educational", label: "Educational", icon: GraduationCapIcon },
  { id: "advertisement", label: "Advertisement", icon: MegaphoneIcon },
  { id: "entertainment_tv", label: "Entertainment & TV", icon: TvIcon },
];

/** The use case a voice names (`narrative story`), as the filter shows it. */
function useCaseOf(raw?: string | null) {
  if (!raw) return undefined;
  const key = raw.toLowerCase().replace(/\s+/g, "_");
  return USE_CASES.find((u) => u.id === key) ?? { id: key, label: capitalize(raw), icon: MessageSquareIcon };
}

const SORTS: { id: NonNullable<LibraryFilters["sort"]>; label: string }[] = [
  { id: "trending", label: "Trending" },
  { id: "usage", label: "Most used" },
  { id: "newest", label: "Newest" },
];

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function compact(n: number) {
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1).replace(/\.0$/, "")}K` : String(n);
}

function noticeLabel(days: number) {
  return days >= 365 ? `${Math.round(days / 365)}y` : days >= 30 ? `${Math.round(days / 30)}mo` : `${days}d`;
}

function libraryLink(engine: VoiceService, id: string) {
  return engine === "elevenlabs"
    ? `https://elevenlabs.io/app/voice-library?voiceId=${encodeURIComponent(id)}`
    : `https://fish.audio/m/${encodeURIComponent(id)}/`;
}

/**
 * The service's public voice library, like its own site: search, language,
 * accent and use-case filters, then one row per voice — hear it, and `+`
 * makes it Mali's voice (added to the ElevenLabs account first).
 */
export function VoiceLibrary({ engine, settings }: { engine: VoiceService; settings: VoiceSettings }) {
  const { output } = settings;
  const isEleven = engine === "elevenlabs";
  const [query, setQuery] = useState("");
  const [typed, setTyped] = useState("");
  const [lang, setLang] = useState<string | undefined>(settings.language === "en" ? "en" : "th");
  const [accent, setAccent] = useState<string>();
  const [useCase, setUseCase] = useState<string>();
  const [sort, setSort] = useState<NonNullable<LibraryFilters["sort"]>>("trending");
  const [voices, setVoices] = useState<LibraryVoice[]>([]);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  /** Accents seen in this language, for the accent menu. */
  const [accents, setAccents] = useState<string[]>([]);
  const [adding, setAdding] = useState<string>();

  // The service searches as you type, once typing settles.
  useEffect(() => {
    const timer = setTimeout(() => setQuery(typed.trim()), 450);
    return () => clearTimeout(timer);
  }, [typed]);

  // New filters start over at the first page.
  useEffect(() => setPage(0), [query, lang, accent, useCase, sort]);
  useEffect(() => {
    setAccent(undefined);
    setAccents([]);
  }, [lang]);

  useEffect(() => {
    let live = true;
    setLoading(true);
    setError(undefined);
    voiceLibrary(engine, { query, language: lang, accent, useCase, sort, page })
      .then((result) => {
        if (!live) return;
        setVoices((prev) => (page === 0 ? result.voices : [...prev, ...result.voices.filter((v) => !prev.some((p) => p.id === v.id))]));
        setHasMore(result.hasMore);
        const seen = result.voices.map((v) => v.accent?.toLowerCase()).filter((a): a is string => !!a);
        setAccents((prev) => [...new Set([...prev, ...seen])].sort());
      })
      .catch((e) => live && setError(String(e)))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [engine, query, lang, accent, useCase, sort, page]);

  const use = async (voice: LibraryVoice) => {
    setAdding(voice.id);
    try {
      const id = await adoptLibraryVoice(engine, voice);
      patchVoiceSettings({ output: { ...output, voice: id, voiceName: voice.name } });
      toast.success(`${shortName(voice.name)} is Mali’s voice now`, {
        description: isEleven ? "Added to your ElevenLabs voices." : undefined,
      });
    } catch (e) {
      toast.error("Couldn’t use that voice", { description: String(e) });
    } finally {
      setAdding(undefined);
    }
  };

  const picked = language(lang);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2">
        <SearchField
          value={typed}
          onChange={setTyped}
          placeholder="Search library voices…"
          className="sm:w-auto sm:flex-1"
          busy={loading && !!query}
        />
        <Menu
          trigger={
            <Button type="button" variant="outline" className="h-9 gap-1.5 px-3 text-[13px]">
              <ArrowDownWideNarrowIcon className="size-4" />
              <span className="hidden sm:inline">{SORTS.find((s) => s.id === sort)?.label}</span>
            </Button>
          }
          items={SORTS.map((s) => ({ key: s.id, label: s.label, on: s.id === sort, onSelect: () => setSort(s.id) }))}
        />
      </div>

      <div className="scroll-hidden -mx-1 flex items-center gap-2 overflow-x-auto px-1 py-0.5">
        <Menu
          trigger={
            <FilterChip active={!!picked}>
              {picked ? (
                <>
                  <span className="text-[15px] leading-none">{picked.flag}</span>
                  {picked.name}
                  <span
                    role="button"
                    tabIndex={0}
                    aria-label="Any language"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      setLang(undefined);
                    }}
                    className="-mr-1 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    <XIcon className="size-3.5" />
                  </span>
                </>
              ) : (
                <>
                  Any language <ChevronDownIcon className="size-3.5 opacity-60" />
                </>
              )}
            </FilterChip>
          }
          items={LANGUAGES.map((l) => ({
            key: l.id,
            label: (
              <>
                <span className="text-[15px] leading-none">{l.flag}</span> {l.name}
              </>
            ),
            on: l.id === lang,
            onSelect: () => setLang(l.id),
          }))}
        />
        {isEleven && (
          <Menu
            trigger={
              <FilterChip active={!!accent}>
                {accent ? capitalize(accent) : "Select accent"} <ChevronDownIcon className="size-3.5 opacity-60" />
              </FilterChip>
            }
            items={[
              { key: "", label: "Any accent", on: !accent, onSelect: () => setAccent(undefined) },
              ...accents.map((a) => ({ key: a, label: capitalize(a), on: a === accent, onSelect: () => setAccent(a) })),
            ]}
          />
        )}
        {isEleven && (
          <>
            <span className="mx-1 h-6 w-px shrink-0 bg-border" />
            {USE_CASES.map((u) => (
              <FilterChip key={u.id} active={useCase === u.id} onClick={() => setUseCase(useCase === u.id ? undefined : u.id)}>
                <u.icon className="size-4 opacity-80" />
                {u.label}
              </FilterChip>
            ))}
          </>
        )}
      </div>

      <p className="pt-1 text-[13px] text-muted-foreground">
        {loading && page === 0 ? "Searching…" : `${voices.length}${hasMore ? "+" : ""} voice${voices.length === 1 ? "" : "s"}`}
      </p>

      {error ? (
        <p className="text-[13px] leading-relaxed text-red-600 wrap-anywhere dark:text-red-400">{error}</p>
      ) : !loading && voices.length === 0 ? (
        <p className="py-8 text-center text-[13px] text-muted-foreground">
          No voices match — try another language or fewer filters.
        </p>
      ) : (
        <ul className={cn("flex flex-col", loading && page === 0 && "opacity-60 transition-opacity")}>
          {voices.map((voice) => {
            const selected = voice.id === output.voice || voice.name === output.voiceName;
            const useCaseInfo = useCaseOf(voice.useCase);
            return (
              <VoiceRow
                key={voice.id}
                name={voice.name}
                description={voice.description}
                preview={voice.preview}
                previewId={`library:${engine}:${voice.id}`}
                selected={selected}
                language={voice.language}
                accent={voice.accent}
                stats={
                  <>
                    {voice.noticeDays != null && voice.noticeDays > 0 && (
                      <span className="inline-flex items-center gap-1" title={`Stays available for at least ${voice.noticeDays} days`}>
                        <HourglassIcon className="size-3.5" />
                        {noticeLabel(voice.noticeDays)}
                      </span>
                    )}
                    {voice.users != null && (
                      <span className="inline-flex items-center gap-1" title={isEleven ? "People who added it" : "Times used"}>
                        <UsersIcon className="size-3.5" />
                        {compact(voice.users)}
                      </span>
                    )}
                  </>
                }
                useCase={
                  useCaseInfo && (
                    <span className="inline-flex min-w-0 items-center gap-1.5">
                      <useCaseInfo.icon className="size-4 shrink-0 opacity-70" />
                      <span className="truncate">{useCaseInfo.label}</span>
                    </span>
                  )
                }
                actions={
                  <>
                    <RowButton
                      label={selected ? "Mali’s voice" : `Use ${shortName(voice.name)}`}
                      onClick={() => !selected && void use(voice)}
                      active={selected}
                    >
                      {adding === voice.id ? <LoaderIcon className="animate-spin" /> : selected ? <CheckIcon /> : <PlusIcon />}
                    </RowButton>
                    <RowButton label="Copy voice ID" onClick={() => void copyId(voice.id)}>
                      <CopyIcon />
                    </RowButton>
                    <Menu
                      trigger={
                        <button
                          type="button"
                          aria-label={`More for ${voice.name}`}
                          className="flex size-8 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
                        >
                          <MoreVerticalIcon className="size-4" />
                        </button>
                      }
                      items={[
                        { key: "use", label: "Use this voice", onSelect: () => void use(voice) },
                        { key: "copy", label: "Copy voice ID", onSelect: () => void copyId(voice.id) },
                        {
                          key: "open",
                          label: (
                            <>
                              Open on {VOICE_SERVICES[engine].name} <ExternalLinkIcon className="size-3.5 opacity-60" />
                            </>
                          ),
                          onSelect: () => void openUrl(libraryLink(engine, voice.id)),
                          separated: true,
                        },
                      ]}
                    />
                  </>
                }
              />
            );
          })}
        </ul>
      )}

      {hasMore && !error && (
        <Button type="button" variant="outline" className="mx-auto mt-1 gap-1.5" disabled={loading} onClick={() => setPage((p) => p + 1)}>
          {loading && <LoaderIcon className="size-3.5 animate-spin" />}
          Load more
        </Button>
      )}
    </div>
  );
}

async function copyId(id: string) {
  try {
    await navigator.clipboard.writeText(id);
    toast.success("Voice ID copied");
  } catch {
    toast.error("Couldn’t copy", { description: id });
  }
}

/** "Anan - Confident, Deep, Firm" → "Anan". */
function shortName(name: string) {
  return name.split(/\s+[-–—|]\s+/)[0] ?? name;
}

/** A gradient orb per voice, so a long list is easy to scan. */
function orb(name: string) {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360;
  const h2 = (h + 50) % 360;
  return `radial-gradient(circle at 32% 28%, oklch(0.9 0.08 ${h}) 0%, oklch(0.62 0.16 ${h}) 38%, oklch(0.32 0.1 ${h2}) 100%)`;
}

/**
 * One voice as a row: orb (press to hear it), name and description, language,
 * stats, use case, and actions on the right. Shared by the library and the
 * account's own voices.
 */
export function VoiceRow({
  name,
  description,
  preview,
  previewId,
  onPreview,
  selected,
  badge,
  language: lang,
  accent,
  stats,
  useCase,
  actions,
}: {
  name: string;
  description?: ReactNode;
  /** A sample from the service. */
  preview?: string | null;
  previewId: string;
  /** Hear it another way, when there's no sample. */
  onPreview?: () => void;
  selected?: boolean;
  badge?: ReactNode;
  language?: string | null;
  accent?: string | null;
  stats?: ReactNode;
  useCase?: ReactNode;
  actions: ReactNode;
}) {
  const state = useSyncExternalStore(subscribeSpeaker, speakerState);
  const playing = state.id === previewId && (state.speaking || state.loading);
  const canPreview = !!preview || !!onPreview;
  const hear = () => {
    if (playing) return stopSpeaking();
    if (preview) return void playClip(preview, { id: previewId });
    onPreview?.();
  };
  const lang_ = language(lang);
  return (
    <li
      className={cn(
        "group grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 rounded-lg px-2 py-2 transition-colors md:grid-cols-[minmax(0,2.4fr)_minmax(0,1fr)_minmax(0,0.8fr)_auto] xl:grid-cols-[minmax(0,2.4fr)_minmax(0,1fr)_minmax(0,0.8fr)_minmax(0,1fr)_auto]",
        selected ? "bg-violet-500/[0.07]" : "hover:bg-muted/50",
      )}
    >
      <div className="flex min-w-0 items-center gap-3">
        <button
          type="button"
          onClick={hear}
          disabled={!canPreview}
          aria-label={playing ? `Stop ${name}` : `Hear ${name}`}
          title={canPreview ? (playing ? "Stop" : "Hear it") : "No sample"}
          className="relative flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-full text-white shadow-sm ring-1 ring-black/5"
          style={{ background: orb(name) }}
        >
          <span
            className={cn(
              "flex size-full items-center justify-center bg-black/35 transition-opacity",
              playing ? "opacity-100" : "opacity-0 group-hover:opacity-100",
              !canPreview && "hidden",
            )}
          >
            {playing && state.loading ? (
              <LoaderIcon className="size-3.5 animate-spin" />
            ) : playing ? (
              <SquareIcon className="size-3 fill-current" />
            ) : (
              <PlayIcon className="size-3.5 translate-x-px fill-current" />
            )}
          </span>
        </button>
        <div className="flex min-w-0 flex-col">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-[13.5px] font-semibold">{name}</span>
            {badge}
            {selected && (
              <span className="shrink-0 rounded bg-violet-600 px-1.5 py-px text-[10px] font-bold tracking-wide text-white uppercase">
                In use
              </span>
            )}
          </span>
          {description && <span className="truncate text-xs text-muted-foreground">{description}</span>}
        </div>
      </div>

      <div className="hidden min-w-0 items-center gap-1.5 text-[13px] md:flex">
        {lang_ || lang ? (
          <>
            {lang_ && <span className="text-[15px] leading-none">{lang_.flag}</span>}
            <span className="truncate">{lang_?.name ?? lang}</span>
            {accent && <span className="truncate text-muted-foreground">{capitalize(accent)}</span>}
          </>
        ) : (
          accent && <span className="truncate text-muted-foreground">{capitalize(accent)}</span>
        )}
      </div>
      <div className="hidden min-w-0 items-center gap-3 text-[13px] text-muted-foreground md:flex">{stats}</div>
      <div className="hidden min-w-0 text-[13px] text-muted-foreground xl:block">{useCase}</div>
      <div className="flex shrink-0 items-center gap-0.5">{actions}</div>
    </li>
  );
}

export function RowButton({
  label,
  onClick,
  children,
  active,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        "flex size-8 items-center justify-center rounded-full transition-colors [&_svg]:size-[18px]",
        active ? "text-violet-600 dark:text-violet-300" : "text-foreground/80 hover:bg-muted hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

/** A filter; also a menu's trigger, so it passes on what the menu gives it. */
function FilterChip({ active, children, className, ...rest }: ComponentProps<"button"> & { active?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      {...rest}
      className={cn(
        "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border px-3 text-[13px] whitespace-nowrap transition-colors",
        active
          ? "border-foreground/70 bg-muted font-medium text-foreground"
          : "border-border text-foreground/80 hover:bg-muted/60 hover:text-foreground",
        className,
      )}
    >
      {children}
    </button>
  );
}

function Menu({
  trigger,
  items,
}: {
  trigger: ReactNode;
  items: { key: string; label: ReactNode; on?: boolean; onSelect: () => void; separated?: boolean }[];
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent align="start" sideOffset={6} className={cn(menuClass, "max-h-80 overflow-y-auto")}>
        {items.map((item) => (
          <div key={item.key}>
            {item.separated && <DropdownMenuSeparator className="-mx-1 my-1 h-px bg-border" />}
            <DropdownMenuItem className={menuItemClass} onSelect={item.onSelect}>
              <span className="flex flex-1 items-center gap-2">{item.label}</span>
              {item.on && <CheckIcon className="size-4 text-muted-foreground" />}
            </DropdownMenuItem>
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
