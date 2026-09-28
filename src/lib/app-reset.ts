// Settings → General: clear the cache, or put the app back to how it was
// when first installed.

import { deleteChats, flushChatHistory, getChatIds, getRuns } from "@/features/chat-history";
import { deleteProject, flushProjects, getProjects } from "@/features/projects";
import { invoke } from "@tauri-apps/api/core";
import { relaunch } from "@tauri-apps/plugin-process";

/** Bytes of cached files (catalogs, prices) the app can fetch again. */
export const cacheSize = () => invoke<number>("app_cache_size");

/** Remove the cache; resolves with the bytes freed. */
export const clearCache = () => invoke<number>("app_clear_cache");

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
}

/** Is an agent still working? A reset would cut it off. */
export const anythingRunning = () => Object.keys(getRuns()).length > 0;

/**
 * Every setting back to its default (models, MCP servers, skills list,
 * folder access, theme, language), then restart. Chats, projects, API keys
 * (in the system keychain) and files on disk stay.
 */
export async function resetSettings() {
  localStorage.clear();
  sessionStorage.clear();
  await relaunch();
}

/** Settings, chats and projects all go; the app starts as if just installed. */
export async function resetEverything() {
  deleteChats(getChatIds());
  for (const project of getProjects()) deleteProject(project.id);
  await Promise.all([flushChatHistory(), flushProjects()]);
  await resetSettings();
}
