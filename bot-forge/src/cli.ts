#!/usr/bin/env node
/**
 * bot-forge: describe a bot, get a bot.
 *
 *   bot-forge new "a bot that reviews my pull requests"
 *   bot-forge add-mcp pr-reviewer github
 *   bot-forge add-skill pr-reviewer ./skills/review-checklist
 *   bot-forge show pr-reviewer
 *   bot-forge export pr-reviewer
 *   bot-forge serve
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";
import { CATALOG } from "./catalog";
import { addConnector, addSkill, removeConnector, removeSkill, updateFields, type ConnectorInput } from "./edit";
import { configProblem, generateBot, generatorConfig, listModels, type ConfigInput } from "./generate";
import { PRESETS, preset } from "./providers";
import { checkConnector, describeRun } from "./mcp-check";
import { readSkill } from "./skills";
import { Workspace } from "./store";
import { renderText, summarize, type CheckResult } from "./summary";
import { ToolScope } from "./schema";

const HELP = `bot-forge — describe a bot, get a bot (portable to Mali Cowork and Claude Code)

Make
  new "<description>"            generate a bot   [--provider P] [--model M] [--base-url U]
  edit <bot>                     [--name N] [--duty D] [--tools none|read|files|all] [--instructions-file F]
  delete <bot>

Connect
  catalog [search]               connectors bot-forge knows
  add-mcp <bot> <catalog-id>     add a known connector
  add-mcp <bot> --url U          add a remote MCP server   [--name N] [--header "K=V"]… [--env VAR]…
  add-mcp <bot> --command "C"    add a local MCP server    [--name N] [--env VAR]…
  remove-mcp <bot> <name>
  add-skill <bot> <path>         a SKILL.md, or a folder holding one
  remove-skill <bot> <name>
  check <bot>                    connect to each connector and list its tools   [--only NAME] [--yes]

Pick the model that designs bots (any provider; local ones are free)
  providers                      what you can use, and which keys are set
  models [--provider P]          the models a provider offers
  use <provider> [--model M]     remember the choice   [--base-url U]

See and share
  list
  show <bot>                     capabilities and connections   [--json]
  export <bot>                   a .zip to share   [--out FILE] [--folder DIR]
  import <path>                  a .zip, folder or bot.json   [--replace]
  serve                          the web page   [--port 4317]

Bots live in ./bots (or $BOT_FORGE_HOME). Keys come from each provider's variable
(ANTHROPIC_API_KEY, GROQ_API_KEY, OPENROUTER_API_KEY…); Ollama and LM Studio need none.`;

async function main(argv: string[]) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      model: { type: "string" },
      provider: { type: "string" },
      name: { type: "string" },
      duty: { type: "string" },
      tools: { type: "string" },
      "instructions-file": { type: "string" },
      url: { type: "string" },
      command: { type: "string" },
      header: { type: "string", multiple: true },
      env: { type: "string", multiple: true },
      only: { type: "string" },
      yes: { type: "boolean", short: "y" },
      json: { type: "boolean" },
      out: { type: "string" },
      folder: { type: "string" },
      replace: { type: "boolean" },
      port: { type: "string" },
      "base-url": { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });
  const [command, ...rest] = positionals;
  const ws = new Workspace();
  const arg = (i: number, what: string) => {
    const v = rest[i];
    if (!v) throw new Error(`Say which ${what}. Run \`bot-forge --help\`.`);
    return v;
  };

  if (!command || values.help || command === "help") return console.log(HELP);
  const flags = (): ConfigInput => ({
    ...(values.provider ? { provider: values.provider } : {}),
    ...(values.model ? { model: values.model } : {}),
    ...(values["base-url"] ? { baseUrl: values["base-url"] } : {}),
  });

  switch (command) {
    case "new": {
      const prompt = rest.join(" ");
      const config = generatorConfig(flags(), process.env, ws.choice());
      console.error(`Designing the bot with ${preset(config.provider).label} · ${config.model || "?"}…`);
      const { spec, unknownConnectors, notes } = await generateBot(prompt, config);
      const saved = ws.save({ ...spec, slug: ws.freeSlug(spec.slug) }, { touch: false });
      console.log(renderText(summarize(saved, process.env)));
      if (unknownConnectors.length) console.log(`\nLeft out (not in the catalog): ${unknownConnectors.join(", ")}`);
      if (notes) console.log(`\nNote: ${notes}`);
      console.log(`\nSaved to ${resolve(ws.root, saved.slug)}`);
      return;
    }
    case "providers": {
      const current = generatorConfig({}, process.env, ws.choice());
      for (const p of PRESETS) {
        const key = p.local ? "local, free" : p.keyEnv && process.env[p.keyEnv] ? `${p.keyEnv} set` : p.id === "custom" ? "key optional" : `needs ${p.keyEnv}`;
        console.log(`${p.id === current.provider ? "●" : " "} ${p.id.padEnd(11)} ${p.label.padEnd(28)} ${key}${p.note ? `  — ${p.note}` : ""}`);
      }
      const problem = configProblem(current);
      console.log(`\nNow: ${preset(current.provider).label} · ${current.model || "(no model)"}${problem ? `\n${problem}` : ""}`);
      return console.log("Change it: bot-forge use <provider> --model <model>");
    }
    case "models": {
      const config = generatorConfig(flags(), process.env, ws.choice());
      const models = await listModels(config);
      if (!models.length) return console.log(`${preset(config.provider).label} lists no models.`);
      for (const m of models) console.log(`${m === config.model ? "●" : " "} ${m}`);
      return;
    }
    case "use": {
      const provider = preset(arg(0, "provider")).id;
      const config = generatorConfig({ provider, ...(values.model ? { model: values.model } : {}), ...(values["base-url"] ? { baseUrl: values["base-url"] } : {}) }, process.env, ws.choice());
      ws.saveChoice({ provider, model: config.model, baseUrl: values["base-url"] });
      const problem = configProblem(config);
      return console.log(`Bots are now designed with ${preset(provider).label} · ${config.model || "(no model yet)"}.${problem ? `\n${problem}` : ""}`);
    }
    case "list": {
      const bots = ws.list();
      if (!bots.length) return console.log('No bots yet. Make one: bot-forge new "…"');
      for (const b of bots) console.log(`${b.slug.padEnd(28)} ${b.name} — ${b.duty}  [${b.connectors.length} connectors, ${b.skills.length} skills]`);
      return;
    }
    case "show": {
      const spec = ws.get(arg(0, "bot"));
      const summary = summarize(spec, process.env, ws.checks(spec.slug));
      return console.log(values.json ? JSON.stringify({ spec, summary }, null, 2) : renderText(summary));
    }
    case "edit": {
      const spec = ws.get(arg(0, "bot"));
      const next = updateFields(spec, {
        ...(values.name !== undefined ? { name: values.name } : {}),
        ...(values.duty !== undefined ? { duty: values.duty } : {}),
        ...(values.tools !== undefined ? { tools: ToolScope.parse(values.tools) } : {}),
        ...(values["instructions-file"] ? { instructions: readFileSync(values["instructions-file"], "utf8") } : {}),
      });
      ws.save(next);
      return console.log(`Updated ${next.name}.`);
    }
    case "delete": {
      const spec = ws.get(arg(0, "bot"));
      if (!values.yes && !(await confirm(`Delete ${spec.name} (${resolve(ws.root, spec.slug)})?`))) return;
      ws.remove(spec.slug);
      return console.log(`Deleted ${spec.name}.`);
    }
    case "catalog": {
      const q = rest.join(" ").toLowerCase();
      const found = CATALOG.filter((c) => !q || `${c.id} ${c.name} ${c.description} ${c.category}`.toLowerCase().includes(q));
      for (const c of found) console.log(`${c.id.padEnd(22)} ${c.name} — ${c.description}${c.env.length ? `  (needs ${c.env.map((v) => v.var).join(", ")})` : ""}`);
      console.log("\nAnything else: add-mcp <bot> --url <mcp url> or --command \"<command line>\".");
      return;
    }
    case "add-mcp": {
      const spec = ws.get(arg(0, "bot"));
      const headers = Object.fromEntries(
        (values.header ?? []).map((h) => {
          const at = h.indexOf("=");
          if (at < 1) throw new Error(`A header is "Name=value": ${h}`);
          return [h.slice(0, at).trim(), h.slice(at + 1).trim()];
        }),
      );
      const common = { ...(values.name ? { name: values.name } : {}), env: values.env ?? [] };
      const input: ConnectorInput = values.url
        ? { url: values.url, headers, ...common }
        : values.command
          ? { command: values.command, ...common }
          : { catalogId: arg(1, "connector (a catalog id, --url or --command)") };
      const { spec: next, connector } = addConnector(spec, input);
      ws.save(next);
      console.log(`Added ${connector.title} as "${connector.name}" to ${spec.name}.`);
      const missing = connector.env.filter((v) => v.required && !process.env[v.var]).map((v) => v.var);
      if (missing.length) console.log(`It needs ${missing.join(", ")} set where the bot runs.`);
      return;
    }
    case "remove-mcp": {
      const spec = ws.get(arg(0, "bot"));
      ws.save(removeConnector(spec, arg(1, "connector")));
      ws.setChecks(spec.slug, Object.fromEntries(Object.entries(ws.checks(spec.slug)).filter(([k]) => k !== rest[1])));
      return console.log(`Removed ${rest[1]} from ${spec.name}.`);
    }
    case "add-skill": {
      const spec = ws.get(arg(0, "bot"));
      const skill = readSkill(arg(1, "skill path"));
      ws.save(addSkill(spec, skill));
      return console.log(`Added the skill ${skill.name} to ${spec.name}.`);
    }
    case "remove-skill": {
      const spec = ws.get(arg(0, "bot"));
      ws.save(removeSkill(spec, arg(1, "skill")));
      return console.log(`Removed the skill ${rest[1]} from ${spec.name}.`);
    }
    case "check": {
      const spec = ws.get(arg(0, "bot"));
      const targets = spec.connectors.filter((c) => !values.only || c.name === values.only);
      if (!targets.length) return console.log(values.only ? `${spec.name} has no connector called ${values.only}.` : `${spec.name} has no connectors.`);
      console.log("This will:");
      for (const c of targets) console.log(`  • ${describeRun(c)}`);
      if (!values.yes && !(await confirm("Go ahead?"))) return;
      const checks: Record<string, CheckResult> = { ...ws.checks(spec.slug) };
      for (const c of targets) {
        process.stderr.write(`Checking ${c.title}… `);
        checks[c.name] = await checkConnector(c);
        console.error(checks[c.name].ok ? "ok" : "failed");
      }
      ws.setChecks(spec.slug, checks);
      return console.log(`\n${renderText(summarize(spec, process.env, checks))}`);
    }
    case "export": {
      const spec = ws.get(arg(0, "bot"));
      if (values.folder) return console.log(`Exported to ${ws.exportFolder(spec.slug, values.folder)}`);
      const out = resolve(values.out ?? `${spec.slug}.zip`);
      writeFileSync(out, ws.exportZip(spec.slug));
      return console.log(`Exported ${spec.name} to ${out}\nIn Mali Cowork: Settings › Team › Import bot, and pick this .zip. Or load it in Claude Code as a plugin.`);
    }
    case "import": {
      const { spec, dropped } = ws.importFrom(arg(0, "file or folder"), { replace: !!values.replace });
      console.log(`Imported ${spec.name} as ${spec.slug}. Nothing in it was run.`);
      if (dropped.length) console.log(`Left out values written into its .mcp.json (set them in the environment instead): ${dropped.join(", ")}`);
      return console.log(`\n${renderText(summarize(spec, process.env))}`);
    }
    case "serve": {
      const { serve } = await import("./server");
      await serve({ workspace: ws, port: Number(values.port ?? process.env.PORT ?? 4317) });
      return;
    }
    default:
      throw new Error(`Unknown command "${command}". Run \`bot-forge --help\`.`);
  }
}

async function confirm(question: string): Promise<boolean> {
  if (!process.stdin.isTTY) {
    console.error(`${question} Pass --yes to go ahead without asking.`);
    return false;
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question(`${question} [y/N] `)).trim().toLowerCase();
  rl.close();
  return answer === "y" || answer === "yes";
}

main(process.argv.slice(2)).catch((error: unknown) => {
  console.error(`bot-forge: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
