import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  diagnoseMcpBinaries,
  effectiveCommand,
  fetchMcpStatus,
  MCP_CATEGORIES,
  MCP_SERVERS,
  getMcpConnections,
  parseMcpErrorMessage,
  patchMcpConnection,
  setMcpConnections,
  syncMcpServers,
  useMcpConnections,
  UV_INSTALL_PS,
  WORD_SETUP_STEPS,
  type McpDiagnoseResult,
  type McpCategory,
  type McpDef,
  type McpServerStatus,
} from "@/features/mcp";
import { useOpencode } from "@/features/opencode";
import {
  BrainIcon,
  CheckIcon,
  CopyIcon,
  DatabaseIcon,
  FileTextIcon,
  FolderIcon,
  GitBranchIcon,
  GlobeIcon,
  KeyRoundIcon,
  LoaderIcon,
  MonitorPlayIcon,
  PlugIcon,
  PlugZapIcon,
  SearchIcon,
  SendIcon,
  SquareTerminalIcon,
  StethoscopeIcon,
  UnplugIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

const ICONS: Record<string, typeof FileTextIcon> = {
  word: FileTextIcon,
  exec: SquareTerminalIcon,
  sandbox: SquareTerminalIcon,
  filesystem: FolderIcon,
  github: GitBranchIcon,
  fetch: GlobeIcon,
  playwright: MonitorPlayIcon,
  sqlite: DatabaseIcon,
  postgres: DatabaseIcon,
  memory: BrainIcon,
  thinking: BrainIcon,
  search: SearchIcon,
  slack: SendIcon,
};

function McpIcon({ server, className }: { server: McpDef; className?: string }) {
  const Icon = ICONS[server.icon] ?? PlugIcon;
  return <Icon className={className} />;
}

function statusLabel(status: McpServerStatus | undefined, enabled: boolean) {
  if (!enabled) return { text: "○ Disconnected", className: "text-muted-foreground" };
  const s = status?.status ?? "pending";
  if (s === "connected") {
    return { text: "● Connected", className: "text-emerald-600 dark:text-emerald-400" };
  }
  if (s === "needs_auth" || s === "needs_client_registration") {
    return { text: "● Needs auth", className: "text-amber-600 dark:text-amber-400" };
  }
  if (s === "failed") {
    return { text: "● Failed", className: "text-red-600 dark:text-red-400" };
  }
  return { text: "● Connecting…", className: "text-muted-foreground" };
}

function McpErrorHelp({ error, serverId }: { error: string; serverId: string }) {
  const { title, steps } = parseMcpErrorMessage(error);
  return (
    <div className="space-y-2 rounded-lg border border-red-500/30 bg-red-500/5 p-2.5 text-[11px] leading-snug text-red-800 dark:text-red-200">
      <p className="font-medium">{title}</p>
      {steps.length > 0 && (
        <ol className="list-decimal space-y-1 pl-4 text-red-700/90 dark:text-red-200/90">
          {steps.map((step, i) => (
            <li key={i}>{step}</li>
          ))}
        </ol>
      )}
      {serverId === "word" && /connection closed|-32000/i.test(error) && steps.length === 0 && (
        <ol className="list-decimal space-y-1 pl-4">
          {WORD_SETUP_STEPS.map((s) => (
            <li key={s.id}>{s.detail}</li>
          ))}
        </ol>
      )}
    </div>
  );
}

function WordSetupBanner({
  diagnose,
  onRefresh,
  refreshing,
}: {
  diagnose: McpDiagnoseResult | null;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  const uvOk = diagnose?.binaries.some((b) => b.binary === "uvx" && b.found);
  const wordOk = diagnose?.microsoftWord === true;

  return (
    <div className="rounded-xl border border-sky-500/30 bg-sky-500/5 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">Word MCP — สิ่งที่ต้องมีก่อน Connect</h3>
          <p className="text-xs text-muted-foreground">
            แก้ไข .docx แบบ live บน Windows ใช้ uvx + Microsoft Word (Desktop)
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" disabled={refreshing} onClick={onRefresh}>
          {refreshing ? <LoaderIcon className="size-3.5 animate-spin" /> : "ตรวจอีกครั้ง"}
        </Button>
      </div>
      <ul className="space-y-2">
        {WORD_SETUP_STEPS.map((step) => {
          const ok =
            step.id === "uv"
              ? uvOk
              : step.id === "word"
                ? wordOk
                : undefined;
          return (
            <li
              key={step.id}
              className={cn(
                "rounded-lg border px-3 py-2 text-xs",
                ok === true && "border-emerald-500/40 bg-emerald-500/5",
                ok === false && "border-amber-500/40 bg-amber-500/5",
              )}
            >
              <div className="flex items-start gap-2">
                <span className="mt-0.5 shrink-0">
                  {ok === true ? (
                    <CheckIcon className="size-3.5 text-emerald-600" />
                  ) : ok === false ? (
                    <span className="text-amber-600">!</span>
                  ) : (
                    <span className="text-muted-foreground">·</span>
                  )}
                </span>
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="font-medium text-foreground">{step.title}</p>
                  <p className="text-muted-foreground">{step.detail}</p>
                  {"command" in step && step.command && (
                    <CopyInstallCommand command={step.command} />
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function CopyInstallCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <code className="block max-w-full truncate rounded bg-muted px-2 py-1 font-mono text-[10px]">
        {command}
      </code>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 gap-1 px-2 text-[10px]"
        onClick={async () => {
          await navigator.clipboard.writeText(command);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? <CheckIcon className="size-3" /> : <CopyIcon className="size-3" />}
        {copied ? "Copied" : "Copy"}
      </Button>
    </div>
  );
}

export function McpSettings() {
  const connections = useMcpConnections();
  const opencode = useOpencode();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<McpCategory>("All");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [live, setLive] = useState<Record<string, McpServerStatus>>({});
  const [syncError, setSyncError] = useState<string | null>(null);
  const [diagnose, setDiagnose] = useState<McpDiagnoseResult | null>(null);
  const [diagnosing, setDiagnosing] = useState(false);
  const [editingCmd, setEditingCmd] = useState<string | null>(null);

  const refreshLive = useCallback(async () => {
    const rows = await fetchMcpStatus(opencode.cwd).catch(() => []);
    setLive(Object.fromEntries(rows.map((r) => [r.id, r])));
  }, [opencode.cwd]);

  const runDiagnose = useCallback(async () => {
    setDiagnosing(true);
    try {
      setDiagnose(await diagnoseMcpBinaries());
    } finally {
      setDiagnosing(false);
    }
  }, []);

  useEffect(() => {
    if (opencode.check?.available) void refreshLive();
  }, [opencode.check?.available, refreshLive]);

  useEffect(() => {
    void runDiagnose();
  }, [runDiagnose]);

  const connectedCount = useMemo(
    () => MCP_SERVERS.filter((s) => connections[s.id]?.enabled).length,
    [connections],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return MCP_SERVERS.filter((s) => {
      if (category !== "All" && s.category !== category) return false;
      if (!q) return true;
      return (
        s.name.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q) ||
        s.id.includes(q)
      );
    });
  }, [query, category]);

  const applyToggle = async (server: McpDef, nextEnabled: boolean) => {
    const envUpdates: Record<string, string> = {};
    if (nextEnabled && server.envVars?.length) {
      for (const field of server.envVars) {
        const existing = connections[server.id]?.env?.[field.var]?.trim();
        if (existing) continue;
        const value = window.prompt(
          `${field.label} (${server.name})${field.required ? " — จำเป็น" : " (ว่างได้ กด OK ข้าม)"}:`,
        );
        if (value?.trim()) {
          envUpdates[field.var] = value.trim();
        } else if (field.required) {
          return;
        }
      }
    }
    const prev = getMcpConnections();
    const next = {
      ...prev,
      [server.id]: {
        enabled: nextEnabled,
        env: { ...prev[server.id]?.env, ...envUpdates },
        variantId: prev[server.id]?.variantId,
        customCommand: prev[server.id]?.customCommand,
      },
    };
    setMcpConnections(next);
    setBusyId(server.id);
    setSyncError(null);
    try {
      const result = await syncMcpServers(next, opencode.cwd);
      if (result?.servers) {
        setLive(Object.fromEntries(result.servers.map((r) => [r.id, r])));
      }
      void runDiagnose();
    } catch (error) {
      setSyncError(error instanceof Error ? error.message : String(error));
      setMcpConnections({
        ...prev,
        [server.id]: { ...prev[server.id], enabled: !nextEnabled },
      });
    } finally {
      setBusyId(null);
    }
  };

  const uvMissing = diagnose && !diagnose.binaries.some((b) => b.binary === "uvx" && b.found);

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold tracking-tight">MCP Connect</h2>
          <p className="max-w-xl text-sm text-muted-foreground">
            เชื่อมเครื่องมือ MCP กับ OpenCode — agent ใน Cowork จะเรียกใช้ tool จากเซิร์ฟเวอร์ที่เปิดอยู่
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void runDiagnose()}
            disabled={diagnosing}
            className="gap-1.5"
          >
            <StethoscopeIcon className={cn("size-3.5", diagnosing && "animate-pulse")} />
            {diagnosing ? "กำลังตรวจ…" : "ตรวจเครื่อง"}
          </Button>
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium",
              connectedCount > 0
                ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"
                : "bg-muted text-muted-foreground",
            )}
          >
            <PlugZapIcon className="size-3.5" />
            {connectedCount}/{MCP_SERVERS.length} enabled
          </span>
        </div>
      </header>

      <WordSetupBanner diagnose={diagnose} onRefresh={() => void runDiagnose()} refreshing={diagnosing} />

      {diagnose && (
        <div className="flex flex-wrap gap-1.5 rounded-xl border bg-card p-3">
          {diagnose.binaries.map((b) => (
            <span
              key={b.binary}
              title={b.path ?? "ไม่พบใน PATH"}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-[11px]",
                b.found
                  ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                  : "bg-red-500/10 text-red-700 dark:text-red-300",
              )}
            >
              {b.found ? "●" : "○"} {b.binary}
            </span>
          ))}
          {diagnose.microsoftWord != null && (
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px]",
                diagnose.microsoftWord
                  ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                  : "bg-amber-500/10 text-amber-800 dark:text-amber-200",
              )}
            >
              {diagnose.microsoftWord ? "●" : "○"} Microsoft Word
            </span>
          )}
          {uvMissing && (
            <div className="w-full space-y-1 text-xs text-muted-foreground">
              <p>
                ไม่เจอ <code className="rounded bg-muted px-1">uvx</code> — ติดตั้งแล้ว restart แอป
              </p>
              <CopyInstallCommand command={UV_INSTALL_PS} />
            </div>
          )}
        </div>
      )}

      {syncError && (
        <p className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          {syncError}
        </p>
      )}

      {!opencode.check?.available && (
        <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          ติดตั้งและเปิด OpenCode ก่อน (Settings → Models หรือ `npm i -g opencode-ai`) แล้วกลับมา Connect MCP
        </p>
      )}

      <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="ค้นหา Word, Exec, GitHub…"
          className="h-9 max-w-sm"
        />
        <div className="flex flex-wrap gap-1.5">
          {MCP_CATEGORIES.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCategory(c)}
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                category === c
                  ? "border-primary bg-primary/10 text-foreground"
                  : "border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="rounded-2xl bg-muted/60 p-6 text-center text-sm text-muted-foreground">
          ไม่พบ MCP ที่ค้นหา ลองคำอื่นดู
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((server) => {
            const conn = connections[server.id];
            const enabled = !!conn?.enabled;
            const liveStatus = live[server.id];
            const label = statusLabel(liveStatus, enabled);
            const busy = busyId === server.id;
            const failed = enabled && liveStatus?.status === "failed";
            return (
              <Card
                key={server.id}
                className={cn(
                  "relative transition-colors",
                  enabled && liveStatus?.status === "connected" &&
                    "border-emerald-500/40 ring-1 ring-emerald-500/20",
                  failed && "border-red-500/40",
                )}
              >
                <CardHeader className="flex-row items-start gap-3 space-y-0">
                  <span
                    className={cn(
                      "flex size-10 shrink-0 items-center justify-center rounded-xl",
                      enabled
                        ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                        : "bg-primary/10 text-primary",
                    )}
                  >
                    <McpIcon server={server} className="size-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <CardTitle className="flex items-center gap-2 text-[15px]">
                      <span className="truncate">{server.name}</span>
                      {server.needsKey && (
                        <KeyRoundIcon
                          className="size-3.5 shrink-0 text-amber-500"
                          aria-label="ต้องใช้ API key"
                        />
                      )}
                    </CardTitle>
                    <CardDescription className="text-xs">
                      {server.category} ·{" "}
                      <span className={cn("font-medium", label.className)}>{label.text}</span>
                    </CardDescription>
                  </div>
                </CardHeader>

                <CardContent className="gap-2">
                  <p className="min-h-10 text-[13px] leading-snug text-muted-foreground">
                    {server.description}
                  </p>

                  {server.variants ? (
                    <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
                      วิธีเชื่อม
                      <select
                        value={conn?.variantId ?? server.variants[0].id}
                        disabled={busy}
                        onChange={(e) => {
                          patchMcpConnection(server.id, {
                            variantId: e.target.value,
                            customCommand: undefined,
                          });
                          if (enabled) void applyToggle(server, true);
                        }}
                        className="h-8 rounded-lg border bg-background px-2 text-xs text-foreground"
                      >
                        {server.variants.map((v) => (
                          <option key={v.id} value={v.id}>
                            {v.label} — {v.command}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}

                  <code
                    className="block truncate rounded-lg bg-muted/70 px-2.5 py-1.5 font-mono text-[11px] text-muted-foreground"
                    title={effectiveCommand(server, conn)}
                  >
                    {effectiveCommand(server, conn)}
                  </code>

                  {editingCmd === server.id ? (
                    <Input
                      defaultValue={conn?.customCommand ?? effectiveCommand(server, conn)}
                      placeholder="คำสั่งเอง เช่น uvx word-mcp-live"
                      className="h-8 font-mono text-[11px]"
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          patchMcpConnection(server.id, {
                            customCommand: e.currentTarget.value.trim() || undefined,
                          });
                          setEditingCmd(null);
                          if (enabled) void applyToggle(server, true);
                        }
                        if (e.key === "Escape") setEditingCmd(null);
                      }}
                      onBlur={(e) => {
                        patchMcpConnection(server.id, {
                          customCommand: e.target.value.trim() || undefined,
                        });
                        setEditingCmd(null);
                      }}
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => setEditingCmd(server.id)}
                      className="self-start text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                    >
                      {conn?.customCommand ? "แก้คำสั่งเอง ✓ (กดเพื่อเปลี่ยน)" : "ใช้คำสั่งเอง…"}
                    </button>
                  )}

                  {failed && liveStatus?.error && (
                    <McpErrorHelp error={liveStatus.error} serverId={server.id} />
                  )}
                </CardContent>

                <CardFooter className="gap-2">
                  <Button
                    type="button"
                    variant={enabled ? "outline" : "default"}
                    size="sm"
                    disabled={busy || !opencode.check?.available}
                    className={cn(
                      "w-full gap-1.5",
                      enabled &&
                        "border-emerald-500/40 text-emerald-700 hover:bg-emerald-500/10 hover:text-emerald-700 dark:text-emerald-300",
                    )}
                    onClick={() => void applyToggle(server, !enabled)}
                  >
                    {busy ? (
                      <LoaderIcon className="size-4 animate-spin" />
                    ) : enabled ? (
                      <UnplugIcon className="size-4" />
                    ) : (
                      <PlugIcon className="size-4" />
                    )}
                    {busy
                      ? server.id === "word"
                        ? "กำลังเชื่อม… (ครั้งแรก ~1–2 นาที)"
                        : "Syncing…"
                      : enabled
                        ? failed
                          ? "ลองใหม่"
                          : "Disconnect"
                        : "Connect"}
                  </Button>
                  {enabled && liveStatus?.status === "connected" && (
                    <span className="pointer-events-none absolute -top-px right-4 flex items-center gap-1 rounded-b-lg bg-emerald-500 px-2 py-0.5 text-[10px] font-semibold text-white">
                      <CheckIcon className="size-3" />
                      ON
                    </span>
                  )}
                </CardFooter>
              </Card>
            );
          })}
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        การตั้งค่า MCP ถูกบันทึกลง{" "}
        <code className="rounded bg-muted px-1">~/.config/opencode/opencode.json</code> — Word ใช้{" "}
        <code className="rounded bg-muted px-1">uvx word-mcp-live</code> (timeout 3 นาที ครั้งแรก)
      </p>
    </div>
  );
}
