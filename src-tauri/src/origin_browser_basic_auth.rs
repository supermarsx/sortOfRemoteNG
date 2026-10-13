//! Native-only HTTP Basic/Digest credentials: a Quick Connect tab's Basic pair,
//! or a saved connection whose login mode is `basic` or `digest`. Never a proxy
//! or form grant. Chromium computes a Digest response itself from the pair.
use super::{credentials, NativeAuthorityError, NativeOwnerLease};
use serde_json::Value;
use sorng_browser_host::ipc::OriginBrowserQuickConnect;
use sorng_encryption::EncryptionState;
use sorng_protocols::origin_browser::{BrowserIdentity, OriginBrowserPolicy};
use std::sync::{
    atomic::{AtomicBool, AtomicUsize, Ordering},
    Arc,
};
use tauri::{Runtime, WebviewWindow};
use url::{Host, Url};
use zeroize::Zeroizing;

const MAX_CREDENTIAL_BYTES: usize = 16_384;
const MAX_URL_BYTES: usize = 16_384;
// Bound repeated 401s, including parallel resource challenges, for one attempt.
const MAX_RESPONSES: usize = 32;

/// The one HTTP authentication scheme a grant answers. A Digest grant never
/// answers Basic: that would hand the cleartext password to whoever can
/// answer with a Basic challenge (the legacy engine refuses it too).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum HttpAuthScheme {
    Basic,
    Digest,
}

impl HttpAuthScheme {
    fn matches(self, scheme: &str) -> bool {
        scheme.eq_ignore_ascii_case(match self {
            Self::Basic => "basic",
            Self::Digest => "digest",
        })
    }
}

/// Saved opt-in only. An application row answers when its login mode is
/// `basic` or `digest`; `manual` and `form` never do. A row without an
/// application answers when its legacy `authType` is exactly `basic` or
/// `digest` (`explicit == false`: a bad pair then disables only this answer,
/// never the tab, because such rows also carry form-login credentials).
fn saved_mode(connection: &Value) -> Option<(HttpAuthScheme, bool)> {
    let (mode, explicit) = match connection.get("httpApplication") {
        Some(application) => (application.get("loginMode")?.as_str()?, true),
        None => (connection.get("authType")?.as_str()?, false),
    };
    match mode {
        "basic" => Some((HttpAuthScheme::Basic, explicit)),
        "digest" => Some((HttpAuthScheme::Digest, explicit)),
        _ => None,
    }
}

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

    /// A saved connection's grant for its exact source origin (`policy`'s,
    /// which the caller derived from the saved row): same scheme, host and
    /// port, so an HTTPS source never answers over HTTP and an HTTP source
    /// exists only when the row itself is saved as HTTP and `httpsOnly` is off.
    /// The pair is the one the editor and the legacy engine send for these
    /// modes: the vault entry when one is selected, else the dedicated Basic
    /// pair, else the generic pair; never an application rewrite of it.
    pub(super) async fn saved<R: Runtime>(
        connection: &Value,
        policy: &OriginBrowserPolicy,
        lease: &NativeOwnerLease,
        window: &WebviewWindow<R>,
        state: &EncryptionState,
    ) -> Result<Option<Arc<Self>>, NativeAuthorityError> {
        let Some((scheme, explicit)) = saved_mode(connection) else {
            return Ok(None);
        };
        if lease.is_temporary() || !lease.is_current() {
            return Err(NativeAuthorityError::OwnerUnavailable);
        }
        let grant = match credentials::resolve_pair(connection, lease, window, state).await {
            Ok(pair) => BasicAuthGrant::saved(scheme, pair, policy),
            Err(error) => Err(error),
        };
        match grant {
            Ok(Some(grant)) => Ok(Some(Arc::new(Self {
                grant,
                lease: lease.clone(),
            }))),
            // A saved basic/digest mode without a usable pair is an error the
            // user must fix, as the editor and legacy engine report it.
            Ok(None) if explicit => Err(NativeAuthorityError::CredentialUnavailable),
            Err(error) if explicit => Err(error),
            Ok(None) | Err(_) => Ok(None),
        }
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
    scheme: HttpAuthScheme,
    username: Zeroizing<String>,
    password: Zeroizing<String>,
    revoked: AtomicBool,
    responses: AtomicUsize,
}

/// `None` for an empty pair; an error for one no HTTP scheme can carry.
fn checked_pair(username: &str, password: &str) -> Result<bool, NativeAuthorityError> {
    if [username, password]
        .iter()
        .any(|value| value.len() > MAX_CREDENTIAL_BYTES || value.chars().any(char::is_control))
        || username.contains(':')
    {
        return Err(NativeAuthorityError::CredentialUnavailable);
    }
    Ok(!username.is_empty() || !password.is_empty())
}

impl BasicAuthGrant {
    fn saved(
        scheme: HttpAuthScheme,
        pair: credentials::Credentials,
        policy: &OriginBrowserPolicy,
    ) -> Result<Option<Self>, NativeAuthorityError> {
        if !checked_pair(&pair.username, &pair.password)? {
            return Ok(None);
        }
        let source =
            challenge_url(policy.source_origin()).ok_or(NativeAuthorityError::SourceMismatch)?;
        Ok(Some(Self {
            identity: policy.identity().clone(),
            source,
            scheme,
            username: pair.username,
            password: pair.password,
            revoked: AtomicBool::new(false),
            responses: AtomicUsize::new(0),
        }))
    }

    fn new(
        quick: &OriginBrowserQuickConnect,
        policy: &OriginBrowserPolicy,
    ) -> Result<Option<Self>, NativeAuthorityError> {
        let username = quick.basic_auth_username.as_deref().unwrap_or("");
        let password = quick.basic_auth_password.as_deref().unwrap_or("");
        if !checked_pair(username, password)? {
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
            // Quick Connect offers Basic fields only; unchanged.
            scheme: HttpAuthScheme::Basic,
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
            || !self.scheme.matches(scheme)
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

    /// Saved rows through the real `authorize_create` path (synthetic database).
    mod saved {
        use super::super::super::tests::{connection, Fixture};
        use super::super::NativeBasicAuth;
        use crate::origin_browser_authority::{
            authorize_create_with_certificate_hooks, NativeAuthorityError, NativeAuthorizedBrowser,
        };
        use serde_json::{json, Value};
        use sorng_protocols::origin_browser::BrowserIdentity;

        const SOURCE: &str = "https://source.example/login?q=fixture";

        fn app(id: &str, mode: &str) -> Value {
            let mut row = connection();
            row["httpApplication"] = json!({"version":1,"id":id,"loginMode":mode});
            row["basicAuthUsername"] = "basic-user".into();
            row["basicAuthPassword"] = "basic-secret".into();
            row
        }

        fn legacy(auth_type: Option<&str>) -> Value {
            let mut row = connection();
            if let Some(auth_type) = auth_type {
                row["authType"] = auth_type.into();
            }
            row
        }

        async fn authorize(row: Value) -> Result<NativeAuthorizedBrowser, NativeAuthorityError> {
            Fixture::new(row).await.authorize().await
        }

        /// The pair delivered, or None when nothing was answered.
        fn answer(
            auth: &NativeBasicAuth,
            identity: &BrowserIdentity,
            url: &str,
            host: &str,
            port: u16,
            scheme: &str,
        ) -> Option<(String, String)> {
            let mut delivered = None;
            let mut calls = 0;
            let allowed = auth.with_credentials(identity, url, host, port, scheme, &mut |u, p| {
                calls += 1;
                delivered = Some((u.to_owned(), p.to_owned()));
            });
            assert_eq!(calls, usize::from(allowed));
            delivered
        }

        fn pair(user: &str, password: &str) -> Option<(String, String)> {
            Some((user.into(), password.into()))
        }

        #[tokio::test]
        async fn saved_basic_mode_answers_only_its_exact_source_origin() {
            let authorized = authorize(app("http-basic", "basic")).await.unwrap();
            assert!(!authorized.login.enabled());
            let auth = authorized.basic_auth.as_deref().expect("saved basic grant");
            let id = authorized.policy.identity();
            assert_eq!(
                answer(
                    auth,
                    id,
                    "https://source.example/other/page",
                    "source.example",
                    443,
                    "Basic"
                ),
                pair("basic-user", "basic-secret")
            );
            for (url, host, port, scheme) in [
                // Wrong scheme: a basic grant never answers Digest (or anything else).
                ("https://source.example/", "source.example", 443, "Digest"),
                ("https://source.example/", "source.example", 443, "NTLM"),
                // Sub-resource or redirect target on another origin.
                ("https://other.example/", "other.example", 443, "Basic"),
                (
                    "https://sub.source.example/",
                    "sub.source.example",
                    443,
                    "Basic",
                ),
                (
                    "https://source.example:8443/",
                    "source.example",
                    8443,
                    "Basic",
                ),
                // Never downgraded to cleartext HTTP on the same host.
                ("http://source.example/", "source.example", 80, "Basic"),
                // Host/port reported by the engine must agree with the URL.
                ("https://source.example/", "other.example", 443, "Basic"),
                ("https://source.example/", "source.example", 8443, "Basic"),
            ] {
                assert_eq!(
                    answer(auth, id, url, host, port, scheme),
                    None,
                    "{url} {host} {port} {scheme}"
                );
            }
        }

        #[tokio::test]
        async fn saved_digest_mode_answers_digest_and_never_a_basic_downgrade() {
            let mut row = app("http-digest", "digest");
            // No dedicated pair: the generic pair is used, as in the editor.
            row.as_object_mut().unwrap().remove("basicAuthUsername");
            row.as_object_mut().unwrap().remove("basicAuthPassword");
            let authorized = authorize(row).await.unwrap();
            let auth = authorized
                .basic_auth
                .as_deref()
                .expect("saved digest grant");
            let id = authorized.policy.identity();
            for scheme in ["Digest", "digest", "DIGEST"] {
                assert_eq!(
                    answer(auth, id, SOURCE, "source.example", 443, scheme),
                    pair("test-user", "fixture-secret")
                );
            }
            assert_eq!(
                answer(auth, id, SOURCE, "source.example", 443, "Basic"),
                None
            );
            assert_eq!(
                answer(
                    auth,
                    id,
                    "https://other.example/",
                    "other.example",
                    443,
                    "Digest"
                ),
                None
            );
        }

        #[tokio::test]
        async fn manual_and_form_modes_and_other_legacy_auth_types_never_answer() {
            for row in [
                app("http-basic", "manual"),
                app("http-digest", "manual"),
                app("generic-form", "form"),
                app("generic-form", "manual"),
                legacy(None),
                legacy(Some("password")),
                legacy(Some("header")),
                legacy(Some("key")),
            ] {
                let authorized = authorize(row.clone()).await.unwrap();
                assert!(authorized.basic_auth.is_none(), "{row}");
            }
        }

        #[tokio::test]
        async fn legacy_basic_and_digest_auth_types_answer_their_own_scheme() {
            let authorized = authorize(legacy(Some("basic"))).await.unwrap();
            let auth = authorized
                .basic_auth
                .as_deref()
                .expect("legacy basic grant");
            let id = authorized.policy.identity();
            assert_eq!(
                answer(auth, id, SOURCE, "source.example", 443, "basic"),
                pair("test-user", "fixture-secret")
            );
            assert_eq!(
                answer(auth, id, SOURCE, "source.example", 443, "digest"),
                None
            );
            let authorized = authorize(legacy(Some("digest"))).await.unwrap();
            let auth = authorized
                .basic_auth
                .as_deref()
                .expect("legacy digest grant");
            let id = authorized.policy.identity();
            assert!(answer(auth, id, SOURCE, "source.example", 443, "Digest").is_some());
            assert_eq!(
                answer(auth, id, SOURCE, "source.example", 443, "Basic"),
                None
            );
        }

        #[tokio::test]
        async fn saved_mode_without_a_usable_pair_is_refused_but_legacy_rows_still_open() {
            let mut row = app("http-basic", "basic");
            for key in [
                "basicAuthUsername",
                "basicAuthPassword",
                "username",
                "password",
            ] {
                row.as_object_mut().unwrap().remove(key);
            }
            assert!(matches!(
                authorize(row).await,
                Err(NativeAuthorityError::CredentialUnavailable)
            ));
            let mut row = app("http-basic", "basic");
            row["basicAuthUsername"] = "user:name".into();
            assert!(matches!(
                authorize(row).await,
                Err(NativeAuthorityError::CredentialUnavailable)
            ));
            let mut row = app("http-digest", "digest");
            row["basicAuthPassword"] = "line\r\nbreak".into();
            assert!(matches!(
                authorize(row).await,
                Err(NativeAuthorityError::CredentialUnavailable)
            ));
            // A legacy row also carries form-login credentials: an unusable
            // pair only disables the HTTP answer, never the tab.
            let mut row = legacy(Some("basic"));
            row["username"] = "user:name".into();
            assert!(authorize(row).await.unwrap().basic_auth.is_none());
            let mut row = legacy(Some("basic"));
            row["username"] = "".into();
            row["password"] = "".into();
            row["httpAutoLogin"] = false.into();
            assert!(authorize(row).await.unwrap().basic_auth.is_none());
        }

        #[tokio::test]
        async fn dedicated_pair_wins_whole_and_application_rewrites_do_not_apply() {
            // Username only in the dedicated pair: never mixed with the generic password.
            let mut row = app("proxmox", "basic");
            row["basicAuthPassword"] = Value::Null;
            row["basicAuthUsername"] = "root".into();
            let authorized = authorize(row).await.unwrap();
            let auth = authorized.basic_auth.as_deref().unwrap();
            // Proxmox's `@pam` realm suffix is a form-login rewrite only.
            assert_eq!(
                answer(
                    auth,
                    authorized.policy.identity(),
                    SOURCE,
                    "source.example",
                    443,
                    "Basic"
                ),
                pair("root", "")
            );
        }

        #[tokio::test]
        async fn vault_selection_supplies_the_pair_and_local_fields_are_ignored() {
            let vault = "01234567-89ab-4cde-8fab-0123456789ab";
            let mut row = app("http-basic", "basic");
            row["credentialSource"] = json!({"kind":"vault","credentialId":vault});
            let mut f = Fixture::new(row.clone()).await;
            f.replace_totp_fixture_data(&json!({"connections":[row], "settings":{}, "credentialVault":{
                "version":1,"revision":1,"entries":[{"id":vault,"facets":{"username":"vault-user","password":"vault-secret"}}]
            }}));
            let authorized = f.authorize().await.unwrap();
            let auth = authorized.basic_auth.as_deref().unwrap();
            assert_eq!(
                answer(
                    auth,
                    authorized.policy.identity(),
                    SOURCE,
                    "source.example",
                    443,
                    "Basic"
                ),
                pair("vault-user", "vault-secret")
            );
            // Missing vault entry: refused, never a fallback to the local pair.
            let mut row = app("http-basic", "basic");
            row["credentialSource"] = json!({"kind":"vault","credentialId":vault});
            assert!(matches!(
                authorize(row).await,
                Err(NativeAuthorityError::CredentialUnavailable)
            ));
        }

        #[tokio::test]
        async fn lease_loss_and_saved_edits_stop_delivery_at_once() {
            let mut f = Fixture::new(app("http-basic", "basic")).await;
            let authorized = f.authorize().await.unwrap();
            let auth = authorized.basic_auth.as_deref().unwrap();
            let id = authorized.policy.identity();
            assert!(answer(auth, id, SOURCE, "source.example", 443, "Basic").is_some());
            let mut edited = app("http-basic", "basic");
            edited["basicAuthPassword"] = "changed".into();
            f.replace_connection(edited);
            assert!(authorized.lease.recheck(&f.window, &f.state).await.is_err());
            assert_eq!(
                answer(auth, id, SOURCE, "source.example", 443, "Basic"),
                None
            );

            let authorized = Fixture::new(app("http-basic", "basic"))
                .await
                .authorize()
                .await
                .unwrap();
            let auth = authorized.basic_auth.as_deref().unwrap();
            let id = authorized.policy.identity();
            authorized.lease.revoke();
            assert_eq!(
                answer(auth, id, SOURCE, "source.example", 443, "Basic"),
                None
            );
        }

        #[tokio::test]
        async fn saved_grant_is_bounded_to_32_responses_per_attempt() {
            let authorized = authorize(app("http-basic", "basic")).await.unwrap();
            let auth = authorized.basic_auth.as_deref().unwrap();
            let id = authorized.policy.identity();
            for _ in 0..32 {
                assert!(answer(auth, id, SOURCE, "source.example", 443, "Basic").is_some());
            }
            assert_eq!(
                answer(auth, id, SOURCE, "source.example", 443, "Basic"),
                None
            );
        }

        #[tokio::test]
        async fn saved_http_source_answers_only_its_exact_http_origin_and_https_only_refuses_it() {
            let mut row = app("http-basic", "basic");
            row["protocol"] = "http".into();
            row["hostname"] = "http://router.example:8080/".into();
            row["port"] = 8080.into();
            row["httpVerifySsl"] = false.into();
            let mut f = Fixture::new(row.clone()).await;
            f.request.initial_url = "http://router.example:8080/".into();
            let authorized =
                authorize_create_with_certificate_hooks(&f.window, &f.state, &f.request)
                    .await
                    .unwrap();
            let auth = authorized
                .basic_auth
                .as_deref()
                .expect("saved HTTP basic grant");
            let id = authorized.policy.identity();
            assert!(answer(
                auth,
                id,
                "http://router.example:8080/x",
                "router.example",
                8080,
                "Basic"
            )
            .is_some());
            for (url, port) in [
                ("https://router.example:8080/", 8080),
                ("http://router.example/", 80),
                ("https://router.example/", 443),
            ] {
                assert_eq!(
                    answer(auth, id, url, "router.example", port, "Basic"),
                    None,
                    "{url}"
                );
            }
            row["httpProxyPolicy"] = json!({"version":1,"httpsOnly":true});
            let mut f = Fixture::new(row).await;
            f.request.initial_url = "http://router.example:8080/".into();
            assert!(
                authorize_create_with_certificate_hooks(&f.window, &f.state, &f.request)
                    .await
                    .is_err()
            );
        }

        #[tokio::test]
        async fn quick_connect_grant_still_answers_basic_only() {
            let mut f = Fixture::new(connection()).await;
            let mut wire = serde_json::to_value(&f.request).unwrap();
            wire["owner"]["ownerDatabaseId"] = json!("quick-connect:tab");
            wire["expectedSecurityRevision"] = json!("quick-connect");
            wire["sourceSessionId"] = json!("tab");
            wire["initialUrl"] = json!("https://temporary.example/");
            wire["quickConnect"] = json!({"protocol":"https","hostname":"temporary.example","port":443,
                "httpVerifySsl":true,"basicAuthUsername":"quick-user","basicAuthPassword":"quick-secret"});
            f.request = serde_json::from_value(wire).unwrap();
            let authorized =
                authorize_create_with_certificate_hooks(&f.window, &f.state, &f.request)
                    .await
                    .unwrap();
            let auth = authorized.basic_auth.as_deref().unwrap();
            let id = authorized.policy.identity();
            let url = "https://temporary.example/";
            assert_eq!(
                answer(auth, id, url, "temporary.example", 443, "Basic"),
                pair("quick-user", "quick-secret")
            );
            assert_eq!(
                answer(auth, id, url, "temporary.example", 443, "Digest"),
                None
            );
        }
    }
}
