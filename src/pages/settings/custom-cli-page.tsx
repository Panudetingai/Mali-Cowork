import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toast } from "@/components/ui/sonner";
import { iconFromUrl } from "@/features/mcp";
import {
  canInstallForUser,
  checkCustomCli,
  CLI_PRESETS,
  cliArgs,
  cliModels,
  discoverCustomCliModels,
  getCustomCli,
  installCustomCli,
  modelsFromList,
  openCliSignIn,
  presetForDraft,
  customCliIconFromFile,
  normalizeCustomCliIcon,
  removeCustomCli,
  saveCustomCli,
  type CliCheck,
  type CliPreset,
  type CustomCliModel,
  type CustomCliInput,
} from "@/features/custom-cli";
import { ProviderLogo } from "@/features/providers";
import { cn } from "@/lib/utils";
import { cliGenerateStream } from "@/pages/chat/api/cli";
import {
  CheckIcon,
  ChevronDownIcon,
  DownloadIcon,
  ImageUpIcon,
  LinkIcon,
  LoaderIcon,
  LogInIcon,
  PencilIcon,
  PlayIcon,
  RotateCcwIcon,
  SearchIcon,
  WrenchIcon,
} from "lucide-react";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { CopyCommand, Field, Notice, PageHeader, SectionLabel, StatusPill } from "./ui";

const EMPTY: CustomCliInput = { name: "", command: "", args: "{prompt}", models: "" };

/** Shown in the form: what Mali will actually run. */
function preview(draft: CustomCliInput, model?: string) {
  const quote = (a: string) => (/[\s"']/.test(a) ? JSON.stringify(a) : a);
  const args = cliArgs(draft, model);
  const withPrompt = draft.args.includes("{prompt}") ? args : [...args, "{prompt}"];
  return [draft.command.trim() || "<command>", ...withPrompt.map((a) => (a.includes("{prompt}") ? a.replace("{prompt}", "“your message”") : quote(a)))].join(" ");
}

function applyPreset(preset: CliPreset): CustomCliInput {
  return { name: preset.name, command: preset.command, args: preset.args, models: preset.models };
}

/**
 * Settings → Models → CLI agents → Add CLI (`cli/new`) or one already added
 * (`cli/<id>`): for well-known CLIs a guided setup that installs and signs
 * in with buttons, no Terminal typing; advanced fields for the rest.
 */
export function CustomCliPage({ id, onDone }: { id: string; onDone: () => void }) {
  const existing = id === "new" ? undefined : getCustomCli(id);
  const [draft, setDraft] = useState<CustomCliInput>(existing ?? EMPTY);
  const [attempted, setAttempted] = useState(false);
  const [check, setCheck] = useState<(CliCheck & { command: string }) | null>(null);
  const [checking, setChecking] = useState(false);
  const [advanced, setAdvanced] = useState(!!existing);
  const [customMode, setCustomMode] = useState(!!existing);
  const [listed, setListed] = useState<CustomCliModel[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [modelsFallback, setModelsFallback] = useState(false);
  const [modelFetchError, setModelFetchError] = useState<string>();
  /** Which preset CLIs are already on this computer, for the cards. */
  const [installed, setInstalled] = useState<Record<string, boolean>>({});
  const ids = { name: useId(), command: useId(), args: useId() };
  const set = (patch: Partial<CustomCliInput>) => setDraft((prev) => ({ ...prev, ...patch }));

  const name = draft.name.trim();
  const command = draft.command.trim();
  const canSave = !!name && !!command;
  const models = cliModels(draft);
  const preset = presetForDraft(draft);
  const guided = !existing && !customMode;

  useEffect(() => {
    if (existing) return;
    let live = true;
    for (const p of CLI_PRESETS) {
      checkCustomCli(p.command)
        .then((r) => live && setInstalled((prev) => ({ ...prev, [p.command]: r.available })))
        .catch(() => {});
    }
    return () => {
      live = false;
    };
  }, [existing]);

  async function loadModels(cmd: string, forPreset?: CliPreset) {
    setLoadingModels(true);
    setModelFetchError(undefined);
    try {
      const { models: list, fromFallback } = await discoverCustomCliModels(cmd, forPreset ?? presetForDraft({ ...draft, command: cmd }));
      setListed(list);
      setModelsFallback(fromFallback);
      set({ models: list.length > 0 ? modelsFromList(list) : "" });
    } catch (e) {
      setListed([]);
      setModelFetchError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingModels(false);
    }
  }

  async function detect(cmd = command) {
    if (!cmd) return;
    setChecking(true);
    try {
      const result = { ...(await checkCustomCli(cmd)), command: cmd };
      setCheck(result);
      setInstalled((prev) => ({ ...prev, [cmd]: result.available }));
      if (result.available) void loadModels(cmd);
    } catch (e) {
      setCheck({ available: false, error: String(e), command: cmd });
    } finally {
      setChecking(false);
    }
  }

  useEffect(() => {
    if (existing?.command) void detect(existing.command.trim());
    // Only once when opening an existing CLI for edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existing?.id]);

  function pickPreset(p: CliPreset) {
    setDraft(applyPreset(p));
    setCustomMode(false);
    setAdvanced(false);
    setCheck(null);
    setListed([]);
    void detect(p.command);
  }

  function pickCustom() {
    setDraft(EMPTY);
    setCustomMode(true);
    setAdvanced(true);
    setCheck(null);
    setListed([]);
  }

  function save(event: FormEvent) {
    event.preventDefault();
    setAttempted(true);
    if (!canSave) return;
    saveCustomCli(draft, existing?.id);
    toast.success(`${name} is in the model picker`, {
      description: models.length ? `${models.length} model${models.length === 1 ? "" : "s"}` : "With its own default model.",
    });
    onDone();
  }

  function remove() {
    if (!existing) return;
    removeCustomCli(existing.id);
    toast(`${existing.name} removed`);
    onDone();
  }

  if (id !== "new" && !existing) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader back={{ label: "Models", onClick: onDone }} title="CLI not found" description="It may have been removed." />
      </div>
    );
  }

  const found = !!check?.available && check.command === command;
  const oneClick = canInstallForUser(preset);

  return (
    <form onSubmit={save} className="flex flex-col gap-8">
      <PageHeader
        back={{ label: "Models", onClick: onDone }}
        icon={
          <ProviderLogo
            logo="terminal"
            name={name || "CLI"}
            className="size-7"
            imageUrl={normalizeCustomCliIcon(draft.icon)}
          />
        }
        title={existing ? existing.name : "Add a CLI agent"}
        description={
          existing
            ? "How Mali runs this program in the chat folder. Change only if you know the CLI’s flags."
            : "Pick an agent, press Install, press Sign in — that’s it. No typing in Terminal needed."
        }
      />

      {!existing && (
        <section className="flex max-w-3xl flex-col gap-4">
          <SectionLabel>1 · Choose an agent</SectionLabel>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {CLI_PRESETS.map((p) => {
              const on = draft.name === p.name && draft.command === p.command && !customMode;
              return (
                <button
                  key={p.name}
                  type="button"
                  onClick={() => pickPreset(p)}
                  className={cn(
                    "flex flex-col items-start gap-1 rounded-xl border p-3 text-left transition-colors",
                    on ? "border-primary bg-primary/10" : "border-border/70 hover:border-foreground/25",
                  )}
                >
                  <span className="flex w-full items-center justify-between gap-2 text-sm font-medium">
                    {p.name}
                    {installed[p.command] && (
                      <span className="flex items-center gap-1 text-[11px] font-normal text-emerald-700 dark:text-emerald-400">
                        <CheckIcon className="size-3" /> Installed
                      </span>
                    )}
                  </span>
                  <span className="text-[12px] leading-relaxed text-muted-foreground">{p.hint}</span>
                </button>
              );
            })}
            <button
              type="button"
              onClick={pickCustom}
              className={cn(
                "flex flex-col items-start gap-1 rounded-xl border border-dashed p-3 text-left transition-colors",
                customMode ? "border-primary bg-primary/10" : "border-border/70 hover:border-foreground/25",
              )}
            >
              <span className="flex items-center gap-1.5 text-sm font-medium">
                <WrenchIcon className="size-3.5 text-muted-foreground" />
                Other CLI
              </span>
              <span className="text-[12px] text-muted-foreground">For developers: any program that accepts a prompt on the command line.</span>
            </button>
          </div>
        </section>
      )}

      <div className="flex max-w-xl flex-col gap-6">
        {(existing || customMode) && (
          <>
            <Field label="Name" htmlFor={ids.name} error={attempted && !name ? "Give it a name" : null}>
              <Input id={ids.name} value={draft.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Claude Code" className="h-10" />
            </Field>
            <CliIconField draft={draft} onChange={set} label={name || "CLI"} />
            <Field
              label="Command"
              htmlFor={ids.command}
              error={attempted && !command ? "Which program to run" : null}
              hint="Its name on PATH, or the full path to it."
            >
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  id={ids.command}
                  value={draft.command}
                  onChange={(e) => {
                    set({ command: e.target.value });
                    setCheck(null);
                  }}
                  onBlur={() => command && command !== check?.command && void detect()}
                  placeholder="e.g. claude"
                  spellCheck={false}
                  className="h-10 font-mono text-[13px]"
                />
                <Button type="button" variant="outline" className="h-10 gap-1.5" onClick={() => void detect()} disabled={!command || checking}>
                  {checking ? <LoaderIcon className="size-4 animate-spin" /> : <SearchIcon className="size-4" />}
                  Find it
                </Button>
              </div>
            </Field>
            {check && check.command === command && (
              <div className="-mt-3 flex flex-col gap-1">
                <StatusPill tone={check.available ? "success" : "danger"} className="w-fit">
                  {check.available ? `Found${check.version ? ` · ${check.version.split("\n")[0]}` : ""}` : "Not found on this computer"}
                </StatusPill>
                {check.path && <p className="font-mono text-[12px] text-muted-foreground wrap-anywhere">{check.path}</p>}
              </div>
            )}
          </>
        )}

        {(guided ? !!preset : !found && !!preset) && preset && (
          <InstallStep
            preset={preset}
            found={found}
            checking={checking}
            version={found ? check?.version : undefined}
            onRecheck={() => void detect(preset.command)}
          />
        )}

        {found && preset && (guided || oneClick) && <SignInStep preset={preset} number={guided ? 3 : undefined} />}

        {canSave && found && <TryCli draft={draft} number={guided ? 4 : undefined} />}

        {guided && found && canSave && !customMode && !existing && (
          <CliIconField draft={draft} onChange={set} label={name || preset?.name || "CLI"} />
        )}

        {found && (
          <ModelsSection
            loading={loadingModels}
            models={listed.length > 0 ? listed : models.map((id) => ({ id, name: id }))}
            count={models.length}
            fallback={modelsFallback}
            error={modelFetchError}
            onRefresh={() => void loadModels(command)}
          />
        )}

        {(existing || customMode) && (
          <>
            <button
              type="button"
              onClick={() => setAdvanced((v) => !v)}
              className="flex w-fit items-center gap-1 text-[12px] font-medium text-muted-foreground hover:text-foreground"
            >
              <ChevronDownIcon className={cn("size-3.5 transition-transform", advanced && "rotate-180")} />
              {advanced ? "Hide advanced settings" : "Advanced settings (arguments only)"}
            </button>
            {advanced && (
              <>
                <Field
                  label="Arguments"
                  htmlFor={ids.args}
                  hint={
                    <>
                      Leave the default unless the CLI docs say otherwise. <code className="font-mono">{"{prompt}"}</code> is your message;{" "}
                      <code className="font-mono">{"{model}"}</code> is optional.
                    </>
                  }
                >
                  <Input
                    id={ids.args}
                    value={draft.args}
                    onChange={(e) => set({ args: e.target.value })}
                    placeholder="-p {prompt}"
                    spellCheck={false}
                    className="h-10 font-mono text-[13px]"
                  />
                </Field>
                <div className="flex flex-col gap-1.5">
                  <p className="text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">Mali will run</p>
                  <code className="rounded-lg bg-muted/60 px-3 py-2 font-mono text-[12px] wrap-anywhere">{preview(draft, models[0])}</code>
                </div>
              </>
            )}
          </>
        )}
      </div>

      <div className="sticky bottom-0 z-10 -mx-1 flex items-center justify-between gap-2 border-t border-border/60 bg-background/90 px-1 py-3 backdrop-blur">
        {existing ? (
          <Button type="button" variant="ghost" className="text-muted-foreground hover:text-destructive" onClick={remove}>
            Remove
          </Button>
        ) : (
          <span className="text-[12px] text-muted-foreground">{guided && preset && !found ? `Install ${preset.name} first.` : ""}</span>
        )}
        <div className="flex items-center gap-2">
          <Button type="button" variant="ghost" onClick={onDone}>
            Cancel
          </Button>
          <Button type="submit" disabled={(attempted && !canSave) || (guided && !found)} className="h-10 gap-1.5 px-5">
            <CheckIcon className="size-4" />
            {existing ? "Save" : "Add to model picker"}
          </Button>
        </div>
      </div>
    </form>
  );
}

/** Install with one button (npm, Node.js first if missing), or the command to copy. */
function InstallStep({
  preset,
  found,
  checking,
  version,
  onRecheck,
}: {
  preset: CliPreset;
  found: boolean;
  checking: boolean;
  version?: string;
  onRecheck: () => void;
}) {
  const [state, setState] = useState<{ running?: boolean; log: string[]; error?: string }>({ log: [] });
  const oneClick = canInstallForUser(preset);

  async function install() {
    setState({ running: true, log: [] });
    try {
      await installCustomCli(preset.command, (line) => setState((s) => ({ ...s, log: [...s.log.slice(-3), line] })));
      setState({ log: [] });
      toast.success(`${preset.name} installed`);
      onRecheck();
    } catch (e) {
      setState((s) => ({ log: s.log, error: e instanceof Error ? e.message : String(e) }));
    }
  }

  return (
    <section className="flex flex-col gap-2">
      <SectionLabel>2 · Install on this computer</SectionLabel>
      {checking && !state.running ? (
        <p className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
          <LoaderIcon className="size-3.5 animate-spin" /> Looking for {preset.name}…
        </p>
      ) : found ? (
        <StatusPill tone="success" className="w-fit">
          Installed{version ? ` · ${version.split("\n")[0]}` : ""}
        </StatusPill>
      ) : oneClick ? (
        <>
          <Button type="button" className="h-10 w-fit gap-1.5 px-5" onClick={() => void install()} disabled={state.running}>
            {state.running ? <LoaderIcon className="size-4 animate-spin" /> : <DownloadIcon className="size-4" />}
            {state.running ? "Installing… (about a minute)" : `Install ${preset.name}`}
          </Button>
          {state.log.length > 0 && (
            <pre className="max-h-24 overflow-hidden rounded-md bg-muted/60 px-2 py-1 font-mono text-[11px] whitespace-pre-wrap text-muted-foreground wrap-anywhere">
              {state.log.join("\n")}
            </pre>
          )}
          {state.error && (
            <Notice tone="warning" title="Couldn’t install automatically">
              <div className="flex flex-col gap-2">
                <span className="whitespace-pre-wrap wrap-anywhere">{state.error}</span>
                <span>Or paste this into Terminal, then press Check again:</span>
                <CopyCommand command={preset.install} />
                <Button type="button" variant="outline" size="sm" className="h-8 w-fit" onClick={onRecheck}>
                  Check again
                </Button>
              </div>
            </Notice>
          )}
        </>
      ) : (
        <>
          <p className="text-[13px] text-muted-foreground">Paste this into Terminal, then press Check again:</p>
          <CopyCommand command={preset.install} />
          <Button type="button" variant="outline" size="sm" className="h-8 w-fit gap-1.5" onClick={onRecheck}>
            <SearchIcon className="size-3.5" /> Check again
          </Button>
        </>
      )}
    </section>
  );
}

/** Opens the CLI's own sign-in in a Terminal window. */
function CliIconField({
  draft,
  onChange,
  label,
}: {
  draft: CustomCliInput;
  onChange: (patch: Partial<CustomCliInput>) => void;
  label: string;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const iconUrl = normalizeCustomCliIcon(draft.icon);
  const [open, setOpen] = useState(false);
  const [link, setLink] = useState("");
  const [loading, setLoading] = useState<"file" | "link">();
  const [error, setError] = useState<string>();

  const apply = async (kind: "file" | "link", work: () => Promise<string>) => {
    setLoading(kind);
    setError(undefined);
    try {
      onChange({ icon: await work() });
      setLink("");
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(undefined);
    }
  };

  return (
    <Field
      label="Icon"
      hint="Click the icon to upload a picture, paste an HTTPS link, or reset to the default terminal icon."
    >
      <Popover open={open} onOpenChange={(next) => (setOpen(next), next || setError(undefined))}>
        <PopoverTrigger asChild>
          <button
            type="button"
            title="Change icon"
            aria-label="Change CLI icon"
            className="group/icon relative size-11 shrink-0 overflow-hidden rounded-lg ring-1 ring-border/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <ProviderLogo logo="terminal" name={label} size={44} imageUrl={iconUrl} className="size-full rounded-lg" />
            <span className="absolute inset-0 flex items-center justify-center bg-black/45 text-white opacity-0 transition-opacity group-hover/icon:opacity-100 group-focus-visible/icon:opacity-100 group-data-[state=open]/icon:opacity-100">
              <PencilIcon className="size-4" />
            </span>
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" sideOffset={8} className="w-80 gap-3 rounded-xl p-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">CLI icon</p>
            {iconUrl && (
              <button
                type="button"
                onClick={() => {
                  onChange({ icon: "" });
                  setOpen(false);
                }}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              >
                <RotateCcwIcon className="size-3" />
                Use default
              </button>
            )}
          </div>

          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void apply("file", () => customCliIconFromFile(file));
            }}
          />
          <Button
            type="button"
            variant="outline"
            className="w-full justify-center gap-2"
            disabled={!!loading}
            onClick={() => fileRef.current?.click()}
          >
            {loading === "file" ? <LoaderIcon className="size-4 animate-spin" /> : <ImageUpIcon className="size-4" />}
            Upload image
          </Button>

          <div className="flex items-center gap-2 text-[11px] text-muted-foreground uppercase">
            <span className="h-px flex-1 bg-border" />
            or link
            <span className="h-px flex-1 bg-border" />
          </div>

          <div className="flex gap-2">
            <label className="flex min-w-0 flex-1 items-center gap-2 rounded-md border bg-background px-2.5 focus-within:ring-1 focus-within:ring-ring">
              <LinkIcon className="size-3.5 shrink-0 text-muted-foreground" />
              <input
                value={link}
                onChange={(e) => setLink(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    const trimmed = link.trim();
                    if (!trimmed) return;
                    const direct = normalizeCustomCliIcon(trimmed);
                    if (direct?.startsWith("https://")) {
                      void apply("link", async () => direct);
                      return;
                    }
                    void apply("link", () => iconFromUrl(trimmed));
                  }
                }}
                placeholder="https://example.com/logo.png"
                className="h-8 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/70"
              />
            </label>
            <Button
              type="button"
              size="sm"
              className="h-8"
              disabled={!link.trim() || !!loading}
              onClick={() => {
                const trimmed = link.trim();
                const direct = normalizeCustomCliIcon(trimmed);
                if (direct?.startsWith("https://")) {
                  void apply("link", async () => direct);
                  return;
                }
                void apply("link", () => iconFromUrl(trimmed));
              }}
            >
              {loading === "link" ? <LoaderIcon className="size-4 animate-spin" /> : "Use"}
            </Button>
          </div>

          {error ? (
            <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
          ) : (
            <p className="text-[11px] text-muted-foreground">PNG, JPEG, WebP or GIF — up to 256 KB. Square images look best.</p>
          )}
        </PopoverContent>
      </Popover>
    </Field>
  );
}

function SignInStep({ preset, number }: { preset: CliPreset; number?: number }) {
  const [opening, setOpening] = useState(false);
  const oneClick = canInstallForUser(preset);
  async function signIn() {
    setOpening(true);
    try {
      await openCliSignIn(preset.command);
      toast("Finish signing in in the Terminal window", { description: "Then come back and press Try it." });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setOpening(false);
    }
  }
  return (
    <section className="flex flex-col gap-2">
      <SectionLabel>{number ? `${number} · ` : ""}Sign in</SectionLabel>
      <p className="text-[13px] text-muted-foreground">{preset.signIn}</p>
      {oneClick ? (
        <Button type="button" variant="outline" className="h-9 w-fit gap-1.5" onClick={() => void signIn()} disabled={opening}>
          {opening ? <LoaderIcon className="size-4 animate-spin" /> : <LogInIcon className="size-4" />}
          Sign in to {preset.name}
        </Button>
      ) : (
        preset.signInCommand && <CopyCommand command={preset.signInCommand} />
      )}
      <p className="text-[12px] text-muted-foreground">Already signed in? Skip this.</p>
    </section>
  );
}

function ModelsSection({
  loading,
  models,
  count,
  fallback,
  error,
  onRefresh,
}: {
  loading: boolean;
  models: CustomCliModel[];
  count: number;
  fallback: boolean;
  error?: string;
  onRefresh: () => void;
}) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <SectionLabel>Models in the picker</SectionLabel>
        <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={onRefresh} disabled={loading}>
          {loading ? <LoaderIcon className="size-3.5 animate-spin" /> : "Refresh list"}
        </Button>
      </div>
      {loading && <p className="text-[12px] text-muted-foreground">Asking the CLI which models you can use…</p>}
      {!loading && count > 0 && (
        <>
          <p className="text-[12px] text-muted-foreground">
            {count} model{count === 1 ? "" : "s"} — fetched from the CLI
            {fallback ? " (common defaults until you sign in)" : ""}. You do not need to type these yourself.
          </p>
          <ul className="flex max-h-40 flex-wrap gap-1.5 overflow-y-auto rounded-lg border border-border/60 bg-muted/20 p-2">
            {(models.length ? models : []).slice(0, 80).map((m) => (
              <li key={m.id} className="rounded-md bg-background px-2 py-0.5 font-mono text-[11px] text-foreground/90" title={m.id}>
                {m.name}
              </li>
            ))}
            {count > 80 && <li className="px-2 py-0.5 text-[11px] text-muted-foreground">+{count - 80} more</li>}
          </ul>
        </>
      )}
      {!loading && count === 0 && !error && (
        <p className="text-[12px] text-muted-foreground">No model list yet — one picker entry will use this CLI’s default. Sign in in Terminal, then Refresh list.</p>
      )}
      {error && !loading && <p className="text-[12px] text-amber-700 dark:text-amber-400">{error}</p>}
    </section>
  );
}

/** Run the CLI once with a short prompt, the way a chat would, and show what came back. */
function TryCli({ draft, number }: { draft: CustomCliInput; number?: number }) {
  const [state, setState] = useState<{ running?: boolean; output?: string; error?: string }>({});
  const run = async () => {
    let output = "";
    setState({ running: true });
    try {
      await cliGenerateStream(
        {
          prompt: "Reply with the single word: OK",
          agent: "custom-try",
          // The CLI's own default model: works as soon as it's signed in.
          custom: { name: draft.name.trim(), command: draft.command.trim(), args: cliArgs(draft) },
        },
        {
          onChunk: (text) => {
            output += text;
          },
          onDone: () => setState({ output: output.trim() }),
          onError: (message) => setState({ error: message, output: output.trim() || undefined }),
        },
      );
    } catch (e) {
      setState({ error: e instanceof Error ? e.message : String(e) });
    }
  };
  return (
    <Notice tone={state.error ? "warning" : "info"} title={`${number ? `${number} · ` : ""}Check it works`}>
      <div className="flex flex-col gap-2">
        <span>Sends one short message. The first answer can take 10–20 seconds.</span>
        <Button type="button" variant="outline" size="sm" className="h-8 w-fit gap-1.5" onClick={() => void run()} disabled={state.running}>
          {state.running ? <LoaderIcon className="size-3.5 animate-spin" /> : <PlayIcon className="size-3.5" />}
          {state.running ? "Waiting for an answer…" : "Try it"}
        </Button>
        {state.output && (
          <p className="flex items-center gap-1.5 text-[12px] text-emerald-700 dark:text-emerald-400">
            <CheckIcon className="size-3.5" /> It works — it replied “{state.output.slice(0, 120)}”. Press Add to model picker.
          </p>
        )}
        {state.error && <p className="text-[12px] whitespace-pre-wrap wrap-anywhere">{state.error.slice(0, 800)}</p>}
      </div>
    </Notice>
  );
}
