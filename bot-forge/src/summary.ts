/**
 * What a bot can do and what it's connected to, at a glance: the same
 * summary in the terminal, the web page and the bot's README.
 */
import type { BotSpec, Connector } from "./schema";
import { TOOL_SCOPE_TEXT } from "./schema";

/** The last live check of a connector (`mcp-check.ts`). */
export type CheckResult =
  | { ok: true; tools: string[]; serverName?: string; at: string }
  | { ok: false; error: string; at: string };

/**
 * - `connected`: a live check reached it and listed its tools
 * - `ready`: everything it needs is set; not checked yet
 * - `needs-setup`: a variable it needs isn't set here
 * - `failed`: the last check couldn't reach it
 */
export type ConnectionState = "connected" | "ready" | "needs-setup" | "failed";

export type ConnectionSummary = {
  name: string;
  title: string;
  kind: Connector["kind"];
  /** The command line or the URL. */
  target: string;
  state: ConnectionState;
  missing: string[];
  tools: string[];
  error?: string;
};

export type BotSummary = {
  name: string;
  duty: string;
  access: string;
  capabilities: string[];
  examples: string[];
  skills: { name: string; description: string }[];
  connections: ConnectionSummary[];
  counts: { connectors: number; connected: number; needsSetup: number; failed: number; skills: number };
  worksWith: string[];
};

export function target(c: Connector): string {
  return c.kind === "remote" ? c.url : [c.command, ...c.args].join(" ");
}

export function summarize(spec: BotSpec, env: Record<string, string | undefined> = {}, checks: Record<string, CheckResult> = {}): BotSummary {
  const connections = spec.connectors.map((c): ConnectionSummary => {
    const missing = c.env.filter((v) => v.required && !env[v.var]?.trim()).map((v) => v.var);
    const check = checks[c.name];
    const base = { name: c.name, title: c.title, kind: c.kind, target: target(c), missing, tools: [] as string[] };
    if (check?.ok) return { ...base, state: "connected", tools: check.tools };
    if (missing.length) return { ...base, state: "needs-setup" };
    if (check && !check.ok) return { ...base, state: "failed", error: check.error };
    return { ...base, state: "ready" };
  });
  // What it can do: what it was made to do, then what each part brings.
  const capabilities = [
    ...spec.capabilities,
    ...spec.connectors.map((c) => (c.description ? `${c.title}: ${c.description}` : `Uses ${c.title}`)),
    ...spec.skills.map((s) => `Skill ${s.name}: ${s.description}`),
  ];
  return {
    name: spec.name,
    duty: spec.duty,
    access: TOOL_SCOPE_TEXT[spec.tools],
    capabilities: [...new Set(capabilities)],
    examples: spec.examples,
    skills: spec.skills.map((s) => ({ name: s.name, description: s.description })),
    connections,
    counts: {
      connectors: connections.length,
      connected: connections.filter((c) => c.state === "connected").length,
      needsSetup: connections.filter((c) => c.state === "needs-setup").length,
      failed: connections.filter((c) => c.state === "failed").length,
      skills: spec.skills.length,
    },
    worksWith: ["Mali Cowork (Settings › Team › Import bot)", "Claude Code (as a plugin)"],
  };
}

const MARK: Record<ConnectionState, string> = { connected: "●", ready: "○", "needs-setup": "◐", failed: "✕" };
const WORD: Record<ConnectionState, string> = { connected: "connected", ready: "ready, not checked", "needs-setup": "needs setup", failed: "failed" };

/** The summary for a terminal. */
export function renderText(s: BotSummary): string {
  const lines = [`${s.name}`, `  ${s.duty}`, "", `Access: ${s.access}`];
  if (s.capabilities.length) lines.push("", "Can do:", ...s.capabilities.map((c) => `  • ${c}`));
  if (s.examples.length) lines.push("", "Try asking:", ...s.examples.map((e) => `  “${e}”`));
  lines.push("", `Connections (${s.counts.connectors}):`);
  if (!s.connections.length) lines.push("  none — it works with its own tools only");
  for (const c of s.connections) {
    lines.push(`  ${MARK[c.state]} ${c.title} [${c.name}] — ${WORD[c.state]}`);
    lines.push(`      ${c.kind === "remote" ? "url" : "runs"}: ${c.target}`);
    if (c.missing.length) lines.push(`      set: ${c.missing.join(", ")}`);
    if (c.tools.length) lines.push(`      tools (${c.tools.length}): ${c.tools.slice(0, 8).join(", ")}${c.tools.length > 8 ? ", …" : ""}`);
    if (c.error) lines.push(`      error: ${c.error}`);
  }
  lines.push("", `Skills (${s.counts.skills}):`);
  if (!s.skills.length) lines.push("  none");
  for (const k of s.skills) lines.push(`  • ${k.name} — ${k.description}`);
  lines.push("", `Works with: ${s.worksWith.join(", ")}`);
  return lines.join("\n");
}

/** The README that travels with the bot. */
export function renderReadme(spec: BotSpec): string {
  const s = summarize(spec);
  const out = [`# ${spec.name}`, "", `> ${spec.duty}`, "", `**Access:** ${s.access}`, ""];
  if (s.capabilities.length) out.push("## What it can do", "", ...s.capabilities.map((c) => `- ${c}`), "");
  if (s.examples.length) out.push("## Try asking", "", ...s.examples.map((e) => `- “${e}”`), "");
  out.push("## Connectors", "");
  if (!spec.connectors.length) out.push("None.", "");
  for (const c of spec.connectors) {
    out.push(`- **${c.title}** (\`${c.name}\`) — ${c.kind === "remote" ? `\`${c.url}\`` : `\`${target(c)}\``}`);
    for (const v of c.env) out.push(`  - needs \`${v.var}\`${v.label && v.label !== v.var ? ` (${v.label})` : ""}${v.required ? "" : ", optional"}`);
  }
  out.push("", "## Skills", "");
  if (!spec.skills.length) out.push("None.");
  for (const k of spec.skills) out.push(`- **${k.name}** — ${k.description}`);
  out.push(
    "",
    "## Install",
    "",
    "- **Mali Cowork:** Settings › Team › Import bot, and pick the .zip (or this folder). Choose whether it joins the team, is your own bot in the chat box, or both — and which model it runs on.",
    "- **Claude Code:** add this folder as a plugin (e.g. from a local marketplace).",
    "- Set the variables listed under Connectors where the bot runs; they are never stored in these files.",
    "",
    "_Made with bot-forge._",
    "",
  );
  return out.join("\n");
}
