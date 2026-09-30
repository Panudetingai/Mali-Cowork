import { loadSelectedModelId, type AiModel } from "@/pages/chat/models";
import { useModelCatalog } from "@/pages/chat/hooks/use-model-catalog";
import { useMemo } from "react";
import { runsOn } from "./payload";

/**
 * Models a bot can run on, as the chat box lists them: API models (on Mali's
 * own agent) and the CLI agents — Codex, Cursor, Antigravity and OpenCode.
 */
export function useTeamModels(): AiModel[] {
  const { catalog } = useModelCatalog("cowork");
  return useMemo(() => catalog.filter((m) => !m.issue && !m.media && runsOn(m.id) !== undefined), [catalog]);
}

/** The model a bot taken on in one click runs on: the Cowork pick, or the first API model. */
export function defaultTeamModel(models: AiModel[]): string | undefined {
  const picked = loadSelectedModelId("cowork");
  return models.find((m) => m.id === picked)?.id ?? models[0]?.id;
}
