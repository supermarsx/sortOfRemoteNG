//! # CryptoJS Compatibility (Legacy Decrypt)
//!
//! Decrypts ciphertext produced by the JavaScript `crypto-js` library's
//! default `AES.encrypt(plaintext, password)` call. That format is
//! OpenSSL-compatible and uses:
//!   - 8-byte magic header `"Salted__"`
//!   - 8-byte random salt
//!   - AES-256-CBC ciphertext
//!   - PKCS#7 padding
//!   - Key + IV derived via `EVP_BytesToKey` with MD5, 1 iteration
//!
//! This module exists solely to unlock old encrypted collections /
//! encrypted exports created before the WebCrypto (AES-GCM + PBKDF2)
//! migration landed. New ciphertext is produced in the browser via
//! `window.crypto.subtle`; this module only handles the read-path.

use aes::cipher::{block_padding::Pkcs7, BlockDecryptMut, KeyIvInit};
use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use md5::{Digest, Md5};

type Aes256CbcDec = cbc::Decryptor<aes::Aes256>;

const SALT_MAGIC: &[u8] = b"Salted__";
const KEY_LEN: usize = 32; // AES-256
const IV_LEN: usize = 16;
const SALT_LEN: usize = 8;

/// EVP_BytesToKey with MD5, count=1 — the exact KDF used by
/// `CryptoJS.AES.encrypt(str, pwd)` / `openssl enc -aes-256-cbc -md md5`.
fn evp_bytes_to_key(password: &[u8], salt: &[u8]) -> ([u8; KEY_LEN], [u8; IV_LEN]) {
    let mut derived = Vec::with_capacity(KEY_LEN + IV_LEN);
    let mut prev: Vec<u8> = Vec::new();
    while derived.len() < KEY_LEN + IV_LEN {
        let mut h = Md5::new();
        h.update(&prev);
        h.update(password);
        h.update(salt);
        prev = h.finalize().to_vec();
        derived.extend_from_slice(&prev);
    }
    let mut key = [0u8; KEY_LEN];
    let mut iv = [0u8; IV_LEN];
    key.copy_from_slice(&derived[..KEY_LEN]);
    iv.copy_from_slice(&derived[KEY_LEN..KEY_LEN + IV_LEN]);
    (key, iv)
}

/// Decrypt a `crypto-js`-format base64 blob with the given password.
///
/// Returns the plaintext bytes on success, or an error string on
/// malformed input / wrong password.
pub fn decrypt_cryptojs(ciphertext_b64: &str, password: &str) -> Result<Vec<u8>, String> {
    let bytes = B64
        .decode(ciphertext_b64.trim())
        .map_err(|e| format!("invalid base64: {e}"))?;

    if bytes.len() < SALT_MAGIC.len() + SALT_LEN {
        return Err("ciphertext too short".into());
    }
    if &bytes[..SALT_MAGIC.len()] != SALT_MAGIC {
        return Err("missing Salted__ magic header".into());
    }

    let salt = &bytes[SALT_MAGIC.len()..SALT_MAGIC.len() + SALT_LEN];
    let ct = &bytes[SALT_MAGIC.len() + SALT_LEN..];

    let (key, iv) = evp_bytes_to_key(password.as_bytes(), salt);

    let mut buf = ct.to_vec();
    let pt = Aes256CbcDec::new(&key.into(), &iv.into())
        .decrypt_padded_mut::<Pkcs7>(&mut buf)
        .map_err(|e| format!("decrypt failed: {e}"))?;

    Ok(pt.to_vec())
}

/// Decrypt and UTF-8 decode. Convenience wrapper.
pub fn decrypt_cryptojs_to_string(ciphertext_b64: &str, password: &str) -> Result<String, String> {
    let bytes = decrypt_cryptojs(ciphertext_b64, password)?;
    String::from_utf8(bytes).map_err(|e| format!("invalid utf-8: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    // Reference vector produced by:
    //   CryptoJS.AES.encrypt("hello world", "pw").toString()
    // (The Salted__ prefix + random salt means the exact bytes vary; we
    //  therefore generate a known-input blob with a fixed salt by hand-
    //  constructing the EVP_BytesToKey path, then round-trip.)

    #[test]
    fn round_trip_via_known_salt() {
        use aes::cipher::{block_padding::Pkcs7, BlockEncryptMut};
        type Aes256CbcEnc = cbc::Encryptor<aes::Aes256>;

        let password = "correct horse battery staple";
        let plaintext = b"{\"connections\":[],\"settings\":{}}";
        let salt: [u8; SALT_LEN] = [1, 2, 3, 4, 5, 6, 7, 8];

        let (key, iv) = evp_bytes_to_key(password.as_bytes(), &salt);

        let mut buf = vec![0u8; plaintext.len() + 16];
        let ct_len = Aes256CbcEnc::new(&key.into(), &iv.into())
            .encrypt_padded_b2b_mut::<Pkcs7>(plaintext, &mut buf)
            .unwrap()
            .len();
        buf.truncate(ct_len);

        let mut blob = Vec::new();
        blob.extend_from_slice(SALT_MAGIC);
        blob.extend_from_slice(&salt);
        blob.extend_from_slice(&buf);
        let b64 = B64.encode(&blob);

        let decrypted = decrypt_cryptojs_to_string(&b64, password).unwrap();
        assert_eq!(decrypted.as_bytes(), plaintext);
    }

    #[test]
    fn wrong_password_fails() {
        use aes::cipher::{block_padding::Pkcs7, BlockEncryptMut};
        type Aes256CbcEnc = cbc::Encryptor<aes::Aes256>;

        let salt: [u8; SALT_LEN] = [9; SALT_LEN];
        let (key, iv) = evp_bytes_to_key(b"right", &salt);
        let mut buf = vec![0u8; 32];
        let ct_len = Aes256CbcEnc::new(&key.into(), &iv.into())
            .encrypt_padded_b2b_mut::<Pkcs7>(b"secret data", &mut buf)
            .unwrap()
            .len();
        buf.truncate(ct_len);
        let mut blob = Vec::new();
        blob.extend_from_slice(SALT_MAGIC);
        blob.extend_from_slice(&salt);
        blob.extend_from_slice(&buf);
        let b64 = B64.encode(&blob);

        assert!(decrypt_cryptojs_to_string(&b64, "wrong").is_err());
    }

    #[test]
    fn rejects_missing_magic() {
        let b64 = B64.encode(b"NotSaltedjunkdata");
        assert!(decrypt_cryptojs_to_string(&b64, "pw").is_err());
    }
}
