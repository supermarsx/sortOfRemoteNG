//! One-shot device permission decisions. No CEF pointers leave the UI thread.
use sorng_protocols::origin_browser::BrowserIdentity;
use std::sync::{
    atomic::{AtomicU8, Ordering},
    Arc,
};
use std::time::Instant;

const PENDING: u8 = 0;
const DENIED: u8 = 1;
const ALLOWED: u8 = 2;

pub struct NativeMediaChallenge {
    pub identity: BrowserIdentity,
    pub origin: String,
    pub audio: bool,
    pub video: bool,
    pub expires_at: Instant,
}

pub struct MediaPermissionDecision {
    state: Arc<AtomicU8>,
    expires_at: Instant,
}

/// Dropping a prompt, losing its window, or failing to enqueue it means deny.
/// The host must additionally recheck owner, attempt and exact document when
/// consuming an allow. This token alone is not a device permission grant.
pub struct MediaPermissionCompletion {
    state: Arc<AtomicU8>,
}

impl MediaPermissionDecision {
    pub fn pending(expires_at: Instant) -> (Self, MediaPermissionCompletion) {
        let state = Arc::new(AtomicU8::new(PENDING));
        (
            Self {
                state: state.clone(),
                expires_at,
            },
            MediaPermissionCompletion { state },
        )
    }

    pub fn decision(&self, now: Instant) -> Option<bool> {
        if now >= self.expires_at {
            return Some(false);
        }
        match self.state.load(Ordering::Acquire) {
            ALLOWED => Some(true),
            DENIED => Some(false),
            _ => None,
        }
    }

    pub fn deny(&self) {
        self.state.store(DENIED, Ordering::Release);
    }
}

impl MediaPermissionCompletion {
    pub fn complete(self, allow: bool) {
        let _ = self.state.compare_exchange(
            PENDING,
            if allow { ALLOWED } else { DENIED },
            Ordering::AcqRel,
            Ordering::Acquire,
        );
    }
}

impl Drop for MediaPermissionCompletion {
    fn drop(&mut self) {
        let _ = self
            .state
            .compare_exchange(PENDING, DENIED, Ordering::AcqRel, Ordering::Acquire);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[test]
    fn dropped_dialog_denies_and_a_complete_allow_survives_drop() {
        let now = Instant::now();
        let (state, completion) = MediaPermissionDecision::pending(now + Duration::from_secs(60));
        assert_eq!(state.decision(now), None);
        drop(completion);
        assert_eq!(state.decision(now), Some(false));
        let (state, completion) = MediaPermissionDecision::pending(now + Duration::from_secs(60));
        completion.complete(true);
        assert_eq!(state.decision(now), Some(true));
    }

    #[test]
    fn expiry_and_revocation_override_delayed_approval() {
        let now = Instant::now();
        let (state, completion) = MediaPermissionDecision::pending(now + Duration::from_secs(60));
        state.deny();
        completion.complete(true);
        assert_eq!(state.decision(now), Some(false));
        let (state, completion) = MediaPermissionDecision::pending(now);
        completion.complete(true);
        assert_eq!(state.decision(now), Some(false));
    }
}
