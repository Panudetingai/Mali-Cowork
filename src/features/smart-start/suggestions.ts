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
  icon: "pdf" | "doc" | "sheet" | "image" | "code" | "notes" | "tidy" | "slides" | "template";
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
