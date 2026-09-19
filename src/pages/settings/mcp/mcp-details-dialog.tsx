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
import {
  effectiveCommand,
  parseMcpErrorMessage,
  type McpConnection,
  type McpDef,
  type McpServerStatus,
} from "@/features/mcp";
import { cn } from "@/lib/utils";
import { AlertTriangleIcon, ChevronRightIcon, LoaderIcon } from "lucide-react";
import { useId, useState, type ChangeEvent, type FormEvent } from "react";
import { Field, Notice, SecretInput, StatusPill } from "../ui";
import {
  EnvFieldHint,
  KeychainNote,
  McpMeta,
  RunOnDeviceBlock,
} from "./mcp-connection-ui";
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
      <DialogContent className="max-h-[calc(100svh-2rem)] gap-0 overflow-y-auto p-0 sm:max-w-xl">
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
  const runCommand = effectiveCommand(server, draft);
  const activeVariant = server.variants?.find((v) => v.id === variantId);
  const runWarning =
    server.runWarning ??
    (activeVariant?.id === "docker" || runCommand.startsWith("docker ")
      ? "Downloads a container image and runs it with your permissions."
      : undefined);

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
    <form onSubmit={save} className="flex flex-col">
      <div className="flex flex-col gap-5 px-6 pt-6 pb-2">
        <header className="flex gap-4 pr-6">
          <McpIcon server={server} className="size-14 rounded-2xl [&_svg]:size-7" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <DialogTitle className="text-left text-xl font-semibold tracking-tight">
              {server.name}
            </DialogTitle>
            <p className="text-sm leading-relaxed text-muted-foreground">{server.description}</p>
            <McpMeta server={server} />
            <StatusPill tone={state.tone} className="mt-1 w-fit">
              {state.label === "Connect" ? "Not connected" : state.label}
            </StatusPill>
          </div>
        </header>

        {server.setup && <Notice>{server.setup}</Notice>}
        {enabled && live?.status === "failed" && live.error && <McpErrorHelp error={live.error} />}

        {server.variants && !advanced && (
          <Field label="Connection mode" htmlFor={`${ids}-variant`}>
            <Select value={variantId} onValueChange={setVariantId}>
              <SelectTrigger id={`${ids}-variant`} className="h-11 w-full text-sm">
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
                <div key={field.var} className="flex flex-col gap-1.5">
                  <label htmlFor={id} className="text-xs font-semibold tracking-wide text-foreground uppercase">
                    {field.var}
                    {!field.required && (
                      <span className="ml-1.5 font-normal normal-case text-muted-foreground">(optional)</span>
                    )}
                  </label>
                  {field.secret ? <SecretInput {...props} /> : <Input {...props} spellCheck={false} />}
                  <EnvFieldHint field={field} />
                  {submitted && field.required && !env[field.var]?.trim() && (
                    <p className="text-xs text-red-600 dark:text-red-400">Required</p>
                  )}
                </div>
              );
            })}
            <KeychainNote />
          </div>
        ) : (
          <KeychainNote />
        )}

        {!advanced && <RunOnDeviceBlock command={runCommand} />}

        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={() => setAdvanced((v) => !v)}
            aria-expanded={advanced}
            className="flex w-fit items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground"
          >
            <ChevronRightIcon
              className={cn("size-4 transition-transform duration-200", advanced && "rotate-90")}
            />
            Advanced: custom command
          </button>
          {advanced && (
            <Field
              label="Command"
              htmlFor={`${ids}-cmd`}
              hint='Runs without a shell. Quote paths with spaces; leave empty for the default.'
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
          )}
        </div>

        {runWarning && (
          <div className="flex gap-2.5 rounded-xl border border-border/80 bg-muted/30 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
            <AlertTriangleIcon className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <p>{runWarning}</p>
          </div>
        )}

        {!available && (
          <Notice tone="warning">Start OpenCode first (see the Agents tab).</Notice>
        )}
      </div>

      <DialogFooter className="mt-2 flex-col gap-2 border-t bg-muted/20 px-6 py-4 sm:flex-row sm:justify-between">
        {enabled ? (
          <Button type="button" variant="destructive" disabled={busy} onClick={disconnect}>
            Disconnect
          </Button>
        ) : (
          <span className="hidden sm:block" />
        )}
        <div className="flex w-full flex-col-reverse gap-2 sm:w-auto sm:flex-row">
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
        <p className="px-6 pb-3 text-right text-xs text-muted-foreground">
          First run may take 1–2 min to download.
        </p>
      )}
    </form>
  );
}
