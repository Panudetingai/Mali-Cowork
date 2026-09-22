import type { ToolId } from "./api";

export type AgentChoice = {
  id: Extract<ToolId, "opencode" | "codex" | "antigravity" | "cursor">;
  name: string;
  tagline: string;
  /** What the user needs to use it. */
  account: string;
  recommended?: boolean;
};

export const AGENTS: AgentChoice[] = [
  {
    id: "opencode",
    name: "OpenCode",
    tagline: "The main Cowork agent: MCP tools, asks before changing files.",
    account: "Free models included — no account needed",
    recommended: true,
  },
  {
    id: "codex",
    name: "Codex",
    tagline: "OpenAI's coding agent, sandboxed to your folder.",
    account: "Sign in with ChatGPT (Plus, Pro, Team)",
  },
  {
    id: "antigravity",
    name: "Antigravity CLI",
    tagline: "Google's terminal agent (agy), the successor to Gemini CLI.",
    account: "Sign in with a Google account (run `agy` once)",
  },
  {
    id: "cursor",
    name: "Cursor Agent",
    tagline: "The agent behind Cursor, from your terminal.",
    account: "Cursor subscription",
  },
];

export type McpChoice = {
  id: string;
  /** Why a new user would want it. */
  pitch: string;
  /** `uv` for Python servers, `node` for npx ones. */
  needs: "uv" | "node";
  recommended?: boolean;
};

/** A short, safe starter set from the MCP catalog. */
export const RECOMMENDED_MCP: McpChoice[] = [
  { id: "word", pitch: "Create and edit Word documents", needs: "uv", recommended: true },
  { id: "fetch", pitch: "Read web pages for research", needs: "node", recommended: true },
  { id: "memory", pitch: "Remember facts across chats", needs: "node", recommended: true },
  { id: "sequential-thinking", pitch: "Plan big tasks step by step", needs: "node" },
  { id: "playwright", pitch: "Drive a browser: click, fill, screenshot", needs: "node" },
  { id: "filesystem", pitch: "Read and write files in your folder", needs: "node" },
];
