//! Loopback-only, public-API integration of session ownership and opaque TLS.
//!
//! Existing relay unit tests cover HTTP framing, admission and byte copying.
//! These regressions exercise their composition with OriginBrowserSession:
//! active TLS/WSS lifecycle, end-client certificate validation, and redirected
//! authority rejection. The client is Rustls/reqwest, NOT a browser host. A
//! synthetic Ready report below is not evidence of platform containment or
//! Google/Cloudflare acceptance. No public DNS, OS trust or account is used.

use base64::Engine;
use rustls::pki_types::{CertificateDer, PrivatePkcs8KeyDer, ServerName};
use sorng_protocols::origin_browser::{
    BrowserPolicyError, BrowserSessionStatus, NativeHostReadiness, OriginBrowserPolicy,
    OriginBrowserSession,
};
use sorng_protocols::private_forward_proxy::ProxyLimits;
use sorng_protocols::private_forward_route::NativeForwardRoute;
use std::future::Future;
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::time::{sleep, timeout};
use tokio_rustls::{TlsAcceptor, TlsConnector};
use zeroize::Zeroizing;

const ORIGIN: &str = "https://real-origin.invalid:8443";
const AUTHORITY: &str = "real-origin.invalid:8443";
const HOSTNAME: &str = "real-origin.invalid";
const DEADLINE: Duration = Duration::from_secs(10);
const IDLE_BUDGET: Duration = Duration::from_millis(25);
const UPGRADE: &[u8] = b"GET /socket?state=%2F+ HTTP/1.1\r\nHost: real-origin.invalid:8443\r\nOrigin: https://real-origin.invalid:8443\r\nCookie: fixture-session=local-only\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n";
const SWITCH_PROTOCOLS: &[u8] = b"HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=\r\n\r\n";

async fn bounded<T>(future: impl Future<Output = T>) -> T {
    timeout(DEADLINE, future)
        .await
        .expect("loopback fixture timed out")
}

async fn head(stream: &mut (impl AsyncRead + Unpin)) -> Vec<u8> {
    bounded(async {
        let mut bytes = Vec::new();
        while !bytes.ends_with(b"\r\n\r\n") {
            bytes.push(stream.read_u8().await.expect("incomplete HTTP head"));
            assert!(bytes.len() <= 8192, "fixture HTTP head exceeded limit");
        }
        bytes
    })
    .await
}

async fn assert_closed(stream: &mut (impl AsyncRead + Unpin)) {
    // Revocation intentionally cuts the TCP tunnel; Rustls can report missing
    // close_notify rather than clean EOF. Neither endpoint may remain waiting.
    let result = bounded(stream.read(&mut [0; 1])).await;
    assert!(matches!(result, Ok(0)) || result.is_err());
}

struct TlsFixture {
    certificate: CertificateDer<'static>,
    acceptor: TlsAcceptor,
    connector: TlsConnector,
}

impl TlsFixture {
    fn new(certificate_name: &str) -> Self {
        let certificate =
            rcgen::generate_simple_self_signed(vec![certificate_name.into()]).unwrap();
        let der = CertificateDer::from(certificate.serialize_der().unwrap());
        let key = PrivatePkcs8KeyDer::from(certificate.serialize_private_key_der());
        let provider = Arc::new(rustls::crypto::aws_lc_rs::default_provider());
        let mut server = rustls::ServerConfig::builder_with_provider(provider.clone())
            .with_safe_default_protocol_versions()
            .unwrap()
            .with_no_client_auth()
            .with_single_cert(vec![der.clone()], key.into())
            .unwrap();
        server.alpn_protocols = vec![b"http/1.1".to_vec()];
        let mut roots = rustls::RootCertStore::empty();
        roots.add(der.clone()).unwrap();
        let mut client = rustls::ClientConfig::builder_with_provider(provider)
            .with_safe_default_protocol_versions()
            .unwrap()
            .with_root_certificates(roots)
            .with_no_client_auth();
        client.alpn_protocols = server.alpn_protocols.clone();
        Self {
            certificate: der,
            acceptor: TlsAcceptor::from(Arc::new(server)),
            connector: TlsConnector::from(Arc::new(client)),
        }
    }
}

async fn session(upstream: SocketAddr) -> OriginBrowserSession {
    assert!(upstream.ip().is_loopback());
    let route = NativeForwardRoute::http_connect(format!("http://{upstream}"))
        .expect("valid loopback upstream proxy");
    let policy =
        OriginBrowserPolicy::new("fixture-owner", "fixture-connection", "fixture-tab", ORIGIN)
            .unwrap();
    let mut session = OriginBrowserSession::start(
        policy,
        Arc::new(route),
        ProxyLimits {
            http_idle_timeout: IDLE_BUDGET,
            http_response_timeout: IDLE_BUDGET,
            ..ProxyLimits::default()
        },
    )
    .await
    .unwrap();
    assert_eq!(session.status(), BrowserSessionStatus::NotReady);
    let identity = session.policy().identity().clone();
    assert_eq!(
        session.authorize_navigation(&identity, ORIGIN),
        Err(BrowserPolicyError::NotReady)
    );
    // Test-only host report, bound through the public contract. This does not
    // represent any native engine or prove browser traffic containment.
    session
        .report_host(
            &identity,
            NativeHostReadiness::Ready {
                profile_key: session.policy().profile_key().to_owned(),
                proxy_endpoint: session.proxy_endpoint(),
            },
        )
        .unwrap();
    session
}

async fn connect_request(session: &OriginBrowserSession, authority: &str) -> TcpStream {
    let request = session
        .with_proxy_credentials(|user, password| {
            let credentials = Zeroizing::new(format!("{user}:{password}"));
            let encoded = Zeroizing::new(
                base64::engine::general_purpose::STANDARD.encode(credentials.as_bytes()),
            );
            Zeroizing::new(format!(
                "CONNECT {authority} HTTP/1.1\r\nHost: {authority}\r\nProxy-Authorization: Basic {}\r\n\r\n",
                &*encoded
            ))
        })
        .expect("live session has native proxy credentials");
    let mut stream = bounded(TcpStream::connect(session.proxy_endpoint()))
        .await
        .unwrap();
    bounded(stream.write_all(request.as_bytes())).await.unwrap();
    stream
}

async fn upstream_tunnel(listener: &TcpListener) -> TcpStream {
    let (mut stream, _) = bounded(listener.accept()).await.unwrap();
    let request = head(&mut stream).await;
    // No private Proxy-Authorization or other private headers may escape to
    // the configured upstream. It has its own independent auth policy (none).
    let expected = format!("CONNECT {AUTHORITY} HTTP/1.1\r\nHost: {AUTHORITY}\r\n\r\n");
    assert!(
        request == expected.as_bytes(),
        "upstream CONNECT was modified"
    );
    bounded(stream.write_all(b"HTTP/1.1 200 Connection Established\r\n\r\n"))
        .await
        .unwrap();
    stream
}

#[tokio::test]
async fn dynamic_network_origin_uses_authenticated_private_proxy_and_fixed_upstream() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let route =
        NativeForwardRoute::http_connect(format!("http://{}", listener.local_addr().unwrap()))
            .unwrap();
    let policy = OriginBrowserPolicy::new(
        "fixture-owner",
        "fixture-connection",
        "fixture-tab",
        "https://source.invalid",
    )
    .unwrap()
    .with_network_origin_grant(Arc::new(|origin| origin == ORIGIN));
    assert_eq!(policy.allowed_origins(), &["https://source.invalid"]);
    let mut session = OriginBrowserSession::start(policy, Arc::new(route), ProxyLimits::default())
        .await
        .unwrap();
    let identity = session.policy().identity().clone();
    session
        .report_host(
            &identity,
            NativeHostReadiness::Ready {
                profile_key: session.policy().profile_key().to_owned(),
                proxy_endpoint: session.proxy_endpoint(),
            },
        )
        .unwrap();
    assert!(session
        .authorize_navigation(&identity, &format!("{ORIGIN}/resource"))
        .is_ok());
    assert_eq!(
        session.authorize_source_navigation(&identity, ORIGIN),
        Err(BrowserPolicyError::NavigationNotGranted)
    );
    let peer = tokio::spawn(async move {
        // Fails if the dynamic destination bypasses the configured upstream.
        let mut stream = upstream_tunnel(&listener).await;
        let mut bytes = [0; 7];
        bounded(stream.read_exact(&mut bytes)).await.unwrap();
        assert_eq!(&bytes, b"fixture");
        bounded(stream.write_all(b"relayed")).await.unwrap();
        assert_closed(&mut stream).await;
    });
    let mut transport = connect_request(&session, AUTHORITY).await;
    assert!(head(&mut transport).await.starts_with(b"HTTP/1.1 200 "));
    bounded(transport.write_all(b"fixture")).await.unwrap();
    let mut bytes = [0; 7];
    bounded(transport.read_exact(&mut bytes)).await.unwrap();
    assert_eq!(&bytes, b"relayed");
    let mut denied = connect_request(&session, "ungranted.invalid:443").await;
    assert!(head(&mut denied).await.starts_with(b"HTTP/1.1 403 "));
    session.revoke(&identity).unwrap();
    assert_closed(&mut transport).await;
    bounded(peer).await.unwrap();
    bounded(session.stop()).await.unwrap();
}

#[tokio::test]
async fn allow_all_network_grant_cannot_dial_its_own_relay() {
    use sorng_protocols::private_forward_proxy::{Authority, DialFuture};
    let policy =
        OriginBrowserPolicy::new("fixture-owner", "fixture-connection", "fixture-tab", ORIGIN)
            .unwrap()
            .with_network_origin_grant(Arc::new(|_| true));
    let dialer = Arc::new(|_: Authority| -> DialFuture {
        panic!("self-relay request must be denied before route selection");
    });
    let mut session = OriginBrowserSession::start(policy, dialer, ProxyLimits::default())
        .await
        .unwrap();
    for host in [
        "127.0.0.1",
        "127.0.0.2",
        "[::1]",
        "[::ffff:127.0.0.1]",
        "localhost",
        "sub.localhost",
    ] {
        let mut transport = connect_request(
            &session,
            &format!("{host}:{}", session.proxy_endpoint().port()),
        )
        .await;
        assert!(
            head(&mut transport).await.starts_with(b"HTTP/1.1 403 "),
            "{host}"
        );
    }
    bounded(session.stop()).await.unwrap();
}

#[derive(Clone, Copy)]
enum RevokeBy {
    Owner,
    HostReadinessLost,
    Drop,
}

async fn quiet_secure_stream_lifecycle(reason: RevokeBy) {
    let fixture = TlsFixture::new(HOSTNAME);
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let mut session = session(listener.local_addr().unwrap()).await;
    let identity = session.policy().identity().clone();
    let url = format!("{ORIGIN}/socket?state=%2F+");
    assert_eq!(
        session
            .authorize_source_navigation(&identity, &url)
            .unwrap()
            .as_str(),
        url
    );
    let peer = tokio::spawn(async move {
        let stream = upstream_tunnel(&listener).await;
        let mut tls = bounded(fixture.acceptor.accept(stream)).await.unwrap();
        assert_eq!(tls.get_ref().1.server_name(), Some(HOSTNAME));
        assert_eq!(tls.get_ref().1.alpn_protocol(), Some(&b"http/1.1"[..]));
        assert!(
            head(&mut tls).await == UPGRADE,
            "website request was modified"
        );
        bounded(tls.write_all(SWITCH_PROTOCOLS)).await.unwrap();
        // Exchange data on both sides of a quiet period greater than either
        // plain-HTTP timeout. This is a persistent WSS stream inside CONNECT.
        for _ in 0..2 {
            let mut frame = [0; 8];
            bounded(tls.read_exact(&mut frame)).await.unwrap();
            assert_eq!(frame, [0x81, 0x82, 1, 2, 3, 4, b'h' ^ 1, b'i' ^ 2]);
            bounded(tls.write_all(&[0x81, 2, b'h', b'i']))
                .await
                .unwrap();
        }
        assert_closed(&mut tls).await;
    });
    let mut transport = connect_request(&session, AUTHORITY).await;
    assert!(head(&mut transport).await.starts_with(b"HTTP/1.1 200 "));
    let mut tls = bounded(
        fixture
            .connector
            .connect(ServerName::try_from(HOSTNAME).unwrap(), transport),
    )
    .await
    .unwrap();
    assert_eq!(
        tls.get_ref().1.peer_certificates().unwrap(),
        &[fixture.certificate]
    );
    assert_eq!(tls.get_ref().1.alpn_protocol(), Some(&b"http/1.1"[..]));
    bounded(tls.write_all(UPGRADE)).await.unwrap();
    assert_eq!(head(&mut tls).await, SWITCH_PROTOCOLS);
    for index in 0..2 {
        if index == 1 {
            sleep(IDLE_BUDGET * 10).await;
        }
        bounded(tls.write_all(&[0x81, 0x82, 1, 2, 3, 4, b'h' ^ 1, b'i' ^ 2]))
            .await
            .unwrap();
        let mut frame = [0; 4];
        bounded(tls.read_exact(&mut frame)).await.unwrap();
        assert_eq!(frame, [0x81, 2, b'h', b'i']);
    }
    match reason {
        RevokeBy::Owner => session.revoke(&identity).unwrap(),
        RevokeBy::HostReadinessLost => session
            .report_host(&identity, NativeHostReadiness::NotReady)
            .unwrap(),
        RevokeBy::Drop => {
            drop(session);
            assert_closed(&mut tls).await;
            bounded(peer).await.unwrap();
            return;
        }
    }
    assert_eq!(session.status(), BrowserSessionStatus::Revoked);
    assert!(session.with_proxy_credentials(|_, _| ()).is_none());
    assert_eq!(
        session.authorize_navigation(&identity, &url),
        Err(BrowserPolicyError::Revoked)
    );
    // Observe closure before stop() so the test proves synchronous revocation
    // signalling actually stops the live transport without explicit cleanup.
    assert_closed(&mut tls).await;
    bounded(peer).await.unwrap();
    bounded(session.stop()).await.unwrap();
}

#[tokio::test]
async fn owner_revocation_closes_quiet_end_to_end_tls_websocket() {
    quiet_secure_stream_lifecycle(RevokeBy::Owner).await;
}

#[tokio::test]
async fn lost_native_host_readiness_closes_quiet_end_to_end_tls_websocket() {
    quiet_secure_stream_lifecycle(RevokeBy::HostReadinessLost).await;
}

#[tokio::test]
async fn dropping_session_closes_quiet_end_to_end_tls_websocket() {
    quiet_secure_stream_lifecycle(RevokeBy::Drop).await;
}

#[tokio::test]
async fn trusted_certificate_for_wrong_origin_is_rejected_by_the_end_client() {
    let fixture = TlsFixture::new("different-origin.invalid");
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let mut session = session(listener.local_addr().unwrap()).await;
    let peer = tokio::spawn(async move {
        let stream = upstream_tunnel(&listener).await;
        assert!(bounded(fixture.acceptor.accept(stream)).await.is_err());
    });
    let mut transport = connect_request(&session, AUTHORITY).await;
    assert!(head(&mut transport).await.starts_with(b"HTTP/1.1 200 "));
    // The fixture leaf is trusted, but only the original destination hostname
    // is accepted. CONNECT must not substitute its own certificate or bypass
    // validation because the TCP peer happens to be a loopback address.
    let result = bounded(
        fixture
            .connector
            .connect(ServerName::try_from(HOSTNAME).unwrap(), transport),
    )
    .await;
    let error = match result {
        Err(error) => error,
        Ok(_) => panic!("wrong-origin certificate was accepted"),
    };
    assert!(matches!(
        error
            .get_ref()
            .and_then(|error| error.downcast_ref::<rustls::Error>()),
        Some(rustls::Error::InvalidCertificate(_))
    ));
    bounded(peer).await.unwrap();
    bounded(session.stop()).await.unwrap();
}

#[tokio::test]
async fn https_redirect_to_reachable_unapproved_origin_never_dials_or_falls_back() {
    let fixture = TlsFixture::new(HOSTNAME);
    let trap = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let denied_authority = trap.local_addr().unwrap().to_string();
    let redirect = format!("https://{denied_authority}/unapproved");
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let mut session = session(listener.local_addr().unwrap()).await;
    let identity = session.policy().identity().clone();
    assert_eq!(
        session.authorize_navigation(&identity, &redirect),
        Err(BrowserPolicyError::NavigationNotGranted)
    );
    let peer = tokio::spawn(async move {
        let stream = upstream_tunnel(&listener).await;
        let mut tls = bounded(fixture.acceptor.accept(stream)).await.unwrap();
        let request = head(&mut tls).await;
        let request = String::from_utf8(request).unwrap().to_ascii_lowercase();
        assert!(request.starts_with("get /start http/1.1\r\n"));
        assert!(request.contains("\r\nhost: real-origin.invalid:8443\r\n"));
        assert!(!request.contains("proxy-authorization"));
        bounded(tls.write_all(
            format!("HTTP/1.1 302 Found\r\nLocation: {redirect}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").as_bytes(),
        ))
        .await
        .unwrap();
        bounded(tls.shutdown()).await.unwrap();
        listener
    });
    let proxy = session
        .with_proxy_credentials(|user, password| {
            reqwest::Proxy::all(format!("http://{}", session.proxy_endpoint()))
                .unwrap()
                .basic_auth(user, password)
        })
        .unwrap();
    let client = reqwest::Client::builder()
        .no_proxy()
        .proxy(proxy)
        .add_root_certificate(reqwest::Certificate::from_der(&fixture.certificate).unwrap())
        .redirect(reqwest::redirect::Policy::limited(3))
        .timeout(DEADLINE)
        .build()
        .unwrap();
    assert!(bounded(client.get(format!("{ORIGIN}/start")).send())
        .await
        .is_err());
    let listener = bounded(peer).await.unwrap();
    // Check the wire-level rejection separately from the HTTP client's opaque
    // connection error. The valid session credential does not grant this host.
    let mut denied = connect_request(&session, &denied_authority).await;
    assert!(head(&mut denied).await.starts_with(b"HTTP/1.1 403 "));
    let (upstream, direct) = tokio::join!(
        timeout(Duration::from_millis(150), listener.accept()),
        timeout(Duration::from_millis(150), trap.accept())
    );
    assert!(
        upstream.is_err(),
        "unapproved authority reached upstream route"
    );
    assert!(
        direct.is_err(),
        "unapproved authority reached direct fallback"
    );
    bounded(session.stop()).await.unwrap();
}
