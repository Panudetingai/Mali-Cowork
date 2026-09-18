import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  diagnoseMcpBinaries,
  MCP_CATEGORIES,
  MCP_SERVERS,
  missingEnv,
  uvInstallCommand,
  type McpCategoryFilter,
  type McpDiagnoseResult,
} from "@/features/mcp";
import { cn } from "@/lib/utils";
import { PlusIcon, RefreshCwIcon, SearchIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CardGrid, CopyCommand, IntegrationCard, Notice, SectionHeader, StatusPill } from "../ui";
import { CustomMcpDialog, type CustomDialogTarget } from "./custom-mcp-dialog";
import { McpDetailsDialog, type McpDetailsTarget } from "./mcp-details-dialog";
import { CustomMcpIcon, McpIcon } from "./mcp-icon";
import { cardState, useMcpManager } from "./use-mcp-manager";

export function McpSettings() {
  const mcp = useMcpManager();
  const { connections, custom, live, busy, available } = mcp;
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<McpCategoryFilter>("All");
  const [details, setDetails] = useState<McpDetailsTarget | null>(null);
  const [customTarget, setCustomTarget] = useState<CustomDialogTarget | null>(null);
  const [diagnose, setDiagnose] = useState<McpDiagnoseResult | null>(null);
  const [checking, setChecking] = useState(false);

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

  const q = query.trim().toLowerCase();
  const matches = (text: string[]) => !q || text.some((t) => t.toLowerCase().includes(q));

  const catalog = useMemo(
    () =>
      MCP_SERVERS.filter(
        (s) =>
          (category === "All" || s.category === category) &&
          matches([s.name, s.description, s.id]),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [category, q],
  );
  const customShown = useMemo(
    () =>
      custom.filter(
        (s) =>
          (category === "All" || category === "Custom") &&
          matches([s.name, s.description ?? "", s.command ?? "", s.url ?? ""]),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [custom, category, q],
  );

  const total = MCP_SERVERS.length + custom.length;
  const enabledCount = [...MCP_SERVERS, ...custom].filter((s) => connections[s.id]?.enabled).length;
  const missingBins = diagnose?.binaries.filter((b) => !b.found).map((b) => b.binary) ?? [];
  const uvMissing = missingBins.includes("uvx");
  const nodeMissing = missingBins.includes("npx");

  const detailsId = details?.server.id;
  const customId = customTarget?.mode === "edit" ? customTarget.server.id : undefined;

  const stateFor = (id: string, needsSetup = false) =>
    cardState({
      enabled: !!connections[id]?.enabled,
      busy: busy.has(id),
      live: live[id],
      available,
      needsSetup,
    });

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader
        title="MCP Integrations"
        description="เชื่อมเครื่องมือให้ agent ในโหมด Cowork ใช้งาน — เปิดสวิตช์เพื่อเชื่อม กดที่การ์ดเพื่อตั้งค่า"
        actions={
          <>
            <StatusPill tone={enabledCount > 0 ? "success" : "neutral"}>
              {enabledCount}/{total} enabled
            </StatusPill>
            <Button type="button" size="sm" className="gap-1.5" onClick={() => setCustomTarget({ mode: "create" })}>
              <PlusIcon className="size-4" />
              Custom MCP
            </Button>
          </>
        }
      />

      {!mcp.opencode.loading && !available && (
        <Notice tone="warning" title="OpenCode ยังไม่พร้อม">
          MCP ทำงานผ่าน OpenCode — ติดตั้งด้วย <code className="font-mono">npm i -g opencode-ai</code> แล้วเปิดแอปใหม่
          (ดูสถานะที่แท็บ Agents)
        </Notice>
      )}

      {mcp.error && (
        <Notice tone="danger" title="บันทึกหรือเชื่อมต่อไม่สำเร็จ" onDismiss={mcp.clearError}>
          {mcp.error}
        </Notice>
      )}

      {(uvMissing || nodeMissing) && (
        <Notice
          tone="info"
          title="บางเครื่องมือยังขาดโปรแกรมที่ใช้รัน"
          action={
            <div className="flex flex-col gap-2">
              {uvMissing && <CopyCommand command={uvInstallCommand(diagnose?.platform ?? null)} className="max-w-xl" />}
              {nodeMissing && (
                <p className="text-xs">
                  ติดตั้ง Node.js จาก <span className="font-medium">nodejs.org</span> เพื่อใช้ server ที่รันด้วย npx
                </p>
              )}
            </div>
          }
        >
          {uvMissing && "Word ต้องใช้ uv (uvx). "}
          {nodeMissing && "Server ส่วนใหญ่ต้องใช้ Node.js (npx). "}
          ติดตั้งแล้วเปิดแอปใหม่
        </Notice>
      )}

      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="relative w-full md:max-w-xs">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="ค้นหา MCP…"
            aria-label="Search MCP servers"
            className="pl-8"
          />
        </div>
        <div className="scroll-hidden -mx-4 flex gap-1.5 overflow-x-auto px-4 md:mx-0 md:px-0">
          {MCP_CATEGORIES.map((c) => (
            <button
              key={c}
              type="button"
              aria-pressed={category === c}
              onClick={() => setCategory(c)}
              className={cn(
                "h-7 shrink-0 rounded-full border px-3 text-xs font-medium transition-colors",
                category === c
                  ? "border-foreground/20 bg-foreground text-background"
                  : "bg-background text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              {c}
              {c === "Custom" && custom.length > 0 && <span className="ml-1 opacity-70">{custom.length}</span>}
            </button>
          ))}
        </div>
      </div>

      {catalog.length === 0 && customShown.length === 0 ? (
        category === "Custom" && !q ? (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed p-8 text-center">
            <p className="text-sm text-muted-foreground">ยังไม่มี Custom MCP — เพิ่ม server ของคุณเองได้ทั้งแบบคำสั่งและ URL</p>
            <Button type="button" size="sm" className="gap-1.5" onClick={() => setCustomTarget({ mode: "create" })}>
              <PlusIcon className="size-4" />
              Custom MCP
            </Button>
          </div>
        ) : (
          <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
            ไม่พบ MCP ที่ค้นหา
          </p>
        )
      ) : (
        <CardGrid>
          {catalog.map((server) => {
            const conn = connections[server.id];
            const enabled = !!conn?.enabled;
            const needsSetup = missingEnv(server, conn).length > 0;
            const state = stateFor(server.id, needsSetup);
            return (
              <IntegrationCard
                key={server.id}
                icon={<McpIcon server={server} />}
                title={server.name}
                description={server.description}
                onOpen={() => setDetails({ server })}
                openLabel={`ตั้งค่า ${server.name}`}
                highlight={state.tone === "success" ? "success" : state.tone === "danger" ? "danger" : undefined}
                status={<StatusPill tone={state.tone}>{state.label}</StatusPill>}
                control={
                  <Switch
                    checked={enabled}
                    disabled={busy.has(server.id) || (!enabled && !available)}
                    aria-label={`${enabled ? "Disconnect" : "Connect"} ${server.name}`}
                    onCheckedChange={(next) => {
                      if (next && needsSetup) setDetails({ server, connectOnSave: true });
                      else void mcp.apply(server.id, { enabled: next });
                    }}
                  />
                }
              />
            );
          })}
          {customShown.map((server) => {
            const enabled = !!connections[server.id]?.enabled;
            const state = stateFor(server.id);
            return (
              <IntegrationCard
                key={server.id}
                icon={<CustomMcpIcon server={server} />}
                title={server.name}
                badge={<StatusPill tone="neutral">Custom</StatusPill>}
                description={
                  server.description || (
                    <span className="font-mono text-xs">{server.kind === "remote" ? server.url : server.command}</span>
                  )
                }
                onOpen={() => setCustomTarget({ mode: "edit", server })}
                openLabel={`แก้ไข ${server.name}`}
                highlight={state.tone === "success" ? "success" : state.tone === "danger" ? "danger" : undefined}
                status={<StatusPill tone={state.tone}>{state.label}</StatusPill>}
                control={
                  <Switch
                    checked={enabled}
                    disabled={busy.has(server.id) || (!enabled && !available)}
                    aria-label={`${enabled ? "Disconnect" : "Connect"} ${server.name}`}
                    onCheckedChange={(next) => void mcp.apply(server.id, { enabled: next })}
                  />
                }
              />
            );
          })}
        </CardGrid>
      )}

      <footer className="flex flex-col gap-2 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <p>
          บันทึกลง <code className="font-mono">~/.config/opencode/opencode.json</code> และ{" "}
          <code className="font-mono">~/.codex/config.toml</code> (Codex CLI) — MCP ที่เพิ่มเองในไฟล์เหล่านั้นจะไม่ถูกแตะ
          {" · "}
          <a
            href="https://mcp.so/"
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-2 hover:text-foreground"
          >
            ค้นหา MCP บน mcp.so
          </a>
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
          ตรวจสถานะอีกครั้ง
        </Button>
      </footer>

      <McpDetailsDialog
        target={details}
        conn={detailsId ? connections[detailsId] : undefined}
        live={detailsId ? live[detailsId] : undefined}
        state={detailsId ? stateFor(detailsId) : { tone: "neutral", label: "" }}
        busy={detailsId ? busy.has(detailsId) : false}
        available={available}
        onClose={() => setDetails(null)}
        onApply={mcp.apply}
      />
      <CustomMcpDialog
        target={customTarget}
        conn={customId ? connections[customId] : undefined}
        live={customId ? live[customId] : undefined}
        state={customId ? stateFor(customId) : undefined}
        busy={customId ? busy.has(customId) : busy.size > 0}
        available={available}
        onClose={() => setCustomTarget(null)}
        onApply={mcp.apply}
        onDelete={mcp.removeCustom}
      />
    </div>
  );
}
