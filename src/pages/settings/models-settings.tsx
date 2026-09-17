import {
  PROVIDERS,
  ProviderLogo,
  usableModels,
  useEnvKeys,
  useProviderConfigs,
  type ProviderDef,
} from "@/features/providers";
import { cn } from "@/lib/utils";
import { ChevronDownIcon } from "lucide-react";
import { useState } from "react";
import { ProviderForm } from "./provider-form";

const GROUPS: { id: ProviderDef["group"]; label: string }[] = [
  { id: "local", label: "Local" },
  { id: "cloud", label: "Cloud" },
];

export function ModelsSettings() {
  const [selectedId, setSelectedId] = useState(PROVIDERS[0].id);
  const selected = PROVIDERS.find((p) => p.id === selectedId) ?? PROVIDERS[0];

  return (
    <div className="flex flex-col gap-5">
      <header className="space-y-1">
        <h2 className="text-lg font-semibold tracking-tight">Models</h2>
        <p className="max-w-xl text-sm text-muted-foreground">
          Connect AI providers and pick which models show up in chat.
        </p>
      </header>

      <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
        <aside className="shrink-0 lg:sticky lg:top-4 lg:w-64">
          <nav
            aria-label="Model providers"
            className="rounded-xl border bg-card p-2 shadow-sm"
          >
            {GROUPS.map((group) => (
              <ProviderGroup
                key={group.id}
                label={group.label}
                providers={PROVIDERS.filter((p) => p.group === group.id)}
                selectedId={selected.id}
                onSelect={setSelectedId}
              />
            ))}
          </nav>
        </aside>

        <ProviderForm key={selected.id} provider={selected} />
      </div>
    </div>
  );
}

function ProviderGroup({
  label,
  providers,
  selectedId,
  onSelect,
}: {
  label: string;
  providers: ProviderDef[];
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(true);
  const configs = useProviderConfigs();
  const envKeys = useEnvKeys();

  return (
    <div className="not-first:mt-3 not-first:border-t not-first:pt-3">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-2 pb-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase"
      >
        {label}
        <ChevronDownIcon
          className={cn("size-3.5 transition-transform", !open && "-rotate-90")}
        />
      </button>

      {open && (
        <ul className="flex flex-col gap-0.5">
          {providers.map((provider) => {
            const active = provider.id === selectedId;
            const ready = usableModels(provider, configs[provider.id], envKeys).length > 0;
            return (
              <li key={provider.id}>
                <button
                  type="button"
                  aria-current={active ? "true" : undefined}
                  onClick={() => onSelect(provider.id)}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors",
                    active
                      ? "bg-primary/10 font-medium text-foreground ring-1 ring-primary/20"
                      : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                  )}
                >
                  <ProviderLogo logo={provider.logo} name={provider.name} className="size-4" />
                  <span className="min-w-0 flex-1 truncate">{provider.name}</span>
                  <span
                    className={cn(
                      "size-1.5 shrink-0 rounded-full",
                      ready ? "bg-emerald-500" : "bg-muted-foreground/25",
                    )}
                    aria-label={ready ? "Configured" : "Not configured"}
                  />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
