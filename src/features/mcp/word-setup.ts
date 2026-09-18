import type { McpDiagnoseResult } from "./api";

/** Command that installs uv (and so `uvx`) on this platform. */
export function uvInstallCommand(platform: McpDiagnoseResult["platform"]) {
  return platform === "windows"
    ? 'powershell -c "irm https://astral.sh/uv/install.ps1 | iex"'
    : "curl -LsSf https://astral.sh/uv/install.sh | sh";
}

/** Split backend error strings into a short title + bullet steps for the UI. */
export function parseMcpErrorMessage(raw: string): { title: string; steps: string[] } {
  const parts = raw.split(/\s+—\s+/);
  const title = parts[0]?.trim() || raw;
  const rest = parts.slice(1).join(" — ");
  const steps = rest
    .split(/\s*·\s*/)
    .map((s) => s.replace(/^วิธีแก้:\s*/, "").trim())
    .filter(Boolean);
  return { title, steps };
}
