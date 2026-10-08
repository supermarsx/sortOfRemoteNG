//! Async handoffs shared with the runtime's CEF-free lifecycle regression tests.

use std::{
    future::Future,
    sync::atomic::{AtomicU8, Ordering},
    time::Duration,
};
use tokio::sync::oneshot;

/// Serialize preflight and queued UI startup without tying ownership to a
/// command future. Only failures BEFORE native initialization may be retried.
#[derive(Default)]
pub(super) struct StartupGate(AtomicU8);

/// One caller's native-entry boundary. Cancellation and claiming use the SAME
/// atomic transition: a timeout cannot slip between an earlier cancellation
/// check and separate publication of native startup ownership.
#[derive(Default)]
pub(super) struct StartupClaim(AtomicU8);

impl StartupClaim {
    pub(super) fn claim_native(&self) -> bool {
        self.0
            .compare_exchange(0, 1, Ordering::AcqRel, Ordering::Acquire)
            .is_ok()
    }

    /// True only for the first cancellation after this caller claimed entry.
    /// Once claimed, native work may finish, but its traffic must stay revoked.
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
/// cancel a native call already in progress; its caller must revoke admission.
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

/// Native startup may need pump work before its policy is installed. Pending is
/// not a failure, but watchdog/policy/exit revocation is terminal for this
/// process. A late successful readback must never restore revoked admission.
#[derive(Default)]
pub(super) struct RuntimeAdmission(AtomicU8);

impl RuntimeAdmission {
    const PENDING: u8 = 0;
    const READY: u8 = 1;
    const REVOKED: u8 = 2;

    pub(super) fn ready(&self) -> bool {
        self.0.load(Ordering::Acquire) == Self::READY
    }

    pub(super) fn revoked(&self) -> bool {
        self.0.load(Ordering::Acquire) == Self::REVOKED
    }

    pub(super) fn observe_policy(&self, configured: bool) {
        if configured {
            let _ = self.0.compare_exchange(
                Self::PENDING,
                Self::READY,
                Ordering::AcqRel,
                Ordering::Acquire,
            );
        } else if self.ready() {
            self.revoke();
        }
    }

    pub(super) fn revoke(&self) {
        self.0.store(Self::REVOKED, Ordering::Release);
    }

    /// Only the caller that entered native initialization may fail a pending
    /// startup. Authority checks and joining callers cannot revoke a ready host.
    /// The CAS also preserves readiness published concurrently with the timeout.
    pub(super) fn timeout_owned_startup(&self, owned_native_start: bool) -> bool {
        owned_native_start
            && self
                .0
                .compare_exchange(
                    Self::PENDING,
                    Self::REVOKED,
                    Ordering::AcqRel,
                    Ordering::Acquire,
                )
                .is_ok()
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

/// Keep the one outstanding UI callback alive after a stall. Revocation runs
/// immediately at the deadline; only that callback's completion allows the
/// caller to enqueue another tick. Recovery never restores traffic admission.
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
