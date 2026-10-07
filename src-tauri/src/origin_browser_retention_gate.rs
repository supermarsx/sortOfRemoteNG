//! CEF-free ordering gate shared by the coordinator and standalone unit tests.

use std::time::{Duration, Instant};

const INTERVAL: Duration = Duration::from_secs(5);
const CLOSE_LIMIT: Duration = Duration::from_secs(12);
const CLEANUP_RETRY: Duration = Duration::from_secs(1);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Work {
    PeriodicSave,
    FinalSave,
    Finish,
    Clear,
    Revoke,
}

impl Work {
    pub(super) fn cleanup(self) -> bool {
        matches!(self, Self::Clear | Self::Revoke)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Phase {
    Open,
    Closing(Instant),
    Cleaning { work: Work, retry_at: Instant },
    Finished,
}

pub(super) struct Gate {
    phase: Phase,
    worker: Option<Work>,
    next: Instant,
}

impl Gate {
    pub(super) fn new(now: Instant) -> Self {
        Self {
            phase: Phase::Open,
            worker: None,
            next: now + INTERVAL,
        }
    }

    pub(super) fn begin_close(&mut self, now: Instant) -> bool {
        if self.phase != Phase::Open {
            return false;
        }
        self.phase = Phase::Closing(now + CLOSE_LIMIT);
        true
    }

    /// The caller must synchronously invalidate the owner on a true result.
    /// Keep the outstanding worker: dropping its receiver cannot cancel IO.
    pub(super) fn fail(&mut self, owner_unavailable: bool, now: Instant) -> bool {
        if matches!(self.phase, Phase::Cleaning { .. } | Phase::Finished) {
            return false;
        }
        self.phase = Phase::Cleaning {
            work: if owner_unavailable {
                Work::Revoke
            } else {
                Work::Clear
            },
            retry_at: now,
        };
        true
    }

    pub(super) fn expire(&mut self, now: Instant) -> bool {
        if matches!(self.phase, Phase::Closing(deadline) if now >= deadline) {
            self.fail(false, now)
        } else {
            false
        }
    }

    /// Process completion before expiry. A completed final save is authoritative
    /// even if the UI did not poll until after the capture/save deadline.
    /// Err(bool) distinguishes owner loss from other failures.
    pub(super) fn completed(&mut self, result: Result<(), bool>, now: Instant) -> bool {
        let work = self.worker.take().expect("completion without a worker");
        if let Phase::Cleaning { work: cleanup, .. } = self.phase {
            if work.cleanup() {
                self.phase = if result.is_ok() {
                    Phase::Finished
                } else {
                    Phase::Cleaning {
                        work: cleanup,
                        retry_at: now + CLEANUP_RETRY,
                    }
                };
            }
            // An old save completing after invalidation cannot finish cleanup.
            return false;
        }
        match result {
            Err(owner_unavailable) => self.fail(owner_unavailable, now),
            Ok(()) => {
                if matches!(work, Work::FinalSave | Work::Finish) {
                    self.phase = Phase::Finished;
                }
                false
            }
        }
    }

    pub(super) fn claim_cleanup(&mut self, now: Instant) -> Option<Work> {
        if self.worker.is_some() {
            return None;
        }
        if let Phase::Cleaning { work, retry_at } = self.phase {
            if now >= retry_at {
                self.worker = Some(work);
                return Some(work);
            }
        }
        None
    }

    pub(super) fn start_save(&mut self, now: Instant) -> Work {
        assert!(self.can_capture());
        let work = if matches!(self.phase, Phase::Closing(_)) {
            Work::FinalSave
        } else {
            Work::PeriodicSave
        };
        self.worker = Some(work);
        self.next = now + INTERVAL;
        work
    }

    pub(super) fn start_finish(&mut self) {
        assert!(matches!(self.phase, Phase::Closing(_)) && self.worker.is_none());
        self.worker = Some(Work::Finish);
    }

    pub(super) fn worker(&self) -> Option<Work> {
        self.worker
    }
    pub(super) fn open(&self) -> bool {
        self.phase == Phase::Open
    }
    pub(super) fn can_capture(&self) -> bool {
        self.worker.is_none() && matches!(self.phase, Phase::Open | Phase::Closing(_))
    }
    pub(super) fn periodic_due(&self, now: Instant) -> bool {
        self.open() && self.can_capture() && now >= self.next
    }
    pub(super) fn draining(&self) -> bool {
        self.worker.is_some() || matches!(self.phase, Phase::Closing(_) | Phase::Cleaning { .. })
    }
}

/// Edge-triggered notice: retries and late worker failures must not spam the UI.
pub(super) struct FailureNotice<T> {
    recorded: bool,
    pending: Option<T>,
}

impl<T> FailureNotice<T> {
    pub(super) fn new() -> Self {
        Self {
            recorded: false,
            pending: None,
        }
    }
    pub(super) fn record(&mut self, error: T) {
        if !self.recorded {
            self.recorded = true;
            self.pending = Some(error);
        }
    }
    pub(super) fn take(&mut self) -> Option<T> {
        self.pending.take()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn timeout_waits_for_save_then_cleanup_before_releasing_close() {
        for final_save in [false, true] {
            let now = Instant::now();
            let mut gate = Gate::new(now);
            if final_save {
                assert!(gate.begin_close(now));
            }
            gate.start_save(now);
            if !final_save {
                assert!(gate.begin_close(now));
            }
            let late = now + CLOSE_LIMIT;
            assert!(gate.expire(late)); // coordinator must invalidate here
            assert!(gate.draining());
            assert_eq!(gate.claim_cleanup(late), None);
            assert!(!gate.completed(Ok(()), late));
            assert!(gate.draining());
            assert_eq!(gate.claim_cleanup(late), Some(Work::Clear));
            assert!(!gate.completed(Ok(()), late));
            assert!(!gate.draining());
            assert!(!gate.can_capture());
        }
    }

    #[test]
    fn periodic_failure_is_an_exit_barrier_even_before_begin_close() {
        let now = Instant::now();
        let mut gate = Gate::new(now);
        gate.start_save(now);
        assert!(gate.completed(Err(false), now));
        assert!(gate.draining());
        assert!(!gate.begin_close(now));
        assert_eq!(gate.claim_cleanup(now), Some(Work::Clear));
        gate.completed(Ok(()), now);
        assert!(!gate.begin_close(now));
        assert!(!gate.draining());
    }

    #[test]
    fn final_completion_observed_after_deadline_does_not_clear_good_snapshot() {
        let now = Instant::now();
        let mut gate = Gate::new(now);
        gate.begin_close(now);
        assert_eq!(gate.start_save(now), Work::FinalSave);
        let late = now + CLOSE_LIMIT + INTERVAL;
        assert!(!gate.completed(Ok(()), late));
        assert!(!gate.expire(late));
        assert_eq!(gate.claim_cleanup(late), None);
        assert!(!gate.draining());
    }

    #[test]
    fn cleanup_failure_or_disconnected_worker_retries_without_changing_lock_policy() {
        let now = Instant::now();
        let mut gate = Gate::new(now);
        gate.begin_close(now);
        gate.start_save(now);
        let late = now + CLOSE_LIMIT;
        assert!(gate.completed(Err(true), late));
        assert!(!gate.expire(late));
        assert_eq!(gate.claim_cleanup(late), Some(Work::Revoke));
        gate.completed(Err(false), late); // IO failure or closed oneshot
        assert!(gate.draining());
        assert_eq!(gate.claim_cleanup(late), None);
        assert!(!gate.fail(false, late));
        assert_eq!(gate.claim_cleanup(late + CLEANUP_RETRY), Some(Work::Revoke));
        gate.completed(Ok(()), late + CLEANUP_RETRY);
        assert!(!gate.draining());
    }

    #[test]
    fn periodic_completion_does_not_substitute_for_final_save() {
        let now = Instant::now();
        let mut gate = Gate::new(now);
        assert_eq!(gate.start_save(now), Work::PeriodicSave);
        gate.begin_close(now);
        assert!(!gate.begin_close(now + INTERVAL));
        gate.completed(Ok(()), now);
        assert!(gate.draining());
        assert_eq!(gate.start_save(now), Work::FinalSave);
        gate.completed(Ok(()), now);
        assert!(!gate.draining());
    }

    #[test]
    fn disabled_retention_finish_is_tracked_and_failure_needs_cleanup() {
        let now = Instant::now();
        for result in [Ok(()), Err(false)] {
            let mut gate = Gate::new(now);
            gate.begin_close(now);
            gate.start_finish();
            assert_eq!(gate.worker(), Some(Work::Finish));
            assert!(gate.draining());
            assert!(!gate.can_capture());
            assert_eq!(gate.completed(result, now), result.is_err());
            assert_eq!(gate.draining(), result.is_err());
        }
    }

    #[test]
    fn owner_loss_during_periodic_save_keeps_worker_until_revoke() {
        let now = Instant::now();
        let mut gate = Gate::new(now);
        assert!(gate.open());
        assert!(!gate.periodic_due(now));
        assert!(gate.periodic_due(now + INTERVAL));
        gate.start_save(now);
        assert!(gate.fail(true, now));
        assert_eq!(gate.claim_cleanup(now), None);
        assert!(!gate.completed(Err(true), now));
        assert_eq!(gate.claim_cleanup(now), Some(Work::Revoke));
        gate.completed(Ok(()), now);
        assert!(!gate.draining());
    }

    #[test]
    fn failure_notice_is_consumed_once_including_after_retry() {
        let mut notice = FailureNotice::new();
        assert_eq!(notice.take(), None);
        notice.record("first");
        notice.record("retry");
        assert_eq!(notice.take(), Some("first"));
        notice.record("late failure");
        assert_eq!(notice.take(), None);
    }
}
