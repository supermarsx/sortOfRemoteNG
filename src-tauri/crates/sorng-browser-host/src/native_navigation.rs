//! Load errors describe a document request, not the lifetime of its browser.
//! This module deliberately accepts no URL, engine text or request payload.

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LoadFailureCategory {
    Dns,
    Connection,
    Timeout,
    NetworkChanged,
    Offline,
    Proxy,
    Certificate,
    Tls,
    Blocked,
    Http,
    Redirect,
    Cache,
    Other,
}

impl LoadFailureCategory {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Dns => "dns",
            Self::Connection => "connection",
            Self::Timeout => "timeout",
            Self::NetworkChanged => "network-changed",
            Self::Offline => "offline",
            Self::Proxy => "proxy",
            Self::Certificate => "certificate",
            Self::Tls => "tls",
            Self::Blocked => "blocked",
            Self::Http => "http",
            Self::Redirect => "redirect",
            Self::Cache => "cache",
            Self::Other => "other",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct LoadFailure {
    pub code: i32,
    pub category: LoadFailureCategory,
}

/// Tracks the first real address after attachment, independently of loading
/// callbacks (which can stop while Chromium still exposes about:blank).
#[derive(Default)]
pub struct FirstAddressWatch { started: Option<std::time::Instant> }
impl FirstAddressWatch {
    pub fn start(&mut self, now: std::time::Instant) { self.started.get_or_insert(now); }
    /// The owner passes its native HTTP(S) address admission result. Keeping
    /// this timer std-only also permits deterministic engine-free fixtures.
    pub fn observe(&mut self, website_address: bool) {
        if website_address { self.started = None; }
    }
    /// A provisional address or stopped-loading event is not completion proof.
    /// The app passes verified native main-document completion independently
    /// of whether its consumer observed the earlier loading transition.
    /// A terminal native error settles this initial-load deadline. Later blank
    /// callbacks must not replace its concrete failure with a synthetic timeout.
    pub fn observe_failure(&mut self) { self.started = None; }
    pub fn observe_document(&mut self, website_address: bool, document_loaded: bool) {
        self.observe(website_address && document_loaded);
    }
    pub fn take_expired(&mut self, now: std::time::Instant, limit: std::time::Duration) -> bool {
        if self.started.is_some_and(|start| now.checked_duration_since(start).is_some_and(|elapsed| elapsed >= limit)) { self.started = None; true } else { false }
    }
}

/// Decide whether the initial-document watchdog still describes an unresolved
/// load. A concrete CEF failure or completed document wins over a stale timer.
pub fn initial_document_timeout_failure(existing: Option<LoadFailure>, document_loaded: bool) -> Option<LoadFailure> {
    if existing.is_some() || document_loaded { None } else { classify_load_error(-118, true) }
}

/// CEF net_error_list.h numeric values. Cancellations, downloads and superseded
/// navigations use ABORTED; IO_PENDING is not a completed failure. A subframe
/// error must never replace the main document's state. No result retries a
/// request, revokes the browser, or changes route/certificate permissions.
pub fn classify_load_error(code: i32, main_frame: bool) -> Option<LoadFailure> {
    if !main_frame || code >= 0 || matches!(code, -1 | -3) {
        return None;
    }
    use LoadFailureCategory::*;
    let category = match code {
        -105 | -137 | -899..=-800 => Dns,
        -7 | -118 => Timeout,
        -21 => NetworkChanged,
        -106 => Offline,
        -111 | -115 | -120 | -121 | -127 | -130 | -131 | -136 | -186 | -187 | -188 | -364
        | -366 => Proxy,
        -299..=-200 => Certificate,
        -107 | -110 | -113 | -114 | -117 | -123 | -125 | -126 | -134 | -135 | -141 | -150
        | -151 | -153 | -156 | -159 | -164 | -167 | -172 | -177 | -181 | -501 => Tls,
        -20 | -22 | -27 | -29 | -30 | -32 | -33 | -34 | -35 | -36 | -138 => Blocked,
        -104..=-100 | -109 => Connection,
        -310 => Redirect,
        -414..=-400 => Cache,
        -399..=-300 => Http,
        _ => Other,
    };
    Some(LoadFailure { code, category })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn initial_watchdog_preserves_terminal_native_failure_and_completed_document() {
        use std::time::{Duration, Instant};
        for code in [-130, -111, -118, -105] {
            let failure = classify_load_error(code, true).unwrap();
            assert_eq!(initial_document_timeout_failure(Some(failure), false), None);
            let start = Instant::now();
            let mut watch = FirstAddressWatch::default();
            watch.start(start);
            watch.observe_failure();
            watch.observe_document(false, false);
            watch.observe_document(true, false);
            assert!(!watch.take_expired(start + Duration::from_secs(31), Duration::from_secs(30)));
        }
        assert_eq!(initial_document_timeout_failure(None, true), None);
        assert_eq!(initial_document_timeout_failure(None, false).unwrap().code, -118);
    }
    #[test]
    fn initial_document_deadline_requires_admitted_completion_and_survives_provisional_addresses() {
        use std::time::{Duration, Instant};
        let start = Instant::now();
        let limit = Duration::from_secs(30);
        for (address, completed) in [(true, false), (false, true), (false, false)] {
            let mut watch = FirstAddressWatch::default();
            watch.start(start);
            watch.observe_document(address, completed);
            watch.start(start + Duration::from_secs(25));
            watch.observe_document(address, completed);
            assert!(!watch.take_expired(start + Duration::from_secs(29), limit));
            assert!(watch.take_expired(start + Duration::from_secs(30), limit));
        }
        let mut fast = FirstAddressWatch::default();
        fast.start(start);
        fast.observe_document(true, true);
        assert!(!fast.take_expired(start + Duration::from_secs(31), limit));
    }
    #[test]
    fn first_address_wait_is_bounded_and_blank_observations_cannot_restart_or_clear_it() {
        use std::time::{Duration, Instant};
        let start = Instant::now();
        let mut watch = FirstAddressWatch::default();
        watch.start(start);
        watch.observe(false); watch.observe(false); watch.observe(false);
        watch.start(start + Duration::from_secs(25));
        assert!(!watch.take_expired(start + Duration::from_secs(29), Duration::from_secs(30)));
        assert!(watch.take_expired(start + Duration::from_secs(30), Duration::from_secs(30)));
        assert!(!watch.take_expired(start + Duration::from_secs(31), Duration::from_secs(30)));
        watch.start(start);
        watch.observe(true);
        assert!(!watch.take_expired(start + Duration::from_secs(31), Duration::from_secs(30)));
    }

    #[test]
    fn cancelled_download_and_subframe_callbacks_do_not_fail_the_tab() {
        for code in [0, -1, -3, 200, 301, 401, 403, 404, 407, 500, 502, 503] {
            assert_eq!(classify_load_error(code, true), None);
        }
        for code in [-2, -21, -105, -111, -200, -27, -310, -379] {
            assert_eq!(classify_load_error(code, false), None);
        }
    }

    #[test]
    fn navigation_failures_keep_numeric_evidence_and_fixed_categories() {
        for (code, category) in [
            (-105, "dns"),
            (-118, "timeout"),
            (-21, "network-changed"),
            (-106, "offline"),
            (-130, "proxy"),
            (-111, "proxy"), // ERR_TUNNEL_CONNECTION_FAILED, not an HTTP status
            (-202, "certificate"),
            (-107, "tls"),
            (-20, "blocked"),
            (-102, "connection"),
            (-310, "redirect"),
            (-400, "cache"),
            (-324, "http"),
            (-2, "other"),
            (-9999, "other"),
        ] {
            let failure = classify_load_error(code, true).unwrap();
            assert_eq!(failure.code, code);
            assert_eq!(failure.category.as_str(), category);
        }
    }
}
