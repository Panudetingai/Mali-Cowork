/**
 * Copies Mali Cowork's vetted connector catalog (pinned versions, setup
 * notes) into `data/connectors.json`. bot-forge reads only that JSON, so it
 * runs without Mali; run this again when Mali's catalog changes.
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { MCP_SERVERS } from "../../src/features/mcp/catalog";
import { splitCommand } from "../src/cmdline";

const out = fileURLToPath(new URL("../data/connectors.json", import.meta.url));
const entries = MCP_SERVERS.map((s) => {
  const [command, ...args] = splitCommand(s.command);
  return {
    id: s.id,
    name: s.name,
    description: s.description,
    category: s.category,
    command,
    args,
    env: (s.envVars ?? []).map((v) => ({ var: v.var, label: v.label, required: v.required !== false, secret: !!v.secret })),
    ...(s.setup ? { setup: s.setup } : {}),
    ...(s.repositoryUrl ? { repositoryUrl: s.repositoryUrl } : {}),
  };
});
writeFileSync(out, `${JSON.stringify({ source: "Mali Cowork src/features/mcp/catalog.ts", connectors: entries }, null, 2)}\n`);
console.log(`Wrote ${entries.length} connectors to ${out}`);
