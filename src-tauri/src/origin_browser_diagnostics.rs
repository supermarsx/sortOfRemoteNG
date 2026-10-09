//! The diagnostic command accepts identity + canonical origin, never a request
//! template, proxy address, credential, path, header, body or TLS override.
use serde::Deserialize;
use sorng_browser_host::ipc::OriginBrowserIdentity;

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[cfg_attr(not(feature = "native-browser"), allow(dead_code))]
pub(crate) struct DiagnoseRequest {
    pub identity: OriginBrowserIdentity,
    pub origin: String,
}

pub(crate) type DiagnoseResponse = sorng_protocols::origin_browser_diagnostics::ProbeResponse;

/// Per-attempt gate released on every return, timeout, future cancellation or
/// unwind. This carries no process-global state and cannot outlive its attempt.
#[cfg(any(feature = "native-browser", test))]
pub(crate) struct ProbeBusyGuard<'a>(&'a std::sync::atomic::AtomicBool);

#[cfg(any(feature = "native-browser", test))]
impl<'a> ProbeBusyGuard<'a> {
    pub(crate) fn enter(busy: &'a std::sync::atomic::AtomicBool) -> Option<Self> {
        busy.compare_exchange(
            false,
            true,
            std::sync::atomic::Ordering::AcqRel,
            std::sync::atomic::Ordering::Acquire,
        )
        .ok()
        .map(|_| Self(busy))
    }
}

#[cfg(any(feature = "native-browser", test))]
impl Drop for ProbeBusyGuard<'_> {
    fn drop(&mut self) {
        self.0.store(false, std::sync::atomic::Ordering::Release);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn busy_guard_is_exclusive_and_cancellation_safe() {
        let busy = std::sync::atomic::AtomicBool::new(false);
        let first = ProbeBusyGuard::enter(&busy).unwrap();
        assert!(ProbeBusyGuard::enter(&busy).is_none());
        drop(first);
        assert!(ProbeBusyGuard::enter(&busy).is_some());
    }
}
