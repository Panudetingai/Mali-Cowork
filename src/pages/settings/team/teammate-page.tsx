import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ModelPicker } from "@/pages/chat/components/model-picker";
import { findModel } from "@/pages/chat/models";
import { Textarea } from "@/components/ui/textarea";
import { CoworkBot } from "@/components/anim/cowork-bot";
import { BOTS } from "@/features/cowork-bot";
import { useInstructions } from "@/features/instructions";
import { McpToolIcon, useInstalledConnectors } from "@/features/mcp";
import { draftIssue, ownerOf, runsOn, saveTeammate, TOOL_SCOPES, useTeam, type TeammateDraft } from "@/features/team";
import { cn } from "@/lib/utils";
import type { AiModel } from "@/pages/chat/models";
import { CheckIcon, ScrollTextIcon } from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import { Field, PageHeader, Step } from "../ui";

/**
 * Create or edit a bot, as its own page (`/settings/team/new`,
 * `/settings/team/<id>`); a connector or skill another bot owns can't be picked.
 */
export function TeammatePage({
  draft,
  models,
  onSaved,
  onDone,
}: {
  draft: TeammateDraft;
  /** Models a bot can run on: API models and the CLI agents, as the chat box lists them. */
  models: AiModel[];
  onSaved?: () => void;
  onDone: () => void;
}) {
  const { mates } = useTeam();
  const { skills } = useInstructions();
  const connectors = useInstalledConnectors();
  const [form, setForm] = useState<TeammateDraft>(draft);
  const [error, setError] = useState<string>();
  const ids = { name: useId(), role: useId(), instructions: useId() };

  const set = (patch: Partial<TeammateDraft>) => setForm((f) => ({ ...f, ...patch }));
  const toggle = (kind: "skills" | "connectors", id: string) =>
    set({ [kind]: form[kind].includes(id) ? form[kind].filter((x) => x !== id) : [...form[kind], id] });
  const issue = draftIssue(mates, form);

  const save = () => {
    try {
      saveTeammate(form);
      onSaved?.();
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const usableSkills = skills.filter((k) => k.enabled);
  const onCli = !!form.modelId && runsOn(form.modelId) !== "api";

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        back={{ label: "Team", onClick: onDone }}
        media={<CoworkBot bot={form.mascot} state="welcome" size={48} />}
        title={form.id ? `Edit ${form.name || "bot"}` : "New bot"}
        description="One duty per bot. The lead gives each job to the bot whose duty it is, and never gives it to anyone else."
      />

      <div className="flex max-w-3xl flex-col">
        <Step n={1} title="Who it is" done={!!form.name.trim()}>
          <div className="flex max-w-lg flex-col gap-5">
            <Field label="Name" htmlFor={ids.name}>
              <Input id={ids.name} value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder="Momo Designer" className="h-10" />
            </Field>
            <Field label="Look">
              <div role="radiogroup" aria-label="Look" className="flex flex-wrap gap-1">
                {BOTS.map((bot) => {
                  const on = form.mascot === bot.id;
                  return (
                    <button
                      key={bot.id}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      title={bot.name}
                      onClick={() => set({ mascot: bot.id })}
                      className={cn(
                        "flex size-12 items-center justify-center rounded-xl transition",
                        on ? "bg-violet-500/10 ring-2 ring-violet-500" : "opacity-60 hover:bg-muted/60 hover:opacity-100",
                      )}
                    >
                      {/* Picking one plays its "done" again. */}
                      <CoworkBot key={on ? `${bot.id}-on` : bot.id} bot={bot.id} state="done" size={40} />
                    </button>
                  );
                })}
              </div>
            </Field>
          </div>
        </Step>

        <Step n={2} title="Its duty" description="The lead reads it to decide which bot does a job." done={!!form.role.trim()}>
          <div className="flex max-w-2xl flex-col gap-5">
            <Field label="Duty" htmlFor={ids.role} hint="One sentence.">
              <Textarea
                id={ids.role}
                value={form.role}
                onChange={(e) => set({ role: e.target.value })}
                placeholder="Designs posts, banners and slides in Canva."
                className="min-h-16 resize-y text-sm"
              />
            </Field>
            <Field label="How it works" htmlFor={ids.instructions} optional hint="Steps, style, what it hands back to the lead.">
              <Textarea
                id={ids.instructions}
                value={form.instructions}
                onChange={(e) => set({ instructions: e.target.value })}
                placeholder="Keep the brand's colours and fonts. Check the preview before finishing. Hand back the design link."
                className="min-h-24 resize-y text-sm"
              />
            </Field>
          </div>
        </Step>

        <Step n={3} title="What it runs on" done={!!form.modelId}>
          <div className="grid max-w-2xl grid-cols-1 gap-5 sm:grid-cols-2">
            <Field
              label="Model"
              hint={
                !models.length
                  ? "Add an API key or sign in to a CLI agent in Settings → Models first."
                  : onCli
                    ? "Runs on this CLI agent, with its own tools and sign-in."
                    : "Runs on Mali's own agent with your API key."
              }
            >
              {models.length > 0 ? (
                <ModelPicker
                  appearance="field"
                  models={models}
                  selected={findModel(models, form.modelId || models[0].id)}
                  onSelect={(model) => set({ modelId: model.id })}
                />
              ) : (
                <p className="text-xs text-muted-foreground">No models yet.</p>
              )}
            </Field>
            <Field label="Files and commands" hint={TOOL_SCOPES.find((s) => s.value === form.tools)?.hint}>
              <Select value={form.tools} onValueChange={(tools) => set({ tools: tools as TeammateDraft["tools"] })}>
                <SelectTrigger className="w-full" aria-label="Files and commands">
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
            </Field>
          </div>
        </Step>

        <Step n={4} title="What it owns" description="Only this bot gets them — the lead and the other bots don't." last>
          <div className="flex flex-col gap-5">
            <Field
              label="Connectors"
              hint={
                onCli
                  ? "A CLI agent can reach every connector that's on; this bot is told to use only these, and no other bot may pick them."
                  : undefined
              }
            >
              <PickList
                empty="No connectors yet. Add them in Settings → Connectors."
                items={connectors.map((c) => ({
                  id: c.id,
                  label: c.name,
                  icon: <McpToolIcon mcp={c.ref} size={14} />,
                  note: c.enabled ? undefined : "off",
                  owner: ownerOf(mates, "connectors", c.id, form.id)?.name,
                }))}
                picked={form.connectors}
                onToggle={(id) => toggle("connectors", id)}
              />
            </Field>
            <Field label="Skills" optional>
              <PickList
                empty="No skills yet. Add them in Settings → Skills."
                items={usableSkills.map((k) => ({
                  id: k.id,
                  label: k.name,
                  icon: <ScrollTextIcon className="size-3.5 text-muted-foreground" />,
                  owner: ownerOf(mates, "skills", k.id, form.id)?.name,
                }))}
                picked={form.skills}
                onToggle={(id) => toggle("skills", id)}
              />
            </Field>
          </div>
        </Step>
      </div>

      <div className="sticky bottom-0 z-10 -mx-1 flex items-center justify-between gap-2 border-t border-border/60 bg-background/90 px-1 py-3 backdrop-blur">
        <p className={cn("min-w-0 truncate text-xs", error || issue ? "text-red-600 dark:text-red-400" : "text-muted-foreground")}>
          {error ?? issue ?? "Ready to save"}
        </p>
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="ghost" onClick={onDone}>
            Cancel
          </Button>
          <Button onClick={save} disabled={!!issue} className="h-10 px-5">
            {form.id ? "Save" : "Add to team"}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Chips to pick from; one another bot owns shows whose it is and can't be picked. */
function PickList({
  items,
  picked,
  onToggle,
  empty,
}: {
  items: { id: string; label: string; icon: ReactNode; note?: string; owner?: string }[];
  picked: string[];
  onToggle: (id: string) => void;
  empty: string;
}) {
  if (!items.length) return <p className="text-xs text-muted-foreground">{empty}</p>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((item) => {
        const on = picked.includes(item.id);
        return (
          <button
            key={item.id}
            type="button"
            aria-pressed={on}
            disabled={!!item.owner}
            title={item.owner ? `${item.owner} owns this` : undefined}
            onClick={() => onToggle(item.id)}
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs transition-colors",
              on ? "border-primary/50 bg-primary/10 text-foreground" : "border-border/70 hover:bg-muted/60",
              item.owner && "cursor-not-allowed opacity-50",
            )}
          >
            {item.icon}
            <span className="max-w-40 truncate">{item.label}</span>
            {item.note && <span className="text-muted-foreground">({item.note})</span>}
            {item.owner && <span className="text-muted-foreground">· {item.owner}</span>}
            {on && <CheckIcon className="size-3.5 text-primary" />}
          </button>
        );
      })}
    </div>
  );
}
