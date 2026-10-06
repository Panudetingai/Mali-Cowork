//! Live CPU, memory, disk and GPU readings for the notch home card.
//!
//! A background thread samples sysinfo (and occasional Windows GPU counters)
//! so the notch never blocks on `Get-Counter` or disk rescans.

use serde::Serialize;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};
use sysinfo::{Disks, System};

const SAMPLE_EVERY: Duration = Duration::from_secs(3);
const DISK_EVERY: Duration = Duration::from_secs(30);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemStatsSnapshot {
    pub cpu_percent: f32,
    pub ram_used_mb: u64,
    pub ram_total_mb: u64,
    pub disk_used_pct: f32,
    pub disk_used_gb: u64,
    pub disk_total_gb: u64,
    pub gpu_percent: Option<f32>,
    /// Shown as a hint under GPU % (e.g. the adapter name on Windows).
    pub gpu_label: Option<String>,
}

impl Default for SystemStatsSnapshot {
    fn default() -> Self {
        Self {
            cpu_percent: 0.0,
            ram_used_mb: 0,
            ram_total_mb: 0,
            disk_used_pct: 0.0,
            disk_used_gb: 0,
            disk_total_gb: 0,
            gpu_percent: None,
            gpu_label: None,
        }
    }
}

static CACHE: OnceLock<Arc<Mutex<SystemStatsSnapshot>>> = OnceLock::new();

fn cache() -> Arc<Mutex<SystemStatsSnapshot>> {
    CACHE
        .get_or_init(|| Arc::new(Mutex::new(SystemStatsSnapshot::default())))
        .clone()
}

fn disk_from(disks: &Disks) -> (f32, u64, u64) {
    let pick = disks.list().iter().find(|d| {
        let mount = d.mount_point().to_string_lossy();
        #[cfg(windows)]
        {
            mount.starts_with("C:")
        }
        #[cfg(not(windows))]
        {
            mount == "/"
        }
    }).or_else(|| disks.list().first());

    let Some(disk) = pick else {
        return (0.0, 0, 0);
    };
    let total = disk.total_space();
    let available = disk.available_space();
    let used = total.saturating_sub(available);
    let pct = if total > 0 {
        (used as f64 / total as f64 * 100.0) as f32
    } else {
        0.0
    };
    let gb = |bytes: u64| bytes / 1024 / 1024 / 1024;
    (pct, gb(used), gb(total))
}

#[cfg(windows)]
fn gpu_name_windows() -> Option<String> {
    run_with_timeout(Duration::from_millis(2_500), || {
        let out = crate::commands::process::std_command("powershell")
            .args([
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                "(Get-CimInstance Win32_VideoController | Select-Object -First 1 -ExpandProperty Name)",
            ])
            .output()
            .ok()?;
        let name = String::from_utf8_lossy(&out.stdout).trim().to_string();
        if name.is_empty() { None } else { Some(name) }
    })
    .flatten()
}

/// sysinfo 0.39 has no GPU API on Unix; the notch omits GPU % unless we add a
/// platform-specific probe later (Windows uses WMI for the label only).
#[cfg(not(windows))]
fn gpu_from_sys(_sys: &mut System) -> (Option<String>, Option<f32>) {
    (None, None)
}

fn cpu_percent(sys: &System) -> f32 {
    let cpus = sys.cpus();
    if cpus.is_empty() {
        return sys.global_cpu_usage().clamp(0.0, 100.0);
    }
    let sum: f32 = cpus.iter().map(|c| c.cpu_usage()).sum();
    (sum / cpus.len() as f32).clamp(0.0, 100.0)
}

fn run_with_timeout<T: Send + 'static>(
    timeout: Duration,
    work: impl FnOnce() -> T + Send + 'static,
) -> Option<T> {
    let (tx, rx) = std::sync::mpsc::sync_channel(1);
    std::thread::spawn(move || {
        let _ = tx.send(work());
    });
    rx.recv_timeout(timeout).ok()
}

fn sample(
    sys: &mut System,
    disks: &mut Disks,
    disk_due: bool,
    gpu_label: &mut Option<String>,
    gpu_percent: &mut Option<f32>,
) -> SystemStatsSnapshot {
    sys.refresh_cpu_usage();
    std::thread::sleep(Duration::from_millis(80));
    sys.refresh_cpu_usage();
    sys.refresh_memory();

    if disk_due {
        disks.refresh(false);
    }

    let (disk_used_pct, disk_used_gb, disk_total_gb) = disk_from(disks);

    #[cfg(windows)]
    if gpu_label.is_none() {
        *gpu_label = gpu_name_windows();
    }

    #[cfg(not(windows))]
    {
        let (label, pct) = gpu_from_sys(sys);
        if label.is_some() {
            *gpu_label = label;
        }
        if pct.is_some() {
            *gpu_percent = pct;
        }
    }

    SystemStatsSnapshot {
        cpu_percent: cpu_percent(sys),
        ram_total_mb: sys.total_memory() / 1024 / 1024,
        ram_used_mb: sys.used_memory() / 1024 / 1024,
        disk_used_pct,
        disk_used_gb,
        disk_total_gb,
        gpu_percent: *gpu_percent,
        gpu_label: gpu_label.clone(),
    }
}

fn sampler_loop(store: Arc<Mutex<SystemStatsSnapshot>>) {
    let mut sys = System::new();
    let mut disks = Disks::new_with_refreshed_list();
    let mut gpu_label = None::<String>;
    let mut gpu_percent = None::<f32>;
    let mut last_disk = Instant::now() - DISK_EVERY;

    loop {
        let disk_due = last_disk.elapsed() >= DISK_EVERY;
        if disk_due {
            last_disk = Instant::now();
        }

        let snap = sample(
            &mut sys,
            &mut disks,
            disk_due,
            &mut gpu_label,
            &mut gpu_percent,
        );
        if let Ok(mut guard) = store.lock() {
            *guard = snap;
        }
        std::thread::sleep(SAMPLE_EVERY);
    }
}

/// Starts one background sampler for the whole app (cheap reads from the notch).
pub fn start_sampler() {
    static START: OnceLock<()> = OnceLock::new();
    START.get_or_init(|| {
        let store = cache();
        let mut sys = System::new();
        let mut disks = Disks::new_with_refreshed_list();
        let mut gpu_label = None;
        let mut gpu_percent = None;
        let snap = sample(
            &mut sys,
            &mut disks,
            true,
            &mut gpu_label,
            &mut gpu_percent,
        );
        if let Ok(mut guard) = store.lock() {
            *guard = snap;
        }
        std::thread::spawn(move || sampler_loop(store));
    });
}

#[tauri::command]
pub fn system_stats_snapshot() -> SystemStatsSnapshot {
    cache().lock().map(|g| g.clone()).unwrap_or_default()
}
