// MCP server catalog shown in Settings → MCP.
// `command` is the default launch command (argv, quotes allowed).
// `variants` lists alternative launch methods for the same server —
// the backend tries them in order until one connects.

export type McpEnvVar = {
  /** Environment variable name passed to the MCP process. */
  var: string;
  label: string;
  /** When false the user may leave it empty. */
  required?: boolean;
  /** Shown as a password field. */
  secret?: boolean;
  placeholder?: string;
};

export type McpVariant = {
  id: string;
  label: string;
  command: string;
};

export type McpCategory = "Documents" | "Execute" | "Dev" | "Web" | "Data" | "Memory" | "Custom";

export type McpDef = {
  id: string;
  name: string;
  description: string;
  /** Legacy icon key; cards use LobeHub brand icons via catalog id. */
  icon: string;
  /** Tailwind classes for the icon tile. */
  tile: string;
  command: string;
  variants?: McpVariant[];
  category: McpCategory;
  envVars?: McpEnvVar[];
  /** Startup timeout in ms. Defaults to 60s; slow starters (uvx cold download) need more. */
  timeoutMs?: number;
  /** One-line setup note shown in the details dialog. */
  setup?: string;
  /** MCP Registry id, shown in the connection dialog. */
  registryName?: string;
  /** Package version label in the connection dialog. */
  packageVersion?: string;
  repositoryUrl?: string;
  /** Shown under the run command (e.g. Docker download). */
  runWarning?: string;
};

export const MCP_SERVERS: McpDef[] = [
  {
    id: "word",
    name: "Word",
    description: "Create and edit .docx files: text, tables, styles, comments.",
    icon: "word",
    tile: "bg-blue-600 text-white",
    command: "uvx --from office-word-mcp-server==1.1.11 word_mcp_server",
    variants: [
      { id: "uvx", label: "uvx (recommended)", command: "uvx --from office-word-mcp-server==1.1.11 word_mcp_server" },
      {
        id: "github",
        label: "uvx from GitHub (pinned, needs git)",
        command: "uvx --from git+https://github.com/GongRzhe/Office-Word-MCP-Server@a3bbbb6d6167e68cf855d73ef7dc6cd8cfbfedba word_mcp_server",
      },
      { id: "pip", label: "pip install office-word-mcp-server", command: "word_mcp_server" },
      { id: "python", label: "python -m", command: "python3 -m word_document_server.main" },
    ],
    category: "Documents",
    timeoutMs: 180_000,
    setup:
      "Office-Word-MCP-Server. Works without Microsoft Word; needs uv (uvx) or Python 3.11+.",
  },
  {
    id: "exec",
    name: "Exec",
    description: "Let the agent run shell commands on this device.",
    icon: "exec",
    tile: "bg-zinc-900 text-white dark:bg-zinc-700",
    command: "npx -y @mkusaka/mcp-shell-server@0.1.1",
    variants: [
      { id: "npx", label: "npx", command: "npx -y @mkusaka/mcp-shell-server@0.1.1" },
      { id: "bunx", label: "bunx", command: "bunx @mkusaka/mcp-shell-server@0.1.1" },
    ],
    category: "Execute",
  },
  {
    id: "filesystem",
    name: "Filesystem",
    description: "Read and write files in the working folder.",
    icon: "filesystem",
    tile: "bg-amber-500 text-white",
    command: "npx -y @modelcontextprotocol/server-filesystem@2026.8.31",
    variants: [
      { id: "npx", label: "npx", command: "npx -y @modelcontextprotocol/server-filesystem@2026.8.31" },
      { id: "bunx", label: "bunx", command: "bunx @modelcontextprotocol/server-filesystem@2026.8.31" },
    ],
    category: "Dev",
  },
  {
    id: "github",
    name: "GitHub",
    description:
      "Connect AI assistants to GitHub — manage repos, issues, PRs, and workflows via API.",
    icon: "github",
    tile: "bg-neutral-900 text-white dark:bg-neutral-700",
    command: "npx -y @modelcontextprotocol/server-github@2025.4.8",
    variants: [
      {
        id: "npx",
        label: "npx — @modelcontextprotocol/server-github",
        command: "npx -y @modelcontextprotocol/server-github@2025.4.8",
      },
      {
        id: "docker",
        label: "Docker — ghcr.io/github/github-mcp-server",
        command:
          "docker run -i --rm -e GITHUB_PERSONAL_ACCESS_TOKEN ghcr.io/github/github-mcp-server",
      },
    ],
    category: "Dev",
    registryName: "io.github.github/github-mcp-server",
    packageVersion: "2025.4.8",
    repositoryUrl: "https://github.com/github/github-mcp-server",
    runWarning:
      "Docker pulls a container image and runs it with your account permissions. Install Docker Desktop first if needed.",
    envVars: [
      {
        var: "GITHUB_PERSONAL_ACCESS_TOKEN",
        label: "GitHub personal access token",
        required: false,
        secret: true,
        placeholder: "ghp_…",
      },
    ],
  },
  {
    id: "fetch",
    name: "Fetch",
    description: "Open web pages and read their content.",
    icon: "fetch",
    tile: "bg-sky-500 text-white",
    command: "npx -y @modelcontextprotocol/server-puppeteer@2025.5.12",
    category: "Web",
  },
  {
    id: "playwright",
    name: "Playwright",
    description: "Automate a browser, test sites, take screenshots.",
    icon: "playwright",
    tile: "bg-emerald-600 text-white",
    command: "npx -y @playwright/mcp@0.0.82",
    category: "Web",
    timeoutMs: 90_000,
  },
  {
    id: "sqlite",
    name: "SQLite",
    description: "Query local .db files.",
    icon: "sqlite",
    tile: "bg-cyan-700 text-white",
    command: "npx -y mcp-sqlite@1.0.9",
    category: "Data",
  },
  {
    id: "postgres",
    name: "Postgres",
    description: "Query a Postgres database.",
    icon: "postgres",
    tile: "bg-indigo-600 text-white",
    command: "npx -y @modelcontextprotocol/server-postgres@0.6.2",
    category: "Data",
    envVars: [
      {
        var: "POSTGRES_CONNECTION_STRING",
        label: "Connection URL",
        required: true,
        secret: true,
        placeholder: "postgresql://user:pass@host:5432/db",
      },
    ],
  },
  {
    id: "memory",
    name: "Memory",
    description: "Long-term memory across sessions.",
    icon: "memory",
    tile: "bg-violet-600 text-white",
    command: "npx -y @modelcontextprotocol/server-memory@2026.8.31",
    category: "Memory",
  },
  {
    id: "sequential-thinking",
    name: "Sequential Thinking",
    description: "Step-by-step thinking for complex tasks.",
    icon: "thinking",
    tile: "bg-fuchsia-600 text-white",
    command: "npx -y @modelcontextprotocol/server-sequential-thinking@2026.8.31",
    category: "Memory",
  },
  {
    id: "brave-search",
    name: "Brave Search",
    description: "Live web search.",
    icon: "search",
    tile: "bg-orange-500 text-white",
    command: "npx -y @modelcontextprotocol/server-brave-search@0.6.2",
    category: "Web",
    envVars: [{ var: "BRAVE_API_KEY", label: "Brave Search API key", required: true, secret: true }],
  },
  {
    id: "slack",
    name: "Slack",
    description: "Read and post in Slack channels.",
    icon: "slack",
    tile: "bg-[#4A154B] text-white",
    command: "npx -y @modelcontextprotocol/server-slack@2025.4.25",
    category: "Dev",
    envVars: [
      { var: "SLACK_BOT_TOKEN", label: "Bot token", required: true, secret: true, placeholder: "xoxb-…" },
      { var: "SLACK_TEAM_ID", label: "Workspace ID", required: true, placeholder: "T01234567" },
    ],
  },
];

export const MCP_CATEGORIES = [
  "All",
  "Documents",
  "Execute",
  "Dev",
  "Web",
  "Data",
  "Memory",
  "Custom",
] as const;

export type McpCategoryFilter = (typeof MCP_CATEGORIES)[number];

export function catalogServer(id: string) {
  return MCP_SERVERS.find((s) => s.id === id);
}
