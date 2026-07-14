fn main() {
    println!("cargo:rerun-if-changed=build.rs");

    let target_os = std::env::var("CARGO_CFG_TARGET_OS").ok();

    if target_os.as_deref() == Some("windows") {
        println!("cargo:rustc-link-lib=advapi32");
    }
}
