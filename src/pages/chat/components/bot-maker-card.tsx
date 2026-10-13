import { CoworkBot } from "@/components/anim/cowork-bot";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/components/ui/sonner";
import { TextShimmer } from "@/components/ui/text-shimmer";
import type { CoworkBotId } from "@/features/cowork-bot/store";
import { useInstructions } from "@/features/instructions";
import { catalogConnectorsSuggested, catalogServer, McpToolIcon, useInstalledConnectors } from "@/features/mcp";
import { lobeMcpIcon } from "@/features/mcp/lobe-icons";
import { connectorsItNeeds, defaultTeamModel, ownerOf, skillsItNeeds, TOOL_SCOPES, useTeam, useTeamModels } from "@/features/team";
import { cn } from "@/lib/utils";
import { useMcpManager } from "@/pages/settings/mcp/use-mcp-manager";
import { settingsPath } from "@/pages/settings/route";
import {
  AlertCircleIcon,
  CheckIcon,
  ChevronDownIcon,
  FileTextIcon,
  FolderIcon,
  LightbulbIcon,
  PlusIcon,
  RefreshCwIcon,
  SettingsIcon,
  XIcon,
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { attachReplyBots, isWriting, previewMascots, rewriteAll, saveOption, setOptionDraft, writeOption } from "../bot-maker";
import { extractBotBlocks } from "@/features/team/bot-blocks";
import type { BotOption, ChatMessage } from "../types";
import { ConnectorPickerDialog, SkillPickerDialog } from "./bot-maker-pickers";
import { RecommendedInstalls } from "./bot-maker-recommend";

type Status = "writing" | "ready" | "failed" | "stopped";

function statusOf(option: BotOption, messageId: string, index: number): Status {
  if (option.proposal) return "ready";
  if (option.error) return "failed";
  return isWriting(messageId, index) ? "writing" : "stopped";
}

/**
 * The bots a finished reply wrote in ```bot blocks ("make a bot from this
 * Notion page"): turned into a bot maker on the reply once, then shown.
 */
export function ReplyBots({ chatId, message }: { chatId: string; message: ChatMessage }) {
  const bots = useMemo(() => (message.botMaker ? [] : extractBotBlocks(message.content).bots), [message.botMaker, message.content]);
  useEffect(() => {
    if (bots.length) attachReplyBots(chatId, message.id, bots);
  }, [bots, chatId, message.id]);
  return message.botMaker ? <BotMakerCard chatId={chatId} message={message} /> : null;
}

/**
 * `/bot …` in the chat: three bots written from the user's words. Pick one,
 * set up what it uses — file access, connectors, skills — and save it.
 */
export function BotMakerCard({ chatId, message }: { chatId: string; message: ChatMessage }) {
  const maker = message.botMaker!;
  const team = useTeam();
  const models = useTeamModels();
  const navigate = useNavigate();
  // The faces are picked once, so they don't swap as bots are saved.
  const mascots = useMemo(() => previewMascots(maker.options.length), [maker.options.length]);
  const statuses = maker.options.map((o, i) => statusOf(o, message.id, i));
  const firstReady = statuses.indexOf("ready");
  const [picked, setPicked] = useState<number>();
  const selected = picked ?? (firstReady >= 0 ? firstReady : undefined);
  const busy = statuses.includes("writing");
  const writer = models.find((m) => m.id === maker.writerId)?.name ?? maker.writerId?.replace(/^api:/, "");
  const savedId = (o: BotOption) => (o.savedId && team.mates.some((m) => m.id === o.savedId) ? o.savedId : undefined);
  const headerMascot = selected !== undefined ? mascots[selected] : firstReady >= 0 ? mascots[firstReady] : mascots[0];
  const runsOnId = defaultTeamModel(models);
  const runsOn = models.find((m) => m.id === runsOnId)?.name;
  const mcp = useMcpManager();

  const save = (index: number) => {
    if (!runsOnId) {
      toast.error("Add an API key or sign in to a CLI agent in Settings → Models: the bot needs a model to run on.");
      return;
    }
    try {
      saveOption(chatId, message.id, index, runsOnId, mascots[index]);
      // A connector it uses that's switched off is turned on: it couldn't work otherwise.
      const option = maker.options[index];
      for (const id of option.draftConnectors ?? option.proposal!.connectors) {
        if (!mcp.connections[id]?.enabled) void mcp.apply(id, { enabled: true });
      }
      toast.success(`${maker.options[index].proposal!.name} is saved. Pick it in the chat box’s model menu to talk to it.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="mt-1 flex w-full flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <CoworkBot bot={headerMascot} size={36} state={busy ? "thinking" : selected !== undefined ? "idle" : "welcome"} />
          <div className="flex min-w-0 flex-col">
            <span className="text-sm font-semibold">
              {maker.fromReply
                ? maker.options.length === 1
                  ? "A bot from this chat — look it over and save it"
                  : `${maker.options.length} bots from this chat — pick one`
                : busy
                  ? "Writing bots for your idea…"
                  : `${maker.options.length} bots for your idea — pick one`}
            </span>
            <span className="truncate text-xs text-muted-foreground" title={maker.words}>
              {maker.fromReply ? "Written from what the AI read above" : `“${maker.words}”`}
              {writer && ` · written by ${writer}`}
            </span>
          </div>
        </div>
        {!maker.fromReply && (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 gap-1.5 text-muted-foreground"
            disabled={busy || !maker.writerId}
            onClick={() => rewriteAll(chatId, message.id)}
          >
            <RefreshCwIcon className="size-3.5" /> Write again
          </Button>
        )}
      </header>

      {!maker.fromReply && /notion|https?:\/\//i.test(maker.words) && (
        <p className="flex gap-2 rounded-xl bg-sky-500/[0.07] px-3 py-2.5 text-xs leading-relaxed text-sky-900 dark:text-sky-200">
          <LightbulbIcon className="mt-px size-3.5 shrink-0" />
          <span>
            <code>/bot</code> can’t open links or Notion pages — these bots only read your words and this chat. To build one from
            the page itself, ask in the chat without <code>/bot</code>, e.g. “อ่านหน้า Notion นี้แล้วสร้างบอทให้หน่อย”: the AI reads it
            with your Notion connector and the bot appears here to save.
          </span>
        </p>
      )}

      <div
        role="radiogroup"
        aria-label="Bots to pick from"
        className={cn(
          "grid grid-cols-1 gap-2.5",
          maker.options.length >= 3 ? "sm:grid-cols-3" : maker.options.length === 2 && "sm:grid-cols-2",
        )}
      >
        {maker.options.map((option, i) => (
          <OptionTile
            key={i}
            option={option}
            status={statuses[i]}
            mascot={mascots[i]}
            selected={selected === i}
            saved={!!savedId(option)}
            onPick={() => setPicked(i)}
            onRetry={() => void writeOption(chatId, message.id, i)}
          />
        ))}
      </div>

      {selected !== undefined && maker.options[selected]?.proposal && (
        <Details
          key={selected}
          chatId={chatId}
          messageId={message.id}
          index={selected}
          option={maker.options[selected]}
          mascot={mascots[selected]}
          savedId={savedId(maker.options[selected])}
          runsOn={runsOn}
          teamOn={team.enabled}
          onSave={() => save(selected)}
          onOpen={(id) => navigate(settingsPath("team", id))}
        />
      )}
    </div>
  );
}

function OptionTile({
  option,
  status,
  mascot,
  selected,
  saved,
  onPick,
  onRetry,
}: {
  option: BotOption;
  status: Status;
  mascot: CoworkBotId;
  selected: boolean;
  saved: boolean;
  onPick: () => void;
  onRetry: () => void;
}) {
  const ready = status === "ready";
  return (
    <div
      className={cn(
        "relative flex min-h-36 min-w-0 flex-col gap-2 rounded-xl border bg-card p-3.5 transition-[border-color,box-shadow,background-color]",
        selected
          ? "border-violet-500/60 bg-violet-500/[0.04] shadow-[0_0_0_1px_rgb(139_92_246/0.35)]"
          : "border-border/70",
        ready && !selected && "hover:border-foreground/25",
      )}
    >
      {ready && (
        <button
          type="button"
          role="radio"
          aria-checked={selected}
          aria-label={option.proposal!.name}
          onClick={onPick}
          className="absolute inset-0 rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        />
      )}
      <div className="pointer-events-none flex items-center gap-2.5">
        <CoworkBot bot={mascot} size={30} state={status === "writing" ? "thinking" : "idle"} />
        <span className="min-w-0 flex-1 truncate text-[10px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
          {option.angle}
        </span>
        {saved ? (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-500/10 px-1.5 py-px text-[10px] font-semibold text-emerald-700 dark:text-emerald-400">
            <CheckIcon className="size-2.5" strokeWidth={3} /> Saved
          </span>
        ) : (
          ready && (
            <span
              className={cn(
                "flex size-4 shrink-0 items-center justify-center rounded-full border transition-colors",
                selected ? "border-violet-500 bg-violet-500 text-white" : "border-border",
              )}
            >
              {selected && <CheckIcon className="size-2.5" strokeWidth={3.5} />}
            </span>
          )
        )}
      </div>

      {status === "writing" && (
        <div className="flex flex-col gap-2 pt-1">
          <TextShimmer duration={2} className="text-sm font-medium">
            Writing…
          </TextShimmer>
          <span className="h-2 w-full animate-pulse rounded bg-muted" />
          <span className="h-2 w-4/5 animate-pulse rounded bg-muted" />
          <span className="h-2 w-2/3 animate-pulse rounded bg-muted" />
        </div>
      )}

      {(status === "failed" || status === "stopped") && (
        <div className="flex flex-1 flex-col items-start gap-2 pt-1">
          <p className="flex gap-1.5 text-xs leading-relaxed text-destructive">
            <AlertCircleIcon className="mt-px size-3.5 shrink-0" />
            <span className="line-clamp-4">{option.error ?? "Stopped before it was written."}</span>
          </p>
          <Button size="sm" variant="outline" className="mt-auto h-7 gap-1.5" onClick={onRetry}>
            <RefreshCwIcon className="size-3.5" /> Try again
          </Button>
        </div>
      )}

      {ready && (
        <div className="pointer-events-none flex min-w-0 flex-1 flex-col gap-1">
          <span className="line-clamp-2 text-sm leading-snug font-semibold">{option.proposal!.name}</span>
          <span className="line-clamp-3 text-xs leading-relaxed text-muted-foreground">{option.proposal!.role}</span>
          <TileCounts option={option} />
        </div>
      )}
    </div>
  );
}

function TileCounts({ option }: { option: BotOption }) {
  const scope = TOOL_SCOPES.find((s) => s.value === (option.draftTools ?? option.proposal!.tools));
  const connectors = (option.draftConnectors ?? option.proposal!.connectors).length;
  const skills = option.draftSkills?.length ?? 0;
  return (
    <span className="mt-auto flex flex-wrap items-center gap-x-2.5 gap-y-1 pt-2 text-[11px] text-muted-foreground">
      <span className="inline-flex items-center gap-1">
        <FolderIcon className="size-3" /> {scope?.label}
      </span>
      {connectors > 0 && (
        <span className="inline-flex items-center gap-1">
          <McpBrandIcon /> {connectors}
        </span>
      )}
      {skills > 0 && (
        <span className="inline-flex items-center gap-1">
          <FileTextIcon className="size-3" /> {skills}
        </span>
      )}
    </span>
  );
}

/** The picked bot in full: what it does and how, what it uses — and saving it. */
function Details({
  chatId,
  messageId,
  index,
  option,
  mascot,
  savedId,
  runsOn,
  teamOn,
  onSave,
  onOpen,
}: {
  chatId: string;
  messageId: string;
  index: number;
  option: BotOption;
  mascot: CoworkBotId;
  savedId?: string;
  runsOn?: string;
  teamOn: boolean;
  onSave: () => void;
  onOpen: (id: string) => void;
}) {
  const p = option.proposal!;
  const { mates } = useTeam();
  const installed = useInstalledConnectors();
  const { skills } = useInstructions();
  const [allSteps, setAllSteps] = useState(false);
  const [picker, setPicker] = useState<"connectors" | "skills">();
  const [pickerQuery, setPickerQuery] = useState<string>();
  const openPicker = (kind: "connectors" | "skills", query?: string) => {
    setPickerQuery(query);
    setPicker(kind);
  };
  const locked = !!savedId;

  const tools = option.draftTools ?? p.tools;
  const pickedConnectors = option.draftConnectors ?? p.connectors;
  const pickedSkills = option.draftSkills ?? [];
  const scope = TOOL_SCOPES.find((s) => s.value === tools);
  const duty = useMemo(() => ({ role: p.role, instructions: p.instructions }), [p.role, p.instructions]);

  // What fits this bot: the writer's picks, what its duty names, and built-in connectors it names.
  const suggestedConnectors = useMemo(
    () =>
      new Set([
        ...p.connectors,
        ...connectorsItNeeds({ ...duty, connectors: [] }, installed).map((c) => c.id),
        ...catalogConnectorsSuggested(duty.role, duty.instructions, new Set()).map((s) => s.id),
      ]),
    [p.connectors, duty, installed],
  );
  const suggestedSkills = useMemo(
    () => new Set([...(p.skills ?? []), ...skillsItNeeds({ ...duty, skills: [] }, skills).map((k) => k.id)]),
    [p.skills, duty, skills],
  );

  const connectorChips = pickedConnectors.map((id) => {
    const c = installed.find((x) => x.id === id);
    const def = catalogServer(id);
    return {
      id,
      label: c?.name ?? def?.name ?? id,
      icon: <McpToolIcon mcp={c?.ref ?? { serverId: id, serverName: def?.name ?? id, tool: "", def }} size={14} />,
    };
  });
  const connectorIdeas = [...suggestedConnectors]
    .filter((id) => !pickedConnectors.includes(id) && installed.some((c) => c.id === id))
    .map((id) => ({ id, label: installed.find((c) => c.id === id)?.name ?? catalogServer(id)?.name ?? id }))
    .slice(0, 3);
  const skillChips = pickedSkills.map((id) => ({
    id,
    label: skills.find((k) => k.id === id)?.name ?? id,
    icon: <FileTextIcon className="size-3.5 text-muted-foreground" />,
  }));
  const skillIdeas = [...suggestedSkills]
    .filter((id) => !pickedSkills.includes(id) && skills.some((k) => k.id === id && k.enabled))
    .map((id) => ({ id, label: skills.find((k) => k.id === id)!.name }))
    .slice(0, 3);

  const setConnectors = (next: string[]) => setOptionDraft(chatId, messageId, index, { draftConnectors: next });
  const setSkills = (next: string[]) => setOptionDraft(chatId, messageId, index, { draftSkills: next });

  // Pre-pick connectors and skills that fit this bot so the user doesn't have to add them by hand.
  useEffect(() => {
    if (locked) return;
    const installedIds = new Set(installed.map((c) => c.id));
    const addConnectors = [...suggestedConnectors].filter(
      (id) => installedIds.has(id) && !pickedConnectors.includes(id) && !ownerOf(mates, "connectors", id),
    );
    if (addConnectors.length) setConnectors([...pickedConnectors, ...addConnectors]);
    const addSkills = [...suggestedSkills].filter(
      (id) => !pickedSkills.includes(id) && skills.some((k) => k.id === id && k.enabled) && !ownerOf(mates, "skills", id),
    );
    if (addSkills.length) setSkills([...pickedSkills, ...addSkills]);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only fill gaps when suggestions or installs change
  }, [suggestedConnectors, suggestedSkills, installed, locked, mates]);

  // A suggested built-in connector that isn't connected yet opens the picker to connect it.
  const addConnectorIdea = (id: string) =>
    installed.some((c) => c.id === id) ? setConnectors([...pickedConnectors, id]) : setPicker("connectors");

  return (
    <section className="overflow-hidden rounded-2xl border border-border/70 bg-card shadow-[0_1px_2px_rgb(0_0_0/0.04)]">
      <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-start sm:p-5">
        <div className="flex min-w-0 flex-1 items-start gap-3.5">
          <CoworkBot bot={mascot} size={44} state={locked ? "done" : "idle"} />
          <div className="flex min-w-0 flex-col gap-1">
            <h3 className="text-base leading-snug font-semibold tracking-tight">{p.name}</h3>
            <p className="text-[13px] leading-relaxed text-muted-foreground">{p.role}</p>
          </div>
        </div>
        {locked ? (
          <div className="flex shrink-0 items-center gap-2">
            <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 dark:text-emerald-400">
              <CheckIcon className="size-3.5" strokeWidth={3} /> Saved
            </span>
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => onOpen(savedId!)}>
              <SettingsIcon className="size-3.5" /> Edit in Settings
            </Button>
          </div>
        ) : (
          <Button className="shrink-0 gap-1.5" onClick={onSave}>
            <PlusIcon className="size-4" /> Save this bot
          </Button>
        )}
      </div>

      <div className="border-t border-border/60 px-4 py-4 sm:px-5">
        <Label>How it works</Label>
        <p
          className={cn(
            "mt-2 text-[13px] leading-relaxed whitespace-pre-wrap text-foreground/85",
            !allSteps && "line-clamp-5",
          )}
        >
          {p.instructions}
        </p>
        {p.instructions.split("\n").length > 5 || p.instructions.length > 420 ? (
          <button
            type="button"
            onClick={() => setAllSteps((v) => !v)}
            className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            {allSteps ? "Show less" : "Show all steps"}
            <ChevronDownIcon className={cn("size-3.5 transition-transform", allSteps && "rotate-180")} />
          </button>
        ) : null}
      </div>

      <div className="flex flex-col divide-y divide-border/60 border-t border-border/60 px-4 sm:px-5">
        <SetupRow icon={<FolderIcon />} label="File access" hint={scope?.hint}>
          <Select value={tools} disabled={locked} onValueChange={(v) => setOptionDraft(chatId, messageId, index, { draftTools: v as typeof tools })}>
            <SelectTrigger className="h-8 w-full sm:w-56" aria-label="File access">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TOOL_SCOPES.map((s) => (
                <SelectItem key={s.value} value={s.value}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SetupRow>

        <SetupRow icon={<McpBrandIcon />} label="Connectors" hint="Apps it can use (MCP).">
          <ChipList
            chips={connectorChips}
            empty="None — it works without apps."
            ideas={connectorIdeas}
            locked={locked}
            onRemove={(id) => setConnectors(pickedConnectors.filter((x) => x !== id))}
            onAddIdea={addConnectorIdea}
            onAdd={() => openPicker("connectors")}
            addLabel="Add or connect"
          />
        </SetupRow>

        <SetupRow icon={<FileTextIcon />} label="Skills" hint="Know-how it follows.">
          <ChipList
            chips={skillChips}
            empty="None."
            ideas={skillIdeas}
            locked={locked}
            onRemove={(id) => setSkills(pickedSkills.filter((x) => x !== id))}
            onAddIdea={(id) => setSkills([...pickedSkills, id])}
            onAdd={() => openPicker("skills")}
            addLabel="Add skill"
          />
        </SetupRow>
      </div>

      {!locked && (
        <RecommendedInstalls
          proposal={p}
          pickedConnectors={pickedConnectors}
          pickedSkills={pickedSkills}
          onConnectors={setConnectors}
          onSkills={setSkills}
          onMore={openPicker}
        />
      )}

      {p.reason && (
        <p className="flex gap-2 border-t border-border/60 bg-muted/30 px-4 py-3 text-xs leading-relaxed text-muted-foreground sm:px-5">
          <LightbulbIcon className="mt-px size-3.5 shrink-0" />
          <span>{p.reason}</span>
        </p>
      )}

      <p className="border-t border-border/60 px-4 py-3 text-[11px] leading-relaxed text-muted-foreground sm:px-5">
        {locked
          ? "Saved as your own bot. Pick it in the chat box’s model menu to talk to it."
          : `Saves it as your own bot${runsOn ? `, running on ${runsOn}` : ""} — you pick it in the chat box${teamOn ? ", and the lead can hand it work" : ""}. You can change anything later in Settings → Team.`}
      </p>

      <ConnectorPickerDialog
        open={picker === "connectors"}
        onOpenChange={(open) => setPicker(open ? "connectors" : undefined)}
        botName={p.name}
        duty={duty}
        picked={pickedConnectors}
        onChange={setConnectors}
        suggested={suggestedConnectors}
        initialQuery={picker === "connectors" ? pickerQuery : undefined}
      />
      <SkillPickerDialog
        open={picker === "skills"}
        onOpenChange={(open) => setPicker(open ? "skills" : undefined)}
        botName={p.name}
        duty={duty}
        picked={pickedSkills}
        onChange={setSkills}
        suggested={suggestedSkills}
        initialQuery={picker === "skills" ? pickerQuery : undefined}
      />
    </section>
  );
}

/** One thing the bot uses: what it is on the left, the picks on the right. */
function McpBrandIcon() {
  const Icon = lobeMcpIcon("memory");
  return <Icon size={14} className="shrink-0" />;
}

function SetupRow({
  icon,
  label,
  hint,
  children,
  iconClassName,
}: {
  icon: ReactNode;
  label: string;
  hint?: string;
  children: ReactNode;
  iconClassName?: string;
}) {
  return (
    <div className="grid grid-cols-1 gap-2.5 py-3.5 sm:grid-cols-[10rem_minmax(0,1fr)] sm:gap-4">
      <div className="flex min-w-0 items-start gap-2.5">
        <span
          className={cn(
            "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground [&_svg]:size-3.5",
            iconClassName,
          )}
        >
          {icon}
        </span>
        <div className="flex min-w-0 flex-col">
          <span className="text-[13px] font-medium">{label}</span>
          {hint && <span className="text-[11px] leading-snug text-muted-foreground">{hint}</span>}
        </div>
      </div>
      <div className="min-w-0 sm:pt-px">{children}</div>
    </div>
  );
}

function ChipList({
  chips,
  empty,
  ideas,
  locked,
  onRemove,
  onAddIdea,
  onAdd,
  addLabel,
}: {
  chips: { id: string; label: string; icon: ReactNode }[];
  empty: string;
  ideas: { id: string; label: string }[];
  locked: boolean;
  onRemove: (id: string) => void;
  onAddIdea: (id: string) => void;
  onAdd: () => void;
  addLabel: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {chips.length === 0 && <span className="text-xs text-muted-foreground">{empty}</span>}
        {chips.map((chip) => (
          <span
            key={chip.id}
            className="inline-flex h-7 max-w-full items-center gap-1.5 rounded-full border border-border/70 bg-background pr-1 pl-2.5 text-xs"
          >
            {chip.icon}
            <span className="truncate">{chip.label}</span>
            {!locked && (
              <button
                type="button"
                onClick={() => onRemove(chip.id)}
                aria-label={`Remove ${chip.label}`}
                className="flex size-5 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <XIcon className="size-3" />
              </button>
            )}
          </span>
        ))}
        {!locked && (
          <Button size="sm" variant="ghost" className="h-7 gap-1 rounded-full px-2.5 text-xs text-muted-foreground" onClick={onAdd}>
            <PlusIcon className="size-3.5" /> {addLabel}
          </Button>
        )}
      </div>
      {!locked && ideas.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <SuggestedTag />
          {ideas.map((idea) => (
            <button
              key={idea.id}
              type="button"
              onClick={() => onAddIdea(idea.id)}
              className="inline-flex h-6 items-center gap-1 rounded-full border border-dashed border-violet-500/40 px-2 text-[11px] text-violet-700 transition-colors hover:bg-violet-500/10 dark:text-violet-300"
            >
              <PlusIcon className="size-3" /> {idea.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Label({ children }: { children: ReactNode }) {
  return <h4 className="text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">{children}</h4>;
}

function SuggestedTag() {
  return (
    <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-violet-500/10 px-1.5 py-px text-[10px] font-semibold text-violet-700 dark:text-violet-300">
      <LightbulbIcon className="size-2.5" aria-hidden /> Suggested
    </span>
  );
}
