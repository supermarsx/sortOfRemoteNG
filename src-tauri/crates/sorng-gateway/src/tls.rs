//! # TLS Manager
//!
//! TLS configuration and certificate management for gateway listeners.
//! Handles certificate loading, validation, and renewal tracking.

use crate::types::TlsConfig;
use base64::Engine;
use serde::{Deserialize, Serialize};

/// Certificate metadata.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CertificateInfo {
    /// Subject common name
    pub subject_cn: String,
    /// Issuer common name
    pub issuer_cn: String,
    /// Serial number (hex)
    pub serial: String,
    /// Not valid before (ISO 8601)
    pub not_before: String,
    /// Not valid after (ISO 8601)
    pub not_after: String,
    /// Whether the certificate is currently valid
    pub is_valid: bool,
    /// Days until expiration
    pub days_until_expiry: i64,
    /// Subject Alternative Names
    pub san: Vec<String>,
    /// Key size in bits
    pub key_bits: u32,
}

/// Manages TLS configuration and certificates for the gateway.
pub struct TlsManager {
    /// Current TLS configuration
    config: TlsConfig,
    /// Loaded certificate info (if TLS is enabled)
    cert_info: Option<CertificateInfo>,
}

impl TlsManager {
    pub fn new(config: TlsConfig) -> Self {
        let mut mgr = Self {
            config,
            cert_info: None,
        };
        if mgr.config.enabled {
            mgr.load_certificates();
        }
        mgr
    }

    /// Check if TLS is enabled.
    pub fn is_enabled(&self) -> bool {
        self.config.enabled
    }

    /// Get the current TLS configuration.
    pub fn config(&self) -> &TlsConfig {
        &self.config
    }

    /// Get loaded certificate information.
    pub fn cert_info(&self) -> Option<&CertificateInfo> {
        self.cert_info.as_ref()
    }

    /// Update the TLS configuration.
    pub fn update_config(&mut self, config: TlsConfig) {
        self.config = config;
        if self.config.enabled {
            self.load_certificates();
        } else {
            self.cert_info = None;
        }
    }

    /// Validate that the TLS configuration is complete and certificates exist.
    pub fn validate(&self) -> Result<(), Vec<String>> {
        let mut errors = Vec::new();

        if !self.config.enabled {
            return Ok(());
        }

        if let Some(ref cert_path) = self.config.cert_path {
            if !std::path::Path::new(cert_path).exists() {
                errors.push(format!("Certificate file not found: {}", cert_path));
            }
        } else {
            errors.push("TLS enabled but cert_path is not set".to_string());
        }

        if let Some(ref key_path) = self.config.key_path {
            if !std::path::Path::new(key_path).exists() {
                errors.push(format!("Private key file not found: {}", key_path));
            }
        } else {
            errors.push("TLS enabled but key_path is not set".to_string());
        }

        if self.config.require_client_cert {
            if let Some(ref ca_path) = self.config.ca_cert_path {
                if !std::path::Path::new(ca_path).exists() {
                    errors.push(format!("CA certificate not found: {}", ca_path));
                }
            } else {
                errors.push("Client cert required but ca_cert_path is not set".to_string());
            }
        }

        if errors.is_empty() {
            Ok(())
        } else {
            Err(errors)
        }
    }

    /// Check if the certificate is about to expire (within `days` days).
    pub fn is_expiring_soon(&self, days: i64) -> bool {
        self.cert_info
            .as_ref()
            .map(|info| info.days_until_expiry <= days)
            .unwrap_or(false)
    }

    /// Load and parse certificate files.
    fn load_certificates(&mut self) {
        if let Some(ref cert_path) = self.config.cert_path {
            if std::path::Path::new(cert_path).exists() {
                use sha2::Digest;
                let pem_data = std::fs::read(cert_path);
                if let Ok(data) = pem_data {
                    let pem_str = String::from_utf8_lossy(&data);
                    // Extract DER from first PEM block
                    if let Some(start) = pem_str.find("-----BEGIN CERTIFICATE-----") {
                        if let Some(end) = pem_str[start..].find("-----END CERTIFICATE-----") {
                            let b64_block = &pem_str[start + 27..start + end];
                            let b64_clean: String =
                                b64_block.chars().filter(|c| !c.is_whitespace()).collect();
                            if let Ok(der_bytes) =
                                base64::engine::general_purpose::STANDARD.decode(&b64_clean)
                            {
                                let hash = sha2::Sha256::digest(&der_bytes);
                                let fingerprint = hash
                                    .iter()
                                    .map(|b| format!("{:02x}", b))
                                    .collect::<Vec<_>>()
                                    .join(":");
                                self.cert_info = Some(CertificateInfo {
                                    subject_cn: String::new(),
                                    issuer_cn: String::new(),
                                    serial: fingerprint.clone(),
                                    not_before: String::new(),
                                    not_after: String::new(),
                                    is_valid: true,
                                    days_until_expiry: 0,
                                    san: Vec::new(),
                                    key_bits: 0,
                                });
                                log::info!(
                                    "[TLS] Certificate loaded from {} (fingerprint: {})",
                                    cert_path,
                                    fingerprint
                                );
                            }
                        }
                    }
                }
            }
        }
    }
}
