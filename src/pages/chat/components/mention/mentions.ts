import { join } from "@tauri-apps/api/path";
import { readDir, readTextFile } from "@tauri-apps/plugin-fs";

const MAX_FILE_BYTES = 100_000;
const MAX_FILE_CHARS = 8000;
const MAX_FILES = 5;

/** `@src/app.ts` tokens the user typed (the `@` must start the token). */
export function parseMentions(text: string): string[] {
  const found: string[] = [];
  const re = /(?:^|\s)@([^\s@][^\s]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const token = m[1].replace(/[.,;:!?)]+$/, "");
    if (token && !found.includes(token)) found.push(token);
  }
  return found;
}

type Resolved =
  | { kind: "file"; rel: string; abs: string }
  | { kind: "dir"; rel: string; abs: string }
  | { kind: "missing"; rel: string };

async function resolve(root: string, token: string): Promise<Resolved> {
  const rel = token.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
  if (!rel || rel.includes("..")) return { kind: "missing", rel: token };
  const abs = await join(root, ...rel.split("/"));
  try {
    const entries = await readDir(abs);
    void entries;
    return { kind: "dir", rel, abs };
  } catch {
    // Not a directory — try it as a file below.
  }
  try {
    await readTextFile(abs);
    return { kind: "file", rel, abs };
  } catch {
    return { kind: "missing", rel: token };
  }
}

/**
 * Read every `@path` the prompt references and return a context appendix.
 * Files contribute their content, folders their listing — so every backend
 * (provider API and local agents) sees the same context.
 */
export async function buildMentionAppendix(root: string, text: string): Promise<string> {
  const tokens = parseMentions(text);
  if (tokens.length === 0) return "";
  const parts: string[] = [];
  let files = 0;
  for (const token of tokens) {
    const target = await resolve(root, token);
    // Not a path (e.g. `@claude`, an email): leave it as plain text.
    if (target.kind === "missing") continue;
    if (target.kind === "dir") {
      let names: string[] = [];
      try {
        const entries = await readDir(target.abs);
        names = entries
          .map((e) => `${e.name ?? "?"}${e.isDirectory ? "/" : ""}`)
          .sort()
          .slice(0, 100);
      } catch {
        names = ["(could not list this folder)"];
      }
      parts.push(`--- @${target.rel}/ (folder listing) ---\n${names.join("\n")}`);
      continue;
    }
    if (files >= MAX_FILES) {
      parts.push(`--- @${target.rel} ---\n(skipped: more than ${MAX_FILES} files referenced)`);
      continue;
    }
    files += 1;
    try {
      const content = await readTextFile(target.abs);
      if (content.length > MAX_FILE_BYTES) {
        parts.push(`--- @${target.rel} ---\n(file too large, ${content.length} chars — open it in the workspace instead)`);
      } else if (content.length > MAX_FILE_CHARS) {
        parts.push(`--- @${target.rel} ---\n${content.slice(0, MAX_FILE_CHARS)}\n… (truncated, ${content.length} chars total)`);
      } else {
        parts.push(`--- @${target.rel} ---\n${content}`);
      }
    } catch {
      parts.push(`--- @${target.rel} ---\n(could not read: binary or locked)`);
    }
  }
  return parts.length > 0 ? `\n\n[Referenced files]\n${parts.join("\n\n")}` : "";
}
