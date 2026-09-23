import { Button } from "@/components/ui/button";
import {
  PROVIDERS,
  ProviderLogo,
  useEnvKeys,
  useProviderConfigs,
  type ProviderDef,
} from "@/features/providers";
import { useVaultStatus } from "@/features/secrets";
import { LockKeyholeIcon } from "lucide-react";
import { useState } from "react";
import { AgentsSettings } from "./agents-settings";
import { ProviderDialog, providerStatus } from "./provider-dialog";
import {
  CardGrid,
  GroupLabel,
  IconTile,
  IntegrationCard,
  SectionHeader,
  SettingsSection,
  Notice,
  StatusPill,
} from "./ui";

const GROUPS: { id: ProviderDef["group"]; label: string }[] = [
  { id: "local", label: "On this computer" },
  { id: "cloud", label: "Cloud providers" },
];

/**
 * Everything a model can come from, on one page.
 *
 * Providers and CLI agents used to be two tabs that each showed the provider
 * cards, so the same Gemini key had two homes and neither said which one the
 * chat box would read. There is one list now.
 */
export function ModelsSettings() {
  const configs = useProviderConfigs();
  const envKeys = useEnvKeys();
  const [open, setOpen] = useState<ProviderDef | null>(null);

  const connected = PROVIDERS.filter((p) => providerStatus(p, configs[p.id], envKeys).tone === "success").length;

  return (
    <div className="flex flex-col gap-10">
      <SectionHeader
        title="Models"
        description="Every model the chat box offers comes from here: a provider you hold the key for, or a CLI agent already signed in on this Mac."
        actions={
          <StatusPill tone={connected > 0 ? "success" : "neutral"}>
            {connected}/{PROVIDERS.length} connected
          </StatusPill>
        }
      />

      <KeyStorageNotice />

      {GROUPS.map((group) => (
        <SettingsSection key={group.id}>
          <GroupLabel>{group.label}</GroupLabel>
          <CardGrid>
            {PROVIDERS.filter((p) => p.group === group.id).map((provider) => {
              const status = providerStatus(provider, configs[provider.id], envKeys);
              const ready = status.tone === "success";
              return (
                <IntegrationCard
                  key={provider.id}
                  icon={
                    <IconTile>
                      <ProviderLogo logo={provider.logo} name={provider.name} className="size-6" />
                    </IconTile>
                  }
                  title={provider.name}
                  description={provider.description}
                  onOpen={() => setOpen(provider)}
                  openLabel={`Set up ${provider.name}`}
                  highlight={ready ? "success" : undefined}
                  status={<StatusPill tone={status.tone}>{status.label}</StatusPill>}
                  control={
                    <Button type="button" variant="outline" size="sm" onClick={() => setOpen(provider)}>
                      {ready ? "Manage" : "Set up"}
                    </Button>
                  }
                />
              );
            })}
          </CardGrid>
        </SettingsSection>
      ))}

      <AgentsSettings />

      <ProviderDialog provider={open} onClose={() => setOpen(null)} />
    </div>
  );
}

/** Where API keys are kept, so people know they aren't in plain text. */
function KeyStorageNotice() {
  const vault = useVaultStatus();
  if (vault.state === "loading") return null;
  if (vault.state === "unavailable") {
    return (
      <Notice tone="warning" title="Keychain unavailable">
        API keys are kept in the app’s own storage on this device instead. ({vault.error})
      </Notice>
    );
  }
  const where =
    vault.backend === "file"
      ? "a file only your user account can read"
      : navigator.userAgent.includes("Windows")
        ? "Windows Credential Manager"
        : "the macOS Keychain";
  return (
    <p className="-mt-6 flex items-center gap-1.5 text-xs text-muted-foreground">
      <LockKeyholeIcon className="size-3.5 shrink-0" />
      API keys and MCP tokens are stored in {where}, not in plain text.
    </p>
  );
}
