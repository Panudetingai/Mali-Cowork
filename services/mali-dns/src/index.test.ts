import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { handle, isChallengeValue, isPrivateIPv4, parseAuth, sweep, type Env, type KVNamespace } from "./index";

/** In-memory KV and a fake Cloudflare DNS, enough to run the Worker. */
function setup() {
  const kv = new Map<string, string>();
  const DEVICES: KVNamespace = {
    get: async (k) => kv.get(k) ?? null,
    put: async (k, v) => void kv.set(k, v),
    delete: async (k) => void kv.delete(k),
    list: async ({ prefix }) => ({ keys: [...kv.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true }),
  };
  const records = new Map<string, { type: string; name: string; content: string }>();
  let next = 1;
  const calls: string[] = [];
  globalThis.fetch = mock(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    calls.push(`${method} ${url.pathname}${url.search}`);
    const ok = (result: unknown) => new Response(JSON.stringify({ success: true, result }));
    const id = url.pathname.split("/dns_records/")[1];
    if (method === "GET") {
      const type = url.searchParams.get("type");
      const name = url.searchParams.get("name");
      return ok([...records].filter(([, r]) => r.type === type && r.name === name).map(([rid]) => ({ id: rid })));
    }
    if (method === "POST") {
      const rid = `r${next++}`;
      records.set(rid, JSON.parse(String(init?.body)));
      return ok({ id: rid });
    }
    if (method === "PUT") {
      records.set(id, JSON.parse(String(init?.body)));
      return ok({ id });
    }
    if (method === "DELETE") {
      records.delete(id);
      return ok({ id });
    }
    return new Response("{}", { status: 400 });
  }) as unknown as typeof fetch;
  const env: Env = { DEVICES, CF_API_TOKEN: "t", CF_ZONE_ID: "z", BASE_DOMAIN: "m.example.com" };
  const call = (method: string, path: string, body?: unknown, auth?: string, ip = "203.0.113.9") =>
    handle(
      new Request(`https://dns.example.workers.dev${path}`, {
        method,
        headers: { ...(auth ? { authorization: `Bearer ${auth}` } : {}), "cf-connecting-ip": ip },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
      env,
    );
  return { env, kv, records, calls, call };
}

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("checks", () => {
  test("only LAN and Tailscale addresses", () => {
    for (const ip of ["192.168.1.5", "10.0.0.1", "172.16.0.1", "172.31.255.255", "100.64.0.1", "100.127.1.1"]) {
      expect(isPrivateIPv4(ip)).toBe(true);
    }
    for (const ip of ["8.8.8.8", "172.32.0.1", "100.128.0.1", "127.0.0.1", "192.168.1", "192.168.001.5", "256.1.1.1", "::1"]) {
      expect(isPrivateIPv4(ip)).toBe(false);
    }
  });

  test("challenge values and auth headers have one shape", () => {
    expect(isChallengeValue("a".repeat(43))).toBe(true);
    expect(isChallengeValue("a".repeat(42))).toBe(false);
    expect(isChallengeValue("<script>".padEnd(43, "a"))).toBe(false);
    expect(parseAuth(`Bearer abcdefghij.${"a".repeat(64)}`)).toEqual({ id: "abcdefghij", secret: "a".repeat(64) });
    expect(parseAuth("Bearer nope")).toBeNull();
    expect(parseAuth(null)).toBeNull();
  });
});

describe("worker", () => {
  let t: ReturnType<typeof setup>;
  beforeEach(() => {
    t = setup();
  });

  async function register(ip?: string) {
    const res = await t.call("POST", "/v1/register", undefined, undefined, ip);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; secret: string; hostname: string };
    return { ...body, auth: `${body.id}.${body.secret}` };
  }

  test("registers a name and points it at a private address", async () => {
    const d = await register();
    expect(d.hostname).toBe(`${d.id}.m.example.com`);
    expect((await t.call("POST", "/v1/address", { ip: "192.168.1.23" }, d.auth)).status).toBe(200);
    const [record] = [...t.records.values()];
    expect(record).toEqual({ type: "A", name: d.hostname, content: "192.168.1.23", ttl: 60, proxied: false } as never);
    // The secret itself is never stored.
    expect([...t.kv.values()].join()).not.toContain(d.secret);
  });

  test("refuses public addresses, wrong secrets and other devices' names", async () => {
    const d = await register();
    expect((await t.call("POST", "/v1/address", { ip: "1.2.3.4" }, d.auth)).status).toBe(400);
    expect((await t.call("POST", "/v1/address", { ip: "192.168.1.2" }, `${d.id}.${"0".repeat(64)}`)).status).toBe(401);
    expect((await t.call("POST", "/v1/address", { ip: "192.168.1.2" })).status).toBe(401);
    const other = await register();
    await t.call("POST", "/v1/challenge", { value: "b".repeat(43) }, other.auth);
    const names = [...t.records.values()].map((r) => r.name);
    expect(names).toEqual([`_acme-challenge.${other.hostname}`]);
  });

  test("adds and clears the challenge records of its own name only", async () => {
    const d = await register();
    expect((await t.call("POST", "/v1/challenge", { value: "x".repeat(43) }, d.auth)).status).toBe(200);
    expect((await t.call("POST", "/v1/challenge", { value: "not valid" }, d.auth)).status).toBe(400);
    expect([...t.records.values()][0]).toMatchObject({ type: "TXT", name: `_acme-challenge.${d.hostname}` });
    for (let i = 0; i < 3; i++) await t.call("POST", "/v1/challenge", { value: "y".repeat(43) }, d.auth);
    expect((await t.call("POST", "/v1/challenge", { value: "z".repeat(43) }, d.auth)).status).toBe(429);
    await t.call("DELETE", "/v1/challenge", undefined, d.auth);
    expect(t.records.size).toBe(0);
  });

  test("limits registrations per network per day", async () => {
    for (let i = 0; i < 5; i++) await register("198.51.100.1");
    expect((await t.call("POST", "/v1/register", undefined, undefined, "198.51.100.1")).status).toBe(429);
    expect((await t.call("POST", "/v1/register", undefined, undefined, "198.51.100.2")).status).toBe(200);
  });

  test("an unchanged address doesn't write again", async () => {
    const d = await register();
    await t.call("POST", "/v1/address", { ip: "10.0.0.7" }, d.auth);
    const writes = t.calls.length;
    await t.call("POST", "/v1/address", { ip: "10.0.0.7" }, d.auth);
    expect(t.calls.length).toBe(writes);
  });

  test("deleting a device removes its records; sweep forgets stale ones", async () => {
    const a = await register();
    await t.call("POST", "/v1/address", { ip: "10.0.0.7" }, a.auth);
    await t.call("DELETE", "/v1/device", undefined, a.auth);
    expect(t.records.size).toBe(0);
    expect(t.kv.has(`dev:${a.id}`)).toBe(false);

    const b = await register();
    await t.call("POST", "/v1/address", { ip: "10.0.0.8" }, b.auth);
    await sweep(t.env, Date.now() + 121 * 86_400_000);
    expect(t.records.size).toBe(0);
    expect(t.kv.has(`dev:${b.id}`)).toBe(false);
  });
});
