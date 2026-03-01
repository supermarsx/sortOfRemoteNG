//! VNC authentication handlers.
//!
//! Implements security type negotiation and authentication flows for the
//! RFB protocol, including None and VNC DES challenge-response authentication.

use crate::vnc::types::{SecurityType, VncError, VncErrorKind};
use cipher::{BlockEncrypt, KeyInit};
use des::Des;

/// Select the best available security type from the server's list.
///
/// Prefers VNC authentication over None (so we use encryption when available).
pub fn select_security_type(types: &[SecurityType]) -> Option<SecurityType> {
    // Preference order: VncAuthentication > None > Others.
    let preference = [
        SecurityType::VncAuthentication,
        SecurityType::None,
        SecurityType::Tight,
        SecurityType::VeNCrypt,
        SecurityType::AppleRemoteDesktop,
    ];

    for candidate in &preference {
        if types.contains(candidate) {
            return Some(candidate.clone());
        }
    }

    // Fall back to first available.
    types.first().cloned()
}

/// Handle "None" security (type 1) — no authentication required.
///
/// In RFB 3.8+ the server still sends a SecurityResult message.
/// In RFB 3.3 there is no SecurityResult for None auth.
pub fn handle_none_auth() -> Vec<u8> {
    // Client sends the selected security type byte.
    vec![SecurityType::None.to_byte()]
}

/// Handle VNC (DES) authentication (type 2).
///
/// The server sends a 16-byte challenge. The client encrypts it using
/// DES with the password (up to 8 chars, null-padded) as the key,
/// with each key byte bit-reversed.
///
/// Returns the 16-byte response to send back to the server.
pub fn handle_vnc_auth(challenge: &[u8; 16], password: &str) -> Result<Vec<u8>, VncError> {
    if challenge.len() != 16 {
        return Err(VncError {
            kind: VncErrorKind::AuthFailed,
            message: "Invalid challenge length".into(),
        });
    }

    let key = make_des_key(password);

    // Encrypt the 16-byte challenge in two 8-byte DES ECB blocks.
    let mut response = Vec::with_capacity(16);
    response.extend_from_slice(&des_encrypt_block(&key, &challenge[0..8]));
    response.extend_from_slice(&des_encrypt_block(&key, &challenge[8..16]));

    Ok(response)
}

/// Build the security type selection message.
///
/// Client → Server: single byte indicating the chosen security type.
pub fn build_security_type_selection(security_type: &SecurityType) -> Vec<u8> {
    vec![security_type.to_byte()]
}

/// Parse the SecurityResult message (RFB 3.8+).
///
/// Returns `Ok(())` if authentication succeeded, or `Err` with the
/// failure reason if provided.
pub fn parse_security_result(data: &[u8]) -> Result<(), VncError> {
    if data.len() < 4 {
        return Err(VncError {
            kind: VncErrorKind::ProtocolViolation,
            message: "SecurityResult too short".into(),
        });
    }

    let status = u32::from_be_bytes([data[0], data[1], data[2], data[3]]);

    match status {
        0 => Ok(()),
        1 => {
            // In RFB 3.8+ there is optionally a reason string.
            let reason = if data.len() >= 8 {
                let reason_len = u32::from_be_bytes([data[4], data[5], data[6], data[7]]) as usize;
                if data.len() >= 8 + reason_len {
                    String::from_utf8_lossy(&data[8..8 + reason_len]).into_owned()
                } else {
                    "Authentication failed".into()
                }
            } else {
                "Authentication failed".into()
            };
            Err(VncError {
                kind: VncErrorKind::AuthFailed,
                message: reason,
            })
        }
        2 => Err(VncError {
            kind: VncErrorKind::AuthFailed,
            message: "Too many authentication attempts".into(),
        }),
        _ => Err(VncError {
            kind: VncErrorKind::AuthFailed,
            message: format!("Unknown security result: {}", status),
        }),
    }
}

// ── DES implementation ──────────────────────────────────────────────

/// Create DES key from VNC password.
///
/// The password is truncated/padded to 8 bytes, then each byte is
/// bit-reversed (VNC-specific quirk).
fn make_des_key(password: &str) -> [u8; 8] {
    let mut key = [0u8; 8];
    let bytes = password.as_bytes();
    for i in 0..std::cmp::min(8, bytes.len()) {
        key[i] = bytes[i];
    }
    // Reverse bits of each byte (VNC DES key quirk).
    for b in &mut key {
        *b = reverse_bits(*b);
    }
    key
}

/// Reverse the bits in a byte.
fn reverse_bits(mut b: u8) -> u8 {
    let mut result = 0u8;
    for _ in 0..8 {
        result = (result << 1) | (b & 1);
        b >>= 1;
    }
    result
}

/// DES ECB encryption of a single 8-byte block using the `des` crate.
fn des_encrypt_block(key: &[u8; 8], block: &[u8]) -> [u8; 8] {
    let cipher = Des::new_from_slice(key).expect("DES key must be 8 bytes");
    let mut output = cipher::generic_array::GenericArray::clone_from_slice(&block[..8]);
    cipher.encrypt_block(&mut output);
    let mut result = [0u8; 8];
    result.copy_from_slice(&output);
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── reverse_bits ────────────────────────────────────────────────

    #[test]
    fn reverse_bits_zero() {
        assert_eq!(reverse_bits(0), 0);
    }

    #[test]
    fn reverse_bits_one() {
        assert_eq!(reverse_bits(1), 128);
    }

    #[test]
    fn reverse_bits_ff() {
        assert_eq!(reverse_bits(0xFF), 0xFF);
    }

    #[test]
    fn reverse_bits_0a() {
        // 0x0A = 00001010 → 01010000 = 0x50
        assert_eq!(reverse_bits(0x0A), 0x50);
    }

    #[test]
    fn reverse_bits_roundtrip() {
        for b in 0..=255u8 {
            assert_eq!(reverse_bits(reverse_bits(b)), b);
        }
    }

    // ── make_des_key ────────────────────────────────────────────────

    #[test]
    fn make_des_key_empty() {
        let key = make_des_key("");
        assert_eq!(key, [0; 8]);
    }

    #[test]
    fn make_des_key_short() {
        let key = make_des_key("abc");
        assert_eq!(key[0], reverse_bits(b'a'));
        assert_eq!(key[1], reverse_bits(b'b'));
        assert_eq!(key[2], reverse_bits(b'c'));
        for i in 3..8 {
            assert_eq!(key[i], 0);
        }
    }

    #[test]
    fn make_des_key_truncated() {
        let key = make_des_key("longpassword123");
        assert_eq!(key[7], reverse_bits(b's'));
        assert_eq!(key.len(), 8);
    }

    // ── des_encrypt_block ───────────────────────────────────────────

    #[test]
    fn des_encrypt_block_known_vector() {
        // NIST test vector for DES:
        // Key: 0x0123456789ABCDEF
        // Plaintext: 0x4E6F772069732074 ("Now is t")
        // Ciphertext: 0x3FA40E8A984D4815
        let key = [0x01, 0x23, 0x45, 0x67, 0x89, 0xAB, 0xCD, 0xEF];
        let plaintext = [0x4E, 0x6F, 0x77, 0x20, 0x69, 0x73, 0x20, 0x74];
        let expected = [0x3F, 0xA4, 0x0E, 0x8A, 0x98, 0x4D, 0x48, 0x15];
        let result = des_encrypt_block(&key, &plaintext);
        assert_eq!(result, expected, "DES encryption does not match known vector");
    }

    #[test]
    fn des_encrypt_block_zeros() {
        let key = [0u8; 8];
        let plaintext = [0u8; 8];
        let result = des_encrypt_block(&key, &plaintext);
        // DES(0,0) = 0x8CA64DE9C1B123A7
        assert_eq!(
            result,
            [0x8C, 0xA6, 0x4D, 0xE9, 0xC1, 0xB1, 0x23, 0xA7]
        );
    }

    #[test]
    fn des_encrypt_block_all_ones() {
        let key = [0xFF; 8];
        let plaintext = [0xFF; 8];
        let result = des_encrypt_block(&key, &plaintext);
        // DES(FF..FF, FF..FF) = 0x7359B2163E4EDC58
        assert_eq!(
            result,
            [0x73, 0x59, 0xB2, 0x16, 0x3E, 0x4E, 0xDC, 0x58]
        );
    }

    // ── handle_vnc_auth ─────────────────────────────────────────────

    #[test]
    fn handle_vnc_auth_produces_16_bytes() {
        let challenge = [1u8; 16];
        let response = handle_vnc_auth(&challenge, "password").unwrap();
        assert_eq!(response.len(), 16);
    }

    #[test]
    fn handle_vnc_auth_empty_password() {
        let challenge = [0u8; 16];
        let response = handle_vnc_auth(&challenge, "").unwrap();
        assert_eq!(response.len(), 16);
    }

    #[test]
    fn handle_vnc_auth_deterministic() {
        let challenge = [42u8; 16];
        let r1 = handle_vnc_auth(&challenge, "test").unwrap();
        let r2 = handle_vnc_auth(&challenge, "test").unwrap();
        assert_eq!(r1, r2);
    }

    #[test]
    fn handle_vnc_auth_different_passwords_differ() {
        let challenge = [42u8; 16];
        let r1 = handle_vnc_auth(&challenge, "pass1").unwrap();
        let r2 = handle_vnc_auth(&challenge, "pass2").unwrap();
        assert_ne!(r1, r2);
    }

    // ── handle_none_auth ────────────────────────────────────────────

    #[test]
    fn handle_none_auth_returns_type_byte() {
        let msg = handle_none_auth();
        assert_eq!(msg, vec![1]);
    }

    // ── build_security_type_selection ────────────────────────────────

    #[test]
    fn build_security_type_selection_vnc_auth() {
        let msg = build_security_type_selection(&SecurityType::VncAuthentication);
        assert_eq!(msg, vec![2]);
    }

    #[test]
    fn build_security_type_selection_none() {
        let msg = build_security_type_selection(&SecurityType::None);
        assert_eq!(msg, vec![1]);
    }

    // ── select_security_type ────────────────────────────────────────

    #[test]
    fn select_security_type_prefers_vnc_auth() {
        let types = vec![SecurityType::None, SecurityType::VncAuthentication];
        assert_eq!(
            select_security_type(&types),
            Some(SecurityType::VncAuthentication)
        );
    }

    #[test]
    fn select_security_type_none_only() {
        let types = vec![SecurityType::None];
        assert_eq!(select_security_type(&types), Some(SecurityType::None));
    }

    #[test]
    fn select_security_type_empty() {
        assert_eq!(select_security_type(&[]), None);
    }

    #[test]
    fn select_security_type_tight() {
        let types = vec![SecurityType::Tight];
        assert_eq!(select_security_type(&types), Some(SecurityType::Tight));
    }

    // ── parse_security_result ───────────────────────────────────────

    #[test]
    fn parse_security_result_ok() {
        let data = 0u32.to_be_bytes();
        assert!(parse_security_result(&data).is_ok());
    }

    #[test]
    fn parse_security_result_failed() {
        let data = 1u32.to_be_bytes();
        let err = parse_security_result(&data).unwrap_err();
        assert_eq!(err.kind, VncErrorKind::AuthFailed);
    }

    #[test]
    fn parse_security_result_failed_with_reason() {
        let mut data = Vec::new();
        data.extend_from_slice(&1u32.to_be_bytes());
        let reason = b"Bad password";
        data.extend_from_slice(&(reason.len() as u32).to_be_bytes());
        data.extend_from_slice(reason);
        let err = parse_security_result(&data).unwrap_err();
        assert!(err.message.contains("Bad password"));
    }

    #[test]
    fn parse_security_result_too_many() {
        let data = 2u32.to_be_bytes();
        let err = parse_security_result(&data).unwrap_err();
        assert!(err.message.contains("Too many"));
    }

    #[test]
    fn parse_security_result_too_short() {
        assert!(parse_security_result(&[0, 0]).is_err());
    }
}
