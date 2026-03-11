// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

// The invoke handler registers ~6 300 commands via tauri::generate_handler!
// which creates deeply nested recursive tuple types.  Resolving a command
// near the end of a large handler walks the full nesting depth, exceeding
// the default 1 MB Windows stack.  Reserve 8 MB for the main thread via the
// linker so the event loop stays on the main thread (required on Windows).
#[cfg(windows)]
#[link_section = ".drectve"]
#[used]
static STACK_RESERVE: [u8; 46] = *b" /STACK:8388608                               ";

fn main() {
    app_lib::run();
}
