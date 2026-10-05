import { Button } from "@/components/ui/button";
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
  getConnectorIcon,
  parseMcpErrorMessage,
  setConnectorIcon,
  type McpConnection,
  type McpDef,
  type McpServerStatus,
} from "@/features/mcp";
import { AlertTriangleIcon, ChevronDownIcon, LoaderIcon } from "lucide-react";
import { useId, useState, type ChangeEvent, type FormEvent } from "react";
import { Field, Notice, PageHeader, SecretInput, StatusPill, Step } from "../ui";
import {
  EnvFieldHint,
  KeychainNote,
  McpMeta,
  RunOnDeviceBlock,
} from "./mcp-connection-ui";
import { IconPicker } from "./icon-picker";
import { McpIcon } from "./mcp-icon";
import type { CardState } from "./use-mcp-manager";


export function McpErrorHelp({ error }: { error: string }) {
  const { title, steps } = parseMcpErrorMessage(error);
  return (
    <Notice tone="danger" title="Couldn’t connect">
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

/**
 * A built-in connector's setup, as its own page (`/settings/mcp/<id>`): how
 * it runs, the keys it needs, then connect — the same steps as a model
 * provider's page.
 */
export function McpDetailsPage({
  server,
  connectOnSave,
  conn,
  live,
  state,
  busy,
  available,
  onDone,
  onApply,
}: {
  server: McpDef;
  /** Opened from Connect: saving also turns the server on. */
  connectOnSave?: boolean;
  conn?: McpConnection;
  live?: McpServerStatus;
  state: CardState;
  busy: boolean;
  available: boolean;
  onDone: () => void;
  onApply: (id: string, patch: Partial<McpConnection>) => Promise<boolean>;
}) {
  const ids = useId();
  const enabled = !!conn?.enabled;
  const [env, setEnv] = useState<Record<string, string>>(() => ({ ...conn?.env }));
  const [variantId, setVariantId] = useState(conn?.variantId ?? server.variants?.[0]?.id);
  const [customCommand, setCustomCommand] = useState(conn?.customCommand ?? "");
  const [submitted, setSubmitted] = useState(false);
  const [icon, setIcon] = useState(() => getConnectorIcon(server.id));

  const draft: McpConnection = {
    enabled,
    env,
    variantId,
    customCommand: customCommand.trim() || undefined,
  };
  const missing = (server.envVars ?? []).filter((f) => f.required && !env[f.var]?.trim());
  // Saving turns it on unless it was deliberately left off.
  const willConnect = enabled || connectOnSave !== false;
  const runCommand = effectiveCommand(server, draft);
  const custom = !!customCommand.trim();
  const activeVariant = server.variants?.find((v) => v.id === variantId);
  const runWarning =
    server.runWarning ??
    (activeVariant?.id === "docker" || runCommand.startsWith("docker ")
      ? "Downloads a container image and runs it with your permissions."
      : undefined);
  const hasKeys = !!server.envVars?.length;

  async function save(event: FormEvent) {
    event.preventDefault();
    setSubmitted(true);
    if (willConnect && missing.length > 0) return;
    setConnectorIcon(server.id, icon);
    const ok = await onApply(server.id, {
      env: Object.fromEntries(Object.entries(env).filter(([, v]) => v.trim())),
      variantId,
      customCommand: draft.customCommand,
      enabled: willConnect,
    });
    if (ok) onDone();
  }

  async function disconnect() {
    if (await onApply(server.id, { enabled: false })) onDone();
  }

  let n = 0;
  return (
    <form onSubmit={save} className="flex flex-col gap-8">
      <PageHeader
        back={{ label: "Connectors", onClick: onDone }}
        media={
          <IconPicker
            value={icon}
            onChange={setIcon}
            className="size-12 rounded-xl"
            fallback={<McpIcon server={server} plain className="size-full rounded-xl [&_svg]:size-7" />}
          />
        }
        title={
          <>
            {server.name}
            <StatusPill tone={state.tone}>{state.label === "Connect" ? "Not connected" : state.label}</StatusPill>
          </>
        }
        description={
          <span className="flex flex-col gap-1">
            <span>{server.description}</span>
            <McpMeta server={server} />
          </span>
        }
      />

      {(server.setup || (enabled && live?.status === "failed" && live.error)) && (
        <div className="flex max-w-3xl flex-col gap-3">
          {server.setup && <Notice>{server.setup}</Notice>}
          {enabled && live?.status === "failed" && live.error && <McpErrorHelp error={live.error} />}
        </div>
      )}

      <div className="flex max-w-3xl flex-col">
        <Step
          n={++n}
          title="How it runs"
          description={custom ? "Your own command, below under Advanced." : "On this computer, started when a Cowork chat needs it."}
          done
        >
          {server.variants && !custom && (
            <Field label="Connection mode" htmlFor={`${ids}-variant`}>
              <Select value={variantId} onValueChange={setVariantId}>
                <SelectTrigger id={`${ids}-variant`} className="h-10 w-full max-w-lg text-sm">
                  <SelectValue placeholder="Choose how to run this server" />
                </SelectTrigger>
                <SelectContent>
                  {server.variants.map((v) => (
                    <SelectItem key={v.id} value={v.id} className="py-2.5">
                      {v.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}
          <RunOnDeviceBlock command={runCommand} />
          {runWarning && (
            <p className="flex gap-2 text-xs leading-relaxed text-muted-foreground">
              <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
              {runWarning}
            </p>
          )}
        </Step>

        {hasKeys && (
          <Step
            n={++n}
            title="Add its keys"
            description="Stored on this device only and passed to the server — never sent to the AI model."
            done={missing.length === 0}
          >
            <div className="flex max-w-lg flex-col gap-4">
              {server.envVars!.map((field) => {
                const id = `${ids}-${field.var}`;
                const props = {
                  id,
                  value: env[field.var] ?? "",
                  onChange: (e: ChangeEvent<HTMLInputElement>) => setEnv((prev) => ({ ...prev, [field.var]: e.target.value })),
                  placeholder: field.placeholder,
                  "aria-invalid": (submitted && field.required && !env[field.var]?.trim()) || undefined,
                };
                return (
                  <div key={field.var} className="flex flex-col gap-1.5">
                    <label htmlFor={id} className="text-[13px] font-semibold">
                      {field.label}
                      {!field.required && <span className="ml-1.5 font-normal text-muted-foreground">(optional)</span>}
                    </label>
                    {field.secret ? <SecretInput {...props} /> : <Input {...props} spellCheck={false} className="h-10" />}
                    <EnvFieldHint field={field} />
                    {submitted && field.required && !env[field.var]?.trim() && (
                      <p className="text-xs text-red-600 dark:text-red-400">Required</p>
                    )}
                  </div>
                );
              })}
            </div>
          </Step>
        )}

        <Step
          n={++n}
          title={enabled ? "Connected" : "Connect"}
          description={
            available
              ? "Save & connect turns it on for Cowork chats, Codex and the other agents Mali shares connectors with."
              : "OpenCode isn’t running, so it’s saved now and connects once OpenCode starts (see Models → CLI agents)."
          }
          done={enabled && live?.status === "connected"}
          last
        >
          {!hasKeys && <KeychainNote />}
        </Step>
      </div>

      <details className="group max-w-3xl border-t border-border/60 pt-4" open={custom || undefined}>
        <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[13px] font-medium text-muted-foreground hover:text-foreground">
          <ChevronDownIcon className="size-4 -rotate-90 transition-transform group-open:rotate-0" />
          Advanced — custom command
        </summary>
        <div className="pt-5 pl-5">
          <Field label="Command" htmlFor={`${ids}-cmd`} hint="Runs without a shell. Quote paths with spaces; leave empty for the default.">
            <Input
              id={`${ids}-cmd`}
              value={customCommand}
              onChange={(e) => setCustomCommand(e.target.value)}
              placeholder={server.command}
              spellCheck={false}
              className="h-10 max-w-lg font-mono text-xs"
            />
          </Field>
        </div>
      </details>

      <div className="sticky bottom-0 z-10 -mx-1 flex items-center justify-between gap-2 border-t border-border/60 bg-background/90 px-1 py-3 backdrop-blur">
        {enabled ? (
          <Button type="button" variant="ghost" className="text-muted-foreground hover:text-destructive" disabled={busy} onClick={() => void disconnect()}>
            Disconnect
          </Button>
        ) : (
          <span />
        )}
        <div className="flex items-center gap-2">
          {busy && server.id === "word" && <span className="hidden text-xs text-muted-foreground sm:inline">First run may take 1–2 min to download.</span>}
          <Button type="button" variant="ghost" onClick={onDone}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy} className="h-10 gap-1.5 px-5">
            {busy && <LoaderIcon className="size-4 animate-spin" />}
            {willConnect ? (enabled ? "Save & reconnect" : "Save & connect") : "Save"}
          </Button>
        </div>
      </div>
    </form>
  );
}
