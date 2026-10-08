fn main() {
    println!("cargo:rerun-if-changed=src/platform/macos_application.mm");
    println!("cargo:rerun-if-changed=src/platform/macos_occlusion.mm");
    println!("cargo:rerun-if-changed=src/platform/windows_bootstrap_abi.cc");
    println!("cargo:rerun-if-env-changed=CEF_PATH");
    if std::env::var_os("CARGO_FEATURE_CEF_HOST").is_none() {
        return;
    }
    let target_os = std::env::var("CARGO_CFG_TARGET_OS").unwrap();
    if target_os == "windows" || target_os == "macos" {
        // Use the exact SDK selected by cef-dll-sys, including when it rejects
        // an incompatible CEF_PATH and resolves a versioned distribution.
        let root = std::path::PathBuf::from(
            std::env::var_os("DEP_CEF_DLL_WRAPPER_CEF_DIR")
                .expect("CEF host: the pinned SDK directory is unavailable"),
        );
        if target_os == "windows" {
            cc::Build::new()
                .cpp(true)
                .file("src/platform/windows_bootstrap_abi.cc")
                .include(root)
                .flag("/std:c++17")
                .compile("sorng_cef_bootstrap_abi");
            return;
        }
        assert!(
            root.join("include/cef_application_mac.h").is_file(),
            "CEF host: pinned macOS application bridge header is missing"
        );
        println!(
            "cargo:rustc-env=SORNG_CEF_TEST_RUNTIME_DIR={}",
            root.display()
        );
        cc::Build::new()
            .cpp(true)
            .file("src/platform/macos_application.mm")
            .file("src/platform/macos_occlusion.mm")
            .include(root)
            // CEF 154's ref-count headers use C++20 concepts (same_as,
            // derived_from). The Objective-C++ bridges include those headers.
            .std("c++20")
            .flag("-fobjc-arc")
            .flag("-mmacosx-version-min=14.0")
            .compile("sorng_cef_application_bridge");
        println!("cargo:rustc-link-lib=framework=AppKit");
        println!("cargo:rustc-link-lib=framework=QuartzCore");
    }
}
