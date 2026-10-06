/**
 * Installing, updating, pausing and removing a plugin as one thing.
 *
 * Each part goes where Mali already keeps that kind of thing — skills in
 * the skill library, bots on the team, connectors with the others — tagged
 * with the plugin's id, and the plugin's record lists them so it can turn
 * them off together or take them all away.
 */
import {
  deleteSkill,
  fromSkillFile,
  getInstructions,
  saveSkill,
  skillSlug,
  toggleSkill,
  toSkillFile,
  type Skill,
} from "@/features/instructions";
import {
  applyConnector,
  customMcpId,
  getCustomMcps,
  getMcpConnections,
  removeConnector,
  saveCustomMcp,
  setMcpEnv,
} from "@/features/mcp";
import { installSkills, takenSlugs, toInstallRecord, uniqueSlug, uninstallSkill } from "@/features/skills";
import type { SkillAsset, SkillPackage } from "@/features/skills/types";
import {
  freeMascot,
  getTeam,
  removeTeammate,
  saveTeammate,
  setTeammatesPaused,
  type TeammateDraft,
} from "@/features/team/store";
import { removeTemplate, syncTemplateSkill, updateTemplate } from "@/features/templates";
import { fetchPlugin, installPluginFiles, peekPlugin, removePluginFiles, sameSource, sourceLabel } from "./api";
import { clearPanelStorage } from "./bridge";
import { agentToTeammate, commandToSkill, humanize, mcpToConnector } from "./convert";
import { forgetPlugin, getPlugin, getPlugins, patchPlugin, savePlugin, type InstalledPlugin } from "./store";
import type { PluginDoc, PluginFile, PluginMcp, PluginPackage } from "./types";

/** What the user kept from a plugin in the install dialog. */
export type PluginChoices = {
  skills: SkillPackage[];
  commands: PluginDoc[];
  agents: PluginDoc[];
  /** The model new bots run on; needed when `agents` has any. */
  agentModelId?: string;
  connectors: PluginMcp[];
  templates: PluginFile[];
  panels: boolean;
  instructions: boolean;
};

export type PluginInstallReport = {
  skills: number;
  commands: number;
  bots: number;
  connectors: number;
  templates: number;
  panels: number;
  /** Parts left out, in words. */
  skipped: string[];
};

/** The plugin's own skills (and commands) in the library, by `/name`. */
function ownSkills(plugin: InstalledPlugin | undefined): Map<string, Skill> {
  const ids = new Set(plugin?.skills ?? []);
  return new Map(getInstructions().skills.filter((s) => ids.has(s.id)).map((s) => [skillSlug(s), s]));
}

/** Install `pkg` — or, when it's installed already, update it to what was chosen. */
export async function installPlugin(
  pkg: PluginPackage,
  choices: PluginChoices,
  { marketplace, overlay }: { marketplace?: string; overlay?: Record<string, unknown> } = {},
): Promise<PluginInstallReport> {
  const before = getPlugin(pkg.id);
  if (before && !sameSource(before.source, pkg.source)) {
    throw new Error(`A plugin called “${before.name}” is installed already, from ${sourceLabel(before.source)}. Remove it first.`);
  }
  const skipped: string[] = [];
  const pluginOn = before?.enabled ?? true;

  // ── Skills and slash commands ───────────────────────────────────────────
  const mine = ownSkills(before);
  const others = getInstructions().skills.filter((s) => !(before?.skills ?? []).includes(s.id));
  const taken = new Set(takenSlugs());
  type Planned = { draft: Omit<Skill, "id">; files: SkillAsset[]; replaces?: Skill; slug: string };
  const planned: Planned[] = [];
  const plan = (draft: Omit<Skill, "id">, files: SkillAsset[]) => {
    const key = skillSlug(draft);
    if (planned.some((p) => skillSlug(p.draft) === key)) return;
    if (others.some((s) => skillSlug(s) === key)) {
      skipped.push(`/${key} — you have a skill with that name already`);
      return;
    }
    const replaces = mine.get(key);
    const slug = replaces?.install?.slug ?? uniqueSlug(draft, taken);
    taken.add(slug);
    planned.push({ draft, files, replaces, slug });
  };
  for (const found of choices.skills) {
    const draft = fromSkillFile(found.content, found.folder || "Skill");
    if (!draft.name.trim() || !draft.instructions.trim()) continue;
    plan({ ...draft, source: found.source, plugin: pkg.id }, found.files.filter((f) => !f.skipped));
  }
  const skillCount = planned.length;
  for (const doc of choices.commands) {
    plan({ ...commandToSkill(doc, pkg.name), source: `${pkg.sourceLabel}/${doc.path}`, plugin: pkg.id }, []);
  }

  const installed = planned.length
    ? await installSkills(planned.map((p) => ({ slug: p.slug, content: toSkillFile(p.draft), files: p.files })))
    : [];
  const skillIds: string[] = [];
  for (const p of planned) {
    const landed = installed.find((i) => i.slug === p.slug);
    skillIds.push(
      saveSkill({
        ...p.draft,
        id: p.replaces?.id,
        // An update keeps what the user switched off; a paused plugin stays paused.
        enabled: pluginOn && (p.replaces?.enabled ?? true),
        install: landed ? toInstallRecord(landed) : undefined,
      }),
    );
  }
  for (const [, old] of mine) {
    if (skillIds.includes(old.id)) continue;
    deleteSkill(old.id);
    if (old.install) void uninstallSkill(old.install.slug).catch(() => undefined);
  }

  // ── Connectors ──────────────────────────────────────────────────────────
  // Added but not connected: the user connects each one (and gives it keys) themselves.
  const oldConnectors = getCustomMcps().filter((c) => before?.connectors.includes(c.id));
  const connectorIds: string[] = [];
  for (const server of choices.connectors) {
    if (server.skipped) {
      skipped.push(`${server.name} — ${server.skipped}`);
      continue;
    }
    const existing = oldConnectors.find((c) => c.name === humanize(server.name));
    const id = existing?.id ?? customMcpId(`${pkg.name} ${server.name}`);
    const { connector, env } = mcpToConnector(server, { id, pluginId: pkg.id, pluginName: pkg.name });
    saveCustomMcp({ ...connector, createdAt: existing?.createdAt ?? connector.createdAt });
    if (Object.keys(env).length) setMcpEnv(id, env);
    connectorIds.push(id);
  }
  for (const old of oldConnectors) {
    if (!connectorIds.includes(old.id)) await removeConnector(old.id).catch(() => undefined);
  }
  // A connector that changed while connected starts again with its new command.
  const live = getMcpConnections();
  for (const id of connectorIds) {
    if (live[id]?.enabled) await applyConnector(id, { enabled: true }).catch(() => undefined);
  }

  // ── Bots ────────────────────────────────────────────────────────────────
  const mates = getTeam().mates;
  const oldBots = mates.filter((m) => before?.bots.includes(m.id));
  const botIds: string[] = [];
  for (const doc of choices.agents) {
    const existing = oldBots.find((m) => m.name === agentToTeammate(doc, { modelId: "", mascot: "mochi", pluginId: pkg.id }).name);
    const modelId = existing?.modelId ?? choices.agentModelId;
    if (!modelId) {
      skipped.push(`${humanize(doc.name)} — pick a model for new bots`);
      continue;
    }
    const draft: TeammateDraft = {
      ...agentToTeammate(doc, { modelId, mascot: existing?.mascot ?? freeMascot(getTeam().mates), pluginId: pkg.id }),
      ...(existing ? { id: existing.id, onTeam: existing.onTeam, skills: existing.skills, connectors: existing.connectors } : {}),
      ...(pluginOn ? {} : { paused: true }),
    };
    try {
      saveTeammate(draft);
      const saved = getTeam().mates.find((m) => (existing ? m.id === existing.id : m.name === draft.name && m.plugin === pkg.id));
      if (saved) botIds.push(saved.id);
    } catch (error) {
      skipped.push(`${draft.name} — ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  for (const old of oldBots) {
    if (!botIds.includes(old.id)) removeTeammate(old.id);
  }

  // ── Templates and panels: files Mali keeps ──────────────────────────────
  for (const id of before?.templates ?? []) await removeTemplate(id).catch(() => undefined);
  const templates = choices.templates.filter((t) => !t.skipped);
  const panelFiles = choices.panels ? pkg.panelFiles.filter((f) => !f.skipped) : [];
  let templateIds: string[] = [];
  let panels = choices.panels ? pkg.panels : [];
  if (templates.length || panelFiles.length || before) {
    const files = await installPluginFiles(
      pkg.id,
      pkg.name,
      templates.map((t) => ({ name: t.name, url: t.url })),
      panelFiles.map((f) => ({ name: f.name, url: f.url })),
    );
    for (const template of files.templates) {
      syncTemplateSkill(template);
      if (!pluginOn) await updateTemplate(template.id, { enabled: false }).catch(() => undefined);
    }
    templateIds = files.templates.map((t) => t.id);
    panels = panels.filter((p) => files.panelFiles.includes(p.entry));
    skipped.push(...files.failed);
  }

  const now = new Date().toISOString();
  savePlugin({
    id: pkg.id,
    name: pkg.name,
    version: pkg.version,
    description: pkg.description,
    author: pkg.author,
    homepage: pkg.homepage ?? pkg.repository,
    source: pkg.source,
    marketplace: marketplace ?? before?.marketplace,
    overlay: overlay ?? before?.overlay,
    revision: pkg.revision,
    enabled: pluginOn,
    installedAt: before?.installedAt ?? now,
    updatedAt: now,
    skills: skillIds,
    connectors: connectorIds,
    bots: botIds,
    templates: templateIds,
    panels,
    instructions: choices.instructions ? pkg.instructions : undefined,
    unsupported: pkg.unsupported,
    paused: before?.paused,
    checkedAt: now,
  });

  return {
    skills: skillCount,
    commands: planned.length - skillCount,
    bots: botIds.length,
    connectors: connectorIds.length,
    templates: templateIds.length,
    panels: panels.length,
    skipped,
  };
}

/** "12 skills, 3 commands and 1 bot" — what to tell the user afterwards. */
export function describePluginInstall(report: PluginInstallReport): string {
  const part = (n: number, one: string, many = `${one}s`) => (n ? `${n} ${n === 1 ? one : many}` : "");
  const parts = [
    part(report.skills, "skill"),
    part(report.commands, "command"),
    part(report.bots, "bot"),
    part(report.connectors, "connector"),
    part(report.templates, "template"),
    part(report.panels, "panel"),
  ].filter(Boolean);
  if (!parts.length) return "Nothing was installed.";
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : parts[0];
  return `Installed ${list}.`;
}

/**
 * Turn a plugin off (everything it brought stops, nothing is lost) or back
 * on (what was on before comes back).
 */
export async function setPluginEnabled(id: string, enabled: boolean) {
  const plugin = getPlugin(id);
  if (!plugin || plugin.enabled === enabled) return;
  const skills = getInstructions().skills.filter((s) => plugin.skills.includes(s.id));
  const connections = getMcpConnections();

  if (!enabled) {
    const paused = {
      skills: skills.filter((s) => s.enabled).map((s) => s.id),
      connectors: plugin.connectors.filter((c) => connections[c]?.enabled),
    };
    patchPlugin(id, { enabled: false, paused });
    for (const skillId of paused.skills) toggleSkill(skillId, false);
    setTeammatesPaused(plugin.bots, true);
    for (const connector of paused.connectors) await applyConnector(connector, { enabled: false }).catch(() => undefined);
    for (const template of plugin.templates) await updateTemplate(template, { enabled: false }).catch(() => undefined);
    return;
  }

  // Back on: what was on when it was turned off (everything, for one never paused).
  const restore = plugin.paused ?? { skills: plugin.skills, connectors: [] };
  patchPlugin(id, { enabled: true, paused: undefined });
  for (const skillId of restore.skills) toggleSkill(skillId, true);
  setTeammatesPaused(plugin.bots, false);
  for (const connector of restore.connectors) await applyConnector(connector, { enabled: true }).catch(() => undefined);
  for (const template of plugin.templates) await updateTemplate(template, { enabled: true }).catch(() => undefined);
}

/** Remove a plugin and everything it brought. */
export async function uninstallPlugin(id: string) {
  const plugin = getPlugin(id);
  if (!plugin) return;
  for (const skill of getInstructions().skills.filter((s) => plugin.skills.includes(s.id))) {
    deleteSkill(skill.id);
    if (skill.install) await uninstallSkill(skill.install.slug).catch(() => undefined);
  }
  for (const connector of plugin.connectors) await removeConnector(connector).catch(() => undefined);
  for (const bot of plugin.bots) removeTeammate(bot);
  for (const template of plugin.templates) await removeTemplate(template).catch(() => undefined);
  await removePluginFiles(id, []).catch(() => undefined);
  clearPanelStorage(id);
  forgetPlugin(id);
}

/** Read a plugin's source again, for its update. */
export async function fetchPluginUpdate(id: string): Promise<PluginPackage> {
  const plugin = getPlugin(id);
  if (!plugin) throw new Error("That plugin isn't installed");
  const fetched = await fetchPlugin(plugin.source, plugin.overlay);
  if (!fetched.plugin) throw new Error(`${sourceLabel(plugin.source)} no longer holds a plugin`);
  // The same plugin may have been renamed; it keeps the id it was installed under.
  return { ...fetched.plugin, id: plugin.id };
}

/**
 * Look for newer versions of plugins installed from GitHub. Cheap: one tree
 * listing and the manifest each. Returns how many have an update.
 */
export async function checkPluginUpdates(): Promise<number> {
  const now = new Date().toISOString();
  let found = 0;
  for (const plugin of getPlugins().plugins) {
    if (plugin.source.kind !== "github") continue;
    try {
      const head = await peekPlugin(plugin.source);
      const changed =
        (!!head.revision && !!plugin.revision && head.revision !== plugin.revision) ||
        (!!head.version && !!plugin.version && head.version !== plugin.version);
      patchPlugin(plugin.id, { checkedAt: now, update: changed ? { version: head.version, revision: head.revision } : undefined });
      if (changed) found++;
    } catch {
      // Offline or rate-limited: try again next time.
    }
  }
  return found;
}

/** Which parts of a plugin are installed now, by name — to preselect them on update. */
export function installedNames(id: string) {
  const plugin = getPlugin(id);
  const skills = getInstructions().skills.filter((s) => plugin?.skills.includes(s.id));
  return {
    skills: new Set(skills.filter((s) => !s.slashOnly).map(skillSlug)),
    commands: new Set(skills.filter((s) => s.slashOnly).map(skillSlug)),
    bots: new Set(getTeam().mates.filter((m) => plugin?.bots.includes(m.id)).map((m) => m.name)),
    connectors: new Set(getCustomMcps().filter((c) => plugin?.connectors.includes(c.id)).map((c) => c.name)),
  };
}
