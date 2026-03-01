use crate::lastpass::types::LastPassError;

/// Derive the encryption key from the master password using PBKDF2-SHA256.
///
/// This is the core key derivation following the LastPass protocol:
/// - If iterations == 1: key = SHA256(hex(SHA256(password)) + password)
/// - If iterations > 1: key = PBKDF2_SHA256(password, email, iterations, 32)
pub fn derive_key(password: &str, email: &str, iterations: u32) -> Vec<u8> {
    use hmac::Hmac;
    use pbkdf2::pbkdf2;
    use sha2::{Digest, Sha256};

    if iterations == 1 {
        let mut hasher = Sha256::new();
        hasher.update(password.as_bytes());
        let first_hash = hasher.finalize();
        let hex_hash = hex::encode(first_hash);
        let mut second_hasher = Sha256::new();
        second_hasher.update(hex_hash.as_bytes());
        second_hasher.update(password.as_bytes());
        second_hasher.finalize().to_vec()
    } else {
        let mut key = [0u8; 32];
        pbkdf2::<Hmac<Sha256>>(
            password.as_bytes(),
            email.to_lowercase().as_bytes(),
            iterations,
            &mut key,
        )
        .expect("PBKDF2 should not fail");
        key.to_vec()
    }
}

/// Compute the login hash sent to the server for authentication.
///
/// Protocol:
/// - If iterations == 1: login_hash = hex(SHA256(hex(key) + password))
/// - If iterations > 1: login_hash = hex(PBKDF2_SHA256(key, password, 1, 32))
pub fn compute_login_hash(key: &[u8], password: &str, iterations: u32) -> String {
    use hmac::Hmac;
    use pbkdf2::pbkdf2;
    use sha2::{Digest, Sha256};

    if iterations == 1 {
        let hex_key = hex::encode(key);
        let mut hasher = Sha256::new();
        hasher.update(hex_key.as_bytes());
        hasher.update(password.as_bytes());
        hex::encode(hasher.finalize())
    } else {
        let mut login_hash = [0u8; 32];
        pbkdf2::<Hmac<Sha256>>(key, password.as_bytes(), 1, &mut login_hash)
            .expect("PBKDF2 should not fail");
        hex::encode(login_hash)
    }
}

/// Decrypt an AES-256-CBC encrypted blob with a given key and IV.
pub fn decrypt_aes_cbc(data: &[u8], key: &[u8], iv: &[u8]) -> Result<Vec<u8>, LastPassError> {
    use aes::Aes256;
    use cbc::cipher::{BlockDecryptMut, KeyIvInit};
    use cbc::cipher::block_padding::Pkcs7;

    type Aes256CbcDec = cbc::Decryptor<Aes256>;

    if key.len() != 32 {
        return Err(LastPassError::decryption_error("Key must be 32 bytes for AES-256"));
    }
    if iv.len() != 16 {
        return Err(LastPassError::decryption_error("IV must be 16 bytes"));
    }

    let mut buf = data.to_vec();
    let decryptor = Aes256CbcDec::new_from_slices(key, iv)
        .map_err(|e| LastPassError::decryption_error(format!("Failed to init AES-CBC: {}", e)))?;

    let plaintext = decryptor
        .decrypt_padded_mut::<Pkcs7>(&mut buf)
        .map_err(|e| LastPassError::decryption_error(format!("AES-CBC decryption failed: {}", e)))?;

    Ok(plaintext.to_vec())
}

/// Decrypt an AES-256-ECB encrypted blob with a given key.
pub fn decrypt_aes_ecb(data: &[u8], key: &[u8]) -> Result<Vec<u8>, LastPassError> {
    use aes::Aes256;
    use aes::cipher::{BlockDecrypt, KeyInit, generic_array::GenericArray};

    if key.len() != 32 {
        return Err(LastPassError::decryption_error("Key must be 32 bytes for AES-256"));
    }
    if data.len() % 16 != 0 {
        return Err(LastPassError::decryption_error("ECB data must be multiple of 16 bytes"));
    }

    let cipher = Aes256::new(GenericArray::from_slice(key));
    let mut result = Vec::with_capacity(data.len());

    for chunk in data.chunks(16) {
        let mut block = *GenericArray::from_slice(chunk);
        cipher.decrypt_block(&mut block);
        result.extend_from_slice(&block);
    }

    // Remove PKCS7 padding
    if let Some(&last_byte) = result.last() {
        let pad_len = last_byte as usize;
        if pad_len > 0 && pad_len <= 16 && result.len() >= pad_len {
            let valid_padding = result[result.len() - pad_len..]
                .iter()
                .all(|&b| b == last_byte);
            if valid_padding {
                result.truncate(result.len() - pad_len);
            }
        }
    }

    Ok(result)
}

/// Encrypt data using AES-256-CBC with a given key and IV.
pub fn encrypt_aes_cbc(data: &[u8], key: &[u8], iv: &[u8]) -> Result<Vec<u8>, LastPassError> {
    use aes::Aes256;
    use cbc::cipher::BlockEncryptMut;
    use cbc::cipher::KeyIvInit;
    use cbc::cipher::block_padding::Pkcs7;

    type Aes256CbcEnc = cbc::Encryptor<Aes256>;

    if key.len() != 32 {
        return Err(LastPassError::encryption_error("Key must be 32 bytes for AES-256"));
    }
    if iv.len() != 16 {
        return Err(LastPassError::encryption_error("IV must be 16 bytes"));
    }

    let encryptor = Aes256CbcEnc::new_from_slices(key, iv)
        .map_err(|e| LastPassError::encryption_error(format!("Failed to init AES-CBC: {}", e)))?;

    let padded_len = data.len() + (16 - data.len() % 16);
    let mut buf = vec![0u8; padded_len];
    buf[..data.len()].copy_from_slice(data);

    let ciphertext = encryptor
        .encrypt_padded_mut::<Pkcs7>(&mut buf, data.len())
        .map_err(|e| LastPassError::encryption_error(format!("AES-CBC encryption failed: {}", e)))?;

    Ok(ciphertext.to_vec())
}

/// Decrypt a field that is either base64-encoded AES-CBC (with ! prefix) or hex AES-ECB.
pub fn decrypt_field(data: &str, key: &[u8]) -> Result<String, LastPassError> {
    use base64::Engine;
    use base64::engine::general_purpose::STANDARD;

    if data.is_empty() {
        return Ok(String::new());
    }

    if data.starts_with('!') {
        // AES-256-CBC: !<base64_iv>|<base64_ciphertext>
        let parts: Vec<&str> = data[1..].splitn(2, '|').collect();
        if parts.len() != 2 {
            return Err(LastPassError::decryption_error("Invalid CBC field format"));
        }
        let iv = STANDARD
            .decode(parts[0])
            .map_err(|e| LastPassError::decryption_error(format!("Invalid IV base64: {}", e)))?;
        let ciphertext = STANDARD
            .decode(parts[1])
            .map_err(|e| LastPassError::decryption_error(format!("Invalid ciphertext base64: {}", e)))?;
        let plaintext = decrypt_aes_cbc(&ciphertext, key, &iv)?;
        String::from_utf8(plaintext)
            .map_err(|e| LastPassError::decryption_error(format!("Invalid UTF-8 after decrypt: {}", e)))
    } else {
        // AES-256-ECB with hex encoding
        let data_bytes = hex::decode(data)
            .map_err(|e| LastPassError::decryption_error(format!("Invalid hex: {}", e)))?;
        if data_bytes.is_empty() {
            return Ok(String::new());
        }
        let plaintext = decrypt_aes_ecb(&data_bytes, key)?;
        String::from_utf8(plaintext)
            .map_err(|e| LastPassError::decryption_error(format!("Invalid UTF-8 after ECB decrypt: {}", e)))
    }
}

/// Generate a random 16-byte IV.
pub fn generate_iv() -> [u8; 16] {
    use rand::RngCore;
    let mut iv = [0u8; 16];
    rand::thread_rng().fill_bytes(&mut iv);
    iv
}

/// Encrypt a field for storage (AES-256-CBC, base64 encoded with ! prefix).
pub fn encrypt_field(data: &str, key: &[u8]) -> Result<String, LastPassError> {
    use base64::Engine;
    use base64::engine::general_purpose::STANDARD;

    if data.is_empty() {
        return Ok(String::new());
    }

    let iv = generate_iv();
    let ciphertext = encrypt_aes_cbc(data.as_bytes(), key, &iv)?;
    Ok(format!(
        "!{}|{}",
        STANDARD.encode(&iv),
        STANDARD.encode(&ciphertext)
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_derive_key_multiple_iterations() {
        let key = derive_key("master_password", "user@example.com", 100100);
        assert_eq!(key.len(), 32);
    }

    #[test]
    fn test_derive_key_single_iteration() {
        let key = derive_key("master_password", "user@example.com", 1);
        assert_eq!(key.len(), 32);
    }

    #[test]
    fn test_login_hash_multiple_iterations() {
        let key = derive_key("master_password", "user@example.com", 100100);
        let hash = compute_login_hash(&key, "master_password", 100100);
        assert_eq!(hash.len(), 64); // hex-encoded 32 bytes
    }

    #[test]
    fn test_encrypt_decrypt_cbc_roundtrip() {
        let key = [0x42u8; 32];
        let plaintext = "Hello, LastPass!";
        let encrypted = encrypt_field(plaintext, &key).unwrap();
        let decrypted = decrypt_field(&encrypted, &key).unwrap();
        assert_eq!(decrypted, plaintext);
    }

    #[test]
    fn test_empty_field() {
        let key = [0x42u8; 32];
        let encrypted = encrypt_field("", &key).unwrap();
        assert_eq!(encrypted, "");
        let decrypted = decrypt_field("", &key).unwrap();
        assert_eq!(decrypted, "");
    }
}
