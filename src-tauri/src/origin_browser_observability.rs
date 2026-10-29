//! Read-only live-session diagnostics. No page, address, token or credential data.
use serde::Serialize;
use sorng_browser_host::ipc::{OriginBrowserFailureReason, OriginBrowserPhase};
use sorng_protocols::private_forward_proxy::PrivateProxyDiagnostics;
use std::sync::atomic::{AtomicBool, AtomicU8, Ordering};

#[derive(Default)]
pub(crate) struct EngineObservations {
    revision: AtomicU8,
    proxy_applied: AtomicBool,
    http_cache: AtomicU8,
}

/// Which HTTP cache an attempt's context uses, and why not the disk (C-H4).
/// Fixed codes only: never a path, key or connection identifier.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum HttpCacheDiagnostic {
    Disk = 1,
    Disabled,
    NotLocal,
    EngineUnsupported,
    InUse,
    DeletePending,
    Unavailable,
    EngineRejected,
}

impl HttpCacheDiagnostic {
    const ALL: [Self; 8] = [
        Self::Disk,
        Self::Disabled,
        Self::NotLocal,
        Self::EngineUnsupported,
        Self::InUse,
        Self::DeletePending,
        Self::Unavailable,
        Self::EngineRejected,
    ];

    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Disk => "disk",
            Self::Disabled => "memory-disabled",
            Self::NotLocal => "memory-cache-location-not-local",
            Self::EngineUnsupported => "memory-engine-unsupported",
            Self::InUse => "memory-in-use",
            Self::DeletePending => "memory-delete-pending",
            Self::Unavailable => "memory-unavailable",
            Self::EngineRejected => "memory-engine-rejected",
        }
    }
}

impl EngineObservations {
    pub fn snapshot(&self) -> (Option<&'static str>, bool) {
        // A true ACK Acquire observes the revision published before its Release
        // store. Reading revision first could incorrectly pair unknown + true.
        let applied = self.proxy_applied_at_startup();
        (self.loaded_patch_id(), applied)
    }

    /// Actual loaded bridge metadata only; a renderer never supplies this value.
    pub fn observe_loaded(&self, patch: &str) {
        let revision = match patch {
            "sorng-tls-v2-682c378-1" => 1,
            "sorng-tls-v2-682c378-2" => 2,
            "sorng-tls-v2-682c378-3" => 3,
            "sorng-tls-v2-682c378-4" => 4,
            "sorng-tls-v2-682c378-5" => 5,
            "sorng-tls-v2-682c378-6" => 6,
            _ => return,
        };
        // One attempt cannot inherit metadata from a replacement engine.
        let _ = self
            .revision
            .compare_exchange(0, revision, Ordering::AcqRel, Ordering::Acquire);
    }

    pub fn observe_proxy_applied(&self) {
        if self.revision.load(Ordering::Acquire) >= 3 {
            self.proxy_applied.store(true, Ordering::Release);
        }
    }

    pub fn loaded_patch_id(&self) -> Option<&'static str> {
        match self.revision.load(Ordering::Acquire) {
            1 => Some("sorng-tls-v2-682c378-1"),
            2 => Some("sorng-tls-v2-682c378-2"),
            3 => Some("sorng-tls-v2-682c378-3"),
            4 => Some("sorng-tls-v2-682c378-4"),
            5 => Some("sorng-tls-v2-682c378-5"),
            6 => Some("sorng-tls-v2-682c378-6"),
            _ => None,
        }
    }

    pub fn proxy_applied_at_startup(&self) -> bool {
        self.proxy_applied.load(Ordering::Acquire)
    }

    /// Recorded once, when the attempt's context is created.
    pub fn observe_http_cache(&self, observed: HttpCacheDiagnostic) {
        let _ = self.http_cache.compare_exchange(
            0,
            observed as u8,
            Ordering::AcqRel,
            Ordering::Acquire,
        );
    }

    pub fn http_cache(&self) -> Option<&'static str> {
        let value = self.http_cache.load(Ordering::Acquire);
        HttpCacheDiagnostic::ALL
            .into_iter()
            .find(|candidate| *candidate as u8 == value)
            .map(HttpCacheDiagnostic::as_str)
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SessionIdentity {
    pub connection_id: String,
    pub session_id: String,
    pub attempt_id: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SessionDiagnostics {
    pub loaded_patch_id: Option<&'static str>,
    /// Historical proof for this attempt, not current listener reachability.
    pub proxy_applied_at_startup: bool,
    pub route_health: sorng_core::route_health::RouteHealthSnapshot,
    pub identity: SessionIdentity,
    /// None means a busy/poisoned snapshot, not a fabricated lifecycle state.
    pub phase: Option<OriginBrowserPhase>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub failure_reason: Option<OriginBrowserFailureReason>,
    /// None means a busy/poisoned session, never zero activity.
    pub proxy: Option<PrivateProxyDiagnostics>,
    /// Fixed HTTP cache code of this attempt; absent before its context.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub http_cache: Option<&'static str>,
}

#[cfg(test)]
mod engine_observation_tests {
    use super::*;

    #[test]
    fn unknown_and_legacy_engines_cannot_claim_proxy_application_proof() {
        for patch in [
            "unknown SECRET",
            "sorng-tls-v2-682c378-1",
            "sorng-tls-v2-682c378-2",
        ] {
            let evidence = EngineObservations::default();
            evidence.observe_loaded(patch);
            evidence.observe_proxy_applied();
            assert!(!evidence.proxy_applied_at_startup());
            assert_ne!(evidence.loaded_patch_id(), Some("unknown SECRET"));
        }
    }

    #[test]
    fn exact_observed_revision_and_ack_stay_bound_to_the_attempt() {
        let evidence = EngineObservations::default();
        evidence.observe_loaded("sorng-tls-v2-682c378-4");
        assert!(!evidence.proxy_applied_at_startup());
        evidence.observe_proxy_applied();
        evidence.observe_loaded("sorng-tls-v2-682c378-1");
        assert_eq!(evidence.loaded_patch_id(), Some("sorng-tls-v2-682c378-4"));
        assert!(evidence.proxy_applied_at_startup());
        assert!(!EngineObservations::default().proxy_applied_at_startup());
    }

    #[test]
    fn revision_six_is_reported_and_carries_proxy_application_proof() {
        let evidence = EngineObservations::default();
        evidence.observe_loaded("sorng-tls-v2-682c378-6");
        evidence.observe_proxy_applied();
        assert_eq!(evidence.snapshot(), (Some("sorng-tls-v2-682c378-6"), true));
        let unknown = EngineObservations::default();
        unknown.observe_loaded("sorng-tls-v2-682c378-7");
        assert_eq!(unknown.loaded_patch_id(), None);
    }

    #[test]
    fn http_cache_observation_is_a_fixed_code_recorded_once() {
        let evidence = EngineObservations::default();
        assert_eq!(evidence.http_cache(), None);
        evidence.observe_http_cache(HttpCacheDiagnostic::InUse);
        evidence.observe_http_cache(HttpCacheDiagnostic::Disk);
        assert_eq!(evidence.http_cache(), Some("memory-in-use"));
        let mut codes: Vec<_> = HttpCacheDiagnostic::ALL.iter().map(|code| code.as_str()).collect();
        assert!(codes.iter().all(|code| *code == "disk" || code.starts_with("memory-")));
        codes.sort();
        codes.dedup();
        assert_eq!(codes.len(), HttpCacheDiagnostic::ALL.len());
    }

    #[test]
    fn concurrent_startup_snapshots_never_pair_unknown_revision_with_ack() {
        for _ in 0..128 {
            let evidence = std::sync::Arc::new(EngineObservations::default());
            let start = std::sync::Arc::new(std::sync::Barrier::new(2));
            let writer_evidence = evidence.clone();
            let writer_start = start.clone();
            let writer = std::thread::spawn(move || {
                writer_start.wait();
                writer_evidence.observe_loaded("sorng-tls-v2-682c378-4");
                writer_evidence.observe_proxy_applied();
            });
            start.wait();
            for _ in 0..64 {
                let (patch, applied) = evidence.snapshot();
                assert!(!applied || patch == Some("sorng-tls-v2-682c378-4"));
                std::thread::yield_now();
            }
            writer.join().unwrap();
            assert_eq!(evidence.snapshot(), (Some("sorng-tls-v2-682c378-4"), true));
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SessionDiagnosticsResponse {
    /// Whether this build exposes native observations, not engine readiness.
    pub available: bool,
    pub sessions: Vec<SessionDiagnostics>,
}
