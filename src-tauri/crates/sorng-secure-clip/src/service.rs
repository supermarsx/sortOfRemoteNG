use std::sync::Arc;
use tokio::sync::RwLock;

use crate::engine::ClipEngine;
use crate::guard;
use crate::history::ClipHistory;
use crate::types::*;

/// The main secure-clipboard service, orchestrating engine + history + auto-clear.
pub struct SecureClipService {
    engine: Arc<RwLock<ClipEngine>>,
    history: Arc<RwLock<ClipHistory>>,
    config: SecureClipConfig,
    locked: bool,
    _auto_clear_task: Option<guard::AutoClearTask>,
}

/// Thread-safe state handle for Tauri managed state.
pub type SecureClipServiceState = Arc<RwLock<SecureClipService>>;

/// Create a new secure-clipboard service state and start the auto-clear watcher.
pub fn create_secure_clip_state() -> SecureClipServiceState {
    let config = SecureClipConfig::default();
    let engine = Arc::new(RwLock::new(ClipEngine::new()));
    let history = Arc::new(RwLock::new(ClipHistory::new(config.history_max_entries)));

    let handle = guard::spawn_auto_clear_task(engine.clone(), history.clone());

    Arc::new(RwLock::new(SecureClipService {
        engine,
        history,
        config,
        locked: false,
        _auto_clear_task: Some(handle),
    }))
}

impl SecureClipService {
    fn ensure_available(&self) -> Result<(), String> {
        if !self.config.enabled {
            return Err("Secure clipboard is disabled".to_string());
        }
        if self.locked && self.config.block_when_locked {
            return Err("Secure clipboard is unavailable while the app is locked".to_string());
        }
        Ok(())
    }

    fn ensure_terminal_paste_available(&self) -> Result<(), String> {
        self.ensure_available()?;
        if !self.config.paste_to_terminal_enabled {
            return Err("Secure terminal paste is disabled by policy".to_string());
        }
        Ok(())
    }

    // ═══════════════════════════════════════════════════════════════
    //  Copy
    // ═══════════════════════════════════════════════════════════════

    /// Copy a credential to the secure clipboard.
    pub async fn copy(&mut self, request: &CopyRequest) -> Result<ClipEntryDisplay, String> {
        self.ensure_available()?;

        let (entry, replaced) = {
            let mut eng = self.engine.write().await;
            eng.copy(request, &self.config)?
        };

        // Record in history.
        if self.config.history_enabled {
            let mut hist = self.history.write().await;
            hist.record_copy(&entry);
            if let Some(ref old) = replaced {
                hist.record_replaced(old);
            }
        }

        Ok(entry.to_display())
    }

    /// Copy a connection password with sensible defaults.
    pub async fn copy_connection_password(
        &mut self,
        connection_id: &str,
        connection_name: &str,
        password: String,
    ) -> Result<ClipEntryDisplay, String> {
        let req = CopyRequest {
            value: password,
            kind: SecretKind::Password,
            label: Some(format!("Password for {}", connection_name)),
            connection_id: Some(connection_id.to_string()),
            field: Some("password".to_string()),
            clear_after_secs: None,
            max_pastes: None,
            one_time: false,
        };
        self.copy(&req).await
    }

    /// Copy a TOTP code (auto-clear = 30s, one-time default).
    pub async fn copy_totp(
        &mut self,
        connection_id: Option<&str>,
        code: String,
    ) -> Result<ClipEntryDisplay, String> {
        let req = CopyRequest {
            value: code,
            kind: SecretKind::TotpCode,
            label: Some("TOTP Code".to_string()),
            connection_id: connection_id.map(|s| s.to_string()),
            field: Some("totpCode".to_string()),
            clear_after_secs: Some(30),
            max_pastes: self.config.one_time_paste_available.then_some(1),
            one_time: self.config.one_time_paste_available,
        };
        self.copy(&req).await
    }

    /// Copy a username (longer timeout, not truly secret).
    pub async fn copy_username(
        &mut self,
        connection_id: Option<&str>,
        username: String,
    ) -> Result<ClipEntryDisplay, String> {
        let req = CopyRequest {
            value: username,
            kind: SecretKind::Username,
            label: Some("Username".to_string()),
            connection_id: connection_id.map(|s| s.to_string()),
            field: Some("username".to_string()),
            clear_after_secs: Some(30),
            max_pastes: None,
            one_time: false,
        };
        self.copy(&req).await
    }

    /// Copy a private key passphrase.
    pub async fn copy_passphrase(
        &mut self,
        connection_id: Option<&str>,
        passphrase: String,
    ) -> Result<ClipEntryDisplay, String> {
        let req = CopyRequest {
            value: passphrase,
            kind: SecretKind::Passphrase,
            label: Some("Key Passphrase".to_string()),
            connection_id: connection_id.map(|s| s.to_string()),
            field: Some("passphrase".to_string()),
            clear_after_secs: None,
            max_pastes: None,
            one_time: false,
        };
        self.copy(&req).await
    }

    /// Copy an API key or token.
    pub async fn copy_api_key(
        &mut self,
        label: Option<&str>,
        key: String,
    ) -> Result<ClipEntryDisplay, String> {
        let req = CopyRequest {
            value: key,
            kind: SecretKind::ApiKey,
            label: label.map(|s| s.to_string()),
            connection_id: None,
            field: Some("apiKey".to_string()),
            clear_after_secs: None,
            max_pastes: None,
            one_time: false,
        };
        self.copy(&req).await
    }

    // ═══════════════════════════════════════════════════════════════
    //  Paste
    // ═══════════════════════════════════════════════════════════════

    /// Read the current clipboard value.
    pub async fn paste(&mut self) -> Result<String, String> {
        self.ensure_available()?;
        let paste = {
            let mut eng = self.engine.write().await;
            eng.paste()?
        };
        if let Some(ref entry) = paste.cleared {
            let mut history = self.history.write().await;
            history.record_clear(entry, ClearReason::MaxPastes);
        }
        Ok(paste.value.to_string())
    }

    /// Read by entry ID.
    pub async fn paste_by_id(&mut self, entry_id: &str) -> Result<String, String> {
        self.ensure_available()?;
        let paste = {
            let mut eng = self.engine.write().await;
            eng.paste_by_id(entry_id)?
        };
        if let Some(ref entry) = paste.cleared {
            let mut history = self.history.write().await;
            history.record_clear(entry, ClearReason::MaxPastes);
        }
        Ok(paste.value.to_string())
    }

    /// Atomically consume one terminal paste before handing the value to the
    /// native SSH queue. Renderer code never receives this payload.
    pub async fn consume_terminal_paste(
        &mut self,
        entry_id: Option<&str>,
    ) -> Result<NativeTerminalPaste, String> {
        self.ensure_terminal_paste_available()?;
        let paste = {
            let mut eng = self.engine.write().await;
            match entry_id {
                Some(entry_id) => eng.paste_by_id(entry_id)?,
                None => eng.paste()?,
            }
        };
        let cleared = paste.cleared.is_some();
        if let Some(ref entry) = paste.cleared {
            let mut history = self.history.write().await;
            history.record_clear(entry, ClearReason::MaxPastes);
        }
        Ok(NativeTerminalPaste {
            response: PasteToTerminalResponse {
                entry_id: paste.entry_id,
                paste_count: paste.paste_count,
                cleared,
            },
            value: paste.value,
        })
    }

    // ═══════════════════════════════════════════════════════════════
    //  Clear
    // ═══════════════════════════════════════════════════════════════

    /// Manually clear the clipboard.
    pub async fn clear(&mut self) -> Result<bool, String> {
        let cleared = {
            let mut eng = self.engine.write().await;
            eng.clear(ClearReason::ManualClear)?
        };
        if let Some(ref entry) = cleared {
            let mut hist = self.history.write().await;
            hist.record_clear(entry, ClearReason::ManualClear);
        }
        Ok(cleared.is_some())
    }

    /// Clear due to app locking.
    pub async fn clear_on_lock(&mut self) -> Result<bool, String> {
        self.locked = true;
        if !self.config.clear_on_lock {
            return Ok(false);
        }
        let cleared = {
            let mut eng = self.engine.write().await;
            eng.clear(ClearReason::AppLocked)?
        };
        if let Some(ref entry) = cleared {
            let mut hist = self.history.write().await;
            hist.record_clear(entry, ClearReason::AppLocked);
        }
        Ok(cleared.is_some())
    }

    /// Mark the application as unlocked so policy-gated copies and pastes can resume.
    pub fn on_app_unlock(&mut self) {
        self.locked = false;
    }

    /// Synchronize policy with the authoritative native application lock state.
    /// Repeated locked observations retry an earlier failed owned-secret clear.
    pub async fn synchronize_lock_state(&mut self, locked: bool) -> Result<(), String> {
        if locked {
            self.clear_on_lock().await?;
        } else {
            self.on_app_unlock();
        }
        Ok(())
    }

    /// Clear due to app exit.
    pub async fn clear_on_exit(&mut self) -> Result<bool, String> {
        if !self.config.clear_on_exit {
            return Ok(false);
        }
        let cleared = {
            let mut eng = self.engine.write().await;
            eng.clear(ClearReason::AppExit)?
        };
        if let Some(ref entry) = cleared {
            let mut hist = self.history.write().await;
            hist.record_clear(entry, ClearReason::AppExit);
        }
        Ok(cleared.is_some())
    }

    // ═══════════════════════════════════════════════════════════════
    //  Status / display
    // ═══════════════════════════════════════════════════════════════

    /// Get the current entry display (masked value).
    pub async fn current(&self) -> Option<ClipEntryDisplay> {
        let eng = self.engine.read().await;
        eng.current_display()
    }

    /// Is there an active entry on the clipboard?
    pub async fn has_entry(&self) -> bool {
        let eng = self.engine.read().await;
        eng.has_entry()
    }

    // ═══════════════════════════════════════════════════════════════
    //  History
    // ═══════════════════════════════════════════════════════════════

    /// Get copy history (metadata only, no values).
    pub async fn get_history(&self) -> Vec<ClipHistoryEntry> {
        let hist = self.history.read().await;
        hist.list().to_vec()
    }

    /// Get history for a specific connection.
    pub async fn get_connection_history(&self, connection_id: &str) -> Vec<ClipHistoryEntry> {
        let hist = self.history.read().await;
        hist.for_connection(connection_id)
            .into_iter()
            .cloned()
            .collect()
    }

    /// Clear all history.
    pub async fn clear_history(&mut self) {
        let mut hist = self.history.write().await;
        hist.clear();
    }

    // ═══════════════════════════════════════════════════════════════
    //  Config
    // ═══════════════════════════════════════════════════════════════

    /// Get current config.
    pub fn get_config(&self) -> SecureClipConfig {
        self.config.clone()
    }

    /// Update config.
    pub async fn update_config(&mut self, config: SecureClipConfig) -> Result<(), String> {
        if self.locked && self.config.block_when_locked {
            return Err(
                "Secure clipboard settings cannot change while the app is locked".to_string(),
            );
        }
        if config.history_max_entries > 10_000 {
            return Err("Secure clipboard history limit exceeds 10000 entries".to_string());
        }
        if config.auto_clear_secs > 7 * 24 * 60 * 60
            || config
                .kind_clear_overrides
                .values()
                .any(|seconds| *seconds > 7 * 24 * 60 * 60)
        {
            return Err("Secure clipboard clear timeout exceeds seven days".to_string());
        }
        self.config = config;
        let mut hist = self.history.write().await;
        hist.set_max_entries(self.config.history_max_entries);
        Ok(())
    }

    // ═══════════════════════════════════════════════════════════════
    //  Stats
    // ═══════════════════════════════════════════════════════════════

    pub async fn stats(&self) -> SecureClipStats {
        let mut stats = {
            let eng = self.engine.read().await;
            eng.stats()
        };
        let hist = self.history.read().await;
        stats.history_entries = hist.len();
        stats
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn service(config: SecureClipConfig) -> SecureClipService {
        SecureClipService {
            engine: Arc::new(RwLock::new(ClipEngine::new())),
            history: Arc::new(RwLock::new(ClipHistory::new(config.history_max_entries))),
            config,
            locked: false,
            _auto_clear_task: None,
        }
    }

    #[test]
    fn backend_lock_and_terminal_policies_are_enforced() {
        let mut service = service(SecureClipConfig::default());
        service.locked = true;
        assert!(service.ensure_available().is_err());

        service.config.block_when_locked = false;
        assert!(service.ensure_available().is_ok());

        service.config.paste_to_terminal_enabled = false;
        assert!(service.ensure_terminal_paste_available().is_err());

        service.on_app_unlock();
        service.config.enabled = false;
        assert!(service.ensure_available().is_err());
    }

    #[tokio::test]
    async fn native_lock_transitions_block_and_restore_operations() {
        let mut service = service(SecureClipConfig::default());
        service
            .synchronize_lock_state(true)
            .await
            .expect("lock transition");
        assert!(service.ensure_available().is_err());

        service
            .synchronize_lock_state(false)
            .await
            .expect("unlock transition");
        assert!(service.ensure_available().is_ok());
    }
}
