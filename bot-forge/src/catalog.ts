/**
 * Connectors bot-forge knows by name, copied from Mali Cowork's vetted
 * catalog (`bun run sync-catalog`), plus custom ones: any MCP server by
 * command or by URL.
 */
import catalogFile from "../data/connectors.json" with { type: "json" };
import { splitCommand } from "./cmdline";
import { Connector, EnvVar, slugify } from "./schema";

export { splitCommand };

export type CatalogEntry = {
  id: string;
  name: string;
  description: string;
  category: string;
  command: string;
  args: string[];
  env: EnvVar[];
  setup?: string;
  repositoryUrl?: string;
};

export const CATALOG: CatalogEntry[] = catalogFile.connectors as CatalogEntry[];

export function catalogEntry(id: string): CatalogEntry | undefined {
  const key = id.trim().toLowerCase();
  return CATALOG.find((c) => c.id === key || c.name.toLowerCase() === key);
}

/** A catalog entry as the bot's connector. */
export function fromCatalog(entry: CatalogEntry): Connector {
  return Connector.parse({
    kind: "local",
    name: entry.id,
    title: entry.name,
    description: entry.description,
    catalogId: entry.id,
    command: entry.command,
    args: entry.args,
    env: entry.env,
  });
}

/** `${API_KEY}` or `$API_KEY` names in a value. */
export function varsIn(value: string): string[] {
  return [...value.matchAll(/\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-[^}]*)?\}|\$([A-Za-z_][A-Za-z0-9_]*)/g)].map((m) => m[1] ?? m[2]);
}

/** A connector the user describes: a URL (remote) or a command line (local). */
export function customConnector(input: {
  name?: string;
  title?: string;
  description?: string;
  url?: string;
  command?: string;
  headers?: Record<string, string>;
  env?: string[];
}): Connector {
  const title = input.title?.trim() || input.name?.trim() || (input.url ? new URL(input.url).hostname : splitCommand(input.command ?? "")[0] ?? "connector");
  const name = slugify(input.name || title, "connector");
  const declared = (input.env ?? []).map((v) => v.trim()).filter(Boolean);
  if (input.url) {
    const headers = input.headers ?? {};
    const vars = [...new Set([...declared, ...Object.values(headers).flatMap(varsIn)])];
    return Connector.parse({
      kind: "remote",
      name,
      title,
      description: input.description ?? "",
      url: input.url,
      headers,
      env: vars.map((v) => ({ var: v, label: v, required: true, secret: true })),
    });
  }
  const [command, ...args] = splitCommand(input.command ?? "");
  if (!command) throw new Error("A custom connector needs a URL or a command.");
  const vars = [...new Set([...declared, ...args.flatMap(varsIn)])];
  return Connector.parse({
    kind: "local",
    name,
    title,
    description: input.description ?? "",
    command,
    args,
    env: vars.map((v) => ({ var: v, label: v, required: true, secret: /key|token|secret|password|auth/i.test(v) })),
  });
}
