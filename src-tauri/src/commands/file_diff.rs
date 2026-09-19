//! Line-by-line changes to one file, in the shape the UI's diff view draws.
//! Built from two texts (checkpoints) or parsed from `git diff` output.

use serde::Serialize;

/// Lines of context around each change.
const CONTEXT: usize = 3;

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DiffLine {
    /// `add`, `del` or `ctx`.
    pub tag: &'static str,
    pub text: String,
    pub old_line: Option<usize>,
    pub new_line: Option<usize>,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DiffHunk {
    /// `@@ -1,4 +1,5 @@ fn main()`: where the hunk is, and the enclosing
    /// function or heading when git knows it.
    pub header: String,
    pub lines: Vec<DiffLine>,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FileDiff {
    /// `text`, `binary` (no line diff), `too-large` or `unavailable`.
    pub kind: &'static str,
    pub hunks: Vec<DiffHunk>,
    pub additions: usize,
    pub deletions: usize,
}

impl FileDiff {
    /// A diff with no lines to show, e.g. `binary` or `too-large`.
    pub fn empty(kind: &'static str) -> Self {
        Self { kind, hunks: Vec::new(), additions: 0, deletions: 0 }
    }

    /// Compare two versions of a text file.
    pub fn from_texts(old: &str, new: &str) -> Self {
        let diff = similar::TextDiff::from_lines(old, new);
        let mut out = Self::empty("text");
        for group in diff.grouped_ops(CONTEXT) {
            let mut lines = Vec::new();
            for op in group {
                for line in diff.iter_changes(&op) {
                    let tag = match line.tag() {
                        similar::ChangeTag::Insert => "add",
                        similar::ChangeTag::Delete => "del",
                        similar::ChangeTag::Equal => "ctx",
                    };
                    lines.push(DiffLine {
                        tag,
                        text: line.value().trim_end_matches(['\n', '\r']).to_string(),
                        old_line: line.old_index().map(|i| i + 1),
                        new_line: line.new_index().map(|i| i + 1),
                    });
                }
            }
            out.push_hunk(header_for(&lines), lines);
        }
        out
    }

    /// Parse `git diff` output for one file. "Binary files … differ" gives a
    /// `binary` diff.
    pub fn parse_unified(patch: &str) -> Self {
        if patch.lines().any(|l| l.starts_with("Binary files ") || l == "GIT binary patch") {
            return Self::empty("binary");
        }
        let mut out = Self::empty("text");
        let mut current: Option<(String, Vec<DiffLine>)> = None;
        let (mut old_no, mut new_no) = (0usize, 0usize);
        for line in patch.lines() {
            if let Some(rest) = line.strip_prefix("@@ ") {
                if let Some((header, lines)) = current.take() {
                    out.push_hunk(header, lines);
                }
                let (old_start, new_start) = hunk_starts(rest);
                old_no = old_start;
                new_no = new_start;
                current = Some((line.to_string(), Vec::new()));
                continue;
            }
            let Some((_, lines)) = current.as_mut() else { continue };
            let (tag, text) = match line.as_bytes().first() {
                Some(b'+') => ("add", &line[1..]),
                Some(b'-') => ("del", &line[1..]),
                Some(b' ') => ("ctx", &line[1..]),
                // "\ No newline at end of file"
                Some(b'\\') => continue,
                // A blank context line some tools emit without its space.
                None => ("ctx", ""),
                _ => continue,
            };
            let (old_line, new_line) = match tag {
                "add" => (None, Some(new_no)),
                "del" => (Some(old_no), None),
                _ => (Some(old_no), Some(new_no)),
            };
            if tag != "add" {
                old_no += 1;
            }
            if tag != "del" {
                new_no += 1;
            }
            lines.push(DiffLine { tag, text: text.trim_end_matches('\r').to_string(), old_line, new_line });
        }
        if let Some((header, lines)) = current {
            out.push_hunk(header, lines);
        }
        out
    }

    fn push_hunk(&mut self, header: String, lines: Vec<DiffLine>) {
        self.additions += lines.iter().filter(|l| l.tag == "add").count();
        self.deletions += lines.iter().filter(|l| l.tag == "del").count();
        self.hunks.push(DiffHunk { header, lines });
    }
}

/// `-12,5 +12,7 @@ …` → (12, 12).
fn hunk_starts(rest: &str) -> (usize, usize) {
    let mut parts = rest.split_whitespace();
    let start = |part: Option<&str>, sign: char| {
        part.and_then(|p| p.strip_prefix(sign))
            .and_then(|p| p.split(',').next())
            .and_then(|n| n.parse().ok())
            .unwrap_or(0)
    };
    (start(parts.next(), '-'), start(parts.next(), '+'))
}

/// The `@@ -a,b +c,d @@` line for a hunk built from texts.
fn header_for(lines: &[DiffLine]) -> String {
    let range = |numbers: Vec<usize>| match (numbers.first(), numbers.len()) {
        (Some(first), len) => format!("{first},{len}"),
        (None, _) => "0,0".into(),
    };
    let old = range(lines.iter().filter_map(|l| l.old_line).collect());
    let new = range(lines.iter().filter_map(|l| l.new_line).collect());
    format!("@@ -{old} +{new} @@")
}

#[cfg(test)]
mod tests {
    use super::*;

    const PATCH: &str = "diff --git a/src/a.rs b/src/a.rs
index 1111111..2222222 100644
--- a/src/a.rs
+++ b/src/a.rs
@@ -1,3 +1,4 @@ fn main() {
 one
-two
+2
+three
 four
\\ No newline at end of file
@@ -10,2 +11,2 @@
-x
+y
 z
";

    #[test]
    fn parses_git_hunks_with_line_numbers() {
        let diff = FileDiff::parse_unified(PATCH);
        assert_eq!(diff.kind, "text");
        assert_eq!((diff.additions, diff.deletions), (3, 2));
        assert_eq!(diff.hunks.len(), 2);
        assert_eq!(diff.hunks[0].header, "@@ -1,3 +1,4 @@ fn main() {");
        let first: Vec<(&str, Option<usize>, Option<usize>)> =
            diff.hunks[0].lines.iter().map(|l| (l.tag, l.old_line, l.new_line)).collect();
        assert_eq!(
            first,
            [
                ("ctx", Some(1), Some(1)),
                ("del", Some(2), None),
                ("add", None, Some(2)),
                ("add", None, Some(3)),
                ("ctx", Some(3), Some(4)),
            ]
        );
        assert_eq!(diff.hunks[1].lines[0].old_line, Some(10));
        assert_eq!(diff.hunks[1].lines[1].new_line, Some(11));
    }

    #[test]
    fn binary_patches_have_no_lines() {
        let diff = FileDiff::parse_unified("diff --git a/x.png b/x.png\nBinary files a/x.png and b/x.png differ\n");
        assert_eq!(diff.kind, "binary");
        assert!(diff.hunks.is_empty());
    }

    #[test]
    fn texts_diff_like_git() {
        let diff = FileDiff::from_texts("one\ntwo\n", "one\n2\nthree\n");
        assert_eq!((diff.additions, diff.deletions), (2, 1));
        assert_eq!(diff.hunks[0].header, "@@ -1,2 +1,3 @@");
    }
}
