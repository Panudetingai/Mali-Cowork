//! Thai work templates (PRD v0.3 Epic E-FR3/FR4): real `.docx` layouts —
//! a quotation, an invoice, an official letter, meeting minutes — that the
//! agent fills with `{{placeholders}}`. Money documents compute their own
//! amounts, VAT and the total in words, so a model never does the arithmetic.
//!
//! The same filling works on the user's own `.docx`: any file with
//! `{{name}}` fields (and a table row with `{{item.…}}` for line items).

pub mod docx;
pub mod library;
pub mod thai;
pub mod tools;

use std::collections::BTreeMap;

use serde_json::Value;

use docx::{cell, Align, Block, Para, Table};

/// What an unfilled field shows, so the gap is visible on paper.
pub const BLANK: &str = "……………………";
/// Thai VAT.
const VAT_RATE: f64 = 0.07;

pub struct Template {
    pub id: &'static str,
    pub name: &'static str,
    pub description: &'static str,
    /// `(key, what it is)`; keys starting with `?` may be left out.
    pub fields: &'static [(&'static str, &'static str)],
    pub item_fields: &'static [(&'static str, &'static str)],
    /// Items carry `qty` and `unit_price`; totals are computed.
    pub money: bool,
    build: fn() -> Vec<Block>,
}

impl Template {
    pub fn bytes(&self) -> Vec<u8> {
        docx::build(&(self.build)())
    }
}

const COMPANY_FIELDS: [(&str, &str); 4] = [
    ("company_name", "ชื่อบริษัท/ร้านของผู้ออกเอกสาร"),
    ("company_address", "ที่อยู่ผู้ออกเอกสาร"),
    ("?company_tax_id", "เลขประจำตัวผู้เสียภาษีของผู้ออกเอกสาร"),
    ("?company_phone", "เบอร์โทร/อีเมลผู้ออกเอกสาร"),
];

pub fn catalog() -> Vec<Template> {
    vec![
        Template {
            id: "quotation",
            name: "ใบเสนอราคา",
            description: "ใบเสนอราคาพร้อมตารางรายการ คำนวณรวมเงิน ภาษีมูลค่าเพิ่ม 7% และจำนวนเงินเป็นตัวอักษรให้เอง",
            fields: &[
                COMPANY_FIELDS[0], COMPANY_FIELDS[1], COMPANY_FIELDS[2], COMPANY_FIELDS[3],
                ("doc_no", "เลขที่ใบเสนอราคา เช่น QT-2569-001"),
                ("?date", "วันที่ (ไม่ใส่ = วันนี้ แบบ พ.ศ.)"),
                ("customer_name", "ชื่อลูกค้า"),
                ("?customer_address", "ที่อยู่ลูกค้า"),
                ("?customer_tax_id", "เลขผู้เสียภาษีลูกค้า"),
                ("?valid_days", "ยืนราคากี่วัน (ไม่ใส่ = 30)"),
                ("?discount", "ส่วนลด (บาท)"),
                ("?terms", "เงื่อนไขการชำระเงิน/ส่งของ"),
                ("?signer_name", "ชื่อผู้เสนอราคา"),
                ("?signer_position", "ตำแหน่งผู้เสนอราคา"),
            ],
            item_fields: &[
                ("description", "รายการ"),
                ("qty", "จำนวน"),
                ("?unit", "หน่วย เช่น ชิ้น, ชุด, ชั่วโมง"),
                ("unit_price", "ราคาต่อหน่วย (บาท)"),
            ],
            money: true,
            build: || money_doc("ใบเสนอราคา", "QUOTATION", false),
        },
        Template {
            id: "invoice",
            name: "ใบแจ้งหนี้",
            description: "ใบแจ้งหนี้/ใบวางบิล คำนวณยอด ภาษีมูลค่าเพิ่ม 7% และจำนวนเงินเป็นตัวอักษรให้เอง",
            fields: &[
                COMPANY_FIELDS[0], COMPANY_FIELDS[1], COMPANY_FIELDS[2], COMPANY_FIELDS[3],
                ("doc_no", "เลขที่ใบแจ้งหนี้ เช่น INV-2569-001"),
                ("?date", "วันที่ (ไม่ใส่ = วันนี้ แบบ พ.ศ.)"),
                ("customer_name", "ชื่อลูกค้า"),
                ("?customer_address", "ที่อยู่ลูกค้า"),
                ("?customer_tax_id", "เลขผู้เสียภาษีลูกค้า"),
                ("?due_date", "ครบกำหนดชำระ"),
                ("?discount", "ส่วนลด (บาท)"),
                ("?payment_info", "ช่องทางชำระเงิน เช่น ธนาคาร เลขบัญชี"),
                ("?signer_name", "ชื่อผู้วางบิล"),
                ("?signer_position", "ตำแหน่งผู้วางบิล"),
            ],
            item_fields: &[
                ("description", "รายการ"),
                ("qty", "จำนวน"),
                ("?unit", "หน่วย"),
                ("unit_price", "ราคาต่อหน่วย (บาท)"),
            ],
            money: true,
            build: || money_doc("ใบแจ้งหนี้", "INVOICE", true),
        },
        Template {
            id: "official-letter",
            name: "หนังสือราชการ",
            description: "หนังสือภายนอกตามรูปแบบงานสารบรรณ: ที่ ส่วนราชการ วันที่ เรื่อง เรียน อ้างถึง สิ่งที่ส่งมาด้วย เนื้อความ ลงนาม",
            fields: &[
                ("doc_no", "เลขที่หนังสือ เช่น ศธ 0123/456"),
                ("org_name", "ชื่อส่วนราชการ/หน่วยงานเจ้าของหนังสือ"),
                ("?org_address", "ที่อยู่หน่วยงาน"),
                ("?date", "วันที่ (ไม่ใส่ = วันนี้ แบบ พ.ศ.)"),
                ("subject", "เรื่อง"),
                ("to", "เรียน (ตำแหน่งผู้รับ)"),
                ("?reference", "อ้างถึง"),
                ("?enclosures", "สิ่งที่ส่งมาด้วย"),
                ("body", "เนื้อความ (ย่อหน้าคั่นด้วยบรรทัดว่าง)"),
                ("closing", "ย่อหน้าสรุป เช่น จึงเรียนมาเพื่อโปรดพิจารณา"),
                ("signer_name", "ชื่อผู้ลงนาม"),
                ("signer_position", "ตำแหน่งผู้ลงนาม"),
                ("?department", "ส่วนราชการเจ้าของเรื่อง"),
                ("?phone", "โทรศัพท์"),
                ("?email", "อีเมล"),
            ],
            item_fields: &[],
            money: false,
            build: official_letter,
        },
        Template {
            id: "meeting-minutes",
            name: "บันทึกการประชุม",
            description: "รายงานการประชุม: ผู้เข้าประชุม สรุปวาระ มติ และตารางงานที่ต้องทำพร้อมผู้รับผิดชอบ",
            fields: &[
                ("meeting_title", "ชื่อการประชุม"),
                ("?meeting_no", "ครั้งที่"),
                ("?date", "วันที่ (ไม่ใส่ = วันนี้ แบบ พ.ศ.)"),
                ("?time", "เวลาเริ่ม"),
                ("?place", "สถานที่ หรือช่องทางออนไลน์"),
                ("attendees", "ผู้เข้าประชุม (บรรทัดละคน)"),
                ("?absent", "ผู้ไม่มาประชุม"),
                ("summary", "สรุปตามวาระ"),
                ("?resolutions", "มติที่ประชุม"),
                ("?end_time", "เวลาปิดประชุม"),
                ("?recorder", "ผู้บันทึก"),
                ("?reviewer", "ผู้ตรวจรายงาน"),
            ],
            item_fields: &[("task", "งานที่ต้องทำ"), ("owner", "ผู้รับผิดชอบ"), ("?due", "กำหนดเสร็จ")],
            money: false,
            build: meeting_minutes,
        },
    ]
}

pub fn find_builtin(id: &str) -> Option<Template> {
    let id = id.trim().trim_end_matches(".docx");
    catalog().into_iter().find(|t| t.id == id || t.name == id)
}

/// A template by id or name — built-in or the user's own.
pub struct Resolved {
    pub name: String,
    pub bytes: Vec<u8>,
    /// Built-ins say; for the user's own, it depends on the items (see `money_for`).
    pub money: Option<bool>,
}

pub fn resolve(name_or_id: &str) -> Option<Resolved> {
    if let Some(t) = find_builtin(name_or_id) {
        return Some(Resolved { name: t.name.to_string(), bytes: t.bytes(), money: Some(t.money) });
    }
    let user = library::find(name_or_id)?;
    let bytes = library::bytes_of(&user.id).ok()?;
    Some(Resolved { name: user.name, bytes, money: None })
}

/// The user's own template computes money when it has a `{{total}}` and the items carry prices.
pub fn money_for(fields: &[String], items: &Value) -> bool {
    let priced = items.as_array().is_some_and(|items| items.iter().any(|i| i.get("unit_price").is_some() || i.get("price").is_some()));
    priced && fields.iter().any(|f| f.trim_start_matches('?') == "total")
}

/// Every template, for the Settings page.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TemplateInfo {
    pub id: String,
    pub name: String,
    pub description: String,
    pub fields: Vec<String>,
    pub money: bool,
    pub builtin: bool,
    pub enabled: bool,
}

pub fn list_all() -> Vec<TemplateInfo> {
    let mut out: Vec<TemplateInfo> = catalog()
        .into_iter()
        .map(|t| TemplateInfo {
            id: t.id.into(),
            name: t.name.into(),
            description: t.description.into(),
            fields: t.fields.iter().map(|(k, _)| k.to_string()).chain(t.item_fields.iter().map(|(k, _)| format!("item.{}", k.trim_start_matches('?')))).collect(),
            money: t.money,
            builtin: true,
            enabled: true,
        })
        .collect();
    out.extend(library::load().into_iter().map(|t| TemplateInfo {
        money: t.fields.iter().any(|f| f.trim_start_matches('?') == "total"),
        id: t.id,
        name: t.name,
        description: t.description,
        fields: t.fields,
        builtin: false,
        enabled: t.enabled,
    }));
    out
}

// ---------------------------------------------------------------- layouts

fn borderless(widths: Vec<u32>, rows: Vec<Vec<docx::Cell>>) -> Block {
    Block::Table(Table { widths, rows, borders: false, header_rows: 0 })
}

fn money_doc(title: &str, english: &str, invoice: bool) -> Vec<Block> {
    let right = |t: &str| cell(t).align(Align::Right);
    let (third_left, third_right) = if invoice {
        ("**เลขประจำตัวผู้เสียภาษี:** {{?customer_tax_id}}", "**ครบกำหนดชำระ:** {{?due_date}}")
    } else {
        ("**เลขประจำตัวผู้เสียภาษี:** {{?customer_tax_id}}", "**ยืนราคา:** {{valid_days}} วัน")
    };
    let mut blocks = vec![
        Block::Para(Para::new("{{company_name}}").bold().size(36)),
        Block::Para(Para::new("{{company_address}}")),
        Block::Para(Para::new("เลขประจำตัวผู้เสียภาษี {{?company_tax_id}}")),
        Block::Para(Para::new("ติดต่อ {{?company_phone}}").after(200)),
        Block::Para(Para::new(title).bold().size(44).align(Align::Center)),
        Block::Para(Para::new(english).size(28).align(Align::Center).after(200)),
        borderless(
            vec![5571, 3500],
            vec![
                vec![cell("**ลูกค้า:** {{customer_name}}"), cell("**เลขที่:** {{doc_no}}")],
                vec![cell("**ที่อยู่:** {{?customer_address}}"), cell("**วันที่:** {{date}}")],
                vec![cell(third_left), cell(third_right)],
            ],
        ),
        Block::Table(Table {
            widths: vec![900, 3371, 1000, 900, 1500, 1400],
            rows: vec![
                ["ลำดับ", "รายการ", "จำนวน", "หน่วย", "ราคาต่อหน่วย", "จำนวนเงิน"]
                    .iter()
                    .map(|h| cell(*h).align(Align::Center))
                    .collect(),
                vec![
                    cell("{{item.no}}").align(Align::Center),
                    cell("{{item.description}}"),
                    right("{{item.qty}}"),
                    cell("{{item.unit}}").align(Align::Center),
                    right("{{item.unit_price}}"),
                    right("{{item.amount}}"),
                ],
                vec![right("รวมเป็นเงิน").span(5), right("{{subtotal}}")],
                vec![right("ส่วนลด").span(5), right("{{discount}}")],
                vec![right("{{vat_label}}").span(5), right("{{vat}}")],
                vec![right("**จำนวนเงินรวมทั้งสิ้น**").span(5), right("**{{total}}**")],
                vec![cell("({{total_text}})").align(Align::Center).bold().span(6)],
            ],
            borders: true,
            header_rows: 1,
        }),
    ];
    blocks.push(Block::Para(Para::new(if invoice {
        "**ช่องทางชำระเงิน:** {{?payment_info}}"
    } else {
        "**เงื่อนไข:** {{?terms}}"
    })));
    blocks.push(Block::Para(Para::new("").after(600)));
    let (left, right_role) = if invoice { ("ผู้รับวางบิล", "ผู้วางบิล") } else { ("ผู้อนุมัติสั่งซื้อ", "ผู้เสนอราคา") };
    let centered = |t: String| cell(t).align(Align::Center);
    blocks.push(borderless(
        vec![4535, 4536],
        vec![
            vec![centered("ลงชื่อ ................................".into()), centered("ลงชื่อ ................................".into())],
            vec![centered("(................................)".into()), centered("({{?signer_name}})".into())],
            vec![centered(left.into()), centered(right_role.into())],
            vec![centered("วันที่ ......../......../........".into()), centered("{{?signer_position}}".into())],
        ],
    ));
    blocks
}

fn official_letter() -> Vec<Block> {
    vec![
        borderless(
            vec![4535, 4536],
            vec![vec![cell("ที่ {{doc_no}}"), cell("{{org_name}}\n{{?org_address}}")]],
        ),
        Block::Para(Para::new("{{date}}").align(Align::Center).after(240)),
        Block::Para(Para::new("**เรื่อง**  {{subject}}").after(120)),
        Block::Para(Para::new("**เรียน**  {{to}}").after(120)),
        Block::Para(Para::new("**อ้างถึง**  {{?reference}}").after(120)),
        Block::Para(Para::new("**สิ่งที่ส่งมาด้วย**  {{?enclosures}}").after(240)),
        Block::Para(Para::new("{{body}}").indent(1418).align(Align::Both).after(240)),
        Block::Para(Para::new("{{closing}}").indent(1418).align(Align::Both).after(480)),
        Block::Para(Para::new("ขอแสดงความนับถือ").align(Align::Center).after(960)),
        Block::Para(Para::new("({{signer_name}})").align(Align::Center)),
        Block::Para(Para::new("{{signer_position}}").align(Align::Center).after(720)),
        Block::Para(Para::new("{{?department}}")),
        Block::Para(Para::new("โทร. {{?phone}}")),
        Block::Para(Para::new("อีเมล {{?email}}")),
    ]
}

fn meeting_minutes() -> Vec<Block> {
    vec![
        Block::Para(Para::new("บันทึกการประชุม").bold().size(40).align(Align::Center)),
        Block::Para(Para::new("{{meeting_title}}").bold().align(Align::Center)),
        Block::Para(Para::new("ครั้งที่ {{?meeting_no}}").align(Align::Center)),
        Block::Para(Para::new("วันที่ {{date}}").align(Align::Center)),
        Block::Para(Para::new("เวลา {{?time}}").align(Align::Center)),
        Block::Para(Para::new("ณ {{?place}}").align(Align::Center).after(240)),
        Block::Para(Para::new("**ผู้เข้าประชุม**")),
        Block::Para(Para::new("{{attendees}}").left(720).after(120)),
        Block::Para(Para::new("**ผู้ไม่มาประชุม**  {{?absent}}").after(120)),
        Block::Para(Para::new("**สรุปการประชุม**")),
        Block::Para(Para::new("{{summary}}").left(720).after(120)),
        Block::Para(Para::new("**มติที่ประชุม**  {{?resolutions}}").after(240)),
        Block::Para(Para::new("**งานที่ต้องดำเนินการ**")),
        Block::Table(Table {
            widths: vec![900, 4171, 2200, 1800],
            rows: vec![
                ["ลำดับ", "งานที่ต้องทำ", "ผู้รับผิดชอบ", "กำหนดเสร็จ"].iter().map(|h| cell(*h).align(Align::Center)).collect(),
                vec![
                    cell("{{item.no}}").align(Align::Center),
                    cell("{{item.task}}"),
                    cell("{{item.owner}}"),
                    cell("{{item.due}}").align(Align::Center),
                ],
            ],
            borders: true,
            header_rows: 1,
        }),
        Block::Para(Para::new("ปิดประชุมเวลา {{?end_time}}").after(480)),
        Block::Para(Para::new("ผู้บันทึกการประชุม  {{?recorder}}").align(Align::Right)),
        Block::Para(Para::new("ผู้ตรวจรายงานการประชุม  {{?reviewer}}").align(Align::Right)),
    ]
}

// ---------------------------------------------------------------- values

fn as_text(value: &Value) -> Option<String> {
    match value {
        Value::Null => None,
        Value::String(s) => Some(s.trim().to_string()).filter(|s| !s.is_empty()),
        Value::Number(n) => Some(n.to_string()),
        Value::Bool(b) => Some(b.to_string()),
        Value::Array(list) => {
            let lines: Vec<String> = list.iter().filter_map(as_text).collect();
            (!lines.is_empty()).then(|| lines.join("\n"))
        }
        Value::Object(_) => Some(value.to_string()),
    }
}

fn as_number(value: Option<&Value>) -> Option<f64> {
    match value? {
        Value::Number(n) => n.as_f64(),
        Value::String(s) => thai::parse_amount(s),
        _ => None,
    }
}

/// What filling came to: values for every placeholder, and a summary for the agent.
pub struct Prepared {
    pub values: BTreeMap<String, String>,
    pub items: Vec<BTreeMap<String, String>>,
    pub summary: Vec<String>,
}

/// Turn the agent's JSON into placeholder values; money templates get their
/// amounts, VAT and total in words computed here.
pub fn prepare(money: bool, values: &Value, items: &Value, vat: Option<&str>) -> Result<Prepared, String> {
    let mut out: BTreeMap<String, String> = BTreeMap::new();
    for (key, value) in values.as_object().into_iter().flatten() {
        if let Some(text) = as_text(value) {
            out.insert(key.trim_start_matches('?').to_string(), text);
        }
    }
    out.entry("date".into()).or_insert_with(thai::today_thai);
    let mut rows = Vec::new();
    let mut summary = Vec::new();
    let list: Vec<&Value> = items.as_array().map(|a| a.iter().collect()).unwrap_or_default();

    if money {
        let mut subtotal = 0.0;
        for (i, item) in list.iter().enumerate() {
            let qty = as_number(item.get("qty").or_else(|| item.get("quantity"))).unwrap_or(1.0);
            let price = as_number(item.get("unit_price").or_else(|| item.get("price")))
                .ok_or_else(|| format!("Item {} has no unit_price.", i + 1))?;
            let amount = (qty * price * 100.0).round() / 100.0;
            subtotal += amount;
            let mut row: BTreeMap<String, String> = BTreeMap::new();
            for (k, v) in item.as_object().into_iter().flatten() {
                if let Some(t) = as_text(v) {
                    row.insert(k.clone(), t);
                }
            }
            row.insert("no".into(), (i + 1).to_string());
            row.insert("qty".into(), thai::number(qty));
            row.insert("unit_price".into(), thai::money(price));
            row.insert("amount".into(), thai::money(amount));
            row.entry("unit".into()).or_default();
            rows.push(row);
        }
        if rows.is_empty() {
            return Err("A money document needs at least one item with a unit_price.".into());
        }
        let discount = as_number(values.get("discount")).unwrap_or(0.0).max(0.0);
        let after_discount = subtotal - discount;
        let add_vat = !matches!(vat.map(str::trim), Some("none" | "exempt" | "0" | "no"));
        let vat_amount = if add_vat { (after_discount * VAT_RATE * 100.0).round() / 100.0 } else { 0.0 };
        let total = after_discount + vat_amount;
        out.insert("subtotal".into(), thai::money(subtotal));
        out.insert("discount".into(), thai::money(discount));
        out.insert("vat".into(), thai::money(vat_amount));
        out.insert(
            "vat_label".into(),
            if add_vat { "ภาษีมูลค่าเพิ่ม 7%".into() } else { "ภาษีมูลค่าเพิ่ม (ไม่คิด)".into() },
        );
        out.insert("total".into(), thai::money(total));
        out.insert("total_text".into(), thai::baht_text(total));
        out.entry("valid_days".into()).or_insert_with(|| "30".into());
        summary.push(format!(
            "Totals: subtotal {} − discount {} + VAT {} = {} ({})",
            thai::money(subtotal),
            thai::money(discount),
            thai::money(vat_amount),
            thai::money(total),
            thai::baht_text(total)
        ));
    } else {
        for (i, item) in list.iter().enumerate() {
            let mut row: BTreeMap<String, String> = BTreeMap::new();
            for (k, v) in item.as_object().into_iter().flatten() {
                if let Some(t) = as_text(v) {
                    row.insert(k.clone(), t);
                }
            }
            row.insert("no".into(), (i + 1).to_string());
            rows.push(row);
        }
    }
    Ok(Prepared { values: out, items: rows, summary })
}

/// The catalog as the agent reads it.
pub fn describe_catalog() -> String {
    let mut out = String::from(
        "Built-in templates (pass the id as `template`). Fields starting with ? are optional — leave them out \
and that line is dropped from the document.\n",
    );
    for t in catalog() {
        out.push_str(&format!("\n## {} — {}\n{}\n", t.id, t.name, t.description));
        out.push_str("Fields: ");
        out.push_str(&t.fields.iter().map(|(k, d)| format!("{k} ({d})")).collect::<Vec<_>>().join("; "));
        if !t.item_fields.is_empty() {
            out.push_str("\nitems[]: ");
            out.push_str(&t.item_fields.iter().map(|(k, d)| format!("{k} ({d})")).collect::<Vec<_>>().join("; "));
        }
        if t.money {
            out.push_str("\nComputed for you: each item's amount, subtotal, VAT 7% (vat: \"none\" to leave it out), total and total in Thai words.");
        }
        out.push('\n');
    }
    let own: Vec<_> = library::load().into_iter().filter(|t| t.enabled).collect();
    if !own.is_empty() {
        out.push_str("\n# The user's own templates (pass the name or id as `template`)\n");
        for t in own {
            out.push_str(&format!("\n## {} — {}\n", t.id, t.name));
            if !t.description.is_empty() {
                out.push_str(&format!("{}\n", t.description));
            }
            out.push_str(&format!("Fields: {}\n", t.fields.join(", ")));
            if t.fields.iter().any(|f| f.trim_start_matches('?') == "total") {
                out.push_str("Give items with qty and unit_price and the amounts, VAT and total in words are computed.\n");
            }
        }
    }
    out.push_str(
        "\nAny other .docx with {{fields}} works too: pass its path as `template`. A document with no fields \
yet can become a template with make_template.",
    );
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn every_template_builds_and_lists_its_fields() {
        for t in catalog() {
            let bytes = t.bytes();
            let found = docx::placeholders(&bytes).unwrap();
            for (key, _) in t.fields {
                let key = key.trim_start_matches('?');
                assert!(
                    found.iter().any(|f| f.trim_start_matches('?') == key),
                    "{}: {key} isn't in the layout ({found:?})",
                    t.id
                );
            }
        }
    }

    #[test]
    fn a_quotation_computes_its_totals() {
        let t = find_builtin("quotation").unwrap();
        let prepared = prepare(
            true,
            &json!({ "company_name": "ร้านกาแฟ", "doc_no": "QT-001", "customer_name": "คุณเอ", "discount": 100 }),
            &json!([
                { "description": "เมล็ดกาแฟ 1 กก.", "qty": 2, "unit": "ถุง", "unit_price": "650" },
                { "description": "แก้วกระดาษ", "qty": 100, "unit_price": 2.5 }
            ]),
            None,
        )
        .unwrap();
        assert_eq!(prepared.values["subtotal"], "1,550.00");
        assert_eq!(prepared.values["vat"], "101.50");
        assert_eq!(prepared.values["total"], "1,551.50");
        assert_eq!(prepared.values["total_text"], "หนึ่งพันห้าร้อยห้าสิบเอ็ดบาทห้าสิบสตางค์");
        let (doc, missing) = docx::fill(&t.bytes(), &prepared.values, &prepared.items, BLANK).unwrap();
        let text = docx::read_text(&doc).unwrap();
        assert!(text.contains("| 1 | เมล็ดกาแฟ 1 กก. | 2 | ถุง | 650.00 | 1,300.00 |"), "{text}");
        assert!(text.contains("| 2 | แก้วกระดาษ | 100 |  | 2.50 | 250.00 |"), "{text}");
        assert!(text.contains("(หนึ่งพันห้าร้อยห้าสิบเอ็ดบาทห้าสิบสตางค์)"));
        // Optional fields left out drop their line instead of showing a gap.
        assert!(!text.contains("เลขประจำตัวผู้เสียภาษี ……"), "{text}");
        // A required field nobody gave is reported, so the agent can ask for it.
        assert_eq!(missing, ["company_address"]);
    }

    /// `MALI_TEMPLATE_SAMPLES=/some/dir cargo test -- --ignored template_samples`
    /// writes a filled copy of every template, to look at in Word.
    #[test]
    #[ignore = "writes sample documents to MALI_TEMPLATE_SAMPLES"]
    fn template_samples() {
        let dir = std::path::PathBuf::from(std::env::var("MALI_TEMPLATE_SAMPLES").expect("MALI_TEMPLATE_SAMPLES"));
        std::fs::create_dir_all(&dir).unwrap();
        let company = json!({ "company_name": "Cups Of Hope Coffee", "company_address": "99/9 ถ.สุขุมวิท แขวงคลองเตย เขตคลองเตย กรุงเทพฯ 10110",
            "company_tax_id": "0105569012345", "company_phone": "02-123-4567 · hello@cupsofhope.co",
            "doc_no": "QT-2569-001", "customer_name": "บริษัท ตัวอย่าง จำกัด", "customer_address": "123 ถ.พระราม 9 กรุงเทพฯ",
            "terms": "ชำระ 50% เมื่อยืนยัน ส่วนที่เหลือเมื่อส่งมอบ", "signer_name": "สมหญิง ใจดี", "signer_position": "ผู้จัดการฝ่ายขาย",
            "due_date": "31 ตุลาคม 2569", "payment_info": "ธ.กสิกรไทย 123-4-56789-0 บจก.คัพส์ออฟโฮป" });
        let items = json!([
            { "description": "กาแฟลาเต้ (สำหรับงานสัมมนา)", "qty": 120, "unit": "แก้ว", "unit_price": 55 },
            { "description": "ครัวซองต์เนยสด", "qty": 120, "unit": "ชิ้น", "unit_price": 45 },
            { "description": "ค่าบริการจัดเลี้ยงและขนส่ง", "qty": 1, "unit": "งาน", "unit_price": 3500 }
        ]);
        let letter = json!({ "doc_no": "มก 0501/123", "org_name": "มหาวิทยาลัยตัวอย่าง", "org_address": "50 ถ.งามวงศ์วาน กรุงเทพฯ 10900",
            "subject": "ขอความอนุเคราะห์ใช้สถานที่จัดกิจกรรม", "to": "ผู้อำนวยการสำนักงานเขต", "reference": "หนังสือที่ มก 0501/99 ลงวันที่ 1 กันยายน 2569",
            "body": "ด้วยคณะฯ มีกำหนดจัดกิจกรรมวันกาแฟสากล ในวันที่ 1 ตุลาคม 2569 เวลา 09.00–16.00 น. จึงขอความอนุเคราะห์ใช้ลานกิจกรรมหน้าสำนักงานเขตเป็นสถานที่จัดงาน",
            "closing": "จึงเรียนมาเพื่อโปรดพิจารณาให้ความอนุเคราะห์ ขอบคุณมา ณ โอกาสนี้", "signer_name": "นายสมชาย ใจงาม", "signer_position": "คณบดีคณะเกษตร",
            "department": "งานกิจการนิสิต คณะเกษตร", "phone": "02-579-0000" });
        let minutes = json!({ "meeting_title": "ประชุมวางแผนเปิดสาขาใหม่", "meeting_no": "3/2569", "time": "10.00 น.", "place": "ห้องประชุม 2 / Google Meet",
            "attendees": "1. คุณเอ (ประธาน)\n2. คุณบี\n3. คุณซี", "summary": "วาระที่ 1 ทำเลสาขาใหม่: เลือกย่านอารีย์\nวาระที่ 2 งบประมาณ: 1.2 ล้านบาท",
            "resolutions": "อนุมัติทำเลและงบประมาณตามเสนอ", "end_time": "11.30 น.", "recorder": "คุณบี" });
        let tasks = json!([{ "task": "ติดต่อเจ้าของพื้นที่", "owner": "คุณเอ", "due": "5 ต.ค. 2569" }, { "task": "ทำแบบร่างร้าน", "owner": "คุณซี", "due": "15 ต.ค. 2569" }]);
        for (id, values, items) in [
            ("quotation", &company, &items),
            ("invoice", &company, &items),
            ("official-letter", &letter, &json!([])),
            ("meeting-minutes", &minutes, &tasks),
        ] {
            let t = find_builtin(id).unwrap();
            let p = prepare(t.money, values, items, None).unwrap();
            let (doc, _) = docx::fill(&t.bytes(), &p.values, &p.items, BLANK).unwrap();
            std::fs::write(dir.join(format!("{id}.docx")), doc).unwrap();
        }
    }

    #[test]
    fn vat_can_be_left_out() {
        let p = prepare(true, &json!({}), &json!([{ "description": "x", "qty": 1, "unit_price": 1000 }]), Some("none")).unwrap();
        assert_eq!(p.values["total"], "1,000.00");
        assert_eq!(p.values["total_text"], "หนึ่งพันบาทถ้วน");
    }

    #[test]
    fn a_letter_drops_the_lines_it_has_no_value_for() {
        let t = find_builtin("official-letter").unwrap();
        let p = prepare(
            false,
            &json!({ "doc_no": "ที่ 1/2569", "org_name": "สำนักงาน", "subject": "ขอความอนุเคราะห์", "to": "ผู้อำนวยการ",
                     "body": "ด้วย…", "closing": "จึงเรียนมาเพื่อโปรดพิจารณา", "signer_name": "นายเอ", "signer_position": "หัวหน้า" }),
            &json!([]),
            None,
        )
        .unwrap();
        let (doc, missing) = docx::fill(&t.bytes(), &p.values, &p.items, BLANK).unwrap();
        let text = docx::read_text(&doc).unwrap();
        assert!(text.contains("เรื่อง  ขอความอนุเคราะห์"));
        assert!(!text.contains("อ้างถึง"), "{text}");
        assert!(missing.is_empty(), "{missing:?}");
    }
}
