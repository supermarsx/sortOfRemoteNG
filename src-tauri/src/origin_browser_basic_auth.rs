//! Temporary, native-only HTTP Basic credentials. Never a proxy or form grant.
use super::{NativeAuthorityError, NativeOwnerLease};
use sorng_browser_host::ipc::OriginBrowserQuickConnect;
use sorng_protocols::origin_browser::{BrowserIdentity, OriginBrowserPolicy};
use std::sync::{
    atomic::{AtomicBool, AtomicUsize, Ordering},
    Arc,
};
use url::{Host, Url};
use zeroize::Zeroizing;

const MAX_CREDENTIAL_BYTES: usize = 16_384;
const MAX_URL_BYTES: usize = 16_384;
// Bound repeated 401s, including parallel resource challenges, for one attempt.
const MAX_RESPONSES: usize = 32;

/// No Debug, Clone or serde: secrets stay in the owning browser process.
pub struct NativeBasicAuth {
    grant: BasicAuthGrant,
    lease: NativeOwnerLease,
}

impl NativeBasicAuth {
    pub(super) fn new(
        quick: &OriginBrowserQuickConnect,
        policy: &OriginBrowserPolicy,
        lease: &NativeOwnerLease,
    ) -> Result<Option<Arc<Self>>, NativeAuthorityError> {
        let Some(grant) = BasicAuthGrant::new(quick, policy)? else {
            return Ok(None);
        };
        if !lease.is_temporary() || !lease.is_current() {
            return Err(NativeAuthorityError::OwnerUnavailable);
        }
        Ok(Some(Arc::new(Self {
            grant,
            lease: lease.clone(),
        })))
    }

    /// Native non-proxy challenge only. Borrow synchronously, at most once.
    #[allow(clippy::too_many_arguments)]
    pub fn with_credentials(
        &self,
        identity: &BrowserIdentity,
        origin_url: &str,
        host: &str,
        port: u16,
        scheme: &str,
        deliver: &mut dyn FnMut(&str, &str),
    ) -> bool {
        self.grant.with_credentials(
            identity,
            origin_url,
            host,
            port,
            scheme,
            || self.lease.is_current(),
            deliver,
        )
    }

    pub fn revoke(&self) {
        self.grant.revoke();
    }
}

struct BasicAuthGrant {
    identity: BrowserIdentity,
    source: Url,
    username: Zeroizing<String>,
    password: Zeroizing<String>,
    revoked: AtomicBool,
    responses: AtomicUsize,
}

impl BasicAuthGrant {
    fn new(
        quick: &OriginBrowserQuickConnect,
        policy: &OriginBrowserPolicy,
    ) -> Result<Option<Self>, NativeAuthorityError> {
        let username = quick.basic_auth_username.as_deref().unwrap_or("");
        let password = quick.basic_auth_password.as_deref().unwrap_or("");
        if [username, password]
            .iter()
            .any(|value| value.len() > MAX_CREDENTIAL_BYTES || value.chars().any(char::is_control))
            || username.contains(':')
        {
            return Err(NativeAuthorityError::CredentialUnavailable);
        }
        if username.is_empty() && password.is_empty() {
            return Ok(None);
        }
        let source =
            challenge_url(policy.source_origin()).ok_or(NativeAuthorityError::SourceMismatch)?;
        let requested_source = super::saved_source(&serde_json::json!({
            "protocol": quick.protocol,
            "hostname": quick.hostname,
            "port": quick.port,
        }))?;
        // A source HTTPS grant can never be downgraded. Cleartext is authorized
        // only by the user's explicit Quick Connect HTTP selection.
        if source.scheme() != quick.protocol
            || source.port_or_known_default() != Some(quick.port)
            || requested_source.origin() != source.origin()
        {
            return Err(NativeAuthorityError::SourceMismatch);
        }
        Ok(Some(Self {
            identity: policy.identity().clone(),
            source,
            username: Zeroizing::new(username.to_owned()),
            password: Zeroizing::new(password.to_owned()),
            revoked: AtomicBool::new(false),
            responses: AtomicUsize::new(0),
        }))
    }

    fn revoke(&self) {
        self.revoked.store(true, Ordering::Release);
    }

    #[allow(clippy::too_many_arguments)]
    fn with_credentials(
        &self,
        identity: &BrowserIdentity,
        origin_url: &str,
        host: &str,
        port: u16,
        scheme: &str,
        lease_current: impl Fn() -> bool,
        deliver: &mut dyn FnMut(&str, &str),
    ) -> bool {
        if identity != &self.identity
            || self.revoked.load(Ordering::Acquire)
            || !scheme.eq_ignore_ascii_case("basic")
            || port == 0
            || self.source.port_or_known_default() != Some(port)
            || !challenge_url(origin_url).is_some_and(|url| url.origin() == self.source.origin())
            || !challenge_host_matches(&self.source, host)
        {
            return false;
        }
        if !lease_current() {
            self.revoke();
            return false;
        }
        if self
            .responses
            .fetch_update(Ordering::AcqRel, Ordering::Acquire, |count| {
                (count < MAX_RESPONSES).then_some(count + 1)
            })
            .is_err()
        {
            return false;
        }
        if !lease_current() || self.revoked.load(Ordering::Acquire) {
            self.revoke();
            return false;
        }
        deliver(&self.username, &self.password);
        true
    }
}

fn challenge_url(value: &str) -> Option<Url> {
    if value.len() > MAX_URL_BYTES
        || value
            .chars()
            .any(|c| c.is_control() || c.is_whitespace() || c == '\\')
    {
        return None;
    }
    let (_, remainder) = value.split_once("://")?;
    let authority = remainder.split(['/', '?', '#']).next()?;
    if authority.is_empty() || authority.contains(['@', '%', '*']) || authority.ends_with(':') {
        return None;
    }
    let url = Url::parse(value).ok()?;
    (matches!(url.scheme(), "http" | "https")
        && url.has_host()
        && url.username().is_empty()
        && url.password().is_none()
        && url.port_or_known_default().is_some_and(|port| port != 0))
    .then_some(url)
}

fn challenge_host_matches(source: &Url, host: &str) -> bool {
    if host.is_empty()
        || host.len() > 1024
        || host.chars().any(|c| c.is_control() || c.is_whitespace())
        || host.contains(['/', '\\', '@', '%', '?', '#'])
    {
        return false;
    }
    // CEF may provide a numeric IPv6 host without the URL's brackets.
    if let Some(Host::Ipv6(expected)) = source.host() {
        let raw = host
            .strip_prefix('[')
            .and_then(|s| s.strip_suffix(']'))
            .unwrap_or(host);
        return raw.parse::<std::net::Ipv6Addr>().ok() == Some(expected);
    }
    Host::parse(host).ok().as_ref().map(|host| host.to_string())
        == source.host().map(|host| host.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;

    fn fixture(source: &str) -> (OriginBrowserQuickConnect, OriginBrowserPolicy) {
        let url = Url::parse(source).unwrap();
        let policy =
            OriginBrowserPolicy::new("quick-connect:session", "connection", "session", source)
                .unwrap();
        let quick = OriginBrowserQuickConnect {
            protocol: url.scheme().into(),
            hostname: source.into(),
            port: url.port_or_known_default().unwrap(),
            http_verify_ssl: true,
            basic_auth_username: Some("website-user".into()),
            basic_auth_password: Some("website-secret".into()),
        };
        (quick, policy)
    }

    fn answer(
        grant: &BasicAuthGrant,
        identity: &BrowserIdentity,
        url: &str,
        host: &str,
        port: u16,
        scheme: &str,
    ) -> bool {
        let mut calls = 0;
        let allowed = grant.with_credentials(
            identity,
            url,
            host,
            port,
            scheme,
            || true,
            &mut |user, password| {
                assert_eq!(user, "website-user");
                assert_eq!(password, "website-secret");
                calls += 1;
            },
        );
        assert_eq!(calls, usize::from(allowed));
        allowed
    }

    #[test]
    fn basic_auth_exact_https_origin_and_native_authority_only() {
        let (quick, policy) = fixture("https://example.test:8443");
        let grant = BasicAuthGrant::new(&quick, &policy).unwrap().unwrap();
        assert!(answer(
            &grant,
            policy.identity(),
            "https://EXAMPLE.test:8443/path?q=1",
            "EXAMPLE.test",
            8443,
            "Basic"
        ));
        for (url, host, port, scheme) in [
            ("http://example.test:8443/", "example.test", 8443, "basic"),
            ("https://other.test:8443/", "other.test", 8443, "basic"),
            ("https://example.test/", "example.test", 8443, "basic"),
            ("https://example.test:8443/", "other.test", 8443, "basic"),
            ("https://example.test:8443/", "example.test", 443, "basic"),
            ("https://example.test:8443/", "example.test", 0, "basic"),
            ("https://example.test:8443/", "example.test", 8443, "digest"),
            (
                "https://user@example.test:8443/",
                "example.test",
                8443,
                "basic",
            ),
            ("https://@example.test:8443/", "example.test", 8443, "basic"),
            ("https:///example.test:8443/", "example.test", 8443, "basic"),
            (
                "https://example.test:8443/\n",
                "example.test",
                8443,
                "basic",
            ),
            (
                "https://example.test:8443/",
                "example.test:8443",
                8443,
                "basic",
            ),
        ] {
            assert!(!answer(&grant, policy.identity(), url, host, port, scheme));
        }
        let (_, successor) = fixture("https://example.test:8443");
        assert!(!answer(
            &grant,
            successor.identity(),
            "https://example.test:8443/",
            "example.test",
            8443,
            "basic"
        ));
    }

    #[test]
    fn basic_auth_http_requires_explicit_http_and_does_not_cross_schemes() {
        let (mut quick, policy) = fixture("http://example.test");
        let grant = BasicAuthGrant::new(&quick, &policy).unwrap().unwrap();
        assert!(answer(
            &grant,
            policy.identity(),
            "http://example.test:80/path",
            "example.test",
            80,
            "BASIC"
        ));
        assert!(!answer(
            &grant,
            policy.identity(),
            "https://example.test:80/path",
            "example.test",
            80,
            "basic"
        ));
        quick.protocol = "https".into();
        assert!(BasicAuthGrant::new(&quick, &policy).is_err());
        let (mut quick, policy) = fixture("https://example.test");
        quick.protocol = "http".into();
        assert!(BasicAuthGrant::new(&quick, &policy).is_err());
    }

    #[test]
    fn basic_auth_constructor_rejects_different_quick_connect_source() {
        let (mut quick, policy) = fixture("https://example.test");
        quick.hostname = "https://other.test".into();
        assert!(BasicAuthGrant::new(&quick, &policy).is_err());
        quick.hostname = "https://example.test".into();
        quick.port = 8443;
        assert!(BasicAuthGrant::new(&quick, &policy).is_err());
    }

    #[test]
    fn basic_auth_ipv6_and_default_port_canonicalization() {
        let (quick, policy) = fixture("https://[::1]");
        let grant = BasicAuthGrant::new(&quick, &policy).unwrap().unwrap();
        for host in ["::1", "[::1]", "0:0:0:0:0:0:0:1"] {
            assert!(answer(
                &grant,
                policy.identity(),
                "https://[::1]:443/",
                host,
                443,
                "basic"
            ));
        }
        assert!(!answer(
            &grant,
            policy.identity(),
            "https://[::1]/",
            "localhost",
            443,
            "basic"
        ));
    }

    #[test]
    fn basic_auth_credentials_are_bounded_and_empty_password_is_preserved() {
        let (mut quick, policy) = fixture("https://example.test");
        quick.basic_auth_password = None;
        let grant = BasicAuthGrant::new(&quick, &policy).unwrap().unwrap();
        assert!(grant.with_credentials(
            policy.identity(),
            "https://example.test",
            "example.test",
            443,
            "basic",
            || true,
            &mut |user, password| {
                assert_eq!(user, "website-user");
                assert_eq!(password, "");
            }
        ));
        quick.basic_auth_username = None;
        assert!(BasicAuthGrant::new(&quick, &policy).unwrap().is_none());
        for username in [
            "user:name".into(),
            "user\0name".into(),
            "user\r\nname".into(),
            "x".repeat(MAX_CREDENTIAL_BYTES + 1),
        ] {
            quick.basic_auth_username = Some(username);
            assert!(BasicAuthGrant::new(&quick, &policy).is_err());
        }
        quick.basic_auth_username = Some("user".into());
        for password in ["pass\0word".into(), "x".repeat(MAX_CREDENTIAL_BYTES + 1)] {
            quick.basic_auth_password = Some(password);
            assert!(BasicAuthGrant::new(&quick, &policy).is_err());
        }
    }

    #[test]
    fn basic_auth_revocation_lease_loss_and_response_budget_are_terminal() {
        let (quick, policy) = fixture("https://example.test");
        let grant = BasicAuthGrant::new(&quick, &policy).unwrap().unwrap();
        for _ in 0..MAX_RESPONSES {
            assert!(answer(
                &grant,
                policy.identity(),
                "https://example.test/",
                "example.test",
                443,
                "basic"
            ));
        }
        assert!(!answer(
            &grant,
            policy.identity(),
            "https://example.test/",
            "example.test",
            443,
            "basic"
        ));
        let grant = BasicAuthGrant::new(&quick, &policy).unwrap().unwrap();
        let checks = Cell::new(0);
        assert!(!grant.with_credentials(
            policy.identity(),
            "https://example.test/",
            "example.test",
            443,
            "basic",
            || {
                checks.set(checks.get() + 1);
                checks.get() == 1
            },
            &mut |_, _| panic!("stale lease")
        ));
        assert!(!answer(
            &grant,
            policy.identity(),
            "https://example.test/",
            "example.test",
            443,
            "basic"
        ));
        let grant = BasicAuthGrant::new(&quick, &policy).unwrap().unwrap();
        assert!(!grant.with_credentials(
            policy.identity(),
            "https://example.test/",
            "example.test",
            443,
            "basic",
            || {
                grant.revoke();
                true
            },
            &mut |_, _| panic!("revoked grant")
        ));
        assert!(!answer(
            &grant,
            policy.identity(),
            "https://example.test/",
            "example.test",
            443,
            "basic"
        ));
    }
}
