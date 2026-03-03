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
    _auto_clear_handle: Option<tokio::task::JoinHandle<()>>,
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
        _auto_clear_handle: Some(handle),
    }))
}

impl SecureClipService {
    // ═══════════════════════════════════════════════════════════════
    //  Copy
    // ═══════════════════════════════════════════════════════════════

    /// Copy a credential to the secure clipboard.
    pub async fn copy(&mut self, request: &CopyRequest) -> Result<ClipEntryDisplay, String> {
        if !self.config.enabled {
            return Err("Secure clipboard is disabled".to_string());
        }

        let (entry, replaced) = {
            let mut eng = self.engine.write().await;
            eng.copy(request, &self.config)
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
        password: &str,
    ) -> Result<ClipEntryDisplay, String> {
        let req = CopyRequest {
            value: password.to_string(),
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
        code: &str,
    ) -> Result<ClipEntryDisplay, String> {
        let req = CopyRequest {
            value: code.to_string(),
            kind: SecretKind::TotpCode,
            label: Some("TOTP Code".to_string()),
            connection_id: connection_id.map(|s| s.to_string()),
            field: Some("totpCode".to_string()),
            clear_after_secs: Some(30),
            max_pastes: Some(1),
            one_time: true,
        };
        self.copy(&req).await
    }

    /// Copy a username (longer timeout, not truly secret).
    pub async fn copy_username(
        &mut self,
        connection_id: Option<&str>,
        username: &str,
    ) -> Result<ClipEntryDisplay, String> {
        let req = CopyRequest {
            value: username.to_string(),
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
        passphrase: &str,
    ) -> Result<ClipEntryDisplay, String> {
        let req = CopyRequest {
            value: passphrase.to_string(),
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
        key: &str,
    ) -> Result<ClipEntryDisplay, String> {
        let req = CopyRequest {
            value: key.to_string(),
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
        let mut eng = self.engine.write().await;
        eng.paste()
    }

    /// Read by entry ID.
    pub async fn paste_by_id(&mut self, entry_id: &str) -> Result<String, String> {
        let mut eng = self.engine.write().await;
        eng.paste_by_id(entry_id)
    }

    /// Get the current value for "paste to terminal" — does NOT increment
    /// the paste counter (the SSH module will call `record_terminal_paste` after).
    pub async fn get_for_terminal(&self) -> Result<(String, String), String> {
        let eng = self.engine.read().await;
        let entry = eng.current_entry()
            .ok_or_else(|| "Secure clipboard is empty".to_string())?;
        if !entry.is_valid() {
            return Err("Clipboard entry has expired or been cleared".to_string());
        }
        Ok((entry.id.clone(), entry.value.clone()))
    }

    /// Record that a paste-to-terminal happened (increments count, may clear).
    pub async fn record_terminal_paste(&mut self, entry_id: &str) {
        let mut eng = self.engine.write().await;
        let _ = eng.paste_by_id(entry_id);
    }

    // ═══════════════════════════════════════════════════════════════
    //  Clear
    // ═══════════════════════════════════════════════════════════════

    /// Manually clear the clipboard.
    pub async fn clear(&mut self) -> bool {
        let cleared = {
            let mut eng = self.engine.write().await;
            eng.clear(ClearReason::ManualClear)
        };
        if let Some(ref entry) = cleared {
            let mut hist = self.history.write().await;
            hist.record_clear(entry, ClearReason::ManualClear);
        }
        cleared.is_some()
    }

    /// Clear due to app locking.
    pub async fn clear_on_lock(&mut self) -> bool {
        if !self.config.clear_on_lock {
            return false;
        }
        let cleared = {
            let mut eng = self.engine.write().await;
            eng.clear(ClearReason::AppLocked)
        };
        if let Some(ref entry) = cleared {
            let mut hist = self.history.write().await;
            hist.record_clear(entry, ClearReason::AppLocked);
        }
        cleared.is_some()
    }

    /// Clear due to app exit.
    pub async fn clear_on_exit(&mut self) -> bool {
        if !self.config.clear_on_exit {
            return false;
        }
        let cleared = {
            let mut eng = self.engine.write().await;
            eng.clear(ClearReason::AppExit)
        };
        if let Some(ref entry) = cleared {
            let mut hist = self.history.write().await;
            hist.record_clear(entry, ClearReason::AppExit);
        }
        cleared.is_some()
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
        hist.for_connection(connection_id).into_iter().cloned().collect()
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
    pub async fn update_config(&mut self, config: SecureClipConfig) {
        self.config = config;
        let mut hist = self.history.write().await;
        hist.set_max_entries(self.config.history_max_entries);
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
