/** Prefixes copied from Claude Code docs (see `plugins_resolve` in Rust). */
const PLUGIN_PREFIXES = [
  "claude plugin marketplace add",
  "/plugin marketplace add",
  "claude plugin install",
  "/plugin install",
] as const;

export function stripPluginCommandPrefix(input: string): string {
  let text = input.trim().replace(/^\$+\s*/, "");
  for (const prefix of PLUGIN_PREFIXES) {
    if (text.toLowerCase().startsWith(prefix)) {
      text = text.slice(prefix.length).trim();
      break;
    }
  }
  return text;
}

function looksLikePluginCommand(line: string): boolean {
  const lower = line.toLowerCase();
  return PLUGIN_PREFIXES.some((p) => lower.startsWith(p));
}

const SKILL_RUNNER =
  /^(?:npx|bunx|pnpx|pnpm\s+dlx|yarn\s+dlx|npm\s+exec|bun\s+x)(?:\s+-[^\s]+)*\s+(?:[\w@./-]+\s+)?(?:skillfish|skills|openskills|add-skill)\s+(?:add|install|i)\b/i;

const SKILL_BARE = /^(?:skillfish|skills|add-skill|openskills)\s+(?:add|install|i)\b/i;

export type ChatInstallRequest =
  | { kind: "plugin"; input: string }
  | { kind: "skill"; input: string };

/**
 * When the whole composer message is an install command, handle it in-app
 * instead of sending it to the model.
 */
export function parseChatInstall(text: string): ChatInstallRequest | null {
  const line = text.trim().replace(/^\$+\s*/, "");
  if (!line || line.includes("\n")) return null;

  if (looksLikePluginCommand(line)) {
    return { kind: "plugin", input: line };
  }
  if (SKILL_RUNNER.test(line) || SKILL_BARE.test(line)) {
    return { kind: "skill", input: line };
  }
  return null;
}
