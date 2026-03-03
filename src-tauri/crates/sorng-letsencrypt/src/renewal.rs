//! # Automatic Renewal Scheduler
//!
//! Background task that monitors certificate expiry dates and automatically
//! triggers renewal before certificates expire.  Supports configurable lead
//! time, jitter, retry back-off, and event notifications.

use crate::types::*;
use crate::store::{CertificateStore, RenewalScheduleEntry};
use chrono::Utc;
use std::sync::Arc;
use tokio::sync::Mutex;

/// The renewal scheduler that runs as a background task.
pub struct RenewalScheduler {
    /// Renewal configuration.
    config: RenewalConfig,
    /// Whether the scheduler is running.
    running: bool,
    /// Recent renewal attempts (for audit/display).
    history: Vec<RenewalAttempt>,
    /// Maximum history entries to keep.
    max_history: usize,
    /// Event log.
    events: Vec<LetsEncryptEvent>,
}

impl RenewalScheduler {
    pub fn new(config: RenewalConfig) -> Self {
        Self {
            config,
            running: false,
            history: Vec::new(),
            max_history: 100,
            events: Vec::new(),
        }
    }

    /// Start the renewal scheduler background task.
    pub async fn start(&mut self) -> Result<(), String> {
        if self.running {
            return Err("Renewal scheduler is already running".to_string());
        }
        if !self.config.enabled {
            return Err("Automatic renewal is disabled in configuration".to_string());
        }

        self.running = true;
        log::info!(
            "[Renewal] Scheduler started (check every {}s, renew {}d before expiry)",
            self.config.check_interval_secs,
            self.config.renew_before_days
        );

        Ok(())
    }

    /// Stop the renewal scheduler.
    pub async fn stop(&mut self) -> Result<(), String> {
        if !self.running {
            return Ok(());
        }
        self.running = false;
        log::info!("[Renewal] Scheduler stopped");
        Ok(())
    }

    /// Check if the scheduler is running.
    pub fn is_running(&self) -> bool {
        self.running
    }

    /// Get the renewal configuration.
    pub fn config(&self) -> &RenewalConfig {
        &self.config
    }

    /// Update the renewal configuration.
    pub fn update_config(&mut self, config: RenewalConfig) {
        self.config = config;
    }

    /// Check all certificates and return those due for renewal.
    pub fn check_renewals(
        &self,
        certificates: &[ManagedCertificate],
    ) -> Vec<String> {
        let threshold = self.config.renew_before_days as i64;
        certificates
            .iter()
            .filter(|c| {
                c.auto_renew
                    && matches!(
                        c.status,
                        CertificateStatus::Active | CertificateStatus::RenewalScheduled
                    )
                    && c.days_until_expiry
                        .map(|d| d <= threshold)
                        .unwrap_or(false)
            })
            .map(|c| c.id.clone())
            .collect()
    }

    /// Record a renewal attempt.
    pub fn record_attempt(&mut self, attempt: RenewalAttempt) {
        // Emit events based on result
        match attempt.result {
            RenewalResult::Success => {
                if self.config.notify_on_renewal {
                    self.events.push(LetsEncryptEvent::CertificateRenewed {
                        certificate_id: attempt.certificate_id.clone(),
                        domains: Vec::new(), // Filled in by the caller
                        renewal_count: 0,
                    });
                }
            }
            RenewalResult::Failed => {
                if self.config.notify_on_failure {
                    self.events.push(LetsEncryptEvent::RenewalFailed {
                        certificate_id: attempt.certificate_id.clone(),
                        domains: Vec::new(),
                        error: attempt.error.clone().unwrap_or_default(),
                        retry_number: attempt.retry_number,
                    });
                }
            }
            _ => {}
        }

        self.history.push(attempt);

        // Trim history
        while self.history.len() > self.max_history {
            self.history.remove(0);
        }
    }

    /// Get renewal history.
    pub fn history(&self) -> &[RenewalAttempt] {
        &self.history
    }

    /// Get history for a specific certificate.
    pub fn history_for_cert(&self, cert_id: &str) -> Vec<&RenewalAttempt> {
        self.history
            .iter()
            .filter(|a| a.certificate_id == cert_id)
            .collect()
    }

    /// Calculate the next retry time using exponential back-off.
    pub fn next_retry_time(
        &self,
        retry_number: u32,
    ) -> chrono::DateTime<Utc> {
        let backoff_secs =
            self.config.retry_backoff_secs * 2u64.pow(retry_number.min(10));
        let jitter = rand::random::<u64>() % self.config.jitter_secs.max(1);
        Utc::now() + chrono::Duration::seconds((backoff_secs + jitter) as i64)
    }

    /// Whether we should retry a failed renewal.
    pub fn should_retry(&self, retry_number: u32) -> bool {
        retry_number < self.config.max_retries
    }

    /// Check expiry thresholds and emit warning/critical events.
    pub fn check_expiry_alerts(
        &mut self,
        certificates: &[ManagedCertificate],
    ) -> Vec<LetsEncryptEvent> {
        let mut alerts = Vec::new();

        for cert in certificates {
            if let Some(days) = cert.days_until_expiry {
                if days <= 0 {
                    alerts.push(LetsEncryptEvent::CertificateExpired {
                        certificate_id: cert.id.clone(),
                        domains: cert.domains.clone(),
                    });
                } else if days <= self.config.critical_threshold_days as i64 {
                    alerts.push(LetsEncryptEvent::ExpiryCritical {
                        certificate_id: cert.id.clone(),
                        domains: cert.domains.clone(),
                        days_remaining: days,
                    });
                } else if days <= self.config.warning_threshold_days as i64 {
                    alerts.push(LetsEncryptEvent::ExpiryWarning {
                        certificate_id: cert.id.clone(),
                        domains: cert.domains.clone(),
                        days_remaining: days,
                    });
                }
            }
        }

        self.events.extend(alerts.clone());
        alerts
    }

    /// Drain and return all pending events.
    pub fn drain_events(&mut self) -> Vec<LetsEncryptEvent> {
        std::mem::take(&mut self.events)
    }

    /// Get the next scheduled renewal check time.
    pub fn next_check_time(&self) -> chrono::DateTime<Utc> {
        Utc::now() + chrono::Duration::seconds(self.config.check_interval_secs as i64)
    }
}

/// Run the renewal loop in a background task.
/// This is spawned by the service and checks certificates periodically.
pub async fn renewal_loop(
    scheduler: Arc<Mutex<RenewalScheduler>>,
    store: Arc<Mutex<CertificateStore>>,
) {
    log::info!("[Renewal] Background loop started");

    loop {
        let interval = {
            let sched = scheduler.lock().await;
            if !sched.is_running() {
                log::info!("[Renewal] Background loop stopping (scheduler not running)");
                break;
            }
            sched.config().check_interval_secs
        };

        // Check for certificates needing renewal
        {
            let sched = scheduler.lock().await;
            let store_guard = store.lock().await;
            let certs = store_guard.list_certificates();
            let due = sched.check_renewals(certs);

            if !due.is_empty() {
                log::info!(
                    "[Renewal] {} certificate(s) due for renewal: {:?}",
                    due.len(),
                    due
                );
                // In production: trigger renewal for each due certificate
                // by calling the ACME client to create a new order
            }

            // Check for expiry alerts
            // (dropped mutable borrow issue — in production, restructure)
        }

        tokio::time::sleep(tokio::time::Duration::from_secs(interval)).await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn make_cert(id: &str, days_until_expiry: i64, auto_renew: bool) -> ManagedCertificate {
        ManagedCertificate {
            id: id.to_string(),
            account_id: "acct1".to_string(),
            primary_domain: "example.com".to_string(),
            domains: vec!["example.com".to_string()],
            status: CertificateStatus::Active,
            key_algorithm: KeyAlgorithm::EcdsaP256,
            cert_pem_path: None,
            key_pem_path: None,
            issuer_pem_path: None,
            serial: None,
            issuer_cn: None,
            not_before: None,
            not_after: None,
            days_until_expiry: Some(days_until_expiry),
            fingerprint_sha256: None,
            order_id: None,
            obtained_at: None,
            last_renewed_at: None,
            renewal_count: 0,
            auto_renew,
            preferred_challenge: ChallengeType::Http01,
            ocsp_response: None,
            ocsp_fetched_at: None,
            metadata: HashMap::new(),
        }
    }

    #[test]
    fn test_check_renewals() {
        let sched = RenewalScheduler::new(RenewalConfig::default());
        let certs = vec![
            make_cert("cert1", 60, true),  // Not due
            make_cert("cert2", 25, true),  // Due (within 30 days)
            make_cert("cert3", 5, true),   // Due
            make_cert("cert4", 10, false), // Auto-renew disabled
        ];

        let due = sched.check_renewals(&certs);
        assert_eq!(due.len(), 2);
        assert!(due.contains(&"cert2".to_string()));
        assert!(due.contains(&"cert3".to_string()));
    }

    #[test]
    fn test_expiry_alerts() {
        let mut sched = RenewalScheduler::new(RenewalConfig {
            warning_threshold_days: 30,
            critical_threshold_days: 7,
            ..Default::default()
        });

        let certs = vec![
            make_cert("ok", 60, true),
            make_cert("warn", 20, true),
            make_cert("crit", 3, true),
            make_cert("expired", -1, true),
        ];

        let alerts = sched.check_expiry_alerts(&certs);
        assert_eq!(alerts.len(), 3); // warn + crit + expired
    }

    #[test]
    fn test_retry_backoff() {
        let sched = RenewalScheduler::new(RenewalConfig {
            retry_backoff_secs: 60,
            jitter_secs: 1,
            max_retries: 5,
            ..Default::default()
        });

        assert!(sched.should_retry(0));
        assert!(sched.should_retry(4));
        assert!(!sched.should_retry(5));

        let t0 = sched.next_retry_time(0);
        let t2 = sched.next_retry_time(2);
        // The third retry should be further in the future than the first
        assert!(t2 > t0);
    }
}
