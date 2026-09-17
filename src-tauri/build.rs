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
            Ok("windows") => {
                // /OPT:REF may discard the complete decoder COMDAT before it
                // observes the direct version probe, which also removes the
                // DLL import descriptor. Retain only that import-address-table
                // symbol at the final app link. This keeps OpenH264 a required
                // process dependency without whole-archiving every export in
                // openh264.lib. The spelling is shared by Windows x64 and
                // ARM64 MSVC import libraries.
                println!("cargo:rustc-link-arg=/INCLUDE:__imp_WelsGetCodecVersionEx");
            }
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

    embed_app_identity();

    tauri_build::build()
}

/// Resolve the identifier tauri-build compiles into the app, from the same
/// inputs it merges (`tauri.conf.json`, the target's platform file, then the
/// `TAURI_CONFIG` merge patch), and hand it to `src/app_profile.rs` as
/// `SORNG_BUILD_IDENTIFIER`. Every profile directory, the WebView2 folder and
/// the keychain namespace follow this identifier, so any input the resolver
/// cannot read exactly as tauri-build does fails the build.
fn embed_app_identity() {
    let tauri_dir = std::path::PathBuf::from(
        std::env::var_os("CARGO_MANIFEST_DIR").expect("cargo sets CARGO_MANIFEST_DIR"),
    );
    // Mirrors tauri_utils::platform::Target::from_triple.
    let target = std::env::var("TARGET").expect("cargo sets TARGET");
    let platform = if target.contains("darwin") {
        "macos"
    } else if target.contains("windows") {
        "windows"
    } else if target.contains("android") {
        "android"
    } else if target.contains("ios") {
        "ios"
    } else {
        "linux"
    };

    for unsupported in [
        "tauri.conf.json5".to_string(),
        "Tauri.toml".to_string(),
        format!("tauri.{platform}.conf.json5"),
        format!("Tauri.{platform}.toml"),
    ] {
        if tauri_dir.join(&unsupported).exists() {
            panic!(
                "src-tauri/{unsupported} is not supported: build.rs resolves the compiled app identifier from JSON Tauri config only"
            );
        }
    }

    let read_config = |name: &str| {
        let path = tauri_dir.join(name);
        println!("cargo:rerun-if-changed={}", path.display());
        std::fs::read_to_string(&path)
            .unwrap_or_else(|error| panic!("cannot read src-tauri/{name}: {error}"))
    };
    let base = read_config("tauri.conf.json");
    let platform_name = format!("tauri.{platform}.conf.json");
    let platform_config = tauri_dir
        .join(&platform_name)
        .exists()
        .then(|| read_config(&platform_name));

    println!("cargo:rerun-if-env-changed=TAURI_CONFIG");
    let tauri_config = match std::env::var("TAURI_CONFIG") {
        Ok(value) => Some(value),
        Err(std::env::VarError::NotPresent) => None,
        Err(std::env::VarError::NotUnicode(_)) => {
            panic!("TAURI_CONFIG is not valid Unicode; cannot resolve the compiled app identifier")
        }
    };

    let identifier = sorng_core::app_identity::resolve_build_identifier(
        &base,
        platform_config.as_deref(),
        tauri_config.as_deref(),
    )
    .unwrap_or_else(|error| panic!("cannot resolve the compiled app identifier: {error}"));
    println!("cargo:rustc-env=SORNG_BUILD_IDENTIFIER={identifier}");
}
