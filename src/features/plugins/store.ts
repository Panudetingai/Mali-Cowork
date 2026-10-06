import { createStore } from "@/lib/local-store";
import type { Marketplace, PluginPanel, PluginSource } from "./types";

/** What one installed plugin brought, so it can be turned off or removed whole. */
export type InstalledPlugin = {
  id: string;
  name: string;
  version?: string;
  description: string;
  author?: string;
  homepage?: string;
  source: PluginSource;
  /** The marketplace it was picked from, by name. */
  marketplace?: string;
  /** The marketplace's entry, read again on update. */
  overlay?: Record<string, unknown>;
  /** Changes whenever the plugin's files do (GitHub only). */
  revision?: string;
  enabled: boolean;
  installedAt: string;
  updatedAt: string;
  /** Skill ids — skills and slash commands — in the user's library. */
  skills: string[];
  /** Custom connector ids (`custom-…`). */
  connectors: string[];
  /** Teammate ids. */
  bots: string[];
  /** Template ids in the template library. */
  templates: string[];
  panels: PluginPanel[];
  /** Added to every chat while the plugin is on. */
  instructions?: string;
  /** What the plugin has that Mali leaves out. */
  unsupported: string[];
  /** What was on when the plugin was turned off, to turn back on. */
  paused?: { skills: string[]; connectors: string[] };
  /** A newer version is out (from the last check). */
  update?: { version?: string; revision?: string };
  checkedAt?: string;
};

/** A marketplace the user added, read again whenever it's opened. */
export type SavedMarketplace = {
  name: string;
  description: string;
  source: PluginSource;
  addedAt: string;
};

export type PluginsState = {
  plugins: InstalledPlugin[];
  marketplaces: SavedMarketplace[];
};

const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

function revivePlugin(value: Partial<InstalledPlugin>): InstalledPlugin | null {
  if (!value || typeof value.id !== "string" || typeof value.name !== "string" || !value.source) return null;
  return {
    ...value,
    id: value.id,
    name: value.name,
    description: typeof value.description === "string" ? value.description : "",
    source: value.source,
    enabled: value.enabled !== false,
    installedAt: typeof value.installedAt === "string" ? value.installedAt : new Date().toISOString(),
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : new Date().toISOString(),
    skills: strings(value.skills),
    connectors: strings(value.connectors),
    bots: strings(value.bots),
    templates: strings(value.templates),
    panels: Array.isArray(value.panels) ? value.panels.filter((p) => p && typeof p.entry === "string") : [],
    unsupported: strings(value.unsupported),
  };
}

const store = createStore<PluginsState>(
  { plugins: [], marketplaces: [] },
  {
    key: "mali_plugins",
    revive: (value) => ({
      plugins: Array.isArray(value?.plugins)
        ? value.plugins.map(revivePlugin).filter((p): p is InstalledPlugin => !!p)
        : [],
      marketplaces: Array.isArray(value?.marketplaces)
        ? value.marketplaces.filter((m) => m && typeof m.name === "string" && m.source)
        : [],
    }),
  },
);

export const usePlugins = store.use;
export const getPlugins = store.get;
export const subscribeToPlugins = store.subscribe;

export function getPlugin(id: string) {
  return store.get().plugins.find((p) => p.id === id);
}

export function savePlugin(plugin: InstalledPlugin) {
  store.set((s) => {
    const exists = s.plugins.some((p) => p.id === plugin.id);
    return {
      ...s,
      plugins: exists ? s.plugins.map((p) => (p.id === plugin.id ? plugin : p)) : [...s.plugins, plugin],
    };
  });
}

export function patchPlugin(id: string, patch: Partial<InstalledPlugin>) {
  store.set((s) => ({ ...s, plugins: s.plugins.map((p) => (p.id === id ? { ...p, ...patch } : p)) }));
}

export function forgetPlugin(id: string) {
  store.set((s) => ({ ...s, plugins: s.plugins.filter((p) => p.id !== id) }));
}

export function saveMarketplace(market: Pick<Marketplace, "name" | "description" | "source">) {
  store.set((s) => {
    const rest = s.marketplaces.filter((m) => m.name !== market.name);
    return {
      ...s,
      marketplaces: [
        ...rest,
        { name: market.name, description: market.description, source: market.source, addedAt: new Date().toISOString() },
      ],
    };
  });
}

export function removeMarketplace(name: string) {
  store.set((s) => ({ ...s, marketplaces: s.marketplaces.filter((m) => m.name !== name) }));
}

/** The instructions of every plugin that's on, as one section of the system prompt. */
export function pluginInstructions(state: PluginsState = store.get()): string | undefined {
  const parts = state.plugins
    .filter((p) => p.enabled && p.instructions?.trim())
    .map((p) => `## ${p.name}\n${p.instructions!.trim()}`);
  return parts.length ? `# Instructions from plugins\n${parts.join("\n\n")}` : undefined;
}
