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

pub(crate) fn install(
    preferences: &mut impl ProxyPreferences,
    endpoint: SocketAddr,
) -> Result<(), ContextError> {
    validate_private_proxy_endpoint(endpoint).map_err(|_| ContextError::ProxyRejected)?;
    if !preferences.is_private() {
        return Err(ContextError::SharedContext);
    }
    let expected = FixedProxy {
        mode: "fixed_servers".into(),
        server: format!("http://{endpoint}"),
        // Remove Chromium's implicit loopback bypass. This is necessary, but
        // still insufficient to prove all-protocol traffic containment.
        bypass_list: "<-loopback>".into(),
    };
    if !preferences.write(&expected) {
        return Err(ContextError::ProxyRejected);
    }
    if preferences.read().as_ref() != Some(&expected) {
        return Err(ContextError::ProxyMismatch);
    }
    Ok(())
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
    }

    impl Default for Preferences {
        fn default() -> Self {
            Self {
                private: true,
                accepts_write: true,
                readback: None,
                tamper: false,
                writes: 0,
            }
        }
    }

    impl ProxyPreferences for Preferences {
        fn is_private(&self) -> bool {
            self.private
        }
        fn write(&mut self, settings: &FixedProxy) -> bool {
            self.writes += 1;
            if !self.accepts_write {
                return false;
            }
            let mut settings = settings.clone();
            if self.tamper {
                settings.bypass_list.clear();
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
}
