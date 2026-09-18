use std::path::PathBuf;

/// Return a safe default working directory for the OpenCode agent.
///
/// Preference order:
/// 1. OS public directory (`dirs::public_dir()`)
/// 2. `%PUBLIC%` / `C:\Users\Public` / `~/Public`
/// 3. `Documents`
/// 4. Project `public/` (or `../public` if running inside `src-tauri`)
/// 5. System temp directory
pub fn get_default_public_dir() -> PathBuf {
    if let Some(p) = dirs::public_dir() {
        if p.exists() {
            return p;
        }
    }

    #[cfg(windows)]
    {
        let mut candidates: Vec<PathBuf> = Vec::new();
        candidates.push(PathBuf::from(r"C:\Users\Public"));
        if let Ok(v) = std::env::var("PUBLIC") {
            candidates.push(PathBuf::from(v));
        }
        if let Ok(h) = std::env::var("USERPROFILE") {
            candidates.push(PathBuf::from(&h).join("Public"));
            candidates.push(PathBuf::from(&h).join("Documents"));
        }
        for c in candidates {
            if c.exists() {
                return c;
            }
        }

        if let Ok(cur) = std::env::current_dir() {
            let p = cur.join("public");
            if p.exists() {
                return p;
            }
            // When launched from src-tauri, go up one level.
            if cur.ends_with("src-tauri") {
                let p2 = cur.join("..").join("public");
                if p2.exists() {
                    return p2;
                }
            }
            return p;
        }
    }

    #[cfg(not(windows))]
    {
        if let Ok(home) = std::env::var("HOME") {
            let candidates = [PathBuf::from(&home).join("Public"), PathBuf::from(&home).join("public")];
            for c in candidates {
                if c.exists() {
                    return c;
                }
            }
        }

        if let Ok(cur) = std::env::current_dir() {
            let p = cur.join("public");
            if p.exists() {
                return p;
            }
            return p;
        }
    }

    std::env::temp_dir()
}
