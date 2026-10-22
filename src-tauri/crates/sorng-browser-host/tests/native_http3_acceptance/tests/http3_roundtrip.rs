use bytes::{Buf, Bytes};
use sorng_cef_http3_acceptance::{server::FixtureServer, Result};
use std::{
    sync::{atomic::Ordering, Arc},
    time::{Duration, Instant},
};
use tokio::{task::JoinSet, time::timeout};

fn client_endpoint(
    certificate: Option<rustls::pki_types::CertificateDer<'static>>,
) -> Result<quinn::Endpoint> {
    let mut roots = rustls::RootCertStore::empty();
    if let Some(certificate) = certificate {
        roots.add(certificate)?;
    }
    let mut tls = rustls::ClientConfig::builder_with_provider(Arc::new(
        rustls::crypto::ring::default_provider(),
    ))
    .with_protocol_versions(&[&rustls::version::TLS13])?
    .with_root_certificates(roots)
    .with_no_client_auth();
    tls.alpn_protocols = vec![b"h3".to_vec()];
    tls.enable_early_data = false;
    tls.resumption = rustls::client::Resumption::disabled();
    let config = quinn::ClientConfig::new(Arc::new(
        quinn::crypto::rustls::QuicClientConfig::try_from(tls)?,
    ));
    let mut endpoint = quinn::Endpoint::client("127.0.0.1:0".parse()?)?;
    endpoint.set_default_client_config(config);
    Ok(endpoint)
}

async fn request(
    mut sender: h3::client::SendRequest<h3_quinn::OpenStreams, Bytes>,
    port: u16,
    index: usize,
) -> Result<Vec<u8>> {
    let request = http::Request::get(format!("https://localhost:{port}/asset/{index}")).body(())?;
    let mut stream = sender.send_request(request).await?;
    stream.finish().await?;
    let response = stream.recv_response().await?;
    assert_eq!(response.status(), 200);
    let mut body = Vec::new();
    while let Some(mut data) = stream.recv_data().await? {
        if body.len() + data.remaining() > 4096 {
            return Err("Fixture body exceeds bound".into());
        }
        body.extend_from_slice(&data.copy_to_bytes(data.remaining()));
    }
    Ok(body)
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn verified_h3_multiplexes_32_requests_on_one_owned_loopback_connection() -> Result<()> {
    timeout(Duration::from_secs(15), async {
        let mut server = FixtureServer::start(Duration::from_millis(80)).await?;
        let endpoint = client_endpoint(Some(server.certificate.clone()))?;
        let connection = endpoint.connect(server.address, "localhost")?.await?;
        let protocol = connection
            .handshake_data()
            .unwrap()
            .downcast::<quinn::crypto::rustls::HandshakeData>()
            .unwrap()
            .protocol;
        assert_eq!(protocol.as_deref(), Some(b"h3".as_slice()));
        let (mut driver, sender) =
            h3::client::new(h3_quinn::Connection::new(connection.clone())).await?;
        let driver = tokio::spawn(async move { driver.wait_idle().await });
        let start = Instant::now();
        let mut requests = JoinSet::new();
        for index in 0..32 {
            let sender = sender.clone();
            let port = server.address.port();
            requests.spawn(async move {
                Ok::<_, Box<dyn std::error::Error + Send + Sync>>((
                    index,
                    request(sender, port, index).await?,
                ))
            });
        }
        while let Some(result) = requests.join_next().await {
            let (index, body) = result??;
            assert_eq!(body, format!("owned-h3:/asset/{index}").as_bytes());
        }
        assert_eq!(server.observed.connections.load(Ordering::SeqCst), 1);
        assert_eq!(server.observed.h3_connections.load(Ordering::SeqCst), 1);
        assert_eq!(server.observed.requests.load(Ordering::SeqCst), 32);
        assert_eq!(server.observed.completed.load(Ordering::SeqCst), 32);
        let peak = server.observed.peak.load(Ordering::SeqCst);
        assert!(
            peak > 1,
            "server must observe overlapping HTTP/3 request streams"
        );
        println!(
            "native-http3-origin-only requests=32 connections=1 peak={peak} elapsed_ms={}",
            start.elapsed().as_millis()
        );
        connection.close(0u32.into(), b"fixture complete");
        endpoint.close(0u32.into(), b"fixture complete");
        timeout(Duration::from_secs(3), endpoint.wait_idle()).await?;
        driver.abort();
        let _ = driver.await;
        server.shutdown().await?;
        assert_eq!(server.observed.active.load(Ordering::SeqCst), 0);
        Ok::<(), Box<dyn std::error::Error + Send + Sync>>(())
    })
    .await?
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn untrusted_fixture_certificate_prevents_all_http3_requests() -> Result<()> {
    let mut server = FixtureServer::start(Duration::ZERO).await?;
    let endpoint = client_endpoint(None)?;
    let result = timeout(
        Duration::from_secs(3),
        endpoint.connect(server.address, "localhost")?,
    )
    .await?;
    let Err(quinn::ConnectionError::TransportError(error)) = result else {
        panic!("Expected the fixture's untrusted certificate to fail the TLS handshake");
    };
    // TLS unknown_ca (48), not an arbitrary network failure.
    assert_eq!(error.code, quinn::TransportErrorCode::crypto(48));
    assert_eq!(server.observed.requests.load(Ordering::SeqCst), 0);
    endpoint.close(0u32.into(), b"fixture complete");
    timeout(Duration::from_secs(3), endpoint.wait_idle()).await?;
    server.shutdown().await?;
    Ok(())
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn delayed_response_is_bounded_and_shutdown_clears_pending_streams() -> Result<()> {
    let mut server = FixtureServer::start_held().await?;
    let endpoint = client_endpoint(Some(server.certificate.clone()))?;
    let connection = timeout(
        Duration::from_secs(3),
        endpoint.connect(server.address, "localhost")?,
    )
    .await??;
    let (mut driver, sender) =
        h3::client::new(h3_quinn::Connection::new(connection.clone())).await?;
    let driver = tokio::spawn(async move { driver.wait_idle().await });
    let mut pending = tokio::spawn(request(sender, server.address.port(), 0));
    server.wait_for_requests(1).await?;
    assert!(timeout(Duration::from_millis(100), &mut pending)
        .await
        .is_err());
    pending.abort();
    let _ = pending.await;
    assert_eq!(server.observed.requests.load(Ordering::SeqCst), 1);
    assert_eq!(server.observed.completed.load(Ordering::SeqCst), 0);
    connection.close(0u32.into(), b"fixture deadline");
    endpoint.close(0u32.into(), b"fixture deadline");
    timeout(Duration::from_secs(3), endpoint.wait_idle()).await?;
    driver.abort();
    let _ = driver.await;
    server.shutdown().await?;
    assert_eq!(server.observed.active.load(Ordering::SeqCst), 0);
    Ok(())
}
