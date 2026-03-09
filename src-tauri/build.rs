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

    tauri_build::build()
}
