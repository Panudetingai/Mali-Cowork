/** Markdown front matter: flat `key: value` lines, enough for agents and skills. */

export type Front = Record<string, string>;

export function splitFrontMatter(text: string): { meta: Front; body: string } {
  const match = /^---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)([\s\S]*)$/.exec(text.trim());
  if (!match) return { meta: {}, body: text.trim() };
  const meta: Front = {};
  for (const line of match[1].split(/\r?\n/)) {
    const found = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line);
    if (found) meta[found[1].toLowerCase()] = unquote(found[2].trim());
  }
  return { meta, body: match[2].trim() };
}

export function joinFrontMatter(meta: Front, body: string): string {
  const lines = Object.entries(meta)
    .filter(([, v]) => v !== "")
    .map(([k, v]) => `${k}: ${quote(v)}`);
  return `---\n${lines.join("\n")}\n---\n\n${body.trim()}\n`;
}

/** A value on one line, quoted when YAML would read it as something else. */
function quote(value: string): string {
  const flat = value.replace(/\s*\r?\n\s*/g, " ").trim();
  return /^[\s"'&*!|>%@`#{[]|: | #|^(true|false|null|yes|no)$/i.test(flat) || flat === "" ? JSON.stringify(flat) : flat;
}

function unquote(value: string): string {
  if (value.startsWith('"') && value.endsWith('"')) {
    try {
      return JSON.parse(value) as string;
    } catch {
      return value.slice(1, -1);
    }
  }
  return value.replace(/^'(.*)'$/, "$1");
}

/** `a, b, c` → `["a", "b", "c"]`. */
export const listOf = (value: string | undefined) =>
  (value ?? "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
