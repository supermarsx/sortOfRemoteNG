// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

// The invoke handler registers ~6 300 commands across 10 generate_handler!
// macros (the largest has ~1 270 entries).  Each macro creates deeply nested
// recursive tuple types whose dispatch walks the full nesting depth,
// exceeding the default 1 MB Windows stack.  Reserve 32 MB for the main
// thread via the linker so the event loop stays on the main thread
// (required on Windows).
#[cfg(windows)]
#[link_section = ".drectve"]
#[used]
static STACK_RESERVE: [u8; 47] = *b" /STACK:33554432                               ";

fn main() {
    app_lib::run();
}
