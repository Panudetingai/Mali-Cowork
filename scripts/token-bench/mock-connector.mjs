// A stand-in connector for the token benchmark: an "Acme" CRM over MCP
// (Streamable HTTP, JSON replies). It has as many tools, with schemas as
// wordy, as the real connectors people use (Canva, Notion, HubSpot), so the
// cost of carrying tool definitions shows up the way it does in real work.
// Nothing leaves this machine; every call is logged for the task checks.
//
//   node mock-connector.mjs <port> <log.json>
//   POST /reset  — fresh data and an empty call log

import { createServer } from "node:http";
import { writeFileSync } from "node:fs";

const port = Number(process.argv[2] ?? 4791);
const logPath = process.argv[3] ?? "calls.json";

const seed = () => ({
  customers: [
    { id: "C-101", name: "Siam Coffee", city: "Bangkok", email: "ap@siamcoffee.co.th", language: "th", tier: "gold" },
    { id: "C-102", name: "Lanna Tea House", city: "Chiang Mai", email: "owner@lannatea.co.th", language: "th", tier: "silver" },
    { id: "C-103", name: "Phuket Surf Co", city: "Phuket", email: "hello@phuketsurf.com", language: "en", tier: "bronze" },
    { id: "C-104", name: "Isaan Silk", city: "Khon Kaen", email: "finance@isaansilk.co.th", language: "th", tier: "silver" },
  ],
  invoices: [
    { number: "INV-2001", customerId: "C-101", total: 30000, currency: "THB", dueDate: "2026-08-15", status: "unpaid" },
    { number: "INV-2002", customerId: "C-101", total: 18250, currency: "THB", dueDate: "2026-10-20", status: "unpaid" },
    { number: "INV-2003", customerId: "C-102", total: 12900, currency: "THB", dueDate: "2026-09-01", status: "unpaid" },
    { number: "INV-2004", customerId: "C-104", total: 7450.5, currency: "THB", dueDate: "2026-09-28", status: "unpaid" },
    { number: "INV-2005", customerId: "C-103", total: 5000, currency: "THB", dueDate: "2026-09-10", status: "paid" },
  ],
  products: [
    { sku: "P-OOL-3", name: "Oolong Gift Box", unitPrice: 890, currency: "THB" },
    { sku: "P-JAS-1", name: "Jasmine Green Tea 250g", unitPrice: 320, currency: "THB" },
    { sku: "P-ESP-2", name: "Espresso Blend 1kg", unitPrice: 1150, currency: "THB" },
    { sku: "P-MUG-9", name: "Ceramic Mug", unitPrice: 240, currency: "THB" },
  ],
  nextInvoice: 2006,
});

let db = seed();
let calls = [];
const save = () => writeFileSync(logPath, JSON.stringify(calls, null, 2));

// ── schemas: written the way real connectors write them ──
const str = (description, extra = {}) => ({ type: "string", description, ...extra });
const num = (description, extra = {}) => ({ type: "number", description, ...extra });
const int = (description, extra = {}) => ({ type: "integer", description, ...extra });
const bool = (description) => ({ type: "boolean", description });
const page = {
  limit: int("Maximum number of results to return in one page. Defaults to 25; the largest allowed value is 100.", { minimum: 1, maximum: 100 }),
  cursor: str("Opaque pagination cursor returned as `next_cursor` by a previous call. Omit it to start from the first page."),
};
const address = {
  type: "object",
  description: "A postal address. All fields are optional, but a billing address needs at least a line and a city.",
  properties: {
    line1: str("Street address, building and unit."),
    line2: str("Additional address information such as a floor or district."),
    city: str("City, district or locality."),
    province: str("Province or state."),
    postal_code: str("Postal or ZIP code."),
    country: str("Two-letter ISO 3166-1 country code, for example TH.", { minLength: 2, maxLength: 2 }),
  },
};
const lineItems = {
  type: "array",
  description: "The lines of the document, in order. Each line refers to a product by its SKU from list_products, or describes a custom charge.",
  items: {
    type: "object",
    properties: {
      sku: str("Product SKU as returned by list_products. Leave empty for a custom line."),
      description: str("Text shown on the line. Defaults to the product name when a SKU is given."),
      quantity: num("How many units. Must be greater than zero.", { exclusiveMinimum: 0 }),
      unit_price: num("Price per unit in the document currency. Defaults to the product's list price when a SKU is given."),
      discount_percent: num("Discount on this line, from 0 to 100.", { minimum: 0, maximum: 100 }),
      tax_code: str("Tax treatment of the line.", { enum: ["VAT7", "EXEMPT", "ZERO"] }),
    },
    required: ["quantity"],
  },
};

const tools = [
  ["search_customers", "Search the CRM's customers by name, email, city or customer ID. Returns matching customers with their IDs, tier and contact details. Use this before any action that needs a customer_id.", { query: str("Free text to match against the customer's name, email, city or ID. Matching is case-insensitive and accepts partial words."), tier: str("Only customers of this tier.", { enum: ["gold", "silver", "bronze"] }), ...page }, ["query"]],
  ["get_customer", "Get one customer's full record: contact details, language preference, tier, account owner and current outstanding balance.", { customer_id: str("The customer's ID, for example C-101, as returned by search_customers.") }, ["customer_id"]],
  ["create_customer", "Create a new customer record. Returns the new customer's ID. Check with search_customers first so you don't create a duplicate.", { name: str("Company or person name as it should appear on documents."), email: str("Billing email address.", { format: "email" }), phone: str("Phone number in international format, for example +66 2 123 4567."), language: str("Preferred language for documents and emails.", { enum: ["th", "en"] }), billing_address: address, tags: { type: "array", items: { type: "string" }, description: "Free-form labels used for segmentation." } }, ["name"]],
  ["update_customer", "Update fields on an existing customer. Only the fields you pass are changed.", { customer_id: str("The customer's ID."), name: str("New display name."), email: str("New billing email.", { format: "email" }), phone: str("New phone number."), language: str("Preferred language.", { enum: ["th", "en"] }), billing_address: address, tier: str("Customer tier.", { enum: ["gold", "silver", "bronze"] }) }, ["customer_id"]],
  ["delete_customer", "Permanently delete a customer and all of their draft documents. Customers with issued invoices cannot be deleted; archive them instead.", { customer_id: str("The customer's ID."), confirm: bool("Must be true to confirm the deletion.") }, ["customer_id", "confirm"]],
  ["list_invoices", "List invoices, newest first, optionally filtered by customer, status or due date range. Each invoice includes its number, customer_id, total, currency, due date and status (draft, unpaid, paid, void).", { customer_id: str("Only invoices for this customer."), status: str("Only invoices in this status.", { enum: ["draft", "unpaid", "paid", "void"] }), due_before: str("Only invoices due strictly before this date (YYYY-MM-DD).", { format: "date" }), due_after: str("Only invoices due on or after this date (YYYY-MM-DD).", { format: "date" }), ...page }, []],
  ["get_invoice", "Get one invoice in full, including its lines, taxes, payments received and the remaining amount due.", { invoice_number: str("The invoice number, for example INV-2001.") }, ["invoice_number"]],
  ["create_invoice", "Create and issue an invoice for a customer. Prices default to the product list price. Returns the new invoice number and its total.", { customer_id: str("The customer's ID from search_customers."), items: lineItems, due_date: str("Payment due date (YYYY-MM-DD). Defaults to 30 days after the issue date.", { format: "date" }), currency: str("Three-letter currency code. Defaults to the customer's currency.", { enum: ["THB", "USD", "EUR"] }), notes: str("Text printed at the bottom of the invoice."), send_email: bool("Email the invoice to the customer's billing address right away.") }, ["customer_id", "items"]],
  ["update_invoice_status", "Change an invoice's status, for example to mark it void. Use record_payment, not this, when money was received.", { invoice_number: str("The invoice number."), status: str("The new status.", { enum: ["draft", "unpaid", "void"] }), reason: str("Why the status changed; kept in the audit log.") }, ["invoice_number", "status"]],
  ["send_invoice_email", "Email an issued invoice to the customer as a PDF attachment, using one of the account's email templates.", { invoice_number: str("The invoice number."), template_id: str("Email template ID from list_email_templates. Defaults to the account's standard invoice template."), cc: { type: "array", items: { type: "string", format: "email" }, description: "Extra recipients." }, message: str("A personal note added above the template text.") }, ["invoice_number"]],
  ["void_invoice", "Void an issued invoice. A voided invoice stays in the records but no longer counts as owed.", { invoice_number: str("The invoice number."), reason: str("Reason shown in the audit log.") }, ["invoice_number"]],
  ["list_payments", "List payments received, newest first, optionally for one customer or invoice.", { customer_id: str("Only payments from this customer."), invoice_number: str("Only payments applied to this invoice."), received_after: str("Only payments received on or after this date.", { format: "date" }), ...page }, []],
  ["record_payment", "Record money received against an invoice. The invoice becomes paid when the payments cover its total.", { invoice_number: str("The invoice number."), amount: num("Amount received in the invoice currency.", { exclusiveMinimum: 0 }), received_on: str("Date the money arrived (YYYY-MM-DD).", { format: "date" }), method: str("How it was paid.", { enum: ["bank_transfer", "promptpay", "card", "cash", "cheque"] }), reference: str("Bank or payment reference.") }, ["invoice_number", "amount"]],
  ["list_products", "List the product catalog with SKUs, names, list prices and stock levels. Use SKUs from here on invoices and quotes.", { query: str("Only products whose name or SKU contains this text."), in_stock: bool("Only products with stock available."), ...page }, []],
  ["get_product", "Get one product's details, price tiers and stock by location.", { sku: str("The product SKU.") }, ["sku"]],
  ["create_quote", "Create a sales quote for a customer. Quotes can later be converted into invoices.", { customer_id: str("The customer's ID."), items: lineItems, valid_until: str("Last day the quote can be accepted.", { format: "date" }), notes: str("Terms or notes printed on the quote.") }, ["customer_id", "items"]],
  ["list_deals", "List open sales deals in the pipeline with their stage, value and owner.", { stage: str("Only deals in this stage.", { enum: ["lead", "qualified", "proposal", "negotiation", "won", "lost"] }), owner_id: str("Only deals owned by this team member."), ...page }, []],
  ["update_deal_stage", "Move a deal to another pipeline stage.", { deal_id: str("The deal's ID."), stage: str("The new stage.", { enum: ["lead", "qualified", "proposal", "negotiation", "won", "lost"] }), note: str("Why it moved; added to the deal timeline.") }, ["deal_id", "stage"]],
  ["list_calendar_events", "List calendar events in a time range for the account or one team member.", { start: str("Start of the range, ISO 8601 date-time.", { format: "date-time" }), end: str("End of the range, ISO 8601 date-time.", { format: "date-time" }), member_id: str("Only this team member's events.") }, ["start", "end"]],
  ["create_calendar_event", "Create a calendar event and invite attendees by email.", { title: str("Event title."), start: str("Start time, ISO 8601.", { format: "date-time" }), end: str("End time, ISO 8601.", { format: "date-time" }), attendees: { type: "array", items: { type: "string", format: "email" }, description: "Emails to invite." }, location: str("Place or video link."), description: str("Agenda or notes.") }, ["title", "start", "end"]],
  ["list_tasks", "List follow-up tasks, optionally only open ones or those for a customer.", { customer_id: str("Only tasks about this customer."), open_only: bool("Only tasks not yet completed."), assignee_id: str("Only tasks assigned to this team member."), ...page }, []],
  ["create_task", "Create a follow-up task, optionally linked to a customer or invoice, with a due date and an assignee.", { title: str("What needs doing."), customer_id: str("Customer the task is about."), invoice_number: str("Invoice the task is about."), due_date: str("When it should be done.", { format: "date" }), assignee_id: str("Team member responsible. Defaults to the account owner."), priority: str("Task priority.", { enum: ["low", "normal", "high"] }) }, ["title"]],
  ["complete_task", "Mark a task as done.", { task_id: str("The task's ID."), note: str("Outcome, added to the task history.") }, ["task_id"]],
  ["search_documents", "Full-text search across the account's stored documents: contracts, proposals and notes.", { query: str("Words to search for."), type: str("Only this kind of document.", { enum: ["contract", "proposal", "note", "other"] }), ...page }, ["query"]],
  ["get_document", "Get a stored document's text and metadata.", { document_id: str("The document's ID.") }, ["document_id"]],
  ["create_document", "Store a new document, optionally linked to a customer.", { title: str("Document title."), content: str("The document's text, in Markdown."), type: str("Kind of document.", { enum: ["contract", "proposal", "note", "other"] }), customer_id: str("Customer it belongs to.") }, ["title", "content"]],
  ["list_team_members", "List the account's team members with their roles and IDs.", { ...page }, []],
  ["get_revenue_report", "Revenue for a period, grouped by month, customer or product.", { start: str("First day of the period.", { format: "date" }), end: str("Last day of the period.", { format: "date" }), group_by: str("How to group the totals.", { enum: ["month", "customer", "product"] }), currency: str("Report currency.", { enum: ["THB", "USD", "EUR"] }) }, ["start", "end"]],
  ["export_report", "Export a report as CSV or PDF and return a download link valid for one hour.", { report: str("Which report.", { enum: ["revenue", "aging", "sales_pipeline", "payments"] }), format: str("File format.", { enum: ["csv", "pdf"] }), start: str("First day.", { format: "date" }), end: str("Last day.", { format: "date" }) }, ["report", "format"]],
  ["list_email_templates", "List the email templates available for invoices, reminders and quotes.", { kind: str("Only templates of this kind.", { enum: ["invoice", "reminder", "quote", "general"] }) }, []],
  ["send_email", "Send an email from the account's address to a customer, logged on their timeline.", { customer_id: str("The customer it is sent to."), subject: str("Subject line."), body: str("Plain text or Markdown body."), template_id: str("Use this template instead of a body.") }, ["customer_id"]],
  ["get_company_settings", "The account's company profile: legal name, tax ID, address, default currency and payment terms.", {}, []],
].map(([name, description, properties, required]) => ({
  name,
  description,
  inputSchema: { type: "object", properties, ...(required.length ? { required } : {}) },
}));

const owed = (customerId) =>
  db.invoices.filter((i) => i.customerId === customerId && i.status === "unpaid").reduce((sum, i) => sum + i.total, 0);

function call(name, args) {
  switch (name) {
    case "search_customers": {
      const q = String(args.query ?? "").toLowerCase();
      return db.customers.filter((c) => [c.id, c.name, c.city, c.email].some((v) => v.toLowerCase().includes(q)));
    }
    case "get_customer": {
      const c = db.customers.find((c) => c.id === args.customer_id);
      if (!c) throw new Error(`No customer ${args.customer_id}`);
      return { ...c, outstanding_balance: owed(c.id), currency: "THB", account_owner: "Nok (sales)" };
    }
    case "list_invoices":
      return db.invoices.filter(
        (i) =>
          (!args.customer_id || i.customerId === args.customer_id) &&
          (!args.status || i.status === args.status) &&
          (!args.due_before || i.dueDate < args.due_before) &&
          (!args.due_after || i.dueDate >= args.due_after),
      );
    case "get_invoice": {
      const i = db.invoices.find((i) => i.number === args.invoice_number);
      if (!i) throw new Error(`No invoice ${args.invoice_number}`);
      return { ...i, amount_due: i.status === "unpaid" ? i.total : 0 };
    }
    case "list_products":
      return db.products.filter((p) => !args.query || `${p.sku} ${p.name}`.toLowerCase().includes(String(args.query).toLowerCase()));
    case "get_product": {
      const p = db.products.find((p) => p.sku === args.sku);
      if (!p) throw new Error(`No product ${args.sku}`);
      return { ...p, stock: { bangkok: 40, chiang_mai: 12 } };
    }
    case "create_invoice": {
      if (!db.customers.some((c) => c.id === args.customer_id)) throw new Error(`No customer ${args.customer_id}`);
      const items = (args.items ?? []).map((line) => {
        const product = db.products.find((p) => p.sku === line.sku);
        return { ...line, unit_price: line.unit_price ?? product?.unitPrice ?? 0 };
      });
      const total = items.reduce((s, l) => s + l.quantity * l.unit_price, 0);
      const number = `INV-${db.nextInvoice++}`;
      db.invoices.push({ number, customerId: args.customer_id, total, currency: "THB", dueDate: args.due_date ?? "2026-11-02", status: "unpaid" });
      return { invoice_number: number, total, currency: "THB", status: "unpaid" };
    }
    case "get_company_settings":
      return { legal_name: "Acme Trading Co., Ltd.", tax_id: "0105556000000", currency: "THB", payment_terms_days: 30 };
    default:
      // The rest answer plausibly; the tasks don't need them.
      return { ok: true, note: `${name} done`, results: [] };
  }
}

const reply = (res, status, body) => {
  res.writeHead(status, { "content-type": "application/json", "mcp-session-id": "bench" });
  res.end(body === undefined ? "" : JSON.stringify(body));
};

createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    if (req.url === "/reset") {
      db = seed();
      calls = [];
      save();
      return reply(res, 200, { ok: true });
    }
    if (req.method !== "POST") return reply(res, 405, { error: "POST only" });
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return reply(res, 400, { error: "bad json" });
    }
    if (msg.id === undefined) return reply(res, 202);
    const ok = (result) => reply(res, 200, { jsonrpc: "2.0", id: msg.id, result });
    switch (msg.method) {
      case "initialize":
        return ok({ protocolVersion: msg.params?.protocolVersion ?? "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "acme-crm", version: "1.0.0" } });
      case "tools/list":
        return ok({ tools });
      case "tools/call": {
        const { name, arguments: args = {} } = msg.params ?? {};
        calls.push({ name, args });
        save();
        try {
          return ok({ content: [{ type: "text", text: JSON.stringify(call(name, args), null, 2) }] });
        } catch (e) {
          return ok({ content: [{ type: "text", text: String(e.message) }], isError: true });
        }
      }
      case "ping":
        return ok({});
      default:
        return reply(res, 200, { jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: "Method not found" } });
    }
  });
}).listen(port, "127.0.0.1", () => {
  save();
  console.log(`acme mock connector on http://127.0.0.1:${port}/mcp — ${tools.length} tools, ${JSON.stringify(tools).length} chars of definitions`);
});
