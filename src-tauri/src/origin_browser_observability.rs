//! Read-only live-session diagnostics. No page, address, token or credential data.
use serde::Serialize;
use sorng_browser_host::ipc::{OriginBrowserFailureReason, OriginBrowserPhase};
use sorng_protocols::private_forward_proxy::PrivateProxyDiagnostics;
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicU8, Ordering};

#[derive(Default)]
pub(crate) struct EngineObservations {
    revision: AtomicU8,
    proxy_applied: AtomicBool,
    http_cache: AtomicU8,
    tls_interception: AtomicU8,
    upstream: UpstreamCounters,
}

/// How an attempt handles HTTPS (t-mitmproxy K6). Decided once, before the
/// attempt's context exists; never switched mid-attempt.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum TlsInterceptionDiagnostic {
    /// The app's proxy terminates HTTPS (CUSTOM_ONLY context anchor).
    Active = 1,
    /// Direct TLS chosen in settings ("off").
    Passthrough,
    /// "auto", but the engine cannot trust a per-attempt CA (or the CA could
    /// not be created): Direct TLS for this attempt.
    Unavailable,
}

impl TlsInterceptionDiagnostic {
    const ALL: [Self; 3] = [Self::Active, Self::Passthrough, Self::Unavailable];

    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Active => "active",
            Self::Passthrough => "passthrough",
            Self::Unavailable => "interception-unavailable",
        }
    }
}

/// App-side upstream trust verdicts of an intercepting attempt. Counters
/// only: never a host, URL or certificate.
#[derive(Default)]
struct UpstreamCounters {
    admitted: AtomicU64,
    denied: AtomicU64,
    timeout: AtomicU64,
}

/// One app-side upstream trust verdict (K6 `UpstreamOutcome` subset that the
/// app decides; fatal and route failures end inside the proxy).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum UpstreamVerdictDiagnostic {
    Admitted,
    Denied,
    Timeout,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UpstreamDiagnostics {
    pub admitted: u64,
    pub denied: u64,
    pub timeout: u64,
}

/// K6 proxy cache counters of an intercepting attempt.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProxyCacheDiagnostics {
    pub hits: u64,
    pub misses: u64,
    pub revalidations: u64,
    pub stores: u64,
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
    /// Disk was leased but the proxy store could not open it.
    StoreUnavailable,
    /// Direct TLS: no proxy, so only Chromium's in-memory cache.
    DirectTls,
}

impl HttpCacheDiagnostic {
    const ALL: [Self; 10] = [
        Self::Disk,
        Self::Disabled,
        Self::NotLocal,
        Self::EngineUnsupported,
        Self::InUse,
        Self::DeletePending,
        Self::Unavailable,
        Self::EngineRejected,
        Self::StoreUnavailable,
        Self::DirectTls,
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
            Self::StoreUnavailable => "memory-store-unavailable",
            Self::DirectTls => "memory-direct-tls",
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

    /// Recorded once, before the attempt's context is created.
    pub fn observe_tls_interception(&self, observed: TlsInterceptionDiagnostic) {
        let _ = self.tls_interception.compare_exchange(
            0,
            observed as u8,
            Ordering::AcqRel,
            Ordering::Acquire,
        );
    }

    pub fn tls_interception(&self) -> Option<&'static str> {
        let value = self.tls_interception.load(Ordering::Acquire);
        TlsInterceptionDiagnostic::ALL
            .into_iter()
            .find(|candidate| *candidate as u8 == value)
            .map(TlsInterceptionDiagnostic::as_str)
    }

    pub fn observe_upstream(&self, verdict: UpstreamVerdictDiagnostic) {
        let counter = match verdict {
            UpstreamVerdictDiagnostic::Admitted => &self.upstream.admitted,
            UpstreamVerdictDiagnostic::Denied => &self.upstream.denied,
            UpstreamVerdictDiagnostic::Timeout => &self.upstream.timeout,
        };
        counter.fetch_add(1, Ordering::Relaxed);
    }

    pub fn upstream(&self) -> UpstreamDiagnostics {
        UpstreamDiagnostics {
            admitted: self.upstream.admitted.load(Ordering::Relaxed),
            denied: self.upstream.denied.load(Ordering::Relaxed),
            timeout: self.upstream.timeout.load(Ordering::Relaxed),
        }
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
    /// Fixed HTTPS handling code (t-mitmproxy); absent before its decision.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tls_interception: Option<&'static str>,
    /// App-side upstream trust verdicts; intercepting attempts only.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub upstream: Option<UpstreamDiagnostics>,
    /// Proxy cache counters; intercepting attempts with a readable session.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub proxy_cache: Option<ProxyCacheDiagnostics>,
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
        let mut codes: Vec<_> = HttpCacheDiagnostic::ALL
            .iter()
            .map(|code| code.as_str())
            .collect();
        assert!(codes
            .iter()
            .all(|code| *code == "disk" || code.starts_with("memory-")));
        codes.sort();
        codes.dedup();
        assert_eq!(codes.len(), HttpCacheDiagnostic::ALL.len());
    }

    #[test]
    fn interception_diagnostics_are_fixed_codes_and_counters_only() {
        let evidence = EngineObservations::default();
        assert_eq!(evidence.tls_interception(), None);
        evidence.observe_tls_interception(TlsInterceptionDiagnostic::Unavailable);
        evidence.observe_tls_interception(TlsInterceptionDiagnostic::Active);
        assert_eq!(
            evidence.tls_interception(),
            Some("interception-unavailable")
        );
        let codes: std::collections::HashSet<_> = TlsInterceptionDiagnostic::ALL
            .iter()
            .map(|code| code.as_str())
            .collect();
        assert_eq!(
            codes,
            ["active", "passthrough", "interception-unavailable"]
                .into_iter()
                .collect()
        );
        for verdict in [
            UpstreamVerdictDiagnostic::Admitted,
            UpstreamVerdictDiagnostic::Admitted,
            UpstreamVerdictDiagnostic::Denied,
            UpstreamVerdictDiagnostic::Timeout,
        ] {
            evidence.observe_upstream(verdict);
        }
        assert_eq!(
            evidence.upstream(),
            UpstreamDiagnostics {
                admitted: 2,
                denied: 1,
                timeout: 1
            }
        );
        assert_eq!(
            HttpCacheDiagnostic::StoreUnavailable.as_str(),
            "memory-store-unavailable"
        );
        assert_eq!(HttpCacheDiagnostic::DirectTls.as_str(), "memory-direct-tls");
    }

    /// No host, URL, path, fingerprint or identifier can reach the K6
    /// fields: they are fixed codes and numbers, whatever the attempt saw.
    #[test]
    fn serialized_interception_diagnostics_carry_no_host_or_url() {
        let evidence = EngineObservations::default();
        evidence.observe_tls_interception(TlsInterceptionDiagnostic::Active);
        evidence.observe_http_cache(HttpCacheDiagnostic::Disk);
        evidence.observe_upstream(UpstreamVerdictDiagnostic::Denied);
        let value = serde_json::json!({
            "tlsInterception": evidence.tls_interception(),
            "httpCache": evidence.http_cache(),
            "upstream": evidence.upstream(),
            "proxyCache": ProxyCacheDiagnostics { hits: 3, misses: 1, revalidations: 0, stores: 1 },
        });
        let mut strings = Vec::new();
        fn walk(value: &serde_json::Value, strings: &mut Vec<String>) {
            match value {
                serde_json::Value::String(text) => strings.push(text.clone()),
                serde_json::Value::Array(items) => {
                    items.iter().for_each(|item| walk(item, strings))
                }
                serde_json::Value::Object(map) => map.values().for_each(|item| walk(item, strings)),
                _ => {}
            }
        }
        walk(&value, &mut strings);
        strings.sort();
        // The only text values are the fixed codes; everything else is numbers.
        assert_eq!(strings, ["active", "disk"]);
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
