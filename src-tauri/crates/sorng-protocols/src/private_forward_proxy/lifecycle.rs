//! Attempt-local observations only. Never consulted to authorize traffic and
//! never retain endpoint, destination, credential, or native error text.
use serde::Serialize;
use std::sync::atomic::{AtomicU32, AtomicU8, Ordering};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum PrivateProxyState {
    Listening,
    Revoking,
    Stopped,
    ListenerFailed,
    TaskEnded,
}

/// A best-effort snapshot, not an atomic transaction or a future liveness lease.
/// Counts saturate instead of wrapping, and include diagnostic probe traffic.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrivateProxyDiagnostics {
    pub state: PrivateProxyState,
    pub accepted_connections: u32,
    pub authentication_challenges: u32,
    pub authenticated_requests: u32,
    pub destination_denials: u32,
    pub upstream_failures: u32,
    pub request_rejections: u32,
    pub capacity_refusals: u32,
}

#[derive(Default)]
pub(super) struct Observations {
    // First concrete listener/task failure survives subsequent cleanup.
    failure: AtomicU8,
    pub accepted_connections: AtomicU32,
    pub authentication_challenges: AtomicU32,
    pub authenticated_requests: AtomicU32,
    pub destination_denials: AtomicU32,
    pub upstream_failures: AtomicU32,
    pub request_rejections: AtomicU32,
    pub capacity_refusals: AtomicU32,
}

pub(super) fn increment(counter: &AtomicU32) {
    let _ = counter.fetch_update(Ordering::Relaxed, Ordering::Relaxed, |value| {
        Some(value.saturating_add(1))
    });
}

impl Observations {
    pub fn listener_failed(&self) {
        let _ = self
            .failure
            .compare_exchange(0, 1, Ordering::Relaxed, Ordering::Relaxed);
    }

    pub fn task_ended(&self) {
        let _ = self
            .failure
            .compare_exchange(0, 2, Ordering::Relaxed, Ordering::Relaxed);
    }

    pub fn snapshot(&self, revoked: bool, finished: bool) -> PrivateProxyDiagnostics {
        let state = match self.failure.load(Ordering::Relaxed) {
            1 => PrivateProxyState::ListenerFailed,
            2 => PrivateProxyState::TaskEnded,
            _ if finished && !revoked => PrivateProxyState::TaskEnded,
            _ if finished => PrivateProxyState::Stopped,
            _ if revoked => PrivateProxyState::Revoking,
            _ => PrivateProxyState::Listening,
        };
        PrivateProxyDiagnostics {
            state,
            accepted_connections: self.accepted_connections.load(Ordering::Relaxed),
            authentication_challenges: self.authentication_challenges.load(Ordering::Relaxed),
            authenticated_requests: self.authenticated_requests.load(Ordering::Relaxed),
            destination_denials: self.destination_denials.load(Ordering::Relaxed),
            upstream_failures: self.upstream_failures.load(Ordering::Relaxed),
            request_rejections: self.request_rejections.load(Ordering::Relaxed),
            capacity_refusals: self.capacity_refusals.load(Ordering::Relaxed),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn counters_saturate_and_failure_survives_cleanup_without_shared_state() {
        let first = Observations::default();
        let second = Observations::default();
        first
            .accepted_connections
            .store(u32::MAX, Ordering::Relaxed);
        increment(&first.accepted_connections);
        first.listener_failed();
        first.task_ended();
        let snapshot = first.snapshot(true, true);
        assert_eq!(snapshot.state, PrivateProxyState::ListenerFailed);
        assert_eq!(snapshot.accepted_connections, u32::MAX);
        assert_eq!(
            second.snapshot(false, false).state,
            PrivateProxyState::Listening
        );
        assert_eq!(second.snapshot(false, false).accepted_connections, 0);
    }

    #[test]
    fn serialization_has_only_fixed_states_and_numeric_counters() {
        let observations = Observations::default();
        let value = serde_json::to_value(observations.snapshot(false, false)).unwrap();
        assert_eq!(
            value,
            serde_json::json!({
                "state": "listening",
                "acceptedConnections": 0,
                "authenticationChallenges": 0,
                "authenticatedRequests": 0,
                "destinationDenials": 0,
                "upstreamFailures": 0,
                "requestRejections": 0,
                "capacityRefusals": 0
            })
        );
        for (state, expected) in [
            (PrivateProxyState::Listening, "listening"),
            (PrivateProxyState::Revoking, "revoking"),
            (PrivateProxyState::Stopped, "stopped"),
            (PrivateProxyState::ListenerFailed, "listener-failed"),
            (PrivateProxyState::TaskEnded, "task-ended"),
        ] {
            assert_eq!(serde_json::to_value(state).unwrap(), expected);
        }
    }
}
