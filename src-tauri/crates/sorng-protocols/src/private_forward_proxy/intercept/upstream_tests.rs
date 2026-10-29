//! x2 tests: upstream TLS (recording verifier, fatal set, HSTS), the trust
//! gate before any request byte, and the per-attempt pool. Every server is a
//! local rustls/hyper fixture; the "system" root store is injected, so nothing
//! depends on the machine's OS roots.

use super::pool::{prepare_request, UpstreamPool};
use super::trust::{
    UpstreamEvidence, UpstreamFatal, UpstreamTrust, UpstreamTrustFuture, UpstreamVerdict,
};
use super::upstream::{handshake_failure, Admission, UpstreamFailure};
use super::upstream_verify::{process_provider, structural_fatal, UpstreamVerifierConfig};
use super::ProxyBody;
use crate::private_forward_proxy::{Authority, BoxedStream, DialFuture, RouteDialer};
use http_body_util::{BodyExt, Empty, Full};
use hyper::body::{Bytes, Incoming};
use hyper::{Request, Response};
use hyper_util::rt::{TokioExecutor, TokioIo};
use rcgen::{
    BasicConstraints, Certificate, CertificateParams, DistinguishedName, DnType, IsCa,
    KeyUsagePurpose, SanType,
};
use rustls::pki_types::{CertificateDer, PrivateKeyDer, PrivatePkcs8KeyDer};
use std::io;
use std::net::SocketAddr;
use std::pin::Pin;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::task::{Context, Poll};
use std::time::Duration;
use tokio::io::{AsyncRead, AsyncWrite, ReadBuf};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::Semaphore;

// ---------------------------------------------------------------- PKI ----

fn ca(name: &str) -> Certificate {
    let mut params = CertificateParams::new(Vec::<String>::new());
    params.is_ca = IsCa::Ca(BasicConstraints::Unconstrained);
    params.distinguished_name = DistinguishedName::new();
    params.distinguished_name.push(DnType::CommonName, name);
    params.key_usages = vec![
        KeyUsagePurpose::KeyCertSign,
        KeyUsagePurpose::CrlSign,
        KeyUsagePurpose::DigitalSignature,
    ];
    Certificate::from_params(params).expect("test CA")
}

#[derive(Clone, Copy)]
enum Validity {
    Current,
    Expired,
    NotYetValid,
}

fn leaf_params(names: &[&str], validity: Validity) -> CertificateParams {
    let mut params = CertificateParams::new(Vec::<String>::new());
    params.distinguished_name = DistinguishedName::new();
    params.distinguished_name.push(DnType::CommonName, names[0]);
    params.subject_alt_names = names
        .iter()
        .map(|name| match name.parse() {
            Ok(ip) => SanType::IpAddress(ip),
            Err(_) => SanType::DnsName((*name).to_owned()),
        })
        .collect();
    params.extended_key_usages = vec![rcgen::ExtendedKeyUsagePurpose::ServerAuth];
    match validity {
        Validity::Current => {}
        Validity::Expired => {
            params.not_before = rcgen::date_time_ymd(2020, 1, 1);
            params.not_after = rcgen::date_time_ymd(2021, 1, 1);
        }
        Validity::NotYetValid => {
            params.not_before = rcgen::date_time_ymd(2090, 1, 1);
            params.not_after = rcgen::date_time_ymd(2091, 1, 1);
        }
    }
    params
}

/// A served identity: the chain exactly as the server sends it and the key
/// that signs the handshake.
#[derive(Clone)]
struct Served {
    chain: Vec<Vec<u8>>,
    key: Vec<u8>,
}

struct Pki {
    root: Certificate,
    root_der: Vec<u8>,
    intermediate: Certificate,
    intermediate_der: Vec<u8>,
}

impl Pki {
    fn new() -> Self {
        let root = ca("x2 system root");
        let root_der = root.serialize_der().unwrap();
        let intermediate = ca("x2 intermediate");
        let intermediate_der = intermediate.serialize_der_with_signer(&root).unwrap();
        Self {
            root,
            root_der,
            intermediate,
            intermediate_der,
        }
    }

    fn system(&self, revoked: &[Vec<u8>]) -> UpstreamVerifierConfig {
        UpstreamVerifierConfig::for_tests(&[CertificateDer::from(self.root_der.clone())], revoked)
    }

    /// Leaf under the intermediate, sent as [leaf, intermediate].
    fn valid(&self, names: &[&str], validity: Validity) -> Served {
        let leaf = Certificate::from_params(leaf_params(names, validity)).unwrap();
        Served {
            chain: vec![
                leaf.serialize_der_with_signer(&self.intermediate).unwrap(),
                self.intermediate_der.clone(),
            ],
            key: leaf.serialize_private_key_der(),
        }
    }

    /// Leaf directly under the root, sent alone.
    fn direct(&self, names: &[&str], validity: Validity) -> Served {
        let leaf = Certificate::from_params(leaf_params(names, validity)).unwrap();
        Served {
            chain: vec![leaf.serialize_der_with_signer(&self.root).unwrap()],
            key: leaf.serialize_private_key_der(),
        }
    }
}

fn self_signed(names: &[&str]) -> Served {
    let leaf = Certificate::from_params(leaf_params(names, Validity::Current)).unwrap();
    Served {
        chain: vec![leaf.serialize_der().unwrap()],
        key: leaf.serialize_private_key_der(),
    }
}

fn unknown_ca(names: &[&str]) -> Served {
    let other = ca("x2 unknown root");
    let leaf = Certificate::from_params(leaf_params(names, Validity::Current)).unwrap();
    Served {
        chain: vec![leaf.serialize_der_with_signer(&other).unwrap()],
        key: leaf.serialize_private_key_der(),
    }
}

/// RSA-1024 public key behind a test-only remote key pair (ring cannot load
/// RSA keys under 2048 bits). The leaf never signs anything itself.
struct WeakRsa(Vec<u8>);
impl rcgen::RemoteKeyPair for WeakRsa {
    fn public_key(&self) -> &[u8] {
        &self.0
    }
    fn sign(&self, _: &[u8]) -> Result<Vec<u8>, rcgen::Error> {
        Err(rcgen::Error::RingUnspecified)
    }
    fn algorithm(&self) -> &'static rcgen::SignatureAlgorithm {
        &rcgen::PKCS_RSA_SHA256
    }
}

fn weak_rsa_leaf(pki: &Pki, names: &[&str]) -> Served {
    use rsa::pkcs1::EncodeRsaPublicKey;
    let key = rsa::RsaPrivateKey::new(&mut rand::thread_rng(), 1024).unwrap();
    let public = key
        .to_public_key()
        .to_pkcs1_der()
        .unwrap()
        .as_bytes()
        .to_vec();
    let mut params = leaf_params(names, Validity::Current);
    params.alg = &rcgen::PKCS_RSA_SHA256;
    params.key_pair = Some(rcgen::KeyPair::from_remote(Box::new(WeakRsa(public))).unwrap());
    let leaf = Certificate::from_params(params).unwrap();
    // The handshake key does not matter: the client aborts on the chain.
    let signer = ca("x2 unrelated signer");
    Served {
        chain: vec![
            leaf.serialize_der_with_signer(&pki.intermediate).unwrap(),
            pki.intermediate_der.clone(),
        ],
        key: signer.serialize_private_key_der(),
    }
}

// ------------------------------------------------------------- server ----

#[derive(Default)]
struct Stats {
    accepts: AtomicUsize,
    open: AtomicUsize,
    handshakes: AtomicUsize,
    /// Application bytes read from clients after the TLS handshake.
    bytes: AtomicUsize,
}

struct Counting<T> {
    inner: T,
    stats: Arc<Stats>,
}

impl<T: AsyncRead + Unpin> AsyncRead for Counting<T> {
    fn poll_read(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<io::Result<()>> {
        let before = buf.filled().len();
        let result = Pin::new(&mut self.inner).poll_read(cx, buf);
        let read = buf.filled().len() - before;
        self.stats.bytes.fetch_add(read, Ordering::SeqCst);
        result
    }
}

impl<T: AsyncWrite + Unpin> AsyncWrite for Counting<T> {
    fn poll_write(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &[u8],
    ) -> Poll<io::Result<usize>> {
        Pin::new(&mut self.inner).poll_write(cx, buf)
    }
    fn poll_flush(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        Pin::new(&mut self.inner).poll_flush(cx)
    }
    fn poll_shutdown(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        Pin::new(&mut self.inner).poll_shutdown(cx)
    }
}

#[derive(Clone, Copy, PartialEq)]
enum Alpn {
    H2AndH1,
    H1Only,
}

/// Serves one chain with one handshake key (possibly not the leaf key).
#[derive(Debug)]
struct FixedKey(Arc<rustls::sign::CertifiedKey>);
impl rustls::server::ResolvesServerCert for FixedKey {
    fn resolve(
        &self,
        _: rustls::server::ClientHello<'_>,
    ) -> Option<Arc<rustls::sign::CertifiedKey>> {
        Some(self.0.clone())
    }
}

fn server_config(
    served: &Served,
    alpn: Alpn,
    mismatched_key: Option<&[u8]>,
) -> Arc<rustls::ServerConfig> {
    let provider = process_provider();
    let chain: Vec<CertificateDer<'static>> = served
        .chain
        .iter()
        .map(|der| CertificateDer::from(der.clone()))
        .collect();
    let builder = rustls::ServerConfig::builder_with_provider(provider.clone())
        .with_protocol_versions(&[&rustls::version::TLS13, &rustls::version::TLS12])
        .unwrap()
        .with_no_client_auth();
    // A fixed resolver: `CertifiedKey::new` does not insist that the key
    // matches the leaf, which the bad-signature and weak-key rows need.
    let signing = mismatched_key.unwrap_or(&served.key).to_vec();
    let key = provider
        .key_provider
        .load_private_key(PrivateKeyDer::Pkcs8(PrivatePkcs8KeyDer::from(signing)))
        .unwrap();
    let mut config = builder.with_cert_resolver(Arc::new(FixedKey(Arc::new(
        rustls::sign::CertifiedKey::new(chain, key),
    ))));
    config.alpn_protocols = match alpn {
        Alpn::H2AndH1 => vec![b"h2".to_vec(), b"http/1.1".to_vec()],
        Alpn::H1Only => vec![b"http/1.1".to_vec()],
    };
    Arc::new(config)
}

struct Server {
    addr: SocketAddr,
    stats: Arc<Stats>,
    /// `/hold` waits for one permit per request.
    hold: Arc<Semaphore>,
}

async fn start_server(config: Option<Arc<rustls::ServerConfig>>) -> Server {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let stats = Arc::new(Stats::default());
    let hold = Arc::new(Semaphore::new(0));
    let acceptor = config.map(tokio_rustls::TlsAcceptor::from);
    {
        let stats = stats.clone();
        let hold = hold.clone();
        tokio::spawn(async move {
            loop {
                let Ok((tcp, _)) = listener.accept().await else {
                    return;
                };
                stats.accepts.fetch_add(1, Ordering::SeqCst);
                stats.open.fetch_add(1, Ordering::SeqCst);
                let stats = stats.clone();
                let hold = hold.clone();
                let acceptor = acceptor.clone();
                tokio::spawn(async move {
                    match acceptor {
                        Some(acceptor) => {
                            if let Ok(tls) = acceptor.accept(tcp).await {
                                stats.handshakes.fetch_add(1, Ordering::SeqCst);
                                serve(
                                    Counting {
                                        inner: tls,
                                        stats: stats.clone(),
                                    },
                                    hold,
                                )
                                .await;
                            }
                        }
                        None => {
                            serve(
                                Counting {
                                    inner: tcp,
                                    stats: stats.clone(),
                                },
                                hold,
                            )
                            .await
                        }
                    }
                    stats.open.fetch_sub(1, Ordering::SeqCst);
                });
            }
        });
    }
    Server { addr, stats, hold }
}

async fn serve<T>(io: T, hold: Arc<Semaphore>)
where
    T: AsyncRead + AsyncWrite + Unpin + Send + 'static,
{
    let service = hyper::service::service_fn(move |req: Request<Incoming>| {
        let hold = hold.clone();
        async move {
            if req.uri().path() == "/hold" {
                hold.acquire().await.unwrap().forget();
            }
            let host = req
                .headers()
                .get(hyper::header::HOST)
                .and_then(|value| value.to_str().ok())
                .map(str::to_owned)
                .or_else(|| req.uri().authority().map(|a| a.to_string()))
                .unwrap_or_default();
            let body = format!("{} {:?} {}", req.uri().path(), req.version(), host);
            Ok::<_, io::Error>(Response::new(Full::new(Bytes::from(body))))
        }
    });
    let _ = hyper_util::server::conn::auto::Builder::new(TokioExecutor::new())
        .serve_connection(TokioIo::new(io), service)
        .await;
}

// ----------------------------------------------------- dialer / trust ----

fn dialer(addr: SocketAddr, dials: Arc<AtomicUsize>) -> Arc<dyn RouteDialer> {
    Arc::new(move |_authority: Authority| -> DialFuture {
        dials.fetch_add(1, Ordering::SeqCst);
        Box::pin(async move {
            let stream = TcpStream::connect(addr).await?;
            Ok(Box::new(stream) as BoxedStream)
        })
    })
}

struct Seen {
    authority: String,
    chain: Vec<Vec<u8>>,
    system_ca_valid: bool,
    temporary_ok: bool,
}

struct TestTrust {
    verdict: Mutex<UpstreamVerdict>,
    seen: Mutex<Vec<Seen>>,
}

impl TestTrust {
    fn new(verdict: UpstreamVerdict) -> Arc<Self> {
        Arc::new(Self {
            verdict: Mutex::new(verdict),
            seen: Mutex::new(Vec::new()),
        })
    }
    fn calls(&self) -> usize {
        self.seen.lock().unwrap().len()
    }
}

impl UpstreamTrust for TestTrust {
    fn evaluate(&self, e: UpstreamEvidence) -> UpstreamTrustFuture {
        self.seen.lock().unwrap().push(Seen {
            authority: e.authority.to_string(),
            chain: e.chain_der,
            system_ca_valid: e.system_ca_valid,
            temporary_ok: e.temporary_ok,
        });
        let verdict = *self.verdict.lock().unwrap();
        Box::pin(async move { verdict })
    }
}

const ADMIT: UpstreamVerdict = UpstreamVerdict::Admit { persistent: true };

fn authority(value: &str) -> Authority {
    Authority::parse(value).unwrap()
}

fn get(path: &str) -> Request<ProxyBody> {
    Request::get(path)
        .body(
            Empty::<Bytes>::new()
                .map_err(|never| match never {})
                .boxed(),
        )
        .unwrap()
}

async fn text(response: Response<Incoming>) -> String {
    String::from_utf8(
        response
            .into_body()
            .collect()
            .await
            .unwrap()
            .to_bytes()
            .to_vec(),
    )
    .unwrap()
}

async fn eventually(what: &str, check: impl Fn() -> bool) {
    for _ in 0..200 {
        if check() {
            return;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    panic!("timed out waiting for {what}");
}

struct Fixture {
    server: Server,
    trust: Arc<TestTrust>,
    dials: Arc<AtomicUsize>,
    pool: Arc<UpstreamPool>,
}

async fn fixture(
    served: &Served,
    alpn: Alpn,
    verifier: UpstreamVerifierConfig,
    verdict: UpstreamVerdict,
    idle: Duration,
) -> Fixture {
    let server = start_server(Some(server_config(served, alpn, None))).await;
    let trust = TestTrust::new(verdict);
    let dials = Arc::new(AtomicUsize::new(0));
    let pool = UpstreamPool::with_idle_timeout(
        dialer(server.addr, dials.clone()),
        trust.clone(),
        verifier,
        idle,
    );
    Fixture {
        server,
        trust,
        dials,
        pool,
    }
}

// --------------------------------------------------------------- pool ----

#[tokio::test]
async fn pool_is_keyed_by_exact_authority_and_never_coalesces() {
    let pki = Pki::new();
    // One certificate valid for both names, one server: an IP/SAN-coalescing
    // pool would share a connection. This one must not.
    let served = pki.valid(&["a.test", "b.test"], Validity::Current);
    let f = fixture(
        &served,
        Alpn::H2AndH1,
        pki.system(&[]),
        ADMIT,
        Duration::from_secs(90),
    )
    .await;
    let a = authority("a.test:443");
    let b = authority("b.test:443");
    for _ in 0..3 {
        let (response, admission) = f.pool.send(&a, true, get("/x")).await.unwrap();
        assert_eq!(admission, Admission { persistent: true });
        assert!(text(response).await.ends_with("a.test"));
        let (response, _) = f.pool.send(&b, true, get("/y")).await.unwrap();
        assert!(text(response).await.ends_with("b.test"));
    }
    assert_eq!(f.server.stats.accepts.load(Ordering::SeqCst), 2);
    assert_eq!(f.dials.load(Ordering::SeqCst), 2);
    let seen = f.trust.seen.lock().unwrap();
    let mut authorities: Vec<_> = seen.iter().map(|s| s.authority.clone()).collect();
    authorities.sort();
    assert_eq!(authorities, ["a.test:443", "b.test:443"]);
    assert!(seen.iter().all(|s| s.system_ca_valid && s.temporary_ok));
    // Different port = different authority.
    drop(seen);
    assert!(f.pool.admitted(&a) && f.pool.admitted(&b));
    assert!(!f.pool.admitted(&authority("a.test:8443")));
}

#[tokio::test]
async fn h2_multiplexes_concurrent_requests_over_one_connection() {
    let pki = Pki::new();
    let served = pki.valid(&["a.test"], Validity::Current);
    let f = fixture(
        &served,
        Alpn::H2AndH1,
        pki.system(&[]),
        ADMIT,
        Duration::from_secs(90),
    )
    .await;
    let a = authority("a.test:443");
    let mut tasks = Vec::new();
    for index in 0..12 {
        let pool = f.pool.clone();
        let a = a.clone();
        tasks.push(tokio::spawn(async move {
            let (response, _) = pool
                .send(&a, true, get(&format!("/r{index}")))
                .await
                .unwrap();
            assert_eq!(response.version(), hyper::Version::HTTP_2);
            text(response).await
        }));
    }
    for (index, task) in tasks.into_iter().enumerate() {
        assert!(task
            .await
            .unwrap()
            .starts_with(&format!("/r{index} HTTP/2.0")));
    }
    assert_eq!(f.server.stats.accepts.load(Ordering::SeqCst), 1);
    assert_eq!(f.trust.calls(), 1);
}

#[tokio::test]
async fn h1_uses_at_most_six_connections_and_reuses_them() {
    let pki = Pki::new();
    let served = pki.valid(&["a.test"], Validity::Current);
    let f = fixture(
        &served,
        Alpn::H1Only,
        pki.system(&[]),
        ADMIT,
        Duration::from_secs(90),
    )
    .await;
    let a = authority("a.test:443");
    let mut tasks = Vec::new();
    for _ in 0..10 {
        let pool = f.pool.clone();
        let a = a.clone();
        tasks.push(tokio::spawn(async move {
            let (response, _) = pool.send(&a, true, get("/hold")).await.unwrap();
            assert_eq!(response.version(), hyper::Version::HTTP_11);
            text(response).await
        }));
    }
    let stats = f.server.stats.clone();
    eventually("six held connections", || {
        stats.handshakes.load(Ordering::SeqCst) == 6
    })
    .await;
    tokio::time::sleep(Duration::from_millis(100)).await;
    assert_eq!(
        f.server.stats.accepts.load(Ordering::SeqCst),
        6,
        "never a 7th"
    );
    f.server.hold.add_permits(10);
    for task in tasks {
        assert!(task.await.unwrap().starts_with("/hold HTTP/1.1 a.test"));
    }
    for _ in 0..5 {
        let (response, _) = f.pool.send(&a, true, get("/again")).await.unwrap();
        text(response).await;
    }
    assert_eq!(f.server.stats.accepts.load(Ordering::SeqCst), 6);
    // Every new connection was evaluated; serialised per authority.
    assert_eq!(f.trust.calls(), 6);
}

#[tokio::test]
async fn idle_connections_expire_and_are_closed() {
    let pki = Pki::new();
    let served = pki.valid(&["a.test"], Validity::Current);
    let f = fixture(
        &served,
        Alpn::H1Only,
        pki.system(&[]),
        ADMIT,
        Duration::from_millis(150),
    )
    .await;
    let a = authority("a.test:443");
    let (response, _) = f.pool.send(&a, true, get("/one")).await.unwrap();
    text(response).await;
    let (response, _) = f.pool.send(&a, true, get("/two")).await.unwrap();
    text(response).await;
    assert_eq!(
        f.server.stats.accepts.load(Ordering::SeqCst),
        1,
        "kept alive"
    );
    let stats = f.server.stats.clone();
    eventually("idle close", || stats.open.load(Ordering::SeqCst) == 0).await;
    let (response, _) = f.pool.send(&a, true, get("/three")).await.unwrap();
    text(response).await;
    assert_eq!(f.server.stats.accepts.load(Ordering::SeqCst), 2);
    assert_eq!(
        f.trust.calls(),
        2,
        "the replacement connection is evaluated again"
    );
}

#[tokio::test]
async fn idle_h2_connection_expires_too() {
    let pki = Pki::new();
    let served = pki.valid(&["a.test"], Validity::Current);
    let f = fixture(
        &served,
        Alpn::H2AndH1,
        pki.system(&[]),
        ADMIT,
        Duration::from_millis(150),
    )
    .await;
    let a = authority("a.test:443");
    let (response, _) = f.pool.send(&a, true, get("/one")).await.unwrap();
    text(response).await;
    let stats = f.server.stats.clone();
    eventually("idle h2 close", || stats.open.load(Ordering::SeqCst) == 0).await;
    let (response, _) = f.pool.send(&a, true, get("/two")).await.unwrap();
    text(response).await;
    assert_eq!(f.server.stats.accepts.load(Ordering::SeqCst), 2);
}

#[tokio::test]
async fn denied_or_timed_out_upstream_receives_zero_request_bytes() {
    let pki = Pki::new();
    let served = pki.valid(&["a.test"], Validity::Current);
    for (verdict, failure) in [
        (UpstreamVerdict::Deny, UpstreamFailure::Denied),
        (UpstreamVerdict::Timeout, UpstreamFailure::Timeout),
    ] {
        for alpn in [Alpn::H2AndH1, Alpn::H1Only] {
            let f = fixture(
                &served,
                alpn,
                pki.system(&[]),
                verdict,
                Duration::from_secs(90),
            )
            .await;
            let a = authority("a.test:443");
            let mut post = get("/login");
            *post.method_mut() = hyper::Method::POST;
            *post.body_mut() = Full::new(Bytes::from_static(b"user=a&password=secret"))
                .map_err(|never| match never {})
                .boxed();
            assert_eq!(f.pool.send(&a, true, post).await.unwrap_err(), failure);
            assert!(matches!(
                f.pool.connect_upgrade(&a, true).await,
                Err(error) if error == failure
            ));
            let stats = f.server.stats.clone();
            eventually("denied connections closed", || {
                stats.open.load(Ordering::SeqCst) == 0
            })
            .await;
            assert_eq!(f.server.stats.handshakes.load(Ordering::SeqCst), 2);
            assert_eq!(
                f.server.stats.bytes.load(Ordering::SeqCst),
                0,
                "no request byte"
            );
            assert!(!f.pool.admitted(&a));
        }
    }
}

#[tokio::test]
async fn temporary_admission_is_reported_per_exchange() {
    let pki = Pki::new();
    let served = pki.valid(&["a.test"], Validity::Current);
    let f = fixture(
        &served,
        Alpn::H2AndH1,
        pki.system(&[]),
        UpstreamVerdict::Admit { persistent: false },
        Duration::from_secs(90),
    )
    .await;
    let a = authority("a.test:443");
    for _ in 0..2 {
        let (response, admission) = f.pool.send(&a, true, get("/t")).await.unwrap();
        assert_eq!(admission, Admission { persistent: false });
        text(response).await;
    }
}

#[tokio::test]
async fn close_all_drops_connections_and_refuses_new_sends() {
    let pki = Pki::new();
    let served = pki.valid(&["a.test"], Validity::Current);
    let f = fixture(
        &served,
        Alpn::H1Only,
        pki.system(&[]),
        ADMIT,
        Duration::from_secs(90),
    )
    .await;
    let a = authority("a.test:443");
    let (response, _) = f.pool.send(&a, true, get("/one")).await.unwrap();
    text(response).await;
    assert!(f.pool.admitted(&a));
    f.pool.close_all();
    let stats = f.server.stats.clone();
    eventually("revoked connections closed", || {
        stats.open.load(Ordering::SeqCst) == 0
    })
    .await;
    assert_eq!(
        f.pool.send(&a, true, get("/two")).await.unwrap_err(),
        UpstreamFailure::RouteFailed
    );
    assert!(f.pool.connect_upgrade(&a, true).await.is_err());
    assert!(!f.pool.admitted(&a));
    assert_eq!(f.server.stats.accepts.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn plain_http_keeps_alive_without_trust_evaluation() {
    let server = start_server(None).await;
    let trust = TestTrust::new(UpstreamVerdict::Deny);
    let pool = UpstreamPool::new(
        dialer(server.addr, Arc::new(AtomicUsize::new(0))),
        trust.clone(),
        UpstreamVerifierConfig::for_tests(&[], &[]),
    );
    let a = authority("device.test:80");
    for path in ["/a", "/b", "/c"] {
        let (response, admission) = pool.send(&a, false, get(path)).await.unwrap();
        assert_eq!(admission, Admission { persistent: true });
        assert_eq!(text(response).await, format!("{path} HTTP/1.1 device.test"));
    }
    assert_eq!(server.stats.accepts.load(Ordering::SeqCst), 1);
    assert_eq!(trust.calls(), 0);
    // Same authority over TLS is a different pool key (and is evaluated).
    assert!(pool.send(&a, true, get("/tls")).await.is_err());
}

#[tokio::test]
async fn websocket_upgrade_gets_a_dedicated_admitted_connection() {
    let pki = Pki::new();
    let served = pki.valid(&["a.test"], Validity::Current);
    let f = fixture(
        &served,
        Alpn::H2AndH1,
        pki.system(&[]),
        ADMIT,
        Duration::from_secs(90),
    )
    .await;
    let a = authority("a.test:443");
    let (mut sender, admission) = f.pool.connect_upgrade(&a, true).await.unwrap();
    assert!(admission.persistent);
    let mut req = get("/ws");
    prepare_request(&mut req, &a, true, false).unwrap();
    let response = sender.send_request(req).await.unwrap();
    assert_eq!(
        response.version(),
        hyper::Version::HTTP_11,
        "ALPN offered http/1.1 only"
    );
    text(response).await;
    // Pooled traffic opens its own connection.
    let (response, _) = f.pool.send(&a, true, get("/p")).await.unwrap();
    text(response).await;
    assert_eq!(f.server.stats.accepts.load(Ordering::SeqCst), 2);
    assert_eq!(f.trust.calls(), 2);
}

#[test]
fn requests_are_rewritten_to_the_pooled_authority_only() {
    let a = authority("a.test:443");
    let mut req = get("https://evil.test/path?q=1");
    req.headers_mut()
        .insert(hyper::header::HOST, "evil.test".parse().unwrap());
    req.headers_mut().insert(
        hyper::header::PROXY_AUTHORIZATION,
        "Basic eDp5".parse().unwrap(),
    );
    req.headers_mut()
        .insert("proxy-connection", "keep-alive".parse().unwrap());
    prepare_request(&mut req, &a, true, false).unwrap();
    assert_eq!(req.uri(), "/path?q=1");
    assert_eq!(req.headers()[hyper::header::HOST], "a.test");
    assert!(!req
        .headers()
        .contains_key(hyper::header::PROXY_AUTHORIZATION));
    assert!(!req.headers().contains_key("proxy-connection"));
    prepare_request(&mut req, &a, true, true).unwrap();
    assert_eq!(req.uri(), "https://a.test/path?q=1");
    assert!(!req.headers().contains_key(hyper::header::HOST));
    let mut req = get("/");
    prepare_request(&mut req, &authority("[::1]:8443"), true, false).unwrap();
    assert_eq!(req.headers()[hyper::header::HOST], "[::1]:8443");
    let mut req = get("/");
    prepare_request(&mut req, &authority("10.0.0.1:80"), false, false).unwrap();
    assert_eq!(req.headers()[hyper::header::HOST], "10.0.0.1");
}

// --------------------------------------------------- handshake errors ----

#[test]
fn handshake_errors_map_to_fatal_or_route_failure() {
    let tls = |error: rustls::Error| io::Error::new(io::ErrorKind::InvalidData, error);
    assert_eq!(
        handshake_failure(
            &tls(rustls::Error::PeerIncompatible(
                rustls::PeerIncompatible::Tls12NotOffered
            )),
            None
        ),
        UpstreamFailure::Fatal(UpstreamFatal::Protocol)
    );
    assert_eq!(
        handshake_failure(
            &tls(rustls::Error::AlertReceived(
                rustls::AlertDescription::ProtocolVersion
            )),
            None
        ),
        UpstreamFailure::Fatal(UpstreamFatal::Protocol)
    );
    assert_eq!(
        handshake_failure(
            &tls(rustls::Error::InvalidCertificate(
                rustls::CertificateError::BadSignature
            )),
            None
        ),
        UpstreamFailure::Fatal(UpstreamFatal::BadSignature)
    );
    assert_eq!(
        handshake_failure(&io::Error::from(io::ErrorKind::ConnectionReset), None),
        UpstreamFailure::RouteFailed
    );
    assert_eq!(
        handshake_failure(
            &io::Error::from(io::ErrorKind::ConnectionReset),
            Some(UpstreamFatal::WeakKey)
        ),
        UpstreamFailure::Fatal(UpstreamFatal::WeakKey)
    );
    assert_eq!(UpstreamFailure::Denied.header_value(), "certificate-denied");
    assert_eq!(
        UpstreamFailure::Fatal(UpstreamFatal::HstsViolation).outcome(),
        super::UpstreamOutcome::Fatal(UpstreamFatal::HstsViolation)
    );
    assert_eq!(
        UpstreamFailure::RouteFailed.outcome().as_str(),
        "route-failed"
    );
    assert_eq!(UpstreamFailure::Timeout.header_value(), "review-timeout");
    assert_eq!(
        UpstreamFailure::Fatal(UpstreamFatal::Revoked).header_value(),
        "fatal"
    );
    assert_eq!(UpstreamFailure::RouteFailed.header_value(), "route-failed");
}

// ------------------------------------------------ cert-error matrix ----

/// What the proxy produced for one row.
#[derive(Clone, Copy, Debug, PartialEq)]
enum Proxy {
    /// Trust was asked with this CA validity (chain checked separately).
    Evidence {
        system_ca_valid: bool,
    },
    Fatal(UpstreamFatal),
}

/// CEF-era evidence for the same chain: Chromium's verdict as the bridge
/// reported it (`native_error`, `fatal`, exception mask, known root), or
/// `None` when the handshake fails before any evidence exists. The app crate
/// runs the same rows through the real `admissible_native_result`.
#[derive(Clone, Copy, Debug)]
struct Cef {
    native_error: i32,
    fatal: bool,
    mask: u32,
    known_root: bool,
}

const CEF_OK: Cef = Cef {
    native_error: 0,
    fatal: false,
    mask: 0,
    known_root: true,
};
const fn cef(native_error: i32, mask: u32) -> Option<Cef> {
    Some(Cef {
        native_error,
        fatal: false,
        mask,
        known_root: false,
    })
}

fn cef_admissible(cef: Cef) -> bool {
    !cef.fatal
        && ((cef.native_error == 0 && cef.mask == 0)
            || (cef.native_error < 0 && cef.mask != 0 && cef.mask & !7 == 0))
}

struct Row {
    name: &'static str,
    authority: &'static str,
    served: Served,
    revoked: bool,
    mismatched_key: bool,
    hsts: bool,
    expected: Proxy,
    cef: Option<Cef>,
}

fn rows(pki: &Pki) -> Vec<Row> {
    let valid = pki.valid(&["a.test"], Validity::Current);
    let mut changed_intermediate = valid.clone();
    // Same leaf; the intermediate re-signed (same name and key, new bytes).
    changed_intermediate.chain[1] = pki
        .intermediate
        .serialize_der_with_signer(&pki.root)
        .unwrap();
    assert_ne!(changed_intermediate.chain[1], valid.chain[1]);
    let row = |name, authority, served: Served, expected, cef| Row {
        name,
        authority,
        served,
        revoked: false,
        mismatched_key: false,
        hsts: false,
        expected,
        cef,
    };
    let ok = Proxy::Evidence {
        system_ca_valid: true,
    };
    let not_ca = Proxy::Evidence {
        system_ca_valid: false,
    };
    vec![
        row("valid-ca", "a.test:443", valid.clone(), ok, Some(CEF_OK)),
        row(
            "self-signed",
            "a.test:443",
            self_signed(&["a.test"]),
            not_ca,
            cef(-202, 4),
        ),
        row(
            "unknown-ca",
            "a.test:443",
            unknown_ca(&["a.test"]),
            not_ca,
            cef(-202, 4),
        ),
        row(
            "expired",
            "a.test:443",
            pki.direct(&["a.test"], Validity::Expired),
            not_ca,
            cef(-201, 2),
        ),
        row(
            "not-yet-valid",
            "a.test:443",
            pki.direct(&["a.test"], Validity::NotYetValid),
            not_ca,
            cef(-201, 2),
        ),
        row(
            "wrong-name",
            "a.test:443",
            pki.valid(&["other.test"], Validity::Current),
            not_ca,
            cef(-200, 1),
        ),
        row(
            "ip-san-ok",
            "127.0.0.1:443",
            pki.valid(&["127.0.0.1"], Validity::Current),
            ok,
            Some(CEF_OK),
        ),
        row(
            "ip-san-mismatch",
            "127.0.0.1:443",
            pki.valid(&["127.0.0.2"], Validity::Current),
            not_ca,
            cef(-200, 1),
        ),
        row(
            "changed-intermediate",
            "a.test:443",
            changed_intermediate,
            ok,
            Some(CEF_OK),
        ),
        Row {
            revoked: true,
            ..row(
                "revoked",
                "a.test:443",
                valid.clone(),
                Proxy::Fatal(UpstreamFatal::Revoked),
                cef(-206, 0),
            )
        },
        Row {
            mismatched_key: true,
            ..row(
                "bad-handshake-signature",
                "a.test:443",
                valid.clone(),
                Proxy::Fatal(UpstreamFatal::BadSignature),
                None,
            )
        },
        row(
            "rsa-1024",
            "a.test:443",
            weak_rsa_leaf(pki, &["a.test"]),
            Proxy::Fatal(UpstreamFatal::WeakKey),
            cef(-208, 0),
        ),
        Row {
            hsts: true,
            ..row(
                "hsts-wrong-name",
                "a.test:443",
                pki.valid(&["other.test"], Validity::Current),
                Proxy::Fatal(UpstreamFatal::HstsViolation),
                Some(Cef {
                    native_error: -200,
                    fatal: true,
                    mask: 0,
                    known_root: false,
                }),
            )
        },
        Row {
            hsts: true,
            ..row("hsts-valid", "a.test:443", valid, ok, Some(CEF_OK))
        },
    ]
}

#[tokio::test]
async fn certificate_error_rows_match_cef_era_evidence() {
    let pki = Pki::new();
    for row in rows(&pki) {
        let revoked = if row.revoked {
            vec![row.served.chain[0].clone()]
        } else {
            Vec::new()
        };
        let other_key = row
            .mismatched_key
            .then(|| ca("x2 other key").serialize_private_key_der());
        let server = start_server(Some(server_config(
            &row.served,
            Alpn::H2AndH1,
            other_key.as_deref(),
        )))
        .await;
        let trust = TestTrust::new(ADMIT);
        let pool = UpstreamPool::new(
            dialer(server.addr, Arc::new(AtomicUsize::new(0))),
            trust.clone(),
            pki.system(&revoked),
        );
        let target = authority(row.authority);
        if row.hsts {
            pool.mark_hsts(&target);
        }
        let result = pool.send(&target, true, get("/")).await;
        let proxy = match &result {
            Ok(_) => {
                let seen = trust.seen.lock().unwrap();
                assert_eq!(seen.len(), 1, "{}", row.name);
                // The chain exactly as sent: what Chromium reported as
                // peer_chain, so stored TOFU fingerprints keep matching.
                assert_eq!(seen[0].chain, row.served.chain, "{}", row.name);
                Proxy::Evidence {
                    system_ca_valid: seen[0].system_ca_valid,
                }
            }
            Err(UpstreamFailure::Fatal(fatal)) => {
                assert_eq!(trust.calls(), 0, "{}: fatal never prompts", row.name);
                Proxy::Fatal(*fatal)
            }
            Err(other) => panic!("{}: unexpected {other:?}", row.name),
        };
        assert_eq!(proxy, row.expected, "{}", row.name);
        if let Ok((response, _)) = result {
            text(response).await;
        } else {
            let stats = server.stats.clone();
            eventually("fatal connection closed", || {
                stats.open.load(Ordering::SeqCst) == 0
            })
            .await;
            assert_eq!(server.stats.bytes.load(Ordering::SeqCst), 0, "{}", row.name);
        }
        // Same decision input as the CEF era: fatal <=> not admissible,
        // otherwise identical CA validity.
        match (row.cef, &proxy) {
            (None, Proxy::Fatal(_)) => {}
            (Some(cef), Proxy::Fatal(_)) => assert!(!cef_admissible(cef), "{}", row.name),
            (Some(cef), Proxy::Evidence { system_ca_valid }) => {
                assert!(cef_admissible(cef), "{}", row.name);
                assert_eq!(
                    *system_ca_valid,
                    cef.native_error == 0 && cef.known_root,
                    "{}",
                    row.name
                );
            }
            (None, Proxy::Evidence { .. }) => panic!("{}: CEF had no evidence", row.name),
        }
    }
}

#[test]
fn structural_checks_flag_weak_keys_but_not_strong_chains() {
    let pki = Pki::new();
    let weak = weak_rsa_leaf(&pki, &["a.test"]);
    let refs: Vec<&[u8]> = weak.chain.iter().map(Vec::as_slice).collect();
    assert_eq!(structural_fatal(&refs), Some(UpstreamFatal::WeakKey));
    let strong = pki.valid(&["a.test"], Validity::Expired);
    let refs: Vec<&[u8]> = strong.chain.iter().map(Vec::as_slice).collect();
    assert_eq!(
        structural_fatal(&refs),
        None,
        "dates are the app's decision"
    );
    let mut with_root = strong.chain.clone();
    with_root.push(pki.root_der.clone());
    let refs: Vec<&[u8]> = with_root.iter().map(Vec::as_slice).collect();
    assert_eq!(structural_fatal(&refs), None);
}
