import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import type { ChatMessage } from "@/pages/chat/types";
import type { ChatSession } from "./store";

function formatDate(date: number) {
  return new Date(date).toLocaleString();
}

function messageToMarkdown(message: ChatMessage): string {
  const roleLabel =
    message.role === "user" ? "You" : message.role === "assistant" ? "Assistant" : "Error";
  const model = message.modelId ? ` (${message.modelId})` : "";
  const header = `## ${roleLabel}${model}`;
  let body = message.content || "(no content)";

  if (message.reasoning) {
    body += `\n\n<details>\n<summary>Thinking</summary>\n\n${message.reasoning}\n\n</details>`;
  }
  if (message.attachments && message.attachments.length > 0) {
    const names = message.attachments.map((a) => a.name).join(", ");
    body += `\n\n*[Attached: ${names}]*`;
  }
  if (message.todos && message.todos.length > 0) {
    const list = message.todos.map((t) => `- [${t.done || t.status === "completed" ? "x" : " "}] ${t.text}`).join("\n");
    body += `\n\n**Task plan**\n${list}`;
  }

  return `${header}\n\n${body}`;
}

export function chatToMarkdown(session: ChatSession): string {
  const title = session.title || "Chat export";
  const mode = session.mode ? `Mode: ${session.mode}` : "";
  const cwd = session.cwd ? `Working folder: ${session.cwd}` : "";
  const meta = [mode, cwd].filter(Boolean).join(" · ");

  let md = `# ${title}\n\n`;
  md += `- Exported: ${formatDate(Date.now())}\n`;
  if (meta) md += `- ${meta}\n`;
  md += `\n---\n\n`;

  for (const message of session.messages) {
    md += `${messageToMarkdown(message)}\n\n---\n\n`;
  }

  return md.trimEnd() + "\n";
}

export async function exportChat(session: ChatSession): Promise<boolean> {
  const suggestedName = `${session.title.replace(/[^\w\-]/g, "_").slice(0, 40) || "chat"}.md`;
  const path = await save({
    title: "Export chat as Markdown",
    defaultPath: suggestedName,
    filters: [{ name: "Markdown", extensions: ["md"] }],
  });
  if (!path) return false;

  await writeTextFile(path, chatToMarkdown(session));
  return true;
}
