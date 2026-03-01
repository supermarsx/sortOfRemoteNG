//! Device pairing for the unofficial WhatsApp Web client.
//!
//! Supports two pairing methods:
//!
//! 1. **QR code pairing** — Classic flow where the user scans a QR
//!    code from the WhatsApp mobile app. The QR encodes a Curve25519
//!    public key + client ID and is refreshed periodically.
//!
//! 2. **Phone number linking (pairing code)** — Newer flow where the
//!    user enters a numeric code displayed by the app into their phone.
//!    Does not require a camera.
//!
//! Both methods result in a paired `DeviceIdentity` that can be
//! persisted and reused for future connections.

use crate::whatsapp::error::{WhatsAppError, WhatsAppResult};
use crate::whatsapp::unofficial::{
    DeviceIdentity, UnofficialClient,
};
use chrono::Utc;
use log::{debug, info, warn};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::RwLock;

// ─── Pairing state ──────────────────────────────────────────────────────

/// State of the pairing process.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum PairingState {
    /// Not started.
    Idle,
    /// Generating keys and connecting.
    Initializing,
    /// QR code available — waiting for user to scan.
    WaitingForQrScan {
        /// The current QR code content string.
        qr_data: String,
        /// How many QR refreshes have occurred.
        refresh_count: u32,
    },
    /// Pairing code available — user should enter it on their phone.
    WaitingForPairingCode {
        /// The numeric pairing code (usually 8 digits).
        code: String,
    },
    /// Phone confirmed, device registration in progress.
    Registering,
    /// Pairing succeeded.
    Paired {
        /// JID of the paired phone.
        phone_jid: String,
    },
    /// Pairing failed.
    Failed(String),
    /// Pairing expired (QR was not scanned in time).
    Expired,
}

/// Configuration for the pairing process.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PairingConfig {
    /// QR code refresh interval in seconds (default 20).
    pub qr_refresh_interval_secs: u64,
    /// Maximum number of QR refreshes before giving up (default 5).
    pub max_qr_refreshes: u32,
    /// Pairing timeout in seconds (default 120).
    pub timeout_secs: u64,
    /// Preferred method if both are available.
    pub preferred_method: PairingMethod,
    /// Whether to generate a QR code image (PNG bytes).
    pub generate_qr_image: bool,
    /// QR image size in pixels (default 256).
    pub qr_image_size: u32,
}

impl Default for PairingConfig {
    fn default() -> Self {
        Self {
            qr_refresh_interval_secs: 20,
            max_qr_refreshes: 5,
            timeout_secs: 120,
            preferred_method: PairingMethod::QrCode,
            generate_qr_image: true,
            qr_image_size: 256,
        }
    }
}

/// Pairing method selection.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum PairingMethod {
    QrCode,
    PhoneNumber,
}

/// Result of a successful pairing.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PairingResult {
    pub phone_jid: String,
    pub phone_number: Option<String>,
    pub device_identity: DeviceIdentity,
    pub paired_at: chrono::DateTime<Utc>,
    pub platform: String,
    pub push_name: Option<String>,
}

/// QR code data ready for display.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QrCodeData {
    /// Raw QR content string.
    pub content: String,
    /// PNG image bytes (if `generate_qr_image` is true).
    pub png_bytes: Option<Vec<u8>>,
    /// Base64-encoded PNG (for embedding in HTML/Tauri).
    pub png_base64: Option<String>,
    /// The QR refresh number (1-based).
    pub refresh_number: u32,
    /// Seconds until this QR expires.
    pub expires_in_secs: u64,
}

// ─── Pairing Manager ────────────────────────────────────────────────────

/// Manages the device pairing lifecycle.
pub struct PairingManager {
    config: PairingConfig,
    state: Arc<RwLock<PairingState>>,
    identity: Arc<RwLock<Option<DeviceIdentity>>>,
}

impl PairingManager {
    /// Create a new pairing manager.
    pub fn new(config: PairingConfig) -> Self {
        Self {
            config,
            state: Arc::new(RwLock::new(PairingState::Idle)),
            identity: Arc::new(RwLock::new(None)),
        }
    }

    /// Create with default config.
    pub fn default_manager() -> Self {
        Self::new(PairingConfig::default())
    }

    /// Get current pairing state.
    pub async fn state(&self) -> PairingState {
        self.state.read().await.clone()
    }

    // ─── QR Code Pairing ─────────────────────────────────────────────

    /// Start QR code pairing flow.
    ///
    /// Generates device keys, produces the first QR code, and returns
    /// it. The caller is responsible for displaying it and calling
    /// `refresh_qr` periodically until pairing completes.
    pub async fn start_qr_pairing(&self) -> WhatsAppResult<QrCodeData> {
        *self.state.write().await = PairingState::Initializing;

        // Generate fresh device identity
        let identity = UnofficialClient::generate_identity();
        *self.identity.write().await = Some(identity.clone());

        info!("Starting QR code pairing");

        let qr = self.generate_qr(&identity, 1)?;

        *self.state.write().await = PairingState::WaitingForQrScan {
            qr_data: qr.content.clone(),
            refresh_count: 1,
        };

        Ok(qr)
    }

    /// Refresh the QR code (called periodically).
    ///
    /// Returns `None` if max refreshes exceeded (pairing expired).
    pub async fn refresh_qr(&self) -> WhatsAppResult<Option<QrCodeData>> {
        let current = self.state.read().await.clone();

        match current {
            PairingState::WaitingForQrScan { refresh_count, .. } => {
                if refresh_count >= self.config.max_qr_refreshes {
                    *self.state.write().await = PairingState::Expired;
                    warn!("QR pairing expired after {} refreshes", refresh_count);
                    return Ok(None);
                }

                let identity = self
                    .identity
                    .read()
                    .await
                    .clone()
                    .ok_or_else(|| {
                        WhatsAppError::internal("No identity during QR refresh")
                    })?;

                let new_count = refresh_count + 1;
                let qr = self.generate_qr(&identity, new_count)?;

                *self.state.write().await = PairingState::WaitingForQrScan {
                    qr_data: qr.content.clone(),
                    refresh_count: new_count,
                };

                debug!("QR refreshed (#{}/{})", new_count, self.config.max_qr_refreshes);
                Ok(Some(qr))
            }
            _ => {
                Err(WhatsAppError::internal(
                    "Cannot refresh QR - not in QR scan state",
                ))
            }
        }
    }

    /// Generate the QR code content and optional PNG image.
    fn generate_qr(
        &self,
        identity: &DeviceIdentity,
        refresh_number: u32,
    ) -> WhatsAppResult<QrCodeData> {
        // QR content format: {ref},{publicKey_base64},{identityKey_base64},{advSecretKey}
        let mut rng = rand::thread_rng();
        let mut ref_bytes = [0u8; 16];
        rng.fill_bytes(&mut ref_bytes);
        let ref_str = base64::Engine::encode(
            &base64::engine::general_purpose::STANDARD,
            &ref_bytes,
        );

        let pub_key_b64 = base64::Engine::encode(
            &base64::engine::general_purpose::STANDARD,
            &identity.noise_public_key,
        );

        let id_key_b64 = base64::Engine::encode(
            &base64::engine::general_purpose::STANDARD,
            &identity.identity_key_public,
        );

        let mut adv_secret = [0u8; 32];
        rng.fill_bytes(&mut adv_secret);
        let adv_b64 = base64::Engine::encode(
            &base64::engine::general_purpose::STANDARD,
            &adv_secret,
        );

        let content = format!("{},{},{},{}", ref_str, pub_key_b64, id_key_b64, adv_b64);

        // Generate QR image
        let (png_bytes, png_base64) = if self.config.generate_qr_image {
            match self.render_qr_png(&content) {
                Ok(bytes) => {
                    let b64 = base64::Engine::encode(
                        &base64::engine::general_purpose::STANDARD,
                        &bytes,
                    );
                    (Some(bytes), Some(b64))
                }
                Err(e) => {
                    warn!("QR image generation failed: {}", e);
                    (None, None)
                }
            }
        } else {
            (None, None)
        };

        Ok(QrCodeData {
            content,
            png_bytes,
            png_base64,
            refresh_number,
            expires_in_secs: self.config.qr_refresh_interval_secs,
        })
    }

    /// Render QR code content to a PNG byte vector.
    fn render_qr_png(&self, content: &str) -> WhatsAppResult<Vec<u8>> {
        use image::{Luma, ImageBuffer};
        use qrcode::QrCode;

        let code = QrCode::new(content.as_bytes()).map_err(|e| {
            WhatsAppError::internal(format!("QR code generation failed: {}", e))
        })?;

        let size = self.config.qr_image_size;
        let module_count = code.width() as u32;
        let scale = size / (module_count + 8); // 4-module quiet zone each side
        let scale = scale.max(1);
        let img_size = (module_count + 8) * scale;

        let mut img: ImageBuffer<Luma<u8>, Vec<u8>> =
            ImageBuffer::from_pixel(img_size, img_size, Luma([255u8]));

        for (y, row) in code.to_colors().chunks(module_count as usize).enumerate() {
            for (x, &color) in row.iter().enumerate() {
                let pixel = if color == qrcode::Color::Dark {
                    Luma([0u8])
                } else {
                    Luma([255u8])
                };

                let px = (x as u32 + 4) * scale;
                let py = (y as u32 + 4) * scale;
                for dy in 0..scale {
                    for dx in 0..scale {
                        if px + dx < img_size && py + dy < img_size {
                            img.put_pixel(px + dx, py + dy, pixel);
                        }
                    }
                }
            }
        }

        let mut buf = Vec::new();
        let encoder = image::codecs::png::PngEncoder::new(&mut buf);
        image::ImageEncoder::write_image(
            encoder,
            img.as_raw(),
            img_size,
            img_size,
            image::ExtendedColorType::L8,
        )
        .map_err(|e| WhatsAppError::internal(format!("PNG encode: {}", e)))?;

        Ok(buf)
    }

    // ─── Phone Number Pairing ────────────────────────────────────────

    /// Start phone number pairing flow.
    ///
    /// Requests a pairing code that the user must enter on their phone
    /// in WhatsApp → Linked Devices → Link with Phone Number.
    pub async fn start_phone_pairing(
        &self,
        phone_number: &str,
    ) -> WhatsAppResult<String> {
        *self.state.write().await = PairingState::Initializing;

        // Generate identity if not already present
        {
            let mut id = self.identity.write().await;
            if id.is_none() {
                *id = Some(UnofficialClient::generate_identity());
            }
        }

        info!("Starting phone number pairing for {}", phone_number);

        // Generate an 8-digit pairing code
        let code = Self::generate_pairing_code();

        *self.state.write().await = PairingState::WaitingForPairingCode {
            code: code.clone(),
        };

        Ok(code)
    }

    /// Generate a random 8-digit pairing code.
    fn generate_pairing_code() -> String {
        let mut rng = rand::thread_rng();
        let mut bytes = [0u8; 4];
        rng.fill_bytes(&mut bytes);
        let num = u32::from_le_bytes(bytes) % 100_000_000;
        format!("{:08}", num)
    }

    /// Format pairing code for display (xxxx-xxxx).
    pub fn format_pairing_code(code: &str) -> String {
        if code.len() == 8 {
            format!("{}-{}", &code[..4], &code[4..])
        } else {
            code.to_string()
        }
    }

    // ─── Pairing confirmation ────────────────────────────────────────

    /// Called when the server confirms pairing success.
    pub async fn confirm_pairing(
        &self,
        phone_jid: &str,
        push_name: Option<String>,
    ) -> WhatsAppResult<PairingResult> {
        let identity = self
            .identity
            .read()
            .await
            .clone()
            .ok_or_else(|| {
                WhatsAppError::internal("No identity at pairing confirmation")
            })?;

        *self.state.write().await = PairingState::Paired {
            phone_jid: phone_jid.to_string(),
        };

        let phone_number = UnofficialClient::jid_to_phone(phone_jid);

        info!("Pairing confirmed with {}", phone_jid);

        Ok(PairingResult {
            phone_jid: phone_jid.to_string(),
            phone_number,
            device_identity: identity,
            paired_at: Utc::now(),
            platform: "Windows".into(),
            push_name,
        })
    }

    /// Cancel the pairing process.
    pub async fn cancel(&self) {
        *self.state.write().await = PairingState::Idle;
        info!("Pairing cancelled");
    }

    /// Mark pairing as failed.
    pub async fn set_failed(&self, reason: &str) {
        *self.state.write().await = PairingState::Failed(reason.to_string());
        warn!("Pairing failed: {}", reason);
    }

    /// Check if pairing has completed successfully.
    pub async fn is_paired(&self) -> bool {
        matches!(*self.state.read().await, PairingState::Paired { .. })
    }

    /// Get the paired device identity (if pairing succeeded).
    pub async fn get_paired_identity(&self) -> Option<DeviceIdentity> {
        if self.is_paired().await {
            self.identity.read().await.clone()
        } else {
            None
        }
    }
}

// ─── Session persistence ────────────────────────────────────────────────

/// Serializable session data for persistence across app restarts.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PersistedSession {
    pub device_identity: DeviceIdentity,
    pub phone_jid: String,
    pub phone_number: Option<String>,
    pub push_name: Option<String>,
    pub paired_at: chrono::DateTime<Utc>,
    pub last_connected: Option<chrono::DateTime<Utc>>,
    pub platform: String,
}

impl PersistedSession {
    /// Create from a pairing result.
    pub fn from_pairing(result: &PairingResult) -> Self {
        Self {
            device_identity: result.device_identity.clone(),
            phone_jid: result.phone_jid.clone(),
            phone_number: result.phone_number.clone(),
            push_name: result.push_name.clone(),
            paired_at: result.paired_at,
            last_connected: None,
            platform: result.platform.clone(),
        }
    }

    /// Serialize to JSON bytes for storage.
    pub fn to_bytes(&self) -> WhatsAppResult<Vec<u8>> {
        serde_json::to_vec(self)
            .map_err(|e| WhatsAppError::internal(format!("Session serialize: {}", e)))
    }

    /// Deserialize from JSON bytes.
    pub fn from_bytes(data: &[u8]) -> WhatsAppResult<Self> {
        serde_json::from_slice(data)
            .map_err(|e| WhatsAppError::internal(format!("Session deserialize: {}", e)))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_generate_pairing_code() {
        let code = PairingManager::generate_pairing_code();
        assert_eq!(code.len(), 8);
        assert!(code.chars().all(|c| c.is_ascii_digit()));
    }

    #[test]
    fn test_format_pairing_code() {
        assert_eq!(
            PairingManager::format_pairing_code("12345678"),
            "1234-5678"
        );
        assert_eq!(
            PairingManager::format_pairing_code("123"),
            "123"
        );
    }

    #[test]
    fn test_pairing_state_serialization() {
        let state = PairingState::WaitingForQrScan {
            qr_data: "test_data".into(),
            refresh_count: 2,
        };
        let json = serde_json::to_string(&state).unwrap();
        assert!(json.contains("WaitingForQrScan"));
        assert!(json.contains("test_data"));

        let deser: PairingState = serde_json::from_str(&json).unwrap();
        assert_eq!(deser, state);
    }

    #[test]
    fn test_pairing_config_default() {
        let cfg = PairingConfig::default();
        assert_eq!(cfg.qr_refresh_interval_secs, 20);
        assert_eq!(cfg.max_qr_refreshes, 5);
        assert_eq!(cfg.timeout_secs, 120);
        assert!(cfg.generate_qr_image);
        assert_eq!(cfg.qr_image_size, 256);
    }

    #[tokio::test]
    async fn test_pairing_manager_lifecycle() {
        let mgr = PairingManager::default_manager();
        assert_eq!(mgr.state().await, PairingState::Idle);

        // Start phone pairing
        let code = mgr.start_phone_pairing("+1234567890").await.unwrap();
        assert_eq!(code.len(), 8);
        assert!(matches!(
            mgr.state().await,
            PairingState::WaitingForPairingCode { .. }
        ));

        // Confirm pairing
        let result = mgr
            .confirm_pairing("1234567890@s.whatsapp.net", Some("John".into()))
            .await
            .unwrap();
        assert_eq!(result.phone_jid, "1234567890@s.whatsapp.net");
        assert!(mgr.is_paired().await);
    }

    #[tokio::test]
    async fn test_qr_pairing_start() {
        let mgr = PairingManager::new(PairingConfig {
            generate_qr_image: false, // skip image in test
            ..Default::default()
        });

        let qr = mgr.start_qr_pairing().await.unwrap();
        assert!(!qr.content.is_empty());
        assert_eq!(qr.refresh_number, 1);
        assert!(qr.png_bytes.is_none()); // image disabled
    }

    #[tokio::test]
    async fn test_qr_refresh_limit() {
        let mgr = PairingManager::new(PairingConfig {
            max_qr_refreshes: 2,
            generate_qr_image: false,
            ..Default::default()
        });

        mgr.start_qr_pairing().await.unwrap();

        // First refresh ok
        let r1 = mgr.refresh_qr().await.unwrap();
        assert!(r1.is_some());

        // Second refresh exceeds limit
        let r2 = mgr.refresh_qr().await.unwrap();
        assert!(r2.is_none());
        assert_eq!(mgr.state().await, PairingState::Expired);
    }

    #[test]
    fn test_persisted_session() {
        let identity = UnofficialClient::generate_identity();
        let result = PairingResult {
            phone_jid: "123@s.whatsapp.net".into(),
            phone_number: Some("+123".into()),
            device_identity: identity,
            paired_at: Utc::now(),
            platform: "Windows".into(),
            push_name: Some("Test".into()),
        };

        let session = PersistedSession::from_pairing(&result);
        let bytes = session.to_bytes().unwrap();
        let restored = PersistedSession::from_bytes(&bytes).unwrap();
        assert_eq!(restored.phone_jid, "123@s.whatsapp.net");
    }

    #[tokio::test]
    async fn test_cancel_pairing() {
        let mgr = PairingManager::default_manager();
        mgr.start_phone_pairing("+1234").await.unwrap();
        mgr.cancel().await;
        assert_eq!(mgr.state().await, PairingState::Idle);
    }
}
