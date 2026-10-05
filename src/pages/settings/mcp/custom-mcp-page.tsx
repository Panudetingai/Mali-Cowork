import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { AlertTriangleIcon, ChevronDownIcon, ClipboardPasteIcon, ExternalLinkIcon, LoaderIcon, Trash2Icon } from "lucide-react";
import { useId, useState, type FormEvent } from "react";
import {
  Field,
  KeyValueEditor,
  Notice,
  PageHeader,
  Pills,
  StatusPill,
  Step,
  toRecord,
  toRows,
  type KeyValueRow,
} from "../ui";
import { KeychainNote, RemoteConnectionBlock, RunOnDeviceBlock } from "./mcp-connection-ui";
import { OAuthLimitBanner } from "./oauth-limit-banner";
import { McpErrorHelp } from "./mcp-details-page";
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

/**
 * Add or change your own MCP server, as its own page (`/settings/mcp/new`,
 * `/settings/mcp/<id>`): name it, say how it runs, then connect.
 */
export function CustomMcpPage({
  existing,
  conn,
  live,
  state,
  busy,
  available,
  onDone,
  onApply,
  onDelete,
}: {
  existing?: CustomMcp;
  conn?: McpConnection;
  live?: McpServerStatus;
  state?: CardState;
  busy: boolean;
  available: boolean;
  onDone: () => void;
  onApply: (id: string, patch: Partial<McpConnection>) => Promise<boolean>;
  onDelete: (id: string) => Promise<void>;
}) {
  const ids = useId();
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
    if (ok) onDone();
  }

  const limit = oauthLimitFor(draft.url);
  const previewCommand =
    draft.kind === "local" ? draft.command.trim() || "npx -y @modelcontextprotocol/server-everything" : "";

  const sourceMeta = existing?.registry && (
    <span className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
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
    </span>
  );

  return (
    <form onSubmit={save} className="flex flex-col gap-8">
      <PageHeader
        back={{ label: "Connectors", onClick: onDone }}
        media={
          <IconPicker
            value={icon}
            onChange={setIcon}
            className="size-12 rounded-xl"
            fallback={
              <CustomMcpIcon
                server={existing ?? { id: "new", name: "", kind: "local", createdAt: 0 }}
                plain
                className="size-full rounded-xl [&_svg]:size-7"
              />
            }
          />
        }
        title={
          <>
            {existing ? existing.name : "Add your own connector"}
            {existing && state && (
              <StatusPill tone={state.tone}>{state.label === "Connect" ? "Not connected" : state.label}</StatusPill>
            )}
          </>
        }
        description={
          <span className="flex flex-col gap-1">
            <span>{existing?.description ?? "Connect any MCP server: a command that runs on this computer, or a web address."}</span>
            {sourceMeta}
          </span>
        }
      />

      {(limit && draft.kind === "remote") || (existing && conn?.enabled && live?.status === "failed" && live.error) ? (
        <div className="flex max-w-3xl flex-col gap-3">
          {limit && draft.kind === "remote" && (
            <OAuthLimitBanner
              limit={limit}
              onUseAlternative={limit.alternative ? () => set({ url: limit.alternative!.url }) : undefined}
            />
          )}
          {existing && conn?.enabled && live?.status === "failed" && live.error && <McpErrorHelp error={live.error} />}
        </div>
      ) : null}

      <div className="flex max-w-3xl flex-col">
        <Step n={1} title="Name it" description="How it shows in your connectors and to the AI." done={!errors.name}>
          {!existing && (
            <div className="flex flex-col gap-2">
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
                  <div className="flex gap-2">
                    <Button type="button" size="sm" disabled={!pasteText.trim()} onClick={applyPaste}>
                      Fill in from JSON
                    </Button>
                    <Button type="button" variant="ghost" size="sm" onClick={() => setPasteOpen(false)}>
                      Cancel
                    </Button>
                  </div>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => setPasteOpen(true)}
                  className="flex w-fit items-center gap-2 text-left text-[13px] text-muted-foreground hover:text-foreground"
                >
                  <ClipboardPasteIcon className="size-4 shrink-0" />
                  Have a JSON config from a README? Paste it to fill this in.
                </button>
              )}
            </div>
          )}
          <div className="grid max-w-2xl gap-4 sm:grid-cols-2">
            <Field label="Name" htmlFor={`${ids}-name`} error={submitted ? errors.name : null}>
              <Input
                id={`${ids}-name`}
                value={draft.name}
                onChange={(e) => set({ name: e.target.value })}
                placeholder="e.g. Notion, Jira"
                aria-invalid={(submitted && !!errors.name) || undefined}
                autoFocus={!existing}
                className="h-10"
              />
            </Field>
            <Field label="Description" htmlFor={`${ids}-desc`} optional>
              <Input
                id={`${ids}-desc`}
                value={draft.description}
                onChange={(e) => set({ description: e.target.value })}
                placeholder="What it’s for"
                className="h-10"
              />
            </Field>
          </div>
        </Step>

        <Step
          n={2}
          title="How it connects"
          description={
            draft.kind === "local"
              ? "A command that starts the server on this computer (stdio)."
              : "The server’s web address (streamable HTTP or SSE)."
          }
          done={draft.kind === "local" ? !errors.command && !errors.env : !errors.url && !errors.headers}
        >
          <Pills
            label="Connection mode"
            value={draft.kind}
            onChange={(kind) => set({ kind })}
            options={[
              { value: "local", label: "Command on this computer" },
              { value: "remote", label: "Web address (URL)" },
            ]}
          />
          {draft.kind === "local" ? (
            <div className="flex max-w-2xl flex-col gap-4">
              <Field
                label="Command"
                htmlFor={`${ids}-cmd`}
                hint="Runs without a shell. Quote paths with spaces."
                error={submitted ? errors.command : null}
              >
                <Input
                  id={`${ids}-cmd`}
                  value={draft.command}
                  onChange={(e) => set({ command: e.target.value })}
                  placeholder="npx -y @modelcontextprotocol/server-everything"
                  spellCheck={false}
                  aria-invalid={(submitted && !!errors.command) || undefined}
                  className="h-10 font-mono text-xs"
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
              <p className="flex gap-2 text-xs leading-relaxed text-muted-foreground">
                <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
                Runs on your device with your permissions. Only add servers you trust.
              </p>
            </div>
          ) : (
            <div className="flex max-w-2xl flex-col gap-4">
              <Field label="URL" htmlFor={`${ids}-url`} error={submitted ? errors.url : null}>
                <Input
                  id={`${ids}-url`}
                  type="url"
                  value={draft.url}
                  onChange={(e) => set({ url: e.target.value })}
                  placeholder="https://example.com/mcp"
                  spellCheck={false}
                  aria-invalid={(submitted && !!errors.url) || undefined}
                  className="h-10 font-mono text-xs"
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
            </div>
          )}
        </Step>

        <Step
          n={3}
          title={existing && conn?.enabled ? "Connected" : "Connect"}
          description={
            available
              ? "Save & connect turns it on. A web server that needs sign-in opens your browser the first time."
              : "OpenCode isn’t running, so it’s saved now and connects once OpenCode starts."
          }
          done={!!conn?.enabled && live?.status === "connected"}
          last
        />
      </div>

      <details className="group max-w-3xl border-t border-border/60 pt-4" open={!!draft.timeoutSec || undefined}>
        <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[13px] font-medium text-muted-foreground hover:text-foreground">
          <ChevronDownIcon className="size-4 -rotate-90 transition-transform group-open:rotate-0" />
          Advanced — timeout
        </summary>
        <div className="pt-5 pl-5">
          <Field label="Timeout (seconds)" htmlFor={`${ids}-timeout`} optional error={errors.timeout} hint="Default 60">
            <Input
              id={`${ids}-timeout`}
              inputMode="numeric"
              value={draft.timeoutSec}
              onChange={(e) => set({ timeoutSec: e.target.value.replace(/[^\d]/g, "") })}
              placeholder="60"
              className="h-10 w-28"
            />
          </Field>
        </div>
      </details>

      {!available && <Notice>OpenCode isn’t ready. Saved; it connects once OpenCode runs.</Notice>}

      <div className="sticky bottom-0 z-10 -mx-1 flex items-center justify-between gap-2 border-t border-border/60 bg-background/90 px-1 py-3 backdrop-blur">
        {existing ? (
          confirmDelete ? (
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Delete this connector?</span>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                onClick={async () => {
                  await onDelete(existing.id);
                  onDone();
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
        <div className="flex items-center gap-2">
          <Button type="button" variant="ghost" onClick={onDone}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy || (submitted && invalid)} className="h-10 gap-1.5 px-5">
            {busy && <LoaderIcon className="size-4 animate-spin" />}
            {available ? "Save & connect" : "Save"}
          </Button>
        </div>
      </div>
    </form>
  );
}
