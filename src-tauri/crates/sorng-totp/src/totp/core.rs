//! Core OTP generation — RFC 4226 (HOTP) and RFC 6238 (TOTP).
//!
//! Implements HMAC-based One-Time Password with SHA-1, SHA-256, and SHA-512,
//! time-step calculation, code verification with configurable drift window,
//! and a variety of helper utilities.

use crate::totp::types::*;
use hmac::{Hmac, Mac};
use sha1::Sha1;
use sha2::{Sha256, Sha512};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Raw HMAC-OTP (RFC 4226 §5.3)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Compute an HOTP code for the given raw key bytes and counter.
pub fn hotp_raw(key: &[u8], counter: u64, digits: u8, algo: Algorithm) -> String {
    let hmac_result = compute_hmac(key, &counter.to_be_bytes(), algo);
    truncate(&hmac_result, digits)
}

/// Compute HMAC(key, message) using the specified algorithm.
fn compute_hmac(key: &[u8], data: &[u8], algo: Algorithm) -> Vec<u8> {
    match algo {
        Algorithm::Sha1 => {
            let mut mac =
                Hmac::<Sha1>::new_from_slice(key).expect("HMAC accepts any key length");
            mac.update(data);
            mac.finalize().into_bytes().to_vec()
        }
        Algorithm::Sha256 => {
            let mut mac =
                Hmac::<Sha256>::new_from_slice(key).expect("HMAC accepts any key length");
            mac.update(data);
            mac.finalize().into_bytes().to_vec()
        }
        Algorithm::Sha512 => {
            let mut mac =
                Hmac::<Sha512>::new_from_slice(key).expect("HMAC accepts any key length");
            mac.update(data);
            mac.finalize().into_bytes().to_vec()
        }
    }
}

/// Dynamic truncation per RFC 4226 §5.3.
fn truncate(hmac_result: &[u8], digits: u8) -> String {
    let offset = (hmac_result[hmac_result.len() - 1] & 0x0f) as usize;
    let binary = ((hmac_result[offset] as u32 & 0x7f) << 24)
        | ((hmac_result[offset + 1] as u32) << 16)
        | ((hmac_result[offset + 2] as u32) << 8)
        | (hmac_result[offset + 3] as u32);
    let modulus = 10u32.pow(digits as u32);
    let code = binary % modulus;
    format!("{:0>width$}", code, width = digits as usize)
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  HOTP (counter-based, RFC 4226)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Generate an HOTP code from a base-32 encoded secret.
pub fn generate_hotp(secret_b32: &str, counter: u64, digits: u8, algo: Algorithm) -> Result<String, TotpError> {
    let key = decode_secret(secret_b32)?;
    Ok(hotp_raw(&key, counter, digits, algo))
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  TOTP (time-based, RFC 6238)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Compute the current TOTP time-step counter.
pub fn time_step(period: u32) -> u64 {
    time_step_at(current_unix_time(), period)
}

/// Compute the time-step counter for a given unix timestamp.
pub fn time_step_at(unix_seconds: u64, period: u32) -> u64 {
    unix_seconds / period as u64
}

/// Seconds remaining until the current time-step expires.
pub fn seconds_remaining(period: u32) -> u32 {
    seconds_remaining_at(current_unix_time(), period)
}

/// Seconds remaining for a specific timestamp.
pub fn seconds_remaining_at(unix_seconds: u64, period: u32) -> u32 {
    let p = period as u64;
    (p - (unix_seconds % p)) as u32
}

/// Progress fraction (0.0 = fresh code, 1.0 = about to expire).
pub fn progress_fraction(period: u32) -> f64 {
    progress_fraction_at(current_unix_time(), period)
}

/// Progress fraction for a specific timestamp.
pub fn progress_fraction_at(unix_seconds: u64, period: u32) -> f64 {
    let p = period as f64;
    let elapsed = (unix_seconds % period as u64) as f64;
    elapsed / p
}

/// Generate a TOTP code from a base-32 secret, at the current time.
pub fn generate_totp(
    secret_b32: &str,
    digits: u8,
    period: u32,
    algo: Algorithm,
) -> Result<String, TotpError> {
    generate_totp_at(secret_b32, digits, period, algo, current_unix_time())
}

/// Generate a TOTP code at an explicit unix timestamp.
pub fn generate_totp_at(
    secret_b32: &str,
    digits: u8,
    period: u32,
    algo: Algorithm,
    unix_seconds: u64,
) -> Result<String, TotpError> {
    let step = time_step_at(unix_seconds, period);
    generate_hotp(secret_b32, step, digits, algo)
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  High-level: generate from entry
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Generate a `GeneratedCode` for a `TotpEntry`.
pub fn generate_code(entry: &TotpEntry) -> Result<GeneratedCode, TotpError> {
    generate_code_at(entry, current_unix_time())
}

/// Generate a `GeneratedCode` at a specific unix timestamp.
pub fn generate_code_at(entry: &TotpEntry, unix_seconds: u64) -> Result<GeneratedCode, TotpError> {
    let secret = entry.normalised_secret();
    match entry.otp_type {
        OtpType::Totp => {
            let step = time_step_at(unix_seconds, entry.period);
            let code = generate_hotp(&secret, step, entry.digits, entry.algorithm)?;
            let remaining = seconds_remaining_at(unix_seconds, entry.period);
            let progress = progress_fraction_at(unix_seconds, entry.period);
            Ok(GeneratedCode {
                code,
                remaining_seconds: remaining,
                period: entry.period,
                progress,
                counter: step,
                entry_id: entry.id.clone(),
            })
        }
        OtpType::Hotp => {
            let code = generate_hotp(&secret, entry.counter, entry.digits, entry.algorithm)?;
            Ok(GeneratedCode {
                code,
                remaining_seconds: 0,
                period: 0,
                progress: 0.0,
                counter: entry.counter,
                entry_id: entry.id.clone(),
            })
        }
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Verification
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Verify an OTP code against a `TotpEntry`.
///
/// `drift_window` specifies how many time-steps (or counters) to check
/// on either side of the current value (e.g. 1 checks ±1).
pub fn verify_code(
    entry: &TotpEntry,
    code: &str,
    drift_window: u32,
) -> Result<VerifyResult, TotpError> {
    verify_code_at(entry, code, drift_window, current_unix_time())
}

/// Verify at a specific timestamp.
pub fn verify_code_at(
    entry: &TotpEntry,
    code: &str,
    drift_window: u32,
    unix_seconds: u64,
) -> Result<VerifyResult, TotpError> {
    let secret = entry.normalised_secret();
    let key = decode_secret(&secret)?;

    let base_counter = match entry.otp_type {
        OtpType::Totp => time_step_at(unix_seconds, entry.period),
        OtpType::Hotp => entry.counter,
    };

    // Check the code itself (must be digits only, correct length)
    if code.len() != entry.digits as usize || !code.chars().all(|c| c.is_ascii_digit()) {
        return Ok(VerifyResult {
            valid: false,
            drift: 0,
            matched_counter: None,
        });
    }

    // Search window: for HOTP we only look "ahead" from counter
    let start = if entry.otp_type == OtpType::Hotp {
        base_counter
    } else {
        base_counter.saturating_sub(drift_window as u64)
    };
    let end = base_counter + drift_window as u64;

    for c in start..=end {
        let generated = hotp_raw(&key, c, entry.digits, entry.algorithm);
        if constant_time_eq(generated.as_bytes(), code.as_bytes()) {
            let drift = c as i64 - base_counter as i64;
            return Ok(VerifyResult {
                valid: true,
                drift,
                matched_counter: Some(c),
            });
        }
    }

    Ok(VerifyResult {
        valid: false,
        drift: 0,
        matched_counter: None,
    })
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Utility helpers
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Decode a base-32 secret (with or without spaces/dashes, case-insensitive).
pub fn decode_secret(b32: &str) -> Result<Vec<u8>, TotpError> {
    let cleaned = b32.replace(' ', "").replace('-', "").to_uppercase();
    // Pad to multiple of 8 if needed
    let padded = pad_base32(&cleaned);
    base32::decode(base32::Alphabet::Rfc4648 { padding: true }, &padded)
        .or_else(|| base32::decode(base32::Alphabet::Rfc4648 { padding: false }, &cleaned))
        .ok_or_else(|| TotpError::new(TotpErrorKind::InvalidSecret, "Invalid base-32 secret"))
}

/// Encode raw bytes to base-32 (no padding, uppercase).
pub fn encode_secret(bytes: &[u8]) -> String {
    base32::encode(base32::Alphabet::Rfc4648 { padding: false }, bytes)
}

/// Generate a cryptographically-random base-32 secret.
pub fn generate_secret(byte_length: usize) -> String {
    let mut buf = vec![0u8; byte_length];
    use rand::RngCore;
    rand::thread_rng().fill_bytes(&mut buf);
    encode_secret(&buf)
}

/// Pad a base-32 string to a multiple of 8 with '='.
fn pad_base32(s: &str) -> String {
    let remainder = s.len() % 8;
    if remainder == 0 {
        s.to_string()
    } else {
        let pad_count = 8 - remainder;
        format!("{}{}", s, "=".repeat(pad_count))
    }
}

/// Current unix timestamp in seconds.
fn current_unix_time() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

/// Constant-time comparison (to prevent timing attacks on code verification).
fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for (x, y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

/// Format an OTP code with a space in the middle (e.g. "123 456").
pub fn format_code_display(code: &str) -> String {
    if code.len() <= 4 {
        return code.to_string();
    }
    let mid = code.len() / 2;
    format!("{} {}", &code[..mid], &code[mid..])
}

/// Check if a string looks like a valid base-32 secret.
pub fn is_valid_base32(s: &str) -> bool {
    let cleaned = s.replace(' ', "").replace('-', "").to_uppercase();
    if cleaned.is_empty() {
        return false;
    }
    cleaned.chars().all(|c| matches!(c, 'A'..='Z' | '2'..='7' | '='))
        && decode_secret(&cleaned).is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── RFC 4226 test vectors (Appendix D) ───────────────────────
    // Secret: "12345678901234567890" (ASCII) → base32: GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ

    const RFC4226_SECRET: &str = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

    #[test]
    fn rfc4226_hotp_vectors() {
        let expected = [
            "755224", "287082", "359152", "969429", "338314",
            "254676", "287922", "162583", "399871", "520489",
        ];
        for (counter, exp) in expected.iter().enumerate() {
            let code = generate_hotp(RFC4226_SECRET, counter as u64, 6, Algorithm::Sha1).unwrap();
            assert_eq!(&code, exp, "HOTP mismatch at counter {}", counter);
        }
    }

    // ── RFC 6238 test vectors ────────────────────────────────────

    #[test]
    fn rfc6238_totp_sha1() {
        // Secret: "12345678901234567890" → GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ
        // At T=59s → step 1
        let code = generate_totp_at(RFC4226_SECRET, 8, 30, Algorithm::Sha1, 59).unwrap();
        assert_eq!(code, "94287082");
    }

    #[test]
    fn rfc6238_totp_sha256() {
        // Secret: "12345678901234567890123456789012" → 32 bytes
        let secret_b32 = encode_secret(b"12345678901234567890123456789012");
        let code = generate_totp_at(&secret_b32, 8, 30, Algorithm::Sha256, 59).unwrap();
        assert_eq!(code, "46119246");
    }

    #[test]
    fn rfc6238_totp_sha512() {
        // Secret: "1234567890123456789012345678901234567890123456789012345678901234"
        let secret_b32 =
            encode_secret(b"1234567890123456789012345678901234567890123456789012345678901234");
        let code = generate_totp_at(&secret_b32, 8, 30, Algorithm::Sha512, 59).unwrap();
        assert_eq!(code, "90693936");
    }

    #[test]
    fn rfc6238_totp_large_time() {
        // T = 1111111109
        let code = generate_totp_at(RFC4226_SECRET, 8, 30, Algorithm::Sha1, 1111111109).unwrap();
        assert_eq!(code, "07081804");
    }

    #[test]
    fn rfc6238_totp_20000000000() {
        let code = generate_totp_at(RFC4226_SECRET, 8, 30, Algorithm::Sha1, 20000000000).unwrap();
        assert_eq!(code, "65353130");
    }

    // ── Time-step helpers ────────────────────────────────────────

    #[test]
    fn time_step_calculation() {
        assert_eq!(time_step_at(0, 30), 0);
        assert_eq!(time_step_at(29, 30), 0);
        assert_eq!(time_step_at(30, 30), 1);
        assert_eq!(time_step_at(59, 30), 1);
        assert_eq!(time_step_at(60, 30), 2);
    }

    #[test]
    fn seconds_remaining_calculation() {
        assert_eq!(seconds_remaining_at(0, 30), 30);
        assert_eq!(seconds_remaining_at(1, 30), 29);
        assert_eq!(seconds_remaining_at(29, 30), 1);
        assert_eq!(seconds_remaining_at(30, 30), 30);
    }

    #[test]
    fn progress_fraction_calculation() {
        let p = progress_fraction_at(0, 30);
        assert!((p - 0.0).abs() < 0.01);
        let p = progress_fraction_at(15, 30);
        assert!((p - 0.5).abs() < 0.01);
    }

    // ── generate_code for entry ──────────────────────────────────

    #[test]
    fn generate_code_totp_entry() {
        let entry = TotpEntry::new("user", RFC4226_SECRET);
        let result = generate_code_at(&entry, 59).unwrap();
        assert_eq!(result.code, "287082"); // 6-digit at step 1
        assert_eq!(result.remaining_seconds, 1);
        assert_eq!(result.entry_id, entry.id);
    }

    #[test]
    fn generate_code_hotp_entry() {
        let entry = TotpEntry::new("user", RFC4226_SECRET).as_hotp(0);
        let result = generate_code(&entry).unwrap();
        assert_eq!(result.code, "755224"); // counter=0
    }

    #[test]
    fn generate_code_invalid_secret() {
        let entry = TotpEntry::new("u", "!!!INVALID!!!");
        let result = generate_code(&entry);
        assert!(result.is_err());
    }

    // ── Verification ─────────────────────────────────────────────

    #[test]
    fn verify_totp_exact() {
        let entry = TotpEntry::new("u", RFC4226_SECRET);
        // At T=59 the code is "287082"
        let vr = verify_code_at(&entry, "287082", 0, 59).unwrap();
        assert!(vr.valid);
        assert_eq!(vr.drift, 0);
    }

    #[test]
    fn verify_totp_with_drift() {
        let entry = TotpEntry::new("u", RFC4226_SECRET);
        // Previous step code at T=29 (step 0) is "755224"
        // At T=59 (step 1) with drift=1 should still match step 0
        let vr = verify_code_at(&entry, "755224", 1, 59).unwrap();
        assert!(vr.valid);
        assert_eq!(vr.drift, -1);
    }

    #[test]
    fn verify_totp_wrong_code() {
        let entry = TotpEntry::new("u", RFC4226_SECRET);
        let vr = verify_code_at(&entry, "000000", 0, 59).unwrap();
        assert!(!vr.valid);
    }

    #[test]
    fn verify_totp_wrong_length() {
        let entry = TotpEntry::new("u", RFC4226_SECRET);
        let vr = verify_code_at(&entry, "12345", 0, 59).unwrap();
        assert!(!vr.valid);
    }

    #[test]
    fn verify_hotp() {
        let entry = TotpEntry::new("u", RFC4226_SECRET).as_hotp(0);
        let vr = verify_code(&entry, "755224", 0).unwrap();
        assert!(vr.valid);
        assert_eq!(vr.matched_counter, Some(0));
    }

    #[test]
    fn verify_hotp_lookahead() {
        let entry = TotpEntry::new("u", RFC4226_SECRET).as_hotp(0);
        // counter=1 code is "287082"
        let vr = verify_code(&entry, "287082", 3).unwrap();
        assert!(vr.valid);
        assert_eq!(vr.drift, 1);
        assert_eq!(vr.matched_counter, Some(1));
    }

    // ── Secret helpers ───────────────────────────────────────────

    #[test]
    fn decode_encode_roundtrip() {
        let original = b"hello world secret";
        let b32 = encode_secret(original);
        let decoded = decode_secret(&b32).unwrap();
        assert_eq!(decoded, original);
    }

    #[test]
    fn decode_with_spaces_dashes() {
        let clean = "JBSWY3DPEHPK3PXP";
        let spaced = "JBSW Y3DP EHPK 3PXP";
        let dashed = "JBSW-Y3DP-EHPK-3PXP";
        let d1 = decode_secret(clean).unwrap();
        let d2 = decode_secret(spaced).unwrap();
        let d3 = decode_secret(dashed).unwrap();
        assert_eq!(d1, d2);
        assert_eq!(d2, d3);
    }

    #[test]
    fn decode_case_insensitive() {
        let upper = decode_secret("JBSWY3DPEHPK3PXP").unwrap();
        let lower = decode_secret("jbswy3dpehpk3pxp").unwrap();
        assert_eq!(upper, lower);
    }

    #[test]
    fn decode_invalid() {
        assert!(decode_secret("!!!").is_err());
    }

    #[test]
    fn generate_secret_length() {
        let s = generate_secret(20);
        assert!(!s.is_empty());
        let bytes = decode_secret(&s).unwrap();
        assert_eq!(bytes.len(), 20);
    }

    #[test]
    fn is_valid_base32_check() {
        assert!(is_valid_base32("JBSWY3DPEHPK3PXP"));
        assert!(is_valid_base32("jbsw y3dp ehpk 3pxp"));
        assert!(!is_valid_base32(""));
        assert!(!is_valid_base32("!!!"));
    }

    // ── Display formatting ───────────────────────────────────────

    #[test]
    fn format_code_split() {
        assert_eq!(format_code_display("123456"), "123 456");
        assert_eq!(format_code_display("12345678"), "1234 5678");
        assert_eq!(format_code_display("1234"), "1234");
        assert_eq!(format_code_display("123"), "123");
    }

    // ── constant_time_eq ─────────────────────────────────────────

    #[test]
    fn constant_time_eq_works() {
        assert!(constant_time_eq(b"abc", b"abc"));
        assert!(!constant_time_eq(b"abc", b"abd"));
        assert!(!constant_time_eq(b"abc", b"ab"));
    }
}
