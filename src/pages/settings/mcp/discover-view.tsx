import { Button } from "@/components/ui/button";
import {
  FEATURED_REGISTRY,
  getRegistryServers,
  installedFromRegistry,
  registryPublisher,
  requestConnectorInstall,
  searchRegistry,
  useCustomMcps,
  type RegistryServer,
} from "@/features/mcp";
import { cn } from "@/lib/utils";
import { useDebouncedValue } from "@/pages/chat/hooks/use-debounced-value";
import { CheckIcon, LoaderIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Notice } from "../ui";
import { RegistryIcon } from "./connector-icon";

type Kind = "all" | "remote" | "local";

let featuredCache: Promise<RegistryServer[]> | undefined;

/** Well-known services from the registry, fetched once per app session. */
export function useFeaturedServers() {
  const [servers, setServers] = useState<RegistryServer[] | null>(null);
  useEffect(() => {
    featuredCache ??= getRegistryServers(FEATURED_REGISTRY).catch((e) => {
      featuredCache = undefined;
      throw e;
    });
    let live = true;
    featuredCache
      .then((list) => {
        const order = new Map(FEATURED_REGISTRY.map((name, i) => [name, i]));
        if (live) setServers([...list].sort((a, b) => (order.get(a.name) ?? 0) - (order.get(b.name) ?? 0)));
      })
      .catch(() => live && setServers([]));
    return () => {
      live = false;
    };
  }, []);
  return servers;
}

function methods(server: RegistryServer) {
  const labels = new Set<string>();
  if (server.remotes.length) labels.add("Web");
  for (const p of server.packages) labels.add(p.registryType === "npm" ? "npm" : p.registryType === "pypi" ? "PyPI" : "Docker");
  return [...labels];
}

function matchesKind(server: RegistryServer, kind: Kind) {
  if (kind === "remote") return server.remotes.length > 0;
  if (kind === "local") return server.packages.length > 0;
  return server.remotes.length + server.packages.length > 0;
}

/** Browse and search the official MCP Registry. */
export function DiscoverView({ query }: { query: string }) {
  const [kind, setKind] = useState<Kind>("all");
  const search = useDebouncedValue(query.trim(), 350, true);
  const featured = useFeaturedServers();
  const [servers, setServers] = useState<RegistryServer[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setLoading(true);
    setError(null);
    searchRegistry(search, null, 40)
      .then((page) => {
        if (!live) return;
        setServers(page.servers);
        setCursor(page.nextCursor ?? null);
      })
      .catch((e) => live && setError(String(e)))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [search]);

  const loadMore = async () => {
    if (!cursor) return;
    setLoading(true);
    try {
      const page = await searchRegistry(search, cursor, 40);
      setServers((prev) => [...prev, ...page.servers.filter((s) => !prev.some((p) => p.name === s.name))]);
      setCursor(page.nextCursor ?? null);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const shown = servers.filter((s) => matchesKind(s, kind));
  const showFeatured = !search && featured && featured.length > 0;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <FilterPills
          value={kind}
          onChange={setKind}
          options={[
            ["all", "All"],
            ["remote", "Web"],
            ["local", "On this computer"],
          ]}
        />
        <p className="text-xs text-muted-foreground">
          From the official{" "}
          <span className="font-medium text-foreground/80">MCP Registry</span> · anyone can publish, check the publisher
        </p>
      </div>

      {error && <Notice tone="danger">{error}</Notice>}

      {showFeatured && (
        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-medium text-muted-foreground">Featured</h3>
          <ServerList servers={featured.filter((s) => matchesKind(s, kind))} />
        </section>
      )}

      <section className="flex flex-col gap-2">
        {showFeatured && <h3 className="text-sm font-medium text-muted-foreground">All servers</h3>}
        {shown.length > 0 ? (
          <ServerList servers={shown} />
        ) : (
          !loading && (
            <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
              {search ? `Nothing in the registry matches “${search}”.` : "No servers to show."}
            </p>
          )
        )}
        {loading && (
          <p className="flex items-center justify-center gap-2 py-3 text-sm text-muted-foreground">
            <LoaderIcon className="size-4 animate-spin" /> Loading…
          </p>
        )}
        {cursor && !loading && (
          <Button type="button" variant="ghost" size="sm" className="self-center" onClick={() => void loadMore()}>
            Load more
          </Button>
        )}
      </section>
    </div>
  );
}

function ServerList({ servers }: { servers: RegistryServer[] }) {
  const custom = useCustomMcps();
  return (
    <ul className="flex flex-col divide-y divide-border/50 overflow-hidden rounded-xl border border-border/60">
      {servers.map((server) => {
        const installed = !!installedFromRegistry(server.name, custom);
        return (
          <li key={server.name}>
            <div
              role="button"
              tabIndex={0}
              onClick={() => requestConnectorInstall({ server })}
              onKeyDown={(e) => e.key === "Enter" && requestConnectorInstall({ server })}
              className="flex min-w-0 cursor-pointer items-center gap-3 px-3 py-2.5 transition-colors hover:bg-muted/40"
            >
              <RegistryIcon icons={server.icons} size={32} />
              <div className="min-w-0 flex-1">
                <p className="flex min-w-0 items-center gap-2">
                  <span className="truncate text-sm font-medium">{server.title}</span>
                  <span className="hidden truncate font-mono text-[11px] text-muted-foreground/70 sm:inline">
                    {registryPublisher(server.name)}
                  </span>
                </p>
                <p className="line-clamp-1 text-xs text-muted-foreground">{server.description}</p>
              </div>
              <div className="hidden shrink-0 gap-1 md:flex">
                {methods(server).map((m) => (
                  <span key={m} className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                    {m}
                  </span>
                ))}
              </div>
              {installed ? (
                <span className="flex w-20 shrink-0 items-center justify-end gap-1 text-xs text-muted-foreground">
                  <CheckIcon className="size-3.5" /> Added
                </span>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  className="w-20 shrink-0"
                  onClick={(e) => {
                    e.stopPropagation();
                    requestConnectorInstall({ server });
                  }}
                >
                  Install
                </Button>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function FilterPills<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (value: T) => void;
  options: [T, string][];
}) {
  return (
    <div className="flex flex-wrap gap-1" role="tablist">
      {options.map(([id, label]) => (
        <button
          key={id}
          type="button"
          role="tab"
          aria-selected={value === id}
          onClick={() => onChange(id)}
          className={cn(
            "h-8 rounded-lg px-3 text-sm transition-colors",
            value === id ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
