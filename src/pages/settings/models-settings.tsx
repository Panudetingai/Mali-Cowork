import {
  getProvider,
  PROVIDERS,
  ProviderLogo,
  usableModels,
  useEnvKeys,
  useProviderConfigs,
  type ProviderDef,
} from "@/features/providers";
import { useVaultStatus } from "@/features/secrets";
import { useTranslation } from "@/features/i18n";
import { ChevronRightIcon, LockKeyholeIcon, PlusIcon } from "lucide-react";
import { useState } from "react";
import { AgentsSettings } from "./agents-settings";
import { ProviderPage, providerStatus } from "./provider-page";
import { useSettingsSub } from "./route";
import {
  Dot,
  Notice,
  PageEnter,
  PageHeader,
  Pills,
  SearchField,
  SectionLabel,
  StatusPill,
  Tile,
  TileBadge,
  TileButton,
  TileGrid,
} from "./ui";

type Filter = "all" | "connected" | "local" | "cloud";

/** Easiest first: free / local options users can set up in a minute. */
const EASY_IDS = new Set(["puter", "ollama", "openrouter"]);

/**
 * Settings → Models, laid out like an Integrations page: pills and a search
 * on top, then UPPERCASE groups of tiles. A tile opens the provider's own
 * setup page (`/settings/models/<id>`), so the steps get room to breathe.
 */
export function ModelsSettings() {
  const { sub, open, back } = useSettingsSub();
  const provider = sub ? getProvider(sub) : undefined;
  if (provider) {
    return (
      <PageEnter key={provider.id}>
        <ProviderPage provider={provider} onDone={back} />
      </PageEnter>
    );
  }
  return <ProviderGallery onOpen={(p) => open(p.id)} />;
}

function ProviderGallery({ onOpen }: { onOpen: (provider: ProviderDef) => void }) {
  const { t } = useTranslation();
  const configs = useProviderConfigs();
  const envKeys = useEnvKeys();
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");

  const isConnected = (p: ProviderDef) => providerStatus(p, configs[p.id], envKeys).tone === "success";
  const connected = PROVIDERS.filter(isConnected);
  const q = query.trim().toLowerCase();
  const matches = (p: ProviderDef) => !q || `${p.name} ${p.description} ${p.id}`.toLowerCase().includes(q);
  const easyFirst = (a: ProviderDef, b: ProviderDef) => Number(EASY_IDS.has(b.id)) - Number(EASY_IDS.has(a.id));

  // Each provider shows once: connected ones on top, the rest by where they run.
  const groups: { id: Exclude<Filter, "all">; label: string; items: ProviderDef[] }[] = [
    { id: "connected", label: t("modelsConnected"), items: connected },
    { id: "local", label: t("modelsFilterLocal"), items: PROVIDERS.filter((p) => p.group === "local" && !isConnected(p)) },
    { id: "cloud", label: t("modelsFilterCloud"), items: PROVIDERS.filter((p) => p.group === "cloud" && !isConnected(p)) },
  ];
  const shown = groups
    .filter((g) => filter === "all" || g.id === filter)
    .map((g) => ({ ...g, items: g.items.filter(matches).sort(easyFirst) }))
    .filter((g) => g.items.length > 0);

  return (
    <div className="flex flex-col gap-10">
      <div className="flex flex-col gap-6">
        <PageHeader
          title={t("tabModels")}
          description={t("modelsSubtitle")}
          actions={
            <StatusPill tone={connected.length > 0 ? "success" : "neutral"}>
              {connected.length}/{PROVIDERS.length} connected
            </StatusPill>
          }
        />

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Pills
            label={t("tabModels")}
            value={filter}
            onChange={setFilter}
            options={[
              { value: "all", label: t("modelsFilterAll") },
              { value: "connected", label: t("modelsConnected"), count: connected.length },
              { value: "local", label: t("modelsFilterLocal") },
              { value: "cloud", label: t("modelsFilterCloud") },
            ]}
          />
          <SearchField value={query} onChange={setQuery} placeholder="Search providers…" />
        </div>

        {shown.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            {q ? `No provider matches “${query.trim()}”.` : "Nothing connected yet — pick a provider below to start."}
          </p>
        ) : (
          shown.map((group) => (
            <section key={group.id} className="flex flex-col gap-3">
              <SectionLabel>{group.label}</SectionLabel>
              <TileGrid>
                {group.items.map((provider) => (
                  <ProviderTile key={provider.id} provider={provider} onOpen={() => onOpen(provider)} />
                ))}
              </TileGrid>
            </section>
          ))
        )}

        <KeyStorageNotice />
      </div>

      <AgentsSettings />
    </div>
  );
}

function ProviderTile({ provider, onOpen }: { provider: ProviderDef; onOpen: () => void }) {
  const { t } = useTranslation();
  const configs = useProviderConfigs();
  const envKeys = useEnvKeys();
  const status = providerStatus(provider, configs[provider.id], envKeys);
  const ready = status.tone === "success";
  const models = usableModels(provider, configs[provider.id], envKeys).length;
  return (
    <Tile
      icon={<ProviderLogo logo={provider.logo} name={provider.name} className="size-7" />}
      title={provider.name}
      badge={
        provider.id === "puter" ? (
          <TileBadge tone="free">{t("modelsFreeBadge")}</TileBadge>
        ) : EASY_IDS.has(provider.id) ? (
          <TileBadge>{t("modelsEasyBadge")}</TileBadge>
        ) : undefined
      }
      description={provider.description}
      meta={
        ready ? (
          <Dot tone="success">
            {status.label} · {models} model{models === 1 ? "" : "s"}
          </Dot>
        ) : undefined
      }
      onOpen={onOpen}
      openLabel={`${ready ? t("modelsManageBtn") : t("modelsSetupBtn")} ${provider.name}`}
      action={
        <TileButton label={ready ? t("modelsManageBtn") : t("modelsSetupBtn")} onClick={onOpen}>
          {ready ? <ChevronRightIcon /> : <PlusIcon />}
        </TileButton>
      }
    />
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
    <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <LockKeyholeIcon className="size-3.5 shrink-0" />
      API keys and MCP tokens are stored in {where}, not in plain text.
    </p>
  );
}
