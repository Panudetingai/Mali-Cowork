/**
 * Smart empty state (PRD v0.3 Q2): a few task ideas for an empty Cowork chat,
 * from the *names* of the files in its folder — never their contents, and no
 * AI call, so it's instant and free. Cards say how many files of a kind there
 * are, never a file's name, so nothing private ends up on screen.
 */

export type Suggestion = {
  id: string;
  /** What the card says. */
  title: string;
  /** The prompt it puts in the chat box (not sent). */
  prompt: string;
  /** A skill to add as a badge, e.g. a document template. */
  skill?: string;
  icon:
    | "pdf"
    | "doc"
    | "sheet"
    | "image"
    | "code"
    | "notes"
    | "tidy"
    | "slides"
    | "template"
    | "web"
    | "write"
    | "design"
    | "mail"
    | "plan"
    | "translate"
    | "idea"
    | "learn";
  /** Fits whatever is in the folder (or no folder): drawn at random to fill the cards. */
  general?: boolean;
};

type Lang = "th" | "en";

const EXT = {
  pdf: ["pdf"],
  doc: ["docx", "doc", "rtf", "odt", "pages"],
  sheet: ["xlsx", "xls", "csv", "ods", "numbers"],
  image: ["jpg", "jpeg", "png", "webp", "heic", "gif"],
  slides: ["pptx", "ppt", "key", "odp"],
  notes: ["md", "txt"],
};

const PROJECT_FILES = ["package.json", "cargo.toml", "pyproject.toml", "requirements.txt", "go.mod", "pom.xml", "composer.json", "gemfile"];

function ext(name: string) {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

/** Up to `max` ideas, most useful first, for files given as paths relative to the folder. */
export function suggestTasks(files: string[], lang: Lang, max = 4): Suggestion[] {
  const th = lang === "th";
  const names = files.map((f) => f.split("/").pop() ?? f);
  const count = (kinds: string[]) => names.filter((n) => kinds.includes(ext(n))).length;
  const topLevel = files.filter((f) => !f.includes("/"));
  const out: Suggestion[] = [];

  const isProject = names.some((n) => PROJECT_FILES.includes(n.toLowerCase()));
  const pdf = count(EXT.pdf);
  const doc = count(EXT.doc);
  const sheet = count(EXT.sheet);
  const image = count(EXT.image);
  const slides = count(EXT.slides);
  const notes = count(EXT.notes);

  if (isProject) {
    out.push({
      id: "project-review",
      icon: "code",
      title: th ? "หา bug และเขียน test ให้โปรเจกต์นี้" : "Find bugs and add tests to this project",
      prompt: th
        ? "ช่วยอ่านโปรเจกต์นี้ หาจุดที่น่าจะเป็น bug พร้อมเหตุผล แล้วเขียน test สำหรับส่วนที่สำคัญที่สุด"
        : "Read this project, point out likely bugs with the reasons, then add tests for the most important parts.",
    });
  }
  if (pdf > 0) {
    out.push({
      id: "pdf-summary",
      icon: "pdf",
      title: th ? `สรุป PDF ${pdf} ไฟล์เป็นตาราง` : `Summarise ${pdf} PDF${pdf === 1 ? "" : "s"} into a table`,
      prompt: th
        ? `สรุปไฟล์ PDF ทั้ง ${pdf} ไฟล์ในโฟลเดอร์นี้เป็นตาราง: ชื่อไฟล์ · เรื่อง · ประเด็นสำคัญ · ตัวเลข/วันที่ที่ควรรู้ แล้วบันทึกเป็นไฟล์ Excel`
        : `Summarise the ${pdf} PDF file${pdf === 1 ? "" : "s"} in this folder into a table: file · topic · key points · numbers/dates to know, and save it as an Excel file.`,
    });
  }
  if (sheet > 0) {
    out.push({
      id: "sheet-insights",
      icon: "sheet",
      title: th ? `วิเคราะห์ข้อมูลจาก ${sheet} ไฟล์ตาราง` : `Find insights in ${sheet} spreadsheet${sheet === 1 ? "" : "s"}`,
      prompt: th
        ? "อ่านไฟล์ตาราง (Excel/CSV) ในโฟลเดอร์นี้ สรุปข้อสังเกตสำคัญ แนวโน้ม และสิ่งที่ผิดปกติ พร้อมทำกราฟประกอบ"
        : "Read the spreadsheets (Excel/CSV) in this folder and summarise the key findings, trends and anything unusual, with charts.",
    });
  }
  if (doc > 0) {
    out.push({
      id: "doc-review",
      icon: "doc",
      title: th ? `สรุปและตรวจเอกสาร Word ${doc} ไฟล์` : `Summarise and proofread ${doc} Word document${doc === 1 ? "" : "s"}`,
      prompt: th
        ? "อ่านเอกสาร Word ในโฟลเดอร์นี้ สรุปแต่ละฉบับสั้น ๆ และชี้จุดที่ควรแก้ภาษาหรือข้อมูลที่ไม่ตรงกัน"
        : "Read the Word documents in this folder, summarise each briefly, and point out wording to fix or details that don't match.",
    });
  }
  if (slides > 0) {
    out.push({
      id: "slides-summary",
      icon: "slides",
      title: th ? `สรุปสไลด์ ${slides} ไฟล์` : `Summarise ${slides} slide deck${slides === 1 ? "" : "s"}`,
      prompt: th ? "สรุปเนื้อหาสไลด์ในโฟลเดอร์นี้เป็นประเด็นสำคัญ และร่างสคริปต์พูดสั้น ๆ" : "Summarise the slide decks in this folder into key points, and draft a short talk track.",
    });
  }
  if (image >= 3) {
    out.push({
      id: "image-tidy",
      icon: "image",
      title: th ? `จัดรูป ${image} รูปเข้าโฟลเดอร์และตั้งชื่อใหม่` : `Sort ${image} pictures into folders and rename them`,
      prompt: th
        ? `ช่วยจัดรูปทั้ง ${image} รูปในโฟลเดอร์นี้เข้าโฟลเดอร์ย่อยตามหัวข้อ และตั้งชื่อไฟล์ใหม่ให้อ่านง่าย (บอกแผนก่อนย้ายจริง)`
        : `Sort the ${image} pictures in this folder into subfolders by topic and give them readable names (show me the plan before moving anything).`,
    });
  }
  const kinds = new Set(topLevel.map(ext).filter(Boolean));
  if (topLevel.length >= 15 && kinds.size >= 4 && !isProject) {
    out.push({
      id: "tidy",
      icon: "tidy",
      title: th ? `จัดไฟล์ ${topLevel.length} ไฟล์เข้าโฟลเดอร์ตามประเภท` : `Tidy ${topLevel.length} files into folders by type`,
      prompt: th
        ? "จัดไฟล์ในโฟลเดอร์นี้เข้าโฟลเดอร์ย่อยตามประเภท (เอกสาร รูป ตาราง ฯลฯ) — บอกแผนก่อน แล้วค่อยย้ายเมื่อฉันตกลง"
        : "Tidy the files in this folder into subfolders by type (documents, pictures, spreadsheets…) — show me the plan first, and move them once I agree.",
    });
  }
  if (notes >= 3 && !isProject) {
    out.push({
      id: "notes-todo",
      icon: "notes",
      title: th ? `สรุปโน้ต ${notes} ไฟล์เป็นรายการสิ่งที่ต้องทำ` : `Turn ${notes} notes into a to-do list`,
      prompt: th ? "อ่านโน้ต (.md/.txt) ในโฟลเดอร์นี้ แล้วสรุปเป็นรายการสิ่งที่ต้องทำ เรียงตามความสำคัญ" : "Read the notes (.md/.txt) in this folder and turn them into a to-do list, most important first.",
    });
  }

  // Always worth offering: the document templates.
  out.push({
    id: "quotation",
    icon: "template",
    skill: "ใบเสนอราคา",
    title: th ? "ทำใบเสนอราคา" : "Make a quotation",
    prompt: th ? "ทำใบเสนอราคาให้ลูกค้า: " : "Make a quotation for: the customer details and product details and price list",
  });
  out.push({
    id: "letter",
    icon: "template",
    skill: "หนังสือราชการ",
    title: th ? "ร่างหนังสือราชการ" : "Draft an official letter",
    prompt: th ? "ร่างหนังสือเรื่อง " : "Draft an official letter about the subject and the details",
  });
  return out.slice(0, max);
}

type Idea = Omit<Suggestion, "title" | "prompt" | "general"> & { th: [title: string, prompt: string]; en: [title: string, prompt: string] };

/** Cowork ideas that need nothing in the folder; the prompt goes to the chat box to finish, never sent. */
const COWORK_IDEAS: Idea[] = [
  { id: "g-research", icon: "web", th: ["ค้นข้อมูลจากเว็บแล้วทำรายงาน", "ค้นข้อมูลจากเว็บเรื่อง … แล้วสรุปเป็นรายงานพร้อมแหล่งอ้างอิง บันทึกเป็นไฟล์ Word"], en: ["Research the web and write a report", "Research … on the web and write it up as a report with sources, saved as a Word file."] },
  { id: "g-promo", icon: "design", th: ["ทำโพสต์โปรโมชันลงโซเชียล", "ทำโพสต์โปรโมชันสำหรับ Instagram เรื่อง … สไตล์สดใส ขนาด 1080×1350 พร้อมแคปชั่น 3 แบบ"], en: ["Create a social media promo post", "Create an Instagram promo post about … — bright style, 1080×1350, with three caption options."] },
  { id: "g-slides", icon: "slides", th: ["ทำสไลด์นำเสนอ 5 หน้า", "ทำสไลด์นำเสนอ 5 หน้าเรื่อง … มีหน้าปก ประเด็นหลัก และสรุป บันทึกเป็น PowerPoint"], en: ["Build a 5-slide presentation", "Build a 5-slide presentation about … with a cover, the key points and a summary, saved as PowerPoint."] },
  { id: "g-budget", icon: "sheet", th: ["สร้างตารางงบประมาณรายเดือน", "สร้างไฟล์ Excel งบประมาณรายเดือน มีรายรับ รายจ่ายแยกหมวด และสูตรรวมยอดอัตโนมัติ"], en: ["Make a monthly budget spreadsheet", "Create a monthly budget in Excel: income, spending by category, and totals that add up on their own."] },
  { id: "g-timeline", icon: "plan", th: ["วางแผนโปรเจกต์เป็น timeline", "วางแผนโปรเจกต์ … เป็น timeline รายสัปดาห์ บอกงาน ผู้รับผิดชอบ และกำหนดส่ง บันทึกเป็น Excel"], en: ["Plan a project as a timeline", "Plan the project … as a week-by-week timeline with tasks, owners and due dates, saved as Excel."] },
  { id: "g-landing", icon: "code", th: ["สร้างหน้าเว็บ landing page", "สร้างหน้าเว็บ landing page หน้าเดียวสำหรับ … มีหัวข้อ จุดเด่น 3 ข้อ และปุ่มติดต่อ ใช้ HTML ไฟล์เดียว"], en: ["Build a one-page landing site", "Build a one-page landing site for … with a headline, three highlights and a contact button, as a single HTML file."] },
  { id: "g-minutes", icon: "notes", th: ["เปลี่ยนโน้ตเป็นรายงานการประชุม", "เปลี่ยนโน้ตการประชุมนี้เป็นรายงานการประชุม มีวาระ มติ และงานที่ต้องทำพร้อมผู้รับผิดชอบ: …"], en: ["Turn notes into meeting minutes", "Turn these meeting notes into minutes with the agenda, decisions and action items with owners: …"] },
  { id: "g-translate", icon: "translate", th: ["แปลเอกสาร ไทย ↔ อังกฤษ", "แปลเอกสาร … เป็นภาษาอังกฤษแบบเป็นทางการ คงรูปแบบเดิมไว้ และบันทึกเป็นไฟล์ใหม่"], en: ["Translate a document Thai ↔ English", "Translate … into formal Thai, keep its layout, and save it as a new file."] },
  { id: "g-sop", icon: "write", th: ["เขียน SOP ขั้นตอนการทำงาน", "เขียน SOP ขั้นตอนการทำงานเรื่อง … เป็นข้อ ๆ มีจุดตรวจสอบ และบันทึกเป็น Word"], en: ["Write a step-by-step SOP", "Write a step-by-step SOP for … with checkpoints, saved as a Word document."] },
  { id: "g-email", icon: "mail", th: ["ร่างอีเมลตอบลูกค้า", "ร่างอีเมลตอบลูกค้าอย่างสุภาพและเป็นมืออาชีพ เรื่อง … ให้ 2 แบบ: สั้น และละเอียด"], en: ["Draft a reply to a customer", "Draft a polite, professional reply to a customer about … in two versions: short and detailed."] },
  { id: "g-script", icon: "code", th: ["เขียนสคริปต์เปลี่ยนชื่อไฟล์จำนวนมาก", "เขียนสคริปต์เปลี่ยนชื่อไฟล์ในโฟลเดอร์นี้ตามรูปแบบ … (แสดงผลลัพธ์ก่อนเปลี่ยนจริง)"], en: ["Write a script to rename many files", "Write a script that renames the files in this folder to the pattern … (show me the result before renaming)."] },
  { id: "g-checklist", icon: "plan", th: ["ทำ checklist งานประจำวัน", "ทำ checklist งานประจำวันสำหรับ … แบ่งเป็นเช้า กลางวัน เย็น พิมพ์ได้บนกระดาษ A4"], en: ["Make a daily checklist", "Make a daily checklist for … split into morning, afternoon and evening, printable on A4."] },
  { id: "g-report", icon: "sheet", th: ["ทำกราฟสรุปยอดขาย", "ทำกราฟและสรุปยอดขายจากไฟล์ … แยกตามเดือนและสินค้า พร้อมข้อสังเกต 3 ข้อ"], en: ["Chart the sales numbers", "Chart and summarise the sales in … by month and by product, with three things worth noticing."] },
  { id: "g-proposal", icon: "doc", th: ["ร่างข้อเสนอโครงการ", "ร่างข้อเสนอโครงการ … มีที่มา วัตถุประสงค์ ขอบเขต งบประมาณ และระยะเวลา บันทึกเป็น Word"], en: ["Draft a project proposal", "Draft a proposal for … with background, goals, scope, budget and timeline, saved as Word."] },
];

/** Chat ideas: questions that need no files. */
const CHAT_IDEAS: Idea[] = [
  { id: "c-explain", icon: "learn", th: ["อธิบายเรื่องยากให้เข้าใจง่าย", "อธิบายเรื่อง … ให้เข้าใจง่ายเหมือนเล่าให้เพื่อนฟัง พร้อมตัวอย่าง"], en: ["Explain something simply", "Explain … simply, like you'd tell a friend, with an example."] },
  { id: "c-names", icon: "idea", th: ["คิดชื่อแบรนด์", "ช่วยคิดชื่อแบรนด์สำหรับ … 10 ชื่อ พร้อมความหมายสั้น ๆ"], en: ["Brainstorm brand names", "Brainstorm 10 brand names for … with a line on what each means."] },
  { id: "c-interview", icon: "learn", th: ["ฝึกสัมภาษณ์งาน", "ช่วยฝึกสัมภาษณ์งานตำแหน่ง … ถามทีละข้อ แล้วให้คำแนะนำหลังฉันตอบ"], en: ["Practise a job interview", "Interview me for a … role: one question at a time, with feedback after each answer."] },
  { id: "c-caption", icon: "write", th: ["เขียนแคปชั่นโซเชียล", "เขียนแคปชั่นโซเชียล 5 แบบสำหรับ … โทนสนุก มีแฮชแท็ก"], en: ["Write social captions", "Write five social captions for … in a fun tone, with hashtags."] },
  { id: "c-trip", icon: "plan", th: ["วางแผนเที่ยว 3 วัน", "วางแผนเที่ยว … 3 วัน 2 คืน งบ … บาท มีที่กิน ที่เที่ยว และการเดินทาง"], en: ["Plan a 3-day trip", "Plan 3 days in … on a budget of … with places to eat, see and how to get around."] },
  { id: "c-excel", icon: "sheet", th: ["สอนสูตร Excel", "สอนสูตร Excel สำหรับ … พร้อมตัวอย่างที่ลองตามได้"], en: ["Learn an Excel formula", "Teach me the Excel formula for … with an example I can try."] },
  { id: "c-menu", icon: "idea", th: ["คิดเมนูอาหารทั้งสัปดาห์", "คิดเมนูอาหารเย็น 7 วัน ทำง่าย ไม่เกิน 30 นาที พร้อมรายการของที่ต้องซื้อ"], en: ["Plan a week of dinners", "Plan 7 easy dinners (30 minutes or less) with a shopping list."] },
  { id: "c-review", icon: "write", th: ["ช่วยตรวจงานเขียน", "ช่วยตรวจงานเขียนนี้ แก้คำผิด ปรับให้อ่านลื่น และบอกว่าแก้อะไรไป: …"], en: ["Proofread my writing", "Proofread this, make it read smoothly, and tell me what you changed: …"] },
  { id: "c-plan", icon: "plan", th: ["ทบทวนแผนธุรกิจ", "ช่วยทบทวนแผนธุรกิจ … บอกจุดแข็ง ความเสี่ยง และสิ่งที่ควรทำต่อ"], en: ["Review a business plan", "Review my business plan for … — strengths, risks and next steps."] },
  { id: "c-reply", icon: "mail", th: ["ช่วยตอบข้อความยาก ๆ", "ช่วยร่างคำตอบข้อความนี้ให้สุภาพแต่ชัดเจน: …"], en: ["Answer a tricky message", "Help me reply to this politely but clearly: …"] },
];

function fromIdea(idea: Idea, lang: Lang): Suggestion {
  const [title, prompt] = idea[lang];
  return { id: idea.id, icon: idea.icon, skill: idea.skill, title, prompt, general: true };
}

export function coworkIdeas(lang: Lang): Suggestion[] {
  return COWORK_IDEAS.map((idea) => fromIdea(idea, lang));
}

export function chatIdeas(lang: Lang): Suggestion[] {
  return CHAT_IDEAS.map((idea) => fromIdea(idea, lang));
}

export function shuffle<T>(items: T[], random: () => number = Math.random): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * The cards to show: at most one idea read from the folder (it's the most
 * relevant), the rest drawn at random from everything else, so each visit
 * shows something new.
 */
export function pickSuggestions<T extends { id: string }>(
  fromFolder: T[],
  general: T[],
  count: number,
  random: () => number = Math.random,
): T[] {
  const [first, ...rest] = shuffle(fromFolder, random);
  const picked = first ? [first] : [];
  for (const idea of shuffle([...rest, ...general], random)) {
    if (picked.length >= count) break;
    if (!picked.some((p) => p.id === idea.id)) picked.push(idea);
  }
  return picked;
}
