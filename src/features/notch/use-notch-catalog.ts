/**
 * The models the notch offers, built like the chat box's picker but without
 * `useOpencode`: that one syncs providers first, which waits for the keychain
 * (never loaded in this window, so it waited forever — the endless spinner,
 * and no OpenCode models at all), and syncing without the keys would drop
 * them. The notch only reads OpenCode's list, as the Quick bar does.
 */
import { useAntigravity } from "@/features/antigravity";
import { useCursor } from "@/features/cursor";
import {
  ensureOpencodeModels,
  getOpencodeModels,
  loadOpencodeSettings,
  type OpencodeModelsResult,
  type WorkMode,
} from "@/features/opencode";
import { listConfiguredProviders, useEnvKeys, useProviderConfigs } from "@/features/providers";
import { normalizeFolder } from "@/features/workspace";
import { buildModelCatalog } from "@/pages/chat/models";
import { useEffect, useMemo, useState } from "react";

/** OpenCode starts with the app; give up on its list after this and show the rest. */
const LIST_TIMEOUT_MS = 15_000;

export function useNotchCatalog(mode: WorkMode) {
  const [opencode, setOpencode] = useState<OpencodeModelsResult | null>(getOpencodeModels);
  const [loading, setLoading] = useState(!opencode);
  const cursor = useCursor();
  const antigravity = useAntigravity();
  const providerConfigs = useProviderConfigs();
  const envKeys = useEnvKeys();

  useEffect(() => {
    if (opencode) return;
    let live = true;
    const cwd = normalizeFolder(loadOpencodeSettings().cwd) || undefined;
    const timeout = setTimeout(() => live && setLoading(false), LIST_TIMEOUT_MS);
    void ensureOpencodeModels(cwd).then((models) => {
      if (!live) return;
      setOpencode(models);
      setLoading(false);
      clearTimeout(timeout);
    });
    return () => {
      live = false;
      clearTimeout(timeout);
    };
  }, [opencode]);

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
        opencode,
        listConfiguredProviders(providerConfigs, envKeys),
        mode,
        cursorStatus,
        undefined,
        antigravityStatus,
      ),
    [opencode, providerConfigs, envKeys, mode, cursorStatus, antigravityStatus],
  );
  return { catalog, loading: loading || cursor.loading || antigravity.loading };
}
