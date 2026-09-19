//! Content-addressed copies of files, shared by every checkpoint.
//!
//! A file is stored once per distinct content, under its SHA-256. It is
//! copied first and hashed from the copy, so a file that changes while it is
//! being saved still yields a blob that matches its hash. On APFS (macOS),
//! `std::fs::copy` clones the file, so a copy costs no disk space until the
//! original changes.

use std::fs::File;
use std::io::{self, Read};
use std::path::{Path, PathBuf};

use sha2::{Digest, Sha256};

pub fn root() -> PathBuf {
    dirs::data_local_dir()
        .unwrap_or_else(std::env::temp_dir)
        .join("mali-cowork")
        .join("checkpoints")
}

fn objects() -> PathBuf {
    root().join("objects")
}

/// Where the blob with `hash` lives; `None` for anything that isn't a hash.
pub fn blob_path(hash: &str) -> Option<PathBuf> {
    let valid = hash.len() == 64 && hash.bytes().all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase());
    valid.then(|| objects().join(&hash[..2]).join(&hash[2..]))
}

pub fn has(hash: &str) -> bool {
    blob_path(hash).is_some_and(|p| p.is_file())
}

/// Save a copy of `path` and return its hash.
pub fn put(path: &Path) -> io::Result<String> {
    let tmp_dir = objects().join("tmp");
    std::fs::create_dir_all(&tmp_dir)?;
    let tmp = tmp_dir.join(uuid::Uuid::new_v4().simple().to_string());
    let result = std::fs::copy(path, &tmp).and_then(|_| {
        make_private(&tmp)?;
        hash_file(&tmp)
    });
    let hash = match result {
        Ok(hash) => hash,
        Err(e) => {
            let _ = std::fs::remove_file(&tmp);
            return Err(e);
        }
    };
    let target = blob_path(&hash).expect("sha256 hex is a valid hash");
    if target.is_file() {
        std::fs::remove_file(&tmp)?;
    } else {
        std::fs::create_dir_all(target.parent().expect("blob has a parent"))?;
        std::fs::rename(&tmp, &target)?;
    }
    Ok(hash)
}

pub fn read(hash: &str) -> io::Result<Vec<u8>> {
    let path = blob_path(hash).ok_or_else(|| io::Error::other("invalid hash"))?;
    std::fs::read(path)
}

pub fn hash_file(path: &Path) -> io::Result<String> {
    let mut file = File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; 256 * 1024];
    loop {
        let n = file.read(&mut buf)?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(hex::encode(hasher.finalize()))
}

/// Blobs hold copies of the user's files: readable by the user only.
fn make_private(path: &Path) -> io::Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))?;
    }
    #[cfg(not(unix))]
    let _ = path;
    Ok(())
}

/// Delete every blob not in `keep`, plus copies left over from a crash.
pub fn collect_garbage(keep: &std::collections::HashSet<String>) {
    let _ = std::fs::remove_dir_all(objects().join("tmp"));
    let Ok(prefixes) = std::fs::read_dir(objects()) else { return };
    for prefix in prefixes.flatten() {
        let Ok(blobs) = std::fs::read_dir(prefix.path()) else { continue };
        for blob in blobs.flatten() {
            let hash = format!(
                "{}{}",
                prefix.file_name().to_string_lossy(),
                blob.file_name().to_string_lossy()
            );
            if !keep.contains(&hash) {
                let _ = std::fs::remove_file(blob.path());
            }
        }
        let _ = std::fs::remove_dir(prefix.path());
    }
}
