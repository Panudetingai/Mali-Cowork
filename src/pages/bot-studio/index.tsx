"use client";

import { CoworkBot } from "@/components/anim/cowork-bot";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  BOTS,
  customIdOf,
  setCoworkBot,
  useCoworkBot,
  type BotState,
  type CoworkBotId,
} from "@/features/cowork-bot";
import {
  EAR_KINDS,
  MAX_LEVEL,
  MOUTH_KINDS,
  MOVES,
  SHAPES,
  UNLOCKS,
  downloadBotExport,
  distillFromRecentChats,
  importBotBundle,
  lookFrom,
  parseBotImport,
  presetOf,
  previewSize,
  removeCustomBot,
  saveCustomBot,
  setActiveBot,
  stageOf,
  unlocked,
  useBotStudio,
  xpProgress,
  type BotLook,
  type CustomBot,
  type LookPart,
} from "@/features/bot-studio";
import { partLabel } from "@/features/bot-studio/level-up";
import { useTranslation, type TranslationKey } from "@/features/i18n";
import { MALI_EASE } from "@/lib/motion-presets";
import { cn } from "@/lib/utils";
import {
  BotIcon,
  CheckIcon,
  DownloadIcon,
  LockIcon,
  PlusIcon,
  SparklesIcon,
  Trash2Icon,
  UploadIcon,
} from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

const PRESET_COLORS = ["#f5c518", "#34c77b", "#8b5cf6", "#f7609f", "#3aa3f5", "#ff9a2e", "#2a2a33", "#f0443a"];

/** The poses to try: the same ones the bot takes in chat, the notch and the Inbox. */
const POSES: { state: BotState; label: TranslationKey }[] = [
  { state: "idle", label: "botStudioPoseIdle" },
  { state: "thinking", label: "botStudioPoseThinking" },
  { state: "working", label: "botStudioPoseWorking" },
  { state: "tool", label: "botStudioPoseTool" },
  { state: "question", label: "botStudioPoseQuestion" },
  { state: "permission", label: "botStudioPosePermission" },
  { state: "done", label: "botStudioPoseDone" },
  { state: "alert", label: "botStudioPoseAlert" },
];

const STAGE_LABEL: Record<ReturnType<typeof stageOf>["key"], TranslationKey> = {
  baby: "botStudioStageBaby",
  kid: "botStudioStageKid",
  teen: "botStudioStageTeen",
  adult: "botStudioStageAdult",
  grown: "botStudioStageGrown",
};

const SHAPE_LABEL: Record<BotLook["shape"], TranslationKey> = {
  round: "botStudioShapeRound",
  chubby: "botStudioShapeChubby",
  tall: "botStudioShapeTall",
};
const MOVE_LABEL: Record<BotLook["move"], TranslationKey> = {
  wave: "botStudioMoveWave",
  hop: "botStudioMoveHop",
  orbit: "botStudioMoveOrbit",
  snake: "botStudioMoveSnake",
};
const EAR_LABEL: Record<BotLook["ears"], TranslationKey> = {
  none: "botStudioNone",
  cat: "botStudioEarCat",
  bunny: "botStudioEarBunny",
  bear: "botStudioEarBear",
  fox: "botStudioEarFox",
  panda: "botStudioEarPanda",
  leaf: "botStudioEarLeaf",
  tuft: "botStudioEarTuft",
};
const MOUTH_LABEL: Record<BotLook["mouth"], TranslationKey> = {
  smile: "botStudioMouthSmile",
  cat: "botStudioMouthCat",
};

/** A design change is saved (and reaches the notch) once the picking settles. */
const SAVE_LOOK_MS = 250;

export default function BotStudioPage() {
  const { t } = useTranslation();
  const { bots, activeBotId } = useBotStudio();
  const { bot: mainBot } = useCoworkBot();
  const [selectedId, setSelectedId] = useState<string | undefined>(() => activeBotId ?? bots[0]?.id);
  const selected = bots.find((b) => b.id === selectedId) ?? bots[0];
  const mainId = customIdOf(mainBot);

  const select = (id: string) => {
    setSelectedId(id);
    setActiveBot(id);
  };

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-8 sm:px-6 lg:flex-row lg:items-start lg:gap-10 lg:py-10">
      <aside className="flex w-full shrink-0 flex-col gap-4 lg:sticky lg:top-10 lg:w-56">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{t("botStudioTitle")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("botStudioSubtitle")}</p>
        </div>
        <Button
          type="button"
          className="gap-2 rounded-xl"
          onClick={() => {
            const color = PRESET_COLORS[bots.length % PRESET_COLORS.length]!;
            const bot = saveCustomBot({
              name: t("botStudioNewName"),
              color,
              mascot: "mochi",
              look: lookFrom("mochi", color),
              role: "",
              styleNotes: "",
            });
            select(bot.id);
          }}
        >
          <PlusIcon className="size-4" />
          {t("botStudioCreate")}
        </Button>
        <nav className="flex flex-col gap-1">
          {bots.map((bot) => (
            <button
              key={bot.id}
              type="button"
              onClick={() => select(bot.id)}
              className={cn(
                "flex items-center gap-2 rounded-xl px-2.5 py-2 text-left text-sm transition-colors",
                bot.id === selected?.id
                  ? "bg-muted font-medium text-foreground"
                  : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
              )}
            >
              <span className="size-2.5 shrink-0 rounded-full" style={{ background: bot.look.color }} />
              <span className="min-w-0 truncate">{bot.name}</span>
              <span className="ml-auto flex items-center gap-1 text-[10px] tabular-nums text-muted-foreground">
                {mainId === bot.id && <CheckIcon className="size-3" aria-label={t("botStudioInUse")} />}
                Lv{bot.level}
              </span>
            </button>
          ))}
          {!bots.length && <p className="px-2 text-xs text-muted-foreground">{t("botStudioEmptyList")}</p>}
        </nav>
      </aside>

      <main className="min-w-0 flex-1">
        {selected ? (
          // Keyed by the bot alone: XP coming in mustn't reset what's being edited.
          <BotEditor key={selected.id} bot={selected} isMain={mainId === selected.id} onRemoved={() => setSelectedId(undefined)} />
        ) : (
          <div className="flex flex-col items-center gap-3 rounded-2xl bg-muted/25 px-6 py-16 text-center ring-1 ring-border/60">
            <BotIcon className="size-8 text-muted-foreground" />
            <p className="text-sm font-medium">{t("botStudioEmptyTitle")}</p>
            <p className="max-w-sm text-sm text-muted-foreground">{t("botStudioEmptyDesc")}</p>
          </div>
        )}
      </main>
    </div>
  );
}

function BotEditor({ bot, isMain, onRemoved }: { bot: CustomBot; isMain: boolean; onRemoved: () => void }) {
  const { t } = useTranslation();
  const fileRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(bot.name);
  const [role, setRole] = useState(bot.role);
  const [styleNotes, setStyleNotes] = useState(bot.styleNotes);
  const [look, setLook] = useState(bot.look);
  const [pose, setPose] = useState<BotState>("idle");
  /** Show it fully grown, to see what it's growing into. */
  const [grownPreview, setGrownPreview] = useState(false);
  const [importError, setImportError] = useState<string>();
  const [learnNote, setLearnNote] = useState<string>();

  const level = bot.level;
  const shownLevel = grownPreview ? MAX_LEVEL : level;
  const progress = useMemo(() => xpProgress(bot.xp), [bot.xp]);
  const stage = stageOf(shownLevel);
  const size = previewSize(shownLevel);
  const design = useMemo(() => presetOf(look, shownLevel), [look, shownLevel]);
  const saturated = level >= MAX_LEVEL && bot.knowledge.length >= 10;

  const draft = { id: bot.id, name, role, styleNotes, color: look.color, mascot: look.base, look };
  const persist = (patch: Partial<typeof draft> = {}) => saveCustomBot({ ...draft, ...patch });

  // A design change saves once the picking settles (a color drag fires many).
  const lookTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const changeLook = (patch: Partial<BotLook>) => {
    const next = { ...look, ...patch };
    setLook(next);
    clearTimeout(lookTimer.current);
    lookTimer.current = setTimeout(() => persist({ look: next, color: next.color, mascot: next.base }), SAVE_LOOK_MS);
  };
  useEffect(() => () => clearTimeout(lookTimer.current), []);

  // It grew while the page was open: it celebrates, the way it does when work is done.
  const seenLevel = useRef(level);
  useEffect(() => {
    if (level > seenLevel.current) setPose("done");
    seenLevel.current = level;
  }, [level]);

  const learnFromChats = () => {
    const next = distillFromRecentChats(bot);
    saveCustomBot({ ...draft, knowledge: next.knowledge });
    setLearnNote(t("botStudioLearned"));
    setTimeout(() => setLearnNote(undefined), 3200);
  };

  const onImportFile = async (file: File) => {
    setImportError(undefined);
    const parsed = parseBotImport(await file.text());
    if ("error" in parsed) {
      setImportError(parsed.error);
      return;
    }
    importBotBundle({
      name: `${parsed.name} (${t("botStudioImportCopy")})`,
      color: parsed.color,
      mascot: parsed.mascot,
      look: parsed.look,
      role: parsed.role,
      styleNotes: parsed.styleNotes,
      xp: parsed.xp,
      knowledge: parsed.knowledge,
    });
  };

  const lockOf = (part: LookPart) => (unlocked(part, level) ? undefined : UNLOCKS[part]);

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">{name}</h2>
          <p className="text-sm text-muted-foreground">
            {t("botStudioLevelLine", { level: String(level), max: String(MAX_LEVEL) })} · {t(STAGE_LABEL[stageOf(level).key])}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {isMain ? (
            <span className="inline-flex h-8 items-center gap-1.5 rounded-xl bg-muted px-3 text-xs font-medium">
              <CheckIcon className="size-3.5" />
              {t("botStudioInUse")}
            </span>
          ) : (
            <Button
              type="button"
              size="sm"
              className="gap-1.5 rounded-xl"
              onClick={() => {
                persist();
                setCoworkBot(`custom:${bot.id}`);
                // The bot you work with is the one that grows.
                setActiveBot(bot.id);
              }}
            >
              <BotIcon className="size-3.5" />
              {t("botStudioUseAsMain")}
            </Button>
          )}
          <Button type="button" variant="outline" size="sm" className="gap-1.5 rounded-xl" onClick={() => downloadBotExport(bot)}>
            <DownloadIcon className="size-3.5" />
            {t("botStudioExport")}
          </Button>
          <Button type="button" variant="outline" size="sm" className="gap-1.5 rounded-xl" onClick={() => fileRef.current?.click()}>
            <UploadIcon className="size-3.5" />
            {t("botStudioImport")}
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && void onImportFile(e.target.files[0])}
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-destructive hover:text-destructive"
            aria-label={t("botStudioDeleteConfirm")}
            onClick={() => {
              if (!confirm(t("botStudioDeleteConfirm"))) return;
              // The app keeps a bot: the one this was built from.
              if (isMain) setCoworkBot(look.base);
              removeCustomBot(bot.id);
              onRemoved();
            }}
          >
            <Trash2Icon className="size-3.5" />
          </Button>
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,260px)_1fr]">
        {/* The bot, as big as it has grown, trying the poses it has in the app. */}
        <div className="flex flex-col items-center gap-4 self-start rounded-2xl bg-muted/25 px-4 py-6 ring-1 ring-border/60">
          <div className="flex h-[150px] items-end justify-center">
            <motion.div
              className="flex items-center justify-center"
              initial={false}
              animate={{ width: size, height: size }}
              transition={{ duration: 0.5, ease: MALI_EASE }}
            >
              <CoworkBot design={design} state={pose} size="100%" title={name} />
            </motion.div>
          </div>
          <span className="rounded-full bg-background px-2.5 py-0.5 text-[11px] font-medium ring-1 ring-border/60">
            {t(STAGE_LABEL[stage.key])} · Lv{shownLevel}
          </span>

          <div className="flex flex-wrap justify-center gap-1">
            {POSES.map((p) => (
              <button
                key={p.state}
                type="button"
                onClick={() => setPose(p.state)}
                aria-pressed={pose === p.state}
                className={cn(
                  "rounded-lg px-2 py-1 text-[11px] transition-colors",
                  pose === p.state ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted",
                )}
              >
                {t(p.label)}
              </button>
            ))}
          </div>

          <div className="w-full space-y-1.5">
            <div className="flex justify-between text-[11px] text-muted-foreground">
              <span>{t("botStudioGrowth")}</span>
              <span className="tabular-nums">
                {level >= MAX_LEVEL ? t("botStudioMaxLevel") : `${progress.current}/${progress.next} XP`}
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              <motion.div
                className="h-full rounded-full"
                style={{ background: look.color }}
                initial={false}
                animate={{ width: `${Math.round(progress.ratio * 100)}%` }}
                transition={{ duration: 0.4, ease: MALI_EASE }}
              />
            </div>
            <p className="text-center text-[11px] text-muted-foreground">{t("botStudioTurns", { count: bot.workTurns })}</p>
          </div>
          {level < MAX_LEVEL && (
            <button
              type="button"
              onClick={() => setGrownPreview((v) => !v)}
              aria-pressed={grownPreview}
              className="text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            >
              {grownPreview ? `← Lv${level}` : `${t("botStudioStageGrown")} →`}
            </button>
          )}
        </div>

        <div className="flex flex-col gap-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="font-medium">{t("botStudioName")}</span>
              <Input value={name} onChange={(e) => setName(e.target.value)} onBlur={() => persist()} className="rounded-xl" />
            </label>
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="font-medium">{t("botStudioRole")}</span>
              <Input
                value={role}
                onChange={(e) => setRole(e.target.value)}
                onBlur={() => persist()}
                className="rounded-xl"
                placeholder={t("botStudioRoleHint")}
              />
            </label>
          </div>

          <section className="flex flex-col gap-4 rounded-2xl p-4 ring-1 ring-border/60">
            <h3 className="text-sm font-semibold">{t("botStudioLook")}</h3>

            <Part label={t("botStudioBase")}>
              {BOTS.map((b) => (
                <Chip
                  key={b.id}
                  active={look.base === b.id}
                  // A new start keeps the color: the rest comes from that bot.
                  onClick={() => changeLook({ ...lookFrom(b.id, look.color), color2: look.color2 })}
                >
                  <span className="size-2 rounded-full" style={{ background: b.color }} />
                  {b.name}
                </Chip>
              ))}
            </Part>

            <Part label={partLabel("color")}>
              <ColorRow value={look.color} onChange={(color) => changeLook({ color })} />
            </Part>

            <Part label={partLabel("shape")}>
              {SHAPES.map((shape) => (
                <Chip key={shape} active={look.shape === shape} onClick={() => changeLook({ shape })}>
                  {t(SHAPE_LABEL[shape])}
                </Chip>
              ))}
            </Part>

            <Part label={partLabel("eyes")}>
              {BOTS.map((b) => (
                <Chip key={b.id} active={look.eyes === b.id} onClick={() => changeLook({ eyes: b.id as CoworkBotId })}>
                  {b.name}
                </Chip>
              ))}
            </Part>

            <Part label={partLabel("mouth")}>
              {MOUTH_KINDS.map((mouth) => (
                <Chip key={mouth} active={look.mouth === mouth} onClick={() => changeLook({ mouth })}>
                  {t(MOUTH_LABEL[mouth])}
                </Chip>
              ))}
            </Part>

            <Part label={partLabel("ears")} lockedAt={lockOf("ears")}>
              {EAR_KINDS.map((ears) => (
                <Chip key={ears} active={look.ears === ears} disabled={!!lockOf("ears")} onClick={() => changeLook({ ears })}>
                  {t(EAR_LABEL[ears])}
                </Chip>
              ))}
            </Part>

            <Part label={partLabel("blush")} lockedAt={lockOf("blush")}>
              {[true, false].map((blush) => (
                <Chip key={String(blush)} active={look.blush === blush} disabled={!!lockOf("blush")} onClick={() => changeLook({ blush })}>
                  {blush ? partLabel("blush") : t("botStudioNone")}
                </Chip>
              ))}
            </Part>

            <Part label={partLabel("move")} lockedAt={lockOf("move")}>
              {MOVES.map((move) => (
                <Chip
                  key={move}
                  active={look.move === move}
                  disabled={!!lockOf("move")}
                  onClick={() => {
                    changeLook({ move });
                    setPose("working");
                  }}
                >
                  {t(MOVE_LABEL[move])}
                </Chip>
              ))}
            </Part>

            <Part label={partLabel("color2")} lockedAt={lockOf("color2")}>
              <Chip active={!look.color2} disabled={!!lockOf("color2")} onClick={() => changeLook({ color2: undefined })}>
                {t("botStudioNone")}
              </Chip>
              <ColorRow
                value={look.color2 ?? ""}
                disabled={!!lockOf("color2")}
                onChange={(color2) => changeLook({ color2 })}
              />
            </Part>

            <Part label={partLabel("eyeInk")} lockedAt={lockOf("eyeInk")}>
              <ColorRow
                value={look.eyeInk}
                colors={["#000000", "#ffffff", "#3b2a20", "#1e3a8a", "#065f46"]}
                disabled={!!lockOf("eyeInk")}
                onChange={(eyeInk) => changeLook({ eyeInk })}
              />
            </Part>
          </section>

          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">{t("botStudioStyle")}</span>
            <Textarea
              value={styleNotes}
              onChange={(e) => setStyleNotes(e.target.value)}
              onBlur={() => persist()}
              rows={3}
              className="rounded-xl"
              placeholder={t("botStudioStyleHint")}
            />
          </label>
        </div>
      </div>

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-base font-semibold">{t("botStudioKnowledge")}</h3>
            <p className="text-sm text-muted-foreground">{t("botStudioKnowledgeDesc")}</p>
          </div>
          <Button type="button" variant="secondary" size="sm" className="gap-1.5 rounded-xl" onClick={learnFromChats}>
            <SparklesIcon className="size-3.5" />
            {t("botStudioLearnNow")}
          </Button>
        </div>
        {learnNote && <p className="text-xs text-emerald-600 dark:text-emerald-400">{learnNote}</p>}
        {saturated && <p className="text-xs text-amber-700 dark:text-amber-400">{t("botStudioSaturated")}</p>}
        {importError && <p className="text-xs text-destructive">{importError}</p>}

        {!bot.knowledge.length ? (
          <p className="rounded-2xl bg-muted/30 px-4 py-6 text-center text-sm text-muted-foreground">{t("botStudioNoKnowledge")}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {bot.knowledge.map((k) => (
              <li key={k.id} className="rounded-2xl bg-muted/30 px-4 py-3">
                <p className="text-sm font-medium">{k.title}</p>
                <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">{k.body}</p>
                {k.tags.length > 0 && <p className="mt-2 text-[10px] text-muted-foreground/80">{k.tags.join(" · ")}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/** One part of the look: its name, a lock until its level, and the choices. */
function Part({ label, lockedAt, children }: { label: string; lockedAt?: number; children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-1.5">
      <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        {label}
        {lockedAt !== undefined && (
          <span className="inline-flex items-center gap-1 rounded-full bg-muted px-1.5 py-px text-[10px] font-normal">
            <LockIcon className="size-2.5" />
            {t("botStudioLockedAt", { level: String(lockedAt) })}
          </span>
        )}
      </span>
      <div className={cn("flex flex-wrap items-center gap-1.5", lockedAt !== undefined && "opacity-50")}>{children}</div>
    </div>
  );
}

function Chip({
  active,
  disabled,
  onClick,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-xs transition-colors disabled:cursor-not-allowed",
        active ? "bg-foreground text-background" : "bg-muted/50 text-foreground hover:bg-muted",
      )}
    >
      {children}
    </button>
  );
}

function ColorRow({
  value,
  onChange,
  colors = PRESET_COLORS,
  disabled,
}: {
  value: string;
  onChange: (color: string) => void;
  colors?: string[];
  disabled?: boolean;
}) {
  return (
    <>
      {colors.map((c) => (
        <button
          key={c}
          type="button"
          aria-label={c}
          aria-pressed={value.toLowerCase() === c}
          disabled={disabled}
          onClick={() => onChange(c)}
          className={cn(
            "size-7 rounded-full ring-2 ring-offset-2 ring-offset-background transition-transform hover:scale-105 disabled:cursor-not-allowed disabled:hover:scale-100",
            value.toLowerCase() === c ? "ring-foreground/40" : "ring-transparent",
          )}
          style={{ background: c, boxShadow: "inset 0 0 0 1px rgb(0 0 0 / 0.08)" }}
        />
      ))}
      <Input
        type="color"
        value={value || colors[0]}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="h-7 w-12 cursor-pointer rounded-lg p-0.5"
      />
    </>
  );
}
