//! Lightweight CPU-capability reporting for the UI.
//!
//! Exposes a frontend-friendly slice of `sorng_core::cpu_features::detect()`
//! focused on AES hardware acceleration so the Security settings can show a
//! "supported / not supported" indicator next to the algorithm picker.

use serde::Serialize;

#[derive(Debug, Serialize, Clone)]
pub struct CpuAesCapabilities {
    /// CPU architecture as reported at compile time (e.g. "x86_64",
    /// "aarch64", "arm", "other").
    pub arch: &'static str,
    /// True when the AES-NI instruction set is present (x86_64).
    pub has_aes_ni: bool,
    /// True when VAES (vectorized AES, AVX-512) is present.
    pub has_vaes: bool,
    /// True when PCLMULQDQ is present — needed for the AES-GCM fast path.
    pub has_pclmulqdq: bool,
    /// True when AES-NI + PCLMULQDQ are both present (AES-GCM hardware
    /// fast path).
    pub tier_aes_gcm: bool,
    /// Convenience: any form of hardware AES acceleration is available.
    pub hardware_aes: bool,
    /// Short human-readable label describing the acceleration available
    /// (e.g. "AES-NI + PCLMULQDQ", "AES-NI only", "VAES + AVX-512", or
    /// "none detected").
    pub label: String,
}

const fn current_arch() -> &'static str {
    #[cfg(target_arch = "x86_64")]
    {
        "x86_64"
    }
    #[cfg(target_arch = "aarch64")]
    {
        "aarch64"
    }
    #[cfg(all(not(target_arch = "x86_64"), not(target_arch = "aarch64")))]
    {
        "other"
    }
}

fn describe(caps: &CpuAesCapabilities) -> String {
    let mut parts: Vec<&'static str> = Vec::new();
    if caps.has_vaes {
        parts.push("VAES");
    } else if caps.has_aes_ni {
        parts.push("AES-NI");
    }
    if caps.has_pclmulqdq {
        parts.push("PCLMULQDQ");
    }
    if parts.is_empty() {
        "none detected".to_string()
    } else {
        parts.join(" + ")
    }
}

#[tauri::command]
pub fn get_cpu_aes_capabilities() -> CpuAesCapabilities {
    let caps = sorng_core::cpu_features::detect();
    let mut out = CpuAesCapabilities {
        arch: current_arch(),
        has_aes_ni: caps.has_aes_ni,
        has_vaes: caps.has_vaes,
        has_pclmulqdq: caps.has_pclmulqdq,
        tier_aes_gcm: caps.tier_aes_gcm,
        hardware_aes: caps.has_aes_ni || caps.has_vaes,
        label: String::new(),
    };
    out.label = describe(&out);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make(has_aes_ni: bool, has_vaes: bool, has_pclmulqdq: bool) -> CpuAesCapabilities {
        let mut c = CpuAesCapabilities {
            arch: "x86_64",
            has_aes_ni,
            has_vaes,
            has_pclmulqdq,
            tier_aes_gcm: has_aes_ni && has_pclmulqdq,
            hardware_aes: has_aes_ni || has_vaes,
            label: String::new(),
        };
        c.label = describe(&c);
        c
    }

    #[test]
    fn label_says_none_when_no_features() {
        assert_eq!(make(false, false, false).label, "none detected");
    }

    #[test]
    fn label_pairs_aes_ni_and_pclmulqdq() {
        assert_eq!(make(true, false, true).label, "AES-NI + PCLMULQDQ");
    }

    #[test]
    fn label_prefers_vaes_over_aes_ni() {
        assert_eq!(make(true, true, true).label, "VAES + PCLMULQDQ");
    }
}
