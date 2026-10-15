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
import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { newChatHomeUrl } from "@/features/chat-history";
import { composerDraftKey, writeComposerDraft } from "@/pages/chat/composer-draft";
import { useSettingsSub } from "../route";
import {
    PageEnter,
    SectionHeader,
    SettingRow,
    SettingsGroup,
    SettingsPage,
    SectionLabel,
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
        description="Bots that each do one job, with their own model, skills and connectors. With team mode on, the chat’s model leads them: it splits your request, hands each part to the bot whose job it is, and brings the answers back to you."
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

      <GettingStarted />

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
        description="Click a bot to change its job, model, skills and connectors. The two switches on each card decide where you can use it."
      >
        {team.mates.length === 0 ? (
          <button
            type="button"
            onClick={() => scrollToAdd()}
            className="mt-2 flex flex-col items-center gap-2 rounded-xl border border-dashed border-border px-6 py-10 text-center transition-colors hover:border-foreground/30 hover:bg-muted/30"
          >
            <span className="flex size-11 items-center justify-center rounded-xl bg-muted">
              <PlusIcon className="size-5" />
            </span>
            <span className="text-sm font-medium">No bots yet</span>
            <span className="max-w-sm text-[13px] text-muted-foreground">
              Describe one in your own words or start from a ready-made bot, just below. The lead can also propose bots as it learns what you work on.
            </span>
          </button>
        ) : (
          <>
            <dl className="mb-3 grid grid-cols-1 gap-2 rounded-xl bg-muted/40 px-3.5 py-3 text-xs sm:grid-cols-2">
              <div className="flex gap-2">
                <UsersIcon className="mt-px size-3.5 shrink-0 text-muted-foreground" />
                <span>
                  <dt className="inline font-medium">On the team</dt>
                  <dd className="inline text-muted-foreground"> — the lead hands it work without asking. Off: the lead asks you first.</dd>
                </span>
              </div>
              <div className="flex gap-2">
                <MessageCircleIcon className="mt-px size-3.5 shrink-0 text-muted-foreground" />
                <span>
                  <dt className="inline font-medium">In the chat box</dt>
                  <dd className="inline text-muted-foreground"> — pick it in the chat box’s model menu and talk to it directly.</dd>
                </span>
              </div>
            </dl>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-3">
              {team.mates.map((mate) => (
                <BotCard key={mate.id} mate={mate} modelName={models.find((m) => m.id === mate.modelId)?.name} onEdit={() => open(mate.id)} />
              ))}
            </div>
          </>
        )}
      </SettingsGroup>

      <SettingsGroup
        wide
        id="team-add"
        title="Add a bot"
        description="Give each bot one job. A connector or a skill belongs to one bot only, so the lead always knows who does what."
      >
        <div className="flex flex-col gap-6">
          <MakeInChat />
          {unusedTemplates.length > 0 && (
            <div id="team-templates" className="flex scroll-mt-24 flex-col gap-2.5">
              <SubHead title="Or start from a ready-made bot" description="Pick one, then give it a model and its connectors." />
              <TileGrid>
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
            </div>
          )}
        </div>
      </SettingsGroup>

      <div className="flex flex-col gap-1 border-t border-border/60 pt-9 pb-1">
        <SectionLabel>Advanced</SectionLabel>
        <p className="text-[13px] text-muted-foreground">Optional. The team works without them.</p>
      </div>
      <CoachSection />
      <NotebookSection />
      <ShareSection />
    </SettingsPage>
  );
}

/** Bots are written in a chat now: `/bot <what it should do>` brings three to pick from. */
function MakeInChat() {
  const navigate = useNavigate();
  const start = () => {
    writeComposerDraft(composerDraftKey(undefined, "cowork"), { prompt: "/bot ", replyExcerpt: null });
    navigate(newChatHomeUrl("cowork"));
  };
  return (
    <div className="flex flex-col gap-4 rounded-xl border border-border/70 bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <MessageCircleIcon className="size-4.5" />
        </span>
        <div className="flex min-w-0 flex-col gap-1">
          <h4 className="text-sm font-medium">Describe it in a chat</h4>
          <p className="text-[13px] leading-relaxed text-muted-foreground">
            In any chat, type <code className="rounded bg-muted px-1 py-px font-mono text-[12px] text-foreground">/bot</code> and what it
            should do — e.g. <span className="text-foreground/80">/bot สรุปข่าวจากลิงก์ที่ฉันส่ง เป็นภาษาไทย 5 ข้อ</span>. Mali writes three
            bots right in the chat; open each to see how it works, and save the one you like.
          </p>
        </div>
      </div>
      <Button size="sm" className="shrink-0 gap-1.5" onClick={start}>
        <SparklesIcon className="size-4" /> Try it in Cowork
      </Button>
    </div>
  );
}

function scrollToAdd() {
  document.getElementById("team-add")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function SubHead({ title, description }: { title: string; description?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <h4 className="text-sm font-medium">{title}</h4>
      {description && <p className="text-[13px] text-muted-foreground">{description}</p>}
    </div>
  );
}

/**
 * How a team works, as three steps ticked off as they're done — with team
 * mode's own switch in the second, so setting up never leaves this card.
 */
function GettingStarted() {
  const team = useTeam();
  const onTeam = team.mates.filter((m) => m.onTeam && !m.paused);
  const steps = [
    {
      title: "Make a bot",
      description: "One job each: “summarise links”, “file my receipts”…",
      done: team.mates.length > 0,
      action:
        team.mates.length > 0 ? (
          <span className="text-xs text-muted-foreground">
            {team.mates.length} {team.mates.length === 1 ? "bot" : "bots"} · {onTeam.length} on the team
          </span>
        ) : (
          <Button size="sm" variant="outline" className="h-7 gap-1" onClick={scrollToAdd}>
            <PlusIcon className="size-3.5" /> Add a bot
          </Button>
        ),
    },
    {
      title: "Turn on team mode",
      description: "Works with models on an API key, which run on Mali’s own agent.",
      done: team.enabled,
      action: (
        <label htmlFor="team-mode" className="flex cursor-pointer items-center gap-2 text-xs font-medium">
          <Switch id="team-mode" checked={team.enabled} onCheckedChange={setTeamEnabled} />
          {team.enabled ? "On" : "Off — every chat works alone"}
        </label>
      ),
    },
    {
      title: "Ask in a chat",
      description: "Open a chat’s + menu → Team, tick the bots for that chat, then ask as usual. The lead hands out the work.",
      done: false,
    },
  ];
  const ready = steps[0].done && steps[1].done;

  return (
    <section className="mb-7 flex flex-col gap-5 rounded-2xl border border-border/70 bg-card p-5 sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-1">
          <h3 className="text-[15px] font-semibold tracking-tight">How a team works</h3>
          <Flow mates={onTeam} />
        </div>
        <span
          className={cn(
            "inline-flex h-6 w-fit shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[11px] font-medium",
            ready ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" : "bg-muted text-muted-foreground",
          )}
        >
          {ready ? <CheckIcon className="size-3" /> : <span className="size-1.5 rounded-full bg-current" />}
          {ready ? "Ready to use" : "Not set up yet"}
        </span>
      </div>
      <ol className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {steps.map((step, i) => (
          <li
            key={step.title}
            className={cn(
              "flex flex-col gap-2.5 rounded-xl border p-3.5 transition-colors",
              step.done ? "border-emerald-500/25 bg-emerald-500/[0.04]" : "border-border/70 bg-background",
            )}
          >
            <div className="flex items-center gap-2.5">
              <span
                className={cn(
                  "flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                  step.done ? "bg-emerald-500 text-white" : "border border-border bg-background",
                )}
              >
                {step.done ? <CheckIcon className="size-3.5" strokeWidth={3} /> : i + 1}
              </span>
              <span className="text-sm font-medium">{step.title}</span>
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">{step.description}</p>
            {step.action && <div className="mt-auto pt-0.5">{step.action}</div>}
          </li>
        ))}
      </ol>
    </section>
  );
}

/** You → the lead → the bots on the team → one answer, drawn with the team's own mascots. */
function Flow({ mates }: { mates: Teammate[] }) {
  const pill = "inline-flex h-6 items-center gap-1.5 rounded-full border border-border/70 bg-background px-2 text-[11px] font-medium";
  const arrow = <span className="text-muted-foreground/60">→</span>;
  return (
    <div className="flex flex-wrap items-center gap-1.5 pt-1 text-muted-foreground">
      <span className={pill}>You ask</span>
      {arrow}
      <span className={pill}>
        <SparklesIcon className="size-3" /> The lead (chat’s model)
      </span>
      {arrow}
      <span className={pill}>
        {mates.length > 0 ? (
          <span className="flex -space-x-1">
            {mates.slice(0, 4).map((m) => (
              <CoworkBot key={m.id} bot={m.mascot} size={16} />
            ))}
          </span>
        ) : (
          <UsersIcon className="size-3" />
        )}
        {mates.length > 0 ? `${mates.length} on the team` : "Your bots"}
      </span>
      {arrow}
      <span className={pill}>One answer</span>
    </div>
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
        <div className="pointer-events-auto relative z-10 shrink-0">
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
      <div className="relative z-10 mt-auto flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-border/60 pt-3 text-xs">
        <label className="flex cursor-pointer items-center gap-2">
          <Switch size="sm" checked={mate.onTeam} onCheckedChange={(on) => setOnTeam(mate.id, on)} />
          <UsersIcon className="size-3.5 text-muted-foreground" />
          On the team
        </label>
        <label className="flex cursor-pointer items-center gap-2">
          <Switch size="sm" checked={!!mate.personal} onCheckedChange={(on) => setPersonal(mate.id, on)} />
          <MessageCircleIcon className="size-3.5 text-muted-foreground" />
          In the chat box
        </label>
      </div>
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
      description="A stronger model that helps the lead. It writes new bots and improves weak ones. You approve every change first."
    >
      <SettingRow
        icon={<GraduationCapIcon />}
        label={coach ? coach.name : "No coach"}
        description={
          coach
            ? `${coach.group} · also keeps the notebook${onCli ? " · never touches your files" : ""}`
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
      description={`Topics you often work on, found in your chats. At ${READY_AT} chats the coach can write a bot for one, and you decide. Stays on this computer; only the coach model sees it.`}
      actions={
        <Button size="sm" variant="outline" className="gap-1.5" disabled={busy || !team.learning} onClick={() => void update()}>
          {busy ? <LoaderIcon className="size-3.5 animate-spin" /> : <RefreshCwIcon className="size-3.5" />}
          Update now
        </Button>
      }
      footer={
        error ??
        (team.lastReflection ? `Last updated ${new Date(team.lastReflection).toLocaleString()} · updates itself, at most twice a day.` : undefined)
      }
    >
      <SettingRow
        icon={<BookOpenTextIcon />}
        label="Learn from my chats"
        description="Off: the lead sees only chat titles, and nothing is saved."
        control={<Switch checked={team.learning} onCheckedChange={setLearning} aria-label="Learn from my chats" />}
      />
      {team.learning &&
        (team.notebook.length === 0 ? (
          <p className="py-3 text-xs text-muted-foreground">Empty for now. It fills in as you use the team, or press Update now.</p>
        ) : (
          team.notebook.map((insight) => (
            <SettingRow
              key={insight.id}
              label={
                <span className="line-clamp-2" title={insight.pattern}>
                  {insight.pattern}
                </span>
              }
              description={
                <>
                  <span className={insightStatusClass(team, insight)}>{insightStatus(team, insight)}</span>
                  {insight.evidence.length > 0 && (
                    <span className="line-clamp-2" title={insight.evidence.join(" · ")}>
                      {` · ${insight.evidence.slice(0, 3).join(" · ")}`}
                    </span>
                  )}
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
  if (insight.count >= READY_AT) return `${insight.count} chats · ready for a bot, proposed at the next update`;
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
              <span className="text-amber-700 dark:text-amber-400">none yet — on a bot’s card, turn on “In the chat box”.</span>
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
