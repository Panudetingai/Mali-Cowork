mod ai;
mod chat_stream;
mod commands;

use commands::chat::{chat_generate, ollama_list_models, provider_env_keys};
use commands::cli::{check_cli, cli_generate};
use commands::cursor::{
    cursor_abort, cursor_check, cursor_generate, cursor_list_models, cursor_login,
};
use commands::mcp::{mcp_diagnose, mcp_status, mcp_sync};
use commands::opencode::{
    opencode_abort, opencode_check, opencode_default_cwd, opencode_delete_session,
    opencode_generate, opencode_list_models, opencode_permission_reply, opencode_set_auth,
    opencode_warm, shutdown_server, warm_up_server,
};

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
        // ลบ native menu bar ทั้ง Windows/Linux และ macOS (global menu)
        // ถ้าไม่สร้าง menu จะไม่มีแถบเมนูในหน้าต่าง; บน macOS จะเหลือแค่ชื่อแอปแบบว่างๆ
        .menu(|handle| tauri::menu::Menu::new(handle))
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
            mcp_sync,
            mcp_status,
            mcp_diagnose,
            cursor_generate,
            cursor_check,
            cursor_login,
            cursor_list_models,
            cursor_abort,
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
