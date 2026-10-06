import { useAntigravity } from "@/features/antigravity";
import { useCliAgentsFilter } from "@/features/cli-agents";
import { useCustomClis } from "@/features/custom-cli";
import { useCursor } from "@/features/cursor";
import { useOpencode, type WorkMode } from "@/features/opencode";
import { listConfiguredProviders, useEnvKeys, useProviderConfigs } from "@/features/providers";
import { useMemo } from "react";
import { buildModelCatalog } from "../models";

/** Every model offered for `mode`, built the same way as the chat box's picker. */
export function useModelCatalog(mode: WorkMode) {
  const opencode = useOpencode();
  const cursor = useCursor();
  const antigravity = useAntigravity();
  const providerConfigs = useProviderConfigs();
  const envKeys = useEnvKeys();
  const customClis = useCustomClis();
  const cliFilter = useCliAgentsFilter();
  const cursorStatus = useMemo(
    () => ({ models: cursor.models, loggedIn: !!cursor.check?.loggedIn }),
    [cursor.models, cursor.check?.loggedIn],
  );
  const antigravityStatus = useMemo(
    () => ({ models: antigravity.models, loggedIn: !!antigravity.check?.loggedIn }),
    [antigravity.models, antigravity.check?.loggedIn],
  );
  const catalog = useMemo(
    () =>
      buildModelCatalog(
        opencode.models,
        listConfiguredProviders(providerConfigs, envKeys),
        mode,
        cursorStatus,
        undefined,
        antigravityStatus,
        customClis,
        cliFilter,
      ),
    [opencode.models, providerConfigs, envKeys, mode, cursorStatus, antigravityStatus, customClis, cliFilter],
  );
  return { catalog, loading: opencode.loading };
}
