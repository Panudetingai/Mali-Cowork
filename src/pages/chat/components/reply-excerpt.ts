/** How a highlighted excerpt is merged into the message the model sees. */
export function mergeReplyExcerpt(userText: string, excerpt: string) {
  const body = userText.trim();
  const quote = excerpt
    .trim()
    .split(/\r?\n/)
    .map((line) => `> ${line}`)
    .join("\n");
  return body ? `${body}\n\n${quote}` : quote;
}

/** One line for the reply bar above the composer. */
export function excerptPreview(excerpt: string, max = 120) {
  const flat = excerpt.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  return `${flat.slice(0, max - 1)}…`;
}
