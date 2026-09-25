/**
 * Chat → Cowork, in the same chat. Chat mode can't touch files, so when the
 * user asks for that, the model says so and adds a ```cowork block; the app
 * hides the block and offers to move the chat to Cowork, where the new agent
 * hears the whole conversation (see `moveChatToCowork`).
 */

/** Anything that could be about files or the computer; gates the instructions. */
const INTENT =
  /\b(files?|folders?|director(y|ies)|save|saving|desktop|disk|rename|organi[sz]e|download|export)\b|\.(txt|md|csv|tsv|json|html?|docx?|xlsx?|pptx?|pdf|py|js|ts)\b|ไฟล์|โฟลเดอร์|แฟ้ม|บันทึก|เซฟ|ในเครื่อง|จัดระเบียบ|เปลี่ยนชื่อ|ดาวน์โหลด/i;

/** A request to do something, not to explain it. */
const ACTION =
  /\b(create|make|write|save|generate|put|edit|update|change|delete|remove|move|rename|organi[sz]e|export|build)\b|สร้าง|เขียน|บันทึก|เซฟ|แก้|ลบ|ย้าย|จัด|เปลี่ยนชื่อ|ทำ|ใส่/i;
const OBJECT =
  /\b(files?|folders?|director(y|ies))\b|\.(txt|md|csv|tsv|json|html?|docx?|xlsx?|pptx?|pdf)\b|ไฟล์|โฟลเดอร์|แฟ้ม/i;
/** "How do I…" is a question to answer, not work to hand over. */
const HOW_TO = /\b(how (do|can|to)|what is|explain|example)\b|วิธี|ยังไง|อย่างไร|คืออะไร|ตัวอย่าง/i;

const INSTRUCTIONS = `# Chat mode and Cowork
You are in Chat mode: you can't read, create, edit, move or delete files or folders on this computer, and you can't run commands. When the user asks you to do that (for example "create a file in this folder" or "save this as a .md file"), don't paste a script as a stand-in and never claim it's done. Say in one short sentence, in the user's language, that Cowork mode can do it in their folder and will keep this conversation, then end your reply with this block:

\`\`\`cowork
{"task": "<what Cowork should do, a few words, in the user's language>"}
\`\`\`

Only add the block for work on the user's files or computer — not for questions about how something is done.`;

/** Extra instructions for a Chat-mode prompt that might want file work. */
export function coworkInstructionsFor(prompt: string) {
  return INTENT.test(prompt) ? INSTRUCTIONS : "";
}

/**
 * The prompt asks for file work outright. Used when the model didn't add a
 * block (some ignore instructions): the app then offers Cowork more quietly.
 */
export function looksLikeFileWork(prompt: string) {
  return ACTION.test(prompt) && OBJECT.test(prompt) && !HOW_TO.test(prompt);
}

const BLOCK = /```cowork[^\S\n]*\n([\s\S]*?)```/;
/** A block still being written (no closing fence yet). */
const OPEN_BLOCK = /```cowork[^\S\n]*(\n[\s\S]*)?$/;

export type CoworkSuggestion = { task?: string };

/** The reply without its ```cowork block, and the suggestion it held. */
export function extractCoworkBlock(content: string): { text: string; suggestion?: CoworkSuggestion } {
  if (!content.includes("```cowork")) return { text: content };
  let suggestion: CoworkSuggestion | undefined;
  const text = content
    .replace(BLOCK, (_, body: string) => {
      suggestion = { task: taskOf(body) };
      return "";
    })
    .replace(OPEN_BLOCK, "")
    .trimEnd();
  return { text, suggestion };
}

function taskOf(body: string) {
  try {
    const value = JSON.parse(body.trim());
    const task = typeof value?.task === "string" ? value.task.trim() : "";
    return task ? task.slice(0, 200) : undefined;
  } catch {
    return undefined;
  }
}
