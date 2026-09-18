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
};

export const MCP_SERVERS: McpDef[] = [
  {
    id: "word",
    name: "Word",
    description: "สร้างและแก้ไขไฟล์ .docx — ข้อความ ตาราง รูปแบบ คอมเมนต์ (Office-Word-MCP-Server)",
    icon: "word",
    tile: "bg-blue-600 text-white",
    command: "uvx --from office-word-mcp-server word_mcp_server",
    variants: [
      { id: "uvx", label: "uvx (แนะนำ)", command: "uvx --from office-word-mcp-server word_mcp_server" },
      {
        id: "github",
        label: "uvx จาก GitHub (โค้ดล่าสุด ต้องมี git)",
        command: "uvx --from git+https://github.com/GongRzhe/Office-Word-MCP-Server word_mcp_server",
      },
      { id: "pip", label: "pip install office-word-mcp-server", command: "word_mcp_server" },
      { id: "python", label: "python -m", command: "python3 -m word_document_server.main" },
    ],
    category: "Documents",
    timeoutMs: 180_000,
    setup:
      "ใช้ github.com/GongRzhe/Office-Word-MCP-Server (54 tools: เอกสาร ตาราง รูปแบบ คอมเมนต์ footnote) — ทำงานได้ทั้ง Windows, macOS, Linux ไม่ต้องมี Microsoft Word ต้องมี uv (uvx) หรือ Python 3.11+",
  },
  {
    id: "exec",
    name: "Exec",
    description: "รันคำสั่ง shell / สคริปต์บนเครื่องนี้ผ่าน agent",
    icon: "exec",
    tile: "bg-zinc-900 text-white dark:bg-zinc-700",
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
    description: "ให้ agent อ่าน–เขียนไฟล์ในโฟลเดอร์งาน (ใส่ path โฟลเดอร์ให้อัตโนมัติ)",
    icon: "filesystem",
    tile: "bg-amber-500 text-white",
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
    tile: "bg-neutral-900 text-white dark:bg-neutral-700",
    command: "npx -y @modelcontextprotocol/server-github",
    category: "Dev",
    envVars: [
      {
        var: "GITHUB_PERSONAL_ACCESS_TOKEN",
        label: "Personal access token",
        required: true,
        secret: true,
        placeholder: "ghp_…",
      },
    ],
  },
  {
    id: "fetch",
    name: "Fetch",
    description: "เปิดเว็บและดึงเนื้อหาหน้าเว็บให้ agent (Puppeteer)",
    icon: "fetch",
    tile: "bg-sky-500 text-white",
    command: "npx -y @modelcontextprotocol/server-puppeteer",
    category: "Web",
  },
  {
    id: "playwright",
    name: "Playwright",
    description: "สั่งเบราว์เซอร์อัตโนมัติ ทดสอบเว็บ ถ่ายสกรีนช็อต",
    icon: "playwright",
    tile: "bg-emerald-600 text-white",
    command: "npx -y @playwright/mcp",
    category: "Web",
    timeoutMs: 90_000,
  },
  {
    id: "sqlite",
    name: "SQLite",
    description: "คิวรีไฟล์ .db ในเครื่องด้วยภาษาธรรมชาติ",
    icon: "sqlite",
    tile: "bg-cyan-700 text-white",
    command: "npx -y mcp-sqlite",
    category: "Data",
  },
  {
    id: "postgres",
    name: "Postgres",
    description: "เชื่อมฐานข้อมูล Postgres คิวรีตารางโดยตรง",
    icon: "postgres",
    tile: "bg-indigo-600 text-white",
    command: "npx -y @modelcontextprotocol/server-postgres",
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
    description: "หน่วยความจำระยะยาว จำบริบทข้ามเซสชัน",
    icon: "memory",
    tile: "bg-violet-600 text-white",
    command: "npx -y @modelcontextprotocol/server-memory",
    category: "Memory",
  },
  {
    id: "sequential-thinking",
    name: "Sequential Thinking",
    description: "ให้ agent คิดเป็นขั้นเป็นตอน งานซับซ้อนแม่นขึ้น",
    icon: "thinking",
    tile: "bg-fuchsia-600 text-white",
    command: "npx -y @modelcontextprotocol/server-sequential-thinking",
    category: "Memory",
  },
  {
    id: "brave-search",
    name: "Brave Search",
    description: "ค้นเว็บเรียลไทม์พร้อมคำตอบสรุป",
    icon: "search",
    tile: "bg-orange-500 text-white",
    command: "npx -y @modelcontextprotocol/server-brave-search",
    category: "Web",
    envVars: [{ var: "BRAVE_API_KEY", label: "Brave Search API key", required: true, secret: true }],
  },
  {
    id: "slack",
    name: "Slack",
    description: "อ่าน–ส่งข้อความใน Slack channel ที่เชื่อมไว้",
    icon: "slack",
    tile: "bg-[#4A154B] text-white",
    command: "npx -y @modelcontextprotocol/server-slack",
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
