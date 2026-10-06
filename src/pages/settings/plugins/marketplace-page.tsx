import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import {
  fetchPlugin,
  removeMarketplace,
  sourceUrl,
  usePlugins,
  type Marketplace,
  type MarketplaceEntry,
} from "@/features/plugins";
import { openUrl } from "@tauri-apps/plugin-opener";
import { CheckIcon, ExternalLinkIcon, LoaderCircleIcon, PlusIcon, PuzzleIcon, Trash2Icon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { EmptyState, PageEnter, PageHeader, Pills, SearchField, Tile, TileBadge, TileButton, TileGrid } from "../ui";
import { InstallPluginDialog } from "./install-plugin-dialog";
import { usePluginInstall } from "./use-plugin-install";

/** One marketplace: its plugins, read fresh each time it's opened. */
export function MarketplacePage({
  name,
  onBack,
  onOpen,
}: {
  name: string;
  onBack: () => void;
  /** Open an installed plugin's page. */
  onOpen: (id: string) => void;
}) {
  const { plugins, marketplaces } = usePlugins();
  const saved = marketplaces.find((m) => m.name === name);
  const [market, setMarket] = useState<Marketplace | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [opening, setOpening] = useState<string | null>(null);
  const installer = usePluginInstall(onOpen);

  useEffect(() => {
    if (!saved) return;
    let live = true;
    setError(null);
    fetchPlugin(saved.source)
      .then((fetched) => {
        if (!live) return;
        if (fetched.marketplace) setMarket(fetched.marketplace);
        else setError("This source no longer lists plugins.");
      })
      .catch((e) => live && setError(String(e)));
    return () => {
      live = false;
    };
  }, [saved]);

  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of market?.plugins ?? []) if (p.category) counts.set(p.category, (counts.get(p.category) ?? 0) + 1);
    return [...counts].sort((a, b) => b[1] - a[1]).slice(0, 8);
  }, [market]);

  if (!saved) {
    return (
      <PageEnter>
        <PageHeader title="Marketplace not found" back={{ label: "Plugins", onClick: onBack }} />
      </PageEnter>
    );
  }

  const installedFrom = (entry: MarketplaceEntry) =>
    plugins.find((p) => p.marketplace === name && p.name.toLowerCase() === entry.name.toLowerCase());

  const install = async (entry: MarketplaceEntry) => {
    if (!entry.source) return;
    setOpening(entry.name);
    try {
      const fetched = await fetchPlugin(entry.source, entry.entry);
      if (!fetched.plugin) throw new Error("That entry doesn’t hold a plugin");
      installer.review(fetched.plugin, {
        update: plugins.some((p) => p.id === fetched.plugin!.id),
        marketplace: name,
        overlay: entry.entry,
      });
    } catch (e) {
      toast.error(`Couldn’t read ${entry.name}`, { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setOpening(null);
    }
  };

  const q = query.trim().toLowerCase();
  const shown = (market?.plugins ?? []).filter(
    (p) =>
      (category === "all" || p.category === category) &&
      (!q || `${p.name} ${p.description} ${p.keywords.join(" ")}`.toLowerCase().includes(q)),
  );
  const link = sourceUrl(saved.source);

  return (
    <PageEnter>
      <div className="flex flex-col gap-6">
        <PageHeader
          back={{ label: "Plugins", onClick: onBack }}
          title={market?.name ?? name}
          description={market?.description || saved.description}
          actions={
            <>
              {link && (
                <Button variant="outline" size="sm" className="gap-1.5" onClick={() => void openUrl(link)}>
                  <ExternalLinkIcon className="size-4" />
                  Source
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                className="gap-1.5 text-muted-foreground"
                onClick={() => {
                  removeMarketplace(name);
                  onBack();
                }}
              >
                <Trash2Icon className="size-4" />
                Remove
              </Button>
            </>
          }
        />

        {error ? (
          <EmptyState icon={<PuzzleIcon />} title="Couldn’t read the marketplace" description={error} />
        ) : !market ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <LoaderCircleIcon className="size-4 animate-spin" /> Reading {saved.name}…
          </p>
        ) : (
          <>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              {categories.length > 1 ? (
                <Pills
                  label="Categories"
                  value={category}
                  onChange={setCategory}
                  options={[
                    { value: "all", label: "All", count: market.plugins.length },
                    ...categories.map(([c, n]) => ({ value: c, label: c, count: n })),
                  ]}
                />
              ) : (
                <span />
              )}
              <SearchField value={query} onChange={setQuery} placeholder={`Search ${market.plugins.length} plugins`} />
            </div>
            <TileGrid>
              {shown.map((entry) => {
                const have = installedFrom(entry);
                return (
                  <Tile
                    key={entry.name}
                    icon={<PuzzleIcon className={have ? "text-violet-500" : "text-muted-foreground"} />}
                    title={entry.name}
                    badge={entry.version && <TileBadge tone="muted">v{entry.version}</TileBadge>}
                    description={entry.unsupported ?? entry.description}
                    meta={<span className="truncate">{[entry.author, entry.category].filter(Boolean).join(" · ")}</span>}
                    action={
                      have ? (
                        <TileButton label="Installed" active onClick={() => onOpen(have.id)}>
                          <CheckIcon />
                        </TileButton>
                      ) : entry.source ? (
                        <TileButton label={`Install ${entry.name}`} onClick={() => void install(entry)}>
                          {opening === entry.name ? <LoaderCircleIcon className="animate-spin" /> : <PlusIcon />}
                        </TileButton>
                      ) : undefined
                    }
                    onOpen={have ? () => onOpen(have.id) : entry.source ? () => void install(entry) : undefined}
                  />
                );
              })}
            </TileGrid>
            {shown.length === 0 && <p className="text-center text-sm text-muted-foreground">Nothing matches.</p>}
          </>
        )}
      </div>

      <InstallPluginDialog
        plugin={installer.pending?.plugin ?? null}
        installed={installer.pending?.installed}
        busy={installer.busy}
        onInstall={(choices) => void installer.install(choices)}
        onClose={installer.cancel}
      />
    </PageEnter>
  );
}
