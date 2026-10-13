/**
 * Bots the chat's AI writes: asked to "make a bot" from what's in the chat,
 * a Notion page, a document — anything it can read with its tools — it adds
 * a ```bot block to its reply. The app hides the block and shows the bots on
 * a card to look over and save (see `BotMakerCard`). The AI never creates a
 * bot itself.
 */
import type { TeammateProposal, ToolScope } from "./store";

/** What the AI may write in a block: a proposal without the app's own fields. */
export type BotBlock = Omit<TeammateProposal, "id" | "updates">;

const MAX_BOTS = 3;
const SCOPES: ToolScope[] = ["none", "read", "files", "all"];

export function botBlockInstructions() {
  return `# Making bots in Mali
Mali has its own bots: each does one job, with its own instructions, file access, connectors and skills. When the user asks you to make, build or design a bot (บอท, สร้างบอท, "a bot that…") — from this chat, from a Notion page, a document, a link, or their own words — you write it here and the app saves it. You cannot create a Mali bot any other way: never claim it's created, and don't make a page, file, design or skill about it in another app instead.

1. Read what it should be built from first, with the tools you have (open the Notion page with its connector, read the file or the conversation above). If you can't reach it, say so and ask.
2. Then add one block per bot at the end of your reply — at most ${MAX_BOTS}, different takes on the job when it helps the user choose:

\`\`\`bot
{"name": "Short name with its job", "role": "Its one job, in one sentence", "instructions": "1. …\\n2. …", "reason": "Why it fits what the user asked, citing the source", "tools": "read", "connectors": ["custom-notion"], "skills": ["meeting-notes"]}
\`\`\`

- Write the name, role and instructions in the user's language; make the instructions concrete steps taken from the source, not generic advice.
- \`tools\`: the least it needs — "none" (connectors only), "read" (reads files), "files" (also writes) or "all" (also runs commands).
- \`connectors\`: ids of connectors it should use, as in your tool names before \`_\` (e.g. \`custom-notion\`); leave out what it doesn't need.
- \`skills\`: names of skills from the user's library it should follow, if any.
- Keep your reply short: say what you based the bots on, and that the user can look them over and save one on the card. The app hides the block.`;
}

const BLOCK = /```bot[^\S\n]*\n([\s\S]*?)```/g;
/** A block still being written (no closing fence yet). */
const OPEN_BLOCK = /```bot[^\S\n]*(\n[\s\S]*)?$/;

function parse(json: string): BotBlock | null {
  try {
    const value = JSON.parse(json.trim());
    if (!value || typeof value !== "object") return null;
    const text = (v: unknown, max: number) => {
      const s = Array.isArray(v) ? v.map(String).join("\n") : typeof v === "string" ? v : "";
      return s.trim().slice(0, max);
    };
    const list = (v: unknown) =>
      (Array.isArray(v) ? v : typeof v === "string" ? v.split(",") : [])
        .map((x) => (typeof x === "string" ? x : String((x as { id?: string; name?: string })?.id ?? (x as { name?: string })?.name ?? "")).trim())
        .filter(Boolean)
        .slice(0, 8);
    const bot: BotBlock = {
      name: text(value.name, 80),
      role: text(value.role, 400),
      instructions: text(value.instructions, 6000),
      reason: text(value.reason, 600),
      tools: SCOPES.includes(value.tools) ? value.tools : "read",
      connectors: list(value.connectors),
      skills: list(value.skills),
    };
    return bot.name && bot.role ? bot : null;
  } catch {
    return null;
  }
}

/** The reply without its ```bot blocks, and the bots they hold. */
export function extractBotBlocks(content: string): { text: string; bots: BotBlock[] } {
  if (!content.includes("```bot")) return { text: content, bots: [] };
  const bots: BotBlock[] = [];
  const text = content
    .replace(BLOCK, (_, body: string) => {
      const bot = parse(body);
      if (bot && bots.length < MAX_BOTS) bots.push(bot);
      return "";
    })
    .replace(OPEN_BLOCK, "");
  return { text, bots };
}
