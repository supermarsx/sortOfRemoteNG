#[path = "../../../../native/cef_windows_delay_load.rs"]
mod cef_windows_delay_load;

fn main() {
    println!("cargo:rerun-if-changed=build.rs");
    println!("cargo:rerun-if-changed=../../../../native/cef_windows_delay_load.rs");
    // This opt-in fixture always links CEF; the helper gates on the target OS.
    cef_windows_delay_load::configure(true);
}
