//! Stateless TOTP helpers (t5-e9).
//!
//! These functions operate purely on their arguments — no vault access,
//! no shared state. They are intended for features that store TOTP
//! configuration ad-hoc per connection (see `useTOTPOptions`,
//! `useBackupCodesSection`, `useRDPTotpPanel`, etc.) rather than in the
//! shared TOTP vault.

use crate::totp::core::{encode_secret, generate_totp};
use crate::totp::types::{Algorithm, TotpError, TotpErrorKind};
use rand::RngCore;

// ────────────────────────────────────────────────────────────────────
//  1. Stateless code computation
// ────────────────────────────────────────────────────────────────────

/// Compute a current TOTP code from a raw base-32 secret.
///
/// `algorithm` defaults to SHA1, `digits` to 6, `period` to 30 seconds.
pub fn compute_code(
    secret: &str,
    algorithm: Option<&str>,
    digits: Option<u32>,
    period: Option<u64>,
) -> Result<String, TotpError> {
    let algo = match algorithm {
        Some(a) => Algorithm::from_str_loose(a).ok_or_else(|| {
            TotpError::new(
                TotpErrorKind::InvalidAlgorithm,
                format!("Unknown algorithm: {}", a),
            )
        })?,
        None => Algorithm::Sha1,
    };
    let digits_u8 = digits.unwrap_or(6).min(10) as u8;
    let period_u32 = period.unwrap_or(30).max(1) as u32;
    generate_totp(secret, digits_u8, period_u32, algo)
}

// ────────────────────────────────────────────────────────────────────
//  2. Stateless otpauth:// URI builder
// ────────────────────────────────────────────────────────────────────

/// Build an `otpauth://totp/ISSUER:ACCOUNT?...` URI from ad-hoc parameters.
///
/// `issuer` and `account` are URL-encoded (unreserved chars only per RFC 3986).
pub fn build_otpauth_uri(
    secret: &str,
    issuer: &str,
    account: &str,
    algorithm: Option<&str>,
    digits: Option<u32>,
    period: Option<u64>,
) -> Result<String, TotpError> {
    let algo = match algorithm {
        Some(a) => Algorithm::from_str_loose(a).ok_or_else(|| {
            TotpError::new(
                TotpErrorKind::InvalidAlgorithm,
                format!("Unknown algorithm: {}", a),
            )
        })?,
        None => Algorithm::Sha1,
    };
    let digits = digits.unwrap_or(6);
    let period = period.unwrap_or(30);

    let issuer_enc = url_encode(issuer);
    let account_enc = url_encode(account);

    let path = if issuer.is_empty() {
        account_enc.clone()
    } else {
        format!("{}:{}", issuer_enc, account_enc)
    };

    let mut params = vec![format!("secret={}", secret)];
    if !issuer.is_empty() {
        params.push(format!("issuer={}", issuer_enc));
    }
    params.push(format!("algorithm={}", algo.uri_name()));
    params.push(format!("digits={}", digits));
    params.push(format!("period={}", period));

    Ok(format!("otpauth://totp/{}?{}", path, params.join("&")))
}

/// Percent-encode everything except the RFC 3986 unreserved set.
fn url_encode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for byte in s.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(byte as char);
            }
            b' ' => out.push_str("%20"),
            _ => out.push_str(&format!("%{:02X}", byte)),
        }
    }
    out
}

// ────────────────────────────────────────────────────────────────────
//  3. Random backup codes
// ────────────────────────────────────────────────────────────────────

/// Generate `count` random backup codes, each `length` characters long
/// (default 10). Uses the RFC 4648 base-32 alphabet (A-Z, 2-7) which is
/// readable, unambiguous, and has no external crate requirements.
pub fn generate_backup_codes(count: u32, length: Option<u32>) -> Result<Vec<String>, TotpError> {
    if count == 0 {
        return Ok(Vec::new());
    }
    let len = length.unwrap_or(10).clamp(4, 64) as usize;

    // Each base-32 character encodes 5 bits → need ceil(len * 5 / 8) bytes
    // per code, but overshooting is fine — we just truncate after encoding.
    let byte_len = (len * 5).div_ceil(8) + 1;

    let mut rng = rand::thread_rng();
    let mut codes: Vec<String> = Vec::with_capacity(count as usize);

    for _ in 0..count {
        let mut bytes = vec![0u8; byte_len];
        rng.fill_bytes(&mut bytes);
        let encoded = encode_secret(&bytes);
        let trimmed: String = encoded.chars().take(len).collect();
        codes.push(trimmed);
    }

    Ok(codes)
}

// ────────────────────────────────────────────────────────────────────
//  Tests
// ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compute_code_defaults_work() {
        let code = compute_code("JBSWY3DPEHPK3PXP", None, None, None).unwrap();
        assert_eq!(code.len(), 6);
        assert!(code.chars().all(|c| c.is_ascii_digit()));
    }

    #[test]
    fn compute_code_rfc6238_vector() {
        let code = compute_code(
            "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ",
            Some("SHA1"),
            Some(8),
            Some(30),
        )
        .unwrap();
        assert_eq!(code.len(), 8);
    }

    #[test]
    fn compute_code_custom_digits() {
        let code = compute_code("JBSWY3DPEHPK3PXP", Some("sha256"), Some(8), Some(30)).unwrap();
        assert_eq!(code.len(), 8);
    }

    #[test]
    fn compute_code_rejects_bad_algorithm() {
        let err = compute_code("JBSWY3DPEHPK3PXP", Some("md5"), None, None);
        assert!(err.is_err());
    }

    #[test]
    fn compute_code_rejects_bad_secret() {
        let err = compute_code("!!!", None, None, None);
        assert!(err.is_err());
    }

    #[test]
    fn build_otpauth_uri_basic() {
        let uri = build_otpauth_uri(
            "JBSWY3DPEHPK3PXP",
            "Acme",
            "alice@example.com",
            None,
            None,
            None,
        )
        .unwrap();
        assert!(uri.starts_with("otpauth://totp/Acme:alice%40example.com?"));
        assert!(uri.contains("secret=JBSWY3DPEHPK3PXP"));
        assert!(uri.contains("issuer=Acme"));
        assert!(uri.contains("algorithm=SHA1"));
        assert!(uri.contains("digits=6"));
        assert!(uri.contains("period=30"));
    }

    #[test]
    fn build_otpauth_uri_roundtrip_via_parser() {
        let uri = build_otpauth_uri(
            "JBSWY3DPEHPK3PXP",
            "Acme Co",
            "alice@example.com",
            Some("SHA256"),
            Some(8),
            Some(60),
        )
        .unwrap();
        let entry = crate::totp::uri::parse_otpauth_uri(&uri).expect("round-trip parses");
        assert_eq!(entry.label, "alice@example.com");
        assert_eq!(entry.issuer.as_deref(), Some("Acme Co"));
        assert_eq!(entry.digits, 8);
        assert_eq!(entry.period, 60);
        assert_eq!(entry.algorithm, Algorithm::Sha256);
    }

    #[test]
    fn build_otpauth_uri_rejects_bad_algorithm() {
        let err = build_otpauth_uri("s", "i", "a", Some("bogus"), None, None);
        assert!(err.is_err());
    }

    #[test]
    fn build_otpauth_uri_empty_issuer() {
        let uri =
            build_otpauth_uri("JBSWY3DPEHPK3PXP", "", "alice", None, None, None).unwrap();
        assert!(uri.starts_with("otpauth://totp/alice?"));
        assert!(!uri.contains("issuer="));
    }

    #[test]
    fn generate_backup_codes_count_and_length() {
        let codes = generate_backup_codes(10, None).unwrap();
        assert_eq!(codes.len(), 10);
        for c in &codes {
            assert_eq!(c.len(), 10);
            assert!(c.chars().all(|ch| ch.is_ascii_alphanumeric()));
        }
    }

    #[test]
    fn generate_backup_codes_are_distinct() {
        let codes = generate_backup_codes(10, Some(12)).unwrap();
        let set: std::collections::HashSet<_> = codes.iter().collect();
        assert_eq!(set.len(), codes.len(), "all codes must be distinct");
    }

    #[test]
    fn generate_backup_codes_custom_length() {
        let codes = generate_backup_codes(3, Some(16)).unwrap();
        assert_eq!(codes.len(), 3);
        for c in &codes {
            assert_eq!(c.len(), 16);
        }
    }

    #[test]
    fn generate_backup_codes_zero_count() {
        let codes = generate_backup_codes(0, None).unwrap();
        assert!(codes.is_empty());
    }

    #[test]
    fn generate_backup_codes_length_clamped() {
        let codes = generate_backup_codes(1, Some(1)).unwrap();
        assert_eq!(codes[0].len(), 4);
        let codes = generate_backup_codes(1, Some(1000)).unwrap();
        assert_eq!(codes[0].len(), 64);
    }
}
