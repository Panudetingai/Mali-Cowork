/**
 * Document templates (see `src-tauri/src/templates`): the built-in Thai ones
 * and the user's own `.docx` files with `{{fields}}`. Each of the user's own
 * gets a `/` skill, so it's one command away in the chat box.
 */
import { invoke } from "@tauri-apps/api/core";
import { deleteSkill, getInstructions, NEEDS_COWORK, saveSkill, toggleSkill } from "@/features/instructions";

export type TemplateInfo = {
  id: string;
  name: string;
  description: string;
  /** `{{fields}}` in order; `?name` is optional, `item.name` is a table row field. */
  fields: string[];
  /** Computes amounts, VAT and the total in words. */
  money: boolean;
  builtin: boolean;
  enabled: boolean;
};

export type UserTemplate = Omit<TemplateInfo, "money" | "builtin"> & { addedAt: number };

export type Inspection = { fields: string[]; preview: string; suggestedName: string };

export const listTemplates = () => invoke<TemplateInfo[]>("templates_list");
export const inspectTemplate = (path: string) => invoke<Inspection>("templates_inspect", { path });
export const exportTemplate = (id: string, path: string) => invoke("templates_export", { id, path });
export const openTemplate = (id: string) => invoke("templates_open", { id });
export const refreshTemplate = (id: string) => invoke<UserTemplate>("templates_refresh", { id });

/** Where a template's skill came from, so it follows the template. */
const skillSource = (id: string) => `template:${id}`;

function skillFor(template: Pick<UserTemplate, "id" | "name" | "description" | "fields">) {
  const money = template.fields.some((f) => f.replace(/^\?/, "") === "total");
  return {
    name: template.name,
    description: template.description || `ผู้ใช้ขอทำเอกสารตามแบบ “${template.name}”`,
    instructions: [
      `# เอกสารตามแบบ “${template.name}”`,
      `- ใช้ fill_template กับ template "${template.id}" (แบบของผู้ใช้เอง) เพื่อสร้างไฟล์ .docx ในโฟลเดอร์งาน — ห้ามเขียนเอกสารเองทั้งฉบับ และห้ามเปลี่ยนรูปแบบ`,
      `- ช่องในแบบนี้: ${template.fields.join(", ")}${template.fields.some((f) => f.startsWith("?")) ? " (ช่องที่มี ? ไม่บังคับ)" : ""}`,
      template.fields.some((f) => f.includes("item.")) ? "- รายการในตารางส่งเป็น items (หนึ่ง object ต่อหนึ่งแถว ชื่อ key ตามช่อง item.xxx)" : "",
      money ? "- ส่ง qty และ unit_price ในแต่ละรายการ — ยอดรวม ภาษี และจำนวนเงินเป็นตัวอักษรคำนวณให้เอง อย่าคำนวณเอง" : "",
      "- เก็บข้อมูลจากที่ผู้ใช้บอกและไฟล์ในโฟลเดอร์ก่อน ข้อมูลที่จำเป็นแต่ยังไม่มีให้ถามด้วย ask_user ครั้งเดียวรวมทุกข้อ ห้ามแต่งขึ้นเอง",
      "- สร้างเสร็จแล้วบอกว่าไฟล์อยู่ไหน และช่องไหนยังว่าง",
      `- ${NEEDS_COWORK}`,
    ]
      .filter(Boolean)
      .join("\n"),
    source: skillSource(template.id),
  };
}

function skillOf(id: string) {
  return getInstructions().skills.find((s) => s.source === skillSource(id));
}

/** Keep a template's `/` skill in step with it. */
export function syncTemplateSkill(template: UserTemplate) {
  const existing = skillOf(template.id);
  saveSkill({ ...skillFor(template), id: existing?.id, enabled: template.enabled });
}

export async function addTemplate(path: string, name: string, description: string) {
  const template = await invoke<UserTemplate>("templates_add", { path, name, description });
  syncTemplateSkill(template);
  return template;
}

export async function updateTemplate(id: string, patch: { name?: string; description?: string; enabled?: boolean }) {
  const template = await invoke<UserTemplate>("templates_update", { id, ...patch });
  const existing = skillOf(id);
  if (existing && patch.enabled !== undefined && Object.keys(patch).length === 1) toggleSkill(existing.id, template.enabled);
  else syncTemplateSkill(template);
  return template;
}

/** After the file changed in Word: new fields, and the skill that lists them. */
export async function reloadTemplate(id: string) {
  const template = await refreshTemplate(id);
  syncTemplateSkill(template);
  return template;
}

export async function removeTemplate(id: string) {
  await invoke("templates_remove", { id });
  const existing = skillOf(id);
  if (existing) deleteSkill(existing.id);
}
