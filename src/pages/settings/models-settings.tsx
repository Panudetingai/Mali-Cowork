import { Button } from "@/components/ui/button";
import {
  PROVIDERS,
  ProviderLogo,
  useEnvKeys,
  useProviderConfigs,
  type ProviderDef,
} from "@/features/providers";
import { useState } from "react";
import { ProviderDialog, providerStatus } from "./provider-dialog";
import { CardGrid, GroupLabel, IconTile, IntegrationCard, SectionHeader, StatusPill } from "./ui";

const GROUPS: { id: ProviderDef["group"]; label: string }[] = [
  { id: "local", label: "On this computer" },
  { id: "cloud", label: "Cloud providers" },
];

export function ModelsSettings() {
  const configs = useProviderConfigs();
  const envKeys = useEnvKeys();
  const [open, setOpen] = useState<ProviderDef | null>(null);

  const connected = PROVIDERS.filter((p) => providerStatus(p, configs[p.id], envKeys).tone === "success").length;

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader
        title="AI Providers"
        description="เชื่อม provider แล้วเลือก model ได้จากช่องพิมพ์ในหน้าแชท — ผู้ให้บริการที่มีป้าย Chat + Cowork ใช้กับ agent ได้ด้วย"
        actions={
          <StatusPill tone={connected > 0 ? "success" : "neutral"}>
            {connected}/{PROVIDERS.length} connected
          </StatusPill>
        }
      />

      {GROUPS.map((group) => (
        <section key={group.id} className="flex flex-col gap-3">
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
                  badge={provider.cli ? <StatusPill tone="neutral">Chat + Cowork</StatusPill> : undefined}
                  description={provider.description}
                  onOpen={() => setOpen(provider)}
                  openLabel={`ตั้งค่า ${provider.name}`}
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
        </section>
      ))}

      <ProviderDialog provider={open} onClose={() => setOpen(null)} />
    </div>
  );
}
