/**
 * Thai work templates (PRD v0.3 E-FR3): skills that come with the app. The
 * documents themselves are real .docx layouts inside Mali (see
 * `src-tauri/src/templates`); these skills tell the agent to fill them with
 * the `fill_template` tool rather than write a document from scratch, so the
 * layout, the Thai font and the money figures always come out right.
 *
 * They're added to the user's skills once; after that they're the user's to
 * edit, switch off or delete like any other skill.
 */
import type { Skill } from "./store";

const SEEDED_KEY = "mali.thaiTemplates.seeded.v1";

/** The line older versions wrote into these skills, replaced by [`NEEDS_COWORK`]. */
export const OLD_NEEDS_COWORK =
  "ต้องใช้ในโหมด Cowork กับโมเดลใต้ “Your API keys” (มีเครื่องมือ fill_template) — ถ้าอยู่ในโหมด Chat หรือไม่มีเครื่องมือนี้ ให้บอกผู้ใช้สั้น ๆ ว่าต้องสลับไป Cowork";

/** Every model has the document tools in Cowork: on Mali's agent directly, on a CLI agent through Mali's `mali` connector. */
export const NEEDS_COWORK =
  "เครื่องมือเอกสาร (list_templates, read_document, fill_template, save_template, make_template) ใช้ได้กับทุกโมเดลในโหมด Cowork — ใน CLI agent จะเห็นเป็นเครื่องมือของ connector “mali” เช่น mali_fill_template; ถ้าอยู่ในโหมด Chat ให้บอกผู้ใช้สั้น ๆ ว่าต้องสลับไป Cowork (เอกสารต้องมีโฟลเดอร์ให้บันทึก)";

const DOCUMENT_STEPS = (template: string, name: string, extra: string[]) =>
  [
    `ใช้ fill_template กับ template "${template}" เพื่อสร้าง${name}เป็นไฟล์ .docx ในโฟลเดอร์งาน — ห้ามเขียนเอกสารเองทั้งฉบับ`,
    "ถ้าในโฟลเดอร์มีแบบฟอร์มของผู้ใช้เอง (.docx ที่มี {{ช่อง}}) หรือผู้ใช้บอกว่ามีแบบของบริษัท ให้ใช้ read_document ดูช่องก่อน แล้วส่ง path ของไฟล์นั้นเป็น template แทน",
    "เรียก list_templates เพื่อดูว่าต้องมีช่องไหนบ้าง แล้วเก็บข้อมูลจากสิ่งที่ผู้ใช้ให้มาและไฟล์ในโฟลเดอร์ก่อน",
    "ข้อมูลที่จำเป็นแต่ยังไม่มี ให้ถามด้วย ask_user ครั้งเดียวรวมทุกข้อ — ห้ามแต่งชื่อลูกค้า ราคา เลขที่เอกสาร หรือข้อมูลบริษัทขึ้นเอง",
    ...extra,
    "ตั้งชื่อไฟล์ให้หาง่าย เช่น ประเภทเอกสาร-เลขที่.docx",
    "สร้างเสร็จแล้วสรุปสั้น ๆ: ไฟล์อยู่ที่ไหน ยอดสำคัญ และช่องที่ยังว่าง (ถ้ามี) ให้ผู้ใช้ตรวจ",
    NEEDS_COWORK,
  ].join("\n- ");

export const THAI_TEMPLATE_SKILLS: Omit<Skill, "id" | "enabled">[] = [
  {
    name: "ใบเสนอราคา",
    description: "ผู้ใช้ขอทำใบเสนอราคา / quotation ให้ลูกค้า",
    instructions:
      "# ใบเสนอราคา\n- " +
      DOCUMENT_STEPS("quotation", "ใบเสนอราคา", [
        "รายการสินค้า/บริการใส่ใน items (description, qty, unit, unit_price) — เครื่องมือคำนวณยอดรวม ภาษีมูลค่าเพิ่ม 7% และจำนวนเงินเป็นตัวอักษรให้เอง อย่าคำนวณเอง",
        "ถ้าผู้ใช้บอกว่าไม่คิด VAT ให้ส่ง vat: \"none\"; ส่วนลดใส่ใน values.discount เป็นจำนวนบาท",
      ]),
  },
  {
    name: "ใบแจ้งหนี้",
    description: "ผู้ใช้ขอทำใบแจ้งหนี้ / ใบวางบิล / invoice",
    instructions:
      "# ใบแจ้งหนี้\n- " +
      DOCUMENT_STEPS("invoice", "ใบแจ้งหนี้", [
        "รายการใส่ใน items (description, qty, unit, unit_price) — ยอด ภาษี และตัวอักษรคำนวณให้อัตโนมัติ",
        "ถ้ามีใบเสนอราคาเดิมในโฟลเดอร์ ให้อ่านด้วย read_document แล้วใช้รายการและข้อมูลลูกค้าจากฉบับนั้น",
        "ใส่ช่องทางชำระเงินใน payment_info และวันครบกำหนดใน due_date ถ้าผู้ใช้ให้มา",
      ]),
  },
  {
    name: "หนังสือราชการ",
    description: "ผู้ใช้ขอร่างหนังสือราชการ หนังสือภายนอก หรือหนังสือขอความอนุเคราะห์",
    instructions:
      "# หนังสือราชการ\n- " +
      DOCUMENT_STEPS("official-letter", "หนังสือราชการ (หนังสือภายนอก)", [
        "เขียน body ด้วยภาษาราชการ: ขึ้นต้นด้วย “ด้วย…” หรือ “ตามที่…” ระบุเหตุ แล้วตามด้วยจุดประสงค์ ย่อหน้าคั่นด้วยบรรทัดว่าง",
        "closing เป็นย่อหน้าสรุปจุดประสงค์ เช่น “จึงเรียนมาเพื่อโปรดพิจารณา” หรือ “จึงเรียนมาเพื่อโปรดทราบ”",
        "ใช้คำขึ้นต้น-ลงท้ายให้ตรงกับผู้รับ (เรียน … / ขอแสดงความนับถือ) ใช้ตัวเลขและวันที่แบบ พ.ศ.",
      ]),
  },
  {
    name: "บันทึกการประชุม",
    description: "ผู้ใช้ขอสรุปหรือจดรายงานการประชุม จากโน้ต ข้อความ หรือไฟล์ถอดเสียง",
    instructions:
      "# บันทึกการประชุม\n- " +
      DOCUMENT_STEPS("meeting-minutes", "บันทึกการประชุม", [
        "ถ้าผู้ใช้ให้โน้ตหรือไฟล์ถอดเสียงมา ให้อ่านแล้วสรุปเป็นวาระ (summary) มติ (resolutions) และงานที่ต้องทำใส่ items (task, owner, due)",
        "ผู้เข้าประชุมใส่บรรทัดละคนใน attendees; คงชื่อ ตัวเลข และวันที่ตามที่พูดจริง ห้ามเดา",
      ]),
  },
  {
    name: "อีเมลธุรกิจ",
    description: "ผู้ใช้ขอร่างอีเมลธุรกิจ/อีเมลถึงลูกค้าเป็นภาษาไทยแบบสุภาพ",
    instructions: [
      "# อีเมลธุรกิจภาษาไทย",
      "- โครงสร้าง: หัวเรื่องสั้นชัด → คำขึ้นต้น (เรียน คุณ… / เรียน ท่าน…) → ย่อหน้าเปิดบอกจุดประสงค์ในประโยคแรก → รายละเอียดเป็นข้อ ๆ ถ้ามีหลายเรื่อง → สิ่งที่ขอให้ผู้รับทำและกำหนดเวลา → คำลงท้าย (ขอแสดงความนับถือ / ขอบคุณครับ-ค่ะ) → ลายเซ็น",
      "- ใช้ภาษาสุภาพแต่ไม่แข็งเกินไป ประโยคสั้น ไม่ใช้คำแสลง ใช้ “ครับ/ค่ะ” ให้สม่ำเสมอตามผู้ส่ง",
      "- ถ้าไม่รู้ชื่อผู้รับ ชื่อผู้ส่ง หรือรายละเอียดสำคัญ (วันที่ ราคา เลขอ้างอิง) ให้ถามด้วย ask_user หรือเว้นเป็น […] ให้ผู้ใช้เติม ห้ามแต่งเอง",
      "- ให้หัวเรื่องมาด้วยเสมอ และถ้าเหมาะ เสนอเวอร์ชันสั้นอีกแบบหนึ่ง",
    ].join("\n"),
  },
  {
    name: "โพสต์ขายของ",
    description: "ผู้ใช้ขอเขียนโพสต์ขายสินค้า/โปรโมชัน สำหรับ Facebook, IG, LINE OA หรือ TikTok",
    instructions: [
      "# โพสต์ขายของ",
      "- เปิดด้วยประโยคดึงความสนใจ 1 บรรทัด แล้วตามด้วยจุดเด่นของสินค้า 3–5 ข้อ (ใช้อีโมจินำข้อได้พอประมาณ)",
      "- ใส่ราคา โปรโมชัน ระยะเวลา และวิธีสั่งซื้อให้ครบและตรงตามที่ผู้ใช้ให้ — ห้ามแต่งราคาหรือโปรเอง ถ้าไม่มีให้ถาม",
      "- ปิดด้วย call to action ชัด ๆ (ทักแชท / กดลิงก์ / โทร) และแฮชแท็กที่เกี่ยวข้อง 3–6 อัน",
      "- ปรับความยาวตามช่องทาง: IG/TikTok สั้นกระชับ, Facebook ยาวได้, LINE OA สั้นมากและมีลิงก์",
      "- ถ้าผู้ใช้ไม่ได้ระบุโทน ให้เสนอ 2 แบบ: เป็นกันเอง และทางการ",
    ].join("\n"),
  },
];

/**
 * Add the Thai templates to the user's skills once (never again after they
 * delete one). Skills written by an older version that said the templates need
 * an API-key model are brought up to date, whichever template they belong to.
 */
export function seedThaiTemplateSkills(existing: Skill[], add: (skill: Omit<Skill, "id"> & { id?: string }) => void) {
  for (const skill of existing) {
    if (skill.instructions.includes(OLD_NEEDS_COWORK)) {
      add({ ...skill, instructions: skill.instructions.replace(OLD_NEEDS_COWORK, NEEDS_COWORK) });
    } else if (skill.source?.startsWith("template:") && skill.instructions.includes("ต้องใช้โหมด Cowork กับโมเดลใต้ “Your API keys”")) {
      add({ ...skill, instructions: skill.instructions.replace("- ต้องใช้โหมด Cowork กับโมเดลใต้ “Your API keys”", `- ${NEEDS_COWORK}`) });
    }
  }
  try {
    if (localStorage.getItem(SEEDED_KEY) === "1") return;
    localStorage.setItem(SEEDED_KEY, "1");
  } catch {
    return;
  }
  for (const skill of THAI_TEMPLATE_SKILLS) {
    if (existing.some((s) => s.name === skill.name)) continue;
    add({ ...skill, enabled: true });
  }
}
