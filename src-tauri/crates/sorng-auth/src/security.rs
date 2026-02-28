use std::sync::Arc;
use tokio::sync::Mutex;
use totp_rs::{Algorithm, TOTP};
use aes_gcm::{Aes256Gcm, Nonce};
use aes_gcm::aead::{Aead, KeyInit};
use rand::RngCore;
use base64::{Engine as _, engine::general_purpose};

pub type SecurityServiceState = Arc<Mutex<SecurityService>>;

pub struct SecurityService {
    totp: Option<TOTP>,
}

impl SecurityService {
    pub fn new() -> SecurityServiceState {
        Arc::new(Mutex::new(SecurityService { totp: None }))
    }

    pub async fn generate_totp_secret(&mut self) -> Result<String, String> {
        let mut secret = [0u8; 32];
        rand::thread_rng().fill_bytes(&mut secret);
        let secret_b32 = general_purpose::STANDARD.encode(&secret);

        let totp = TOTP::new(
            Algorithm::SHA1,
            6,
            1,
            30,
            secret_b32.as_bytes().to_vec(),
        ).map_err(|e| e.to_string())?;
        self.totp = Some(totp);
        Ok(secret_b32)
    }

    pub async fn verify_totp(&self, code: String) -> Result<bool, String> {
        if let Some(totp) = &self.totp {
            let result = totp.check_current(&code).map_err(|e| e.to_string())?;
            Ok(result)
        } else {
            Err("TOTP not initialized".to_string())
        }
    }

    pub async fn encrypt_data(&self, data: String, key: String) -> Result<String, String> {
        // Derive a 32-byte key from the provided key using a simple hash
        let key_bytes = Self::derive_key(&key);
        let cipher = Aes256Gcm::new(&key_bytes.into());

        // Generate a random nonce
        let mut nonce_bytes = [0u8; 12];
        rand::thread_rng().fill_bytes(&mut nonce_bytes);
        let nonce = Nonce::from_slice(&nonce_bytes);

        // Encrypt the data
        let ciphertext = cipher.encrypt(nonce, data.as_bytes())
            .map_err(|e| format!("Encryption failed: {:?}", e))?;

        // Combine nonce and ciphertext, then base64 encode
        let mut combined = nonce_bytes.to_vec();
        combined.extend(ciphertext);
        let encoded = general_purpose::STANDARD.encode(&combined);

        Ok(encoded)
    }

    pub async fn decrypt_data(&self, data: String, key: String) -> Result<String, String> {
        // Decode from base64
        let combined = general_purpose::STANDARD.decode(data.as_bytes())
            .map_err(|e| format!("Base64 decode failed: {}", e))?;

        if combined.len() < 12 {
            return Err("Invalid encrypted data".to_string());
        }

        // Split nonce and ciphertext
        let nonce_bytes = &combined[..12];
        let ciphertext = &combined[12..];

        // Derive key
        let key_bytes = Self::derive_key(&key);
        let cipher = Aes256Gcm::new(&key_bytes.into());
        let nonce = Nonce::from_slice(nonce_bytes);

        // Decrypt
        let plaintext = cipher.decrypt(nonce, ciphertext)
            .map_err(|e| format!("Decryption failed: {:?}", e))?;

        String::from_utf8(plaintext)
            .map_err(|e| format!("UTF-8 decode failed: {}", e))
    }

    // Simple key derivation - in production, use proper KDF like PBKDF2
    fn derive_key(password: &str) -> [u8; 32] {
        use std::collections::hash_map::DefaultHasher;
        use std::hash::{Hash, Hasher};

        let mut hasher = DefaultHasher::new();
        password.hash(&mut hasher);
        let hash = hasher.finish();

        let mut key = [0u8; 32];
        for (i, chunk) in hash.to_le_bytes().iter().cycle().take(32).enumerate() {
            key[i] = *chunk;
        }
        key
    }
}

#[tauri::command]
pub async fn generate_totp_secret(state: tauri::State<'_, SecurityServiceState>) -> Result<String, String> {
    let mut security = state.lock().await;
    security.generate_totp_secret().await
}

#[tauri::command]
pub async fn verify_totp(state: tauri::State<'_, SecurityServiceState>, code: String) -> Result<bool, String> {
    let security = state.lock().await;
    security.verify_totp(code).await
}

#[tauri::command]
pub async fn encrypt_data(state: tauri::State<'_, SecurityServiceState>, data: String, key: String) -> Result<String, String> {
    let security = state.lock().await;
    security.encrypt_data(data, key).await
}

#[tauri::command]
pub async fn decrypt_data(state: tauri::State<'_, SecurityServiceState>, data: String, key: String) -> Result<String, String> {
    let security = state.lock().await;
    security.decrypt_data(data, key).await
}