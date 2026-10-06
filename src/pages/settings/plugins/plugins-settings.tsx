import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/sonner";
import { Switch } from "@/components/ui/switch";
import {
    checkPluginUpdates,
    examplePluginDir,
    fetchPlugin,
    resolvePluginSource,
    saveMarketplace,
    setPluginEnabled,
    sourceLabel,
    usePlugins,
    type InstalledPlugin,
    type PluginSource,
} from "@/features/plugins";
import {
    isSuggestedPluginInstalled,
    looksLikePluginImageUrl,
    MarketplaceBrandIcon,
    resolveMarketplaceBrand,
    resolveSuggestedPlugin,
    SUGGESTED_MARKETPLACES,
    SUGGESTED_PLUGINS,
} from "@/features/plugins/marketplace-brand";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { FolderOpenIcon, Loader, PuzzleIcon, RefreshCwIcon, SearchIcon } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useSettingsSub } from "../route";
import { Dot, EmptyState, Field, PageHeader, SectionLabel, Tile, TileBadge, TileGrid } from "../ui";
import { InstallPluginDialog } from "./install-plugin-dialog";
import { MarketplacePage } from "./marketplace-page";
import { PluginPage } from "./plugin-page";
import { usePluginInstall } from "./use-plugin-install";

/**
 * Settings → Plugins.
 *
 * A plugin brings several things at once — skills, slash commands, bots,
 * connectors, templates, instructions and panels — and is turned off, updated
 * or removed as one. Published Claude Code plugins and marketplaces install
 * as they are.
 */
export function PluginsSettings() {
  const { sub, open, back } = useSettingsSub();
  const { plugins, marketplaces } = usePlugins();
  const installer = usePluginInstall((id) => open(id));
  const [input, setInput] = useState("");
  const [finding, setFinding] = useState<"link" | "folder" | null>(null);
  /** Which suggested tile is fetching (Recommended / Marketplaces card key). */
  const [loadingCard, setLoadingCard] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  if (sub?.startsWith("market/")) {
    return <MarketplacePage name={decodeURIComponent(sub.slice("market/".length))} onBack={back} onOpen={open} />;
  }
  if (sub) return <PluginPage id={sub} onBack={back} />;

  /** Whatever a source holds: a plugin goes to the install dialog, a marketplace gets its own page. */
  const find = async (
    kind: "link" | "folder",
    source: () => Promise<PluginSource | null>,
    cardKey?: string,
  ) => {
    if (loadingCard) return;
    if (cardKey) setLoadingCard(cardKey);
    else setFinding(kind);
    try {
      if (kind === "link" && cardKey === undefined) {
        const typed = input.trim();
        if (looksLikePluginImageUrl(typed)) {
          toast.error("That’s an image link, not a plugin", {
            description:
              "Use owner/repo or a GitHub tree path. Mobbin’s logo is already on the Recommended card — paste the repo path or tap the card.",
          });
          return;
        }
      }
      const resolved = await source();
      if (!resolved) return;
      const fetched = await fetchPlugin(resolved);
      if (fetched.plugin) {
        installer.review(fetched.plugin, {
          update: plugins.some((p) => p.id === fetched.plugin!.id),
          marketplace: fetched.marketplace?.name,
        });
      } else if (fetched.marketplace) {
        saveMarketplace(fetched.marketplace);
        open(`market/${encodeURIComponent(fetched.marketplace.name)}`);
      }
      setInput("");
    } catch (error) {
      toast.error("Couldn’t read that plugin", { description: error instanceof Error ? error.message : String(error) });
    } finally {
      setFinding(null);
      setLoadingCard(null);
    }
  };

  const findLink = (event: FormEvent) => {
    event.preventDefault();
    if (input.trim()) void find("link", () => resolvePluginSource(input.trim()));
  };

  const findFolder = () =>
    find("folder", async () => {
      const folder = await openDialog({ directory: true, multiple: false, title: "Choose a plugin or marketplace folder" });
      return typeof folder === "string" ? { kind: "folder", path: folder } : null;
    });

  const checkUpdates = async () => {
    setChecking(true);
    try {
      const found = await checkPluginUpdates();
      toast.success(found ? `${found} plugin${found === 1 ? " has an update" : "s have updates"}` : "Every plugin is up to date");
    } finally {
      setChecking(false);
    }
  };

  const suggestions = SUGGESTED_MARKETPLACES.filter(
    (s) => !marketplaces.some((m) => sourceLabel(m.source).toLowerCase() === s.input.toLowerCase()),
  );
  const pluginSuggestions = SUGGESTED_PLUGINS.filter((s) => !isSuggestedPluginInstalled(plugins, s));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Plugins"
        description="Add a set of skills, slash commands, bots, connectors and templates in one go — and turn them off or remove them together. Claude Code plugins and marketplaces work as they are."
        actions={
          plugins.some((p) => p.source.kind === "github") && (
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => void checkUpdates()} disabled={checking}>
              <RefreshCwIcon className={checking ? "size-4 animate-spin" : "size-4"} />
              Check for updates
            </Button>
          )
        }
      />

      <form onSubmit={findLink} className="flex flex-col gap-2">
        <Field
          label="Add a plugin or marketplace"
          htmlFor="plugin-source"
          hint="GitHub only: owner/repo, a tree link to a plugin folder, or Folder… — not an image URL (logos are set on the Recommended cards or under Connectors → icon)."
        >
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              id="plugin-source"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="affaan-m/ecc"
              autoComplete="off"
              spellCheck={false}
            />
            <div className="flex gap-2">
              <Button type="submit" variant="outline" disabled={!input.trim() || !!finding || !!loadingCard} className="gap-1.5">
                {finding === "link" ? <Loader className="size-4 animate-spin" /> : <SearchIcon className="size-4" />}
                Find
              </Button>
              <Button type="button" variant="outline" disabled={!!finding || !!loadingCard} onClick={() => void findFolder()} className="gap-1.5">
                {finding === "folder" ? <Loader className="size-4 animate-spin" /> : <FolderOpenIcon className="size-4" />}
                Folder…
              </Button>
            </div>
          </div>
        </Field>
        {finding === "link" && (
          <p className="text-xs text-muted-foreground">Reading the plugin — a large one can take a few seconds…</p>
        )}
      </form>

      <section className="flex flex-col gap-3">
        <SectionLabel>Installed</SectionLabel>
        {plugins.length === 0 ? (
          <EmptyState
            icon={<PuzzleIcon />}
            title="No plugins yet"
            description="Paste a repository above, or open a marketplace below to browse what’s published."
          />
        ) : (
          <TileGrid>
            {plugins.map((plugin) => (
              <PluginTile key={plugin.id} plugin={plugin} onOpen={() => open(plugin.id)} />
            ))}
          </TileGrid>
        )}
      </section>

      {pluginSuggestions.length > 0 && (
        <section className="flex flex-col gap-3">
          <SectionLabel>Recommended</SectionLabel>
          <TileGrid>
            {pluginSuggestions.map((s) => {
              const busy = loadingCard === s.input;
              return (
                <Tile
                  key={s.input}
                  busy={busy}
                  icon={<MarketplaceBrandIcon brand={s.brand} imageUrl={s.imageUrl} />}
                  title={s.label}
                  badge={<TileBadge tone="muted">Suggested</TileBadge>}
                  description={s.description}
                  meta={
                    busy ? (
                      <span className="truncate">Reading plugin…</span>
                    ) : (
                      <span className="truncate">{s.input.replace(/^.*\/tree\/[^/]+\//, "")}</span>
                    )
                  }
                  openLabel={`Install ${s.label}`}
                  onOpen={() =>
                    void find(
                      "link",
                      () => resolveSuggestedPlugin(s, resolvePluginSource, examplePluginDir),
                      s.input,
                    )
                  }
                />
              );
            })}
          </TileGrid>
        </section>
      )}

      <section className="flex flex-col gap-3">
        <SectionLabel>Marketplaces</SectionLabel>
        <TileGrid>
          {marketplaces.map((m) => (
            <Tile
              key={m.name}
              icon={
                <MarketplaceBrandIcon
                  brand={resolveMarketplaceBrand(m.source, m.name)}
                />
              }
              title={m.name}
              description={m.description || sourceLabel(m.source)}
              meta={<span className="truncate">{sourceLabel(m.source)}</span>}
              onOpen={() => open(`market/${encodeURIComponent(m.name)}`)}
            />
          ))}
          {suggestions.map((s) => {
            const busy = loadingCard === s.input;
            return (
              <Tile
                key={s.input}
                busy={busy}
                icon={<MarketplaceBrandIcon brand={s.brand} imageUrl={s.imageUrl} muted={!busy} />}
                title={s.label}
                badge={<TileBadge tone="muted">Suggested</TileBadge>}
                description={s.description}
                meta={
                  busy ? (
                    <span className="truncate">Reading marketplace…</span>
                  ) : (
                    <span className="truncate">{s.input}</span>
                  )
                }
                openLabel={`Open ${s.label}`}
                onOpen={() => void find("link", () => resolvePluginSource(s.input), s.input)}
              />
            );
          })}
        </TileGrid>
      </section>

      <footer className="text-xs leading-relaxed text-muted-foreground">
        Mali reads a plugin’s skills, commands, agents and <code className="font-mono">.mcp.json</code>, plus a{" "}
        <code className="font-mono">mali/</code> folder for templates, instructions and panels. It never runs a
        plugin’s hooks or install scripts.
      </footer>

      <InstallPluginDialog
        plugin={installer.pending?.plugin ?? null}
        installed={installer.pending?.installed}
        busy={installer.busy}
        onInstall={(choices) => void installer.install(choices)}
        onClose={installer.cancel}
      />
    </div>
  );
}

function PluginTile({ plugin, onOpen }: { plugin: InstalledPlugin; onOpen: () => void }) {
  const [busy, setBusy] = useState(false);
  const parts = [
    plugin.skills.length && `${plugin.skills.length} skill${plugin.skills.length === 1 ? "" : "s"}`,
    plugin.bots.length && `${plugin.bots.length} bot${plugin.bots.length === 1 ? "" : "s"}`,
    plugin.connectors.length && `${plugin.connectors.length} connector${plugin.connectors.length === 1 ? "" : "s"}`,
    plugin.panels.length && `${plugin.panels.length} panel${plugin.panels.length === 1 ? "" : "s"}`,
  ].filter(Boolean);
  const toggle = async (on: boolean) => {
    setBusy(true);
    try {
      await setPluginEnabled(plugin.id, on);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Tile
      icon={
        plugin.id === "mobbin" ? (
          <MarketplaceBrandIcon brand="mobbin" />
        ) : plugin.id === "google-calendar" ? (
          <MarketplaceBrandIcon brand="google" />
        ) : (
          <PuzzleIcon className={plugin.enabled ? "text-violet-500" : "text-muted-foreground"} />
        )
      }
      title={plugin.name}
      badge={plugin.version && <TileBadge tone="muted">v{plugin.version}</TileBadge>}
      description={plugin.description || sourceLabel(plugin.source)}
      meta={
        plugin.update ? (
          <Dot tone="warning">Update available</Dot>
        ) : plugin.enabled ? (
          <Dot tone="success">{parts.join(" · ") || "On"}</Dot>
        ) : (
          <Dot tone="neutral">Off</Dot>
        )
      }
      action={
        <Switch
          checked={plugin.enabled}
          disabled={busy}
          onCheckedChange={(on) => void toggle(on)}
          aria-label={plugin.enabled ? `Turn off ${plugin.name}` : `Turn on ${plugin.name}`}
        />
      }
      onOpen={onOpen}
    />
  );
}
