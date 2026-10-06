import { ConfirmDialog, type ConfirmRequest } from "@/components/app/confirm-dialog";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import { Switch } from "@/components/ui/switch";
import { useInstructions } from "@/features/instructions";
import { useCustomMcps, useMcpConnections } from "@/features/mcp";
import {
  fetchPluginUpdate,
  setPluginEnabled,
  sourceLabel,
  sourceUrl,
  uninstallPlugin,
  usePlugins,
} from "@/features/plugins";
import { useTeam } from "@/features/team";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  BotIcon,
  ExternalLinkIcon,
  FileTextIcon,
  LayoutPanelLeftIcon,
  LoaderCircleIcon,
  PackageIcon,
  PlugIcon,
  PuzzleIcon,
  RefreshCwIcon,
  SlashIcon,
  Trash2Icon,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { settingsPath } from "../route";
import { Notice, PageEnter, PageHeader, SettingRow, SettingsGroup, StatusPill } from "../ui";
import { InstallPluginDialog } from "./install-plugin-dialog";
import { usePluginInstall } from "./use-plugin-install";

/** One installed plugin: what it brought, and turning it off, updating or removing it. */
export function PluginPage({ id, onBack }: { id: string; onBack: () => void }) {
  const navigate = useNavigate();
  const { plugins } = usePlugins();
  const { skills } = useInstructions();
  const team = useTeam();
  const connectors = useCustomMcps();
  const connections = useMcpConnections();
  const plugin = plugins.find((p) => p.id === id);
  const [busy, setBusy] = useState<"toggle" | "update" | null>(null);
  const [confirm, setConfirm] = useState<ConfirmRequest>();
  const installer = usePluginInstall();

  if (!plugin) {
    return (
      <PageEnter>
        <PageHeader title="Plugin not found" back={{ label: "Plugins", onClick: onBack }} />
      </PageEnter>
    );
  }

  const own = skills.filter((s) => plugin.skills.includes(s.id));
  const ownSkills = own.filter((s) => !s.slashOnly);
  const commands = own.filter((s) => s.slashOnly);
  const bots = team.mates.filter((m) => plugin.bots.includes(m.id));
  const servers = connectors.filter((c) => plugin.connectors.includes(c.id));
  const link = sourceUrl(plugin.source);

  const toggle = async (on: boolean) => {
    setBusy("toggle");
    try {
      await setPluginEnabled(plugin.id, on);
    } finally {
      setBusy(null);
    }
  };

  const update = async () => {
    setBusy("update");
    try {
      installer.review(await fetchPluginUpdate(plugin.id), { update: true });
    } catch (error) {
      toast.error("Couldn’t read the plugin again", { description: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(null);
    }
  };

  const remove = () =>
    setConfirm({
      title: `Remove ${plugin.name}?`,
      description: "Everything it added goes with it: its skills, commands, bots, connectors, templates and panels.",
      confirmLabel: "Remove",
      destructive: true,
      onConfirm: () => {
        void uninstallPlugin(plugin.id).then(() => {
          toast.success(`${plugin.name} removed`);
          onBack();
        });
      },
    });

  return (
    <PageEnter>
      <div className="flex flex-col">
        <PageHeader
          back={{ label: "Plugins", onClick: onBack }}
          icon={<PuzzleIcon className={plugin.enabled ? "text-violet-500" : "text-muted-foreground"} />}
          title={
            <>
              {plugin.name}
              {plugin.version && <span className="text-sm font-normal text-muted-foreground">v{plugin.version}</span>}
              {plugin.update && <StatusPill tone="warning">Update available</StatusPill>}
            </>
          }
          description={plugin.description}
          actions={
            <>
              <Button variant="outline" size="sm" className="gap-1.5" onClick={() => void update()} disabled={!!busy}>
                {busy === "update" ? <LoaderCircleIcon className="size-4 animate-spin" /> : <RefreshCwIcon className="size-4" />}
                {plugin.update ? "Update" : plugin.source.kind === "folder" ? "Reload" : "Check again"}
              </Button>
              <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground" onClick={remove}>
                <Trash2Icon className="size-4" />
                Remove
              </Button>
            </>
          }
        />

        <SettingsGroup title="Plugin" className="mt-6">
          <SettingRow
            label={plugin.enabled ? "On" : "Off"}
            description={
              plugin.enabled
                ? "Its skills, commands, bots and connectors are available."
                : "Everything it added is switched off and comes back as it was when you turn it on."
            }
            control={
              <Switch
                checked={plugin.enabled}
                disabled={busy === "toggle"}
                onCheckedChange={(on) => void toggle(on)}
                aria-label="Plugin on"
              />
            }
          />
          <SettingRow
            label="Source"
            description={
              <>
                {sourceLabel(plugin.source)}
                {plugin.marketplace && ` · from ${plugin.marketplace}`}
                {plugin.author && ` · by ${plugin.author}`}
                {` · updated ${new Date(plugin.updatedAt).toLocaleDateString()}`}
              </>
            }
            control={
              link && (
                <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => void openUrl(link)}>
                  <ExternalLinkIcon className="size-4" />
                  Open
                </Button>
              )
            }
          />
        </SettingsGroup>

        {plugin.panels.length > 0 && (
          <Section title="Panels" description="Pages the plugin shows in the app. They run sandboxed, away from your files and keys.">
            {plugin.panels.map((panel) => (
              <SettingRow
                key={panel.id}
                icon={<LayoutPanelLeftIcon />}
                label={panel.title}
                control={
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!plugin.enabled}
                    onClick={() => navigate(`/plugins/${encodeURIComponent(plugin.id)}/${encodeURIComponent(panel.id)}`)}
                  >
                    Open
                  </Button>
                }
              />
            ))}
          </Section>
        )}

        <NamedList
          icon={<PackageIcon />}
          title="Skills"
          names={ownSkills.map((s) => `${s.name}${s.enabled ? "" : " (off)"}`)}
          action={<LinkButton onClick={() => navigate(settingsPath("skills"))}>Skills</LinkButton>}
        />
        <NamedList icon={<SlashIcon />} title="Slash commands" names={commands.map((s) => `/${s.name}`)} />
        <NamedList
          icon={<BotIcon />}
          title="Bots"
          names={bots.map((b) => `${b.name}${b.paused ? " (paused)" : ""}`)}
          action={<LinkButton onClick={() => navigate(settingsPath("team"))}>Team</LinkButton>}
        />

        {servers.length > 0 && (
          <Section title="Connectors" description="Added switched off. Connect each one, with any keys it needs, on its page.">
            {servers.map((server) => (
              <SettingRow
                key={server.id}
                icon={<PlugIcon />}
                label={server.name}
                description={server.kind === "remote" ? server.url : server.command}
                control={
                  <>
                    <StatusPill tone={connections[server.id]?.enabled ? "success" : "neutral"}>
                      {connections[server.id]?.enabled ? "Connected" : "Not connected"}
                    </StatusPill>
                    <Button size="sm" variant="outline" onClick={() => navigate(settingsPath("mcp", server.id))}>
                      Set up
                    </Button>
                  </>
                }
              />
            ))}
          </Section>
        )}

        {plugin.templates.length > 0 && (
          <Section title="Templates">
            <SettingRow
              icon={<FileTextIcon />}
              label={`${plugin.templates.length} template${plugin.templates.length === 1 ? "" : "s"}`}
              description="In your template library, ready to fill from a chat."
              control={<LinkButton onClick={() => navigate(settingsPath("templates"))}>Templates</LinkButton>}
            />
          </Section>
        )}

        {plugin.instructions && (
          <Section title="Instructions" description="Added to every chat while the plugin is on.">
            <pre className="max-h-64 overflow-auto rounded-lg bg-muted/40 p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap">
              {plugin.instructions}
            </pre>
          </Section>
        )}

        {plugin.unsupported.length > 0 && (
          <div className="border-t border-border/60 py-7">
            <Notice title="Left out">
              <ul className="list-disc space-y-0.5 pl-4 text-xs">
                {plugin.unsupported.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            </Notice>
          </div>
        )}
      </div>

      <InstallPluginDialog
        plugin={installer.pending?.plugin ?? null}
        installed={installer.pending?.installed}
        busy={installer.busy}
        onInstall={(choices) => void installer.install(choices)}
        onClose={installer.cancel}
      />
      <ConfirmDialog request={confirm} onClose={() => setConfirm(undefined)} />
    </PageEnter>
  );
}

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <SettingsGroup title={title} description={description}>
      {children}
    </SettingsGroup>
  );
}

function NamedList({ icon, title, names, action }: { icon: ReactNode; title: string; names: string[]; action?: ReactNode }) {
  const [all, setAll] = useState(false);
  if (names.length === 0) return null;
  const shown = all ? names : names.slice(0, 24);
  return (
    <Section title={title}>
      <SettingRow
        icon={icon}
        label={`${names.length} ${title.toLowerCase()}`}
        control={action}
      >
        <div className="flex flex-wrap gap-1.5">
          {shown.map((name) => (
            <span key={name} className="rounded-md bg-muted/60 px-2 py-0.5 font-mono text-[11px] text-muted-foreground">
              {name}
            </span>
          ))}
          {names.length > shown.length && (
            <button type="button" onClick={() => setAll(true)} className="text-[11px] font-medium underline-offset-2 hover:underline">
              and {names.length - shown.length} more
            </button>
          )}
        </div>
      </SettingRow>
    </Section>
  );
}

function LinkButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <Button size="sm" variant="ghost" onClick={onClick}>
      {children}
    </Button>
  );
}
