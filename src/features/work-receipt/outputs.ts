import type { ChatSession } from "@/features/chat-history";
import { renamePairs } from "./receipt";
import type { OutputItem, OutputKind, OutputsQuery } from "./types";

const KIND_BY_EXT: Record<string, OutputKind> = {
  md: "document", txt: "document", docx: "document", doc: "document", rtf: "document", odt: "document", html: "document",
  csv: "sheet", tsv: "sheet", xlsx: "sheet", xls: "sheet", ods: "sheet",
  pptx: "slides", ppt: "slides", key: "slides", odp: "slides",
  pdf: "pdf",
  png: "image", jpg: "image", jpeg: "image", gif: "image", webp: "image", svg: "image", heic: "image",
  ts: "code", tsx: "code", js: "code", jsx: "code", mjs: "code", py: "code", rs: "code", go: "code",
  java: "code", kt: "code", swift: "code", c: "code", h: "code", cpp: "code", cs: "code", rb: "code",
  php: "code", sh: "code", sql: "code", css: "code", json: "code", yaml: "code", yml: "code", toml: "code",
};

const nameOf = (path: string) => path.split(/[\\/]/).pop() || path;

export function outputKindOf(path: string): OutputKind {
  const name = nameOf(path);
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return "other";
  return KIND_BY_EXT[name.slice(dot + 1).toLowerCase()] ?? "other";
}

/**
 * Files agents created, newest first, read from the chats already in memory
 * (every Cowork turn keeps its `turn.changes`). A file created again by a
 * later turn is listed once, at its latest creation.
 */
export function listOutputs(sessions: ChatSession[], query: OutputsQuery = {}): OutputItem[] {
  const search = query.search?.trim().toLowerCase();
  const byPath = new Map<string, OutputItem>();
  for (const session of sessions) {
    if (query.projectId && session.projectId !== query.projectId) continue;
    for (const message of session.messages) {
      const turn = message.turn;
      if (message.role !== "assistant" || !turn) continue;
      const undone = turn.state === "undone";
      if (undone && !query.includeUndone) continue;
      const createdAt = message.createdAt ?? session.updatedAt;
      if (query.since !== undefined && createdAt < query.since) continue;
      const renamed = renamePairs(turn.changes);
      for (const change of turn.changes) {
        // A renamed or moved file isn't something the agent made.
        if (change.kind !== "added" || renamed.has(change.path)) continue;
        const kind = outputKindOf(change.path);
        if (query.kinds?.length && !query.kinds.includes(kind)) continue;
        const name = nameOf(change.path);
        if (search && !name.toLowerCase().includes(search) && !change.relative.toLowerCase().includes(search)) continue;
        const seen = byPath.get(change.path);
        if (seen && seen.createdAt >= createdAt) continue;
        byPath.set(change.path, {
          path: change.path,
          relative: change.relative,
          name,
          kind,
          size: change.size,
          createdAt,
          chatId: session.id,
          chatTitle: session.title,
          messageId: message.id,
          projectId: session.projectId,
          checkpointId: turn.checkpointId,
          undone,
        });
      }
    }
  }
  return [...byPath.values()].sort((a, b) => b.createdAt - a.createdAt);
}
