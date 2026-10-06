import { fetchPlugin, resolvePluginSource } from "@/features/plugins/api";
import { getPlugins } from "@/features/plugins/store";
import type { PluginFetch } from "@/features/plugins/types";
import { stripPluginCommandPrefix } from "./parse";

/**
 * `/plugin install ponytail@ponytail` — plugin name @ saved marketplace name.
 * Everything else goes through `plugins_resolve` (owner/repo, links, folders).
 */
export async function fetchPluginFromChatInput(input: string): Promise<PluginFetch & { marketplace?: string; overlay?: Record<string, unknown> }> {
  const rest = stripPluginCommandPrefix(input);
  const marketRef = rest.match(/^([^/@\s]+)@([^/@\s]+)$/);
  if (marketRef && !rest.includes("/")) {
    const pluginName = marketRef[1];
    const marketName = marketRef[2];
    const saved = getPlugins().marketplaces.find((m) => m.name.toLowerCase() === marketName.toLowerCase());
    if (!saved) {
      throw new Error(
        `No marketplace “${marketName}” yet. Add it first, e.g. /plugin marketplace add owner/repo`,
      );
    }
    const listed = await fetchPlugin(saved.source);
    const market = listed.marketplace;
    if (!market) throw new Error(`“${marketName}” is not a marketplace anymore.`);
    const entry = market.plugins.find((p) => p.name.toLowerCase() === pluginName.toLowerCase());
    if (!entry?.source) {
      throw new Error(`“${marketName}” has no plugin called “${pluginName}”.`);
    }
    const fetched = await fetchPlugin(entry.source, entry.entry ?? undefined);
    return { ...fetched, marketplace: market.name, overlay: entry.entry ?? undefined };
  }

  const source = await resolvePluginSource(input);
  return fetchPlugin(source);
}
