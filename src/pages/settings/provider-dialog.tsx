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
import { clearAgentSessions } from "@/features/chat-history";
import { refreshOpencode } from "@/features/opencode";
import {
  checkProviderKey,
  cleanApiKey,
  configOrDefaults,
  ollamaListModels,
  ProviderLogo,
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
import { CheckIcon, ExternalLinkIcon, LoaderIcon, PlayIcon, PlusIcon, RefreshCwIcon } from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ClipboardEvent,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { refreshPuterModels } from "@/features/media/puter-catalog";
import { PuterConnect } from "./puter-connect";
import { Field, IconTile, Notice, SecretInput, StatusPill, TagInput } from "./ui";

export function ProviderDialog({ provider, onClose }: { provider: ProviderDef | null; onClose: () => void }) {
  return (
    <Dialog open={!!provider} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[calc(100svh-2rem)] gap-0 overflow-y-auto p-0 sm:max-w-lg">
        {provider && <ProviderForm key={provider.id} provider={provider} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  );
}

export function providerStatus(provider: ProviderDef, config: ProviderConfig | undefined, envKeys: string[]) {
  if (usableModels(provider, config, envKeys).length > 0) {
    return !config && envKeys.includes(provider.id)
      ? { tone: "success" as const, label: "From .env" }
      : { tone: "success" as const, label: "Connected" };
  }
  return { tone: "neutral" as const, label: "Not connected" };
}

function ProviderForm({ provider, onClose }: { provider: ProviderDef; onClose: () => void }) {
  const configs = useProviderConfigs();
  const envKeys = useEnvKeys();
  const saved = configs[provider.id];
  const [draft, setDraft] = useState<ProviderConfig>(() => configOrDefaults(provider, saved));
  const [saving, setSaving] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [attempted, setAttempted] = useState(false);
  const ids = { key: useId(), host: useId(), models: useId(), limit: useId() };

  const status = providerStatus(provider, saved, envKeys);
  const hasEnvKey = envKeys.includes(provider.id);
  const models = splitModels(draft.models);
  const missingKey = provider.keyRequired && !draft.apiKey.trim() && !hasEnvKey;
  const badUrl = !!draft.baseUrl.trim() && !/^https?:\/\/\S+$/i.test(draft.baseUrl.trim());
  const canSave = models.length > 0 && !missingKey && !badUrl;
  const isOllama = provider.id === "ollama" || provider.id === "ollama-cloud";
  // Puter's chat models come from Puter's own list, like Ollama's from its server.
  const isPuter = provider.id === "puter";

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
    const baseUrl = draft.baseUrl.trim() || provider.defaultBaseUrl;
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
    if (ok) onClose();
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
    setDraft(configOrDefaults(provider));
    await syncAgent();
  }

  return (
    <form onSubmit={save} className="flex flex-col">
      <div className="flex flex-col gap-4 px-6 pt-6 pb-5">
        <DialogHeader className="flex-row items-start gap-3.5 space-y-0 pr-8 text-left">
          <IconTile className="size-11 rounded-2xl bg-muted/60">
            <ProviderLogo logo={provider.logo} name={provider.name} className="size-7" />
          </IconTile>
          <div className="min-w-0 flex-1 pt-0.5">
            <DialogTitle className="truncate text-xl font-semibold tracking-tight">{provider.name}</DialogTitle>
            <DialogDescription asChild>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <StatusPill tone={status.tone}>{status.label}</StatusPill>
                <StatusPill tone="neutral">Chat + Cowork</StatusPill>
              </div>
            </DialogDescription>
          </div>
        </DialogHeader>

        <p className="rounded-xl border border-border/60 bg-muted/25 px-3.5 py-3 text-[13px] leading-relaxed text-muted-foreground">
          {provider.description}
          {" Works in Chat and in Cowork agents, with your MCP tools. Syncs on save."}
        </p>
      </div>

      <div className="flex flex-col gap-4 border-t border-border/60 px-6 py-5">
      {isPuter ? (
        <PuterConnect
          apiKey={draft.apiKey}
          baseUrl={draft.baseUrl || provider.defaultBaseUrl}
          onToken={connectPuter}
        />
      ) : (
        <Field
          label="API key"
          htmlFor={ids.key}
          optional={!provider.keyRequired}
          hint={
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
              {hasEnvKey && <span>Using {provider.envVar} from .env. Enter a key to override.</span>}
              {provider.keyUrl && (
                <button
                  type="button"
                  onClick={() => void openUrl(provider.keyUrl!)}
                  className="inline-flex items-center gap-1 font-medium text-foreground/80 underline-offset-2 hover:text-foreground hover:underline"
                >
                  Get an API key
                  <ExternalLinkIcon className="size-3 opacity-70" />
                </button>
              )}
              {!provider.keyRequired && !provider.keyUrl && "Not needed for a local server"}
            </span>
          }
          error={attempted && missingKey ? "API key is required" : null}
        >
          <SecretInput
            id={ids.key}
            value={draft.apiKey}
            onChange={(e) => set({ apiKey: e.target.value })}
            placeholder={hasEnvKey ? `Using ${provider.envVar} from .env` : provider.keyRequired ? "Paste API key" : "Optional"}
          />
        </Field>
      )}

      <Field label="Base URL" htmlFor={ids.host} error={attempted && badUrl ? "Must start with http:// or https://" : null}>
        <Input
          id={ids.host}
          value={draft.baseUrl}
          onChange={(e) => set({ baseUrl: e.target.value })}
          placeholder={provider.defaultBaseUrl}
          spellCheck={false}
          className="h-10 font-mono text-[13px]"
        />
      </Field>

      {isOllama || isPuter ? (
        <OllamaModelPicker
          id={ids.models}
          cloud={provider.id !== "ollama"}
          catalog={isPuter ? PUTER_CATALOG : undefined}
          baseUrl={draft.baseUrl || provider.defaultBaseUrl}
          apiKey={draft.apiKey}
          selected={models}
          onChange={(next) => set({ models: next.join(", ") })}
          invalid={attempted && models.length === 0}
          error={attempted && models.length === 0 ? "Add at least one model" : null}
        />
      ) : (
        <Field
          label="Models"
          htmlFor={ids.models}
          hint="Type a model id and press Enter. Each one appears in the model picker."
          error={attempted && models.length === 0 ? "Add at least one model" : null}
        >
          <TagInput
            id={ids.models}
            values={models}
            onChange={(next) => set({ models: next.join(", ") })}
            placeholder={provider.defaultModels || "Add model id…"}
            invalid={attempted && models.length === 0}
          />
        </Field>
      )}

      {!isPuter && !isOllama && models.length > 0 && !missingKey && (
        <ModelTestRow
          providerId={provider.id}
          models={models}
          apiKey={draft.apiKey.trim()}
          baseUrl={draft.baseUrl.trim() || provider.defaultBaseUrl}
          disabled={saving}
        />
      )}

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
          className="h-10 w-full text-sm"
        />
      </Field>

      {syncError && (
        <Notice tone="warning" title="Saved, but syncing to Cowork failed">
          {syncError}
        </Notice>
      )}
      </div>

      <DialogFooter className="gap-2 border-t border-border/60 bg-muted/15 px-6 py-4 sm:justify-between">
        {saved ? (
          <Button type="button" variant="ghost" className="text-muted-foreground hover:text-destructive" onClick={reset}>
            Remove
          </Button>
        ) : (
          <span />
        )}
        <div className="flex flex-col-reverse gap-2 sm:flex-row">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving || (attempted && !canSave)} className="gap-1.5">
            {saving ? <LoaderIcon className="size-4 animate-spin" /> : <CheckIcon className="size-4" />}
            Save
          </Button>
        </div>
      </DialogFooter>
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
}: {
  providerId: string;
  models: string[];
  apiKey: string;
  baseUrl: string;
  disabled: boolean;
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
      setResult({ ...(await testProviderModel(providerId, chosen, apiKey, baseUrl)), model: chosen });
    } catch (e) {
      setResult({ ok: false, message: e instanceof Error ? e.message : String(e), durationMs: 0, model: chosen });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border/70 bg-muted/15 px-3 py-2.5">
      <div className="flex items-center gap-2">
        <p className="min-w-0 flex-1 text-[12px] text-muted-foreground">Check it works: send one short message</p>
        {models.length > 1 && (
          <select
            value={chosen}
            onChange={(e) => {
              setModel(e.target.value);
              setResult(null);
            }}
            aria-label="Model to test"
            className="h-8 max-w-44 truncate rounded-md border border-input bg-background px-2 font-mono text-[12px]"
          >
            {models.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        )}
        <Button type="button" variant="secondary" size="sm" className="h-8 gap-1.5 px-2.5 text-xs" onClick={() => void run()} disabled={testing || disabled}>
          {testing ? <LoaderIcon className="size-3.5 animate-spin" /> : <PlayIcon className="size-3.5" />}
          Test
        </Button>
      </div>
      {testing && <StatusPill tone="pending">Asking {chosen}…</StatusPill>}
      {result && (
        <div className="flex flex-col gap-1">
          <StatusPill tone={result.ok ? "success" : "danger"}>
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

/** Where a picker lists models from, when it isn't an Ollama server. */
type Catalog = { label: string; list: (baseUrl: string) => Promise<string[]> };

/** Puter's chat models that can call tools (Cowork needs them), newest first. */
const PUTER_CATALOG: Catalog = {
  label: "Puter catalog — models that can use tools",
  list: async (baseUrl) => (await refreshPuterModels("chat", baseUrl)).filter((m) => m.toolCall === true).map((m) => m.id),
};

/** Shown at once from a long catalog; typing narrows it. */
const SHOWN_FROM_CATALOG = 40;

function OllamaModelPicker({
  id,
  cloud,
  catalog: source,
  baseUrl,
  apiKey,
  selected,
  onChange,
  invalid,
  error,
}: {
  id: string;
  cloud: boolean;
  /** List from here instead of an Ollama server. */
  catalog?: Catalog;
  baseUrl: string;
  apiKey: string;
  selected: string[];
  onChange: (models: string[]) => void;
  invalid?: boolean;
  error?: string | null;
}) {
  const [available, setAvailable] = useState<string[] | null>(null);
  const [detectError, setDetectError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const detect = useCallback(async (url: string, key: string) => {
    setLoading(true);
    setDetectError(null);
    try {
      const list = source ? await source.list(url) : await ollamaListModels(url, key);
      setAvailable(list.map((m) => m.trim()).filter(Boolean));
    } catch (e) {
      setAvailable(null);
      setDetectError(formatOllamaError(String(e)));
    } finally {
      setLoading(false);
    }
  }, [source]);

  const [initial] = useState({ baseUrl, apiKey });
  useEffect(() => {
    // A public catalog lists without a key.
    if (!cloud || source || initial.apiKey.trim()) void detect(initial.baseUrl, initial.apiKey);
  }, [cloud, source, detect, initial]);

  const catalog = available ?? [];
  const catalogSet = new Set(catalog);
  const manual = selected.filter((m) => m.trim() && !catalogSet.has(m));
  // What's typed narrows a long catalog; only so many show at once.
  const query = text.trim().toLowerCase();
  const catalogChoices = catalog
    .filter((m) => !selected.includes(m) && (!query || m.toLowerCase().includes(query)))
    .slice(0, SHOWN_FROM_CATALOG);

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
    if (event.key === "Enter" || event.key === "," || (event.key === "Tab" && text.trim())) {
      event.preventDefault();
      if (addManual(text)) setText("");
    }
  };

  const onPaste = (event: ClipboardEvent<HTMLInputElement>) => {
    const pasted = event.clipboardData.getData("text");
    if (!pasted.includes(",") && !pasted.includes("\n")) return;
    event.preventDefault();
    if (addManual(pasted.replace(/\n/g, ","))) setText("");
  };

  return (
    <Field
      label="Models"
      htmlFor={id}
      hint="Tap to select from Detect, or type a model id and press Enter."
      error={error}
    >
      <div
        className={cn(
          "overflow-hidden rounded-lg border border-input bg-background shadow-xs",
          invalid && "border-destructive ring-3 ring-destructive/20 dark:ring-destructive/40",
        )}
      >
        <div className="flex items-center justify-between gap-2 border-b border-border/60 bg-muted/20 px-3 py-2.5">
          <p className="text-[12px] text-muted-foreground">
            {source?.label ?? (cloud ? "Ollama Cloud catalog" : "Local Ollama catalog")}
          </p>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => void detect(baseUrl, apiKey)}
            disabled={loading}
            className="h-8 gap-1.5 px-2.5 text-xs shadow-xs"
          >
            <RefreshCwIcon className={cn("size-3.5", loading && "animate-spin")} />
            Detect
          </Button>
        </div>

        <div className="flex flex-col gap-3 p-2.5">
          {detectError ? (
            <p className="text-[12px] leading-relaxed text-red-700 wrap-anywhere dark:text-red-400">
              {detectError}
              {!cloud && (
                <>
                  {" "}
                  — run <code className="font-mono">ollama serve</code>, then Detect
                </>
              )}
            </p>
          ) : loading && catalog.length === 0 && manual.length === 0 ? (
            <p className="text-[12px] text-muted-foreground">Searching…</p>
          ) : null}

          {manual.length > 0 && (
            <ModelGrid
              title="Added manually (not in Detect list)"
              models={manual}
              selected={selected}
              onToggle={toggle}
            />
          )}

          {catalog.length > 0 ? (
            <ModelGrid
              title={manual.length > 0 ? "From Detect" : undefined}
              models={[...selected.filter((m) => catalogSet.has(m)), ...catalogChoices]}
              selected={selected}
              onToggle={toggle}
            />
          ) : !loading && !detectError ? (
            <p className="text-[12px] text-muted-foreground">
              {cloud ? "Add an API key, then Detect — or type a model id below." : "Detect to list models, or type an id below."}
            </p>
          ) : null}

          {!cloud && (
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              Cloud via local Ollama: <code className="font-mono">ollama signin</code>, then a{" "}
              <code className="font-mono">-cloud</code> tag.
            </p>
          )}

          <div className="flex items-center gap-2 rounded-md border border-input bg-background px-2 shadow-xs focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50">
            <PlusIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
            <input
              ref={inputRef}
              id={id}
              value={text}
              spellCheck={false}
              autoComplete="off"
              onChange={(e) => setText(e.target.value)}
              onKeyDown={onKeyDown}
              onPaste={onPaste}
              onBlur={() => addManual(text) && setText("")}
              placeholder={selected.length === 0 ? "Add model id…" : "Add another model…"}
              className="h-9 min-w-0 flex-1 bg-transparent font-mono text-[13px] outline-none placeholder:font-sans placeholder:text-[13px] placeholder:text-muted-foreground"
            />
          </div>
        </div>
      </div>
    </Field>
  );
}

function ModelGrid({
  title,
  models,
  selected,
  onToggle,
}: {
  title?: string;
  models: string[];
  selected: string[];
  onToggle: (model: string) => void;
}) {
  const unique = [...new Set(models.map((m) => m.trim()).filter(Boolean))];
  if (unique.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      {title && <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{title}</p>}
      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {unique.map((model) => {
          const on = selected.includes(model);
          return (
            <li key={model}>
              <button
                type="button"
                aria-pressed={on}
                onClick={() => onToggle(model)}
                className={cn(
                  "flex w-full min-h-10 items-center gap-2 rounded-lg border px-3 py-2 text-left font-mono text-[12px] leading-snug transition-colors",
                  on
                    ? "border-emerald-600/40 bg-emerald-500/15 text-emerald-950 dark:text-emerald-100"
                    : "border-border/80 bg-muted/30 text-foreground hover:bg-muted/50",
                )}
              >
                <span
                  className={cn(
                    "flex size-4 shrink-0 items-center justify-center rounded-full border",
                    on ? "border-emerald-600/50 bg-emerald-600 text-white" : "border-border bg-background",
                  )}
                  aria-hidden
                >
                  {on && <CheckIcon className="size-2.5" strokeWidth={3} />}
                </span>
                <span className="min-w-0 flex-1 truncate" title={model}>
                  {model}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function formatOllamaError(raw: string) {
  const clean = raw.replace(/\(error sending request for url[^)]+\)/gi, "").trim();
  if (clean.length > 280) return `${clean.slice(0, 277)}…`;
  return clean || "Can’t connect. Check the base URL.";
}
