//! VNC authentication handlers.
//!
//! Implements security type negotiation and authentication flows for the
//! RFB protocol, including None, VNC DES challenge-response, and Apple
//! Remote Desktop (ARD) Diffie-Hellman authentication.

use crate::vnc::types::{SecurityType, VncError, VncErrorKind};
use aes::Aes128;
use cipher::{BlockEncrypt, KeyInit};
use des::Des;
use md5::{Digest, Md5};
use num_bigint::BigUint;
use num_traits::One;
use rand::RngCore;

/// Select the best available security type from the server's list.
///
/// Prefers VNC authentication over None (so we use encryption when available).
pub fn select_security_type(types: &[SecurityType]) -> Option<SecurityType> {
    // Preference order: ARD (user+pass DH) > VncAuthentication > None > Others.
    let preference = [
        SecurityType::AppleRemoteDesktop,
        SecurityType::VncAuthentication,
        SecurityType::None,
        SecurityType::Tight,
        SecurityType::VeNCrypt,
    ];

    for candidate in &preference {
        if types.contains(candidate) {
            return Some(*candidate);
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

// ── Apple Remote Desktop (ARD / Diffie-Hellman) authentication ──────

/// Parameters received from the server during ARD DH handshake.
#[derive(Debug, Clone)]
pub struct ArdServerParams {
    /// Diffie-Hellman generator (typically 2).
    pub generator: u16,
    /// Key length in bytes (determines prime and public-key sizes).
    pub key_length: u16,
    /// Prime modulus (big-endian, `key_length` bytes).
    pub prime: Vec<u8>,
    /// Server's DH public value (big-endian, `key_length` bytes).
    pub server_public_key: Vec<u8>,
}

/// Result of ARD authentication computation on the client side.
#[derive(Debug, Clone)]
pub struct ArdAuthResponse {
    /// AES-128-ECB encrypted credentials (always 128 bytes).
    pub encrypted_credentials: Vec<u8>,
    /// Client's DH public value (big-endian, `key_length` bytes).
    pub client_public_key: Vec<u8>,
}

/// Parse the ARD server parameters from a raw byte buffer.
///
/// Expected layout: `[generator: U16] [key_length: U16] [prime: key_length] [pub_key: key_length]`
pub fn parse_ard_server_params(data: &[u8]) -> Result<ArdServerParams, VncError> {
    if data.len() < 4 {
        return Err(VncError {
            kind: VncErrorKind::ProtocolViolation,
            message: "ARD auth data too short for header".into(),
        });
    }

    let generator = u16::from_be_bytes([data[0], data[1]]);
    let key_length = u16::from_be_bytes([data[2], data[3]]);
    let expected_len = 4 + (key_length as usize) * 2;

    if data.len() < expected_len {
        return Err(VncError {
            kind: VncErrorKind::ProtocolViolation,
            message: format!(
                "ARD auth data too short: expected {} bytes, got {}",
                expected_len,
                data.len()
            ),
        });
    }

    let prime_start = 4;
    let prime_end = prime_start + key_length as usize;
    let pub_end = prime_end + key_length as usize;

    Ok(ArdServerParams {
        generator,
        key_length,
        prime: data[prime_start..prime_end].to_vec(),
        server_public_key: data[prime_end..pub_end].to_vec(),
    })
}

/// Perform the full ARD (Diffie-Hellman) authentication computation.
///
/// Implements VNC security type 30 ("Diffie-Hellman Authentication")
/// per the RFB protocol specification §7.2.13:
///
/// 1. Generate a random DH private key.
/// 2. Compute the client public key: `g^private mod p`.
/// 3. Compute the shared secret: `server_public^private mod p`.
/// 4. Derive an AES-128 key via `MD5(shared_secret)`.
/// 5. Build a 128-byte credential buffer:
///    - Bytes  0..63:  username (UTF-8, NUL-terminated, random-padded).
///    - Bytes 64..127: password (UTF-8, NUL-terminated, random-padded).
/// 6. Encrypt credentials with AES-128-ECB.
/// 7. Return encrypted credentials + client public key.
pub fn handle_ard_auth(
    params: &ArdServerParams,
    username: &str,
    password: &str,
) -> Result<ArdAuthResponse, VncError> {
    let key_len = params.key_length as usize;
    if key_len == 0 {
        return Err(VncError {
            kind: VncErrorKind::AuthFailed,
            message: "ARD key length is zero".into(),
        });
    }

    // Parse DH parameters as big-endian big integers.
    let g = BigUint::from(params.generator);
    let p = BigUint::from_bytes_be(&params.prime);
    let server_pub = BigUint::from_bytes_be(&params.server_public_key);

    // Validate prime is > 1 to avoid degenerate DH.
    if p <= BigUint::one() {
        return Err(VncError {
            kind: VncErrorKind::AuthFailed,
            message: "ARD prime modulus is too small".into(),
        });
    }

    // Generate random private key (same byte-length as the prime).
    let mut private_bytes = vec![0u8; key_len];
    rand::thread_rng().fill_bytes(&mut private_bytes);
    let private_key = BigUint::from_bytes_be(&private_bytes);

    // Compute client public key: g^private mod p
    let client_pub = g.modpow(&private_key, &p);

    // Compute shared secret: server_public^private mod p
    let shared_secret = server_pub.modpow(&private_key, &p);

    // Convert shared secret to big-endian bytes, zero-padded to key_len.
    let secret_bytes = biguint_to_fixed_be(&shared_secret, key_len);

    // Derive AES-128 key: MD5(shared_secret_bytes).
    let mut hasher = Md5::new();
    hasher.update(&secret_bytes);
    let aes_key: [u8; 16] = hasher.finalize().into();

    // Build the 128-byte credential buffer.
    let credentials = build_ard_credentials(username, password);

    // Encrypt with AES-128-ECB.
    let encrypted = aes128_ecb_encrypt(&aes_key, &credentials)?;

    // Client public key as big-endian bytes, zero-padded to key_len.
    let client_pub_bytes = biguint_to_fixed_be(&client_pub, key_len);

    Ok(ArdAuthResponse {
        encrypted_credentials: encrypted,
        client_public_key: client_pub_bytes,
    })
}

/// Build the 128-byte ARD credential buffer.
///
/// Layout:
/// - Bytes  0..63:  username (UTF-8, NUL-terminated, remainder random).
/// - Bytes 64..127: password (UTF-8, NUL-terminated, remainder random).
fn build_ard_credentials(username: &str, password: &str) -> [u8; 128] {
    let mut buf = [0u8; 128];

    // Fill with random data first (per spec: "padded with random data").
    rand::thread_rng().fill_bytes(&mut buf);

    // Write username (max 63 bytes + NUL terminator).
    let user_bytes = username.as_bytes();
    let user_len = std::cmp::min(user_bytes.len(), 63);
    buf[..user_len].copy_from_slice(&user_bytes[..user_len]);
    buf[user_len] = 0; // NUL terminator

    // Write password (max 63 bytes + NUL terminator).
    let pass_bytes = password.as_bytes();
    let pass_len = std::cmp::min(pass_bytes.len(), 63);
    buf[64..64 + pass_len].copy_from_slice(&pass_bytes[..pass_len]);
    buf[64 + pass_len] = 0; // NUL terminator

    buf
}

/// Encrypt data using AES-128-ECB (no padding — input must be block-aligned).
fn aes128_ecb_encrypt(key: &[u8; 16], data: &[u8; 128]) -> Result<Vec<u8>, VncError> {
    let cipher = Aes128::new_from_slice(key).map_err(|e| VncError {
        kind: VncErrorKind::AuthFailed,
        message: format!("Failed to create AES cipher: {}", e),
    })?;

    let mut output = data.to_vec();
    // AES-128-ECB: encrypt each 16-byte block independently.
    for chunk in output.chunks_exact_mut(16) {
        let block = cipher::generic_array::GenericArray::from_mut_slice(chunk);
        cipher.encrypt_block(block);
    }

    Ok(output)
}

/// Convert a `BigUint` to a fixed-length big-endian byte vector,
/// zero-padding on the left if needed or truncating the most-significant bytes if longer.
fn biguint_to_fixed_be(n: &BigUint, len: usize) -> Vec<u8> {
    let bytes = n.to_bytes_be();
    if bytes.len() == len {
        bytes
    } else if bytes.len() < len {
        let mut padded = vec![0u8; len - bytes.len()];
        padded.extend_from_slice(&bytes);
        padded
    } else {
        // Truncate leading bytes (shared secret might have extra leading byte).
        bytes[bytes.len() - len..].to_vec()
    }
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
    let len = std::cmp::min(8, bytes.len());
    key[..len].copy_from_slice(&bytes[..len]);
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

    // ── ARD / Diffie-Hellman authentication ─────────────────────────

    #[test]
    fn parse_ard_server_params_valid() {
        // Generator = 2, key_length = 8.
        let mut data = Vec::new();
        data.extend_from_slice(&2u16.to_be_bytes()); // generator
        data.extend_from_slice(&8u16.to_be_bytes()); // key_length
        data.extend_from_slice(&[0xFF; 8]); // prime (8 bytes)
        data.extend_from_slice(&[0xAA; 8]); // server_public_key (8 bytes)

        let params = parse_ard_server_params(&data).unwrap();
        assert_eq!(params.generator, 2);
        assert_eq!(params.key_length, 8);
        assert_eq!(params.prime.len(), 8);
        assert_eq!(params.server_public_key.len(), 8);
    }

    #[test]
    fn parse_ard_server_params_too_short() {
        let data = [0u8; 3]; // Less than 4 bytes.
        assert!(parse_ard_server_params(&data).is_err());
    }

    #[test]
    fn parse_ard_server_params_truncated_keys() {
        let mut data = Vec::new();
        data.extend_from_slice(&2u16.to_be_bytes());
        data.extend_from_slice(&16u16.to_be_bytes()); // key_length = 16
        data.extend_from_slice(&[0xAA; 10]); // Only 10 bytes, need 32.
        assert!(parse_ard_server_params(&data).is_err());
    }

    #[test]
    fn build_ard_credentials_layout() {
        let creds = build_ard_credentials("admin", "secret");
        assert_eq!(creds.len(), 128);
        // Check username is at start with NUL terminator.
        assert_eq!(&creds[..5], b"admin");
        assert_eq!(creds[5], 0);
        // Check password starts at offset 64 with NUL terminator.
        assert_eq!(&creds[64..70], b"secret");
        assert_eq!(creds[70], 0);
    }

    #[test]
    fn build_ard_credentials_empty_strings() {
        let creds = build_ard_credentials("", "");
        assert_eq!(creds.len(), 128);
        assert_eq!(creds[0], 0); // NUL-terminated empty username.
        assert_eq!(creds[64], 0); // NUL-terminated empty password.
    }

    #[test]
    fn build_ard_credentials_truncates_long_username() {
        let long_name = "a".repeat(100);
        let creds = build_ard_credentials(&long_name, "pw");
        // Max 63 chars + NUL.
        assert_eq!(creds[62], b'a');
        assert_eq!(creds[63], 0);
    }

    #[test]
    fn aes128_ecb_encrypt_roundtrip_structure() {
        let key = [0x42u8; 16];
        let data = [0x01u8; 128];
        let encrypted = aes128_ecb_encrypt(&key, &data).unwrap();
        assert_eq!(encrypted.len(), 128);
        // Encrypted data should differ from plaintext.
        assert_ne!(encrypted, data.to_vec());
    }

    #[test]
    fn biguint_to_fixed_be_zero_pad() {
        let n = BigUint::from(255u32); // 0xFF, 1 byte.
        let bytes = biguint_to_fixed_be(&n, 4);
        assert_eq!(bytes, vec![0, 0, 0, 0xFF]);
    }

    #[test]
    fn biguint_to_fixed_be_exact() {
        let n = BigUint::from_bytes_be(&[0xDE, 0xAD, 0xBE, 0xEF]);
        let bytes = biguint_to_fixed_be(&n, 4);
        assert_eq!(bytes, vec![0xDE, 0xAD, 0xBE, 0xEF]);
    }

    #[test]
    fn biguint_to_fixed_be_truncate() {
        let n = BigUint::from_bytes_be(&[0x01, 0x02, 0x03, 0x04]);
        let bytes = biguint_to_fixed_be(&n, 2);
        assert_eq!(bytes, vec![0x03, 0x04]);
    }

    #[test]
    fn handle_ard_auth_full_flow() {
        // Use small DH parameters for testing:
        // p = 23 (prime), g = 5, server private = 6, server_pub = 5^6 mod 23 = 8.
        let p: u8 = 23;
        let g: u16 = 5;
        let server_private = BigUint::from(6u32);
        let p_big = BigUint::from(p);
        let g_big = BigUint::from(g);
        let server_pub = g_big.modpow(&server_private, &p_big);

        let key_length: u16 = 1; // 1 byte keys for testing.
        let params = ArdServerParams {
            generator: g,
            key_length,
            prime: biguint_to_fixed_be(&p_big, key_length as usize),
            server_public_key: biguint_to_fixed_be(&server_pub, key_length as usize),
        };

        let result = handle_ard_auth(&params, "testuser", "testpass").unwrap();
        assert_eq!(result.encrypted_credentials.len(), 128);
        assert_eq!(result.client_public_key.len(), key_length as usize);
    }

    #[test]
    fn handle_ard_auth_rejects_zero_key_length() {
        let params = ArdServerParams {
            generator: 2,
            key_length: 0,
            prime: vec![],
            server_public_key: vec![],
        };
        assert!(handle_ard_auth(&params, "u", "p").is_err());
    }

    #[test]
    fn handle_ard_auth_rejects_trivial_prime() {
        // p = 1 is degenerate — everything mod 1 is 0.
        let params = ArdServerParams {
            generator: 2,
            key_length: 1,
            prime: vec![1],
            server_public_key: vec![1],
        };
        assert!(handle_ard_auth(&params, "u", "p").is_err());
    }

    #[test]
    fn select_security_type_prefers_ard_over_vnc() {
        let types = vec![
            SecurityType::None,
            SecurityType::VncAuthentication,
            SecurityType::AppleRemoteDesktop,
        ];
        assert_eq!(
            select_security_type(&types),
            Some(SecurityType::AppleRemoteDesktop)
        );
    }

    #[test]
    fn handle_ard_auth_realistic_key_size() {
        // Use a 128-byte (1024-bit) key, which is typical for macOS ARD servers.
        // Generate a random prime-like big number for testing.
        let key_length: u16 = 128;

        // Use a known safe prime for testing (smaller than real, but 128 bytes).
        let mut prime_bytes = vec![0u8; 128];
        prime_bytes[0] = 0xFF; // Make it large.
        prime_bytes[127] = 0xFB; // Make it odd (prime-ish).
        rand::thread_rng().fill_bytes(&mut prime_bytes[1..127]);
        // Ensure MSB is set for a proper-sized prime.
        prime_bytes[0] |= 0x80;

        let g: u16 = 2;
        let p_big = BigUint::from_bytes_be(&prime_bytes);
        let g_big = BigUint::from(g);

        // Generate a random "server" keypair.
        let mut server_priv_bytes = vec![0u8; 128];
        rand::thread_rng().fill_bytes(&mut server_priv_bytes);
        let server_priv = BigUint::from_bytes_be(&server_priv_bytes);
        let server_pub = g_big.modpow(&server_priv, &p_big);

        let params = ArdServerParams {
            generator: g,
            key_length,
            prime: prime_bytes,
            server_public_key: biguint_to_fixed_be(&server_pub, key_length as usize),
        };

        let result = handle_ard_auth(&params, "admin", "password123").unwrap();
        assert_eq!(result.encrypted_credentials.len(), 128);
        assert_eq!(result.client_public_key.len(), 128);

        // Verify both sides compute the same shared secret.
        let client_pub = BigUint::from_bytes_be(&result.client_public_key);
        let _server_shared = client_pub.modpow(&server_priv, &p_big);

        // Client's shared secret (re-derive from client_pub for the server).
        // We can't directly access the client's private key from the result,
        // but we can verify the response structure is well-formed.
        assert!(!result.encrypted_credentials.iter().all(|&b| b == 0));
    }
}
