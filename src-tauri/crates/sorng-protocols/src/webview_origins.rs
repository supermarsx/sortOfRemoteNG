//! Native frame-navigation allowlist. Entries are live proxy leases, never a
//! wildcard localhost rule. This is NOT a WebSocket/WebRTC egress firewall.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU8, Ordering};
use std::sync::{Mutex, OnceLock};

// 0 = not installed yet, 1 = installed, 2 = failed. Unsupported platforms are
// reported separately and do not pretend that a Windows callback exists.
static FRAME_GUARD: AtomicU8 = AtomicU8::new(0);

pub fn mark_frame_guard_ready() {
    // Failure is latched for this app lifetime; a reentrant installation event
    // must not accidentally turn a failed callback into an enforced status.
    let _ = FRAME_GUARD.compare_exchange(0, 1, Ordering::SeqCst, Ordering::SeqCst);
}

pub fn mark_frame_guard_failed() {
    FRAME_GUARD.store(2, Ordering::SeqCst);
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FrameGuardStatus {
    pub platform: &'static str,
    pub frame_navigation: &'static str,
    pub all_network_requests_mediated: bool,
}

pub fn frame_guard_status() -> FrameGuardStatus {
    FrameGuardStatus {
        platform: std::env::consts::OS,
        frame_navigation: if cfg!(target_os = "windows") {
            match FRAME_GUARD.load(Ordering::SeqCst) {
                1 => "enforced",
                2 => "failed",
                _ => "initializing",
            }
        } else {
            "unsupported"
        },
        all_network_requests_mediated: false,
    }
}

/// Called before creating a browser proxy in the desktop app, so no iframe is
/// exposed during asynchronous Windows hook installation or after failure.
pub fn require_frame_guard_ready() -> Result<(), String> {
    if cfg!(target_os = "windows") && FRAME_GUARD.load(Ordering::SeqCst) != 1 {
        return Err("The embedded browser navigation guard is unavailable. Restart the application before opening a website.".into());
    }
    Ok(())
}

#[derive(Default)]
struct Registry {
    next_id: u64,
    origins: HashMap<String, u64>,
}

fn registry() -> &'static Mutex<Registry> {
    static REGISTRY: OnceLock<Mutex<Registry>> = OnceLock::new();
    REGISTRY.get_or_init(Mutex::default)
}

fn protected_origin(value: &str) -> Option<String> {
    let url = url::Url::parse(value).ok()?;
    if url.scheme() != "http" || !url.username().is_empty() || url.password().is_some() {
        return None;
    }
    let host = url.host_str()?;
    let token = host.strip_prefix('p')?.strip_suffix(".localhost")?;
    if token.len() != 32 || !token.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return None;
    }
    url.port().filter(|port| *port != 0)?;
    Some(url.origin().ascii_serialization())
}

/// Not cloneable: exactly one registration owns revocation. Callers may retain
/// an Arc to it for the listener and manager, and explicitly revoke on stop.
pub struct ProxyOriginLease {
    origin: String,
    id: u64,
}

impl ProxyOriginLease {
    /// Idempotent and identity checked: an old drop cannot revoke a new lease.
    pub fn revoke(&self) {
        if let Ok(mut registry) = registry().lock() {
            if registry.origins.get(&self.origin) == Some(&self.id) {
                registry.origins.remove(&self.origin);
            }
        }
    }
}

impl Drop for ProxyOriginLease {
    fn drop(&mut self) {
        self.revoke();
    }
}

pub fn acquire_proxy_origin(origin: &str) -> Result<ProxyOriginLease, String> {
    let canonical = protected_origin(origin)
        .filter(|canonical| canonical == origin)
        .ok_or_else(|| "Invalid protected proxy origin".to_string())?;
    let mut registry = registry()
        .lock()
        .map_err(|_| "Protected proxy origin registry unavailable".to_string())?;
    if registry.origins.contains_key(&canonical) {
        return Err("Protected proxy origin is already registered".into());
    }
    registry.next_id = registry
        .next_id
        .checked_add(1)
        .ok_or_else(|| "Protected proxy origin registry exhausted".to_string())?;
    let id = registry.next_id;
    registry.origins.insert(canonical.clone(), id);
    Ok(ProxyOriginLease {
        origin: canonical,
        id,
    })
}

/// about:srcdoc is needed by the application's sandboxed, script-free document
/// print frame. No remote URLs, data URLs, file URLs or arbitrary localhost ports.
pub fn allows_frame_url(value: &str) -> bool {
    if matches!(value, "about:blank" | "about:srcdoc") {
        return true;
    }
    let Some(origin) = protected_origin(value) else {
        return false;
    };
    registry()
        .lock()
        .is_ok_and(|registry| registry.origins.contains_key(&origin))
}

/// The document request event also observes the top-level app bootstrap. Its
/// origin is supplied by compiled Tauri configuration, never page headers.
/// Frame navigation still does NOT allow this app origin.
pub fn allows_document_url(value: &str, app_origin: &str) -> bool {
    if allows_frame_url(value) {
        return true;
    }
    url::Url::parse(value).is_ok_and(|url| {
        app_origin != "null"
            && url.username().is_empty()
            && url.password().is_none()
            && matches!(url.scheme(), "http" | "https" | "tauri")
            && url.origin().ascii_serialization() == app_origin
    })
}

#[cfg(test)]
mod tests {
    #[test]
    fn only_exact_live_proxy_origin_is_allowed_and_stop_is_immediate() {
        use super::*;
        let origin = "http://p0123456789abcdef0123456789abcdef.localhost:43129";
        assert!(!allows_frame_url(origin));
        let lease = acquire_proxy_origin(origin).unwrap();
        assert!(allows_frame_url(&format!("{origin}/login?x=1#next")));
        for url in [
            "https://example.com/",
            "http://localhost:43129/",
            "http://127.0.0.1:43129/",
            "http://p0123456789abcdef0123456789abcdef.localhost:43130/",
            "http://p0123456789abcdef0123456789abcdef.localhost.evil.test:43129/",
            "http://user@p0123456789abcdef0123456789abcdef.localhost:43129/",
            "https://p0123456789abcdef0123456789abcdef.localhost:43129/",
            "data:text/html,hello",
            "blob:http://p0123456789abcdef0123456789abcdef.localhost:43129/id",
            "javascript:alert(1)",
            "file:///C:/secret",
            "about:blank?external=1",
        ] {
            assert!(!allows_frame_url(url), "Unexpected frame permission");
        }
        assert!(acquire_proxy_origin(origin).is_err());
        lease.revoke();
        assert!(!allows_frame_url(origin));
        let replacement = acquire_proxy_origin(origin).unwrap();
        drop(lease);
        assert!(allows_frame_url(origin));
        drop(replacement);
        assert!(!allows_frame_url(origin));
    }

    #[test]
    fn registrations_are_canonical_origins_not_urls_or_wildcards() {
        use super::*;
        for input in [
            "http://*.localhost:1234",
            "http://p0123456789abcdef0123456789abcdef.localhost:0",
            "http://p0123456789abcdef0123456789abcdef.localhost:80",
            "http://p0123456789abcdef0123456789abcdef.localhost:1234/",
            "http://p0123456789abcdef0123456789abcdef.localhost:1234?secret=x",
            "http://p0123456789abcdef0123456789abcdef.localhost:1234#x",
        ] {
            assert!(acquire_proxy_origin(input).is_err());
        }
        assert!(allows_frame_url("about:blank"));
        assert!(allows_frame_url("about:srcdoc"));
        assert!(allows_document_url(
            "http://tauri.localhost/index.html",
            "http://tauri.localhost"
        ));
        assert!(!allows_frame_url("http://tauri.localhost/index.html"));
        assert!(allows_document_url(
            "http://localhost:3001/",
            "http://localhost:3001"
        ));
        assert!(!allows_document_url(
            "http://localhost:3002/",
            "http://localhost:3001"
        ));
        assert!(!allows_document_url(
            "http://user@tauri.localhost/",
            "http://tauri.localhost"
        ));
        assert!(!allows_document_url(
            "https://remote.test/",
            "http://tauri.localhost"
        ));
    }
}
