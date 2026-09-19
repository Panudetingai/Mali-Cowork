//! Launching CLI tools without letting a shell reinterpret their arguments.
//!
//! On Windows, npm installs CLIs as `.cmd` shims, which only `cmd.exe` can
//! run, and `cmd.exe` treats `&`, `|`, `%VAR%` and friends in any argument as
//! syntax. A prompt such as `" & calc & "` would then run `calc`. So a shim is
//! first resolved to the `node <script>` it wraps and run directly; any other
//! batch file gets every argument escaped for `cmd.exe`.

use std::path::{Path, PathBuf};

use tokio::process::Command;

/// Windows `CREATE_NO_WINDOW`: the app is a GUI program, so every console
/// program it starts (`node`, `cmd`, `taskkill`…) would otherwise pop up its
/// own black console window.
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// A command running `bin` with `args` passed through verbatim, with no
/// console window on Windows.
pub fn command(bin: &str, args: &[&str]) -> Command {
    #[cfg(windows)]
    {
        let mut cmd = windows_command(bin, args);
        cmd.creation_flags(CREATE_NO_WINDOW);
        cmd
    }
    #[cfg(not(windows))]
    {
        let mut cmd = Command::new(bin);
        cmd.args(args);
        cmd
    }
}

/// A blocking `std` command for small helpers (`where`, `kill`, `taskkill`),
/// with no console window on Windows.
pub fn std_command(program: &str) -> std::process::Command {
    #[allow(unused_mut)]
    let mut cmd = std::process::Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

#[cfg(windows)]
fn windows_command(bin: &str, args: &[&str]) -> Command {
    let path = Path::new(bin);
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(str::to_ascii_lowercase)
        .unwrap_or_default();

    if ext == "exe" || ext == "com" {
        let mut cmd = Command::new(bin);
        cmd.args(args);
        return cmd;
    }

    let contents = std::fs::read_to_string(path).unwrap_or_default();
    let script = if ext == "cmd" || ext == "bat" {
        shim_script(path, &contents)
    } else if contents.starts_with("#!") && contents.lines().next().is_some_and(|l| l.contains("node")) {
        // An extensionless node script (the file npm writes next to the shim).
        Some(path.to_path_buf())
    } else {
        None
    };

    if let Some(script) = script {
        let node = path
            .parent()
            .map(|dir| dir.join("node.exe"))
            .filter(|node| node.is_file())
            .unwrap_or_else(|| PathBuf::from("node"));
        let mut cmd = Command::new(node);
        cmd.arg(script).args(args);
        return cmd;
    }

    // Last resort: through `cmd.exe`, with nothing left for it to interpret.
    let mut cmd = Command::new("cmd");
    cmd.raw_arg(cmd_line(bin, args));
    cmd
}

/// The JavaScript file an npm, pnpm or yarn `.cmd` shim runs, e.g.
/// `"%dp0%\node_modules\@openai\codex\bin\codex.js" %*`.
#[cfg_attr(not(windows), allow(dead_code))]
fn shim_script(shim: &Path, contents: &str) -> Option<PathBuf> {
    let dir = shim.parent()?;
    for marker in ["\"%dp0%\\", "\"%~dp0\\"] {
        for (at, _) in contents.match_indices(marker) {
            let rest = &contents[at + marker.len()..];
            let Some(end) = rest.find('"') else { continue };
            let relative = &rest[..end];
            let lower = relative.to_ascii_lowercase();
            if [".js", ".mjs", ".cjs"].iter().any(|ext| lower.ends_with(ext)) {
                let script = dir.join(relative.replace('\\', std::path::MAIN_SEPARATOR_STR));
                return script.is_file().then_some(script);
            }
        }
    }
    None
}

/// Characters `cmd.exe` gives a meaning to.
const CMD_META: &str = "()[]%!^\"`<>&|;, *?";

fn caret_escape(text: &str) -> String {
    let mut out = String::with_capacity(text.len() * 2);
    for c in text.chars() {
        if CMD_META.contains(c) {
            out.push('^');
        }
        out.push(c);
    }
    out
}

/// Quote one argument the way the C runtime splits a command line.
fn quote_argument(arg: &str) -> String {
    let mut out = String::from("\"");
    let mut backslashes = 0;
    for c in arg.chars() {
        if c == '\\' {
            backslashes += 1;
            continue;
        }
        if c == '"' {
            out.extend(std::iter::repeat_n('\\', backslashes * 2 + 1));
        } else {
            out.extend(std::iter::repeat_n('\\', backslashes));
        }
        backslashes = 0;
        out.push(c);
    }
    out.extend(std::iter::repeat_n('\\', backslashes * 2));
    out.push('"');
    out
}

/// `/D /S /C "<bin> <args>"` with every metacharacter escaped. Arguments are
/// escaped twice because the batch file re-parses them when it passes `%*`
/// on. `cmd.exe` cannot carry line breaks in an argument, so they become spaces.
#[cfg_attr(not(windows), allow(dead_code))]
fn cmd_line(bin: &str, args: &[&str]) -> String {
    let mut line = caret_escape(bin);
    for arg in args {
        line.push(' ');
        line.push_str(&cmd_argument(arg));
    }
    format!("/D /S /C \"{line}\"")
}

fn cmd_argument(arg: &str) -> String {
    let flat = arg.replace("\r\n", " ").replace(['\r', '\n'], " ");
    caret_escape(&caret_escape(&quote_argument(&flat)))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Every metacharacter is escaped: an odd run of carets before it.
    fn all_escaped(escaped: &str) -> bool {
        let chars: Vec<char> = escaped.chars().collect();
        let mut i = 0;
        while i < chars.len() {
            if chars[i] == '^' {
                i += 2;
                continue;
            }
            if CMD_META.contains(chars[i]) {
                return false;
            }
            i += 1;
        }
        true
    }

    #[test]
    fn prompt_cannot_break_out_of_cmd() {
        for prompt in [r#"hi" & calc & echo "%PATH%"#, "a | b > c", "^& (x) !y!", r#"\" & calc"#] {
            let arg = cmd_argument(prompt);
            assert!(all_escaped(&arg), "{prompt} → {arg}");
        }
        let line = cmd_line(r"C:\npm\codex.cmd", &["exec", "x & y"]);
        assert_eq!(line, format!(r#"/D /S /C "C:\npm\codex.cmd {} {}""#, cmd_argument("exec"), cmd_argument("x & y")));
    }

    #[test]
    fn line_breaks_are_flattened() {
        let line = cmd_line("x.cmd", &["a\r\nb\nc"]);
        assert!(!line.contains(['\r', '\n']));
    }

    #[test]
    fn arguments_are_quoted_for_the_c_runtime() {
        assert_eq!(quote_argument("a b"), r#""a b""#);
        assert_eq!(quote_argument(r#"say "hi""#), r#""say \"hi\"""#);
        assert_eq!(quote_argument(r"C:\dir\"), r#""C:\dir\\""#);
        assert_eq!(quote_argument(r#"a\"b"#), r#""a\\\"b""#);
    }

    #[test]
    fn npm_and_pnpm_shims_point_at_their_script() {
        let dir = std::env::temp_dir().join(format!("mali-shim-{}", uuid::Uuid::new_v4().simple()));
        let script = dir.join("node_modules").join("pkg").join("bin").join("cli.js");
        std::fs::create_dir_all(script.parent().unwrap()).unwrap();
        std::fs::write(&script, "").unwrap();
        let shim = dir.join("cli.cmd");

        let npm = r#"endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\node_modules\pkg\bin\cli.js" %*"#;
        assert_eq!(shim_script(&shim, npm), Some(script.clone()));

        let pnpm = "@IF EXIST \"%~dp0\\node.exe\" (\n  \"%~dp0\\node.exe\"  \"%~dp0\\node_modules\\pkg\\bin\\cli.js\" %*\n)";
        assert_eq!(shim_script(&shim, pnpm), Some(script));

        assert_eq!(shim_script(&shim, "\"%dp0%\\missing.js\" %*"), None);
        let _ = std::fs::remove_dir_all(dir);
    }
}
