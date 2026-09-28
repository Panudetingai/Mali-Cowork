/**
 * Installing connectors from chat. The AI never installs anything itself:
 * it adds a ```connector block to its reply, the app turns that into an
 * install card, and the user reviews and confirms it in the app — where
 * keys go to the keychain and sign-in happens in the browser.
 */

export type ConnectorSuggestion = {
  /** Words to search the MCP Registry for. */
  query?: string;
  /** An exact MCP Registry name, e.g. `com.notion/mcp`. */
  name?: string;
  /** An official remote MCP endpoint that isn't in the registry. */
  url?: string;
  /** Display name for a `url` suggestion. */
  title?: string;
};

const BASE = `# Connectors (MCP)
This app can add tools ("connectors", MCP servers). Connected ones show up as tools named \`serverId_*\` (or \`mali_serverId_*\` in some agents).

When a connected connector already covers the task, call its tools — do not guess, write a stand-in script, or say you cannot do what its tools do.

When the task needs an external app or API (Notion, GitHub, Google Calendar, Slack, databases, etc.) and no connected connector covers it — or you are unsure how to finish the user's request with what you have — do not pretend the work is done. In the user's language, say briefly what is missing, then help them add a connector safely (see below). If you can browse, search the official MCP Registry first: https://registry.modelcontextprotocol.io/v0.1/servers?search=<term>&version=latest. Prefer well-known publishers and entries that match the service; do not suggest random or unverified servers.

Safety (always): never edit MCP config files or run install commands (\`npx\`, \`uvx\`, \`docker\`, etc.) yourself; never ask the user to paste API keys, tokens, or passwords into the chat. Keys are entered only in the app (system keychain) and OAuth sign-in happens in the browser. The user must confirm every install on a card the app shows.`;

const SUGGEST_BLOCK = `To suggest a connector, add one block per connector at the end of your reply (the app hides the block and shows an install card):

\`\`\`connector
{"query": "notion"}
\`\`\`

Use \`"name"\` instead of \`"query"\` when you know the exact MCP Registry name (e.g. \`"com.notion/mcp"\`). Use \`{"url": "https://…", "title": "…"}\` only for an official https MCP endpoint the vendor documents that is not in the registry.`;

const GALLERY_BLOCK = `# Showing what you made in another app
When you create or change something with pages or slides in another app (a Canva design or presentation, Notion pages, Figma frames, a Google Slides deck), show it in the chat: ask the connector for the page thumbnails (for Canva, get the design's pages; for others, the thumbnail or cover of each page), then add one block at the end of your reply. The app hides the block and shows a strip of previews that keeps each page's shape (portrait or landscape):

\`\`\`gallery
{"source": "canva", "connector": "custom-canva", "title": "Campaign Review", "url": "https://www.canva.com/design/…/edit", "items": [{"image": "https://…/page-1.png", "width": 1920, "height": 1080, "title": "Cover"}]}
\`\`\`

- \`source\`: the app, lowercase (\`canva\`, \`notion\`, \`figma\`, \`google-slides\`, …). \`connector\`: the id of the connector whose tools you used (the part of the tool name before \`_\`, e.g. \`custom-canva\`), so the app shows its icon. \`url\`: the link that opens it in that app.
- \`items\`: one per page, in order; \`image\` is the https thumbnail exactly as the tool returned it, with \`width\` and \`height\` when the tool gives them. Never invent an image URL; if no thumbnail is available, leave the block out and just give the link.`;

/** System instructions so the model knows when and how to suggest MCP connectors. */
export function connectorInstructionsFor(_prompt?: string) {
  return `${BASE}\n\n${SUGGEST_BLOCK}\n\n${GALLERY_BLOCK}`;
}

const BLOCK = /```connector[^\S\n]*\n([\s\S]*?)```/g;
/** A block still being written (no closing fence yet). */
const OPEN_BLOCK = /```connector[^\S\n]*(\n[\s\S]*)?$/;
const MAX_SUGGESTIONS = 5;

function parse(json: string): ConnectorSuggestion | null {
  try {
    const value = JSON.parse(json.trim());
    if (!value || typeof value !== "object") return null;
    const text = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined);
    const suggestion: ConnectorSuggestion = {
      query: text(value.query, 100),
      name: text(value.name, 200),
      url: text(value.url, 500),
      title: text(value.title, 80),
    };
    if (suggestion.url && !suggestion.url.startsWith("https://")) suggestion.url = undefined;
    return suggestion.query || suggestion.name || suggestion.url ? suggestion : null;
  } catch {
    return null;
  }
}

/** The reply without its ```connector blocks, and what they suggest. */
export function extractConnectorBlocks(content: string): { text: string; suggestions: ConnectorSuggestion[] } {
  if (!content.includes("```connector")) return { text: content, suggestions: [] };
  const suggestions: ConnectorSuggestion[] = [];
  const text = content
    .replace(BLOCK, (_, body: string) => {
      const suggestion = parse(body);
      if (suggestion && suggestions.length < MAX_SUGGESTIONS) suggestions.push(suggestion);
      return "";
    })
    .replace(OPEN_BLOCK, "");
  return { text, suggestions };
}
