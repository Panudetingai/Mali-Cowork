import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { getCustomMcps } from "./custom";
import { getMcpConnections } from "./store";
import { buildMcpSyncPayload } from "./sync";

/** App-only servers other apps don't get (they have their own file and shell tools). */
const NOT_SHARED = new Set(["filesystem", "exec"]);

/**
 * The switched-on connectors in the common `mcpServers` format that Claude
 * Code (`.mcp.json`), Claude Desktop, VS Code, Windsurf and most MCP clients
 * read. Keys are never written: env values become `${NAME}` (filled from the
 * environment by Claude Code and VS Code) and header values are left empty.
 */
export function mcpServersJson() {
  const servers = buildMcpSyncPayload(getMcpConnections(), getCustomMcps()).filter(
    (s) => s.enabled && !NOT_SHARED.has(s.id),
  );
  const mcpServers = Object.fromEntries(
    servers.map((s) => {
      if (s.kind === "remote") {
        const headers = Object.fromEntries(Object.keys(s.headers ?? {}).map((name) => [name, ""]));
        return [s.id, { type: "http", url: s.url, ...(Object.keys(headers).length ? { headers } : {}) }];
      }
      const env = Object.fromEntries(
        Object.keys(s.environment)
          .filter((name) => name !== "MCP_TRANSPORT")
          .map((name) => [name, `\${${name}}`]),
      );
      const [command, ...args] = s.command;
      return [s.id, { command, args, ...(Object.keys(env).length ? { env } : {}) }];
    }),
  );
  return { json: JSON.stringify({ mcpServers }, null, 2) + "\n", count: servers.length };
}

/** Save `mcpServers` JSON for another app; returns how many servers, or null if cancelled. */
export async function exportMcpServers(): Promise<number | null> {
  const { json, count } = mcpServersJson();
  const path = await save({
    title: "Export connectors for other apps",
    defaultPath: ".mcp.json",
    filters: [{ name: "MCP config (JSON)", extensions: ["json"] }],
  });
  if (!path) return null;
  await writeTextFile(path, json);
  return count;
}
