import { CoworkBot } from "@/components/anim/cowork-bot";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useInstructions } from "@/features/instructions";
import { useInstalledConnectors } from "@/features/mcp";
import {
    connectorsItNeeds,
    defaultTeamModel,
    dismissProposal,
    draftFromProposal,
    forgetInsight,
    freeMascot,
    ownerOf,
    ProposalCard,
    READY_AT,
    reflectNow,
    removeTeammate,
    runsOn,
    saveTeammate,
    setCoachModel,
    setLearning,
    setOnTeam,
    setPersonal,
    setTeamEnabled,
    TEAMMATE_TEMPLATES,
    TOOL_SCOPES,
    botsMcpStatus,
    clearPendingBotWords,
    getPendingBotWords,
    writeBot,
    claudeCodeCommand,
    mcpJsonConfig,
    resetBotsMcpToken,
    setBotsMcpEnabled,
    useTeam,
    useTeamModels,
    type BotsMcpStatus,
    type Proposal,
    type Teammate,
    type TeammateDraft,
} from "@/features/team";
import { cn } from "@/lib/utils";
import { ModelPicker } from "@/pages/chat/components/model-picker";
import { findModel } from "@/pages/chat/models";
import {
    AlertTriangleIcon,
    CheckIcon,
    CopyIcon,
    TerminalIcon,
    BookOpenTextIcon,
    DownloadIcon,
    GraduationCapIcon,
    LoaderIcon,
    MessageCircleIcon,
    SparklesIcon,
    PlusIcon,
    RefreshCwIcon,
    Trash2Icon,
    UsersIcon,
    XIcon,
} from "lucide-react";
import { toast } from "@/components/ui/sonner";
import { Textarea } from "@/components/ui/textarea";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useSettingsSub } from "../route";
import {
    PageEnter,
    SectionHeader,
    SettingRow,
    SettingsGroup,
    SettingsPage,
    Steps,
    Tile,
    TileButton,
    TileGrid,
} from "../ui";
import { ImportBotDialog } from "./import-bot-dialog";
import { TeammatePage } from "./teammate-page";

export function TeamSettings() {
  const team = useTeam();
  const models = useTeamModels();
  const installed = useInstalledConnectors();
  const [draft, setDraft] = useState<TeammateDraft | null>(null);
  const { sub, open, back } = useSettingsSub();
  // Set while a proposal is open in the editor: saving it takes it off the list.
  const [reviewing, setReviewing] = useState<string>();
  const [importing, setImporting] = useState(false);

  const newBot = (from?: Omit<TeammateDraft, "modelId">) => {
    // The connectors its duty names, when no other bot has them yet.
    const wanted = from
      ? connectorsItNeeds(from, installed)
          .filter((c) => !ownerOf(team.mates, "connectors", c.id))
          .map((c) => c.id)
      : [];
    if (sub !== "new") open("new");
    setDraft({
      name: "",
      role: "",
      instructions: "",
      skills: [],
      tools: "read",
      onTeam: true,
      ...from,
      connectors: [...(from?.connectors ?? []), ...wanted],
      mascot: from && !team.mates.some((m) => m.mascot === from.mascot) ? from.mascot : freeMascot(team.mates),
      modelId: defaultTeamModel(models) ?? "",
    });
  };
  const review = (proposal: Proposal) => {
    setReviewing(proposal.id);
    setDraft(draftFromProposal(proposal, defaultTeamModel(models) ?? ""));
    open("new");
  };
  /** A bot the model wrote from the user's words: open in the editor, theirs to change before it's added. */
  const written = (proposal: Awaited<ReturnType<typeof writeBot>>) => {
    setDraft({
      ...draftFromProposal({ ...proposal, at: Date.now() }, defaultTeamModel(models) ?? ""),
      origin: "user",
      personal: true,
      onTeam: team.enabled,
    });
    open("new");
  };
  const unusedTemplates = TEAMMATE_TEMPLATES.filter((t) => !team.mates.some((m) => m.name === t.name));

  // Opened from the notch's "New bot": show the ready-made bots to pick
  // from, or the form when every one is already on the team. Once.
  const [params, setParams] = useSearchParams();
  const wantsNew = params.get("new") === "1";
  useEffect(() => {
    if (!wantsNew) return;
    if (unusedTemplates.length > 0) {
      requestAnimationFrame(() =>
        document.getElementById("team-templates")?.scrollIntoView({ behavior: "smooth", block: "center" }),
      );
    } else {
      newBot();
    }
    const next = new URLSearchParams(params);
    next.delete("new");
    setParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantsNew]);

  // The bot editor is a page of its own: `/settings/team/new` or `/settings/team/<id>`.
  const editing = sub === "new" ? draft : sub ? team.mates.find((m) => m.id === sub) : undefined;
  useEffect(() => {
    // Reopened `new` with nothing to edit (after a reload): start a blank bot.
    if (sub === "new" && !draft) newBot();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sub]);
  if (sub && editing) {
    return (
      <PageEnter key={editing.id ?? "new"}>
        <TeammatePage
          draft={editing}
          models={models}
          onSaved={() => reviewing && dismissProposal(reviewing)}
          onDone={() => {
            setDraft(null);
            setReviewing(undefined);
            back();
          }}
        />
      </PageEnter>
    );
  }

  return (
    <SettingsPage>
      <SectionHeader
        title="Team"
        description="Bots you make, each with one duty, its own model, skills and connectors. In team mode the chat’s model is the lead: it splits the work, hands each job to the bot whose duty it is, and reports back to you."
        actions={
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" className="h-9 gap-1.5" onClick={() => setImporting(true)}>
              <DownloadIcon className="size-4" /> Import bot
            </Button>
            <Button size="sm" className="h-9 gap-1.5" onClick={() => newBot()}>
              <PlusIcon className="size-4" /> New bot
            </Button>
          </div>
        }
      />
      <ImportBotDialog open={importing} onClose={() => setImporting(false)} />

      <div className="pb-7">
        <Steps
          steps={[
            { title: "Make bots", description: "Give each one duty. A connector or a skill belongs to one bot only." },
            { title: "Turn on team mode", description: "In the chat’s + menu → Team. Tick the bots on the chat’s team." },
            { title: "Ask the lead", description: "It hands jobs out. A bot off the team starts only when you allow it." },
          ]}
        />
      </div>

      <SettingsGroup title="Team mode" description="Works with models on an API key, which run on Mali’s own agent.">
        <SettingRow
          icon={<UsersIcon />}
          htmlFor="team-mode"
          label="Let the chat’s model lead your bots"
          description="Off: every chat works alone, as before."
          control={<Switch id="team-mode" checked={team.enabled} onCheckedChange={setTeamEnabled} />}
        />
      </SettingsGroup>

      <DescribeBot onWritten={written} />

      {team.proposals.length > 0 && (
        <SettingsGroup wide title="Proposed by the lead" description="The lead noticed a duty nobody on the team has. Nothing changes until you accept.">
          <div className="mt-1 grid grid-cols-1 gap-3 md:grid-cols-2">
            {team.proposals.map((p) => (
              <ProposalCard key={p.id} proposal={p} onReview={review} />
            ))}
          </div>
        </SettingsGroup>
      )}

      <SettingsGroup
        wide
        title={`Your bots${team.mates.length ? ` · ${team.mates.length}` : ""}`}
        description="The switch puts a bot on the team: the lead calls it without asking. Off the team, you’re asked first. The chat bubble makes it yours too: pick it in the chat box and talk to it directly."
      >
        {team.mates.length === 0 ? (
          <button
            type="button"
            onClick={() => newBot()}
            className="mt-2 flex flex-col items-center gap-2 rounded-xl border border-dashed border-border px-6 py-10 text-center transition-colors hover:border-foreground/30 hover:bg-muted/30"
          >
            <span className="flex size-11 items-center justify-center rounded-xl bg-muted">
              <PlusIcon className="size-5" />
            </span>
            <span className="text-sm font-medium">No bots yet</span>
            <span className="max-w-sm text-[13px] text-muted-foreground">
              Make one, or start from a ready-made bot below. The lead can also propose bots as it learns what you work on.
            </span>
          </button>
        ) : (
          <div className="mt-1 grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-3">
            {team.mates.map((mate) => (
              <BotCard key={mate.id} mate={mate} modelName={models.find((m) => m.id === mate.modelId)?.name} onEdit={() => open(mate.id)} />
            ))}
          </div>
        )}
      </SettingsGroup>

      {unusedTemplates.length > 0 && (
        <SettingsGroup wide id="team-templates" title="Start from" description="Ready-made bots. Pick one, then give it its model and connectors.">
          <TileGrid className="mt-1">
            {unusedTemplates.map((t) => (
              <Tile
                key={t.name}
                icon={<CoworkBot bot={t.mascot} size={30} />}
                title={t.name}
                description={t.role}
                onOpen={() => newBot(t)}
                openLabel={`Make ${t.name}`}
                action={
                  <TileButton label={`Make ${t.name}`} onClick={() => newBot(t)}>
                    <PlusIcon />
                  </TileButton>
                }
              />
            ))}
          </TileGrid>
        </SettingsGroup>
      )}

      <ShareSection />
      <CoachSection />
      <NotebookSection />
    </SettingsPage>
  );
}

/** One bot as a card: who it is, its duty, what it runs on and owns. */
function BotCard({ mate, modelName, onEdit }: { mate: Teammate; modelName?: string; onEdit: () => void }) {
  const connectors = useInstalledConnectors();
  const { skills } = useInstructions();
  const { mates } = useTeam();
  // Its duty names a connector it doesn't own: the lead would keep that work.
  const missing = connectorsItNeeds(mate, connectors).map((c) => ({ ...c, owner: ownerOf(mates, "connectors", c.id, mate.id) }));
  const owns = [
    ...mate.connectors.map((id) => connectors.find((c) => c.id === id)?.name ?? id),
    ...mate.skills.map((id) => skills.find((k) => k.id === id)?.name).filter((n): n is string => !!n),
  ];
  const scope = TOOL_SCOPES.find((s) => s.value === mate.tools)?.label;
  return (
    <div
      className={cn(
        "group relative flex min-w-0 flex-col gap-3 rounded-xl border border-border/70 bg-card p-4 transition-[border-color,box-shadow,opacity] hover:border-foreground/20 hover:shadow-[0_6px_16px_-10px_rgb(0_0_0/0.25)]",
        !mate.onTeam && !mate.personal && "bg-muted/20",
      )}
    >
      <button type="button" onClick={onEdit} aria-label={`Edit ${mate.name}`} className="absolute inset-0 rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50" />
      <div className="pointer-events-none flex items-start gap-3">
        <CoworkBot bot={mate.mascot} size={40} />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-sm font-semibold">{mate.name}</span>
            {mate.personal && (
              <span className="shrink-0 rounded bg-primary/10 px-1.5 py-px text-[10px] font-semibold text-primary">
                {mate.onTeam ? "yours + team" : "yours"}
              </span>
            )}
            {mate.origin === "lead" && (
              <span className="shrink-0 rounded bg-violet-500/10 px-1.5 py-px text-[10px] font-semibold text-violet-700 dark:text-violet-300">
                from the lead
              </span>
            )}
          </span>
          <span className="truncate text-xs text-muted-foreground">
            {modelName ?? (mate.modelId ? mate.modelId.replace(/^api:/, "") : "No model — pick one")} · {scope}
          </span>
        </div>
        <div className="pointer-events-auto relative z-10 flex shrink-0 items-center gap-0.5">
          <Button
            size="icon-sm"
            variant="ghost"
            aria-pressed={!!mate.personal}
            onClick={() => setPersonal(mate.id, !mate.personal)}
            aria-label={mate.personal ? `Stop offering ${mate.name} in the chat box` : `Talk to ${mate.name} from the chat box`}
            title={mate.personal ? "Your own bot: in the chat box's model menu" : "Make it your own bot too: talk to it from the chat box"}
            className={cn(mate.personal ? "text-primary" : "text-muted-foreground")}
          >
            <MessageCircleIcon className={cn(mate.personal && "fill-current/15")} />
          </Button>
          <Switch
            checked={mate.onTeam}
            onCheckedChange={(on) => setOnTeam(mate.id, on)}
            aria-label={mate.onTeam ? `Take ${mate.name} off the team` : `Put ${mate.name} on the team`}
          />
          <Button size="icon-sm" variant="ghost" onClick={() => removeTeammate(mate.id)} aria-label={`Remove ${mate.name}`} title="Remove" className="text-muted-foreground hover:text-destructive">
            <Trash2Icon />
          </Button>
        </div>
      </div>
      <p className="pointer-events-none line-clamp-2 text-[13px] leading-relaxed text-foreground/80">{mate.role}</p>
      {owns.length > 0 && (
        <div className="pointer-events-none flex flex-wrap gap-1">
          {owns.map((name) => (
            <span key={name} className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
              {name}
            </span>
          ))}
        </div>
      )}
      {missing.map((c) => (
        <div
          key={c.id}
          className="relative z-10 flex flex-wrap items-center gap-1.5 rounded-lg bg-amber-500/10 px-2.5 py-1.5 text-[11px] text-amber-800 dark:text-amber-300"
        >
          <AlertTriangleIcon className="size-3 shrink-0" />
          {c.owner
            ? `Its duty needs ${c.name}, but ${c.owner.name} owns it.`
            : `Its duty needs ${c.name}, which it doesn’t own — the lead would do that work itself.`}
          {!c.owner && (
            <button
              type="button"
              className="font-medium underline underline-offset-2"
              onClick={() => saveTeammate({ ...mate, connectors: [...mate.connectors, c.id] })}
            >
              Give {c.name} to {mate.name}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

/** The coach: a stronger model — API or CLI agent — the lead calls to write and coach bots. */
function CoachSection() {
  const team = useTeam();
  const models = useTeamModels();
  const onCli = !!team.coachModelId && runsOn(team.coachModelId) !== "api";
  const coach = team.coachModelId ? models.find((m) => m.id === team.coachModelId) : undefined;
  return (
    <SettingsGroup
      title="Coach"
      description="A stronger model for when the lead runs on a small or free one. The lead tells the coach what the team needs, and the coach writes the bot; when a bot does a job badly, the coach rewrites how it works. Nothing changes until you accept it."
    >
      <SettingRow
        icon={<GraduationCapIcon />}
        label={coach ? coach.name : "No coach"}
        description={
          coach
            ? `${coach.group} · also keeps the lead's notebook${onCli ? " · asked in Chat mode, so it never touches your files" : ""}`
            : "The lead writes bots itself."
        }
        control={
          <>
            {models.length > 0 ? (
              <div className="w-full sm:w-64">
                <ModelPicker
                  appearance="field"
                  models={models}
                  selected={findModel(models, team.coachModelId ?? models[0].id)}
                  onSelect={(model) => setCoachModel(model.id)}
                />
              </div>
            ) : (
              <span className="text-xs text-muted-foreground">Add an API key or sign in to a CLI agent in Settings → Models</span>
            )}
            {team.coachModelId && (
              <Button size="icon-sm" variant="ghost" aria-label="No coach" onClick={() => setCoachModel(undefined)}>
                <XIcon />
              </Button>
            )}
          </>
        }
      />
    </SettingsGroup>
  );
}

/** What the lead learned the user keeps doing; every line can go. */
function NotebookSection() {
  const team = useTeam();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const update = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await reflectNow();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <SettingsGroup
      title="Lead's notebook"
      description={`What you keep working on, learned from your chats' titles and first messages. Once something reaches ${READY_AT} chats, the coach writes a bot for it and you decide. It stays on this computer and is sent only to the coach model.`}
      actions={
        <Button size="sm" variant="outline" className="gap-1.5" disabled={busy || !team.learning} onClick={() => void update()}>
          {busy ? <LoaderIcon className="size-3.5 animate-spin" /> : <RefreshCwIcon className="size-3.5" />}
          Update now
        </Button>
      }
      footer={
        error ??
        (team.lastReflection ? `Last updated ${new Date(team.lastReflection).toLocaleString()} · updates itself after team work, twice a day at most.` : undefined)
      }
    >
      <SettingRow
        icon={<BookOpenTextIcon />}
        label="Learn from my chats"
        description="Off: the lead only sees your latest chat titles, and nothing is kept."
        control={<Switch checked={team.learning} onCheckedChange={setLearning} aria-label="Learn from my chats" />}
      />
      {team.learning &&
        (team.notebook.length === 0 ? (
          <p className="py-3 text-xs text-muted-foreground">Nothing yet. It fills in as you work in team mode, or press Update now.</p>
        ) : (
          team.notebook.map((insight) => (
            <SettingRow
              key={insight.id}
              label={insight.pattern}
              description={
                <>
                  <span className={insightStatusClass(team, insight)}>{insightStatus(team, insight)}</span>
                  {insight.evidence.length > 0 && ` · ${insight.evidence.slice(0, 3).join(" · ")}`}
                </>
              }
              control={
                <Button size="icon-sm" variant="ghost" aria-label={`Forget ${insight.pattern}`} onClick={() => forgetInsight(insight.id)}>
                  <XIcon />
                </Button>
              }
            />
          ))
        ))}
    </SettingsGroup>
  );
}

/** Where a pattern stands on its way to a bot. */
function insightStatus(team: ReturnType<typeof useTeam>, insight: { pattern: string; count: number }) {
  if (team.suggested.includes(insight.pattern.trim().toLowerCase())) {
    const proposed = team.proposals.some((p) => p.fromNotebook?.toLowerCase() === insight.pattern.trim().toLowerCase());
    return proposed ? `${insight.count} chats · bot proposed` : `${insight.count} chats · checked by the coach`;
  }
  if (insight.count >= READY_AT) return `${insight.count} chats · enough for a bot — proposed at the next update`;
  return `${insight.count} of ${READY_AT} chats`;
}

function insightStatusClass(team: ReturnType<typeof useTeam>, insight: { pattern: string; count: number }) {
  const looked = team.suggested.includes(insight.pattern.trim().toLowerCase());
  return !looked && insight.count >= READY_AT ? "font-medium text-violet-700 dark:text-violet-300" : undefined;
}

/** Your own bots as tools in Claude Code (or any agent on this computer that speaks MCP). */
function ShareSection() {
  const team = useTeam();
  const [status, setStatus] = useState<BotsMcpStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string>();
  const [showJson, setShowJson] = useState(false);
  const own = team.mates.filter((m) => m.personal && !m.paused);

  useEffect(() => {
    void botsMcpStatus().then(setStatus).catch(() => undefined);
    // The tools follow the bots: read them again when the bots change.
  }, [team.mates]);

  const toggle = async (on: boolean) => {
    setBusy(true);
    try {
      setStatus(await setBotsMcpEnabled(on));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const copy = async (what: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      setTimeout(() => setCopied(undefined), 1500);
    } catch {
      toast.error("Couldn't copy: select the text and copy it yourself.");
    }
  };
  const reset = async () => setStatus(await resetBotsMcpToken());

  return (
    <SettingsGroup
      title="Use your bots from Claude Code"
      description="Mali serves your own bots to agents on this computer as an MCP server: each one becomes a tool (ask_<bot>) that runs the bot here — on its model, with its skills and connectors — and returns its answer. Mali has to be open."
    >
      <SettingRow
        icon={<TerminalIcon />}
        htmlFor="bots-mcp"
        label="Serve my bots"
        description={
          status?.error
            ? status.error
            : status?.enabled
              ? `On 127.0.0.1:${status.port} — only this computer, only with the token.`
              : "Off: nothing outside Mali can call your bots."
        }
        control={<Switch id="bots-mcp" checked={!!status?.enabled} disabled={busy || !status} onCheckedChange={(on) => void toggle(on)} />}
      />
      {status?.enabled && (
        <div className="flex flex-col gap-3 py-3">
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="text-muted-foreground">Tools:</span>
            {own.length === 0 ? (
              <span className="text-amber-700 dark:text-amber-400">none yet — on a bot, turn on “As my own bot” (the chat bubble on its card).</span>
            ) : (
              status.tools.map((t) => (
                <span key={t} className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[11px]">
                  {t}
                </span>
              ))
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium">Add to Claude Code — run this once in a terminal:</span>
            <CodeBlock text={claudeCodeCommand(status)} copied={copied === "cmd"} onCopy={() => void copy("cmd", claudeCodeCommand(status))} />
          </div>
          <button type="button" className="self-start text-xs text-muted-foreground underline underline-offset-4" onClick={() => setShowJson((v) => !v)}>
            {showJson ? "Hide" : "Another agent? Its MCP config"}
          </button>
          {showJson && <CodeBlock text={mcpJsonConfig(status)} copied={copied === "json"} onCopy={() => void copy("json", mcpJsonConfig(status))} />}
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>The token opens your bots — don't share it. Claude Code asks you before each call.</span>
            <Button size="sm" variant="outline" className="h-7" onClick={() => void reset()}>
              New token
            </Button>
          </div>
        </div>
      )}
    </SettingsGroup>
  );
}

function CodeBlock({ text, copied, onCopy }: { text: string; copied: boolean; onCopy: () => void }) {
  return (
    <div className="relative">
      <pre className="overflow-x-auto rounded-lg border bg-muted/40 py-2.5 pr-11 pl-3 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]">{text}</pre>
      <Button size="icon-sm" variant="ghost" className="absolute top-1.5 right-1.5" aria-label="Copy" onClick={onCopy}>
        {copied ? <CheckIcon /> : <CopyIcon />}
      </Button>
    </div>
  );
}

/**
 * A bot from the user's own words, written by a model they pick (the coach
 * by default). Words typed after `/bot` in the chat box land here and start
 * at once.
 */
function DescribeBot({ onWritten }: { onWritten: (proposal: Awaited<ReturnType<typeof writeBot>>) => void }) {
  const team = useTeam();
  const models = useTeamModels();
  const [words, setWords] = useState("");
  const [writerId, setWriterId] = useState<string>();
  const [writing, setWriting] = useState(false);
  const [error, setError] = useState<string>();
  const writer = writerId ?? team.coachModelId ?? defaultTeamModel(models);
  const local = !!writer && /^api:(ollama|lmstudio|lm-studio)\//.test(writer);

  const write = async (text = words) => {
    const need = text.trim();
    if (!need || !writer) return;
    setWriting(true);
    setError(undefined);
    try {
      onWritten(await writeBot(need, writer));
      setWords("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setWriting(false);
    }
  };

  // From the chat box: `/bot <words>`.
  useEffect(() => {
    const pending = getPendingBotWords();
    if (!pending) return;
    clearPendingBotWords();
    setWords(pending.words);
    if (pending.words.trim() && writer) void write(pending.words);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <SettingsGroup
      wide
      title="Describe a bot"
      description="Say what you need in your own words. A model writes its duty, instructions, file access and connectors; you look it over before it's added. Tip: type /bot in the chat box."
    >
      <div className="flex flex-col gap-3 pt-1">
        <Textarea
          value={words}
          onChange={(e) => setWords(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void write();
          }}
          disabled={writing}
          placeholder="e.g. บอทสรุปข่าวจากลิงก์ที่ฉันส่ง เป็นภาษาไทย 5 ข้อ — or: a bot that files my Gmail receipts into a Notion table"
          className="min-h-24"
          aria-label="What the bot should do"
        />
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">Written by</span>
          {models.length ? (
            <div className="w-full sm:w-64">
              <ModelPicker appearance="field" models={models} selected={findModel(models, writer ?? models[0].id)} onSelect={(m) => setWriterId(m.id)} />
            </div>
          ) : (
            <span className="text-xs text-muted-foreground">Add an API key or sign in to a CLI agent in Settings → Models first.</span>
          )}
          <Button className="ml-auto gap-1.5" disabled={writing || !words.trim() || !writer} onClick={() => void write()}>
            {writing ? <LoaderIcon className="size-4 animate-spin" /> : <SparklesIcon className="size-4" />}
            {writing ? "Writing…" : "Write the bot"}
          </Button>
        </div>
        {writing && local && <p className="text-xs text-muted-foreground">A model on this computer can take a few minutes.</p>}
        {error && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>}
      </div>
    </SettingsGroup>
  );
}
