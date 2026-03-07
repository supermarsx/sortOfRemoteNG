//! # Let's Encrypt Service
//!
//! Top-level orchestrator that ties together the ACME client, challenge
//! solvers, certificate store, renewal scheduler, OCSP manager, and
//! certificate monitor into a single cohesive service.

use crate::acme::AcmeClient;
use crate::challenges::{Dns01Solver, Http01Solver, TlsAlpn01Solver};
use crate::monitor::CertificateMonitor;
use crate::ocsp::OcspManager;
use crate::renewal::RenewalScheduler;
use crate::store::CertificateStore;
use crate::types::*;
use chrono::Utc;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

/// Type alias for the service state (Tauri managed-state pattern).
pub type LetsEncryptServiceState = Arc<Mutex<LetsEncryptService>>;

/// The top-level Let's Encrypt service.
pub struct LetsEncryptService {
    /// Service configuration.
    config: LetsEncryptConfig,
    /// ACME client.
    acme: AcmeClient,
    /// HTTP-01 challenge solver.
    http_solver: Http01Solver,
    /// DNS-01 challenge solver.
    dns_solver: Option<Dns01Solver>,
    /// TLS-ALPN-01 challenge solver.
    tls_alpn_solver: TlsAlpn01Solver,
    /// Certificate store (on-disk persistence).
    store: CertificateStore,
    /// Renewal scheduler.
    renewal: RenewalScheduler,
    /// OCSP manager.
    ocsp: OcspManager,
    /// Certificate health monitor.
    monitor: CertificateMonitor,
    /// Whether the service is running.
    running: bool,
    /// Event history (last N events for the UI).
    events: Vec<LetsEncryptEvent>,
    /// Maximum events to keep.
    max_events: usize,
}

impl LetsEncryptService {
    /// Create a new Let's Encrypt service with the given configuration.
    pub fn new(config: LetsEncryptConfig) -> LetsEncryptServiceState {
        let acme = AcmeClient::new(
            config.environment,
            config.custom_directory_url.clone(),
        );

        let http_solver = Http01Solver::new(config.http_challenge.clone());

        let dns_solver = config.dns_provider.as_ref().map(|dns_config| {
            Dns01Solver::new(dns_config.clone())
        });

        let tls_alpn_solver = TlsAlpn01Solver::new();

        let store = CertificateStore::new(&config.storage_dir);

        let renewal = RenewalScheduler::new(config.renewal.clone());

        let ocsp = OcspManager::new(
            config.ocsp_stapling,
            config.ocsp_refresh_interval_secs,
        );

        let monitor = CertificateMonitor::new(
            config.renewal.warning_threshold_days as i64,
            config.renewal.critical_threshold_days as i64,
        );

        let service = LetsEncryptService {
            config,
            acme,
            http_solver,
            dns_solver,
            tls_alpn_solver,
            store,
            renewal,
            ocsp,
            monitor,
            running: false,
            events: Vec::new(),
            max_events: 200,
        };

        Arc::new(Mutex::new(service))
    }

    /// Create with default settings.
    pub fn new_default(storage_dir: &str) -> LetsEncryptServiceState {
        let config = LetsEncryptConfig {
            storage_dir: storage_dir.to_string(),
            ..Default::default()
        };
        Self::new(config)
    }

    // ── Service Lifecycle ───────────────────────────────────────────

    /// Initialize and start the service.
    pub async fn start(&mut self) -> Result<(), String> {
        if self.running {
            return Err("Let's Encrypt service is already running".to_string());
        }

        log::info!(
            "[LetsEncrypt] Starting service (env: {:?})",
            self.config.environment
        );

        // Initialize storage
        self.store.init()?;
        self.store.load()?;

        // Fetch ACME directory
        self.acme.fetch_directory().await?;

        // Start renewal scheduler
        if self.config.renewal.enabled {
            self.renewal.start().await?;
        }

        // Start HTTP challenge server if configured
        if self.config.http_challenge.standalone_server {
            // In production: start the standalone server
            log::info!("[LetsEncrypt] HTTP-01 standalone server would start");
        }

        self.running = true;
        self.emit_event(LetsEncryptEvent::ChallengeServerStarted {
            port: self.config.http_challenge.listen_port,
        });

        Ok(())
    }

    /// Stop the service.
    pub async fn stop(&mut self) -> Result<(), String> {
        if !self.running {
            return Ok(());
        }

        log::info!("[LetsEncrypt] Stopping service");

        self.renewal.stop().await?;
        self.http_solver.stop_standalone_server().await?;
        self.store.save()?;

        self.running = false;
        self.emit_event(LetsEncryptEvent::ChallengeServerStopped);

        Ok(())
    }

    /// Check if the service is running.
    pub fn is_running(&self) -> bool {
        self.running
    }

    /// Get the current configuration.
    pub fn config(&self) -> &LetsEncryptConfig {
        &self.config
    }

    /// Update configuration (restarts affected components).
    pub async fn update_config(&mut self, config: LetsEncryptConfig) -> Result<(), String> {
        let was_running = self.running;
        if was_running {
            self.stop().await?;
        }

        self.config = config.clone();
        self.acme = AcmeClient::new(
            config.environment,
            config.custom_directory_url.clone(),
        );
        self.http_solver = Http01Solver::new(config.http_challenge.clone());
        self.dns_solver = config.dns_provider.as_ref().map(|c| Dns01Solver::new(c.clone()));
        self.renewal.update_config(config.renewal.clone());

        if was_running {
            self.start().await?;
        }

        Ok(())
    }

    // ── Account Management ──────────────────────────────────────────

    /// Register or look up an ACME account.
    pub async fn register_account(&mut self) -> Result<AcmeAccount, String> {
        if self.config.contact_email.is_empty() {
            return Err("Contact email is required for account registration".to_string());
        }

        let mut contacts = vec![format!("mailto:{}", self.config.contact_email)];
        for email in &self.config.additional_contacts {
            contacts.push(format!("mailto:{}", email));
        }

        let account = self
            .acme
            .register_account(
                &contacts,
                self.config.agree_tos,
                self.config.eab_key_id.as_deref(),
                self.config.eab_hmac_key.as_deref(),
            )
            .await?;

        self.store.save_account(&account)?;

        log::info!("[LetsEncrypt] Account registered: {}", account.id);
        Ok(account)
    }

    /// List registered accounts.
    pub fn list_accounts(&self) -> Vec<AcmeAccount> {
        self.store.list_accounts().to_vec()
    }

    /// Remove an account.
    pub async fn remove_account(&mut self, account_id: &str) -> Result<(), String> {
        self.store.remove_account(account_id)
    }

    // ── Certificate Operations ──────────────────────────────────────

    /// Request a new certificate for the given domains.
    pub async fn request_certificate(
        &mut self,
        domains: Vec<String>,
        challenge_type: Option<ChallengeType>,
    ) -> Result<ManagedCertificate, String> {
        if domains.is_empty() {
            return Err("At least one domain is required".to_string());
        }

        let challenge = challenge_type.unwrap_or(self.config.preferred_challenge);

        // Check for wildcard + HTTP-01 incompatibility
        let has_wildcard = domains.iter().any(|d| d.starts_with("*."));
        if has_wildcard && challenge == ChallengeType::Http01 {
            return Err(
                "Wildcard domains require DNS-01 challenge (HTTP-01 is not supported)".to_string(),
            );
        }

        log::info!(
            "[LetsEncrypt] Requesting certificate for {:?} (challenge: {:?})",
            domains,
            challenge
        );

        // 1. Create the ACME order
        let order = self.acme.create_order(&domains).await?;

        // 2. Fetch authorizations and solve challenges
        for authz_url in &order.authorization_urls {
            let authz = self.acme.fetch_authorization(authz_url).await?;

            // Find the challenge matching the requested type
            let acme_challenge = authz
                .challenges
                .iter()
                .find(|c| c.challenge_type == challenge)
                .ok_or_else(|| {
                    format!(
                        "Challenge type {:?} not available for {}",
                        challenge, authz.identifier.value
                    )
                })?;

            let thumbprint = self
                .acme
                .key_thumbprint()
                .unwrap_or("placeholder")
                .to_string();

            // Provision the challenge
            match challenge {
                ChallengeType::Http01 => {
                    self.http_solver
                        .provision(&acme_challenge.token, &thumbprint)
                        .await?;
                }
                ChallengeType::Dns01 => {
                    if let Some(ref mut dns) = self.dns_solver {
                        dns.provision(
                            &authz.identifier.value,
                            &acme_challenge.token,
                            &thumbprint,
                        )
                        .await?;
                        dns.wait_for_propagation(&authz.identifier.value)
                            .await?;
                    } else {
                        return Err("DNS-01 selected but no DNS provider configured".to_string());
                    }
                }
                ChallengeType::TlsAlpn01 => {
                    self.tls_alpn_solver
                        .provision(
                            &authz.identifier.value,
                            &acme_challenge.token,
                            &thumbprint,
                        )
                        .await?;
                }
            }

            // Tell the CA we're ready
            self.acme.respond_challenge(&acme_challenge.url).await?;
        }

        // 3. Generate CSR and finalize
        // In production: use ring/rcgen to create a CSR
        let csr_der = b"placeholder-csr";

        if let Some(ref finalize_url) = order.finalize_url {
            self.acme.finalize_order(finalize_url, csr_der).await?;
        }

        // 4. Download the certificate
        let cert_pem = if let Some(ref cert_url) = order.certificate_url {
            self.acme.download_certificate(cert_url).await?
        } else {
            "(certificate would be downloaded here)".to_string()
        };

        // 5. Create the managed certificate record
        let cert_id = uuid::Uuid::new_v4().to_string();
        let cert = ManagedCertificate {
            id: cert_id.clone(),
            account_id: order.account_id,
            primary_domain: domains[0].clone(),
            domains: domains.clone(),
            status: CertificateStatus::Active,
            key_algorithm: self.config.certificate_key_algorithm,
            cert_pem_path: None,
            key_pem_path: None,
            issuer_pem_path: None,
            serial: Some("placeholder-serial".to_string()),
            issuer_cn: Some("Let's Encrypt".to_string()),
            not_before: Some(Utc::now()),
            not_after: Some(Utc::now() + chrono::Duration::days(90)),
            days_until_expiry: Some(90),
            fingerprint_sha256: Some("placeholder-fingerprint".to_string()),
            order_id: Some(order.id),
            obtained_at: Some(Utc::now()),
            last_renewed_at: None,
            renewal_count: 0,
            auto_renew: true,
            preferred_challenge: challenge,
            ocsp_response: None,
            ocsp_fetched_at: None,
            metadata: HashMap::new(),
        };

        // 6. Save to disk
        self.store
            .save_certificate(&cert, &cert_pem, "placeholder-key-pem", None)?;

        // 7. Clean up challenges
        for authz_url in &order.authorization_urls {
            if let Ok(authz) = self.acme.fetch_authorization(authz_url).await {
                for ch in &authz.challenges {
                    match ch.challenge_type {
                        ChallengeType::Http01 => {
                            let _ = self.http_solver.cleanup(&ch.token).await;
                        }
                        ChallengeType::Dns01 => {
                            if let Some(ref mut dns) = self.dns_solver {
                                let _ = dns.cleanup(&authz.identifier.value).await;
                            }
                        }
                        ChallengeType::TlsAlpn01 => {
                            let _ = self
                                .tls_alpn_solver
                                .cleanup(&authz.identifier.value)
                                .await;
                        }
                    }
                }
            }
        }

        // Record issuance for rate limiting
        for domain in &domains {
            self.acme.record_issuance(domain);
        }

        self.emit_event(LetsEncryptEvent::CertificateObtained {
            certificate_id: cert_id.clone(),
            domains: domains.clone(),
        });

        log::info!(
            "[LetsEncrypt] Certificate obtained: {} for {:?}",
            cert_id,
            domains
        );

        Ok(cert)
    }

    /// Renew an existing certificate.
    pub async fn renew_certificate(
        &mut self,
        cert_id: &str,
    ) -> Result<ManagedCertificate, String> {
        let existing = self
            .store
            .get_certificate(cert_id)
            .cloned()
            .ok_or_else(|| format!("Certificate not found: {}", cert_id))?;

        log::info!(
            "[LetsEncrypt] Renewing certificate {} ({})",
            cert_id,
            existing.primary_domain
        );

        self.store
            .update_certificate_status(cert_id, CertificateStatus::Renewing)?;

        let attempt_id = uuid::Uuid::new_v4().to_string();
        let attempt_start = Utc::now();

        match self
            .request_certificate(existing.domains.clone(), Some(existing.preferred_challenge))
            .await
        {
            Ok(mut new_cert) => {
                new_cert.renewal_count = existing.renewal_count + 1;
                new_cert.last_renewed_at = Some(Utc::now());

                // Record success
                self.renewal.record_attempt(RenewalAttempt {
                    id: attempt_id,
                    certificate_id: cert_id.to_string(),
                    started_at: attempt_start,
                    completed_at: Some(Utc::now()),
                    result: RenewalResult::Success,
                    error: None,
                    retry_number: 0,
                    new_certificate_id: Some(new_cert.id.clone()),
                });

                self.emit_event(LetsEncryptEvent::CertificateRenewed {
                    certificate_id: new_cert.id.clone(),
                    domains: new_cert.domains.clone(),
                    renewal_count: new_cert.renewal_count,
                });

                Ok(new_cert)
            }
            Err(err) => {
                self.store
                    .update_certificate_status(cert_id, CertificateStatus::Active)?;

                self.renewal.record_attempt(RenewalAttempt {
                    id: attempt_id,
                    certificate_id: cert_id.to_string(),
                    started_at: attempt_start,
                    completed_at: Some(Utc::now()),
                    result: RenewalResult::Failed,
                    error: Some(err.clone()),
                    retry_number: 0,
                    new_certificate_id: None,
                });

                Err(err)
            }
        }
    }

    /// Revoke a certificate.
    pub async fn revoke_certificate(
        &mut self,
        cert_id: &str,
        reason: Option<u8>,
    ) -> Result<(), String> {
        let cert = self
            .store
            .get_certificate(cert_id)
            .ok_or_else(|| format!("Certificate not found: {}", cert_id))?;

        let primary_domain = cert.primary_domain.clone();
        let domains = cert.domains.clone();

        log::info!(
            "[LetsEncrypt] Revoking certificate {} ({})",
            cert_id,
            primary_domain
        );

        // In production: load the certificate DER and send revocation request
        let cert_der = b"placeholder-cert-der";
        self.acme.revoke_certificate(cert_der, reason).await?;

        self.store
            .update_certificate_status(cert_id, CertificateStatus::Revoked)?;

        self.emit_event(LetsEncryptEvent::CertificateRevoked {
            certificate_id: cert_id.to_string(),
            domains,
        });

        Ok(())
    }

    /// List all managed certificates.
    pub fn list_certificates(&self) -> Vec<ManagedCertificate> {
        self.store.list_certificates().to_vec()
    }

    /// Get a certificate by ID.
    pub fn get_certificate(&self, cert_id: &str) -> Option<ManagedCertificate> {
        self.store.get_certificate(cert_id).cloned()
    }

    /// Find certificates by domain.
    pub fn find_certificates_by_domain(&self, domain: &str) -> Vec<ManagedCertificate> {
        self.store.find_by_domain(domain).into_iter().cloned().collect()
    }

    /// Remove a certificate.
    pub fn remove_certificate(&mut self, cert_id: &str) -> Result<(), String> {
        self.store.remove_certificate(cert_id)
    }

    /// Get certificate file paths (for gateway TLS configuration).
    pub fn get_cert_paths(
        &self,
        cert_id: &str,
    ) -> Result<(String, String), String> {
        let cert = self
            .store
            .get_certificate(cert_id)
            .ok_or_else(|| format!("Certificate not found: {}", cert_id))?;

        let cert_path = cert
            .cert_pem_path
            .as_ref()
            .ok_or("Certificate PEM path not set")?;
        let key_path = cert
            .key_pem_path
            .as_ref()
            .ok_or("Key PEM path not set")?;

        Ok((cert_path.clone(), key_path.clone()))
    }

    // ── Health & Status ─────────────────────────────────────────────

    /// Get the overall service status.
    pub fn status(&self) -> LetsEncryptStatus {
        let certs = self.store.list_certificates();
        let active = certs
            .iter()
            .filter(|c| matches!(c.status, CertificateStatus::Active))
            .count();
        let pending = certs
            .iter()
            .filter(|c| matches!(c.status, CertificateStatus::RenewalScheduled | CertificateStatus::Renewing))
            .count();
        let expired = certs
            .iter()
            .filter(|c| matches!(c.status, CertificateStatus::Expired))
            .count();

        LetsEncryptStatus {
            enabled: self.config.enabled,
            running: self.running,
            environment: self.config.environment.display_name().to_string(),
            total_certificates: certs.len() as u32,
            active_certificates: active as u32,
            pending_renewal: pending as u32,
            expired_certificates: expired as u32,
            recent_events: self.events.iter().rev().take(20).cloned().collect(),
            next_renewal_check: if self.renewal.is_running() {
                Some(self.renewal.next_check_time())
            } else {
                None
            },
            challenge_server_running: self.http_solver.is_server_running(),
        }
    }

    /// Run certificate health checks.
    pub fn health_check(&mut self) -> crate::monitor::CertificateHealthSummary {
        let certs = self.store.list_certificates().to_vec();
        self.monitor.check_all(&certs)
    }

    /// Check if any certificates have critical issues.
    pub fn has_critical_issues(&self) -> bool {
        self.monitor.has_critical_issues()
    }

    // ── OCSP ────────────────────────────────────────────────────────

    /// Fetch OCSP response for a certificate.
    pub async fn fetch_ocsp(&mut self, cert_id: &str) -> Result<OcspStatus, String> {
        self.ocsp
            .fetch_response(cert_id, "http://ocsp.letsencrypt.org/")
            .await
    }

    /// Get cached OCSP status.
    pub fn get_ocsp_status(&self, cert_id: &str) -> Option<OcspStatus> {
        self.ocsp.get_status(cert_id)
    }

    // ── Events ──────────────────────────────────────────────────────

    /// Emit an event and add it to the history.
    fn emit_event(&mut self, event: LetsEncryptEvent) {
        log::info!("[LetsEncrypt] Event: {:?}", event);
        self.events.push(event);
        while self.events.len() > self.max_events {
            self.events.remove(0);
        }
    }

    /// Get recent events.
    pub fn recent_events(&self, count: usize) -> Vec<&LetsEncryptEvent> {
        self.events.iter().rev().take(count).collect()
    }

    /// Drain pending events (for Tauri event emission).
    pub fn drain_events(&mut self) -> Vec<LetsEncryptEvent> {
        let renewal_events = self.renewal.drain_events();
        self.events.extend(renewal_events.clone());
        renewal_events
    }

    // ── Rate Limits ─────────────────────────────────────────────────

    /// Check rate limit status for a domain.
    pub fn check_rate_limit(&self, domain: &str) -> Option<RateLimitInfo> {
        self.acme.check_rate_limit(domain).cloned()
    }

    /// Check if a domain is rate-limited.
    pub fn is_rate_limited(&self, domain: &str) -> bool {
        self.acme.is_rate_limited(domain)
    }
}
