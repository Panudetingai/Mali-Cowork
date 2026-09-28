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
import {
  asRegistryServer,
  searchSmitheryServers,
  smitheryRegistryName,
  smitheryServerDetail,
  useSmitheryReady,
  type SmitheryServer,
} from "@/features/smithery";
import { cn } from "@/lib/utils";
import { useDebouncedValue } from "@/pages/chat/hooks/use-debounced-value";
import { CheckIcon, LoaderCircleIcon, LoaderIcon, PlugZapIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { SmitheryCard, SourceBadge } from "../smithery-card";
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
  const [stale, setStale] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const [fromSmithery, setFromSmithery] = useState<SmitheryServer[]>([]);
  const [smitheryError, setSmitheryError] = useState<string | null>(null);
  const smitheryOn = useSmitheryReady();

  // Its own catalogue, its own key, its own failures — a Smithery outage
  // must not empty the official registry's results.
  useEffect(() => {
    let live = true;
    if (!smitheryOn) {
      setFromSmithery([]);
      setSmitheryError(null);
      return;
    }
    searchSmitheryServers(search)
      .then((page) => {
        if (!live) return;
        setFromSmithery(page.items);
        setSmitheryError(null);
      })
      .catch((e) => {
        if (!live) return;
        setFromSmithery([]);
        // Say why rather than quietly showing nothing.
        setSmitheryError(String(e));
      });
    return () => {
      live = false;
    };
  }, [search, smitheryOn]);

  useEffect(() => {
    let live = true;
    setLoading(true);
    setError(null);
    searchRegistry(search, null, 40)
      .then((page) => {
        if (!live) return;
        setServers(page.servers);
        setCursor(page.nextCursor ?? null);
        setStale(Boolean(page.stale));
      })
      // Keep whatever is on screen; the notice says the list may be out of date.
      .catch((e) => live && setError(String(e)))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [search, retryKey]);

  const loadMore = async () => {
    if (!cursor) return;
    setLoading(true);
    try {
      const page = await searchRegistry(search, cursor, 40);
      setServers((prev) => [...prev, ...page.servers.filter((s) => !prev.some((p) => p.name === s.name))]);
      setCursor(page.nextCursor ?? null);
      setStale(Boolean(page.stale));
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const retry = (
    <Button type="button" variant="outline" size="sm" disabled={loading} onClick={() => setRetryKey((k) => k + 1)}>
      Try again
    </Button>
  );

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

      <SmitheryCard what="connectors" />

      {error ? (
        <Notice tone="warning" title="MCP Registry is slow to respond" action={retry} onDismiss={() => setError(null)}>
          {error}
        </Notice>
      ) : (
        stale &&
        !loading && (
          <Notice tone="info" title="Showing saved results" action={retry}>
            The MCP Registry isn’t responding, so these come from an earlier visit and may be incomplete.
          </Notice>
        )
      )}
      {smitheryError && (
        <Notice tone="warning" title="Couldn’t search Smithery" onDismiss={() => setSmitheryError(null)}>
          {smitheryError} The MCP Registry below is unaffected.
        </Notice>
      )}

      {fromSmithery.length > 0 && (
        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-medium text-muted-foreground">
            {search ? `On Smithery` : "Popular on Smithery"}
          </h3>
          <ul className="flex flex-col divide-y divide-border/50 overflow-hidden rounded-xl border border-border/60">
            {fromSmithery.map((server) => (
              <SmitheryServerRow key={server.qualifiedName} server={server} />
            ))}
          </ul>
        </section>
      )}

      {showFeatured && (
        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-medium text-muted-foreground">Featured</h3>
          <ServerList servers={featured.filter((s) => matchesKind(s, kind))} />
        </section>
      )}

      <section className="flex flex-col gap-2">
        {(showFeatured || fromSmithery.length > 0) && (
          <h3 className="text-sm font-medium text-muted-foreground">MCP Registry</h3>
        )}
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

/**
 * One MCP server from Smithery.
 *
 * Smithery only lists what a server is until you ask for it, so Install
 * fetches its connection details, then hands it to the same dialog the
 * official registry uses — same URL checks, same settings form, and the same
 * editable connector afterwards.
 */
function SmitheryServerRow({ server }: { server: SmitheryServer }) {
  const custom = useCustomMcps();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const installed = !!installedFromRegistry(smitheryRegistryName(server.qualifiedName), custom);

  const install = async () => {
    setBusy(true);
    setError(null);
    try {
      requestConnectorInstall({ server: asRegistryServer(await smitheryServerDetail(server.qualifiedName)) });
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="flex min-w-0 flex-col">
      <div className="flex min-w-0 items-center gap-3 px-3 py-2.5">
        <RegistryIcon icons={server.iconUrl ? [server.iconUrl] : []} size={32} />
        <div className="min-w-0 flex-1">
          <p className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-medium">{server.name}</span>
            <SourceBadge source="smithery" />
            {server.verified && (
              <span className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                Verified
              </span>
            )}
            <span className="hidden truncate font-mono text-[11px] text-muted-foreground/70 sm:inline">
              {server.qualifiedName}
            </span>
          </p>
          <p className="line-clamp-1 text-xs text-muted-foreground">
            {server.description || "No description"}
          </p>
        </div>
        <span className="hidden shrink-0 items-center gap-1 text-[11px] text-muted-foreground md:flex">
          <PlugZapIcon className="size-3" />
          Web
        </span>
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
            disabled={busy}
            onClick={() => void install()}
          >
            {busy ? <LoaderCircleIcon className="size-3.5 animate-spin" /> : "Install"}
          </Button>
        )}
      </div>
      {error && (
        <div className="px-3 pb-2.5">
          <Notice tone="danger" onDismiss={() => setError(null)}>
            {error}
          </Notice>
        </div>
      )}
    </li>
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
