fn main() {
    let target_os = std::env::var("CARGO_CFG_TARGET_OS").ok();
    let target_env = std::env::var("CARGO_CFG_TARGET_ENV").ok();

    if target_os.as_deref() == Some("windows") && target_env.as_deref() == Some("gnu") {
        println!("cargo:rustc-link-lib=dylib=advapi32");
    }
}