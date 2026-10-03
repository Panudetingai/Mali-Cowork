// The benchmark's tasks: real Cowork work on a copy of ./fixture, some with
// the Acme connector. Each check is a plain fact about the result, so the
// quality score is the share of checks passed — no model grades a model.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

/** Models write INV‑2001 with a non-breaking hyphen, 48 250 with a thin space: read them plainly. */
export const plain = (text) => text.replace(/[\u2010-\u2015\u2212]/g, "-").replace(/[\u00a0\u2007\u2009\u202f]/g, " ");
const read = (dir, file) => (existsSync(join(dir, file)) ? plain(readFileSync(join(dir, file), "utf8")) : "");
/** 62250 → matches "62,250", "62250", "62,250.00", "62 250". */
const amount = (n) => {
  const [int, frac] = String(n).split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, "[,\\s]?");
  // Whole amounts may carry ".00"; fractional ones must show their decimals.
  const tail = frac ? `\\.${frac}0*(?!\\d)` : `(\\.0+)?(?!\\d|\\.\\d)`;
  return new RegExp(`(?<![\\d.])${grouped}${tail}`);
};
const thai = /[฀-๿]/;

export const TASKS = [
  {
    id: "csv-summary",
    title: "Summarise a CSV into a file",
    prompt: "Read sales.csv and create summary.md listing the total revenue (qty × unit_price) for each region, highest first.",
    checks: [
      ["summary.md exists", ({ dir }) => !!read(dir, "summary.md")],
      ["Central 62,250", ({ dir }) => amount(62250).test(read(dir, "summary.md"))],
      ["North 22,830", ({ dir }) => amount(22830).test(read(dir, "summary.md"))],
      ["South 22,300", ({ dir }) => amount(22300).test(read(dir, "summary.md"))],
      ["Northeast 15,200", ({ dir }) => amount(15200).test(read(dir, "summary.md"))],
      [
        "highest first",
        ({ dir }) => {
          const s = read(dir, "summary.md");
          const at = ["Central", "North", "South", "Northeast"].map((r) => s.search(new RegExp(`\\b${r}\\b`)));
          return at.every((v, i) => v >= 0 && (i === 0 || v > at[i - 1]));
        },
      ],
    ],
  },
  {
    id: "fix-bug",
    title: "Fix a bug so the tests pass",
    prompt: "The tests in test_stats.py fail. Fix stats.py so they all pass. Don't change the tests.",
    checks: [
      [
        "tests pass",
        ({ dir }) => {
          try {
            execFileSync("python3", ["-m", "unittest", "test_stats"], { cwd: dir, stdio: "pipe", timeout: 30_000 });
            return true;
          } catch {
            return false;
          }
        },
      ],
      ["tests untouched", ({ dir, fixture }) => read(dir, "test_stats.py") === read(fixture, "test_stats.py")],
      ["mean and spread kept", ({ dir }) => /def mean/.test(read(dir, "stats.py")) && /def spread/.test(read(dir, "stats.py"))],
    ],
  },
  {
    id: "crm-lookup",
    title: "Look something up in the connector",
    prompt: "In the Acme CRM, what is Siam Coffee's outstanding balance, and which invoices make it up?",
    checks: [
      ["balance 48,250", ({ answer }) => amount(48250).test(answer)],
      ["names INV-2001", ({ answer }) => /INV-2001/.test(answer)],
      ["names INV-2002", ({ answer }) => /INV-2002/.test(answer)],
      ["no wrong invoice", ({ answer }) => !/INV-200[345]/.test(answer)],
    ],
  },
  {
    id: "crm-create",
    title: "Create a record through the connector",
    prompt:
      "Create an invoice in the Acme CRM for Lanna Tea House: 3 × Oolong Gift Box (use the product's SKU from the CRM), due 2026-11-15. Tell me the new invoice number.",
    checks: [
      ["one invoice created", ({ calls }) => calls.filter((c) => c.name === "create_invoice").length === 1],
      ["right customer", ({ calls }) => calls.find((c) => c.name === "create_invoice")?.args?.customer_id === "C-102"],
      [
        "right line",
        ({ calls }) => {
          const items = calls.find((c) => c.name === "create_invoice")?.args?.items ?? [];
          return items.length === 1 && items[0].sku === "P-OOL-3" && Number(items[0].quantity) === 3;
        },
      ],
      ["right due date", ({ calls }) => calls.find((c) => c.name === "create_invoice")?.args?.due_date === "2026-11-15"],
      ["reports INV-2006", ({ answer }) => /INV-2006/.test(answer)],
    ],
  },
  {
    id: "crm-to-files",
    title: "Connector data into files, in Thai",
    prompt:
      "As of 2026-10-03, find every unpaid invoice in the Acme CRM that is past its due date. Write one reminder email per customer into drafts/<customer id>.md (for example drafts/C-101.md) with the customer's name, their overdue invoice numbers and the total overdue amount. These customers prefer Thai, so write the emails in Thai.",
    checks: [
      ["C-101 draft", ({ dir }) => !!read(dir, "drafts/C-101.md")],
      ["C-102 draft", ({ dir }) => !!read(dir, "drafts/C-102.md")],
      ["C-104 draft", ({ dir }) => !!read(dir, "drafts/C-104.md")],
      ["no C-103 draft", ({ dir }) => !existsSync(join(dir, "drafts/C-103.md"))],
      ["C-101: INV-2001, 30,000", ({ dir }) => /INV-2001/.test(read(dir, "drafts/C-101.md")) && amount(30000).test(read(dir, "drafts/C-101.md"))],
      ["C-101: not INV-2002 (not due yet)", ({ dir }) => !/INV-2002/.test(read(dir, "drafts/C-101.md"))],
      ["C-102: INV-2003, 12,900", ({ dir }) => /INV-2003/.test(read(dir, "drafts/C-102.md")) && amount(12900).test(read(dir, "drafts/C-102.md"))],
      ["C-104: INV-2004, 7,450.50", ({ dir }) => /INV-2004/.test(read(dir, "drafts/C-104.md")) && amount(7450.5).test(read(dir, "drafts/C-104.md"))],
      [
        "written in Thai",
        ({ dir }) => existsSync(join(dir, "drafts")) && readdirSync(join(dir, "drafts")).every((f) => thai.test(read(dir, join("drafts", f)))),
      ],
    ],
  },
  {
    id: "handbook-qa",
    title: "Answer questions from a long document",
    extra: ["handbook.md"],
    prompt:
      "Using handbook.md, write answers.md answering: 1) How many days of annual leave does an employee in their 5th year get? 2) What is the daily meal allowance on a domestic trip? 3) Who must approve working remotely 3 days a week? 4) How long is probation? Keep each answer to one line.",
    checks: [
      ["answers.md exists", ({ dir }) => !!read(dir, "answers.md")],
      ["18 days of leave", ({ dir }) => /\b18\b/.test(read(dir, "answers.md"))],
      ["750 THB meals", ({ dir }) => amount(750).test(read(dir, "answers.md"))],
      ["Head of People", ({ dir }) => /head of people/i.test(read(dir, "answers.md"))],
      ["119 days probation", ({ dir }) => /\b119\b/.test(read(dir, "answers.md"))],
    ],
  },
  {
    id: "thai-summary",
    title: "Summarise notes in Thai",
    prompt: "สรุปไฟล์ notes.txt เป็นภาษาไทย 3 ข้อ (bullet) แล้วบันทึกลงไฟล์ summary_th.md",
    checks: [
      ["summary_th.md exists", ({ dir }) => !!read(dir, "summary_th.md")],
      ["exactly 3 bullets", ({ dir }) => read(dir, "summary_th.md").split("\n").filter((l) => /^\s*([-*•]|\d+[.)])\s+/.test(l)).length === 3],
      ["in Thai", ({ dir }) => thai.test(read(dir, "summary_th.md"))],
      ["launch date 15 Nov", ({ dir }) => /15/.test(read(dir, "summary_th.md"))],
      ["budget 250,000", ({ dir }) => amount(250000).test(read(dir, "summary_th.md"))],
    ],
  },
];
