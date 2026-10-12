import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { addConnector, addSkillText, removeConnector } from "../src/edit";
import { checkConnector, expand } from "../src/mcp-check";
import { Connector } from "../src/schema";
import { createApp, serve } from "../src/server";
import { Workspace } from "../src/store";
import { renderText, summarize } from "../src/summary";
import { sampleSpec, tempDir } from "./helpers";

const stub = fileURLToPath(new URL("./fixtures/stub-mcp.js", import.meta.url));

describe("connectors", () => {
  test("from the catalog, by URL, or by command", () => {
    let spec = sampleSpec({ connectors: [] });
    spec = addConnector(spec, { catalogId: "github" }).spec;
    expect(() => addConnector(spec, { catalogId: "github" })).toThrow("already has");
    spec = addConnector(spec, { url: "https://mcp.example.com/mcp", headers: { Authorization: "Bearer ${EX_TOKEN}" } }).spec;
    spec = addConnector(spec, { command: 'my-mcp --key "${MY_KEY}"', name: "mine" }).spec;
    expect(spec.connectors.map((c) => c.name)).toEqual(["github", "mcp-example-com", "mine"]);
    expect(spec.connectors[1].env.map((v) => v.var)).toEqual(["EX_TOKEN"]);
    expect(spec.connectors[2]).toMatchObject({ kind: "local", command: "my-mcp", args: ["--key", "${MY_KEY}"] });
    expect(removeConnector(spec, "mine").connectors).toHaveLength(2);
    expect(() => addConnector(spec, { catalogId: "nope" })).toThrow("isn't in the catalog");
  });

  test("a skill pasted as SKILL.md", () => {
    const { spec, skill } = addSkillText(sampleSpec(), "---\nname: Weekly Report\ndescription: Formats it\n---\n\n1. Collect\n2. Write");
    expect(skill).toMatchObject({ name: "weekly-report", description: "Formats it" });
    expect(spec.skills.map((s) => s.name)).toEqual(["review-checklist", "weekly-report"]);
  });

  test("variables fill in", () => {
    expect(expand("Bearer ${T}", { T: "abc" })).toBe("Bearer abc");
    expect(expand("${MISSING:-x}", {})).toBe("x");
  });
});

describe("the summary", () => {
  test("says what's connected and what needs setting up", () => {
    const spec = sampleSpec();
    const before = summarize(spec, {});
    expect(before.connections.map((c) => c.state)).toEqual(["needs-setup", "needs-setup"]);
    expect(before.connections[0].missing).toEqual(["GITHUB_PERSONAL_ACCESS_TOKEN"]);
    const after = summarize(spec, { GITHUB_PERSONAL_ACCESS_TOKEN: "t", DOCS_TOKEN: "d" }, {
      github: { ok: true, tools: ["create_issue"], at: "" },
      docs: { ok: false, error: "The server answered 500.", at: "" },
    });
    expect(after.connections.map((c) => c.state)).toEqual(["connected", "failed"]);
    expect(after.counts).toMatchObject({ connectors: 2, connected: 1, failed: 1, skills: 1 });
    expect(after.capabilities).toContain("Skill review-checklist: The checklist every review follows");
    const text = renderText(after);
    expect(text).toContain("● GitHub [github] — connected");
    expect(text).toContain("tools (1): create_issue");
  });
});

describe("checking a connection", () => {
  const local = (env: { var: string }[] = []) =>
    Connector.parse({ kind: "local", name: "stub", title: "Stub", command: process.execPath, args: [stub], env });

  test("talks MCP to a local server and lists its tools", async () => {
    const result = await checkConnector(local(), { env: { STUB_TOOL: "label" }, timeoutMs: 10_000 });
    expect(result).toMatchObject({ ok: true, tools: ["search_mail", "label"], serverName: "stub" });
  });

  test("doesn't start a server whose variables aren't set", async () => {
    const result = await checkConnector(local([{ var: "BOT_FORGE_TEST_UNSET" }]));
    expect(result).toMatchObject({ ok: false, error: "Set BOT_FORGE_TEST_UNSET first." });
  });

  test("a command that isn't there fails plainly", async () => {
    const missing = Connector.parse({ kind: "local", name: "x", title: "X", command: "bot-forge-no-such-command" });
    const result = await checkConnector(missing, { timeoutMs: 5_000 });
    expect(result.ok).toBe(false);
  });

  test("talks MCP to a remote server, SSE replies included", async () => {
    const seen: Record<string, string>[] = [];
    const fakeFetch = (async (_url: string, init: RequestInit) => {
      const headers = init.headers as Record<string, string>;
      seen.push(headers);
      const body = JSON.parse(init.body as string);
      if (body.method === "initialize") {
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { serverInfo: { name: "remote" } } }), { headers: { "mcp-session-id": "s1", "content-type": "application/json" } });
      }
      if (body.method === "tools/list") {
        return new Response(`event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: 2, result: { tools: [{ name: "lookup" }] } })}\n\n`, { headers: { "content-type": "text/event-stream" } });
      }
      return new Response(null, { status: 202 });
    }) as unknown as typeof fetch;
    const remote = Connector.parse({ kind: "remote", name: "r", title: "R", url: "https://example.com/mcp", headers: { Authorization: "Bearer ${R_TOKEN}" }, env: [{ var: "R_TOKEN" }] });
    const result = await checkConnector(remote, { env: { R_TOKEN: "abc" }, fetch: fakeFetch });
    expect(result).toMatchObject({ ok: true, tools: ["lookup"], serverName: "remote" });
    expect(seen[0].Authorization).toBe("Bearer abc");
    expect(seen[2]["mcp-session-id"]).toBe("s1");
  });
});

describe("the web server", () => {
  test("needs its token and its own host name", async () => {
    const ws = new Workspace(tempDir());
    ws.save(sampleSpec());
    const server = await serve({ workspace: ws, port: 0, quiet: true });
    try {
      const noToken = await fetch(`${server.url}api/bots`);
      expect(noToken.status).toBe(401);
      const page = await (await fetch(server.url)).text();
      const token = /const TOKEN = "([0-9a-f]+)"/.exec(page)![1];
      const bots = await (await fetch(`${server.url}api/bots`, { headers: { "x-bot-forge-token": token } })).json();
      expect(bots.bots.map((b: { slug: string }) => b.slug)).toEqual(["pr-reviewer"]);
      const rebound = await fetch(`${server.url}api/bots`, { headers: { "x-bot-forge-token": token, host: "evil.example" } });
      expect(rebound.status).toBe(403);
    } finally {
      server.close();
    }
  });

  test("edits a bot, refuses an unconfirmed check, exports and imports", async () => {
    const ws = new Workspace(tempDir());
    ws.save(sampleSpec());
    const app = createApp({ workspace: ws });
    const server = await serve({ workspace: ws, port: 0, quiet: true });
    const page = await (await fetch(server.url)).text();
    const token = /const TOKEN = "([0-9a-f]+)"/.exec(page)![1];
    const call = (path: string, init: RequestInit = {}) => fetch(`${server.url}api/${path}`, { ...init, headers: { "x-bot-forge-token": token, ...(init.headers ?? {}) } });
    try {
      const patched = await (await call("bots/pr-reviewer", { method: "PATCH", body: JSON.stringify({ tools: "files", name: "Reviewer" }) })).json();
      expect(patched.spec).toMatchObject({ tools: "files", name: "Reviewer" });
      const unconfirmed = await call("bots/pr-reviewer/check", { method: "POST", body: "{}" });
      expect(unconfirmed.status).toBe(400);
      const plan = await (await call("bots/pr-reviewer/check")).json();
      expect(plan.plan[0].run).toBe("run npx -y @modelcontextprotocol/server-github@2025.4.8");
      const zip = new Uint8Array(await (await call("bots/pr-reviewer/export")).arrayBuffer());
      const imported = await (await call("import", { method: "POST", body: zip })).json();
      expect(imported.spec.slug).toBe("pr-reviewer-2");
      expect(app.token).toMatch(/^[0-9a-f]{48}$/);
    } finally {
      server.close();
    }
  });
});

describe("picking the model from the web page", () => {
  test("remembers provider and model, keeps a typed key in memory only, and lists a server's models", async () => {
    const seenKeys: (string | null)[] = [];
    // A stand-in OpenAI-compatible server (think Ollama or a company gateway).
    const fake = Bun.serve({
      port: 0,
      fetch(req) {
        seenKeys.push(req.headers.get("authorization"));
        return Response.json({ data: [{ id: "small-model" }, { id: "big-model" }] });
      },
    });
    const ws = new Workspace(tempDir());
    const server = await serve({ workspace: ws, port: 0, quiet: true });
    const page = await (await fetch(server.url)).text();
    const token = /const TOKEN = "([0-9a-f]+)"/.exec(page)![1];
    const call = (path: string, init: RequestInit = {}) => fetch(`${server.url}api/${path}`, { ...init, headers: { "x-bot-forge-token": token, ...(init.headers ?? {}) } });
    try {
      const listed = await (await call("models", { method: "POST", body: JSON.stringify({ provider: "custom", baseUrl: `http://127.0.0.1:${fake.port}/v1`, apiKey: "sk-session" }) })).json();
      expect(listed.models).toEqual(["big-model", "small-model"]);
      expect(seenKeys.at(-1)).toBe("Bearer sk-session");

      const saved = await (await call("config", { method: "PUT", body: JSON.stringify({ provider: "custom", model: "small-model", baseUrl: `http://127.0.0.1:${fake.port}/v1` }) })).json();
      expect(saved).toMatchObject({ provider: "custom", model: "small-model", problem: null });
      expect(saved.presets.find((p: { id: string }) => p.id === "custom").key).toBe("session");
      expect(saved.presets.find((p: { id: string }) => p.id === "ollama").key).toBe("none");
      expect(ws.choice()).toEqual({ provider: "custom", model: "small-model", baseUrl: `http://127.0.0.1:${fake.port}/v1` });
      expect(readFileSync(join(ws.root, ".bot-forge", "settings.json"), "utf8")).not.toContain("sk-session");
    } finally {
      server.close();
      fake.stop(true);
    }
  });
});
