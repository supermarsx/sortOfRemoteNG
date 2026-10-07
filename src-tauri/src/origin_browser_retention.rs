//! Native sign-in cookies in the owning encrypted database. No CEF disk profile,
//! sidecar, DOM storage, or renderer cookie payload. All database IO is worker-only.
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sorng_browser_host::cef_session_retention::{
    cef_time, validate_cookies, CookieOwner, RetentionError, RetentionMode, RetentionPolicy,
    SignInCookie, MAX_TOTAL_BYTES,
};
use sorng_commands_core::database_protection::native_browser_owner::{
    NativeCookieOwnerBinding, NativeOwnerLease,
};
use sorng_encryption::{database_protection::Zeroizing, EncryptionState};
use sorng_protocols::origin_browser::{BrowserIdentity, OriginBrowserPolicy};
use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex, OnceLock,
    },
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{Emitter, Manager, Runtime, WebviewWindow};
const MAX_ACTIVE: usize = 64;
const MAX_TRACKED: usize = 1024;
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
struct Slot {
    generation: u64,
    binding: String,
    active: bool,
    memory: Option<Zeroizing<Vec<u8>>>,
    expires: u64,
    cleanup: NativeOwnerLease,
    database_revision: Option<String>,
    notify: Arc<dyn Fn() + Send + Sync>,
}
#[derive(Default)]
struct Registry {
    next: u64,
    slots: HashMap<String, Slot>,
}
impl Registry {
    fn current(&self, scope: &str, generation: u64, active: bool) -> bool {
        self.slots
            .get(scope)
            .is_some_and(|slot| slot.generation == generation && (!active || slot.active))
    }
    fn can_admit(&self, scope: &str) -> bool {
        capacity_available(
            self.slots.len(),
            self.slots.values().filter(|s| s.active).count(),
            self.slots.contains_key(scope),
            self.slots.get(scope).is_some_and(|s| s.active),
        )
    }
}
fn capacity_available(
    tracked: usize,
    active: usize,
    existing: bool,
    existing_active: bool,
) -> bool {
    (existing || tracked < MAX_TRACKED) && (existing_active || active < MAX_ACTIVE)
}
fn registry() -> &'static Mutex<Registry> {
    static STORE: OnceLock<Mutex<Registry>> = OnceLock::new();
    STORE.get_or_init(Mutex::default)
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
            owner.window,
            owner.connection
        ]))?)
    );
    let binding = format!(
        "{:x}",
        Sha256::digest(encode(serde_json::json!([
            scope,
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
            let mut store = registry().lock().map_err(failure)?;
            store
                .slots
                .retain(|_, s| s.active || s.memory.is_some() || s.database_revision.is_some());
            if !store.can_admit(&scope) {
                return Err(RetentionError::Limit);
            }
            store.next = store.next.checked_add(1).ok_or(RetentionError::Limit)?;
            let generation = store.next;
            let memory = store
                .slots
                .remove(&scope)
                .filter(|s| s.binding == binding && s.expires > stamp)
                .and_then(|s| s.memory);
            store.slots.insert(
                scope.clone(),
                Slot {
                    generation,
                    binding,
                    active: true,
                    memory,
                    expires: stamp + u64::from(policy.max_age_hours) * 3600,
                    cleanup,
                    database_revision: None,
                    notify: notify.clone(),
                },
            );
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
        self.policy.enabled() && !self.dormant.load(Ordering::Acquire)
    }
    pub fn invalidate(&self) {
        self.invalidated.store(true, Ordering::Release);
    }
    fn current(&self) -> bool {
        !self.invalidated.load(Ordering::Acquire)
            && registry()
                .lock()
                .is_ok_and(|r| r.current(&self.scope, self.generation, true))
    }
    fn generation_current(&self) -> bool {
        registry()
            .lock()
            .is_ok_and(|r| r.current(&self.scope, self.generation, false))
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
        if self.policy.mode != RetentionMode::EncryptedDatabase || !self.enabled() {
            if record.is_some() {
                self.dormant.store(true, Ordering::Release);
                return Ok(vec![]);
            }
            if self.policy.mode != RetentionMode::Memory || !self.enabled() {
                return Ok(vec![]);
            }
            let bytes = registry()
                .lock()
                .map_err(failure)?
                .slots
                .get(&self.scope)
                .and_then(|s| s.memory.as_ref())
                .map(|b| Zeroizing::new(b.to_vec()));
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
        if !store.current(&self.scope, self.generation, true) {
            return Err(RetentionError::OwnerUnavailable);
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
            let record = tauri::async_runtime::block_on(self.lease.save_cookie_record(
                expected.clone(),
                cookies,
                self.source.clone(),
                self.origins.clone(),
                self.policy,
                || self.current(),
            ))
            .map_err(failure)?;
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
                    || !store.current(&self.scope, self.generation, true)
                {
                    return Err("session unavailable".into());
                }
                let total: usize = store
                    .slots
                    .iter()
                    .filter(|(id, _)| *id != &self.scope)
                    .map(|(_, s)| s.memory.as_ref().map_or(0, |b| b.len()))
                    .sum();
                if total + bytes.len() > MAX_TOTAL_BYTES {
                    return Err("session storage full".into());
                }
                store
                    .slots
                    .get_mut(&self.scope)
                    .ok_or("session unavailable")?
                    .memory = Some(bytes);
                Ok(())
            })
            .map_err(failure)?;
        self.touch(created, None)
    }
    fn clear_database(&self) -> Result<(), RetentionError> {
        let expected = self.revision.lock().map_err(failure)?.clone();
        tauri::async_runtime::block_on(
            self.lease
                .clear_cookie_record(expected.clone(), || self.generation_current()),
        )
        .map_err(failure)?;
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
        if let Some(slot) = registry()
            .lock()
            .map_err(failure)?
            .slots
            .get_mut(&self.scope)
        {
            if slot.generation == self.generation {
                slot.active = false;
                slot.memory = None;
            }
        }
        self.lease.revoke();
        Ok(())
    }
    pub fn finish(&self) -> Result<(), RetentionError> {
        if self.policy.mode == RetentionMode::EncryptedDatabase && self.enabled() {
            let expected = self.revision.lock().map_err(failure)?.clone();
            tauri::async_runtime::block_on(
                self.lease.touch_cookie_record(expected, || self.current()),
            )
            .map_err(failure)?;
        }
        self.invalidate();
        if let Some(slot) = registry()
            .lock()
            .map_err(failure)?
            .slots
            .get_mut(&self.scope)
        {
            if slot.generation == self.generation {
                slot.active = false;
            }
        }
        self.lease.revoke();
        Ok(())
    }
    pub fn housekeeping() -> Result<usize, RetentionError> {
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
                            r.current(&scope, generation, false)
                                && r.slots.get(&scope).is_some_and(|s| s.expires <= now())
                        })
                    }))
                    .map_err(failure)?;
                if removed {
                    notify();
                }
            }
            let mut store = registry().lock().map_err(failure)?;
            if store.current(&scope, generation, false)
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
                    || !store.current(&self.scope, self.generation, true)
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
        if let Ok(mut store) = registry().lock() {
            if let Some(slot) = store.slots.get_mut(&self.scope) {
                if slot.generation == self.generation && slot.active {
                    slot.active = false;
                    slot.memory = None;
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sixty_five_retired_connections_do_not_exhaust_the_active_limit() {
        assert!(capacity_available(65, 0, false, false));
        assert!(!capacity_available(64, 64, false, false));
        assert!(!capacity_available(1024, 0, false, false));
        assert!(capacity_available(1024, 0, true, false));
        assert!(capacity_available(1024, 64, true, true));
    }

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
            if change < 3 {
                assert_ne!(original.0, updated.0);
            }
        }
    }
}
