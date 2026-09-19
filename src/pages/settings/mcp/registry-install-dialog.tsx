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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  checkInstall,
  closeInstallRequest,
  diagnoseMcpBinaries,
  installConnector,
  installedFromRegistry,
  installOptions,
  oauthLimitFor,
  registryConnector,
  registryPublisher,
  searchRegistry,
  cancelSignIn,
  signInConnector,
  useCustomMcps,
  useInstallRequest,
  type McpServerStatus,
  type RegistryServer,
} from "@/features/mcp";
import { useOpencode } from "@/features/opencode";
import { openUrl } from "@tauri-apps/plugin-opener";
import { cn } from "@/lib/utils";
import {
  BookOpenIcon,
  ExternalLinkIcon,
  GlobeIcon,
  LoaderIcon,
  LockKeyholeIcon,
  LogInIcon,
  ShieldAlertIcon,
  SparklesIcon,
} from "lucide-react";
import { useEffect, useId, useMemo, useState, type ChangeEvent } from "react";
import { CopyCommand, Field, Notice, SecretInput } from "../ui";
import { RegistryIcon } from "./connector-icon";
import { InstallMethodSelect } from "./install-method-select";
import { McpErrorHelp } from "./mcp-details-dialog";
import { OAuthLimitBanner } from "./oauth-limit-banner";

/** Install a connector from the MCP Registry. Mounted once; opened with `requestConnectorInstall`. */
export function RegistryInstallDialog() {
  const request = useInstallRequest();
  const [picked, setPicked] = useState<RegistryServer | null>(null);

  useEffect(() => setPicked(request?.server ?? null), [request]);

  const close = () => closeInstallRequest();

  return (
    <Dialog open={!!request} onOpenChange={(open) => !open && close()}>
      <DialogContent className="max-h-[calc(100svh-2rem)] gap-5 overflow-y-auto sm:max-w-lg">
        {request &&
          (picked ? (
            <InstallForm key={picked.name} server={picked} fromChat={!!request.fromChat} onClose={close} />
          ) : (
            <PickServer query={request.query ?? ""} onPick={setPicked} onClose={close} />
          ))}
      </DialogContent>
    </Dialog>
  );
}

/** The AI asked for "something like X": let the user choose the registry entry. */
function PickServer({ query, onPick, onClose }: { query: string; onPick: (s: RegistryServer) => void; onClose: () => void }) {
  const [results, setResults] = useState<RegistryServer[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    searchRegistry(query, null, 8)
      .then((page) => setResults(page.servers))
      .catch((e) => setError(String(e)));
  }, [query]);

  return (
    <>
      <DialogHeader className="pr-8">
        <DialogTitle>Choose a connector</DialogTitle>
        <DialogDescription>Results for “{query}” in the MCP Registry.</DialogDescription>
      </DialogHeader>
      {error && <Notice tone="danger">{error}</Notice>}
      {!results && !error && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <LoaderIcon className="size-4 animate-spin" /> Searching…
        </p>
      )}
      {results?.length === 0 && <p className="text-sm text-muted-foreground">Nothing found.</p>}
      {results && results.length > 0 && (
        <ul className="flex flex-col divide-y divide-border/60 rounded-xl border border-border/60">
          {results.map((server) => (
            <li key={server.name}>
              <button
                type="button"
                onClick={() => onPick(server)}
                className="flex w-full min-w-0 items-center gap-3 p-3 text-left hover:bg-muted/40"
              >
                <RegistryIcon icons={server.icons} size={32} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{server.title}</span>
                  <span className="block truncate text-xs text-muted-foreground">{server.description}</span>
                  <span className="block truncate text-[11px] text-muted-foreground/70">{server.name}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      </DialogFooter>
    </>
  );
}

function hostOf(url?: string) {
  try {
    return url ? new URL(url).host : "";
  } catch {
    return "";
  }
}

function InstallForm({ server, fromChat, onClose }: { server: RegistryServer; fromChat: boolean; onClose: () => void }) {
  const ids = useId();
  const opencode = useOpencode();
  const available = !!opencode.check?.available;
  const custom = useCustomMcps();
  const existing = installedFromRegistry(server.name, custom);
  const options = useMemo(() => installOptions(server), [server]);
  const firstUsable = options.find((o) => !o.unsupported) ?? options[0];
  const [optionId, setOptionId] = useState(firstUsable?.id);
  const option = options.find((o) => o.id === optionId) ?? firstUsable;
  const [values, setValues] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState(false);
  const [phase, setPhase] = useState<"form" | "installing" | "signing-in">("form");
  const [status, setStatus] = useState<McpServerStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [missingBinary, setMissingBinary] = useState<string | null>(null);
  const [signInFailed, setSignInFailed] = useState(false);

  // Say up front when the method needs a program that isn't installed.
  useEffect(() => {
    setMissingBinary(null);
    const needs = option?.needs;
    if (!needs) return;
    void diagnoseMcpBinaries()
      .then((d) => setMissingBinary(d.binaries.some((b) => b.binary === needs && !b.found) ? needs : null))
      .catch(() => undefined);
  }, [option?.needs]);

  if (!option) {
    return (
      <>
        <Header server={server} />
        <Notice tone="warning" title="Can’t install this one here">
          It has no install method this app supports (npm, PyPI, Docker or a remote https server).
        </Notice>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </>
    );
  }

  const problems = checkInstall(option, values);
  const limit = server.remotes.map((r) => oauthLimitFor(r.url)).find(Boolean);
  const built = option.build(values);
  const connectorId = existing?.id;

  const install = async () => {
    setSubmitted(true);
    if (problems.length || option.unsupported) return;
    setError(null);
    setPhase("installing");
    try {
      const { connector, env } = registryConnector(server, option, values, existing);
      const result = await installConnector(connector, env);
      setStatus(result ?? { id: connector.id, status: "unknown" });
      // Remote servers that use OAuth ask to sign in right away.
      if (result?.status === "needs_auth") await signIn(connector.id);
    } catch (e) {
      setError(String(e));
    } finally {
      setPhase("form");
    }
  };

  const signIn = async (id = status?.id ?? connectorId, fresh = false) => {
    if (!id) return;
    setError(null);
    setSignInFailed(false);
    setPhase("signing-in");
    try {
      setStatus(await signInConnector(id, { fresh }));
    } catch (e) {
      setError(String(e).replace(/^Error: /, ""));
      setSignInFailed(true);
    } finally {
      setPhase("form");
    }
  };
  const signingInId = status?.id ?? connectorId;

  const setValue = (key: string) => (e: ChangeEvent<HTMLInputElement>) =>
    setValues((prev) => ({ ...prev, [key]: e.target.value }));

  const done = !!status && !["failed", "needs_auth", "needs_client_registration"].includes(status.status);
  const secretFields = option.fields.some((f) => f.secret);

  return (
    <>
      <Header server={server} />

      {fromChat && !status && (
        <Notice tone="info" title="Suggested by the AI">
          Check the publisher and what will run before installing. Enter keys here, never in the chat.
        </Notice>
      )}

      {done ? (
        <Notice title={`${server.title} is connected`}>
          The AI can use it in Chat and Cowork. Manage it in Settings → Connectors.
        </Notice>
      ) : (
        <>
          {options.length > 1 && (
            <Field label="Install method" htmlFor={`${ids}-method`}>
              <InstallMethodSelect
                id={`${ids}-method`}
                options={options}
                value={option.id}
                onChange={setOptionId}
              />
            </Field>
          )}
          {limit && option.kind === "remote" && option.unsupported && (
            <OAuthLimitBanner limit={limit} />
          )}
          {option.note && (
            <Notice tone="warning" title="Before you connect">
              {option.note}
            </Notice>
          )}
          {option.unsupported && !limit && <Notice tone="warning">{option.unsupported}</Notice>}

          {option.fields.map((field) => {
            const id = `${ids}-${field.key}`;
            const value = values[field.key] ?? "";
            const missing = submitted && field.required && !value.trim() && !field.defaultValue;
            const hint = (
              <>
                {field.description && <span className="block">{field.description}</span>}
                {field.target === "env" && <code className="font-mono">{field.label}</code>}
              </>
            );
            return (
              <Field
                key={field.key}
                label={field.target === "header" ? `${field.label} header` : field.label}
                htmlFor={id}
                optional={!field.required}
                hint={hint}
                error={missing ? "Required" : null}
              >
                {field.choices?.length ? (
                  <Select
                    value={value || field.defaultValue || undefined}
                    onValueChange={(v) => setValues((prev) => ({ ...prev, [field.key]: v }))}
                  >
                    <SelectTrigger id={id} className="w-full">
                      <SelectValue placeholder="Choose…" />
                    </SelectTrigger>
                    <SelectContent>
                      {field.choices.map((choice) => (
                        <SelectItem key={choice} value={choice}>
                          {choice}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : field.secret ? (
                  <SecretInput id={id} value={value} onChange={setValue(field.key)} autoComplete="off" />
                ) : (
                  <Input
                    id={id}
                    value={value}
                    onChange={setValue(field.key)}
                    placeholder={field.defaultValue}
                    spellCheck={false}
                    autoComplete="off"
                  />
                )}
              </Field>
            );
          })}

          {secretFields && (
            <p className="-mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
              <LockKeyholeIcon className="size-3.5 shrink-0" />
              Keys are stored in your system keychain and never sent to the AI.
            </p>
          )}

          {option.kind === "local" ? (
            <div className="flex flex-col gap-2">
              <p className="text-sm font-medium">Will run on this computer</p>
              <CopyCommand command={built.command ?? ""} />
              <p className="flex gap-1.5 text-xs text-muted-foreground">
                <ShieldAlertIcon className="mt-0.5 size-3.5 shrink-0" />
                Downloads {option.needs === "docker" ? "a container image" : "a package"} and runs it with your
                account’s permissions. Install only from publishers you trust.
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              <p className="text-sm font-medium">Connects to</p>
              <p className="flex items-center gap-1.5 truncate font-mono text-xs text-muted-foreground">
                <GlobeIcon className="size-3.5 shrink-0" />
                {built.url}
              </p>
              <p className="text-xs text-muted-foreground">
                {/^http:\/\/(127\.0\.0\.1|localhost)/.test(built.url ?? "")
                  ? "A server running on this computer; nothing is sent over the internet."
                  : `If it needs an account, you’ll sign in with ${hostOf(built.url) || "the service"} in your browser.`}
              </p>
            </div>
          )}

          {missingBinary && (
            <Notice tone="warning" title={`${missingBinary} isn’t installed`}>
              {missingBinary === "docker"
                ? "Install Docker Desktop and start it, then try again."
                : missingBinary === "uvx"
                  ? "Install uv (Settings → Connectors shows the command), then restart the app."
                  : "Install Node.js from nodejs.org, then restart the app."}
            </Notice>
          )}
        </>
      )}

      {status?.status === "needs_auth" && phase !== "signing-in" && (
        <Notice tone="warning" title="Sign-in needed">
          {server.title} needs you to sign in. Your browser opens the {hostOf(built.url) || "service"} page; tokens stay
          on this device.
        </Notice>
      )}
      {status?.status === "needs_client_registration" && (
        <Notice tone="warning" title="Can’t sign in automatically">
          This server doesn’t let apps register for sign-in. Add a token in the header field instead, if it offers one.
        </Notice>
      )}
      {status?.status === "failed" && status.error && <McpErrorHelp error={status.error} />}
      {error && <Notice tone="danger">{error}</Notice>}
      {phase === "signing-in" && (
        <div className="flex flex-col gap-2 text-sm text-muted-foreground">
          {/* The consent page names Mali Cowork as the app asking for access. */}
          <div className="flex items-center gap-3 rounded-xl border border-border/60 bg-muted/30 p-3">
            <img src="/icon.ico" alt="" className="size-8 rounded-lg" />
            <span aria-hidden className="text-muted-foreground/60">→</span>
            <RegistryIcon icons={server.icons} size={32} />
            <p className="min-w-0 flex-1 text-xs">
              <span className="font-medium text-foreground">Mali Cowork</span> is asking {server.title} for access. The
              sign-in page shows Mali Cowork as the app.
            </p>
          </div>
          <p className="flex items-center gap-2">
            <LoaderIcon className="size-4 animate-spin" /> Finish signing in in your browser…
          </p>
          <p className="text-xs">
            If the page shows an error instead of a login, press Cancel here and try Start over.
          </p>
        </div>
      )}
      {signInFailed && phase === "form" && (
        <p className="text-xs text-muted-foreground">
          “Start over” forgets this app’s earlier sign-in registration with {hostOf(built.url) || "the service"} and
          signs in again.
        </p>
      )}
      {!available && !done && <Notice tone="warning">Connectors run through OpenCode. Set it up in Settings → Agents.</Notice>}

      <DialogFooter>
        {phase === "signing-in" && signingInId ? (
          <Button type="button" variant="ghost" onClick={() => cancelSignIn(signingInId)}>
            Cancel sign-in
          </Button>
        ) : (
          <Button type="button" variant="ghost" onClick={onClose}>
            {done ? "Done" : "Cancel"}
          </Button>
        )}
        {status?.status === "needs_auth" && signInFailed && (
          <Button type="button" variant="outline" disabled={phase !== "form"} onClick={() => void signIn(undefined, true)}>
            Start over
          </Button>
        )}
        {status?.status === "needs_auth" && (
          <Button type="button" className="gap-1.5" disabled={phase !== "form"} onClick={() => void signIn()}>
            <LogInIcon className="size-4" />
            Sign in
          </Button>
        )}
        {!done && status?.status !== "needs_auth" && (
          <Button
            type="button"
            className="gap-1.5"
            disabled={phase !== "form" || !available || !!option.unsupported || (submitted && problems.length > 0)}
            onClick={() => void install()}
          >
            {phase === "installing" ? <LoaderIcon className="size-4 animate-spin" /> : <SparklesIcon className="size-4" />}
            {existing ? "Update & connect" : status?.status === "failed" ? "Try again" : "Install & connect"}
          </Button>
        )}
      </DialogFooter>
      {submitted && problems.length > 0 && (
        <ul className="-mt-2 list-disc pl-5 text-xs text-red-600 dark:text-red-400">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
    </>
  );
}

function Header({ server }: { server: RegistryServer }) {
  return (
    <DialogHeader className="flex-row items-start gap-3 space-y-0 pr-8 text-left">
      <RegistryIcon icons={server.icons} size={44} className="rounded-xl" />
      <div className="min-w-0 flex-1">
        <DialogTitle className="truncate">{server.title}</DialogTitle>
        <DialogDescription asChild>
          <div className="flex flex-col gap-1.5 pt-1">
            <span className="text-sm">{server.description}</span>
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
              <span title="Publisher (MCP Registry namespace)" className="font-mono">
                {registryPublisher(server.name)}
              </span>
              {server.version && <span>v{server.version}</span>}
              {server.websiteUrl && (
                <button type="button" onClick={() => void openUrl(server.websiteUrl!)} className={linkClass}>
                  <ExternalLinkIcon className="size-3" /> Website
                </button>
              )}
              {server.repositoryUrl && (
                <button type="button" onClick={() => void openUrl(server.repositoryUrl!)} className={linkClass}>
                  <BookOpenIcon className="size-3" /> Source
                </button>
              )}
            </span>
          </div>
        </DialogDescription>
      </div>
    </DialogHeader>
  );
}

const linkClass = cn("inline-flex items-center gap-1 underline-offset-2 hover:text-foreground hover:underline");

