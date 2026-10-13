use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::{RwLock, RwLockWriteGuard};

use crate::engine::ClipEngine;
use crate::guard;
use crate::history::ClipHistory;
use crate::types::*;

/// How long [`clear_on_exit_blocking`] waits for a clipboard operation that is
/// still in flight before it gives up.
const EXIT_LOCK_WAIT: Duration = Duration::from_millis(500);

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

/// Clear the engine's entry on the application exit path.
///
/// What the exit path may assume:
///  - It is synchronous and needs no async runtime: call it from the exit
///    handler while the managed state still exists. It never panics.
///  - It is bounded. It waits at most [`EXIT_LOCK_WAIT`] for a clipboard
///    command that is still running and then makes one clear attempt, whose
///    own bound is the platform's (about 100 ms on Windows; a helper timeout
///    of 2 s per helper on macOS and Linux).
///  - It only ever removes the value this engine put on the clipboard.
///    Whatever the user or another program copied since is left untouched.
///  - It is idempotent and safe when nothing was ever copied.
///
/// `Ok(true)`: the entry was retired (its value removed from the clipboard
/// when it was still there). `Ok(false)`: nothing to do, or `clear_on_exit` is
/// off. `Err(busy | unavailable)`: ownership could not be verified in time and
/// the value may remain on the clipboard; exit should proceed regardless.
pub fn clear_on_exit_blocking(state: &SecureClipServiceState) -> Result<bool, SecureClipError> {
    let deadline = Instant::now() + EXIT_LOCK_WAIT;
    let service = write_before(state, deadline)?;
    if !service.config.clear_on_exit {
        return Ok(false);
    }

    let cleared = write_before(&service.engine, deadline)?.clear(ClearReason::AppExit)?;
    if let Some(ref entry) = cleared {
        // History dies with the process; recording is a courtesy.
        if let Ok(mut history) = service.history.try_write() {
            history.record_clear(entry, ClearReason::AppExit);
        }
    }
    Ok(cleared.is_some())
}

/// Take a write lock without an async runtime, giving up at `deadline`.
fn write_before<T>(
    lock: &RwLock<T>,
    deadline: Instant,
) -> Result<RwLockWriteGuard<'_, T>, SecureClipError> {
    loop {
        match lock.try_write() {
            Ok(guard) => return Ok(guard),
            Err(_) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(5)),
            Err(_) => return Err(SecureClipError::Busy),
        }
    }
}

impl SecureClipService {
    fn ensure_available(&self) -> Result<(), SecureClipError> {
        if !self.config.enabled {
            return Err(SecureClipError::Unavailable);
        }
        if self.locked && self.config.block_when_locked {
            return Err(SecureClipError::Locked);
        }
        Ok(())
    }

    fn ensure_terminal_paste_available(&self) -> Result<(), SecureClipError> {
        self.ensure_available()?;
        if !self.config.paste_to_terminal_enabled {
            return Err(SecureClipError::Unavailable);
        }
        Ok(())
    }

    // ═══════════════════════════════════════════════════════════════
    //  Copy
    // ═══════════════════════════════════════════════════════════════

    /// Copy a credential to the secure clipboard.
    ///
    /// Fails only with the copy contract's codes (`locked`, `busy`,
    /// `too-large`, `unavailable`); see [`SecureClipError::for_copy`].
    pub async fn copy(
        &mut self,
        request: &CopyRequest,
    ) -> Result<ClipEntryDisplay, SecureClipError> {
        self.copy_unnarrowed(request).await.map_err(|error| {
            // The precise refusal stays in the native log; the caller gets
            // one of the four codes it is promised.
            log::warn!("Secure clipboard copy refused ({error})");
            error.for_copy()
        })
    }

    async fn copy_unnarrowed(
        &mut self,
        request: &CopyRequest,
    ) -> Result<ClipEntryDisplay, SecureClipError> {
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
    ) -> Result<ClipEntryDisplay, SecureClipError> {
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
    ) -> Result<ClipEntryDisplay, SecureClipError> {
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
    ) -> Result<ClipEntryDisplay, SecureClipError> {
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
    ) -> Result<ClipEntryDisplay, SecureClipError> {
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
    ) -> Result<ClipEntryDisplay, SecureClipError> {
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
    pub async fn paste(&mut self) -> Result<String, SecureClipError> {
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
    pub async fn paste_by_id(&mut self, entry_id: &str) -> Result<String, SecureClipError> {
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
    ) -> Result<NativeTerminalPaste, SecureClipError> {
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
    ///
    /// `Ok(true)` means the engine's entry is gone. The OS clipboard is
    /// emptied only when it still held that entry's value.
    pub async fn clear(&mut self) -> Result<bool, SecureClipError> {
        self.retire(ClearReason::ManualClear).await
    }

    /// Clear due to app locking.
    pub async fn clear_on_lock(&mut self) -> Result<bool, SecureClipError> {
        self.locked = true;
        if !self.config.clear_on_lock {
            return Ok(false);
        }
        self.retire(ClearReason::AppLocked).await
    }

    /// Mark the application as unlocked so policy-gated copies and pastes can resume.
    pub fn on_app_unlock(&mut self) {
        self.locked = false;
    }

    /// Synchronize policy with the authoritative native application lock state.
    /// Repeated locked observations retry an earlier failed owned-secret clear.
    ///
    /// This is the future the auto-lock transition callback returns, whose
    /// error type is `String`: the string is the fixed code and nothing else.
    pub async fn synchronize_lock_state(&mut self, locked: bool) -> Result<(), String> {
        Ok(self.apply_lock_state(locked).await?)
    }

    async fn apply_lock_state(&mut self, locked: bool) -> Result<(), SecureClipError> {
        if locked {
            self.clear_on_lock().await?;
        } else {
            self.on_app_unlock();
        }
        Ok(())
    }

    /// Record the authoritative lock state ahead of a policy-gated operation.
    ///
    /// The lock flag is always applied. A lock-time clear that cannot be
    /// verified is retried by the next observation and by the auto-clear
    /// watcher, and must not change the operation's own answer: a locked app
    /// answers `locked`, not whatever kept the clipboard from being examined.
    pub async fn observe_lock_state(&mut self, locked: bool) {
        if let Err(error) = self.apply_lock_state(locked).await {
            log::warn!("Secure clipboard lock-time clear is pending ({error})");
        }
    }

    /// Clear due to app exit.
    ///
    /// The exit path itself should call [`clear_on_exit_blocking`], which needs
    /// no async runtime and cannot wait indefinitely.
    pub async fn clear_on_exit(&mut self) -> Result<bool, SecureClipError> {
        if !self.config.clear_on_exit {
            return Ok(false);
        }
        self.retire(ClearReason::AppExit).await
    }

    async fn retire(&mut self, reason: ClearReason) -> Result<bool, SecureClipError> {
        let cleared = {
            let mut eng = self.engine.write().await;
            eng.clear(reason)?
        };
        if let Some(ref entry) = cleared {
            let mut hist = self.history.write().await;
            hist.record_clear(entry, reason);
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
    pub async fn update_config(&mut self, config: SecureClipConfig) -> Result<(), SecureClipError> {
        if self.locked && self.config.block_when_locked {
            return Err(SecureClipError::Locked);
        }
        if !(MIN_CLIPBOARD_BYTES..=MAX_CLIPBOARD_BYTES).contains(&config.max_value_bytes)
            || config.history_max_entries > 10_000
        {
            return Err(SecureClipError::InvalidRequest);
        }
        if config.auto_clear_secs > MAX_POLICY_CLEAR_SECS
            || config
                .kind_clear_overrides
                .values()
                .any(|seconds| *seconds > MAX_POLICY_CLEAR_SECS)
        {
            return Err(SecureClipError::InvalidRequest);
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
    use crate::engine::fake::FakeClipboard;

    /// A service on a fake clipboard, without the background watcher.
    fn service_on(clipboard: &FakeClipboard, config: SecureClipConfig) -> SecureClipService {
        SecureClipService {
            engine: Arc::new(RwLock::new(clipboard.engine())),
            history: Arc::new(RwLock::new(ClipHistory::new(config.history_max_entries))),
            config,
            locked: false,
            _auto_clear_task: None,
        }
    }

    fn service(config: SecureClipConfig) -> SecureClipService {
        service_on(&FakeClipboard::default(), config)
    }

    fn request(value: &str, clear_after_secs: Option<u64>) -> CopyRequest {
        CopyRequest {
            value: value.to_string(),
            kind: SecretKind::Password,
            label: None,
            connection_id: None,
            field: None,
            clear_after_secs,
            max_pastes: None,
            one_time: false,
        }
    }

    async fn copy_refusal(
        service: &mut SecureClipService,
        request: &CopyRequest,
    ) -> Option<SecureClipError> {
        service.copy(request).await.err()
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

    #[test]
    fn policy_refusals_carry_fixed_codes() {
        let mut service = service(SecureClipConfig::default());
        service.locked = true;
        assert_eq!(service.ensure_available(), Err(SecureClipError::Locked));
        assert_eq!(SecureClipError::Locked.to_string(), "locked");

        service.on_app_unlock();
        service.config.enabled = false;
        assert_eq!(
            service.ensure_available(),
            Err(SecureClipError::Unavailable)
        );
        assert_eq!(SecureClipError::Unavailable.to_string(), "unavailable");
    }

    #[tokio::test]
    async fn size_policy_is_validated_without_replacing_previous_config() {
        let mut service = service(SecureClipConfig::default());
        for invalid in [MIN_CLIPBOARD_BYTES - 1, MAX_CLIPBOARD_BYTES + 1] {
            assert_eq!(
                service
                    .update_config(SecureClipConfig {
                        max_value_bytes: invalid,
                        ..Default::default()
                    })
                    .await,
                Err(SecureClipError::InvalidRequest)
            );
            assert_eq!(
                service.get_config().max_value_bytes,
                DEFAULT_CLIPBOARD_BYTES
            );
        }
        for valid in [
            MIN_CLIPBOARD_BYTES,
            DEFAULT_CLIPBOARD_BYTES,
            MAX_CLIPBOARD_BYTES,
        ] {
            service
                .update_config(SecureClipConfig {
                    max_value_bytes: valid,
                    ..Default::default()
                })
                .await
                .expect("valid limit");
            assert_eq!(service.get_config().max_value_bytes, valid);
        }
        let mut value = serde_json::to_value(SecureClipConfig::default()).expect("config json");
        value
            .as_object_mut()
            .expect("object")
            .remove("maxValueBytes");
        assert_eq!(
            serde_json::from_value::<SecureClipConfig>(value)
                .expect("old settings")
                .max_value_bytes,
            DEFAULT_CLIPBOARD_BYTES
        );
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

    #[tokio::test]
    async fn every_copy_refusal_is_one_of_the_four_contract_codes() {
        let secret = request("fake-secret", None);

        // locked
        let clipboard = FakeClipboard::default();
        let mut locked = service_on(&clipboard, SecureClipConfig::default());
        locked.observe_lock_state(true).await;
        assert_eq!(
            copy_refusal(&mut locked, &secret).await,
            Some(SecureClipError::Locked)
        );
        assert_eq!(clipboard.sessions(), 0);

        // busy
        let clipboard = FakeClipboard::default();
        clipboard.hold_by_another_program(true);
        let mut busy = service_on(&clipboard, SecureClipConfig::default());
        assert_eq!(
            copy_refusal(&mut busy, &secret).await,
            Some(SecureClipError::Busy)
        );

        // too-large
        let clipboard = FakeClipboard::default();
        let mut service = service_on(
            &clipboard,
            SecureClipConfig {
                max_value_bytes: MIN_CLIPBOARD_BYTES,
                ..Default::default()
            },
        );
        let oversized = request(&"x".repeat(64 * 1024 + 1), None);
        assert_eq!(
            copy_refusal(&mut service, &oversized).await,
            Some(SecureClipError::TooLarge)
        );
        assert_eq!(clipboard.sessions(), 0);

        // unavailable: a malformed request, never a fifth code
        for malformed in [
            request("", None),
            request("fake\0secret", None),
            request("fake-secret", Some(0)),
            request("fake-secret", Some(MAX_REQUEST_CLEAR_SECS + 1)),
        ] {
            assert_eq!(
                copy_refusal(&mut service, &malformed).await,
                Some(SecureClipError::Unavailable)
            );
        }
        assert_eq!(clipboard.sessions(), 0, "refused before any write");

        // unavailable: policy and the OS clipboard
        let mut one_time = request("fake-secret", None);
        one_time.one_time = true;
        service.config.one_time_paste_available = false;
        assert_eq!(
            copy_refusal(&mut service, &one_time).await,
            Some(SecureClipError::Unavailable)
        );
        clipboard.reject_text(true);
        assert_eq!(
            copy_refusal(&mut service, &secret).await,
            Some(SecureClipError::Unavailable)
        );
        service.config.enabled = false;
        assert_eq!(
            copy_refusal(&mut service, &secret).await,
            Some(SecureClipError::Unavailable)
        );

        assert!(service.current().await.is_none());
        assert!(service.get_history().await.is_empty());
    }

    #[tokio::test]
    async fn a_locked_copy_answers_locked_even_while_the_lock_clear_is_pending() {
        let clipboard = FakeClipboard::default();
        let mut service = service_on(
            &clipboard,
            SecureClipConfig {
                clear_on_lock: true,
                ..SecureClipConfig::default()
            },
        );
        service
            .copy(&request("fake-secret", None))
            .await
            .expect("copy");
        clipboard.hold_by_another_program(true);

        // What the auto-lock callback sees: the fixed code, as its `String`.
        assert_eq!(
            service.synchronize_lock_state(true).await,
            Err("busy".to_string())
        );
        service.observe_lock_state(true).await;
        assert_eq!(
            copy_refusal(&mut service, &request("second-secret", None)).await,
            Some(SecureClipError::Locked)
        );
        assert_eq!(service.paste().await.err(), Some(SecureClipError::Locked));

        // The next observation retries the clear.
        clipboard.hold_by_another_program(false);
        service.observe_lock_state(true).await;
        assert!(clipboard.is_empty());
        assert!(service.current().await.is_none());
    }

    #[tokio::test]
    async fn a_copy_is_recorded_and_its_predecessor_marked_replaced() {
        let clipboard = FakeClipboard::default();
        let mut service = service_on(&clipboard, SecureClipConfig::default());
        let first = service
            .copy(&request("fake-secret", None))
            .await
            .expect("copy");
        let second = service
            .copy(&request("second-secret", Some(30)))
            .await
            .expect("copy");

        assert_eq!(clipboard.text().as_deref(), Some("second-secret"));
        assert_eq!(second.seconds_remaining.map(|left| left > 12), Some(true));
        let history = service.get_history().await;
        assert_eq!(history[0].id, second.id);
        assert_eq!(history[1].id, first.id);
        assert_eq!(history[1].clear_reason, Some(ClearReason::Replaced));
    }

    #[tokio::test]
    async fn exit_clear_removes_only_the_owned_value_and_honours_policy() {
        let secret = request("fake-secret", None);

        // Owned: removed.
        let clipboard = FakeClipboard::default();
        let mut service = service_on(&clipboard, SecureClipConfig::default());
        service.copy(&secret).await.expect("copy");
        assert_eq!(service.clear_on_exit().await, Ok(true));
        assert!(clipboard.is_empty());
        assert_eq!(
            service.get_history().await[0].clear_reason,
            Some(ClearReason::AppExit)
        );
        assert_eq!(service.clear_on_exit().await, Ok(false), "idempotent");

        // The user copied something else, or an image: left exactly as it is.
        let replacements: [fn(&FakeClipboard); 2] = [
            |clipboard| clipboard.user_copies_text("user-content"),
            |clipboard| clipboard.user_copies_an_image(),
        ];
        for replace in replacements {
            let clipboard = FakeClipboard::default();
            let mut service = service_on(&clipboard, SecureClipConfig::default());
            service.copy(&secret).await.expect("copy");
            replace(&clipboard);
            let changes = clipboard.changes().len();

            assert_eq!(service.clear_on_exit().await, Ok(true));
            assert_eq!(clipboard.changes().len(), changes);
            assert!(!clipboard.is_empty());
            assert!(service.current().await.is_none());
        }

        // Policy off: nothing is examined, nothing is cleared.
        let clipboard = FakeClipboard::default();
        let mut service = service_on(
            &clipboard,
            SecureClipConfig {
                clear_on_exit: false,
                ..SecureClipConfig::default()
            },
        );
        service.copy(&secret).await.expect("copy");
        let sessions = clipboard.sessions();
        assert_eq!(service.clear_on_exit().await, Ok(false));
        assert_eq!(clipboard.sessions(), sessions);
        assert_eq!(clipboard.text().as_deref(), Some("fake-secret"));
    }

    fn state_with_secret(
        clipboard: &FakeClipboard,
        config: SecureClipConfig,
    ) -> SecureClipServiceState {
        let mut service = service_on(clipboard, config);
        tokio::runtime::Builder::new_current_thread()
            .build()
            .expect("runtime")
            .block_on(service.copy(&request("fake-secret", None)))
            .expect("copy");
        Arc::new(RwLock::new(service))
    }

    #[test]
    fn blocking_exit_clear_needs_no_runtime_and_respects_ownership() {
        // Owned: removed, and recorded.
        let clipboard = FakeClipboard::default();
        let state = state_with_secret(&clipboard, SecureClipConfig::default());
        assert_eq!(clear_on_exit_blocking(&state), Ok(true));
        assert!(clipboard.is_empty());
        assert_eq!(clear_on_exit_blocking(&state), Ok(false), "idempotent");
        let service = state.try_read().expect("idle service");
        let history = service.history.try_read().expect("idle history");
        assert_eq!(history.list()[0].clear_reason, Some(ClearReason::AppExit));

        // Replaced by the user: untouched.
        let clipboard = FakeClipboard::default();
        let state = state_with_secret(&clipboard, SecureClipConfig::default());
        clipboard.user_copies_text("user-content");
        let changes = clipboard.changes().len();
        assert_eq!(clear_on_exit_blocking(&state), Ok(true));
        assert_eq!(clipboard.text().as_deref(), Some("user-content"));
        assert_eq!(clipboard.changes().len(), changes);

        // Policy off: untouched.
        let clipboard = FakeClipboard::default();
        let state = state_with_secret(
            &clipboard,
            SecureClipConfig {
                clear_on_exit: false,
                ..SecureClipConfig::default()
            },
        );
        assert_eq!(clear_on_exit_blocking(&state), Ok(false));
        assert_eq!(clipboard.text().as_deref(), Some("fake-secret"));

        // Ownership cannot be verified: reported, the entry is kept.
        let clipboard = FakeClipboard::default();
        let state = state_with_secret(&clipboard, SecureClipConfig::default());
        clipboard.hold_by_another_program(true);
        assert_eq!(clear_on_exit_blocking(&state), Err(SecureClipError::Busy));
        assert_eq!(clipboard.text().as_deref(), Some("fake-secret"));
    }

    #[test]
    fn blocking_exit_clear_gives_up_on_a_stuck_command_instead_of_hanging() {
        let clipboard = FakeClipboard::default();
        let state = state_with_secret(&clipboard, SecureClipConfig::default());

        let command_in_flight = state.try_write().expect("idle service");
        let started = Instant::now();
        assert_eq!(clear_on_exit_blocking(&state), Err(SecureClipError::Busy));
        let waited = started.elapsed();
        assert!(waited >= EXIT_LOCK_WAIT, "it waits for the command first");
        assert!(waited < EXIT_LOCK_WAIT + Duration::from_secs(5));
        assert_eq!(clipboard.text().as_deref(), Some("fake-secret"));

        drop(command_in_flight);
        assert_eq!(clear_on_exit_blocking(&state), Ok(true));
        assert!(clipboard.is_empty());
    }

    #[tokio::test]
    async fn settings_refusals_carry_fixed_codes() {
        let mut service = service(SecureClipConfig::default());
        for invalid in [
            SecureClipConfig {
                history_max_entries: 10_001,
                ..SecureClipConfig::default()
            },
            SecureClipConfig {
                auto_clear_secs: MAX_POLICY_CLEAR_SECS + 1,
                ..SecureClipConfig::default()
            },
            SecureClipConfig {
                kind_clear_overrides: [(SecretKind::Password, MAX_POLICY_CLEAR_SECS + 1)].into(),
                ..SecureClipConfig::default()
            },
        ] {
            assert_eq!(
                service.update_config(invalid).await,
                Err(SecureClipError::InvalidRequest)
            );
        }

        service.locked = true;
        assert_eq!(
            service.update_config(SecureClipConfig::default()).await,
            Err(SecureClipError::Locked)
        );
    }
}
