//! Absolute native login-attempt bound, independent of renderer/UI activity.
use std::{
    sync::atomic::{AtomicBool, AtomicU8, Ordering},
    time::{Duration, Instant},
};

pub(super) const MAX_LOGIN_ATTEMPT: Duration = Duration::from_secs(3600);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum CancelReason {
    UserCancelled,
    AttemptTimeout,
}

impl CancelReason {
    pub(super) fn code(self) -> &'static str {
        match self {
            Self::UserCancelled => "user-cancelled",
            Self::AttemptTimeout => "attempt-timeout",
        }
    }
}

pub(super) struct LoginLifetime {
    deadline: Instant,
    state: AtomicU8,
    last_completed: AtomicBool,
}

impl LoginLifetime {
    pub(super) fn new(started: Instant) -> Self {
        Self {
            deadline: started + MAX_LOGIN_ATTEMPT,
            state: AtomicU8::new(0),
            last_completed: AtomicBool::new(false),
        }
    }
    pub(super) fn deadline(&self) -> Instant {
        self.deadline
    }
    pub(super) fn active(&self, now: Instant) -> bool {
        self.state.load(Ordering::Acquire) == 0 && now < self.deadline
    }
    pub(super) fn expired(&self, now: Instant) -> bool {
        now >= self.deadline
    }
    /// Presentation only: a renderer checkpoint is not authenticated success
    /// and must never extend or revoke the underlying multi-stage grant.
    pub(super) fn observe_activity(&self, completed: bool) {
        self.last_completed.store(completed, Ordering::Release);
    }
    pub(super) fn report_timeout(&self) -> bool {
        !self.last_completed.load(Ordering::Acquire)
    }
    /// One terminal winner. A caller cannot relabel an elapsed native deadline.
    pub(super) fn cancel(&self, requested: CancelReason, now: Instant) -> Option<CancelReason> {
        if requested == CancelReason::AttemptTimeout && !self.expired(now) {
            return None;
        }
        let reason = if self.expired(now) {
            CancelReason::AttemptTimeout
        } else {
            requested
        };
        let state = match reason {
            CancelReason::UserCancelled => 1,
            CancelReason::AttemptTimeout => 2,
        };
        self.state
            .compare_exchange(0, state, Ordering::AcqRel, Ordering::Acquire)
            .ok()
            .map(|_| reason)
    }
    pub(super) fn stop(&self) {
        let _ = self
            .state
            .compare_exchange(0, 3, Ordering::AcqRel, Ordering::Acquire);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn absolute_deadline_cannot_be_renewed_by_activity_or_background_visibility() {
        let started = Instant::now();
        let life = LoginLifetime::new(started);
        assert_eq!(life.deadline(), started + Duration::from_secs(3600));
        for seconds in [0, 1, 599, 600, 3599] {
            assert!(life.active(started + Duration::from_secs(seconds)));
        }
        assert!(!life.active(started + MAX_LOGIN_ATTEMPT));
        assert_eq!(
            life.cancel(CancelReason::UserCancelled, life.deadline()),
            Some(CancelReason::AttemptTimeout)
        );
        assert_eq!(life.cancel(CancelReason::UserCancelled, started), None);
    }
    #[test]
    fn user_cancellation_is_terminal_and_preserves_the_first_fixed_reason() {
        let now = Instant::now();
        let life = LoginLifetime::new(now);
        assert_eq!(
            life.cancel(CancelReason::UserCancelled, now),
            Some(CancelReason::UserCancelled)
        );
        assert!(!life.active(now));
        assert_eq!(
            life.cancel(CancelReason::AttemptTimeout, now + MAX_LOGIN_ATTEMPT),
            None
        );
        assert_eq!(CancelReason::UserCancelled.code(), "user-cancelled");
        assert_eq!(CancelReason::AttemptTimeout.code(), "attempt-timeout");
    }
    #[test]
    fn browser_revocation_never_generates_a_later_deadline_cancellation() {
        let now = Instant::now();
        let life = LoginLifetime::new(now);
        life.stop();
        assert!(!life.active(now));
        assert_eq!(
            life.cancel(CancelReason::AttemptTimeout, now + MAX_LOGIN_ATTEMPT),
            None
        );
    }
    #[test]
    fn a_renderer_timeout_claim_cannot_expire_a_new_native_attempt() {
        let now = Instant::now();
        let life = LoginLifetime::new(now);
        assert_eq!(life.cancel(CancelReason::AttemptTimeout, now), None);
        assert!(life.active(now));
    }
    #[test]
    fn concurrent_cancel_requests_have_exactly_one_terminal_winner() {
        let now = Instant::now();
        let life = std::sync::Arc::new(LoginLifetime::new(now));
        let threads: Vec<_> = (0..16)
            .map(|_| {
                let life = life.clone();
                std::thread::spawn(move || life.cancel(CancelReason::UserCancelled, now).is_some())
            })
            .collect();
        assert_eq!(
            threads
                .into_iter()
                .map(|t| t.join().unwrap())
                .filter(|winner| *winner)
                .count(),
            1
        );
    }
    #[test]
    fn completed_checkpoint_expires_grants_without_relabeling_the_finished_display() {
        let now = Instant::now();
        let life = LoginLifetime::new(now);
        life.observe_activity(true);
        assert!(life.active(now));
        assert_eq!(
            life.cancel(CancelReason::AttemptTimeout, life.deadline()),
            Some(CancelReason::AttemptTimeout)
        );
        assert!(!life.active(life.deadline()));
        assert!(!life.report_timeout());
    }
    #[test]
    fn completed_then_waiting_two_factor_is_still_bounded_and_reports_its_timeout() {
        let now = Instant::now();
        let life = LoginLifetime::new(now);
        life.observe_activity(true);
        life.observe_activity(false);
        assert_eq!(
            life.cancel(CancelReason::AttemptTimeout, life.deadline()),
            Some(CancelReason::AttemptTimeout)
        );
        assert!(life.report_timeout());
        let held = LoginLifetime::new(now);
        held.observe_activity(false);
        assert!(held.report_timeout());
        assert_eq!(
            held.cancel(CancelReason::UserCancelled, now),
            Some(CancelReason::UserCancelled)
        );
    }
}
