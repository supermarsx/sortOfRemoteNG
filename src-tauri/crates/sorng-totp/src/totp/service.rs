//! High-level orchestrator — owns the vault, delegates to sub-modules.
//! Exposes the methods that `commands.rs` delegates to.

use std::sync::Arc;
use tokio::sync::Mutex;

use crate::totp::core;
use crate::totp::crypto;
use crate::totp::export;
use crate::totp::import;
use crate::totp::qr;
use crate::totp::storage::TotpVault;
use crate::totp::types::*;
use crate::totp::uri;

/// Thread-safe service state managed by Tauri.
pub type TotpServiceState = Arc<Mutex<TotpService>>;

/// Central TOTP service.
pub struct TotpService {
    pub vault: TotpVault,
    /// If the vault is locked with a password, `true` means unlocked.
    pub unlocked: bool,
    /// Vault password (held in memory only while unlocked).
    vault_password: Option<String>,
}

impl TotpService {
    /// Create a new service wrapped in `Arc<Mutex<_>>` for Tauri state.
    pub fn new() -> TotpServiceState {
        Arc::new(Mutex::new(TotpService {
            vault: TotpVault::new(),
            unlocked: true,
            vault_password: None,
        }))
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    //  Vault lock / unlock
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    /// Set a vault password (enables encryption on save).
    pub fn set_password(&mut self, password: &str) {
        self.vault_password = Some(password.to_string());
        self.unlocked = true;
    }

    /// Lock the vault (clears in-memory data).
    pub fn lock(&mut self) {
        self.unlocked = false;
        // Keep password so we can unlock later; clear entries from memory
        self.vault.entries.clear();
        self.vault.groups.clear();
    }

    /// Unlock the vault from an encrypted payload.
    pub fn unlock(&mut self, encrypted_json: &str, password: &str) -> Result<(), TotpError> {
        let plaintext = crypto::decrypt_vault(encrypted_json, password)?;
        self.vault = TotpVault::from_json(&plaintext)?;
        self.vault_password = Some(password.to_string());
        self.unlocked = true;
        Ok(())
    }

    /// Check if the vault is locked.
    pub fn is_locked(&self) -> bool {
        !self.unlocked
    }

    /// Check if a vault password is set.
    pub fn has_password(&self) -> bool {
        self.vault_password.is_some()
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    //  Entry CRUD
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    /// Add a new TOTP entry.
    pub fn add_entry(&mut self, entry: TotpEntry) -> Result<String, TotpError> {
        self.require_unlocked()?;
        Ok(self.vault.add_entry(entry))
    }

    /// Create and add a new entry from basic fields.
    pub fn create_entry(
        &mut self,
        label: String,
        secret: String,
        issuer: Option<String>,
        algorithm: Option<String>,
        digits: Option<u8>,
        period: Option<u32>,
    ) -> Result<TotpEntry, TotpError> {
        self.require_unlocked()?;
        let mut entry = TotpEntry::new(&label, &secret);
        if let Some(iss) = issuer {
            entry = entry.with_issuer(iss);
        }
        if let Some(algo) = algorithm {
            entry.algorithm = Algorithm::from_str_loose(&algo).unwrap_or(Algorithm::Sha1);
        }
        if let Some(d) = digits {
            entry.digits = d;
        }
        if let Some(p) = period {
            entry.period = p;
        }
        self.vault.add_entry(entry.clone());
        Ok(entry)
    }

    /// Get an entry by ID.
    pub fn get_entry(&self, id: &str) -> Result<TotpEntry, TotpError> {
        self.require_unlocked()?;
        self.vault
            .get_entry(id)
            .cloned()
            .ok_or_else(|| TotpError::new(TotpErrorKind::NotFound, format!("Entry not found: {}", id)))
    }

    /// Update an existing entry.
    pub fn update_entry(&mut self, entry: TotpEntry) -> Result<(), TotpError> {
        self.require_unlocked()?;
        if self.vault.update_entry(entry) {
            Ok(())
        } else {
            Err(TotpError::new(TotpErrorKind::NotFound, "Entry not found"))
        }
    }

    /// Remove an entry by ID.
    pub fn remove_entry(&mut self, id: &str) -> Result<TotpEntry, TotpError> {
        self.require_unlocked()?;
        self.vault
            .remove_entry(id)
            .ok_or_else(|| TotpError::new(TotpErrorKind::NotFound, "Entry not found"))
    }

    /// List all entries.
    pub fn list_entries(&self) -> Result<Vec<TotpEntry>, TotpError> {
        self.require_unlocked()?;
        Ok(self.vault.entries.clone())
    }

    /// Search entries.
    pub fn search_entries(&self, query: &str) -> Result<Vec<TotpEntry>, TotpError> {
        self.require_unlocked()?;
        Ok(self.vault.search(query).into_iter().cloned().collect())
    }

    /// Filter entries.
    pub fn filter_entries(&self, filter: EntryFilter) -> Result<Vec<TotpEntry>, TotpError> {
        self.require_unlocked()?;
        Ok(self.vault.filter_entries(&filter).into_iter().cloned().collect())
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    //  Code generation
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    /// Generate a code for an entry by ID.
    pub fn generate_code(&mut self, id: &str) -> Result<GeneratedCode, TotpError> {
        self.require_unlocked()?;
        let entry = self
            .vault
            .get_entry(id)
            .ok_or_else(|| TotpError::new(TotpErrorKind::NotFound, "Entry not found"))?
            .clone();
        let code = core::generate_code(&entry)?;
        self.vault.record_use(id);
        Ok(code)
    }

    /// Generate codes for all entries.
    pub fn generate_all_codes(&self) -> Result<Vec<GeneratedCode>, TotpError> {
        self.require_unlocked()?;
        self.vault
            .entries
            .iter()
            .map(core::generate_code)
            .collect()
    }

    /// Verify a code against an entry.
    pub fn verify_code(
        &self,
        id: &str,
        code: &str,
        drift_window: Option<u32>,
    ) -> Result<VerifyResult, TotpError> {
        self.require_unlocked()?;
        let entry = self
            .vault
            .get_entry(id)
            .ok_or_else(|| TotpError::new(TotpErrorKind::NotFound, "Entry not found"))?;
        let window = drift_window.unwrap_or(1);
        Ok(core::verify_code(entry, code, window)?)
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    //  Groups
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    /// Add a group.
    pub fn add_group(&mut self, name: String) -> Result<TotpGroup, TotpError> {
        self.require_unlocked()?;
        let group = TotpGroup::new(&name);
        self.vault.add_group(group.clone());
        Ok(group)
    }

    /// List all groups.
    pub fn list_groups(&self) -> Result<Vec<TotpGroup>, TotpError> {
        self.require_unlocked()?;
        Ok(self.vault.groups.clone())
    }

    /// Remove a group.
    pub fn remove_group(&mut self, id: &str) -> Result<(), TotpError> {
        self.require_unlocked()?;
        self.vault
            .remove_group(id)
            .ok_or_else(|| TotpError::new(TotpErrorKind::NotFound, "Group not found"))?;
        Ok(())
    }

    /// Move an entry to a group (or None to ungroup).
    pub fn move_entry_to_group(
        &mut self,
        entry_id: &str,
        group_id: Option<String>,
    ) -> Result<(), TotpError> {
        self.require_unlocked()?;
        let entry = self
            .vault
            .get_entry_mut(entry_id)
            .ok_or_else(|| TotpError::new(TotpErrorKind::NotFound, "Entry not found"))?;
        entry.group_id = group_id;
        Ok(())
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    //  Favourites & ordering
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    /// Toggle favourite.
    pub fn toggle_favourite(&mut self, id: &str) -> Result<bool, TotpError> {
        self.require_unlocked()?;
        self.vault
            .toggle_favourite(id)
            .ok_or_else(|| TotpError::new(TotpErrorKind::NotFound, "Entry not found"))
    }

    /// List favourites.
    pub fn list_favourites(&self) -> Result<Vec<TotpEntry>, TotpError> {
        self.require_unlocked()?;
        Ok(self.vault.favourites().into_iter().cloned().collect())
    }

    /// Reorder an entry.
    pub fn reorder_entry(&mut self, from_idx: usize, to_idx: usize) -> Result<(), TotpError> {
        self.require_unlocked()?;
        if self.vault.reorder_entry(from_idx, to_idx) {
            Ok(())
        } else {
            Err(TotpError::new(TotpErrorKind::InvalidInput, "Invalid reorder indices"))
        }
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    //  Import / Export
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    /// Import entries (auto-detect format).
    pub fn import_entries(&mut self, data: &str) -> Result<ImportResult, TotpError> {
        self.require_unlocked()?;
        let result = import::auto_import(data);
        for entry in &result.entries {
            self.vault.add_entry(entry.clone());
        }
        Ok(result)
    }

    /// Import with explicit format.
    pub fn import_as(
        &mut self,
        data: &str,
        format: ImportFormat,
    ) -> Result<ImportResult, TotpError> {
        self.require_unlocked()?;
        let result = import::import_as(data, format);
        for entry in &result.entries {
            self.vault.add_entry(entry.clone());
        }
        Ok(result)
    }

    /// Import from an `otpauth://` URI.
    pub fn import_uri(&mut self, uri_str: &str) -> Result<TotpEntry, TotpError> {
        self.require_unlocked()?;
        let entry = uri::parse_otpauth_uri(uri_str)?;
        self.vault.add_entry(entry.clone());
        Ok(entry)
    }

    /// Export entries in the requested format.
    pub fn export_entries(
        &self,
        format: ExportFormat,
        password: Option<String>,
    ) -> Result<String, TotpError> {
        self.require_unlocked()?;
        export::export(&self.vault.entries, format, password.as_deref())
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    //  QR codes
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    /// Generate a QR-code PNG (bytes) for an entry.
    pub fn entry_qr_png(&self, id: &str) -> Result<Vec<u8>, TotpError> {
        self.require_unlocked()?;
        let entry = self
            .vault
            .get_entry(id)
            .ok_or_else(|| TotpError::new(TotpErrorKind::NotFound, "Entry not found"))?;
        qr::entry_to_qr_png(entry)
    }

    /// Generate a QR-code data URI for an entry.
    pub fn entry_qr_data_uri(&self, id: &str) -> Result<String, TotpError> {
        self.require_unlocked()?;
        let entry = self
            .vault
            .get_entry(id)
            .ok_or_else(|| TotpError::new(TotpErrorKind::NotFound, "Entry not found"))?;
        qr::entry_to_qr_data_uri(entry)
    }

    /// Generate the `otpauth://` URI for an entry.
    pub fn entry_uri(&self, id: &str) -> Result<String, TotpError> {
        self.require_unlocked()?;
        let entry = self
            .vault
            .get_entry(id)
            .ok_or_else(|| TotpError::new(TotpErrorKind::NotFound, "Entry not found"))?;
        Ok(uri::build_otpauth_uri(entry))
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    //  Utility
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    /// Generate a fresh random secret (base32, 20 bytes by default).
    pub fn generate_secret(&self, length: Option<usize>) -> String {
        core::generate_secret(length.unwrap_or(20))
    }

    /// Password strength score.
    pub fn password_strength(&self, password: &str) -> (u8, &'static str) {
        let score = crypto::password_strength(password);
        (score, crypto::strength_label(score))
    }

    /// Deduplicate entries.
    pub fn deduplicate(&mut self) -> Result<usize, TotpError> {
        self.require_unlocked()?;
        Ok(self.vault.deduplicate())
    }

    /// Get vault statistics.
    pub fn vault_stats(&self) -> Result<VaultStats, TotpError> {
        self.require_unlocked()?;
        Ok(VaultStats {
            entry_count: self.vault.entry_count(),
            group_count: self.vault.group_count(),
            favourite_count: self.vault.favourites().len(),
            tags: self.vault.all_tags(),
            has_password: self.has_password(),
        })
    }

    /// Save vault as encrypted JSON (if password set) or plain JSON.
    pub fn save_vault(&self) -> Result<String, TotpError> {
        self.require_unlocked()?;
        let json = self.vault.to_json()?;
        if let Some(ref pw) = self.vault_password {
            crypto::encrypt_vault(&json, pw)
        } else {
            Ok(json)
        }
    }

    /// Load vault from JSON (auto-detects encrypted vs plain).
    pub fn load_vault(&mut self, data: &str, password: Option<&str>) -> Result<(), TotpError> {
        let trimmed = data.trim();
        if let Ok(envelope) = serde_json::from_str::<crypto::VaultEnvelope>(trimmed) {
            // Encrypted
            let pw = password.ok_or_else(|| {
                TotpError::new(TotpErrorKind::VaultLocked, "Vault is encrypted, password required")
            })?;
            let plain = crypto::decrypt_vault(data, pw)?;
            self.vault = TotpVault::from_json(&plain)?;
            self.vault_password = Some(pw.to_string());
            // suppress warning about unused variable
            let _ = envelope;
        } else {
            // Plain JSON
            self.vault = TotpVault::from_json(trimmed)?;
        }
        self.unlocked = true;
        Ok(())
    }

    /// Get all tags in the vault.
    pub fn all_tags(&self) -> Result<Vec<String>, TotpError> {
        self.require_unlocked()?;
        Ok(self.vault.all_tags())
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    //  Internal
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    fn require_unlocked(&self) -> Result<(), TotpError> {
        if self.is_locked() {
            Err(TotpError::new(TotpErrorKind::VaultLocked, "Vault is locked"))
        } else {
            Ok(())
        }
    }
}

/// Summary stats returned by `vault_stats`.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct VaultStats {
    pub entry_count: usize,
    pub group_count: usize,
    pub favourite_count: usize,
    pub tags: Vec<String>,
    pub has_password: bool,
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn new_svc() -> TotpService {
        TotpService {
            vault: TotpVault::new(),
            unlocked: true,
            vault_password: None,
        }
    }

    #[tokio::test]
    async fn add_and_get_entry() {
        let mut svc = new_svc().await;
        let entry = TotpEntry::new("alice", "JBSWY3DPEHPK3PXP").with_issuer("GitHub");
        let id = svc.add_entry(entry).unwrap();
        let found = svc.get_entry(&id).unwrap();
        assert_eq!(found.label, "alice");
    }

    #[tokio::test]
    async fn create_entry_with_defaults() {
        let mut svc = new_svc().await;
        let entry = svc
            .create_entry("user".into(), "ABCDEF".into(), Some("Acme".into()), None, None, None)
            .unwrap();
        assert_eq!(entry.issuer.as_deref(), Some("Acme"));
        assert_eq!(entry.algorithm, Algorithm::Sha1);
        assert_eq!(entry.digits, 6);
    }

    #[tokio::test]
    async fn remove_entry() {
        let mut svc = new_svc().await;
        let entry = TotpEntry::new("a", "A");
        let id = svc.add_entry(entry).unwrap();
        svc.remove_entry(&id).unwrap();
        assert!(svc.get_entry(&id).is_err());
    }

    #[tokio::test]
    async fn generate_code_succeeds() {
        let mut svc = new_svc().await;
        let entry = TotpEntry::new("user", "JBSWY3DPEHPK3PXP");
        let id = svc.add_entry(entry).unwrap();
        let code = svc.generate_code(&id).unwrap();
        assert_eq!(code.code.len(), 6);
    }

    #[tokio::test]
    async fn lock_prevents_access() {
        let mut svc = new_svc().await;
        svc.add_entry(TotpEntry::new("a", "A")).unwrap();
        svc.lock();
        assert!(svc.list_entries().is_err());
        assert!(svc.is_locked());
    }

    #[tokio::test]
    async fn import_otpauth_uri() {
        let mut svc = new_svc().await;
        let entry = svc
            .import_uri("otpauth://totp/GitHub:alice?secret=JBSWY3DPEHPK3PXP&issuer=GitHub")
            .unwrap();
        assert_eq!(entry.label, "alice");
        assert_eq!(svc.vault.entry_count(), 1);
    }

    #[tokio::test]
    async fn groups_lifecycle() {
        let mut svc = new_svc().await;
        let group = svc.add_group("Work".into()).unwrap();
        assert_eq!(svc.list_groups().unwrap().len(), 1);

        let entry = TotpEntry::new("a", "A");
        let eid = svc.add_entry(entry).unwrap();
        svc.move_entry_to_group(&eid, Some(group.id.clone())).unwrap();

        svc.remove_group(&group.id).unwrap();
        let e = svc.get_entry(&eid).unwrap();
        assert!(e.group_id.is_none()); // unlinked
    }

    #[tokio::test]
    async fn toggle_favourite() {
        let mut svc = new_svc().await;
        let entry = TotpEntry::new("a", "A");
        let id = svc.add_entry(entry).unwrap();
        assert_eq!(svc.toggle_favourite(&id).unwrap(), true);
        assert_eq!(svc.toggle_favourite(&id).unwrap(), false);
    }

    #[tokio::test]
    async fn generate_secret() {
        let svc = new_svc().await;
        let s1 = svc.generate_secret(None);
        let s2 = svc.generate_secret(None);
        assert_ne!(s1, s2);
        assert!(s1.len() > 10);
    }

    #[tokio::test]
    async fn vault_stats() {
        let mut svc = new_svc().await;
        svc.add_entry(TotpEntry::new("a", "A")).unwrap();
        svc.add_group("G".into()).unwrap();
        let stats = svc.vault_stats().unwrap();
        assert_eq!(stats.entry_count, 1);
        assert_eq!(stats.group_count, 1);
    }

    #[tokio::test]
    async fn save_and_load_plaintext() {
        let mut svc = new_svc().await;
        svc.add_entry(TotpEntry::new("a", "AAAA")).unwrap();
        let json = svc.save_vault().unwrap();

        let mut svc2 = new_svc().await;
        svc2.load_vault(&json, None).unwrap();
        assert_eq!(svc2.vault.entry_count(), 1);
    }

    #[tokio::test]
    async fn save_and_load_encrypted() {
        let mut svc = new_svc().await;
        svc.set_password("test-pw-123!");
        svc.add_entry(TotpEntry::new("a", "AAAA")).unwrap();
        let enc = svc.save_vault().unwrap();
        assert!(enc.contains("ciphertext"));

        let mut svc2 = new_svc().await;
        svc2.load_vault(&enc, Some("test-pw-123!")).unwrap();
        assert_eq!(svc2.vault.entry_count(), 1);
    }

    #[tokio::test]
    async fn export_import_roundtrip() {
        let mut svc = new_svc().await;
        svc.add_entry(
            TotpEntry::new("alice", "JBSWY3DPEHPK3PXP").with_issuer("GitHub"),
        ).unwrap();
        let uris = svc.export_entries(ExportFormat::OtpAuthUris, None).unwrap();

        let mut svc2 = new_svc().await;
        let result = svc2.import_entries(&uris).unwrap();
        assert_eq!(result.entries.len(), 1);
    }

    #[tokio::test]
    async fn deduplicate() {
        let mut svc = new_svc().await;
        svc.add_entry(TotpEntry::new("a", "AAAA").with_issuer("X")).unwrap();
        svc.add_entry(TotpEntry::new("b", "AAAA").with_issuer("X")).unwrap();
        let removed = svc.deduplicate().unwrap();
        assert_eq!(removed, 1);
    }
}
