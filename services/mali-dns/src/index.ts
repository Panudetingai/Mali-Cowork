/**
 * Mali DNS: gives every Mali install its own name under BASE_DOMAIN (like
 * `k3x9q2mf7a.m.example.com`), so its phone remote gets a trusted Let's
 * Encrypt certificate and the phone never warns.
 *
 * The Cloudflare API token lives here only (a Worker secret). An install
 * gets an id and a secret once, and with them can do three things to its
 * own name and nothing else:
 *   - point it at an address on its LAN or tailnet (never a public one),
 *   - add the TXT record Let's Encrypt checks (`_acme-challenge.<its name>`),
 *   - remove those again, or the whole name.
 *
 * The certificate's private key is made on the computer and never comes
 * here; neither does anything the phone and the computer say to each other.
 */

export interface Env {
  DEVICES: KVNamespace;
  /** Zone → DNS → Edit, for the zone that holds BASE_DOMAIN. A secret. */
  CF_API_TOKEN: string;
  CF_ZONE_ID: string;
  /** e.g. `m.example.com`: names are `<id>.m.example.com`. */
  BASE_DOMAIN: string;
}

/** The slice of the KV API used here (also what the tests fake). */
export interface KVNamespace {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
  list(options: { prefix: string; cursor?: string }): Promise<{
    keys: { name: string }[];
    list_complete: boolean;
    cursor?: string;
  }>;
}

type Device = {
  /** SHA-256 of the secret, hex. */
  secretHash: string;
  createdAt: number;
  /** Last time the install was heard from (updated at most weekly, to spare writes). */
  seenAt: number;
  ip?: string;
  recordId?: string;
};

const CF_API = "https://api.cloudflare.com/client/v4";
const TTL = 60;
/** Registrations allowed per public address per day. */
const REGISTRATIONS_PER_DAY = 5;
/** Challenge records one install may have at a time. */
const MAX_TXT = 4;
const DAY_MS = 86_400_000;
/** An install not heard from in this long is forgotten, with its records. */
const FORGET_AFTER_MS = 120 * DAY_MS;
const SEEN_EVERY_MS = 7 * DAY_MS;

// ── checks (exported for tests) ──

/** Only addresses that can't be reached from the internet: LAN ranges and Tailscale's. */
export function isPrivateIPv4(ip: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return false;
  const [a, b, c, d] = m.slice(1).map(Number);
  if ([a, b, c, d].some((n) => n > 255) || m.slice(1).some((p) => p.length > 1 && p.startsWith("0"))) return false;
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}

/** A DNS-01 value: base64url of a SHA-256, 43 characters. */
export function isChallengeValue(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);
}

/** `Authorization: Bearer <id>.<secret>`. */
export function parseAuth(header: string | null): { id: string; secret: string } | null {
  const m = /^Bearer ([a-z0-9]{10})\.([a-f0-9]{64})$/.exec(header?.trim() ?? "");
  return m ? { id: m[1], secret: m[2] } : null;
}

const ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";

/** 10 characters from an alphabet without look-alikes: about 50 bits. */
export function newId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
}

function newSecret(): string {
  return hex(crypto.getRandomValues(new Uint8Array(32)));
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function sha256(text: string): Promise<string> {
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))));
}

/** Compare without leaking how much matched. */
function same(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ── Cloudflare ──

async function cf(env: Env, method: string, path: string, body?: unknown): Promise<any> {
  const response = await fetch(`${CF_API}/zones/${env.CF_ZONE_ID}${path}`, {
    method,
    headers: { authorization: `Bearer ${env.CF_API_TOKEN}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data: any = await response.json().catch(() => ({}));
  if (!data?.success) throw new Error(data?.errors?.[0]?.message ?? `Cloudflare ${response.status}`);
  return data.result;
}

async function recordsNamed(env: Env, type: string, name: string): Promise<{ id: string }[]> {
  return cf(env, "GET", `/dns_records?type=${type}&name=${encodeURIComponent(name)}`);
}

// ── HTTP ──

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

const fail = (status: number, error: string) => json({ error }, status);

async function readJson(request: Request): Promise<any> {
  const text = await request.text();
  if (text.length > 2048) throw new Error("too large");
  return text ? JSON.parse(text) : {};
}

async function device(env: Env, request: Request): Promise<{ id: string; device: Device } | null> {
  const auth = parseAuth(request.headers.get("authorization"));
  if (!auth) return null;
  const raw = await env.DEVICES.get(`dev:${auth.id}`);
  if (!raw) return null;
  const found = JSON.parse(raw) as Device;
  return same(found.secretHash, await sha256(auth.secret)) ? { id: auth.id, device: found } : null;
}

export async function handle(request: Request, env: Env, now = Date.now()): Promise<Response> {
  const url = new URL(request.url);
  const route = `${request.method} ${url.pathname}`;
  try {
    if (route === "GET /v1/health") return json({ ok: true, base: env.BASE_DOMAIN });

    if (route === "POST /v1/register") {
      // A few names per address per day: enough for anyone, too few to farm.
      const caller = request.headers.get("cf-connecting-ip") ?? "unknown";
      const counter = `rl:${await sha256(caller)}:${Math.floor(now / DAY_MS)}`;
      const count = Number((await env.DEVICES.get(counter)) ?? 0);
      if (count >= REGISTRATIONS_PER_DAY) return fail(429, "Too many registrations from this network today.");
      await env.DEVICES.put(counter, String(count + 1), { expirationTtl: 2 * 86_400 });
      let id = newId();
      while (await env.DEVICES.get(`dev:${id}`)) id = newId();
      const secret = newSecret();
      const record: Device = { secretHash: await sha256(secret), createdAt: now, seenAt: now };
      await env.DEVICES.put(`dev:${id}`, JSON.stringify(record));
      return json({ id, secret, hostname: `${id}.${env.BASE_DOMAIN}` });
    }

    const found = await device(env, request);
    if (!found) return fail(401, "Unknown device.");
    const { id } = found;
    const name = `${id}.${env.BASE_DOMAIN}`;
    const challengeName = `_acme-challenge.${name}`;
    let record = found.device;
    let changed = false;

    if (route === "POST /v1/address") {
      const { ip } = await readJson(request);
      if (typeof ip !== "string" || !isPrivateIPv4(ip)) {
        return fail(400, "Only a LAN or Tailscale address can be used.");
      }
      if (record.ip !== ip || !record.recordId) {
        const body = { type: "A", name, content: ip, ttl: TTL, proxied: false };
        const result = record.recordId
          ? await cf(env, "PUT", `/dns_records/${record.recordId}`, body).catch(() => cf(env, "POST", "/dns_records", body))
          : await cf(env, "POST", "/dns_records", body);
        record = { ...record, ip, recordId: result.id };
        changed = true;
      }
      if (changed || now - record.seenAt > SEEN_EVERY_MS) {
        await env.DEVICES.put(`dev:${id}`, JSON.stringify({ ...record, seenAt: now }));
      }
      return json({ hostname: name, ip });
    }

    if (route === "POST /v1/challenge") {
      const { value } = await readJson(request);
      if (!isChallengeValue(value)) return fail(400, "Not a challenge value.");
      if ((await recordsNamed(env, "TXT", challengeName)).length >= MAX_TXT) {
        return fail(429, "Too many challenge records; remove the old ones first.");
      }
      const result = await cf(env, "POST", "/dns_records", { type: "TXT", name: challengeName, content: value, ttl: TTL });
      return json({ id: result.id });
    }

    if (route === "DELETE /v1/challenge") {
      for (const r of await recordsNamed(env, "TXT", challengeName)) await cf(env, "DELETE", `/dns_records/${r.id}`);
      return json({ ok: true });
    }

    if (route === "DELETE /v1/device") {
      await forget(env, id, record);
      return json({ ok: true });
    }

    return fail(404, "Not found.");
  } catch (error) {
    console.error(route, error);
    return fail(502, "The DNS update didn't go through. Try again shortly.");
  }
}

async function forget(env: Env, id: string, record: Device) {
  const name = `${id}.${env.BASE_DOMAIN}`;
  const records = [
    ...(await recordsNamed(env, "A", name).catch(() => [])),
    ...(await recordsNamed(env, "TXT", `_acme-challenge.${name}`).catch(() => [])),
  ];
  if (record.recordId && !records.some((r) => r.id === record.recordId)) records.push({ id: record.recordId });
  for (const r of records) await cf(env, "DELETE", `/dns_records/${r.id}`).catch(() => undefined);
  await env.DEVICES.delete(`dev:${id}`);
}

/** Daily: forget installs not heard from in four months, with their records. */
export async function sweep(env: Env, now = Date.now()) {
  let cursor: string | undefined;
  do {
    const page = await env.DEVICES.list({ prefix: "dev:", cursor });
    for (const key of page.keys) {
      const raw = await env.DEVICES.get(key.name);
      if (!raw) continue;
      const record = JSON.parse(raw) as Device;
      if (now - record.seenAt > FORGET_AFTER_MS) await forget(env, key.name.slice(4), record);
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
}

export default {
  fetch: (request: Request, env: Env) => handle(request, env),
  scheduled: (_event: unknown, env: Env, ctx: { waitUntil(p: Promise<unknown>): void }) => ctx.waitUntil(sweep(env)),
};
