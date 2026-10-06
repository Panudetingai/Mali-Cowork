import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { fromSkillFile } from "@/features/instructions";
import {
    commandToSkill,
    dutyOf,
    humanize,
    splitFrontMatter,
    toolScopeOf,
    type PluginChoices,
    type PluginPackage,
} from "@/features/plugins";
import { defaultTeamModel, useTeamModels } from "@/features/team";
import { cn } from "@/lib/utils";
import { ModelPicker } from "@/pages/chat/components/model-picker";
import { findModel } from "@/pages/chat/models";
import {
    BotIcon,
    ChevronRightIcon,
    FileTextIcon,
    LayoutPanelLeftIcon,
    Loader,
    NotebookPenIcon,
    PackageIcon,
    PlugIcon,
    SlashIcon
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Notice } from "../ui";

/** Above this many, a part starts unpicked: each one adds to every prompt. */
const PICK_ALL_UP_TO = { skills: 25, commands: 40, agents: 3 };

type Row = { key: string; title: string; description: string; detail?: string; skipped?: string; meta?: string };

type Names = { skills: Set<string>; commands: Set<string>; bots: Set<string>; connectors: Set<string> };

/**
 * What installing a plugin will add, part by part — and the say over each
 * part. On an update, what's installed now starts picked and what's new is
 * marked so.
 */
export function InstallPluginDialog({
  plugin,
  installed,
  busy,
  onInstall,
  onClose,
}: {
  plugin: PluginPackage | null;
  /** On an update: the names of what's installed now. */
  installed?: Names;
  busy?: boolean;
  onInstall: (choices: PluginChoices) => void;
  onClose: () => void;
}) {
  const models = useTeamModels();
  const rows = useMemo(() => (plugin ? rowsOf(plugin) : null), [plugin]);
  const [picked, setPicked] = useState<Record<Part, Set<string>>>(emptyPicks);
  const [panels, setPanels] = useState(true);
  const [instructions, setInstructions] = useState(true);
  const [modelId, setModelId] = useState<string | undefined>();

  useEffect(() => {
    if (!plugin || !rows) return;
    setPicked(defaults(rows, installed));
    setPanels(true);
    setInstructions(true);
  }, [plugin, rows, installed]);

  useEffect(() => {
    if (!modelId) setModelId(defaultTeamModel(models));
  }, [models, modelId]);

  if (!plugin || !rows) return null;
  const isUpdate = !!installed;
  const isNew = (part: Part, title: string) => !!installed && !namesFor(installed, part).has(title);

  const choose = (part: Part, keys: string[], on: boolean) =>
    setPicked((prev) => {
      const next = new Set(prev[part]);
      for (const key of keys) {
        if (on) next.add(key);
        else next.delete(key);
      }
      return { ...prev, [part]: next };
    });

  const count = (part: Part) => picked[part].size;
  const needsModel = count("agents") > 0 && !modelId;
  const total =
    count("skills") + count("commands") + count("agents") + count("connectors") + count("templates") +
    (panels ? plugin.panels.length : 0) + (instructions && plugin.instructions ? 1 : 0);

  const install = () =>
    onInstall({
      skills: plugin.skills.filter((_, i) => picked.skills.has(rows.skills[i].key)),
      commands: plugin.commands.filter((_, i) => picked.commands.has(rows.commands[i].key)),
      agents: plugin.agents.filter((_, i) => picked.agents.has(rows.agents[i].key)),
      agentModelId: modelId,
      connectors: plugin.mcpServers.filter((_, i) => picked.connectors.has(rows.connectors[i].key)),
      templates: plugin.templates.filter((_, i) => picked.templates.has(rows.templates[i].key)),
      panels,
      instructions,
    });

  return (
    <Dialog open={!!plugin} onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="flex max-h-[88vh] flex-col sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            {isUpdate ? `Update “${plugin.name}”` : `Install “${plugin.name}”`}
            {plugin.version && <span className="text-sm font-normal text-muted-foreground">v{plugin.version}</span>}
          </DialogTitle>
          <DialogDescription className="flex flex-col gap-1">
            {plugin.description && <span>{plugin.description}</span>}
            <span className="text-xs text-muted-foreground/80 [overflow-wrap:anywhere]">
              {plugin.author && `${plugin.author} · `}
              {plugin.sourceLabel}
              {plugin.license && ` · ${plugin.license}`}
            </span>
          </DialogDescription>
        </DialogHeader>

        <div className="-mx-1 flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-1">
          <PartList
            part="skills"
            icon={<PackageIcon />}
            title="Skills"
            hint="How-tos the AI follows when a task matches. Each one you keep adds a line to every Cowork prompt."
            rows={rows.skills}
            picked={picked.skills}
            isNew={(t) => isNew("skills", t)}
            onChoose={choose}
          />
          <PartList
            part="commands"
            icon={<SlashIcon />}
            title="Slash commands"
            hint="Called by name in the chat box, e.g. /review. They cost nothing until you call one."
            rows={rows.commands}
            picked={picked.commands}
            isNew={(t) => isNew("commands", t)}
            onChoose={choose}
          />
          <PartList
            part="agents"
            icon={<BotIcon />}
            title="Bots"
            hint="Join your team with one duty each. The lead asks you before calling a bot from a plugin."
            rows={rows.agents}
            picked={picked.agents}
            isNew={(t) => isNew("agents", t)}
            onChoose={choose}
            footer={
              count("agents") > 0 &&
              (models.length > 0 && modelId ? (
                <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center">
                  <span className="text-xs text-muted-foreground">New bots run on</span>
                  <div className="w-full sm:w-64">
                    <ModelPicker
                      appearance="field"
                      models={models}
                      selected={findModel(models, modelId)}
                      onSelect={(model) => setModelId(model.id)}
                    />
                  </div>
                </div>
              ) : (
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  Add an API key or sign in to a CLI agent in Settings → Models so the bots have a model to run on.
                </p>
              ))
            }
          />
          <PartList
            part="connectors"
            icon={<PlugIcon />}
            title="Connectors"
            hint="Added switched off. You connect each one — and give it any keys — in Settings → Connectors."
            rows={rows.connectors}
            picked={picked.connectors}
            isNew={(t) => isNew("connectors", t)}
            onChoose={choose}
          />
          <PartList
            part="templates"
            icon={<FileTextIcon />}
            title="Templates"
            hint="Word templates for documents, added to your template library."
            rows={rows.templates}
            picked={picked.templates}
            onChoose={choose}
          />
          {plugin.panels.length > 0 && (
            <Toggle
              icon={<LayoutPanelLeftIcon />}
              title={`${plugin.panels.length} panel${plugin.panels.length === 1 ? "" : "s"}`}
              description={`${plugin.panels.map((p) => p.title).join(", ")} — pages it shows in the app, sandboxed: they can't reach your files, keys or the internet.`}
              checked={panels}
              onChange={setPanels}
            />
          )}
          {plugin.instructions && (
            <Toggle
              icon={<NotebookPenIcon />}
              title="Instructions"
              description="Added to every chat while the plugin is on."
              detail={plugin.instructions}
              checked={instructions}
              onChange={setInstructions}
            />
          )}
          {plugin.unsupported.length > 0 && (
            <Notice title="Left out">
              <ul className="list-disc space-y-0.5 pl-4 text-xs">
                {plugin.unsupported.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            </Notice>
          )}
        </div>

        <p className="text-xs text-muted-foreground">
          Plugins come from people on the internet. Read what you don’t recognise — the AI follows skills and commands,
          and connectors run programs. Nothing runs while installing.
        </p>

        <DialogFooter className="items-center">
          <span className="mr-auto text-xs text-muted-foreground">{total} picked</span>
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="button" onClick={install} disabled={busy || needsModel || (total === 0 && !isUpdate)} className="gap-1.5">
            {busy && <Loader className="size-4 animate-spin" />}
            {busy ? (isUpdate ? "Updating…" : "Installing…") : isUpdate ? "Update" : "Install"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type Part = "skills" | "commands" | "agents" | "connectors" | "templates";

const emptyPicks = (): Record<Part, Set<string>> => ({
  skills: new Set(),
  commands: new Set(),
  agents: new Set(),
  connectors: new Set(),
  templates: new Set(),
});

function namesFor(names: Names, part: Part): Set<string> {
  switch (part) {
    case "skills":
      return names.skills;
    case "commands":
      return names.commands;
    case "agents":
      return names.bots;
    case "connectors":
      return names.connectors;
    default:
      return new Set();
  }
}

/** Each part as rows to show, keyed by position (names may repeat). */
function rowsOf(plugin: PluginPackage): Record<Part, Row[]> {
  return {
    skills: plugin.skills.map((s, i) => {
      const skill = fromSkillFile(s.content, s.folder || "Skill");
      const kept = s.files.filter((f) => !f.skipped).length;
      return {
        key: `s${i}`,
        title: skill.name.trim().toLowerCase().replace(/\s+/g, "-"),
        description: skill.description,
        detail: skill.instructions,
        meta: kept ? `${kept} file${kept === 1 ? "" : "s"}` : undefined,
      };
    }),
    commands: plugin.commands.map((c, i) => {
      const skill = commandToSkill(c, plugin.name);
      return { key: `c${i}`, title: skill.name, description: skill.description, detail: splitFrontMatter(c.content).body };
    }),
    agents: plugin.agents.map((a, i) => {
      const { meta, body } = splitFrontMatter(a.content);
      const scope = toolScopeOf(meta.tools);
      return {
        key: `a${i}`,
        title: humanize(meta.name || a.name),
        description: dutyOf(meta.description || ""),
        detail: body,
        meta: scope === "all" ? "files and commands" : scope === "files" ? "changes files" : scope === "read" ? "reads files" : "no files",
      };
    }),
    connectors: plugin.mcpServers.map((m, i) => {
      const c = m.config as Record<string, unknown>;
      const command = Array.isArray(c.command)
        ? c.command.join(" ")
        : [c.command, ...(Array.isArray(c.args) ? c.args : [])].filter((x) => typeof x === "string").join(" ");
      const where = typeof c.url === "string" ? c.url : command;
      return { key: `m${i}`, title: humanize(m.name), description: where, skipped: m.skipped };
    }),
    templates: plugin.templates.map((t, i) => ({
      key: `t${i}`,
      title: t.name,
      description: t.path,
      skipped: t.skipped,
    })),
  };
}

function defaults(rows: Record<Part, Row[]>, installed?: Names): Record<Part, Set<string>> {
  const usable = (part: Part) => rows[part].filter((r) => !r.skipped);
  const all = (part: Part) => new Set(usable(part).map((r) => r.key));
  if (installed) {
    const same = (part: Part) => new Set(usable(part).filter((r) => namesFor(installed, part).has(r.title)).map((r) => r.key));
    return { skills: same("skills"), commands: same("commands"), agents: same("agents"), connectors: same("connectors"), templates: all("templates") };
  }
  const upTo = (part: "skills" | "commands" | "agents") =>
    rows[part].length <= PICK_ALL_UP_TO[part] ? all(part) : new Set<string>();
  return { skills: upTo("skills"), commands: upTo("commands"), agents: upTo("agents"), connectors: all("connectors"), templates: all("templates") };
}

function PartList({
  part,
  icon,
  title,
  hint,
  rows,
  picked,
  isNew,
  onChoose,
  footer,
}: {
  part: Part;
  icon: ReactNode;
  title: string;
  hint: string;
  rows: Row[];
  picked: Set<string>;
  isNew?: (title: string) => boolean;
  onChoose: (part: Part, keys: string[], on: boolean) => void;
  footer?: ReactNode;
}) {
  const [open, setOpen] = useState(rows.length <= 8);
  const [query, setQuery] = useState("");
  if (rows.length === 0) return null;
  const q = query.trim().toLowerCase();
  const shown = rows.filter((r) => !q || `${r.title} ${r.description}`.toLowerCase().includes(q));
  const usable = shown.filter((r) => !r.skipped).map((r) => r.key);

  return (
    <section className="rounded-xl border border-border/70">
      <div className="flex items-center gap-3 p-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted/70 text-foreground/70 [&_svg]:size-4">
          {icon}
        </span>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex min-w-0 flex-1 flex-col items-start text-left"
        >
          <span className="flex items-center gap-1.5 text-sm font-medium">
            {title}
            <span className="text-xs font-normal tabular-nums text-muted-foreground">
              {picked.size} of {rows.length}
            </span>
            <ChevronRightIcon className={cn("size-3.5 text-muted-foreground transition-transform", open && "rotate-90")} />
          </span>
          <span className="text-xs leading-relaxed text-muted-foreground">{hint}</span>
        </button>
        <div className="flex shrink-0 gap-1">
          <Button type="button" size="xs" variant="ghost" onClick={() => onChoose(part, usable, true)}>
            All
          </Button>
          <Button type="button" size="xs" variant="ghost" onClick={() => onChoose(part, shown.map((r) => r.key), false)}>
            None
          </Button>
        </div>
      </div>
      {footer && <div className="border-t border-border/60 px-3 py-2.5">{footer}</div>}
      {open && (
        <div className="border-t border-border/60">
          {rows.length > 8 && (
            <div className="p-2">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={`Filter ${rows.length} ${title.toLowerCase()}…`}
                aria-label={`Filter ${title.toLowerCase()}`}
                className="h-8 w-full rounded-lg border bg-transparent px-2.5 text-[13px] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              />
            </div>
          )}
          <ul className="flex max-h-72 flex-col divide-y divide-border/60 overflow-y-auto">
            {shown.map((row) => (
              <RowItem
                key={row.key}
                row={row}
                fresh={isNew?.(row.title)}
                picked={picked.has(row.key)}
                onToggle={() => onChoose(part, [row.key], !picked.has(row.key))}
              />
            ))}
            {shown.length === 0 && <li className="p-3 text-center text-xs text-muted-foreground">Nothing matches.</li>}
          </ul>
        </div>
      )}
    </section>
  );
}

function RowItem({ row, picked, fresh, onToggle }: { row: Row; picked: boolean; fresh?: boolean; onToggle: () => void }) {
  const [reading, setReading] = useState(false);
  return (
    <li className={cn(!picked && "opacity-60")}>
      <div className="flex min-w-0 items-start gap-3 px-3 py-2">
        <input
          type="checkbox"
          checked={picked}
          disabled={!!row.skipped}
          onChange={onToggle}
          aria-label={`Keep ${row.title}`}
          className="mt-0.5 size-4 shrink-0 accent-primary"
        />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <p className="flex min-w-0 items-center gap-2">
            <span className={cn("truncate text-[13px] font-medium", row.skipped && "line-through")}>{row.title}</span>
            {fresh && (
              <span className="shrink-0 rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-400">
                New
              </span>
            )}
            {row.meta && <span className="shrink-0 text-[11px] text-muted-foreground/70">{row.meta}</span>}
          </p>
          {row.description && (
            <p className="line-clamp-2 text-xs text-muted-foreground [overflow-wrap:anywhere]">{row.description}</p>
          )}
          {row.skipped && <p className="text-xs text-amber-700 dark:text-amber-400">{row.skipped}</p>}
          {row.detail && (
            <button
              type="button"
              onClick={() => setReading((v) => !v)}
              aria-expanded={reading}
              className="flex w-fit items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
            >
              <FileTextIcon className="size-3" />
              Read it
              <ChevronRightIcon className={cn("size-3 transition-transform", reading && "rotate-90")} />
            </button>
          )}
        </div>
      </div>
      {reading && row.detail && (
        <pre className="mx-3 mb-2 max-h-56 overflow-auto rounded-lg bg-muted/40 p-2.5 font-mono text-[11px] leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]">
          {row.detail}
        </pre>
      )}
    </li>
  );
}

function Toggle({
  icon,
  title,
  description,
  detail,
  checked,
  onChange,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  detail?: string;
  checked: boolean;
  onChange: (on: boolean) => void;
}) {
  const [reading, setReading] = useState(false);
  return (
    <section className="rounded-xl border border-border/70">
      <label className="flex cursor-pointer items-start gap-3 p-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted/70 text-foreground/70 [&_svg]:size-4">
          {icon}
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-sm font-medium">{title}</span>
          <span className="text-xs leading-relaxed text-muted-foreground">{description}</span>
        </span>
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="mt-1 size-4 shrink-0 accent-primary"
        />
      </label>
      {detail && (
        <div className="border-t border-border/60 px-3 py-2">
          <button
            type="button"
            onClick={() => setReading((v) => !v)}
            className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
          >
            Read it
            <ChevronRightIcon className={cn("size-3 transition-transform", reading && "rotate-90")} />
          </button>
          {reading && (
            <pre className="mt-2 max-h-56 overflow-auto rounded-lg bg-muted/40 p-2.5 font-mono text-[11px] leading-relaxed whitespace-pre-wrap">
              {detail}
            </pre>
          )}
        </div>
      )}
    </section>
  );
}
