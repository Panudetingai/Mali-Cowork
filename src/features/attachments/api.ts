import { invoke } from "@tauri-apps/api/core";
import { readFile, readTextFile } from "@tauri-apps/plugin-fs";
import type { Attachment } from "./types";

/** Copy a file the user picked or dropped. */
export function importAttachment(path: string) {
  return invoke<Attachment>("attachment_import", { path });
}

/** Save a pasted picture or file. */
export async function saveAttachment(file: File) {
  const data = Array.from(new Uint8Array(await file.arrayBuffer()));
  const name = file.name || `pasted-${Date.now()}.${file.type.split("/")[1] || "png"}`;
  return invoke<Attachment>("attachment_save", { name, data });
}

export function readAttachmentBytes(attachment: Attachment) {
  return readFile(attachment.path);
}

const MAX_TEXT_CHARS = 60_000;

/**
 * Text attachments pasted into the prompt, so every model sees them, and a
 * note for other files the model can't read inline.
 */
export async function buildAttachmentAppendix(attachments: Attachment[], { filesInline }: { filesInline: boolean }) {
  const parts: string[] = [];
  for (const attachment of attachments) {
    if (attachment.kind === "text") {
      try {
        let content = await readTextFile(attachment.path);
        if (content.length > MAX_TEXT_CHARS) {
          content = `${content.slice(0, MAX_TEXT_CHARS)}\n… (truncated)`;
        }
        parts.push(`--- Attached: ${attachment.name} ---\n\`\`\`\n${content}\n\`\`\``);
      } catch {
        parts.push(`--- Attached: ${attachment.name} ---\n(could not be read)`);
      }
    } else if ((attachment.kind === "file" || attachment.kind === "video") && !filesInline) {
      const note =
        attachment.kind === "video"
          ? "Video attached (the model may not be able to watch it on this backend)."
          : `Saved at ${attachment.path}`;
      parts.push(`--- Attached: ${attachment.name} ---\n${note}`);
    }
  }
  return parts.length ? `\n\n${parts.join("\n\n")}` : "";
}

const units = ["B", "KB", "MB"];
export function formatSize(bytes: number) {
  let size = bytes;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit++;
  }
  return `${size < 10 && unit > 0 ? size.toFixed(1) : Math.round(size)} ${units[unit]}`;
}
