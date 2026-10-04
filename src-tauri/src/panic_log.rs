//! เก็บ panic ลงไฟล์ก่อนโปรเซสตาย
//!
//! release ใช้ `panic = "unwind"`: panic ใน tokio task จะตายแค่ task นั้น แอปยังอยู่
//! แต่ panic ที่ข้าม FFI (callback ของ AppKit/WebKit) ยัง abort ทั้งโปรเซสได้ —
//! hook ตัวนี้บันทึกทุก panic ไว้ ไม่ว่าแอปจะรอดหรือไม่ (hook ถูกเรียกก่อน unwind/abort เสมอ)

use std::backtrace::Backtrace;
use std::fs::OpenOptions;
use std::io::Write;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};

const MAX_BYTES: u64 = 2 * 1024 * 1024;

/// ไฟล์ log — override ได้ด้วย `MALI_PANIC_LOG` เวลาทำ support request หรือเทสต์
pub fn panic_log_path() -> PathBuf {
    if let Some(path) = std::env::var_os("MALI_PANIC_LOG") {
        return PathBuf::from(path);
    }
    dirs::data_local_dir()
        .unwrap_or_else(std::env::temp_dir)
        .join("mali-cowork")
        .join("panic.log")
}

/// ติดตั้ง hook ครั้งเดียว ให้เรียกเป็นบรรทัดแรกสุดของ `run()`
/// เพื่อให้ครอบคลุม panic ที่เกิดใน tokio worker, spawn_blocking และ setup ของ Tauri
pub fn install() {
    static INSTALLED: AtomicBool = AtomicBool::new(false);
    if INSTALLED.swap(true, Ordering::SeqCst) {
        return;
    }

    // เก็บ hook เดิมไว้ ยังอยากได้ข้อความบน stderr ตอน dev เหมือนเดิม
    let previous = std::panic::take_hook();

    std::panic::set_hook(Box::new(move |info| {
        // hook เองห้าม panic ซ้ำ ไม่งั้นจะได้ "panic in a panic" แทนข้อมูลจริง
        let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            write_record(info);
        }));
        previous(info);
    }));
}

fn write_record(info: &std::panic::PanicHookInfo<'_>) {
    let thread = std::thread::current();
    let thread_name = thread.name().unwrap_or("<unnamed>").to_string();

    let location = info
        .location()
        .map(|l| format!("{}:{}:{}", l.file(), l.line(), l.column()))
        .unwrap_or_else(|| "<unknown>".to_string());

    // payload ของ panic มาได้ทั้ง &str และ String
    let payload = info.payload();
    let message = payload
        .downcast_ref::<&str>()
        .map(|s| (*s).to_string())
        .or_else(|| payload.downcast_ref::<String>().cloned())
        .unwrap_or_else(|| "<non-string panic payload>".to_string());

    // force_capture ไม่สนใจ RUST_BACKTRACE — ผู้ใช้ปลายทางไม่ได้ตั้ง env ให้เราอยู่แล้ว
    let backtrace = Backtrace::force_capture();

    let record = format!(
        "\n===== PANIC =====\n\
         time    : {}\n\
         version : {}\n\
         thread  : {}\n\
         location: {}\n\
         message : {}\n\
         backtrace:\n{}\n",
        timestamp(),
        env!("CARGO_PKG_VERSION"),
        thread_name,
        location,
        message,
        backtrace,
    );

    // stderr ไว้ก่อน เผื่อเขียนไฟล์ไม่ได้ (สิทธิ์, ดิสก์เต็ม)
    eprintln!("{record}");

    let path = panic_log_path();
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    // ไฟล์โตเกินเพดานก็ทิ้งของเก่า — log ตัวนี้คือของช่วยดีบัก ไม่ใช่หลักฐาน
    if std::fs::metadata(&path).is_ok_and(|m| m.len() > MAX_BYTES) {
        let _ = std::fs::remove_file(&path);
    }
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(&path) {
        let _ = file.write_all(record.as_bytes());
        let _ = file.flush();
    }
}

/// เวลาแบบ UTC ที่อ่านออก โดยไม่ต้องลากเอา chrono เข้ามาทั้ง crate
fn timestamp() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);

    let days = secs / 86_400;
    let tod = secs % 86_400;
    let (h, m, s) = (tod / 3600, (tod % 3600) / 60, tod % 60);

    // civil_from_days (Howard Hinnant) — แปลง epoch day เป็นปฏิทิน
    let z = days as i64 + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let mth = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = if mth <= 2 { y + 1 } else { y };

    format!("{year:04}-{mth:02}-{d:02}T{h:02}:{m:02}:{s:02}Z")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn timestamp_has_the_right_shape() {
        let t = timestamp();
        assert_eq!(t.len(), 20, "{t}");
        assert!(t.ends_with('Z'), "{t}");
        assert!(t.starts_with("20"), "{t}");
    }

    #[test]
    fn installing_twice_is_a_no_op() {
        install();
        install();
    }
}
