// GUI on Windows: no extra console when opening Mali.exe (dev or release).
#![cfg_attr(windows, windows_subsystem = "windows")]

fn main() {
    mali_cowork_lib::run()
}
