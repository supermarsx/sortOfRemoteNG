//! # Two-Factor Authentication Module
//!
//! This module provides two-factor authentication functionality using TOTP (Time-based One-Time Passwords).
//! It supports multiple 2FA methods including TOTP, SMS, and email verification.
//!
//! ## Features
//!
//! - TOTP token generation and verification
//! - QR code generation for TOTP setup
//! - Backup codes for account recovery
//! - Multiple 2FA methods support
//!
//! ## Security
//!
//! Uses cryptographically secure random number generation for secrets.
//! TOTP tokens have a 30-second window for validation.
//!
//! ## Example
//!

use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;
use serde::{Deserialize, Serialize};
use totp_rs::{Algorithm, TOTP};
use image::Rgb;
use qrcode::QrCode;
use base64::{Engine as _, engine::general_purpose};
use rand::RngCore;

/// Supported 2FA methods
#[derive(Serialize, Deserialize, Clone, Debug)]
pub enum TwoFactorMethod {
    /// Time-based One-Time Password
    TOTP,
    /// SMS verification (not implemented)
    SMS,
    /// Email verification (not implemented)
    Email,
}

/// 2FA configuration for a user
#[derive(Serialize, Deserialize, Clone)]
pub struct TwoFactorConfig {
    /// The 2FA method
    pub method: TwoFactorMethod,
    /// Secret key for TOTP
    pub secret: String,
    /// Whether 2FA is enabled
    pub enabled: bool,
    /// Backup codes for recovery
    pub backup_codes: Vec<String>,
    /// When 2FA was enabled
    pub created_at: chrono::DateTime<chrono::Utc>,
}

/// 2FA service state
pub type TwoFactorServiceState = Arc<Mutex<TwoFactorService>>;

/// Service for managing two-factor authentication
pub struct TwoFactorService {
    /// Map of usernames to their 2FA configurations
    configs: HashMap<String, TwoFactorConfig>,
    /// TOTP instances for verification
    totp_instances: HashMap<String, TOTP>,
}

impl TwoFactorService {
    /// Creates a new 2FA service
    pub fn new() -> TwoFactorServiceState {
        Arc::new(Mutex::new(TwoFactorService {
            configs: HashMap::new(),
            totp_instances: HashMap::new(),
        }))
    }

    /// Enables 2FA for a user
    pub async fn enable_2fa(&mut self, username: String, method: TwoFactorMethod) -> Result<String, String> {
        match method {
            TwoFactorMethod::TOTP => {
                self.enable_totp(username).await
            }
            _ => Err("Unsupported 2FA method".to_string())
        }
    }

    /// Enables TOTP for a user and returns setup information
    pub async fn enable_totp(&mut self, username: String) -> Result<String, String> {
        // Generate a new secret
        let mut secret_bytes = [0u8; 20];
        rand::rngs::OsRng.fill_bytes(&mut secret_bytes);
        let secret = data_encoding::BASE32_NOPAD.encode(&secret_bytes);

        // Create TOTP instance
        let totp = TOTP::new(
            Algorithm::SHA1,
            6,  // 6 digits
            1,  // 1 digit step (30 seconds)
            30, // 30 second period
            secret.clone().into_bytes(),
        ).map_err(|e| format!("Failed to create TOTP: {}", e))?;

        // Generate QR code URL
        let url = format!("otpauth://totp/SortOfRemote NG:{}?secret={}&issuer=SortOfRemote NG", username, secret);
        let code = QrCode::new(url.as_bytes())
            .map_err(|e| format!("Failed to generate QR code: {}", e))?;

        let image = code.render::<Rgb<u8>>().build();
        let mut png_data = Vec::new();
        image.write_to(&mut std::io::Cursor::new(&mut png_data), image::ImageFormat::Png)
            .map_err(|e| format!("Failed to encode QR code: {}", e))?;

        let qr_base64 = general_purpose::STANDARD.encode(&png_data);

        // Generate backup codes
        let backup_codes = self.generate_backup_codes();

        // Store configuration
        let config = TwoFactorConfig {
            method: TwoFactorMethod::TOTP,
            secret: secret.clone(),
            enabled: false, // Will be enabled after verification
            backup_codes: backup_codes.clone(),
            created_at: chrono::Utc::now(),
        };

        self.configs.insert(username.clone(), config);
        self.totp_instances.insert(username, totp);

        // Return setup information
        Ok(format!(
            r#"{{"qr_code": "data:image/png;base64,{}", "secret": "{}", "backup_codes": {}}}"#,
            qr_base64,
            secret,
            serde_json::to_string(&backup_codes).unwrap()
        ))
    }

    /// Verifies a 2FA token
    pub async fn verify_2fa(&self, username: &str, token: &str) -> Result<bool, String> {
        if let Some(config) = self.configs.get(username) {
            if !config.enabled {
                return Ok(false);
            }

            match config.method {
                TwoFactorMethod::TOTP => {
                    if let Some(totp) = self.totp_instances.get(username) {
                        let is_valid = totp.check_current(token)
                            .map_err(|e| format!("TOTP verification failed: {}", e))?;
                        Ok(is_valid)
                    } else {
                        Err("TOTP instance not found".to_string())
                    }
                }
                _ => Err("Unsupported 2FA method".to_string())
            }
        } else {
            Ok(false) // No 2FA configured
        }
    }

    /// Confirms 2FA setup after successful verification

    pub async fn confirm_2fa_setup(&mut self, username: String, token: String) -> Result<(), String> {
        if let Some(config) = self.configs.get_mut(&username) {
            // Check if the token is valid first
            if let Some(totp) = self.totp_instances.get(&username) {
                let is_valid = totp.check_current(&token)
                    .map_err(|e| format!("TOTP verification failed: {}", e))?;
                if is_valid {
                    config.enabled = true;
                    Ok(())
                } else {
                    Err("Invalid verification token".to_string())
                }
            } else {
                Err("TOTP instance not found".to_string())
            }
        } else {
            Err("2FA not configured for user".to_string())
        }
    }

    /// Disables 2FA for a user
    pub async fn disable_2fa(&mut self, username: String) -> Result<(), String> {
        if let Some(config) = self.configs.get_mut(&username) {
            config.enabled = false;
            self.totp_instances.remove(&username);
            Ok(())
        } else {
            Err("2FA not configured for user".to_string())
        }
    }

    /// Verifies a backup code
    pub async fn verify_backup_code(&mut self, username: String, code: String) -> Result<bool, String> {
        if let Some(config) = self.configs.get_mut(&username) {
            if let Some(pos) = config.backup_codes.iter().position(|c| c == &code) {
                config.backup_codes.remove(pos);
                Ok(true)
            } else {
                Ok(false)
            }
        } else {
            Ok(false)
        }
    }

    /// Regenerates backup codes for a user
    pub async fn regenerate_backup_codes(&mut self, username: String) -> Result<Vec<String>, String> {
        let codes = self.generate_backup_codes();
        if let Some(config) = self.configs.get_mut(&username) {
            config.backup_codes = codes.clone();
            Ok(codes)
        } else {
            Err("2FA not configured for user".to_string())
        }
    }

    /// Checks if 2FA is enabled for a user
    pub async fn is_2fa_enabled(&self, username: &str) -> bool {
        self.configs.get(username)
            .map(|config| config.enabled)
            .unwrap_or(false)
    }

    /// Gets 2FA status for a user
    pub async fn get_2fa_status(&self, username: &str) -> Option<TwoFactorConfig> {
        self.configs.get(username).cloned()
    }

    /// Generates backup codes
    fn generate_backup_codes(&self) -> Vec<String> {
        use rand::Rng;
        let mut rng = rand::thread_rng();
        (0..10).map(|_| {
            (0..8).map(|_| rng.gen_range(0..10).to_string()).collect()
        }).collect()
    }
}
