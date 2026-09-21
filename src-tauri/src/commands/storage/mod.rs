//! What the app keeps between launches: chat history and projects (SQLite),
//! API keys (the OS keychain) and the skill library on disk.

pub mod history;
pub mod secrets;
pub mod skills;

pub use history::{history_import_legacy, history_load, history_save};
pub use secrets::{secrets_load, secrets_save};
pub use skills::{
    skills_dir, skills_export_folder, skills_fetch_url, skills_install, skills_installed,
    skills_read_asset, skills_scan_folder, skills_search_repos, skills_sync, skills_uninstall,
};
