//! Native-only foundation for origin-preserving, app-private browser sessions.
//!
//! This is NOT a supported browser engine or a renderer-selectable capability.
//! Hosts must prove private profile isolation, authenticated fixed-proxy routing
//! and containment of bypass traffic before reporting readiness. There are no
//! OS-based readiness defaults, direct fallback, TLS interception or IPC grants.
//! The default grant is source-only. Native callers may explicitly grant exact
//! additional origins for navigation, redirects and resources in this attempt.
//! These grants never imply consent to send credentials or perform login there.

use crate::private_forward_proxy::{
    Authority, DestinationGrant, PrivateForwardProxy, ProxyLimits, RouteDialer,
};
use serde::Serialize;
use std::net::{IpAddr, SocketAddr};
use std::sync::Arc;
use url::Url;
use uuid::Uuid;

/// Maximum canonical origins per attempt, including its automatic source grant.
/// The supplied list is also bounded before validation or deduplication.
pub const MAX_ALLOWED_ORIGINS: usize = 128;

/// Native identity captured from the unlocked database, never inferred by an ID
/// lookup in a different database. A reconnect always creates a fresh attempt.
/// No Debug/serde: these identifiers are not diagnostics or renderer authority.
#[derive(Clone, PartialEq, Eq)]
pub struct BrowserIdentity {
    owner_database_id: String,
    connection_id: String,
    session_id: String,
    attempt_id: Uuid,
}

impl BrowserIdentity {
    pub fn owner_database_id(&self) -> &str {
        &self.owner_database_id
    }
    pub fn connection_id(&self) -> &str {
        &self.connection_id
    }
    pub fn session_id(&self) -> &str {
        &self.session_id
    }
    pub fn attempt_id(&self) -> Uuid {
        self.attempt_id
    }
}

/// Validated immutable policy; deliberately not deserializable or cloneable.
pub struct OriginBrowserPolicy {
    identity: BrowserIdentity,
    source_origin: String,
    authority: Authority,
    allowed_origins: Vec<String>,
    allowed_authorities: Vec<Authority>,
    profile_key: String,
}

impl OriginBrowserPolicy {
    pub fn new(
        owner_database_id: &str,
        connection_id: &str,
        session_id: &str,
        source_origin: &str,
    ) -> Result<Self, BrowserPolicyError> {
        Self::new_with_allowed_origins(
            owner_database_id,
            connection_id,
            session_id,
            source_origin,
            &[],
        )
    }

    /// Native-only, immutable per-session grants for navigation, redirects and
    /// resources. The source is always included; canonical duplicates collapse.
    /// Both the input length and final origin count are at most 128. Wildcards,
    /// credentials and URL paths are forbidden. Grants do not authorize login,
    /// credential disclosure, TLS exceptions or direct-network fallback.
    pub fn new_with_allowed_origins(
        owner_database_id: &str,
        connection_id: &str,
        session_id: &str,
        source_origin: &str,
        allowed_origins: &[&str],
    ) -> Result<Self, BrowserPolicyError> {
        for id in [owner_database_id, connection_id, session_id] {
            if id.is_empty()
                || id.len() > 256
                || id.chars().any(|c| c.is_control() || c.is_whitespace())
            {
                return Err(BrowserPolicyError::InvalidIdentity);
            }
        }
        if allowed_origins.len() > MAX_ALLOWED_ORIGINS {
            return Err(BrowserPolicyError::TooManyOrigins);
        }
        let (source_origin, authority) = parse_http_origin(source_origin)?;
        let mut origins = vec![source_origin.clone()];
        let mut authorities = vec![authority.clone()];
        for value in allowed_origins {
            let (origin, authority) = parse_http_origin(value)?;
            if !origins.contains(&origin) {
                if origins.len() == MAX_ALLOWED_ORIGINS {
                    return Err(BrowserPolicyError::TooManyOrigins);
                }
                origins.push(origin);
            }
            if !authorities.contains(&authority) {
                authorities.push(authority);
            }
        }
        let attempt_id = Uuid::new_v4();
        Ok(Self {
            identity: BrowserIdentity {
                owner_database_id: owner_database_id.into(),
                connection_id: connection_id.into(),
                session_id: session_id.into(),
                attempt_id,
            },
            source_origin,
            authority,
            allowed_origins: origins,
            allowed_authorities: authorities,
            // Safe opaque profile name: never a database/connection ID or URL.
            profile_key: format!("origin-browser-{}", attempt_id.simple()),
        })
    }

    pub fn identity(&self) -> &BrowserIdentity {
        &self.identity
    }
    pub fn source_origin(&self) -> &str {
        &self.source_origin
    }
    pub fn source_authority(&self) -> &Authority {
        &self.authority
    }
    /// Canonical exact origins, source first; no credential or login consent.
    pub fn allowed_origins(&self) -> &[String] {
        &self.allowed_origins
    }
    pub fn profile_key(&self) -> &str {
        &self.profile_key
    }
    pub fn destination_grant(&self) -> DestinationGrant {
        // Relay admission is exact host + port. Schemes are checked separately
        // by the native host through authorize_navigation, including redirects
        // and resource requests; an authority alone cannot distinguish schemes.
        let authorities = self.allowed_authorities.clone();
        Arc::new(move |candidate| authorities.contains(candidate))
    }

    fn validate_proxy_endpoint(&self, endpoint: SocketAddr) -> Result<(), BrowserPolicyError> {
        validate_private_proxy_endpoint(endpoint)?;
        for authority in &self.allowed_authorities {
            let host = authority.host();
            if authority.port() == endpoint.port()
                && (host.parse::<IpAddr>().is_ok_and(|ip| ip.is_loopback())
                    || host == "localhost"
                    || host.ends_with(".localhost"))
            {
                return Err(BrowserPolicyError::InvalidProxyEndpoint);
            }
        }
        Ok(())
    }
}

fn parse_http_origin(value: &str) -> Result<(String, Authority), BrowserPolicyError> {
    let authority_text = value
        .split_once("://")
        .map(|(_, rest)| rest.strip_suffix('/').unwrap_or(rest))
        .ok_or(BrowserPolicyError::InvalidOrigin)?;
    // Check raw syntax before Url normalizes dot paths, empty userinfo,
    // whitespace and backslashes. An origin is not a navigation URL.
    if value.len() > 2048
        || dirty_url(value)
        || authority_text.contains(['/', '?', '#', '@', '%', '*'])
        || authority_text.ends_with(':')
    {
        return Err(BrowserPolicyError::InvalidOrigin);
    }
    let url = Url::parse(value).map_err(|_| BrowserPolicyError::InvalidOrigin)?;
    if !matches!(url.scheme(), "http" | "https")
        || !url.has_host()
        || url.port() == Some(0)
        || url.path() != "/"
    {
        return Err(BrowserPolicyError::InvalidOrigin);
    }
    let port = url
        .port_or_known_default()
        .ok_or(BrowserPolicyError::InvalidOrigin)?;
    // Use the relay's exact authority grammar and canonicalization.
    let authority = Authority::parse(&format!("{}:{port}", url.host_str().unwrap()))
        .map_err(|_| BrowserPolicyError::InvalidOrigin)?;
    Ok((url.origin().ascii_serialization(), authority))
}

fn dirty_url(value: &str) -> bool {
    value
        .chars()
        .any(|c| c.is_control() || c.is_whitespace() || c == '\\')
}

/// Validate the address obtained from a RETAINED listener. This does not claim
/// that any socket is alive/authenticated; session start uses the real relay.
pub fn validate_private_proxy_endpoint(endpoint: SocketAddr) -> Result<(), BrowserPolicyError> {
    if !endpoint.ip().is_loopback()
        || endpoint.port() == 0
        || matches!(endpoint, SocketAddr::V6(v6) if v6.scope_id() != 0 || v6.flowinfo() != 0)
    {
        Err(BrowserPolicyError::InvalidProxyEndpoint)
    } else {
        Ok(())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum HostUnavailableReason {
    RuntimeUnavailable,
    ProfileIsolationUnavailable,
    ProxyAuthenticationUnavailable,
    TrafficContainmentUnverified,
}

/// A report from TRUSTED native host code, never page JS or IPC deserialization.
/// Ready means the host verified an attempt-private profile, native proxy auth
/// scoped to this endpoint, no direct/system/loopback bypass, and blocked or
/// mediated non-proxy traffic (including QUIC/WebRTC). Merely setting an engine
/// proxy preference is insufficient. The host must apply authorize_navigation
/// to navigation, redirect and resource URLs, including their exact scheme.
/// No production adapter currently emits it.
pub enum NativeHostReadiness {
    Unsupported(HostUnavailableReason),
    NotReady,
    Ready {
        profile_key: String,
        proxy_endpoint: SocketAddr,
    },
}

/// Safe UI/diagnostic output only: no URLs, IDs, paths or proxy credentials.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(tag = "state", content = "reason", rename_all = "kebab-case")]
pub enum BrowserSessionStatus {
    NotReady,
    Ready,
    Unsupported(HostUnavailableReason),
    Revoked,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum BrowserPolicyError {
    #[error("Browser owner, connection and session identities are required")]
    InvalidIdentity,
    #[error("Browser grants must be exact HTTP(S) origins without credentials or URL paths")]
    InvalidOrigin,
    #[error("Browser origin grants exceed the per-session limit")]
    TooManyOrigins,
    #[error("Private browser proxy must retain a numeric loopback listener on a nonzero port")]
    InvalidProxyEndpoint,
    #[error("Private browser proxy is unavailable; no direct fallback was attempted")]
    ProxyUnavailable,
    #[error("Browser operation belongs to a different owner, session or attempt")]
    StaleIdentity,
    #[error("Native browser host is not ready for this private session")]
    NotReady,
    #[error("Native browser host profile or proxy binding does not match this attempt")]
    HostBindingMismatch,
    #[error("Browser session was revoked; create a new attempt")]
    Revoked,
    #[error("Navigation is outside the exact origins permitted for this browser operation")]
    NavigationNotGranted,
}

/// Owns the actual relay, so stale callbacks cannot close a successor's proxy.
/// No Clone/serde/Debug and no method replacing its owner, source or endpoint.
/// Drop revokes the relay; stop() also awaits cleanup. The native host owner must
/// synchronously stop/hide its view when reporting loss of readiness or owner.
pub struct OriginBrowserSession {
    policy: OriginBrowserPolicy,
    proxy: PrivateForwardProxy,
    status: BrowserSessionStatus,
}

/// Challenge metadata from a trusted native engine callback, never page JS or
/// renderer IPC. Hosts without an explicit proxy flag must establish it from
/// the native challenge URI and the retained relay endpoint before constructing
/// this value. Website/server authentication is a separate consent path.
pub struct NativeProxyChallenge<'a> {
    pub is_proxy: bool,
    pub host: &'a str,
    pub port: u16,
    pub scheme: &'a str,
    pub realm: &'a str,
}

impl OriginBrowserSession {
    pub async fn start(
        policy: OriginBrowserPolicy,
        dialer: Arc<dyn RouteDialer>,
        limits: ProxyLimits,
    ) -> Result<Self, BrowserPolicyError> {
        let proxy = PrivateForwardProxy::start(dialer, policy.destination_grant(), limits)
            .await
            .map_err(|_| BrowserPolicyError::ProxyUnavailable)?;
        policy.validate_proxy_endpoint(proxy.local_addr())?;
        Ok(Self {
            policy,
            proxy,
            status: BrowserSessionStatus::NotReady,
        })
    }

    pub fn policy(&self) -> &OriginBrowserPolicy {
        &self.policy
    }
    pub fn proxy_endpoint(&self) -> SocketAddr {
        self.proxy.local_addr()
    }
    pub fn status(&self) -> BrowserSessionStatus {
        if matches!(
            self.status,
            BrowserSessionStatus::NotReady | BrowserSessionStatus::Ready
        ) && !self.proxy.is_running()
        {
            BrowserSessionStatus::Revoked
        } else {
            self.status
        }
    }

    /// Native proxy-auth callback only, including setup before host readiness.
    /// Never release these credentials to a website challenge, JS, IPC or logs.
    pub fn with_proxy_credentials<R>(&self, callback: impl FnOnce(&str, &str) -> R) -> Option<R> {
        if self.proxy.is_running() {
            self.proxy.with_credentials(callback)
        } else {
            None
        }
    }

    /// Answer only this attempt's exact numeric relay challenge. A matching
    /// realm alone is not authority: websites can send the same realm in a 401.
    /// No DNS lookup, localhost alias, alternate loopback IP, upstream proxy or
    /// stale attempt may receive these credentials. Authentication is available
    /// during host setup, but does not mark the host ready or permit navigation.
    pub fn answer_proxy_challenge<R>(
        &self,
        identity: &BrowserIdentity,
        challenge: NativeProxyChallenge<'_>,
        callback: impl FnOnce(&str, &str) -> R,
    ) -> Option<R> {
        if self.check_identity(identity).is_err()
            || !challenge.is_proxy
            || !challenge.scheme.eq_ignore_ascii_case("basic")
            || challenge.realm != "private-forward-proxy"
            || challenge.port != self.proxy_endpoint().port()
        {
            return None;
        }
        // Native engines may return an IPv6 host with or without URL brackets.
        // Parsing remains numeric-only, with no scoped addresses or host aliases.
        let host = challenge
            .host
            .strip_prefix('[')
            .and_then(|value| value.strip_suffix(']'))
            .unwrap_or(challenge.host);
        if host.parse::<IpAddr>().ok() != Some(self.proxy_endpoint().ip()) {
            return None;
        }
        self.with_proxy_credentials(callback)
    }

    fn check_identity(&self, identity: &BrowserIdentity) -> Result<(), BrowserPolicyError> {
        if identity == self.policy.identity() {
            Ok(())
        } else {
            Err(BrowserPolicyError::StaleIdentity)
        }
    }

    pub fn report_host(
        &mut self,
        identity: &BrowserIdentity,
        report: NativeHostReadiness,
    ) -> Result<(), BrowserPolicyError> {
        self.check_identity(identity)?;
        if matches!(
            self.status(),
            BrowserSessionStatus::Revoked | BrowserSessionStatus::Unsupported(_)
        ) {
            return Err(BrowserPolicyError::Revoked);
        }
        match report {
            NativeHostReadiness::Unsupported(reason) => {
                self.proxy.revoke();
                self.status = BrowserSessionStatus::Unsupported(reason);
            }
            NativeHostReadiness::NotReady => {
                if self.status == BrowserSessionStatus::Ready {
                    self.revoke(identity)?;
                }
            }
            NativeHostReadiness::Ready {
                profile_key,
                proxy_endpoint,
            } => {
                if profile_key != self.policy.profile_key || proxy_endpoint != self.proxy_endpoint()
                {
                    self.revoke(identity)?;
                    return Err(BrowserPolicyError::HostBindingMismatch);
                }
                self.status = BrowserSessionStatus::Ready;
            }
        }
        Ok(())
    }

    /// Source-only admission for login callers, even when other origins have
    /// explicit navigation grants. This does not itself grant credential use.
    /// Call immediately before native navigation, not across an await.
    /// Hosts must also revoke on runtime/proxy failure and owner lock/close.
    pub fn authorize_source_navigation(
        &self,
        identity: &BrowserIdentity,
        value: &str,
    ) -> Result<Url, BrowserPolicyError> {
        let url = self.authorize_navigation(identity, value)?;
        if url.origin().ascii_serialization() != self.policy.source_origin {
            return Err(BrowserPolicyError::NavigationNotGranted);
        }
        Ok(url)
    }

    /// Native admission for navigation, redirects and resources to exact grants.
    /// Call for each URL immediately before use, not across an await; enforce
    /// scheme here because relay grants can check only the destination authority.
    /// This does not permit login or sending credentials to added origins.
    pub fn authorize_navigation(
        &self,
        identity: &BrowserIdentity,
        value: &str,
    ) -> Result<Url, BrowserPolicyError> {
        self.check_identity(identity)?;
        match self.status() {
            BrowserSessionStatus::Ready => {}
            BrowserSessionStatus::Revoked => return Err(BrowserPolicyError::Revoked),
            _ => return Err(BrowserPolicyError::NotReady),
        }
        if value.len() > 8192 || dirty_url(value) {
            return Err(BrowserPolicyError::NavigationNotGranted);
        }
        let (scheme, rest) = value
            .split_once("://")
            .ok_or(BrowserPolicyError::NavigationNotGranted)?;
        let authority = rest.split(['/', '?', '#']).next().unwrap_or("");
        // Apply the same strict origin grammar before the URL parser can turn
        // empty authorities, userinfo or escaped hosts into an allowed origin.
        parse_http_origin(&format!("{scheme}://{authority}"))
            .map_err(|_| BrowserPolicyError::NavigationNotGranted)?;
        let url = Url::parse(value).map_err(|_| BrowserPolicyError::NavigationNotGranted)?;
        if !self
            .policy
            .allowed_origins
            .contains(&url.origin().ascii_serialization())
        {
            return Err(BrowserPolicyError::NavigationNotGranted);
        }
        Ok(url)
    }

    pub fn revoke(&mut self, identity: &BrowserIdentity) -> Result<(), BrowserPolicyError> {
        self.check_identity(identity)?;
        self.status = BrowserSessionStatus::Revoked;
        self.proxy.revoke();
        Ok(())
    }

    pub async fn stop(&mut self) -> Result<(), BrowserPolicyError> {
        self.status = BrowserSessionStatus::Revoked;
        self.proxy
            .stop()
            .await
            .map_err(|_| BrowserPolicyError::ProxyUnavailable)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::private_forward_proxy::DialFuture;
    use std::time::Duration;

    fn policy(origin: &str) -> OriginBrowserPolicy {
        policy_with_origins(origin, &[])
    }
    fn policy_with_origins(origin: &str, allowed_origins: &[&str]) -> OriginBrowserPolicy {
        OriginBrowserPolicy::new_with_allowed_origins(
            "owner-fixture",
            "connection-fixture",
            "session-fixture",
            origin,
            allowed_origins,
        )
        .unwrap()
    }
    fn dialer() -> Arc<dyn RouteDialer> {
        Arc::new(|_: Authority| -> DialFuture {
            Box::pin(async { Err(std::io::Error::other("fixture must not dial")) })
        })
    }
    async fn session() -> OriginBrowserSession {
        session_for_policy(policy("https://source.invalid")).await
    }
    async fn session_for_policy(policy: OriginBrowserPolicy) -> OriginBrowserSession {
        tokio::time::timeout(
            Duration::from_secs(2),
            OriginBrowserSession::start(policy, dialer(), ProxyLimits::default()),
        )
        .await
        .unwrap()
        .unwrap()
    }
    async fn stop(session: &mut OriginBrowserSession) {
        tokio::time::timeout(Duration::from_secs(2), session.stop())
            .await
            .unwrap()
            .unwrap();
    }
    fn ready(session: &OriginBrowserSession) -> NativeHostReadiness {
        NativeHostReadiness::Ready {
            profile_key: session.policy().profile_key().into(),
            proxy_endpoint: session.proxy_endpoint(),
        }
    }

    #[test]
    fn canonical_origin_and_relay_grant_share_exact_authority() {
        for (input, expected, authority) in [
            (
                "HTTPS://Source.Invalid:443/",
                "https://source.invalid",
                "source.invalid:443",
            ),
            (
                "http://source.invalid:8080",
                "http://source.invalid:8080",
                "source.invalid:8080",
            ),
            ("https://[::1]:8443", "https://[::1]:8443", "[::1]:8443"),
            (
                "https://bücher.example",
                "https://xn--bcher-kva.example",
                "xn--bcher-kva.example:443",
            ),
        ] {
            let policy = policy(input);
            assert_eq!(policy.source_origin(), expected);
            assert_eq!(policy.allowed_origins(), &[expected]);
            assert_eq!(policy.source_authority().to_string(), authority);
            let grant = policy.destination_grant();
            assert!(grant(&Authority::parse(authority).unwrap()));
            assert!(!grant(&Authority::parse("other.invalid:443").unwrap()));
            assert!(!grant(&Authority::parse("source.invalid:444").unwrap()));
        }
    }

    #[test]
    fn explicit_grants_are_canonical_exact_and_source_is_automatically_included() {
        let policy = policy_with_origins(
            "https://source.invalid",
            &[
                "HTTPS://Resources.Invalid:443/",
                "http://resources.invalid:8080",
                "https://[::1]:8443",
                "https://bücher.example",
            ],
        );
        assert_eq!(
            policy.allowed_origins(),
            &[
                "https://source.invalid",
                "https://resources.invalid",
                "http://resources.invalid:8080",
                "https://[::1]:8443",
                "https://xn--bcher-kva.example",
            ]
        );
        let grant = policy.destination_grant();
        for authority in [
            "source.invalid:443",
            "resources.invalid:443",
            "resources.invalid:8080",
            "[::1]:8443",
            "xn--bcher-kva.example:443",
        ] {
            assert!(grant(&Authority::parse(authority).unwrap()), "{authority}");
        }
        for authority in [
            "source.invalid:80",
            "resources.invalid:80",
            "resources.invalid:8443",
            "sub.resources.invalid:443",
            "resources.invalid.other.invalid:443",
            "invalid:443",
            "other.invalid:443",
            "[::1]:443",
            "[::2]:8443",
        ] {
            assert!(!grant(&Authority::parse(authority).unwrap()), "{authority}");
        }
    }

    #[test]
    fn duplicates_collapse_after_canonicalization_but_distinct_schemes_remain() {
        let policy = policy_with_origins(
            "https://source.invalid",
            &[
                "HTTPS://SOURCE.Invalid:443/",
                "https://source.invalid",
                "http://source.invalid:443",
                "https://bücher.example",
                "https://xn--bcher-kva.example:443/",
                "https://[0:0:0:0:0:0:0:1]:8443",
                "https://[::1]:8443/",
            ],
        );
        assert_eq!(
            policy.allowed_origins(),
            &[
                "https://source.invalid",
                "http://source.invalid:443",
                "https://xn--bcher-kva.example",
                "https://[::1]:8443",
            ]
        );
        assert_eq!(policy.allowed_authorities.len(), 3);
        assert!((policy.destination_grant())(
            &Authority::parse("source.invalid:443").unwrap()
        ));
        assert!(!(policy.destination_grant())(
            &Authority::parse("source.invalid:80").unwrap()
        ));
    }

    #[test]
    fn origin_limit_counts_source_and_bounds_input_before_deduplication() {
        let origins: Vec<_> = (0..MAX_ALLOWED_ORIGINS)
            .map(|i| format!("https://resource-{i}.invalid"))
            .collect();
        let mut origins: Vec<_> = origins.iter().map(String::as_str).collect();
        let policy = policy_with_origins(
            "https://source.invalid",
            &origins[..MAX_ALLOWED_ORIGINS - 1],
        );
        assert_eq!(policy.allowed_origins().len(), MAX_ALLOWED_ORIGINS);
        assert!(matches!(
            OriginBrowserPolicy::new_with_allowed_origins(
                "owner",
                "conn",
                "tab",
                "https://source.invalid",
                &origins,
            ),
            Err(BrowserPolicyError::TooManyOrigins)
        ));
        origins[MAX_ALLOWED_ORIGINS - 1] = "HTTPS://Source.Invalid:443/";
        assert_eq!(
            policy_with_origins("https://source.invalid", &origins)
                .allowed_origins()
                .len(),
            MAX_ALLOWED_ORIGINS
        );
        assert_eq!(
            policy_with_origins(
                "https://source.invalid",
                &["https://source.invalid"; MAX_ALLOWED_ORIGINS],
            )
            .allowed_origins(),
            &["https://source.invalid"]
        );
        assert!(matches!(
            OriginBrowserPolicy::new_with_allowed_origins(
                "owner",
                "conn",
                "tab",
                "https://source.invalid",
                &["https://source.invalid"; MAX_ALLOWED_ORIGINS + 1],
            ),
            Err(BrowserPolicyError::TooManyOrigins)
        ));
    }

    #[test]
    fn origin_grants_are_owned_and_isolated_to_their_policy_attempt() {
        let mut added = String::from("https://resources.invalid");
        let first = policy_with_origins("https://source.invalid", &[added.as_str()]);
        added.clear();
        added.push_str("https://other.invalid");
        let second = policy_with_origins("https://source.invalid", &[added.as_str()]);
        let default = OriginBrowserPolicy::new(
            "owner-fixture",
            "connection-fixture",
            "session-fixture",
            "https://source.invalid",
        )
        .unwrap();
        assert_eq!(default.allowed_origins(), &["https://source.invalid"]);
        let first_authority = Authority::parse("resources.invalid:443").unwrap();
        let second_authority = Authority::parse("other.invalid:443").unwrap();
        assert!((first.destination_grant())(&first_authority));
        assert!(!(first.destination_grant())(&second_authority));
        assert!(!(second.destination_grant())(&first_authority));
        assert!((second.destination_grant())(&second_authority));
        assert!(!(default.destination_grant())(&first_authority));
        assert!(!(default.destination_grant())(&second_authority));
        assert!(first.identity() != second.identity());
        assert_ne!(first.profile_key(), second.profile_key());
    }

    #[test]
    fn rejects_ambiguous_secret_bearing_and_non_origin_inputs() {
        for origin in [
            "",
            "file:///tmp/page",
            "data:text/html,hi",
            "wss://source.invalid",
            "//source.invalid",
            "https:///source.invalid",
            "https://@source.invalid",
            "https://user:secret@source.invalid",
            "https://source.invalid/path",
            "https://source.invalid/../",
            "https://source.invalid/?token=secret",
            "https://source.invalid#secret",
            "https://source.invalid\\path",
            " https://source.invalid",
            "https://source.invalid\n",
            "https://*.invalid",
            "https://%73ource.invalid",
            "https://source.invalid:0",
            "https://source.invalid:",
            "https://source.invalid:65536",
            "https://[::1%25lo0]",
            &"x".repeat(2049),
        ] {
            assert!(
                matches!(
                    OriginBrowserPolicy::new("owner", "conn", "tab", origin),
                    Err(BrowserPolicyError::InvalidOrigin)
                ),
                "{origin}"
            );
            assert!(
                matches!(
                    OriginBrowserPolicy::new_with_allowed_origins(
                        "owner",
                        "conn",
                        "tab",
                        "https://source.invalid",
                        &["https://resources.invalid", origin],
                    ),
                    Err(BrowserPolicyError::InvalidOrigin)
                ),
                "{origin}"
            );
        }
    }

    #[test]
    fn identity_is_bounded_owner_pinned_and_profile_is_attempt_private() {
        for invalid in ["", "owner\n", "two ids", &"x".repeat(257)] {
            assert!(
                OriginBrowserPolicy::new(invalid, "conn", "tab", "https://source.invalid").is_err()
            );
            assert!(
                OriginBrowserPolicy::new("owner", invalid, "tab", "https://source.invalid")
                    .is_err()
            );
            assert!(
                OriginBrowserPolicy::new("owner", "conn", invalid, "https://source.invalid")
                    .is_err()
            );
        }
        let first = policy("https://source.invalid");
        let second = policy("https://source.invalid");
        assert!(first.identity() != second.identity());
        assert_ne!(first.profile_key(), second.profile_key());
        assert!(!first.profile_key().contains("fixture"));
        assert_eq!(first.identity().owner_database_id(), "owner-fixture");
        assert_eq!(first.identity().connection_id(), "connection-fixture");
        assert_eq!(first.identity().session_id(), "session-fixture");
        assert!(!first.identity().attempt_id().is_nil());
    }

    #[test]
    fn private_endpoint_rejects_public_unspecified_zero_and_scoped_addresses() {
        for endpoint in [
            "0.0.0.0:8080",
            "[::]:8080",
            "192.0.2.1:8080",
            "127.0.0.1:0",
            "[::1%1]:8080",
        ] {
            assert_eq!(
                validate_private_proxy_endpoint(endpoint.parse().unwrap()),
                Err(BrowserPolicyError::InvalidProxyEndpoint)
            );
        }
        for endpoint in ["127.0.0.1:8080", "[::1]:8080"] {
            assert!(validate_private_proxy_endpoint(endpoint.parse().unwrap()).is_ok());
        }
    }

    #[test]
    fn every_granted_authority_is_checked_for_private_proxy_recursion() {
        let endpoint = "127.0.0.1:18080".parse().unwrap();
        for origin in [
            "http://127.0.0.1:18080",
            "https://127.0.0.2:18080",
            "http://[::1]:18080",
            "https://localhost:18080",
            "http://sub.localhost:18080",
        ] {
            for policy in [
                policy(origin),
                policy_with_origins("https://source.invalid", &[origin]),
            ] {
                assert_eq!(
                    policy.validate_proxy_endpoint(endpoint),
                    Err(BrowserPolicyError::InvalidProxyEndpoint),
                    "{origin}"
                );
            }
        }
        for origin in [
            "http://127.0.0.1:18081",
            "https://[::1]:18081",
            "https://localhost:18081",
            "http://source.invalid:18080",
            "http://localhost.other.invalid:18080",
        ] {
            assert!(policy_with_origins("https://source.invalid", &[origin])
                .validate_proxy_endpoint(endpoint)
                .is_ok());
        }
    }

    #[tokio::test]
    async fn http_session_readiness_requires_a_bound_native_host_report() {
        for source in ["http://source.invalid", "http://source.invalid:8080"] {
            let mut session =
                session_for_policy(policy_with_origins(source, &["https://resources.invalid"]))
                    .await;
            let id = session.policy().identity().clone();
            assert_eq!(session.status(), BrowserSessionStatus::NotReady);
            assert!(session.with_proxy_credentials(|_, _| ()).is_some());
            session
                .report_host(&id, NativeHostReadiness::NotReady)
                .unwrap();
            assert_eq!(
                session.authorize_source_navigation(&id, source),
                Err(BrowserPolicyError::NotReady)
            );
            for url in [source, "https://resources.invalid/style.css"] {
                assert_eq!(
                    session.authorize_navigation(&id, url),
                    Err(BrowserPolicyError::NotReady)
                );
            }
            session.report_host(&id, ready(&session)).unwrap();
            assert_eq!(session.status(), BrowserSessionStatus::Ready);
            assert!(session.authorize_source_navigation(&id, source).is_ok());
            assert!(session.authorize_navigation(&id, source).is_ok());
            assert!(session
                .authorize_navigation(&id, "https://resources.invalid/style.css")
                .is_ok());
            assert_eq!(
                session.authorize_navigation(&id, "https://source.invalid"),
                Err(BrowserPolicyError::NavigationNotGranted)
            );
            session
                .report_host(&id, NativeHostReadiness::NotReady)
                .unwrap();
            assert_eq!(session.status(), BrowserSessionStatus::Revoked);
            assert!(session.with_proxy_credentials(|_, _| ()).is_none());
            for url in [source, "https://resources.invalid/style.css"] {
                assert_eq!(
                    session.authorize_navigation(&id, url),
                    Err(BrowserPolicyError::Revoked)
                );
            }
            assert_eq!(
                session.report_host(&id, ready(&session)),
                Err(BrowserPolicyError::Revoked)
            );
            stop(&mut session).await;
        }
    }

    #[tokio::test]
    async fn explicit_navigation_preserves_origin_scheme_port_and_source_only_login() {
        let mut session = session_for_policy(policy_with_origins(
            "https://source.invalid",
            &[
                "https://resources.invalid",
                "http://assets.invalid:8080",
                "https://source.invalid:8443",
                "http://source.invalid:443",
                "https://[::1]:8443",
                "https://bücher.example",
            ],
        ))
        .await;
        let id = session.policy().identity().clone();
        session.report_host(&id, ready(&session)).unwrap();
        for url in [
            "https://source.invalid/login?opaque=%2B#x",
            "HTTPS://SOURCE.Invalid:443/redirect",
            "https://source.invalid/path/../login",
        ] {
            assert!(session.authorize_navigation(&id, url).is_ok(), "{url}");
            assert!(
                session.authorize_source_navigation(&id, url).is_ok(),
                "{url}"
            );
        }
        let additional_urls = [
            "https://resources.invalid/redirect?state=%2F#complete",
            "HTTPS://RESOURCES.Invalid:443/style.css",
            "http://assets.invalid:8080/script.js",
            "https://source.invalid:8443/login",
            "http://source.invalid:443/login",
            "https://[::1]:8443/image.png",
            "https://xn--bcher-kva.example/font.woff2",
        ];
        for url in additional_urls {
            assert!(session.authorize_navigation(&id, url).is_ok(), "{url}");
            assert_eq!(
                session.authorize_source_navigation(&id, url),
                Err(BrowserPolicyError::NavigationNotGranted),
                "{url}"
            );
        }
        for url in [
            "http://source.invalid",
            "http://resources.invalid:443/style.css",
            "https://assets.invalid:8080/script.js",
            "http://assets.invalid/script.js",
            "https://resources.invalid:8443",
            "https://source.invalid:444",
            "https://other.invalid",
            "https://sub.resources.invalid",
            "https://resources.invalid.other.invalid",
            "https://[::1]/image.png",
            "https://[::2]:8443/image.png",
            "https://@resources.invalid",
            "https://user:secret@resources.invalid",
            "https://resources.invalid@other.invalid",
            "https://resources.invalid\\@other.invalid",
            "https://resources.invalid:/style.css",
            "https://%72esources.invalid/style.css",
            "https:///resources.invalid/style.css",
            "https:////resources.invalid/style.css",
            "https://resources.invalid\n/style.css",
            " https://resources.invalid/style.css",
            "https://*.invalid/style.css",
            "javascript:void(0)",
            "data:text/html,hi",
            "file:///tmp/page",
            "blob:https://source.invalid/id",
            "wss://resources.invalid/socket",
            "//resources.invalid/style.css",
            "/relative/path",
            &format!("https://resources.invalid/{}", "x".repeat(8192)),
        ] {
            assert_eq!(
                session.authorize_navigation(&id, url),
                Err(BrowserPolicyError::NavigationNotGranted),
                "{url}"
            );
        }
        session.revoke(&id).unwrap();
        assert!(session.with_proxy_credentials(|_, _| ()).is_none());
        for url in additional_urls {
            assert_eq!(
                session.authorize_navigation(&id, url),
                Err(BrowserPolicyError::Revoked)
            );
            assert_eq!(
                session.authorize_source_navigation(&id, url),
                Err(BrowserPolicyError::Revoked)
            );
        }
        assert_eq!(
            session.report_host(&id, ready(&session)),
            Err(BrowserPolicyError::Revoked)
        );
        stop(&mut session).await;
    }

    #[tokio::test]
    async fn readiness_is_not_implied_by_retained_authenticated_proxy() {
        let mut session = session().await;
        let id = session.policy().identity().clone();
        assert_ne!(session.proxy_endpoint().port(), 0);
        assert_eq!(session.status(), BrowserSessionStatus::NotReady);
        assert!(session
            .with_proxy_credentials(|user, password| !user.is_empty() && !password.is_empty())
            .unwrap());
        assert_eq!(
            session.authorize_source_navigation(&id, "https://source.invalid"),
            Err(BrowserPolicyError::NotReady)
        );
        assert_eq!(
            session.authorize_navigation(&id, "https://source.invalid"),
            Err(BrowserPolicyError::NotReady)
        );
        session.report_host(&id, ready(&session)).unwrap();
        assert_eq!(
            session
                .authorize_source_navigation(&id, "https://source.invalid/login?opaque=%2B#x")
                .unwrap()
                .as_str(),
            "https://source.invalid/login?opaque=%2B#x"
        );
        for url in [
            "http://source.invalid",
            "https://other.invalid",
            "https://source.invalid:444",
            "https://@source.invalid",
            "https://user:secret@source.invalid",
            "https://source.invalid\\path",
            "javascript:void(0)",
            "//source.invalid/path",
        ] {
            assert_eq!(
                session.authorize_source_navigation(&id, url),
                Err(BrowserPolicyError::NavigationNotGranted)
            );
            assert_eq!(
                session.authorize_navigation(&id, url),
                Err(BrowserPolicyError::NavigationNotGranted)
            );
        }
        stop(&mut session).await;
        assert!(session.with_proxy_credentials(|_, _| ()).is_none());
        assert_eq!(
            session.authorize_source_navigation(&id, "https://source.invalid"),
            Err(BrowserPolicyError::Revoked)
        );
        assert_eq!(
            session.authorize_navigation(&id, "https://source.invalid"),
            Err(BrowserPolicyError::Revoked)
        );
        assert_eq!(
            session.report_host(&id, ready(&session)),
            Err(BrowserPolicyError::Revoked)
        );
    }

    #[tokio::test]
    async fn stale_owner_session_and_attempt_callbacks_do_not_mutate_current_session() {
        for host_ready in [false, true] {
            let mut session = session_for_policy(policy_with_origins(
                "https://source.invalid",
                &["https://resources.invalid"],
            ))
            .await;
            let current = session.policy().identity().clone();
            if host_ready {
                session.report_host(&current, ready(&session)).unwrap();
            }
            let expected_status = session.status();
            for field in 0..4 {
                let mut stale = current.clone();
                match field {
                    0 => stale.owner_database_id = "other-owner".into(),
                    1 => stale.connection_id = "other-connection".into(),
                    2 => stale.session_id = "other-tab".into(),
                    _ => stale.attempt_id = Uuid::new_v4(),
                }
                for report in [
                    ready(&session),
                    NativeHostReadiness::NotReady,
                    NativeHostReadiness::Unsupported(HostUnavailableReason::RuntimeUnavailable),
                ] {
                    assert_eq!(
                        session.report_host(&stale, report),
                        Err(BrowserPolicyError::StaleIdentity)
                    );
                }
                assert_eq!(
                    session.revoke(&stale),
                    Err(BrowserPolicyError::StaleIdentity)
                );
                for url in [
                    "https://source.invalid",
                    "https://resources.invalid/style.css",
                ] {
                    assert_eq!(
                        session.authorize_source_navigation(&stale, url),
                        Err(BrowserPolicyError::StaleIdentity)
                    );
                    assert_eq!(
                        session.authorize_navigation(&stale, url),
                        Err(BrowserPolicyError::StaleIdentity)
                    );
                }
                assert_eq!(session.status(), expected_status);
                assert!(session.with_proxy_credentials(|_, _| ()).is_some());
            }
            stop(&mut session).await;
        }
    }

    #[tokio::test]
    async fn unsupported_runtime_is_terminal_and_status_has_no_private_metadata() {
        for reason in [
            HostUnavailableReason::RuntimeUnavailable,
            HostUnavailableReason::ProfileIsolationUnavailable,
            HostUnavailableReason::ProxyAuthenticationUnavailable,
            HostUnavailableReason::TrafficContainmentUnverified,
        ] {
            let mut session = session().await;
            let id = session.policy().identity().clone();
            session
                .report_host(&id, NativeHostReadiness::Unsupported(reason))
                .unwrap();
            assert_eq!(session.status(), BrowserSessionStatus::Unsupported(reason));
            let output = serde_json::to_string(&session.status()).unwrap();
            assert!(output.contains("unsupported"));
            assert!(
                !output.contains("fixture")
                    && !output.contains("source.invalid")
                    && !output.contains("127.0.0.1")
            );
            assert!(session.with_proxy_credentials(|_, _| ()).is_none());
            assert_eq!(
                session.report_host(&id, ready(&session)),
                Err(BrowserPolicyError::Revoked)
            );
            stop(&mut session).await;
        }
    }

    #[tokio::test]
    async fn wrong_profile_or_proxy_binding_revokes_and_cannot_be_rearmed() {
        for (source, wrong_profile) in [
            ("https://source.invalid", true),
            ("https://source.invalid", false),
            ("http://source.invalid", true),
            ("http://source.invalid", false),
        ] {
            let mut session =
                session_for_policy(policy_with_origins(source, &["https://resources.invalid"]))
                    .await;
            let id = session.policy().identity().clone();
            let report = NativeHostReadiness::Ready {
                profile_key: if wrong_profile {
                    "other-profile".into()
                } else {
                    session.policy().profile_key().into()
                },
                proxy_endpoint: if wrong_profile {
                    session.proxy_endpoint()
                } else {
                    "192.0.2.1:8080".parse().unwrap()
                },
            };
            assert_eq!(
                session.report_host(&id, report),
                Err(BrowserPolicyError::HostBindingMismatch)
            );
            assert_eq!(session.status(), BrowserSessionStatus::Revoked);
            assert_eq!(
                session.authorize_navigation(&id, "https://resources.invalid/style.css"),
                Err(BrowserPolicyError::Revoked)
            );
            assert_eq!(
                session.report_host(&id, ready(&session)),
                Err(BrowserPolicyError::Revoked)
            );
            stop(&mut session).await;
        }
    }

    #[tokio::test]
    async fn loss_of_host_readiness_revokes_real_proxy_credentials() {
        let mut session = session().await;
        let id = session.policy().identity().clone();
        session
            .report_host(&id, NativeHostReadiness::NotReady)
            .unwrap();
        session.report_host(&id, ready(&session)).unwrap();
        session
            .report_host(&id, NativeHostReadiness::NotReady)
            .unwrap();
        assert_eq!(session.status(), BrowserSessionStatus::Revoked);
        assert!(session.with_proxy_credentials(|_, _| ()).is_none());
        stop(&mut session).await;
    }

    #[tokio::test]
    async fn native_proxy_auth_is_endpoint_scheme_realm_and_attempt_bound() {
        let mut session = session().await;
        let id = session.policy().identity().clone();
        let other_id = policy("https://source.invalid").identity().clone();
        let host = session.proxy_endpoint().ip().to_string();
        let port = session.proxy_endpoint().port();
        let answer = |identity: &BrowserIdentity, is_proxy, host, port, scheme, realm| {
            session.answer_proxy_challenge(
                identity,
                NativeProxyChallenge {
                    is_proxy,
                    host,
                    port,
                    scheme,
                    realm,
                },
                |user, password| !user.is_empty() && !password.is_empty(),
            )
        };
        assert_eq!(
            answer(&id, true, &host, port, "Basic", "private-forward-proxy"),
            Some(true)
        );
        assert_eq!(
            answer(&id, true, &host, port, "BASIC", "private-forward-proxy"),
            Some(true)
        );
        assert_eq!(session.status(), BrowserSessionStatus::NotReady);
        // A 401 imitating the private relay, another proxy, and a stale native
        // callback all leave the credential callback completely uncalled.
        assert_eq!(
            answer(&id, false, &host, port, "Basic", "private-forward-proxy"),
            None
        );
        assert_eq!(
            answer(
                &other_id,
                true,
                &host,
                port,
                "Basic",
                "private-forward-proxy"
            ),
            None
        );
        for wrong_host in [
            "localhost",
            "127.0.0.2",
            "::1",
            "source.invalid",
            "127.1",
            "2130706433",
            "127.0.0.1.evil.invalid",
            "127.0.0.1 ",
        ] {
            assert_eq!(
                answer(
                    &id,
                    true,
                    wrong_host,
                    port,
                    "Basic",
                    "private-forward-proxy"
                ),
                None
            );
        }
        assert_eq!(
            answer(&id, true, &host, 0, "Basic", "private-forward-proxy"),
            None
        );
        for scheme in ["Digest", "Negotiate", "Basic ", "", "Basic\r\n"] {
            assert_eq!(
                answer(&id, true, &host, port, scheme, "private-forward-proxy"),
                None
            );
        }
        for realm in ["", "website", "private-forward-proxy "] {
            assert_eq!(answer(&id, true, &host, port, "Basic", realm), None);
        }
        session.revoke(&id).unwrap();
        assert!(session
            .answer_proxy_challenge(
                &id,
                NativeProxyChallenge {
                    is_proxy: true,
                    host: &host,
                    port,
                    scheme: "basic",
                    realm: "private-forward-proxy"
                },
                |_, _| panic!("revoked relay credentials must not escape"),
            )
            .is_none());
        stop(&mut session).await;
    }

    #[tokio::test]
    async fn relay_exit_invalidates_cached_host_readiness() {
        let mut session = session_for_policy(policy_with_origins(
            "https://source.invalid",
            &["https://resources.invalid"],
        ))
        .await;
        let id = session.policy().identity().clone();
        session.report_host(&id, ready(&session)).unwrap();
        // End only the actual relay, leaving the host's cached report Ready.
        // The relay's own tests cover unexpected listener task termination.
        tokio::time::timeout(Duration::from_secs(2), session.proxy.stop())
            .await
            .unwrap()
            .unwrap();
        assert_eq!(session.status, BrowserSessionStatus::Ready);
        assert_eq!(session.status(), BrowserSessionStatus::Revoked);
        assert!(session.with_proxy_credentials(|_, _| ()).is_none());
        assert_eq!(
            session.authorize_source_navigation(&id, "https://source.invalid"),
            Err(BrowserPolicyError::Revoked)
        );
        assert_eq!(
            session.authorize_navigation(&id, "https://resources.invalid/style.css"),
            Err(BrowserPolicyError::Revoked)
        );
        assert_eq!(
            session.report_host(&id, ready(&session)),
            Err(BrowserPolicyError::Revoked)
        );
        stop(&mut session).await;
    }
}
