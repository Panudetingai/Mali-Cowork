import { useAntigravity } from "@/features/antigravity";
import { useCliAgentsFilter } from "@/features/cli-agents";
import { useCustomClis } from "@/features/custom-cli";
import { useCursor } from "@/features/cursor";
import { useOpencode, type WorkMode } from "@/features/opencode";
import { listConfiguredProviders, useEnvKeys, useProviderConfigs } from "@/features/providers";
import { useMemo } from "react";
import { buildModelCatalog } from "../models";

/** Matches `groupKeyOf` in the model picker (`section:label`). */
const OPENCODE_GROUP_KEY = "opencode:OpenCode";
const CURSOR_GROUP_KEY = "cli:Cursor CLI";
const ANTIGRAVITY_GROUP_KEY = "cli:Antigravity CLI";

/** Provider rail keys still waiting on a CLI / OpenCode model list. */
export function loadingGroupKeysFor(opts: {
  opencode: { loading: boolean };
  cursor: { loading: boolean; loggedIn: boolean };
  antigravity: { loading: boolean; loggedIn: boolean };
  cliFilter: { opencode?: boolean; cursor?: boolean; antigravity?: boolean };
}): Set<string> {
  const keys = new Set<string>();
  const { opencode, cursor, antigravity, cliFilter } = opts;

  if (cliFilter.opencode !== false && opencode.loading) keys.add(OPENCODE_GROUP_KEY);
  if (cliFilter.cursor !== false && cursor.loading && cursor.loggedIn) keys.add(CURSOR_GROUP_KEY);
  if (cliFilter.antigravity !== false && antigravity.loading && antigravity.loggedIn) {
    keys.add(ANTIGRAVITY_GROUP_KEY);
  }
  return keys;
}

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
  const loadingGroupKeys = useMemo(
    () =>
      loadingGroupKeysFor({
        opencode: { loading: opencode.loading },
        cursor: { loading: cursor.loading, loggedIn: cursorStatus.loggedIn },
        antigravity: { loading: antigravity.loading, loggedIn: antigravityStatus.loggedIn },
        cliFilter,
      }),
    [opencode.loading, cursor.loading, cursorStatus.loggedIn, antigravity.loading, antigravityStatus.loggedIn, cliFilter],
  );
  const sourcesLoading = opencode.loading || cursor.loading || antigravity.loading;

  return { catalog, loading: sourcesLoading, loadingGroupKeys };
}
