import type { BotExportBundle, CustomBot } from "./types";

export function exportBot(bot: CustomBot): BotExportBundle {
  const { id: _id, createdAt: _c, ...rest } = bot;
  return {
    version: 1,
    exportedAt: Date.now(),
    bot: rest,
  };
}

export function downloadBotExport(bot: CustomBot) {
  const bundle = exportBot(bot);
  const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `mali-bot-${bot.name.replace(/\W+/g, "-").toLowerCase() || "export"}.json`;
  a.click();
  URL.revokeObjectURL(url);
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
