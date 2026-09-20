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
  usableModels,
  useEnvKeys,
  useProviderConfigs,
  type ProviderConfig,
  type ProviderDef,
} from "@/features/providers";
import { cn } from "@/lib/utils";
import { openUrl } from "@tauri-apps/plugin-opener";
import { CheckIcon, ExternalLinkIcon, LoaderIcon, RefreshCwIcon } from "lucide-react";
import { useCallback, useEffect, useId, useState, type FormEvent } from "react";
import { Field, IconTile, Notice, SecretInput, StatusPill } from "./ui";

export function ProviderDialog({ provider, onClose }: { provider: ProviderDef | null; onClose: () => void }) {
  return (
    <Dialog open={!!provider} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[calc(100svh-2rem)] gap-5 overflow-y-auto sm:max-w-xl">
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

  async function reset() {
    removeProviderConfig(provider.id);
    setDraft(configOrDefaults(provider));
    await syncAgent();
  }

  return (
    <form onSubmit={save} className="flex flex-col gap-5">
      <DialogHeader className="flex-row items-center gap-3 space-y-0 pr-8 text-left">
        <IconTile>
          <ProviderLogo logo={provider.logo} name={provider.name} className="size-6" />
        </IconTile>
        <div className="min-w-0">
          <DialogTitle className="truncate">{provider.name}</DialogTitle>
          <DialogDescription className="flex flex-wrap items-center gap-2 pt-1">
            <StatusPill tone={status.tone}>{status.label}</StatusPill>
            <StatusPill tone="neutral">Chat + Cowork</StatusPill>
          </DialogDescription>
        </div>
      </DialogHeader>

      <p className="text-sm text-muted-foreground">
        {provider.description}
        {" Works in Chat and in Cowork agents, with your MCP tools. Syncs on save."}
      </p>

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
                className="inline-flex items-center gap-1 underline-offset-2 hover:text-foreground hover:underline"
              >
                Get an API key
                <ExternalLinkIcon className="size-3" />
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

      <Field label="Base URL" htmlFor={ids.host} error={attempted && badUrl ? "Must start with http:// or https://" : null}>
        <Input
          id={ids.host}
          value={draft.baseUrl}
          onChange={(e) => set({ baseUrl: e.target.value })}
          placeholder={provider.defaultBaseUrl}
          spellCheck={false}
          className="font-mono text-xs"
        />
      </Field>

      <Field
        label="Models"
        htmlFor={ids.models}
        hint="Comma-separated. Each appears in the model picker."
        error={attempted && models.length === 0 ? "Add at least one model" : null}
      >
        <Input
          id={ids.models}
          value={draft.models}
          onChange={(e) => set({ models: e.target.value })}
          placeholder={provider.defaultModels || "e.g. llama3.2, qwen3:8b"}
          spellCheck={false}
          className="font-mono text-xs"
        />
      </Field>

      {isOllama && (
        <OllamaModels
          cloud={provider.id === "ollama-cloud"}
          baseUrl={draft.baseUrl || provider.defaultBaseUrl}
          apiKey={draft.apiKey}
          selected={models}
          onChange={(next) => set({ models: next.join(", ") })}
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
          className="w-40"
        />
      </Field>

      {syncError && (
        <Notice tone="warning" title="Saved, but syncing to Cowork failed">
          {syncError}
        </Notice>
      )}

      <DialogFooter className="gap-2 sm:justify-between">
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

function OllamaModels({
  cloud,
  baseUrl,
  apiKey,
  selected,
  onChange,
}: {
  cloud: boolean;
  baseUrl: string;
  apiKey: string;
  selected: string[];
  onChange: (models: string[]) => void;
}) {
  const [available, setAvailable] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const detect = useCallback(async (url: string, key: string) => {
    setLoading(true);
    setError(null);
    try {
      setAvailable(await ollamaListModels(url, key));
    } catch (e) {
      setAvailable(null);
      setError(formatOllamaError(String(e)));
    } finally {
      setLoading(false);
    }
  }, []);

  // Detect once on open; later only on request, so typing a URL doesn't spam requests.
  const [initial] = useState({ baseUrl, apiKey });
  useEffect(() => {
    if (!cloud || initial.apiKey.trim()) void detect(initial.baseUrl, initial.apiKey);
  }, [cloud, detect, initial]);

  const toggle = (model: string) =>
    onChange(selected.includes(model) ? selected.filter((m) => m !== model) : [...selected, model]);

  return (
    <div className="rounded-xl border bg-muted/30 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-sm font-medium">{cloud ? "Cloud models" : "Local models"}</p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void detect(baseUrl, apiKey)}
          disabled={loading}
          className="gap-1.5"
        >
          <RefreshCwIcon className={cn("size-3.5", loading && "animate-spin")} />
          Detect
        </Button>
      </div>

      {error ? (
        <p className="text-xs leading-relaxed text-red-700 [overflow-wrap:anywhere] dark:text-red-400">
          {error}
          {!cloud && (
            <>
              {" "}
              — run <code className="font-mono">ollama serve</code>, then Detect
            </>
          )}
        </p>
      ) : available === null ? (
        <p className="text-xs text-muted-foreground">
          {loading ? "Searching…" : cloud ? "Add an API key, then Detect models" : "Detect to list models"}
        </p>
      ) : available.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No models yet. Try <code className="font-mono">ollama pull llama3.2</code>
        </p>
      ) : (
        <div className="scroll-hidden flex max-h-40 flex-wrap gap-1.5 overflow-y-auto">
          {available.map((model) => {
            const on = selected.includes(model);
            return (
              <button
                key={model}
                type="button"
                aria-pressed={on}
                onClick={() => toggle(model)}
                className={cn(
                  "flex max-w-full items-center gap-1 rounded-md border px-2 py-1 font-mono text-xs transition-colors",
                  on
                    ? "border-emerald-600/40 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300"
                    : "bg-background text-muted-foreground hover:text-foreground",
                )}
              >
                {on && <CheckIcon className="size-3 shrink-0" />}
                <span className="truncate">{model}</span>
              </button>
            );
          })}
        </div>
      )}
      {!cloud && (
        <p className="mt-2 text-xs text-muted-foreground">
          For cloud models via local Ollama, run <code className="font-mono">ollama signin</code> and add
          a <code className="font-mono">-cloud</code> model, e.g. gpt-oss:120b-cloud
        </p>
      )}
    </div>
  );
}

function formatOllamaError(raw: string) {
  const clean = raw.replace(/\(error sending request for url[^)]+\)/gi, "").trim();
  if (clean.length > 280) return `${clean.slice(0, 277)}…`;
  return clean || "Can’t connect. Check the base URL.";
}
