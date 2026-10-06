import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/sonner";
import { clearAgentSessions } from "@/features/chat-history";
import { refreshOpencode } from "@/features/opencode";
import {
  checkProviderKey,
  cleanApiKey,
  configOrDefaults,
  listProviderModels,
  ollamaListModels,
  ProviderLogo,
  removeCustomProvider,
  removeProviderConfig,
  saveProviderConfig,
  splitModels,
  syncCliProviders,
  testProviderModel,
  usableModels,
  useEnvKeys,
  useProviderConfigs,
  type ModelTest,
  type ProviderConfig,
  type ProviderDef,
} from "@/features/providers";
import { cn } from "@/lib/utils";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  CheckIcon,
  ChevronDownIcon,
  ExternalLinkIcon,
  LoaderIcon,
  LockKeyholeIcon,
  PlayIcon,
  PlusIcon,
  RefreshCwIcon,
  SearchIcon,
} from "lucide-react";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type ClipboardEvent,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { refreshPuterModels } from "@/features/media/puter-catalog";
import { PuterConnect } from "./puter-connect";
import { Field, Notice, PageHeader, SecretInput, StatusPill, Step } from "./ui";

export function providerStatus(provider: ProviderDef, config: ProviderConfig | undefined, envKeys: string[]) {
  if (usableModels(provider, config, envKeys).length > 0) {
    return !config && envKeys.includes(provider.id)
      ? { tone: "success" as const, label: "From .env" }
      : { tone: "success" as const, label: "Connected" };
  }
  return { tone: "neutral" as const, label: "Not connected" };
}

function hostOf(url: string) {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

/**
 * One provider's setup, as a page of its own (`/settings/models/<id>`):
 * connect the account, tick models straight from the provider's list, check
 * one answers. Address and token limit wait under Advanced.
 */
export function ProviderPage({ provider, onDone }: { provider: ProviderDef; onDone: () => void }) {
  const configs = useProviderConfigs();
  const envKeys = useEnvKeys();
  const saved = configs[provider.id];
  const [draft, setDraft] = useState<ProviderConfig>(() => configOrDefaults(provider, saved));
  const [saving, setSaving] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [attempted, setAttempted] = useState(false);
  const [tested, setTested] = useState(false);
  const ids = { key: useId(), host: useId(), models: useId(), limit: useId() };

  const status = providerStatus(provider, saved, envKeys);
  const hasEnvKey = envKeys.includes(provider.id);
  const models = splitModels(draft.models);
  const missingKey = provider.keyRequired && !draft.apiKey.trim() && !hasEnvKey;
  const badUrl = !!draft.baseUrl.trim() && !/^https?:\/\/\S+$/i.test(draft.baseUrl.trim());
  const canSave = models.length > 0 && !missingKey && !badUrl;
  const isLocalOllama = provider.id === "ollama";
  const isOllama = isLocalOllama || provider.id === "ollama-cloud";
  // Puter's chat models come from Puter's own list, like Ollama's from its server.
  const isPuter = provider.id === "puter";
  const canTest = !isPuter && !isOllama;
  // Added by the user: where it runs is part of connecting it, and Remove forgets it entirely.
  const isCustom = !!provider.custom;
  const baseUrl = draft.baseUrl.trim() || provider.defaultBaseUrl;

  const set = (patch: Partial<ProviderConfig>) => setDraft((prev) => ({ ...prev, ...patch }));

  async function syncAgent() {
    try {
      await syncCliProviders();
      void refreshOpencode();
      return true;
    } catch (e) {
      setSyncError(e instanceof Error ? e.message : String(e));
      return false;
    }
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setAttempted(true);
    if (!canSave || saving) return;
    setSaving(true);
    setSyncError(null);
    // Quotes, a `NAME=` prefix or a stray newline come along with a pasted
    // key often enough to be worth removing here.
    const apiKey = cleanApiKey(draft.apiKey);
    const keyChanged = apiKey !== (saved?.apiKey.trim() ?? "");
    if (keyChanged && apiKey) {
      const check = await checkProviderKey(provider.id, apiKey, baseUrl);
      if (check.status === "rejected") {
        setSaving(false);
        setSyncError(
          check.message
            ? `${provider.name} rejected this key: ${check.message}`
            : `${provider.name} rejected this key. Check that it was copied in full, and that it is still active.`,
        );
        return;
      }
    }
    saveProviderConfig(provider.id, {
      apiKey,
      baseUrl,
      models: models.join(", "),
      contextLimit: draft.contextLimit?.trim() ?? "",
    });
    if (keyChanged) clearAgentSessions();
    const ok = await syncAgent();
    setSaving(false);
    if (ok) {
      toast.success(`${provider.name} is connected`, { description: `${models.length} model${models.length === 1 ? "" : "s"} in the model picker.` });
      onDone();
    }
  }

  /**
   * Signing in to Puter (or pasting a token it accepted) is the setup: it's
   * saved at once, with Puter's default models if none were picked, so the
   * user isn't left one Save away from a working provider.
   */
  function connectPuter(token: string) {
    const next = { ...draft, apiKey: token, models: draft.models.trim() || provider.defaultModels };
    setDraft(next);
    saveProviderConfig(provider.id, {
      apiKey: token,
      baseUrl: next.baseUrl.trim() || provider.defaultBaseUrl,
      models: next.models,
      contextLimit: next.contextLimit?.trim() ?? "",
    });
    clearAgentSessions();
  }

  async function reset() {
    removeProviderConfig(provider.id);
    if (isCustom) removeCustomProvider(provider.id);
    else setDraft(configOrDefaults(provider));
    await syncAgent();
    toast(`${provider.name} removed`);
    onDone();
  }

  const baseUrlField = (
    <Field label="Address" htmlFor={ids.host} error={attempted && badUrl ? "Must start with http:// or https://" : null}>
      <Input
        id={ids.host}
        value={draft.baseUrl}
        onChange={(e) => set({ baseUrl: e.target.value })}
        placeholder={provider.defaultBaseUrl}
        spellCheck={false}
        className="h-10 max-w-lg font-mono text-[13px]"
      />
    </Field>
  );

  return (
    <form onSubmit={save} className="flex flex-col gap-8">
      <PageHeader
        back={{ label: "Models", onClick: onDone }}
        icon={<ProviderLogo logo={provider.logo} name={provider.name} className="size-7" />}
        title={
          <>
            {provider.name}
            <StatusPill tone={status.tone}>{status.label}</StatusPill>
          </>
        }
        description={
          <span className="flex flex-col gap-1">
            <span>{provider.description} Works in Chat and in Cowork agents, with your MCP tools.</span>
            <button
              type="button"
              onClick={() => void openUrl(provider.defaultBaseUrl)}
              className="inline-flex w-fit items-center gap-1 font-mono text-xs text-muted-foreground hover:text-foreground hover:underline"
            >
              {hostOf(provider.defaultBaseUrl)}
              <ExternalLinkIcon className="size-3 opacity-60" />
            </button>
          </span>
        }
      />

      <div className="flex max-w-3xl flex-col">
        {isPuter ? (
          <Step n={1} title="Sign in to Puter" description="Free to start. Signing in saves it at once." done={!missingKey}>
            <PuterConnect apiKey={draft.apiKey} baseUrl={baseUrl} onToken={connectPuter} />
          </Step>
        ) : isCustom ? (
          <Step
            n={1}
            title={provider.group === "local" ? `Reach ${provider.name} on this computer` : `Connect ${provider.name}`}
            description={
              provider.keyRequired
                ? "Check the address, then paste an API key."
                : "Keep the server running. A key is only needed if you set one up on the server."
            }
            done={!missingKey && !badUrl}
          >
            {baseUrlField}
            <div className="flex max-w-lg flex-col gap-2 sm:flex-row">
              <div className="min-w-0 flex-1">
                <SecretInput
                  id={ids.key}
                  aria-label="API key"
                  aria-invalid={(attempted && missingKey) || undefined}
                  value={draft.apiKey}
                  onChange={(e) => set({ apiKey: e.target.value })}
                  placeholder={provider.keyRequired ? "Paste API key" : "API key (optional)"}
                />
              </div>
              {provider.keyUrl && (
                <Button type="button" variant="outline" className="h-10 gap-1.5" onClick={() => void openUrl(provider.keyUrl!)}>
                  Get a key
                  <ExternalLinkIcon className="size-3.5 opacity-70" />
                </Button>
              )}
            </div>
            {attempted && missingKey && <p className="text-[12px] text-red-600 dark:text-red-400">An API key is required.</p>}
          </Step>
        ) : isLocalOllama ? (
          <Step
            n={1}
            title="Run Ollama on this Mac"
            description={
              <>
                Install Ollama and keep <code className="font-mono text-xs">ollama serve</code> running — no key needed.
              </>
            }
            done
          >
            {baseUrlField}
          </Step>
        ) : (
          <Step
            n={1}
            title={`Connect your ${provider.name} account`}
            description={
              hasEnvKey
                ? `Using ${provider.envVar} from .env — paste a key to use another.`
                : provider.keyRequired
                  ? `Create an API key on ${hostOf(provider.keyUrl ?? provider.defaultBaseUrl)}, then paste it here.`
                  : "Optional for this provider."
            }
            done={!missingKey && (!!draft.apiKey.trim() || hasEnvKey)}
          >
            <div className="flex max-w-lg flex-col gap-2 sm:flex-row">
              <div className="min-w-0 flex-1">
                <SecretInput
                  id={ids.key}
                  aria-label="API key"
                  aria-invalid={(attempted && missingKey) || undefined}
                  value={draft.apiKey}
                  onChange={(e) => set({ apiKey: e.target.value })}
                  placeholder={hasEnvKey ? `Using ${provider.envVar} from .env` : "Paste API key"}
                />
              </div>
              {provider.keyUrl && (
                <Button type="button" variant="outline" className="h-10 gap-1.5" onClick={() => void openUrl(provider.keyUrl!)}>
                  Get a key
                  <ExternalLinkIcon className="size-3.5 opacity-70" />
                </Button>
              )}
            </div>
            {attempted && missingKey && <p className="text-[12px] text-red-600 dark:text-red-400">An API key is required.</p>}
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <LockKeyholeIcon className="size-3 shrink-0" />
              Kept in this Mac’s {navigator.userAgent.includes("Windows") ? "Credential Manager" : "Keychain"}, sent only to {provider.name}.
            </p>
          </Step>
        )}

        <Step
          n={2}
          title="Pick models"
          description={`Listed by ${isOllama ? "Ollama" : provider.name} itself — tick the ones you want in the model picker.`}
          done={models.length > 0}
          last={!canTest}
        >
          <ModelPicker
            id={ids.models}
            catalog={catalogFor(provider, hasEnvKey)}
            baseUrl={baseUrl}
            apiKey={draft.apiKey}
            selected={models}
            onChange={(next) => set({ models: next.join(", ") })}
            invalid={attempted && models.length === 0}
            error={attempted && models.length === 0 ? "Pick at least one model" : null}
            tip={
              isLocalOllama ? (
                <>
                  Cloud models through local Ollama: <code className="font-mono">ollama signin</code>, then a{" "}
                  <code className="font-mono">-cloud</code> tag.
                </>
              ) : undefined
            }
          />
        </Step>

        {canTest && (
          <Step n={3} title="Check it works" description="Send one short message with what’s on this page, saved or not." done={tested} last>
            {models.length > 0 && !missingKey ? (
              <ModelTestRow
                providerId={provider.id}
                models={models}
                apiKey={draft.apiKey.trim()}
                baseUrl={baseUrl}
                disabled={saving}
                onResult={setTested}
              />
            ) : (
              <p className="text-[13px] text-muted-foreground">Add a key and a model first.</p>
            )}
          </Step>
        )}
      </div>

      <details className="group max-w-3xl border-t border-border/60 pt-4">
        <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[13px] font-medium text-muted-foreground hover:text-foreground">
          <ChevronDownIcon className="size-4 -rotate-90 transition-transform group-open:rotate-0" />
          Advanced
        </summary>
        <div className="flex flex-col gap-5 pt-5 pl-5">
          {!isLocalOllama && !isCustom && baseUrlField}
          <Field
            label="Token limit"
            htmlFor={ids.limit}
            optional
            hint={
              provider.contextLimit
                ? `Default ${provider.contextLimit.toLocaleString()} (${provider.name} free tier)`
                : "Empty = no limit. Past it, a new chat starts."
            }
          >
            <Input
              id={ids.limit}
              inputMode="numeric"
              value={draft.contextLimit ?? ""}
              onChange={(e) => set({ contextLimit: e.target.value.replace(/[^\d]/g, "") })}
              placeholder={provider.contextLimit ? String(provider.contextLimit) : "No limit"}
              className="h-10 max-w-48 text-sm"
            />
          </Field>
        </div>
      </details>

      {syncError && (
        <div className="max-w-3xl">
          <Notice tone="warning" title="Couldn’t finish connecting">
            {syncError}
          </Notice>
        </div>
      )}

      {/* Stays in reach on a long page. */}
      <div className="sticky bottom-0 z-10 -mx-1 flex items-center justify-between gap-2 border-t border-border/60 bg-background/90 px-1 py-3 backdrop-blur">
        {saved || isCustom ? (
          <Button type="button" variant="ghost" className="text-muted-foreground hover:text-destructive" onClick={() => void reset()}>
            Remove
          </Button>
        ) : (
          <span />
        )}
        <div className="flex items-center gap-2">
          <Button type="button" variant="ghost" onClick={onDone}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving || (attempted && !canSave)} className="h-10 gap-1.5 px-5">
            {saving ? <LoaderIcon className="size-4 animate-spin" /> : <CheckIcon className="size-4" />}
            {saving ? "Saving…" : saved ? "Save" : "Save & connect"}
          </Button>
        </div>
      </div>
    </form>
  );
}

/**
 * Try a model before relying on it: one short message with what's in the
 * form now (saved or not), and what came back — the answer, or the
 * provider's own reason it didn't.
 */
function ModelTestRow({
  providerId,
  models,
  apiKey,
  baseUrl,
  disabled,
  onResult,
}: {
  providerId: string;
  models: string[];
  apiKey: string;
  baseUrl: string;
  disabled: boolean;
  onResult: (ok: boolean) => void;
}) {
  const [model, setModel] = useState<string>();
  const [result, setResult] = useState<(ModelTest & { model: string }) | null>(null);
  const [testing, setTesting] = useState(false);
  const chosen = model && models.includes(model) ? model : models[0];
  if (!chosen) return null;

  const run = async () => {
    setTesting(true);
    setResult(null);
    try {
      const test = await testProviderModel(providerId, chosen, apiKey, baseUrl);
      setResult({ ...test, model: chosen });
      onResult(test.ok);
    } catch (e) {
      setResult({ ok: false, message: e instanceof Error ? e.message : String(e), durationMs: 0, model: chosen });
      onResult(false);
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-center gap-2">
        {models.length > 1 && (
          <select
            value={chosen}
            onChange={(e) => {
              setModel(e.target.value);
              setResult(null);
            }}
            aria-label="Model to test"
            className="h-9 max-w-64 truncate rounded-lg border border-input bg-background px-2.5 font-mono text-[12px]"
          >
            {models.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        )}
        <Button type="button" variant="outline" className="h-9 gap-1.5" onClick={() => void run()} disabled={testing || disabled}>
          {testing ? <LoaderIcon className="size-3.5 animate-spin" /> : <PlayIcon className="size-3.5" />}
          {testing ? `Asking ${chosen}…` : models.length > 1 ? "Test" : `Test ${chosen}`}
        </Button>
      </div>
      {result && (
        <div className="flex flex-col gap-1">
          <StatusPill tone={result.ok ? "success" : "danger"} className="w-fit">
            {result.ok
              ? `Works — ${result.model} answered in ${(result.durationMs / 1000).toFixed(1)}s`
              : `${result.model} didn't answer`}
          </StatusPill>
          <p className="text-[12px] leading-relaxed text-muted-foreground wrap-anywhere">
            {result.ok ? `“${result.message}”` : result.message}
          </p>
        </div>
      )}
    </div>
  );
}

/** Where the picker lists a provider's models from. */
type Catalog = {
  label: string;
  list: (baseUrl: string, apiKey: string) => Promise<string[]>;
  /** Lists without a key typed here: a local server, a public catalog, a key in .env. */
  open: boolean;
  /** What to do when listing failed. */
  fix?: ReactNode;
};

/** Puter's chat models that can call tools (Cowork needs them), newest first. */
const PUTER_CATALOG: Catalog = {
  label: "Puter catalog · models that can use tools",
  list: async (baseUrl) => (await refreshPuterModels("chat", baseUrl)).filter((m) => m.toolCall === true).map((m) => m.id),
  open: true,
};

function catalogFor(provider: ProviderDef, hasEnvKey: boolean): Catalog {
  if (provider.id === "puter") return PUTER_CATALOG;
  if (provider.id === "ollama")
    return {
      label: "On this Mac",
      list: (baseUrl, apiKey) => ollamaListModels(baseUrl, apiKey),
      open: true,
      fix: (
        <>
          Run <code className="font-mono">ollama serve</code>, then Refresh.
        </>
      ),
    };
  if (provider.id === "ollama-cloud")
    return { label: "Ollama Cloud", list: (baseUrl, apiKey) => ollamaListModels(baseUrl, apiKey), open: hasEnvKey };
  return {
    label: `From ${provider.name}`,
    list: (baseUrl, apiKey) => listProviderModels(provider.id, apiKey, baseUrl),
    open: hasEnvKey || !provider.keyRequired,
    // A model newly loaded into a local server shows up on Refresh.
    fix: provider.custom && provider.group === "local" ? <>Make sure the server is running, then Refresh.</> : undefined,
  };
}

/** Shown at once from a long catalog; typing narrows it. */
const SHOWN_FROM_CATALOG = 40;

/**
 * Models straight from the provider: they load as soon as there's a key (and
 * again when it changes), so ticking replaces typing ids. An id the list
 * doesn't have can still be typed in.
 */
function ModelPicker({
  id,
  catalog,
  baseUrl,
  apiKey,
  selected,
  onChange,
  invalid,
  error,
  tip,
}: {
  id: string;
  catalog: Catalog;
  baseUrl: string;
  apiKey: string;
  selected: string[];
  onChange: (models: string[]) => void;
  invalid?: boolean;
  error?: string | null;
  tip?: ReactNode;
}) {
  const [available, setAvailable] = useState<string[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [round, setRound] = useState(0);
  // Search filters the list; the box at the bottom adds your own id — two
  // jobs, two boxes, so typing never feels broken.
  const [query, setQuery] = useState("");
  const [custom, setCustom] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const canList = catalog.open || !!apiKey.trim();
  const { list } = catalog;

  useEffect(() => {
    if (!canList) return;
    let live = true;
    // Wait for the key or address to stop changing.
    const timer = setTimeout(() => {
      setLoading(true);
      setListError(null);
      list(baseUrl, apiKey.trim())
        .then((models) => live && setAvailable(models.map((m) => m.trim()).filter(Boolean)))
        .catch((e) => {
          if (!live) return;
          setAvailable(null);
          setListError(formatListError(String(e)));
        })
        .finally(() => live && setLoading(false));
    }, round === 0 ? 400 : 0);
    return () => {
      live = false;
      clearTimeout(timer);
    };
    // `list` is rebuilt each render; the provider doesn't change on this page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canList, baseUrl, apiKey, round]);

  const catalogSet = new Set(available ?? []);
  const manual = selected.filter((m) => m.trim() && !catalogSet.has(m));
  const q = query.trim().toLowerCase();
  const matching = (available ?? []).filter((m) => !selected.includes(m) && (!q || m.toLowerCase().includes(q)));
  const choices = matching.slice(0, SHOWN_FROM_CATALOG);

  const toggle = (model: string) =>
    onChange(selected.includes(model) ? selected.filter((m) => m !== model) : [...selected, model]);

  const addManual = (raw: string) => {
    const parts = raw.split(",").map((t) => t.trim()).filter(Boolean);
    if (parts.length === 0) return false;
    const next = [...selected];
    for (const part of parts) if (!next.includes(part)) next.push(part);
    if (next.length !== selected.length) onChange(next);
    return true;
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" || event.key === "," || (event.key === "Tab" && custom.trim())) {
      event.preventDefault();
      if (addManual(custom)) setCustom("");
    }
  };

  const onPaste = (event: ClipboardEvent<HTMLInputElement>) => {
    const pasted = event.clipboardData.getData("text");
    if (!pasted.includes(",") && !pasted.includes("\n")) return;
    event.preventDefault();
    if (addManual(pasted.replace(/\n/g, ","))) setCustom("");
  };

  return (
    <div className={cn("flex flex-col gap-4", invalid && "rounded-xl ring-3 ring-destructive/20")}>
      {selected.length > 0 && (
        <ModelGrid
          title={`Selected · ${selected.length}`}
          action={
            <button type="button" onClick={() => onChange([])} className="text-xs text-muted-foreground hover:text-destructive">
              Clear
            </button>
          }
          models={[...selected.filter((m) => catalogSet.has(m)), ...manual]}
          selected={selected}
          onToggle={toggle}
        />
      )}

      <div className="flex flex-col gap-2.5">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
            {catalog.label}
            {available && <span className="ml-1.5 font-normal tabular-nums">· {available.length}</span>}
          </p>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setRound((n) => n + 1)}
            disabled={loading || !canList}
            className="h-7 gap-1.5 px-2 text-xs text-muted-foreground"
          >
            <RefreshCwIcon className={cn("size-3.5", loading && "animate-spin")} />
            Refresh
          </Button>
        </div>

        {available && available.length > SHOWN_FROM_CATALOG / 2 && (
          <div className="relative max-w-sm">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Escape" && setQuery("")}
              spellCheck={false}
              autoComplete="off"
              placeholder={`Search ${available.length} models…`}
              aria-label="Filter models"
              className="h-9 w-full rounded-lg border border-input bg-muted/40 pr-3 pl-8 text-[13px] outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            />
          </div>
        )}

        {!canList ? (
          <p className="text-[13px] text-muted-foreground">Add the key in step 1 — the models load by themselves.</p>
        ) : listError ? (
          <p className="text-[12px] leading-relaxed text-red-700 wrap-anywhere dark:text-red-400">
            {listError} {catalog.fix}
          </p>
        ) : loading && !available ? (
          <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
            <LoaderIcon className="size-3.5 animate-spin" /> Loading models…
          </p>
        ) : available && available.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">No models listed — type one below.</p>
        ) : (
          available && (
            <ModelGrid
              models={choices}
              selected={selected}
              onToggle={toggle}
              emptyHint={q ? `Nothing matches “${query.trim()}” — type the id below instead.` : "All of them are selected."}
              more={matching.length - choices.length}
            />
          )
        )}
      </div>

      <div className="flex max-w-sm items-center gap-2 rounded-lg border border-dashed border-border px-3 transition-colors focus-within:border-primary/50 focus-within:ring-3 focus-within:ring-ring/30">
        <PlusIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <input
          ref={inputRef}
          id={id}
          value={custom}
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => setCustom(e.target.value)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          onBlur={() => addManual(custom) && setCustom("")}
          placeholder="Another model id… then Enter"
          aria-label="Add a model by id"
          className="h-9 min-w-0 flex-1 bg-transparent font-mono text-[13px] outline-none placeholder:font-sans placeholder:text-muted-foreground"
        />
      </div>

      {error && <p className="text-[12px] text-red-600 dark:text-red-400">{error}</p>}
      {tip && <p className="text-[12px] leading-relaxed text-muted-foreground">{tip}</p>}
    </div>
  );
}

function ModelGrid({
  title,
  action,
  models,
  selected,
  onToggle,
  emptyHint,
  more = 0,
}: {
  title?: string;
  action?: ReactNode;
  models: string[];
  selected: string[];
  onToggle: (model: string) => void;
  emptyHint?: string;
  /** How many more match than are shown. */
  more?: number;
}) {
  const unique = [...new Set(models.map((m) => m.trim()).filter(Boolean))];
  if (unique.length === 0) {
    if (!emptyHint) return null;
    return <p className="text-[13px] text-muted-foreground">{emptyHint}</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      {title && (
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">{title}</p>
          {action}
        </div>
      )}
      <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
        {unique.map((model) => {
          const on = selected.includes(model);
          return (
            <li key={model}>
              <button
                type="button"
                aria-pressed={on}
                onClick={() => onToggle(model)}
                title={model}
                className={cn(
                  "group flex min-h-10 w-full items-center gap-2.5 rounded-lg border px-2.5 py-1.5 text-left font-mono text-[12.5px] leading-snug transition-all outline-none",
                  "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
                  on
                    ? "border-emerald-500/50 bg-emerald-500/[0.12] text-emerald-950 shadow-[0_0_0_1px_var(--color-emerald-500/20)] dark:bg-emerald-500/15 dark:text-emerald-100"
                    : "border-border/70 bg-background text-foreground hover:border-primary/30 hover:bg-muted/40",
                )}
              >
                <span
                  className={cn(
                    "flex size-5 shrink-0 items-center justify-center rounded-full border transition-colors",
                    on
                      ? "border-emerald-500 bg-emerald-500 text-white"
                      : "border-border bg-muted/40 text-transparent group-hover:border-primary/40",
                  )}
                  aria-hidden
                >
                  <CheckIcon className="size-3" strokeWidth={3.5} />
                </span>
                <span className="min-w-0 flex-1 truncate">{model}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {more > 0 && <p className="text-xs text-muted-foreground">{more} more — search to find them.</p>}
    </div>
  );
}

function formatListError(raw: string) {
  const clean = raw.replace(/\(error sending request for url[^)]+\)/gi, "").trim();
  if (clean.length > 280) return `${clean.slice(0, 277)}…`;
  return clean || "Can’t connect. Check the base URL.";
}
