import { Button } from "@/components/ui/button";
import {
  getRegistryServers,
  installedFromRegistry,
  registryPublisher,
  requestConnectorInstall,
  searchRegistry,
  useCustomMcps,
  useMcpConnections,
  useMcpLive,
  type ConnectorSuggestion,
  type RegistryServer,
} from "@/features/mcp";
import { RegistryIcon } from "@/pages/settings/mcp/connector-icon";
import { CheckIcon, LoaderIcon, SearchIcon, ShieldCheckIcon } from "lucide-react";
import { useEffect, useState } from "react";

/** A remote endpoint the AI found outside the registry, shaped like a registry entry. */
function fromUrl(url: string, title?: string): RegistryServer {
  const host = new URL(url).host;
  return {
    name: `external/${host}`,
    title: title || host,
    description: `Remote MCP server at ${host}. Not listed in the MCP Registry — make sure it’s the vendor’s official endpoint.`,
    version: "",
    icons: [`https://${host.replace(/^(mcp|api)\./, "")}/favicon.ico`],
    packages: [],
    remotes: [{ type: "streamable-http", url }],
  };
}

async function resolve(suggestion: ConnectorSuggestion): Promise<RegistryServer[]> {
  if (suggestion.url) return [fromUrl(suggestion.url, suggestion.title)];
  if (suggestion.name) {
    const [server] = await getRegistryServers([suggestion.name]);
    if (server) return [server];
  }
  const query = suggestion.query ?? suggestion.name?.split("/").pop() ?? "";
  return (await searchRegistry(query, null, 3)).servers;
}

/** Install cards for the connectors the AI suggested. Nothing installs until the user confirms. */
export function ConnectorSuggestions({ suggestions }: { suggestions: ConnectorSuggestion[] }) {
  return (
    <div className="mt-3 flex flex-col gap-2">
      {suggestions.map((s, i) => (
        <SuggestionCard key={`${s.name ?? s.query ?? s.url}-${i}`} suggestion={s} />
      ))}
    </div>
  );
}

function SuggestionCard({ suggestion }: { suggestion: ConnectorSuggestion }) {
  const [servers, setServers] = useState<RegistryServer[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The reply re-renders while it streams; look the suggestion up once.
  const key = JSON.stringify(suggestion);

  useEffect(() => {
    let live = true;
    resolve(JSON.parse(key) as ConnectorSuggestion)
      .then((list) => live && setServers(list))
      .catch((e) => live && setError(String(e)));
    return () => {
      live = false;
    };
  }, [key]);

  return (
    <div className="flex max-w-xl flex-col overflow-hidden rounded-xl border border-border/70 bg-card">
      <p className="flex items-center gap-1.5 border-b border-border/60 px-3 py-2 text-xs text-muted-foreground">
        <ShieldCheckIcon className="size-3.5" />
        Connector · you review and confirm before anything is installed
      </p>
      {error && <p className="px-3 py-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
      {!servers && !error && (
        <p className="flex items-center gap-2 px-3 py-3 text-sm text-muted-foreground">
          <LoaderIcon className="size-4 animate-spin" /> Looking it up in the MCP Registry…
        </p>
      )}
      {servers?.length === 0 && (
        <p className="px-3 py-3 text-sm text-muted-foreground">
          Nothing found for “{suggestion.query ?? suggestion.name}”.
        </p>
      )}
      {servers && servers.length > 0 && (
        <ul className="flex flex-col divide-y divide-border/50">
          {servers.map((server) => (
            <ServerRow key={server.name} server={server} />
          ))}
        </ul>
      )}
      {suggestion.query && servers && servers.length > 0 && (
        <button
          type="button"
          onClick={() => requestConnectorInstall({ query: suggestion.query, fromChat: true })}
          className="flex items-center gap-1.5 border-t border-border/60 px-3 py-2 text-left text-xs text-muted-foreground hover:bg-muted/40 hover:text-foreground"
        >
          <SearchIcon className="size-3.5" />
          More results for “{suggestion.query}”
        </button>
      )}
    </div>
  );
}

function ServerRow({ server }: { server: RegistryServer }) {
  const custom = useCustomMcps();
  const connections = useMcpConnections();
  const live = useMcpLive();
  const installed = installedFromRegistry(server.name, custom);
  const connected = installed && connections[installed.id]?.enabled && live[installed.id]?.status !== "needs_auth";

  return (
    <li className="flex min-w-0 items-center gap-3 px-3 py-2.5">
      <RegistryIcon icons={server.icons} size={32} />
      <div className="min-w-0 flex-1">
        <p className="flex min-w-0 items-baseline gap-2">
          <span className="truncate text-sm font-medium">{server.title}</span>
          <span className="truncate font-mono text-[11px] text-muted-foreground/70">
            {registryPublisher(server.name)}
          </span>
        </p>
        <p className="line-clamp-2 text-xs text-muted-foreground">{server.description}</p>
      </div>
      {connected ? (
        <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
          <CheckIcon className="size-3.5" /> Connected
        </span>
      ) : (
        <Button
          type="button"
          size="sm"
          className="shrink-0"
          onClick={() => requestConnectorInstall({ server, fromChat: true })}
        >
          {installed ? "Connect" : "Install"}
        </Button>
      )}
    </li>
  );
}
