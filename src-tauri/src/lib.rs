mod ai;
mod chat_stream;
mod commands;

use commands::chat::chat_generate;
use commands::cli::{check_cli, cli_generate};
use commands::opencode::{
    opencode_check, opencode_default_cwd, opencode_generate, opencode_list_models,
};
use commands::socket::{socket_generate, socket_tcp_generate, socket_ws_generate};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // โหลด .env ที่ root ของโปรเจค (D:\mali_cowork\.env) — Rust ไม่ได้โหลดอัตโนมัติ
    // ถ้าไม่มีไฟล์หรือโหลดไม่สำเร็จก็ไม่ error แค่ .ok()
    let _ = dotenvy::dotenv();
    // เผื่อรันจาก src-tauri/ ให้ลองโหลด ../.env อีกรอบ
    let _ = dotenvy::from_path("../.env");

    // debug: เช็คว่าโหลดได้ไหม (จะเห็นใน terminal ตอน bun tauri dev)
    if std::env::var("OPENROUTER_API_KEY").is_err() {
        eprintln!("[mali_cowork] OPENROUTER_API_KEY not found. Set it in .env at project root.");
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        // ลบ native menu bar ทั้ง Windows/Linux และ macOS (global menu)
        // ถ้าไม่สร้าง menu จะไม่มีแถบเมนูในหน้าต่าง; บน macOS จะเหลือแค่ชื่อแอปแบบว่างๆ
        .menu(|handle| tauri::menu::Menu::new(handle))
        .invoke_handler(tauri::generate_handler![
            chat_generate,
            cli_generate,
            check_cli,
            opencode_generate,
            opencode_check,
            opencode_list_models,
            opencode_default_cwd,
            socket_generate,
            socket_ws_generate,
            socket_tcp_generate
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
