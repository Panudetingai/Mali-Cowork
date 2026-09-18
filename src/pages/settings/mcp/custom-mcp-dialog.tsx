import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  customMcpId,
  parseCommand,
  saveCustomMcp,
  type CustomMcp,
  type McpConnection,
  type McpServerStatus,
} from "@/features/mcp";
import { cn } from "@/lib/utils";
import { ClipboardPasteIcon, GlobeIcon, LoaderIcon, SquareTerminalIcon, Trash2Icon } from "lucide-react";
import { useId, useState, type FormEvent } from "react";
import {
  Field,
  KeyValueEditor,
  Notice,
  StatusPill,
  toRecord,
  toRows,
  type KeyValueRow,
} from "../ui";
import { McpErrorHelp } from "./mcp-details-dialog";
import type { CardState } from "./use-mcp-manager";

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const HEADER_NAME = /^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/;

/** Mirrors the backend rule: https everywhere, http only on this machine. */
function urlError(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return "URL ไม่ถูกต้อง";
  }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol === "https:") return null;
  if (url.protocol === "http:" && local) return null;
  return url.protocol === "http:" ? "ต้องใช้ https:// (http ใช้ได้เฉพาะ localhost)" : "ใช้ https:// เท่านั้น";
}

type Draft = {
  name: string;
  description: string;
  kind: CustomMcp["kind"];
  command: string;
  env: KeyValueRow[];
  url: string;
  headers: KeyValueRow[];
  timeoutSec: string;
};

function quote(arg: string) {
  return /[\s"']/.test(arg) ? `"${arg.replace(/"/g, "")}"` : arg;
}

/**
 * Accepts the JSON most MCP READMEs show: `{ "mcpServers": { name: {...} } }`,
 * a single `{ command, args, env }` / `{ url, headers }`, or opencode's
 * `{ type, command: [...], environment }`.
 */
function parsePastedConfig(raw: string): Partial<Draft> {
  let value: unknown = JSON.parse(raw);
  let name: string | undefined;
  const container = (value as Record<string, unknown>)?.mcpServers ?? (value as Record<string, unknown>)?.mcp;
  if (container && typeof container === "object") {
    const [first] = Object.entries(container as Record<string, unknown>);
    if (!first) throw new Error("ไม่พบ server ใน JSON");
    [name, value] = first;
  }
  if (!value || typeof value !== "object") throw new Error("รูปแบบ JSON ไม่ถูกต้อง");
  const v = value as Record<string, unknown>;
  const strings = (x: unknown) => (Array.isArray(x) ? x.filter((a): a is string => typeof a === "string") : []);
  const record = (x: unknown) =>
    x && typeof x === "object"
      ? Object.fromEntries(Object.entries(x).filter((e): e is [string, string] => typeof e[1] === "string"))
      : {};

  const url = typeof v.url === "string" ? v.url : typeof v.serverUrl === "string" ? v.serverUrl : undefined;
  if (url) {
    return { name, kind: "remote", url, headers: toRows(record(v.headers)) };
  }
  const argv = Array.isArray(v.command)
    ? strings(v.command)
    : typeof v.command === "string"
      ? [v.command, ...strings(v.args)]
      : [];
  if (!argv.length) throw new Error("ไม่พบ command หรือ url ใน JSON");
  return {
    name,
    kind: "local",
    command: argv.map(quote).join(" "),
    env: toRows(record(v.env ?? v.environment)),
  };
}

export type CustomDialogTarget = { mode: "create" } | { mode: "edit"; server: CustomMcp };

export function CustomMcpDialog({
  target,
  conn,
  live,
  state,
  busy,
  available,
  onClose,
  onApply,
  onDelete,
}: {
  target: CustomDialogTarget | null;
  conn?: McpConnection;
  live?: McpServerStatus;
  state?: CardState;
  busy: boolean;
  available: boolean;
  onClose: () => void;
  onApply: (id: string, patch: Partial<McpConnection>) => Promise<boolean>;
  onDelete: (id: string) => Promise<void>;
}) {
  return (
    <Dialog open={!!target} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[calc(100svh-2rem)] gap-5 overflow-y-auto sm:max-w-xl">
        {target && (
          <CustomForm
            key={target.mode === "edit" ? target.server.id : "new"}
            target={target}
            conn={conn}
            live={live}
            state={state}
            busy={busy}
            available={available}
            onClose={onClose}
            onApply={onApply}
            onDelete={onDelete}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function CustomForm({
  target,
  conn,
  live,
  state,
  busy,
  available,
  onClose,
  onApply,
  onDelete,
}: {
  target: CustomDialogTarget;
  conn?: McpConnection;
  live?: McpServerStatus;
  state?: CardState;
  busy: boolean;
  available: boolean;
  onClose: () => void;
  onApply: (id: string, patch: Partial<McpConnection>) => Promise<boolean>;
  onDelete: (id: string) => Promise<void>;
}) {
  const ids = useId();
  const existing = target.mode === "edit" ? target.server : undefined;
  const [draft, setDraft] = useState<Draft>(() => ({
    name: existing?.name ?? "",
    description: existing?.description ?? "",
    kind: existing?.kind ?? "local",
    command: existing?.command ?? "",
    env: toRows(conn?.env),
    url: existing?.url ?? "",
    headers: toRows(existing?.headers),
    timeoutSec: existing?.timeoutMs ? String(Math.round(existing.timeoutMs / 1000)) : "",
  }));
  const [submitted, setSubmitted] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [pasteError, setPasteError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const set = (patch: Partial<Draft>) => setDraft((prev) => ({ ...prev, ...patch }));

  const errors = {
    name: !draft.name.trim() ? "ตั้งชื่อ server" : null,
    command:
      draft.kind === "local" && parseCommand(draft.command).length === 0 ? "ใส่คำสั่งที่ใช้รัน server" : null,
    url: draft.kind === "remote" ? (draft.url.trim() ? urlError(draft.url) : "ใส่ URL ของ server") : null,
    env: draft.kind === "local" && draft.env.some((r) => r.key.trim() && !ENV_NAME.test(r.key.trim()))
      ? "ชื่อตัวแปรใช้ได้เฉพาะ A-Z, 0-9 และ _"
      : null,
    headers: draft.kind === "remote" && draft.headers.some((r) => r.key.trim() && !HEADER_NAME.test(r.key.trim()))
      ? "ชื่อ header ไม่ถูกต้อง"
      : null,
    timeout:
      draft.timeoutSec && !(Number(draft.timeoutSec) >= 5 && Number(draft.timeoutSec) <= 600)
        ? "5–600 วินาที"
        : null,
  };
  const invalid = Object.values(errors).some(Boolean);

  function applyPaste() {
    try {
      const parsed = parsePastedConfig(pasteText);
      setDraft((prev) => ({ ...prev, ...parsed, name: prev.name || parsed.name || "" }));
      setPasteOpen(false);
      setPasteText("");
      setPasteError(null);
    } catch (e) {
      setPasteError(e instanceof Error ? e.message : "อ่าน JSON ไม่ได้");
    }
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setSubmitted(true);
    if (invalid) return;
    const server: CustomMcp = {
      id: existing?.id ?? customMcpId(draft.name),
      name: draft.name.trim(),
      description: draft.description.trim() || undefined,
      kind: draft.kind,
      command: draft.kind === "local" ? draft.command.trim() : undefined,
      url: draft.kind === "remote" ? draft.url.trim() : undefined,
      headers: draft.kind === "remote" ? toRecord(draft.headers) : undefined,
      timeoutMs: draft.timeoutSec ? Number(draft.timeoutSec) * 1000 : undefined,
      createdAt: existing?.createdAt ?? Date.now(),
    };
    saveCustomMcp(server);
    const ok = await onApply(server.id, {
      enabled: available ? true : !!conn?.enabled,
      env: draft.kind === "local" ? toRecord(draft.env) : {},
    });
    if (ok) onClose();
  }

  return (
    <form onSubmit={save} className="flex flex-col gap-5">
      <DialogHeader className="pr-8">
        <DialogTitle>{existing ? existing.name : "เพิ่ม Custom MCP"}</DialogTitle>
        <DialogDescription className="flex flex-wrap items-center gap-2">
          {existing && state ? (
            <StatusPill tone={state.tone}>{state.label === "Connect" ? "Not connected" : state.label}</StatusPill>
          ) : (
            "เชื่อม MCP server ของคุณเอง — รันคำสั่งบนเครื่อง หรือเชื่อมผ่าน URL"
          )}
        </DialogDescription>
      </DialogHeader>

      {existing && conn?.enabled && live?.status === "failed" && live.error && (
        <McpErrorHelp error={live.error} />
      )}

      {!existing && (
        <div className="flex flex-col gap-2 rounded-xl border border-dashed p-3">
          {pasteOpen ? (
            <>
              <Textarea
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                placeholder={'{\n  "mcpServers": {\n    "my-server": { "command": "npx", "args": ["-y", "some-mcp"] }\n  }\n}'}
                spellCheck={false}
                className="min-h-32 font-mono text-xs"
                autoFocus
              />
              {pasteError && <p className="text-xs text-red-600 dark:text-red-400">{pasteError}</p>}
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" size="sm" onClick={() => setPasteOpen(false)}>
                  ยกเลิก
                </Button>
                <Button type="button" size="sm" disabled={!pasteText.trim()} onClick={applyPaste}>
                  ใช้ค่านี้
                </Button>
              </div>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setPasteOpen(true)}
              className="flex items-center gap-2 text-left text-sm text-muted-foreground hover:text-foreground"
            >
              <ClipboardPasteIcon className="size-4 shrink-0" />
              มี JSON config จาก README? วางที่นี่เพื่อกรอกให้อัตโนมัติ
            </button>
          )}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="ชื่อ" htmlFor={`${ids}-name`} error={submitted ? errors.name : null}>
          <Input
            id={`${ids}-name`}
            value={draft.name}
            onChange={(e) => set({ name: e.target.value })}
            placeholder="เช่น Notion, Jira"
            aria-invalid={(submitted && !!errors.name) || undefined}
            autoFocus={!existing}
          />
        </Field>
        <Field label="คำอธิบาย" htmlFor={`${ids}-desc`} optional>
          <Input
            id={`${ids}-desc`}
            value={draft.description}
            onChange={(e) => set({ description: e.target.value })}
            placeholder="ใช้ทำอะไร"
          />
        </Field>
      </div>

      <div role="radiogroup" aria-label="ชนิดการเชื่อมต่อ" className="grid grid-cols-2 gap-2">
        {(
          [
            { kind: "local", title: "Local command", detail: "รันบนเครื่องนี้ (stdio)", Icon: SquareTerminalIcon },
            { kind: "remote", title: "Remote URL", detail: "HTTP / SSE server", Icon: GlobeIcon },
          ] as const
        ).map(({ kind, title, detail, Icon }) => (
          <button
            key={kind}
            type="button"
            role="radio"
            aria-checked={draft.kind === kind}
            onClick={() => set({ kind })}
            className={cn(
              "flex items-start gap-2.5 rounded-xl border p-3 text-left transition-colors",
              draft.kind === kind
                ? "border-primary/60 bg-primary/5 ring-1 ring-primary/30"
                : "hover:bg-muted/60",
            )}
          >
            <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0">
              <span className="block text-sm font-medium">{title}</span>
              <span className="block text-xs text-muted-foreground">{detail}</span>
            </span>
          </button>
        ))}
      </div>

      {draft.kind === "local" ? (
        <>
          <Field
            label="คำสั่ง"
            htmlFor={`${ids}-cmd`}
            hint='รันตรง ไม่ผ่าน shell — ใส่ "…" ครอบ path ที่มีช่องว่าง'
            error={submitted ? errors.command : null}
          >
            <Input
              id={`${ids}-cmd`}
              value={draft.command}
              onChange={(e) => set({ command: e.target.value })}
              placeholder="npx -y @modelcontextprotocol/server-everything"
              spellCheck={false}
              aria-invalid={(submitted && !!errors.command) || undefined}
              className="font-mono text-xs"
            />
          </Field>
          <Field label="Environment variables" optional error={errors.env}>
            <KeyValueEditor
              rows={draft.env}
              onChange={(env) => set({ env })}
              keyPlaceholder="API_KEY"
              valuePlaceholder="value"
              addLabel="เพิ่มตัวแปร"
              invalidKey={(k) => !ENV_NAME.test(k)}
            />
          </Field>
        </>
      ) : (
        <>
          <Field label="URL" htmlFor={`${ids}-url`} error={submitted ? errors.url : null}>
            <Input
              id={`${ids}-url`}
              type="url"
              value={draft.url}
              onChange={(e) => set({ url: e.target.value })}
              placeholder="https://example.com/mcp"
              spellCheck={false}
              aria-invalid={(submitted && !!errors.url) || undefined}
              className="font-mono text-xs"
            />
          </Field>
          <Field label="Headers" optional hint="เช่น Authorization: Bearer <token>" error={errors.headers}>
            <KeyValueEditor
              rows={draft.headers}
              onChange={(headers) => set({ headers })}
              keyPlaceholder="Authorization"
              valuePlaceholder="Bearer …"
              addLabel="เพิ่ม header"
              invalidKey={(k) => !HEADER_NAME.test(k)}
            />
          </Field>
        </>
      )}

      <Field label="Timeout (วินาที)" htmlFor={`${ids}-timeout`} optional error={errors.timeout} hint="ค่าเริ่มต้น 60">
        <Input
          id={`${ids}-timeout`}
          inputMode="numeric"
          value={draft.timeoutSec}
          onChange={(e) => set({ timeoutSec: e.target.value.replace(/[^\d]/g, "") })}
          placeholder="60"
          className="w-28"
        />
      </Field>

      {draft.kind === "local" && (
        <Notice tone="warning">
          คำสั่งนี้จะรันบนเครื่องคุณด้วยสิทธิ์ของคุณ — เพิ่มเฉพาะ server จากแหล่งที่เชื่อถือได้
        </Notice>
      )}
      {!available && <Notice>OpenCode ยังไม่พร้อม — จะบันทึกไว้ และเชื่อมเมื่อ OpenCode เปิดอยู่</Notice>}

      <DialogFooter className="gap-2 sm:justify-between">
        {existing ? (
          confirmDelete ? (
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">ลบ server นี้?</span>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                onClick={async () => {
                  await onDelete(existing.id);
                  onClose();
                }}
              >
                ลบ
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>
                ไม่
              </Button>
            </div>
          ) : (
            <Button
              type="button"
              variant="ghost"
              className="gap-1.5 text-muted-foreground hover:text-destructive"
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2Icon className="size-4" />
              ลบ
            </Button>
          )
        ) : (
          <span />
        )}
        <div className="flex flex-col-reverse gap-2 sm:flex-row">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy || (submitted && invalid)} className="gap-1.5">
            {busy && <LoaderIcon className="size-4 animate-spin" />}
            {available ? "Save & connect" : "Save"}
          </Button>
        </div>
      </DialogFooter>
    </form>
  );
}
