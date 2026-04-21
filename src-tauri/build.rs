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

    // ── Pluggable updater endpoint (t3-e39) ─────────────────────────────
    //
    // If the build environment defines `UPDATER_PRIVATE_ENDPOINT_URL`,
    // append it to `plugins.updater.endpoints` in `tauri.conf.json` at
    // build time. The public GitHub Releases endpoint (wired by t3-e21)
    // is preserved as the first entry so signature verification parity
    // is maintained (same embedded Ed25519 pubkey, two endpoints checked
    // in order). If the env var is missing, the file is untouched.
    //
    // See `docs/release/private-updater-endpoint.md` for enterprise
    // deployment flow + `latest.json` schema.
    println!("cargo:rerun-if-env-changed=UPDATER_PRIVATE_ENDPOINT_URL");
    if let Ok(private_endpoint) = std::env::var("UPDATER_PRIVATE_ENDPOINT_URL") {
        let trimmed = private_endpoint.trim();
        if !trimmed.is_empty() {
            inject_private_endpoint(trimmed);
        }
    }

    tauri_build::build()
}

/// Parse `tauri.conf.json`, append the given URL to
/// `plugins.updater.endpoints` if not already present, and write it back.
///
/// This intentionally mutates the committed config on disk: enterprise
/// builds are expected to run against fresh checkouts (CI container or
/// throwaway workstation clone). Do NOT set the env var in a developer
/// shell where you plan to commit from — the resulting diff should not
/// be committed upstream.
fn inject_private_endpoint(url: &str) {
    let conf_path = std::path::Path::new("tauri.conf.json");
    let raw = match std::fs::read_to_string(conf_path) {
        Ok(s) => s,
        Err(e) => {
            println!(
                "cargo:warning=t3-e39: cannot read tauri.conf.json ({e}); skipping private-endpoint injection"
            );
            return;
        }
    };

    let mut root: serde_json::Value = match serde_json::from_str(&raw) {
        Ok(v) => v,
        Err(e) => {
            println!(
                "cargo:warning=t3-e39: tauri.conf.json is not valid JSON ({e}); skipping private-endpoint injection"
            );
            return;
        }
    };

    // Validate URL shape — fail closed if malformed.
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        println!(
            "cargo:warning=t3-e39: UPDATER_PRIVATE_ENDPOINT_URL must be http(s) (got {url:?}); skipping"
        );
        return;
    }

    // Navigate / create plugins.updater.endpoints.
    let plugins = root
        .as_object_mut()
        .and_then(|o| {
            o.entry("plugins")
                .or_insert_with(|| serde_json::json!({}))
                .as_object_mut()
        });
    let Some(plugins) = plugins else {
        println!("cargo:warning=t3-e39: tauri.conf.json root is not an object; skipping");
        return;
    };
    let updater = plugins
        .entry("updater")
        .or_insert_with(|| serde_json::json!({}))
        .as_object_mut();
    let Some(updater) = updater else {
        println!("cargo:warning=t3-e39: plugins.updater is not an object; skipping");
        return;
    };
    let endpoints = updater
        .entry("endpoints")
        .or_insert_with(|| serde_json::json!([]));
    if !endpoints.is_array() {
        println!("cargo:warning=t3-e39: plugins.updater.endpoints is not an array; skipping");
        return;
    }
    let arr = endpoints.as_array_mut().expect("checked above");

    // Skip if already present (idempotent across incremental builds).
    let already = arr
        .iter()
        .any(|v| v.as_str().map(|s| s == url).unwrap_or(false));
    if already {
        return;
    }
    arr.push(serde_json::Value::String(url.to_string()));

    // Pretty-print to preserve diff readability.
    let new_raw = match serde_json::to_string_pretty(&root) {
        Ok(s) => s,
        Err(e) => {
            println!("cargo:warning=t3-e39: serialize tauri.conf.json failed ({e}); skipping");
            return;
        }
    };
    if let Err(e) = std::fs::write(conf_path, format!("{new_raw}\n")) {
        println!("cargo:warning=t3-e39: write tauri.conf.json failed ({e}); skipping");
        return;
    }
    println!(
        "cargo:warning=t3-e39: injected private updater endpoint into tauri.conf.json: {url}"
    );
}
