//! Bounded application-wide diagnostics, not authorization or session attribution.
//! No URL paths, query strings, fragments, credentials, headers or bodies survive.

use std::collections::VecDeque;
use std::sync::{Mutex, OnceLock};

const CAPACITY: usize = 64;
const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpObservation {
    pub sequence: u64,
    pub method: &'static str,
    pub origin: String,
    pub resource_kind: &'static str,
    pub source_kind: &'static str,
    pub document_blocked: bool,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpObservations {
    pub scope: &'static str,
    pub total: u64,
    pub document_blocked: u64,
    pub recent: Vec<HttpObservation>,
}

#[derive(Default)]
struct Observations {
    total: u64,
    document_blocked: u64,
    recent: VecDeque<HttpObservation>,
}

fn method_category(method: &str) -> &'static str {
    match method {
        "GET" => "GET",
        "HEAD" => "HEAD",
        "POST" => "POST",
        "PUT" => "PUT",
        "PATCH" => "PATCH",
        "DELETE" => "DELETE",
        "OPTIONS" => "OPTIONS",
        "CONNECT" => "CONNECT",
        "TRACE" => "TRACE",
        _ => "OTHER",
    }
}

// Values are the documented WebView2 enums. Unknown future values never become
// unbounded diagnostic strings, and a WebSocket enum is not a coverage claim.
fn resource_category(kind: i32) -> &'static str {
    match kind {
        1 => "document",
        2 => "stylesheet",
        3 => "image",
        4 => "media",
        5 => "font",
        6 => "script",
        7 => "xhr",
        8 => "fetch",
        9 => "text-track",
        10 => "event-source",
        11 => "websocket",
        12 => "manifest",
        13 => "signed-exchange",
        14 => "ping",
        15 => "csp-report",
        _ => "other",
    }
}

fn source_category(kind: i32) -> &'static str {
    match kind {
        1 => "document",
        2 => "shared-worker",
        4 => "service-worker",
        _ => "unknown",
    }
}

impl Observations {
    fn record(&mut self, uri: &str, method: &str, resource: i32, source: i32, blocked: bool) {
        // Parsing cost is bounded; an oversized or invalid diagnostic is simply
        // omitted, never used to permit, cancel, or alter the actual request.
        if uri.len() > 65_536 {
            return;
        }
        let Ok(url) = url::Url::parse(uri) else {
            return;
        };
        if !matches!(url.scheme(), "http" | "https") {
            return;
        }
        let origin = url.origin().ascii_serialization();
        if origin.len() > 512 || url.host_str().is_none() {
            return;
        }
        self.total = self.total.saturating_add(1).min(MAX_SAFE_INTEGER);
        let document_blocked = resource == 1 && blocked;
        if document_blocked {
            self.document_blocked = self
                .document_blocked
                .saturating_add(1)
                .min(MAX_SAFE_INTEGER);
        }
        if self.recent.len() == CAPACITY {
            self.recent.pop_front();
        }
        self.recent.push_back(HttpObservation {
            sequence: self.total,
            method: method_category(method),
            origin,
            resource_kind: resource_category(resource),
            source_kind: source_category(source),
            document_blocked,
        });
    }

    fn snapshot(&self) -> HttpObservations {
        HttpObservations {
            scope: "application",
            total: self.total,
            document_blocked: self.document_blocked,
            recent: self.recent.iter().cloned().collect(),
        }
    }
}

fn observations() -> &'static Mutex<Observations> {
    static OBSERVATIONS: OnceLock<Mutex<Observations>> = OnceLock::new();
    OBSERVATIONS.get_or_init(Mutex::default)
}

pub fn record(uri: &str, method: &str, resource: i32, source: i32, document_blocked: bool) {
    // Diagnostics never interrupt a request or recover a poisoned authorization
    // guard. Contention/poisoning loses an observation instead of blocking UI.
    if let Ok(mut observations) = observations().try_lock() {
        observations.record(uri, method, resource, source, document_blocked);
    }
}

pub fn snapshot() -> Option<HttpObservations> {
    observations()
        .lock()
        .ok()
        .map(|observations| observations.snapshot())
}

#[cfg(test)]
mod tests {
    #[test]
    fn observation_redacts_secrets_and_uses_only_closed_categories() {
        let mut observations = super::Observations::default();
        observations.record(
            "https://user:secret@EXAMPLE.com:443/private?token=secret#secret",
            "SECRET",
            999,
            999,
            true,
        );
        let snapshot = observations.snapshot();
        let row = &snapshot.recent[0];
        assert_eq!(row.origin, "https://example.com");
        assert_eq!(
            (row.method, row.resource_kind, row.source_kind),
            ("OTHER", "other", "unknown")
        );
        assert!(!row.document_blocked);
        let json = serde_json::to_string(&snapshot).unwrap();
        for secret in ["user", "secret", "private", "token", "SECRET"] {
            assert!(!json.contains(secret));
        }
    }

    #[test]
    fn observation_is_http_only_capped_and_counters_are_safe() {
        let mut observations = super::Observations::default();
        for url in [
            "file:///secret",
            "data:text/plain,secret",
            "ws://example.com",
            "not a URL",
        ] {
            observations.record(url, "GET", 1, 1, true);
        }
        assert_eq!(observations.snapshot().total, 0);
        for _ in 0..100 {
            observations.record("http://[::1]:1234/path", "GET", 1, 1, true);
        }
        let snapshot = observations.snapshot();
        assert_eq!(snapshot.total, 100);
        assert_eq!(snapshot.document_blocked, 100);
        assert_eq!(snapshot.recent.len(), 64);
        assert_eq!(snapshot.recent[0].sequence, 37);
        assert_eq!(snapshot.recent[0].origin, "http://[::1]:1234");
        observations.total = super::MAX_SAFE_INTEGER;
        observations.record("https://example.com", "POST", 7, 4, false);
        assert_eq!(observations.snapshot().total, super::MAX_SAFE_INTEGER);
        assert_eq!(
            observations.snapshot().recent.last().unwrap().source_kind,
            "service-worker"
        );
    }
}
