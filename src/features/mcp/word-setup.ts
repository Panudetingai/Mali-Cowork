export const UV_INSTALL_PS =
  'powershell -c "irm https://astral.sh/uv/install.ps1 | iex"';

export const WORD_SETUP_STEPS = [
  {
    id: "uv",
    title: "ติดตั้ง uv (ได้ uvx)",
    detail: `รันใน PowerShell แล้ว restart แอป:`,
    command: UV_INSTALL_PS,
  },
  {
    id: "word",
    title: "Microsoft Word (Desktop)",
    detail: "ต้องมี Word ติดตั้งบน Windows — MCP นี้แก้ไฟล์ .docx ผ่าน Word COM (live edit)",
  },
  {
    id: "first-run",
    title: "ครั้งแรก Connect อาจช้า",
    detail: "uvx จะดาวน์โหลด word-mcp-live (~1–2 นาที) — อย่ากดยกเลิกกลางคัน",
  },
] as const;

/** Split backend error strings into short title + bullet steps for the UI. */
export function parseMcpErrorMessage(raw: string): { title: string; steps: string[] } {
  const parts = raw.split(/\s*—\s*/);
  const title = parts[0]?.trim() || raw;
  const rest = parts.slice(1).join(" — ");
  const steps = rest
    .split(/\s*·\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (steps.length === 0 && rest.trim()) {
    steps.push(rest.trim());
  }
  return { title, steps };
}
