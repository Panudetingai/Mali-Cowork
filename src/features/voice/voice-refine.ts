/**
 * After dictation in voice mode: spot when the user corrected themselves
 * ("cloud … I mean claude", "… หมายถึง claude") and rebuild what to send.
 */
export type VoiceRefineResult = {
  text: string;
  /** Speak back and wait for yes before sending. */
  needsConfirm: boolean;
  /** The corrected phrase, for the confirmation line. */
  confirmHint?: string;
};

function normalizePlain(text: string) {
  return text
    .trim()
    .normalize("NFKC")
    .replace(/\s+/g, " ");
}

/** Drop the last token before appending a spoken correction. */
function replaceLastToken(before: string, correction: string) {
  const words = before.trim().split(/\s+/);
  if (words.length <= 1) return correction;
  return `${words.slice(0, -1).join(" ")} ${correction}`.trim();
}

/**
 * "use cloud I mean claude" → send "use claude", confirm "claude".
 * No marker → pass through unchanged.
 */
export function refineVoiceTranscript(raw: string): VoiceRefineResult {
  const text = normalizePlain(raw);
  if (!text) return { text: "", needsConfirm: false };

  const meanEn = text.match(/^(.+?)\b(?:i mean|actually)\b\s*(.+)$/i);
  if (meanEn) {
    const before = meanEn[1].trim();
    const correction = meanEn[2].trim();
    if (correction) {
      return {
        text: replaceLastToken(before, correction),
        needsConfirm: true,
        confirmHint: correction,
      };
    }
  }

  const meanTh = text.match(/^(.+?)(?:\s|^)(?:หมายถึง|ไม่ใช่(?:\s+\S+)*?\s+หมายถึง|อ่อ(?:\s+หมายถึง)?)\s*(.+)$/u);
  if (meanTh) {
    const before = meanTh[1].trim();
    const correction = meanTh[2].trim();
    if (correction) {
      return {
        text: replaceLastToken(before, correction),
        needsConfirm: true,
        confirmHint: correction,
      };
    }
  }

  const noThen = text.match(/^(.+?)\bno\b\s+(.+)$/i);
  if (noThen) {
    const before = noThen[1].trim();
    const correction = noThen[2].trim();
    if (correction.split(/\s+/).length <= 6) {
      return {
        text: replaceLastToken(before, correction),
        needsConfirm: true,
        confirmHint: correction,
      };
    }
  }

  return { text, needsConfirm: false };
}

export function voiceConfirmYes(text: string): boolean {
  const plain = text
    .trim()
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[.!?,…]/g, "")
    .trim();
  if (!plain) return false;
  return /^(yes|yeah|yep|yup|ok|okay|sure|correct|right|ใช่|ใช|ถูก|ถูกแล้ว|ถูกต้อง|เอา|ได้|โอเค|ตกลง)/u.test(plain);
}

export function voiceConfirmNo(text: string): boolean {
  const plain = text
    .trim()
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[.!?,…]/g, "")
    .trim();
  if (!plain) return false;
  return /^(no|nope|wrong|ไม่|ไม่ใช่|ไม่ถูก|ผิด)/u.test(plain);
}
