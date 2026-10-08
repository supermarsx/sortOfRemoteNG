//! Native sign-in cookies in the owning encrypted database. No CEF disk profile,
//! sidecar, DOM storage, or renderer cookie payload. All database IO is worker-only.
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sorng_browser_host::cef_session_retention::{
    cef_time, validate_cookies, CookieOwner, RetentionError, RetentionMode, RetentionPolicy,
    SignInCookie,
};
use sorng_commands_core::database_protection::native_browser_owner::{
    NativeCookieOwnerBinding, NativeOwnerLease,
};
use sorng_encryption::{database_protection::Zeroizing, EncryptionState};
use sorng_protocols::origin_browser::{BrowserIdentity, OriginBrowserPolicy};
use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex, OnceLock,
    },
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{Emitter, Manager, Runtime, WebviewWindow};
#[path = "origin_browser_retention_registry.rs"]
mod ownership;
use ownership::{Registry, Slot};
fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}
fn failure<T>(_: T) -> RetentionError {
    RetentionError::OwnerUnavailable
}
#[derive(Serialize, Deserialize)]
struct MemorySnapshot {
    created: u64,
    cookies: Vec<SignInCookie>,
}
fn registry() -> &'static Mutex<Registry<NativeOwnerLease>> {
    static STORE: OnceLock<Mutex<Registry<NativeOwnerLease>>> = OnceLock::new();
    STORE.get_or_init(Mutex::default)
}
fn retire(scope: &str, generation: u64, clear_memory: bool) -> Result<(), RetentionError> {
    let retired = registry()
        .lock()
        .map_err(failure)?
        .retire(scope, generation, clear_memory);
    // Destroy native leases only after releasing the registry mutex.
    drop(retired);
    Ok(())
}
pub struct NativeCookieRetention {
    lease: NativeOwnerLease,
    identity: BrowserIdentity,
    policy: RetentionPolicy,
    source: String,
    origins: Vec<String>,
    scope: String,
    generation: u64,
    created: Mutex<u64>,
    revision: Mutex<Option<String>>,
    invalidated: AtomicBool,
    dormant: AtomicBool,
    notify: Arc<dyn Fn() + Send + Sync>,
}
fn bindings(
    owner: &NativeCookieOwnerBinding,
    source: &str,
    origins: &[String],
    policy: RetentionPolicy,
) -> Result<(String, String), RetentionError> {
    let encode =
        |value: serde_json::Value| serde_json::to_vec(&value).map_err(|_| RetentionError::Invalid);
    let scope = format!(
        "{:x}",
        Sha256::digest(encode(serde_json::json!([
            owner.profile,
            owner.database,
            owner.connection
        ]))?)
    );
    let binding = format!(
        "{:x}",
        Sha256::digest(encode(serde_json::json!([
            scope,
            owner.window,
            owner.revision,
            owner.connection_digest,
            owner.unlock_epoch,
            source,
            origins,
            policy
        ]))?)
    );
    Ok((scope, binding))
}
impl NativeCookieRetention {
    pub async fn prepare<R: Runtime>(
        window: &WebviewWindow<R>,
        state: &EncryptionState,
        lease: &NativeOwnerLease,
        browser: &OriginBrowserPolicy,
        policy: RetentionPolicy,
    ) -> Result<Arc<Self>, RetentionError> {
        policy.validate()?;
        lease.recheck(window, state).await.map_err(failure)?;
        let (lease, owner) = lease.fork_for_cookie_retention().map_err(failure)?;
        if browser.identity().owner_database_id() != owner.database
            || browser.identity().connection_id() != owner.connection
            || window.label() != owner.window
        {
            return Err(RetentionError::OwnerUnavailable);
        }
        let (cleanup, _) = lease.fork_for_cookie_retention().map_err(failure)?;
        let mut origins = browser.allowed_origins().to_vec();
        origins.sort();
        origins.dedup();
        let (scope, binding) = bindings(&owner, browser.source_origin(), &origins, policy)?;
        let stamp = now();
        let app = window.app_handle().clone();
        let database_id = owner.database.clone();
        let notify: Arc<dyn Fn() + Send + Sync> = Arc::new(move || {
            let _ = app.emit(
                "database-protection:browser-sessions-changed",
                serde_json::json!({"databaseId":database_id}),
            );
        });
        let generation = {
            // The DB APIs take this coordinator before their final native
            // commit. Serialize writer handover with that entire transaction,
            // not just with its final boolean generation check.
            let _write = sorng_encryption::settings_coordinator::lock_settings_write().await;
            let retired = registry().lock().map_err(failure)?.prune();
            drop(retired);
            let (generation, retired) = lease
                .with_cookie_retention_key(|_| {
                    Ok(registry().lock().map_err(failure).and_then(|mut store| {
                        store.admit(
                            scope.clone(),
                            Slot {
                                generation: 0,
                                binding,
                                memory: None,
                                expires: stamp + u64::from(policy.max_age_hours) * 3600,
                                cleanup,
                                database_revision: None,
                                notify: notify.clone(),
                            },
                            lease.clone(),
                            stamp,
                        )
                    }))
                })
                .map_err(failure)??;
            // A previous owner's last EncryptionState clone may be here. Its
            // destructor takes the unlock mutex; the admission fence is over.
            drop(retired);
            generation
        };
        Ok(Arc::new(Self {
            lease,
            identity: browser.identity().clone(),
            policy,
            source: browser.source_origin().into(),
            origins,
            scope,
            generation,
            created: Mutex::new(stamp),
            revision: Mutex::new(None),
            invalidated: AtomicBool::new(false),
            dormant: AtomicBool::new(false),
            notify,
        }))
    }
    pub fn enabled(&self) -> bool {
        self.retains() && self.generation_current()
    }
    fn retains(&self) -> bool {
        self.policy.enabled() && !self.dormant.load(Ordering::Acquire)
    }
    pub fn invalidate(&self) {
        self.invalidated.store(true, Ordering::Release);
    }
    fn current(&self) -> bool {
        !self.invalidated.load(Ordering::Acquire)
            && registry()
                .lock()
                .is_ok_and(|r| r.current(&self.scope, self.generation))
    }
    fn write_current(&self) -> bool {
        !self.invalidated.load(Ordering::Acquire) && self.generation_current()
    }
    fn generation_current(&self) -> bool {
        registry()
            .lock()
            .is_ok_and(|r| r.writer(&self.scope, self.generation))
    }
    pub fn load(&self) -> Result<Vec<SignInCookie>, RetentionError> {
        if !self.current() {
            return Err(RetentionError::OwnerUnavailable);
        }
        let loaded =
            tauri::async_runtime::block_on(self.lease.load_cookie_record(|| self.current()))
                .map_err(failure)?;
        if loaded.changed {
            (self.notify)();
        }
        self.dormant.store(loaded.dormant, Ordering::Release);
        if loaded.dormant {
            return Ok(vec![]);
        }
        let record = loaded.record;
        *self.revision.lock().map_err(failure)? = record.as_ref().map(|r| r.revision.clone());
        if self.policy.mode != RetentionMode::EncryptedDatabase || !self.retains() {
            if record.is_some() {
                self.dormant.store(true, Ordering::Release);
                return Ok(vec![]);
            }
            if self.policy.mode != RetentionMode::Memory || !self.retains() {
                return Ok(vec![]);
            }
            let bytes =
                registry()
                    .lock()
                    .map_err(failure)?
                    .memory(&self.scope, self.generation, now());
            let Some(bytes) = bytes else {
                return Ok(vec![]);
            };
            let mut snapshot: MemorySnapshot =
                serde_json::from_slice(&bytes).map_err(|_| RetentionError::Invalid)?;
            *self.created.lock().map_err(failure)? = snapshot.created;
            let stamp = now();
            snapshot.cookies.retain(|c| {
                c.expires
                    .is_none_or(|e| e > cef_time(stamp).unwrap_or(i64::MAX))
            });
            validate_cookies(&snapshot.cookies, &self.origins, stamp)?;
            return Ok(snapshot.cookies);
        }
        let Some(mut record) = record else {
            return Ok(vec![]);
        };
        if record.expired(now()) {
            self.clear_database()?;
            return Ok(vec![]);
        }
        if record.source_origin != self.source
            || record.origins != self.origins
            || record.policy != self.policy
        {
            self.dormant.store(true, Ordering::Release);
            return Ok(vec![]);
        }
        *self.created.lock().map_err(failure)? = record.created;
        self.touch(record.created, Some(record.revision.clone()))?;
        let stamp = now();
        record.cookies.retain(|c| {
            c.expires
                .is_none_or(|e| e > cef_time(stamp).unwrap_or(i64::MAX))
        });
        validate_cookies(&record.cookies, &self.origins, stamp)?;
        Ok(record.cookies)
    }
    fn touch(&self, created: u64, revision: Option<String>) -> Result<(), RetentionError> {
        let mut store = registry().lock().map_err(failure)?;
        if !store.writer(&self.scope, self.generation) {
            return Ok(());
        }
        let slot = store
            .slots
            .get_mut(&self.scope)
            .ok_or(RetentionError::OwnerUnavailable)?;
        slot.expires = (created + u64::from(self.policy.max_age_hours) * 3600)
            .min(now() + u64::from(self.policy.idle_timeout_minutes) * 60);
        slot.database_revision = revision;
        Ok(())
    }
    fn storage_result<T>(
        &self,
        expected: &Option<String>,
        result: Result<T, String>,
    ) -> Result<Option<T>, RetentionError> {
        match result {
            Ok(value) => Ok(Some(value)),
            Err(_) if !self.generation_current() || !self.lease.is_current() => Ok(None),
            Err(error) => {
                // Another native operation (e.g. reviewed import/clear) can
                // replace the saved revision without admitting a new tab. Do
                // not retry a stale jar against its new revision, or repeatedly
                // try to delete it during close. Keep the live jar read-only.
                let loaded = tauri::async_runtime::block_on(
                    self.lease.load_cookie_record(|| self.generation_current()),
                )
                .map_err(failure)?;
                if loaded.changed {
                    (self.notify)();
                }
                let actual = loaded.record.as_ref().map(|r| r.revision.clone());
                if loaded.dormant || &actual != expected {
                    self.dormant.store(true, Ordering::Release);
                    let mut store = registry().lock().map_err(failure)?;
                    if let Some(slot) = store
                        .slots
                        .get_mut(&self.scope)
                        .filter(|s| s.generation == self.generation)
                    {
                        // This attempt cannot expire a replacement record.
                        slot.database_revision = None;
                    }
                    Ok(None)
                } else {
                    Err(failure(error))
                }
            }
        }
    }
    pub fn save(&self, mut cookies: Vec<SignInCookie>) -> Result<(), RetentionError> {
        if self.dormant.load(Ordering::Acquire) {
            return Ok(());
        }
        if !self.enabled() {
            return Ok(());
        }
        let stamp = now();
        let created = *self.created.lock().map_err(failure)?;
        if stamp < created
            || stamp.saturating_sub(created) >= u64::from(self.policy.max_age_hours) * 3600
        {
            self.clear_database()?;
            return Err(RetentionError::Expired);
        }
        cookies.retain(|c| {
            c.expires
                .is_none_or(|e| e > cef_time(stamp).unwrap_or(i64::MAX))
        });
        validate_cookies(&cookies, &self.origins, stamp)?;
        if self.policy.mode == RetentionMode::EncryptedDatabase {
            let expected = self.revision.lock().map_err(failure)?.clone();
            let result = tauri::async_runtime::block_on(self.lease.save_cookie_record(
                expected.clone(),
                cookies,
                self.source.clone(),
                self.origins.clone(),
                self.policy,
                || self.write_current(),
            ));
            // A successor may be admitted while this worker waits for the DB
            // coordinator. Losing persistence authority is not a jar failure.
            let Some(record) = self.storage_result(&expected, result)? else {
                return Ok(());
            };
            let revision = record.as_ref().map(|r| r.revision.clone());
            *self.revision.lock().map_err(failure)? = revision.clone();
            if expected != revision {
                (self.notify)();
            }
            if let Some(record) = record {
                *self.created.lock().map_err(failure)? = record.created;
                // Identical captures do not change logical revisions. Native
                // activity checkpoints are bounded to five minutes or close.
                self.touch(record.created, revision)?;
            } else {
                self.touch(created, None)?;
            }
            return Ok(());
        }
        let created = *self.created.lock().map_err(failure)?;
        let snapshot = MemorySnapshot { created, cookies };
        let bytes =
            Zeroizing::new(serde_json::to_vec(&snapshot).map_err(|_| RetentionError::Invalid)?);
        self.lease
            .with_cookie_retention_key(|_| {
                let mut store = registry()
                    .lock()
                    .map_err(|_| "session registry unavailable")?;
                if self.invalidated.load(Ordering::Acquire)
                    || !store.current(&self.scope, self.generation)
                {
                    return Err("session unavailable".into());
                }
                store
                    .save_memory(&self.scope, self.generation, bytes)
                    .map_err(|_| "session storage full")?;
                Ok(())
            })
            .map_err(failure)?;
        self.touch(created, None)
    }
    fn clear_database(&self) -> Result<(), RetentionError> {
        if !self.generation_current() || self.dormant.load(Ordering::Acquire) {
            return Ok(());
        }
        let expected = self.revision.lock().map_err(failure)?.clone();
        // An attempt that never loaded/saved a record owns nothing to delete.
        if expected.is_none() {
            return Ok(());
        }
        let result = tauri::async_runtime::block_on(
            self.lease
                .clear_cookie_record(expected.clone(), || self.generation_current()),
        );
        if self.storage_result(&expected, result)?.is_none() {
            return Ok(());
        }
        *self.revision.lock().map_err(failure)? = None;
        if expected.is_some() {
            (self.notify)();
        }
        if let Some(slot) = registry()
            .lock()
            .map_err(failure)?
            .slots
            .get_mut(&self.scope)
        {
            if slot.generation == self.generation {
                slot.database_revision = None;
            }
        }
        Ok(())
    }
    pub fn clear(&self) -> Result<(), RetentionError> {
        self.end(true)
    }
    pub fn revoke(&self) -> Result<(), RetentionError> {
        self.end(self.policy.clear_on_database_lock)
    }
    fn end(&self, delete: bool) -> Result<(), RetentionError> {
        self.invalidate();
        // The managed lock hook clears records before dropping its key.
        if delete && self.generation_current() && self.lease.is_current() {
            self.clear_database()?;
        }
        retire(&self.scope, self.generation, true)?;
        self.lease.revoke();
        Ok(())
    }
    pub fn finish(&self) -> Result<(), RetentionError> {
        if self.policy.mode == RetentionMode::EncryptedDatabase && self.enabled() {
            let expected = self.revision.lock().map_err(failure)?.clone();
            if expected.is_some() {
                let result = tauri::async_runtime::block_on(
                    self.lease
                        .touch_cookie_record(expected.clone(), || self.write_current()),
                );
                self.storage_result(&expected, result)?;
            }
        }
        self.invalidate();
        retire(&self.scope, self.generation, false)?;
        self.lease.revoke();
        Ok(())
    }
    pub fn housekeeping() -> Result<usize, RetentionError> {
        // Snapshot eviction must not invalidate still-live tabs. Unlock/key
        // revocation, however, removes every affected attempt independently.
        let attempts: Vec<_> = registry()
            .lock()
            .map_err(failure)?
            .active
            .iter()
            .map(|(generation, a)| (*generation, a.scope.clone(), a.lease.clone()))
            .collect();
        for (generation, scope, lease) in attempts {
            if !lease.is_current() {
                retire(&scope, generation, true)?;
            }
        }
        let candidates: Vec<_> = registry()
            .lock()
            .map_err(failure)?
            .slots
            .iter()
            .map(|(id, s)| {
                (
                    id.clone(),
                    s.generation,
                    s.expires,
                    s.cleanup.clone(),
                    s.database_revision.clone(),
                    s.notify.clone(),
                )
            })
            .collect();
        let mut cleaned = 0;
        for (scope, generation, expires, owner, revision, notify) in candidates {
            let current = owner.is_current();
            if current && now() < expires {
                continue;
            }
            if current && revision.is_some() {
                let removed =
                    tauri::async_runtime::block_on(owner.expire_cookie_record(revision, || {
                        registry().lock().is_ok_and(|r| {
                            r.snapshot_current(&scope, generation)
                                && r.slots.get(&scope).is_some_and(|s| s.expires <= now())
                        })
                    }))
                    .map_err(failure)?;
                if removed {
                    notify();
                }
            }
            let mut store = registry().lock().map_err(failure)?;
            if store.snapshot_current(&scope, generation)
                && (!current || store.slots.get(&scope).is_some_and(|s| s.expires <= now()))
            {
                store.slots.remove(&scope);
                cleaned += 1;
            }
        }
        Ok(cleaned)
    }
}
impl CookieOwner for NativeCookieRetention {
    fn identity(&self) -> &BrowserIdentity {
        &self.identity
    }
    fn with_current(&self, action: &mut dyn FnMut()) -> bool {
        // Final native publication shares this fence. OS stalls can exceed
        // capture/close deadlines. Busy needs tri-state semantics, not false.
        self.lease
            .with_cookie_retention_key(|_| {
                let store = registry()
                    .lock()
                    .map_err(|_| "session registry unavailable")?;
                if self.invalidated.load(Ordering::Acquire)
                    || !store.current(&self.scope, self.generation)
                {
                    return Err("session unavailable".into());
                }
                action();
                Ok(())
            })
            .is_ok()
    }
}
impl Drop for NativeCookieRetention {
    fn drop(&mut self) {
        let _ = retire(&self.scope, self.generation, true);
    }
}

#[cfg(test)]
#[path = "origin_browser_retention_tests.rs"]
mod integration_tests;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn memory_scope_separates_database_connection_window_and_unlock_attempt() {
        let owner = || NativeCookieOwnerBinding {
            profile: "fixture".into(),
            database: "database".into(),
            revision: "r1".into(),
            window: "main".into(),
            connection: "one".into(),
            connection_digest: [1; 32],
            unlock_epoch: [2; 32],
        };
        let origins = vec!["https://same.example".to_owned()];
        let original =
            bindings(&owner(), &origins[0], &origins, RetentionPolicy::default()).unwrap();
        for change in 0..4 {
            let mut different = owner();
            match change {
                0 => different.database = "other".into(),
                1 => different.connection = "two".into(),
                2 => different.window = "detached".into(),
                _ => different.unlock_epoch = [3; 32],
            }
            let updated = bindings(
                &different,
                &origins[0],
                &origins,
                RetentionPolicy::default(),
            )
            .unwrap();
            assert_ne!(original.1, updated.1);
            if change < 2 {
                assert_ne!(original.0, updated.0);
            } else {
                // Windows/attempts share ONE persisted connection snapshot,
                // but never another window/unlock epoch's in-memory cookies.
                assert_eq!(original.0, updated.0);
            }
        }
    }
}
