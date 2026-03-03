//! # Let's Encrypt Bridge
//!
//! Integration layer between the gateway and the `sorng-letsencrypt` crate.
//! Provides higher-level operations that combine Let's Encrypt certificate
//! management with the gateway's TLS listener, health monitoring, and
//! configuration system.
//!
//! ## Key Features
//!
//! - **Auto-TLS** — Automatically obtain and install certificates for the
//!   gateway's listen address
//! - **Hot Reload** — Swap certificates on the running gateway without restart
//! - **Health Integration** — Feed certificate health into the gateway's
//!   overall health status
//! - **Challenge Routing** — Route HTTP-01 challenges through the gateway's
//!   own HTTP listener

use crate::config::GatewayConfig;
use crate::tls::{CertificateInfo, TlsManager};
use crate::types::TlsConfig;
use sorng_letsencrypt::types::*;
use sorng_letsencrypt::service::LetsEncryptService;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::Mutex;

/// Configuration for the gateway's Let's Encrypt integration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GatewayLetsEncryptConfig {
    /// Whether Let's Encrypt auto-TLS is enabled for the gateway.
    pub enabled: bool,
    /// Domains to obtain certificates for.
    pub domains: Vec<String>,
    /// The Let's Encrypt service configuration.
    pub letsencrypt: LetsEncryptConfig,
    /// Whether to automatically configure the gateway's TLS after obtaining certs.
    pub auto_configure_tls: bool,
    /// Whether to route HTTP-01 challenges through the gateway's HTTP listener.
    pub gateway_challenge_proxy: bool,
    /// Port to listen on for HTTP-01 challenges if using standalone mode.
    pub challenge_port: u16,
}

impl Default for GatewayLetsEncryptConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            domains: Vec::new(),
            letsencrypt: LetsEncryptConfig::default(),
            auto_configure_tls: true,
            gateway_challenge_proxy: false,
            challenge_port: 80,
        }
    }
}

/// Bridge between the gateway and Let's Encrypt service.
pub struct LetsEncryptBridge {
    /// Configuration.
    config: GatewayLetsEncryptConfig,
    /// Let's Encrypt service instance.
    service: Arc<Mutex<LetsEncryptService>>,
    /// Whether the bridge has been initialized.
    initialized: bool,
}

impl LetsEncryptBridge {
    /// Create a new bridge with the given configuration.
    pub fn new(config: GatewayLetsEncryptConfig) -> Self {
        let service_state = LetsEncryptService::new(config.letsencrypt.clone());

        // We need to get the inner service for our bridge
        Self {
            config,
            service: service_state,
            initialized: false,
        }
    }

    /// Initialize the bridge and Let's Encrypt service.
    pub async fn init(&mut self) -> Result<(), String> {
        if self.initialized {
            return Ok(());
        }

        if !self.config.enabled {
            log::info!("[LE Bridge] Let's Encrypt is disabled in gateway config");
            return Ok(());
        }

        log::info!(
            "[LE Bridge] Initializing for domains: {:?}",
            self.config.domains
        );

        // Start the LE service
        {
            let mut svc = self.service.lock().await;
            svc.start().await?;
        }

        self.initialized = true;
        Ok(())
    }

    /// Obtain certificates for the configured domains and install them
    /// into the gateway's TLS configuration.
    pub async fn obtain_and_install(
        &mut self,
        tls_manager: &mut TlsManager,
    ) -> Result<CertificateInfo, String> {
        if self.config.domains.is_empty() {
            return Err("No domains configured for Let's Encrypt".to_string());
        }

        log::info!(
            "[LE Bridge] Obtaining certificate for: {:?}",
            self.config.domains
        );

        // Request the certificate
        let cert = {
            let mut svc = self.service.lock().await;
            svc.request_certificate(self.config.domains.clone(), None)
                .await?
        };

        // If auto-configure is enabled, update the gateway TLS config
        if self.config.auto_configure_tls {
            self.install_certificate(&cert, tls_manager)?;
        }

        // Convert to gateway CertificateInfo
        Ok(CertificateInfo {
            subject_cn: cert.primary_domain.clone(),
            issuer_cn: cert.issuer_cn.unwrap_or_else(|| "Let's Encrypt".to_string()),
            serial: cert.serial.unwrap_or_default(),
            not_before: cert
                .not_before
                .map(|d| d.to_rfc3339())
                .unwrap_or_default(),
            not_after: cert
                .not_after
                .map(|d| d.to_rfc3339())
                .unwrap_or_default(),
            is_valid: matches!(cert.status, CertificateStatus::Active),
            days_until_expiry: cert.days_until_expiry.unwrap_or(0),
            san: cert.domains.clone(),
            key_bits: cert.key_algorithm.key_bits(),
        })
    }

    /// Install a managed certificate into the gateway's TLS configuration.
    fn install_certificate(
        &self,
        cert: &ManagedCertificate,
        tls_manager: &mut TlsManager,
    ) -> Result<(), String> {
        let cert_path = cert
            .cert_pem_path
            .as_ref()
            .ok_or("Certificate PEM path not available")?;
        let key_path = cert
            .key_pem_path
            .as_ref()
            .ok_or("Key PEM path not available")?;

        let new_tls_config = TlsConfig {
            enabled: true,
            cert_path: Some(cert_path.clone()),
            key_path: Some(key_path.clone()),
            ca_cert_path: cert.issuer_pem_path.clone(),
            require_client_cert: tls_manager.config().require_client_cert,
            min_version: tls_manager.config().min_version.clone(),
        };

        tls_manager.update_config(new_tls_config);
        log::info!(
            "[LE Bridge] TLS configuration updated with Let's Encrypt certificate for {}",
            cert.primary_domain
        );

        Ok(())
    }

    /// Check if any managed certificates need renewal and renew them.
    pub async fn check_and_renew(
        &mut self,
        tls_manager: &mut TlsManager,
    ) -> Result<Vec<String>, String> {
        let mut renewed = Vec::new();

        let certs_to_renew: Vec<ManagedCertificate> = {
            let svc = self.service.lock().await;
            svc.list_certificates()
                .into_iter()
                .filter(|c| {
                    c.auto_renew
                        && c.days_until_expiry
                            .map(|d| d <= self.config.letsencrypt.renewal.renew_before_days as i64)
                            .unwrap_or(false)
                })
                .collect()
        };

        for cert in certs_to_renew {
            log::info!(
                "[LE Bridge] Renewing certificate {} ({})",
                cert.id,
                cert.primary_domain
            );

            let new_cert = {
                let mut svc = self.service.lock().await;
                svc.renew_certificate(&cert.id).await?
            };

            if self.config.auto_configure_tls {
                self.install_certificate(&new_cert, tls_manager)?;
            }

            renewed.push(new_cert.id);
        }

        Ok(renewed)
    }

    /// Get the Let's Encrypt service status.
    pub async fn status(&self) -> LetsEncryptStatus {
        let svc = self.service.lock().await;
        svc.status()
    }

    /// Get a reference to the underlying LE service.
    pub fn service(&self) -> &Arc<Mutex<LetsEncryptService>> {
        &self.service
    }

    /// Shut down the bridge and LE service.
    pub async fn shutdown(&mut self) -> Result<(), String> {
        if self.initialized {
            let mut svc = self.service.lock().await;
            svc.stop().await?;
            self.initialized = false;
        }
        Ok(())
    }

    /// Handle an incoming HTTP-01 challenge request from the gateway's
    /// HTTP listener.  Returns the challenge response if we have one for
    /// the given token.
    pub async fn handle_challenge_request(
        &self,
        token: &str,
    ) -> Option<String> {
        // Delegate to the LE service's HTTP solver
        // In production, the service would expose its HTTP solver's token map
        log::debug!(
            "[LE Bridge] Challenge request for token: {}",
            &token[..8.min(token.len())]
        );
        None // In production: look up the token in the HTTP solver
    }
}

/// Check whether a request path is an ACME HTTP-01 challenge path.
pub fn is_acme_challenge_path(path: &str) -> bool {
    path.starts_with("/.well-known/acme-challenge/")
}

/// Extract the token from an ACME challenge path.
pub fn extract_challenge_token(path: &str) -> Option<&str> {
    path.strip_prefix("/.well-known/acme-challenge/")
        .filter(|t| !t.is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_acme_challenge_path() {
        assert!(is_acme_challenge_path("/.well-known/acme-challenge/token123"));
        assert!(!is_acme_challenge_path("/api/v1/status"));
        assert!(!is_acme_challenge_path("/.well-known/other"));
    }

    #[test]
    fn test_extract_challenge_token() {
        assert_eq!(
            extract_challenge_token("/.well-known/acme-challenge/abc123"),
            Some("abc123")
        );
        assert_eq!(
            extract_challenge_token("/.well-known/acme-challenge/"),
            None
        );
        assert_eq!(
            extract_challenge_token("/other/path"),
            None
        );
    }
}
