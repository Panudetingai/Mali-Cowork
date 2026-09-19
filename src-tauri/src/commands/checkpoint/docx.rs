//! A readable Markdown rendering of a `.docx`, for previews: headings,
//! paragraphs, bold/italic, lists and tables. Layout, images and styles are
//! left out; the preview shows what the document says, Word shows the rest.

use std::io::{Cursor, Read};

use quick_xml::events::{BytesStart, Event};
use quick_xml::Reader;

/// Longest preview produced; the rest of the document is cut.
const MAX_CHARS: usize = 200_000;
/// `word/document.xml` larger than this isn't unpacked.
const MAX_XML_BYTES: u64 = 30 * 1024 * 1024;

pub fn to_markdown(bytes: &[u8]) -> Result<String, String> {
    let mut archive = zip::ZipArchive::new(Cursor::new(bytes)).map_err(|_| "Not a Word document".to_string())?;
    let file = archive
        .by_name("word/document.xml")
        .map_err(|_| "The document has no body".to_string())?;
    let mut xml = String::new();
    file.take(MAX_XML_BYTES)
        .read_to_string(&mut xml)
        .map_err(|e| format!("Can't read the document: {e}"))?;
    Ok(render(&xml))
}

#[derive(Default)]
struct Paragraph {
    text: String,
    heading: Option<usize>,
    list: bool,
}

#[derive(Default)]
struct Run {
    bold: bool,
    italic: bool,
}

fn render(xml: &str) -> String {
    let mut reader = Reader::from_str(xml);
    let mut out = String::new();
    let mut para: Option<Paragraph> = None;
    let mut run = Run::default();
    let mut in_text = false;
    // Table rows, each a list of cells; nested tables flatten into their cell.
    let mut table: Vec<Vec<String>> = Vec::new();
    let mut table_depth = 0usize;
    let mut cell: Option<String> = None;

    loop {
        let event = match reader.read_event() {
            Ok(Event::Eof) | Err(_) => break,
            Ok(event) => event,
        };
        match event {
            Event::Start(e) if is(&e, "p") => para = Some(Paragraph::default()),
            // `<w:p/>`: an empty paragraph.
            Event::Empty(e) if is(&e, "p") => {}
            Event::Start(e) | Event::Empty(e) => match e.local_name().as_ref() {
                "pStyle" => {
                    if let (Some(p), Some(style)) = (para.as_mut(), val(&e)) {
                        p.heading = heading_level(&style);
                        // "List Bullet", "List Number"…: numbered by the style.
                        p.list |= style.to_ascii_lowercase().starts_with("list");
                    }
                }
                "numPr" => {
                    if let Some(p) = para.as_mut() {
                        p.list = true;
                    }
                }
                "r" => run = Run::default(),
                "b" => run.bold = on(&e),
                "i" => run.italic = on(&e),
                "t" => in_text = true,
                "tab" => push_text(&mut para, "\t", &run),
                "br" | "cr" => push_text(&mut para, "  \n", &Run::default()),
                "tbl" => {
                    table_depth += 1;
                    if table_depth == 1 {
                        flush_paragraph(&mut out, &mut para);
                        table.clear();
                    }
                }
                "tr" if table_depth == 1 => table.push(Vec::new()),
                "tc" if table_depth == 1 => cell = Some(String::new()),
                _ => {}
            },
            Event::Text(t) if in_text => push_text(&mut para, &t.xml10_content(), &run),
            Event::GeneralRef(r) if in_text => {
                let ch = match r.resolve_char_ref() {
                    Ok(Some(c)) => Some(c),
                    _ => match &*r.xml10_content() {
                        "amp" => Some('&'),
                        "lt" => Some('<'),
                        "gt" => Some('>'),
                        "quot" => Some('"'),
                        "apos" => Some('\''),
                        _ => None,
                    },
                };
                if let Some(c) = ch {
                    push_text(&mut para, c.encode_utf8(&mut [0; 4]), &run);
                }
            }
            Event::End(e) => match e.local_name().as_ref() {
                "t" => in_text = false,
                "p" => {
                    if let Some(cell) = cell.as_mut() {
                        let text = para.take().map(|p| p.text).unwrap_or_default();
                        if !text.trim().is_empty() {
                            if !cell.is_empty() {
                                cell.push(' ');
                            }
                            cell.push_str(text.trim());
                        }
                    } else {
                        flush_paragraph(&mut out, &mut para);
                    }
                }
                "tc" if table_depth == 1 => {
                    if let (Some(row), Some(text)) = (table.last_mut(), cell.take()) {
                        row.push(text.replace("  \n", " "));
                    }
                }
                "tbl" => {
                    table_depth = table_depth.saturating_sub(1);
                    if table_depth == 0 {
                        flush_table(&mut out, &table);
                        table.clear();
                    }
                }
                _ => {}
            },
            _ => {}
        }
        if out.len() > MAX_CHARS {
            out.truncate(floor_char_boundary(&out, MAX_CHARS));
            out.push_str("\n\n*…the rest of the document isn't shown.*\n");
            return out;
        }
    }
    flush_paragraph(&mut out, &mut para);
    out
}

fn is(e: &BytesStart, name: &str) -> bool {
    e.local_name().as_ref() == name
}

fn val(e: &BytesStart) -> Option<String> {
    e.try_get_attribute("w:val")
        .ok()
        .flatten()
        .and_then(|a| a.normalized_value(quick_xml::XmlVersion::Implicit1_0).ok().map(|v| v.into_owned()))
}

/// `<w:b/>` is on; `<w:b w:val="0"/>` or `"false"` is off.
fn on(e: &BytesStart) -> bool {
    !matches!(val(e).as_deref(), Some("0") | Some("false") | Some("none"))
}

fn heading_level(style: &str) -> Option<usize> {
    let lower = style.to_ascii_lowercase();
    if lower == "title" {
        return Some(1);
    }
    let digits = lower.strip_prefix("heading")?.trim();
    digits.parse::<usize>().ok().map(|n| n.clamp(1, 6))
}

fn push_text(para: &mut Option<Paragraph>, text: &str, run: &Run) {
    let p = para.get_or_insert_with(Paragraph::default);
    let escaped = escape(text);
    if escaped.trim().is_empty() || !(run.bold || run.italic) {
        p.text.push_str(&escaped);
        return;
    }
    // Emphasis markers must hug the text: keep outer spaces outside.
    let start = escaped.len() - escaped.trim_start().len();
    let end = escaped.trim_end().len();
    let marker = match (run.bold, run.italic) {
        (true, true) => "***",
        (true, false) => "**",
        _ => "*",
    };
    p.text.push_str(&escaped[..start]);
    p.text.push_str(marker);
    p.text.push_str(&escaped[start..end]);
    p.text.push_str(marker);
    p.text.push_str(&escaped[end..]);
}

fn flush_paragraph(out: &mut String, para: &mut Option<Paragraph>) {
    let Some(p) = para.take() else { return };
    let text = p.text.trim();
    if text.is_empty() {
        return;
    }
    if let Some(level) = p.heading {
        out.push_str(&"#".repeat(level));
        out.push(' ');
        out.push_str(&text.replace("  \n", " "));
        out.push_str("\n\n");
    } else if p.list {
        out.push_str("- ");
        out.push_str(text);
        out.push('\n');
    } else {
        out.push_str(text);
        out.push_str("\n\n");
    }
}

fn flush_table(out: &mut String, rows: &[Vec<String>]) {
    let width = rows.iter().map(Vec::len).max().unwrap_or(0);
    if width == 0 {
        return;
    }
    out.push('\n');
    for (i, row) in rows.iter().enumerate() {
        out.push('|');
        for c in 0..width {
            out.push(' ');
            out.push_str(row.get(c).map(String::as_str).unwrap_or(""));
            out.push_str(" |");
        }
        out.push('\n');
        if i == 0 {
            out.push('|');
            out.push_str(&" --- |".repeat(width));
            out.push('\n');
        }
    }
    out.push('\n');
}

/// Document text is data, not Markdown or HTML.
fn escape(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for c in text.chars() {
        match c {
            '\\' | '`' | '*' | '_' | '[' | ']' | '#' | '|' | '~' => {
                out.push('\\');
                out.push(c);
            }
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '&' => out.push_str("&amp;"),
            _ => out.push(c),
        }
    }
    out
}

fn floor_char_boundary(s: &str, mut i: usize) -> usize {
    while !s.is_char_boundary(i) {
        i -= 1;
    }
    i
}

#[cfg(test)]
mod tests {
    use super::*;

    const BODY: &str = r#"<w:document xmlns:w="w"><w:body>
<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>รายงาน Q3</w:t></w:r></w:p>
<w:p><w:r><w:t xml:space="preserve">Sales </w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>grew</w:t></w:r><w:r><w:t xml:space="preserve"> 5% &amp; &lt;script&gt;*</w:t></w:r></w:p>
<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/></w:numPr></w:pPr><w:r><w:t>first</w:t></w:r></w:p>
<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Name</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>A|B</w:t></w:r></w:p></w:tc></w:tr>
<w:tr><w:tc><w:p><w:r><w:t>x</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
<w:p/></w:body></w:document>"#;

    #[test]
    fn renders_headings_emphasis_lists_and_tables_as_inert_markdown() {
        let md = render(BODY);
        assert!(md.contains("# รายงาน Q3\n"), "{md}");
        assert!(md.contains("Sales **grew** 5% &amp; &lt;script&gt;\\*"), "{md}");
        assert!(md.contains("- first\n"), "{md}");
        assert!(md.contains("| Name | A\\|B |"), "{md}");
        assert!(md.contains("| --- | --- |"), "{md}");
        assert!(md.contains("| x |  |"), "{md}");
        assert!(!md.contains("<script"), "{md}");
    }
}
