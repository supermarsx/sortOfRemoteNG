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

use base64::{engine::general_purpose, Engine as _};
use qrcode::QrCode;
use rand::{Rng, RngCore};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;
use totp_rs::{Algorithm, TOTP};

/// Supported 2FA methods
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub enum TwoFactorMethod {
    /// Time-based One-Time Password
    TOTP,
    /// SMS verification (code delivered via a Twilio-compatible HTTP API).
    SMS,
    /// Email verification (code delivered via the notifications SMTP path).
    Email,
}

/// 2FA configuration for a user
#[derive(Serialize, Deserialize, Clone)]
pub struct TwoFactorConfig {
    /// The 2FA method
    pub method: TwoFactorMethod,
    /// Secret key for TOTP (empty for SMS/Email methods)
    pub secret: String,
    /// Whether 2FA is enabled
    pub enabled: bool,
    /// Backup codes for recovery
    pub backup_codes: Vec<String>,
    /// When 2FA was enabled
    pub created_at: chrono::DateTime<chrono::Utc>,
    /// Delivery target for SMS/Email methods — E.164 phone number or RFC-5322 address.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub delivery_target: Option<String>,
}

/// A pending SMS/Email challenge — a short-lived one-time code awaiting user input.
#[derive(Clone, Debug)]
struct PendingChallenge {
    /// SHA-256 hex of the dispatched 6-digit code (codes are never kept in plaintext).
    code_hash: String,
    /// Expiry timestamp — challenges are single-use and time-limited.
    expires_at: chrono::DateTime<chrono::Utc>,
    /// Number of verification attempts so far (cap prevents brute force).
    attempts: u8,
}

/// Maximum lifetime of an SMS/Email challenge before it must be re-requested.
const CHALLENGE_TTL_SECS: i64 = 300; // 5 minutes
/// Maximum number of verification attempts per challenge before it is invalidated.
const MAX_CHALLENGE_ATTEMPTS: u8 = 5;

/// 2FA service state
pub type TwoFactorServiceState = Arc<Mutex<TwoFactorService>>;

/// Service for managing two-factor authentication
pub struct TwoFactorService {
    /// Map of usernames to their 2FA configurations
    configs: HashMap<String, TwoFactorConfig>,
    /// TOTP instances for verification
    totp_instances: HashMap<String, TOTP>,
    /// Pending SMS/Email challenges keyed by username
    pending_challenges: HashMap<String, PendingChallenge>,
}

const QR_MODULE_PX: u32 = 8;
const QR_QUIET_ZONE: u32 = 4;

fn render_qr_png(content: &str) -> Result<Vec<u8>, String> {
    let code = QrCode::new(content.as_bytes())
        .map_err(|e| format!("Failed to generate QR code: {}", e))?;

    let matrix = code.to_colors();
    let width = code.width() as u32;
    let img_size = (width + QR_QUIET_ZONE * 2) * QR_MODULE_PX;
    let mut pixels = vec![255u8; (img_size * img_size) as usize];

    for y in 0..width {
        for x in 0..width {
            if matrix[(y * width + x) as usize] != qrcode::Color::Dark {
                continue;
            }

            let px_x = (x + QR_QUIET_ZONE) * QR_MODULE_PX;
            let px_y = (y + QR_QUIET_ZONE) * QR_MODULE_PX;
            for dy in 0..QR_MODULE_PX {
                let row = (px_y + dy) * img_size;
                for dx in 0..QR_MODULE_PX {
                    pixels[(row + px_x + dx) as usize] = 0;
                }
            }
        }
    }

    let mut png_data = Vec::new();
    let mut encoder = png::Encoder::new(&mut png_data, img_size, img_size);
    encoder.set_color(png::ColorType::Grayscale);
    encoder.set_depth(png::BitDepth::Eight);
    encoder
        .write_header()
        .map_err(|e| format!("Failed to prepare PNG encoder: {}", e))?
        .write_image_data(&pixels)
        .map_err(|e| format!("Failed to encode QR code: {}", e))?;

    Ok(png_data)
}

impl TwoFactorService {
    /// Creates a new 2FA service
    pub fn new() -> TwoFactorServiceState {
        Arc::new(Mutex::new(TwoFactorService {
            configs: HashMap::new(),
            totp_instances: HashMap::new(),
            pending_challenges: HashMap::new(),
        }))
    }

    /// Enables 2FA for a user.
    ///
    /// For TOTP this generates a secret/QR and returns setup JSON. For SMS or
    /// Email this registers the delivery target and returns a confirmation
    /// payload; the first verification must still be confirmed via
    /// `send_2fa_challenge` + `confirm_2fa_setup` before the config goes live.
    ///
    /// `delivery_target` must be provided for SMS (E.164 phone) and Email
    /// (RFC-5322 address). It is ignored for TOTP.
    pub async fn enable_2fa(
        &mut self,
        username: String,
        method: TwoFactorMethod,
        delivery_target: Option<String>,
    ) -> Result<String, String> {
        match method {
            TwoFactorMethod::TOTP => self.enable_totp(username).await,
            TwoFactorMethod::SMS => {
                let phone = delivery_target
                    .ok_or_else(|| "SMS 2FA requires a phone number".to_string())?;
                self.enable_channel(username, TwoFactorMethod::SMS, phone)
                    .await
            }
            TwoFactorMethod::Email => {
                let address = delivery_target
                    .ok_or_else(|| "Email 2FA requires an email address".to_string())?;
                self.enable_channel(username, TwoFactorMethod::Email, address)
                    .await
            }
        }
    }

    /// Shared enrolment path for SMS/Email methods.
    async fn enable_channel(
        &mut self,
        username: String,
        method: TwoFactorMethod,
        delivery_target: String,
    ) -> Result<String, String> {
        let backup_codes = self.generate_backup_codes();
        let config = TwoFactorConfig {
            method: method.clone(),
            secret: String::new(), // no TOTP secret for SMS/Email
            enabled: false,        // user must confirm first code
            backup_codes: backup_codes.clone(),
            created_at: chrono::Utc::now(),
            delivery_target: Some(delivery_target.clone()),
        };
        self.configs.insert(username.clone(), config);
        self.totp_instances.remove(&username);

        let method_label = match method {
            TwoFactorMethod::SMS => "sms",
            TwoFactorMethod::Email => "email",
            TwoFactorMethod::TOTP => "totp",
        };

        Ok(format!(
            r#"{{"method": "{}", "delivery_target": {}, "backup_codes": {}}}"#,
            method_label,
            serde_json::to_string(&delivery_target).map_err(|e| e.to_string())?,
            serde_json::to_string(&backup_codes).map_err(|e| e.to_string())?
        ))
    }

    /// Generates a 6-digit code, stores its SHA-256 hash as a pending
    /// challenge, and delivers it via the channel associated with the user's
    /// 2FA method (Email → SMTP; SMS → Twilio-compatible HTTP API).
    ///
    /// Callers invoke this **after** `enable_2fa`/`confirm_2fa_setup` on every
    /// login that requires SMS/Email 2FA. The returned string echoes the
    /// (redacted) delivery target for UX display.
    pub async fn send_2fa_challenge(&mut self, username: &str) -> Result<String, String> {
        let config = self
            .configs
            .get(username)
            .ok_or_else(|| "2FA not configured for user".to_string())?
            .clone();

        match config.method {
            TwoFactorMethod::TOTP => {
                Err("TOTP does not require a server-sent challenge".to_string())
            }
            TwoFactorMethod::SMS | TwoFactorMethod::Email => {
                let target = config.delivery_target.as_deref().ok_or_else(|| {
                    "2FA delivery target missing; re-run enable_2fa".to_string()
                })?;

                let code = Self::generate_numeric_code();
                let hash = Self::hash_code(&code);
                let challenge = PendingChallenge {
                    code_hash: hash,
                    expires_at: chrono::Utc::now()
                        + chrono::Duration::seconds(CHALLENGE_TTL_SECS),
                    attempts: 0,
                };
                self.pending_challenges
                    .insert(username.to_string(), challenge);

                match config.method {
                    TwoFactorMethod::Email => {
                        deliver_email_code(target, &code).await?;
                    }
                    TwoFactorMethod::SMS => {
                        deliver_sms_code(target, &code).await?;
                    }
                    TwoFactorMethod::TOTP => unreachable!(),
                }

                Ok(redact_target(target))
            }
        }
    }

    /// Generate a cryptographically random 6-digit numeric code.
    fn generate_numeric_code() -> String {
        let mut rng = rand::rngs::OsRng;
        let mut code = String::with_capacity(6);
        for _ in 0..6 {
            code.push(char::from(b'0' + rng.gen_range(0..10) as u8));
        }
        code
    }

    /// SHA-256 hex digest of a 2FA code (constant-time verification later).
    fn hash_code(code: &str) -> String {
        let mut hasher = Sha256::new();
        hasher.update(code.as_bytes());
        hex::encode(hasher.finalize())
    }

    /// Enables TOTP for a user and returns setup information
    pub async fn enable_totp(&mut self, username: String) -> Result<String, String> {
        // Generate a new secret
        let mut secret_bytes = [0u8; 20];
        rand::rngs::OsRng.fill_bytes(&mut secret_bytes);
        let secret = data_encoding::BASE32_NOPAD.encode(&secret_bytes);

        // Decode BASE32 secret to raw bytes
        let secret_bytes = data_encoding::BASE32_NOPAD
            .decode(secret.as_bytes())
            .map_err(|e| format!("Invalid BASE32 secret: {}", e))?;

        // Create TOTP instance
        let totp = TOTP::new(
            Algorithm::SHA1,
            6,  // 6 digits
            1,  // 1 digit step (30 seconds)
            30, // 30 second period
            secret_bytes,
        )
        .map_err(|e| format!("Failed to create TOTP: {}", e))?;

        // Generate QR code URL
        let url = format!(
            "otpauth://totp/SortOfRemote NG:{}?secret={}&issuer=SortOfRemote NG",
            username, secret
        );
        let png_data = render_qr_png(&url)?;

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
            delivery_target: None,
        };

        self.configs.insert(username.clone(), config);
        self.totp_instances.insert(username, totp);

        // Return setup information
        Ok(format!(
            r#"{{"qr_code": "data:image/png;base64,{}", "secret": "{}", "backup_codes": {}}}"#,
            qr_base64,
            secret,
            serde_json::to_string(&backup_codes).map_err(|e| e.to_string())?
        ))
    }

    /// Verifies a 2FA token.
    ///
    /// For TOTP this validates the time-based token. For SMS/Email this
    /// compares the token against the active pending challenge (constant-time
    /// compare, attempt-capped, TTL-enforced, single-use).
    ///
    /// Requires `&mut self` because successful SMS/Email verification consumes
    /// the pending challenge and tracked failed-attempt counters increment.
    pub async fn verify_2fa(&mut self, username: &str, token: &str) -> Result<bool, String> {
        let config = match self.configs.get(username) {
            Some(c) => c.clone(),
            None => return Ok(false),
        };

        if !config.enabled {
            return Ok(false);
        }

        match config.method {
            TwoFactorMethod::TOTP => {
                if let Some(totp) = self.totp_instances.get(username) {
                    let is_valid = totp
                        .check_current(token)
                        .map_err(|e| format!("TOTP verification failed: {}", e))?;
                    Ok(is_valid)
                } else {
                    Err("TOTP instance not found".to_string())
                }
            }
            TwoFactorMethod::SMS | TwoFactorMethod::Email => {
                self.verify_channel_challenge(username, token)
            }
        }
    }

    /// Verify a one-time code against the pending SMS/Email challenge.
    fn verify_channel_challenge(&mut self, username: &str, token: &str) -> Result<bool, String> {
        let challenge = match self.pending_challenges.get_mut(username) {
            Some(c) => c,
            None => return Err("No active 2FA challenge; request a new code".to_string()),
        };

        if chrono::Utc::now() >= challenge.expires_at {
            self.pending_challenges.remove(username);
            return Err("2FA challenge expired; request a new code".to_string());
        }

        challenge.attempts = challenge.attempts.saturating_add(1);
        if challenge.attempts > MAX_CHALLENGE_ATTEMPTS {
            self.pending_challenges.remove(username);
            return Err("Too many attempts; request a new code".to_string());
        }

        let presented = Self::hash_code(token);
        // Constant-time compare over hex digests of equal length.
        let stored = challenge.code_hash.as_bytes();
        let ok = stored.len() == presented.len() && {
            let mut diff = 0u8;
            for (a, b) in stored.iter().zip(presented.as_bytes()) {
                diff |= a ^ b;
            }
            diff == 0
        };

        if ok {
            // Single-use — consume the challenge on success.
            self.pending_challenges.remove(username);
        }
        Ok(ok)
    }

    /// Confirms 2FA setup after successful verification
    pub async fn confirm_2fa_setup(
        &mut self,
        username: String,
        token: String,
    ) -> Result<(), String> {
        let method = self
            .configs
            .get(&username)
            .map(|c| c.method.clone())
            .ok_or_else(|| "2FA not configured for user".to_string())?;

        match method {
            TwoFactorMethod::TOTP => {
                let totp = self
                    .totp_instances
                    .get(&username)
                    .ok_or_else(|| "TOTP instance not found".to_string())?;
                let is_valid = totp
                    .check_current(&token)
                    .map_err(|e| format!("TOTP verification failed: {}", e))?;
                if is_valid {
                    if let Some(config) = self.configs.get_mut(&username) {
                        config.enabled = true;
                    }
                    Ok(())
                } else {
                    Err("Invalid verification token".to_string())
                }
            }
            TwoFactorMethod::SMS | TwoFactorMethod::Email => {
                let valid = self.verify_channel_challenge(&username, &token)?;
                if valid {
                    if let Some(config) = self.configs.get_mut(&username) {
                        config.enabled = true;
                    }
                    Ok(())
                } else {
                    Err("Invalid verification code".to_string())
                }
            }
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
    pub async fn verify_backup_code(
        &mut self,
        username: String,
        code: String,
    ) -> Result<bool, String> {
        if let Some(config) = self.configs.get_mut(&username) {
            // Find matching backup code using constant-time comparison
            let mut found_index: Option<usize> = None;
            for (i, stored_code) in config.backup_codes.iter().enumerate() {
                if stored_code.len() == code.len() {
                    let mut diff = 0u8;
                    for (a, b) in stored_code.bytes().zip(code.bytes()) {
                        diff |= a ^ b;
                    }
                    if diff == 0 {
                        found_index = Some(i);
                        break;
                    }
                }
            }
            if let Some(pos) = found_index {
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
    pub async fn regenerate_backup_codes(
        &mut self,
        username: String,
    ) -> Result<Vec<String>, String> {
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
        self.configs
            .get(username)
            .map(|config| config.enabled)
            .unwrap_or(false)
    }

    /// Gets 2FA status for a user
    pub async fn get_2fa_status(&self, username: &str) -> Option<TwoFactorConfig> {
        self.configs.get(username).cloned()
    }

    /// Generates backup codes
    fn generate_backup_codes(&self) -> Vec<String> {
        let mut rng = rand::thread_rng();
        (0..10)
            .map(|_| (0..8).map(|_| rng.gen_range(0..10).to_string()).collect())
            .collect()
    }
}

// ── SMS / Email delivery helpers ────────────────────────────────────

/// Deliver a 2FA verification code to the given email address using the
/// notification subsystem's SMTP transport. Returns the error string from the
/// notification layer on failure.
async fn deliver_email_code(address: &str, code: &str) -> Result<(), String> {
    // We depend on the notifications crate's SMTP transport to avoid
    // duplicating lettre config handling here. The crate reads SMTP settings
    // from environment variables (see `SmtpConfig::from_env`).
    //
    // If the notifications crate is ever feature-gated out, this call site
    // will need a local fallback; for now the runtime always links it.
    use sorng_notifications::channels::{send_smtp_email, SmtpConfig};

    let config = SmtpConfig::from_env().ok_or_else(|| {
        "SMTP not configured for Email 2FA: set SMTP_HOST (and SMTP_USERNAME/SMTP_PASSWORD/SMTP_FROM as needed)"
            .to_string()
    })?;

    let subject = "Your SortOfRemote NG verification code";
    let body = format!(
        "Your SortOfRemote NG verification code is: {code}\n\n\
        This code expires in 5 minutes. If you did not request it, ignore this email."
    );

    send_smtp_email(&config, &[address.to_string()], &[], &[], subject, &body, false)
        .await
        .map_err(|e| format!("Email 2FA delivery failed: {e}"))
}

/// Deliver a 2FA verification code via a Twilio-compatible HTTP SMS API.
///
/// Required environment variables:
/// - `SMS_API_URL` — full URL of the send-message endpoint. For Twilio this is
///   `https://api.twilio.com/2010-04-01/Accounts/<SID>/Messages.json`.
///   Any Twilio-compatible provider that accepts `From`/`To`/`Body`
///   form-encoded fields and HTTP Basic auth (SID:token) works.
/// - `SMS_API_SID` — account SID / API key (HTTP Basic username).
/// - `SMS_API_TOKEN` — auth token (HTTP Basic password).
/// - `SMS_API_FROM` — sender phone number in E.164 form.
///
/// Returns a concise error if any of these are missing so the caller can
/// surface a useful message instead of silently failing.
async fn deliver_sms_code(phone: &str, code: &str) -> Result<(), String> {
    let url = std::env::var("SMS_API_URL")
        .ok()
        .filter(|s| !s.is_empty())
        .ok_or_else(|| {
            "SMS 2FA unavailable: SMS_API_URL not set. Configure SMS_API_URL, SMS_API_SID, SMS_API_TOKEN, SMS_API_FROM".to_string()
        })?;
    let sid = std::env::var("SMS_API_SID")
        .ok()
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "SMS 2FA unavailable: SMS_API_SID not set".to_string())?;
    let token = std::env::var("SMS_API_TOKEN")
        .ok()
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "SMS 2FA unavailable: SMS_API_TOKEN not set".to_string())?;
    let from = std::env::var("SMS_API_FROM")
        .ok()
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "SMS 2FA unavailable: SMS_API_FROM not set".to_string())?;

    let body = format!(
        "Your SortOfRemote NG verification code is {code}. Expires in 5 minutes."
    );

    let form = [
        ("From", from.as_str()),
        ("To", phone),
        ("Body", body.as_str()),
    ];

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| format!("SMS 2FA: HTTP client init failed: {e}"))?;

    let resp = client
        .post(&url)
        .basic_auth(&sid, Some(&token))
        .form(&form)
        .send()
        .await
        .map_err(|e| format!("SMS 2FA request failed: {e}"))?;

    let status = resp.status();
    if status.is_success() {
        log::info!(
            "SMS 2FA code delivered to {} via {}",
            redact_target(phone),
            url
        );
        Ok(())
    } else {
        let body = resp.text().await.unwrap_or_default();
        Err(format!(
            "SMS 2FA provider returned HTTP {status}: {}",
            body.chars().take(400).collect::<String>()
        ))
    }
}

/// Redact the middle of a phone number or email address for UI display.
fn redact_target(target: &str) -> String {
    if let Some(at) = target.find('@') {
        let (local, domain) = target.split_at(at);
        let masked = if local.len() <= 2 {
            "*".repeat(local.len())
        } else {
            format!(
                "{}{}{}",
                &local[..1],
                "*".repeat(local.len() - 2),
                &local[local.len() - 1..]
            )
        };
        format!("{masked}{domain}")
    } else {
        // Phone: keep last 4
        let len = target.chars().count();
        if len <= 4 {
            "*".repeat(len)
        } else {
            let keep: String = target.chars().skip(len - 4).collect();
            format!("{}{}", "*".repeat(len - 4), keep)
        }
    }
}
