//! Native managed inner-database control plane. The renderer receives plaintext
//! only for an unlocked database, never DEKs, KEKs, or vault secret material.
use crate::database_files::{lock_database_operation, managed_snapshot, ManagedSnapshot};
// Shared artifact adapters also compile in app_lib, which intentionally has no
// database_files module. Expose the same guard through the existing public
// protection facade; do not duplicate or weaken its plaintext-vault checks.
#[doc(hidden)]
pub use crate::database_files::reject_plaintext_credential_vault;
#[doc(hidden)]
pub use crate::database_files::reject_unprotected_documents;
use crate::trust_store_commands as trust_reads;
use codec::Zeroizing;
use serde::Serialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use sorng_encryption::{
    database_protection::{
        self as codec, DataCipher, DatabaseEnvelope, DatabaseKey, NewSlotInput, ProtectionTarget,
        SlotInfo, SlotType,
    },
    database_sessions::{self, SessionScope},
    EncryptionState,
};
use std::{
    future::Future,
    path::{Path, PathBuf},
    pin::Pin,
};
use tauri::{Emitter, Manager, Runtime, State, WebviewWindow};

#[path = "database_browser_sessions.rs"]
pub mod browser_sessions;
pub use browser_sessions::{database_browser_sessions_export, database_browser_sessions_import};

#[path = "database_session_delegation.rs"]
pub mod delegation;

const VAULT_SERVICE: &str = "sortofremoteng.internal.database-protection.v1";

/// Generic runtime form of the same production commands, enabling real IPC
/// decoding/state extraction in temp-profile tests without a native WebView.
pub fn build<R: Runtime>() -> impl Fn(tauri::ipc::Invoke<R>) -> bool + Send + Sync + 'static {
    tauri::generate_handler![
        database_protection_capabilities,
        database_protection_status,
        database_protection_unlock,
        database_protection_lock,
        database_protection_release_session,
        delegation::database_protection_delegate_session,
        delegation::database_protection_load_plain,
        database_protection_save,
        database_protection_load,
        database_protection_change,
        browser_sessions::database_browser_sessions_export,
        browser_sessions::database_browser_sessions_import,
        browser_sessions::database_browser_sessions_describe,
        trust_migrate_legacy_database,
        trust_reassign_reviewed_scope,
        trust_reads::trust_get_effective_identity,
        trust_reads::trust_verify_identity,
    ]
}
type VaultFuture<'a, T> = Pin<Box<dyn Future<Output = Result<T, String>> + Send + 'a>>;
trait VaultProvider {
    fn available(&self) -> bool;
    fn put<'a>(&'a self, account: &'a str, key: &'a DatabaseKey) -> VaultFuture<'a, ()>;
    fn get<'a>(&'a self, account: &'a str) -> VaultFuture<'a, DatabaseKey>;
}
struct NativeVault;
impl VaultProvider for NativeVault {
    fn available(&self) -> bool {
        sorng_vault::keychain::is_available()
    }
    fn put<'a>(&'a self, account: &'a str, key: &'a DatabaseKey) -> VaultFuture<'a, ()> {
        Box::pin(async move {
            match sorng_vault::keychain::read_bytes_zeroizing(VAULT_SERVICE, account).await {
                Err(error)
                    if matches!(error.kind, sorng_vault::types::VaultErrorKind::NotFound) => {}
                _ => return Err("new database vault slot is not confirmed empty".into()),
            }
            let bytes = key.with_bytes(|bytes| Zeroizing::new(*bytes));
            sorng_vault::keychain::store_bytes(VAULT_SERVICE, account, &bytes[..])
                .await
                .map_err(|_| "could not store database unlock secret")?;
            let verified = self.get(account).await?;
            if !verified.with_bytes(|other| other == &*bytes) {
                return Err("database vault enrollment verification failed".into());
            }
            Ok(())
        })
    }
    fn get<'a>(&'a self, account: &'a str) -> VaultFuture<'a, DatabaseKey> {
        Box::pin(async move {
            let bytes = sorng_vault::keychain::read_bytes_zeroizing(VAULT_SERVICE, account)
                .await
                .map_err(|_| {
                    "database vault unlock secret unavailable; use a portable password slot"
                })?;
            DatabaseKey::from_bytes(&bytes)
        })
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProtectionStatus {
    kind: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    version: Option<u8>,
    #[serde(skip_serializing_if = "Option::is_none")]
    data_cipher: Option<DataCipher>,
    security_revision: String,
    slots: Vec<SlotInfo>,
    unlocked: bool,
    global_encryption_protected: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    session_expires_at: Option<u64>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UnlockResult {
    session_id: String,
    // Explicit null denotes an open-lifetime grant. Never omit this field:
    // older/malformed hosts must not be mistaken for unlimited authority.
    session_expires_at: Option<u64>,
    security_revision: String,
    data: Value,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangeResult {
    committed: bool,
    cleanup_pending: bool,
    warnings: Vec<String>,
    security_revision: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    session_id: Option<String>,
    session_expires_at: Option<u64>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveResult {
    committed: bool,
    cleanup_pending: bool,
    warnings: Vec<String>,
    security_revision: String,
    #[serde(skip)]
    browser_sessions_changed: bool,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LockResult {
    locked: bool,
    notification_pending: bool,
    warnings: Vec<String>,
}
#[derive(Serialize)]
pub struct ReleaseSessionResult {
    released: bool,
}

fn revoke_database_sessions(
    owner: u64,
    profile: &str,
    database_id: &str,
    notify: impl FnOnce() -> Result<(), String>,
) -> Result<LockResult, String> {
    database_sessions::global()
        .lock()
        .map_err(|_| "database session registry unavailable")?
        .revoke_database(owner, profile, database_id);
    // Revocation is authoritative. A later event delivery error cannot turn it
    // into an apparent failed lock and leave the initiating window exposed.
    let notification_pending = notify().is_err();
    Ok(LockResult {
        locked: true,
        notification_pending,
        warnings: if notification_pending {
            vec!["Database locked, but other-window notification failed. Other windows can no longer use their native unlock sessions.".into()]
        } else {
            Vec::new()
        },
    })
}
fn revision(snapshot: &ManagedSnapshot) -> &str {
    snapshot
        .row
        .get("securityRevision")
        .and_then(Value::as_str)
        .unwrap_or("")
}
fn is_managed(snapshot: &ManagedSnapshot) -> bool {
    snapshot.row.get("protectionFormat").is_some() || codec::is_managed(&snapshot.data)
}
fn profile_binding(profile: &Path) -> Result<String, String> {
    let canonical = profile
        .canonicalize()
        .map_err(|_| "database profile directory unavailable")?;
    Ok(format!(
        "{:x}",
        Sha256::digest(canonical.to_string_lossy().as_bytes())
    ))
}
fn native_root<R: Runtime>(
    window: &WebviewWindow<R>,
    state: &EncryptionState,
) -> Result<PathBuf, String> {
    state.artifact_policy_root().map(Ok).unwrap_or_else(|| {
        window
            .app_handle()
            .path()
            .app_data_dir()
            .map_err(|_| "database profile directory unavailable".into())
    })
}
fn scope<'a>(
    profile: &'a str,
    database: &'a str,
    revision: &'a str,
    window: &'a str,
    state: &EncryptionState,
) -> SessionScope<'a> {
    SessionScope {
        owner: state.database_session_owner(),
        profile,
        database,
        revision,
        window,
        generation: state.key_generation(),
    }
}
fn window_epoch(state: &EncryptionState, window: &str) -> Result<u64, String> {
    database_sessions::global()
        .lock()
        .map_err(|_| "database session registry unavailable")?
        .window_epoch(state.database_session_owner(), window)
}
fn insert_session(
    scope: &SessionScope<'_>,
    key: DatabaseKey,
    epoch: u64,
) -> Result<String, String> {
    database_sessions::global()
        .lock()
        .map_err(|_| "database session registry unavailable")?
        .insert_for_window(scope, key, epoch)
}
fn session_key(id: &str, scope: &SessionScope<'_>) -> Result<DatabaseKey, String> {
    database_sessions::global()
        .lock()
        .map_err(|_| "database session registry unavailable")?
        .key(id, scope)
}

/// Bounded numeric-only diagnostics, not authority. Startup callers must start
/// before authorization and carry clones through UI/context callbacks. A trace
/// ends at navigation submission (outcome 1), failure/cancellation (0), or an
/// explicitly observed first document completion (2). Never infer paint from it.
pub mod native_browser_timing {
    use std::sync::{
        atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering},
        mpsc, Arc, OnceLock,
    };
    use std::time::Instant;

    const MISSING: u64 = u64::MAX;
    const SLOTS: usize = 16;
    static STARTUPS: AtomicU32 = AtomicU32::new(0);
    static RECHECKS: AtomicU32 = AtomicU32::new(0);
    static SENDER: OnceLock<Option<mpsc::SyncSender<Report>>> = OnceLock::new();

    /// Each array entry is cumulative microseconds since create entry, not a
    /// wall-clock timestamp. The reached bitmask distinguishes missing from zero.
    #[repr(usize)]
    #[derive(Clone, Copy)]
    pub enum StartupStage {
        Authorized,
        RuntimeReady,
        InitialOwnerChecked,
        RetentionPrepared,
        CookiesLoaded,
        LoginPrepared,
        OwnerCheckedBeforeProxy,
        ProxyReady,
        OwnerCheckedBeforeContext,
        UiEntered,
        ContextCreated,
        ContextReady,
        BrowserAttached,
        FinalOwnerChecked,
        NavigationSubmitted,
        FirstDocumentComplete,
    }

    // Kind 1: StartupStage. Kind 2: recheck endpoints: memory checks, database
    // guard acquired, snapshot read, session key obtained, decrypt/parse, final
    // digest/dependency/window checks. Adjacent differences give phase costs.
    struct Report {
        kind: u8,
        outcome: u8,
        total_us: u64,
        reached: u32,
        us: [u64; SLOTS],
    }
    struct Active {
        start: Instant,
        kind: u8,
        marks: [AtomicU64; SLOTS],
        finished: AtomicBool,
        sender: mpsc::SyncSender<Report>,
    }
    #[derive(Clone, Default)]
    pub struct Trace(Option<Arc<Active>>);

    fn micros(start: Instant) -> u64 {
        start.elapsed().as_micros().min(u128::from(MISSING - 1)) as u64
    }
    fn sender() -> Option<&'static mpsc::SyncSender<Report>> {
        SENDER.get_or_init(|| {
            let (tx, rx) = mpsc::sync_channel::<Report>(64);
            std::thread::Builder::new().name("browser-stage-timing".into()).spawn(move || {
                for r in rx {
                    log::info!("Native browser timing: kind={} outcome={} total_us={} reached={} us={:?}",
                        r.kind, r.outcome, r.total_us, r.reached, r.us);
                }
            }).ok().map(|_| tx)
        }).as_ref()
    }
    impl Trace {
        fn sampled(
            count: &AtomicU32,
            limit: u32,
            kind: u8,
            sender: Option<&mpsc::SyncSender<Report>>,
        ) -> Self {
            Self(sender.and_then(|sender| {
                count
                    .fetch_update(Ordering::Relaxed, Ordering::Relaxed, |n| {
                        (n < limit).then(|| n + 1)
                    })
                    .ok()?;
                Some(Arc::new(Active {
                    start: Instant::now(),
                    kind,
                    marks: std::array::from_fn(|_| AtomicU64::new(MISSING)),
                    finished: AtomicBool::new(false),
                    sender: sender.clone(),
                }))
            }))
        }
        pub fn startup() -> Self {
            Self::sampled(&STARTUPS, 32, 1, sender())
        }
        pub(super) fn recheck() -> Self {
            Self::sampled(&RECHECKS, 128, 2, sender())
        }
        pub fn mark(&self, stage: StartupStage) {
            self.mark_slot(stage as usize);
        }
        pub(super) fn mark_slot(&self, slot: usize) {
            if let Some(active) = &self.0 {
                // First observation wins: repeated ticks/reloads cannot replace
                // the original attach/navigation measurement. No UI mutex.
                let _ = active.marks[slot].compare_exchange(
                    MISSING,
                    micros(active.start),
                    Ordering::Release,
                    Ordering::Relaxed,
                );
            }
        }
        pub fn finish(&self, outcome: u8) {
            if let Some(active) = &self.0 {
                active.finish(outcome);
            }
        }
        #[cfg(test)]
        pub(super) fn measured() -> Self {
            let (tx, _) = mpsc::sync_channel(1);
            Self::sampled(&AtomicU32::new(0), 1, 2, Some(&tx))
        }
        #[cfg(test)]
        pub(super) fn stages(&self) -> [u64; SLOTS] {
            std::array::from_fn(|i| self.0.as_ref().unwrap().marks[i].load(Ordering::Acquire))
        }
    }
    impl Active {
        fn finish(&self, outcome: u8) {
            if self.finished.swap(true, Ordering::AcqRel) {
                return;
            }
            let mut reached = 0;
            let us = std::array::from_fn(|i| {
                let value = self.marks[i].load(Ordering::Acquire);
                if value == MISSING {
                    0
                } else {
                    reached |= 1 << i;
                    value
                }
            });
            // No log/file I/O or waiting on the caller, even on queue overflow.
            let _ = self.sender.try_send(Report {
                kind: self.kind,
                outcome,
                total_us: micros(self.start),
                reached,
                us,
            });
        }
    }
    impl Drop for Active {
        fn drop(&mut self) {
            self.finish(0);
        }
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn concurrent_sampling_and_completion_are_bounded_and_first_mark_wins() {
            let count = AtomicU32::new(0);
            let (tx, rx) = mpsc::sync_channel(32);
            std::thread::scope(|scope| {
                for _ in 0..8 {
                    let count = &count;
                    let tx = &tx;
                    scope.spawn(move || {
                        for _ in 0..16 {
                            let trace = Trace::sampled(count, 32, 1, Some(tx));
                            trace.mark(StartupStage::Authorized);
                            if let Some(active) = &trace.0 {
                                let first = active.marks[0].load(Ordering::Acquire);
                                trace.clone().mark(StartupStage::Authorized);
                                assert_eq!(active.marks[0].load(Ordering::Acquire), first);
                            }
                            trace.clone().finish(1);
                            trace.finish(0);
                        }
                    });
                }
            });
            let reports: Vec<_> = rx.try_iter().collect();
            assert_eq!(reports.len(), 32);
            assert!(reports.iter().all(|r| r.reached == 1 && r.outcome == 1));
        }

        #[test]
        fn cancellation_and_full_or_disconnected_queue_never_wait() {
            let count = AtomicU32::new(0);
            let (tx, rx) = mpsc::sync_channel(1);
            let trace = Trace::sampled(&count, 32, 1, Some(&tx));
            let other = trace.clone();
            drop(trace);
            assert!(rx.try_recv().is_err());
            drop(other);
            // Queue is now full: all following reports must be discarded.
            drop(Trace::sampled(&count, 32, 1, Some(&tx)));
            assert_eq!(rx.try_recv().unwrap().outcome, 0);
            drop(rx);
            drop(Trace::sampled(&count, 32, 1, Some(&tx)));
            assert!(Trace::sampled(&count, 32, 1, None).0.is_none());
        }
    }
}

/// Native-only read/lease boundary. Neither plaintext databases nor unlock
/// tokens implement Debug or Serialize here. No command exposes this helper.
pub mod native_browser_owner {
    use super::*;
    use std::sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    };

    const UNAVAILABLE: &str = "Browser database owner is unavailable or changed";

    #[derive(Clone)]
    pub struct NativeOwnerLease(Arc<LeaseInner>);

    /// Native-only delivery result. Dormant records release no cookie bytes and
    /// must not be replaced by an empty checkpoint from a fresh browser jar.
    pub struct NativeCookieLoad {
        pub record: Option<browser_sessions::NativeCookieRecord>,
        pub dormant: bool,
        pub changed: bool,
    }

    type Dependencies = std::collections::BTreeMap<(bool, String), [u8; 32]>;

    /// One successful validation, private to this exact lease/token/generation.
    /// No plaintext, keys, timestamps or cross-owner cache. Both full parsed
    /// documents participate, including envelope metadata and the entire index.
    struct RecheckProof {
        content: ([u8; 32], [u8; 32]),
        dependencies: Dependencies,
    }

    fn recheck_content(snapshot: &ManagedSnapshot) -> Result<([u8; 32], [u8; 32]), String> {
        // managed_snapshot already validates the string envelope. Hash its
        // exact bytes directly: re-serializing a megabyte JSON string adds a
        // second escaping/allocation pass without adding any security binding.
        let envelope = snapshot.data.as_str().ok_or(UNAVAILABLE)?;
        Ok((
            digest(&snapshot.index)?,
            Sha256::digest(envelope.as_bytes()).into(),
        ))
    }

    struct LeaseInner {
        temporary: bool,
        state: EncryptionState,
        root: PathBuf,
        configured_root: Option<PathBuf>,
        profile: String,
        database: String,
        revision: String,
        window: String,
        token: Zeroizing<String>,
        session_validity: Option<database_sessions::SessionValidity>,
        generation: u64,
        connection_id: String,
        connection_digest: [u8; 32],
        dependencies: std::sync::Mutex<Dependencies>,
        recheck_proof: std::sync::Mutex<Option<RecheckProof>>,
        revoked: AtomicBool,
        cookie_gate: std::sync::Mutex<()>,
    }

    /// Native-only cookie artifact binding. Never an IPC argument or result.
    /// No unlock token or key is present; unlock_epoch is a one-way token digest.
    pub struct NativeCookieOwnerBinding {
        pub profile: String,
        pub database: String,
        pub revision: String,
        pub window: String,
        pub connection: String,
        pub connection_digest: [u8; 32],
        pub unlock_epoch: [u8; 32],
    }

    impl NativeOwnerLease {
        pub fn is_temporary(&self) -> bool {
            self.0.temporary
        }
        /// Worker-only native DB access. Renderer input cannot choose the
        /// database, connection, dependencies, key, or profile for this lease.
        async fn cookie_database<T>(
            &self,
            current: impl Fn() -> bool,
            operation: impl FnOnce(&mut Value, &Value) -> Result<(T, bool), String>,
        ) -> Result<T, String> {
            let inner = &self.0;
            if inner.temporary { return Err(UNAVAILABLE.into()); }
            let _guard = lock_database_operation(&inner.root.join("databases")).await?;
            if !self.is_current() || !current() {
                return Err(UNAVAILABLE.into());
            }
            let snapshot = managed_snapshot(&inner.root, &inner.state, &inner.database).await?;
            if !is_managed(&snapshot) || revision(&snapshot) != inner.revision {
                return Err(UNAVAILABLE.into());
            }
            let key = self.with_cookie_retention_key(|key| Ok(key.duplicate()))?;
            let mut envelope = DatabaseEnvelope::parse(&snapshot.data, &inner.database)?;
            let mut data = browser_sessions::SecretData(envelope.open(&key)?);
            if connection_digest(select_connection(&data.0, &inner.connection_id)?)?
                != inner.connection_digest
            {
                return Err(UNAVAILABLE.into());
            }
            self.validate_dependencies(&data.0)?;
            let settings =
                crate::app_settings_commands::read_app_settings_inner(&inner.root, &inner.state)
                    .await?
                    .unwrap_or(Value::Null);
            let (result, changed) = operation(&mut data.0, &settings)?;
            if changed {
                envelope.replace_data(&data.0, &key)?;
                crate::database_files::managed_commit_guarded(
                    &inner.root,
                    &inner.state,
                    &inner.database,
                    &inner.revision,
                    &snapshot.data,
                    &envelope.value()?,
                    &inner.revision,
                    |commit| {
                        self.with_cookie_retention_key(|_| {
                            if !current() {
                                return Err(UNAVAILABLE.into());
                            }
                            commit()
                        })
                    },
                )
                .await?;
            }
            self.with_cookie_retention_key(|_| {
                if current() {
                    Ok(result)
                } else {
                    Err(UNAVAILABLE.into())
                }
            })
        }

        pub async fn load_cookie_record(
            &self,
            current: impl Fn() -> bool,
        ) -> Result<NativeCookieLoad, String> {
            let id = self.0.connection_id.clone();
            self.cookie_database(current, |data, settings| {
                let cookie_disabled =
                    !crate::origin_browser_authority::NativeBrowserPreferences::from_saved(
                        select_connection(data, &id)?,
                        settings,
                    )
                    .map_err(|_| UNAVAILABLE)?
                    .capabilities
                    .cookies_enabled;
                let mut records = browser_sessions::private(data)?;
                let mut record = records
                    .records
                    .iter()
                    .position(|r| r.connection_id == id)
                    .map(|i| records.records.remove(i));
                if record.as_ref().is_some_and(|r| {
                    !browser_sessions::record_matches(data, r).unwrap_or(false)
                        || r.expired(browser_sessions::stamp())
                }) {
                    browser_sessions::put_private(data, records)?;
                    return Ok((
                        NativeCookieLoad {
                            record: None,
                            dormant: cookie_disabled,
                            changed: true,
                        },
                        true,
                    ));
                }
                // Archive/sync preservation is independent of this device's
                // settings. Only native admission may release these cookies;
                // a local opt-out/grant mismatch leaves ciphertext dormant.
                if cookie_disabled {
                    return Ok((
                        NativeCookieLoad {
                            record: None,
                            dormant: true,
                            changed: false,
                        },
                        false,
                    ));
                }
                if let Some(record) = record.as_mut() {
                    let now = sorng_browser_host::cef_session_retention::cef_time(
                        browser_sessions::stamp(),
                    )
                    .map_err(|_| UNAVAILABLE)?;
                    record
                        .cookies
                        .retain(|cookie| cookie.expires.is_none_or(|expires| expires > now));
                    if browser_sessions::validate_destination_scope(data, settings, record).is_err()
                    {
                        return Ok((
                            NativeCookieLoad {
                                record: None,
                                dormant: true,
                                changed: false,
                            },
                            false,
                        ));
                    }
                }
                Ok((
                    NativeCookieLoad {
                        record,
                        dormant: false,
                        changed: false,
                    },
                    false,
                ))
            })
            .await
        }

        pub async fn save_cookie_record(
            &self,
            expected: Option<String>,
            mut cookies: Vec<sorng_browser_host::cef_session_retention::SignInCookie>,
            source_origin: String,
            mut origins: Vec<String>,
            policy: sorng_browser_host::cef_session_retention::RetentionPolicy,
            current: impl Fn() -> bool,
        ) -> Result<Option<browser_sessions::NativeCookieRecord>, String> {
            use sorng_browser_host::cef_session_retention::validate_cookies;
            let inner = &self.0;
            origins.sort();
            origins.dedup();
            cookies.sort_by(|a, b| {
                (&a.origin, &a.domain, &a.path, &a.name)
                    .cmp(&(&b.origin, &b.domain, &b.path, &b.name))
            });
            let now = browser_sessions::stamp();
            validate_cookies(&cookies, &origins, now).map_err(|_| UNAVAILABLE)?;
            self.cookie_database(current, |data, settings| {
                let preferences =
                    crate::origin_browser_authority::NativeBrowserPreferences::from_saved(
                        select_connection(data, &inner.connection_id)?,
                        settings,
                    )
                    .map_err(|_| UNAVAILABLE)?;
                let effective: sorng_browser_host::cef_session_retention::RetentionPolicy =
                    serde_json::from_value(preferences.retention).map_err(|_| UNAVAILABLE)?;
                if policy != effective || !preferences.capabilities.cookies_enabled {
                    return Err(UNAVAILABLE.into());
                }
                let (saved_source, saved_origins) =
                    crate::origin_browser_authority::saved_retention_scope(
                        select_connection(data, &inner.connection_id)?,
                        settings,
                    )
                    .map_err(|_| UNAVAILABLE)?;
                if source_origin != saved_source || origins != saved_origins {
                    return Err(UNAVAILABLE.into());
                }
                let mut records = browser_sessions::private(data)?;
                let index = records
                    .records
                    .iter()
                    .position(|r| r.connection_id == inner.connection_id);
                if index.map(|i| records.records[i].revision.as_str()) != expected.as_deref() {
                    return Err(UNAVAILABLE.into());
                }
                if let Some(i) = index {
                    let old = &records.records[i];
                    // CEF may reset creation time when importing into a fresh
                    // jar. It is not a semantic sign-in change.
                    for cookie in &mut cookies {
                        if let Some(previous) = old.cookies.iter().find(|p| {
                            p.origin == cookie.origin
                                && p.domain == cookie.domain
                                && p.path == cookie.path
                                && p.name == cookie.name
                        }) {
                            cookie.creation = previous.creation;
                        }
                    }
                    if old.source_origin == source_origin
                        && old.policy == policy
                        && old.same_cookies(&cookies)?
                    {
                        let activity_interval =
                            (u64::from(policy.idle_timeout_minutes) * 30).clamp(30, 300);
                        if now.saturating_sub(old.last_used) < activity_interval
                            && old.origins == origins
                        {
                            return Ok((Some(records.records.remove(i)), false));
                        }
                        records.records[i].origins = origins;
                        records.records[i].last_used = now;
                        let bytes = Zeroizing::new(
                            serde_json::to_vec(&records.records[i]).map_err(|_| UNAVAILABLE)?,
                        );
                        browser_sessions::put_private(data, records)?;
                        return Ok((
                            Some(serde_json::from_slice(&bytes).map_err(|_| UNAVAILABLE)?),
                            true,
                        ));
                    }
                }
                let previous = index.map(|i| records.records.remove(i));
                if cookies.is_empty() {
                    if previous.is_some() {
                        browser_sessions::put_private(data, records)?;
                    }
                    return Ok((None, previous.is_some()));
                }
                // Drop the mutex guard before computing portable dependencies;
                // temporaries inside a struct literal otherwise live to its end.
                let dependencies: Vec<_> = inner
                    .dependencies
                    .lock()
                    .map_err(|_| UNAVAILABLE)?
                    .iter()
                    .map(|((v, id), digest)| (*v, id.clone(), *digest))
                    .collect();
                let portable_dependencies = dependencies
                    .iter()
                    .map(|(v, id, _)| {
                        Ok((
                            *v,
                            id.clone(),
                            browser_sessions::portable_digest(
                                select_dependency(data, *v, id)?,
                                *v,
                                &inner.database,
                            )?,
                        ))
                    })
                    .collect::<Result<Vec<_>, String>>()?;
                let mut record = browser_sessions::NativeCookieRecord {
                    connection_id: inner.connection_id.clone(),
                    revision: String::new(),
                    salt: previous
                        .as_ref()
                        .map(|r| r.salt.clone())
                        .unwrap_or_else(codec::random_id),
                    connection_digest: browser_sessions::retention_connection_digest(
                        select_connection(data, &inner.connection_id)?,
                    )?,
                    dependencies,
                    portable_connection_digest: browser_sessions::portable_digest(
                        select_connection(data, &inner.connection_id)?,
                        false,
                        &inner.database,
                    )?,
                    portable_dependencies,
                    source_origin,
                    origins,
                    policy,
                    created: previous
                        .as_ref()
                        .filter(|r| !r.expired(now))
                        .map_or(now, |r| r.created),
                    saved: now,
                    last_used: now,
                    cookies,
                };
                record.refresh_revision()?;
                if !browser_sessions::record_matches(data, &record)? {
                    return Err(UNAVAILABLE.into());
                }
                let bytes = Zeroizing::new(serde_json::to_vec(&record).map_err(|_| UNAVAILABLE)?);
                records.records.push(record);
                browser_sessions::put_private(data, records)?;
                Ok((
                    Some(serde_json::from_slice(&bytes).map_err(|_| UNAVAILABLE)?),
                    true,
                ))
            })
            .await
        }

        pub async fn clear_cookie_record(
            &self,
            expected: Option<String>,
            current: impl Fn() -> bool,
        ) -> Result<(), String> {
            self.remove_cookie_record(expected, false, current)
                .await
                .map(|_| ())
        }

        pub async fn expire_cookie_record(
            &self,
            expected: Option<String>,
            current: impl Fn() -> bool,
        ) -> Result<bool, String> {
            self.remove_cookie_record(expected, true, current).await
        }

        async fn remove_cookie_record(
            &self,
            expected: Option<String>,
            expired_only: bool,
            current: impl Fn() -> bool,
        ) -> Result<bool, String> {
            let id = self.0.connection_id.clone();
            self.cookie_database(current, |data, _settings| {
                let mut records = browser_sessions::private(data)?;
                let index = records.records.iter().position(|r| r.connection_id == id);
                if index.map(|i| records.records[i].revision.as_str()) != expected.as_deref() {
                    return Err(UNAVAILABLE.into());
                }
                if let Some(index) = index {
                    if expired_only && !records.records[index].expired(browser_sessions::stamp()) {
                        return Ok((false, false));
                    }
                    records.records.remove(index);
                    browser_sessions::put_private(data, records)?;
                    Ok((true, true))
                } else {
                    Ok((false, false))
                }
            })
            .await
        }

        pub async fn touch_cookie_record(
            &self,
            expected: Option<String>,
            current: impl Fn() -> bool,
        ) -> Result<(), String> {
            let id = self.0.connection_id.clone();
            self.cookie_database(current, |data, _settings| {
                let mut records = browser_sessions::private(data)?;
                let Some(record) = records.records.iter_mut().find(|r| r.connection_id == id)
                else {
                    return if expected.is_none() {
                        Ok(((), false))
                    } else {
                        Err(UNAVAILABLE.into())
                    };
                };
                if expected.as_deref() != Some(record.revision.as_str()) {
                    return Err(UNAVAILABLE.into());
                }
                let now = browser_sessions::stamp();
                if now <= record.last_used {
                    return Ok(((), false));
                }
                record.last_used = now;
                browser_sessions::put_private(data, records)?;
                Ok(((), true))
            })
            .await
        }

        /// Memory-only exact-token check. Never takes the session/commit mutex,
        /// opens files, duplicates keys or decrypts a DB.
        /// Revocation latches: a stale attempt cannot become current again.
        pub fn is_current(&self) -> bool {
            let inner = &self.0;
            let valid = !inner.revoked.load(Ordering::Acquire)
                && inner.state.key_generation() == inner.generation
                && inner.state.artifact_policy_root() == inner.configured_root
                && !inner.state.artifact_recovery_required()
                && (inner.temporary
                    || (!database_sessions::global().is_poisoned()
                        && inner
                            .session_validity
                            .as_ref()
                            .is_some_and(|token| token.is_current())));
            if !valid {
                // Authority is already invalid. Latch that observation without
                // waiting for a cookie operation to finish. Explicit revoke and
                // all key deliveries retain their existing serialization gates;
                // an in-flight operation also checks validity before returning.
                inner.revoked.store(true, Ordering::Release);
            }
            valid && !inner.revoked.load(Ordering::Acquire)
        }

        /// Revoke this browser lease and its clones, not the user's DB unlock.
        pub fn revoke(&self) {
            let _gate = self.0.cookie_gate.lock().unwrap_or_else(|e| e.into_inner());
            self.0.revoked.store(true, Ordering::Release);
        }

        /// Native-only bounded cookie operation. The database session mutex is
        /// held throughout delivery, serializing explicit lock/window closure
        /// with the operation. No key is retained by this lease or sent to IPC.
        /// `operation` must not call lease/session APIs recursively or await.
        pub fn with_cookie_retention_key<T>(
            &self,
            operation: impl FnOnce(&DatabaseKey) -> Result<T, String>,
        ) -> Result<T, String> {
            let inner = &self.0;
            if inner.temporary { return Err(UNAVAILABLE.into()); }
            let _gate = inner.cookie_gate.lock().map_err(|_| UNAVAILABLE)?;
            let valid = || {
                !inner.revoked.load(Ordering::Acquire)
                    && inner.state.key_generation() == inner.generation
                    && inner.state.artifact_policy_root() == inner.configured_root
                    && !inner.state.artifact_recovery_required()
            };
            if !valid() {
                return Err(UNAVAILABLE.into());
            }
            let mut sessions = database_sessions::global()
                .lock()
                .map_err(|_| UNAVAILABLE)?;
            let key = sessions.key(
                &inner.token,
                &scope(
                    &inner.profile,
                    &inner.database,
                    &inner.revision,
                    &inner.window,
                    &inner.state,
                ),
            )?;
            let result = operation(&key)?;
            if !valid() {
                return Err(UNAVAILABLE.into());
            }
            Ok(result)
        }

        /// Fork only the native owner lifetime. Disconnect may revoke the
        /// browser lease without invalidating a completed retention save, but
        /// database lock/window destruction/key rotation still fence this fork.
        pub fn fork_for_cookie_retention(
            &self,
        ) -> Result<(Self, NativeCookieOwnerBinding), String> {
            self.with_cookie_retention_key(|_| {
                let inner = &self.0;
                let dependencies = inner.dependencies.lock().map_err(|_| UNAVAILABLE)?.clone();
                // Referenced vault/proxy records can change independently of
                // this row. Bind their native security digests as well, so a
                // changed saved identity cannot inherit old sign-in cookies.
                let security = Zeroizing::new(
                    serde_json::to_vec(&(
                        inner.connection_digest,
                        dependencies.iter().collect::<Vec<_>>(),
                    ))
                    .map_err(|_| UNAVAILABLE)?,
                );
                let binding = NativeCookieOwnerBinding {
                    profile: inner.profile.clone(),
                    database: inner.database.clone(),
                    revision: inner.revision.clone(),
                    window: inner.window.clone(),
                    connection: inner.connection_id.clone(),
                    connection_digest: Sha256::digest(&*security).into(),
                    unlock_epoch: Sha256::digest(inner.token.as_bytes()).into(),
                };
                Ok((
                    Self(Arc::new(LeaseInner {
                        temporary: false,
                        state: inner.state.clone(),
                        root: inner.root.clone(),
                        configured_root: inner.configured_root.clone(),
                        profile: inner.profile.clone(),
                        database: inner.database.clone(),
                        revision: inner.revision.clone(),
                        window: inner.window.clone(),
                        token: Zeroizing::new(inner.token.to_string()),
                        session_validity: inner.session_validity.clone(),
                        generation: inner.generation,
                        connection_id: inner.connection_id.clone(),
                        connection_digest: inner.connection_digest,
                        dependencies: std::sync::Mutex::new(dependencies),
                        recheck_proof: std::sync::Mutex::new(None),
                        revoked: AtomicBool::new(false),
                        cookie_gate: std::sync::Mutex::new(()),
                    })),
                    binding,
                ))
            })
        }

        pub(crate) fn profile_root(&self) -> &Path {
            &self.0.root
        }

        /// Command/setup path only. Verifies the current native caller and
        /// on-disk security revision AND selected saved connection. Never
        /// renews a revoked lease; changed owners require a fresh create.
        pub async fn recheck<R: Runtime>(
            &self,
            window: &WebviewWindow<R>,
            state: &EncryptionState,
        ) -> Result<(), String> {
            let timing = native_browser_timing::Trace::recheck();
            let result = self.recheck_inner(window, state, &timing).await;
            if result.is_err() {
                self.revoke();
            }
            timing.finish(u8::from(result.is_ok()));
            result.map(|_| ()).map_err(|_| UNAVAILABLE.to_owned())
        }

        async fn recheck_inner<R: Runtime>(
            &self,
            window: &WebviewWindow<R>,
            state: &EncryptionState,
            timing: &native_browser_timing::Trace,
        ) -> Result<bool, String> {
            let inner = &self.0;
            if window.label() != inner.window
                || state.database_session_owner() != inner.state.database_session_owner()
                || !self.is_current()
            {
                return Err(UNAVAILABLE.into());
            }
            require_live_unlock_window(window, state)?;
            if native_root(window, state)? != inner.root {
                return Err(UNAVAILABLE.into());
            }
            timing.mark_slot(0);
            if inner.temporary {
                return Ok(false);
            }
            let _guard = lock_database_operation(&inner.root.join("databases")).await?;
            timing.mark_slot(1);
            if native_root(window, state)? != inner.root || !self.is_current() {
                return Err(UNAVAILABLE.into());
            }
            let snapshot = managed_snapshot(&inner.root, state, &inner.database).await?;
            timing.mark_slot(2);
            if !is_managed(&snapshot) || revision(&snapshot) != inner.revision {
                return Err(UNAVAILABLE.into());
            }
            let key = session_key(
                &inner.token,
                &scope(
                    &inner.profile,
                    &inner.database,
                    &inner.revision,
                    &inner.window,
                    state,
                ),
            )?;
            timing.mark_slot(3);
            let content = recheck_content(&snapshot)?;
            let reused = {
                // Only worker paths touch this cache. The database-operation
                // guard also serializes native dependency registration; keep
                // the dependency set and proof comparison in one short lease.
                let dependencies = inner.dependencies.lock().map_err(|_| UNAVAILABLE)?;
                let proof = inner.recheck_proof.lock().map_err(|_| UNAVAILABLE)?;
                proof
                    .as_ref()
                    .is_some_and(|proof| proof.content == content && proof.dependencies == *dependencies)
            };
            if !reused {
                let data = DatabaseEnvelope::parse(&snapshot.data, &inner.database)?.open(&key)?;
                let selected = select_connection(&data, &inner.connection_id)?;
                if connection_digest(selected)? != inner.connection_digest {
                    return Err(UNAVAILABLE.into());
                }
                let dependencies = inner.dependencies.lock().map_err(|_| UNAVAILABLE)?;
                validate_dependency_set(&data, &dependencies)?;
                *inner.recheck_proof.lock().map_err(|_| UNAVAILABLE)? = Some(RecheckProof {
                    content,
                    dependencies: dependencies.clone(),
                });
            }
            // Neither a cache hit nor publishing a proof renews authority.
            // Drop dependency/cache guards before any window-revocation path.
            timing.mark_slot(4);
            if !self.is_current() {
                return Err(UNAVAILABLE.into());
            }
            require_live_unlock_window(window, state)?;
            timing.mark_slot(5);
            Ok(reused)
        }

        fn validate_dependencies(&self, data: &Value) -> Result<(), String> {
            let dependencies = self.0.dependencies.lock().map_err(|_| UNAVAILABLE)?;
            validate_dependency_set(data, &dependencies)
        }

        /// Setup-only exact owning-database lookup. Registers the selected
        /// record in this attempt's immutable dependency set for recheck.
        pub(crate) async fn read_dependency<R: Runtime>(
            &self,
            window: &WebviewWindow<R>,
            state: &EncryptionState,
            vault: bool,
            id: &str,
        ) -> Result<Value, String> {
            if self.is_temporary() { return Err(UNAVAILABLE.into()); }
            let result = async {
                self.recheck(window, state).await?;
                let inner = &self.0;
                let _guard = lock_database_operation(&inner.root.join("databases")).await?;
                if !self.is_current() {
                    return Err(UNAVAILABLE.to_owned());
                }
                let snapshot = managed_snapshot(&inner.root, state, &inner.database).await?;
                if !is_managed(&snapshot) || revision(&snapshot) != inner.revision {
                    return Err(UNAVAILABLE.into());
                }
                let key = session_key(
                    &inner.token,
                    &scope(
                        &inner.profile,
                        &inner.database,
                        &inner.revision,
                        &inner.window,
                        state,
                    ),
                )?;
                let data = DatabaseEnvelope::parse(&snapshot.data, &inner.database)?.open(&key)?;
                if connection_digest(select_connection(&data, &inner.connection_id)?)?
                    != inner.connection_digest
                {
                    return Err(UNAVAILABLE.into());
                }
                self.validate_dependencies(&data)?;
                let selected = select_dependency(&data, vault, id)?;
                let fingerprint = digest(selected)?;
                let mut dependencies = inner.dependencies.lock().map_err(|_| UNAVAILABLE)?;
                if dependencies.len() >= 64 {
                    return Err(UNAVAILABLE.into());
                }
                if let Some(previous) = dependencies.insert((vault, id.into()), fingerprint) {
                    if previous != fingerprint {
                        return Err(UNAVAILABLE.into());
                    }
                }
                if !self.is_current() {
                    return Err(UNAVAILABLE.into());
                }
                require_live_unlock_window(window, state)?;
                Ok(selected.clone())
            }
            .await;
            if result.is_err() {
                self.revoke();
            }
            result.map_err(|_: String| UNAVAILABLE.into())
        }
    }

    fn validate_dependency_set(data: &Value, dependencies: &Dependencies) -> Result<(), String> {
        for ((vault, id), expected) in dependencies {
            if digest(select_dependency(data, *vault, id)?)? != *expected {
                return Err(UNAVAILABLE.into());
            }
        }
        Ok(())
    }

    #[cfg(test)]
    mod latency_tests {
        use super::*;
        use crate::origin_browser_authority::{
            authorize_create_with_certificate_hooks, NativeCertificateDecision,
            NativeCertificateEvidence,
        };
        use sorng_browser_host::ipc::OriginBrowserCreateRequest;
        use std::time::Instant;
        use tauri::test::{mock_builder, mock_context, noop_assets, MockRuntime};
        use tauri::{WebviewUrl, WebviewWindowBuilder};

        struct Fixture {
            _app: tauri::App<MockRuntime>,
            root: tempfile::TempDir,
            state: EncryptionState,
            window: WebviewWindow<MockRuntime>,
            request: OriginBrowserCreateRequest,
            plaintext_bytes: usize,
            key: DatabaseKey,
            envelope: DatabaseEnvelope,
            data: Value,
        }
        impl Fixture {
            async fn new(padding: usize) -> Self {
                let app = mock_builder().build(mock_context(noop_assets())).unwrap();
                let window = WebviewWindowBuilder::new(&app, "main", WebviewUrl::default())
                    .build()
                    .unwrap();
                let root = tempfile::tempdir().unwrap();
                let state = EncryptionState::new();
                sorng_encryption::artifact_policy::initialize(&state, root.path()).await;
                std::fs::create_dir(root.path().join("databases")).unwrap();
                let profile = profile_binding(root.path()).unwrap();
                let key = DatabaseKey::generate();
                let slot = codec::new_vault_slot(
                    "db",
                    "key",
                    "slot".into(),
                    &profile,
                    "fixture",
                    &DatabaseKey::generate(),
                    &key,
                )
                .unwrap();
                // No user profile, keychain, credentials or network. Padding is
                // unrelated DB content, not part of the selected row's digest.
                let data = json!({"connections":[{"id":"saved", "isGroup":false,
                            "protocol":"https", "hostname":"https://source.example/",
                            "port":443, "httpsTrustPolicy":"tofu", "httpAutoLogin":false}],
                            "settings":{}, "fixturePadding":"x".repeat(padding)});
                let plaintext_bytes = serde_json::to_vec(&data).unwrap().len();
                let envelope = DatabaseEnvelope::create(
                    "db",
                    "key",
                    "revision",
                    DataCipher::Aes256Gcm,
                    vec![slot],
                    &data,
                    &key,
                )
                .unwrap();
                sorng_storage::sdbf::safe_write(
                    &root.path().join("databases/index.json"),
                    &serde_json::to_vec(&json!([{"id":"db", "name":"fixture",
                            "isEncrypted":true, "protectionFormat":"sorng-db",
                            "securityRevision":"revision"}]))
                    .unwrap(),
                )
                .unwrap();
                sorng_storage::sdbf::safe_write(
                    &root.path().join("databases/db.json"),
                    &serde_json::to_vec(&envelope.value().unwrap()).unwrap(),
                )
                .unwrap();
                let token = database_sessions::global()
                    .lock()
                    .unwrap()
                    .insert(
                        &scope(&profile, "db", "revision", "main", &state),
                        key.duplicate(),
                    )
                    .unwrap();
                let request = serde_json::from_value(json!({
                    "owner":{"ownerDatabaseId":"db", "connectionId":"saved", "sessionId":"tab"},
                    "expectedSecurityRevision":"revision", "sourceSessionId":token,
                    "requestId":"create", "initialUrl":"https://source.example/",
                    "bounds":{"x":0,"y":0,"width":800,"height":600}, "visible":false,
                    "policy":{"darkMode":"forced", "autoLogin":{"enabled":true,
                        "consent":{"kind":"existing-grant", "grantId":"fixture-hint"}}}
                }))
                .unwrap();
                Self {
                    _app: app,
                    root,
                    state,
                    window,
                    request,
                    plaintext_bytes,
                    key,
                    envelope,
                    data,
                }
            }

            async fn lease(&self) -> NativeOwnerLease {
                read(
                    &self.window,
                    &self.state,
                    "db",
                    "saved",
                    "revision",
                    &self.request.source_session_id,
                )
                .await
                .unwrap()
                .1
            }

            fn write_data(&mut self, same_stamp: bool) {
                self.envelope.replace_data(&self.data, &self.key).unwrap();
                let path = self.root.path().join("databases/db.json");
                let bytes = serde_json::to_vec(&self.envelope.value().unwrap()).unwrap();
                if same_stamp {
                    write_same_stamp(&path, &bytes);
                } else {
                    sorng_storage::sdbf::safe_write(&path, &bytes).unwrap();
                }
            }
        }

        fn write_same_stamp(path: &Path, bytes: &[u8]) {
            let before = std::fs::metadata(path).unwrap();
            sorng_storage::sdbf::safe_write(path, bytes).unwrap();
            std::fs::OpenOptions::new()
                .write(true)
                .open(path)
                .unwrap()
                .set_times(std::fs::FileTimes::new().set_modified(before.modified().unwrap()))
                .unwrap();
            let after = std::fs::metadata(path).unwrap();
            assert_eq!(before.len(), after.len());
            assert_eq!(before.modified().unwrap(), after.modified().unwrap());
        }

        async fn reused(f: &Fixture, lease: &NativeOwnerLease) -> bool {
            lease
                .recheck_inner(
                    &f.window,
                    &f.state,
                    &native_browser_timing::Trace::default(),
                )
                .await
                .unwrap()
        }

        #[tokio::test]
        async fn recheck_cache_uses_exact_content_and_index_despite_same_length_and_mtime() {
            let mut f = Fixture::new(32).await;
            let lease = f.lease().await;
            assert!(reused(&f, &lease).await); // Seeded by the authenticated initial read.
            f.data["fixturePadding"] = "y".repeat(32).into();
            f.write_data(true);
            assert!(!reused(&f, &lease).await); // Harmless edit must still decrypt once.
            assert!(reused(&f, &lease).await);
            let index = f.root.path().join("databases/index.json");
            let bytes = std::fs::read(&index).unwrap();
            let mut value: Value =
                serde_json::from_slice(sorng_storage::sdbf::parse_and_verify(&bytes).unwrap()).unwrap();
            value[0]["name"] = "fixturf".into();
            write_same_stamp(&index, &serde_json::to_vec(&value).unwrap());
            assert!(!reused(&f, &lease).await); // Includes non-revision index fields.
            assert!(reused(&f, &lease).await);
            let (fork, _) = lease.fork_for_cookie_retention().unwrap();
            assert!(fork.0.recheck_proof.lock().unwrap().is_none());
            assert!(!reused(&f, &fork).await); // A distinct lease does not inherit the proof.
            assert!(reused(&f, &fork).await);
        }

        #[tokio::test]
        async fn recheck_cache_rejects_same_stamp_ciphertext_metadata_row_and_index_tampering() {
            for change in [
                "ciphertext",
                "keyId",
                "connection",
                "index-revision",
                "index-owner",
            ] {
                let mut f = Fixture::new(0).await;
                let lease = f.lease().await;
                assert!(reused(&f, &lease).await);
                let path = f.root.path().join(if change.starts_with("index") {
                    "databases/index.json"
                } else {
                    "databases/db.json"
                });
                let original = std::fs::read(&path).unwrap();
                let payload = sorng_storage::sdbf::parse_and_verify(&original).unwrap();
                let mut value: Value = serde_json::from_slice(payload).unwrap();
                match change {
                    "connection" => {
                        f.data["connections"][0]["hostname"] = "https://sourcf.example/".into();
                        f.envelope.replace_data(&f.data, &f.key).unwrap();
                        value = f.envelope.value().unwrap();
                    }
                    "ciphertext" => {
                        let mut envelope: Value =
                            serde_json::from_str(value.as_str().unwrap()).unwrap();
                        let mut encoded = envelope["ciphertext"].as_str().unwrap().as_bytes().to_vec();
                        encoded[0] = if encoded[0] == b'A' { b'B' } else { b'A' };
                        envelope["ciphertext"] = String::from_utf8(encoded).unwrap().into();
                        value = serde_json::to_string(&envelope).unwrap().into();
                    }
                    "keyId" => {
                        let mut envelope: Value =
                            serde_json::from_str(value.as_str().unwrap()).unwrap();
                        envelope["keyId"] = "kez".into();
                        value = serde_json::to_string(&envelope).unwrap().into();
                    }
                    "index-revision" => value[0]["securityRevision"] = "revisioo".into(),
                    _ => value[0]["id"] = "zz".into(),
                }
                write_same_stamp(&path, &serde_json::to_vec(&value).unwrap());
                assert!(lease.recheck(&f.window, &f.state).await.is_err());
                assert!(!lease.is_current());
                write_same_stamp(&path, payload);
                assert!(lease.recheck(&f.window, &f.state).await.is_err()); // No ABA revival.
            }
        }

        #[tokio::test]
        async fn recheck_cache_binds_new_dependencies_and_rejects_their_same_stamp_edits() {
            let mut f = Fixture::new(0).await;
            f.data["connections"]
                .as_array_mut()
                .unwrap()
                .push(json!({"id":"dependency", "hostname":"one"}));
            f.write_data(false);
            let lease = f.lease().await;
            assert!(reused(&f, &lease).await);
            lease
                .read_dependency(&f.window, &f.state, false, "dependency")
                .await
                .unwrap();
            assert!(!reused(&f, &lease).await); // Same ciphertext but a new exact dependency set.
            assert!(reused(&f, &lease).await);
            f.data["connections"][1]["hostname"] = "two".into();
            f.write_data(true);
            assert!(lease.recheck(&f.window, &f.state).await.is_err());
            assert!(!lease.is_current());
        }

        #[tokio::test]
        async fn recheck_cache_cannot_bypass_replacement_generation_profile_or_window_invalidation() {
            for change in ["replacement", "generation", "profile", "window"] {
                let f = Fixture::new(0).await;
                let lease = f.lease().await;
                assert!(reused(&f, &lease).await);
                let other_root = tempfile::tempdir().unwrap();
                match change {
                    "replacement" => {
                        database_sessions::global()
                            .lock()
                            .unwrap()
                            .insert(
                                &scope(
                                    &profile_binding(f.root.path()).unwrap(),
                                    "db",
                                    "revision",
                                    "main",
                                    &f.state,
                                ),
                                f.key.duplicate(),
                            )
                            .unwrap();
                    }
                    "generation" => {
                        f.state
                            .install(sorng_encryption::MasterDek::generate())
                            .await
                    }
                    "profile" => {
                        sorng_encryption::artifact_policy::initialize(&f.state, other_root.path()).await
                    }
                    _ => database_sessions::revoke_window(f.state.database_session_owner(), "main"),
                }
                assert!(lease.recheck(&f.window, &f.state).await.is_err());
                assert!(!lease.is_current());
            }
        }

        #[tokio::test]
        #[ignore = "isolated paired latency fixture; run with --ignored --nocapture --test-threads=1"]
        async fn isolated_recheck_cache_latency() {
            for padding in [0, 1024 * 1024] {
                let f = Fixture::new(padding).await;
                let lease = f.lease().await;
                for iteration in 0..5 {
                    *lease.0.recheck_proof.lock().unwrap() = None;
                    let start = Instant::now();
                    assert!(!reused(&f, &lease).await);
                    let cold_us = start.elapsed().as_micros();
                    let start = Instant::now();
                    assert!(reused(&f, &lease).await);
                    println!(
                        "fixture_bytes={} iteration={} cold_us={} cached_us={}",
                        f.plaintext_bytes,
                        iteration,
                        cold_us,
                        start.elapsed().as_micros()
                    );
                }
            }
        }
        impl Drop for Fixture {
            fn drop(&mut self) {
                database_sessions::revoke_owner(self.state.database_session_owner());
            }
        }

        /// Deliberately opt-in: serial isolated process because trust runtime
        /// installation is global. Reports numeric fixture costs, never claims
        /// app startup, renderer paint, or real certificate-chain validation.
        #[tokio::test]
        #[ignore = "isolated latency fixture; run alone with --ignored --nocapture --test-threads=1"]
        async fn isolated_saved_recheck_and_certificate_latency() {
            use base64::Engine;
            use sorng_storage::trust_store;
            // Public repository test certificate; no new certificate file.
            let pem = include_str!("../vendor/tiberius-rustls/docker/certs/server.crt");
            let encoded: String = pem
                .lines()
                .filter(|line| !line.starts_with("---"))
                .map(str::trim)
                .collect();
            let der = base64::engine::general_purpose::STANDARD
                .decode(encoded)
                .unwrap();
            for padding in [0, 1024 * 1024] {
                let f = Fixture::new(padding).await;
                let start = Instant::now();
                let authorized =
                    authorize_create_with_certificate_hooks(&f.window, &f.state, &f.request)
                        .await
                        .unwrap();
                let authorize_us = start.elapsed().as_micros();
                let runtime = trust_store::install_runtime(
                    f.root.path().join("databases"),
                    Some(Arc::new(f.state.clone())),
                );
                runtime
                    .activate_database(Some("db".into()), &["saved".into()])
                    .await
                    .unwrap();
                for iteration in 0..10 {
                    let before = native_browser_timing::Trace::measured();
                    authorized
                        .lease
                        .recheck_inner(&f.window, &f.state, &before)
                        .await
                        .unwrap();
                    let stages = before.stages();
                    let costs: Vec<_> = stages[..6]
                        .iter()
                        .scan(0, |previous, &end| {
                            let elapsed = end - *previous;
                            *previous = end;
                            Some(elapsed)
                        })
                        .collect();
                    let start = Instant::now();
                    let verdict = authorized
                        .certificates
                        .evaluate(NativeCertificateEvidence {
                            identity: authorized.policy.identity().clone(),
                            origin: "https://source.example".into(),
                            chain_der: vec![der.clone()],
                            // Synthetic native proof: this measures app evaluation
                            // and trust I/O, not cryptographic CA validation.
                            system_ca_valid: true,
                        })
                        .await
                        .unwrap();
                    let certificate_us = start.elapsed().as_micros();
                    assert!(matches!(verdict, NativeCertificateDecision::Allow(_)));
                    let start = Instant::now();
                    authorized.lease.recheck(&f.window, &f.state).await.unwrap();
                    let after_us = start.elapsed().as_micros();
                    println!("fixture_bytes={} iteration={} authorize_us={} before_us={} recheck_phases_us={:?} certificate_us={} after_us={}",
                                f.plaintext_bytes, iteration, authorize_us, stages[5], costs, certificate_us, after_us);
                }
                runtime.set_active(None, None).unwrap();
            }
        }
    }

    #[cfg(test)]
    mod cookie_owner_tests {
        use super::*;

        fn fixture() -> NativeOwnerLease {
            let state = EncryptionState::new();
            let key = DatabaseKey::generate();
            let token = database_sessions::global()
                .lock()
                .unwrap()
                .insert(&scope("profile", "db", "revision", "main", &state), key)
                .unwrap();
            let session_validity = database_sessions::global()
                .lock()
                .unwrap()
                .validity(&token, &scope("profile", "db", "revision", "main", &state))
                .unwrap();
            NativeOwnerLease(Arc::new(LeaseInner {
                temporary: false,
                configured_root: state.artifact_policy_root(),
                generation: state.key_generation(),
                state,
                root: PathBuf::from("fixture"),
                profile: "profile".into(),
                database: "db".into(),
                revision: "revision".into(),
                window: "main".into(),
                token: Zeroizing::new(token),
                session_validity: Some(session_validity),
                connection_id: "connection".into(),
                connection_digest: [1; 32],
                dependencies: std::sync::Mutex::new(Default::default()),
                recheck_proof: std::sync::Mutex::new(None),
                revoked: AtomicBool::new(false),
                cookie_gate: std::sync::Mutex::new(()),
            }))
        }

        #[test]
        fn cookie_fork_survives_browser_disconnect_but_not_database_lock() {
            let browser = fixture();
            let (retention, binding) = browser.fork_for_cookie_retention().unwrap();
            assert_eq!(binding.connection, "connection");
            browser.revoke();
            assert!(!browser.is_current());
            assert!(retention.with_cookie_retention_key(|_| Ok(())).is_ok());
            database_sessions::global().lock().unwrap().lock(
                retention.0.state.database_session_owner(),
                "profile",
                "db",
                "main",
            );
            let mut delivered = false;
            assert!(retention
                .with_cookie_retention_key(|_| {
                    delivered = true;
                    Ok(())
                })
                .is_err());
            assert!(!delivered);
        }

        #[test]
        fn referenced_credential_changes_invalidate_cookie_binding() {
            let browser = fixture();
            let (_, before) = browser.fork_for_cookie_retention().unwrap();
            browser
                .0
                .dependencies
                .lock()
                .unwrap()
                .insert((true, "saved-vault-entry".into()), [8; 32]);
            let (_, after) = browser.fork_for_cookie_retention().unwrap();
            assert_ne!(before.connection_digest, after.connection_digest);
            assert_eq!(before.connection, after.connection);
        }

        #[test]
        fn lock_and_reunlock_never_revive_old_browser_or_retention_leases() {
            let browser = fixture();
            let (retention, _) = browser.fork_for_cookie_retention().unwrap();
            let state = &browser.0.state;
            let binding = scope("profile", "db", "revision", "main", state);
            let mut sessions = database_sessions::global().lock().unwrap();
            sessions.lock(
                binding.owner,
                binding.profile,
                binding.database,
                binding.window,
            );
            let replacement = sessions.insert(&binding, DatabaseKey::generate()).unwrap();
            drop(sessions);
            assert!(!browser.is_current());
            assert!(!retention.is_current());
            assert!(retention.with_cookie_retention_key(|_| Ok(())).is_err());
            assert!(session_key(&replacement, &binding).is_ok());
            database_sessions::revoke_owner(binding.owner);
        }

        #[tokio::test]
        async fn generation_and_profile_invalidation_never_revive_clones() {
            for generation in [true, false] {
                let browser = fixture();
                let other = browser.clone();
                let root = tempfile::tempdir().unwrap();
                if generation {
                    browser
                        .0
                        .state
                        .install(sorng_encryption::MasterDek::generate())
                        .await;
                } else {
                    sorng_encryption::artifact_policy::initialize(&browser.0.state, root.path()).await;
                }
                assert!(!browser.is_current());
                assert!(!other.is_current());
                database_sessions::revoke_owner(browser.0.state.database_session_owner());
            }
        }

        /// The reader must finish while the real cookie delivery/commit gate is
        /// still held. A timeout detects the old registry-mutex dependency.
        #[test]
        fn memory_check_does_not_wait_for_cookie_commit_guard() {
            use std::{
                sync::mpsc,
                time::{Duration, Instant},
            };
            let browser = fixture();
            let owner = browser.0.state.database_session_owner();
            let (retention, _) = browser.fork_for_cookie_retention().unwrap();
            let (entered_tx, entered_rx) = mpsc::channel();
            let (release_tx, release_rx) = mpsc::channel();
            let commit = std::thread::spawn(move || {
                retention.with_cookie_retention_key(|_| {
                    entered_tx.send(()).unwrap();
                    release_rx.recv_timeout(Duration::from_secs(5)).unwrap();
                    Ok(())
                })
            });
            entered_rx.recv_timeout(Duration::from_secs(5)).unwrap();
            let (started_tx, started_rx) = mpsc::channel();
            let (done_tx, done_rx) = mpsc::channel();
            let reader = std::thread::spawn(move || {
                let start = Instant::now();
                started_tx.send(()).unwrap();
                let valid = browser.is_current();
                done_tx.send((valid, start.elapsed().as_micros())).unwrap();
            });
            started_rx.recv_timeout(Duration::from_secs(5)).unwrap();
            let completed = done_rx.recv_timeout(Duration::from_secs(2));
            release_tx.send(()).unwrap();
            commit.join().unwrap().unwrap();
            reader.join().unwrap();
            database_sessions::revoke_owner(owner);
            let (valid, elapsed) = completed.expect("memory check waited for the commit guard");
            assert!(valid);
            println!("commit_guard_held=1 memory_check_us={elapsed}");
        }

        #[test]
        fn invalid_memory_check_latches_without_waiting_for_same_lease_delivery() {
            use std::{sync::mpsc, time::Duration};
            let browser = fixture();
            let owner = browser.0.state.database_session_owner();
            let delivery_lease = browser.clone();
            let state = browser.0.state.clone();
            let (entered_tx, entered_rx) = mpsc::channel();
            let (release_tx, release_rx) = mpsc::channel();
            let delivery = std::thread::spawn(move || {
                delivery_lease.with_cookie_retention_key(|_| {
                    entered_tx.send(()).unwrap();
                    release_rx.recv_timeout(Duration::from_secs(5)).unwrap();
                    Ok(())
                })
            });
            entered_rx.recv_timeout(Duration::from_secs(5)).unwrap();
            state.set_artifact_recovery_required(true);
            let (done_tx, done_rx) = mpsc::channel();
            let checked = browser.clone();
            let reader = std::thread::spawn(move || {
                done_tx.send(checked.is_current()).unwrap();
            });
            let completed = done_rx.recv_timeout(Duration::from_secs(2));
            release_tx.send(()).unwrap();
            assert!(delivery.join().unwrap().is_err());
            reader.join().unwrap();
            assert!(!completed.expect("invalid check waited for cookie gate"));
            state.set_artifact_recovery_required(false);
            assert!(!browser.is_current());
            database_sessions::revoke_owner(owner);
        }

        #[test]
        fn explicit_browser_revocation_still_serializes_with_delivery() {
            use std::{sync::mpsc, time::Duration};
            let browser = fixture();
            let owner = browser.0.state.database_session_owner();
            let delivery_lease = browser.clone();
            let revoking_lease = browser.clone();
            let (entered_tx, entered_rx) = mpsc::channel();
            let (release_tx, release_rx) = mpsc::channel();
            let delivery = std::thread::spawn(move || {
                delivery_lease.with_cookie_retention_key(|_| {
                    entered_tx.send(()).unwrap();
                    release_rx.recv_timeout(Duration::from_secs(5)).unwrap();
                    Ok(())
                })
            });
            entered_rx.recv_timeout(Duration::from_secs(5)).unwrap();
            let (done_tx, done_rx) = mpsc::channel();
            let revoke = std::thread::spawn(move || {
                revoking_lease.revoke();
                done_tx.send(()).unwrap();
            });
            let blocked = done_rx.recv_timeout(Duration::from_millis(30)).is_err();
            release_tx.send(()).unwrap();
            delivery.join().unwrap().unwrap();
            revoke.join().unwrap();
            assert!(blocked);
            assert!(!browser.is_current());
            assert!(browser.with_cookie_retention_key(|_| Ok(())).is_err());
            database_sessions::revoke_owner(owner);
        }

        #[test]
        fn explicit_database_lock_serializes_with_cookie_delivery() {
            use std::sync::mpsc;
            use std::time::Duration;
            let browser = fixture();
            let (retention, _) = browser.fork_for_cookie_retention().unwrap();
            let owner = retention.0.state.database_session_owner();
            let worker = retention.clone();
            let (entered_tx, entered_rx) = mpsc::channel();
            let (release_tx, release_rx) = mpsc::channel();
            let delivery = std::thread::spawn(move || {
                worker.with_cookie_retention_key(|_| {
                    entered_tx.send(()).unwrap();
                    release_rx.recv_timeout(Duration::from_secs(5)).unwrap();
                    Ok(())
                })
            });
            entered_rx.recv_timeout(Duration::from_secs(5)).unwrap();
            let (locked_tx, locked_rx) = mpsc::channel();
            let (locking_tx, locking_rx) = mpsc::channel();
            let locking = std::thread::spawn(move || {
                locking_tx.send(()).unwrap();
                database_sessions::global()
                    .lock()
                    .unwrap()
                    .lock(owner, "profile", "db", "main");
                locked_tx.send(()).unwrap();
            });
            locking_rx.recv_timeout(Duration::from_secs(5)).unwrap();
            assert!(locked_rx.recv_timeout(Duration::from_millis(30)).is_err());
            release_tx.send(()).unwrap();
            delivery.join().unwrap().unwrap();
            locking.join().unwrap();
            locked_rx.recv_timeout(Duration::from_secs(5)).unwrap();
            assert!(retention.with_cookie_retention_key(|_| Ok(())).is_err());
        }
    }

    pub(super) fn select_dependency<'a>(
        data: &'a Value,
        vault: bool,
        id: &str,
    ) -> Result<&'a Value, String> {
        if !vault {
            return select_connection(data, id);
        }
        let vault = data.get("credentialVault").ok_or(UNAVAILABLE)?;
        if vault.get("version") != Some(&Value::from(1))
            || vault.get("revision").and_then(Value::as_u64).is_none()
        {
            return Err(UNAVAILABLE.into());
        }
        let rows = vault
            .get("entries")
            .and_then(Value::as_array)
            .ok_or(UNAVAILABLE)?;
        if rows.len() > 1000 {
            return Err(UNAVAILABLE.into());
        }
        let mut found = rows.iter().filter(|row| {
            row.get("id")
                .and_then(Value::as_str)
                .is_some_and(|saved| saved.eq_ignore_ascii_case(id))
        });
        let row = found.next().ok_or(UNAVAILABLE)?;
        if found.next().is_some() || !row.get("facets").is_some_and(Value::is_object) {
            return Err(UNAVAILABLE.into());
        }
        Ok(row)
    }

    pub(super) fn select_connection<'a>(data: &'a Value, id: &str) -> Result<&'a Value, String> {
        let rows = data
            .get("connections")
            .and_then(Value::as_array)
            .ok_or(UNAVAILABLE)?;
        if rows.len() > 100_000 {
            return Err(UNAVAILABLE.into());
        }
        let mut found = rows
            .iter()
            .filter(|row| row.get("id").and_then(Value::as_str) == Some(id));
        let row = found.next().ok_or(UNAVAILABLE)?;
        if found.next().is_some() {
            return Err(UNAVAILABLE.into());
        }
        Ok(row)
    }

    pub(super) fn digest(value: &Value) -> Result<[u8; 32], String> {
        let bytes = Zeroizing::new(serde_json::to_vec(value).map_err(|_| UNAVAILABLE)?);
        Ok(Sha256::digest(&*bytes).into())
    }

    /// Bookmark/library presentation changes do not alter this attempt's
    /// security authority. Keep every other field (including unknown future
    /// fields) in the digest: URLs, credentials, routing and automation consent
    /// edits still require a fresh attempt.
    pub(super) fn connection_digest(value: &Value) -> Result<[u8; 32], String> {
        let mut connection = value.clone();
        let object = connection.as_object_mut().ok_or(UNAVAILABLE)?;
        object.remove("httpBookmarks");
        object.remove("updatedAt");
        if let Some(automation) = object
            .get_mut("httpAutomation")
            .and_then(Value::as_object_mut)
        {
            automation.remove("items");
        }
        digest(&connection)
    }

    #[cfg(test)]
    pub(super) fn test_cookie_lease(
        root: &Path,
        state: &EncryptionState,
        token: &str,
        connection: &Value,
    ) -> NativeOwnerLease {
        let session_validity = database_sessions::global()
            .lock()
            .unwrap()
            .validity(token, &scope(&profile_binding(root).unwrap(), "db", "r1", "main", state))
            .unwrap();
        NativeOwnerLease(Arc::new(LeaseInner {
            temporary: false,
            state: state.clone(),
            root: root.into(),
            configured_root: state.artifact_policy_root(),
            profile: profile_binding(root).unwrap(),
            database: "db".into(),
            revision: "r1".into(),
            window: "main".into(),
            token: Zeroizing::new(token.into()),
            session_validity: Some(session_validity),
            generation: state.key_generation(),
            connection_id: connection["id"].as_str().unwrap().into(),
            connection_digest: connection_digest(connection).unwrap(),
            dependencies: std::sync::Mutex::new(Default::default()),
            recheck_proof: std::sync::Mutex::new(None),
            revoked: AtomicBool::new(false),
            cookie_gate: std::sync::Mutex::new(()),
        }))
    }

    #[cfg(test)]
    mod connection_digest_tests {
        use super::*;
        use serde_json::json;

        #[test]
        fn bookmark_and_favorite_edits_preserve_browser_authority() {
            let before = json!({"id":"website", "hostname":"https://example.test",
                "updatedAt":"before", "httpBookmarks":[],
                "httpAutomation":{"version":1,"items":[],"scriptInjectionEnabled":false}});
            let mut after = before.clone();
            after["updatedAt"] = json!("after");
            after["httpBookmarks"] = json!([{"name":"Docs","path":"/docs"}]);
            after["httpAutomation"]["items"] = json!([{"kind":"script","id":"saved"}]);
            assert_eq!(
                connection_digest(&before).unwrap(),
                connection_digest(&after).unwrap()
            );
        }

        #[test]
        fn consent_route_identity_and_unknown_changes_invalidate_authority() {
            let before = json!({"id":"website", "hostname":"https://example.test",
                "httpAutomation":{"version":1,"items":[],"scriptInjectionEnabled":false}});
            for (field, value) in [
                ("hostname", json!("https://other.test")),
                ("password", json!("changed-fixture")),
                ("httpsTrustPolicy", json!("strict")),
                ("proxyChain", json!(["different-route"])),
                ("futureSecurityField", json!(true)),
            ] {
                let mut changed = before.clone();
                changed[field] = value;
                assert_ne!(
                    connection_digest(&before).unwrap(),
                    connection_digest(&changed).unwrap()
                );
            }
            let mut changed = before.clone();
            changed["httpAutomation"]["scriptInjectionEnabled"] = json!(true);
            assert_ne!(
                connection_digest(&before).unwrap(),
                connection_digest(&changed).unwrap()
            );
        }
    }

    /// A temporary browser has a window/profile lifetime, never a database key.
    /// Its namespace cannot be used to read saved connections or vault entries.
    pub(crate) fn temporary<R: Runtime>(
        window: &WebviewWindow<R>,
        state: &EncryptionState,
        request: &sorng_browser_host::ipc::OriginBrowserCreateRequest,
        connection: &Value,
    ) -> Result<NativeOwnerLease, String> {
        request.validate().map_err(|_| UNAVAILABLE)?;
        if request.quick_connect.is_none() { return Err(UNAVAILABLE.into()); }
        require_live_unlock_window(window, state)?;
        let root = native_root(window, state)?;
        let lease = NativeOwnerLease(Arc::new(LeaseInner {
            temporary: true,
            state: state.clone(),
            profile: profile_binding(&root)?,
            root,
            configured_root: state.artifact_policy_root(),
            database: request.owner.owner_database_id.clone(),
            revision: String::new(),
            window: window.label().into(),
            token: Zeroizing::new(String::new()),
            session_validity: None,
            generation: state.key_generation(),
            connection_id: request.owner.connection_id.clone(),
            connection_digest: connection_digest(connection)?,
            dependencies: std::sync::Mutex::new(Default::default()),
            recheck_proof: std::sync::Mutex::new(None),
            revoked: AtomicBool::new(false),
            cookie_gate: std::sync::Mutex::new(()),
        }));
        if !lease.is_current() { return Err(UNAVAILABLE.into()); }
        Ok(lease)
    }

    /// Only the requested connection escapes this native module; the owning
    /// database is never searched through a global connection-ID index.
    pub(crate) async fn read<R: Runtime>(
        window: &WebviewWindow<R>,
        state: &EncryptionState,
        database: &str,
        connection_id: &str,
        expected_revision: &str,
        token: &str,
    ) -> Result<(Value, NativeOwnerLease), String> {
        async fn inner<R: Runtime>(
            window: &WebviewWindow<R>,
            state: &EncryptionState,
            database: &str,
            connection_id: &str,
            expected_revision: &str,
            token: &str,
        ) -> Result<(Value, NativeOwnerLease), String> {
            require_live_unlock_window(window, state)?;
            let root = native_root(window, state)?;
            let configured_root = state.artifact_policy_root();
            let _guard = lock_database_operation(&root.join("databases")).await?;
            if native_root(window, state)? != root {
                return Err(UNAVAILABLE.into());
            }
            let snapshot = managed_snapshot(&root, state, database).await?;
            if !is_managed(&snapshot) || revision(&snapshot) != expected_revision {
                return Err(UNAVAILABLE.into());
            }
            let profile = profile_binding(&root)?;
            let generation = state.key_generation();
            let key = session_key(
                token,
                &scope(&profile, database, expected_revision, window.label(), state),
            )?;
            let session_validity = database_sessions::global()
                .lock()
                .map_err(|_| UNAVAILABLE)?
                .validity(token, &scope(&profile, database, expected_revision, window.label(), state))?;
            let data = DatabaseEnvelope::parse(&snapshot.data, database)?.open(&key)?;
            let connection = select_connection(&data, connection_id)?.clone();
            let lease = NativeOwnerLease(Arc::new(LeaseInner {
                temporary: false,
                state: state.clone(),
                root,
                configured_root,
                profile,
                database: database.into(),
                revision: expected_revision.into(),
                window: window.label().into(),
                token: Zeroizing::new(token.into()),
                session_validity: Some(session_validity),
                generation,
                connection_id: connection_id.into(),
                connection_digest: connection_digest(&connection)?,
                dependencies: std::sync::Mutex::new(std::collections::BTreeMap::new()),
                // The initial read just authenticated this exact snapshot and
                // selected row; no dependency has been registered yet.
                recheck_proof: std::sync::Mutex::new(Some(RecheckProof {
                    content: recheck_content(&snapshot)?,
                    dependencies: Dependencies::new(),
                })),
                revoked: AtomicBool::new(false),
                cookie_gate: std::sync::Mutex::new(()),
            }));
            if !lease.is_current() {
                return Err(UNAVAILABLE.into());
            }
            require_live_unlock_window(window, state)?;
            Ok((connection, lease))
        }
        inner(
            window,
            state,
            database,
            connection_id,
            expected_revision,
            token,
        )
        .await
        .map_err(|_| UNAVAILABLE.into())
    }
}

fn require_live_unlock_window<R: Runtime>(
    window: &WebviewWindow<R>,
    state: &EncryptionState,
) -> Result<(), String> {
    if window
        .app_handle()
        .get_webview_window(window.label())
        .is_none()
    {
        database_sessions::revoke_window(state.database_session_owner(), window.label());
        return Err("Database window closed; reopen the database to unlock it".into());
    }
    Ok(())
}

/// The source remains in its database; only verified connection IDs cross into
/// the trust migration runtime. A managed lease is never exposed to the UI.
#[tauri::command]
pub async fn trust_migrate_legacy_database<R: Runtime>(
    window: WebviewWindow<R>,
    state: State<'_, EncryptionState>,
    database_id: String,
    expected_security_revision: String,
    source_session_id: Option<String>,
    expected_data: Option<Value>,
    connection_ids: Option<Vec<String>>,
) -> Result<sorng_storage::trust_store::TrustLegacyMigrationOutcome, String> {
    let coordinator = sorng_encryption::settings_coordinator::lock().await;
    let root = native_root(&window, &state)?;
    let snapshot = managed_snapshot(&root, &state, &database_id).await?;
    if revision(&snapshot) != expected_security_revision {
        return Err("Database security changed; unlock and review migration again".into());
    }
    let ids = verified_trust_scope_ids(
        &root,
        &state,
        window.label(),
        &database_id,
        &expected_security_revision,
        &snapshot,
        source_session_id.as_deref(),
        expected_data.as_ref(),
        connection_ids.as_deref(),
    )?;
    let profile = profile_binding(&root)?;
    let access_scope = scope(
        &profile,
        &database_id,
        &expected_security_revision,
        window.label(),
        &state,
    );
    sorng_storage::trust_store::runtime()?.migrate_legacy_database_with_coordinator_guard(
        &root,
        &database_id,
        &expected_security_revision,
        &snapshot.data,
        &ids,
        &coordinator,
        || {
            if let Some(session) = source_session_id.as_deref() {
                session_key(session, &access_scope)?;
            }
            Ok(())
        },
    )
}

#[allow(clippy::too_many_arguments)]
fn verified_trust_scope_ids(
    root: &Path,
    state: &EncryptionState,
    window: &str,
    database_id: &str,
    expected_security_revision: &str,
    snapshot: &ManagedSnapshot,
    source_session_id: Option<&str>,
    expected_data: Option<&Value>,
    connection_ids: Option<&[String]>,
) -> Result<Vec<String>, String> {
    if is_managed(snapshot) {
        if expected_data.is_some() || connection_ids.is_some() {
            return Err(
                "Managed trust migration derives scope from its native unlock session".into(),
            );
        }
        let session = source_session_id.ok_or("Unlock this managed database before migration")?;
        let profile = profile_binding(root)?;
        let scope = scope(
            &profile,
            database_id,
            expected_security_revision,
            window,
            state,
        );
        let key = session_key(session, &scope)?;
        let data = browser_sessions::SecretData(
            DatabaseEnvelope::parse(&snapshot.data, database_id)?.open(&key)?,
        );
        let ids = migration_connection_ids(&data.0)?;
        session_key(session, &scope)?;
        Ok(ids)
    } else if snapshot.data.is_string() {
        if source_session_id.is_some() || expected_data != Some(&snapshot.data) {
            return Err(
                "Legacy password migration requires its exact verified encrypted source snapshot"
                    .into(),
            );
        }
        Ok(connection_ids
            .ok_or("Unlock and verify the legacy database before migration")?
            .to_vec())
    } else {
        if source_session_id.is_some() || expected_data.is_some() || connection_ids.is_some() {
            return Err("Plain database migration derives its scope natively".into());
        }
        migration_connection_ids(&snapshot.data)
    }
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn trust_reassign_reviewed_scope<R: Runtime>(
    window: WebviewWindow<R>,
    state: State<'_, EncryptionState>,
    database_id: String,
    targets: Vec<sorng_storage::trust_store::ReviewedTrustScopeTarget>,
    target_connection_id: Option<String>,
    expected_security_revision: String,
    source_session_id: Option<String>,
    expected_data: Option<Value>,
    connection_ids: Option<Vec<String>>,
) -> Result<sorng_storage::trust_store::ReviewedTrustOutcome, String> {
    let coordinator = sorng_encryption::settings_coordinator::lock().await;
    let root = native_root(&window, &state)?;
    let snapshot = managed_snapshot(&root, &state, &database_id).await?;
    if revision(&snapshot) != expected_security_revision {
        return Err("Database security changed; review trust scope again".into());
    }
    let ids = verified_trust_scope_ids(
        &root,
        &state,
        window.label(),
        &database_id,
        &expected_security_revision,
        &snapshot,
        source_session_id.as_deref(),
        expected_data.as_ref(),
        connection_ids.as_deref(),
    )?;
    let profile = profile_binding(&root)?;
    let access = scope(
        &profile,
        &database_id,
        &expected_security_revision,
        window.label(),
        &state,
    );
    sorng_storage::trust_store::runtime()?.reassign_scope_with_coordinator_guard(
        &root,
        &database_id,
        &expected_security_revision,
        &snapshot.data,
        &ids,
        targets,
        target_connection_id.as_deref(),
        &coordinator,
        || {
            if let Some(session) = source_session_id.as_deref() {
                session_key(session, &access)?;
            }
            Ok(())
        },
    )
}

fn migration_connection_ids(data: &Value) -> Result<Vec<String>, String> {
    let connections = data
        .get("connections")
        .and_then(Value::as_array)
        .ok_or("Verified database connections are malformed")?;
    if connections.len() > 10_000 {
        return Err("Too many database connections for bounded trust migration".into());
    }
    connections
        .iter()
        .map(|connection| {
            connection
                .get("id")
                .and_then(Value::as_str)
                .map(str::to_owned)
                .ok_or_else(|| "A connection ID is missing from the verified database".into())
        })
        .collect()
}

#[tauri::command]
pub fn database_protection_capabilities() -> Value {
    json!({"schemaVersion":1,"ciphers":[
        {"id":"aes-256-gcm","available":true}, {"id":"chacha20-poly1305","available":true},
        {"id":"twofish-256-eax","available":true,"reason":"Advanced software-only alternative; not VeraCrypt compatible. AES/ChaCha are recommended. No independent audit, constant-time, or complete-zeroization guarantee."},
        {"id":"serpent-256-eax","available":true,"reason":"Advanced software-only alternative; not VeraCrypt compatible. AES/ChaCha are recommended. No independent audit, constant-time, or complete-zeroization guarantee."}
    ],"protectors":[
        {"id":"password","available":true,"deviceBound":false,"requiresUserPresence":false},
        {"id":"os-vault","available":NativeVault.available(),"deviceBound":true,"requiresUserPresence":false,"reason":"OS-account secret storage; not biometric or hardware-presence enforcement"},
        {"id":"webauthn-prf","available":false,"deviceBound":false,"requiresUserPresence":true,"reason":"A verified WebAuthn PRF/hmac-secret key provider is not implemented"},
        {"id":"biometric","available":false,"deviceBound":true,"requiresUserPresence":true,"reason":"A verified OS access-controlled key-release provider is not implemented; biometric hashes are not encryption secrets"}
    ]})
}

#[tauri::command]
pub async fn database_protection_status<R: Runtime>(
    window: WebviewWindow<R>,
    state: State<'_, EncryptionState>,
    database_id: String,
) -> Result<ProtectionStatus, String> {
    let root = native_root(&window, &state)?;
    let _guard = lock_database_operation(&root.join("databases")).await?;
    if native_root(&window, &state)? != root {
        return Err("Database profile changed; reload before retrying".into());
    }
    status_inner(&root, &state, window.label(), &database_id).await
}
async fn status_inner(
    root: &Path,
    state: &EncryptionState,
    window: &str,
    id: &str,
) -> Result<ProtectionStatus, String> {
    let snapshot = managed_snapshot(root, state, id).await?;
    let profile = profile_binding(root)?;
    let revision = revision(&snapshot).to_owned();
    let global_encryption_protected =
        crate::database_files::globally_protected_database(root, state, id).await?;
    if is_managed(&snapshot) {
        let envelope = DatabaseEnvelope::parse(&snapshot.data, id)?;
        let unlocked = database_sessions::global()
            .lock()
            .map_err(|_| "database session registry unavailable")?
            .is_unlocked(&scope(&profile, id, &revision, window, state));
        Ok(ProtectionStatus {
            kind: "managed",
            version: Some(codec::VERSION),
            data_cipher: Some(envelope.data_cipher),
            security_revision: revision,
            slots: envelope.slots.iter().map(|s| s.info()).collect(),
            unlocked,
            global_encryption_protected,
            session_expires_at: None,
        })
    } else {
        Ok(ProtectionStatus {
            kind: if snapshot.data.is_string() {
                "legacy-password"
            } else {
                "none"
            },
            version: None,
            data_cipher: None,
            security_revision: revision,
            slots: vec![],
            unlocked: !snapshot.data.is_string(),
            global_encryption_protected,
            session_expires_at: None,
        })
    }
}

#[tauri::command]
pub async fn database_protection_unlock<R: Runtime>(
    window: WebviewWindow<R>,
    state: State<'_, EncryptionState>,
    database_id: String,
    slot_id: String,
    password: Option<String>,
) -> Result<UnlockResult, String> {
    let password = password.map(Zeroizing::new);
    let root = native_root(&window, &state)?;
    let _guard = lock_database_operation(&root.join("databases")).await?;
    if native_root(&window, &state)? != root {
        return Err("Database profile changed; reload before retrying".into());
    }
    require_live_unlock_window(&window, &state)?;
    let result = unlock_inner(
        &root,
        &state,
        window.label(),
        &database_id,
        &slot_id,
        password,
        &NativeVault,
    )
    .await;
    // Also covers an IPC task first polled after native window destruction.
    // Normal mid-unlock destruction is fenced atomically by the window epoch.
    require_live_unlock_window(&window, &state)?;
    result
}
async fn unlock_inner(
    root: &Path,
    state: &EncryptionState,
    window: &str,
    id: &str,
    slot_id: &str,
    password: Option<Zeroizing<String>>,
    vault: &(impl VaultProvider + Sync),
) -> Result<UnlockResult, String> {
    let epoch = window_epoch(state, window)?;
    let snapshot = managed_snapshot(root, state, id).await?;
    let security_revision = revision(&snapshot).to_owned();
    let profile = profile_binding(root)?;
    let envelope = DatabaseEnvelope::parse(&snapshot.data, id)?;
    let slot = envelope.slot(slot_id)?;
    let key = match slot.slot_type {
        SlotType::Password => {
            let password = password.ok_or("password required for selected slot")?;
            let owned = envelope.clone();
            let slot_id = slot_id.to_owned();
            tokio::task::spawn_blocking(move || owned.unlock_password(&slot_id, &password))
                .await
                .map_err(|_| "database unlock task failed")??
        }
        SlotType::OsVault => {
            if password.is_some() {
                return Err("password supplied for vault slot".into());
            }
            let account = codec::vault_account(&profile, id, &envelope.key_id, slot_id)?;
            let kek = vault.get(&account).await?;
            envelope.unlock_vault(slot_id, &profile, &kek)?
        }
    };
    let mut data = envelope.open(&key)?;
    // Check persisted identity again even though production holds the shared
    // barrier: this also fences direct callers and delayed authentication.
    let current = managed_snapshot(root, state, id).await?;
    if current.data != snapshot.data || revision(&current) != security_revision {
        return Err("database changed during unlock; retry".into());
    }
    let session_id = insert_session(
        &scope(&profile, id, &security_revision, window, state),
        key,
        epoch,
    )?;
    session_key(
        &session_id,
        &scope(&profile, id, &security_revision, window, state),
    )?;
    browser_sessions::after_unlock(
        root,
        state,
        browser_sessions::SessionBinding {
            window,
            database: id,
            token: &session_id,
            revision: &security_revision,
        },
        &snapshot,
        &mut data,
    )
    .await?;
    Ok(UnlockResult {
        session_id,
        session_expires_at: None,
        security_revision,
        data: browser_sessions::project(data)?,
    })
}

#[tauri::command]
pub async fn database_protection_lock<R: Runtime>(
    window: WebviewWindow<R>,
    state: State<'_, EncryptionState>,
    database_id: String,
) -> Result<LockResult, String> {
    let _guard = sorng_encryption::settings_coordinator::lock_settings_write().await;
    sorng_storage::database_transaction::validate_database_id(&database_id)?;
    let root = native_root(&window, &state)?;
    let profile = profile_binding(&root)?;
    let cleanup = browser_sessions::before_lock(&root, &state, &database_id).await;
    let mut result = revoke_database_sessions(
        state.database_session_owner(),
        &profile,
        &database_id,
        || {
            window
                .app_handle()
                .emit(
                    "database-protection:locked",
                    json!({"databaseId":database_id}),
                )
                .map_err(|_| "database locked, but other-window notification failed".into())
        },
    )?;
    if cleanup.is_err() {
        result.warnings.push("Database locked; retained sign-in cookie cleanup is pending until its next native unlock".into());
    }
    Ok(result)
}

/// Cleanup for an abandoned unlock attempt, not a database-wide lock.
#[tauri::command]
pub async fn database_protection_release_session<R: Runtime>(
    window: WebviewWindow<R>,
    state: State<'_, EncryptionState>,
    database_id: String,
    session_id: String,
) -> Result<ReleaseSessionResult, String> {
    let _guard = sorng_encryption::settings_coordinator::lock_settings_write().await;
    sorng_storage::database_transaction::validate_database_id(&database_id)?;
    if session_id.is_empty()
        || session_id.len() > 128
        || !session_id.is_ascii()
        || session_id.bytes().any(|byte| byte.is_ascii_control())
    {
        return Err("invalid database unlock session token".into());
    }
    let profile = profile_binding(&native_root(&window, &state)?)?;
    let released = database_sessions::global()
        .lock()
        .map_err(|_| "database session registry unavailable")?
        .release(
            &session_id,
            state.database_session_owner(),
            &profile,
            &database_id,
            window.label(),
        )?;
    Ok(ReleaseSessionResult { released })
}

#[tauri::command]
pub async fn database_protection_save<R: Runtime>(
    window: WebviewWindow<R>,
    state: State<'_, EncryptionState>,
    database_id: String,
    session_id: String,
    expected_security_revision: String,
    data: Value,
    expected_data: Option<Value>,
) -> Result<SaveResult, String> {
    let root = native_root(&window, &state)?;
    let _guard = lock_database_operation(&root.join("databases")).await?;
    if native_root(&window, &state)? != root {
        return Err("Database profile changed; reload before retrying".into());
    }
    let result = save_inner(
        &root,
        &state,
        window.label(),
        &database_id,
        &session_id,
        &expected_security_revision,
        data,
        expected_data,
    )
    .await?;
    if result.committed && result.browser_sessions_changed {
        let _ = window.app_handle().emit(
            "database-protection:browser-sessions-changed",
            json!({"databaseId":database_id}),
        );
    }
    Ok(result)
}

#[tauri::command]
pub async fn database_protection_load<R: Runtime>(
    window: WebviewWindow<R>,
    state: State<'_, EncryptionState>,
    database_id: String,
    session_id: String,
    expected_security_revision: String,
) -> Result<UnlockResult, String> {
    let root = native_root(&window, &state)?;
    let _guard = lock_database_operation(&root.join("databases")).await?;
    if native_root(&window, &state)? != root {
        return Err("Database profile changed; reload before retrying".into());
    }
    let snapshot = managed_snapshot(&root, &state, &database_id).await?;
    if revision(&snapshot) != expected_security_revision {
        return Err("database security changed; unlock again".into());
    }
    let profile = profile_binding(&root)?;
    let current_scope = scope(
        &profile,
        &database_id,
        &expected_security_revision,
        window.label(),
        &state,
    );
    let key = session_key(&session_id, &current_scope)?;
    let data = DatabaseEnvelope::parse(&snapshot.data, &database_id)?.open(&key)?;
    // Do not release plaintext from a revoked session after a lengthy decrypt.
    session_key(&session_id, &current_scope)?;
    Ok(UnlockResult {
        session_id,
        security_revision: expected_security_revision,
        data: browser_sessions::project(data)?,
        session_expires_at: None,
    })
}
#[allow(clippy::too_many_arguments)] // Window/session/security/content boundaries are independent.
async fn save_inner(
    root: &Path,
    state: &EncryptionState,
    window: &str,
    id: &str,
    session: &str,
    expected_revision: &str,
    data: Value,
    expected_data: Option<Value>,
) -> Result<SaveResult, String> {
    let snapshot = managed_snapshot(root, state, id).await?;
    if revision(&snapshot) != expected_revision {
        return Err("database security changed; unlock again".into());
    }
    let profile = profile_binding(root)?;
    let key = session_key(
        session,
        &scope(&profile, id, expected_revision, window, state),
    )?;
    let envelope = DatabaseEnvelope::parse(&snapshot.data, id)?;
    let current = browser_sessions::SecretData(envelope.open(&key)?);
    let data = browser_sessions::SecretData(browser_sessions::merge_renderer(
        &current.0,
        data,
        expected_data,
    )?);
    let changed =
        browser_sessions::descriptor(&current.0)? != browser_sessions::descriptor(&data.0)?;
    let mut result = browser_sessions::commit_session_data(
        root,
        state,
        browser_sessions::SessionBinding {
            window,
            database: id,
            token: session,
            revision: expected_revision,
        },
        &snapshot,
        &data.0,
    )
    .await?;
    result.browser_sessions_changed = changed;
    Ok(result)
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn database_protection_change<R: Runtime>(
    window: WebviewWindow<R>,
    state: State<'_, EncryptionState>,
    database_id: String,
    expected_security_revision: String,
    expected_data: Value,
    source_session_id: Option<String>,
    legacy_verified_data: Option<Value>,
    target: Option<ProtectionTarget>,
    confirm_remove_protection: Option<bool>,
    confirm_device_bound_only: Option<bool>,
    initialize_empty_destination: Option<bool>,
) -> Result<ChangeResult, String> {
    let _guard = sorng_encryption::settings_coordinator::lock().await;
    let root = native_root(&window, &state)?;
    require_live_unlock_window(&window, &state)?;
    let result = change_inner_with_initialization(
        &root,
        &state,
        window.label(),
        &database_id,
        &expected_security_revision,
        expected_data,
        source_session_id,
        legacy_verified_data,
        target,
        confirm_remove_protection == Some(true),
        confirm_device_bound_only == Some(true),
        initialize_empty_destination == Some(true),
        &NativeVault,
    )
    .await;
    require_live_unlock_window(&window, &state)?;
    result
}

#[allow(clippy::too_many_arguments)]
async fn change_inner_with_initialization(
    root: &Path,
    state: &EncryptionState,
    window: &str,
    id: &str,
    expected_revision: &str,
    expected_data: Value,
    source_session: Option<String>,
    legacy_verified_data: Option<Value>,
    target: Option<ProtectionTarget>,
    confirm_remove: bool,
    confirm_device_only: bool,
    initialize_empty_destination: bool,
    vault: &(impl VaultProvider + Sync),
) -> Result<ChangeResult, String> {
    let epoch = window_epoch(state, window)?;
    let snapshot = managed_snapshot(root, state, id).await?;
    if let Some(target) = &target {
        if target
            .new_slots
            .iter()
            .any(|slot| matches!(slot, NewSlotInput::Password { .. }))
        {
            let policy = sorng_encryption::password_policy::read_locked(root, state).await?;
            for slot in &target.new_slots {
                if let NewSlotInput::Password { password, .. } = slot {
                    sorng_encryption::password_policy::validate(password, &policy, "database")?;
                }
            }
        }
    }
    if revision(&snapshot) != expected_revision || snapshot.data != expected_data {
        return Err(
            "database security or contents changed; reload before changing protection".into(),
        );
    }
    let profile = profile_binding(root)?;
    let old = if is_managed(&snapshot) {
        Some(DatabaseEnvelope::parse(&snapshot.data, id)?)
    } else {
        None
    };
    if initialize_empty_destination {
        // Match the actual empty DatabaseManager initialization shape exactly.
        // Other fields (including nonempty settings) may contain data and must
        // not be silently replaced by an import/clone initialization request.
        let empty = snapshot
            .data
            .get("timestamp")
            .and_then(Value::as_u64)
            .is_some()
            && snapshot.data
                == json!({"connections":[],"settings":{},"timestamp":snapshot.data["timestamp"]});
        if old.is_some() || target.is_none() || snapshot.row["isEncrypted"] != false || !empty {
            return Err("protected initialization requires an exact empty unprotected destination and a managed target".into());
        }
    }
    let (mut key, mut key_id, data) = if let Some(old) = &old {
        if legacy_verified_data.is_some() {
            return Err("managed data must be decrypted natively".into());
        }
        let key = session_key(
            source_session
                .as_deref()
                .ok_or("unlock managed database first")?,
            &scope(&profile, id, expected_revision, window, state),
        )?;
        let data = old.open(&key)?;
        (key, old.key_id.clone(), data)
    } else {
        if source_session.is_some() {
            return Err("legacy database cannot reuse a managed session".into());
        }
        let data = legacy_verified_data.ok_or("verified legacy database snapshot required")?;
        codec::validate_data(&data)?;
        if data.get(browser_sessions::PRIVATE).is_some()
            || data.get(browser_sessions::PUBLIC).is_some()
        {
            return Err(
                "Native browser sessions require native transfer into an unlocked managed database"
                    .into(),
            );
        }
        if snapshot.data.is_object() && snapshot.data != data && !initialize_empty_destination {
            return Err("plaintext legacy snapshot differs from stored data".into());
        }
        (DatabaseKey::generate(), codec::random_id(), data)
    };
    let managed = target.is_some();
    if !managed {
        if !browser_sessions::private(&data)?.records.is_empty() {
            return Err(
                "Clear retained sign-in cookies before removing managed database protection".into(),
            );
        }
        crate::database_files::require_document_protection(state, None, &data).await?;
        crate::database_files::require_credential_vault_protection(state, None, &data).await?;
    }
    let new_revision = codec::random_id();
    let output = if let Some(target) = target {
        if let Some(old) = &old {
            let retained: std::collections::BTreeSet<_> = target.keep_slot_ids.iter().collect();
            let removes_old = old.slots.iter().any(|slot| !retained.contains(&slot.id));
            if removes_old {
                if !target.keep_slot_ids.is_empty() {
                    return Err("Removing or replacing an unlock slot requires re-enrolling all desired protectors; old slots cannot be retained with the new database key".into());
                }
                key = DatabaseKey::generate();
                key_id = codec::random_id();
            }
        }
        if target.keep_slot_ids.len() + target.new_slots.len() > codec::MAX_SLOTS {
            return Err("at most eight database unlock slots are supported".into());
        }
        let mut slots = Vec::new();
        let mut seen = std::collections::BTreeSet::new();
        for id in target.keep_slot_ids {
            if !seen.insert(id.clone()) {
                return Err("duplicate retained slot".into());
            }
            slots.push(
                old.as_ref()
                    .ok_or("legacy database has no slots to retain")?
                    .slot(&id)?
                    .clone(),
            );
        }
        let password_present = slots.iter().any(|s| s.slot_type == SlotType::Password)
            || target
                .new_slots
                .iter()
                .any(|s| matches!(s, NewSlotInput::Password { .. }));
        if !password_present && !confirm_device_only {
            return Err("explicit confirmation required for device-bound-only database protection; no portable recovery password exists".into());
        }
        if slots.is_empty() && target.new_slots.is_empty() {
            return Err("at least one verified unlock slot is required".into());
        }
        for input in target.new_slots {
            match &input {
                NewSlotInput::Password {
                    label,
                    password,
                    argon2,
                } => {
                    // Argon2's memory/CPU work must not block async runtime workers.
                    let db = id.to_owned();
                    let key_id = key_id.clone();
                    let key = key.duplicate();
                    let label = label.clone();
                    let password = Zeroizing::new(password.clone());
                    let params = *argon2;
                    slots.push(
                        tokio::task::spawn_blocking(move || {
                            codec::new_password_slot(&db, &key_id, &label, &password, params, &key)
                        })
                        .await
                        .map_err(|_| "database slot creation task failed")??,
                    );
                }
                NewSlotInput::OsVault { label } => {
                    if !vault.available() {
                        return Err("OS vault unavailable; choose password protection".into());
                    }
                    let slot_id = codec::random_id();
                    let kek = DatabaseKey::generate();
                    let slot = codec::new_vault_slot(
                        id,
                        &key_id,
                        slot_id.clone(),
                        &profile,
                        label,
                        &kek,
                        &key,
                    )?;
                    let account = codec::vault_account(&profile, id, &key_id, &slot_id)?;
                    vault.put(&account, &kek).await?;
                    // Never delete a prior key on failed commit; a new orphan
                    // secret has no published ciphertext and is safer to retain.
                    slots.push(slot);
                }
            }
        }
        DatabaseEnvelope::create(
            id,
            &key_id,
            &new_revision,
            target.data_cipher,
            slots,
            &data,
            &key,
        )?
        .value()?
    } else {
        if !confirm_remove {
            return Err("explicit plaintext confirmation required".into());
        }
        data
    };
    if old.is_some() {
        session_key(
            source_session.as_deref().unwrap(),
            &scope(&profile, id, expected_revision, window, state),
        )?;
    }
    let generation = state.key_generation();
    let outcome = crate::database_files::managed_commit_guarded(
        root,
        state,
        id,
        expected_revision,
        &expected_data,
        &output,
        &new_revision,
        |commit| {
            if old.is_some() {
                let mut sessions = database_sessions::global()
                    .lock()
                    .map_err(|_| "database session registry unavailable")?;
                sessions.key(
                    source_session.as_deref().unwrap(),
                    &scope(&profile, id, expected_revision, window, state),
                )?;
                if generation != state.key_generation() {
                    return Err("Database owner changed during protection update".into());
                }
                commit()
            } else {
                commit()
            }
        },
    )
    .await?;
    let mut warnings = outcome.warnings;
    let session_id = match database_sessions::global().lock() {
        Ok(mut registry) => {
            registry.revoke_database(state.database_session_owner(), &profile, id);
            if managed {
                match registry.insert_for_window(
                    &scope(&profile, id, &new_revision, window, state),
                    key,
                    epoch,
                ) {
                    Ok(id) => Some(id),
                    Err(_) => {
                        warnings.push(
                            "Protection committed; unlock again to obtain a fresh session".into(),
                        );
                        None
                    }
                }
            } else {
                None
            }
        }
        Err(_) => {
            warnings.push(
                "Protection committed; native session registry unavailable; restart and unlock"
                    .into(),
            );
            None
        }
    };
    if let Some(token) = session_id.as_deref() {
        if browser_sessions::remember_unlock(root, state, window, id, &new_revision, token).is_err()
        {
            warnings.push(
                "Database protection committed; browser session cleanup tracking is unavailable"
                    .into(),
            );
        }
    }
    Ok(ChangeResult {
        committed: outcome.committed,
        cleanup_pending: outcome.cleanup_pending,
        warnings,
        security_revision: new_revision,
        session_id,
        session_expires_at: None,
    })
}

#[cfg(test)]
#[allow(clippy::too_many_arguments)]
async fn change_inner(
    root: &Path,
    state: &EncryptionState,
    window: &str,
    id: &str,
    expected_revision: &str,
    expected_data: Value,
    source_session: Option<String>,
    legacy_verified_data: Option<Value>,
    target: Option<ProtectionTarget>,
    confirm_remove: bool,
    confirm_device_only: bool,
    vault: &(impl VaultProvider + Sync),
) -> Result<ChangeResult, String> {
    change_inner_with_initialization(
        root,
        state,
        window,
        id,
        expected_revision,
        expected_data,
        source_session,
        legacy_verified_data,
        target,
        confirm_remove,
        confirm_device_only,
        false,
        vault,
    )
    .await
}

#[cfg(test)]
#[path = "database_protection_tests.rs"]
mod tests;
