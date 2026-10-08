import type { WorkMode } from "@/features/opencode";

const PREFIX = "mali_composer_draft:";
const MAX_CHARS = 100_000;

export type ComposerDraft = {
  prompt: string;
  replyExcerpt: string | null;
};

/** One draft per chat and work mode — shared between Chat and Code views. */
export function composerDraftKey(chatId: string | undefined, mode: WorkMode) {
  return `${chatId ?? "new"}:${mode}`;
}

export function readComposerDraft(key: string): ComposerDraft {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return { prompt: "", replyExcerpt: null };
    const value = JSON.parse(raw) as Partial<ComposerDraft>;
    return {
      prompt: typeof value.prompt === "string" ? value.prompt.slice(0, MAX_CHARS) : "",
      replyExcerpt: typeof value.replyExcerpt === "string" ? value.replyExcerpt : null,
    };
  } catch {
    return { prompt: "", replyExcerpt: null };
  }
}

export function writeComposerDraft(key: string, draft: ComposerDraft) {
  try {
    const prompt = draft.prompt.slice(0, MAX_CHARS);
    const replyExcerpt = draft.replyExcerpt?.trim() ? draft.replyExcerpt : null;
    if (!prompt.trim() && !replyExcerpt) {
      localStorage.removeItem(PREFIX + key);
      return;
    }
    localStorage.setItem(PREFIX + key, JSON.stringify({ prompt, replyExcerpt }));
  } catch {
    // Quota or private mode — in-memory only for this session is not worth the complexity.
  }
}

export function clearComposerDraft(key: string) {
  try {
    localStorage.removeItem(PREFIX + key);
  } catch {
    // ignore
  }
}
