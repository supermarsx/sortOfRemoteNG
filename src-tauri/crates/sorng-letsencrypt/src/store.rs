//! # Certificate Store
//!
//! Encrypted on-disk persistence for ACME accounts, certificates, and private
//! keys.  Supports atomic writes, backup rotation, and key-per-domain storage
//! layout.
//!
//! ## Directory Layout
//!
//! ```text
//! <storage_dir>/
//! ├── accounts/
//! │   └── <account_id>/
//! │       ├── account.json       # Account metadata
//! │       └── account_key.pem    # Account private key (encrypted)
//! ├── certificates/
//! │   └── <cert_id>/
//! │       ├── cert.pem           # Full-chain certificate
//! │       ├── key.pem            # Certificate private key (encrypted)
//! │       ├── issuer.pem         # Intermediate CA certificate
//! │       ├── meta.json          # Certificate metadata
//! │       └── ocsp.der           # Cached OCSP response
//! ├── challenges/
//! │   └── <token>                # HTTP-01 challenge responses (transient)
//! ├── backups/
//! │   └── <timestamp>/           # Timestamped backups before renewal
//! └── state.json                 # Service state (active certs, renewal schedule)
//! ```

use crate::types::*;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

/// Persistent state saved to disk.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServiceState {
    /// Active ACME accounts.
    pub accounts: Vec<AcmeAccount>,
    /// Managed certificates.
    pub certificates: Vec<ManagedCertificate>,
    /// Renewal schedule entries.
    pub renewal_schedule: Vec<RenewalScheduleEntry>,
    /// Rate limit state per domain.
    pub rate_limits: HashMap<String, RateLimitInfo>,
    /// Last state save timestamp.
    pub last_saved: chrono::DateTime<Utc>,
}

/// A scheduled renewal entry.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RenewalScheduleEntry {
    /// Certificate ID.
    pub certificate_id: String,
    /// Scheduled renewal date.
    pub scheduled_at: chrono::DateTime<Utc>,
    /// Retry count for current attempt.
    pub retry_count: u32,
    /// Last attempt result.
    pub last_result: Option<RenewalResult>,
    /// Last error message.
    pub last_error: Option<String>,
}

/// Manages all on-disk storage for the Let's Encrypt service.
pub struct CertificateStore {
    /// Root storage directory.
    base_dir: PathBuf,
    /// Number of backup generations to keep.
    max_backups: usize,
    /// In-memory state (synced to disk).
    state: ServiceState,
}

impl CertificateStore {
    /// Create a new certificate store at the given directory.
    pub fn new(base_dir: &str) -> Self {
        let base = PathBuf::from(base_dir);

        let state = ServiceState {
            accounts: Vec::new(),
            certificates: Vec::new(),
            renewal_schedule: Vec::new(),
            rate_limits: HashMap::new(),
            last_saved: Utc::now(),
        };

        Self {
            base_dir: base,
            max_backups: 10,
            state,
        }
    }

    /// Initialize the storage directories.
    pub fn init(&self) -> Result<(), String> {
        let dirs = [
            self.base_dir.join("accounts"),
            self.base_dir.join("certificates"),
            self.base_dir.join("challenges"),
            self.base_dir.join("backups"),
        ];

        for dir in &dirs {
            std::fs::create_dir_all(dir)
                .map_err(|e| format!("Failed to create {}: {}", dir.display(), e))?;
        }

        log::info!(
            "[CertStore] Initialized at {}",
            self.base_dir.display()
        );
        Ok(())
    }

    /// Load state from disk.
    pub fn load(&mut self) -> Result<(), String> {
        let state_file = self.base_dir.join("state.json");
        if state_file.exists() {
            let content = std::fs::read_to_string(&state_file)
                .map_err(|e| format!("Failed to read state: {}", e))?;
            self.state = serde_json::from_str(&content)
                .map_err(|e| format!("Failed to parse state: {}", e))?;
            log::info!(
                "[CertStore] Loaded state: {} accounts, {} certificates",
                self.state.accounts.len(),
                self.state.certificates.len()
            );
        }
        Ok(())
    }

    /// Save state to disk (atomic write).
    pub fn save(&mut self) -> Result<(), String> {
        self.state.last_saved = Utc::now();
        let state_file = self.base_dir.join("state.json");
        let tmp_file = self.base_dir.join("state.json.tmp");

        let content = serde_json::to_string_pretty(&self.state)
            .map_err(|e| format!("Failed to serialize state: {}", e))?;

        // Atomic write: write to temp file, then rename
        std::fs::write(&tmp_file, &content)
            .map_err(|e| format!("Failed to write temp state: {}", e))?;
        std::fs::rename(&tmp_file, &state_file)
            .map_err(|e| format!("Failed to rename state file: {}", e))?;

        log::debug!("[CertStore] State saved");
        Ok(())
    }

    // ── Account Storage ─────────────────────────────────────────────

    /// Save an account to disk.
    pub fn save_account(&mut self, account: &AcmeAccount) -> Result<(), String> {
        let account_dir = self.base_dir.join("accounts").join(&account.id);
        std::fs::create_dir_all(&account_dir)
            .map_err(|e| format!("Failed to create account dir: {}", e))?;

        let meta_path = account_dir.join("account.json");
        let content = serde_json::to_string_pretty(account)
            .map_err(|e| format!("Failed to serialize account: {}", e))?;
        std::fs::write(&meta_path, content)
            .map_err(|e| format!("Failed to write account: {}", e))?;

        // Update in-memory state
        if let Some(existing) = self.state.accounts.iter_mut().find(|a| a.id == account.id) {
            *existing = account.clone();
        } else {
            self.state.accounts.push(account.clone());
        }

        self.save()?;
        log::info!("[CertStore] Account saved: {}", account.id);
        Ok(())
    }

    /// Save an account private key (PEM format).
    pub fn save_account_key(
        &self,
        account_id: &str,
        key_pem: &str,
    ) -> Result<(), String> {
        let key_path = self
            .base_dir
            .join("accounts")
            .join(account_id)
            .join("account_key.pem");
        std::fs::write(&key_path, key_pem)
            .map_err(|e| format!("Failed to write account key: {}", e))?;

        log::info!("[CertStore] Account key saved for {}", account_id);
        Ok(())
    }

    /// Load an account by ID.
    pub fn load_account(&self, account_id: &str) -> Result<AcmeAccount, String> {
        let meta_path = self
            .base_dir
            .join("accounts")
            .join(account_id)
            .join("account.json");
        let content = std::fs::read_to_string(&meta_path)
            .map_err(|e| format!("Failed to read account: {}", e))?;
        serde_json::from_str(&content)
            .map_err(|e| format!("Failed to parse account: {}", e))
    }

    /// List all stored accounts.
    pub fn list_accounts(&self) -> &[AcmeAccount] {
        &self.state.accounts
    }

    /// Remove an account.
    pub fn remove_account(&mut self, account_id: &str) -> Result<(), String> {
        let account_dir = self.base_dir.join("accounts").join(account_id);
        if account_dir.exists() {
            std::fs::remove_dir_all(&account_dir)
                .map_err(|e| format!("Failed to remove account dir: {}", e))?;
        }
        self.state.accounts.retain(|a| a.id != account_id);
        self.save()?;
        Ok(())
    }

    // ── Certificate Storage ─────────────────────────────────────────

    /// Save a certificate and its private key to disk.
    pub fn save_certificate(
        &mut self,
        cert: &ManagedCertificate,
        cert_pem: &str,
        key_pem: &str,
        issuer_pem: Option<&str>,
    ) -> Result<(), String> {
        let cert_dir = self.base_dir.join("certificates").join(&cert.id);
        std::fs::create_dir_all(&cert_dir)
            .map_err(|e| format!("Failed to create cert dir: {}", e))?;

        // Back up existing certificate before overwriting
        if cert_dir.join("cert.pem").exists() {
            self.backup_certificate(&cert.id)?;
        }

        // Write certificate PEM
        std::fs::write(cert_dir.join("cert.pem"), cert_pem)
            .map_err(|e| format!("Failed to write cert PEM: {}", e))?;

        // Write private key PEM
        std::fs::write(cert_dir.join("key.pem"), key_pem)
            .map_err(|e| format!("Failed to write key PEM: {}", e))?;

        // Write issuer certificate if provided
        if let Some(issuer) = issuer_pem {
            std::fs::write(cert_dir.join("issuer.pem"), issuer)
                .map_err(|e| format!("Failed to write issuer PEM: {}", e))?;
        }

        // Write metadata
        let meta = serde_json::to_string_pretty(cert)
            .map_err(|e| format!("Failed to serialize cert meta: {}", e))?;
        std::fs::write(cert_dir.join("meta.json"), meta)
            .map_err(|e| format!("Failed to write cert meta: {}", e))?;

        // Compute file paths and update cert
        let mut updated = cert.clone();
        updated.cert_pem_path = Some(cert_dir.join("cert.pem").to_string_lossy().to_string());
        updated.key_pem_path = Some(cert_dir.join("key.pem").to_string_lossy().to_string());
        if issuer_pem.is_some() {
            updated.issuer_pem_path =
                Some(cert_dir.join("issuer.pem").to_string_lossy().to_string());
        }

        // Update in-memory state
        if let Some(existing) = self.state.certificates.iter_mut().find(|c| c.id == cert.id) {
            *existing = updated;
        } else {
            self.state.certificates.push(updated);
        }

        self.save()?;
        log::info!(
            "[CertStore] Certificate saved: {} ({})",
            cert.id,
            cert.primary_domain
        );
        Ok(())
    }

    /// Load a certificate's PEM content from disk.
    pub fn load_certificate_pem(&self, cert_id: &str) -> Result<String, String> {
        let path = self
            .base_dir
            .join("certificates")
            .join(cert_id)
            .join("cert.pem");
        std::fs::read_to_string(&path)
            .map_err(|e| format!("Failed to read certificate: {}", e))
    }

    /// Load a certificate's private key PEM from disk.
    pub fn load_key_pem(&self, cert_id: &str) -> Result<String, String> {
        let path = self
            .base_dir
            .join("certificates")
            .join(cert_id)
            .join("key.pem");
        std::fs::read_to_string(&path)
            .map_err(|e| format!("Failed to read key: {}", e))
    }

    /// Get certificate metadata by ID.
    pub fn get_certificate(&self, cert_id: &str) -> Option<&ManagedCertificate> {
        self.state.certificates.iter().find(|c| c.id == cert_id)
    }

    /// List all managed certificates.
    pub fn list_certificates(&self) -> &[ManagedCertificate] {
        &self.state.certificates
    }

    /// List certificates that need renewal (expiring within `days`).
    pub fn certificates_needing_renewal(&self, days: i64) -> Vec<&ManagedCertificate> {
        self.state
            .certificates
            .iter()
            .filter(|c| {
                c.auto_renew
                    && matches!(c.status, CertificateStatus::Active | CertificateStatus::RenewalScheduled)
                    && c.days_until_expiry.map(|d| d <= days).unwrap_or(false)
            })
            .collect()
    }

    /// Find certificates by domain name.
    pub fn find_by_domain(&self, domain: &str) -> Vec<&ManagedCertificate> {
        self.state
            .certificates
            .iter()
            .filter(|c| c.domains.iter().any(|d| d == domain))
            .collect()
    }

    /// Update the status of a certificate.
    pub fn update_certificate_status(
        &mut self,
        cert_id: &str,
        status: CertificateStatus,
    ) -> Result<(), String> {
        if let Some(cert) = self.state.certificates.iter_mut().find(|c| c.id == cert_id) {
            cert.status = status;
            self.save()?;
            Ok(())
        } else {
            Err(format!("Certificate not found: {}", cert_id))
        }
    }

    /// Remove a certificate from disk and state.
    pub fn remove_certificate(&mut self, cert_id: &str) -> Result<(), String> {
        let cert_dir = self.base_dir.join("certificates").join(cert_id);
        if cert_dir.exists() {
            std::fs::remove_dir_all(&cert_dir)
                .map_err(|e| format!("Failed to remove cert dir: {}", e))?;
        }
        self.state.certificates.retain(|c| c.id != cert_id);
        self.save()?;
        log::info!("[CertStore] Certificate removed: {}", cert_id);
        Ok(())
    }

    // ── Backup ──────────────────────────────────────────────────────

    /// Back up a certificate's current files before renewal.
    fn backup_certificate(&self, cert_id: &str) -> Result<(), String> {
        let cert_dir = self.base_dir.join("certificates").join(cert_id);
        let timestamp = Utc::now().format("%Y%m%d_%H%M%S").to_string();
        let backup_dir = self
            .base_dir
            .join("backups")
            .join(format!("{}_{}", cert_id, timestamp));

        std::fs::create_dir_all(&backup_dir)
            .map_err(|e| format!("Failed to create backup dir: {}", e))?;

        // Copy existing files to backup
        for entry in std::fs::read_dir(&cert_dir)
            .map_err(|e| format!("Failed to read cert dir: {}", e))?
        {
            if let Ok(entry) = entry {
                let src = entry.path();
                let dst = backup_dir.join(entry.file_name());
                std::fs::copy(&src, &dst)
                    .map_err(|e| format!("Failed to copy {}: {}", src.display(), e))?;
            }
        }

        log::info!(
            "[CertStore] Certificate backed up: {} → {}",
            cert_id,
            backup_dir.display()
        );

        // Prune old backups
        self.prune_backups(cert_id)?;

        Ok(())
    }

    /// Remove old backups keeping only the most recent `max_backups`.
    fn prune_backups(&self, cert_id: &str) -> Result<(), String> {
        let backups_dir = self.base_dir.join("backups");
        if !backups_dir.exists() {
            return Ok(());
        }

        let prefix = format!("{}_", cert_id);
        let mut backup_dirs: Vec<_> = std::fs::read_dir(&backups_dir)
            .map_err(|e| format!("Failed to read backups dir: {}", e))?
            .filter_map(|e| e.ok())
            .filter(|e| {
                e.file_name()
                    .to_string_lossy()
                    .starts_with(&prefix)
            })
            .collect();

        backup_dirs.sort_by_key(|e| e.file_name());

        while backup_dirs.len() > self.max_backups {
            if let Some(old) = backup_dirs.first() {
                let _ = std::fs::remove_dir_all(old.path());
                backup_dirs.remove(0);
            }
        }

        Ok(())
    }

    // ── OCSP Storage ────────────────────────────────────────────────

    /// Save an OCSP response for a certificate.
    pub fn save_ocsp_response(
        &self,
        cert_id: &str,
        ocsp_der: &[u8],
    ) -> Result<(), String> {
        let path = self
            .base_dir
            .join("certificates")
            .join(cert_id)
            .join("ocsp.der");
        std::fs::write(&path, ocsp_der)
            .map_err(|e| format!("Failed to write OCSP response: {}", e))
    }

    /// Load a cached OCSP response for a certificate.
    pub fn load_ocsp_response(&self, cert_id: &str) -> Result<Vec<u8>, String> {
        let path = self
            .base_dir
            .join("certificates")
            .join(cert_id)
            .join("ocsp.der");
        std::fs::read(&path)
            .map_err(|e| format!("Failed to read OCSP response: {}", e))
    }

    // ── Challenge Token Storage ─────────────────────────────────────

    /// Store an HTTP-01 challenge response file.
    pub fn save_challenge_token(
        &self,
        token: &str,
        response: &str,
    ) -> Result<(), String> {
        let path = self.base_dir.join("challenges").join(token);
        std::fs::write(&path, response)
            .map_err(|e| format!("Failed to write challenge token: {}", e))
    }

    /// Remove an HTTP-01 challenge response file.
    pub fn remove_challenge_token(&self, token: &str) -> Result<(), String> {
        let path = self.base_dir.join("challenges").join(token);
        if path.exists() {
            std::fs::remove_file(&path)
                .map_err(|e| format!("Failed to remove challenge token: {}", e))?;
        }
        Ok(())
    }

    // ── Renewal Schedule ────────────────────────────────────────────

    /// Add or update a renewal schedule entry.
    pub fn schedule_renewal(
        &mut self,
        entry: RenewalScheduleEntry,
    ) -> Result<(), String> {
        if let Some(existing) = self
            .state
            .renewal_schedule
            .iter_mut()
            .find(|e| e.certificate_id == entry.certificate_id)
        {
            *existing = entry;
        } else {
            self.state.renewal_schedule.push(entry);
        }
        self.save()
    }

    /// Get the renewal schedule.
    pub fn renewal_schedule(&self) -> &[RenewalScheduleEntry] {
        &self.state.renewal_schedule
    }

    /// Remove a renewal entry.
    pub fn remove_renewal_entry(&mut self, cert_id: &str) -> Result<(), String> {
        self.state
            .renewal_schedule
            .retain(|e| e.certificate_id != cert_id);
        self.save()
    }

    // ── Utilities ───────────────────────────────────────────────────

    /// Get the storage directory path.
    pub fn base_dir(&self) -> &Path {
        &self.base_dir
    }

    /// Get disk usage of the storage directory in bytes.
    pub fn disk_usage(&self) -> u64 {
        dir_size(&self.base_dir)
    }
}

/// Recursively compute the total size of a directory.
fn dir_size(path: &Path) -> u64 {
    if !path.exists() {
        return 0;
    }
    std::fs::read_dir(path)
        .map(|entries| {
            entries
                .filter_map(|e| e.ok())
                .map(|e| {
                    let meta = e.metadata().ok();
                    if e.path().is_dir() {
                        dir_size(&e.path())
                    } else {
                        meta.map(|m| m.len()).unwrap_or(0)
                    }
                })
                .sum()
        })
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_store_init() {
        let tmp = std::env::temp_dir().join("sorng-le-test-store");
        let _ = std::fs::remove_dir_all(&tmp);
        let store = CertificateStore::new(&tmp.to_string_lossy());
        store.init().unwrap();

        assert!(tmp.join("accounts").exists());
        assert!(tmp.join("certificates").exists());
        assert!(tmp.join("challenges").exists());
        assert!(tmp.join("backups").exists());

        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn test_store_save_load_state() {
        let tmp = std::env::temp_dir().join("sorng-le-test-state");
        let _ = std::fs::remove_dir_all(&tmp);

        let mut store = CertificateStore::new(&tmp.to_string_lossy());
        store.init().unwrap();
        store.save().unwrap();

        let mut store2 = CertificateStore::new(&tmp.to_string_lossy());
        store2.load().unwrap();

        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn test_challenge_token_storage() {
        let tmp = std::env::temp_dir().join("sorng-le-test-tokens");
        let _ = std::fs::remove_dir_all(&tmp);

        let store = CertificateStore::new(&tmp.to_string_lossy());
        store.init().unwrap();
        store.save_challenge_token("test-token", "test-response").unwrap();

        let stored = std::fs::read_to_string(tmp.join("challenges").join("test-token")).unwrap();
        assert_eq!(stored, "test-response");

        store.remove_challenge_token("test-token").unwrap();
        assert!(!tmp.join("challenges").join("test-token").exists());

        let _ = std::fs::remove_dir_all(&tmp);
    }
}
