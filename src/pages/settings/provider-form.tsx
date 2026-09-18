import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  configOrDefaults,
  ollamaListModels,
  ProviderLogo,
  removeProviderConfig,
  saveProviderConfig,
  splitModels,
  usableModels,
  useEnvKeys,
  useProviderConfigs,
  type ProviderConfig,
  type ProviderDef,
} from "@/features/providers";
import { cn } from "@/lib/utils";
import {
  AlertTriangleIcon,
  CheckIcon,
  EyeIcon,
  EyeOffIcon,
  RefreshCwIcon,
} from "lucide-react";
import { useCallback, useEffect, useId, useState, type ReactNode } from "react";

const inputClass =
  "h-9 rounded-lg border-input/60 bg-muted/30 px-3 text-sm shadow-none focus-visible:bg-background";

export function ProviderForm({ provider }: { provider: ProviderDef }) {
  const configs = useProviderConfigs();
  const envKeys = useEnvKeys();
  const saved = configs[provider.id];
  const [draft, setDraft] = useState<ProviderConfig>(() => configOrDefaults(provider, saved));
  const [showKey, setShowKey] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const ids = { key: useId(), host: useId(), models: useId(), limit: useId() };

  const configured = usableModels(provider, saved, envKeys).length > 0;
  const hasEnvKey = envKeys.includes(provider.id);
  const models = splitModels(draft.models);
  const missingKey = provider.keyRequired && !draft.apiKey.trim() && !hasEnvKey;
  const canSave = models.length > 0 && !missingKey;

  const set = (patch: Partial<ProviderConfig>) => {
    setJustSaved(false);
    setDraft((prev) => ({ ...prev, ...patch }));
  };

  const save = () => {
    saveProviderConfig(provider.id, {
      apiKey: draft.apiKey.trim(),
      baseUrl: draft.baseUrl.trim() || provider.defaultBaseUrl,
      models: models.join(", "),
      contextLimit: draft.contextLimit?.trim() ?? "",
    });
    setJustSaved(true);
  };

  const reset = () => {
    removeProviderConfig(provider.id);
    setDraft(configOrDefaults(provider));
    setJustSaved(false);
  };

  return (
    <Card className="min-w-0 flex-1 overflow-hidden shadow-sm">
      <CardHeader className="gap-4 border-b bg-muted/15 pb-5">
        <div className="flex flex-wrap items-start gap-3">
          <div className="flex size-11 shrink-0 items-center justify-center rounded-xl border bg-background shadow-xs">
            <ProviderLogo logo={provider.logo} name={provider.name} className="size-6" />
          </div>
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle className="text-xl">{provider.name}</CardTitle>
              <StatusBadge configured={configured} />
            </div>
            <CardDescription className="text-sm leading-relaxed">{provider.description}</CardDescription>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-8 pt-6">
        <FormSection title="Connection">
          <Field
            id={ids.key}
            label="API key"
            optional={!provider.keyRequired}
            hint={hasEnvKey ? `Using ${provider.envVar} from .env` : undefined}
          >
            <div className="relative">
              <Input
                id={ids.key}
                type={showKey ? "text" : "password"}
                value={draft.apiKey}
                onChange={(event) => set({ apiKey: event.target.value })}
                placeholder={
                  hasEnvKey
                    ? `Using ${provider.envVar} from .env`
                    : provider.keyRequired
                      ? "Enter your API key"
                      : "Not needed for a local server"
                }
                autoComplete="off"
                spellCheck={false}
                className={cn(inputClass, "pr-10")}
              />
              <button
                type="button"
                onClick={() => setShowKey((v) => !v)}
                aria-label={showKey ? "Hide API key" : "Show API key"}
                className="absolute top-1/2 right-2 -translate-y-1/2 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                {showKey ? <EyeIcon className="size-4" /> : <EyeOffIcon className="size-4" />}
              </button>
            </div>
          </Field>

          <Field id={ids.host} label="Base URL">
            <Input
              id={ids.host}
              value={draft.baseUrl}
              onChange={(event) => set({ baseUrl: event.target.value })}
              placeholder={provider.defaultBaseUrl}
              spellCheck={false}
              className={inputClass}
            />
          </Field>
        </FormSection>

        <FormSection
          title="Models"
          description="Comma-separated model IDs. Each entry appears in the chat model picker."
        >
          <Field id={ids.models} label="Model IDs">
            <Input
              id={ids.models}
              value={draft.models}
              onChange={(event) => set({ models: event.target.value })}
              placeholder={provider.defaultModels || "e.g. llama3.2, qwen2.5-coder"}
              spellCheck={false}
              className={inputClass}
            />
          </Field>

          {provider.id === "ollama" && (
            <OllamaModels
              baseUrl={draft.baseUrl}
              selected={models}
              onChange={(next) => set({ models: next.join(", ") })}
            />
          )}
        </FormSection>

        <FormSection title="Context">
          <Field
            id={ids.limit}
            label="Token limit"
            optional
            hint={
              provider.contextLimit
                ? `Default ${provider.contextLimit.toLocaleString()} fits ${provider.name}'s free-tier cap.`
                : "Leave empty for no limit. Long chats continue in a new thread when exceeded."
            }
          >
            <Input
              id={ids.limit}
              inputMode="numeric"
              value={draft.contextLimit ?? ""}
              onChange={(event) => set({ contextLimit: event.target.value.replace(/[^\d]/g, "") })}
              placeholder={provider.contextLimit ? String(provider.contextLimit) : "No limit"}
              className={inputClass}
            />
          </Field>
        </FormSection>
      </CardContent>

      <CardFooter className="flex flex-wrap items-center gap-2 border-t bg-muted/10 py-4">
        {missingKey && models.length > 0 && (
          <p className="mr-auto text-xs text-amber-700 dark:text-amber-400">An API key is required to save.</p>
        )}
        <Button type="button" variant="ghost" size="sm" onClick={reset}>
          Reset
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={save}
          disabled={!canSave}
          className="gap-1.5 bg-emerald-600 text-white hover:bg-emerald-600/90"
        >
          {justSaved && <CheckIcon className="size-4" />}
          {justSaved ? "Saved" : "Save changes"}
        </Button>
      </CardFooter>
    </Card>
  );
}

function StatusBadge({ configured }: { configured: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium",
        configured
          ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
          : "bg-muted text-muted-foreground",
      )}
    >
      <span className={cn("size-1.5 rounded-full", configured ? "bg-emerald-500" : "bg-muted-foreground/40")} />
      {configured ? "Configured" : "Not configured"}
    </span>
  );
}

function FormSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-4">
      <div className="space-y-0.5">
        <h4 className="text-sm font-semibold">{title}</h4>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

function Field({
  id,
  label,
  optional,
  hint,
  children,
}: {
  id: string;
  label: string;
  optional?: boolean;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-[minmax(7rem,9rem)_1fr] sm:items-start sm:gap-x-4">
      <Label htmlFor={id} className="pt-2 text-sm font-medium sm:pt-2.5">
        {label}
        {optional && <span className="ml-1 text-xs font-normal text-muted-foreground">(optional)</span>}
      </Label>
      <div className="min-w-0 space-y-1.5">
        {children}
        {hint && <p className="text-xs leading-relaxed text-muted-foreground">{hint}</p>}
      </div>
    </div>
  );
}

function OllamaModels({
  baseUrl,
  selected,
  onChange,
}: {
  baseUrl: string;
  selected: string[];
  onChange: (models: string[]) => void;
}) {
  const [installed, setInstalled] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const detect = useCallback(async (url: string) => {
    setLoading(true);
    setError(null);
    try {
      setInstalled(await ollamaListModels(url));
    } catch (e) {
      setInstalled(null);
      setError(formatOllamaError(String(e)));
    } finally {
      setLoading(false);
    }
  }, []);

  const [initialUrl] = useState(baseUrl);
  useEffect(() => {
    void detect(initialUrl);
  }, [detect, initialUrl]);

  const toggle = (model: string) =>
    onChange(selected.includes(model) ? selected.filter((m) => m !== model) : [...selected, model]);

  return (
    <div className="rounded-xl border bg-muted/20 p-4 sm:col-span-2 sm:col-start-2">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium">Installed models</p>
          <p className="text-xs text-muted-foreground">Detect from your Ollama server, then tap to add or remove.</p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => detect(baseUrl)}
          disabled={loading}
          className="gap-1.5 shrink-0"
        >
          <RefreshCwIcon className={cn("size-3.5", loading && "animate-spin")} />
          Detect
        </Button>
      </div>

      {error ? (
        <div className="flex gap-2.5 rounded-lg border border-red-200/80 bg-red-50 p-3 dark:border-red-900/50 dark:bg-red-950/30">
          <AlertTriangleIcon className="mt-0.5 size-4 shrink-0 text-red-600 dark:text-red-400" />
          <div className="min-w-0 space-y-1">
            <p className="text-sm font-medium text-red-800 dark:text-red-300">Cannot reach Ollama</p>
            <p className="text-xs leading-relaxed break-words text-red-700/90 dark:text-red-400/90">{error}</p>
            <p className="text-xs text-muted-foreground">
              Start the server with <code className="rounded bg-muted px-1 py-0.5">ollama serve</code>, then click
              Detect again.
            </p>
          </div>
        </div>
      ) : installed === null ? (
        <p className="text-sm text-muted-foreground">Looking for Ollama on this machine…</p>
      ) : installed.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Ollama is running but has no models. Try{" "}
          <code className="rounded bg-muted px-1 py-0.5">ollama pull llama3.2</code>.
        </p>
      ) : (
        <div className="flex max-h-40 flex-wrap gap-1.5 overflow-y-auto scroll-hidden pr-1">
          {installed.map((model) => {
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
                    ? "border-emerald-600/40 bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
                    : "bg-background text-muted-foreground hover:border-foreground/20 hover:text-foreground",
                )}
              >
                {on && <CheckIcon className="size-3 shrink-0" />}
                <span className="truncate">{model}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function formatOllamaError(raw: string) {
  const withoutUrlNoise = raw.replace(/\(error sending request for url[^)]+\)/gi, "").trim();
  if (withoutUrlNoise.length > 280) return `${withoutUrlNoise.slice(0, 277)}…`;
  return withoutUrlNoise || "Connection failed. Check the base URL and that Ollama is running.";
}
