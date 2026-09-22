mod ai;
mod chat_stream;
mod commands;
pub mod mcp_runner;
mod sandbox;

use commands::attachments::{attachment_import, attachment_save};
use commands::link_preview::link_preview;
use commands::chat::{chat_generate, ollama_list_models, provider_check_key, provider_env_keys};
use commands::checkpoint::{
    checkpoint_add_folder, checkpoint_begin, checkpoint_diff, checkpoint_finish, checkpoint_open,
    checkpoint_preview, checkpoint_restore,
};
use commands::cli::{check_cli, cli_generate};
use commands::codex::{codex_abort, codex_check, codex_generate, codex_list_models};
use commands::cursor::{
    cursor_abort, cursor_check, cursor_generate, cursor_list_models, cursor_login,
};
use commands::antigravity::{antigravity_abort, antigravity_check, antigravity_generate, antigravity_list_models};
use commands::git::{
    git_avatars, git_branches, git_changes, git_commit, git_commit_context, git_commit_file_diff, git_commit_files,
    git_create_branch, git_discard, git_fetch, git_file_diff, git_init, git_log, git_pull,
    git_push, git_stage, git_stage_all, git_status, git_switch_branch, git_unstage,
};
use commands::mcp::{mcp_auth, mcp_auth_remove, mcp_diagnose, mcp_status, mcp_sync};
use commands::mcp_oauth::{mcp_auth_cancel, mcp_oauth_prepare};
use commands::mcp_registry::{mcp_registry_get, mcp_registry_icon, mcp_registry_search};
use commands::native_alert::native_alert;
use commands::setup::{setup_cancel, setup_codex_login, setup_install, setup_plan, setup_scan};
use commands::opencode::{
    opencode_abort, opencode_check, opencode_configure_providers, opencode_default_cwd,
    opencode_delete_session,
    opencode_generate, opencode_list_models, opencode_permission_reply, opencode_question_reply,
    opencode_set_auth,
    opencode_warm, warm_up_server,
};
use commands::storage::{
    history_import_legacy, history_load, history_save, secrets_load, secrets_save,
    skills_dir, skills_export_folder, skills_fetch_url, skills_install, skills_installed,
    skills_read_asset, skills_scan_folder, skills_search_repos, skills_sync, skills_uninstall,
};
use commands::smithery::{
    smithery_check_key, smithery_search_servers, smithery_search_skills, smithery_server,
};
use commands::supervisor;
use sandbox::{get_audit_logs, get_sandbox_status};

/// Windows/Linux: no menu bar in the window.
/// macOS: the menu lives in the global menu bar, and Cmd+C / Cmd+V / Cmd+X /
/// Cmd+A / Cmd+Z only reach the webview through the Edit menu's items, so an
/// empty menu breaks copy and paste everywhere in the app.
fn app_menu<R: tauri::Runtime>(
    handle: &tauri::AppHandle<R>,
) -> tauri::Result<tauri::menu::Menu<R>> {
    #[cfg(target_os = "macos")]
    {
        use tauri::menu::{Menu, PredefinedMenuItem, Submenu};
        let app = Submenu::with_items(
            handle,
            "Mali Cowork",
            true,
            &[
                &PredefinedMenuItem::about(handle, None, None)?,
                &PredefinedMenuItem::separator(handle)?,
                &PredefinedMenuItem::hide(handle, None)?,
                &PredefinedMenuItem::hide_others(handle, None)?,
                &PredefinedMenuItem::show_all(handle, None)?,
                &PredefinedMenuItem::separator(handle)?,
                &PredefinedMenuItem::quit(handle, None)?,
            ],
        )?;
        let edit = Submenu::with_items(
            handle,
            "Edit",
            true,
            &[
                &PredefinedMenuItem::undo(handle, None)?,
                &PredefinedMenuItem::redo(handle, None)?,
                &PredefinedMenuItem::separator(handle)?,
                &PredefinedMenuItem::cut(handle, None)?,
                &PredefinedMenuItem::copy(handle, None)?,
                &PredefinedMenuItem::paste(handle, None)?,
                &PredefinedMenuItem::select_all(handle, None)?,
            ],
        )?;
        let window = Submenu::with_items(
            handle,
            "Window",
            true,
            &[
                &PredefinedMenuItem::minimize(handle, None)?,
                &PredefinedMenuItem::close_window(handle, None)?,
            ],
        )?;
        Menu::with_items(handle, &[&app, &edit, &window])
    }
    #[cfg(not(target_os = "macos"))]
    {
        tauri::menu::Menu::new(handle)
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // โหลด .env ที่ root ของโปรเจค เฉพาะตอน dev เท่านั้น
    // release build ห้ามโหลด: dotenv() ค้นหา .env จากโฟลเดอร์ที่เปิดแอปขึ้นไปทุกชั้น
    // ถ้าเปิดแอปจากโฟลเดอร์ที่มี .env แปลกปลอม มันตั้ง OPENCODE_BIN ฯลฯ ให้รันโปรแกรมอื่นได้
    #[cfg(debug_assertions)]
    {
        let _ = dotenvy::dotenv();
        // เผื่อรันจาก src-tauri/ ให้ลองโหลด ../.env อีกรอบ
        let _ = dotenvy::from_path("../.env");
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_notification::init())
        .menu(app_menu)
        .setup(|app| {
            supervisor::exit_on_signals();
            // So a system notification carries the app's name and icon.
            commands::native_alert::init(&app.config().identifier);
            // Start opencode in the background so the first prompt is fast.
            tauri::async_runtime::spawn(async {
                if let Err(e) = warm_up_server().await {
                    eprintln!("[opencode] warm-up skipped: {e}");
                    return;
                }
                // Load Chat mode's folder now so the first chat answers sooner.
                if let Err(e) = opencode_warm(None, Some("chat".into())).await {
                    eprintln!("[opencode] chat warm-up failed: {e}");
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            attachment_import,
            attachment_save,
            link_preview,
            chat_generate,
            checkpoint_begin,
            checkpoint_add_folder,
            checkpoint_finish,
            checkpoint_restore,
            checkpoint_diff,
            checkpoint_preview,
            checkpoint_open,
            cli_generate,
            check_cli,
            opencode_generate,
            opencode_check,
            opencode_list_models,
            opencode_default_cwd,
            opencode_permission_reply,
            opencode_abort,
            opencode_set_auth,
            opencode_question_reply,
            opencode_delete_session,
            opencode_warm,
            opencode_configure_providers,
            mcp_sync,
            mcp_status,
            mcp_diagnose,
            mcp_auth,
            mcp_auth_remove,
            mcp_auth_cancel,
            mcp_oauth_prepare,
            native_alert,
            mcp_registry_search,
            mcp_registry_get,
            mcp_registry_icon,
            setup_scan,
            setup_plan,
            setup_install,
            setup_cancel,
            setup_codex_login,
            cursor_generate,
            cursor_check,
            cursor_login,
            cursor_list_models,
            cursor_abort,
            codex_generate,
            codex_check,
            codex_list_models,
            codex_abort,
            antigravity_generate,
            antigravity_check,
            antigravity_list_models,
            antigravity_abort,
            git_status,
            git_init,
            git_file_diff,
            git_changes,
            git_avatars,
            git_stage,
            git_stage_all,
            git_unstage,
            git_discard,
            git_commit,
            git_commit_context,
            git_log,
            git_commit_files,
            git_commit_file_diff,
            git_branches,
            git_switch_branch,
            git_create_branch,
            git_fetch,
            git_pull,
            git_push,
            provider_env_keys,
            provider_check_key,
            ollama_list_models,
            history_load,
            history_save,
            history_import_legacy,
            secrets_load,
            secrets_save,
            skills_fetch_url,
            skills_scan_folder,
            skills_export_folder,
            skills_read_asset,
            skills_search_repos,
            skills_dir,
            skills_install,
            skills_installed,
            skills_sync,
            skills_uninstall,
            smithery_check_key,
            smithery_search_skills,
            smithery_search_servers,
            smithery_server,
            get_sandbox_status,
            get_audit_logs
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_, event| {
            // Stop opencode, running agents and the MCP servers they started.
            if let tauri::RunEvent::Exit = event {
                supervisor::shutdown_all();
            }
        });
}
