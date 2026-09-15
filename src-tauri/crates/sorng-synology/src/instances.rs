//! Independent NAS sessions. Named renderer instances never fall back to the
//! compatibility singleton, and a cancelled login cannot publish a late client.
use crate::{
    error::{SynologyErrorKind, SynologyResult},
    scoped_files::FileStationLogin,
    service::SynologyService,
    types::SynologyConfig,
};
use std::{
    collections::HashMap,
    ops::{Deref, DerefMut},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
};
use tokio::sync::{Mutex as AsyncMutex, OwnedMutexGuard, Semaphore};

const KEEP_ALIVE_INTERVAL: std::time::Duration = std::time::Duration::from_secs(60);

/// Redacted session health only. Native DSM SIDs and tokens never cross IPC.
#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileSessionHealth {
    pub status: &'static str,
    pub last_verified_at: String,
    pub consecutive_failures: u32,
    pub message: Option<String>,
}

const MAX_INSTANCES: usize = 64;
fn expired() -> String {
    "SYNOLOGY_SESSION_EXPIRED: This Synology instance or session changed or ended. Connect again before continuing.".into()
}
fn validate_id(id: &str) -> Result<(), String> {
    if id.is_empty()
        || id.len() > 128
        || !id
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b"-_.:".contains(&c))
    {
        return Err("Invalid Synology instance or request identifier".into());
    }
    Ok(())
}
struct Lease {
    service: Arc<AsyncMutex<SynologyService>>,
    active: Arc<AtomicBool>,
    cancelled: Arc<tokio::sync::Notify>,
    session_id: Option<String>,
    health: Mutex<FileSessionHealth>,
}
impl Lease {
    fn new(mut service: SynologyService, session_id: Option<String>) -> Self {
        let active = Arc::new(AtomicBool::new(true));
        let cancelled = Arc::new(tokio::sync::Notify::new());
        service.fs_install_lease(active.clone(), cancelled.clone());
        Self {
            service: Arc::new(AsyncMutex::new(service)),
            active,
            cancelled,
            session_id,
            health: Mutex::new(FileSessionHealth {
                status: "connected",
                last_verified_at: chrono::Utc::now().to_rfc3339(),
                consecutive_failures: 0,
                message: None,
            }),
        }
    }
    fn revoke(&self) {
        self.active.store(false, Ordering::Release);
        self.cancelled.notify_waiters();
    }

    async fn verify(&self) {
        let Some(expected) = self.session_id.as_deref() else {
            return;
        };
        if !self.active.load(Ordering::Acquire) {
            return;
        }
        // A running operation already exercises the session. Do not queue a
        // heartbeat behind it or interfere with its result.
        let Ok(service) = self.service.try_lock() else {
            return;
        };
        let result = tokio::time::timeout(
            std::time::Duration::from_secs(10),
            service.fs_keep_alive(expected),
        )
        .await;
        if !self.active.load(Ordering::Acquire) {
            return;
        }
        let Ok(mut health) = self.health.lock() else {
            self.revoke();
            return;
        };
        match result {
            Ok(Ok(())) => {
                health.status = "connected";
                health.last_verified_at = chrono::Utc::now().to_rfc3339();
                health.consecutive_failures = 0;
                health.message = None;
            }
            Ok(Err(error))
                if matches!(
                    error.kind,
                    SynologyErrorKind::SessionExpired
                        | SynologyErrorKind::ApiError(106 | 107 | 119 | 150)
                ) =>
            {
                health.status = "authentication-required";
                health.message = Some(crate::error::command_error(error));
                self.revoke();
            }
            _ => {
                health.status = "degraded";
                health.consecutive_failures = health.consecutive_failures.saturating_add(1);
                health.message = Some("The NAS session could not be verified. Check connectivity; no credentials or file operations have been replayed.".into());
            }
        }
    }

    fn start_keep_alive(lease: &Arc<Self>, interval: std::time::Duration) {
        let weak = Arc::downgrade(lease);
        let cancelled = lease.cancelled.clone();
        tokio::spawn(async move {
            let mut delay = interval;
            loop {
                let stop = cancelled.notified();
                tokio::pin!(stop);
                stop.as_mut().enable();
                if weak
                    .upgrade()
                    .is_none_or(|lease| !lease.active.load(Ordering::Acquire))
                {
                    return;
                }
                tokio::select! {
                    biased;
                    _ = &mut stop => return,
                    _ = tokio::time::sleep(delay) => {}
                }
                let Some(lease) = weak.upgrade() else {
                    return;
                };
                tokio::select! {
                    biased;
                    _ = &mut stop => return,
                    _ = lease.verify() => {}
                }
                if !lease.active.load(Ordering::Acquire) {
                    return;
                }
                // Temporary network trouble backs off to at most five minutes.
                let failures = lease
                    .health
                    .lock()
                    .map(|h| h.consecutive_failures)
                    .unwrap_or(3);
                delay = interval
                    .saturating_mul(1u32 << failures.min(3))
                    .min(std::time::Duration::from_secs(300));
            }
        });
    }
}
struct Attempt {
    id: String,
    active: AtomicBool,
}
impl Attempt {
    fn cancel(&self) {
        self.active.store(false, Ordering::Release);
    }
}
#[derive(Default)]
struct Slot {
    lease: Option<Arc<Lease>>,
    pending: Option<Arc<Attempt>>,
}
pub struct SynologyInstances {
    slots: Mutex<HashMap<String, Slot>>,
    legacy: Arc<Lease>,
    connects: Semaphore,
    keep_alive_interval: std::time::Duration,
}
impl Default for SynologyInstances {
    fn default() -> Self {
        Self::new()
    }
}
impl SynologyInstances {
    pub fn new() -> Self {
        Self {
            slots: Mutex::new(HashMap::new()),
            legacy: Arc::new(Lease::new(SynologyService::new(), None)),
            connects: Semaphore::new(16),
            keep_alive_interval: KEEP_ALIVE_INTERVAL,
        }
    }
    #[cfg(test)]
    pub(crate) fn with_keep_alive_interval(interval: std::time::Duration) -> Self {
        Self {
            keep_alive_interval: interval,
            ..Self::new()
        }
    }
    fn slots(&self) -> Result<std::sync::MutexGuard<'_, HashMap<String, Slot>>, String> {
        self.slots
            .lock()
            .map_err(|_| "Synology session registry is unavailable".into())
    }
    pub async fn connect(
        &self,
        instance: &str,
        request: &str,
        config: SynologyConfig,
    ) -> Result<FileStationLogin, String> {
        self.connect_with_route(
            instance,
            request,
            config,
            crate::http_route::NativeHttpRoute::Direct {},
            crate::login_handshake::LoginOptions::default(),
        )
        .await
    }

    pub async fn connect_with_route(
        &self,
        instance: &str,
        request: &str,
        config: SynologyConfig,
        route: crate::http_route::NativeHttpRoute,
        options: crate::login_handshake::LoginOptions,
    ) -> Result<FileStationLogin, String> {
        validate_id(instance)?;
        validate_id(request)?;
        let _permit = self.connects.try_acquire().map_err(|_| "Too many Synology connections are pending; wait for cancellation to finish before retrying".to_string())?;
        let attempt = Arc::new(Attempt {
            id: request.into(),
            active: AtomicBool::new(true),
        });
        {
            let mut slots = self.slots()?;
            // Expired/revoked receipts cannot permanently exhaust the registry.
            slots.retain(|_, slot| {
                if let Some(lease) = slot
                    .lease
                    .as_ref()
                    .filter(|lease| !lease.active.load(Ordering::Acquire))
                {
                    Self::cleanup(lease.clone());
                    slot.lease = None;
                }
                slot.pending.is_some() || slot.lease.is_some()
            });
            if !slots.contains_key(instance) && slots.len() >= MAX_INSTANCES {
                return Err(
                    "Close another Synology instance before opening more (limit 64)".into(),
                );
            }
            let slot = slots.entry(instance.into()).or_default();
            if let Some(previous) = slot.pending.replace(attempt.clone()) {
                previous.cancel();
            }
        }
        let mut candidate = SynologyService::new();
        // Cooperative cancellation checks each bounded HTTP boundary and logs
        // out an authenticated candidate before discarding it. Dropping a login
        // future mid-flight would lose the SID needed for best-effort logout.
        let outcome = candidate
            .fs_connect_with_options(config, &attempt.active, route, options)
            .await;
        let mut retired = None;
        let accepted = {
            let mut slots = self.slots()?;
            let current = slots.get_mut(instance).filter(|slot| {
                slot.pending
                    .as_ref()
                    .is_some_and(|a| Arc::ptr_eq(a, &attempt))
            });
            if let Some(slot) = current {
                slot.pending = None;
                if attempt.active.load(Ordering::Acquire) {
                    if let Ok(FileStationLogin::Connected { session_id, .. }) = &outcome {
                        let lease = Arc::new(Lease::new(
                            std::mem::take(&mut candidate),
                            Some(session_id.clone()),
                        ));
                        Lease::start_keep_alive(&lease, self.keep_alive_interval);
                        retired = slot.lease.replace(lease);
                        if let Some(old) = &retired {
                            old.revoke();
                        }
                    }
                    true
                } else {
                    false
                }
            } else {
                false
            }
        };
        if let Some(old) = retired {
            Self::cleanup(old);
        }
        // A successful but superseded candidate is never made available.
        if !accepted {
            if candidate.is_connected() {
                Self::cleanup(Arc::new(Lease::new(candidate, None)));
            }
            return Err("Synology connection attempt was cancelled or replaced".into());
        }
        // Challenge/failed attempts do not consume one of the bounded slots.
        if !matches!(outcome, Ok(FileStationLogin::Connected { .. })) {
            let mut slots = self.slots()?;
            if slots
                .get(instance)
                .is_some_and(|s| s.pending.is_none() && s.lease.is_none())
            {
                slots.remove(instance);
            }
        }
        outcome.map_err(|e| e.to_string())
    }
    pub fn cancel_connect(&self, instance: &str, request: &str) -> Result<bool, String> {
        validate_id(instance)?;
        validate_id(request)?;
        let mut slots = self.slots()?;
        let Some(slot) = slots.get_mut(instance) else {
            return Ok(false);
        };
        if slot.pending.as_ref().is_none_or(|a| a.id != request) {
            return Ok(false);
        }
        if let Some(attempt) = slot.pending.take() {
            attempt.cancel();
        }
        if slot.lease.is_none() {
            slots.remove(instance);
        }
        Ok(true)
    }
    pub fn session_health(
        &self,
        instance: &str,
        expected: &str,
    ) -> Result<FileSessionHealth, String> {
        validate_id(instance)?;
        let lease = self
            .slots()?
            .get(instance)
            .and_then(|slot| slot.lease.as_ref())
            .filter(|lease| lease.session_id.as_deref() == Some(expected))
            .cloned()
            .ok_or_else(expired)?;
        let mut health = lease
            .health
            .lock()
            .map_err(|_| "Synology session health is unavailable".to_string())?
            .clone();
        if !lease.active.load(Ordering::Acquire) && health.status != "authentication-required" {
            health.status = "authentication-required";
            health.message = Some(expired());
        }
        Ok(health)
    }
    fn cleanup(lease: Arc<Lease>) {
        tokio::spawn(async move {
            let _ = tokio::time::timeout(std::time::Duration::from_secs(6), async {
                lease.service.lock().await.disconnect().await
            })
            .await;
        });
    }
    pub fn disconnect(&self, instance: &str, expected: &str) -> Result<bool, String> {
        validate_id(instance)?;
        let mut slots = self.slots()?;
        let Some(slot) = slots.get_mut(instance) else {
            return Ok(false);
        };
        if slot
            .lease
            .as_ref()
            .is_none_or(|lease| lease.session_id.as_deref() != Some(expected))
        {
            return Ok(false);
        }
        let lease = slot.lease.take().ok_or_else(expired)?;
        lease.revoke();
        // Receipt-scoped close does not cancel a different pending reconnect.
        if slot.pending.is_none() {
            slots.remove(instance);
        }
        drop(slots);
        Self::cleanup(lease);
        Ok(true)
    }
    pub async fn resolve(
        &self,
        instance: Option<&str>,
        expected: Option<&str>,
    ) -> Result<SynologyLeaseGuard, String> {
        let lease = match (instance, expected) {
            (None, None) => self.legacy.clone(),
            (Some(instance), Some(expected)) => {
                validate_id(instance)?;
                self.slots()?
                    .get(instance)
                    .and_then(|s| s.lease.as_ref())
                    .filter(|lease| lease.session_id.as_deref() == Some(expected))
                    .cloned()
                    .ok_or_else(expired)?
            }
            _ => return Err("Both Synology instanceId and expectedSessionId are required".into()),
        };
        if !lease.active.load(Ordering::Acquire) {
            return Err(expired());
        }
        let service = lease.service.clone().lock_owned().await;
        if !lease.active.load(Ordering::Acquire) {
            return Err(expired());
        }
        if let Some(expected) = expected {
            service
                .fs_assert_session(expected)
                .map_err(crate::error::command_error)?;
        }
        Ok(SynologyLeaseGuard { service, lease })
    }
}
pub struct SynologyLeaseGuard {
    service: OwnedMutexGuard<SynologyService>,
    lease: Arc<Lease>,
}
impl SynologyLeaseGuard {
    pub fn finish<T>(&self, result: SynologyResult<T>) -> Result<T, String> {
        if self.lease.session_id.is_some()
            && matches!(&result, Err(error) if matches!(error.kind, SynologyErrorKind::SessionExpired | SynologyErrorKind::ApiError(106 | 107 | 119 | 150)))
        {
            self.lease.revoke();
            // Preserve the safe DSM reason on the response that revoked this
            // exact lease; subsequent stale requests receive only `expired()`.
            return result.map_err(crate::error::command_error);
        }
        if !self.lease.active.load(Ordering::Acquire) {
            return Err(expired());
        }
        result.map_err(crate::error::command_error)
    }
}
impl Deref for SynologyLeaseGuard {
    type Target = SynologyService;
    fn deref(&self) -> &Self::Target {
        &self.service
    }
}
impl DerefMut for SynologyLeaseGuard {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.service
    }
}

#[cfg(test)]
mod capacity_tests {
    use super::*;

    #[tokio::test]
    async fn revoked_leases_are_reclaimed_before_capacity_check() {
        let registry = SynologyInstances::new();
        for number in 0..MAX_INSTANCES {
            let lease = Arc::new(Lease::new(
                SynologyService::new(),
                Some(format!("receipt-{number}")),
            ));
            lease.revoke();
            registry.slots().unwrap().insert(
                format!("old-{number}"),
                Slot {
                    lease: Some(lease),
                    pending: None,
                },
            );
        }
        let result = registry
            .connect(
                "fresh",
                "request",
                SynologyConfig {
                    host: String::new(),
                    port: 0,
                    username: String::new(),
                    password: String::new(),
                    use_https: true,
                    insecure: false,
                    timeout_secs: 1,
                    otp_code: None,
                    device_token: None,
                    access_token: None,
                },
            )
            .await;
        assert!(result.is_err());
        assert!(!result.unwrap_err().contains("limit 64"));
        assert!(registry.slots().unwrap().is_empty());
    }
}
