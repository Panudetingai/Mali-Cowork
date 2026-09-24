import type { QuickAction, QuickRequest } from "./types";

export const DEFAULT_QUICK_ACTIONS: QuickAction[] = [
  { id: "summarize", label: "สรุป", prompt: "สรุปใจความสำคัญของข้อความนี้เป็นข้อ ๆ สั้น ๆ:\n\n{input}", builtIn: true },
  {
    id: "translate",
    label: "แปล TH⇄EN",
    prompt: "ถ้าข้อความนี้เป็นภาษาไทยให้แปลเป็นอังกฤษ ถ้าเป็นภาษาอื่นให้แปลเป็นไทย ตอบเฉพาะคำแปล:\n\n{input}",
    builtIn: true,
  },
  { id: "polite", label: "เขียนใหม่ให้สุภาพ", prompt: "เขียนข้อความนี้ใหม่ให้สุภาพและเป็นมืออาชีพ คงภาษาเดิม ตอบเฉพาะข้อความใหม่:\n\n{input}", builtIn: true },
  { id: "explain-code", label: "อธิบายโค้ด", prompt: "อธิบายว่าโค้ดนี้ทำอะไร และจุดที่ควรระวัง:\n\n{input}", builtIn: true },
];

/**
 * The text sent to the model: the action's template filled with the input
 * (clipboard, else what was typed), plus the typed text as an extra note
 * when both exist.
 */
export function buildQuickPrompt({ prompt, action, clipboardText }: Pick<QuickRequest, "prompt" | "action" | "clipboardText">) {
  const typed = prompt.trim();
  const clip = clipboardText?.trim();
  if (!action) return clip ? `${typed}\n\n---\n${clip}`.trim() : typed;
  const input = clip || typed;
  const filled = action.prompt.includes("{input}") ? action.prompt.split("{input}").join(input) : `${action.prompt}\n\n${input}`;
  return clip && typed ? `${filled}\n\nหมายเหตุจากผู้ใช้: ${typed}` : filled;
}
