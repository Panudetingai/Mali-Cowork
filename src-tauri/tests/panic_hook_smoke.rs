//! panic บน tokio worker ต้องถูกบันทึกลงไฟล์ก่อนโปรเซสตาย
//!
//! อยู่ใน tests/ ไม่ใช่ unit test เพราะ `set_hook` เป็น global state —
//! test binary แยกโปรเซสจึงไม่ไปกวน test อื่นที่ตั้งใจ panic
#[test]
fn panic_in_tokio_worker_is_logged() {
    let log = std::env::temp_dir().join("mali-panic-smoke.log");
    let _ = std::fs::remove_file(&log);
    std::env::set_var("MALI_PANIC_LOG", &log);
    mali_cowork_lib::panic_log::install();

    let rt = tokio::runtime::Builder::new_multi_thread().worker_threads(1).build().unwrap();
    let handle = rt.spawn(async {
        let s = "สวัสดีครับ";
        let _ = &s[..4]; // ตัดกลางตัวอักษรไทย -> panic แบบเดียวกับของจริง
    });
    let _ = rt.block_on(handle);

    let text = std::fs::read_to_string(&log).expect("ต้องมีไฟล์ panic log");
    assert!(text.contains("===== PANIC ====="));
    assert!(text.contains("char boundary"));
    // ชื่อ thread ต้องติดไปด้วย — crash report จาก production ชี้มาที่ tokio-rt-worker
    assert!(text.contains("thread  : tokio-rt-worker"), "{text}");
}
