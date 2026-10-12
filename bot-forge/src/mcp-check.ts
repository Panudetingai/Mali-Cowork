/**
 * Is a connector really there? Connects as an MCP client would — the
 * initialize handshake, then `tools/list` — and hangs up. A local connector
 * means starting its command, so callers show the command and ask first
 * (an imported bot's commands are someone else's).
 */
import { spawn } from "node:child_process";
import type { Connector } from "./schema";
import type { CheckResult } from "./summary";

const PROTOCOL_VERSION = "2025-06-18";
const CLIENT = { name: "bot-forge", version: "0.1.0" };

export type CheckOptions = {
  env?: Record<string, string | undefined>;
  /** Long enough for `npx`/`uvx` to fetch a server the first time. */
  timeoutMs?: number;
  fetch?: typeof fetch;
};

export async function checkConnector(c: Connector, options: CheckOptions = {}): Promise<CheckResult> {
  const env = { ...process.env, ...options.env };
  const missing = c.env.filter((v) => v.required && !env[v.var]?.trim()).map((v) => v.var);
  const at = new Date().toISOString();
  if (missing.length) return { ok: false, error: `Set ${missing.join(", ")} first.`, at };
  try {
    const listed = c.kind === "remote" ? await checkRemote(c, env, options) : await checkLocal(c, env, options.timeoutMs ?? 90_000);
    return { ok: true, tools: listed.tools, ...(listed.serverName ? { serverName: listed.serverName } : {}), at };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error), at };
  }
}

type Listed = { tools: string[]; serverName?: string };

const initialize = (id: number) => ({
  jsonrpc: "2.0",
  id,
  method: "initialize",
  params: { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: CLIENT },
});

function toolNames(result: unknown): string[] {
  const tools = (result as { tools?: { name?: unknown }[] } | null)?.tools ?? [];
  return tools.flatMap((t) => (typeof t.name === "string" ? [t.name] : []));
}

/** `${VAR}` and `$VAR` filled in from `env`. */
export function expand(value: string, env: Record<string, string | undefined>): string {
  return value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}|\$([A-Za-z_][A-Za-z0-9_]*)/g, (_, braced, fallback, bare) => env[braced ?? bare] ?? fallback ?? "");
}

function checkLocal(c: Extract<Connector, { kind: "local" }>, env: Record<string, string | undefined>, timeoutMs: number): Promise<Listed> {
  return new Promise((resolvePromise, reject) => {
    // No shell: the command and its arguments go to the OS as they are.
    // Windows needs a shell for npx.cmd and friends; quote so arguments stay whole.
    const windows = process.platform === "win32";
    const args = c.args.map((a) => expand(a, env)).map((a) => (windows && /[\s"&|<>^]/.test(a) ? `"${a.replace(/"/g, '""')}"` : a));
    const child = spawn(c.command, args, { env: env as NodeJS.ProcessEnv, stdio: ["pipe", "pipe", "pipe"], shell: windows });
    let buffer = "";
    let stderr = "";
    let serverName: string | undefined;
    let settled = false;
    const finish = (error: Error | null, listed?: Listed) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.stdin.end();
      child.kill();
      if (error) reject(error);
      else resolvePromise(listed!);
    };
    const timer = setTimeout(() => finish(new Error(`No answer within ${Math.round(timeoutMs / 1000)}s.${tail(stderr)}`)), timeoutMs);
    const send = (message: unknown) => child.stdin.write(`${JSON.stringify(message)}\n`);

    child.on("error", (e) => finish(new Error(`Couldn't start ${c.command}: ${e.message}`)));
    child.on("exit", (code) => finish(new Error(`It stopped (exit ${code}) before answering.${tail(stderr)}`)));
    child.stderr.on("data", (d: Buffer) => {
      stderr = (stderr + d.toString()).slice(-2000);
    });
    child.stdout.on("data", (d: Buffer) => {
      buffer += d.toString();
      let newline: number;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line) continue;
        let message: { id?: number; result?: unknown; error?: { message?: string } };
        try {
          message = JSON.parse(line);
        } catch {
          continue; // a server's log line on stdout
        }
        if (message.error) return finish(new Error(message.error.message ?? "The server answered with an error."));
        if (message.id === 1) {
          serverName = (message.result as { serverInfo?: { name?: string } })?.serverInfo?.name;
          send({ jsonrpc: "2.0", method: "notifications/initialized" });
          send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
        } else if (message.id === 2) {
          finish(null, { tools: toolNames(message.result), serverName });
        }
      }
    });
    send(initialize(1));
  });
}

async function checkRemote(c: Extract<Connector, { kind: "remote" }>, env: Record<string, string | undefined>, options: CheckOptions): Promise<Listed> {
  const fetcher = options.fetch ?? fetch;
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    "mcp-protocol-version": PROTOCOL_VERSION,
    ...Object.fromEntries(Object.entries(c.headers).map(([k, v]) => [k, expand(v, env)])),
  };
  const timeout = options.timeoutMs ?? 30_000;
  const post = async (body: unknown) => {
    const res = await fetcher(c.url, { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(timeout) });
    if (res.status === 401 || res.status === 403) throw new Error(`The server wants sign-in (${res.status}). Check the headers or token.`);
    if (!res.ok && res.status !== 202) throw new Error(`The server answered ${res.status}.`);
    return res;
  };
  const init = await post(initialize(1));
  const session = init.headers.get("mcp-session-id");
  if (session) headers["mcp-session-id"] = session;
  const first = await readMessage(init, 1);
  await post({ jsonrpc: "2.0", method: "notifications/initialized" });
  const list = await readMessage(await post({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }), 2);
  return { tools: toolNames(list), serverName: (first as { serverInfo?: { name?: string } })?.serverInfo?.name };
}

/** The result for request `id`, from a JSON body or an SSE stream. */
async function readMessage(res: Response, id: number): Promise<unknown> {
  const text = await res.text();
  const candidates = (res.headers.get("content-type") ?? "").includes("text/event-stream")
    ? text.split(/\r?\n/).filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim())
    : [text];
  for (const raw of candidates) {
    try {
      const message = JSON.parse(raw) as { id?: number; result?: unknown; error?: { message?: string } };
      if (message.id !== id) continue;
      if (message.error) throw new Error(message.error.message ?? "The server answered with an error.");
      return message.result;
    } catch (error) {
      if (error instanceof SyntaxError) continue;
      throw error;
    }
  }
  throw new Error("The server didn't answer like an MCP server.");
}

function tail(stderr: string) {
  const last = stderr.trim().split(/\r?\n/).slice(-3).join(" ").trim();
  return last ? ` ${last}` : "";
}

/** What a check would run, for the user to look at before saying yes. */
export function describeRun(c: Connector): string {
  return c.kind === "remote" ? `connect to ${c.url}` : `run ${[c.command, ...c.args].join(" ")}`;
}
