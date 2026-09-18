//! Config files written by the app can hold API keys and tokens.

use std::io::Write;
use std::path::Path;

/// Write `contents` atomically (temp file + rename) and readable by the
/// owner only on Unix, so a crash never leaves half a config behind.
pub fn write_private(path: &Path, contents: &str) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| format!("{} has no parent folder", path.display()))?;
    std::fs::create_dir_all(parent)
        .map_err(|e| format!("Cannot create {}: {e}", parent.display()))?;

    let file_name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("config");
    let tmp = parent.join(format!(".{file_name}.{}.tmp", uuid::Uuid::new_v4().simple()));

    let result = (|| {
        let mut options = std::fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options.open(&tmp)?;
        file.write_all(contents.as_bytes())?;
        file.sync_all()?;
        std::fs::rename(&tmp, path)
    })();

    result.map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        format!("Cannot write {}: {e}", path.display())
    })
}
