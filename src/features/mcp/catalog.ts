// MCP server catalog shown in Settings → MCP.
// `command` is the default launch command (space-separated argv).
// `variants` lists alternative launch methods for the same server —
// the backend tries them in order until one connects.

export type McpEnvVar = {
  /** Environment variable name passed to the MCP process. */
  var: string;
  label: string;
  /** When false the user may leave it empty. */
  required?: boolean;
};

export type McpVariant = {
  id: string;
  label: string;
  command: string;
};

export type McpDef = {
  id: string;
  name: string;
  description: string;
  /** lucide icon key, resolved in mcp-settings.tsx */
  icon: string;
  command: string;
  variants?: McpVariant[];
  category: "Documents" | "Execute" | "Dev" | "Web" | "Data" | "Memory";
  needsKey?: boolean;
  envVars?: McpEnvVar[];
  /** Startup timeout in ms. Defaults to 60s; slow starters (uvx cold download) need more. */
  timeoutMs?: number;
};

export const MCP_SERVERS: McpDef[] = [
  {
    id: "word",
    name: "Word",
    description: "สั่ง Microsoft Word ไฟล์ .docx เปิดอยู่ — แก้ไข live, tracked changes, undo (Windows ต้องมี Word)",
    icon: "word",
    command: "uvx word-mcp-live",
    variants: [
      { id: "uvx", label: "uvx (แนะนำ)", command: "uvx word-mcp-live" },
      { id: "uv-from", label: "uvx --from", command: "uvx --from word-mcp-live word-mcp-live" },
      { id: "pip", label: "pip (word-mcp-live)", command: "word-mcp-live" },
      { id: "python", label: "python -m", command: "python -m word_mcp_live" },
      { id: "docker", label: "Docker", command: "docker run -i --rm ghcr.io/ykarapazar/word-mcp-live" },
    ],
    category: "Documents",
    timeoutMs: 180_000,
    envVars: [
      { var: "MCP_AUTHOR", label: "Author name (ใส่ใน tracked changes)", required: false },
      { var: "MCP_AUTHOR_INITIALS", label: "Author initials", required: false },
    ],
  },
  {
    id: "exec",
    name: "Exec",
    description: "รันคำสั่ง shell / สคริปต์บนเครื่องนี้ผ่าน agent",
    icon: "exec",
    command: "npx -y @mkusaka/mcp-shell-server",
    variants: [
      { id: "npx", label: "npx", command: "npx -y @mkusaka/mcp-shell-server" },
      { id: "bunx", label: "bunx", command: "bunx @mkusaka/mcp-shell-server" },
    ],
    category: "Execute",
  },
  {
    id: "filesystem",
    name: "Filesystem",
    description: "ให้ agent อ่าน–เขียนไฟล์ในโฟลเดอร์ที่อนุญาต (ต่อท้าย path โฟลเดอร์งานอัตโนมัติ)",
    icon: "filesystem",
    command: "npx -y @modelcontextprotocol/server-filesystem",
    variants: [
      { id: "npx", label: "npx", command: "npx -y @modelcontextprotocol/server-filesystem" },
      { id: "bunx", label: "bunx", command: "bunx @modelcontextprotocol/server-filesystem" },
    ],
    category: "Dev",
  },
  {
    id: "github",
    name: "GitHub",
    description: "ค้นหา repo, เปิด issue/PR, อ่านโค้ดผ่าน GitHub API",
    icon: "github",
    command: "npx -y @modelcontextprotocol/server-github",
    category: "Dev",
    needsKey: true,
    envVars: [{ var: "GITHUB_PERSONAL_ACCESS_TOKEN", label: "GitHub personal access token", required: true }],
  },
  {
    id: "fetch",
    name: "Fetch",
    description: "เปิดเว็บและดึงเนื้อหาหน้าเว็บให้ agent (Puppeteer MCP)",
    icon: "fetch",
    command: "npx -y @modelcontextprotocol/server-puppeteer",
    category: "Web",
  },
  {
    id: "playwright",
    name: "Playwright",
    description: "สั่งเบราว์เซอร์อัตโนมัติ ทดสอบเว็บ ถ่ายสกรีนช็อต",
    icon: "playwright",
    command: "npx -y @playwright/mcp",
    category: "Web",
    timeoutMs: 90_000,
  },
  {
    id: "sqlite",
    name: "SQLite",
    description: "คิวรีไฟล์ .db ในเครื่องด้วยภาษา SQL ธรรมชาติ",
    icon: "sqlite",
    command: "npx -y mcp-sqlite",
    category: "Data",
  },
  {
    id: "postgres",
    name: "Postgres",
    description: "เชื่อมฐานข้อมูล Postgres คิวรีตารางโดยตรง",
    icon: "postgres",
    command: "npx -y @modelcontextprotocol/server-postgres",
    category: "Data",
    needsKey: true,
    envVars: [{ var: "POSTGRES_CONNECTION_STRING", label: "Postgres connection URL", required: true }],
  },
  {
    id: "memory",
    name: "Memory",
    description: "หน่วยความจำระยะยาว จำบริบทข้ามเซสชัน",
    icon: "memory",
    command: "npx -y @modelcontextprotocol/server-memory",
    category: "Memory",
  },
  {
    id: "sequential-thinking",
    name: "Sequential Thinking",
    description: "ให้ agent คิดเป็นขั้นเป็นตอน งานซับซ้อนแม่นขึ้น",
    icon: "thinking",
    command: "npx -y @modelcontextprotocol/server-sequential-thinking",
    category: "Memory",
  },
  {
    id: "brave-search",
    name: "Brave Search",
    description: "ค้นเว็บเรียลไทม์พร้อมคำตอบสรุป",
    icon: "search",
    command: "npx -y @modelcontextprotocol/server-brave-search",
    category: "Web",
    needsKey: true,
    envVars: [{ var: "BRAVE_API_KEY", label: "Brave Search API key", required: true }],
  },
  {
    id: "slack",
    name: "Slack",
    description: "อ่าน–ส่งข้อความ Slack channel ที่เชื่อมไว้",
    icon: "slack",
    command: "npx -y @modelcontextprotocol/server-slack",
    category: "Dev",
    needsKey: true,
    envVars: [
      { var: "SLACK_BOT_TOKEN", label: "Slack bot token (xoxb-…)", required: true },
      { var: "SLACK_TEAM_ID", label: "Slack workspace ID", required: true },
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
] as const;

export type McpCategory = (typeof MCP_CATEGORIES)[number];
