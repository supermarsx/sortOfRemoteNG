//! Async handoffs shared with the runtime's CEF-free lifecycle regression tests.

use sorng_protocols::origin_browser::BrowserSessionFailure;
use std::{
    collections::HashMap,
    future::Future,
    sync::{
        atomic::{AtomicBool, AtomicU8, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};
use tokio::sync::{oneshot, Notify};

/// Retain exact attempt instances, then release the registry before revocation
/// can wait on an attempt's own locks. A replacement at the same key is never
/// substituted into this walk; admission/document fences stay with the caller.
pub(super) fn snapshot_attempts<T>(attempts: &Mutex<HashMap<String, Arc<T>>>) -> Vec<Arc<T>> {
    attempts
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .values()
        .cloned()
        .collect()
}

pub(super) fn visit_attempt_snapshot<T>(
    attempts: &Mutex<HashMap<String, Arc<T>>>,
    mut visit: impl FnMut(Arc<T>),
) {
    for attempt in snapshot_attempts(attempts) {
        visit(attempt);
    }
}

/// Native window labels select lifetimes, never grant browser authority. Removing
/// an epoch invalidates every old holder; a replacement cannot revive it.
#[derive(Default)]
pub(super) struct ShellDocuments(Mutex<HashMap<String, Arc<ShellDocument>>>);

impl ShellDocuments {
    pub(super) fn current(&self, label: &str) -> Arc<ShellDocument> {
        self.0
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .entry(label.to_owned())
            .or_default()
            .clone()
    }

    pub(super) fn revoke(&self, label: &str) -> bool {
        let mut documents = self.0.lock().unwrap_or_else(|error| error.into_inner());
        if let Some(document) = documents.remove(label) {
            // Invalidate while holding the registry lock: a new caller can only
            // acquire its fresh epoch after the old one is observably cancelled.
            document.revoked.store(true, Ordering::Release);
            document.changed.notify_waiters();
            true
        } else {
            false
        }
    }
}

#[derive(Default)]
pub(super) struct ShellDocument {
    revoked: AtomicBool,
    changed: Notify,
}

impl ShellDocument {
    pub(super) fn current(&self) -> bool {
        !self.revoked.load(Ordering::Acquire)
    }

    async fn cancelled(&self) {
        // Register before testing the flag so cancellation between the test and
        // await cannot be lost, including multiple creates in this document.
        let changed = self.changed.notified();
        tokio::pin!(changed);
        changed.as_mut().enable();
        if self.current() {
            changed.await;
        }
    }

    pub(super) async fn run<T>(&self, work: impl Future<Output = T>) -> Option<T> {
        tokio::select! {
            biased;
            () = self.cancelled() => None,
            result = work => self.current().then_some(result),
        }
    }
}

/// Serialize preflight and queued UI startup without tying ownership to a
/// command future. Only failures BEFORE native initialization may be retried.
#[derive(Default)]
pub(super) struct StartupGate(AtomicU8);

/// One caller's native-entry boundary. Cancellation and claiming use the SAME
/// atomic transition: a caller that has ended cannot slip between an earlier
/// cancellation check and entry into native initialization.
#[derive(Default)]
pub(super) struct StartupClaim(AtomicU8);

impl StartupClaim {
    pub(super) fn claim_native(&self) -> bool {
        self.0
            .compare_exchange(0, 1, Ordering::AcqRel, Ordering::Acquire)
            .is_ok()
    }

    /// The caller ended: its command was dropped or cancelled, its document
    /// reloaded, or its own deadline passed. Entry it had not claimed can no
    /// longer happen. Entry it had claimed is neither undone nor failed: the
    /// start belongs to the runtime from the claim on, and still requires its
    /// normal policy readback. True, once, when such a start is left running.
    pub(super) fn cancel(&self) -> bool {
        self.0.swap(2, Ordering::AcqRel) == 1
    }
}

impl StartupGate {
    const DEFERRED: u8 = 0;
    const PREPARING: u8 = 1;
    const STARTED: u8 = 2;
    const FAILED: u8 = 3;

    pub(super) fn deferred(&self) -> bool {
        self.0.load(Ordering::Acquire) <= Self::PREPARING
    }

    pub(super) fn started(&self) -> bool {
        self.0.load(Ordering::Acquire) >= Self::STARTED
    }

    pub(super) fn prepare(&self) -> Option<StartupPermit<'_>> {
        self.0
            .compare_exchange(
                Self::DEFERRED,
                Self::PREPARING,
                Ordering::AcqRel,
                Ordering::Acquire,
            )
            .ok()?;
        Some(StartupPermit(self))
    }

    pub(super) fn fail(&self) {
        self.0.store(Self::FAILED, Ordering::Release);
    }
}

pub(super) struct StartupPermit<'a>(&'a StartupGate);

impl StartupPermit<'_> {
    /// Commit immediately before CefInitialize. Dropping this permit afterward
    /// must never make a second native initialization possible.
    pub(super) fn begin_native(&self) -> bool {
        self.0
             .0
            .compare_exchange(
                StartupGate::PREPARING,
                StartupGate::STARTED,
                Ordering::AcqRel,
                Ordering::Acquire,
            )
            .is_ok()
    }
}

impl Drop for StartupPermit<'_> {
    fn drop(&mut self) {
        let _ = self.0 .0.compare_exchange(
            StartupGate::PREPARING,
            StartupGate::DEFERRED,
            Ordering::AcqRel,
            Ordering::Acquire,
        );
    }
}

/// Polling is bounded even when the native UI callback stalls. A timeout cannot
/// cancel a native call already in progress, and it fails only the waiter.
pub(super) async fn wait_for_readiness<E>(
    timeout: Duration,
    mut check: impl FnMut() -> Result<bool, E>,
    timed_out: impl FnOnce() -> E,
) -> Result<(), E> {
    tokio::time::timeout(timeout, async {
        loop {
            if check()? {
                return Ok(());
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await
    .unwrap_or_else(|_| Err(timed_out()))
}

/// Native startup may need pump work before its policy is installed, and it
/// stays pending however its callers end. A ready host can suspend admission
/// for one stalled UI callback; only that callback's recovery owner may resume
/// it. Initialization/policy faults, the start watchdog and exit stay terminal.
#[derive(Default)]
pub(super) struct RuntimeAdmission(AtomicU8);

impl RuntimeAdmission {
    const PENDING: u8 = 0;
    const READY: u8 = 1;
    const REVOKED: u8 = 2;
    const SUSPENDED: u8 = 3;

    pub(super) fn pending(&self) -> bool {
        self.0.load(Ordering::Acquire) == Self::PENDING
    }

    pub(super) fn ready(&self) -> bool {
        self.0.load(Ordering::Acquire) == Self::READY
    }

    pub(super) fn revoked(&self) -> bool {
        self.0.load(Ordering::Acquire) == Self::REVOKED
    }

    pub(super) fn suspended(&self) -> bool {
        self.0.load(Ordering::Acquire) == Self::SUSPENDED
    }

    /// The sole outstanding callback's waiter owns this non-cloneable token.
    /// Pending startup is deliberately ineligible for transient recovery.
    pub(super) fn suspend_for_watchdog(&self) -> Option<PumpRecovery<'_>> {
        self.0
            .compare_exchange(
                Self::READY,
                Self::SUSPENDED,
                Ordering::AcqRel,
                Ordering::Acquire,
            )
            .ok()?;
        Some(PumpRecovery {
            admission: self,
            armed: true,
        })
    }

    pub(super) fn observe_policy(&self, configured: bool) {
        if configured {
            let _ = self.0.compare_exchange(
                Self::PENDING,
                Self::READY,
                Ordering::AcqRel,
                Ordering::Acquire,
            );
        } else if matches!(
            self.0.load(Ordering::Acquire),
            Self::READY | Self::SUSPENDED
        ) {
            self.revoke();
        }
    }

    pub(super) fn revoke(&self) {
        self.0.store(Self::REVOKED, Ordering::Release);
    }

    /// The start watchdog only. No caller can fail a pending start, whether it
    /// entered native initialization or joined it. The CAS also preserves
    /// readiness published concurrently with the expiry.
    pub(super) fn expire_pending_start(&self) -> bool {
        self.0
            .compare_exchange(
                Self::PENDING,
                Self::REVOKED,
                Ordering::AcqRel,
                Ordering::Acquire,
            )
            .is_ok()
    }
}

/// How long an entered native start may go without a policy readback.
pub(super) const NATIVE_START_LIMIT: Duration = Duration::from_secs(120);
pub(super) const NATIVE_START_STEP: Duration = Duration::from_millis(250);

/// The one clock that can end a start. It is armed at native entry and belongs
/// to the start, not to a caller. The budget is spent one observed `step` at a
/// time: time in which nothing ran (a suspended machine) is not counted against
/// a start that could not progress either. True when this call revoked
/// admission; a start that a readback or a real fault decided first ends false.
pub(super) async fn native_start_expired(
    admission: &RuntimeAdmission,
    limit: Duration,
    step: Duration,
) -> bool {
    let step = step.max(Duration::from_millis(1));
    let mut observed = Duration::ZERO;
    while admission.pending() {
        if observed >= limit {
            return admission.expire_pending_start();
        }
        tokio::time::sleep(step).await;
        observed = observed.saturating_add(step);
    }
    false
}

/// The cause an attempt records when it is revoked. Evidence its revoker named
/// wins. Otherwise an edit that a recheck latched on the lease is that edit and
/// not a lost owner, although the lease is equally stale in both readings.
pub(super) fn revocation_reason(
    named: Option<BrowserSessionFailure>,
    source_changed: bool,
    owner_loss: impl FnOnce() -> Option<BrowserSessionFailure>,
) -> Option<BrowserSessionFailure> {
    named
        .or_else(|| source_changed.then_some(BrowserSessionFailure::SourceChanged))
        .or_else(owner_loss)
}

/// Cannot be copied or reused for another stall. Ordinary policy observations
/// never restore SUSPENDED, so at most one live recovery token can exist.
pub(super) struct PumpRecovery<'a> {
    admission: &'a RuntimeAdmission,
    armed: bool,
}

impl PumpRecovery<'_> {
    /// Invoke only after revoking the captured attempts AND receiving the exact
    /// callback's successful pump/fresh policy readback. Hard revocation wins
    /// this CAS, including revocation concurrent with callback completion.
    pub(super) fn complete(mut self, healthy: bool) -> bool {
        // Disarm BEFORE publishing READY. Another callback can subsequently
        // suspend the host; this token's destructor must never revoke that epoch.
        self.armed = false;
        if !healthy {
            self.admission.revoke();
            return false;
        }
        self.admission
            .0
            .compare_exchange(
                RuntimeAdmission::SUSPENDED,
                RuntimeAdmission::READY,
                Ordering::AcqRel,
                Ordering::Acquire,
            )
            .is_ok()
    }

    /// Claim abandonment once, without taking registry/attempt locks or calling
    /// native code. The runtime owner may report a fixed diagnostic only when
    /// this transition wins; an existing hard failure/shutdown is left alone.
    pub(super) fn abandon(&mut self) -> bool {
        if !std::mem::replace(&mut self.armed, false) {
            return false;
        }
        self.admission
            .0
            .compare_exchange(
                RuntimeAdmission::SUSPENDED,
                RuntimeAdmission::REVOKED,
                Ordering::AcqRel,
                Ordering::Acquire,
            )
            .is_ok()
    }
}

impl Drop for PumpRecovery<'_> {
    fn drop(&mut self) {
        self.abandon();
    }
}

/// A queued native callback can outlive the command future that requested it.
/// Retain revocation until the complete handoff succeeds, including errors,
/// timeouts and a caller simply dropping its future between awaits.
pub(super) struct RevokeOnDrop<F: FnOnce()>(Option<F>);

impl<F: FnOnce()> RevokeOnDrop<F> {
    pub(super) fn new(revoke: F) -> Self {
        Self(Some(revoke))
    }

    pub(super) fn disarm(mut self) {
        self.0 = None;
    }
}

impl<F: FnOnce()> Drop for RevokeOnDrop<F> {
    fn drop(&mut self) {
        if let Some(revoke) = self.0.take() {
            revoke();
        }
    }
}

/// Keep the one outstanding UI callback alive after a stall. The deadline
/// handler finishes revoking attempts before completion is returned, even if
/// that callback finishes while revocation waits. This alone never restores
/// admission: the caller must validate completion using its recovery token.
pub(super) async fn wait_for_pump<T>(
    mut receiver: oneshot::Receiver<T>,
    stall_after: Duration,
    revoke: impl FnOnce(),
) -> Result<T, oneshot::error::RecvError> {
    match tokio::time::timeout(stall_after, &mut receiver).await {
        Ok(result) => result,
        Err(_) => {
            revoke();
            receiver.await
        }
    }
}

/// Preparation is not authority to navigate. Invoke a fresh native owner
/// recheck only after preparation, then dispatch the guarded UI admission.
pub(super) async fn admit_prepared<T, E, R, A>(
    prepared: impl Future<Output = Result<(), E>>,
    recheck: impl FnOnce() -> R,
    admit: impl FnOnce() -> A,
) -> Result<T, E>
where
    R: Future<Output = Result<(), E>>,
    A: Future<Output = Result<T, E>>,
{
    prepared.await?;
    recheck().await?;
    admit().await
}
