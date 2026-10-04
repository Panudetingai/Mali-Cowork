mod agent;
mod ai;
mod http_body;
mod mcp_hub;
mod chat_stream;
mod commands;
pub mod mcp_runner;
mod media;
mod puter;
pub mod panic_log;
mod sandbox;
mod templates;

use commands::app_cache::{app_cache_size, app_clear_cache};
use commands::agent::{agent_abort, agent_answer_question, agent_generate, agent_reply_permission, team_lead_begin, team_lead_end, team_reflect, team_suggest};
use commands::mcp_hub::{mcp_hub_set_servers, mcp_hub_set_workspace, mcp_hub_sign_in, mcp_hub_sign_out, mcp_hub_sync};
use commands::mcp_bridge::mcp_release_other_apps;
use commands::templates::{
    templates_add, templates_export, templates_inspect, templates_list, templates_open, templates_refresh,
    templates_remove, templates_update,
};
use commands::voice::voice_input_status;
use commands::attachments::{attachment_from_url, attachment_import, attachment_read, attachment_save};
use commands::link_preview::link_preview;
use commands::chat::{chat_generate, ollama_list_models, provider_check_key, provider_env_keys, provider_test_model};
use commands::media::media_generate;
use commands::checkpoint::{
    checkpoint_add_folder, checkpoint_begin, checkpoint_diff, checkpoint_finish, checkpoint_open,
    checkpoint_before_text, checkpoint_preview, checkpoint_restore, checkpoint_restore_file,
};
use commands::cli::{check_cli, cli_generate};
use commands::code::{code_delete, code_detect, code_kill, code_read, code_rename, code_run, code_scan, code_write};
use commands::codex::{codex_abort, codex_check, codex_generate, codex_list_models};
use commands::cursor::{
    cursor_abort, cursor_check, cursor_generate, cursor_list_models, cursor_login,
};
use commands::antigravity::{antigravity_abort, antigravity_check, antigravity_generate, antigravity_list_models};
use commands::git::{
    git_avatars, git_branches, git_changes, git_commit, git_commit_context, git_commit_file_diff, git_commit_files,
    git_create_branch, git_discard, git_fetch, git_file_diff, git_init, git_log, git_pull,
    git_push, git_stage, git_stage_all, git_stash, git_status, git_switch_branch, git_unstage,
};
use commands::mcp::mcp_diagnose;
use commands::mcp_oauth::mcp_auth_cancel;
use commands::mcp_registry::{mcp_fetch_icon, mcp_registry_get, mcp_registry_icon, mcp_registry_search};
use commands::native_alert::native_alert;
use commands::notch::{
    notch_backdrop, notch_capture_at_cursor, notch_capture_pick, notch_capture_region, notch_drop_out, notch_enter_mode,
    notch_exit_mode, notch_geometry,
    notch_hide, notch_hit_area, notch_login_item, notch_mode, notch_open_main, notch_release, notch_resize,
    notch_set_login_item, notch_set_screen, notch_show, notch_intro_done, notch_take_intro, NotchState,
};
use commands::outputs::{outputs_stat, outputs_trash};
use commands::preview_image::preview_image;
use commands::quick::{
    quick_capture_region, quick_capture_screen, quick_configure, quick_hide, quick_open_main,
    quick_start_capture_overlay, quick_take_context, QuickState,
};
use commands::setup::{setup_cancel, setup_codex_login, setup_install, setup_plan, setup_scan};
use commands::opencode::{
    opencode_abort, opencode_check, opencode_configure_providers, opencode_default_cwd,
    opencode_delete_session,
    opencode_generate, opencode_list_models, opencode_permission_reply, opencode_question_reply,
    opencode_set_auth,
    opencode_warm, warm_up_server,
};
use commands::storage::{
    history_import_legacy, history_load, history_save, secrets_load, secrets_save, usage_load, usage_record,
    skills_dir, skills_export_folder, skills_fetch_url, skills_install, skills_install_npx, skills_installed,
    skills_read_asset, skills_scan_folder, skills_search_repos, skills_sync, skills_uninstall,
};
use commands::usage_remote::{usage_model_prices, usage_provider_account};
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
    // ติดตั้งก่อนอย่างอื่นทั้งหมด: บันทึกทุก panic (รวม tokio worker) ลงไฟล์
    // ทั้งที่แอปรอดและที่ทำให้แอปตาย — ที่เดียวที่บอกสาเหตุได้
    panic_log::install();

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
        // Updates come from the public releases repo; see `plugins.updater`.
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(commands::quick::shortcut_plugin())
        .manage(QuickState::default())
        .manage(NotchState::default())
        .on_window_event(commands::quick::on_window_event)
        .menu(app_menu)
        .setup(|app| {
            supervisor::exit_on_signals();
            // The main window starts hidden: at login (the login item passes
            // `--notch`) Mali stays in the notch until the app is opened.
            if commands::notch::started_in_notch() {
                commands::notch::start_in_notch(app.handle());
            } else {
                commands::quick::show_main(app.handle());
            }
            // So a system notification carries the app's name and icon.
            commands::native_alert::init(&app.config().identifier);
            // Agent Arena was removed; its worktree copies go with it.
            tauri::async_runtime::spawn(commands::arena::remove_leftovers());
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
            attachment_read,
            attachment_from_url,
            voice_input_status,
            commands::speech::speech_transcribe,
            commands::speech::speech_synthesize,
            templates_list,
            templates_inspect,
            templates_add,
            templates_update,
            templates_refresh,
            templates_remove,
            templates_export,
            templates_open,
            agent_generate,
            agent_reply_permission,
            agent_abort,
            team_lead_begin,
            team_lead_end,
            team_reflect,
            team_suggest,
            agent_answer_question,
            mcp_hub_sync,
            mcp_hub_set_servers,
            mcp_hub_set_workspace,
            mcp_release_other_apps,
            mcp_hub_sign_in,
            mcp_hub_sign_out,
            link_preview,
            chat_generate,
            provider_test_model,
            media_generate,
            puter::puter_models,
            puter::puter_account,
            puter::puter_sign_in,
            puter::puter_sign_in_cancel,
            checkpoint_begin,
            checkpoint_add_folder,
            checkpoint_finish,
            checkpoint_restore,
            checkpoint_diff,
            checkpoint_restore_file,
            checkpoint_before_text,
            checkpoint_preview,
            checkpoint_open,
            outputs_stat,
            outputs_trash,
            quick_configure,
            quick_take_context,
            quick_hide,
            quick_open_main,
            quick_capture_screen,
            quick_start_capture_overlay,
            quick_capture_region,
            notch_show,
            notch_hide,
            notch_resize,
            notch_geometry,
            notch_hit_area,
            notch_backdrop,
            notch_capture_at_cursor,
            notch_capture_pick,
            notch_capture_region,
            notch_enter_mode,
            notch_exit_mode,
            notch_take_intro,
            notch_intro_done,
            notch_mode,
            notch_release,
            notch_open_main,
            notch_drop_out,
            notch_set_screen,
            notch_login_item,
            notch_set_login_item,
            preview_image,
            cli_generate,
            check_cli,
            code_scan,
            code_read,
            code_write,
            code_rename,
            code_delete,
            code_detect,
            code_run,
            code_kill,
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
            mcp_diagnose,
            mcp_auth_cancel,
            native_alert,
            mcp_registry_search,
            mcp_registry_get,
            mcp_registry_icon,
            mcp_fetch_icon,
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
            git_stash,
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
            app_cache_size,
            app_clear_cache,
            usage_record,
            usage_load,
            usage_provider_account,
            usage_model_prices,
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
            skills_install_npx,
            skills_installed,
            skills_sync,
            skills_uninstall,
            smithery_check_key,
            smithery_search_skills,
            smithery_search_servers,
            smithery_server,
            get_sandbox_status,
            sandbox::os_sandbox::sandbox_engine,
            get_audit_logs
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| match event {
            // Stop opencode, running agents and the MCP servers they started.
            tauri::RunEvent::Exit => supervisor::shutdown_all(),
            // Dock click after tray mode or notch mode hid the main window.
            #[cfg(target_os = "macos")]
            tauri::RunEvent::Reopen { .. } => commands::notch::reopen(app),
            _ => {}
        });
}
