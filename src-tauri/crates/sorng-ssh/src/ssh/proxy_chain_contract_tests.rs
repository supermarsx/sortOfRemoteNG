//! Synthetic wire contracts only. Every TCP connection is confined to loopback.
use super::*;
use tokio::net::TcpListener as TokioTcpListener;

fn target_config(host: &str, port: u16) -> SshConnectionConfig {
    serde_json::from_value(serde_json::json!({
        "host": host, "port": port, "username": "fixture",
        "jump_hosts": [], "strict_host_key_checking": true, "connect_timeout": 2
    }))
    .unwrap()
}

fn proxy(kind: ProxyType, host: &str, port: u16, account: &str) -> ProxyConfig {
    ProxyConfig {
        proxy_type: kind,
        host: host.into(),
        port,
        username: Some(account.into()),
        password: Some(SecretString::from(format!("{account}-password"))),
    }
}

async fn socks5_peer(
    stream: &mut AsyncTcpStream,
    account: &str,
    expected_host: &str,
    expected_port: u16,
    reply: &[u8],
) {
    let mut prefix = [0; 2];
    stream.read_exact(&mut prefix).await.unwrap();
    assert_eq!(prefix[0], 5);
    let mut methods = vec![0; usize::from(prefix[1])];
    stream.read_exact(&mut methods).await.unwrap();
    assert!(methods.contains(&2), "this hop must offer its credentials");
    stream.write_all(&[5, 2]).await.unwrap();
    stream.read_exact(&mut prefix).await.unwrap();
    assert_eq!(prefix[0], 1);
    let mut username = vec![0; usize::from(prefix[1])];
    stream.read_exact(&mut username).await.unwrap();
    assert_eq!(
        username,
        account.as_bytes(),
        "credentials belong to this hop"
    );
    let length = stream.read_u8().await.unwrap();
    let mut password = vec![0; usize::from(length)];
    stream.read_exact(&mut password).await.unwrap();
    assert_eq!(password, format!("{account}-password").as_bytes());
    stream.write_all(&[1, 0]).await.unwrap();
    let mut request = [0; 4];
    stream.read_exact(&mut request).await.unwrap();
    assert_eq!(&request[..3], &[5, 1, 0]);
    let host = match request[3] {
        1 => {
            let mut ip = [0; 4];
            stream.read_exact(&mut ip).await.unwrap();
            std::net::Ipv4Addr::from(ip).to_string()
        }
        4 => {
            let mut ip = [0; 16];
            stream.read_exact(&mut ip).await.unwrap();
            std::net::Ipv6Addr::from(ip).to_string()
        }
        3 => {
            let length = stream.read_u8().await.unwrap();
            let mut host = vec![0; usize::from(length)];
            stream.read_exact(&mut host).await.unwrap();
            String::from_utf8(host).unwrap()
        }
        value => panic!("unexpected SOCKS address type {value}"),
    };
    let port = stream.read_u16().await.unwrap();
    assert_eq!(host, expected_host, "each proxy must address the NEXT hop");
    assert_eq!(port, expected_port);
    stream.write_all(reply).await.unwrap();
}

async fn http_peer(stream: &mut AsyncTcpStream, account: &str, target: &str, suffix: &[u8]) {
    let mut header = Vec::new();
    while !header.ends_with(b"\r\n\r\n") {
        assert!(header.len() < 4096);
        header.push(stream.read_u8().await.unwrap());
    }
    let header = String::from_utf8(header).unwrap();
    assert!(header.starts_with(&format!("CONNECT {target} HTTP/1.1\r\n")));
    let auth = data_encoding::BASE64.encode(format!("{account}:{account}-password").as_bytes());
    assert!(header.contains(&format!("Proxy-Authorization: Basic {auth}\r\n")));
    let mut response = b"HTTP/1.1 200 Connection Established\r\n\r\n".to_vec();
    response.extend_from_slice(suffix);
    stream.write_all(&response).await.unwrap();
}

async fn run_chain(
    config: &SshConnectionConfig,
    proxies: Vec<ProxyConfig>,
) -> Result<TcpStream, String> {
    let state = SshService::new();
    let service = state.lock().await;
    service
        .establish_proxy_chain_connection(
            config,
            &ProxyChainConfig {
                proxies,
                mode: ProxyChainMode::Strict,
                hop_timeout_ms: 1000,
            },
        )
        .await
}

fn assert_payload(mut stream: TcpStream) {
    stream
        .set_read_timeout(Some(Duration::from_secs(1)))
        .unwrap();
    let mut payload = [0; 8];
    std::io::Read::read_exact(&mut stream, &mut payload).unwrap();
    assert_eq!(&payload, b"SSH-WIRE");
}

#[tokio::test]
async fn strict_proxy_two_hops_negotiate_next_peer_with_each_peers_credentials() {
    let listener = TokioTcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let peer = tokio::spawn(async move {
        let (mut stream, _) = listener.accept().await.unwrap();
        socks5_peer(
            &mut stream,
            "first",
            "second.invalid",
            12002,
            &[5, 0, 0, 1, 127, 0, 0, 1, 0, 0],
        )
        .await;
        socks5_peer(
            &mut stream,
            "second",
            "final.invalid",
            2222,
            &[5, 0, 0, 1, 127, 0, 0, 1, 0, 0],
        )
        .await;
        stream.write_all(b"SSH-WIRE").await.unwrap();
    });
    let result = run_chain(
        &target_config("final.invalid", 2222),
        vec![
            proxy(ProxyType::Socks5, "127.0.0.1", port, "first"),
            proxy(ProxyType::Socks5, "second.invalid", 12002, "second"),
        ],
    )
    .await;
    peer.await.unwrap();
    assert_payload(result.unwrap());
}

#[tokio::test]
async fn strict_proxy_three_hops_consume_variable_socks_replies_and_ipv6_target() {
    let listener = TokioTcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let peer = tokio::spawn(async move {
        let (mut stream, _) = listener.accept().await.unwrap();
        let mut domain_reply = vec![5, 0, 0, 3, 11];
        domain_reply.extend_from_slice(b"bound.local");
        domain_reply.extend_from_slice(&0u16.to_be_bytes());
        socks5_peer(&mut stream, "first", "second.invalid", 12002, &domain_reply).await;
        let mut ipv6_reply = vec![5, 0, 0, 4];
        ipv6_reply.extend_from_slice(&std::net::Ipv6Addr::LOCALHOST.octets());
        ipv6_reply.extend_from_slice(&0u16.to_be_bytes());
        socks5_peer(&mut stream, "second", "third.invalid", 12003, &ipv6_reply).await;
        socks5_peer(
            &mut stream,
            "third",
            "2001:db8::7",
            2222,
            &[5, 0, 0, 1, 127, 0, 0, 1, 0, 0],
        )
        .await;
        stream.write_all(b"SSH-WIRE").await.unwrap();
    });
    let result = run_chain(
        &target_config("2001:db8::7", 2222),
        vec![
            proxy(ProxyType::Socks5, "127.0.0.1", port, "first"),
            proxy(ProxyType::Socks5, "second.invalid", 12002, "second"),
            proxy(ProxyType::Socks5, "third.invalid", 12003, "third"),
        ],
    )
    .await;
    peer.await.unwrap();
    assert_payload(result.unwrap());
}

#[tokio::test]
async fn strict_proxy_dispatches_http_and_preserves_coalesced_tunnel_payload() {
    let listener = TokioTcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let peer = tokio::spawn(async move {
        let (mut stream, _) = listener.accept().await.unwrap();
        socks5_peer(
            &mut stream,
            "first",
            "second.invalid",
            12002,
            &[5, 0, 0, 1, 127, 0, 0, 1, 0, 0],
        )
        .await;
        http_peer(&mut stream, "second", "final.invalid:2222", b"SSH-WIRE").await;
    });
    let result = run_chain(
        &target_config("final.invalid", 2222),
        vec![
            proxy(ProxyType::Socks5, "127.0.0.1", port, "first"),
            proxy(ProxyType::Http, "second.invalid", 12002, "second"),
        ],
    )
    .await;
    peer.await.unwrap();
    assert_payload(result.unwrap());
}

#[tokio::test]
async fn strict_proxy_dispatches_http_first_and_socks4_last() {
    let listener = TokioTcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let peer = tokio::spawn(async move {
        let (mut stream, _) = listener.accept().await.unwrap();
        http_peer(&mut stream, "first", "second.invalid:12002", b"").await;
        let mut request = [0; 8];
        stream.read_exact(&mut request).await.unwrap();
        assert_eq!(&request[..2], &[4, 1]);
        assert_eq!(u16::from_be_bytes([request[2], request[3]]), 2222);
        assert_eq!(&request[4..], &[192, 0, 2, 99]);
        let mut account = Vec::new();
        loop {
            let byte = stream.read_u8().await.unwrap();
            if byte == 0 {
                break;
            }
            assert!(account.len() < 256);
            account.push(byte);
        }
        assert_eq!(account, b"second");
        let mut response = vec![0, 0x5a, 0, 0, 127, 0, 0, 1];
        response.extend_from_slice(b"SSH-WIRE");
        stream.write_all(&response).await.unwrap();
    });
    let result = run_chain(
        &target_config("192.0.2.99", 2222),
        vec![
            proxy(ProxyType::Http, "127.0.0.1", port, "first"),
            proxy(ProxyType::Socks4, "second.invalid", 12002, "second"),
        ],
    )
    .await;
    peer.await.unwrap();
    assert_payload(result.unwrap());
}

#[tokio::test]
async fn strict_proxy_https_is_rejected_before_any_plaintext_connection() {
    for https_index in 0..2 {
        let listener = TokioTcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let mut proxies = vec![
            proxy(ProxyType::Socks5, "127.0.0.1", port, "first"),
            proxy(ProxyType::Socks5, "second.invalid", 12002, "second"),
        ];
        proxies[https_index].proxy_type = ProxyType::Https;
        assert!(run_chain(&target_config("final.invalid", 2222), proxies)
            .await
            .is_err());
        assert!(
            tokio::time::timeout(Duration::from_millis(20), listener.accept())
                .await
                .is_err(),
            "unsupported HTTPS must fail before opening even the first hop"
        );
    }
}

#[tokio::test]
async fn socks5_rejects_malformed_or_refused_connect_frames_without_leaking_credentials() {
    for reply in [
        vec![4, 0, 0, 1, 127, 0, 0, 1, 0, 0],
        vec![5, 0, 1, 1, 127, 0, 0, 1, 0, 0],
        vec![5, 0, 0, 2],
        vec![5, 0, 0, 3, 0],
        vec![5, 5, 0, 1, 127, 0, 0, 1, 0, 0],
        vec![5, 0, 0, 4, 0, 0],
    ] {
        let listener = TokioTcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let peer = tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            socks5_peer(&mut stream, "account", "final.invalid", 2222, &reply).await;
        });
        let stream = AsyncTcpStream::connect(address).await.unwrap();
        let state = SshService::new();
        let error = state
            .lock()
            .await
            .socks5_connect_internal(
                stream,
                "final.invalid:2222",
                &proxy(ProxyType::Socks5, "127.0.0.1", address.port(), "account"),
            )
            .await
            .unwrap_err();
        peer.await.unwrap();
        assert!(!error.contains("account"));
        assert!(!error.contains("password"));
    }
}

#[tokio::test]
async fn socks5_rejects_unoffered_methods_and_wrong_authentication_version() {
    for (method, auth_reply, configured_auth) in [
        (0xff, None, true),
        (2, Some([2, 0]), true),
        (2, Some([1, 1]), true),
        (2, None, false),
    ] {
        let listener = TokioTcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let peer = tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut header = [0; 2];
            stream.read_exact(&mut header).await.unwrap();
            let mut methods = vec![0; usize::from(header[1])];
            stream.read_exact(&mut methods).await.unwrap();
            stream.write_all(&[5, method]).await.unwrap();
            if let Some(reply) = auth_reply {
                stream.read_exact(&mut header).await.unwrap();
                let mut username = vec![0; usize::from(header[1])];
                stream.read_exact(&mut username).await.unwrap();
                let length = stream.read_u8().await.unwrap();
                let mut password = vec![0; usize::from(length)];
                stream.read_exact(&mut password).await.unwrap();
                stream.write_all(&reply).await.unwrap();
            }
            assert_eq!(
                stream.read(&mut [0]).await.unwrap(),
                0,
                "rejected auth must not send CONNECT"
            );
        });
        let state = SshService::new();
        let mut config = proxy(ProxyType::Socks5, "127.0.0.1", address.port(), "account");
        if !configured_auth {
            config.username = None;
            config.password = None;
        }
        let result = state
            .lock()
            .await
            .socks5_connect_internal(
                AsyncTcpStream::connect(address).await.unwrap(),
                "final.invalid:2222",
                &config,
            )
            .await;
        assert!(result.is_err());
        peer.await.unwrap();
    }
}

#[tokio::test]
async fn single_and_mixed_https_proxy_reject_before_dns_or_socket() {
    let listener = TokioTcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let state = SshService::new();
    let service = state.lock().await;
    let config = target_config("final.invalid", 2222);
    let https = proxy(ProxyType::Https, "127.0.0.1", port, "private-account");
    let control = SshEstablishmentControl::new_with_timeout(
        Duration::from_secs(2),
        Arc::new(PendingSshConnection::new()),
    )
    .unwrap();
    assert_eq!(
        service
            .establish_proxy_connection_with_control(
                &config,
                &https,
                &control,
                Duration::from_secs(1)
            )
            .await
            .unwrap_err(),
        HTTPS_SSH_PROXY_UNSUPPORTED
    );
    let result = service
        .establish_mixed_chain_connection(
            &config,
            &MixedChainConfig {
                hops: vec![
                    ChainHop::Proxy(proxy(ProxyType::Http, "127.0.0.1", port, "first")),
                    ChainHop::Proxy(https),
                ],
                hop_timeout_ms: 1000,
            },
        )
        .await;
    assert!(matches!(result, Err(ref error) if error == HTTPS_SSH_PROXY_UNSUPPORTED));
    assert!(
        tokio::time::timeout(Duration::from_millis(20), listener.accept())
            .await
            .is_err()
    );
}

#[tokio::test]
async fn socks5_invalid_target_and_oversized_credentials_send_no_greeting() {
    for (target, account) in [
        (format!("{}:22", "a".repeat(256)), "account".to_owned()),
        ("host\r\nInjected:22".into(), "account".into()),
        ("valid.invalid:22".into(), "a".repeat(256)),
    ] {
        let listener = TokioTcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let peer = tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            assert_eq!(stream.read(&mut [0]).await.unwrap(), 0);
        });
        let state = SshService::new();
        assert!(state
            .lock()
            .await
            .socks5_connect_internal(
                AsyncTcpStream::connect(address).await.unwrap(),
                &target,
                &proxy(ProxyType::Socks5, "127.0.0.1", address.port(), &account),
            )
            .await
            .is_err());
        peer.await.unwrap();
    }
}

#[tokio::test]
async fn strict_proxy_cancel_during_first_negotiation_closes_socket_without_next_hop() {
    let listener = TokioTcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let pending = Arc::new(PendingSshConnection::new());
    let cancellation = pending.clone();
    let peer = tokio::spawn(async move {
        let (mut stream, _) = listener.accept().await.unwrap();
        let mut greeting = [0; 4];
        stream.read_exact(&mut greeting).await.unwrap();
        cancellation.cancel();
        assert_eq!(stream.read(&mut [0]).await.unwrap(), 0);
    });
    let control =
        SshEstablishmentControl::new_with_timeout(Duration::from_secs(2), pending).unwrap();
    let state = SshService::new();
    let result = state
        .lock()
        .await
        .establish_strict_proxy_chain(
            &target_config("final.invalid", 2222),
            &ProxyChainConfig {
                proxies: vec![
                    proxy(ProxyType::Socks5, "127.0.0.1", address.port(), "first"),
                    proxy(ProxyType::Socks5, "next.invalid", 12002, "second"),
                ],
                mode: ProxyChainMode::Strict,
                hop_timeout_ms: 1000,
            },
            &control,
            Duration::from_secs(1),
        )
        .await;
    assert!(result.unwrap_err().contains("SSH connection cancelled"));
    peer.await.unwrap();
}
