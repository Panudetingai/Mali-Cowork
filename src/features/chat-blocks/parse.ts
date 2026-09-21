import type { AuthActionBlock, MediaPreviewBlock } from "./types";

const AUTH_BLOCK = /```auth[^\S\n]*\n([\s\S]*?)```/g;
const OPEN_AUTH = /```auth[^\S\n]*(\n[\s\S]*)?$/;
const PREVIEW_BLOCK = /```preview[^\S\n]*\n([\s\S]*?)```/g;
const OPEN_PREVIEW = /```preview[^\S\n]*(\n[\s\S]*)?$/;

const MD_LINK = /\[([^\]]+)\]\(([^)]+)\)/g;
const HTML_ANCHOR = /<a\s+[^>]*href=["'](https?:\/\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
const ANGLE_URL = /<\s*(https?:\/\/[^>\s]+)\s*>/g;

function parseJson<T>(body: string): T | null {
  try {
    const value = JSON.parse(body.trim());
    return value && typeof value === "object" ? (value as T) : null;
  } catch {
    return null;
  }
}

function normalizeUrl(raw: string): string {
  let u = raw.trim().replace(/^<|>$/g, "");
  const space = u.search(/\s/);
  if (space > 0) u = u.slice(0, space);
  u = u.replace(/^["']|["']$/g, "");
  return u.trim();
}

function isOAuthish(label: string, url: string): boolean {
  const blob = `${label} ${url}`.toLowerCase();
  return (
    /authorize|sign[\s-]?in|oauth|consent|gmail|google|ยืนยัน|เข้าสู่ระบบ|ลงชื่อ|ลิงก์นี้/.test(blob) ||
    /accounts\.google|oauth|authorize|consent|login\.microsoft|github\.com\/login|\/auth\?/i.test(url)
  );
}

function pushAuth(
  actions: AuthActionBlock[],
  url: string,
  label: string,
  leadIn?: string,
) {
  const clean = normalizeUrl(url);
  if (!clean.startsWith("http://") && !clean.startsWith("https://")) return;
  const actionLabel = label.trim() || "Continue in browser";
  actions.push({
    title: /gmail/i.test(label + clean) ? "Gmail" : actionLabel,
    service: /gmail/i.test(label + clean) ? "Gmail" : undefined,
    description: leadIn?.trim() || undefined,
    url: clean,
    actionLabel,
  });
}

function parseAuth(body: string): AuthActionBlock | null {
  const value = parseJson<Record<string, unknown>>(body);
  if (!value) return null;
  const url = typeof value.url === "string" ? value.url.trim() : "";
  if (!url.startsWith("http://") && !url.startsWith("https://")) return null;
  const title =
    (typeof value.title === "string" && value.title.trim()) ||
    (typeof value.service === "string" && value.service.trim()) ||
    "Sign in required";
  return {
    title,
    description: typeof value.description === "string" ? value.description.trim() : undefined,
    url,
    actionLabel: typeof value.actionLabel === "string" ? value.actionLabel.trim() : undefined,
    connectorId: typeof value.connectorId === "string" ? value.connectorId.trim() : undefined,
    service: typeof value.service === "string" ? value.service.trim() : undefined,
  };
}

function parsePreview(body: string): MediaPreviewBlock | null {
  const value = parseJson<Record<string, unknown>>(body);
  if (!value) return null;
  const url = typeof value.url === "string" ? value.url.trim() : "";
  if (!url.startsWith("http://") && !url.startsWith("https://")) return null;
  const kind =
    value.kind === "video" || value.kind === "link" || value.kind === "image"
      ? value.kind
      : /\.(mp4|webm|mov)(\?|$)/i.test(url)
        ? "video"
        : /\.(png|jpe?g|gif|webp|svg)(\?|$)/i.test(url)
          ? "image"
          : "link";
  return {
    kind,
    url,
    title: typeof value.title === "string" ? value.title.trim() : undefined,
    description: typeof value.description === "string" ? value.description.trim() : undefined,
    thumbnail: typeof value.thumbnail === "string" ? value.thumbnail.trim() : undefined,
  };
}

function dedupeAuth(actions: AuthActionBlock[]) {
  const seen = new Set<string>();
  return actions.filter((a) => {
    const key = a.connectorId ?? a.url;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function extractAuthFromProse(text: string, authActions: AuthActionBlock[]): string {
  let leadIn: string | undefined;

  // HTML anchors (common in tool output pasted into chat)
  text = text.replace(HTML_ANCHOR, (_full, url: string, inner: string) => {
    const label = inner.replace(/<[^>]+>/g, "").trim();
    if (isOAuthish(label, url)) {
      pushAuth(authActions, url, label, leadIn);
      return "";
    }
    return _full;
  });

  // Markdown [label](url) — any paren form, optional title after url
  text = text.replace(MD_LINK, (full, label: string, rawUrl: string) => {
    const url = normalizeUrl(rawUrl);
    if (!url.startsWith("http://") && !url.startsWith("https://")) return full;
    if (isOAuthish(label, url)) {
      pushAuth(authActions, url, label, leadIn);
      return "";
    }
    return full;
  });

  // Autolink <https://...>
  text = text.replace(ANGLE_URL, (full, url: string) => {
    if (isOAuthish("", url)) {
      pushAuth(authActions, url, "Open authorization page", leadIn);
      return "";
    }
    return full;
  });

  // Plain URL on its own line when message mentions Gmail / authorize (Thai agent copy)
  if (/gmail|authorize|ยืนยัน|ลิงก์นี้|oauth/i.test(text)) {
    text = text.replace(/(https?:\/\/[^\s<>"')\]]+)/g, (full, url: string) => {
      if (isOAuthish(text, url)) {
        const before = text.slice(0, text.indexOf(full));
        const lead = before.split(/[\n。！!]/).pop();
        pushAuth(authActions, url, "Authorize", lead);
        return "";
      }
      return full;
    });
  }

  // Remember Thai lead-in before colon for the next auth link on the same paragraph
  const leadMatch = /([^\n]+(?:Gmail|gmail|ยืนยัน)[^\n]*[：:])\s*/.exec(text);
  if (leadMatch) leadIn = leadMatch[1];

  return text;
}

/** Pull ```auth / ```preview blocks and OAuth links out of assistant text. */
export function extractChatBlocks(content: string): {
  text: string;
  authActions: AuthActionBlock[];
  mediaPreviews: MediaPreviewBlock[];
} {
  const authActions: AuthActionBlock[] = [];
  const mediaPreviews: MediaPreviewBlock[] = [];

  let text = content;

  if (text.includes("```auth")) {
    text = text
      .replace(AUTH_BLOCK, (_, body: string) => {
        const parsed = parseAuth(body);
        if (parsed) authActions.push(parsed);
        return "";
      })
      .replace(OPEN_AUTH, "");
  }

  if (text.includes("```preview")) {
    text = text
      .replace(PREVIEW_BLOCK, (_, body: string) => {
        const parsed = parsePreview(body);
        if (parsed) mediaPreviews.push(parsed);
        return "";
      })
      .replace(OPEN_PREVIEW, "");
  }

  text = extractAuthFromProse(text, authActions);

  return {
    text: text.replace(/\n{3,}/g, "\n\n").trim(),
    authActions: dedupeAuth(authActions),
    mediaPreviews,
  };
}

/** True when a URL should open immediately (OAuth), not only on hover preview. */
export function isOAuthUrl(url: string): boolean {
  return isOAuthish("", url);
}
