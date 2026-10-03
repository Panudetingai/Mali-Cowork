/** Bot growth stops at level 15. */
export const MAX_LEVEL = 15;

/** Below this level, new non-overlapping knowledge can still be added freely. */
export const KNOWLEDGE_SOFT_CAP = 10;

/** At max level with this many entries, only overlapping merges are accepted. */
export const KNOWLEDGE_SATURATED = 12;

export const XP_PER_CHAT_TURN = 10;
export const XP_PER_COWORK_TURN = 18;
export const XP_PER_INBOX_TASK = 24;

/** XP required to advance from `level` to `level + 1`. */
export function xpStep(level: number) {
  return Math.max(60, level * 85);
}

export function levelFromXp(xp: number) {
  let level = 1;
  let bank = 0;
  while (level < MAX_LEVEL) {
    const step = xpStep(level);
    if (xp < bank + step) break;
    bank += step;
    level += 1;
  }
  return level;
}

export function xpProgress(xp: number) {
  const level = levelFromXp(xp);
  if (level >= MAX_LEVEL) return { level, current: 0, next: 0, ratio: 1 };
  let bank = 0;
  for (let l = 1; l < level; l++) bank += xpStep(l);
  const step = xpStep(level);
  const current = xp - bank;
  return { level, current, next: step, ratio: Math.min(1, current / step) };
}
