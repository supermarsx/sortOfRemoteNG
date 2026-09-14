// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

// Retain the existing 32 MB main-thread stack reserve while command handlers
// are split into bounded compiler units. generate_handler! produces match arms,
// not recursive tuple dispatch. Changing the reserve requires separate runtime
// validation; the Windows event loop must remain on the main thread.
#[cfg(windows)]
#[link_section = ".drectve"]
#[used]
static STACK_RESERVE: [u8; 47] = *b" /STACK:33554432                               ";

fn main() {
    app_lib::run();
}
