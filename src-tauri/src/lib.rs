mod ai;
mod chat_stream;
mod commands;

use commands::chat::{chat_generate, ollama_list_models, provider_env_keys};
use commands::cli::{check_cli, cli_generate};
use commands::codex::{codex_abort, codex_check, codex_generate, codex_list_models};
use commands::cursor::{
    cursor_abort, cursor_check, cursor_generate, cursor_list_models, cursor_login,
};
use commands::gemini::{gemini_abort, gemini_check, gemini_generate, gemini_list_models};
use commands::mcp::{mcp_diagnose, mcp_status, mcp_sync};
use commands::opencode::{
    opencode_abort, opencode_check, opencode_configure_providers, opencode_default_cwd,
    opencode_delete_session,
    opencode_generate, opencode_list_models, opencode_permission_reply, opencode_set_auth,
    opencode_warm, shutdown_server, warm_up_server,
};

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
    // โหลด .env ที่ root ของโปรเจค (D:\mali_cowork\.env) — Rust ไม่ได้โหลดอัตโนมัติ
    // ถ้าไม่มีไฟล์หรือโหลดไม่สำเร็จก็ไม่ error แค่ .ok()
    let _ = dotenvy::dotenv();
    // เผื่อรันจาก src-tauri/ ให้ลองโหลด ../.env อีกรอบ
    let _ = dotenvy::from_path("../.env");

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .menu(app_menu)
        .setup(|_| {
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
            chat_generate,
            cli_generate,
            check_cli,
            opencode_generate,
            opencode_check,
            opencode_list_models,
            opencode_default_cwd,
            opencode_permission_reply,
            opencode_abort,
            opencode_set_auth,
            opencode_delete_session,
            opencode_warm,
            opencode_configure_providers,
            mcp_sync,
            mcp_status,
            mcp_diagnose,
            cursor_generate,
            cursor_check,
            cursor_login,
            cursor_list_models,
            cursor_abort,
            codex_generate,
            codex_check,
            codex_list_models,
            codex_abort,
            gemini_generate,
            gemini_check,
            gemini_list_models,
            gemini_abort,
            provider_env_keys,
            ollama_list_models
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_, event| {
            if let tauri::RunEvent::Exit = event {
                shutdown_server();
            }
        });
}
