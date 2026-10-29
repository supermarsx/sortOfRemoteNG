//! x1 tests: attempt CA and leaves, TLS acceptance (SNI/ALPN), the h1/h2
//! servers, the exchange pipeline, WebSockets, keep-alive plain HTTP and
//! revocation. Upstreams are local rustls/hyper servers whose "public" root
//! is injected into the upstream verifier; nothing depends on OS roots.

use super::ca::{ALPN_H2, ALPN_HTTP11, LEAF_CACHE};
use super::forward::{self, UPSTREAM_TAG};
use super::upstream::UpstreamFailure;
use super::upstream_verify::UpstreamVerifierConfig;
use super::*;
use crate::private_datagram_proxy::{DatagramOpenFuture, RouteDatagramDialer};
use crate::private_forward_proxy::{
    BoxedStream, DestinationGrant, DialFuture, PrivateForwardProxy, ProxyLimits, RouteDialer,
};
use base64::Engine;
use http_body_util::combinators::BoxBody;
use http_body_util::{BodyExt, Full, StreamBody};
use hyper::body::{Bytes, Frame, Incoming};
use hyper::http::{header, HeaderValue, Method, Request, Response, StatusCode};
use hyper_util::rt::{TokioExecutor, TokioIo};
use rustls::client::danger::ServerCertVerifier;
use rustls::pki_types::{CertificateDer, PrivateKeyDer, PrivatePkcs8KeyDer, ServerName, UnixTime};
use std::convert::Infallible;
use std::net::SocketAddr;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Mutex;
use std::time::{Duration, SystemTime};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::time::timeout;

const DEADLINE: Duration = Duration::from_secs(20);
type ClientBody = BoxBody<Bytes, Infallible>;
type ServerBody = BoxBody<Bytes, Box<dyn std::error::Error + Send + Sync>>;

fn provider() -> Arc<rustls::crypto::CryptoProvider> {
    Arc::new(rustls::crypto::aws_lc_rs::default_provider())
}

fn authority(text: &str) -> crate::private_forward_proxy::Authority {
    crate::private_forward_proxy::Authority::parse(text).unwrap()
}

// ---------------------------------------------------------------- PKI ----

/// A disposable "public" root and one server leaf for the upstream fixture.
struct PublicPki {
    root: CertificateDer<'static>,
    chain: Vec<CertificateDer<'static>>,
    key: Vec<u8>,
}

fn public_pki() -> PublicPki {
    let mut ca = rcgen::CertificateParams::default();
    ca.is_ca = rcgen::IsCa::Ca(rcgen::BasicConstraints::Unconstrained);
    ca.key_usages = vec![rcgen::KeyUsagePurpose::KeyCertSign];
    let mut name = rcgen::DistinguishedName::new();
    name.push(rcgen::DnType::CommonName, "x1 test public root");
    ca.distinguished_name = name;
    let ca = rcgen::Certificate::from_params(ca).unwrap();
    let mut leaf = rcgen::CertificateParams::new(vec![
        "upstream.test".to_string(),
        "other.test".to_string(),
        "127.0.0.1".to_string(),
        "::1".to_string(),
    ]);
    leaf.extended_key_usages = vec![rcgen::ExtendedKeyUsagePurpose::ServerAuth];
    let leaf = rcgen::Certificate::from_params(leaf).unwrap();
    let root = CertificateDer::from(ca.serialize_der().unwrap());
    PublicPki {
        chain: vec![
            CertificateDer::from(leaf.serialize_der_with_signer(&ca).unwrap()),
            root.clone(),
        ],
        root,
        key: leaf.serialize_private_key_der(),
    }
}

impl PublicPki {
    fn server_config(&self, alpn: &[&[u8]]) -> Arc<rustls::ServerConfig> {
        let mut config = rustls::ServerConfig::builder_with_provider(provider())
            .with_safe_default_protocol_versions()
            .unwrap()
            .with_no_client_auth()
            .with_single_cert(
                self.chain.clone(),
                PrivateKeyDer::Pkcs8(PrivatePkcs8KeyDer::from(self.key.clone())),
            )
            .unwrap();
        config.alpn_protocols = alpn.iter().map(|p| p.to_vec()).collect();
        Arc::new(config)
    }
}

// ----------------------------------------------------------- upstream ----

struct Upstream {
    address: SocketAddr,
    requests: Arc<AtomicUsize>,
    task: tokio::task::JoinHandle<()>,
}

impl Drop for Upstream {
    fn drop(&mut self) {
        self.task.abort();
    }
}

fn server_body<B>(body: B) -> ServerBody
where
    B: hyper::body::Body<Data = Bytes> + Send + Sync + 'static,
    B::Error: Into<Box<dyn std::error::Error + Send + Sync>>,
{
    body.map_err(Into::into).boxed()
}

fn text(body: impl Into<Bytes>) -> ServerBody {
    server_body(Full::new(body.into()))
}

const BIG: usize = 16 * 1024 * 1024;
const CHUNK: usize = 64 * 1024;

fn pattern(index: usize) -> Bytes {
    Bytes::from(vec![(index % 251) as u8; CHUNK])
}

async fn upstream_service(
    mut request: Request<Incoming>,
    requests: Arc<AtomicUsize>,
) -> Result<Response<ServerBody>, Infallible> {
    requests.fetch_add(1, Ordering::SeqCst);
    let path = request.uri().path().to_string();
    let version = format!("{:?}", request.version());
    let response = match path.as_str() {
        "/hello" => Response::builder()
            .header("alt-svc", "h3=\":443\"; ma=86400")
            .header("x-upstream-version", version)
            .body(text("hello"))
            .unwrap(),
        "/cached" => Response::builder()
            .header("cache-control", "max-age=600")
            .header("content-type", "text/plain")
            .header("alt-svc", "h3=\":443\"")
            .body(text(format!("cached {}", requests.load(Ordering::SeqCst))))
            .unwrap(),
        "/cached-chunked" => {
            let page = Bytes::from(format!("cached {}", requests.load(Ordering::SeqCst)));
            let chunks = futures_util::stream::iter([Ok::<_, Infallible>(Frame::data(page))]);
            Response::builder()
                .header("cache-control", "max-age=600")
                .header("alt-svc", "h3=\":443\"")
                .body(server_body(StreamBody::new(chunks)))
                .unwrap()
        }
        "/hsts" => Response::builder()
            .header("strict-transport-security", "max-age=60")
            .body(text("hsts"))
            .unwrap(),
        "/headers" => {
            let mut lines: Vec<String> = request
                .headers()
                .iter()
                .map(|(n, v)| format!("{}: {}", n, v.to_str().unwrap_or("?")))
                .collect();
            // h2 carries the authority as a pseudo-header, not `Host`.
            if let Some(authority) = request.uri().authority() {
                lines.push(format!("host: {authority}"));
            }
            lines.sort();
            Response::new(text(lines.join("\n")))
        }
        "/hop" => Response::builder()
            .header("connection", "x-secret")
            .header("x-secret", "1")
            .header("keep-alive", "timeout=5")
            .body(text("hop"))
            .unwrap(),
        "/panic-response" => Response::builder()
            .header("x-panic-response", "1")
            .body(text("p"))
            .unwrap(),
        "/echo" => Response::new(server_body(request.into_body())),
        "/big" => {
            let chunks = futures_util::stream::iter(
                (0..BIG / CHUNK).map(|i| Ok::<_, Infallible>(Frame::data(pattern(i)))),
            );
            Response::new(server_body(StreamBody::new(chunks)))
        }
        "/ws" => {
            let upgrade = hyper::upgrade::on(&mut request);
            tokio::spawn(async move {
                if let Ok(upgraded) = upgrade.await {
                    let mut io = TokioIo::new(upgraded);
                    let mut buffer = [0u8; 1024];
                    while let Ok(n) = io.read(&mut buffer).await {
                        if n == 0 || io.write_all(&buffer[..n]).await.is_err() {
                            break;
                        }
                    }
                }
            });
            Response::builder()
                .status(StatusCode::SWITCHING_PROTOCOLS)
                .header("upgrade", "websocket")
                .header("connection", "upgrade")
                .header("sec-websocket-accept", "s3pPLMBiTxaQ9kYGzzhZRbK+xOo=")
                .body(text(""))
                .unwrap()
        }
        "/ws-refused" => Response::builder()
            .status(StatusCode::FORBIDDEN)
            .body(text("no"))
            .unwrap(),
        _ => Response::builder()
            .status(StatusCode::NOT_FOUND)
            .body(text(""))
            .unwrap(),
    };
    Ok(response)
}

async fn upstream(tls: Option<Arc<rustls::ServerConfig>>) -> Upstream {
    upstream_with(tls, false).await
}

/// `sniff`: one listener serves TLS (first byte 0x16) and plain HTTP alike.
async fn upstream_with(tls: Option<Arc<rustls::ServerConfig>>, sniff: bool) -> Upstream {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let requests = Arc::new(AtomicUsize::new(0));
    let counter = requests.clone();
    let task = tokio::spawn(async move {
        loop {
            let Ok((socket, _)) = listener.accept().await else {
                return;
            };
            let tls = tls.clone();
            let counter = counter.clone();
            tokio::spawn(async move {
                let service = hyper::service::service_fn(move |request| {
                    upstream_service(request, counter.clone())
                });
                let builder = hyper_util::server::conn::auto::Builder::new(TokioExecutor::new());
                let mut first = [0u8; 1];
                let handshake =
                    !sniff || matches!(socket.peek(&mut first).await, Ok(1) if first[0] == 0x16);
                match tls.filter(|_| handshake) {
                    Some(config) => {
                        let Ok(stream) =
                            tokio_rustls::TlsAcceptor::from(config).accept(socket).await
                        else {
                            return;
                        };
                        let _ = builder
                            .serve_connection_with_upgrades(TokioIo::new(stream), service)
                            .await;
                    }
                    None => {
                        let _ = builder
                            .serve_connection_with_upgrades(TokioIo::new(socket), service)
                            .await;
                    }
                }
            });
        }
    });
    Upstream {
        address,
        requests,
        task,
    }
}

// ------------------------------------------------------------ dialers ----

fn dialer_to(address: SocketAddr, dials: Arc<AtomicUsize>) -> Arc<dyn RouteDialer> {
    Arc::new(
        move |_: crate::private_forward_proxy::Authority| -> DialFuture {
            dials.fetch_add(1, Ordering::SeqCst);
            Box::pin(async move { Ok(Box::new(TcpStream::connect(address).await?) as BoxedStream) })
        },
    )
}

fn failing_dialer() -> Arc<dyn RouteDialer> {
    Arc::new(|_: crate::private_forward_proxy::Authority| -> DialFuture {
        Box::pin(async { Err(std::io::Error::other("synthetic route failure")) })
    })
}

struct PendingUdp;
impl RouteDatagramDialer for PendingUdp {
    fn open(&self, _: crate::private_forward_proxy::Authority) -> DatagramOpenFuture {
        Box::pin(std::future::pending())
    }
}

struct UdpCapableDialer;
impl RouteDialer for UdpCapableDialer {
    fn dial(&self, _: crate::private_forward_proxy::Authority) -> DialFuture {
        Box::pin(async { Err(std::io::Error::other("unused")) })
    }
    fn datagrams(&self) -> Option<Arc<dyn RouteDatagramDialer>> {
        Some(Arc::new(PendingUdp))
    }
}

// -------------------------------------------------------------- trust ----

struct AdmitAll;
impl UpstreamTrust for AdmitAll {
    fn evaluate(&self, _: UpstreamEvidence) -> UpstreamTrustFuture {
        Box::pin(async { UpstreamVerdict::Admit { persistent: true } })
    }
}

struct TimesOut;
impl UpstreamTrust for TimesOut {
    fn evaluate(&self, _: UpstreamEvidence) -> UpstreamTrustFuture {
        Box::pin(async { UpstreamVerdict::Timeout })
    }
}

// -------------------------------------------------------------- hooks ----

#[derive(Default)]
struct RecordingHook {
    /// Every protected edit attempt, true when it was refused.
    refusals: Mutex<Vec<bool>>,
}

impl ExchangeHook for RecordingHook {
    fn on_request(&self, ctx: &ExchangeCtx, head: &mut RequestHeadView) -> HookVerdict {
        assert_eq!(ctx.authority.host(), "upstream.test");
        match head.uri().path() {
            "/blocked" => return HookVerdict::Block,
            "/static" => {
                return HookVerdict::Respond(StaticResponse {
                    status: StatusCode::IM_A_TEAPOT,
                    content_type: "text/plain",
                    body: b"from hook",
                })
            }
            "/panic" => panic!("synthetic request hook panic"),
            _ => {}
        }
        let value = HeaderValue::from_static("x");
        let mut refusals = self.refusals.lock().unwrap();
        refusals.push(head.set_header(header::HOST, value.clone()).is_err());
        refusals.push(
            head.set_header(header::PROXY_AUTHORIZATION, value.clone())
                .is_err(),
        );
        refusals.push(head.remove_header(&header::CONTENT_LENGTH).is_err());
        refusals.push(
            head.set_header(header::TRANSFER_ENCODING, value.clone())
                .is_err(),
        );
        head.set_header(
            header::HeaderName::from_static("x-hooked"),
            HeaderValue::from_static("1"),
        )
        .unwrap();
        HookVerdict::Continue
    }

    fn on_response(&self, _: &ExchangeCtx, head: &mut ResponseHeadView) {
        if head.headers().contains_key("x-panic-response") {
            panic!("synthetic response hook panic");
        }
        let value = HeaderValue::from_static("x=1");
        let mut refusals = self.refusals.lock().unwrap();
        refusals.push(head.set_header(header::SET_COOKIE, value.clone()).is_err());
        refusals.push(head.set_header(header::CONTENT_LENGTH, value).is_err());
        // Allowed, but the built-in strip runs after every hook.
        head.set_header(header::ALT_SVC, HeaderValue::from_static("h3=\":1\""))
            .unwrap();
        head.set_header(
            header::HeaderName::from_static("x-response-hook"),
            HeaderValue::from_static("1"),
        )
        .unwrap();
    }
}

// -------------------------------------------------------------- proxy ----

struct Harness {
    proxy: PrivateForwardProxy,
    upstream: Upstream,
    dials: Arc<AtomicUsize>,
    allowed: Arc<AtomicBool>,
}

fn config(
    authority: Arc<InterceptAuthority>,
    trust: Arc<dyn UpstreamTrust>,
    hooks: Vec<Arc<dyn ExchangeHook>>,
) -> InterceptConfig {
    InterceptConfig {
        authority,
        trust,
        cache: CacheMode::Off,
        hooks,
    }
}

async fn harness_with(
    tls: bool,
    trust: Arc<dyn UpstreamTrust>,
    hooks: Vec<Arc<dyn ExchangeHook>>,
) -> Harness {
    harness_cached(tls, trust, hooks, CacheMode::Off).await
}

async fn harness_cached(
    tls: bool,
    trust: Arc<dyn UpstreamTrust>,
    hooks: Vec<Arc<dyn ExchangeHook>>,
    cache: CacheMode,
) -> Harness {
    let pki = public_pki();
    let upstream = upstream(tls.then(|| pki.server_config(&[ALPN_H2, ALPN_HTTP11]))).await;
    let dials = Arc::new(AtomicUsize::new(0));
    let allowed = Arc::new(AtomicBool::new(true));
    let grant: DestinationGrant = {
        let allowed = allowed.clone();
        Arc::new(move |_| allowed.load(Ordering::SeqCst))
    };
    let proxy = PrivateForwardProxy::start_intercepting_with_verifier(
        dialer_to(upstream.address, dials.clone()),
        grant,
        ProxyLimits::default(),
        InterceptConfig {
            cache,
            ..config(InterceptAuthority::generate().unwrap(), trust, hooks)
        },
        UpstreamVerifierConfig::for_tests(std::slice::from_ref(&pki.root), &[]),
    )
    .await
    .unwrap();
    Harness {
        proxy,
        upstream,
        dials,
        allowed,
    }
}

async fn harness() -> Harness {
    harness_with(true, Arc::new(AdmitAll), Vec::new()).await
}

fn proxy_auth(proxy: &PrivateForwardProxy) -> String {
    proxy
        .with_credentials(|user, password| {
            format!(
                "Basic {}",
                base64::engine::general_purpose::STANDARD.encode(format!("{user}:{password}"))
            )
        })
        .unwrap()
}

async fn read_head(stream: &mut TcpStream) -> String {
    timeout(DEADLINE, async {
        let mut bytes = Vec::new();
        while !bytes.ends_with(b"\r\n\r\n") {
            bytes.push(stream.read_u8().await.unwrap());
        }
        String::from_utf8(bytes).unwrap()
    })
    .await
    .unwrap()
}

async fn connect(proxy: &PrivateForwardProxy, target: &str) -> TcpStream {
    let mut stream = TcpStream::connect(proxy.local_addr()).await.unwrap();
    stream
        .write_all(
            format!(
                "CONNECT {target} HTTP/1.1\r\nHost: {target}\r\nProxy-Authorization: {}\r\n\r\n",
                proxy_auth(proxy)
            )
            .as_bytes(),
        )
        .await
        .unwrap();
    let head = read_head(&mut stream).await;
    assert!(head.starts_with("HTTP/1.1 200 "), "{head}");
    stream
}

fn client_config(anchor: &[u8], alpn: &[&[u8]], sni: bool) -> Arc<rustls::ClientConfig> {
    let mut roots = rustls::RootCertStore::empty();
    roots.add(CertificateDer::from(anchor.to_vec())).unwrap();
    let mut config = rustls::ClientConfig::builder_with_provider(provider())
        .with_safe_default_protocol_versions()
        .unwrap()
        .with_root_certificates(roots)
        .with_no_client_auth();
    config.alpn_protocols = alpn.iter().map(|p| p.to_vec()).collect();
    config.enable_sni = sni;
    Arc::new(config)
}

async fn tunnel(
    proxy: &PrivateForwardProxy,
    target: &str,
    server_name: &str,
    alpn: &[&[u8]],
    sni: bool,
) -> std::io::Result<tokio_rustls::client::TlsStream<TcpStream>> {
    let tcp = connect(proxy, target).await;
    let anchor = proxy.intercept_authority().unwrap();
    let name = ServerName::try_from(server_name.to_string()).unwrap();
    timeout(
        DEADLINE,
        tokio_rustls::TlsConnector::from(client_config(anchor.anchor_der(), alpn, sni))
            .connect(name, tcp),
    )
    .await
    .unwrap()
}

type H1 = hyper::client::conn::http1::SendRequest<ClientBody>;
type H2 = hyper::client::conn::http2::SendRequest<ClientBody>;

async fn h1<I>(io: I) -> H1
where
    I: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin + Send + 'static,
{
    let (sender, connection) = hyper::client::conn::http1::handshake(TokioIo::new(io))
        .await
        .unwrap();
    tokio::spawn(connection.with_upgrades());
    sender
}

async fn h2<I>(io: I) -> H2
where
    I: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin + Send + 'static,
{
    let (sender, connection) =
        hyper::client::conn::http2::handshake(TokioExecutor::new(), TokioIo::new(io))
            .await
            .unwrap();
    tokio::spawn(connection);
    sender
}

fn empty() -> ClientBody {
    Full::new(Bytes::new()).boxed()
}

fn get(uri: &str, host: Option<&str>) -> Request<ClientBody> {
    let mut builder = Request::builder().uri(uri);
    if let Some(host) = host {
        builder = builder.header(header::HOST, host);
    }
    builder.body(empty()).unwrap()
}

async fn send1(sender: &mut H1, request: Request<ClientBody>) -> Response<Incoming> {
    timeout(DEADLINE, async {
        sender.ready().await.unwrap();
        sender.send_request(request).await.unwrap()
    })
    .await
    .unwrap()
}

async fn send2(sender: &mut H2, request: Request<ClientBody>) -> Response<Incoming> {
    timeout(DEADLINE, async {
        sender.ready().await.unwrap();
        sender.send_request(request).await.unwrap()
    })
    .await
    .unwrap()
}

async fn body(response: Response<Incoming>) -> Bytes {
    timeout(DEADLINE, response.into_body().collect())
        .await
        .unwrap()
        .unwrap()
        .to_bytes()
}

async fn h1_tunnel(h: &Harness) -> H1 {
    h1(tunnel(
        &h.proxy,
        "upstream.test:443",
        "upstream.test",
        &[ALPN_HTTP11],
        true,
    )
    .await
    .unwrap())
    .await
}

async fn h2_tunnel(h: &Harness) -> H2 {
    let tls = tunnel(
        &h.proxy,
        "upstream.test:443",
        "upstream.test",
        &[ALPN_H2, ALPN_HTTP11],
        true,
    )
    .await
    .unwrap();
    assert_eq!(tls.get_ref().1.alpn_protocol(), Some(ALPN_H2));
    h2(tls).await
}

async fn closed<R: tokio::io::AsyncRead + Unpin>(stream: &mut R) {
    let result = timeout(DEADLINE, stream.read(&mut [0u8; 64]))
        .await
        .unwrap();
    assert!(matches!(result, Ok(0)) || result.is_err());
}

// ============================================================ CA tests ===

fn parse(der: &[u8]) -> x509_parser::certificate::X509Certificate<'_> {
    x509_parser::parse_x509_certificate(der).unwrap().1
}

fn leaf_der(ca: &InterceptAuthority, target: &str, now: SystemTime) -> Vec<u8> {
    ca.leaf_at(&authority(target), now).unwrap().cert[0].to_vec()
}

fn unix(time: SystemTime) -> i64 {
    time.duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64
}

#[test]
fn attempt_ca_is_a_p256_pathlen0_signing_only_anchor() {
    let now = SystemTime::now();
    let ca = InterceptAuthority::generate_at(now).unwrap();
    let cert = parse(ca.anchor_der());
    let constraints = cert.basic_constraints().unwrap().unwrap().value;
    assert!(constraints.ca);
    assert_eq!(constraints.path_len_constraint, Some(0));
    let usage = cert.key_usage().unwrap().unwrap().value;
    assert!(usage.key_cert_sign());
    assert!(!usage.digital_signature());
    assert_eq!(
        cert.public_key().algorithm.algorithm,
        x509_parser::oid_registry::OID_KEY_TYPE_EC_PUBLIC_KEY
    );
    let curve = cert
        .public_key()
        .algorithm
        .parameters
        .as_ref()
        .unwrap()
        .as_oid()
        .unwrap();
    assert_eq!(curve, x509_parser::oid_registry::OID_EC_P256);
    let subject = cert.subject().to_string();
    assert!(subject.contains("sortOfRemoteNG attempt "), "{subject}");
    let validity = cert.validity();
    assert_eq!(validity.not_before.timestamp(), unix(now) - 86_400);
    assert_eq!(validity.not_after.timestamp(), unix(now) + 400 * 86_400);
    // A fresh attempt never reuses the CA.
    let other = InterceptAuthority::generate_at(now).unwrap();
    assert_ne!(other.anchor_der(), ca.anchor_der());
}

fn verify_leaf(ca: &InterceptAuthority, der: &[u8], name: &str, now: SystemTime) {
    let mut roots = rustls::RootCertStore::empty();
    roots
        .add(CertificateDer::from(ca.anchor_der().to_vec()))
        .unwrap();
    let verifier =
        rustls::client::WebPkiServerVerifier::builder_with_provider(Arc::new(roots), provider())
            .build()
            .unwrap();
    verifier
        .verify_server_cert(
            &CertificateDer::from(der.to_vec()),
            &[],
            &ServerName::try_from(name.to_string()).unwrap(),
            &[],
            UnixTime::since_unix_epoch(now.duration_since(std::time::UNIX_EPOCH).unwrap()),
        )
        .unwrap();
}

#[test]
fn leaves_have_exact_sans_server_auth_and_seven_day_validity() {
    let now = SystemTime::now();
    let ca = InterceptAuthority::generate_at(now).unwrap();
    for (target, name, san) in [
        (
            "upstream.test:443",
            "upstream.test",
            "DNSName(\"upstream.test\")",
        ),
        ("10.1.2.3:8443", "10.1.2.3", "IPAddress([10, 1, 2, 3])"),
        (
            "[2001:db8::7]:443",
            "2001:db8::7",
            "IPAddress([32, 1, 13, 184, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 7])",
        ),
    ] {
        let der = leaf_der(&ca, target, now);
        let cert = parse(&der);
        let sans: Vec<String> = cert
            .subject_alternative_name()
            .unwrap()
            .unwrap()
            .value
            .general_names
            .iter()
            .map(|n| format!("{n:?}"))
            .collect();
        assert_eq!(sans.len(), 1, "{target}: {sans:?}");
        assert!(sans[0].contains(san), "{target}: {sans:?}");
        let eku = cert.extended_key_usage().unwrap().unwrap().value;
        assert!(eku.server_auth && !eku.client_auth && !eku.any);
        assert!(!cert.is_ca());
        assert_eq!(cert.validity().not_before.timestamp(), unix(now) - 86_400);
        assert_eq!(
            cert.validity().not_after.timestamp(),
            unix(now) + 7 * 86_400
        );
        assert_eq!(cert.issuer(), parse(ca.anchor_der()).subject());
        // Chains to the attempt anchor for exactly that name.
        verify_leaf(&ca, &der, name, now);
    }
    // One leaf key pair per attempt.
    let a = parse(&leaf_der(&ca, "a.test:443", now))
        .public_key()
        .raw
        .to_vec();
    let b = parse(&leaf_der(&ca, "b.test:443", now))
        .public_key()
        .raw
        .to_vec();
    assert_eq!(a, b);
}

#[test]
fn leaves_are_cached_and_reminted_within_a_day_of_expiry() {
    let now = SystemTime::now();
    let ca = InterceptAuthority::generate_at(now).unwrap();
    let first = leaf_der(&ca, "upstream.test:443", now);
    let later = now + Duration::from_secs(5 * 86_400);
    assert_eq!(leaf_der(&ca, "upstream.test:443", later), first);
    let near_expiry = now + Duration::from_secs(6 * 86_400 + 3_600);
    let second = leaf_der(&ca, "upstream.test:443", near_expiry);
    assert_ne!(second, first);
    assert_eq!(
        parse(&second).validity().not_after.timestamp(),
        unix(near_expiry) + 7 * 86_400
    );
    // A handshake that began just before the re-mint is still recognised.
    assert!(ca.admits_leaf("upstream.test", 443, &first));
    assert!(ca.admits_leaf("upstream.test", 443, &second));
    let third = leaf_der(
        &ca,
        "upstream.test:443",
        near_expiry + Duration::from_secs(6 * 86_400 + 3_600),
    );
    assert!(!ca.admits_leaf("upstream.test", 443, &first));
    assert!(ca.admits_leaf("upstream.test", 443, &third));
}

#[test]
fn leaf_cache_is_bounded_lru() {
    let now = SystemTime::now();
    let ca = InterceptAuthority::generate_at(now).unwrap();
    let first = leaf_der(&ca, "h0.test:443", now);
    let second = leaf_der(&ca, "h1.test:443", now);
    for i in 2..LEAF_CACHE {
        leaf_der(&ca, &format!("h{i}.test:443"), now);
    }
    assert_eq!(ca.cached_leaves(), LEAF_CACHE);
    // Touch h0 so h1 is now the least recently used.
    assert_eq!(leaf_der(&ca, "h0.test:443", now), first);
    leaf_der(&ca, "overflow.test:443", now);
    assert_eq!(ca.cached_leaves(), LEAF_CACHE);
    assert!(ca.admits_leaf("h0.test", 443, &first));
    assert!(!ca.admits_leaf("h1.test", 443, &second));
}

#[test]
fn admits_only_its_own_leaf_for_the_exact_authority() {
    let now = SystemTime::now();
    let ca = InterceptAuthority::generate_at(now).unwrap();
    let foreign = InterceptAuthority::generate_at(now).unwrap();
    let leaf = leaf_der(&ca, "upstream.test:443", now);
    let foreign_leaf = leaf_der(&foreign, "upstream.test:443", now);
    assert!(ca.admits_leaf("upstream.test", 443, &leaf));
    assert!(ca.admits_leaf("UPSTREAM.test", 443, &leaf));
    assert!(!ca.admits_leaf("upstream.test", 8443, &leaf));
    assert!(!ca.admits_leaf("other.test", 443, &leaf));
    assert!(!ca.admits_leaf("upstream.test", 443, &foreign_leaf));
    assert!(!ca.admits_leaf("upstream.test", 443, ca.anchor_der()));
    assert!(!ca.admits_leaf("upstream.test", 443, b"\x30\x00"));
    assert!(!ca.admits_leaf("upstream.test:443", 443, &leaf));
    let v6 = leaf_der(&ca, "[::1]:443", now);
    assert!(ca.admits_leaf("[::1]", 443, &v6));
    assert!(ca.admits_leaf("::1", 443, &v6));
    assert!(!ca.admits_leaf("::2", 443, &v6));
}

#[test]
fn server_config_alpn_is_the_offer_intersected_with_h2_and_http11() {
    let ca = InterceptAuthority::generate().unwrap();
    let target = authority("upstream.test:443");
    let offer = |list: &[&[u8]]| list.iter().map(|p| p.to_vec()).collect::<Vec<_>>();
    let alpn = |list: &[&[u8]]| {
        ca.server_config(&target, &offer(list))
            .unwrap()
            .alpn_protocols
            .clone()
    };
    assert_eq!(
        alpn(&[b"http/1.1", b"h2", b"spdy/3"]),
        vec![b"h2".to_vec(), b"http/1.1".to_vec()]
    );
    assert_eq!(alpn(&[b"http/1.1"]), vec![b"http/1.1".to_vec()]);
    assert!(alpn(&[b"h3", b"spdy/3"]).is_empty());
    assert!(alpn(&[]).is_empty());
    let config = ca.server_config(&target, &offer(&[b"h2"])).unwrap();
    assert_eq!(config.send_tls13_tickets, 0);
}

#[test]
fn sni_must_name_the_connect_host_and_is_absent_only_for_ip_literals() {
    let dns = authority("upstream.test:443");
    let v4 = authority("127.0.0.1:443");
    let v6 = authority("[::1]:443");
    assert!(accept::sni_matches(Some("upstream.test"), &dns));
    assert!(accept::sni_matches(Some("Upstream.TEST"), &dns));
    assert!(!accept::sni_matches(Some("other.test"), &dns));
    assert!(!accept::sni_matches(None, &dns));
    assert!(accept::sni_matches(None, &v4));
    assert!(accept::sni_matches(None, &v6));
    assert!(!accept::sni_matches(Some("127.0.0.1"), &v4));
    assert!(!accept::sni_matches(Some("upstream.test"), &v4));
}

#[test]
fn hosts_and_upstream_uris_are_canonical() {
    assert_eq!(
        forward::parse_host("Upstream.test", 443),
        Some(authority("upstream.test:443"))
    );
    assert_eq!(
        forward::parse_host("upstream.test:8443", 443),
        Some(authority("upstream.test:8443"))
    );
    assert_eq!(
        forward::parse_host("[::1]", 80),
        Some(authority("[::1]:80"))
    );
    assert_eq!(forward::parse_host("user@upstream.test", 443), None);
    assert_eq!(
        forward::host_text(&authority("upstream.test:443"), true),
        "upstream.test"
    );
    assert_eq!(
        forward::host_text(&authority("upstream.test:443"), false),
        "upstream.test:443"
    );
    assert_eq!(forward::host_text(&authority("[::1]:80"), false), "[::1]");
    let ctx = ExchangeCtx {
        authority: authority("upstream.test:8443"),
        secure: true,
    };
    assert_eq!(
        forward::upstream_uri(&ctx, &"/a?b=1".parse().unwrap())
            .unwrap()
            .to_string(),
        "https://upstream.test:8443/a?b=1"
    );
    // The request's own authority never steers the upstream.
    assert_eq!(
        forward::upstream_uri(&ctx, &"https://evil.test/x".parse().unwrap())
            .unwrap()
            .to_string(),
        "https://upstream.test:8443/x"
    );
    assert!(forward::upstream_uri(&ctx, &"*".parse().unwrap()).is_none());
}

async fn assert_synthetic(response: Response<ProxyBody>, status: StatusCode, tag: Option<&str>) {
    assert_eq!(response.status(), status);
    assert_eq!(response.headers()[header::CACHE_CONTROL], "no-store");
    assert_eq!(
        response
            .headers()
            .get(UPSTREAM_TAG)
            .map(|v| v.to_str().unwrap()),
        tag
    );
    let page = response.into_body().collect().await.unwrap().to_bytes();
    let page = String::from_utf8_lossy(&page).to_ascii_lowercase();
    assert!(page.contains("<html"));
    for forbidden in ["<script", "<form", "<input", "javascript:", "postmessage"] {
        assert!(!page.contains(forbidden), "{forbidden}");
    }
}

#[tokio::test]
async fn upstream_failures_map_to_static_no_store_502s() {
    for (failure, tag) in [
        (UpstreamFailure::Denied, "certificate-denied"),
        (UpstreamFailure::Timeout, "review-timeout"),
        (
            UpstreamFailure::Fatal(UpstreamFatal::HstsViolation),
            "fatal",
        ),
        (UpstreamFailure::RouteFailed, "route-failed"),
    ] {
        assert_synthetic(
            forward::upstream_failure(failure),
            StatusCode::BAD_GATEWAY,
            Some(tag),
        )
        .await;
    }
    assert_eq!(forward::RESPONSE_HEAD_TIMEOUT, Duration::from_secs(300));
}

// ======================================================= relay tests ===

#[tokio::test]
async fn h1_tunnel_get_post_and_keep_alive() {
    let h = harness().await;
    let tls = tunnel(
        &h.proxy,
        "upstream.test:443",
        "upstream.test",
        &[ALPN_HTTP11],
        true,
    )
    .await
    .unwrap();
    assert_eq!(tls.get_ref().1.alpn_protocol(), Some(ALPN_HTTP11));
    // The served leaf is one the CEF hook would admit for this authority.
    let leaf = tls.get_ref().1.peer_certificates().unwrap()[0].to_vec();
    assert!(h
        .proxy
        .intercept_authority()
        .unwrap()
        .admits_leaf("upstream.test", 443, &leaf));
    let mut sender = h1(tls).await;
    let response = send1(&mut sender, get("/hello", Some("upstream.test"))).await;
    assert_eq!(response.status(), StatusCode::OK);
    // Alt-Svc is always stripped.
    assert!(!response.headers().contains_key(header::ALT_SVC));
    assert_eq!(body(response).await, "hello");
    let post = Request::post("/echo")
        .header(header::HOST, "upstream.test")
        .body(Full::new(Bytes::from_static(b"posted body")).boxed())
        .unwrap();
    let response = send1(&mut sender, post).await;
    assert_eq!(body(response).await, "posted body");
    // Same tunnel, explicit default port.
    let response = send1(&mut sender, get("/hello", Some("upstream.test:443"))).await;
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(h.upstream.requests.load(Ordering::SeqCst), 3);
    assert!(h.proxy.upstream_admitted(&authority("upstream.test:443")));
    assert!(!h.proxy.upstream_admitted(&authority("other.test:443")));
}

#[tokio::test]
async fn h2_tunnel_get_post_and_multiplexing() {
    let h = harness().await;
    let mut sender = h2_tunnel(&h).await;
    let response = send2(&mut sender, get("https://upstream.test/hello", None)).await;
    assert_eq!(response.status(), StatusCode::OK);
    assert!(!response.headers().contains_key(header::ALT_SVC));
    assert_eq!(body(response).await, "hello");
    let mut handles = Vec::new();
    for i in 0..8 {
        let mut sender = sender.clone();
        handles.push(tokio::spawn(async move {
            let post = Request::post("https://upstream.test/echo")
                .body(Full::new(Bytes::from(format!("stream {i}"))).boxed())
                .unwrap();
            let response = send2(&mut sender, post).await;
            body(response).await
        }));
    }
    for (i, handle) in handles.into_iter().enumerate() {
        assert_eq!(handle.await.unwrap(), format!("stream {i}"));
    }
}

/// A streaming request body fed one chunk at a time.
fn upload_channel() -> (tokio::sync::mpsc::Sender<Bytes>, ClientBody) {
    let (tx, rx) = tokio::sync::mpsc::channel::<Bytes>(1);
    let stream = futures_util::stream::unfold(rx, |mut rx| async move {
        rx.recv()
            .await
            .map(|data| (Ok::<_, Infallible>(Frame::data(data)), rx))
    });
    (tx, StreamBody::new(stream).boxed())
}

async fn lockstep_echo(
    send: impl std::future::Future<Output = Response<Incoming>>,
    tx: tokio::sync::mpsc::Sender<Bytes>,
) {
    // The first chunk must reach upstream before the response head exists.
    let first = pattern(0);
    let (response, ()) = tokio::join!(send, async {
        tx.send(first).await.unwrap();
    });
    assert_eq!(response.status(), StatusCode::OK);
    let mut incoming = response.into_body();
    let mut received = 0usize;
    let rounds = 128; // 8 MiB, one chunk in flight at a time.
    for round in 0..rounds {
        // Nothing is sent until the previous chunk came back: a proxy that
        // buffered either body whole would deadlock here.
        while received < (round + 1) * CHUNK {
            let frame = timeout(DEADLINE, incoming.frame())
                .await
                .unwrap()
                .unwrap()
                .unwrap();
            if let Ok(data) = frame.into_data() {
                assert!(data.iter().all(|b| *b == (round % 251) as u8));
                received += data.len();
            }
        }
        if round + 1 < rounds {
            tx.send(pattern(round + 1)).await.unwrap();
        }
    }
    drop(tx);
    // h2 may end the stream with an empty DATA frame.
    while let Some(frame) = timeout(DEADLINE, incoming.frame()).await.unwrap() {
        let data = frame.unwrap().into_data().unwrap();
        assert!(data.is_empty());
    }
    assert_eq!(received, rounds * CHUNK);
}

async fn big_download(response: Response<Incoming>) {
    let mut incoming = response.into_body();
    let mut received = 0usize;
    while let Some(frame) = timeout(DEADLINE, incoming.frame()).await.unwrap() {
        if let Ok(data) = frame.unwrap().into_data() {
            received += data.len();
        }
    }
    assert_eq!(received, BIG);
}

#[tokio::test]
async fn h1_streams_large_bodies_both_ways_without_buffering() {
    let h = harness().await;
    let mut sender = h1_tunnel(&h).await;
    let (tx, channel) = upload_channel();
    let request = Request::post("/echo")
        .header(header::HOST, "upstream.test")
        .body(channel)
        .unwrap();
    sender.ready().await.unwrap();
    let send = sender.send_request(request);
    lockstep_echo(async { send.await.unwrap() }, tx).await;
    big_download(send1(&mut sender, get("/big", Some("upstream.test"))).await).await;
}

#[tokio::test]
async fn h2_streams_large_bodies_both_ways_without_buffering() {
    let h = harness().await;
    let mut sender = h2_tunnel(&h).await;
    let (tx, channel) = upload_channel();
    let request = Request::post("https://upstream.test/echo")
        .body(channel)
        .unwrap();
    sender.ready().await.unwrap();
    let send = sender.send_request(request);
    lockstep_echo(async { send.await.unwrap() }, tx).await;
    big_download(send2(&mut sender, get("https://upstream.test/big", None)).await).await;
}

#[tokio::test]
async fn alpn_negotiation_selects_the_server() {
    let h = harness().await;
    for (offer, expected) in [
        (&[ALPN_H2, ALPN_HTTP11][..], Some(ALPN_H2)),
        (&[ALPN_HTTP11][..], Some(ALPN_HTTP11)),
        (&[][..], None),
        (&[b"spdy/3".as_slice()][..], None),
    ] {
        let tls = tunnel(&h.proxy, "upstream.test:443", "upstream.test", offer, true)
            .await
            .unwrap();
        assert_eq!(tls.get_ref().1.alpn_protocol(), expected);
        let response = if expected == Some(ALPN_H2) {
            send2(&mut h2(tls).await, get("https://upstream.test/hello", None)).await
        } else {
            send1(&mut h1(tls).await, get("/hello", Some("upstream.test"))).await
        };
        assert_eq!(response.status(), StatusCode::OK);
    }
}

#[tokio::test]
async fn sni_mismatch_or_missing_sni_closes_the_tunnel() {
    let h = harness().await;
    // SNI names another host than the CONNECT authority.
    assert!(tunnel(
        &h.proxy,
        "upstream.test:443",
        "other.test",
        &[ALPN_HTTP11],
        true
    )
    .await
    .is_err());
    // No SNI for a DNS authority.
    assert!(tunnel(
        &h.proxy,
        "upstream.test:443",
        "upstream.test",
        &[ALPN_HTTP11],
        false
    )
    .await
    .is_err());
    assert_eq!(h.dials.load(Ordering::SeqCst), 0);
    // IP literals arrive without SNI.
    for (target, name, host) in [
        ("127.0.0.1:443", "127.0.0.1", "127.0.0.1"),
        ("[::1]:443", "::1", "[::1]"),
    ] {
        let tls = tunnel(&h.proxy, target, name, &[ALPN_HTTP11], true)
            .await
            .unwrap();
        let response = send1(&mut h1(tls).await, get("/hello", Some(host))).await;
        assert_eq!(response.status(), StatusCode::OK, "{target}");
    }
}

#[tokio::test]
async fn misdirected_authority_gets_421_and_never_reaches_upstream() {
    let h = harness().await;
    let mut sender = h1_tunnel(&h).await;
    for host in ["other.test", "upstream.test:8443", "upstream.test.:443"] {
        let response = send1(&mut sender, get("/hello", Some(host))).await;
        assert_eq!(response.status(), StatusCode::MISDIRECTED_REQUEST, "{host}");
    }
    // Absolute-form naming another authority, even with a matching Host.
    let response = send1(
        &mut sender,
        get("https://other.test/hello", Some("upstream.test")),
    )
    .await;
    assert_eq!(response.status(), StatusCode::MISDIRECTED_REQUEST);
    let mut sender = h2_tunnel(&h).await;
    let response = send2(&mut sender, get("https://other.test/hello", None)).await;
    assert_eq!(response.status(), StatusCode::MISDIRECTED_REQUEST);
    let response = send2(
        &mut sender,
        get("https://upstream.test/hello", Some("other.test")),
    )
    .await;
    assert_eq!(response.status(), StatusCode::MISDIRECTED_REQUEST);
    assert_eq!(h.upstream.requests.load(Ordering::SeqCst), 0);
    assert_eq!(h.dials.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn h2_never_advertises_extended_connect_and_connect_is_refused() {
    let h = harness().await;
    let mut tls = tunnel(
        &h.proxy,
        "upstream.test:443",
        "upstream.test",
        &[ALPN_H2],
        true,
    )
    .await
    .unwrap();
    tls.write_all(b"PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n\x00\x00\x00\x04\x00\x00\x00\x00\x00")
        .await
        .unwrap();
    let mut frame = [0u8; 9];
    timeout(DEADLINE, tls.read_exact(&mut frame))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(frame[3], 0x4, "first server frame is SETTINGS");
    let length =
        (usize::from(frame[0]) << 16) | (usize::from(frame[1]) << 8) | usize::from(frame[2]);
    let mut payload = vec![0u8; length];
    timeout(DEADLINE, tls.read_exact(&mut payload))
        .await
        .unwrap()
        .unwrap();
    for setting in payload.chunks(6) {
        let id = u16::from_be_bytes([setting[0], setting[1]]);
        // SETTINGS_ENABLE_CONNECT_PROTOCOL (RFC 8441).
        assert_ne!(id, 0x8);
    }
    let mut sender = h1_tunnel(&h).await;
    let connect = Request::builder()
        .method(Method::CONNECT)
        .uri("upstream.test:443")
        .header(header::HOST, "upstream.test")
        .body(empty())
        .unwrap();
    let response = send1(&mut sender, connect).await;
    assert_eq!(response.status(), StatusCode::METHOD_NOT_ALLOWED);
}

fn websocket_request(uri: &str, host: &str) -> Request<ClientBody> {
    Request::get(uri)
        .header(header::HOST, host)
        .header(header::CONNECTION, "Upgrade")
        .header(header::UPGRADE, "websocket")
        .header("sec-websocket-version", "13")
        .header("sec-websocket-key", "dGhlIHNhbXBsZSBub25jZQ==")
        .body(empty())
        .unwrap()
}

async fn websocket_echo(
    sender: &mut H1,
    uri: &str,
    host: &str,
) -> TokioIo<hyper::upgrade::Upgraded> {
    let response = send1(sender, websocket_request(uri, host)).await;
    assert_eq!(response.status(), StatusCode::SWITCHING_PROTOCOLS);
    assert_eq!(response.headers()[header::UPGRADE], "websocket");
    assert_eq!(
        response.headers()["sec-websocket-accept"],
        "s3pPLMBiTxaQ9kYGzzhZRbK+xOo="
    );
    let mut io = TokioIo::new(
        timeout(DEADLINE, hyper::upgrade::on(response))
            .await
            .unwrap()
            .unwrap(),
    );
    io.write_all(b"ping frame").await.unwrap();
    let mut echoed = [0u8; 10];
    timeout(DEADLINE, io.read_exact(&mut echoed))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(&echoed, b"ping frame");
    io
}

#[tokio::test]
async fn websocket_upgrade_echoes_and_refusals_pass_through() {
    let h = harness().await;
    let mut sender = h1_tunnel(&h).await;
    let _io = websocket_echo(&mut sender, "/ws", "upstream.test").await;
    let mut sender = h1_tunnel(&h).await;
    let response = send1(
        &mut sender,
        websocket_request("/ws-refused", "upstream.test"),
    )
    .await;
    assert_eq!(response.status(), StatusCode::FORBIDDEN);
    assert_eq!(body(response).await, "no");
}

#[tokio::test]
async fn revoke_closes_tunnels_websockets_and_plain_connections() {
    let h = harness().await;
    let mut sender = h1_tunnel(&h).await;
    let mut websocket = websocket_echo(&mut sender, "/ws", "upstream.test").await;
    let mut h2_sender = h2_tunnel(&h).await;
    send2(&mut h2_sender, get("https://upstream.test/hello", None)).await;
    let mut idle = connect(&h.proxy, "upstream.test:443").await;
    h.proxy.revoke();
    closed(&mut websocket).await;
    closed(&mut idle).await;
    timeout(DEADLINE, async {
        while !h2_sender.is_closed() {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
    assert!(!h.proxy.upstream_admitted(&authority("upstream.test:443")));
}

#[tokio::test]
async fn grant_revoked_mid_tunnel_refuses_the_next_request() {
    let h = harness().await;
    let mut sender = h1_tunnel(&h).await;
    assert_eq!(
        send1(&mut sender, get("/hello", Some("upstream.test")))
            .await
            .status(),
        StatusCode::OK
    );
    h.allowed.store(false, Ordering::SeqCst);
    assert_eq!(
        send1(&mut sender, get("/hello", Some("upstream.test")))
            .await
            .status(),
        StatusCode::FORBIDDEN
    );
    assert_eq!(h.upstream.requests.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn intercepting_relay_never_offers_datagrams() {
    let grant: DestinationGrant = Arc::new(|_| true);
    let passthrough = PrivateForwardProxy::start(
        Arc::new(UdpCapableDialer),
        grant.clone(),
        ProxyLimits::default(),
    )
    .await
    .unwrap();
    assert!(passthrough.supports_datagrams());
    assert!(!passthrough.is_intercepting());
    assert!(passthrough.intercept_authority().is_none());
    assert!(passthrough.intercept_cache_use().is_none());
    let intercepting = PrivateForwardProxy::start_intercepting(
        Arc::new(UdpCapableDialer),
        grant,
        ProxyLimits::default(),
        config(
            InterceptAuthority::generate().unwrap(),
            Arc::new(DenyAllUpstreamTrust),
            Vec::new(),
        ),
    )
    .await
    .unwrap();
    assert!(intercepting.is_running());
    assert!(intercepting.is_intercepting());
    assert!(!intercepting.supports_datagrams());
    assert!(intercepting.datagrams.is_none());
    assert_eq!(intercepting.intercept_cache_use(), Some(CacheUse::Off));
    // MASQUE CONNECT-UDP is refused like on any TCP-only route.
    let mut stream = TcpStream::connect(intercepting.local_addr()).await.unwrap();
    stream
        .write_all(
            format!(
                "GET /.well-known/masque/udp/192.0.2.1/443/ HTTP/1.1\r\nHost: 127.0.0.1:{}\r\nProxy-Authorization: {}\r\nConnection: Upgrade\r\nUpgrade: connect-udp\r\nCapsule-Protocol: ?1\r\n\r\n",
                intercepting.local_addr().port(),
                proxy_auth(&intercepting)
            )
            .as_bytes(),
        )
        .await
        .unwrap();
    let head = read_head(&mut stream).await;
    assert!(!head.starts_with("HTTP/1.1 200"), "{head}");
}

#[tokio::test]
async fn trust_denial_timeout_and_route_failure_are_synthetic_502s() {
    for (trust, tag) in [
        (
            Arc::new(DenyAllUpstreamTrust) as Arc<dyn UpstreamTrust>,
            "certificate-denied",
        ),
        (
            Arc::new(TimesOut) as Arc<dyn UpstreamTrust>,
            "review-timeout",
        ),
    ] {
        let h = harness_with(true, trust, Vec::new()).await;
        let mut sender = h1_tunnel(&h).await;
        let response = send1(&mut sender, get("/hello", Some("upstream.test"))).await;
        assert_eq!(response.status(), StatusCode::BAD_GATEWAY);
        assert_eq!(response.headers()[UPSTREAM_TAG], tag);
        assert_eq!(response.headers()[header::CACHE_CONTROL], "no-store");
        let page = String::from_utf8_lossy(&body(response).await).to_ascii_lowercase();
        assert!(!page.contains("<script") && !page.contains("<form"));
        // Zero request bytes reached the denied upstream.
        assert_eq!(h.upstream.requests.load(Ordering::SeqCst), 0);
        assert!(!h.proxy.upstream_admitted(&authority("upstream.test:443")));
        // The WebSocket path fails closed the same way.
        let mut sender = h1_tunnel(&h).await;
        let response = send1(&mut sender, websocket_request("/ws", "upstream.test")).await;
        assert_eq!(response.status(), StatusCode::BAD_GATEWAY);
        assert_eq!(response.headers()[UPSTREAM_TAG], tag);
    }
    let pki = public_pki();
    let proxy = PrivateForwardProxy::start_intercepting_with_verifier(
        failing_dialer(),
        Arc::new(|_| true),
        ProxyLimits::default(),
        config(
            InterceptAuthority::generate().unwrap(),
            Arc::new(AdmitAll),
            Vec::new(),
        ),
        UpstreamVerifierConfig::for_tests(&[pki.root], &[]),
    )
    .await
    .unwrap();
    let tls = tunnel(
        &proxy,
        "upstream.test:443",
        "upstream.test",
        &[ALPN_HTTP11],
        true,
    )
    .await
    .unwrap();
    let response = send1(&mut h1(tls).await, get("/hello", Some("upstream.test"))).await;
    assert_eq!(response.status(), StatusCode::BAD_GATEWAY);
    assert_eq!(response.headers()[UPSTREAM_TAG], "route-failed");
}

#[tokio::test]
async fn hsts_is_recorded_for_tls_only_and_hop_headers_are_stripped() {
    let h = harness().await;
    let exchange = h.proxy.intercept.clone().unwrap();
    let mut sender = h1_tunnel(&h).await;
    send1(&mut sender, get("/hello", Some("upstream.test"))).await;
    assert_eq!(exchange.counters.hsts_marks.load(Ordering::Relaxed), 0);
    let response = send1(&mut sender, get("/hsts", Some("upstream.test"))).await;
    // The header itself passes through to the engine.
    assert!(response
        .headers()
        .contains_key(header::STRICT_TRANSPORT_SECURITY));
    assert_eq!(exchange.counters.hsts_marks.load(Ordering::Relaxed), 1);
    let response = send1(&mut sender, get("/hop", Some("upstream.test"))).await;
    assert!(!response.headers().contains_key("x-secret"));
    assert!(!response.headers().contains_key("keep-alive"));
    let request = Request::get("/headers")
        .header(header::HOST, "upstream.test")
        .header(header::CONNECTION, "x-private")
        .header("x-private", "1")
        .header("proxy-authorization", "Basic c2VjcmV0")
        .header("x-kept", "1")
        .body(empty())
        .unwrap();
    let seen = body(send1(&mut sender, request).await).await;
    let seen = String::from_utf8_lossy(&seen);
    assert!(seen.contains("x-kept: 1"), "{seen}");
    assert!(seen.contains("host: upstream.test"), "{seen}");
    assert!(!seen.contains("x-private"), "{seen}");
    assert!(!seen.contains("proxy-authorization"), "{seen}");
}

#[tokio::test]
async fn hook_verdicts_edits_refusals_and_panics() {
    let hook = Arc::new(RecordingHook::default());
    let h = harness_with(true, Arc::new(AdmitAll), vec![hook.clone()]).await;
    let mut sender = h1_tunnel(&h).await;
    let response = send1(&mut sender, get("/blocked", Some("upstream.test"))).await;
    assert_eq!(response.status(), StatusCode::FORBIDDEN);
    let response = send1(&mut sender, get("/static", Some("upstream.test"))).await;
    assert_eq!(response.status(), StatusCode::IM_A_TEAPOT);
    assert_eq!(response.headers()[header::CACHE_CONTROL], "no-store");
    assert_eq!(body(response).await, "from hook");
    let response = send1(&mut sender, get("/panic", Some("upstream.test"))).await;
    assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);
    assert_eq!(response.headers()[header::CACHE_CONTROL], "no-store");
    body(response).await;
    // Nothing above reached upstream: block/respond/panic never skip a hook.
    assert_eq!(h.upstream.requests.load(Ordering::SeqCst), 0);
    let response = send1(&mut sender, get("/headers", Some("upstream.test"))).await;
    assert_eq!(response.headers()["x-response-hook"], "1");
    assert!(!response.headers().contains_key(header::ALT_SVC));
    assert!(!response.headers().contains_key(header::SET_COOKIE));
    let seen = body(response).await;
    let seen = String::from_utf8_lossy(&seen);
    assert!(seen.contains("x-hooked: 1"), "{seen}");
    assert!(seen.contains("host: upstream.test"), "{seen}");
    let response = send1(&mut sender, get("/panic-response", Some("upstream.test"))).await;
    assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);
    let refusals = hook.refusals.lock().unwrap().clone();
    assert!(refusals.len() >= 6);
    assert!(refusals.iter().all(|refused| *refused), "{refusals:?}");
    let exchange = h.proxy.intercept.clone().unwrap();
    assert_eq!(exchange.counters.hook_failures.load(Ordering::Relaxed), 2);
}

// ================================================ plain HTTP keep-alive ===

async fn plain(h: &Harness) -> H1 {
    h1(TcpStream::connect(h.proxy.local_addr()).await.unwrap()).await
}

fn plain_get(path: &str, auth: Option<&str>) -> Request<ClientBody> {
    let mut builder =
        Request::get(format!("http://upstream.test{path}")).header(header::HOST, "upstream.test");
    if let Some(auth) = auth {
        builder = builder.header(header::PROXY_AUTHORIZATION, auth);
    }
    builder.body(empty()).unwrap()
}

#[tokio::test]
async fn plain_http_keeps_alive_and_authenticates_every_request() {
    let h = harness_with(false, Arc::new(AdmitAll), Vec::new()).await;
    let auth = proxy_auth(&h.proxy);
    let mut sender = plain(&h).await;
    for _ in 0..3 {
        let response = send1(&mut sender, plain_get("/hello", Some(&auth))).await;
        assert_eq!(response.status(), StatusCode::OK);
        assert!(!response.headers().contains_key(header::ALT_SVC));
        assert_eq!(body(response).await, "hello");
    }
    // Proxy credentials never travel upstream.
    let seen = body(send1(&mut sender, plain_get("/headers", Some(&auth))).await).await;
    assert!(!String::from_utf8_lossy(&seen).contains("proxy-authorization"));
    // A later request without (or with wrong) credentials is challenged, and
    // the connection is closed rather than reused.
    let response = send1(&mut sender, plain_get("/hello", None)).await;
    assert_eq!(response.status(), StatusCode::PROXY_AUTHENTICATION_REQUIRED);
    assert_eq!(
        response.headers()[header::PROXY_AUTHENTICATE],
        "Basic realm=\"private-forward-proxy\""
    );
    body(response).await;
    timeout(DEADLINE, async {
        while !sender.is_closed() {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
    let mut sender = plain(&h).await;
    assert_eq!(
        send1(&mut sender, plain_get("/hello", Some(&auth)))
            .await
            .status(),
        StatusCode::OK
    );
    assert_eq!(
        send1(
            &mut sender,
            plain_get("/hello", Some("Basic d3Jvbmc6d3Jvbmc="))
        )
        .await
        .status(),
        StatusCode::PROXY_AUTHENTICATION_REQUIRED
    );
    assert_eq!(h.upstream.requests.load(Ordering::SeqCst), 5);
    // HSTS over plain HTTP is not a signal.
    let exchange = h.proxy.intercept.clone().unwrap();
    let mut sender = plain(&h).await;
    send1(&mut sender, plain_get("/hsts", Some(&auth))).await;
    assert_eq!(exchange.counters.hsts_marks.load(Ordering::Relaxed), 0);
}

#[tokio::test]
async fn plain_http_grant_revoked_mid_connection_refuses_the_next_request() {
    let h = harness_with(false, Arc::new(AdmitAll), Vec::new()).await;
    let auth = proxy_auth(&h.proxy);
    let mut sender = plain(&h).await;
    let post = Request::post("http://upstream.test/echo")
        .header(header::HOST, "upstream.test")
        .header(header::PROXY_AUTHORIZATION, &auth)
        .body(Full::new(Bytes::from_static(b"plain upload")).boxed())
        .unwrap();
    assert_eq!(body(send1(&mut sender, post).await).await, "plain upload");
    h.allowed.store(false, Ordering::SeqCst);
    assert_eq!(
        send1(&mut sender, plain_get("/hello", Some(&auth)))
            .await
            .status(),
        StatusCode::FORBIDDEN
    );
    assert_eq!(h.upstream.requests.load(Ordering::SeqCst), 1);
    assert_eq!(h.proxy.diagnostics().destination_denials, 1);
}

#[tokio::test]
async fn plain_http_websocket_and_mismatched_host() {
    let h = harness_with(false, Arc::new(AdmitAll), Vec::new()).await;
    let auth = proxy_auth(&h.proxy);
    let mut sender = plain(&h).await;
    let mut request = websocket_request("http://upstream.test/ws", "upstream.test");
    request
        .headers_mut()
        .insert(header::PROXY_AUTHORIZATION, auth.parse().unwrap());
    let response = send1(&mut sender, request).await;
    assert_eq!(response.status(), StatusCode::SWITCHING_PROTOCOLS);
    let mut io = TokioIo::new(hyper::upgrade::on(response).await.unwrap());
    io.write_all(b"plain ws").await.unwrap();
    let mut echoed = [0u8; 8];
    timeout(DEADLINE, io.read_exact(&mut echoed))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(&echoed, b"plain ws");
    let mut sender = plain(&h).await;
    let request = Request::get("http://upstream.test/hello")
        .header(header::HOST, "other.test")
        .header(header::PROXY_AUTHORIZATION, &auth)
        .body(empty())
        .unwrap();
    // The first request is validated at admission: mismatched Host is a 400.
    let response = timeout(DEADLINE, async {
        sender.ready().await.unwrap();
        sender.send_request(request).await
    })
    .await
    .unwrap();
    assert!(response.is_err() || response.unwrap().status() == StatusCode::BAD_REQUEST);
}

// ================================================== origin browser K4 ===

#[tokio::test]
async fn session_exposes_the_attempt_authority_and_upstream_admission() {
    let pki = public_pki();
    let upstream = upstream(Some(pki.server_config(&[ALPN_H2, ALPN_HTTP11]))).await;
    let policy = crate::origin_browser::OriginBrowserPolicy::new(
        "owner-db",
        "connection-1",
        "session-1",
        "https://upstream.test",
    )
    .unwrap();
    let authority_ca = InterceptAuthority::generate().unwrap();
    let mut session =
        crate::origin_browser::OriginBrowserSession::start_intercepting_with_verifier(
            policy,
            dialer_to(upstream.address, Arc::new(AtomicUsize::new(0))),
            ProxyLimits::default(),
            config(authority_ca.clone(), Arc::new(AdmitAll), Vec::new()),
            UpstreamVerifierConfig::for_tests(std::slice::from_ref(&pki.root), &[]),
        )
        .await
        .unwrap();
    let exposed = session.intercept_authority().unwrap();
    assert_eq!(exposed.anchor_der(), authority_ca.anchor_der());
    assert!(!session.supports_datagrams());
    assert!(!session.upstream_admitted("https://upstream.test"));
    let mut stream = TcpStream::connect(session.proxy_endpoint()).await.unwrap();
    let auth = session
        .with_proxy_credentials(|user, password| {
            format!(
                "Basic {}",
                base64::engine::general_purpose::STANDARD.encode(format!("{user}:{password}"))
            )
        })
        .unwrap();
    stream
        .write_all(
            format!(
                "CONNECT upstream.test:443 HTTP/1.1\r\nHost: upstream.test:443\r\nProxy-Authorization: {auth}\r\n\r\n"
            )
            .as_bytes(),
        )
        .await
        .unwrap();
    assert!(read_head(&mut stream).await.starts_with("HTTP/1.1 200 "));
    let tls =
        tokio_rustls::TlsConnector::from(client_config(exposed.anchor_der(), &[ALPN_HTTP11], true))
            .connect(ServerName::try_from("upstream.test").unwrap(), stream)
            .await
            .unwrap();
    let response = send1(&mut h1(tls).await, get("/hello", Some("upstream.test"))).await;
    assert_eq!(response.status(), StatusCode::OK);
    assert!(session.upstream_admitted("https://upstream.test"));
    assert!(session.upstream_admitted("https://upstream.test:443"));
    assert!(!session.upstream_admitted("https://upstream.test:8443"));
    assert!(!session.upstream_admitted("https://other.test"));
    assert!(!session.upstream_admitted("not an origin"));
    session.stop().await.unwrap();
    assert!(!session.upstream_admitted("https://upstream.test"));
    // Passthrough sessions never intercept.
    let policy = crate::origin_browser::OriginBrowserPolicy::new(
        "owner-db",
        "connection-1",
        "session-2",
        "https://upstream.test",
    )
    .unwrap();
    let passthrough = crate::origin_browser::OriginBrowserSession::start(
        policy,
        failing_dialer(),
        ProxyLimits::default(),
    )
    .await
    .unwrap();
    assert!(passthrough.intercept_authority().is_none());
    assert!(!passthrough.upstream_admitted("https://upstream.test"));
}

// ============================================================ cache ===

async fn fresh_cache_hit(path: &str) {
    let h = harness_cached(
        true,
        Arc::new(AdmitAll),
        Vec::new(),
        CacheMode::Memory {
            max_bytes: 1024 * 1024,
        },
    )
    .await;
    assert!(matches!(
        h.proxy.intercept_cache_use(),
        Some(CacheUse::Memory(_))
    ));
    let exchange = h.proxy.intercept.clone().unwrap();
    let mut sender = h1_tunnel(&h).await;
    let first = send1(&mut sender, get(path, Some("upstream.test"))).await;
    assert_eq!(first.status(), StatusCode::OK);
    assert!(!first.headers().contains_key(header::ALT_SVC));
    assert_eq!(body(first).await, "cached 1");
    assert_eq!(exchange.cache_counters().stores, 1);
    let mut sender = h2_tunnel(&h).await;
    let second = send2(
        &mut sender,
        get(&format!("https://upstream.test{path}"), None),
    )
    .await;
    assert_eq!(second.status(), StatusCode::OK);
    // Served from the proxy cache: same body, no second upstream request,
    // and the built-in Alt-Svc strip still applied on serve.
    assert!(!second.headers().contains_key(header::ALT_SVC));
    assert_eq!(body(second).await, "cached 1");
    assert_eq!(h.upstream.requests.load(Ordering::SeqCst), 1);
    assert_eq!(exchange.cache_counters().hits, 1);
}

#[tokio::test]
async fn fresh_cache_hits_skip_upstream_and_still_pass_response_hooks() {
    fresh_cache_hit("/cached-chunked").await;
}

#[tokio::test]
async fn fresh_cache_hits_for_content_length_responses() {
    fresh_cache_hit("/cached").await;
}

#[tokio::test]
async fn cache_keys_carry_the_scheme_so_http_never_shares_an_https_entry() {
    let pki = public_pki();
    let upstream = upstream_with(Some(pki.server_config(&[ALPN_HTTP11])), true).await;
    let proxy = PrivateForwardProxy::start_intercepting_with_verifier(
        dialer_to(upstream.address, Arc::new(AtomicUsize::new(0))),
        Arc::new(|_| true),
        ProxyLimits::default(),
        InterceptConfig {
            cache: CacheMode::Memory {
                max_bytes: 1024 * 1024,
            },
            ..config(
                InterceptAuthority::generate().unwrap(),
                Arc::new(AdmitAll),
                Vec::new(),
            )
        },
        UpstreamVerifierConfig::for_tests(std::slice::from_ref(&pki.root), &[]),
    )
    .await
    .unwrap();
    // https://upstream.test:443/cached through an intercepted tunnel.
    let tls = tunnel(
        &proxy,
        "upstream.test:443",
        "upstream.test",
        &[ALPN_HTTP11],
        true,
    )
    .await
    .unwrap();
    let mut secure = h1(tls).await;
    let response = send1(&mut secure, get("/cached", Some("upstream.test"))).await;
    assert_eq!(body(response).await, "cached 1");
    // http://upstream.test:443/cached: same authority and path, other scheme.
    let auth = proxy_auth(&proxy);
    let plain_get = || {
        Request::get("http://upstream.test:443/cached")
            .header(header::HOST, "upstream.test:443")
            .header(header::PROXY_AUTHORIZATION, &auth)
            .body(empty())
            .unwrap()
    };
    let mut plain = h1(TcpStream::connect(proxy.local_addr()).await.unwrap()).await;
    let response = send1(&mut plain, plain_get()).await;
    assert_eq!(
        body(response).await,
        "cached 2",
        "http must miss the https entry"
    );
    let response = send1(&mut plain, plain_get()).await;
    assert_eq!(body(response).await, "cached 2", "http has its own entry");
    let response = send1(&mut secure, get("/cached", Some("upstream.test"))).await;
    assert_eq!(body(response).await, "cached 1", "https entry is intact");
    assert_eq!(upstream.requests.load(Ordering::SeqCst), 2);
    let counters = proxy.intercept_cache_counters().unwrap();
    assert_eq!((counters.hits, counters.stores), (2, 2));
}
