pub mod attachments;
pub mod bin_cache;
pub mod chat;
pub mod checkpoint;
pub mod cli;
pub mod codex;
pub mod cursor;
pub mod file_diff;
pub mod antigravity;
pub mod git;
pub mod link_preview;
pub mod mcp;
pub mod mcp_clients;
pub mod media;
pub mod mcp_oauth;
pub mod mcp_registry;
pub mod native_alert;
pub mod smithery;
pub mod opencode;
pub mod process;
pub mod secure_fs;
pub mod setup;
pub mod storage;
pub mod supervisor;


/// ตัดสตริงให้ยาวไม่เกิน `max` ไบต์ โดยไม่ตัดกลางตัวอักษร
///
/// `&s[..max]` ตรงๆ จะ panic ถ้าไบต์ที่ `max` อยู่กลางตัวอักษร UTF-8 —
/// ข้อความไทยตัวละ 3 ไบต์ จึงพังแทบทุกครั้งที่บรรทัดยาวเกินเพดาน
/// ใช้กับ log ของ stdout ที่มาจาก agent CLI ซึ่งควบคุมเนื้อหาไม่ได้
pub fn truncate_chars(s: &str, max: usize) -> &str {
    if s.len() <= max {
        return s;
    }
    let mut end = max;
    while end > 0 && !s.is_char_boundary(end) {
        end -= 1;
    }
    &s[..end]
}

#[cfg(test)]
mod truncate_tests {
    use super::truncate_chars;

    #[test]
    fn short_strings_pass_through() {
        assert_eq!(truncate_chars("hello", 200), "hello");
    }

    #[test]
    fn ascii_cuts_at_the_limit() {
        assert_eq!(truncate_chars("abcdef", 3), "abc");
    }

    #[test]
    fn thai_never_splits_a_character() {
        // "สวัสดี" ตัวละ 3 ไบต์ — ตัดที่ไบต์ 4 ต้องถอยมาที่ 3
        let s = "สวัสดี";
        assert_eq!(truncate_chars(s, 4), "ส");
        assert!(s.is_char_boundary(truncate_chars(s, 7).len()));
    }

    #[test]
    fn emoji_never_splits_a_character() {
        assert_eq!(truncate_chars("🙂🙂", 5), "🙂");
    }
}

#[cfg(test)]
mod live_tests;
