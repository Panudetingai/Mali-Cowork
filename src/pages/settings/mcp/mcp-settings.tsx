import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/animate-ui/primitives/radix/dropdown-menu";
import { toastFailure } from "@/components/ui/sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  diagnoseMcpBinaries,
  exportMcpServers,
  installedFromRegistry,
  MCP_SERVERS,
  cancelSignIn,
  missingEnv,
  oauthLimitFor,
  requestConnectorInstall,
  uvInstallCommand,
  type CustomMcp,
  type McpDef,
  type McpDiagnoseResult,
  type McpServerStatus,
} from "@/features/mcp";
import { cn } from "@/lib/utils";
import SandboxCard from "./sandbox-card";
import {
  CheckIcon,
  CircleAlertIcon,
  CompassIcon,
  FileOutputIcon,
  LoaderIcon,
  LogInIcon,
  LogOutIcon,
  MoreHorizontalIcon,
  PlusIcon,
  PowerOffIcon,
  RefreshCwIcon,
  SearchIcon,
  Settings2Icon,
  SquareTerminalIcon,
  Trash2Icon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { isSmitheryInstall } from "@/features/smithery";
import { SourceBadge } from "../smithery-card";
import { CopyCommand, Notice } from "../ui";
import { ConnectorIcon, RegistryIcon } from "./connector-icon";
import { CustomMcpDialog, type CustomDialogTarget } from "./custom-mcp-dialog";
import { DiscoverView, FilterPills, useFeaturedServers } from "./discover-view";
import { McpDetailsDialog, type McpDetailsTarget } from "./mcp-details-dialog";
import { cardState, useMcpManager } from "./use-mcp-manager";

type Tab = "yours" | "discover";
type Filter = "all" | "connected" | "not";

/** One row of "Your connectors": a built-in server or one the user added. */
type Row = {
  id: string;
  name: string;
  description: string;
  kind: "local" | "remote";
  builtin?: McpDef;
  custom?: CustomMcp;
};

const menuItemClass =
  "flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none select-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground";
const menuClass = "z-50 min-w-44 rounded-xl border bg-popover p-1 text-popover-foreground shadow-lg";

export function McpSettings() {
  const mcp = useMcpManager();
  const { connections, custom, live, busyMap, available } = mcp;
  const [tab, setTab] = useState<Tab>("yours");
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [details, setDetails] = useState<McpDetailsTarget | null>(null);
  const [customTarget, setCustomTarget] = useState<CustomDialogTarget | null>(null);
  const [diagnose, setDiagnose] = useState<McpDiagnoseResult | null>(null);
  const [checking, setChecking] = useState(false);
  const featured = useFeaturedServers();
  const [exported, setExported] = useState<number | null>(null);

  const runDiagnose = useCallback(async () => {
    setChecking(true);
    try {
      setDiagnose(await diagnoseMcpBinaries());
    } catch {
      setDiagnose(null);
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    void runDiagnose();
  }, [runDiagnose]);

  const rows: Row[] = useMemo(
    () => [
      ...custom.map((c) => ({ id: c.id, name: c.name, description: c.description ?? "", kind: c.kind, custom: c })),
      ...MCP_SERVERS.map((s) => ({ id: s.id, name: s.name, description: s.description, kind: "local" as const, builtin: s })),
    ],
    [custom],
  );

  const isConnected = (id: string) => !!connections[id]?.enabled;
  const q = query.trim().toLowerCase();
  const shown = rows.filter(
    (r) =>
      (filter === "all" || (filter === "connected") === isConnected(r.id)) &&
      (!q || [r.name, r.description, r.custom?.registry?.name ?? ""].some((t) => t.toLowerCase().includes(q))),
  );
  // Enabled first, then the user's own, then built-ins.
  shown.sort((a, b) => Number(isConnected(b.id)) - Number(isConnected(a.id)));

  const popular = (featured ?? []).filter((s) => !installedFromRegistry(s.name, custom)).slice(0, 6);

  const missingBins = diagnose?.binaries.filter((b) => !b.found).map((b) => b.binary) ?? [];
  const uvMissing = missingBins.includes("uvx");
  const nodeMissing = missingBins.includes("npx");

  const detailsId = details?.server.id;
  const customId = customTarget?.mode === "edit" ? customTarget.server.id : undefined;
  const stateFor = (id: string, needsSetup = false) =>
    cardState({ enabled: isConnected(id), busy: !!busyMap[id], live: live[id], available, needsSetup });

  const open = (row: Row) => {
    if (row.custom) setCustomTarget({ mode: "edit", server: row.custom });
    else if (row.builtin) setDetails({ server: row.builtin });
  };

  const connect = (row: Row) => {
    if (row.builtin && missingEnv(row.builtin, connections[row.id]).length > 0) {
      setDetails({ server: row.builtin, connectOnSave: true });
      return;
    }
    void mcp.apply(row.id, { enabled: true });
  };

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-center gap-3">
        <h2 className="mr-auto text-2xl font-semibold tracking-tight sm:mr-0">Connectors</h2>
        <div className="relative order-last w-full sm:order-none sm:mx-auto sm:max-w-sm sm:flex-1">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setQuery("")}
            placeholder={tab === "discover" ? "Search the MCP Registry" : "Search connectors"}
            aria-label="Search connectors"
            className="h-9 rounded-lg pl-8"
          />
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" size="sm" className="gap-1.5">
              <PlusIcon className="size-4" />
              Add
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" sideOffset={6} className={menuClass}>
            <DropdownMenuItem className={menuItemClass} onSelect={() => setTab("discover")}>
              <CompassIcon className="size-4 text-muted-foreground" />
              Browse the MCP Registry
            </DropdownMenuItem>
            <DropdownMenuItem className={menuItemClass} onSelect={() => setCustomTarget({ mode: "create" })}>
              <SquareTerminalIcon className="size-4 text-muted-foreground" />
              Custom connector (command or URL)
            </DropdownMenuItem>
            <DropdownMenuSeparator className="-mx-1 my-1 h-px bg-border" />
            <DropdownMenuItem
              className={menuItemClass}
              onSelect={() =>
                void exportMcpServers()
                  .then((count) => count !== null && setExported(count))
                  .catch((e) => toastFailure("Couldn't export", e))
              }
            >
              <FileOutputIcon className="size-4 text-muted-foreground" />
              Export for other apps (.mcp.json)
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      <FilterPills
        value={tab}
        onChange={setTab}
        options={[
          ["yours", "Your connectors"],
          ["discover", "Discover"],
        ]}
      />

      {!mcp.opencode.loading && !available && (
        <Notice tone="warning" title="OpenCode isn’t ready">
          Connectors run through OpenCode. Install it with <code className="font-mono">npm i -g opencode-ai</code>, then
          restart the app (see the Agents tab).
        </Notice>
      )}
      {exported !== null && (
        <Notice title={`Exported ${exported} connector${exported === 1 ? "" : "s"}`} onDismiss={() => setExported(null)}>
          Works with Claude Code (<code className="font-mono">.mcp.json</code> in a project), Claude Desktop, VS Code and
          other MCP apps. Keys aren’t included: set the <code className="font-mono">${"{NAME}"}</code> variables or fill
          in the headers there.
        </Notice>
      )}
      {(uvMissing || nodeMissing) && (
        <Notice
          tone="info"
          title="Some connectors need a runtime"
          action={
            <div className="flex flex-col gap-2">
              {uvMissing && <CopyCommand command={uvInstallCommand(diagnose?.platform ?? null)} className="max-w-xl" />}
              {nodeMissing && (
                <p className="text-xs">
                  Install Node.js from <span className="font-medium">nodejs.org</span> for npx servers.
                </p>
              )}
            </div>
          }
        >
          {uvMissing && "Word and PyPI servers need uv (uvx). "}
          {nodeMissing && "Most servers need Node.js (npx). "}
          Install, then restart the app.
        </Notice>
      )}

      {tab === "discover" ? (
        <DiscoverView query={query} />
      ) : (
        <>
          <FilterPills
            value={filter}
            onChange={setFilter}
            options={[
              ["all", "All"],
              ["connected", "Connected"],
              ["not", "Not connected"],
            ]}
          />

          <div className="flex flex-col">
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-border/60 px-3 pb-2 text-sm text-muted-foreground sm:grid-cols-[minmax(0,1fr)_9rem_9rem]">
              <span>Connector</span>
              <span className="hidden sm:block">Type</span>
              <span className="w-24 sm:w-auto">Status</span>
            </div>
            {shown.length === 0 ? (
              <p className="px-3 py-8 text-center text-sm text-muted-foreground">
                {q ? `No connectors match “${query.trim()}”.` : "Nothing here yet."}
              </p>
            ) : (
              <ul className="flex flex-col">
                {shown.map((row) => (
                  <ConnectorRow
                    key={row.id}
                    row={row}
                    enabled={isConnected(row.id)}
                    live={live[row.id]}
                    busy={busyMap[row.id]}
                    available={available}
                    onOpen={() => open(row)}
                    onConnect={() => connect(row)}
                    onDisconnect={() => void mcp.apply(row.id, { enabled: false })}
                    onSignIn={() => void mcp.signIn(row.id)}
                    onSignOut={() => void mcp.signOut(row.id)}
                    onRemove={row.custom ? () => void mcp.removeCustom(row.id) : undefined}
                  />
                ))}
              </ul>
            )}
          </div>

          {popular.length > 0 && !q && (
            <section className="flex flex-col gap-3">
              <h3 className="text-sm text-muted-foreground">Popular</h3>
              <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {popular.map((server) => (
                  <li
                    key={server.name}
                    className="flex min-w-0 items-center gap-3 rounded-xl border border-border/70 p-2.5 pl-3"
                  >
                    <RegistryIcon icons={server.icons} size={26} />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium" title={server.description}>
                      {server.title}
                    </span>
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      onClick={() => requestConnectorInstall({ server })}
                    >
                      Connect
                    </Button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <SandboxCard />

          <footer className="flex flex-col gap-2 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
            <p>
              Shared with OpenCode, Codex, and — when installed — Antigravity CLI (
              <code className="font-mono">~/.gemini/config/mcp_config.json</code>) and Cursor (
              <code className="font-mono">~/.cursor/mcp.json</code>); servers you added there yourself are kept. Keys live
              in your system keychain; sign-in happens as Mali Cowork and tokens stay on this device.
            </p>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="gap-1.5 self-start text-muted-foreground sm:self-auto"
              disabled={checking}
              onClick={() => {
                void runDiagnose();
                void mcp.refreshLive();
              }}
            >
              <RefreshCwIcon className={cn("size-3.5", checking && "animate-spin")} />
              Check again
            </Button>
          </footer>
        </>
      )}

      <McpDetailsDialog
        target={details}
        conn={detailsId ? connections[detailsId] : undefined}
        live={detailsId ? live[detailsId] : undefined}
        state={detailsId ? stateFor(detailsId) : { tone: "neutral", label: "" }}
        busy={detailsId ? !!busyMap[detailsId] : false}
        available={available}
        onClose={() => setDetails(null)}
        onApply={mcp.apply}
      />
      <CustomMcpDialog
        target={customTarget}
        conn={customId ? connections[customId] : undefined}
        live={customId ? live[customId] : undefined}
        state={customId ? stateFor(customId) : undefined}
        busy={customId ? !!busyMap[customId] : Object.keys(busyMap).length > 0}
        available={available}
        onClose={() => setCustomTarget(null)}
        onApply={mcp.apply}
        onDelete={mcp.removeCustom}
      />
    </div>
  );
}

function ConnectorRow({
  row,
  enabled,
  live,
  busy,
  available,
  onOpen,
  onConnect,
  onDisconnect,
  onSignIn,
  onSignOut,
  onRemove,
}: {
  row: Row;
  enabled: boolean;
  live?: McpServerStatus;
  busy?: "connecting" | "disconnecting" | "signing-in";
  available: boolean;
  onOpen: () => void;
  onConnect: () => void;
  onDisconnect: () => void;
  onSignIn: () => void;
  onSignOut: () => void;
  onRemove?: () => void;
}) {
  const stop = (fn: () => void) => (e: { stopPropagation: () => void }) => {
    e.stopPropagation();
    fn();
  };
  const needsAuth = enabled && (live?.status === "needs_auth" || live?.status === "needs_client_registration");
  // Vendors that only allow approved apps to sign in (e.g. Figma's remote server).
  const limit = row.kind === "remote" ? oauthLimitFor(row.custom?.url) : undefined;

  let status: ReactNode;
  if (busy === "signing-in") {
    status = (
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <LoaderIcon className="size-3.5 animate-spin" />
        <button type="button" onClick={stop(() => cancelSignIn(row.id))} className="hover:text-foreground hover:underline">
          Cancel
        </button>
      </span>
    );
  } else if (busy) {
    status = (
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <LoaderIcon className="size-3.5 animate-spin" />
        {busy === "disconnecting" ? "Stopping…" : "Connecting…"}
      </span>
    );
  } else if (needsAuth && limit) {
    status = (
      <button
        type="button"
        onClick={stop(onOpen)}
        title={limit.reason}
        className="flex items-center gap-1.5 text-xs text-amber-700 hover:underline dark:text-amber-400"
      >
        <CircleAlertIcon className="size-3.5" />
        Can’t sign in
      </button>
    );
  } else if (!enabled) {
    status = (
      <Button type="button" size="sm" variant="secondary" disabled={!available} onClick={stop(onConnect)}>
        Connect
      </Button>
    );
  } else if (needsAuth) {
    status = (
      <Button type="button" size="sm" variant="secondary" className="gap-1.5" onClick={stop(onSignIn)}>
        <LogInIcon className="size-3.5" />
        Sign in
      </Button>
    );
  } else if (live?.status === "failed") {
    status = (
      <button
        type="button"
        onClick={stop(onOpen)}
        title={live.error ?? "Couldn’t connect"}
        className="flex items-center gap-1.5 text-xs text-red-600 hover:underline dark:text-red-400"
      >
        <CircleAlertIcon className="size-3.5" />
        Failed
      </button>
    );
  } else {
    status = (
      <span
        className="flex items-center"
        title={live?.status === "connected" ? "Connected" : "On — starts with the next prompt"}
      >
        <CheckIcon className={cn("size-4", live?.status === "connected" ? "text-foreground" : "text-muted-foreground")} />
      </span>
    );
  }

  // Where it came from, which is not always the official registry any more.
  const badge = row.custom
    ? isSmitheryInstall(row.custom)
      ? <SourceBadge source="smithery" />
      : row.custom.registry
        ? <SourceBadge source="registry" />
        : <span className="rounded-md bg-muted px-1.5 py-0.5 text-[11px]">Custom</span>
    : null;

  return (
    <li
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => e.key === "Enter" && onOpen()}
      className="group grid cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-lg border-b border-border/40 px-3 py-2.5 transition-colors hover:bg-muted/50 sm:grid-cols-[minmax(0,1fr)_9rem_9rem]"
    >
      <span className="flex min-w-0 items-center gap-3">
        <ConnectorIcon server={row.builtin} custom={row.custom} size={26} />
        <span className="truncate text-sm font-medium" title={row.description}>
          {row.name}
        </span>
      </span>
      <span className="hidden items-center gap-2 text-sm text-muted-foreground sm:flex">
        {row.kind === "remote" ? "Web" : "Local"}
        {badge}
      </span>
      <span className="flex w-24 items-center justify-between gap-1 sm:w-auto">
        {status}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={`Options for ${row.name}`}
              onClick={(e) => e.stopPropagation()}
              className="flex size-7 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:bg-muted hover:text-foreground focus-visible:opacity-100 data-[state=open]:opacity-100"
            >
              <MoreHorizontalIcon className="size-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" sideOffset={6} className={menuClass} onClick={(e) => e.stopPropagation()}>
            <DropdownMenuItem className={menuItemClass} onSelect={onOpen}>
              <Settings2Icon className="size-4 text-muted-foreground" />
              Settings
            </DropdownMenuItem>
            {enabled && row.kind === "remote" && (
              <DropdownMenuItem className={menuItemClass} onSelect={needsAuth ? (limit ? onOpen : onSignIn) : onSignOut}>
                {needsAuth ? (
                  <LogInIcon className="size-4 text-muted-foreground" />
                ) : (
                  <LogOutIcon className="size-4 text-muted-foreground" />
                )}
                {needsAuth ? "Sign in" : "Sign out"}
              </DropdownMenuItem>
            )}
            {enabled && (
              <DropdownMenuItem className={menuItemClass} onSelect={onDisconnect}>
                <PowerOffIcon className="size-4 text-muted-foreground" />
                Disconnect
              </DropdownMenuItem>
            )}
            {onRemove && (
              <>
                <DropdownMenuSeparator className="-mx-1 my-1 h-px bg-border" />
                <DropdownMenuItem
                  className={cn(menuItemClass, "text-destructive data-highlighted:text-destructive")}
                  onSelect={onRemove}
                >
                  <Trash2Icon className="size-4" />
                  Remove
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </span>
    </li>
  );
}
