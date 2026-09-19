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

const INTENT = /\b(mcp|connectors?|connect|install|integrat\w*|plugin|tool server)\b|เชื่อม|ติดตั้ง|ต่อกับ|คอนเนค/i;

const INSTRUCTIONS = `# Connectors (MCP)
This app can connect tools ("connectors", i.e. MCP servers). When the user asks to install, add or connect one (for example "connect Notion" or "install a GitHub MCP"), do not edit config files or run install commands yourself. Reply briefly and add one block per connector:

\`\`\`connector
{"query": "notion"}
\`\`\`

Use "name" instead of "query" when you know the exact MCP Registry name (e.g. "com.notion/mcp"); if you can browse, look it up at https://registry.modelcontextprotocol.io/v0.1/servers?search=<term>&version=latest. Use {"url": "https://…", "title": "…"} only for an official https MCP endpoint the vendor documents that is not in the registry. The app shows an install card: the user checks it, enters any keys in the app (kept in the system keychain) and signs in with OAuth in the browser. Never ask the user to paste API keys, tokens or passwords into the chat.`;

/** Extra instructions for a prompt that sounds like it wants a connector. */
export function connectorInstructionsFor(prompt: string) {
  return INTENT.test(prompt) ? INSTRUCTIONS : "";
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
