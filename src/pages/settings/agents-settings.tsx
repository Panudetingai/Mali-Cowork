import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CursorLoginDialog, requestCursorLogin, useCursor } from "@/features/cursor";
import { useGemini } from "@/features/gemini";
import { useOpencode } from "@/features/opencode";
import {
  PROVIDERS,
  ProviderLogo,
  useEnvKeys,
  useProviderConfigs,
  type ProviderDef,
} from "@/features/providers";
import { cn } from "@/lib/utils";
import { checkCli, type CliCheckResult } from "@/pages/chat/api/cli";
import { open } from "@tauri-apps/plugin-dialog";
import { Codex, Cursor, GeminiCLI, OpenCode } from "@lobehub/icons";
import { FolderOpenIcon, RefreshCwIcon } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { ProviderDialog, providerStatus } from "./provider-dialog";
import {
  CardGrid,
  CopyCommand,
  Field,
  GroupLabel,
  IconTile,
  IntegrationCard,
  SectionHeader,
  StatusPill,
} from "./ui";

export function AgentsSettings() {
  const opencode = useOpencode();
  const cursor = useCursor();
  const gemini = useGemini();
  const configs = useProviderConfigs();
  const envKeys = useEnvKeys();
  const folderId = useId();
  const [cwdDraft, setCwdDraft] = useState(opencode.cwd);
  const [codex, setCodex] = useState<CliCheckResult | null>(null);
  const [provider, setProvider] = useState<ProviderDef | null>(null);

  useEffect(() => setCwdDraft(opencode.cwd), [opencode.cwd]);

  const loadCodex = () => {
    setCodex(null);
    checkCli("codex")
      .then(setCodex)
      .catch(() => setCodex({ available: false, error: "check failed" }));
  };
  useEffect(loadCodex, []);

  function refreshAll() {
    opencode.refresh();
    cursor.refresh();
    gemini.refresh();
    loadCodex();
  }

  async function pickFolder() {
    const selected = await open({
      directory: true,
      multiple: false,
      defaultPath: opencode.cwd || undefined,
      title: "เลือกโฟลเดอร์ที่ OpenCode ทำงาน",
    });
    if (typeof selected === "string" && selected) opencode.update({ cwd: selected });
  }

  const oc = opencode.loading ? null : opencode.check;
  const ocModels = opencode.models?.models.length ?? 0;
  const cursorReady = !!cursor.check?.available && !!cursor.check.loggedIn;
  const geminiReady = !!gemini.check?.available && !!gemini.check.loggedIn;
  const refreshing = opencode.loading || cursor.loading || gemini.loading;

  return (
    <div className="flex flex-col gap-8">
      <SectionHeader
        title="Agents"
        description="Agent ที่รันบนเครื่องนี้สำหรับโหมด Cowork — เลือก model ได้ที่ช่องพิมพ์ในหน้าแชท"
        actions={
          <Button variant="outline" size="sm" onClick={refreshAll} disabled={refreshing} className="gap-1.5">
            <RefreshCwIcon className={cn("size-3.5", refreshing && "animate-spin")} />
            รีเฟรช
          </Button>
        }
      />

      <CardGrid className="lg:grid-cols-3 2xl:grid-cols-3">
        <IntegrationCard
          icon={
            <IconTile>
              <OpenCode size={24} />
            </IconTile>
          }
          title="OpenCode"
          badge={<StatusPill tone="neutral">แนะนำ</StatusPill>}
          description={
            oc?.available
              ? `${oc.version ? `v${oc.version} · ` : ""}${ocModels} models · ถามก่อนแก้หรือลบไฟล์`
              : oc?.error || "Agent หลักของ Cowork — รองรับ MCP, OpenRouter และ Ollama"
          }
          status={
            !oc ? (
              <StatusPill tone="pending">กำลังตรวจ…</StatusPill>
            ) : oc.available ? (
              <StatusPill tone="success">Ready</StatusPill>
            ) : (
              <StatusPill tone="danger">Not installed</StatusPill>
            )
          }
        />
        <IntegrationCard
          icon={
            <IconTile>
              <Cursor size={24} />
            </IconTile>
          }
          title="Cursor Agent"
          description={
            cursor.check?.account ||
            (cursor.models.length ? `${cursor.models.length} models · ใช้ subscription ของคุณ` : "ใช้ subscription Cursor ของคุณผ่าน cursor-agent")
          }
          status={
            cursor.loading ? (
              <StatusPill tone="pending">กำลังตรวจ…</StatusPill>
            ) : cursorReady ? (
              <StatusPill tone="success">Signed in</StatusPill>
            ) : cursor.check?.available ? (
              <StatusPill tone="warning">Not signed in</StatusPill>
            ) : (
              <StatusPill tone="neutral">Not installed</StatusPill>
            )
          }
          control={
            !cursor.loading && !cursorReady ? (
              <Button type="button" size="sm" variant="outline" onClick={() => requestCursorLogin()}>
                {cursor.check?.available ? "Sign in" : "วิธีติดตั้ง"}
              </Button>
            ) : undefined
          }
        />
        <IntegrationCard
          icon={
            <IconTile>
              <Codex size={24} />
            </IconTile>
          }
          title="Codex"
          description={codex?.available ? codex.version || codex.path || "พร้อมใช้งาน" : "OpenAI Codex CLI"}
          status={
            !codex ? (
              <StatusPill tone="pending">กำลังตรวจ…</StatusPill>
            ) : codex.available ? (
              <StatusPill tone="success">Ready</StatusPill>
            ) : (
              <StatusPill tone="neutral">Not installed</StatusPill>
            )
          }
        />
        <IntegrationCard
          icon={
            <IconTile>
              <GeminiCLI size={24} />
            </IconTile>
          }
          title="Gemini CLI"
          description={
            gemini.check?.account ||
            (gemini.models.length ? `${gemini.models.length} models · ใช้ Google account ของคุณ` : "ใช้ Google account ของคุณผ่าน gemini CLI")
          }
          status={
            gemini.loading ? (
              <StatusPill tone="pending">กำลังตรวจ…</StatusPill>
            ) : geminiReady ? (
              <StatusPill tone="success">Signed in</StatusPill>
            ) : gemini.check?.available ? (
              <StatusPill tone="warning">Not signed in</StatusPill>
            ) : (
              <StatusPill tone="neutral">Not installed</StatusPill>
            )
          }
        />
      </CardGrid>

      {gemini.check && !gemini.check.available && (
        <div className="flex max-w-xl flex-col gap-2">
          <p className="text-sm text-muted-foreground">ติดตั้ง Gemini CLI แล้วเปิดแอปใหม่ (หรือตั้ง GEMINI_BIN):</p>
          <CopyCommand command="npm i -g @google/gemini-cli" />
        </div>
      )}

      {oc && !oc.available && (
        <div className="flex max-w-xl flex-col gap-2">
          <p className="text-sm text-muted-foreground">ติดตั้ง OpenCode แล้วเปิดแอปใหม่ (หรือตั้ง OPENCODE_BIN):</p>
          <CopyCommand command="npm i -g opencode-ai" />
        </div>
      )}

      <section className="flex flex-col gap-3">
        <GroupLabel>โฟลเดอร์ทำงานเริ่มต้น</GroupLabel>
        <div className="rounded-xl border bg-card p-4">
          <Field
            label="โฟลเดอร์ของ OpenCode"
            htmlFor={folderId}
            hint="ใช้เมื่อแชท Cowork ยังไม่ได้เลือกโฟลเดอร์ — agent จะอ่าน/แก้ไฟล์ได้เฉพาะโฟลเดอร์ที่อนุญาตในแท็บ Folders"
          >
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                id={folderId}
                value={cwdDraft}
                onChange={(e) => setCwdDraft(e.target.value)}
                onBlur={() => cwdDraft.trim() !== opencode.cwd && opencode.update({ cwd: cwdDraft.trim() })}
                placeholder="เช่น ~/Public"
                spellCheck={false}
                className="font-mono text-xs"
              />
              <Button type="button" variant="outline" onClick={pickFolder} className="gap-1.5">
                <FolderOpenIcon className="size-4" />
                เลือก…
              </Button>
            </div>
          </Field>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <div className="space-y-1">
          <GroupLabel>Models สำหรับ agent</GroupLabel>
          <p className="text-sm text-muted-foreground">
            ตั้งค่าครั้งเดียวใช้ได้ทั้ง Chat และ Cowork — แอปส่ง key ให้ OpenCode เก็บเองบนเครื่องนี้
          </p>
        </div>
        <CardGrid className="lg:grid-cols-3 2xl:grid-cols-3">
          {PROVIDERS.map((p) => {
            const status = providerStatus(p, configs[p.id], envKeys);
            const inAgent = opencode.models?.providers.find((x) => x.id === p.id)?.connected;
            return (
              <IntegrationCard
                key={p.id}
                icon={
                  <IconTile>
                    <ProviderLogo logo={p.logo} name={p.name} className="size-6" />
                  </IconTile>
                }
                title={p.name}
                description={p.description}
                onOpen={() => setProvider(p)}
                openLabel={`ตั้งค่า ${p.name}`}
                highlight={inAgent ? "success" : undefined}
                status={
                  inAgent ? (
                    <StatusPill tone="success">Connected</StatusPill>
                  ) : status.tone === "success" ? (
                    <StatusPill tone="warning">Chat only</StatusPill>
                  ) : (
                    <StatusPill tone="neutral">Not connected</StatusPill>
                  )
                }
                control={
                  <Button type="button" variant="outline" size="sm" onClick={() => setProvider(p)}>
                    {status.tone === "success" ? "Manage" : "Set up"}
                  </Button>
                }
              />
            );
          })}
        </CardGrid>
      </section>

      <ProviderDialog provider={provider} onClose={() => setProvider(null)} />
      <CursorLoginDialog />
    </div>
  );
}
