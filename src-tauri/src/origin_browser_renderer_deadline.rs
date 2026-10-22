//! A renderer bootstrap cap starts only after a native host was created.
//! It cannot renew the existing owner/context preparation budget.
use std::time::{Duration, Instant};

const RENDERER_READY_LIMIT: Duration = Duration::from_secs(10);

pub(crate) fn deadline(host_created: Instant, preparation_deadline: Instant) -> Instant {
    preparation_deadline.min(host_created + RENDERER_READY_LIMIT)
}

pub(crate) fn expired(now: Instant, deadline: Instant) -> bool {
    now >= deadline
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn renderer_cap_starts_at_host_creation_after_slow_ssh_and_context_work() {
        let authorization = Instant::now();
        let host_created = authorization + Duration::from_secs(90);
        assert_eq!(
            deadline(host_created, host_created + Duration::from_secs(30)),
            host_created + Duration::from_secs(10)
        );
    }

    #[test]
    fn shorter_saved_preparation_budget_is_never_extended() {
        let host_created = Instant::now();
        let earlier = host_created + Duration::from_secs(3);
        assert_eq!(deadline(host_created, earlier), earlier);
    }

    #[test]
    fn elapsed_preparation_budget_is_not_restarted() {
        let host_created = Instant::now();
        let earlier = host_created - Duration::from_secs(1);
        assert_eq!(deadline(host_created, earlier), earlier);
        assert!(expired(host_created, deadline(host_created, earlier)));
    }

    #[test]
    fn deadline_has_an_exact_inclusive_expiry_boundary() {
        let host_created = Instant::now();
        let cap = deadline(host_created, host_created + Duration::from_secs(30));
        assert!(!expired(cap - Duration::from_nanos(1), cap));
        assert!(expired(cap, cap));
        assert!(expired(cap + Duration::from_nanos(1), cap));
    }
}
