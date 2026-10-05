import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/animate-ui/primitives/radix/dropdown-menu";
import { toastFailure } from "@/components/ui/sonner";
import { Button } from "@/components/ui/button";
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
  type McpCategory,
  type McpDef,
  type McpDiagnoseResult,
  type McpServerStatus,
} from "@/features/mcp";
import { cn } from "@/lib/utils";
import SandboxCard from "./sandbox-card";
import {
  CompassIcon,
  FileOutputIcon,
  LoaderIcon,
  LogInIcon,
  LogOutIcon,
  MoreHorizontalIcon,
  PlusIcon,
  PowerOffIcon,
  RefreshCwIcon,
  Settings2Icon,
  SquareTerminalIcon,
  Trash2Icon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { isSmitheryInstall } from "@/features/smithery";
import { SourceBadge } from "../smithery-card";
import { useSettingsSub } from "../route";
import { CopyCommand, Notice, PageEnter, PageHeader, Pills, SearchField } from "../ui";
import { ConnectorIcon, RegistryIcon } from "./connector-icon";
import { CustomMcpPage } from "./custom-mcp-page";
import { DiscoverView, useFeaturedServers } from "./discover-view";
import { McpDetailsPage } from "./mcp-details-page";
import { cardState, useMcpManager } from "./use-mcp-manager";

/** One connection: a built-in server or one the user added. */
type Row = {
  id: string;
  name: string;
  description: string;
  kind: "local" | "remote";
  group: Group;
  builtin?: McpDef;
  custom?: CustomMcp;
};

type Group = Exclude<McpCategory, "Custom"> | "yours";
type Filter = "all" | "connected" | Group;

/** The catalog's categories, in the order they're listed. */
const GROUPS: { id: Group; label: string }[] = [
  { id: "yours", label: "Added by you" },
  { id: "Documents", label: "Documents" },
  { id: "Dev", label: "Development" },
  { id: "Web", label: "Web" },
  { id: "Data", label: "Data" },
  { id: "Execute", label: "Run code" },
  { id: "Memory", label: "Memory & thinking" },
];

const menuItemClass =
  "flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none select-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground";
const menuClass = "z-50 min-w-44 rounded-xl border bg-popover p-1 text-popover-foreground shadow-lg";

/**
 * Settings → Connectors, laid out like an App Connections page: category chips,
 * one titled group per category with a "+", and a row per connector with
 * its status and Config. Config opens the connector's setup page
 * (`/settings/mcp/<id>`), laid out like a model provider's; Discover and
 * "add your own" are pages too (`/settings/mcp/discover`, `/settings/mcp/new`).
 */
export function McpSettings() {
  const mcp = useMcpManager();
  const { connections, custom, live, busyMap, available } = mcp;
  const { sub, open, back } = useSettingsSub();
  const [params] = useSearchParams();

  const stateFor = (id: string) =>
    cardState({ enabled: !!connections[id]?.enabled, busy: !!busyMap[id], live: live[id], available, needsSetup: false });

  if (sub === "discover") {
    return (
      <PageEnter key="discover">
        <DiscoverPage initialQuery={params.get("q") ?? ""} onBack={back} />
      </PageEnter>
    );
  }
  if (sub === "new") {
    return (
      <PageEnter key="new">
        <CustomMcpPage
          busy={Object.keys(busyMap).length > 0}
          available={available}
          onDone={back}
          onApply={mcp.apply}
          onDelete={mcp.removeCustom}
        />
      </PageEnter>
    );
  }
  if (sub) {
    const builtin = MCP_SERVERS.find((s) => s.id === sub);
    const own = custom.find((c) => c.id === sub);
    if (builtin) {
      return (
        <PageEnter key={sub}>
          <McpDetailsPage
            server={builtin}
            conn={connections[sub]}
            live={live[sub]}
            state={stateFor(sub)}
            busy={!!busyMap[sub]}
            available={available}
            onDone={back}
            onApply={mcp.apply}
          />
        </PageEnter>
      );
    }
    if (own) {
      return (
        <PageEnter key={sub}>
          <CustomMcpPage
            existing={own}
            conn={connections[sub]}
            live={live[sub]}
            state={stateFor(sub)}
            busy={!!busyMap[sub]}
            available={available}
            onDone={back}
            onApply={mcp.apply}
            onDelete={mcp.removeCustom}
          />
        </PageEnter>
      );
    }
  }
  return <ConnectorList mcp={mcp} onOpen={open} />;
}

function DiscoverPage({ initialQuery, onBack }: { initialQuery: string; onBack: () => void }) {
  const [query, setQuery] = useState(initialQuery);
  return (
    <>
      <PageHeader
        back={{ label: "Connectors", onClick: onBack }}
        title="Discover connectors"
        description="Servers from the official MCP Registry and Smithery. Connect one and it shows up in your connectors."
        actions={<SearchField value={query} onChange={setQuery} placeholder="Search the MCP Registry…" />}
      />
      <DiscoverView query={query} />
    </>
  );
}

function ConnectorList({
  mcp,
  onOpen,
}: {
  mcp: ReturnType<typeof useMcpManager>;
  onOpen: (sub: string, search?: Record<string, string>) => void;
}) {
  const { connections, custom, live, busyMap, available } = mcp;
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
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
      ...custom.map((c) => ({ id: c.id, name: c.name, description: c.description ?? "", kind: c.kind, group: "yours" as const, custom: c })),
      ...MCP_SERVERS.map((s) => ({
        id: s.id,
        name: s.name,
        description: s.description,
        kind: "local" as const,
        group: (s.category === "Custom" ? "yours" : s.category) as Group,
        builtin: s,
      })),
    ],
    [custom],
  );

  const isConnected = (id: string) => !!connections[id]?.enabled;
  const q = query.trim().toLowerCase();
  const matches = (r: Row) =>
    !q || [r.name, r.description, r.custom?.registry?.name ?? ""].some((t) => t.toLowerCase().includes(q));
  const visible = rows.filter(
    (r) => matches(r) && (filter === "all" || (filter === "connected" ? isConnected(r.id) : r.group === filter)),
  );
  const connectedCount = rows.filter((r) => isConnected(r.id)).length;
  const popular = (featured ?? []).filter((s) => !installedFromRegistry(s.name, custom)).slice(0, 6);

  const missingBins = diagnose?.binaries.filter((b) => !b.found).map((b) => b.binary) ?? [];
  const uvMissing = missingBins.includes("uvx");
  const nodeMissing = missingBins.includes("npx");

  const connect = (row: Row) => {
    if (row.builtin && missingEnv(row.builtin, connections[row.id]).length > 0) return onOpen(row.id);
    void mcp.apply(row.id, { enabled: true });
  };

  const addTo = (group: Group) => (group === "yours" ? onOpen("new") : onOpen("discover", { q: group }));

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-5">
        <PageHeader
          title="Connectors"
          description="Apps and tools the AI can use in Cowork — documents, code, the web, your data. Shared with the other agents on this Mac."
          actions={
            <>
              <Button type="button" variant="outline" size="sm" className="h-9 gap-1.5" onClick={() => onOpen("discover")}>
                <CompassIcon className="size-4" />
                Discover
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button type="button" size="sm" className="h-9 gap-1.5">
                    <PlusIcon className="size-4" />
                    Add
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" sideOffset={6} className={menuClass}>
                  <DropdownMenuItem className={menuItemClass} onSelect={() => onOpen("discover")}>
                    <CompassIcon className="size-4 text-muted-foreground" />
                    Browse the MCP Registry
                  </DropdownMenuItem>
                  <DropdownMenuItem className={menuItemClass} onSelect={() => onOpen("new")}>
                    <SquareTerminalIcon className="size-4 text-muted-foreground" />
                    Your own (command or URL)
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
            </>
          }
        />

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Pills
            solid
            label="Categories"
            value={filter}
            onChange={setFilter}
            options={[
              { value: "all", label: "All" },
              { value: "connected", label: "Connected", count: connectedCount },
              ...GROUPS.filter((g) => rows.some((r) => r.group === g.id)).map((g) => ({ value: g.id, label: g.label })),
            ]}
          />
          <SearchField value={query} onChange={setQuery} placeholder="Search connectors…" />
        </div>
      </div>

      {!mcp.opencode.loading && !available && (
        <Notice tone="warning" title="OpenCode isn’t ready">
          Connectors run through OpenCode. Install it with <code className="font-mono">npm i -g opencode-ai</code>, then
          restart the app (see Models → CLI agents).
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

      {visible.length === 0 && (
        <p className="py-8 text-center text-sm text-muted-foreground">
          {q ? `No connectors match “${query.trim()}”.` : filter === "connected" ? "Nothing connected yet." : "Nothing here yet."}
        </p>
      )}

      {GROUPS.map((group) => {
        const items = visible.filter((r) => r.group === group.id);
        // "Added by you" stays as a way in, even empty.
        if (items.length === 0 && !(group.id === "yours" && filter === "all" && !q)) return null;
        return (
          <section key={group.id} className="flex flex-col gap-3">
            <GroupHeader title={group.label} onAdd={() => addTo(group.id)} addLabel={group.id === "yours" ? "Add your own" : `Find more ${group.label.toLowerCase()} connectors`} />
            {items.length === 0 ? (
              <button
                type="button"
                onClick={() => onOpen("new")}
                className="flex items-center gap-3 rounded-xl border border-dashed border-border px-4 py-3.5 text-left text-[13px] text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
              >
                <PlusIcon className="size-4" />
                Connect any MCP server — a command on this computer or a web address.
              </button>
            ) : (
              <ul className="flex flex-col gap-2">
                {items.map((row) => (
                  <ConnectionRow
                    key={row.id}
                    row={row}
                    enabled={isConnected(row.id)}
                    live={live[row.id]}
                    busy={busyMap[row.id]}
                    available={available}
                    onOpen={() => onOpen(row.id)}
                    onConnect={() => connect(row)}
                    onDisconnect={() => void mcp.apply(row.id, { enabled: false })}
                    onSignIn={() => void mcp.signIn(row.id)}
                    onSignOut={() => void mcp.signOut(row.id)}
                    onRemove={row.custom ? () => void mcp.removeCustom(row.id) : undefined}
                  />
                ))}
              </ul>
            )}
          </section>
        );
      })}

      {popular.length > 0 && !q && (filter === "all" || filter === "connected") && (
        <section className="flex flex-col gap-3">
          <GroupHeader title="Popular in the MCP Registry" onAdd={() => onOpen("discover")} addLabel="Discover more" />
          <ul className="flex flex-col gap-2">
            {popular.map((server) => (
              <li key={server.name} className="flex min-w-0 items-center gap-3.5 rounded-xl border border-border/70 bg-card px-4 py-3">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-border/70 bg-background">
                  <RegistryIcon icons={server.icons} size={24} />
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm font-semibold">{server.title}</span>
                  <span className="truncate text-[13px] text-muted-foreground">{server.description}</span>
                </span>
                <Button type="button" size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => requestConnectorInstall({ server })}>
                  <PlusIcon className="size-3.5" />
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
    </div>
  );
}

/** "Calendars  [+]": a group's title with its add button on the right. */
function GroupHeader({ title, onAdd, addLabel }: { title: string; onAdd: () => void; addLabel: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <h3 className="text-base font-semibold tracking-tight">{title}</h3>
      <button
        type="button"
        onClick={onAdd}
        aria-label={addLabel}
        title={addLabel}
        className="flex size-7 items-center justify-center rounded-md border border-border bg-background shadow-xs transition-colors hover:bg-muted"
      >
        <PlusIcon className="size-3.5" />
      </button>
    </div>
  );
}

type Tone = "on" | "warn" | "bad" | "off";

/** The button on the right of a row: a status dot, and what to do next. */
function StatusButton({ tone, busy, onClick, title, children }: { tone: Tone; busy?: boolean; onClick: () => void; title?: string; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      title={title}
      className="relative z-10 inline-flex h-8 shrink-0 items-center gap-2 rounded-lg border border-border bg-background px-3 text-[13px] font-medium shadow-xs transition-colors hover:bg-muted"
    >
      {busy ? (
        <LoaderIcon className="size-3 animate-spin text-muted-foreground" />
      ) : (
        <span
          className={cn(
            "size-2 rounded-full",
            tone === "on" && "bg-emerald-500",
            tone === "warn" && "bg-orange-500",
            tone === "bad" && "bg-red-500",
            tone === "off" && "bg-muted-foreground/35",
          )}
        />
      )}
      {children}
    </button>
  );
}

function ConnectionRow({
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
  const needsAuth = enabled && (live?.status === "needs_auth" || live?.status === "needs_client_registration");
  // Vendors that only allow approved apps to sign in (e.g. Figma's remote server).
  const limit = row.kind === "remote" ? oauthLimitFor(row.custom?.url) : undefined;

  let status: ReactNode;
  if (busy === "signing-in") {
    status = (
      <StatusButton tone="warn" busy onClick={() => cancelSignIn(row.id)} title="Waiting for the browser — click to cancel">
        Cancel sign-in
      </StatusButton>
    );
  } else if (busy) {
    status = (
      <StatusButton tone="off" busy onClick={onOpen}>
        {busy === "disconnecting" ? "Stopping…" : "Connecting…"}
      </StatusButton>
    );
  } else if (needsAuth && limit) {
    status = (
      <StatusButton tone="warn" onClick={onOpen} title={limit.reason}>
        Can’t sign in
      </StatusButton>
    );
  } else if (!enabled) {
    status = available ? (
      <StatusButton tone="off" onClick={onConnect} title="Not connected">
        Connect
      </StatusButton>
    ) : (
      <StatusButton tone="off" onClick={onOpen} title="Not connected">
        Config
      </StatusButton>
    );
  } else if (needsAuth) {
    status = (
      <StatusButton tone="warn" onClick={onSignIn} title="Needs sign-in">
        Sign in
      </StatusButton>
    );
  } else if (live?.status === "failed") {
    status = (
      <StatusButton tone="bad" onClick={onOpen} title={live.error ?? "Couldn’t connect"}>
        Config
      </StatusButton>
    );
  } else {
    status = (
      <StatusButton
        tone={live?.status === "connected" || !available ? "on" : "off"}
        onClick={onOpen}
        title={live?.status === "connected" ? "Connected" : "On — starts with the next Cowork prompt"}
      >
        Config
      </StatusButton>
    );
  }

  // Where it came from, which is not always the official registry any more.
  const badge = row.custom ? (
    isSmitheryInstall(row.custom) ? (
      <SourceBadge source="smithery" />
    ) : row.custom.registry ? (
      <SourceBadge source="registry" />
    ) : (
      <span className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">Custom</span>
    )
  ) : null;

  return (
    <li className="group relative flex min-w-0 items-center gap-3.5 rounded-xl border border-border/70 bg-card px-4 py-3 transition-[border-color,box-shadow] hover:border-foreground/20 hover:shadow-[0_6px_16px_-10px_rgb(0_0_0/0.25)]">
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Set up ${row.name}`}
        className="absolute inset-0 rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      />
      <span className="pointer-events-none flex size-10 shrink-0 items-center justify-center rounded-lg border border-border/70 bg-background">
        <ConnectorIcon server={row.builtin} custom={row.custom} size={24} />
      </span>
      <span className="pointer-events-none flex min-w-0 flex-1 flex-col">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-semibold">{row.name}</span>
          {row.kind === "remote" && <span className="shrink-0 text-[11px] text-muted-foreground">Web</span>}
          {badge}
        </span>
        <span className="truncate text-[13px] text-muted-foreground" title={row.description}>
          {row.description || (row.kind === "remote" ? row.custom?.url : row.custom?.command)}
        </span>
      </span>
      {status}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={`Options for ${row.name}`}
            className="relative z-10 flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground data-[state=open]:bg-muted"
          >
            <MoreHorizontalIcon className="size-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" sideOffset={6} className={menuClass}>
          <DropdownMenuItem className={menuItemClass} onSelect={onOpen}>
            <Settings2Icon className="size-4 text-muted-foreground" />
            Config
          </DropdownMenuItem>
          {enabled && row.kind === "remote" && (
            <DropdownMenuItem className={menuItemClass} onSelect={needsAuth ? (limit ? onOpen : onSignIn) : onSignOut}>
              {needsAuth ? <LogInIcon className="size-4 text-muted-foreground" /> : <LogOutIcon className="size-4 text-muted-foreground" />}
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
              <DropdownMenuItem className={cn(menuItemClass, "text-destructive data-highlighted:text-destructive")} onSelect={onRemove}>
                <Trash2Icon className="size-4" />
                Remove
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}
