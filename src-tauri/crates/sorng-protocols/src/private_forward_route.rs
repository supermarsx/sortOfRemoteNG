//! Explicit native routes for the private, origin-preserving CONNECT relay.
//! These adapters open bytes, not website TLS or HTTP. There is no default
//! route, ambient proxy lookup, URL credential serialization, or retry fallback.

use crate::private_forward_proxy::{Authority, BoxedStream, DialFuture, RouteDialer};
use std::io;
use std::time::Duration;
use zeroize::Zeroizing;

#[path = "private_forward_socks.rs"]
mod socks;
pub use socks::Socks5Auth;

#[derive(Clone)]
enum Route {
    Direct,
    HttpConnect(Zeroizing<String>),
    Socks5(socks::Socks5Route),
}

/// Construct only after resolving the saved connection's native network path.
/// Unsupported SOCKS4/SSH/chain configurations must fail in that resolver, never
/// be converted into `direct()`. No serde/Debug/Default implementation by design.
#[derive(Clone)]
pub struct NativeForwardRoute(Route);

impl NativeForwardRoute {
    /// Explicit direct *upstream*: the browser still talks to the private relay.
    pub fn direct() -> Self {
        Self(Route::Direct)
    }

    /// SOCKS5 with upstream destination DNS and explicit authentication policy.
    /// `endpoint` is an ASCII host:port or [IPv6]:port, never a credential URL.
    /// The whole establishment (proxy DNS, TCP, auth, CONNECT) has a 20s budget.
    pub fn socks5(endpoint: &str, auth: Socks5Auth) -> io::Result<Self> {
        Self::socks5_with_timeout(endpoint, auth, Duration::from_secs(20))
    }

    /// As `socks5`, with one absolute establishment budget in (0, 120s].
    /// Dropping the dial future closes its pending tunnel. Established opaque
    /// streams have no route-level idle timer; their owner controls lifetime.
    pub fn socks5_with_timeout(
        endpoint: &str,
        auth: Socks5Auth,
        timeout: Duration,
    ) -> io::Result<Self> {
        socks::Socks5Route::new(endpoint, auth, timeout).map(|route| Self(Route::Socks5(route)))
    }

    /// HTTP or verified HTTPS upstream proxy. Destination DNS is handled by the
    /// upstream proxy; its credentials are distinct from private relay auth.
    pub fn http_connect(proxy_url: String) -> io::Result<Self> {
        let proxy_url = Zeroizing::new(proxy_url);
        let valid = url::Url::parse(&proxy_url).ok().is_some_and(|url| {
            (proxy_url.starts_with("http://") || proxy_url.starts_with("https://"))
                && !proxy_url
                    .chars()
                    .any(|c| c.is_control() || c.is_whitespace() || c == '\\')
                && matches!(url.scheme(), "http" | "https")
                && url.host_str().is_some()
                && url.port() != Some(0)
                && url.path() == "/"
                && url.query().is_none()
                && url.fragment().is_none()
        });
        if !valid {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "Invalid HTTP CONNECT route",
            ));
        }
        Ok(Self(Route::HttpConnect(proxy_url)))
    }
}

impl RouteDialer for NativeForwardRoute {
    fn dial(&self, authority: Authority) -> DialFuture {
        let route = self.0.clone();
        Box::pin(async move {
            let proxy = match &route {
                Route::Direct => None,
                Route::HttpConnect(proxy) => Some(proxy.as_str()),
                Route::Socks5(proxy) => return proxy.connect(authority).await,
            };
            let stream =
                crate::http::connect_browser_transport(authority.host(), authority.port(), proxy)
                    .await
                    // Do not include destination, proxy URL, secret or raw peer data
                    // in a relay error. The listener returns only a fixed status.
                    .map_err(|_| io::Error::other("Configured browser transport failed"))?;
            Ok(Box::new(stream) as BoxedStream)
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::private_forward_proxy::{exact_authority_grant, PrivateForwardProxy, ProxyLimits};
    use std::sync::Arc;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    #[test]
    fn invalid_or_unsupported_routes_are_not_silently_direct() {
        for route in [
            "",
            "socks5://127.0.0.1:1080",
            "http://proxy.invalid:0",
            "file:///proxy",
            "http://user:secret@proxy.invalid/path",
            "http://proxy.invalid/?secret=value",
            "http://proxy.invalid/#secret",
            "http://proxy.invalid\r\n",
            "http:\\proxy.invalid",
        ] {
            let error = match NativeForwardRoute::http_connect(route.into()) {
                Ok(_) => panic!("invalid route accepted"),
                Err(error) => error,
            };
            assert_eq!(error.kind(), io::ErrorKind::InvalidInput);
            assert_eq!(error.to_string(), "Invalid HTTP CONNECT route");
        }
        for route in [
            "http://user:secret@127.0.0.1:3128",
            "https://proxy.invalid:8443",
            "http://[::1]:3128",
        ] {
            assert!(NativeForwardRoute::http_connect(route.into()).is_ok());
        }
    }

    #[tokio::test]
    async fn explicit_direct_route_returns_an_opaque_stream() {
        let peer = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let authority = Authority::parse(&peer.local_addr().unwrap().to_string()).unwrap();
        let task = tokio::spawn(async move {
            let (mut socket, _) = peer.accept().await.unwrap();
            assert_eq!(socket.read_u8().await.unwrap(), 0xff);
            socket.write_u8(0xfe).await.unwrap();
        });
        let mut socket = NativeForwardRoute::direct().dial(authority).await.unwrap();
        socket.write_u8(0xff).await.unwrap();
        assert_eq!(socket.read_u8().await.unwrap(), 0xfe);
        task.await.unwrap();
    }

    /// Actual TLS is end-to-end between a browser-like HTTP client and the peer.
    /// Neither the private relay nor upstream route rewrites the HTTPS origin,
    /// headers, body, SNI, certificate or cookies. No public network is contacted.
    #[tokio::test]
    async fn tls_identity_and_http_headers_survive_both_proxy_hops() {
        let cert =
            rcgen::generate_simple_self_signed(vec!["browser-origin.invalid".into()]).unwrap();
        let der = cert.serialize_der().unwrap();
        let config = rustls::ServerConfig::builder_with_provider(Arc::new(
            rustls::crypto::aws_lc_rs::default_provider(),
        ))
        .with_safe_default_protocol_versions()
        .unwrap()
        .with_no_client_auth()
        .with_single_cert(
            vec![rustls::pki_types::CertificateDer::from(der.clone())],
            rustls::pki_types::PrivatePkcs8KeyDer::from(cert.serialize_private_key_der()).into(),
        )
        .unwrap();
        let acceptor = tokio_rustls::TlsAcceptor::from(Arc::new(config));
        let upstream = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let upstream_port = upstream.local_addr().unwrap().port();
        let task = tokio::spawn(async move {
            let (mut socket, _) = upstream.accept().await.unwrap();
            let mut head = Vec::new();
            while !head.ends_with(b"\r\n\r\n") {
                head.push(socket.read_u8().await.unwrap());
                assert!(head.len() < 8192);
            }
            let head = String::from_utf8(head).unwrap();
            assert_eq!(head, "CONNECT browser-origin.invalid:443 HTTP/1.1\r\nHost: browser-origin.invalid:443\r\nProxy-Authorization: Basic dXBzdHJlYW06Zml4dHVyZQ==\r\n\r\n");
            socket
                .write_all(b"HTTP/1.1 200 Connection established\r\n\r\n")
                .await
                .unwrap();
            let mut tls = acceptor.accept(socket).await.unwrap();
            assert_eq!(
                tls.get_ref().1.server_name(),
                Some("browser-origin.invalid")
            );
            let mut head = Vec::new();
            while !head.ends_with(b"\r\n\r\n") {
                head.push(tls.read_u8().await.unwrap());
                assert!(head.len() < 8192);
            }
            let head = String::from_utf8(head).unwrap().to_ascii_lowercase();
            assert!(head.starts_with("get /login?fixture=opaque%2bvalue http/1.1\r\n"));
            assert!(head.contains("\r\nhost: browser-origin.invalid\r\n"));
            assert!(head.contains("\r\nuser-agent: fixture-native-browser\r\n"));
            assert!(head.contains("\r\ncookie: site-session=fixture\r\n"));
            assert!(!head.contains("proxy-authorization"));
            assert!(!head.contains("sorng"));
            tls.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 7\r\nSet-Cookie: site-session=updated; Secure; HttpOnly\r\nConnection: close\r\n\r\nunmixed").await.unwrap();
            tls.shutdown().await.unwrap();
        });
        let route = NativeForwardRoute::http_connect(format!(
            "http://upstream:fixture@127.0.0.1:{upstream_port}"
        ))
        .unwrap();
        let target = Authority::parse("browser-origin.invalid:443").unwrap();
        let mut relay = PrivateForwardProxy::start(
            Arc::new(route),
            exact_authority_grant(target),
            ProxyLimits::default(),
        )
        .await
        .unwrap();
        let proxy = relay
            .with_credentials(|user, pass| {
                reqwest::Proxy::all(format!("http://{}", relay.local_addr()))
                    .unwrap()
                    .basic_auth(user, pass)
            })
            .unwrap();
        let client = reqwest::Client::builder()
            .no_proxy()
            .proxy(proxy)
            .add_root_certificate(reqwest::Certificate::from_der(&der).unwrap())
            .timeout(std::time::Duration::from_secs(5))
            .build()
            .unwrap();
        let response = client
            .get("https://browser-origin.invalid/login?fixture=opaque%2Bvalue")
            .header("User-Agent", "fixture-native-browser")
            .header("Cookie", "site-session=fixture")
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), 200);
        assert_eq!(
            response.url().origin().ascii_serialization(),
            "https://browser-origin.invalid"
        );
        assert_eq!(
            response.headers()["set-cookie"],
            "site-session=updated; Secure; HttpOnly"
        );
        assert_eq!(response.text().await.unwrap(), "unmixed");
        task.await.unwrap();
        relay.stop().await.unwrap();
    }
}
