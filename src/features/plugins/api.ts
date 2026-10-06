import { invoke } from "@tauri-apps/api/core";
import type { InstalledFiles, PluginFetch, PluginHead, PluginSource } from "./types";

/** What the user typed — `owner/repo`, a link, a folder — as a source. */
export function resolvePluginSource(input: string) {
  return invoke<PluginSource>("plugins_resolve", { input });
}

/**
 * What a source offers. `overlay` is a marketplace's entry for the plugin,
 * which may describe parts its own manifest leaves out.
 */
export function fetchPlugin(source: PluginSource, overlay?: Record<string, unknown>) {
  return invoke<PluginFetch>("plugins_fetch", { source, overlay: overlay ?? null });
}

/** Name, version and revision only: enough to notice an update. */
export function peekPlugin(source: PluginSource) {
  return invoke<PluginHead>("plugins_peek", { source });
}

export function installPluginFiles(
  id: string,
  pluginName: string,
  templates: { name: string; url: string }[],
  panelFiles: { name: string; url: string }[],
) {
  return invoke<InstalledFiles>("plugins_install_files", { id, pluginName, templates, panelFiles });
}

export function removePluginFiles(id: string, templates: string[]) {
  return invoke<void>("plugins_remove_files", { id, templates });
}

export function setTemplateEnabled(id: string, enabled: boolean) {
  return invoke("templates_update", { id, name: null, description: null, enabled });
}

/** Where a panel's file is served: its own scheme, sandboxed (see `plugins/files.rs`). */
export function panelUrl(pluginId: string, file: string) {
  const path = [pluginId, ...file.split("/")].map(encodeURIComponent).join("/");
  // WebView2 serves custom schemes as http://<scheme>.localhost.
  return /Windows/i.test(navigator.userAgent)
    ? `http://mali-plugin.localhost/${path}`
    : `mali-plugin://localhost/${path}`;
}

/** `owner/repo` or the folder's name, for a short line under a title. */
export function sourceLabel(source: PluginSource) {
  if (source.kind === "folder") return source.path;
  return `${source.owner}/${source.repo}${source.dir ? `/${source.dir}` : ""}${source.ref ? `@${source.ref}` : ""}`;
}

/** Where to look at the source in a browser, when it's on GitHub. */
export function sourceUrl(source: PluginSource) {
  if (source.kind !== "github") return undefined;
  const base = `https://github.com/${source.owner}/${source.repo}`;
  return source.dir || source.ref ? `${base}/tree/${source.ref ?? "HEAD"}/${source.dir}` : base;
}

export function sameSource(a: PluginSource, b: PluginSource) {
  return sourceLabel(a).toLowerCase() === sourceLabel(b).toLowerCase() && a.kind === b.kind;
}
