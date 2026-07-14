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
use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use chrono::Utc;
use rcgen::{
    Certificate, CertificateParams, DistinguishedName, DnType, SignatureAlgorithm,
    PKCS_ECDSA_P256_SHA256, PKCS_ECDSA_P384_SHA384,
};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

/// Type alias for the service state (Tauri managed-state pattern).
pub type LetsEncryptServiceState = Arc<Mutex<LetsEncryptService>>;

const ACME_CHALLENGE_POLL_ATTEMPTS: u32 = 60;
const ACME_ORDER_POLL_ATTEMPTS: u32 = 60;
const ACME_POLL_INTERVAL_SECS: u64 = 2;

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
    #[allow(dead_code)]
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
        let acme = AcmeClient::new(config.environment, config.custom_directory_url.clone());

        let http_solver = Http01Solver::new(config.http_challenge.clone());

        let dns_solver = config
            .dns_provider
            .as_ref()
            .map(|dns_config| Dns01Solver::new(dns_config.clone()));

        let tls_alpn_solver = TlsAlpn01Solver::new();

        let store = CertificateStore::new(&config.storage_dir);

        let renewal = RenewalScheduler::new(config.renewal.clone());

        let ocsp = OcspManager::new(config.ocsp_stapling, config.ocsp_refresh_interval_secs);

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

        // Start HTTP challenge server if configured.
        if self.config.http_challenge.standalone_server {
            self.http_solver.start_standalone_server().await?;
            self.emit_event(LetsEncryptEvent::ChallengeServerStarted {
                port: self.config.http_challenge.listen_port,
            });
        }

        self.running = true;

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
        self.acme = AcmeClient::new(config.environment, config.custom_directory_url.clone());
        self.http_solver = Http01Solver::new(config.http_challenge.clone());
        self.dns_solver = config
            .dns_provider
            .as_ref()
            .map(|c| Dns01Solver::new(c.clone()));
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

        self.store.init()?;
        self.store.load()?;
        self.acme
            .set_key_algorithm(self.config.account_key_algorithm);
        if self.acme.account_key_pem()?.is_none() {
            self.acme.generate_account_key()?;
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
        if let Some(account_key_pem) = self.acme.account_key_pem()? {
            self.store.save_account_key(&account.id, &account_key_pem)?;
        }

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
        let domains = normalize_domains(domains)?;
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

        if challenge == ChallengeType::Http01
            && self.config.http_challenge.standalone_server
            && !self.http_solver.is_server_running()
        {
            self.http_solver.start_standalone_server().await?;
            self.emit_event(LetsEncryptEvent::ChallengeServerStarted {
                port: self.config.http_challenge.listen_port,
            });
        }

        log::info!(
            "[LetsEncrypt] Requesting certificate for {:?} (challenge: {:?})",
            domains,
            challenge
        );

        let account = self.ensure_account().await?;
        let key_thumbprint = self
            .acme
            .key_thumbprint()
            .ok_or_else(|| "ACME account key thumbprint is not available".to_string())?
            .to_string();

        let order = self.acme.create_order(&domains).await?;
        let order_url = order
            .order_url
            .clone()
            .ok_or_else(|| "ACME order response missing order URL".to_string())?;

        for authz_url in &order.authorization_urls {
            let authz = self.acme.fetch_authorization(authz_url).await?;
            match authz.status {
                AuthorizationStatus::Valid => continue,
                AuthorizationStatus::Pending => {}
                other => {
                    return Err(format!(
                        "ACME authorization for {} is not pending or valid: {:?}",
                        authz.identifier.value, other
                    ));
                }
            }

            let challenge_info = authz
                .challenges
                .iter()
                .find(|candidate| candidate.challenge_type == challenge)
                .cloned()
                .ok_or_else(|| {
                    format!(
                        "ACME authorization for {} does not offer {}",
                        authz.identifier.value,
                        challenge.display_name()
                    )
                })?;

            let domain = authz.identifier.value.clone();
            self.provision_challenge(&domain, &challenge_info, challenge, &key_thumbprint)
                .await?;

            let validation_result = async {
                self.acme.respond_challenge(&challenge_info.url).await?;
                self.wait_for_challenge_valid(&challenge_info.url).await
            }
            .await;

            let cleanup_result = self
                .cleanup_challenge(&domain, &challenge_info, challenge)
                .await;

            if let Err(err) = validation_result {
                self.acme.record_validation_failure(&domain);
                let cleanup_suffix = cleanup_result
                    .err()
                    .map(|cleanup_err| format!("; cleanup also failed: {}", cleanup_err))
                    .unwrap_or_default();
                return Err(format!("{}{}", err, cleanup_suffix));
            }
            cleanup_result?;
        }

        let ready_order = self.wait_for_order_ready(&order_url).await?;
        let (csr_der, private_key_pem) =
            build_certificate_request(&domains, self.config.certificate_key_algorithm)?;
        let finalize_url = ready_order
            .finalize_url
            .clone()
            .ok_or_else(|| "ACME order is ready but missing finalize URL".to_string())?;
        let finalized = self.acme.finalize_order(&finalize_url, &csr_der).await?;
        let poll_url = finalized
            .order_url
            .as_deref()
            .unwrap_or(&order_url)
            .to_string();
        let issued_order = if finalized.status == OrderStatus::Valid {
            finalized
        } else {
            self.wait_for_order_valid(&poll_url).await?
        };
        let certificate_url = issued_order
            .certificate_url
            .clone()
            .ok_or_else(|| "ACME order is valid but missing certificate URL".to_string())?;
        let cert_pem = self.acme.download_certificate(&certificate_url).await?;
        let managed =
            self.build_managed_certificate(&account, &domains, challenge, &issued_order, &cert_pem);
        self.store
            .save_certificate(&managed, &cert_pem, &private_key_pem, None)?;
        for domain in &domains {
            self.acme.record_issuance(domain);
        }

        let stored = self
            .store
            .get_certificate(&managed.id)
            .cloned()
            .unwrap_or(managed);
        self.emit_event(LetsEncryptEvent::CertificateObtained {
            certificate_id: stored.id.clone(),
            domains: stored.domains.clone(),
        });
        Ok(stored)
    }

    /// Renew an existing certificate.
    pub async fn renew_certificate(&mut self, cert_id: &str) -> Result<ManagedCertificate, String> {
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
        self.store.init()?;
        self.store.load()?;

        let cert = self
            .store
            .get_certificate(cert_id)
            .cloned()
            .ok_or_else(|| format!("Certificate not found: {}", cert_id))?;

        let primary_domain = cert.primary_domain.clone();

        log::info!(
            "[LetsEncrypt] Revoking certificate {} ({})",
            cert_id,
            primary_domain
        );

        self.load_account_for_certificate(&cert)?;
        let cert_pem = self.store.load_certificate_pem(cert_id)?;
        let cert_der = first_certificate_der(&cert_pem)?;
        self.acme.revoke_certificate(&cert_der, reason).await?;
        self.store
            .update_certificate_status(cert_id, CertificateStatus::Revoked)?;
        self.emit_event(LetsEncryptEvent::CertificateRevoked {
            certificate_id: cert_id.to_string(),
            domains: cert.domains.clone(),
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
        self.store
            .find_by_domain(domain)
            .into_iter()
            .cloned()
            .collect()
    }

    /// Remove a certificate.
    pub fn remove_certificate(&mut self, cert_id: &str) -> Result<(), String> {
        self.store.remove_certificate(cert_id)
    }

    /// Get certificate file paths (for gateway TLS configuration).
    pub fn get_cert_paths(&self, cert_id: &str) -> Result<(String, String), String> {
        let cert = self
            .store
            .get_certificate(cert_id)
            .ok_or_else(|| format!("Certificate not found: {}", cert_id))?;

        let cert_path = cert
            .cert_pem_path
            .as_ref()
            .ok_or("Certificate PEM path not set")?;
        let key_path = cert.key_pem_path.as_ref().ok_or("Key PEM path not set")?;

        Ok((cert_path.clone(), key_path.clone()))
    }

    fn load_account_into_acme(&mut self, account: &AcmeAccount) -> Result<(), String> {
        let account_url = account
            .account_url
            .clone()
            .ok_or_else(|| format!("ACME account {} is missing its account URL", account.id))?;
        let account_key_pem = self.store.load_account_key(&account.id)?;
        self.acme.load_account_key_pem(&account_key_pem)?;
        if self.acme.key_thumbprint() != Some(account.key_thumbprint.as_str()) {
            return Err(format!(
                "Stored ACME account key does not match account metadata for {}",
                account.id
            ));
        }
        self.acme.set_account_url(Some(account_url));
        Ok(())
    }

    fn load_account_for_certificate(&mut self, cert: &ManagedCertificate) -> Result<(), String> {
        let account = self.store.load_account(&cert.account_id)?;
        self.load_account_into_acme(&account)
    }

    async fn ensure_account(&mut self) -> Result<AcmeAccount, String> {
        self.store.init()?;
        self.store.load()?;

        let candidates: Vec<_> = self
            .store
            .list_accounts()
            .iter()
            .filter(|account| {
                account.environment == self.config.environment
                    && account.custom_directory_url == self.config.custom_directory_url
                    && account.status == AcmeAccountStatus::Valid
                    && account.account_url.is_some()
            })
            .cloned()
            .collect();

        for account in candidates {
            match self.load_account_into_acme(&account) {
                Ok(()) => return Ok(account),
                Err(err) => {
                    log::warn!(
                        "[LetsEncrypt] Skipping stored ACME account {}: {}",
                        account.id,
                        err
                    );
                }
            }
        }

        self.register_account().await
    }

    async fn provision_challenge(
        &mut self,
        domain: &str,
        challenge: &AcmeChallenge,
        challenge_type: ChallengeType,
        key_thumbprint: &str,
    ) -> Result<(), String> {
        let result = match challenge_type {
            ChallengeType::Http01 => {
                self.http_solver
                    .provision(&challenge.token, key_thumbprint)
                    .await?
            }
            ChallengeType::Dns01 => {
                let dns_solver = self.dns_solver.as_mut().ok_or_else(|| {
                    "DNS-01 challenge requires dns_provider configuration".to_string()
                })?;
                let result = dns_solver
                    .provision(domain, &challenge.token, key_thumbprint)
                    .await?;
                if result.provisioned {
                    dns_solver.wait_for_propagation(domain).await?;
                }
                result
            }
            ChallengeType::TlsAlpn01 => {
                self.tls_alpn_solver
                    .provision(domain, &challenge.token, key_thumbprint)
                    .await?
            }
        };

        if result.provisioned {
            Ok(())
        } else {
            Err(result.message)
        }
    }

    async fn cleanup_challenge(
        &mut self,
        domain: &str,
        challenge: &AcmeChallenge,
        challenge_type: ChallengeType,
    ) -> Result<(), String> {
        match challenge_type {
            ChallengeType::Http01 => self.http_solver.cleanup(&challenge.token).await,
            ChallengeType::Dns01 => {
                if let Some(dns_solver) = self.dns_solver.as_mut() {
                    dns_solver.cleanup(domain).await
                } else {
                    Ok(())
                }
            }
            ChallengeType::TlsAlpn01 => self.tls_alpn_solver.cleanup(domain).await,
        }
    }

    async fn wait_for_challenge_valid(&self, challenge_url: &str) -> Result<AcmeChallenge, String> {
        for attempt in 0..ACME_CHALLENGE_POLL_ATTEMPTS {
            let challenge = self.acme.poll_challenge(challenge_url).await?;
            match challenge.status {
                ChallengeStatus::Valid => return Ok(challenge),
                ChallengeStatus::Invalid => {
                    return Err(format!(
                        "ACME challenge failed at {}: {:?}",
                        challenge_url, challenge.error
                    ));
                }
                ChallengeStatus::Pending | ChallengeStatus::Processing => {
                    if attempt + 1 == ACME_CHALLENGE_POLL_ATTEMPTS {
                        break;
                    }
                    tokio::time::sleep(tokio::time::Duration::from_secs(ACME_POLL_INTERVAL_SECS))
                        .await;
                }
            }
        }

        Err(format!(
            "Timed out waiting for ACME challenge validation at {}",
            challenge_url
        ))
    }

    async fn wait_for_order_ready(&mut self, order_url: &str) -> Result<AcmeOrder, String> {
        for attempt in 0..ACME_ORDER_POLL_ATTEMPTS {
            let order = self.acme.poll_order(order_url).await?;
            match order.status {
                OrderStatus::Ready => return Ok(order),
                OrderStatus::Valid => {
                    return Err(
                        "ACME order became valid before local CSR finalization; refusing to store a certificate without its locally generated private key"
                            .to_string(),
                    );
                }
                OrderStatus::Invalid => {
                    return Err(format!(
                        "ACME order failed at {}: {:?}",
                        order_url, order.error
                    ));
                }
                OrderStatus::Pending | OrderStatus::Processing => {
                    if attempt + 1 == ACME_ORDER_POLL_ATTEMPTS {
                        break;
                    }
                    tokio::time::sleep(tokio::time::Duration::from_secs(ACME_POLL_INTERVAL_SECS))
                        .await;
                }
            }
        }

        Err(format!(
            "Timed out waiting for ACME order readiness at {}",
            order_url
        ))
    }

    async fn wait_for_order_valid(&mut self, order_url: &str) -> Result<AcmeOrder, String> {
        for attempt in 0..ACME_ORDER_POLL_ATTEMPTS {
            let order = self.acme.poll_order(order_url).await?;
            match order.status {
                OrderStatus::Valid => return Ok(order),
                OrderStatus::Invalid => {
                    return Err(format!(
                        "ACME order failed at {}: {:?}",
                        order_url, order.error
                    ));
                }
                OrderStatus::Pending | OrderStatus::Ready | OrderStatus::Processing => {
                    if attempt + 1 == ACME_ORDER_POLL_ATTEMPTS {
                        break;
                    }
                    tokio::time::sleep(tokio::time::Duration::from_secs(ACME_POLL_INTERVAL_SECS))
                        .await;
                }
            }
        }

        Err(format!(
            "Timed out waiting for ACME order issuance at {}",
            order_url
        ))
    }

    fn build_managed_certificate(
        &self,
        account: &AcmeAccount,
        domains: &[String],
        challenge: ChallengeType,
        order: &AcmeOrder,
        cert_pem: &str,
    ) -> ManagedCertificate {
        let now = Utc::now();
        let mut metadata = HashMap::new();
        if let Some(order_url) = &order.order_url {
            metadata.insert("acme_order_url".to_string(), order_url.clone());
        }
        if let Some(certificate_url) = &order.certificate_url {
            metadata.insert("acme_certificate_url".to_string(), certificate_url.clone());
        }
        if let Some(account_url) = &account.account_url {
            metadata.insert("acme_account_url".to_string(), account_url.clone());
        }

        ManagedCertificate {
            id: uuid::Uuid::new_v4().to_string(),
            account_id: account.id.clone(),
            primary_domain: domains[0].clone(),
            domains: domains.to_vec(),
            status: CertificateStatus::Active,
            key_algorithm: self.config.certificate_key_algorithm,
            cert_pem_path: None,
            key_pem_path: None,
            issuer_pem_path: None,
            serial: None,
            issuer_cn: None,
            not_before: order.not_before,
            not_after: order.not_after,
            days_until_expiry: order
                .not_after
                .map(|not_after| not_after.signed_duration_since(now).num_days()),
            fingerprint_sha256: certificate_fingerprint_sha256(cert_pem).ok(),
            order_id: Some(order.id.clone()),
            obtained_at: Some(now),
            last_renewed_at: None,
            renewal_count: 0,
            auto_renew: true,
            preferred_challenge: challenge,
            ocsp_response: None,
            ocsp_fetched_at: None,
            metadata,
        }
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
            .filter(|c| {
                matches!(
                    c.status,
                    CertificateStatus::RenewalScheduled | CertificateStatus::Renewing
                )
            })
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

fn normalize_domains(domains: Vec<String>) -> Result<Vec<String>, String> {
    let mut normalized = Vec::new();
    for domain in domains {
        let domain = domain.trim().trim_end_matches('.').to_ascii_lowercase();
        if domain.is_empty() {
            return Err("Domain names must not be empty".to_string());
        }
        if domain.contains("://")
            || domain.contains('/')
            || domain.contains(':')
            || domain.chars().any(char::is_whitespace)
        {
            return Err(format!("Invalid ACME domain name: {}", domain));
        }

        let dns_name = domain.strip_prefix("*.").unwrap_or(&domain);
        if dns_name.is_empty()
            || dns_name.starts_with('.')
            || dns_name.ends_with('.')
            || dns_name.split('.').any(str::is_empty)
        {
            return Err(format!("Invalid ACME DNS identifier: {}", domain));
        }

        if !normalized.contains(&domain) {
            normalized.push(domain);
        }
    }

    if normalized.is_empty() {
        return Err("At least one domain is required".to_string());
    }

    Ok(normalized)
}

fn build_certificate_request(
    domains: &[String],
    key_algorithm: KeyAlgorithm,
) -> Result<(Vec<u8>, String), String> {
    let primary_domain = domains
        .first()
        .ok_or_else(|| "At least one domain is required for CSR generation".to_string())?;
    let mut params = CertificateParams::new(domains.to_vec());
    params.alg = certificate_signature_algorithm(key_algorithm)?;
    params.distinguished_name = DistinguishedName::new();
    params
        .distinguished_name
        .push(DnType::CommonName, primary_domain.as_str());

    let certificate = Certificate::from_params(params)
        .map_err(|e| format!("Failed to generate certificate key pair: {}", e))?;
    let csr_der = certificate
        .serialize_request_der()
        .map_err(|e| format!("Failed to serialize certificate request: {}", e))?;
    Ok((csr_der, certificate.serialize_private_key_pem()))
}

fn certificate_signature_algorithm(
    key_algorithm: KeyAlgorithm,
) -> Result<&'static SignatureAlgorithm, String> {
    match key_algorithm {
        KeyAlgorithm::EcdsaP256 => Ok(&PKCS_ECDSA_P256_SHA256),
        KeyAlgorithm::EcdsaP384 => Ok(&PKCS_ECDSA_P384_SHA384),
        other => Err(format!(
            "Certificate key algorithm {} is unsupported for generated ACME CSRs: rcgen 0.12 cannot generate new RSA keys with the ring backend; choose ECDSA P-256 or P-384",
            other.display_name()
        )),
    }
}

fn first_certificate_der(pem: &str) -> Result<Vec<u8>, String> {
    const BEGIN: &str = "-----BEGIN CERTIFICATE-----";
    const END: &str = "-----END CERTIFICATE-----";

    let begin = pem
        .find(BEGIN)
        .ok_or_else(|| "Certificate PEM does not contain a certificate block".to_string())?;
    let after_begin = &pem[begin + BEGIN.len()..];
    let end = after_begin
        .find(END)
        .ok_or_else(|| "Certificate PEM block is missing its END marker".to_string())?;
    let body = &after_begin[..end];
    let base64_body: String = body.lines().map(str::trim).collect();
    STANDARD
        .decode(base64_body.as_bytes())
        .map_err(|e| format!("Failed to decode certificate PEM: {}", e))
}

fn certificate_fingerprint_sha256(pem: &str) -> Result<String, String> {
    let der = first_certificate_der(pem)?;
    Ok(hex_lower(&Sha256::digest(&der)))
}

fn hex_lower(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut encoded = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        encoded.push(HEX[(byte >> 4) as usize] as char);
        encoded.push(HEX[(byte & 0x0f) as usize] as char);
    }
    encoded
}

#[cfg(test)]
mod service_tests {
    use super::*;

    #[test]
    fn normalize_domains_deduplicates_and_preserves_wildcard() {
        let domains = normalize_domains(vec![
            " Example.COM. ".to_string(),
            "example.com".to_string(),
            "*.Example.COM.".to_string(),
        ])
        .unwrap();

        assert_eq!(domains, vec!["example.com", "*.example.com"]);
    }

    #[test]
    fn build_certificate_request_generates_csr_and_private_key() {
        let (csr_der, key_pem) =
            build_certificate_request(&["example.com".to_string()], KeyAlgorithm::EcdsaP256)
                .unwrap();

        assert!(!csr_der.is_empty());
        assert!(key_pem.contains("BEGIN PRIVATE KEY"));
    }

    #[test]
    fn first_certificate_der_decodes_pem_block() {
        let der = vec![0x30, 0x03, 0x01, 0x02, 0x03];
        let pem = format!(
            "-----BEGIN CERTIFICATE-----\n{}\n-----END CERTIFICATE-----\n",
            STANDARD.encode(&der)
        );

        assert_eq!(first_certificate_der(&pem).unwrap(), der);
    }
}
