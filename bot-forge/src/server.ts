/**
 * The web page: describe a bot, pick its connectors and skills, see what it
 * can do and what it's connected to, export and import.
 *
 * It listens on the loopback only and answers only its own host name, and
 * every API call carries this run's token in a header — a page on another
 * site can neither read the bots nor change them.
 */
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";
import { unzipFiles } from "./archive";
import { CATALOG } from "./catalog";
import { addConnector, addSkillText, removeConnector, removeSkill, updateFields, type ConnectorInput, type Fields } from "./edit";
import { configProblem, generateBot, generatorConfig, listModels, type ConfigInput } from "./generate";
import { PRESETS, preset } from "./providers";
import { checkConnector, describeRun } from "./mcp-check";
import { Workspace } from "./store";
import { summarize, type CheckResult } from "./summary";

const MAX_BODY = 25 * 1024 * 1024;

export type ServeOptions = { workspace: Workspace; port: number; host?: string; quiet?: boolean };

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function createApp({ workspace: ws }: { workspace: Workspace }) {
  const token = randomBytes(24).toString("hex");
  const page = readFileSync(fileURLToPath(new URL("../web/index.html", import.meta.url)), "utf8").replace("__BOT_FORGE_TOKEN__", token);

  /** Keys typed into the page: this run only, never written anywhere. */
  const sessionKeys = new Map<string, string>();
  const config = (input: ConfigInput = {}) => {
    const provider = input.provider ?? generatorConfig({}, process.env, ws.choice()).provider;
    return generatorConfig({ ...input, provider, apiKey: input.apiKey || sessionKeys.get(provider) }, process.env, ws.choice());
  };
  const configView = () => {
    const c = config();
    return {
      provider: c.provider,
      label: preset(c.provider).label,
      model: c.model,
      baseUrl: c.baseUrl ?? "",
      problem: configProblem(c),
      presets: PRESETS.map((p) => ({
        id: p.id,
        label: p.label,
        kind: p.kind,
        local: !!p.local,
        note: p.note ?? "",
        baseUrl: p.baseUrl ?? "",
        keyEnv: p.keyEnv ?? "",
        key: p.local ? "none" : sessionKeys.has(p.id) ? "session" : p.keyEnv && process.env[p.keyEnv] ? "env" : p.id === "custom" ? "optional" : "missing",
      })),
    };
  };

  const view = (slug: string) => {
    const spec = ws.get(slug);
    return { spec, summary: summarize(spec, process.env, ws.checks(slug)) };
  };

  async function api(method: string, parts: string[], req: IncomingMessage): Promise<unknown> {
    const [first, slug, sub, name] = parts;
    if (first === "catalog" && method === "GET") return { connectors: CATALOG };
    if (first === "config" && method === "GET") return configView();
    if (first === "config" && method === "PUT") {
      const body = (await readJson(req)) as { provider?: string; model?: string; baseUrl?: string; apiKey?: string };
      const provider = preset(body.provider ?? "").id;
      if (body.apiKey?.trim()) sessionKeys.set(provider, body.apiKey.trim());
      ws.saveChoice({ provider, model: body.model, baseUrl: body.baseUrl });
      return configView();
    }
    if (first === "models" && method === "POST") {
      // The key travels in the body, not the URL; one typed here is kept for the session.
      const body = (await readJson(req)) as { provider?: string; baseUrl?: string; apiKey?: string };
      const provider = body.provider ? preset(body.provider).id : undefined;
      if (provider && body.apiKey?.trim()) sessionKeys.set(provider, body.apiKey.trim());
      return { models: await listModels(config({ provider, baseUrl: body.baseUrl?.trim() || undefined })), config: configView() };
    }
    if (first === "generate" && method === "POST") {
      const { prompt, model } = (await readJson(req)) as { prompt?: string; model?: string };
      const { spec, unknownConnectors, notes } = await generateBot(prompt ?? "", config(model ? { model } : {}));
      const saved = ws.save({ ...spec, slug: ws.freeSlug(spec.slug) }, { touch: false });
      return { ...view(saved.slug), unknownConnectors, notes };
    }
    if (first === "import" && method === "POST") {
      const body = await readBody(req);
      const isZip = body[0] === 0x50 && body[1] === 0x4b;
      const files = isZip ? unzipFiles(body) : new Map([["bot.json", Buffer.from(body).toString("utf8")]]);
      const { spec, dropped } = ws.importFiles(files);
      return { ...view(spec.slug), dropped };
    }
    if (first !== "bots") throw new HttpError(404, "Not found");
    if (!slug) {
      if (method === "GET") return { bots: ws.list().map((b) => ({ slug: b.slug, name: b.name, duty: b.duty, connectors: b.connectors.length, skills: b.skills.length, updatedAt: b.updatedAt })) };
      throw new HttpError(405, "Method not allowed");
    }
    if (!ws.has(slug)) throw new HttpError(404, `There's no bot called ${slug}.`);
    const spec = ws.get(slug);

    if (!sub) {
      if (method === "GET") return view(slug);
      if (method === "PATCH") {
        ws.save(updateFields(spec, (await readJson(req)) as Fields));
        return view(slug);
      }
      if (method === "DELETE") {
        ws.remove(slug);
        return { ok: true };
      }
    }
    if (sub === "connectors") {
      if (method === "POST") {
        const { spec: next } = addConnector(spec, (await readJson(req)) as ConnectorInput);
        ws.save(next);
        return view(slug);
      }
      if (method === "DELETE" && name) {
        ws.save(removeConnector(spec, name));
        const checks = ws.checks(slug);
        delete checks[name];
        ws.setChecks(slug, checks);
        return view(slug);
      }
    }
    if (sub === "skills") {
      if (method === "POST") {
        const { content, name: fallback } = (await readJson(req)) as { content?: string; name?: string };
        ws.save(addSkillText(spec, content ?? "", fallback).spec);
        return view(slug);
      }
      if (method === "DELETE" && name) {
        ws.save(removeSkill(spec, name));
        return view(slug);
      }
    }
    if (sub === "check") {
      // What would run, for the page to show before the user says yes.
      if (method === "GET") return { plan: spec.connectors.map((c) => ({ name: c.name, title: c.title, run: describeRun(c) })) };
      if (method === "POST") {
        const { names, confirmed } = (await readJson(req)) as { names?: string[]; confirmed?: boolean };
        if (confirmed !== true) throw new HttpError(400, "Confirm what the check runs first.");
        const checks: Record<string, CheckResult> = { ...ws.checks(slug) };
        const targets = spec.connectors.filter((c) => !names?.length || names.includes(c.name));
        await Promise.all(targets.map(async (c) => (checks[c.name] = await checkConnector(c))));
        ws.setChecks(slug, checks);
        return view(slug);
      }
    }
    if (sub === "export" && method === "GET") return ws.exportZip(slug);
    throw new HttpError(405, "Method not allowed");
  }

  async function handle(req: IncomingMessage, res: ServerResponse, port: number) {
    const host = req.headers.host ?? "";
    if (![`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`].includes(host.toLowerCase())) {
      return send(res, 403, { error: "Open bot-forge at http://127.0.0.1." });
    }
    const url = new URL(req.url ?? "/", `http://${host}`);
    if (url.pathname === "/" && req.method === "GET") {
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "content-security-policy": "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'",
        "x-content-type-options": "nosniff",
      });
      return res.end(page);
    }
    if (!url.pathname.startsWith("/api/")) return send(res, 404, { error: "Not found" });
    if (req.headers["x-bot-forge-token"] !== token) return send(res, 401, { error: "Reload the page." });
    try {
      const parts = url.pathname.slice(5).split("/").filter(Boolean).map(decodeURIComponent);
      const out = await api(req.method ?? "GET", parts, req);
      if (out instanceof Uint8Array) {
        res.writeHead(200, { "content-type": "application/zip", "content-disposition": `attachment; filename="${parts[1]}.zip"` });
        return res.end(out);
      }
      send(res, 200, out);
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 400;
      send(res, status, { error: error instanceof Error ? error.message : String(error) });
    }
  }

  return { token, handle };
}

export function serve({ workspace, port, host = "127.0.0.1", quiet }: ServeOptions): Promise<{ close: () => void; url: string; port: number }> {
  const app = createApp({ workspace });
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => void app.handle(req, res, (server.address() as { port: number }).port));
    server.on("error", reject);
    server.listen(port, host, () => {
      const actual = (server.address() as { port: number }).port;
      const url = `http://127.0.0.1:${actual}/`;
      if (!quiet) console.log(`bot-forge is open at ${url}  (bots in ${workspace.root})`);
      resolve({ close: () => server.close(), url, port: actual });
    });
  });
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new HttpError(413, "That's too big.");
    chunks.push(chunk as Buffer);
  }
  return new Uint8Array(Buffer.concat(chunks));
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const text = Buffer.from(await readBody(req)).toString("utf8");
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new HttpError(400, "Expected JSON.");
  }
}
