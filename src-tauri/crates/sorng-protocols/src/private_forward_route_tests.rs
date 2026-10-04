use super::*;
use crate::private_forward_proxy::{
    exact_authority_grant, PrivateForwardProxy, ProxyLimits, RouteDialer,
};
use crate::private_forward_route::NativeForwardRoute;
use std::sync::atomic::{AtomicBool, Ordering};
use tokio::io::{AsyncRead, AsyncWrite};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::oneshot;

const TEST_DEADLINE: Duration = Duration::from_secs(5);
const USER: &str = "upstream-user:%40";
const PASSWORD: &str = "upstream-password:@%2F";

async fn within<T>(future: impl Future<Output = T>) -> T {
    tokio::time::timeout(TEST_DEADLINE, future)
        .await
        .expect("synthetic fixture timed out")
}

fn auth() -> Socks5Auth {
    Socks5Auth::username_password(USER.into(), PASSWORD.into()).unwrap()
}

fn target() -> Authority {
    Authority::parse("browser-origin.invalid:443").unwrap()
}

fn failure<T>(result: io::Result<T>) -> io::Error {
    match result {
        Ok(_) => panic!("expected a closed route"),
        Err(error) => error,
    }
}

fn sanitized(error: &io::Error) {
    let text = format!("{error} {error:?}");
    for secret in [USER, PASSWORD, "peer-secret", "browser-origin.invalid"] {
        assert!(!text.contains(secret));
    }
    assert!(std::error::Error::source(error).is_none());
}

async fn bytes(stream: &mut (impl AsyncRead + Unpin + ?Sized), count: usize) -> Vec<u8> {
    assert!(count <= 513);
    let mut buffer = vec![0; count];
    stream.read_exact(&mut buffer).await.unwrap();
    buffer
}

fn auth_packet(username: &str, password: &str) -> Vec<u8> {
    let mut packet = vec![1, username.len() as u8];
    packet.extend_from_slice(username.as_bytes());
    packet.push(password.len() as u8);
    packet.extend_from_slice(password.as_bytes());
    packet
}

async fn authenticate(
    stream: &mut (impl AsyncRead + AsyncWrite + Unpin),
    credentials: Option<(&str, &str)>,
) {
    let method = if credentials.is_some() { 2 } else { 0 };
    assert_eq!(bytes(stream, 3).await, [5, 1, method]);
    stream.write_all(&[5, method]).await.unwrap();
    if let Some((username, password)) = credentials {
        let expected = auth_packet(username, password);
        assert_eq!(bytes(stream, expected.len()).await, expected);
        stream.write_all(&[1, 0]).await.unwrap();
    }
}

async fn connect_request(stream: &mut (impl AsyncRead + Unpin)) -> Vec<u8> {
    let mut request = bytes(stream, 4).await;
    assert_eq!(&request[..3], [5, 1, 0]);
    let len = match request[3] {
        1 => 4,
        4 => 16,
        3 => {
            let len = stream.read_u8().await.unwrap();
            assert!(len > 0);
            request.push(len);
            usize::from(len)
        }
        _ => panic!("invalid address type"),
    };
    request.extend(bytes(stream, len + 2).await);
    request
}

fn domain_request(host: &str, port: u16) -> Vec<u8> {
    let mut packet = vec![5, 1, 0, 3, host.len() as u8];
    packet.extend_from_slice(host.as_bytes());
    packet.extend_from_slice(&port.to_be_bytes());
    packet
}

fn reply(kind: u8) -> Vec<u8> {
    let mut packet = vec![5, 0, 0, kind];
    match kind {
        1 => packet.extend_from_slice(&[192, 0, 2, 1]),
        4 => packet.extend_from_slice(
            &"2001:db8::1"
                .parse::<std::net::Ipv6Addr>()
                .unwrap()
                .octets(),
        ),
        3 => {
            // Maximum-length bound name: informational opaque bytes, never DNS.
            packet.push(255);
            packet.extend_from_slice(&[b'x'; 255]);
        }
        _ => panic!("invalid fixture"),
    }
    packet.extend_from_slice(&0u16.to_be_bytes());
    packet
}

async fn closed(stream: &mut (impl AsyncRead + Unpin)) {
    let result = within(stream.read(&mut [0; 1])).await;
    assert!(matches!(result, Ok(0)) || result.is_err());
}

#[test]
fn configuration_is_validated_without_dialing_or_echoing_secrets() {
    for endpoint in [
        "",
        "proxy.invalid",
        "socks5://user:peer-secret@proxy.invalid:1080",
        "user:peer-secret@proxy.invalid:1080",
        "proxy.invalid:0",
        "proxy.invalid:01080",
        "proxy.invalid:65536",
        "proxy.invalid:1080/path",
        "proxy.invalid:1080?peer-secret",
        "proxy.invalid:1080#peer-secret",
        "proxy.invalid:1080\r\npeer-secret",
        "proxy.invalid :1080",
        "proxy%2einvalid:1080",
        "127.1:1080",
        "0x7f000001:1080",
        "::1:1080",
        "[::1%lo]:1080",
        "[::1]:0",
    ] {
        let error = failure(NativeForwardRoute::socks5(endpoint, auth()));
        assert_eq!(error.kind(), io::ErrorKind::InvalidInput);
        assert_eq!(error.to_string(), "Invalid SOCKS5 proxy endpoint");
        sanitized(&error);
    }
    for endpoint in ["proxy.invalid:1080", "127.0.0.1:1080", "[::1]:1080"] {
        assert!(NativeForwardRoute::socks5(endpoint, Socks5Auth::no_auth()).is_ok());
    }
    for timeout in [Duration::ZERO, Duration::from_secs(121), Duration::MAX] {
        let error = failure(NativeForwardRoute::socks5_with_timeout(
            "127.0.0.1:1080",
            auth(),
            timeout,
        ));
        assert_eq!(error.kind(), io::ErrorKind::InvalidInput);
        assert_eq!(error.to_string(), "Invalid SOCKS5 route timeout");
    }
    assert!(NativeForwardRoute::socks5_with_timeout(
        "[::1]:1080",
        auth(),
        Duration::from_secs(120)
    )
    .is_ok());

    for (username, password) in [
        (String::new(), PASSWORD.into()),
        (USER.into(), String::new()),
        ("u".repeat(256), PASSWORD.into()),
        (USER.into(), "p".repeat(256)),
        ("é".repeat(128), PASSWORD.into()),
        (USER.into(), "é".repeat(128)),
    ] {
        let error = failure(Socks5Auth::username_password(username, password));
        assert_eq!(error.kind(), io::ErrorKind::InvalidInput);
        assert_eq!(error.to_string(), "Invalid SOCKS5 credentials");
        sanitized(&error);
    }
    assert!(Socks5Auth::username_password("u".repeat(255), "p".repeat(255)).is_ok());
}

#[tokio::test]
async fn all_address_frames_preserve_remote_dns_and_early_opaque_bytes() {
    within(async {
        let name = "browser-origin.invalid";
        let mut ipv4 = vec![5, 1, 0, 1, 192, 0, 2, 11];
        ipv4.extend_from_slice(&443u16.to_be_bytes());
        let mut ipv6 = vec![5, 1, 0, 4];
        ipv6.extend_from_slice(
            &"2001:db8::12"
                .parse::<std::net::Ipv6Addr>()
                .unwrap()
                .octets(),
        );
        ipv6.extend_from_slice(&8443u16.to_be_bytes());
        let long_name = format!(
            "{}.{}.{}.{}",
            "a".repeat(63),
            "b".repeat(63),
            "c".repeat(63),
            "d".repeat(61)
        );
        for (authority, expected) in [
            (format!("{name}:443"), domain_request(name, 443)),
            ("192.0.2.11:443".into(), ipv4),
            ("[2001:db8::12]:8443".into(), ipv6),
            (format!("{long_name}:443"), domain_request(&long_name, 443)),
        ] {
            for kind in [1, 3, 4] {
                let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
                let endpoint = listener.local_addr().unwrap().to_string();
                let expected = expected.clone();
                let peer = tokio::spawn(within(async move {
                    let (mut stream, _) = listener.accept().await.unwrap();
                    authenticate(&mut stream, None).await;
                    assert_eq!(connect_request(&mut stream).await, expected);
                    let mut response = reply(kind);
                    // Coalesced TLS-like bytes must remain in the returned stream.
                    response.extend_from_slice(b"\x16\x03\x03\x00\x04\xff\x00\x80\x42");
                    stream.write_all(&response).await.unwrap();
                    assert_eq!(
                        bytes(&mut stream, 8).await,
                        b"\x17\x03\x03\x00\x03\xfe\x00\x7f"
                    );
                }));
                let route = NativeForwardRoute::socks5(&endpoint, Socks5Auth::no_auth()).unwrap();
                let mut stream = route
                    .dial(Authority::parse(&authority).unwrap())
                    .await
                    .unwrap();
                assert_eq!(
                    bytes(&mut *stream, 9).await,
                    b"\x16\x03\x03\x00\x04\xff\x00\x80\x42"
                );
                stream
                    .write_all(b"\x17\x03\x03\x00\x03\xfe\x00\x7f")
                    .await
                    .unwrap();
                peer.await.unwrap();
            }
        }
    })
    .await;
}

#[tokio::test]
async fn maximum_credentials_are_raw_bytes_and_not_tunnel_payload() {
    within(async {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let endpoint = listener.local_addr().unwrap().to_string();
        let username = format!("{}x", "é".repeat(127));
        let password = "p".repeat(255);
        let route = NativeForwardRoute::socks5(
            &endpoint,
            Socks5Auth::username_password(username.clone(), password.clone()).unwrap(),
        )
        .unwrap();
        let peer = tokio::spawn(within(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            authenticate(&mut stream, Some((&username, &password))).await;
            assert_eq!(
                connect_request(&mut stream).await,
                domain_request("browser-origin.invalid", 443)
            );
            stream.write_all(&reply(1)).await.unwrap();
            assert_eq!(bytes(&mut stream, 4).await, b"site");
            closed(&mut stream).await;
        }));
        let mut stream = route.dial(target()).await.unwrap();
        stream.write_all(b"site").await.unwrap();
        drop(stream);
        peer.await.unwrap();
    })
    .await;
}

#[derive(Clone, Copy)]
enum Stage {
    Method,
    Auth,
    Connect,
    Address,
}

async fn reach_stage(stream: &mut TcpStream, stage: Stage, target_port: u16) {
    if matches!(stage, Stage::Method) {
        assert_eq!(bytes(stream, 3).await, [5, 1, 2]);
        return;
    }
    if matches!(stage, Stage::Auth) {
        assert_eq!(bytes(stream, 3).await, [5, 1, 2]);
        stream.write_all(&[5, 2]).await.unwrap();
        let expected = auth_packet(USER, PASSWORD);
        assert_eq!(bytes(stream, expected.len()).await, expected);
        return;
    }
    authenticate(stream, Some((USER, PASSWORD))).await;
    let request = connect_request(stream).await;
    assert_eq!(&request[request.len() - 2..], target_port.to_be_bytes());
    if matches!(stage, Stage::Address) {
        stream.write_all(&[5, 0, 0, 3, 255]).await.unwrap();
    }
}

#[tokio::test]
async fn rejection_malformed_and_truncated_replies_never_fall_back_or_retry() {
    within(async {
        let mut cases = vec![
            (Stage::Method, vec![5, 0], io::ErrorKind::InvalidData), // downgrade
            (Stage::Method, vec![5, 1], io::ErrorKind::InvalidData), // unoffered GSSAPI
            (Stage::Method, vec![4, 2], io::ErrorKind::InvalidData),
            (
                Stage::Method,
                vec![5, 0xff],
                io::ErrorKind::PermissionDenied,
            ),
            (Stage::Method, vec![5], io::ErrorKind::Other),
            (Stage::Auth, vec![1, 1], io::ErrorKind::PermissionDenied),
            (Stage::Auth, vec![5, 0], io::ErrorKind::InvalidData),
            (Stage::Auth, vec![1], io::ErrorKind::Other),
            (Stage::Connect, vec![4, 0, 0, 1], io::ErrorKind::InvalidData),
            (Stage::Connect, vec![5, 0, 1, 1], io::ErrorKind::InvalidData),
            (Stage::Connect, vec![5, 0, 0, 2], io::ErrorKind::InvalidData),
            (Stage::Connect, vec![5, 9, 0, 1], io::ErrorKind::InvalidData),
            (
                Stage::Connect,
                vec![5, 0, 0, 3, 0],
                io::ErrorKind::InvalidData,
            ),
            (Stage::Connect, vec![5, 0], io::ErrorKind::Other),
            (Stage::Connect, vec![5, 0, 0, 1, 127], io::ErrorKind::Other),
            (Stage::Connect, vec![5, 0, 0, 4, 0], io::ErrorKind::Other),
            (Stage::Address, vec![b'x'], io::ErrorKind::Other),
        ];
        for code in 1..=8 {
            cases.push((
                Stage::Connect,
                vec![5, code, 0, 1],
                if code == 2 {
                    io::ErrorKind::PermissionDenied
                } else {
                    io::ErrorKind::ConnectionRefused
                },
            ));
        }
        let destination = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let target = Authority::parse(&destination.local_addr().unwrap().to_string()).unwrap();
        for (stage, response, expected_kind) in cases {
            let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
            let endpoint = listener.local_addr().unwrap().to_string();
            let port = target.port();
            let peer = tokio::spawn(within(async move {
                let (mut stream, _) = listener.accept().await.unwrap();
                reach_stage(&mut stream, stage, port).await;
                stream.write_all(&response).await.unwrap();
                stream.shutdown().await.unwrap();
                closed(&mut stream).await;
                listener
            }));
            let route = NativeForwardRoute::socks5(&endpoint, auth()).unwrap();
            let error = failure(route.dial(target.clone()).await);
            assert_eq!(error.kind(), expected_kind);
            sanitized(&error);
            let listener = peer.await.unwrap();
            assert!(
                tokio::time::timeout(Duration::from_millis(10), listener.accept())
                    .await
                    .is_err()
            );
        }
        assert!(
            tokio::time::timeout(Duration::from_millis(30), destination.accept())
                .await
                .is_err()
        );
    })
    .await;
}

#[tokio::test]
async fn no_auth_does_not_accept_unsolicited_authentication() {
    within(async {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let endpoint = listener.local_addr().unwrap().to_string();
        let peer = tokio::spawn(within(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            assert_eq!(bytes(&mut stream, 3).await, [5, 1, 0]);
            stream.write_all(&[5, 2]).await.unwrap();
            closed(&mut stream).await;
        }));
        let error = failure(
            NativeForwardRoute::socks5(&endpoint, Socks5Auth::no_auth())
                .unwrap()
                .dial(target())
                .await,
        );
        assert_eq!(error.kind(), io::ErrorKind::InvalidData);
        sanitized(&error);
        peer.await.unwrap();
    })
    .await;
}

#[tokio::test]
async fn unreachable_proxy_does_not_connect_to_reachable_destination() {
    within(async {
        let destination = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let proxy = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let endpoint = proxy.local_addr().unwrap().to_string();
        drop(proxy);
        let route = NativeForwardRoute::socks5(&endpoint, auth()).unwrap();
        let error = failure(
            route
                .dial(Authority::parse(&destination.local_addr().unwrap().to_string()).unwrap())
                .await,
        );
        assert_eq!(error.to_string(), "SOCKS5 proxy transport failed");
        sanitized(&error);
        assert!(
            tokio::time::timeout(Duration::from_millis(30), destination.accept())
                .await
                .is_err()
        );
    })
    .await;
}

fn partial_reply(stage: Stage) -> &'static [u8] {
    match stage {
        Stage::Method => &[5],
        Stage::Auth => &[1],
        Stage::Connect => &[5, 0],
        Stage::Address => &[b'x'],
    }
}

#[tokio::test]
async fn dropping_pending_dial_closes_every_partial_handshake() {
    within(async {
        for stage in [Stage::Method, Stage::Auth, Stage::Connect, Stage::Address] {
            let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
            let endpoint = listener.local_addr().unwrap().to_string();
            let (ready_tx, ready_rx) = oneshot::channel();
            let peer = tokio::spawn(within(async move {
                let (mut stream, _) = listener.accept().await.unwrap();
                reach_stage(&mut stream, stage, 443).await;
                stream.write_all(partial_reply(stage)).await.unwrap();
                ready_tx.send(()).unwrap();
                closed(&mut stream).await;
                listener
            }));
            let route = NativeForwardRoute::socks5(&endpoint, auth()).unwrap();
            let mut pending = route.dial(target());
            tokio::select! {
                _ = &mut pending => panic!("partial handshake completed"),
                ready = ready_rx => ready.unwrap(),
            }
            drop(pending);
            let listener = peer.await.unwrap();
            assert!(
                tokio::time::timeout(Duration::from_millis(10), listener.accept())
                    .await
                    .is_err()
            );
        }
    })
    .await;
}

#[tokio::test]
async fn deadline_closes_every_partial_handshake() {
    within(async {
        for stage in [Stage::Method, Stage::Auth, Stage::Connect, Stage::Address] {
            let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
            let endpoint = listener.local_addr().unwrap().to_string();
            let peer = tokio::spawn(within(async move {
                let (mut stream, _) = listener.accept().await.unwrap();
                reach_stage(&mut stream, stage, 443).await;
                stream.write_all(partial_reply(stage)).await.unwrap();
                closed(&mut stream).await;
            }));
            let route = NativeForwardRoute::socks5_with_timeout(
                &endpoint,
                auth(),
                Duration::from_millis(300),
            )
            .unwrap();
            let error = failure(route.dial(target()).await);
            assert_eq!(error.kind(), io::ErrorKind::TimedOut);
            assert_eq!(error.to_string(), "SOCKS5 route deadline exceeded");
            sanitized(&error);
            peer.await.unwrap();
        }
    })
    .await;
}

struct DropFlag(Arc<AtomicBool>);

impl Drop for DropFlag {
    fn drop(&mut self) {
        self.0.store(true, Ordering::SeqCst);
    }
}

#[tokio::test]
async fn pending_proxy_open_is_dropped_on_cancellation_and_deadline() {
    within(async {
        let route =
            Socks5Route::new("proxy.invalid:1080", auth(), Duration::from_millis(50)).unwrap();
        for cancel in [true, false] {
            let dropped = Arc::new(AtomicBool::new(false));
            let guard = DropFlag(dropped.clone());
            let (ready_tx, ready_rx) = oneshot::channel();
            let open = async move {
                let _guard = guard;
                ready_tx.send(()).unwrap();
                std::future::pending::<io::Result<BoxedStream>>().await
            };
            let mut pending = Box::pin(route.connect_with(target(), open));
            tokio::select! {
                _ = &mut pending => panic!("pending opener completed"),
                ready = ready_rx => ready.unwrap(),
            }
            if cancel {
                drop(pending);
            } else {
                assert_eq!(failure(pending.await).kind(), io::ErrorKind::TimedOut);
            }
            assert!(dropped.load(Ordering::SeqCst));
        }
        let error = failure(
            route
                .connect_with(target(), async {
                    Err(io::Error::other("peer-secret resolution failure"))
                })
                .await,
        );
        assert_eq!(error.to_string(), "SOCKS5 proxy transport failed");
        sanitized(&error);
    })
    .await;
}

#[tokio::test]
async fn trickled_reply_does_not_renew_the_absolute_deadline() {
    within(async {
        let (client, mut peer) = tokio::io::duplex(1024);
        let route = Socks5Route::new(
            "proxy.invalid:1080",
            Socks5Auth::no_auth(),
            Duration::from_millis(250),
        )
        .unwrap();
        let server = tokio::spawn(within(async move {
            authenticate(&mut peer, None).await;
            assert_eq!(
                connect_request(&mut peer).await,
                domain_request("browser-origin.invalid", 443)
            );
            for byte in reply(4) {
                if peer.write_u8(byte).await.is_err() {
                    return;
                }
                tokio::time::sleep(Duration::from_millis(30)).await;
            }
        }));
        let error = failure(
            route
                .connect_with(target(), async {
                    // The same budget also covers opening the proxy socket.
                    tokio::time::sleep(Duration::from_millis(50)).await;
                    Ok(Box::new(client) as BoxedStream)
                })
                .await,
        );
        assert_eq!(error.kind(), io::ErrorKind::TimedOut);
        server.await.unwrap();
    })
    .await;
}

#[tokio::test]
async fn tls_identity_and_site_credentials_survive_private_and_socks_hops() {
    within(async {
        let cert = rcgen::generate_simple_self_signed(vec!["browser-origin.invalid".into()]).unwrap();
        let der = cert.serialize_der().unwrap();
        let config = rustls::ServerConfig::builder_with_provider(Arc::new(
            rustls::crypto::aws_lc_rs::default_provider(),
        ))
        .with_safe_default_protocol_versions().unwrap()
        .with_no_client_auth()
        .with_single_cert(
            vec![rustls::pki_types::CertificateDer::from(der.clone())],
            rustls::pki_types::PrivatePkcs8KeyDer::from(cert.serialize_private_key_der()).into(),
        ).unwrap();
        let acceptor = tokio_rustls::TlsAcceptor::from(Arc::new(config));
        let upstream = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let route = NativeForwardRoute::socks5(&upstream.local_addr().unwrap().to_string(), auth()).unwrap();
        let mut relay = PrivateForwardProxy::start(
            Arc::new(route), exact_authority_grant(target()), ProxyLimits::default(),
        ).await.unwrap();
        let relay_password = relay.with_credentials(|_, pass| pass.to_owned()).unwrap();
        let server = tokio::spawn(within(async move {
            let (mut stream, _) = upstream.accept().await.unwrap();
            authenticate(&mut stream, Some((USER, PASSWORD))).await;
            assert_eq!(connect_request(&mut stream).await, domain_request("browser-origin.invalid", 443));
            stream.write_all(&reply(3)).await.unwrap();
            let mut tls = acceptor.accept(stream).await.unwrap();
            assert_eq!(tls.get_ref().1.server_name(), Some("browser-origin.invalid"));
            let mut head = Vec::new();
            while !head.ends_with(b"\r\n\r\n") {
                head.push(tls.read_u8().await.unwrap());
                assert!(head.len() < 8192);
            }
            let head = String::from_utf8(head).unwrap();
            for secret in [USER, PASSWORD, relay_password.as_str(), "sorng-private-proxy"] {
                assert!(!head.contains(secret));
            }
            let head = head.to_ascii_lowercase();
            assert!(head.starts_with("get /login?fixture=opaque%2bvalue http/1.1\r\n"));
            assert!(head.contains("\r\nhost: browser-origin.invalid\r\n"));
            assert!(head.contains("\r\nuser-agent: fixture-native-browser\r\n"));
            assert!(head.contains("\r\ncookie: site-session=fixture\r\n"));
            assert!(head.contains("\r\nauthorization: bearer site-only-fixture\r\n"));
            assert!(!head.contains("proxy-authorization"));
            tls.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 7\r\nSet-Cookie: site-session=updated; Secure; HttpOnly\r\nConnection: close\r\n\r\nunmixed").await.unwrap();
            tls.shutdown().await.unwrap();
        }));
        let proxy = relay.with_credentials(|user, pass| {
            reqwest::Proxy::all(format!("http://{}", relay.local_addr())).unwrap().basic_auth(user, pass)
        }).unwrap();
        let client = reqwest::Client::builder().no_proxy().proxy(proxy)
            .add_root_certificate(reqwest::Certificate::from_der(&der).unwrap())
            .timeout(TEST_DEADLINE).build().unwrap();
        let response = client.get("https://browser-origin.invalid/login?fixture=opaque%2Bvalue")
            .header("User-Agent", "fixture-native-browser")
            .header("Cookie", "site-session=fixture")
            .header("Authorization", "Bearer site-only-fixture")
            .send().await.unwrap();
        assert_eq!(response.status(), 200);
        assert_eq!(response.url().origin().ascii_serialization(), "https://browser-origin.invalid");
        assert_eq!(response.headers()["set-cookie"], "site-session=updated; Secure; HttpOnly");
        assert_eq!(response.text().await.unwrap(), "unmixed");
        server.await.unwrap();
        relay.stop().await.unwrap();
    }).await;
}
