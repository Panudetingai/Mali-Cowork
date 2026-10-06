import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  addCustomProvider,
  CUSTOM_PRESETS,
  ProviderLogo,
  type CustomProvider,
  type CustomProviderInput,
} from "@/features/providers";
import { cn } from "@/lib/utils";
import { ArrowRightIcon, CloudIcon, MonitorIcon } from "lucide-react";
import { useId, useState, type FormEvent } from "react";
import { Field, PageHeader, SectionLabel, Segmented } from "./ui";

const EMPTY: CustomProviderInput = { name: "", group: "cloud", baseUrl: "", keyRequired: true };

/**
 * Settings → Models → Add provider: any server that speaks the
 * OpenAI-compatible API — a new cloud service, or a model server on this
 * machine. Creating it opens its own setup page (key, models, test), the same
 * one the built-in providers have.
 */
export function AddProviderPage({
  onCreated,
  onCancel,
}: {
  onCreated: (provider: CustomProvider) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<CustomProviderInput>(EMPTY);
  const [attempted, setAttempted] = useState(false);
  const ids = { name: useId(), url: useId(), keyUrl: useId() };
  const set = (patch: Partial<CustomProviderInput>) => setDraft((prev) => ({ ...prev, ...patch }));

  const name = draft.name.trim();
  const url = draft.baseUrl.trim();
  const badUrl = !/^https?:\/\/\S+$/i.test(url);
  const canCreate = !!name && !badUrl;

  function create(event: FormEvent) {
    event.preventDefault();
    setAttempted(true);
    if (!canCreate) return;
    onCreated(addCustomProvider({ ...draft, keyUrl: draft.keyUrl?.trim() || undefined }));
  }

  return (
    <form onSubmit={create} className="flex flex-col gap-8">
      <PageHeader
        back={{ label: "Models", onClick: onCancel }}
        icon={<ProviderLogo logo="custom" name={name || "+"} className="size-7" />}
        title="Add a provider"
        description="Any service or app that speaks the OpenAI-compatible API — a new cloud provider, or models served on this computer. Its models then show up in the model picker, Cowork and Voice like any other."
      />

      <section className="flex max-w-3xl flex-col gap-3">
        <SectionLabel>Start from</SectionLabel>
        <div className="flex flex-wrap gap-2">
          {CUSTOM_PRESETS.map((preset) => {
            const on = draft.baseUrl === preset.baseUrl && draft.name === preset.name;
            return (
              <button
                key={preset.name}
                type="button"
                title={preset.hint}
                onClick={() => setDraft({ name: preset.name, group: preset.group, baseUrl: preset.baseUrl, keyRequired: preset.keyRequired, keyUrl: preset.keyUrl })}
                className={cn(
                  "inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-[13px] transition-colors",
                  on ? "border-violet-500 bg-violet-500/10 text-foreground" : "border-border/70 text-muted-foreground hover:border-foreground/25 hover:text-foreground",
                )}
              >
                {preset.group === "local" ? <MonitorIcon className="size-3.5" /> : <CloudIcon className="size-3.5" />}
                {preset.name}
              </button>
            );
          })}
        </div>
        <p className="text-[12px] text-muted-foreground">
          {CUSTOM_PRESETS.find((p) => p.baseUrl === draft.baseUrl && p.name === draft.name)?.hint ??
            "Or fill in the form for any other service."}
        </p>
      </section>

      <div className="flex max-w-lg flex-col gap-5">
        <Field label="Name" htmlFor={ids.name} error={attempted && !name ? "Give it a name" : null}>
          <Input
            id={ids.name}
            value={draft.name}
            onChange={(e) => set({ name: e.target.value })}
            placeholder="e.g. LM Studio, My gateway"
            className="h-10"
          />
        </Field>

        <Field label="Where it runs">
          <Segmented
            label="Where it runs"
            value={draft.group}
            onChange={(group) => set({ group, keyRequired: group === "cloud" ? draft.keyRequired : false })}
            options={[
              { value: "cloud", label: "In the cloud", icon: <CloudIcon /> },
              { value: "local", label: "On this computer", icon: <MonitorIcon /> },
            ]}
          />
        </Field>

        <Field
          label="Address (base URL)"
          htmlFor={ids.url}
          error={attempted && badUrl ? "Must start with http:// or https://" : null}
          hint="The part before /chat/completions — usually ends in /v1."
        >
          <Input
            id={ids.url}
            value={draft.baseUrl}
            onChange={(e) => set({ baseUrl: e.target.value })}
            placeholder={draft.group === "local" ? "http://localhost:1234/v1" : "https://api.example.com/v1"}
            spellCheck={false}
            className="h-10 font-mono text-[13px]"
          />
        </Field>

        <label className="flex items-center gap-2 text-[13px]">
          <input
            type="checkbox"
            checked={draft.keyRequired}
            onChange={(e) => set({ keyRequired: e.target.checked })}
            className="size-4 accent-violet-600"
          />
          Needs an API key
        </label>

        {draft.keyRequired && (
          <Field label="Where to get a key" htmlFor={ids.keyUrl} optional hint="Adds a “Get a key” button on its page.">
            <Input
              id={ids.keyUrl}
              value={draft.keyUrl ?? ""}
              onChange={(e) => set({ keyUrl: e.target.value })}
              placeholder="https://…"
              spellCheck={false}
              className="h-10 font-mono text-[13px]"
            />
          </Field>
        )}
      </div>

      <div className="sticky bottom-0 z-10 -mx-1 flex items-center justify-end gap-2 border-t border-border/60 bg-background/90 px-1 py-3 backdrop-blur">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={attempted && !canCreate} className="h-10 gap-1.5 px-5">
          Next: key & models
          <ArrowRightIcon className="size-4" />
        </Button>
      </div>
    </form>
  );
}
