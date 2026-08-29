fn main() {
    // ── Compile-time CPU feature detection ─────────────────────────────
    //
    // Emit cfg flags that first-party code can use to conditionally compile
    // optimised paths.  These reflect what the *build machine* supports
    // (or what RUSTFLAGS enables), not necessarily what the end-user has.
    //
    // Usage in Rust source:
    //   #[cfg(has_avx2)]       fn fast_path() { ... }
    //   #[cfg(not(has_avx2))]  fn slow_path() { ... }
    //
    // The RustCrypto crates (aes, sha2, etc.) handle this internally via
    // `cpufeatures`, but our own first-party SIMD code (yuv_convert, etc.)
    // can use these for compile-time specialisation alongside the existing
    // runtime `is_x86_feature_detected!` dispatch.

    let features = [
        // (target_feature name, cfg flag to emit)
        ("sse3", "has_sse3"),
        ("ssse3", "has_ssse3"),
        ("sse4.1", "has_sse41"),
        ("sse4.2", "has_sse42"),
        ("avx", "has_avx"),
        ("avx2", "has_avx2"),
        ("fma", "has_fma"),
        ("aes", "has_aes_ni"),
        ("sha", "has_sha_ni"),
        ("pclmulqdq", "has_pclmulqdq"),
        ("bmi1", "has_bmi1"),
        ("bmi2", "has_bmi2"),
        ("adx", "has_adx"),
        ("popcnt", "has_popcnt"),
        ("lzcnt", "has_lzcnt"),
        ("f16c", "has_f16c"),
    ];

    for (feature, flag) in &features {
        // `cfg!(target_feature = ...)` is evaluated at *this build script's*
        // compile time, which inherits the same RUSTFLAGS.  We re-check by
        // looking at the CARGO_CFG_TARGET_FEATURE env var that Cargo sets.
        let target_features = std::env::var("CARGO_CFG_TARGET_FEATURE").unwrap_or_default();
        let needle = feature.replace('.', "_"); // sse4.1 -> sse4_1 in CARGO_CFG
        if target_features
            .split(',')
            .any(|f| f.trim() == *feature || f.trim() == needle)
        {
            println!("cargo:rustc-cfg={}", flag);
        }
    }

    // Derived composite flags
    let target_features = std::env::var("CARGO_CFG_TARGET_FEATURE").unwrap_or_default();
    let has = |name: &str| -> bool {
        let needle = name.replace('.', "_");
        target_features
            .split(',')
            .any(|f| f.trim() == name || f.trim() == needle)
    };

    if has("aes") && has("pclmulqdq") {
        println!("cargo:rustc-cfg=has_hw_aes_gcm");
    }
    if has("sha") {
        println!("cargo:rustc-cfg=has_hw_sha");
    }
    if has("avx2") && has("bmi2") {
        println!("cargo:rustc-cfg=has_avx2_full");
    }

    // Private updater endpoints are backend-managed runtime settings. The
    // build must not mutate the committed Tauri config when this env var is
    // present; keep the rerun marker only so CI logs make ignored usage clear.
    println!("cargo:rerun-if-env-changed=UPDATER_PRIVATE_ENDPOINT_URL");
    if std::env::var("UPDATER_PRIVATE_ENDPOINT_URL")
        .map(|value| !value.trim().is_empty())
        .unwrap_or(false)
    {
        println!(
            "cargo:warning=UPDATER_PRIVATE_ENDPOINT_URL is ignored; configure private updater endpoints through backend updater settings"
        );
    }

    // The dynamic OpenH264 release profile packages the required ABI-8 module
    // in the platform's conventional private-library directory. Keep these
    // lookup paths scoped to that feature so static development builds retain
    // their existing loader contract.
    if std::env::var_os("CARGO_FEATURE_RDP_SOFTWARE_DECODE_DYNAMIC").is_some() {
        match std::env::var("CARGO_CFG_TARGET_OS").as_deref() {
            Ok("linux") => {
                println!("cargo:rustc-link-arg=-Wl,-rpath,$ORIGIN/../lib/sortOfRemoteNG");
                // Linux toolchains default to --as-needed, so the dependency
                // crate's ordinary -lopenh264 can disappear when LTO/dead-code
                // elimination proves the decoder path is not needed by a
                // particular codegen unit. Keep the codec as a true process
                // dependency: this single push/pop group preserves exactly one
                // DT_NEEDED entry without leaking --no-as-needed to other libs.
                println!(
                    "cargo:rustc-link-arg=-Wl,--push-state,--no-as-needed,-lopenh264,--pop-state"
                );
            }
            Ok("macos") => {
                println!("cargo:rustc-link-arg=-Wl,-rpath,@executable_path/../Frameworks");
            }
            _ => {}
        }
    }

    // The release executable has thousands of statically linked Rust command
    // shims. Ask MSVC to discard unreachable COMDATs and fold identical ones;
    // keep the repository's proven link.exe path instead of switching this
    // exceptionally large graph to rust-lld.
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows")
        && std::env::var("PROFILE").as_deref() == Ok("release")
    {
        for argument in ["/OPT:REF", "/OPT:ICF", "/INCREMENTAL:NO", "/Brepro"] {
            println!("cargo:rustc-link-arg={argument}");
        }
    }

    tauri_build::build()
}
