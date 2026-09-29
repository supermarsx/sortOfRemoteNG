//! Process-wide storage barrier, separate from ordinary write serialization.
//!
//! Only representation/key transitions exclude trust I/O. Routine settings,
//! database and backup writes share the barrier with trust while serializing
//! with each other. Synchronous verifiers never wait on an async executor.

use tokio::sync::{Mutex, MutexGuard, RwLock, RwLockReadGuard, RwLockWriteGuard};

const TRANSITION_BUSY: &str = "encryption storage transition in progress; retry after it completes";
const WRITE_BUSY: &str = "storage write in progress; retry after it completes";

enum BarrierGuard<'a> {
    Shared { _lease: RwLockReadGuard<'a, ()> },
    Exclusive { _lease: RwLockWriteGuard<'a, ()> },
}

/// Proof that the caller holds the storage barrier. Fields are private; the
/// acquisition API selects shared routine I/O or an exclusive transition.
/// Field order releases the ordinary write mutex before the barrier.
pub struct CoordinatorGuard<'a> {
    _write: Option<MutexGuard<'a, ()>>,
    _barrier: BarrierGuard<'a>,
}

impl CoordinatorGuard<'_> {
    /// Transition-only helpers must check this before touching any state.
    /// A shared lease never upgrades implicitly or waits on its own barrier.
    pub fn require_exclusive(&self) -> Result<(), &'static str> {
        if matches!(self._barrier, BarrierGuard::Exclusive { .. }) {
            Ok(())
        } else {
            Err("exclusive storage transition lease required")
        }
    }

    /// Guarded ordinary writes accept either a transition or the serialized
    /// routine writer, but never a bare trust/read lease.
    pub fn require_serialized_write(&self) -> Result<(), &'static str> {
        if self._write.is_some() || self.require_exclusive().is_ok() {
            Ok(())
        } else {
            Err("serialized storage write lease required")
        }
    }
}

pub type TransitionGuard = CoordinatorGuard<'static>;
pub type SettingsWriteGuard = CoordinatorGuard<'static>;
pub type StorageReadGuard = CoordinatorGuard<'static>;

struct Coordinator {
    barrier: RwLock<()>,
    writes: Mutex<()>,
}

impl Coordinator {
    const fn new() -> Self {
        Self {
            barrier: RwLock::const_new(()),
            writes: Mutex::const_new(()),
        }
    }

    async fn lock(&self) -> CoordinatorGuard<'_> {
        CoordinatorGuard {
            _write: None,
            _barrier: BarrierGuard::Exclusive {
                _lease: self.barrier.write().await,
            },
        }
    }

    fn try_lock(&self) -> Result<CoordinatorGuard<'_>, &'static str> {
        Ok(CoordinatorGuard {
            _write: None,
            _barrier: BarrierGuard::Exclusive {
                _lease: self.barrier.try_write().map_err(|_| TRANSITION_BUSY)?,
            },
        })
    }

    async fn lock_settings_write(&self) -> CoordinatorGuard<'_> {
        let barrier = self.barrier.read().await;
        let write = self.writes.lock().await;
        CoordinatorGuard {
            _write: Some(write),
            _barrier: BarrierGuard::Shared { _lease: barrier },
        }
    }

    fn try_lock_settings_write(&self) -> Result<CoordinatorGuard<'_>, &'static str> {
        let barrier = self.barrier.try_read().map_err(|_| TRANSITION_BUSY)?;
        let write = self.writes.try_lock().map_err(|_| WRITE_BUSY)?;
        Ok(CoordinatorGuard {
            _write: Some(write),
            _barrier: BarrierGuard::Shared { _lease: barrier },
        })
    }

    fn try_lock_trust(&self) -> Result<CoordinatorGuard<'_>, &'static str> {
        Ok(CoordinatorGuard {
            _write: None,
            _barrier: BarrierGuard::Shared {
                _lease: self.barrier.try_read().map_err(|_| TRANSITION_BUSY)?,
            },
        })
    }
}

static COORDINATOR: Coordinator = Coordinator::new();

/// Exclusive representation/key transition. Retain through verification and
/// old-file cleanup. Async acquisition is cancellation-safe and FIFO.
pub async fn lock() -> TransitionGuard {
    COORDINATOR.lock().await
}

/// Nonblocking exclusive transition, retained for callers that cannot await.
pub fn try_lock() -> Result<TransitionGuard, &'static str> {
    COORDINATOR.try_lock()
}

/// Routine read-modify-write of settings/database/backup artifacts. Shares the
/// storage barrier with trust, but serializes routine writes with each other.
pub async fn lock_settings_write() -> SettingsWriteGuard {
    COORDINATOR.lock_settings_write().await
}

/// Synchronous routine write. Busy ordinary writes are not key transitions.
pub fn try_lock_settings_write() -> Result<SettingsWriteGuard, &'static str> {
    COORDINATOR.try_lock_settings_write()
}

/// Trust I/O admission. Multiple readers and routine saves can coexist. A real
/// transition, including a queued exclusive waiter, fails closed immediately.
pub fn try_lock_trust() -> Result<StorageReadGuard, &'static str> {
    COORDINATOR.try_lock_trust()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{future::Future, task::Poll, time::Duration};

    #[tokio::test]
    async fn guard_capabilities_do_not_upgrade_read_or_routine_leases() {
        let coordinator = Coordinator::new();
        let trust = coordinator.try_lock_trust().unwrap();
        assert!(trust.require_exclusive().is_err());
        assert!(trust.require_serialized_write().is_err());
        let save = coordinator.lock_settings_write().await;
        assert!(save.require_exclusive().is_err());
        assert!(save.require_serialized_write().is_ok());
        drop(save);
        drop(trust);
        let transition = coordinator.lock().await;
        assert!(transition.require_exclusive().is_ok());
        assert!(transition.require_serialized_write().is_ok());
    }

    #[tokio::test]
    async fn routine_writes_serialize_without_excluding_trust() {
        let coordinator = Coordinator::new();
        let first = coordinator.lock_settings_write().await;
        let trust = coordinator.try_lock_trust().unwrap();
        assert_eq!(
            coordinator.try_lock_settings_write().err(),
            Some(WRITE_BUSY)
        );
        let mut second = std::pin::pin!(coordinator.lock_settings_write());
        std::future::poll_fn(|cx| {
            assert!(second.as_mut().poll(cx).is_pending());
            Poll::Ready(())
        })
        .await;
        assert!(coordinator.try_lock_trust().is_ok());
        drop(first);
        let second = tokio::time::timeout(Duration::from_secs(1), second)
            .await
            .unwrap();
        assert!(coordinator.try_lock_trust().is_ok());
        assert!(coordinator.try_lock().is_err());
        drop(second);
        drop(trust);
        assert!(coordinator.try_lock().is_ok());
    }

    #[tokio::test]
    async fn actual_transition_excludes_trust_and_routine_saves_then_releases_both() {
        let coordinator = Coordinator::new();
        let transition = coordinator.lock().await;
        assert_eq!(coordinator.try_lock_trust().err(), Some(TRANSITION_BUSY));
        assert_eq!(
            coordinator.try_lock_settings_write().err(),
            Some(TRANSITION_BUSY)
        );
        drop(transition);
        let save = coordinator.try_lock_settings_write().unwrap();
        assert!(coordinator.try_lock_trust().is_ok());
        drop(save);
        assert!(coordinator.try_lock().is_ok());
    }

    #[tokio::test]
    async fn queued_transition_is_fair_and_cancellation_restores_read_admission() {
        let coordinator = Coordinator::new();
        let trust = coordinator.try_lock_trust().unwrap();
        {
            let mut transition = std::pin::pin!(coordinator.lock());
            std::future::poll_fn(|cx| {
                assert!(transition.as_mut().poll(cx).is_pending());
                Poll::Ready(())
            })
            .await;
            assert_eq!(coordinator.try_lock_trust().err(), Some(TRANSITION_BUSY));
            // The current-thread executor still runs while the writer waits.
            tokio::time::sleep(Duration::from_millis(1)).await;
        }
        assert!(coordinator.try_lock_trust().is_ok());
        let mut transition = std::pin::pin!(coordinator.lock());
        std::future::poll_fn(|cx| {
            assert!(transition.as_mut().poll(cx).is_pending());
            Poll::Ready(())
        })
        .await;
        drop(trust);
        let transition = tokio::time::timeout(Duration::from_secs(1), transition)
            .await
            .unwrap();
        assert!(coordinator.try_lock_trust().is_err());
        drop(transition);
        assert!(coordinator.try_lock_trust().is_ok());
    }
}
