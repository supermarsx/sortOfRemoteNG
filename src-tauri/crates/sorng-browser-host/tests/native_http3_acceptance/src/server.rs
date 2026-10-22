use crate::Result;
use bytes::Bytes;
use rustls::pki_types::{CertificateDer, PrivatePkcs8KeyDer};
use std::{
    net::SocketAddr,
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    },
    time::Duration,
};
use tokio::{
    task::{JoinHandle, JoinSet},
    time::timeout,
};

#[derive(Default)]
pub struct Observations {
    pub connections: AtomicUsize,
    pub h3_connections: AtomicUsize,
    pub requests: AtomicUsize,
    pub active: AtomicUsize,
    pub peak: AtomicUsize,
    pub completed: AtomicUsize,
    request_started: tokio::sync::Notify,
}

struct ActiveRequest(Arc<Observations>);
impl ActiveRequest {
    fn new(observed: Arc<Observations>) -> Self {
        let active = observed.active.fetch_add(1, Ordering::SeqCst) + 1;
        observed.peak.fetch_max(active, Ordering::SeqCst);
        Self(observed)
    }
}
impl Drop for ActiveRequest {
    fn drop(&mut self) {
        self.0.active.fetch_sub(1, Ordering::SeqCst);
    }
}

pub struct FixtureServer {
    pub address: SocketAddr,
    pub certificate: CertificateDer<'static>,
    pub observed: Arc<Observations>,
    endpoint: quinn::Endpoint,
    task: Option<JoinHandle<Result<()>>>,
}

impl FixtureServer {
    pub async fn start(response_delay: Duration) -> Result<Self> {
        Self::start_with_delay(Some(response_delay)).await
    }

    pub async fn start_held() -> Result<Self> {
        Self::start_with_delay(None).await
    }

    async fn start_with_delay(response_delay: Option<Duration>) -> Result<Self> {
        let certificate = rcgen::generate_simple_self_signed(vec!["localhost".into()])?;
        let cert = CertificateDer::from(certificate.serialize_der()?);
        let key = PrivatePkcs8KeyDer::from(certificate.serialize_private_key_der());
        let mut tls = rustls::ServerConfig::builder_with_provider(Arc::new(
            rustls::crypto::ring::default_provider(),
        ))
        .with_protocol_versions(&[&rustls::version::TLS13])?
        .with_no_client_auth()
        .with_single_cert(vec![cert.clone()], key.into())?;
        tls.alpn_protocols = vec![b"h3".to_vec()];
        tls.max_early_data_size = 0;
        let mut config = quinn::ServerConfig::with_crypto(Arc::new(
            quinn::crypto::rustls::QuicServerConfig::try_from(tls)?,
        ));
        let mut transport = quinn::TransportConfig::default();
        transport.max_concurrent_bidi_streams(128u32.into());
        transport.max_idle_timeout(Some(Duration::from_secs(5).try_into()?));
        config.transport_config(Arc::new(transport));
        config.migration(false);
        let endpoint = quinn::Endpoint::server(config, "127.0.0.1:0".parse()?)?;
        let address = endpoint.local_addr()?;
        let observed = Arc::new(Observations::default());
        let task_endpoint = endpoint.clone();
        let events = observed.clone();
        let task = tokio::spawn(async move {
            let mut connections = JoinSet::new();
            while let Some(incoming) = task_endpoint.accept().await {
                let events = events.clone();
                connections.spawn(async move {
                    let Ok(connection) = incoming.await else {
                        return Ok::<(), Box<dyn std::error::Error + Send + Sync>>(());
                    };
                    events.connections.fetch_add(1, Ordering::SeqCst);
                    let protocol = connection
                        .handshake_data()
                        .and_then(|data| {
                            data.downcast::<quinn::crypto::rustls::HandshakeData>().ok()
                        })
                        .and_then(|data| data.protocol);
                    if protocol.as_deref() != Some(b"h3".as_slice()) {
                        return Err("Fixture did not negotiate h3".into());
                    }
                    events.h3_connections.fetch_add(1, Ordering::SeqCst);
                    let mut h3 = h3::server::builder()
                        .build::<_, Bytes>(h3_quinn::Connection::new(connection))
                        .await?;
                    let mut requests = JoinSet::new();
                    while let Ok(Some(resolver)) = h3.accept().await {
                        let events = events.clone();
                        requests.spawn(async move {
                            let (request, mut stream) = resolver.resolve_request().await?;
                            events.requests.fetch_add(1, Ordering::SeqCst);
                            events.request_started.notify_one();
                            let _active = ActiveRequest::new(events.clone());
                            if let Some(delay) = response_delay {
                                tokio::time::sleep(delay).await;
                            } else {
                                std::future::pending::<()>().await;
                            }
                            let response = http::Response::builder()
                                .status(200)
                                .header("content-type", "text/plain")
                                .body(())?;
                            stream.send_response(response).await?;
                            stream
                                .send_data(Bytes::from(format!(
                                    "owned-h3:{}",
                                    request.uri().path()
                                )))
                                .await?;
                            stream.finish().await?;
                            events.completed.fetch_add(1, Ordering::SeqCst);
                            Ok::<(), Box<dyn std::error::Error + Send + Sync>>(())
                        });
                    }
                    requests.abort_all();
                    while requests.join_next().await.is_some() {}
                    Ok(())
                });
            }
            connections.abort_all();
            while connections.join_next().await.is_some() {}
            Ok(())
        });
        Ok(Self {
            address,
            certificate: cert,
            observed,
            endpoint,
            task: Some(task),
        })
    }

    pub async fn wait_for_requests(&self, count: usize) -> Result<()> {
        timeout(Duration::from_secs(3), async {
            while self.observed.requests.load(Ordering::SeqCst) < count {
                self.observed.request_started.notified().await;
            }
        })
        .await?;
        Ok(())
    }

    pub async fn shutdown(&mut self) -> Result<()> {
        self.endpoint.close(0u32.into(), b"fixture complete");
        timeout(Duration::from_secs(3), self.endpoint.wait_idle()).await?;
        if let Some(task) = self.task.take() {
            timeout(Duration::from_secs(3), task).await???;
        }
        Ok(())
    }
}
impl Drop for FixtureServer {
    fn drop(&mut self) {
        self.endpoint.close(0u32.into(), b"fixture dropped");
        if let Some(task) = self.task.take() {
            task.abort();
        }
    }
}
