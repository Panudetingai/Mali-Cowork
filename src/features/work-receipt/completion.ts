/**
 * The one line under a finished Cowork turn (PRD v0.3 Q3): what the agent did,
 * how long it took and what it cost — "แก้ 6 ไฟล์ · 3 นาที · $0.04".
 */
import type { WorkReceipt } from "./types";

type Lang = "th" | "en";

function duration(ms: number, lang: Lang) {
  const s = Math.round(ms / 1000);
  if (s < 60) return lang === "th" ? `${s} วิ` : `${s}s`;
  const m = Math.floor(s / 60);
  const rest = s % 60;
  if (lang === "th") return rest ? `${m} นาที ${rest} วิ` : `${m} นาที`;
  return rest ? `${m}m ${rest}s` : `${m}m`;
}

/** The parts of the summary, most telling first; empty when the turn did nothing to show. */
export function completionParts(receipt: WorkReceipt, lang: Lang): string[] {
  const { files } = receipt;
  const th = lang === "th";
  const parts: string[] = [];
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
  if (files.added) parts.push(th ? `สร้าง ${files.added} ไฟล์` : `Created ${plural(files.added, "file")}`);
  if (files.modified) parts.push(th ? `แก้ ${files.modified} ไฟล์` : `Edited ${plural(files.modified, "file")}`);
  if (files.deleted) parts.push(th ? `ลบ ${files.deleted} ไฟล์` : `Deleted ${plural(files.deleted, "file")}`);
  if (receipt.commands.length) {
    parts.push(th ? `รัน ${receipt.commands.length} คำสั่ง` : `Ran ${plural(receipt.commands.length, "command")}`);
  }
  const calls = receipt.connectors.reduce((n, c) => n + c.calls, 0);
  if (calls) {
    const names = receipt.connectors.slice(0, 2).map((c) => c.name).join(", ");
    parts.push(th ? `ใช้ ${names}` : `Used ${names}`);
  }
  if (parts.length === 0) return [];
  if (receipt.durationMs) parts.push(duration(receipt.durationMs, lang));
  if (receipt.usage?.cost) parts.push(`$${receipt.usage.cost < 0.01 ? receipt.usage.cost.toFixed(4) : receipt.usage.cost.toFixed(2)}`);
  return parts;
}
