import { open, save } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import type { BotExportBundle, CustomBot } from "./types";

export function exportBot(bot: CustomBot): BotExportBundle {
  const { id: _id, createdAt: _c, ...rest } = bot;
  return {
    version: 1,
    exportedAt: Date.now(),
    bot: rest,
  };
}

/** `mali-bot-<name>.json`, keeping Thai and other letters in the name. */
export function botExportFileName(bot: Pick<CustomBot, "name">) {
  const slug = bot.name.trim().replace(/[^\p{L}\p{M}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "").toLowerCase();
  return `mali-bot-${slug || "export"}.json`;
}

/**
 * Save the bot — look, role, style, level and knowledge — as one file, where
 * the user picks. Returns the path, or null if they cancelled.
 */
export async function saveBotExport(bot: CustomBot): Promise<string | null> {
  const path = await save({
    title: "Save bot file",
    defaultPath: botExportFileName(bot),
    filters: [{ name: "Mali bot (JSON)", extensions: ["json"] }],
  });
  if (!path) return null;
  await writeTextFile(path, JSON.stringify(exportBot(bot), null, 2) + "\n");
  return path;
}

/** Pick a saved bot file and read it; null if the user cancelled. */
export async function pickBotImport(): Promise<ReturnType<typeof parseBotImport> | null> {
  const path = await open({
    multiple: false,
    title: "Import bot file",
    filters: [{ name: "Mali bot (JSON)", extensions: ["json"] }],
  });
  if (typeof path !== "string") return null;
  return parseBotImport(await readTextFile(path));
}

export function parseBotImport(text: string): BotExportBundle["bot"] | { error: string } {
  try {
    const data = JSON.parse(text) as BotExportBundle;
    if (data.version !== 1 || !data.bot || typeof data.bot.name !== "string") {
      return { error: "This file doesn't look like a Mali bot export." };
    }
    return data.bot;
  } catch {
    return { error: "Couldn't read that JSON file." };
  }
}
