//! Word documents without Word: build a `.docx` from simple blocks, read one
//! back as text, and fill a template's `{{placeholders}}` — including a table
//! row that repeats once per item (`{{item.description}}`).
//!
//! Word often splits what the user typed as `{{name}}` over several runs
//! (a spell-check mark, a font change). Before filling, the runs of any
//! paragraph that holds `{{` are merged, so the placeholder is whole again.

use std::collections::BTreeMap;
use std::io::{Cursor, Read, Write};

use regex::Regex;

/// The default font for Thai documents (government and business use it).
pub const THAI_FONT: &str = "TH Sarabun New";

pub fn escape(text: &str) -> String {
    text.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}

fn unescape(text: &str) -> String {
    text.replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", "\"").replace("&apos;", "'").replace("&amp;", "&")
}

// ---------------------------------------------------------------- building

#[derive(Clone, Copy, PartialEq)]
pub enum Align {
    Left,
    Center,
    Right,
    Both,
}

impl Align {
    fn xml(self) -> &'static str {
        match self {
            Align::Left => "left",
            Align::Center => "center",
            Align::Right => "right",
            Align::Both => "thaiDistribute",
        }
    }
}

/// A run of text: `**bold**` segments are bold.
pub struct Para {
    pub text: String,
    pub align: Align,
    pub size: u32,
    pub bold: bool,
    /// First-line indent in twentieths of a point (Thai letters indent 2.5 cm).
    pub indent: u32,
    /// Indent of every line, for lists and blocks of text.
    pub left: u32,
    pub space_after: u32,
}

impl Para {
    pub fn new(text: impl Into<String>) -> Self {
        Self { text: text.into(), align: Align::Left, size: 32, bold: false, indent: 0, left: 0, space_after: 0 }
    }
    pub fn align(mut self, align: Align) -> Self {
        self.align = align;
        self
    }
    pub fn size(mut self, half_points: u32) -> Self {
        self.size = half_points;
        self
    }
    pub fn bold(mut self) -> Self {
        self.bold = true;
        self
    }
    pub fn indent(mut self, twips: u32) -> Self {
        self.indent = twips;
        self
    }
    pub fn left(mut self, twips: u32) -> Self {
        self.left = twips;
        self
    }
    pub fn after(mut self, twips: u32) -> Self {
        self.space_after = twips;
        self
    }
}

pub struct Cell {
    pub text: String,
    pub align: Align,
    pub bold: bool,
    /// Columns this cell spans.
    pub span: u32,
}

pub fn cell(text: impl Into<String>) -> Cell {
    Cell { text: text.into(), align: Align::Left, bold: false, span: 1 }
}

impl Cell {
    pub fn align(mut self, align: Align) -> Self {
        self.align = align;
        self
    }
    pub fn bold(mut self) -> Self {
        self.bold = true;
        self
    }
    pub fn span(mut self, span: u32) -> Self {
        self.span = span;
        self
    }
}

pub struct Table {
    /// Column widths in twentieths of a point (the page body is about 9,000).
    pub widths: Vec<u32>,
    pub rows: Vec<Vec<Cell>>,
    pub borders: bool,
    /// Rows (by index) shaded as a header.
    pub header_rows: usize,
}

pub enum Block {
    Para(Para),
    Table(Table),
}

fn run(text: &str, bold: bool, size: u32) -> String {
    let props = format!(
        "<w:rPr>{}<w:sz w:val=\"{size}\"/><w:szCs w:val=\"{size}\"/></w:rPr>",
        if bold { "<w:b/><w:bCs/>" } else { "" }
    );
    // Line breaks inside a value become real line breaks.
    let parts: Vec<String> = text
        .split('\n')
        .map(|line| format!("<w:t xml:space=\"preserve\">{}</w:t>", escape(line)))
        .collect();
    format!("<w:r>{props}{}</w:r>", parts.join("<w:br/>"))
}

/// `**bold**` inside a paragraph's text.
fn runs(text: &str, bold: bool, size: u32) -> String {
    text.split("**")
        .enumerate()
        .filter(|(_, part)| !part.is_empty())
        .map(|(i, part)| run(part, bold || i % 2 == 1, size))
        .collect()
}

fn para_xml(p: &Para) -> String {
    let indent = match (p.left, p.indent) {
        (0, 0) => String::new(),
        (left, first) => format!("<w:ind w:left=\"{left}\" w:firstLine=\"{first}\"/>"),
    };
    format!(
        "<w:p><w:pPr><w:spacing w:after=\"{}\" w:line=\"240\" w:lineRule=\"auto\"/>{indent}<w:jc w:val=\"{}\"/></w:pPr>{}</w:p>",
        p.space_after,
        p.align.xml(),
        runs(&p.text, p.bold, p.size)
    )
}

fn table_xml(t: &Table) -> String {
    let border = if t.borders { "single" } else { "nil" };
    let borders = ["top", "left", "bottom", "right", "insideH", "insideV"]
        .iter()
        .map(|side| format!("<w:{side} w:val=\"{border}\" w:sz=\"4\" w:space=\"0\" w:color=\"808080\"/>"))
        .collect::<String>();
    let grid: String = t.widths.iter().map(|w| format!("<w:gridCol w:w=\"{w}\"/>")).collect();
    let total: u32 = t.widths.iter().sum();
    let mut rows = String::new();
    for (r, row) in t.rows.iter().enumerate() {
        rows.push_str("<w:tr>");
        let mut col = 0usize;
        for c in row {
            let span = c.span.max(1) as usize;
            let width: u32 = t.widths[col.min(t.widths.len() - 1)..(col + span).min(t.widths.len())].iter().sum();
            col += span;
            let shade = if r < t.header_rows { "<w:shd w:val=\"clear\" w:color=\"auto\" w:fill=\"E7E6E6\"/>" } else { "" };
            let gridspan = if span > 1 { format!("<w:gridSpan w:val=\"{span}\"/>") } else { String::new() };
            rows.push_str(&format!(
                "<w:tc><w:tcPr><w:tcW w:w=\"{width}\" w:type=\"dxa\"/>{gridspan}{shade}</w:tcPr><w:p><w:pPr><w:spacing w:after=\"0\"/><w:jc w:val=\"{}\"/></w:pPr>{}</w:p></w:tc>",
                c.align.xml(),
                runs(&c.text, c.bold || r < t.header_rows, 30)
            ));
        }
        rows.push_str("</w:tr>");
    }
    format!(
        "<w:tbl><w:tblPr><w:tblW w:w=\"{total}\" w:type=\"dxa\"/><w:tblBorders>{borders}</w:tblBorders><w:tblLayout w:type=\"fixed\"/><w:tblCellMar><w:left w:w=\"80\" w:type=\"dxa\"/><w:right w:w=\"80\" w:type=\"dxa\"/></w:tblCellMar></w:tblPr><w:tblGrid>{grid}</w:tblGrid>{rows}</w:tbl>"
    )
}

const CONTENT_TYPES: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>"#;

const ROOT_RELS: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>"#;

const DOC_RELS: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>"#;

fn styles_xml() -> String {
    format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="{f}" w:hAnsi="{f}" w:eastAsia="{f}" w:cs="{f}"/><w:sz w:val="32"/><w:szCs w:val="32"/><w:lang w:val="th-TH" w:eastAsia="en-US" w:bidi="th-TH"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style></w:styles>"#,
        f = THAI_FONT
    )
}

/// A whole `.docx` (A4, 2.5 cm margins; 3 cm on the left, as Thai letters use).
pub fn build(blocks: &[Block]) -> Vec<u8> {
    let body: String = blocks
        .iter()
        .map(|b| match b {
            Block::Para(p) => para_xml(p),
            Block::Table(t) => table_xml(t) + "<w:p/>",
        })
        .collect();
    let document = format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>{body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1418" w:right="1134" w:bottom="1134" w:left="1701" w:header="709" w:footer="709" w:gutter="0"/></w:sectPr></w:body></w:document>"#
    );
    let mut out = Cursor::new(Vec::new());
    {
        let mut zip = zip::ZipWriter::new(&mut out);
        let options = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
        for (name, content) in [
            ("[Content_Types].xml", CONTENT_TYPES.to_string()),
            ("_rels/.rels", ROOT_RELS.to_string()),
            ("word/_rels/document.xml.rels", DOC_RELS.to_string()),
            ("word/styles.xml", styles_xml()),
            ("word/document.xml", document),
        ] {
            zip.start_file(name, options).expect("zip entry");
            zip.write_all(content.as_bytes()).expect("zip write");
        }
        zip.finish().expect("zip finish");
    }
    out.into_inner()
}

// ---------------------------------------------------------------- reading

/// The parts of a `.docx` that hold text: the body, headers and footers.
fn text_parts(names: &[String]) -> Vec<String> {
    names
        .iter()
        .filter(|n| {
            *n == "word/document.xml"
                || (n.starts_with("word/header") && n.ends_with(".xml"))
                || (n.starts_with("word/footer") && n.ends_with(".xml"))
        })
        .cloned()
        .collect()
}

fn open(bytes: &[u8]) -> Result<zip::ZipArchive<Cursor<&[u8]>>, String> {
    zip::ZipArchive::new(Cursor::new(bytes)).map_err(|_| "That isn't a Word (.docx) file.".to_string())
}

fn read_entry(zip: &mut zip::ZipArchive<Cursor<&[u8]>>, name: &str) -> Result<String, String> {
    let mut entry = zip.by_name(name).map_err(|e| e.to_string())?;
    let mut text = String::new();
    entry.read_to_string(&mut text).map_err(|e| e.to_string())?;
    Ok(text)
}

fn paragraph_text(xml: &str) -> String {
    static T: std::sync::OnceLock<Regex> = std::sync::OnceLock::new();
    let t = T.get_or_init(|| Regex::new(r"<w:t(?:\s[^>]*)?>([^<]*)</w:t>|<w:br/>|<w:tab/>").unwrap());
    t.captures_iter(xml)
        .map(|c| match c.get(1) {
            Some(text) => unescape(text.as_str()),
            None if c[0].starts_with("<w:br") => "\n".into(),
            None => "\t".into(),
        })
        .collect()
}

/// The document as plain text: paragraphs on lines, table cells joined by " | ".
pub fn read_text(bytes: &[u8]) -> Result<String, String> {
    let mut zip = open(bytes)?;
    let names: Vec<String> = zip.file_names().map(str::to_string).collect();
    let mut out = Vec::new();
    for name in text_parts(&names) {
        let xml = read_entry(&mut zip, &name)?;
        static CELL: std::sync::OnceLock<Regex> = std::sync::OnceLock::new();
        static PARA: std::sync::OnceLock<Regex> = std::sync::OnceLock::new();
        let cell = CELL.get_or_init(|| Regex::new(r"(?s)<w:tc[ >].*?</w:tc>").unwrap());
        let para = PARA.get_or_init(|| Regex::new(r"(?s)<w:p[ >].*?</w:p>|<w:p/>|(?s)<w:tr[ >].*?</w:tr>").unwrap());
        for m in para.find_iter(&xml) {
            let chunk = m.as_str();
            if chunk.starts_with("<w:tr") {
                let cells: Vec<String> = cell
                    .find_iter(chunk)
                    .map(|c| paragraph_text(c.as_str()).replace('\n', " ").trim().to_string())
                    .collect();
                out.push(format!("| {} |", cells.join(" | ")));
            } else {
                out.push(paragraph_text(chunk));
            }
        }
    }
    let text = out.join("\n");
    Ok(text.split("\n\n\n").collect::<Vec<_>>().join("\n\n").trim().to_string())
}

static PLACEHOLDER: std::sync::OnceLock<Regex> = std::sync::OnceLock::new();

fn placeholder_re() -> &'static Regex {
    PLACEHOLDER.get_or_init(|| Regex::new(r"\{\{\s*(\??[A-Za-z0-9_.\-]+)\s*\}\}").unwrap())
}

/// Placeholders a template asks for, in order: `name`, `item.qty`…
pub fn placeholders(bytes: &[u8]) -> Result<Vec<String>, String> {
    let text = read_text(bytes)?;
    let mut seen = Vec::new();
    for c in placeholder_re().captures_iter(&text) {
        let name = c[1].to_string();
        if !seen.contains(&name) {
            seen.push(name);
        }
    }
    Ok(seen)
}

// ---------------------------------------------------------------- filling

/// Merge the runs of a paragraph that holds `{{`, so a placeholder Word split
/// apart is whole again. The first run keeps its formatting.
fn merge_split_placeholders(xml: &str) -> String {
    static PARA: std::sync::OnceLock<Regex> = std::sync::OnceLock::new();
    static TEXT: std::sync::OnceLock<Regex> = std::sync::OnceLock::new();
    let para = PARA.get_or_init(|| Regex::new(r"(?s)<w:p[ >].*?</w:p>").unwrap());
    let text = TEXT.get_or_init(|| Regex::new(r"(<w:t(?:\s[^>]*)?>)([^<]*)(</w:t>)").unwrap());
    para.replace_all(xml, |p: &regex::Captures| {
        let p = &p[0];
        let joined: String = text.captures_iter(p).map(|c| c[2].to_string()).collect();
        if !joined.contains("{{") || placeholder_re().find_iter(p).count() == placeholder_re().find_iter(&joined).count() {
            return p.to_string();
        }
        let mut first = true;
        text.replace_all(p, |c: &regex::Captures| {
            if first {
                first = false;
                format!("<w:t xml:space=\"preserve\">{}{}", joined, &c[3])
            } else {
                format!("{}{}", &c[1], &c[3])
            }
        })
        .into_owned()
    })
    .into_owned()
}

/// `{{?name}}` is optional: with a value it's an ordinary field; without one
/// its line goes (or, in a table cell, the cell is left empty — Word needs a
/// paragraph in every cell).
fn resolve_optional(xml: &str, values: &BTreeMap<String, String>) -> String {
    static CELL: std::sync::OnceLock<Regex> = std::sync::OnceLock::new();
    static PARA: std::sync::OnceLock<Regex> = std::sync::OnceLock::new();
    static OPTIONAL: std::sync::OnceLock<Regex> = std::sync::OnceLock::new();
    let cell = CELL.get_or_init(|| Regex::new(r"(?s)<w:tc[ >].*?</w:tc>").unwrap());
    let para = PARA.get_or_init(|| Regex::new(r"(?s)<w:p[ >].*?</w:p>").unwrap());
    let optional = OPTIONAL.get_or_init(|| Regex::new(r"\{\{\s*\?([A-Za-z0-9_.\-]+)\s*\}\}").unwrap());
    let has = |name: &str| values.get(name).is_some_and(|v| !v.trim().is_empty());
    let resolve = |text: &str, empty: &str| -> String {
        para.replace_all(text, |p: &regex::Captures| {
            let p = &p[0];
            let names: Vec<String> = optional.captures_iter(p).map(|c| c[1].to_string()).collect();
            if names.is_empty() {
                p.to_string()
            } else if names.iter().all(|n| has(n)) {
                optional.replace_all(p, "{{$1}}").into_owned()
            } else {
                empty.to_string()
            }
        })
        .into_owned()
    };
    let cells_done = cell.replace_all(xml, |c: &regex::Captures| resolve(&c[0], "<w:p/>")).into_owned();
    resolve(&cells_done, "")
}

/// Where a value's blank line starts a new paragraph (see [`split_paragraphs`]).
const PARAGRAPH_MARK: &str = "\u{E000}";

/// A value as XML text: escaped; a blank line starts a new paragraph, a single
/// line break stays a line break inside it.
fn value_xml(value: &str) -> String {
    let normalized = value.replace("\r\n", "\n");
    let paragraphs: Vec<String> = normalized
        .split("\n\n")
        .map(|p| escape(p.trim_matches('\n')).replace('\n', "</w:t><w:br/><w:t xml:space=\"preserve\">"))
        .collect();
    paragraphs.join(PARAGRAPH_MARK)
}

/// Turn each paragraph mark into a real paragraph break, carrying the
/// paragraph's settings (indent, alignment) and the run's formatting over, so
/// every paragraph of a letter's body gets its own first-line indent.
fn split_paragraphs(xml: &str) -> String {
    if !xml.contains(PARAGRAPH_MARK) {
        return xml.to_string();
    }
    static PARA: std::sync::OnceLock<Regex> = std::sync::OnceLock::new();
    static PPR: std::sync::OnceLock<Regex> = std::sync::OnceLock::new();
    static RPR: std::sync::OnceLock<Regex> = std::sync::OnceLock::new();
    let para = PARA.get_or_init(|| Regex::new(r"(?s)<w:p[ >].*?</w:p>").unwrap());
    let ppr = PPR.get_or_init(|| Regex::new(r"(?s)<w:pPr>.*?</w:pPr>").unwrap());
    let rpr = RPR.get_or_init(|| Regex::new(r"(?s)<w:rPr>.*?</w:rPr>").unwrap());
    para.replace_all(xml, |c: &regex::Captures| {
        let p = &c[0];
        let Some(at) = p.find(PARAGRAPH_MARK) else { return p.to_string() };
        let props = ppr.find(p).map(|m| m.as_str()).unwrap_or("");
        let run_props = rpr.find_iter(&p[..at]).last().map(|m| m.as_str()).unwrap_or("");
        let open = if p.starts_with("<w:p>") { "<w:p>".to_string() } else { p[..p.find('>').unwrap_or(4) + 1].to_string() };
        p.replace(
            PARAGRAPH_MARK,
            &format!("</w:t></w:r></w:p>{open}{props}<w:r>{run_props}<w:t xml:space=\"preserve\">"),
        )
    })
    .into_owned()
}

fn fill_placeholders(xml: &str, values: &BTreeMap<String, String>, blank: &str, missing: &mut Vec<String>) -> String {
    placeholder_re()
        .replace_all(xml, |c: &regex::Captures| match values.get(&c[1]) {
            Some(v) => value_xml(v),
            None => {
                if !missing.contains(&c[1].to_string()) {
                    missing.push(c[1].to_string());
                }
                escape(blank)
            }
        })
        .into_owned()
}

/// Repeat each table row that uses `{{item.…}}` once per item (and drop it when there are none).
fn repeat_item_rows(xml: &str, items: &[BTreeMap<String, String>], blank: &str, missing: &mut Vec<String>) -> String {
    static ROW: std::sync::OnceLock<Regex> = std::sync::OnceLock::new();
    let row = ROW.get_or_init(|| Regex::new(r"(?s)<w:tr[ >].*?</w:tr>").unwrap());
    row.replace_all(xml, |c: &regex::Captures| {
        let template = &c[0];
        if !template.contains("{{item.") && !template.contains("{{ item.") {
            return template.to_string();
        }
        items
            .iter()
            .map(|item| {
                let values: BTreeMap<String, String> = item.iter().map(|(k, v)| (format!("item.{k}"), v.clone())).collect();
                fill_placeholders(template, &values, blank, missing)
            })
            .collect::<String>()
    })
    .into_owned()
}

/// Fill a template. Returns the new document and the placeholders no value was given for.
pub fn fill(
    template: &[u8],
    values: &BTreeMap<String, String>,
    items: &[BTreeMap<String, String>],
    blank: &str,
) -> Result<(Vec<u8>, Vec<String>), String> {
    let mut zip = open(template)?;
    let names: Vec<String> = zip.file_names().map(str::to_string).collect();
    let parts = text_parts(&names);
    let mut missing = Vec::new();
    let mut out = Cursor::new(Vec::new());
    {
        let mut writer = zip::ZipWriter::new(&mut out);
        for name in &names {
            let mut entry = zip.by_name(name).map_err(|e| e.to_string())?;
            let options = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
            writer.start_file(name.as_str(), options).map_err(|e| e.to_string())?;
            if parts.contains(name) {
                let mut xml = String::new();
                entry.read_to_string(&mut xml).map_err(|e| e.to_string())?;
                let merged = resolve_optional(&merge_split_placeholders(&xml), values);
                let with_rows = repeat_item_rows(&merged, items, blank, &mut missing);
                let filled = split_paragraphs(&fill_placeholders(&with_rows, values, blank, &mut missing));
                writer.write_all(filled.as_bytes()).map_err(|e| e.to_string())?;
            } else {
                let mut bytes = Vec::new();
                entry.read_to_end(&mut bytes).map_err(|e| e.to_string())?;
                writer.write_all(&bytes).map_err(|e| e.to_string())?;
            }
        }
        writer.finish().map_err(|e| e.to_string())?;
    }
    missing.retain(|m| !m.starts_with("item."));
    Ok((out.into_inner(), missing))
}

/// Turn an ordinary document into a template: each `find` text becomes
/// `{{field}}`. Returns the new file and how often each was replaced.
pub fn replace_text(bytes: &[u8], pairs: &[(String, String)]) -> Result<(Vec<u8>, Vec<usize>), String> {
    let mut zip = open(bytes)?;
    let names: Vec<String> = zip.file_names().map(str::to_string).collect();
    let parts = text_parts(&names);
    let mut counts = vec![0usize; pairs.len()];
    static PARA: std::sync::OnceLock<Regex> = std::sync::OnceLock::new();
    static TEXT: std::sync::OnceLock<Regex> = std::sync::OnceLock::new();
    let para = PARA.get_or_init(|| Regex::new(r"(?s)<w:p[ >].*?</w:p>").unwrap());
    let text = TEXT.get_or_init(|| Regex::new(r"(<w:t(?:\s[^>]*)?>)([^<]*)(</w:t>)").unwrap());
    let mut out = Cursor::new(Vec::new());
    {
        let mut writer = zip::ZipWriter::new(&mut out);
        for name in &names {
            let mut entry = zip.by_name(name).map_err(|e| e.to_string())?;
            let options = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
            writer.start_file(name.as_str(), options).map_err(|e| e.to_string())?;
            if !parts.contains(name) {
                let mut raw = Vec::new();
                entry.read_to_end(&mut raw).map_err(|e| e.to_string())?;
                writer.write_all(&raw).map_err(|e| e.to_string())?;
                continue;
            }
            let mut xml = String::new();
            entry.read_to_string(&mut xml).map_err(|e| e.to_string())?;
            let replaced = para
                .replace_all(&xml, |p: &regex::Captures| {
                    let p = &p[0];
                    let joined: String = text.captures_iter(p).map(|c| unescape(&c[2])).collect();
                    if !pairs.iter().any(|(find, _)| !find.is_empty() && joined.contains(find.as_str())) {
                        return p.to_string();
                    }
                    // Merge the paragraph's runs so text Word split apart is found whole.
                    let mut merged = joined.clone();
                    for (i, (find, field)) in pairs.iter().enumerate() {
                        if find.is_empty() {
                            continue;
                        }
                        counts[i] += merged.matches(find.as_str()).count();
                        merged = merged.replace(find.as_str(), &format!("{{{{{field}}}}}"));
                    }
                    let mut first = true;
                    text.replace_all(p, |c: &regex::Captures| {
                        if first {
                            first = false;
                            format!("<w:t xml:space=\"preserve\">{}{}", escape(&merged), &c[3])
                        } else {
                            format!("{}{}", &c[1], &c[3])
                        }
                    })
                    .into_owned()
                })
                .into_owned();
            writer.write_all(replaced.as_bytes()).map_err(|e| e.to_string())?;
        }
        writer.finish().map_err(|e| e.to_string())?;
    }
    Ok((out.into_inner(), counts))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> Vec<u8> {
        build(&[
            Block::Para(Para::new("เรียน {{to}}").bold()),
            Block::Table(Table {
                widths: vec![3000, 3000],
                rows: vec![
                    vec![cell("รายการ"), cell("จำนวน")],
                    vec![cell("{{item.name}}"), cell("{{item.qty}}")],
                    vec![cell("รวม"), cell("{{total}}")],
                ],
                borders: true,
                header_rows: 1,
            }),
            Block::Para(Para::new("หมายเหตุ: {{note}}")),
        ])
    }

    #[test]
    fn builds_a_document_word_can_read_back() {
        let text = read_text(&sample()).unwrap();
        assert!(text.contains("เรียน {{to}}"), "{text}");
        assert!(text.contains("| รายการ | จำนวน |"), "{text}");
        assert_eq!(placeholders(&sample()).unwrap(), ["to", "item.name", "item.qty", "total", "note"]);
    }

    #[test]
    fn fills_values_repeats_item_rows_and_reports_what_is_missing() {
        let values: BTreeMap<String, String> =
            [("to".to_string(), "คุณสมชาย & ทีม".to_string()), ("total".to_string(), "3".to_string())].into();
        let items: Vec<BTreeMap<String, String>> = vec![
            [("name".to_string(), "กาแฟ".to_string()), ("qty".to_string(), "2".to_string())].into(),
            [("name".to_string(), "ชา".to_string()), ("qty".to_string(), "1".to_string())].into(),
        ];
        let (doc, missing) = fill(&sample(), &values, &items, "……").unwrap();
        let text = read_text(&doc).unwrap();
        assert!(text.contains("เรียน คุณสมชาย & ทีม"), "{text}");
        assert!(text.contains("| กาแฟ | 2 |") && text.contains("| ชา | 1 |"), "{text}");
        assert!(text.contains("| รวม | 3 |"));
        assert!(text.contains("หมายเหตุ: ……"));
        assert_eq!(missing, ["note"]);
    }

    #[test]
    fn a_placeholder_word_split_over_runs_is_filled() {
        let xml = r#"<w:body><w:p><w:r><w:t>เรียน {{</w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>to</w:t></w:r><w:r><w:t>}} ครับ</w:t></w:r></w:p></w:body>"#;
        let merged = merge_split_placeholders(xml);
        let mut missing = Vec::new();
        let values: BTreeMap<String, String> = [("to".to_string(), "คุณเอ".to_string())].into();
        let filled = fill_placeholders(&merged, &values, "", &mut missing);
        assert_eq!(paragraph_text(&filled), "เรียน คุณเอ ครับ");
        assert!(missing.is_empty());
    }

    #[test]
    fn a_blank_line_starts_a_new_indented_paragraph() {
        let doc = build(&[Block::Para(Para::new("{{body}}").indent(1418))]);
        let values: BTreeMap<String, String> = [("body".to_string(), "ย่อหน้าแรก\n\nย่อหน้าสอง".to_string())].into();
        let (filled, _) = fill(&doc, &values, &[], "").unwrap();
        let mut zip = open(&filled).unwrap();
        let xml = read_entry(&mut zip, "word/document.xml").unwrap();
        assert_eq!(xml.matches("w:firstLine=\"1418\"").count(), 2, "{xml}");
        assert_eq!(read_text(&filled).unwrap(), "ย่อหน้าแรก\nย่อหน้าสอง");
    }

    #[test]
    fn an_ordinary_document_becomes_a_template() {
        let doc = build(&[Block::Para(Para::new("เรียน คุณสมชาย ใจดี")), Block::Para(Para::new("ยอดชำระ 1,500 บาท"))]);
        let (template, counts) = replace_text(
            &doc,
            &[("คุณสมชาย ใจดี".into(), "customer_name".into()), ("1,500".into(), "total".into()), ("ไม่มี".into(), "x".into())],
        )
        .unwrap();
        assert_eq!(counts, [1, 1, 0]);
        assert_eq!(placeholders(&template).unwrap(), ["customer_name", "total"]);
    }

    #[test]
    fn line_breaks_in_values_stay_line_breaks() {
        let values: BTreeMap<String, String> = [("note".to_string(), "บรรทัดหนึ่ง\nบรรทัดสอง".to_string())].into();
        let (doc, _) = fill(&sample(), &values, &[], "").unwrap();
        assert!(read_text(&doc).unwrap().contains("หมายเหตุ: บรรทัดหนึ่ง\nบรรทัดสอง"));
    }
}
