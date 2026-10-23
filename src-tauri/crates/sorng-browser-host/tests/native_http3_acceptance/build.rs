#[path = "../../../../native/cef_windows_delay_load.rs"]
mod cef_windows_delay_load;

fn main() {
    println!("cargo:rerun-if-changed=build.rs");
    println!("cargo:rerun-if-changed=../../../../native/cef_windows_delay_load.rs");
    cef_windows_delay_load::configure(std::env::var_os("CARGO_FEATURE_CEF").is_some());
}
