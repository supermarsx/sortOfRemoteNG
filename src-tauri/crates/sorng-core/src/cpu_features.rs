//! # CPU Feature Detection & Performance Capabilities
//!
//! Provides comprehensive **runtime** detection of x86-64 instruction-set
//! extensions that accelerate the hot paths throughout the application:
//!
//! | Extension family      | Accelerated subsystems                          |
//! |-----------------------|-------------------------------------------------|
//! | **AES-NI / VAES**     | `aes-gcm`, TLS (`ring`, `rustls`), SSH, vault   |
//! | **PCLMULQDQ / VPCLMULQDQ** | AES-GCM carry-less multiply              |
//! | **SHA-NI**            | `sha2`, `sha1`, PBKDF2, HMAC, HKDF (25+ crates) |
//! | **AVX / AVX2**        | `ed25519-dalek`, `argon2`, `zstd`, YUV convert   |
//! | **SSE4.1 / SSSE3**    | `openh264` IDCT/deblocking, pixel conversion     |
//! | **BMI1 / BMI2 / ADX** | RSA/ECC bignum, `zstd` match-finding             |
//! | **AVX-512**           | YUV conversion, future crypto backends            |
//! | **RDRAND / RDSEED**   | Hardware entropy for key generation               |
//! | **FMA**               | Fused multiply-add (LLM / AI inference)           |
//!
//! All detection uses [`std::arch::is_x86_feature_detected!`] which performs
//! a one-time CPUID check cached in an atomic flag — negligible overhead even
//! if called on every frame.
//!
//! ## Usage
//!
//! ```rust,ignore
//! use sorng_core::cpu_features;
//!
//! // Run once at startup (after logging is initialised):
//! cpu_features::log_all_features();
//!
//! // Query individual capabilities:
//! let caps = cpu_features::detect();
//! if caps.has_aes_ni {
//!     log::info!("AES-NI available — hardware-accelerated AES-GCM");
//! }
//! ```

use serde::{Deserialize, Serialize};

// ═══════════════════════════════════════════════════════════════════════
// Capability struct
// ═══════════════════════════════════════════════════════════════════════

/// Snapshot of all CPU instruction-set extensions relevant to the
/// performance-critical subsystems in SortOfRemote NG.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CpuCapabilities {
    // ── Baseline SIMD ────────────────────────────────────────────────
    pub has_sse2: bool,
    pub has_sse3: bool,
    pub has_ssse3: bool,
    pub has_sse41: bool,
    pub has_sse42: bool,

    // ── Advanced SIMD ────────────────────────────────────────────────
    pub has_avx: bool,
    pub has_avx2: bool,
    pub has_fma: bool,
    pub has_f16c: bool,

    // ── AVX-512 family ───────────────────────────────────────────────
    pub has_avx512f: bool,
    pub has_avx512bw: bool,
    pub has_avx512cd: bool,
    pub has_avx512dq: bool,
    pub has_avx512vl: bool,
    pub has_avx512vnni: bool,
    pub has_avx512vbmi: bool,
    pub has_avx512vbmi2: bool,
    pub has_avx512bitalg: bool,
    pub has_avx512ifma: bool,
    pub has_avx512vpopcntdq: bool,

    // ── Cryptography ─────────────────────────────────────────────────
    pub has_aes_ni: bool,
    pub has_vaes: bool,
    pub has_pclmulqdq: bool,
    pub has_vpclmulqdq: bool,
    pub has_sha_ni: bool,
    pub has_gfni: bool,

    // ── Bit manipulation & integer ───────────────────────────────────
    pub has_bmi1: bool,
    pub has_bmi2: bool,
    pub has_adx: bool,
    pub has_popcnt: bool,
    pub has_lzcnt: bool,
    pub has_avxvnni: bool,

    // ── Hardware entropy ─────────────────────────────────────────────
    pub has_rdrand: bool,
    pub has_rdseed: bool,

    // ── Derived performance tiers ────────────────────────────────────
    /// `true` when AES-NI + PCLMULQDQ are both present (AES-GCM fast-path).
    pub tier_aes_gcm: bool,
    /// `true` when SHA-NI is present (sha2/sha1/pbkdf2/hmac fast-path).
    pub tier_sha_accel: bool,
    /// `true` when AVX2 + BMI2 are present (general SIMD + bignum fast-path).
    pub tier_avx2_full: bool,
    /// `true` when VAES + VPCLMULQDQ + AVX-512 are present (wide crypto).
    pub tier_wide_crypto: bool,
    /// `true` when RDRAND + RDSEED are present (hardware entropy).
    pub tier_hw_rng: bool,
    /// Micro-architecture level estimate: 1–4 (x86-64-v1 through v4).
    pub x86_64_level: u8,
}

impl CpuCapabilities {
    /// Summarise which performance tiers are available.
    pub fn tier_summary(&self) -> String {
        let mut parts = Vec::new();
        if self.tier_aes_gcm      { parts.push("AES-GCM(hw)"); }
        if self.tier_sha_accel    { parts.push("SHA(hw)"); }
        if self.tier_avx2_full    { parts.push("AVX2+BMI2"); }
        if self.tier_wide_crypto  { parts.push("WideCrypto(AVX-512)"); }
        if self.tier_hw_rng       { parts.push("HW-RNG"); }
        if parts.is_empty() {
            "baseline (no hardware acceleration beyond SSE2)".to_string()
        } else {
            parts.join(", ")
        }
    }

    /// Micro-architecture level string suitable for display.
    pub fn level_name(&self) -> &'static str {
        match self.x86_64_level {
            4 => "x86-64-v4 (AVX-512 + VNNI)",
            3 => "x86-64-v3 (AVX2 + BMI2 + FMA)",
            2 => "x86-64-v2 (SSE4.2 + POPCNT)",
            _ => "x86-64-v1 (baseline)",
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════
// Detection
// ═══════════════════════════════════════════════════════════════════════

/// Detect all CPU features via CPUID.  Cheap to call (results are
/// cached internally by `std::arch`), but the [`CpuCapabilities`]
/// struct itself is built fresh each time — cache it if needed.
pub fn detect() -> CpuCapabilities {
    #[cfg(target_arch = "x86_64")]
    {
        detect_x86_64()
    }
    #[cfg(not(target_arch = "x86_64"))]
    {
        detect_fallback()
    }
}

#[cfg(target_arch = "x86_64")]
fn detect_x86_64() -> CpuCapabilities {
    // ── Individual feature probes ────────────────────────────────────
    let has_sse2      = is_x86_feature_detected!("sse2");
    let has_sse3      = is_x86_feature_detected!("sse3");
    let has_ssse3     = is_x86_feature_detected!("ssse3");
    let has_sse41     = is_x86_feature_detected!("sse4.1");
    let has_sse42     = is_x86_feature_detected!("sse4.2");
    let has_avx       = is_x86_feature_detected!("avx");
    let has_avx2      = is_x86_feature_detected!("avx2");
    let has_fma       = is_x86_feature_detected!("fma");
    let has_f16c      = is_x86_feature_detected!("f16c");
    let has_avx512f   = is_x86_feature_detected!("avx512f");
    let has_avx512bw  = is_x86_feature_detected!("avx512bw");
    let has_avx512cd  = is_x86_feature_detected!("avx512cd");
    let has_avx512dq  = is_x86_feature_detected!("avx512dq");
    let has_avx512vl  = is_x86_feature_detected!("avx512vl");
    let has_avx512vnni  = is_x86_feature_detected!("avx512vnni");
    let has_avx512vbmi  = is_x86_feature_detected!("avx512vbmi");
    let has_avx512vbmi2 = is_x86_feature_detected!("avx512vbmi2");
    let has_avx512bitalg = is_x86_feature_detected!("avx512bitalg");
    let has_avx512ifma  = is_x86_feature_detected!("avx512ifma");
    let has_avx512vpopcntdq = is_x86_feature_detected!("avx512vpopcntdq");
    let has_aes_ni    = is_x86_feature_detected!("aes");
    let has_vaes      = is_x86_feature_detected!("vaes");
    let has_pclmulqdq = is_x86_feature_detected!("pclmulqdq");
    let has_vpclmulqdq = is_x86_feature_detected!("vpclmulqdq");
    let has_sha_ni    = is_x86_feature_detected!("sha");
    let has_gfni      = is_x86_feature_detected!("gfni");
    let has_bmi1      = is_x86_feature_detected!("bmi1");
    let has_bmi2      = is_x86_feature_detected!("bmi2");
    let has_adx       = is_x86_feature_detected!("adx");
    let has_popcnt    = is_x86_feature_detected!("popcnt");
    let has_lzcnt     = is_x86_feature_detected!("lzcnt");
    let has_avxvnni   = is_x86_feature_detected!("avxvnni");
    let has_rdrand    = is_x86_feature_detected!("rdrand");
    let has_rdseed    = is_x86_feature_detected!("rdseed");

    // ── Derived tiers ────────────────────────────────────────────────
    let tier_aes_gcm     = has_aes_ni && has_pclmulqdq;
    let tier_sha_accel   = has_sha_ni;
    let tier_avx2_full   = has_avx2 && has_bmi2;
    let tier_wide_crypto = has_vaes && has_vpclmulqdq && has_avx512f;
    let tier_hw_rng      = has_rdrand && has_rdseed;

    // ── x86-64 micro-architecture level (psABI v1.0) ────────────────
    // v1: baseline (SSE2)
    // v2: SSE4.2 + POPCNT + CMPXCHG16B + LAHF
    // v3: AVX2 + BMI1 + BMI2 + FMA + F16C + LZCNT + MOVBE
    // v4: AVX-512F + AVX-512BW + AVX-512CD + AVX-512DQ + AVX-512VL
    let x86_64_level = if has_avx512f && has_avx512bw && has_avx512cd
                           && has_avx512dq && has_avx512vl {
        4
    } else if has_avx2 && has_bmi1 && has_bmi2 && has_fma && has_f16c && has_lzcnt {
        3
    } else if has_sse42 && has_popcnt {
        2
    } else {
        1
    };

    CpuCapabilities {
        has_sse2, has_sse3, has_ssse3, has_sse41, has_sse42,
        has_avx, has_avx2, has_fma, has_f16c,
        has_avx512f, has_avx512bw, has_avx512cd, has_avx512dq, has_avx512vl,
        has_avx512vnni, has_avx512vbmi, has_avx512vbmi2,
        has_avx512bitalg, has_avx512ifma, has_avx512vpopcntdq,
        has_aes_ni, has_vaes, has_pclmulqdq, has_vpclmulqdq, has_sha_ni, has_gfni,
        has_bmi1, has_bmi2, has_adx, has_popcnt, has_lzcnt, has_avxvnni,
        has_rdrand, has_rdseed,
        tier_aes_gcm, tier_sha_accel, tier_avx2_full, tier_wide_crypto, tier_hw_rng,
        x86_64_level,
    }
}

#[cfg(not(target_arch = "x86_64"))]
fn detect_fallback() -> CpuCapabilities {
    // On non-x86_64 (ARM, etc.) everything reports false.
    CpuCapabilities {
        has_sse2: false, has_sse3: false, has_ssse3: false,
        has_sse41: false, has_sse42: false,
        has_avx: false, has_avx2: false, has_fma: false, has_f16c: false,
        has_avx512f: false, has_avx512bw: false, has_avx512cd: false,
        has_avx512dq: false, has_avx512vl: false,
        has_avx512vnni: false, has_avx512vbmi: false, has_avx512vbmi2: false,
        has_avx512bitalg: false, has_avx512ifma: false, has_avx512vpopcntdq: false,
        has_aes_ni: false, has_vaes: false, has_pclmulqdq: false,
        has_vpclmulqdq: false, has_sha_ni: false, has_gfni: false,
        has_bmi1: false, has_bmi2: false, has_adx: false,
        has_popcnt: false, has_lzcnt: false, has_avxvnni: false,
        has_rdrand: false, has_rdseed: false,
        tier_aes_gcm: false, tier_sha_accel: false,
        tier_avx2_full: false, tier_wide_crypto: false, tier_hw_rng: false,
        x86_64_level: 0,
    }
}

// ═══════════════════════════════════════════════════════════════════════
// Logging helpers
// ═══════════════════════════════════════════════════════════════════════

/// Log **all** detected CPU features at `INFO` level, grouped by category.
///
/// Intended to be called once at application startup, after `tauri_plugin_log`
/// (or equivalent) is initialised.
pub fn log_all_features() {
    let caps = detect();

    log::info!(
        "CPU micro-architecture level: {} (level {})",
        caps.level_name(),
        caps.x86_64_level
    );
    log::info!("Performance tiers: {}", caps.tier_summary());

    // ── Detailed per-category logging ────────────────────────────────
    log_category("Baseline SIMD", &[
        ("SSE2",   caps.has_sse2),
        ("SSE3",   caps.has_sse3),
        ("SSSE3",  caps.has_ssse3),
        ("SSE4.1", caps.has_sse41),
        ("SSE4.2", caps.has_sse42),
    ]);

    log_category("Advanced SIMD", &[
        ("AVX",  caps.has_avx),
        ("AVX2", caps.has_avx2),
        ("FMA",  caps.has_fma),
        ("F16C", caps.has_f16c),
    ]);

    log_category("AVX-512", &[
        ("AVX-512F",         caps.has_avx512f),
        ("AVX-512BW",        caps.has_avx512bw),
        ("AVX-512CD",        caps.has_avx512cd),
        ("AVX-512DQ",        caps.has_avx512dq),
        ("AVX-512VL",        caps.has_avx512vl),
        ("AVX-512VNNI",      caps.has_avx512vnni),
        ("AVX-512VBMI",      caps.has_avx512vbmi),
        ("AVX-512VBMI2",     caps.has_avx512vbmi2),
        ("AVX-512BITALG",    caps.has_avx512bitalg),
        ("AVX-512IFMA",      caps.has_avx512ifma),
        ("AVX-512VPOPCNTDQ", caps.has_avx512vpopcntdq),
    ]);

    log_category("Cryptography", &[
        ("AES-NI",      caps.has_aes_ni),
        ("VAES",        caps.has_vaes),
        ("PCLMULQDQ",   caps.has_pclmulqdq),
        ("VPCLMULQDQ",  caps.has_vpclmulqdq),
        ("SHA-NI",       caps.has_sha_ni),
        ("GFNI",         caps.has_gfni),
    ]);

    log_category("Bit manipulation & integer", &[
        ("BMI1",    caps.has_bmi1),
        ("BMI2",    caps.has_bmi2),
        ("ADX",     caps.has_adx),
        ("POPCNT",  caps.has_popcnt),
        ("LZCNT",   caps.has_lzcnt),
        ("AVXVNNI", caps.has_avxvnni),
    ]);

    log_category("Hardware entropy", &[
        ("RDRAND", caps.has_rdrand),
        ("RDSEED", caps.has_rdseed),
    ]);

    // ── Impact notes ─────────────────────────────────────────────────
    if caps.tier_aes_gcm {
        log::info!(
            "  -> AES-GCM hardware path active: benefits aes-gcm, \
             rustls/ring, SSH transport, vault encrypt/decrypt"
        );
    } else {
        log::warn!(
            "  -> AES-NI not available: AES-GCM will use software fallback \
             (~10x slower for bulk TLS/SSH traffic)"
        );
    }

    if caps.tier_sha_accel {
        log::info!(
            "  -> SHA-NI hardware path active: benefits sha2 (25+ crates), \
             PBKDF2 (2-5x speedup over 100k+ iterations), HMAC, HKDF"
        );
    } else {
        log::info!(
            "  -> SHA-NI not available: sha2/pbkdf2/hmac using AVX2 or \
             SSSE3 software paths (still fast, but ~2x slower than SHA-NI)"
        );
    }

    if caps.tier_avx2_full {
        log::info!(
            "  -> AVX2+BMI2 active: benefits ed25519-dalek, zstd compression, \
             argon2 KDF, YUV conversion, RSA bignum"
        );
    }

    if caps.tier_wide_crypto {
        log::info!(
            "  -> Wide crypto (VAES+VPCLMULQDQ+AVX-512) available: \
             future ring/aws-lc-rs builds may use 512-bit AES-GCM"
        );
    }

    if caps.tier_hw_rng {
        log::info!(
            "  -> Hardware RNG (RDRAND+RDSEED) available: \
             benefits key generation and random nonce creation"
        );
    }

    // ── Compile-time target-feature status ────────────────────────────
    log_compile_time_features();
}

/// Log which target features were enabled **at compile time** via
/// `RUSTFLAGS` / `.cargo/config.toml`.  This matters because
/// RustCrypto crates (`aes`, `sha2`, etc.) can inline hardware paths
/// when the feature is guaranteed at compile time, avoiding the
/// runtime dispatch branch.
fn log_compile_time_features() {
    let mut enabled = Vec::new();
    let mut disabled = Vec::new();

    macro_rules! check_ct {
        ($($feat:literal),+ $(,)?) => {
            $(
                if cfg!(target_feature = $feat) {
                    enabled.push($feat);
                } else {
                    disabled.push($feat);
                }
            )+
        };
    }

    check_ct!(
        "sse2", "sse3", "ssse3", "sse4.1", "sse4.2",
        "avx", "avx2", "fma", "f16c",
        "aes", "sha", "pclmulqdq",
        "bmi1", "bmi2", "adx", "popcnt", "lzcnt",
    );

    if !enabled.is_empty() {
        log::info!(
            "Compile-time target features ENABLED: {}",
            enabled.join(", ")
        );
    }
    if !disabled.is_empty() {
        log::debug!(
            "Compile-time target features not set (runtime detection still works): {}",
            disabled.join(", ")
        );
    }

    // Warn when runtime has features that compile-time doesn't —
    // means we're leaving some inlining performance on the table.
    let caps = detect();
    let mut missed = Vec::new();
    if caps.has_aes_ni && !cfg!(target_feature = "aes") {
        missed.push("aes");
    }
    if caps.has_sha_ni && !cfg!(target_feature = "sha") {
        missed.push("sha");
    }
    if caps.has_avx2 && !cfg!(target_feature = "avx2") {
        missed.push("avx2");
    }
    if caps.has_pclmulqdq && !cfg!(target_feature = "pclmulqdq") {
        missed.push("pclmulqdq");
    }
    if caps.has_bmi2 && !cfg!(target_feature = "bmi2") {
        missed.push("bmi2");
    }
    if !missed.is_empty() {
        log::warn!(
            "CPU supports [{}] but binary was NOT compiled with these target-features. \
             Consider adding them to .cargo/config.toml for ~5-20%% better crypto/compression throughput.",
            missed.join(", ")
        );
    }
}

/// Helper: log a named category of features, showing present/absent.
fn log_category(category: &str, features: &[(&str, bool)]) {
    let present: Vec<&str> = features.iter()
        .filter(|(_, ok)| *ok)
        .map(|(name, _)| *name)
        .collect();
    let absent: Vec<&str> = features.iter()
        .filter(|(_, ok)| !*ok)
        .map(|(name, _)| *name)
        .collect();

    if absent.is_empty() {
        log::info!("  {}: ALL [{}]", category, present.join(", "));
    } else if present.is_empty() {
        log::info!("  {}: none", category);
    } else {
        log::info!(
            "  {}: [{}]  (missing: {})",
            category,
            present.join(", "),
            absent.join(", ")
        );
    }
}

// ═══════════════════════════════════════════════════════════════════════
// Convenience re-exports for crate-level use
// ═══════════════════════════════════════════════════════════════════════

/// Returns `true` if the CPU supports hardware AES-GCM (AES-NI + PCLMULQDQ).
///
/// This is the most impactful single check — it covers TLS, SSH, vault
/// encryption, and all `aes-gcm` usage across ~10 crates.
#[inline]
pub fn has_hw_aes_gcm() -> bool {
    #[cfg(target_arch = "x86_64")]
    {
        is_x86_feature_detected!("aes") && is_x86_feature_detected!("pclmulqdq")
    }
    #[cfg(not(target_arch = "x86_64"))]
    {
        false
    }
}

/// Returns `true` if the CPU supports SHA-NI (hardware SHA-256/SHA-1).
///
/// Benefits `sha2` (used in 25+ crates), `pbkdf2` (100k–600k iterations),
/// `hmac`, `hkdf`.
#[inline]
pub fn has_hw_sha() -> bool {
    #[cfg(target_arch = "x86_64")]
    {
        is_x86_feature_detected!("sha")
    }
    #[cfg(not(target_arch = "x86_64"))]
    {
        false
    }
}

/// Returns `true` if AVX2 + BMI2 are available (general SIMD fast-path).
///
/// Benefits `ed25519-dalek`, `argon2`, `zstd`, YUV conversion, RSA bignum.
#[inline]
pub fn has_avx2_full() -> bool {
    #[cfg(target_arch = "x86_64")]
    {
        is_x86_feature_detected!("avx2") && is_x86_feature_detected!("bmi2")
    }
    #[cfg(not(target_arch = "x86_64"))]
    {
        false
    }
}

/// Returns `true` if hardware entropy (RDRAND + RDSEED) is available.
#[inline]
pub fn has_hw_rng() -> bool {
    #[cfg(target_arch = "x86_64")]
    {
        is_x86_feature_detected!("rdrand") && is_x86_feature_detected!("rdseed")
    }
    #[cfg(not(target_arch = "x86_64"))]
    {
        false
    }
}

// ═══════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detect_does_not_panic() {
        let caps = detect();
        // On any x86_64 test runner SSE2 is guaranteed.
        #[cfg(target_arch = "x86_64")]
        assert!(caps.has_sse2, "SSE2 must be available on x86_64");
        // Level must be at least 1.
        #[cfg(target_arch = "x86_64")]
        assert!(caps.x86_64_level >= 1);
        let _ = caps;
    }

    #[test]
    fn tier_summary_not_empty() {
        let caps = detect();
        let summary = caps.tier_summary();
        assert!(!summary.is_empty());
    }

    #[test]
    fn level_name_valid() {
        let caps = detect();
        let name = caps.level_name();
        assert!(name.starts_with("x86-64-v"));
    }

    #[test]
    fn log_all_features_does_not_panic() {
        // Just verify it runs without panicking.
        log_all_features();
    }

    #[test]
    fn convenience_functions_consistent() {
        let caps = detect();
        assert_eq!(caps.tier_aes_gcm, has_hw_aes_gcm());
        assert_eq!(caps.tier_sha_accel, has_hw_sha());
        assert_eq!(caps.tier_avx2_full, has_avx2_full());
        assert_eq!(caps.tier_hw_rng, has_hw_rng());
    }

    #[test]
    fn serialization_roundtrip() {
        let caps = detect();
        let json = serde_json::to_string(&caps).unwrap();
        let deser: CpuCapabilities = serde_json::from_str(&json).unwrap();
        assert_eq!(caps.x86_64_level, deser.x86_64_level);
        assert_eq!(caps.has_aes_ni, deser.has_aes_ni);
    }
}
