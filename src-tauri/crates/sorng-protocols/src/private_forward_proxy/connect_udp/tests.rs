use super::*;
use crate::private_datagram_proxy::{
    capsule::encode_datagram, ConnectedUdpDatagram, DatagramOpenFuture, RouteDatagram,
    RouteDatagramDialer,
};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

struct UdpRoute {
    address: SocketAddr,
    opens: Arc<AtomicUsize>,
}
impl RouteDatagramDialer for UdpRoute {
    fn open(&self, _: Authority) -> DatagramOpenFuture {
        self.opens.fetch_add(1, Ordering::SeqCst);
        let address = self.address;
        Box::pin(async move {
            let socket = tokio::net::UdpSocket::bind("127.0.0.1:0").await?;
            socket.connect(address).await?;
            Ok(Arc::new(ConnectedUdpDatagram::new(socket)?) as Arc<dyn RouteDatagram>)
        })
    }
}
impl RouteDialer for UdpRoute {
    fn dial(&self, _: Authority) -> DialFuture {
        panic!("CONNECT-UDP must never fall through to TCP")
    }
    fn datagrams(&self) -> Option<Arc<dyn RouteDatagramDialer>> {
        Some(Arc::new(Self {
            address: self.address,
            opens: self.opens.clone(),
        }))
    }
}
fn authorization(proxy: &PrivateForwardProxy) -> String {
    proxy
        .with_credentials(|user, password| {
            format!(
                "Basic {}",
                base64::engine::general_purpose::STANDARD.encode(format!("{user}:{password}"))
            )
        })
        .unwrap()
}
fn request(proxy: &PrivateForwardProxy, path: &str, auth: &str) -> Vec<u8> {
    format!("GET {path} HTTP/1.1\r\nHost: {}\r\nProxy-Authorization: {auth}\r\nConnection: Upgrade\r\nUpgrade: connect-udp\r\nCapsule-Protocol: ?1\r\n\r\n", proxy.local_addr()).into_bytes()
}
const PATH: &str = "/.well-known/masque/udp/fixture.test/443/";
async fn head(stream: &mut TcpStream) -> String {
    tokio::time::timeout(Duration::from_secs(3), async {
        let mut bytes = Vec::new();
        while !bytes.ends_with(b"\r\n\r\n") {
            bytes.push(stream.read_u8().await.unwrap());
            assert!(bytes.len() < 4096);
        }
        String::from_utf8(bytes).unwrap()
    })
    .await
    .unwrap()
}
async fn exchange(proxy: &PrivateForwardProxy, bytes: &[u8]) -> String {
    let mut stream = TcpStream::connect(proxy.local_addr()).await.unwrap();
    stream.write_all(bytes).await.unwrap();
    head(&mut stream).await
}
async fn fixture(
    grant: DestinationGrant,
) -> (PrivateForwardProxy, tokio::net::UdpSocket, Arc<AtomicUsize>) {
    let udp = tokio::net::UdpSocket::bind("127.0.0.1:0").await.unwrap();
    let opens = Arc::new(AtomicUsize::new(0));
    let proxy = PrivateForwardProxy::start(
        Arc::new(UdpRoute {
            address: udp.local_addr().unwrap(),
            opens: opens.clone(),
        }),
        grant,
        ProxyLimits::default(),
    )
    .await
    .unwrap();
    (proxy, udp, opens)
}
async fn upgrade(proxy: &PrivateForwardProxy) -> TcpStream {
    let mut stream = TcpStream::connect(proxy.local_addr()).await.unwrap();
    stream
        .write_all(&request(proxy, PATH, &authorization(proxy)))
        .await
        .unwrap();
    let response = head(&mut stream).await;
    assert!(response.starts_with("HTTP/1.1 101 "));
    assert!(response.contains("Capsule-Protocol: ?1\r\n"));
    assert!(!response.contains("Content-Length"));
    stream
}
async fn assert_closed(stream: &mut TcpStream) {
    let result = tokio::time::timeout(Duration::from_secs(2), stream.read(&mut [0; 1]))
        .await
        .unwrap();
    assert!(matches!(result, Ok(0) | Err(_)));
}

#[test]
fn canonical_target_encoding_is_exact_including_ipv6() {
    for (path, expected) in [
        (PATH, "fixture.test:443"),
        ("/.well-known/masque/udp/127.0.0.1/443/", "127.0.0.1:443"),
        ("/.well-known/masque/udp/%3A%3A1/443/", "[::1]:443"),
    ] {
        assert_eq!(target(path).unwrap().to_string(), expected);
    }
    for host in [
        "Fixture.test",
        "%66ixture.test",
        "[::1]",
        "::1",
        "%3a%3a1",
        "%5B%3A%3A1%5D",
        "%3A%3A1%25zone",
        "user@fixture.test",
        "fixture.test/extra",
    ] {
        assert!(
            target(&format!("{PREFIX}{host}/443/")).is_err(),
            "accepted {host}"
        );
    }
    for suffix in [
        "fixture.test/0443/",
        "fixture.test/0/",
        "fixture.test/443/?query",
        "fixture.test/443/#fragment",
        "fixture.test/443//",
    ] {
        assert!(target(&format!("{PREFIX}{suffix}")).is_err());
    }
}

#[tokio::test]
async fn wrong_missing_and_other_session_auth_never_grant_or_open_udp() {
    let grants = Arc::new(AtomicUsize::new(0));
    let seen = grants.clone();
    let (mut a, _udp, opens) = fixture(Arc::new(move |_| {
        seen.fetch_add(1, Ordering::SeqCst);
        true
    }))
    .await;
    let (mut b, _, _) = fixture(Arc::new(|_| true)).await;
    assert!(a.supports_datagrams());
    for auth in [
        "Basic d3Jvbmc6d3Jvbmc=".to_owned(),
        authorization(&b),
        "".to_owned(),
    ] {
        let response = exchange(&a, &request(&a, PATH, &auth)).await;
        assert!(response.starts_with("HTTP/1.1 407 "));
        assert!(!response.contains(&authorization(&a)));
    }
    assert_eq!(grants.load(Ordering::SeqCst), 0);
    assert_eq!(opens.load(Ordering::SeqCst), 0);
    a.stop().await.unwrap();
    b.stop().await.unwrap();
    assert!(!a.supports_datagrams());
}

#[tokio::test]
async fn denied_target_and_tcp_only_routes_never_use_udp_or_tcp_fallback() {
    let (mut denied, _, opens) = fixture(Arc::new(|_| false)).await;
    assert!(
        exchange(&denied, &request(&denied, PATH, &authorization(&denied)))
            .await
            .starts_with("HTTP/1.1 403 ")
    );
    assert_eq!(opens.load(Ordering::SeqCst), 0);
    let tcp_calls = Arc::new(AtomicUsize::new(0));
    let seen = tcp_calls.clone();
    let tcp = Arc::new(move |_: Authority| -> DialFuture {
        seen.fetch_add(1, Ordering::SeqCst);
        Box::pin(async { Err(io::Error::other("forbidden")) })
    });
    let mut unsupported =
        PrivateForwardProxy::start(tcp, Arc::new(|_| true), ProxyLimits::default())
            .await
            .unwrap();
    assert!(!unsupported.supports_datagrams());
    assert!(exchange(
        &unsupported,
        &request(&unsupported, PATH, &authorization(&unsupported))
    )
    .await
    .starts_with("HTTP/1.1 503 "));
    assert_eq!(tcp_calls.load(Ordering::SeqCst), 0);
    denied.stop().await.unwrap();
    unsupported.stop().await.unwrap();
}

#[tokio::test]
async fn ambiguous_headers_origin_credentials_and_wrong_proxy_host_are_rejected() {
    let (mut proxy, _, opens) = fixture(Arc::new(|_| true)).await;
    let base = String::from_utf8(request(&proxy, PATH, &authorization(&proxy))).unwrap();
    for field in [
        "Authorization: secret",
        "Cookie: secret",
        "Content-Length: 0",
        "Transfer-Encoding: chunked",
        "Content-Type: application/octet-stream",
        "Host: 127.0.0.1:1",
        "Upgrade: connect-udp",
        "Capsule-Protocol: ?1",
        "Connection: Upgrade",
    ] {
        let bytes = base.replace("\r\n\r\n", &format!("\r\n{field}\r\n\r\n"));
        assert!(exchange(&proxy, bytes.as_bytes())
            .await
            .starts_with("HTTP/1.1 400 "));
    }
    for changed in [
        base.replace(
            &format!("Host: {}", proxy.local_addr()),
            "Host: 127.0.0.1:1",
        ),
        base.replace("Capsule-Protocol: ?1", "Capsule-Protocol: ?0"),
        base.replace("Connection: Upgrade", "Connection: Upgrade, keep-alive"),
        base.replace("Upgrade: connect-udp", "Upgrade: websocket"),
    ] {
        assert!(exchange(&proxy, changed.as_bytes())
            .await
            .starts_with("HTTP/1.1 400 "));
    }
    assert_eq!(opens.load(Ordering::SeqCst), 0);
    proxy.stop().await.unwrap();
}

#[tokio::test]
async fn same_endpoint_upgrade_roundtrips_fragmented_and_coalesced_udp_messages() {
    let (mut proxy, udp, opens) = fixture(exact_authority_grant(
        Authority::parse("fixture.test:443").unwrap(),
    ))
    .await;
    let mut stream = upgrade(&proxy).await;
    assert_eq!(opens.load(Ordering::SeqCst), 1);
    let mut wire = Vec::new();
    for payload in [b"one".as_slice(), b"".as_slice(), b"three".as_slice()] {
        wire.extend(encode_datagram(payload, PAYLOAD).unwrap());
    }
    for bytes in wire.chunks(2) {
        stream.write_all(bytes).await.unwrap();
    }
    let mut buffer = [0; 64];
    for expected in [b"one".as_slice(), b"".as_slice(), b"three".as_slice()] {
        let (n, client) = tokio::time::timeout(Duration::from_secs(2), udp.recv_from(&mut buffer))
            .await
            .unwrap()
            .unwrap();
        assert_eq!(&buffer[..n], expected);
        udp.send_to(expected, client).await.unwrap();
        let mut packet = vec![0; encode_datagram(expected, PAYLOAD).unwrap().len()];
        stream.read_exact(&mut packet).await.unwrap();
        assert_eq!(packet, encode_datagram(expected, PAYLOAD).unwrap());
    }
    proxy.stop().await.unwrap();
    assert_closed(&mut stream).await;
}

#[tokio::test]
async fn authenticated_early_capsules_never_send_before_complete_upgrade_admission() {
    let (mut proxy, udp, opens) = fixture(Arc::new(|_| true)).await;
    let mut stream = TcpStream::connect(proxy.local_addr()).await.unwrap();
    let request = request(&proxy, PATH, &authorization(&proxy));
    stream
        .write_all(&request[..request.len() - 2])
        .await
        .unwrap();
    assert!(
        tokio::time::timeout(Duration::from_millis(30), udp.readable())
            .await
            .is_err()
    );
    assert_eq!(opens.load(Ordering::SeqCst), 0);
    let mut tail = request[request.len() - 2..].to_vec();
    tail.extend(encode_datagram(b"early", PAYLOAD).unwrap());
    stream.write_all(&tail).await.unwrap();
    assert!(head(&mut stream).await.starts_with("HTTP/1.1 101 "));
    let mut buffer = [0; 32];
    let (n, _) = tokio::time::timeout(Duration::from_secs(2), udp.recv_from(&mut buffer))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(&buffer[..n], b"early");
    proxy.stop().await.unwrap();
}

#[tokio::test]
async fn revocation_and_destination_withdrawal_close_owned_flow_without_affecting_other_session() {
    let allowed = Arc::new(AtomicBool::new(true));
    let live = allowed.clone();
    let (mut a, _, _) = fixture(Arc::new(move |_| live.load(Ordering::SeqCst))).await;
    let (mut b, udp_b, _) = fixture(Arc::new(|_| true)).await;
    let mut stream_a = upgrade(&a).await;
    let mut stream_b = upgrade(&b).await;
    allowed.store(false, Ordering::SeqCst);
    assert_closed(&mut stream_a).await;
    stream_b
        .write_all(&encode_datagram(b"independent", PAYLOAD).unwrap())
        .await
        .unwrap();
    let mut bytes = [0; 32];
    let (n, _) = tokio::time::timeout(Duration::from_secs(2), udp_b.recv_from(&mut bytes))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(&bytes[..n], b"independent");
    b.revoke();
    assert_closed(&mut stream_b).await;
    a.stop().await.unwrap();
    b.stop().await.unwrap();
}

#[tokio::test]
async fn oversized_truncated_or_malformed_capsules_close_without_udp_send() {
    for wire in [
        vec![0, 0],
        vec![0, 2, 0],
        {
            let mut v = vec![0, 0xff];
            v.extend([0xff; 7]);
            v
        },
        encode_datagram(&vec![0; PAYLOAD + 1], PAYLOAD + 1).unwrap(),
    ] {
        let (mut proxy, udp, _) = fixture(Arc::new(|_| true)).await;
        let mut stream = upgrade(&proxy).await;
        stream.write_all(&wire).await.unwrap();
        stream.shutdown().await.unwrap();
        assert_closed(&mut stream).await;
        assert!(
            tokio::time::timeout(Duration::from_millis(20), udp.readable())
                .await
                .is_err()
        );
        proxy.stop().await.unwrap();
    }
}
