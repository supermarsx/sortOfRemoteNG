//! Anonymous headers-only observation through an already-authorized native relay.
//!
//! This is not a route selector or browser TLS verifier. The native owner must
//! authorize navigation immediately before preparing the request, retain its
//! lease while polling, and recheck before publishing. Proxy credentials stay
//! inside native memory. No destination credentials or browser state are used.

use serde::Serialize;
use std::{
    net::SocketAddr,
    time::{Duration, Instant},
};
use url::Url;

pub const PROBE_TIMEOUT: Duration = Duration::from_secs(8);
pub const MAX_CONTENT_LENGTH: u64 = 9_007_199_254_740_991;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ProbeOutcome {
    Response,
    Timeout,
    RouteUnavailable,
    TlsFailed,
    RequestFailed,
    OwnerUnavailable,
    Busy,
}

/// Deliberately no server-controlled strings, response body, URL, or raw error.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProbeResponse {
    pub outcome: ProbeOutcome,
    pub elapsed_ms: u32,
    pub http_status: Option<u16>,
    pub content_length: Option<u64>,
}

impl ProbeResponse {
    pub fn without_response(outcome: ProbeOutcome, elapsed: Duration) -> Self {
        Self {
            outcome,
            elapsed_ms: elapsed.as_millis().min(u32::MAX as u128) as u32,
            http_status: None,
            content_length: None,
        }
    }
}

/// Accept only the URL standard's canonical HTTP(S) origin serialization.
/// The renderer cannot supply a path, query, fragment, userinfo or normalization
/// trick. The sole permitted request target is this origin's literal root.
pub fn canonical_origin_root(origin: &str) -> Option<Url> {
    if origin.len() > 2048 || origin.bytes().any(|b| b.is_ascii_control()) {
        return None;
    }
    let url = Url::parse(origin).ok()?;
    if !matches!(url.scheme(), "http" | "https")
        || url.origin().ascii_serialization() != origin
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || url.path() != "/"
    {
        return None;
    }
    Some(url)
}

/// Opaque native-only prepared request; intentionally not Debug or Serialize.
pub struct AnonymousOriginProbe(reqwest::RequestBuilder);

impl AnonymousOriginProbe {
    /// Call ONLY inside the owning session's private credential callback, after
    /// checking the exact retained Navigation permission and live native lease.
    pub fn prepare(
        origin: &str,
        endpoint: SocketAddr,
        proxy_username: &str,
        proxy_password: &str,
    ) -> Result<Self, ProbeOutcome> {
        Self::prepare_with_timeout(
            origin,
            endpoint,
            proxy_username,
            proxy_password,
            PROBE_TIMEOUT,
        )
    }

    fn prepare_with_timeout(
        origin: &str,
        endpoint: SocketAddr,
        proxy_username: &str,
        proxy_password: &str,
        timeout: Duration,
    ) -> Result<Self, ProbeOutcome> {
        let root = canonical_origin_root(origin).ok_or(ProbeOutcome::RequestFailed)?;
        if !endpoint.ip().is_loopback()
            || endpoint.port() == 0
            || proxy_username.is_empty()
            || proxy_password.is_empty()
        {
            return Err(ProbeOutcome::RouteUnavailable);
        }
        let proxy = reqwest::Proxy::all(format!("http://{endpoint}"))
            .map_err(|_| ProbeOutcome::RouteUnavailable)?
            .basic_auth(proxy_username, proxy_password);
        let client = reqwest::Client::builder()
            // Ignore ALL environment/system proxy settings and bypass lists.
            // Only the attempt's authenticated numeric loopback relay is used.
            .no_proxy()
            .proxy(proxy)
            .use_rustls_tls()
            .redirect(reqwest::redirect::Policy::none())
            .cookie_store(false)
            .referer(false)
            .no_gzip()
            .no_brotli()
            .no_deflate()
            .no_zstd()
            .http1_only()
            .pool_max_idle_per_host(0)
            .connect_timeout(timeout)
            .timeout(timeout)
            .build()
            .map_err(|_| ProbeOutcome::RouteUnavailable)?;
        Ok(Self(client.get(root)))
    }

    /// Returns when response headers arrive; the body is never read. Dropping
    /// this future cancels the request (native owner revocation does so).
    pub async fn run(self) -> ProbeResponse {
        let started = Instant::now();
        match self.0.send().await {
            Ok(response) => {
                let status = response.status().as_u16();
                if !(100..=599).contains(&status) {
                    return ProbeResponse::without_response(
                        ProbeOutcome::RequestFailed,
                        started.elapsed(),
                    );
                }
                let mut result =
                    ProbeResponse::without_response(ProbeOutcome::Response, started.elapsed());
                result.http_status = Some(status);
                // Only declared header metadata, never a measured body length.
                result.content_length = response
                    .headers()
                    .get(reqwest::header::CONTENT_LENGTH)
                    .and_then(|value| value.to_str().ok())
                    .filter(|value| value.len() <= 16 && value.bytes().all(|b| b.is_ascii_digit()))
                    .and_then(|value| value.parse::<u64>().ok())
                    .filter(|value| *value <= MAX_CONTENT_LENGTH);
                result
            }
            Err(error) => {
                let outcome = if error.is_timeout() {
                    ProbeOutcome::Timeout
                } else if tls_error(&error) {
                    ProbeOutcome::TlsFailed
                } else {
                    // A connection error can be relay, upstream route or target;
                    // do not invent DNS/TCP stages or classify from error text.
                    ProbeOutcome::RequestFailed
                };
                ProbeResponse::without_response(outcome, started.elapsed())
            }
        }
    }
}

fn tls_error(error: &(dyn std::error::Error + 'static)) -> bool {
    let mut source = Some(error);
    for _ in 0..16 {
        let Some(error) = source else { break };
        if error.downcast_ref::<rustls::Error>().is_some() {
            return true;
        }
        // io::Error::source() forwards the payload's source, skipping the
        // payload itself. tokio-rustls stores its typed TLS error there.
        // Inspect that payload first; never classify from a message string.
        source = error
            .downcast_ref::<std::io::Error>()
            .and_then(|error| error.get_ref())
            .map(|error| error as &(dyn std::error::Error + 'static))
            .or_else(|| error.source());
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::{
        io::{AsyncReadExt, AsyncWriteExt},
        net::TcpListener,
    };

    #[test]
    fn only_canonical_origins_can_select_the_root() {
        for origin in [
            "https://example.test",
            "http://example.test:8080",
            "https://[::1]:8443",
        ] {
            assert_eq!(
                canonical_origin_root(origin).unwrap().as_str(),
                format!("{origin}/")
            );
        }
        for invalid in [
            "https://example.test/",
            "https://example.test/path",
            "https://example.test?secret=x",
            "https://example.test#secret",
            "https://user:pass@example.test",
            "https://@example.test",
            "HTTPS://example.test",
            "https://EXAMPLE.test",
            "https://example.test:443",
            "file:///etc/passwd",
            "https://example.test\\path",
            " https://example.test",
            "https://example.test\n",
        ] {
            assert!(canonical_origin_root(invalid).is_none(), "{invalid:?}");
        }
    }

    async fn headers(stream: &mut tokio::net::TcpStream) -> String {
        let mut bytes = Vec::new();
        while !bytes.ends_with(b"\r\n\r\n") {
            assert!(bytes.len() < 8192);
            bytes.push(stream.read_u8().await.unwrap());
        }
        String::from_utf8(bytes).unwrap()
    }

    #[tokio::test]
    async fn root_get_is_anonymous_proxied_and_does_not_follow_or_read_body() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let endpoint = listener.local_addr().unwrap();
        let (release, wait) = tokio::sync::oneshot::channel::<()>();
        let server = tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            let request = headers(&mut stream).await.to_ascii_lowercase();
            assert!(request.starts_with("get http://unresolvable.invalid/ http/1.1\r\n"));
            assert!(request.contains("\r\nproxy-authorization: basic "));
            for forbidden in [
                "\r\nauthorization:",
                "\r\ncookie:",
                "\r\nreferer:",
                "\r\ncontent-length:",
            ] {
                assert!(!request.contains(forbidden), "{forbidden}");
            }
            stream.write_all(b"HTTP/1.1 302 Found\r\nLocation: http://other.invalid/private\r\nSet-Cookie: secret=never\r\nContent-Length: 1234\r\n\r\n").await.unwrap();
            // Do not send body or close until the client has returned headers.
            let _ = wait.await;
            assert!(
                tokio::time::timeout(Duration::from_millis(40), listener.accept())
                    .await
                    .is_err()
            );
        });
        let result = tokio::time::timeout(
            Duration::from_secs(2),
            AnonymousOriginProbe::prepare(
                "http://unresolvable.invalid",
                endpoint,
                "relay-user",
                "relay-password",
            )
            .unwrap()
            .run(),
        )
        .await
        .unwrap();
        assert_eq!(result.outcome, ProbeOutcome::Response);
        assert_eq!(result.http_status, Some(302));
        assert_eq!(result.content_length, Some(1234));
        let _ = release.send(());
        server.await.unwrap();
    }

    #[tokio::test]
    async fn unavailable_proxy_never_falls_back_to_direct_target() {
        let target = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let relay = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let endpoint = relay.local_addr().unwrap();
        drop(relay);
        let origin = format!("http://{}", target.local_addr().unwrap());
        let result = AnonymousOriginProbe::prepare_with_timeout(
            &origin,
            endpoint,
            "u",
            "p",
            Duration::from_millis(100),
        )
        .unwrap()
        .run()
        .await;
        assert!(matches!(
            result.outcome,
            ProbeOutcome::RequestFailed | ProbeOutcome::Timeout
        ));
        assert!(
            tokio::time::timeout(Duration::from_millis(40), target.accept())
                .await
                .is_err()
        );
        assert_eq!(result.http_status, None);
    }

    #[tokio::test]
    async fn pending_headers_are_bounded_and_do_not_release_metadata() {
        let relay = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let endpoint = relay.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (mut stream, _) = relay.accept().await.unwrap();
            let _ = headers(&mut stream).await;
            tokio::time::sleep(Duration::from_secs(2)).await;
        });
        let result = AnonymousOriginProbe::prepare_with_timeout(
            "http://timeout.invalid",
            endpoint,
            "u",
            "p",
            Duration::from_millis(100),
        )
        .unwrap()
        .run()
        .await;
        assert_eq!(result.outcome, ProbeOutcome::Timeout);
        assert_eq!(result.http_status, None);
        assert_eq!(result.content_length, None);
        assert!(result.elapsed_ms < 2000);
        server.abort();
    }

    #[tokio::test]
    async fn cancelling_pending_probe_closes_its_relay_stream() {
        let relay = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let probe = AnonymousOriginProbe::prepare(
            "http://cancel.invalid",
            relay.local_addr().unwrap(),
            "u",
            "p",
        )
        .unwrap();
        let pending = tokio::spawn(probe.run());
        let (mut stream, _) = tokio::time::timeout(Duration::from_secs(2), relay.accept())
            .await
            .unwrap()
            .unwrap();
        let _ = headers(&mut stream).await;
        pending.abort();
        assert!(pending.await.unwrap_err().is_cancelled());
        let mut byte = [0u8; 1];
        let closed = tokio::time::timeout(Duration::from_secs(2), stream.read(&mut byte))
            .await
            .unwrap();
        assert!(matches!(closed, Ok(0) | Err(_)));
    }

    #[tokio::test]
    async fn oversized_content_length_is_not_published_to_javascript() {
        let relay = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let endpoint = relay.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (mut stream, _) = relay.accept().await.unwrap();
            let _ = headers(&mut stream).await;
            stream
                .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 9007199254740992\r\n\r\n")
                .await
                .unwrap();
        });
        let result = AnonymousOriginProbe::prepare("http://large.invalid", endpoint, "u", "p")
            .unwrap()
            .run()
            .await;
        server.await.unwrap();
        assert_eq!(result.outcome, ProbeOutcome::Response);
        assert_eq!(result.http_status, Some(200));
        assert_eq!(result.content_length, None);
    }

    #[test]
    fn tls_classification_uses_error_types_never_message_text() {
        let certificate_error =
            rustls::Error::InvalidCertificate(rustls::CertificateError::UnknownIssuer);
        assert!(tls_error(&certificate_error));
        assert!(!tls_error(&std::io::Error::other(
            "TLS failed: https://private.invalid/secret"
        )));
    }

    #[test]
    fn tls_classification_recovers_typed_io_payload() {
        let error = std::io::Error::other(rustls::Error::InvalidCertificate(
            rustls::CertificateError::UnknownIssuer,
        ));
        assert!(tls_error(&error));
        let mut deep: Box<dyn std::error::Error + Send + Sync> = Box::new(error);
        for _ in 0..20 {
            deep = Box::new(std::io::Error::other(deep));
        }
        assert!(
            !tls_error(deep.as_ref()),
            "over-depth errors remain unclassified"
        );
    }

    #[tokio::test]
    async fn https_uses_authenticated_connect_and_rejects_untrusted_certificate() {
        use rustls::pki_types::{CertificateDer, PrivatePkcs8KeyDer};
        use std::sync::Arc;

        let certificate =
            rcgen::generate_simple_self_signed(vec!["selfsigned.invalid".into()]).unwrap();
        let config = rustls::ServerConfig::builder_with_provider(Arc::new(
            rustls::crypto::aws_lc_rs::default_provider(),
        ))
        .with_safe_default_protocol_versions()
        .unwrap()
        .with_no_client_auth()
        .with_single_cert(
            vec![CertificateDer::from(certificate.serialize_der().unwrap())],
            PrivatePkcs8KeyDer::from(certificate.serialize_private_key_der()).into(),
        )
        .unwrap();
        let acceptor = tokio_rustls::TlsAcceptor::from(Arc::new(config));
        let relay = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let endpoint = relay.local_addr().unwrap();
        let server = tokio::spawn(async move {
            for _ in 0..2 {
                let (mut stream, _) = relay.accept().await.unwrap();
                let request = headers(&mut stream).await.to_ascii_lowercase();
                assert!(request.starts_with("connect selfsigned.invalid:443 http/1.1\r\n"));
                assert!(request.contains("\r\nproxy-authorization: basic "));
                assert!(!request.contains("\r\nauthorization:"));
                assert!(!request.contains("\r\ncookie:"));
                stream
                    .write_all(b"HTTP/1.1 200 Connection Established\r\n\r\n")
                    .await
                    .unwrap();
                // Matching-name certificate, intentionally not trusted. No
                // system CA or persisted browser trust is changed.
                assert!(
                    tokio::time::timeout(Duration::from_secs(2), acceptor.accept(stream))
                        .await
                        .unwrap()
                        .is_err()
                );
            }
        });
        let result =
            AnonymousOriginProbe::prepare("https://selfsigned.invalid", endpoint, "u", "p")
                .unwrap()
                .run()
                .await;
        // Inspect a second request from the exact same production builder in
        // this test only. Prove UnknownIssuer, not a generic aborted handshake.
        let error = AnonymousOriginProbe::prepare("https://selfsigned.invalid", endpoint, "u", "p")
            .unwrap()
            .0
            .send()
            .await
            .unwrap_err();
        let mut source: Option<&(dyn std::error::Error + 'static)> = Some(&error);
        let mut unknown_issuer = false;
        while let Some(error) = source {
            unknown_issuer |= matches!(
                error.downcast_ref::<rustls::Error>(),
                Some(rustls::Error::InvalidCertificate(
                    rustls::CertificateError::UnknownIssuer
                ))
            );
            source = error
                .downcast_ref::<std::io::Error>()
                .and_then(|error| error.get_ref())
                .map(|error| error as &(dyn std::error::Error + 'static))
                .or_else(|| error.source());
        }
        assert!(unknown_issuer);
        assert_eq!(result.outcome, ProbeOutcome::TlsFailed);
        assert_eq!(result.http_status, None);
        assert_eq!(result.content_length, None);
        server.await.unwrap();
    }

    #[test]
    fn no_nonprivate_or_unauthenticated_proxy_is_accepted() {
        for endpoint in ["192.0.2.1:1234", "127.0.0.1:0"] {
            assert!(matches!(
                AnonymousOriginProbe::prepare(
                    "https://example.test",
                    endpoint.parse().unwrap(),
                    "u",
                    "p"
                ),
                Err(ProbeOutcome::RouteUnavailable)
            ));
        }
        assert!(AnonymousOriginProbe::prepare(
            "https://example.test",
            "127.0.0.1:1234".parse().unwrap(),
            "",
            ""
        )
        .is_err());
    }
}
