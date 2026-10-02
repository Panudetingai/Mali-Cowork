#!/usr/bin/env node
// Token benchmark: the same tasks, the same model, three engines —
//   opencode     OpenCode as Cowork uses it
//   mali-before  Mali's own agent, every connector schema on every step
//   mali-after   Mali's own agent with the token savers on
// — and for each run: tokens used, and a quality score from plain checks.
//
//   node scripts/token-bench/run.mjs --model ollama-cloud/gpt-oss:120b [--repeat 2]
//        [--engines opencode,mali-before,mali-after] [--tasks crm-lookup,fix-bug]
//
// Mali's key for the provider comes from MALI_BENCH_KEY, else the app's
// dev key store. Every run works on a fresh copy of ./fixture.

import { spawnSync, spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { TASKS, plain } from "./tasks.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "../..");
const fixture = join(here, "fixture");

const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, arg, i, all) => (arg.startsWith("--") ? [...pairs, [arg.slice(2), all[i + 1]]] : pairs), []),
);
const model = args.model;
if (!model) {
  console.error("Pass --model provider/model, e.g. --model ollama-cloud/gpt-oss:120b");
  process.exit(1);
}
const [provider, ...rest] = model.split("/");
const modelName = rest.join("/");
const engines = (args.engines ?? "opencode,mali-before,mali-after").split(",");
const repeat = Number(args.repeat ?? 1);
const tasks = args.tasks ? TASKS.filter((t) => args.tasks.split(",").includes(t.id)) : TASKS;
const PORT = Number(args.port ?? 4791);
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const outDir = join(here, "results", stamp);
mkdirSync(outDir, { recursive: true });

// ── the mock connector ──
const callsLog = join(outDir, "calls.json");
const mock = spawn("node", [join(here, "mock-connector.mjs"), String(PORT), callsLog], { stdio: "ignore" });
process.on("exit", () => mock.kill());
const mcpUrl = `http://127.0.0.1:${PORT}/mcp`;
await new Promise((r) => setTimeout(r, 600));
const reset = () => fetch(`http://127.0.0.1:${PORT}/reset`, { method: "POST" });

// ── Mali: its agent, headless (src-tauri/src/agent/bench.rs) ──
function maliKey() {
  if (process.env.MALI_BENCH_KEY) return process.env.MALI_BENCH_KEY;
  const store = join(homedir(), "Library/Application Support/mali-cowork/secrets-dev.json");
  if (!existsSync(store)) return undefined;
  return JSON.parse(readFileSync(store, "utf8"))[`provider:${provider}`];
}
let maliBinary;
function buildMali() {
  if (maliBinary) return maliBinary;
  console.log("Building Mali's agent (cargo test --no-run)…");
  const out = spawnSync("cargo", ["test", "--lib", "--no-run", "--message-format=json"], {
    cwd: join(root, "src-tauri"),
    encoding: "utf8",
    maxBuffer: 1 << 28,
  });
  for (const line of out.stdout.split("\n")) {
    if (!line.includes('"executable"')) continue;
    const msg = JSON.parse(line);
    if (msg.executable && msg.profile?.test && msg.target?.name === "mali_cowork_lib") maliBinary = msg.executable;
  }
  if (!maliBinary) throw new Error(`cargo build failed:\n${out.stderr.slice(-3000)}`);
  return maliBinary;
}
const fakeHome = mkdtempSync(join(tmpdir(), "mali-bench-home-"));
// What the app adds to every Mali request (src/pages/chat/turn.ts), so the
// headless run carries the same system prompt as the real one.
const appInstructions = spawnSync(
  "bun",
  ["-e", 'import { connectorInstructionsFor } from "./src/features/mcp/agent-install.ts"; process.stdout.write(connectorInstructionsFor())'],
  { cwd: root, encoding: "utf8" },
).stdout;

function runMali(task, dir, lazy) {
  const key = maliKey();
  if (!key) throw new Error(`No key for ${provider}: set MALI_BENCH_KEY`);
  const input = join(dir, "..", `${task.id}-in.json`);
  const output = join(dir, "..", `${task.id}-out.json`);
  writeFileSync(input, JSON.stringify({ prompt: task.prompt, cwd: dir, provider, model: modelName, apiKey: key, mcpUrl, instructions: appInstructions }));
  const run = spawnSync(buildMali(), ["agent::bench::bench_run", "--ignored", "--exact", "--nocapture"], {
    // A HOME of its own: the run's session files don't land in the real app's data.
    env: { ...process.env, HOME: fakeHome, BENCH_IN: input, BENCH_OUT: output, MALI_TOKEN_SAVER: lazy ? "1" : "0" },
    encoding: "utf8",
    timeout: 15 * 60_000,
  });
  if (!existsSync(output)) return { error: `no result: ${(run.stderr || run.stdout).slice(-800)}` };
  const out = JSON.parse(readFileSync(output, "utf8"));
  const u = out.usage ?? {};
  const read = u.cacheReadTokens ?? 0;
  const write = u.cacheWriteTokens ?? 0;
  // Anthropic counts cached tokens apart from input; OpenAI-style APIs inside it.
  const processed = provider === "anthropic" ? (u.inputTokens ?? 0) + read + write : (u.inputTokens ?? 0);
  return {
    answer: out.answer ?? "",
    error: out.error ?? undefined,
    tokens: { processed, cacheRead: read, uncached: processed - read, output: u.outputTokens ?? 0 },
    toolCalls: out.tools?.length ?? 0,
    durationMs: out.durationMs,
  };
}

// ── OpenCode, as `opencode run` ──
function runOpenCode(task, dir) {
  const config = join(dir, "..", "opencode-bench.json");
  writeFileSync(
    config,
    JSON.stringify({
      $schema: "https://opencode.ai/config.json",
      // Only the bench connector: the user's own ones would tip the scales.
      mcp: { media: { type: "local", command: ["true"], enabled: false }, acme: { type: "remote", url: mcpUrl, enabled: true } },
      permission: { edit: "allow", bash: "allow", webfetch: "allow" },
    }),
  );
  const started = Date.now();
  const run = spawnSync("opencode", ["run", "--format", "json", "--auto", "--pure", "-m", model, "--dir", dir, task.prompt], {
    cwd: dir,
    env: { ...process.env, OPENCODE_CONFIG: config },
    encoding: "utf8",
    timeout: 15 * 60_000,
    maxBuffer: 1 << 26,
  });
  const tokens = { processed: 0, cacheRead: 0, uncached: 0, output: 0 };
  let answer = "";
  let toolCalls = 0;
  let error;
  for (const line of (run.stdout ?? "").split("\n")) {
    if (!line.trim().startsWith("{")) continue;
    let e;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    const part = e.part ?? {};
    if (e.type === "text" && part.text) answer += part.text;
    if (e.type === "tool_use" || part.type === "tool") toolCalls += 1;
    if (e.type === "error") error = JSON.stringify(e.error ?? e).slice(0, 400);
    const t = part.tokens ?? (e.type === "step_finish" ? e.tokens : undefined);
    if (t && (e.type === "step_finish" || part.type === "step-finish")) {
      const read = t.cache?.read ?? 0;
      const write = t.cache?.write ?? 0;
      tokens.processed += (t.input ?? 0) + read + write;
      tokens.cacheRead += read;
      tokens.uncached += (t.input ?? 0) + write;
      tokens.output += (t.output ?? 0) + (t.reasoning ?? 0);
    }
  }
  if (run.status !== 0 && !answer) error ??= (run.stderr || "opencode failed").slice(-600);
  writeFileSync(join(outDir, `${task.id}-${Date.now()}-opencode.jsonl`), run.stdout ?? "");
  return { answer, error, tokens, toolCalls, durationMs: Date.now() - started };
}

// ── run everything ──
const results = [];
for (let r = 1; r <= repeat; r++) {
  for (const task of tasks) {
    for (const engine of engines) {
      await reset();
      const work = mkdtempSync(join(tmpdir(), `bench-${task.id}-`));
      const dir = join(realpathSync(work), "work");
      cpSync(fixture, dir, { recursive: true });
      for (const extra of task.extra ?? []) cpSync(join(here, "fixture-extra", extra), join(dir, extra));
      process.stdout.write(`[${r}/${repeat}] ${task.id.padEnd(13)} ${engine.padEnd(12)} … `);
      let out;
      try {
        out = engine === "opencode" ? runOpenCode(task, dir) : runMali(task, dir, engine === "mali-after");
      } catch (e) {
        out = { error: String(e.message ?? e), tokens: { processed: 0, cacheRead: 0, uncached: 0, output: 0 }, answer: "" };
      }
      const calls = existsSync(callsLog) ? JSON.parse(readFileSync(callsLog, "utf8")) : [];
      const checks = task.checks.map(([name, check]) => {
        let pass = false;
        try {
          pass = !!check({ dir, fixture, answer: plain(out.answer ?? ""), calls });
        } catch {}
        return { name, pass };
      });
      // "No wrong …" checks only count once the run got something right.
      const negative = (name) => /^no |^not |untouched|kept/.test(name);
      const anyPositive = checks.some((c) => c.pass && !negative(c.name));
      const quality = anyPositive ? Math.round((100 * checks.filter((c) => c.pass).length) / checks.length) : 0;
      results.push({ round: r, task: task.id, engine, quality, checks, ...out });
      // Gone before the next run: an agent searching around must not find another run's copy.
      rmSync(work, { recursive: true, force: true });
      console.log(`${String(out.tokens?.processed ?? 0).padStart(8)} tok  quality ${quality}%${out.error ? `  ERROR ${String(out.error).slice(0, 80)}` : ""}`);
      writeFileSync(join(outDir, "results.json"), JSON.stringify({ model, engines, repeat, results }, null, 2));
    }
  }
}

// ── the summary ──
const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const summary = engines.map((engine) => {
  const rs = results.filter((r) => r.engine === engine);
  return {
    engine,
    runs: rs.length,
    processed: Math.round(avg(rs.map((r) => r.tokens?.processed ?? 0))),
    uncached: Math.round(avg(rs.map((r) => r.tokens?.uncached ?? 0))),
    output: Math.round(avg(rs.map((r) => r.tokens?.output ?? 0))),
    quality: Math.round(avg(rs.map((r) => r.quality))),
    errors: rs.filter((r) => r.error).length,
  };
});
const base = summary.find((s) => s.engine === "mali-before") ?? summary[0];
const pct = (a, b) => (b ? `${Math.round((100 * (a - b)) / b)}%` : "–");
const lines = [
  `# Token benchmark — ${model}, ${tasks.length} tasks × ${repeat}`,
  "",
  "| Engine | Avg input tokens / task | vs mali-before | Uncached input | Output | Quality | Errors |",
  "|---|---:|---:|---:|---:|---:|---:|",
  ...summary.map((s) => `| ${s.engine} | ${s.processed.toLocaleString()} | ${pct(s.processed, base.processed)} | ${s.uncached.toLocaleString()} | ${s.output.toLocaleString()} | ${s.quality}% | ${s.errors} |`),
  "",
  "## Per task",
  "",
  "| Task | " + engines.join(" | ") + " |",
  "|---|" + engines.map(() => "---:").join("|") + "|",
  ...tasks.map((t) => {
    const cells = engines.map((engine) => {
      const rs = results.filter((r) => r.task === t.id && r.engine === engine);
      return `${Math.round(avg(rs.map((r) => r.tokens?.processed ?? 0))).toLocaleString()} tok · ${Math.round(avg(rs.map((r) => r.quality)))}%`;
    });
    return `| ${t.id} | ${cells.join(" | ")} |`;
  }),
];
writeFileSync(join(outDir, "report.md"), lines.join("\n") + "\n");
console.log("\n" + lines.join("\n"));
console.log(`\nResults: ${outDir}`);
mock.kill();
