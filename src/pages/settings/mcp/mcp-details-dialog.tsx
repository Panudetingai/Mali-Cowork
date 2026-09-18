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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  effectiveCommand,
  parseMcpErrorMessage,
  type McpConnection,
  type McpDef,
  type McpServerStatus,
} from "@/features/mcp";
import { ChevronRightIcon, LoaderIcon } from "lucide-react";
import { useId, useState, type ChangeEvent, type FormEvent } from "react";
import { CopyCommand, Field, Notice, SecretInput, StatusPill } from "../ui";
import { McpIcon } from "./mcp-icon";
import type { CardState } from "./use-mcp-manager";

export type McpDetailsTarget = {
  server: McpDef;
  /** Opened from the switch: saving also turns the server on. */
  connectOnSave?: boolean;
};

export function McpErrorHelp({ error }: { error: string }) {
  const { title, steps } = parseMcpErrorMessage(error);
  return (
    <Notice tone="danger" title="เชื่อมต่อไม่สำเร็จ">
      <p className="font-mono text-xs">{title}</p>
      {steps.length > 0 && (
        <ol className="mt-2 list-decimal space-y-1 pl-4 text-xs">
          {steps.map((step, i) => (
            <li key={i}>{step}</li>
          ))}
        </ol>
      )}
    </Notice>
  );
}

export function McpDetailsDialog({
  target,
  conn,
  live,
  state,
  busy,
  available,
  onClose,
  onApply,
}: {
  target: McpDetailsTarget | null;
  conn?: McpConnection;
  live?: McpServerStatus;
  state: CardState;
  busy: boolean;
  available: boolean;
  onClose: () => void;
  onApply: (id: string, patch: Partial<McpConnection>) => Promise<boolean>;
}) {
  return (
    <Dialog open={!!target} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[calc(100svh-2rem)] gap-5 overflow-y-auto sm:max-w-lg">
        {target && (
          <DetailsForm
            key={target.server.id}
            target={target}
            conn={conn}
            live={live}
            state={state}
            busy={busy}
            available={available}
            onClose={onClose}
            onApply={onApply}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function DetailsForm({
  target: { server, connectOnSave },
  conn,
  live,
  state,
  busy,
  available,
  onClose,
  onApply,
}: {
  target: McpDetailsTarget;
  conn?: McpConnection;
  live?: McpServerStatus;
  state: CardState;
  busy: boolean;
  available: boolean;
  onClose: () => void;
  onApply: (id: string, patch: Partial<McpConnection>) => Promise<boolean>;
}) {
  const ids = useId();
  const enabled = !!conn?.enabled;
  const [env, setEnv] = useState<Record<string, string>>(() => ({ ...conn?.env }));
  const [variantId, setVariantId] = useState(conn?.variantId ?? server.variants?.[0]?.id);
  const [customCommand, setCustomCommand] = useState(conn?.customCommand ?? "");
  const [advanced, setAdvanced] = useState(!!conn?.customCommand);
  const [submitted, setSubmitted] = useState(false);

  const draft: McpConnection = {
    enabled,
    env,
    variantId,
    customCommand: customCommand.trim() || undefined,
  };
  const missing = (server.envVars ?? []).filter((f) => f.required && !env[f.var]?.trim());
  const willConnect = enabled || !!connectOnSave;

  async function save(event: FormEvent) {
    event.preventDefault();
    setSubmitted(true);
    if (willConnect && missing.length > 0) return;
    const ok = await onApply(server.id, {
      env: Object.fromEntries(Object.entries(env).filter(([, v]) => v.trim())),
      variantId,
      customCommand: draft.customCommand,
      enabled: willConnect,
    });
    if (ok) onClose();
  }

  async function disconnect() {
    if (await onApply(server.id, { enabled: false })) onClose();
  }

  return (
    <form onSubmit={save} className="flex flex-col gap-5">
      <DialogHeader className="flex-row items-center gap-3 space-y-0 pr-8 text-left">
        <McpIcon server={server} />
        <div className="min-w-0">
          <DialogTitle className="truncate">{server.name}</DialogTitle>
          <DialogDescription className="flex flex-wrap items-center gap-2 pt-1">
            <span>{server.category}</span>
            <StatusPill tone={state.tone}>{state.label === "Connect" ? "Not connected" : state.label}</StatusPill>
          </DialogDescription>
        </div>
      </DialogHeader>

      <p className="text-sm text-muted-foreground">{server.description}</p>
      {server.setup && <Notice>{server.setup}</Notice>}
      {enabled && live?.status === "failed" && live.error && <McpErrorHelp error={live.error} />}

      {server.envVars?.length ? (
        <div className="flex flex-col gap-4">
          {server.envVars.map((field) => {
            const id = `${ids}-${field.var}`;
            const props = {
              id,
              value: env[field.var] ?? "",
              onChange: (e: ChangeEvent<HTMLInputElement>) =>
                setEnv((prev) => ({ ...prev, [field.var]: e.target.value })),
              placeholder: field.placeholder,
              "aria-invalid": (submitted && field.required && !env[field.var]?.trim()) || undefined,
            };
            return (
              <Field
                key={field.var}
                label={field.label}
                htmlFor={id}
                optional={!field.required}
                hint={<code className="font-mono">{field.var}</code>}
                error={submitted && field.required && !env[field.var]?.trim() ? "จำเป็นต้องกรอก" : null}
              >
                {field.secret ? <SecretInput {...props} /> : <Input {...props} spellCheck={false} />}
              </Field>
            );
          })}
          <p className="text-xs text-muted-foreground">
            ค่าเหล่านี้เก็บบนเครื่องนี้เท่านั้น และส่งให้ MCP server ผ่าน environment
          </p>
        </div>
      ) : null}

      {server.variants && !advanced && (
        <Field label="วิธีรัน" htmlFor={`${ids}-variant`} hint="ถ้าวิธีแรกใช้ไม่ได้ แอปจะลองวิธีอื่นให้อัตโนมัติ">
          <Select value={variantId} onValueChange={setVariantId}>
            <SelectTrigger id={`${ids}-variant`} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {server.variants.map((v) => (
                <SelectItem key={v.id} value={v.id}>
                  {v.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      )}

      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={() => setAdvanced((v) => !v)}
          aria-expanded={advanced}
          className="flex w-fit items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground"
        >
          <ChevronRightIcon className={advanced ? "size-4 rotate-90 transition-transform" : "size-4 transition-transform"} />
          ขั้นสูง: กำหนดคำสั่งเอง
        </button>
        {advanced ? (
          <Field
            label="คำสั่ง"
            htmlFor={`${ids}-cmd`}
            hint='รันตรง ไม่ผ่าน shell — ใส่ "…" ครอบ path ที่มีช่องว่าง เว้นว่างเพื่อใช้ค่าเริ่มต้น'
          >
            <Input
              id={`${ids}-cmd`}
              value={customCommand}
              onChange={(e) => setCustomCommand(e.target.value)}
              placeholder={server.command}
              spellCheck={false}
              className="font-mono text-xs"
            />
          </Field>
        ) : (
          <CopyCommand command={effectiveCommand(server, draft)} />
        )}
      </div>

      {!available && (
        <Notice tone="warning">เปิด OpenCode ก่อน (ดูแท็บ Agents) แล้วจึงเชื่อมต่อได้</Notice>
      )}

      <DialogFooter className="gap-2 sm:justify-between">
        {enabled ? (
          <Button type="button" variant="destructive" disabled={busy} onClick={disconnect}>
            Disconnect
          </Button>
        ) : (
          <span />
        )}
        <div className="flex flex-col-reverse gap-2 sm:flex-row">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy || (willConnect && !available)} className="gap-1.5">
            {busy && <LoaderIcon className="size-4 animate-spin" />}
            {willConnect ? (enabled ? "Save & reconnect" : "Save & connect") : "Save"}
          </Button>
        </div>
      </DialogFooter>
      {busy && server.id === "word" && (
        <p className="-mt-2 text-right text-xs text-muted-foreground">ครั้งแรกอาจใช้ 1–2 นาทีเพื่อดาวน์โหลด</p>
      )}
    </form>
  );
}
