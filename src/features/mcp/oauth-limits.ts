/**
 * Remote MCP servers whose sign-in only works for apps the vendor approved.
 * Their OAuth registration succeeds, but the login page then rejects the
 * app ("OAuth app with client id … doesn't exist"), so the app says so up
 * front and offers the vendor's own alternative instead.
 */
export type OAuthLimit = {
  /** Host of the remote MCP URL. */
  host: string;
  service: string;
  reason: string;
  docsUrl?: string;
  /** A way to connect that doesn't need the vendor's approval. */
  alternative?: { label: string; url: string; setup: string };
};

export const OAUTH_LIMITS: OAuthLimit[] = [
  {
    host: "mcp.figma.com",
    service: "Figma",
    reason:
      "Figma only lets apps listed in its MCP Catalog (VS Code, Cursor, Claude Code…) sign in to its remote server, so sign-in from Mali Cowork is refused.",
    docsUrl: "https://developers.figma.com/docs/figma-mcp-server/local-server-installation/",
    alternative: {
      label: "Figma desktop app (local)",
      url: "http://127.0.0.1:3845/mcp",
      setup:
        "In the Figma desktop app, open a Design file, switch to Dev Mode (Shift+D) and click “Enable desktop MCP server” in the inspect panel. Keep Figma open while you use it.",
    },
  },
];

export function oauthLimitFor(url: string | undefined): OAuthLimit | undefined {
  if (!url) return undefined;
  try {
    const host = new URL(url).host.toLowerCase();
    return OAUTH_LIMITS.find((l) => host === l.host);
  } catch {
    return undefined;
  }
}
