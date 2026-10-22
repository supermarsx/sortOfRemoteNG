use super::*;

fn collect(decoder: &mut CapsuleDecoder, mut input: &[u8]) -> Vec<Vec<u8>> {
    let mut output = Vec::new();
    while !input.is_empty() {
        let result = decoder.decode(input).unwrap();
        assert!(result.consumed > 0);
        input = &input[result.consumed..];
        if let Some(datagram) = result.datagram {
            output.push(datagram);
        }
    }
    output
}

#[test]
fn arbitrary_fragmentation_and_coalescing_preserve_all_datagram_boundaries() {
    let expected = vec![
        Vec::new(),
        b"first".to_vec(),
        vec![0xab; 64],
        vec![0x5c; 16_384],
    ];
    let encoded: Vec<_> = expected
        .iter()
        .flat_map(|p| encode_datagram(p, 20_000).unwrap())
        .collect();
    for chunk_size in [1, 2, 3, 7, 63, 1024, encoded.len()] {
        let mut decoder = CapsuleDecoder::new(20_000).unwrap();
        let actual: Vec<_> = encoded
            .chunks(chunk_size)
            .flat_map(|chunk| collect(&mut decoder, chunk))
            .collect();
        assert_eq!(actual, expected);
        assert_eq!(decoder.finish(), Ok(()));
    }
}

#[test]
fn nonminimal_integers_are_valid_and_unknown_types_and_contexts_are_ignored() {
    let mut encoded = vec![0x17, 3, 1, 2, 3, 0x17, 0]; // Unknown type, then empty unknown capsule.
    encoded.extend_from_slice(&[0, 3, 42, b'x', b'y']); // Unknown context, never delivered.
    encoded.extend_from_slice(&[0xc0, 0, 0, 0, 0, 0, 0, 0]); // Type0 encoded in8bytes.
    encoded.extend_from_slice(&[0xc0, 0, 0, 0, 0, 0, 0, 9]); // Length9 encoded in8bytes.
    encoded.extend_from_slice(&[0xc0, 0, 0, 0, 0, 0, 0, 0, b'z']); // Context0 encoded in8bytes.
    let mut decoder = CapsuleDecoder::new(16).unwrap();
    let actual: Vec<_> = encoded
        .chunks(2)
        .flat_map(|c| collect(&mut decoder, c))
        .collect();
    assert_eq!(actual, [b"z".to_vec()]);
    assert_eq!(decoder.finish(), Ok(()));
}

#[test]
fn every_truncated_header_context_and_payload_fails_at_eof_and_stays_closed() {
    let encoded = encode_datagram(b"payload", 32).unwrap();
    for end in 1..encoded.len() {
        let mut decoder = CapsuleDecoder::new(32).unwrap();
        assert!(collect(&mut decoder, &encoded[..end]).is_empty());
        assert_eq!(decoder.finish(), Err(CapsuleError::Malformed));
        assert!(matches!(
            decoder.decode(&encoded),
            Err(CapsuleError::Closed)
        ));
    }
    for bytes in [&[0x40][..], &[0, 0x40][..], &[0, 1, 0x40][..], &[0, 0][..]] {
        let mut decoder = CapsuleDecoder::new(32).unwrap();
        let result = decoder.decode(bytes);
        if result.is_ok() {
            assert_eq!(decoder.finish(), Err(CapsuleError::Malformed));
        } else {
            assert!(matches!(result, Err(CapsuleError::Malformed)));
        }
    }
}

#[test]
fn advertised_lengths_and_payload_limits_fail_before_unbounded_allocation() {
    let mut decoder = CapsuleDecoder::new(8).unwrap();
    let mut huge = vec![0x17, 0xff];
    huge.extend_from_slice(&[0xff; 7]);
    assert!(matches!(decoder.decode(&huge), Err(CapsuleError::TooLarge)));
    assert!(matches!(decoder.decode(&[0]), Err(CapsuleError::Closed)));
    let mut decoder = CapsuleDecoder::new(8).unwrap();
    assert!(matches!(
        decoder.decode(&[0, 10, 0]),
        Err(CapsuleError::TooLarge)
    ));
    assert_eq!(
        encode_datagram(b"123456789", 8),
        Err(CapsuleError::TooLarge)
    );
    assert_eq!(encode_datagram(b"", 0), Err(CapsuleError::InvalidLimit));
    assert!(matches!(
        CapsuleDecoder::new(65_508),
        Err(CapsuleError::InvalidLimit)
    ));
    let maximum = vec![0x5e; 65_507];
    let encoded = encode_datagram(&maximum, 65_507).unwrap();
    let mut decoder = CapsuleDecoder::new(65_507).unwrap();
    assert_eq!(collect(&mut decoder, &encoded), [maximum]);
    assert_eq!(decoder.finish(), Ok(()));
}

#[tokio::test]
async fn fragmented_tcp_capsules_roundtrip_through_real_owner_bound_udp_flow() {
    use crate::private_datagram_proxy::{
        Authority, ConnectedUdpDatagram, DatagramLimits, DatagramOpenFuture, PrivateDatagramProxy,
        RouteDatagram, RouteDatagramDialer,
    };
    use std::{sync::Arc, time::Duration};
    use tokio::{
        io::{AsyncReadExt, AsyncWriteExt},
        net::{TcpListener, TcpStream, UdpSocket},
    };
    struct Dialer(std::net::SocketAddr);
    impl RouteDatagramDialer for Dialer {
        fn open(&self, _: Authority) -> DatagramOpenFuture {
            let peer = self.0;
            Box::pin(async move {
                let socket = UdpSocket::bind("127.0.0.1:0").await?;
                socket.connect(peer).await?;
                Ok(Arc::new(ConnectedUdpDatagram::new(socket)?) as Arc<dyn RouteDatagram>)
            })
        }
    }
    let outcome = tokio::time::timeout(Duration::from_secs(3), async {
        let udp = UdpSocket::bind("127.0.0.1:0").await.unwrap();
        let peer = udp.local_addr().unwrap();
        let expected = vec![
            Vec::new(),
            b"first".to_vec(),
            b"second separate datagram".to_vec(),
        ];
        let echo = tokio::spawn(async move {
            let mut bytes = [0; 128];
            for _ in 0..3 {
                let (n, client) = udp.recv_from(&mut bytes).await.unwrap();
                udp.send_to(&bytes[..n], client).await.unwrap();
            }
        });
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (mut tcp, _) = listener.accept().await.unwrap();
            let proxy = PrivateDatagramProxy::new(
                Arc::new(|| true),
                Arc::new(|a| a.host() == "fixture.test" && a.port() == 443),
                Arc::new(Dialer(peer)),
                DatagramLimits::default(),
            )
            .unwrap();
            let flow = proxy
                .open(Authority::parse("fixture.test:443").unwrap())
                .await
                .unwrap();
            let mut decoder = CapsuleDecoder::new(128).unwrap();
            let mut input = [0; 7];
            let mut delivered = 0;
            while delivered < 3 {
                let n = tcp.read(&mut input).await.unwrap();
                assert!(n > 0);
                for payload in collect(&mut decoder, &input[..n]) {
                    flow.send(&payload).await.unwrap();
                    let reply = flow.recv().await.unwrap();
                    tcp.write_all(&encode_datagram(&reply, 128).unwrap())
                        .await
                        .unwrap();
                    delivered += 1;
                }
            }
            decoder.finish().unwrap();
        });
        let mut client = TcpStream::connect(address).await.unwrap();
        let encoded: Vec<_> = expected
            .iter()
            .flat_map(|p| encode_datagram(p, 128).unwrap())
            .collect();
        for bytes in encoded.chunks(2) {
            client.write_all(bytes).await.unwrap();
        }
        let mut decoder = CapsuleDecoder::new(128).unwrap();
        let mut actual = Vec::new();
        let mut input = [0; 11];
        loop {
            let n = client.read(&mut input).await.unwrap();
            if n == 0 {
                break;
            }
            actual.extend(collect(&mut decoder, &input[..n]));
        }
        decoder.finish().unwrap();
        assert_eq!(actual, expected);
        server.await.unwrap();
        echo.await.unwrap();
    })
    .await;
    assert!(
        outcome.is_ok(),
        "local capsule/UDP bridge exceeded its test budget"
    );
}
