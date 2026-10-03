import { KNOWLEDGE_SATURATED, KNOWLEDGE_SOFT_CAP, MAX_LEVEL } from "./constants";
import type { BotKnowledge, CustomBot } from "./types";

const STOP = new Set(["the", "and", "for", "with", "that", "this", "from", "your", "you", "are", "was", "have", "has"]);

function tokens(text: string) {
  return new Set(
    text
      .toLowerCase()
      .split(/\W+/)
      .filter((w) => w.length > 2 && !STOP.has(w)),
  );
}

/** How much two knowledge entries say the same thing (0–1). */
export function overlapScore(a: string, b: string) {
  const A = tokens(a);
  const B = tokens(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter += 1;
  return inter / Math.min(A.size, B.size);
}

function mergeBodies(a: string, b: string) {
  const lines = [...new Set([...a.split("\n"), ...b.split("\n")].map((l) => l.trim()).filter(Boolean))];
  const merged = lines.slice(0, 8).join("\n");
  return merged.length > 900 ? `${merged.slice(0, 897)}…` : merged;
}

export type AbsorbResult =
  | { ok: true; bot: CustomBot; merged: boolean; skipped?: false }
  | { ok: false; reason: "saturated" | "duplicate"; bot: CustomBot };

/**
 * Add or refresh knowledge. Overlapping entries replace the old one with a
 * merged note; when the bot is full at max level, only merges are kept.
 */
export function absorbKnowledge(bot: CustomBot, draft: Omit<BotKnowledge, "id" | "updatedAt">): AbsorbResult {
  const text = `${draft.title}\n${draft.body}`;
  const now = Date.now();

  const hit = bot.knowledge.find((k) => overlapScore(`${k.title}\n${k.body}`, text) >= 0.48);
  if (hit) {
    const next: BotKnowledge = {
      id: hit.id,
      title: draft.title.length >= hit.title.length ? draft.title : hit.title,
      body: mergeBodies(hit.body, draft.body),
      tags: [...new Set([...hit.tags, ...draft.tags])].slice(0, 8),
      updatedAt: now,
    };
    return {
      ok: true,
      merged: true,
      bot: {
        ...bot,
        knowledge: bot.knowledge.map((k) => (k.id === hit.id ? next : k)),
        updatedAt: now,
      },
    };
  }

  const saturated =
    bot.level >= MAX_LEVEL && bot.knowledge.length >= KNOWLEDGE_SATURATED;
  const softFull = bot.knowledge.length >= KNOWLEDGE_SOFT_CAP && bot.level >= MAX_LEVEL - 2;

  if (saturated || softFull) {
    return { ok: false, reason: "saturated", bot };
  }

  const entry: BotKnowledge = {
    id: `kn_${crypto.randomUUID().slice(0, 10)}`,
    title: draft.title.trim(),
    body: draft.body.trim(),
    tags: draft.tags.filter(Boolean).slice(0, 8),
    updatedAt: now,
  };

  return {
    ok: true,
    merged: false,
    bot: {
      ...bot,
      knowledge: [entry, ...bot.knowledge].slice(0, KNOWLEDGE_SATURATED),
      updatedAt: now,
    },
  };
}
