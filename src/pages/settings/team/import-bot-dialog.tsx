import { CoworkBot } from "@/components/anim/cowork-bot";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/components/ui/sonner";
import { Switch } from "@/components/ui/switch";
import {
  fetchPlugin,
  getPlugin,
  humanize,
  installPlugin,
  ownedParts,
  splitFrontMatter,
  type PluginPackage,
  type PluginSource,
} from "@/features/plugins";
import { defaultTeamModel, freeMascot, setOnTeam, setPersonal, useTeam, useTeamModels } from "@/features/team";
import { ModelPicker } from "@/pages/chat/components/model-picker";
import { findModel } from "@/pages/chat/models";
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { FileArchiveIcon, FolderOpenIcon, Loader2, MessageCircleIcon, PlugIcon, ScrollTextIcon, UsersIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";

/**
 * Bring in a bot made elsewhere (bot-forge, or any plugin with an agent): its
 * skills and connectors come along and stay its own. The user says where it
 * goes — on the team, theirs to talk to from the chat box, or both — and
 * which model it runs on. It installs as a plugin, so Settings › Plugins
 * can update or remove it later.
 */
export function ImportBotDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const team = useTeam();
  const models = useTeamModels();
  const [pkg, setPkg] = useState<PluginPackage | null>(null);
  const [loading, setLoading] = useState<"zip" | "folder" | null>(null);
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState<string>();
  const [onTeam, setOnTeamChoice] = useState(true);
  const [personal, setPersonalChoice] = useState(true);
  const [modelId, setModelId] = useState<string>();
  const file = useRef<HTMLInputElement>(null);
  const ids = { team: useId(), personal: useId() };

  useEffect(() => {
    if (!open) return;
    setPkg(null);
    setError(undefined);
    setOnTeamChoice(team.enabled);
    setPersonalChoice(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  useEffect(() => {
    if (!modelId) setModelId(defaultTeamModel(models));
  }, [models, modelId]);

  const read = async (kind: "zip" | "folder", source: () => Promise<PluginSource | null>) => {
    setError(undefined);
    setLoading(kind);
    try {
      const from = await source();
      if (!from) return;
      const { plugin } = await fetchPlugin(from);
      if (!plugin) throw new Error("That folder holds several plugins (a marketplace), not one bot.");
      if (!plugin.agents.length) throw new Error("This plugin has no bot in it (no agents/*.md). Install it from Settings › Plugins instead.");
      setPkg(plugin);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(null);
    }
  };

  const fromZip = (picked: File) =>
    read("zip", async () => {
      const data = Array.from(new Uint8Array(await picked.arrayBuffer()));
      const path = await invoke<string>("plugins_unpack_bot", { data });
      return { kind: "folder", path };
    });
  const fromFolder = () =>
    read("folder", async () => {
      const folder = await openDialog({ directory: true, multiple: false, title: "Choose the bot's folder" });
      return typeof folder === "string" ? { kind: "folder", path: folder } : null;
    });

  const install = async () => {
    if (!pkg || !modelId) return;
    setInstalling(true);
    setError(undefined);
    try {
      const report = await installPlugin(pkg, {
        skills: pkg.skills,
        commands: pkg.commands,
        agents: pkg.agents,
        agentModelId: modelId,
        connectors: pkg.mcpServers.filter((s) => !s.skipped),
        templates: [],
        panels: false,
        instructions: false,
      });
      const bots = getPlugin(pkg.id)?.bots ?? [];
      for (const id of bots) {
        setOnTeam(id, onTeam);
        setPersonal(id, personal);
      }
      if (!bots.length) throw new Error(report.skipped.join(" · ") || "The bot couldn't be added.");
      const name = botName(pkg);
      toast.success(`${name} is ready`, {
        description: [
          personal && "Pick it in the chat box's model menu, under Your bots.",
          report.connectors > 0 && "Connect its connectors in Settings › Connectors.",
          report.skipped.length > 0 && `Left out: ${report.skipped.join(" · ")}`,
        ]
          .filter(Boolean)
          .join(" "),
      });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setInstalling(false);
    }
  };

  const agent = pkg?.agents[0];
  const owned = agent ? ownedParts(agent) : { connectors: [], skills: [] };
  const meta = agent ? splitFrontMatter(agent.content).meta : {};
  const connectors = pkg ? pkg.mcpServers.filter((s) => !owned.connectors.length || owned.connectors.includes(s.name)) : [];
  const skills = pkg ? pkg.skills.filter((s) => !owned.skills.length || owned.skills.includes(s.folder)) : [];
  const nothing = !onTeam && !personal;

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !installing && onClose()}>
      <DialogContent className="flex max-h-[88vh] flex-col sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{pkg ? `Import ${botName(pkg)}` : "Import a bot"}</DialogTitle>
          <DialogDescription>
            {pkg
              ? meta.description || pkg.description
              : "A bot made with bot-forge (its .zip), or any plugin folder with a bot in it. Nothing in it runs while it's added."}
          </DialogDescription>
        </DialogHeader>

        <div className="-mx-1 flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-1">
          {!pkg ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <SourceButton icon={<FileArchiveIcon />} title="A .zip file" hint="What bot-forge exports" busy={loading === "zip"} onClick={() => file.current?.click()} />
              <SourceButton icon={<FolderOpenIcon />} title="A folder" hint="An unzipped bot or plugin" busy={loading === "folder"} onClick={() => void fromFolder()} />
              <input
                ref={file}
                type="file"
                accept=".zip,application/zip"
                hidden
                onChange={(e) => {
                  const picked = e.target.files?.[0];
                  e.target.value = "";
                  if (picked) void fromZip(picked);
                }}
              />
            </div>
          ) : (
            <>
              <div className="flex items-start gap-3 rounded-xl border bg-muted/20 p-3">
                <CoworkBot bot={freeMascot(team.mates)} size={40} />
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  <span className="text-sm font-semibold">{botName(pkg)}</span>
                  <Owns icon={<PlugIcon />} label="Connectors" names={connectors.map((s) => humanize(s.name))} empty="none — works with its own tools" />
                  <Owns icon={<ScrollTextIcon />} label="Skills" names={skills.map((s) => s.folder)} empty="none" />
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <span className="text-sm font-semibold">Use it</span>
                <Choice
                  id={ids.personal}
                  icon={<MessageCircleIcon />}
                  title="As my own bot"
                  hint="Pick it in the chat box like a model and talk to it directly — its instructions, skills, connectors and model."
                  checked={personal}
                  onChange={setPersonalChoice}
                />
                <Choice
                  id={ids.team}
                  icon={<UsersIcon />}
                  title="On the team"
                  hint={`In team mode the lead hands it the jobs that are its duty.${team.enabled ? "" : " Team mode is off now (Settings › Team)."}`}
                  checked={onTeam}
                  onChange={setOnTeamChoice}
                />
                {nothing && <p className="text-xs text-amber-700 dark:text-amber-400">Pick at least one, or the bot sits unused.</p>}
              </div>

              <div className="flex flex-col gap-2">
                <span className="text-sm font-semibold">Runs on</span>
                {models.length ? (
                  <ModelPicker
                    appearance="field"
                    models={models}
                    selected={findModel(models, modelId ?? models[0].id)}
                    onSelect={(model) => setModelId(model.id)}
                  />
                ) : (
                  <p className="text-xs text-muted-foreground">Add an API key or sign in to a CLI agent in Settings → Models first.</p>
                )}
                <p className="text-xs text-muted-foreground">Any model you've set up: an API key from any provider, a local model, or a CLI agent. Change it later on the bot's page.</p>
              </div>
            </>
          )}
          {error && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          {pkg && (
            <Button variant="ghost" disabled={installing} onClick={() => setPkg(null)}>
              Back
            </Button>
          )}
          <Button variant="outline" disabled={installing} onClick={onClose}>
            Cancel
          </Button>
          {pkg && (
            <Button disabled={installing || nothing || !modelId} onClick={() => void install()}>
              {installing && <Loader2 className="size-4 animate-spin" />}
              Import
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The name the bot shows: its own display name, else its agent's. */
function botName(pkg: PluginPackage) {
  const agent = pkg.agents[0];
  if (!agent) return pkg.name;
  const { meta } = splitFrontMatter(agent.content);
  return meta["mali-name"]?.trim() || humanize(meta.name || agent.name);
}

function SourceButton({ icon, title, hint, busy, onClick }: { icon: ReactNode; title: string; hint: string; busy: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      disabled={busy}
      onClick={onClick}
      className="flex items-center gap-3 rounded-xl border p-4 text-left transition-colors hover:border-foreground/30 hover:bg-muted/30 disabled:opacity-60"
    >
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted [&_svg]:size-5">{busy ? <Loader2 className="animate-spin" /> : icon}</span>
      <span className="flex min-w-0 flex-col">
        <span className="text-sm font-medium">{title}</span>
        <span className="text-xs text-muted-foreground">{hint}</span>
      </span>
    </button>
  );
}

function Owns({ icon, label, names, empty }: { icon: ReactNode; label: string; names: string[]; empty: string }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs">
      <span className="flex items-center gap-1 text-muted-foreground [&_svg]:size-3.5">
        {icon}
        {label}:
      </span>
      {names.length ? (
        names.map((n) => (
          <span key={n} className="rounded-md bg-muted px-1.5 py-0.5">
            {n}
          </span>
        ))
      ) : (
        <span className="text-muted-foreground">{empty}</span>
      )}
    </div>
  );
}

function Choice({ id, icon, title, hint, checked, onChange }: { id: string; icon: ReactNode; title: string; hint: string; checked: boolean; onChange: (on: boolean) => void }) {
  return (
    <label htmlFor={id} className={cn("flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors", checked && "border-primary/50 bg-primary/5")}>
      <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted [&_svg]:size-4">{icon}</span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-sm font-medium">{title}</span>
        <span className="text-xs text-muted-foreground">{hint}</span>
      </span>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </label>
  );
}
