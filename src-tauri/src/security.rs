use std::sync::Arc;
use tokio::sync::Mutex;
use totp_rs::{Algorithm, TOTP};

pub type SecurityServiceState = Arc<Mutex<SecurityService>>;

pub struct SecurityService {
    totp: Option<TOTP>,
}

impl SecurityService {
    pub fn new() -> SecurityServiceState {
        Arc::new(Mutex::new(SecurityService { totp: None }))
    }

    pub async fn generate_totp_secret(&mut self) -> Result<String, String> {
        let secret = "JBSWY3DPEHPK3PXP"; // Example secret, in real app generate random
        let totp = TOTP::new(
            Algorithm::SHA1,
            6,
            1,
            30,
            secret.as_bytes().to_vec(),
        ).map_err(|e| e.to_string())?;
        self.totp = Some(totp);
        Ok(secret.to_string())
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
        use base64::{Engine as _, engine::general_purpose};
        let encoded = general_purpose::STANDARD.encode(data.as_bytes());
        Ok(encoded)
    }

    pub async fn decrypt_data(&self, data: String, key: String) -> Result<String, String> {
        use base64::{Engine as _, engine::general_purpose};
        let decoded = general_purpose::STANDARD.decode(data.as_bytes()).map_err(|e| e.to_string())?;
        String::from_utf8(decoded).map_err(|e| e.to_string())
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