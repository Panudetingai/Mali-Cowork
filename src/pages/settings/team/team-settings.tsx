import { CoworkBot } from "@/components/anim/cowork-bot";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useInstructions } from "@/features/instructions";
import { useInstalledConnectors } from "@/features/mcp";
import {
  connectorsItNeeds,
  defaultTeamModel,
  forgetInsight,
  READY_AT,
  reflectNow,
  runsOn,
  setCoachModel,
  setLearning,
  dismissProposal,
  draftFromProposal,
  freeMascot,
  ProposalCard,
  ownerOf,
  removeTeammate,
  saveTeammate,
  setOnTeam,
  setTeamEnabled,
  TEAMMATE_TEMPLATES,
  TOOL_SCOPES,
  useTeam,
  useTeamModels,
  type Proposal,
  type Teammate,
  type TeammateDraft,
} from "@/features/team";
import {
  AlertTriangleIcon,
  BookOpenTextIcon,
  GraduationCapIcon,
  LoaderIcon,
  PencilIcon,
  PlusIcon,
  RefreshCwIcon,
  Trash2Icon,
  UsersIcon,
  XIcon,
} from "lucide-react";
import { ModelPicker } from "@/pages/chat/components/model-picker";
import { findModel } from "@/pages/chat/models";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { EmptyState, SectionHeader, SettingRow, SettingsGroup, SettingsSection, Steps } from "../ui";
import { TeammateDialog } from "./teammate-dialog";

export function TeamSettings() {
  const team = useTeam();
  const models = useTeamModels();
  const installed = useInstalledConnectors();
  const [draft, setDraft] = useState<TeammateDraft | null>(null);
  // Set while a proposal is open in the editor: saving it takes it off the list.
  const [reviewing, setReviewing] = useState<string>();

  const newBot = (from?: Omit<TeammateDraft, "modelId">) => {
    // The connectors its duty names, when no other bot has them yet.
    const wanted = from
      ? connectorsItNeeds(from, installed)
          .filter((c) => !ownerOf(team.mates, "connectors", c.id))
          .map((c) => c.id)
      : [];
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

  return (
    <div className="flex flex-col gap-10">
      <SectionHeader
        title="Team"
        description="Bots you make, each with one duty, its own model, skills and connectors. In team mode the chat's model is the lead: it splits the work, hands each job to the bot whose duty it is, and reports back to you."
        actions={
          <Button size="sm" className="gap-1.5" onClick={() => newBot()}>
            <PlusIcon className="size-4" /> New bot
          </Button>
        }
      />

      <Steps
        steps={[
          { title: "Make bots", description: "Give each one duty. A connector or a skill belongs to one bot only." },
          { title: "Turn on team mode", description: "In the chat's + menu → Team. Tick the bots on the chat's team." },
          { title: "Ask the lead", description: "It hands jobs out. A bot off the team starts only when you allow it." },
        ]}
      />

      <SettingsGroup>
        <SettingRow
          icon={<UsersIcon />}
          label="Team mode"
          description="The chat's model leads your bots. Works with models on an API key, which run on Mali's own agent."
          control={<Switch checked={team.enabled} onCheckedChange={setTeamEnabled} aria-label="Team mode" />}
        />
      </SettingsGroup>

      <CoachSection />

      {team.proposals.length > 0 && (
        <SettingsSection>
          <SettingsGroup title="Proposed by the lead" description="The lead noticed a duty nobody on the team has.">
            <div className="flex flex-col gap-2 p-2">
              {team.proposals.map((p) => (
                <ProposalCard key={p.id} proposal={p} onReview={review} />
              ))}
            </div>
          </SettingsGroup>
        </SettingsSection>
      )}

      <SettingsSection>
        {team.mates.length === 0 ? (
          <EmptyState
            icon={<UsersIcon />}
            title="No bots yet"
            description="Start from a ready-made bot below or make your own. The lead can also propose bots as it learns what you work on."
            action={
              <Button size="sm" variant="outline" onClick={() => newBot()}>
                New bot
              </Button>
            }
          />
        ) : (
          <SettingsGroup
            title="Your bots"
            description="The switch puts a bot on the team: the lead calls it without asking. Off the team, you're asked first."
          >
            {team.mates.map((mate) => (
              <TeammateRow key={mate.id} mate={mate} modelName={models.find((m) => m.id === mate.modelId)?.name} onEdit={() => setDraft(mate)} />
            ))}
          </SettingsGroup>
        )}
      </SettingsSection>

      <NotebookSection />

      {unusedTemplates.length > 0 && (
        <SettingsSection>
          <div id="team-templates" className="scroll-mt-24" />
          <SettingsGroup title="Start from" description="Pick one, then give it its model and connectors.">
            {unusedTemplates.map((t) => (
              <SettingRow
                key={t.name}
                icon={<CoworkBot bot={t.mascot} size={26} />}
                label={t.name}
                description={t.role}
                control={
                  <Button size="sm" variant="outline" onClick={() => newBot(t)}>
                    Use
                  </Button>
                }
              />
            ))}
          </SettingsGroup>
        </SettingsSection>
      )}

      <TeammateDialog
        draft={draft}
        models={models}
        onSaved={() => reviewing && dismissProposal(reviewing)}
        onClose={() => {
          setDraft(null);
          setReviewing(undefined);
        }}
      />
    </div>
  );
}

function TeammateRow({ mate, modelName, onEdit }: { mate: Teammate; modelName?: string; onEdit: () => void }) {
  const connectors = useInstalledConnectors();
  const { skills } = useInstructions();
  const { mates } = useTeam();
  // Its duty names a connector it doesn't own: the lead would keep that work.
  const missing = connectorsItNeeds(mate, connectors).map((c) => ({ ...c, owner: ownerOf(mates, "connectors", c.id, mate.id) }));
  const names = [
    ...mate.connectors.map((id) => connectors.find((c) => c.id === id)?.name ?? id),
    ...mate.skills.map((id) => skills.find((k) => k.id === id)?.name).filter(Boolean),
  ];
  const scope = TOOL_SCOPES.find((s) => s.value === mate.tools)?.label;
  return (
    <SettingRow
      icon={<CoworkBot bot={mate.mascot} size={26} />}
      label={
        <span className="flex items-center gap-2">
          {mate.name}
          {mate.origin === "lead" && (
            <span className="rounded-full bg-violet-500/10 px-1.5 text-[10px] font-medium text-violet-700 dark:text-violet-300">
              from the lead
            </span>
          )}
        </span>
      }
      description={
        <>
          {mate.role}
          <span className="mt-0.5 block text-[11px]">
            {modelName ?? (mate.modelId ? mate.modelId.replace(/^api:/, "") : "No model — pick one")} · {scope}
            {names.length > 0 && ` · ${names.join(", ")}`}
          </span>
          {missing.map((c) => (
            <span
              key={c.id}
              className="mt-1.5 flex flex-wrap items-center gap-1.5 rounded-md bg-amber-500/10 px-2 py-1 text-[11px] text-amber-800 dark:text-amber-300"
            >
              <AlertTriangleIcon className="size-3 shrink-0" />
              {c.owner
                ? `Its duty needs ${c.name}, but ${c.owner.name} owns it.`
                : `Its duty needs ${c.name}, but it doesn't own it — so the lead would do that work itself.`}
              {!c.owner && (
                <button
                  type="button"
                  className="font-medium underline underline-offset-2"
                  onClick={() => saveTeammate({ ...mate, connectors: [...mate.connectors, c.id] })}
                >
                  Give {c.name} to {mate.name}
                </button>
              )}
            </span>
          ))}
        </>
      }
      control={
        <>
          <Switch
            checked={mate.onTeam}
            onCheckedChange={(on) => setOnTeam(mate.id, on)}
            aria-label={mate.onTeam ? `Take ${mate.name} off the team` : `Put ${mate.name} on the team`}
          />
          <Button size="icon-sm" variant="ghost" onClick={onEdit} aria-label={`Edit ${mate.name}`}>
            <PencilIcon />
          </Button>
          <Button size="icon-sm" variant="ghost" onClick={() => removeTeammate(mate.id)} aria-label={`Remove ${mate.name}`}>
            <Trash2Icon />
          </Button>
        </>
      }
    />
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
          <p className="px-4 py-3 text-xs text-muted-foreground">Nothing yet. It fills in as you work in team mode, or press Update now.</p>
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
