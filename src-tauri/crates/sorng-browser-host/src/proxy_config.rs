//! Engine-neutral preference transaction. This proves configuration only, not
//! containment: host readiness still needs native enforcement and runtime tests.

use sorng_protocols::origin_browser::validate_private_proxy_endpoint;
use std::net::SocketAddr;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct FixedProxy {
    pub mode: String,
    pub server: String,
    pub bypass_list: String,
}

pub(crate) trait ProxyPreferences {
    fn is_private(&self) -> bool;
    fn write(&mut self, settings: &FixedProxy) -> bool;
    fn read(&self) -> Option<FixedProxy>;
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum ContextError {
    #[cfg(feature = "cef-host")]
    #[error("Browser context must be prepared on its native UI thread")]
    WrongThread,
    #[cfg(feature = "cef-host")]
    #[error("Browser context no longer belongs to an active private session")]
    SessionUnavailable,
    #[cfg(feature = "cef-host")]
    #[error("The browser could not create an isolated request context")]
    CreationFailed,
    #[error("The browser context does not have private in-memory storage")]
    SharedContext,
    #[error("The browser context rejected its private proxy configuration")]
    ProxyRejected,
    #[error("The browser context did not retain its private proxy configuration")]
    ProxyMismatch,
}

// Remove Chromium's implicit loopback bypass. This is necessary, but still
// insufficient to prove all-protocol traffic containment.
const BYPASS: &str = "<-loopback>";
/// Reapply-only variant: one extra bypass for a reserved name (RFC 6761
/// `.invalid` never resolves, and the process-wide `MAP * ^NOTFOUND` resolver
/// rule rejects it before DNS). Every reachable request still uses the relay.
const REAPPLY_BYPASS: &str = "<-loopback>;sorng-proxy-reapply.invalid";

fn fixed(endpoint: SocketAddr, bypass_list: &str) -> FixedProxy {
    FixedProxy {
        mode: "fixed_servers".into(),
        server: format!("http://{endpoint}"),
        bypass_list: bypass_list.into(),
    }
}

fn write_verified(
    preferences: &mut impl ProxyPreferences,
    value: &FixedProxy,
) -> Result<(), ContextError> {
    if !preferences.write(value) {
        return Err(ContextError::ProxyRejected);
    }
    if preferences.read().as_ref() != Some(value) {
        return Err(ContextError::ProxyMismatch);
    }
    Ok(())
}

fn admit(preferences: &impl ProxyPreferences, endpoint: SocketAddr) -> Result<(), ContextError> {
    validate_private_proxy_endpoint(endpoint).map_err(|_| ContextError::ProxyRejected)?;
    if !preferences.is_private() {
        return Err(ContextError::SharedContext);
    }
    Ok(())
}

pub(crate) fn install(
    preferences: &mut impl ProxyPreferences,
    endpoint: SocketAddr,
) -> Result<(), ContextError> {
    admit(preferences, endpoint)?;
    write_verified(preferences, &fixed(endpoint, BYPASS))
}

/// Push the exact relay to the engine's network context again, even when the
/// preference already holds it.
///
/// Writing an equal value is not a reassertion: Chromium drops it twice before
/// any network context hears of it (`PrefValueMap::SetValue` returns false for
/// an equal value, so no pref observer runs, and
/// `PrefProxyConfigTrackerImpl::OnProxyPrefChanged` forwards only a changed
/// config). A network context holding a stale proxy would keep it. Writing a
/// semantically different variant of the same relay first makes both writes
/// real changes, so the context receives the exact relay as the newest of two
/// ordered updates on its proxy-config pipe. The variant still sends every
/// reachable request to this relay, so a request that races the two updates
/// is not failed, and no intermediate state allows a direct, system or PAC
/// route. This is delivery, not proof: only the patched runtime ACKs it.
pub(crate) fn reapply(
    preferences: &mut impl ProxyPreferences,
    endpoint: SocketAddr,
) -> Result<(), ContextError> {
    admit(preferences, endpoint)?;
    write_verified(preferences, &fixed(endpoint, REAPPLY_BYPASS))?;
    write_verified(preferences, &fixed(endpoint, BYPASS))
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Preferences {
        private: bool,
        accepts_write: bool,
        readback: Option<FixedProxy>,
        tamper: bool,
        writes: usize,
        /// Accepted writes, in order.
        history: Vec<FixedProxy>,
        /// Like Chromium's pref store: observers run only for a changed value.
        notifications: Vec<FixedProxy>,
        /// Reject writes after this many have been attempted.
        reject_after: Option<usize>,
    }

    impl Default for Preferences {
        fn default() -> Self {
            Self {
                private: true,
                accepts_write: true,
                readback: None,
                tamper: false,
                writes: 0,
                history: Vec::new(),
                notifications: Vec::new(),
                reject_after: None,
            }
        }
    }

    impl ProxyPreferences for Preferences {
        fn is_private(&self) -> bool {
            self.private
        }
        fn write(&mut self, settings: &FixedProxy) -> bool {
            self.writes += 1;
            if !self.accepts_write || self.reject_after.is_some_and(|limit| self.writes > limit) {
                return false;
            }
            let mut settings = settings.clone();
            if self.tamper {
                settings.bypass_list.clear();
            }
            self.history.push(settings.clone());
            if self.readback.as_ref() != Some(&settings) {
                self.notifications.push(settings.clone());
            }
            self.readback = Some(settings);
            true
        }
        fn read(&self) -> Option<FixedProxy> {
            self.readback.clone()
        }
    }

    #[test]
    fn installs_fixed_authenticated_relay_endpoint_without_secrets_or_fallback() {
        let mut prefs = Preferences::default();
        install(&mut prefs, "127.0.0.1:12345".parse().unwrap()).unwrap();
        assert_eq!(
            prefs.readback.unwrap(),
            FixedProxy {
                mode: "fixed_servers".into(),
                server: "http://127.0.0.1:12345".into(),
                bypass_list: "<-loopback>".into(),
            }
        );
    }

    #[test]
    fn brackets_ipv6_relay() {
        let mut prefs = Preferences::default();
        install(&mut prefs, "[::1]:12345".parse().unwrap()).unwrap();
        assert_eq!(prefs.readback.unwrap().server, "http://[::1]:12345");
    }

    #[test]
    fn refuses_shared_context_before_writing() {
        let mut prefs = Preferences {
            private: false,
            ..Default::default()
        };
        assert_eq!(
            install(&mut prefs, "127.0.0.1:12345".parse().unwrap()),
            Err(ContextError::SharedContext)
        );
        assert_eq!(prefs.writes, 0);
    }

    #[test]
    fn refuses_invalid_endpoint_before_writing() {
        for endpoint in ["127.0.0.1:0", "192.0.2.1:12345", "[::1%5]:12345"] {
            let mut prefs = Preferences::default();
            assert_eq!(
                install(&mut prefs, endpoint.parse().unwrap()),
                Err(ContextError::ProxyRejected)
            );
            assert_eq!(prefs.writes, 0);
        }
    }

    #[test]
    fn refuses_rejected_preference() {
        let mut prefs = Preferences {
            accepts_write: false,
            ..Default::default()
        };
        assert_eq!(
            install(&mut prefs, "127.0.0.1:12345".parse().unwrap()),
            Err(ContextError::ProxyRejected)
        );
    }

    #[test]
    fn refuses_modified_readback() {
        let mut prefs = Preferences {
            tamper: true,
            ..Default::default()
        };
        assert_eq!(
            install(&mut prefs, "127.0.0.1:12345".parse().unwrap()),
            Err(ContextError::ProxyMismatch)
        );
    }

    fn relay(port: u16) -> FixedProxy {
        FixedProxy {
            mode: "fixed_servers".into(),
            server: format!("http://127.0.0.1:{port}"),
            bypass_list: "<-loopback>".into(),
        }
    }

    fn variant(port: u16) -> FixedProxy {
        FixedProxy {
            bypass_list: REAPPLY_BYPASS.into(),
            ..relay(port)
        }
    }

    fn deny() -> FixedProxy {
        FixedProxy {
            mode: "fixed_servers".into(),
            server: "http://sorng-unowned-context.invalid:9".into(),
            bypass_list: "<-loopback>".into(),
        }
    }

    #[test]
    fn installing_an_equal_value_again_notifies_nobody() {
        // The defect reapply() exists for: an equal write is silently dropped.
        let mut prefs = Preferences::default();
        let endpoint = "127.0.0.1:12345".parse().unwrap();
        install(&mut prefs, endpoint).unwrap();
        install(&mut prefs, endpoint).unwrap();
        assert_eq!(prefs.writes, 2);
        assert_eq!(prefs.notifications, vec![relay(12345)]);
    }

    #[test]
    fn reapply_delivers_the_exact_relay_as_a_fresh_change_when_already_current() {
        let mut prefs = Preferences::default();
        let endpoint = "127.0.0.1:12345".parse().unwrap();
        install(&mut prefs, endpoint).unwrap();
        reapply(&mut prefs, endpoint).unwrap();
        assert_eq!(
            prefs.history,
            vec![relay(12345), variant(12345), relay(12345)]
        );
        // Both reapply writes reach observers; the exact relay is the newest.
        assert_eq!(
            prefs.notifications,
            vec![relay(12345), variant(12345), relay(12345)]
        );
        assert_eq!(prefs.readback, Some(relay(12345)));
    }

    #[test]
    fn reapply_replaces_an_inherited_deny_or_a_predecessor_relay() {
        for inherited in [deny(), relay(40001)] {
            let mut prefs = Preferences {
                readback: Some(inherited),
                ..Default::default()
            };
            reapply(&mut prefs, "127.0.0.1:40002".parse().unwrap()).unwrap();
            assert_eq!(prefs.readback, Some(relay(40002)));
            assert_eq!(prefs.notifications, vec![variant(40002), relay(40002)]);
        }
    }

    #[test]
    fn every_reapply_write_routes_reachable_traffic_only_to_this_relay() {
        for endpoint in ["127.0.0.1:12345", "[::1]:12345"] {
            let mut prefs = Preferences::default();
            let endpoint: SocketAddr = endpoint.parse().unwrap();
            reapply(&mut prefs, endpoint).unwrap();
            assert_eq!(prefs.history.len(), 2);
            for written in &prefs.history {
                assert_eq!(written.mode, "fixed_servers");
                // One proxy, no DIRECT/PAC/system alternative.
                assert_eq!(written.server, format!("http://{endpoint}"));
                // Never re-adds Chromium's implicit loopback bypass, and the only
                // extra bypass entry is the reserved, unresolvable name.
                let mut rules = written.bypass_list.split(';');
                assert_eq!(rules.next(), Some("<-loopback>"));
                for rule in rules {
                    assert_eq!(rule, "sorng-proxy-reapply.invalid");
                }
            }
            assert_eq!(prefs.readback, Some(fixed(endpoint, BYPASS)));
        }
    }

    #[test]
    fn reapply_refuses_shared_context_or_invalid_endpoint_before_any_write() {
        let mut shared = Preferences {
            private: false,
            ..Default::default()
        };
        assert_eq!(
            reapply(&mut shared, "127.0.0.1:12345".parse().unwrap()),
            Err(ContextError::SharedContext)
        );
        assert_eq!(shared.writes, 0);
        for endpoint in ["127.0.0.1:0", "192.0.2.1:12345", "[::1%5]:12345"] {
            let mut prefs = Preferences {
                readback: Some(relay(40001)),
                ..Default::default()
            };
            assert_eq!(
                reapply(&mut prefs, endpoint.parse().unwrap()),
                Err(ContextError::ProxyRejected)
            );
            assert_eq!(prefs.writes, 0);
            assert_eq!(prefs.readback, Some(relay(40001)));
        }
    }

    #[test]
    fn reapply_reports_rejected_or_altered_writes() {
        // First write rejected: nothing changed and the second is not tried.
        let mut rejected = Preferences {
            accepts_write: false,
            readback: Some(relay(40002)),
            ..Default::default()
        };
        assert_eq!(
            reapply(&mut rejected, "127.0.0.1:40002".parse().unwrap()),
            Err(ContextError::ProxyRejected)
        );
        assert_eq!(rejected.writes, 1);
        assert_eq!(rejected.readback, Some(relay(40002)));
        // Second write rejected: an error, and the context still names only
        // this relay (the reapply variant), never a direct route.
        let mut partial = Preferences {
            readback: Some(relay(40002)),
            reject_after: Some(1),
            ..Default::default()
        };
        assert_eq!(
            reapply(&mut partial, "127.0.0.1:40002".parse().unwrap()),
            Err(ContextError::ProxyRejected)
        );
        assert_eq!(partial.readback, Some(variant(40002)));
        // An altered readback stops before the second write.
        let mut tampered = Preferences {
            tamper: true,
            ..Default::default()
        };
        assert_eq!(
            reapply(&mut tampered, "127.0.0.1:40002".parse().unwrap()),
            Err(ContextError::ProxyMismatch)
        );
        assert_eq!(tampered.writes, 1);
    }
}
