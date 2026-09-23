import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
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
import { Textarea } from "@/components/ui/textarea";
import {
  customMcpId,
  getConnectorIcon,
  oauthLimitFor,
  parseCommand,
  saveCustomMcp,
  setConnectorIcon,
  signOutConnector,
  type CustomMcp,
  type McpConnection,
  type McpServerStatus,
} from "@/features/mcp";
import { AlertTriangleIcon, ClipboardPasteIcon, ExternalLinkIcon, LoaderIcon, Trash2Icon } from "lucide-react";
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
import { KeychainNote, RemoteConnectionBlock, RunOnDeviceBlock } from "./mcp-connection-ui";
import { OAuthLimitBanner } from "./oauth-limit-banner";
import { McpErrorHelp } from "./mcp-details-dialog";
import { IconPicker } from "./icon-picker";
import { CustomMcpIcon } from "./mcp-icon";
import type { CardState } from "./use-mcp-manager";

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const HEADER_NAME = /^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/;

/** Mirrors the backend rule: https everywhere, http only on this machine. */
function urlError(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return "Invalid URL";
  }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol === "https:") return null;
  if (url.protocol === "http:" && local) return null;
  return url.protocol === "http:" ? "Use https:// (http is for localhost only)" : "Use https:// only";
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
    if (!first) throw new Error("No server found in the JSON");
    [name, value] = first;
  }
  if (!value || typeof value !== "object") throw new Error("Invalid JSON format");
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
  if (!argv.length) throw new Error("No command or url in the JSON");
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
      <DialogContent className="max-h-[calc(100svh-2rem)] gap-0 overflow-y-auto p-0 sm:max-w-xl">
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
    // Registry installs list the variables the server takes, even empty ones.
    env: toRows({
      ...Object.fromEntries((existing?.envVars ?? []).map((v) => [v.var, ""])),
      ...conn?.env,
    }),
    url: existing?.url ?? "",
    headers: toRows(existing?.headers),
    timeoutSec: existing?.timeoutMs ? String(Math.round(existing.timeoutMs / 1000)) : "",
  }));
  const [submitted, setSubmitted] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [pasteError, setPasteError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [icon, setIcon] = useState(() => (existing ? getConnectorIcon(existing.id) : null));

  const set = (patch: Partial<Draft>) => setDraft((prev) => ({ ...prev, ...patch }));

  const errors = {
    name: !draft.name.trim() ? "Name the server" : null,
    command:
      draft.kind === "local" && parseCommand(draft.command).length === 0 ? "Enter the command that runs the server" : null,
    url: draft.kind === "remote" ? (draft.url.trim() ? urlError(draft.url) : "Enter the server URL") : null,
    env: draft.kind === "local" && draft.env.some((r) => r.key.trim() && !ENV_NAME.test(r.key.trim()))
      ? "Names may use A-Z, 0-9 and _ only"
      : null,
    headers: draft.kind === "remote" && draft.headers.some((r) => r.key.trim() && !HEADER_NAME.test(r.key.trim()))
      ? "Invalid header name"
      : null,
    timeout:
      draft.timeoutSec && !(Number(draft.timeoutSec) >= 5 && Number(draft.timeoutSec) <= 600)
        ? "5–600 seconds"
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
      setPasteError(e instanceof Error ? e.message : "Couldn’t read the JSON");
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
      registry: existing?.registry,
      envVars: existing?.envVars,
    };
    // A new address can't reuse sign-in tokens meant for the old one.
    if (existing?.url && existing.url !== server.url) {
      await signOutConnector(existing.id).catch(() => undefined);
    }
    saveCustomMcp(server);
    setConnectorIcon(server.id, icon);
    const ok = await onApply(server.id, {
      enabled: available ? true : !!conn?.enabled,
      env: draft.kind === "local" ? toRecord(draft.env) : {},
    });
    if (ok) onClose();
  }

  const limit = oauthLimitFor(draft.url);
  const previewCommand =
    draft.kind === "local" ? draft.command.trim() || "npx -y @modelcontextprotocol/server-everything" : "";

  return (
    <form onSubmit={save} className="flex flex-col">
      <div className="flex flex-col gap-5 px-6 pt-6 pb-2">
        <header className="flex gap-4 pr-6">
          <IconPicker
            value={icon}
            onChange={setIcon}
            fallback={
              <CustomMcpIcon
                server={existing ?? { id: "new", name: "", kind: "local", createdAt: 0 }}
                plain
                className="size-full rounded-2xl [&_svg]:size-7"
              />
            }
          />
          <div className="min-w-0 flex-1 space-y-1.5">
            <DialogTitle className="text-left text-xl font-semibold tracking-tight">
              {existing ? existing.name : "Add custom MCP"}
            </DialogTitle>
            <p className="text-sm leading-relaxed text-muted-foreground">
              {existing?.description ??
                "Connect your own MCP server with a local command or a remote HTTP URL."}
            </p>
            {existing?.registry && (
              <p className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
                <span className="font-mono">{existing.registry.name}</span>
                {existing.registry.method && (
                  <>
                    <span aria-hidden>·</span>
                    <span>{existing.registry.method}</span>
                  </>
                )}
                {existing.registry.repositoryUrl && (
                  <>
                    <span aria-hidden>·</span>
                    <a
                      href={existing.registry.repositoryUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-0.5 font-medium text-foreground/80 underline-offset-2 hover:underline"
                    >
                      Source
                      <ExternalLinkIcon className="size-3" />
                    </a>
                  </>
                )}
              </p>
            )}
            {existing && state && (
              <StatusPill tone={state.tone} className="mt-1 w-fit">
                {state.label === "Connect" ? "Not connected" : state.label}
              </StatusPill>
            )}
          </div>
        </header>

      {limit && draft.kind === "remote" && (
        <OAuthLimitBanner
          limit={limit}
          onUseAlternative={
            limit.alternative ? () => set({ url: limit.alternative!.url }) : undefined
          }
        />
      )}

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
                  Cancel
                </Button>
                <Button type="button" size="sm" disabled={!pasteText.trim()} onClick={applyPaste}>
                  Apply
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
              Have a JSON config from a README? Paste it to fill this in.
            </button>
          )}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" htmlFor={`${ids}-name`} error={submitted ? errors.name : null}>
          <Input
            id={`${ids}-name`}
            value={draft.name}
            onChange={(e) => set({ name: e.target.value })}
            placeholder="e.g. Notion, Jira"
            aria-invalid={(submitted && !!errors.name) || undefined}
            autoFocus={!existing}
          />
        </Field>
        <Field label="Description" htmlFor={`${ids}-desc`} optional>
          <Input
            id={`${ids}-desc`}
            value={draft.description}
            onChange={(e) => set({ description: e.target.value })}
            placeholder="What it’s for"
          />
        </Field>
      </div>

      <Field label="Connection mode" htmlFor={`${ids}-kind`}>
        <Select value={draft.kind} onValueChange={(kind: CustomMcp["kind"]) => set({ kind })}>
          <SelectTrigger id={`${ids}-kind`} className="h-11 w-full text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="local">Local command — runs on this computer (stdio)</SelectItem>
            <SelectItem value="remote">Remote (HTTP) — streamable HTTP / SSE URL</SelectItem>
          </SelectContent>
        </Select>
      </Field>

      {draft.kind === "local" ? (
        <>
          <Field
            label="Command"
            htmlFor={`${ids}-cmd`}
            hint='Runs without a shell. Quote paths with spaces.'
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
              addLabel="Add variable"
              invalidKey={(k) => !ENV_NAME.test(k)}
            />
          </Field>
          <KeychainNote />
          <RunOnDeviceBlock command={previewCommand} />
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
          <Field label="Headers" optional hint="e.g. Authorization: Bearer <token>" error={errors.headers}>
            <KeyValueEditor
              rows={draft.headers}
              onChange={(headers) => set({ headers })}
              keyPlaceholder="Authorization"
              valuePlaceholder="Bearer …"
              addLabel="Add header"
              invalidKey={(k) => !HEADER_NAME.test(k)}
            />
          </Field>
          <KeychainNote />
          <RemoteConnectionBlock url={draft.url} />
        </>
      )}

      <Field label="Timeout (seconds)" htmlFor={`${ids}-timeout`} optional error={errors.timeout} hint="Default 60">
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
        <div className="flex gap-2.5 rounded-xl border border-border/80 bg-muted/30 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
          <AlertTriangleIcon className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <p>Runs on your device with your permissions. Only add servers you trust.</p>
        </div>
      )}
      {!available && <Notice>OpenCode isn’t ready. Saved; it connects once OpenCode runs.</Notice>}
      </div>

      <DialogFooter className="mt-2 flex-col gap-2 border-t bg-muted/20 px-6 py-4 sm:flex-row sm:justify-between">
        {existing ? (
          confirmDelete ? (
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Delete this server?</span>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                onClick={async () => {
                  await onDelete(existing.id);
                  onClose();
                }}
              >
                Delete
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>
                No
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
              Delete
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
