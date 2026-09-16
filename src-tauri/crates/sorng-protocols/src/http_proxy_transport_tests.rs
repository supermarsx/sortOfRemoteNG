use super::super::tls_test_fixture::{test_acceptor, TEST_CERT};
use super::*;
use sha2::{Digest, Sha256};
use std::sync::Mutex;
use tokio::net::TcpListener;
use tokio::task::JoinHandle;

use super::{InspectionFailureKind as Kind, InspectionStage as Stage};

async fn read_request<S: AsyncRead + Unpin>(socket: &mut S) -> String {
    let mut bytes = Vec::new();
    while !bytes.ends_with(b"\r\n\r\n") {
        bytes.push(socket.read_u8().await.unwrap());
        assert!(bytes.len() < MAX_CONNECT_HEADER_BYTES);
    }
    String::from_utf8(bytes).unwrap()
}

fn ms(value: u64) -> Duration {
    Duration::from_millis(value)
}

type Resolver = Box<dyn Fn(&str) -> NetFuture<Vec<SocketAddr>> + Send + Sync>;
type Dialer = Box<dyn Fn(SocketAddr) -> NetFuture<TcpStream> + Send + Sync>;

/// Deterministic network: nothing leaves the process and nothing waits on the OS.
struct FakeNet {
    resolve: Resolver,
    dial: Dialer,
}

impl InspectionNet for FakeNet {
    fn resolve(&self, authority: &str) -> NetFuture<Vec<SocketAddr>> {
        (self.resolve)(authority)
    }

    fn dial(&self, address: SocketAddr) -> NetFuture<TcpStream> {
        (self.dial)(address)
    }
}

fn resolves_to(addresses: &[&str]) -> Resolver {
    let addresses: Vec<SocketAddr> = addresses.iter().map(|a| a.parse().unwrap()).collect();
    Box::new(move |_| {
        let addresses = addresses.clone();
        Box::pin(async move { Ok(addresses) })
    })
}

fn dial_pending() -> Dialer {
    Box::new(|_| Box::pin(std::future::pending()))
}

fn dial_error(kind: io::ErrorKind) -> Dialer {
    Box::new(move |_| Box::pin(async move { Err(io::Error::from(kind)) }))
}

fn unused_net() -> FakeNet {
    FakeNet {
        resolve: Box::new(|authority| panic!("unexpected resolve of {authority}")),
        dial: Box::new(|address| panic!("unexpected dial of {address}")),
    }
}

/// Real system network that records every resolve and dial.
#[derive(Default)]
struct RecordingNet {
    resolved: Mutex<Vec<String>>,
    dialled: Mutex<Vec<SocketAddr>>,
}

impl InspectionNet for RecordingNet {
    fn resolve(&self, authority: &str) -> NetFuture<Vec<SocketAddr>> {
        self.resolved.lock().unwrap().push(authority.to_owned());
        SystemNet.resolve(authority)
    }

    fn dial(&self, address: SocketAddr) -> NetFuture<TcpStream> {
        self.dialled.lock().unwrap().push(address);
        SystemNet.dial(address)
    }
}

async fn inspect_error(
    host: &str,
    port: u16,
    proxy_url: Option<&str>,
    timeouts: InspectionTimeouts,
    net: &dyn InspectionNet,
) -> CertificateInspectionError {
    inspect_certificate_with(
        host,
        port,
        proxy_url,
        Ok(rustls::RootCertStore::empty()),
        timeouts,
        net,
    )
    .await
    .unwrap_err()
}

fn stages(error: &CertificateInspectionError) -> Vec<InspectionStage> {
    error.completed.iter().map(|done| done.stage).collect()
}

/// One loopback peer per call to `behaviour`, served `connections` times.
async fn serve<F, Fut>(connections: usize, behaviour: F) -> (u16, JoinHandle<()>)
where
    F: Fn(TcpStream) -> Fut + Send + 'static,
    Fut: Future<Output = ()> + Send + 'static,
{
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let task = tokio::spawn(async move {
        for _ in 0..connections {
            let (socket, _) = listener.accept().await.unwrap();
            behaviour(socket).await;
        }
    });
    (port, task)
}

async fn read_client_hello(socket: &mut TcpStream) {
    let mut hello = [0; 4096];
    assert!(socket.read(&mut hello).await.unwrap() > 0);
}

// Waiting for the client to close avoids a Windows RST discarding queued bytes.
async fn drain(socket: &mut TcpStream) {
    let mut buffer = [0; 1024];
    while matches!(socket.read(&mut buffer).await, Ok(read) if read > 0) {}
}

/// The raw rustls/io error the inspection handshake sees from a loopback peer.
async fn raw_handshake_error(port: u16) -> io::Error {
    let (config, _) =
        super::super::tls_ca::inspection_tls_config(Ok(rustls::RootCertStore::empty())).unwrap();
    let tcp = TcpStream::connect(("127.0.0.1", port)).await.unwrap();
    tokio_rustls::TlsConnector::from(config)
        .connect(tls_server_name("127.0.0.1").unwrap(), tcp)
        .await
        .expect_err("handshake must fail")
}

#[test]
fn rejects_header_injection_and_non_authority_proxy_routes() {
    for host in ["host\r\nX-Injected: yes", "user@host", "host/path", ""] {
        assert!(authority(host, 443).is_err());
    }
    assert_eq!(
        authority("2001:db8::1", 8443).unwrap(),
        "[2001:db8::1]:8443"
    );
    for proxy in [
        "socks5://localhost:1",
        "http://localhost/path",
        "http://localhost:0",
        " http://localhost:1",
        "http://localhost/?x=1",
    ] {
        assert!(parse_proxy(proxy).is_err());
    }
    assert_eq!(decode_user_info("a+b%3Ac%0D%0A"), "a+b:c\r\n");
    assert_eq!(decode_user_info("a&b+c%26d%2Be"), "a&b+c&d+e");
}

#[test]
fn default_budgets() {
    assert_eq!(
        InspectionTimeouts::DEFAULT,
        InspectionTimeouts {
            resolve: Duration::from_secs(10),
            connect: Duration::from_secs(10),
            per_address_floor: Duration::from_secs(3),
            proxy_tunnel: Duration::from_secs(10),
            tls_handshake: Duration::from_secs(10),
            overall: Duration::from_secs(25),
        }
    );
}

#[test]
fn elapsed_text_uses_ms_below_one_second_then_tenths() {
    for (value, text) in [
        (0, "0 ms"),
        (42, "42 ms"),
        (999, "999 ms"),
        (1000, "1.0 s"),
        (1049, "1.0 s"),
        (1050, "1.1 s"),
        (1250, "1.3 s"),
        (2087, "2.1 s"),
        (10_003, "10.0 s"),
        (25_000, "25.0 s"),
        (59_950, "60.0 s"),
    ] {
        assert_eq!(format_elapsed(value), text, "{value}");
    }
}

#[test]
fn tls_reason_mapping_falls_back_to_other() {
    let tls = |error: rustls::Error| io::Error::new(io::ErrorKind::InvalidData, error);
    for (error, reason) in [
        (
            tls(rustls::Error::InvalidMessage(
                rustls::InvalidMessage::InvalidContentType,
            )),
            TlsFailureReason::NotTls,
        ),
        (
            tls(rustls::Error::AlertReceived(
                rustls::AlertDescription::HandshakeFailure,
            )),
            TlsFailureReason::Alert,
        ),
        (
            tls(rustls::Error::InvalidCertificate(
                rustls::CertificateError::BadSignature,
            )),
            TlsFailureReason::Certificate,
        ),
        (
            tls(rustls::Error::PeerMisbehaved(
                rustls::PeerMisbehaved::BadCertChainExtensions,
            )),
            TlsFailureReason::Certificate,
        ),
        (
            tls(rustls::Error::General("verifier".into())),
            TlsFailureReason::Certificate,
        ),
        (
            tls(rustls::Error::PeerIncompatible(
                rustls::PeerIncompatible::EcPointsExtensionRequired,
            )),
            TlsFailureReason::Other,
        ),
        (tls(rustls::Error::DecryptError), TlsFailureReason::Other),
        (
            io::Error::from(io::ErrorKind::UnexpectedEof),
            TlsFailureReason::PeerClosed,
        ),
        (
            io::Error::from(io::ErrorKind::ConnectionReset),
            TlsFailureReason::PeerClosed,
        ),
        (
            io::Error::from(io::ErrorKind::ConnectionAborted),
            TlsFailureReason::PeerClosed,
        ),
        (
            io::Error::from(io::ErrorKind::BrokenPipe),
            TlsFailureReason::PeerClosed,
        ),
        (io::Error::other("unknown"), TlsFailureReason::Other),
    ] {
        assert_eq!(tls_failure_reason(&error), reason, "{error:?}");
    }
}

fn wire_base(
    kind: InspectionFailureKind,
    stage: InspectionStage,
    route: InspectionRoute,
    target: &str,
) -> CertificateInspectionError {
    CertificateInspectionError {
        kind,
        stage,
        route,
        target: target.into(),
        address: None,
        addresses_tried: 0,
        elapsed_ms: 0,
        stage_elapsed_ms: 0,
        timeout_ms: None,
        proxy_status: None,
        tls_reason: None,
        completed: Vec::new(),
        message: String::new(),
    }
}

fn done(steps: &[(InspectionStage, u64)]) -> Vec<CompletedStage> {
    steps
        .iter()
        .map(|&(stage, elapsed_ms)| CompletedStage { stage, elapsed_ms })
        .collect()
}

/// Fixture values built through the production message composer.
fn example(name: &str) -> CertificateInspectionError {
    use super::InspectionRoute::{Direct, Proxy};
    const DIRECT: &str = "10.1.180.11:443";
    const PROXIED: &str = "private.invalid:443";
    let dialled = || Some(DIRECT.to_string());
    let error = match name {
        "direct_connect_timeout" => CertificateInspectionError {
            address: dialled(),
            addresses_tried: 1,
            elapsed_ms: 10_004,
            stage_elapsed_ms: 10_003,
            timeout_ms: Some(10_000),
            completed: done(&[(Stage::Resolve, 1)]),
            ..wire_base(Kind::ConnectTimeout, Stage::Connect, Direct, DIRECT)
        },
        "direct_connection_refused" => CertificateInspectionError {
            address: dialled(),
            addresses_tried: 1,
            elapsed_ms: 2088,
            stage_elapsed_ms: 2087,
            completed: done(&[(Stage::Resolve, 1)]),
            ..wire_base(Kind::ConnectionRefused, Stage::Connect, Direct, DIRECT)
        },
        "direct_host_unreachable" => CertificateInspectionError {
            address: dialled(),
            addresses_tried: 1,
            elapsed_ms: 3001,
            stage_elapsed_ms: 3000,
            completed: done(&[(Stage::Resolve, 1)]),
            ..wire_base(Kind::HostUnreachable, Stage::Connect, Direct, DIRECT)
        },
        "direct_dns_failure" => CertificateInspectionError {
            elapsed_ms: 42,
            stage_elapsed_ms: 42,
            ..wire_base(Kind::DnsFailure, Stage::Resolve, Direct, "nas.invalid:443")
        },
        "proxy_unreachable" => CertificateInspectionError {
            elapsed_ms: 10_002,
            stage_elapsed_ms: 10_002,
            timeout_ms: Some(10_000),
            ..wire_base(Kind::ProxyUnreachable, Stage::ProxyConnect, Proxy, PROXIED)
        },
        "proxy_auth_rejected" => CertificateInspectionError {
            elapsed_ms: 12,
            stage_elapsed_ms: 4,
            proxy_status: Some(407),
            completed: done(&[(Stage::ProxyConnect, 8)]),
            ..wire_base(Kind::ProxyAuthRejected, Stage::ProxyTunnel, Proxy, PROXIED)
        },
        "proxy_tunnel_rejected" => CertificateInspectionError {
            elapsed_ms: 30,
            stage_elapsed_ms: 22,
            proxy_status: Some(504),
            completed: done(&[(Stage::ProxyConnect, 8)]),
            ..wire_base(
                Kind::ProxyTunnelRejected,
                Stage::ProxyTunnel,
                Proxy,
                PROXIED,
            )
        },
        "tls_handshake_timeout" => CertificateInspectionError {
            address: dialled(),
            addresses_tried: 1,
            elapsed_ms: 10_015,
            stage_elapsed_ms: 10_000,
            timeout_ms: Some(10_000),
            completed: done(&[(Stage::Resolve, 1), (Stage::Connect, 14)]),
            ..wire_base(
                Kind::TlsHandshakeTimeout,
                Stage::TlsHandshake,
                Direct,
                DIRECT,
            )
        },
        "tls_handshake_not_tls" => CertificateInspectionError {
            address: dialled(),
            addresses_tried: 1,
            elapsed_ms: 20,
            stage_elapsed_ms: 5,
            tls_reason: Some(TlsFailureReason::NotTls),
            completed: done(&[(Stage::Resolve, 1), (Stage::Connect, 14)]),
            ..wire_base(
                Kind::TlsHandshakeFailed,
                Stage::TlsHandshake,
                Direct,
                DIRECT,
            )
        },
        "certificate_unreadable" => CertificateInspectionError {
            address: dialled(),
            addresses_tried: 1,
            elapsed_ms: 60,
            stage_elapsed_ms: 1,
            completed: done(&[
                (Stage::Resolve, 1),
                (Stage::Connect, 14),
                (Stage::TlsHandshake, 44),
            ]),
            ..wire_base(
                Kind::CertificateUnreadable,
                Stage::Certificate,
                Direct,
                DIRECT,
            )
        },
        "inspection_unavailable" => {
            wire_base(Kind::InspectionUnavailable, Stage::Verifier, Direct, DIRECT)
        }
        "invalid_target" => wire_base(Kind::InvalidTarget, Stage::Target, Direct, ""),
        "deadline_exceeded_proxy_tunnel" => CertificateInspectionError {
            elapsed_ms: 25_000,
            stage_elapsed_ms: 15_000,
            timeout_ms: Some(25_000),
            completed: done(&[(Stage::ProxyConnect, 10_000)]),
            ..wire_base(Kind::DeadlineExceeded, Stage::ProxyTunnel, Proxy, PROXIED)
        },
        other => panic!("fixture entry without a Rust example: {other}"),
    };
    Failure(error).into()
}

#[test]
fn wire_contract_matches_shared_fixture() {
    let fixture: Vec<serde_json::Value> = serde_json::from_str(include_str!(
        "../../../../tests/fixtures/certificate-inspection-failures.json"
    ))
    .unwrap();
    assert_eq!(fixture.len(), 13);
    for entry in fixture {
        let name = entry["name"].as_str().unwrap();
        let error = example(name);
        assert_eq!(
            serde_json::to_value(&error).unwrap(),
            entry["wire"],
            "{name}"
        );
        assert_eq!(error.to_string(), entry["wire"]["message"], "{name}");
    }
}

#[tokio::test]
async fn connect_timeout_is_reported_at_connect_stage_with_measured_budget() {
    let net = FakeNet {
        resolve: resolves_to(&["192.0.2.1:443"]),
        dial: dial_pending(),
    };
    let timeouts = InspectionTimeouts {
        connect: ms(150),
        ..InspectionTimeouts::DEFAULT
    };
    let error = inspect_error("192.0.2.1", 443, None, timeouts, &net).await;
    assert_eq!(error.kind, Kind::ConnectTimeout, "{error:?}");
    assert_eq!(error.stage, Stage::Connect);
    assert_eq!(error.route, InspectionRoute::Direct);
    assert_eq!(error.target, "192.0.2.1:443");
    assert_eq!(error.address.as_deref(), Some("192.0.2.1:443"));
    assert_eq!(error.addresses_tried, 1);
    assert_eq!(error.timeout_ms, Some(150));
    assert!((150..2000).contains(&error.elapsed_ms), "{error:?}");
    assert!(error.stage_elapsed_ms >= 150 && error.stage_elapsed_ms <= error.elapsed_ms);
    assert_eq!(stages(&error), [Stage::Resolve]);
    assert!(
        error.message.contains("timed out after 150 ms"),
        "{}",
        error.message
    );
}

#[tokio::test]
async fn refused_loopback_port_is_connection_refused() {
    let port = {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        listener.local_addr().unwrap().port()
    };
    // Windows retries a refused loopback SYN for about 2 s: assert the kind only.
    let timeouts = InspectionTimeouts {
        connect: Duration::from_secs(5),
        ..InspectionTimeouts::DEFAULT
    };
    let error = inspect_error("127.0.0.1", port, None, timeouts, &SystemNet).await;
    assert_eq!(error.kind, Kind::ConnectionRefused, "{error:?}");
    assert_eq!(error.stage, Stage::Connect);
    assert_eq!(error.timeout_ms, None);
    assert!(error.message.contains("refused the TCP connection after"));
}

#[tokio::test]
async fn unreachable_and_os_timeout_io_kinds_map() {
    for (io_kind, kind) in [
        (io::ErrorKind::HostUnreachable, Kind::HostUnreachable),
        (io::ErrorKind::NetworkUnreachable, Kind::HostUnreachable),
        (io::ErrorKind::TimedOut, Kind::ConnectTimeout),
        (io::ErrorKind::ConnectionRefused, Kind::ConnectionRefused),
        (io::ErrorKind::AddrNotAvailable, Kind::ConnectFailed),
    ] {
        let net = FakeNet {
            resolve: resolves_to(&["10.1.180.11:443"]),
            dial: dial_error(io_kind),
        };
        let error =
            inspect_error("10.1.180.11", 443, None, InspectionTimeouts::DEFAULT, &net).await;
        assert_eq!(error.kind, kind, "{io_kind:?}");
        assert_eq!(error.stage, Stage::Connect);
        // An OS-reported timeout is not one of our budgets.
        assert_eq!(error.timeout_ms, None, "{io_kind:?}");
        assert_eq!(error.addresses_tried, 1);
        assert!(error.elapsed_ms < 2000, "{error:?}");
    }
}

#[tokio::test]
async fn dns_failure_is_resolve_stage() {
    let failing: Resolver = Box::new(|_| Box::pin(async { Err(io::Error::other("no such host")) }));
    let pending: Resolver = Box::new(|_| Box::pin(std::future::pending()));
    for (resolve, timeout_ms) in [
        (failing, None),
        (resolves_to(&[]), None),
        (pending, Some(100)),
    ] {
        let net = FakeNet {
            resolve,
            dial: Box::new(|address| panic!("unexpected dial of {address}")),
        };
        let timeouts = InspectionTimeouts {
            resolve: ms(100),
            ..InspectionTimeouts::DEFAULT
        };
        let error = inspect_error("nas.invalid", 443, None, timeouts, &net).await;
        assert_eq!(error.kind, Kind::DnsFailure, "{error:?}");
        assert_eq!(error.stage, Stage::Resolve);
        assert_eq!(error.target, "nas.invalid:443");
        assert_eq!(error.address, None);
        assert_eq!(error.addresses_tried, 0);
        assert!(error.completed.is_empty());
        assert_eq!(error.timeout_ms, timeout_ms);
        assert!(error.message.starts_with("Could not resolve nas.invalid "));
    }
}

#[tokio::test]
async fn multi_address_budget_is_split_and_counts_attempts() {
    let net = FakeNet {
        resolve: resolves_to(&["[2001:db8::1]:443", "192.0.2.1:443"]),
        dial: dial_pending(),
    };
    let timeouts = InspectionTimeouts {
        connect: ms(400),
        per_address_floor: ms(100),
        ..InspectionTimeouts::DEFAULT
    };
    let error = inspect_error("nas.example", 443, None, timeouts, &net).await;
    assert_eq!(error.kind, Kind::ConnectTimeout, "{error:?}");
    assert_eq!(error.addresses_tried, 2);
    assert_eq!(error.address.as_deref(), Some("192.0.2.1:443"));
    assert_eq!(error.timeout_ms, Some(400));
    assert!((400..2000).contains(&error.stage_elapsed_ms), "{error:?}");
    assert!(error.message.contains("(2 addresses tried)"), "{error:?}");
    assert!(error
        .message
        .starts_with("TCP connect to nas.example:443 (192.0.2.1:443) timed out"));

    // The floor keeps each address usable when the split would be too small.
    let net = FakeNet {
        resolve: resolves_to(&["192.0.2.1:443", "192.0.2.2:443", "192.0.2.3:443"]),
        dial: dial_pending(),
    };
    let timeouts = InspectionTimeouts {
        connect: ms(150),
        per_address_floor: ms(100),
        ..InspectionTimeouts::DEFAULT
    };
    let error = inspect_error("nas.example", 443, None, timeouts, &net).await;
    assert_eq!(error.addresses_tried, 3);
    assert_eq!(error.timeout_ms, Some(300));
}

#[tokio::test]
async fn last_address_outcome_is_reported() {
    let attempts = std::sync::Arc::new(Mutex::new(Vec::new()));
    let seen = attempts.clone();
    let net = FakeNet {
        resolve: resolves_to(&["[2001:db8::1]:443", "10.1.180.11:443"]),
        dial: Box::new(move |address| {
            seen.lock().unwrap().push(address);
            let kind = if address.is_ipv6() {
                io::ErrorKind::NetworkUnreachable
            } else {
                io::ErrorKind::ConnectionRefused
            };
            Box::pin(async move { Err(io::Error::from(kind)) })
        }),
    };
    let error = inspect_error("nas.example", 443, None, InspectionTimeouts::DEFAULT, &net).await;
    assert_eq!(error.kind, Kind::ConnectionRefused);
    assert_eq!(error.addresses_tried, 2);
    assert_eq!(attempts.lock().unwrap().len(), 2);
}

#[tokio::test]
async fn tls_handshake_timeout_after_tcp_accept() {
    let (port, peer) = serve(1, |mut socket| async move {
        // Accept TCP, then never answer the ClientHello.
        drain(&mut socket).await;
    })
    .await;
    let timeouts = InspectionTimeouts {
        tls_handshake: ms(150),
        ..InspectionTimeouts::DEFAULT
    };
    let error = inspect_error("127.0.0.1", port, None, timeouts, &SystemNet).await;
    assert_eq!(error.kind, Kind::TlsHandshakeTimeout, "{error:?}");
    assert_eq!(error.stage, Stage::TlsHandshake);
    assert_eq!(error.timeout_ms, Some(150));
    assert_eq!(stages(&error), [Stage::Resolve, Stage::Connect]);
    let total: u64 = error.completed.iter().map(|done| done.elapsed_ms).sum();
    assert!(
        total + error.stage_elapsed_ms <= error.elapsed_ms,
        "{error:?}"
    );
    assert!(error
        .message
        .ends_with("accepted TCP but did not complete a TLS handshake within 150 ms"));
    peer.await.unwrap();
}

#[tokio::test]
async fn plain_http_port_is_tls_handshake_failed_not_tls() {
    let (port, peer) = serve(2, |mut socket| async move {
        read_client_hello(&mut socket).await;
        let _ = socket
            .write_all(b"HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\n\r\n")
            .await;
        drain(&mut socket).await;
    })
    .await;
    let observed = raw_handshake_error(port).await;
    eprintln!("plain HTTP peer, observed handshake error: {observed:?}");
    assert_eq!(tls_failure_reason(&observed), TlsFailureReason::NotTls);

    let error = inspect_error(
        "127.0.0.1",
        port,
        None,
        InspectionTimeouts::DEFAULT,
        &SystemNet,
    )
    .await;
    assert_eq!(error.kind, Kind::TlsHandshakeFailed, "{error:?}");
    assert_eq!(error.stage, Stage::TlsHandshake);
    assert_eq!(error.tls_reason, Some(TlsFailureReason::NotTls));
    assert_eq!(error.timeout_ms, None);
    assert_eq!(stages(&error), [Stage::Resolve, Stage::Connect]);
    assert_eq!(
        error.message,
        format!("127.0.0.1:{port} answered with data that is not TLS")
    );
    peer.await.unwrap();
}

#[tokio::test]
async fn peer_close_during_handshake_is_peer_closed() {
    let (port, peer) = serve(2, |mut socket| async move {
        read_client_hello(&mut socket).await;
    })
    .await;
    let observed = raw_handshake_error(port).await;
    eprintln!("closing peer, observed handshake error: {observed:?}");
    assert_eq!(tls_failure_reason(&observed), TlsFailureReason::PeerClosed);

    let error = inspect_error(
        "127.0.0.1",
        port,
        None,
        InspectionTimeouts::DEFAULT,
        &SystemNet,
    )
    .await;
    assert_eq!(error.kind, Kind::TlsHandshakeFailed, "{error:?}");
    assert_eq!(error.tls_reason, Some(TlsFailureReason::PeerClosed));
    peer.await.unwrap();
}

#[tokio::test]
async fn tls_alert_during_handshake_is_alert() {
    // A fatal handshake_failure alert, as sent by servers that share no
    // protocol version or cipher suite with the client.
    const HANDSHAKE_FAILURE_ALERT: [u8; 7] = [0x15, 0x03, 0x03, 0x00, 0x02, 0x02, 0x28];
    let (port, peer) = serve(2, |mut socket| async move {
        read_client_hello(&mut socket).await;
        let _ = socket.write_all(&HANDSHAKE_FAILURE_ALERT).await;
        drain(&mut socket).await;
    })
    .await;
    let observed = raw_handshake_error(port).await;
    eprintln!("alerting peer, observed handshake error: {observed:?}");
    assert_eq!(tls_failure_reason(&observed), TlsFailureReason::Alert);

    let error = inspect_error(
        "127.0.0.1",
        port,
        None,
        InspectionTimeouts::DEFAULT,
        &SystemNet,
    )
    .await;
    assert_eq!(error.kind, Kind::TlsHandshakeFailed, "{error:?}");
    assert_eq!(error.tls_reason, Some(TlsFailureReason::Alert));
    assert!(error
        .message
        .ends_with("rejected the TLS handshake with an alert"));
    peer.await.unwrap();
}

#[tokio::test]
async fn authenticates_connect_and_inspects_target_without_local_target_dns() {
    let acceptor = test_acceptor();
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let proxy = tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        let request = read_request(&mut socket).await;
        assert_eq!(request,
            "CONNECT private.invalid:8443 HTTP/1.1\r\nHost: private.invalid:8443\r\nProxy-Authorization: Basic dXNlcituYW1lOnNlY3JldDoNCg==\r\n\r\n");
        socket
            .write_all(b"HTTP/1.1 200 Connection established\r\n\r\n")
            .await
            .unwrap();
        let mut tls = acceptor.accept(socket).await.unwrap();
        let _ = tls.read_u8().await; // Inspection sends no HTTP application request.
    });
    let info = fetch_tls_certificate_info(
        "private.invalid",
        8443,
        Some(&format!(
            "http://user+name:secret%3A%0D%0A@127.0.0.1:{port}"
        )),
    )
    .await
    .unwrap();
    let der = base64::engine::general_purpose::STANDARD
        .decode(TEST_CERT)
        .unwrap();
    assert_eq!(info.fingerprint, hex::encode(Sha256::digest(&der)));
    assert_eq!(info.chain.len(), 1);
    assert_eq!(info.chain[0].fingerprint, info.fingerprint);
    let wire = serde_json::to_value(&info).unwrap();
    assert_eq!(wire["chain"][0]["fingerprint"], wire["fingerprint"]);
    // Identical rich parsing in lean/default and the compatibility feature.
    assert!(wire["chain"][0]["subject"]
        .as_str()
        .unwrap()
        .contains("localhost"));
    assert!(!wire["chain"][0]["valid_from"].as_str().unwrap().is_empty());
    assert_eq!(wire["details"]["public_key"]["bits"], 2048);
    assert_eq!(wire["details"]["signature_parameters_der_base64"], "BQA=");
    assert_eq!(wire["capture"]["source"], "peer-presented");
    assert_eq!(wire["chain"][0]["details"]["der_base64"], TEST_CERT);
    assert!(info.warnings.is_empty(), "{:?}", info.warnings);
    proxy.await.unwrap();
}

#[tokio::test]
async fn direct_ip_inspection_returns_real_fingerprint_without_sending_credentials() {
    let acceptor = test_acceptor();
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let peer = tokio::spawn(async move {
        let (socket, _) = listener.accept().await.unwrap();
        let mut tls = acceptor.accept(socket).await.unwrap();
        // Inspection is TLS-only: no HTTP request or stored credentials.
        assert_eq!(tls.read(&mut [0; 1]).await.unwrap_or_default(), 0);
    });
    let info = fetch_tls_certificate_info("127.0.0.1", port, None)
        .await
        .unwrap();
    let der = base64::engine::general_purpose::STANDARD
        .decode(TEST_CERT)
        .unwrap();
    assert_eq!(info.fingerprint, hex::encode(Sha256::digest(&der)));
    assert_eq!(info.chain[0].fingerprint, info.fingerprint);
    assert_eq!(info.subject_cn.as_deref(), Some("localhost"));
    assert_eq!(info.san, ["DNS:localhost", "IP:127.0.0.1"]);
    assert_eq!(info.capture.certificate_count, 1);
    assert!(info.pem.unwrap().starts_with("-----BEGIN CERTIFICATE-----"));
    peer.await.unwrap();
}

#[tokio::test]
async fn failed_authentication_has_no_direct_fallback_or_secret_echo() {
    let port =
        port_of_rejecting_proxy(b"HTTP/1.1 407 secret-password\r\nX-Secret: sensitive\r\n\r\n")
            .await;
    let error = fetch_rejected(port).await;
    assert_eq!(error.kind, Kind::ProxyAuthRejected, "{error:?}");
    assert_eq!(error.stage, Stage::ProxyTunnel);
    assert_eq!(error.route, InspectionRoute::Proxy);
    assert_eq!(error.proxy_status, Some(407));
    assert_eq!(error.address, None);
    assert_eq!(error.addresses_tried, 0);
    assert_eq!(stages(&error), [Stage::ProxyConnect]);
    let message = error.to_string();
    assert!(message.contains("407"));
    assert!(!message.contains("secret-password"));
    assert!(!message.contains("sensitive"));
    assert!(!message.contains("private.invalid"));
    let wire = serde_json::to_string(&error).unwrap();
    for secret in ["secret-password", "sensitive", "127.0.0.1"] {
        assert!(!wire.contains(secret), "{secret} in {wire}");
    }
}

async fn port_of_rejecting_proxy(response: &'static [u8]) -> u16 {
    let (port, _peer) = serve(1, move |mut socket| async move {
        let _ = read_request(&mut socket).await;
        socket.write_all(response).await.unwrap();
    })
    .await;
    port
}

async fn fetch_rejected(port: u16) -> CertificateInspectionError {
    fetch_tls_certificate_info(
        "private.invalid",
        443,
        Some(&format!("http://user:secret-password@127.0.0.1:{port}")),
    )
    .await
    .unwrap_err()
}

#[tokio::test]
async fn connect_rejection_reports_proxy_status_only() {
    let port =
        port_of_rejecting_proxy(b"HTTP/1.1 504 upstream private.invalid timed out\r\n\r\n").await;
    let error = fetch_rejected(port).await;
    assert_eq!(error.kind, Kind::ProxyTunnelRejected, "{error:?}");
    assert_eq!(error.stage, Stage::ProxyTunnel);
    assert_eq!(error.proxy_status, Some(504));
    assert_eq!(
        error.message,
        "The configured proxy could not open a tunnel (HTTP 504)"
    );
    for response in [
        &b"HTTP/1.1 999 nonsense\r\n\r\n"[..],
        b"SSH-2.0-OpenSSH\r\n\r\n",
    ] {
        let port = port_of_rejecting_proxy(response).await;
        let error = fetch_rejected(port).await;
        assert_eq!(error.kind, Kind::ProxyProtocolError, "{error:?}");
        assert_eq!(error.proxy_status, None);
    }
}

#[tokio::test]
async fn bounds_connect_response_headers() {
    let (port, proxy) = serve(1, |mut socket| async move {
        let _ = read_request(&mut socket).await;
        let _ = socket
            .write_all(&vec![b'x'; MAX_CONNECT_HEADER_BYTES + 1])
            .await;
    })
    .await;
    let error = inspect_error(
        "private.invalid",
        443,
        Some(&format!("http://127.0.0.1:{port}")),
        InspectionTimeouts::DEFAULT,
        &SystemNet,
    )
    .await;
    assert_eq!(error.kind, Kind::ProxyProtocolError, "{error:?}");
    assert_eq!(error.stage, Stage::ProxyTunnel);
    proxy.await.unwrap();
}

#[tokio::test]
async fn cancellation_drops_an_unresponsive_proxy_socket() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let (seen_tx, seen_rx) = tokio::sync::oneshot::channel();
    let proxy = tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        let _ = read_request(&mut socket).await;
        seen_tx.send(()).unwrap();
        assert_eq!(socket.read(&mut [0]).await.unwrap(), 0);
    });
    let task = tokio::spawn(async move {
        fetch_tls_certificate_info(
            "private.invalid",
            443,
            Some(&format!("http://127.0.0.1:{port}")),
        )
        .await
    });
    seen_rx.await.unwrap();
    task.abort();
    assert!(task.await.unwrap_err().is_cancelled());
    tokio::time::timeout(Duration::from_secs(2), proxy)
        .await
        .unwrap()
        .unwrap();
}

#[tokio::test]
async fn unresponsive_proxy_is_proxy_tunnel_timeout() {
    let (port, proxy) = serve(1, |mut socket| async move {
        let _ = read_request(&mut socket).await;
        assert_eq!(socket.read(&mut [0]).await.unwrap(), 0);
    })
    .await;
    let timeouts = InspectionTimeouts {
        proxy_tunnel: ms(100),
        ..InspectionTimeouts::DEFAULT
    };
    let error = inspect_error(
        "private.invalid",
        443,
        Some(&format!("http://127.0.0.1:{port}")),
        timeouts,
        &SystemNet,
    )
    .await;
    assert_eq!(error.kind, Kind::ProxyTunnelTimeout, "{error:?}");
    assert_eq!(error.stage, Stage::ProxyTunnel);
    assert_eq!(error.timeout_ms, Some(100));
    assert_eq!(stages(&error), [Stage::ProxyConnect]);
    assert_eq!(
        error.message,
        "The configured proxy did not open a tunnel within 100 ms"
    );
    proxy.await.unwrap();
}

#[tokio::test]
async fn overall_deadline_reports_stage_in_progress() {
    let (port, proxy) = serve(1, |mut socket| async move {
        let _ = read_request(&mut socket).await;
        assert_eq!(socket.read(&mut [0]).await.unwrap(), 0);
    })
    .await;
    let timeouts = InspectionTimeouts {
        proxy_tunnel: Duration::from_secs(5),
        overall: ms(150),
        ..InspectionTimeouts::DEFAULT
    };
    let error = inspect_error(
        "private.invalid",
        443,
        Some(&format!("http://127.0.0.1:{port}")),
        timeouts,
        &SystemNet,
    )
    .await;
    assert_eq!(error.kind, Kind::DeadlineExceeded, "{error:?}");
    assert_eq!(error.stage, Stage::ProxyTunnel);
    assert_eq!(error.timeout_ms, Some(150));
    assert!((150..2000).contains(&error.elapsed_ms), "{error:?}");
    assert_eq!(
        error.message,
        "Certificate inspection did not finish within 150 ms (proxy tunnel)"
    );
    proxy.await.unwrap();
}

#[tokio::test]
async fn https_proxy_certificate_is_not_exempted_by_target_inspection() {
    let acceptor = test_acceptor();
    let (port, proxy) = serve(1, move |socket| {
        let acceptor = acceptor.clone();
        async move {
            assert!(acceptor.accept(socket).await.is_err());
        }
    })
    .await;
    let error = fetch_tls_certificate_info(
        "private.invalid",
        443,
        Some(&format!("https://127.0.0.1:{port}")),
    )
    .await
    .unwrap_err();
    assert_eq!(error.kind, Kind::ProxyTlsFailed, "{error:?}");
    assert_eq!(error.stage, Stage::ProxyTls);
    assert_eq!(error.timeout_ms, None);
    assert_eq!(stages(&error), [Stage::ProxyConnect]);
    assert_eq!(
        error.message,
        "The configured HTTPS proxy failed TLS verification"
    );
    proxy.await.unwrap();
}

#[tokio::test]
async fn unreachable_proxy_has_no_direct_fallback() {
    let target = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let target_port = target.local_addr().unwrap().port();
    let proxy_port = {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        listener.local_addr().unwrap().port()
    };
    let net = RecordingNet::default();
    let proxy_url = format!("http://user:secret-password@127.0.0.1:{proxy_port}");
    let error = inspect_error(
        "127.0.0.1",
        target_port,
        Some(&proxy_url),
        InspectionTimeouts::DEFAULT,
        &net,
    )
    .await;
    assert_eq!(error.kind, Kind::ProxyUnreachable, "{error:?}");
    assert_eq!(error.stage, Stage::ProxyConnect);
    assert_eq!(error.route, InspectionRoute::Proxy);
    assert_eq!(error.address, None);
    assert!(error.completed.is_empty());
    assert!(error
        .message
        .starts_with("The configured proxy could not be reached after "));
    let wire = serde_json::to_string(&error).unwrap();
    assert!(!wire.contains("secret-password") && !wire.contains(&proxy_port.to_string()));
    // Only the proxy was resolved and dialled; the target never saw a connection.
    assert_eq!(
        *net.resolved.lock().unwrap(),
        [format!("127.0.0.1:{proxy_port}")]
    );
    assert!(net
        .dialled
        .lock()
        .unwrap()
        .iter()
        .all(|address| address.port() == proxy_port));
    assert!(
        tokio::time::timeout(ms(200), target.accept())
            .await
            .is_err(),
        "target received a direct connection"
    );
}

#[tokio::test]
async fn invalid_target_never_echoes_input() {
    for proxy_url in [None, Some("http://127.0.0.1:1")] {
        for host in [
            "host\r\nX-Injected: yes",
            "user@host",
            "host/path",
            "",
            "a..b",
        ] {
            let error = inspect_error(
                host,
                443,
                proxy_url,
                InspectionTimeouts::DEFAULT,
                &unused_net(),
            )
            .await;
            assert_eq!(error.kind, Kind::InvalidTarget, "{host:?}");
            assert_eq!(error.stage, Stage::Target);
            assert_eq!(error.target, "");
            assert_eq!(error.message, "Invalid certificate target authority");
            let wire = serde_json::to_string(&error).unwrap();
            assert!(
                !wire.contains("Injected") && !wire.contains("path"),
                "{wire}"
            );
        }
    }
    let error = inspect_error(
        "10.1.180.11",
        443,
        Some("http://user:secret-password@127.0.0.1/path"),
        InspectionTimeouts::DEFAULT,
        &unused_net(),
    )
    .await;
    assert_eq!(error.kind, Kind::ProxyInvalid);
    assert!(!serde_json::to_string(&error).unwrap().contains("secret"));
}

#[test]
fn inspection_future_is_send_for_the_tauri_command() {
    fn assert_send<T: Send>(_: &T) {}
    // Constructing the future runs nothing; the command needs it to be Send.
    assert_send(&fetch_tls_certificate_info("127.0.0.1", 443, None));
}

#[test]
fn verifier_unavailable_is_inspection_unavailable() {
    // inspection_tls_config tolerates missing roots (status unavailable), so
    // its error path is unreachable from a test; assert the stage mapping.
    let mut attempt = Attempt::new(InspectionRoute::Direct, InspectionTimeouts::DEFAULT);
    attempt.target = "10.1.180.11:443".into();
    attempt.begin(Stage::Verifier);
    let error = CertificateInspectionError::from(attempt.fail(Kind::InspectionUnavailable));
    assert_eq!(error.stage, Stage::Verifier);
    assert_eq!(error.address, None);
    assert!(error.completed.is_empty());
    assert_eq!(
        error.message,
        "The local TLS inspection verifier is unavailable"
    );
}

#[tokio::test]
#[ignore = "live network: TEST-NET-1 routing differs between hosts and CI"]
async fn live_testnet_blackhole() {
    let timeouts = InspectionTimeouts {
        connect: Duration::from_secs(2),
        ..InspectionTimeouts::DEFAULT
    };
    let error = inspect_error("192.0.2.1", 443, None, timeouts, &SystemNet).await;
    eprintln!("live TEST-NET-1: {error:?}");
    assert!(
        matches!(error.kind, Kind::ConnectTimeout | Kind::HostUnreachable),
        "{error:?}"
    );
    assert!(error.elapsed_ms < 5000, "{error:?}");
}
