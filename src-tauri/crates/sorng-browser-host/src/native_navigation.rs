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
    pub fn take_expired(&mut self, now: std::time::Instant, limit: std::time::Duration) -> bool {
        if self.started.is_some_and(|start| now.checked_duration_since(start).is_some_and(|elapsed| elapsed >= limit)) { self.started = None; true } else { false }
    }
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
