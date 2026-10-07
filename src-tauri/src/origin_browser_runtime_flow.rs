//! Async handoffs shared with the runtime's CEF-free lifecycle regression tests.

use std::{
    future::Future,
    sync::atomic::{AtomicU8, Ordering},
    time::Duration,
};
use tokio::sync::oneshot;

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
