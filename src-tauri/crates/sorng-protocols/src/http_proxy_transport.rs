//! Certificate inspection over the same explicit route used by the web mediator.
//! No direct fallback is allowed when a proxy is configured.
//!
//! Every network stage has its own budget inside one overall deadline, and a
//! failure reports the stage it stopped in with measured timings.

// The structured error is built once, on the failure path of a user-visible
// inspection; boxing it would only obscure the IPC contract.
#![allow(clippy::result_large_err)]

use super::{
    build_tls_config, capture_peer_certificate_chain, tls_server_name, TlsCertificateInfo,
};
use base64::Engine;
use serde::Serialize;
use std::future::Future;
use std::io;
use std::net::SocketAddr;
use std::pin::Pin;
use std::time::{Duration, Instant};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tokio::net::TcpStream;

trait CertificateSocket: AsyncRead + AsyncWrite + Unpin + Send {}
impl<T: AsyncRead + AsyncWrite + Unpin + Send> CertificateSocket for T {}
type Socket = Box<dyn CertificateSocket>;

const MAX_CONNECT_HEADER_BYTES: usize = 16 * 1024;
// Keeps `addresses_tried` bounded; the overall deadline already bounds time.
const MAX_ADDRESSES: usize = 16;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum InspectionStage {
    Target,
    Resolve,
    Connect,
    ProxyConnect,
    ProxyTls,
    ProxyTunnel,
    TlsHandshake,
    Certificate,
    Verifier,
}

impl InspectionStage {
    fn label(self) -> &'static str {
        match self {
            Self::Target => "target",
            Self::Resolve => "name resolution",
            Self::Connect => "TCP connect",
            Self::ProxyConnect => "proxy connect",
            Self::ProxyTls => "proxy TLS",
            Self::ProxyTunnel => "proxy tunnel",
            Self::TlsHandshake => "TLS handshake",
            Self::Certificate => "certificate",
            Self::Verifier => "verifier",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum InspectionFailureKind {
    InvalidTarget,
    DnsFailure,
    ConnectTimeout,
    ConnectionRefused,
    HostUnreachable,
    ConnectFailed,
    ProxyInvalid,
    ProxyUnreachable,
    ProxyTlsFailed,
    ProxyAuthRejected,
    ProxyTunnelRejected,
    ProxyTunnelTimeout,
    ProxyProtocolError,
    TlsHandshakeTimeout,
    TlsHandshakeFailed,
    CertificateUnreadable,
    InspectionUnavailable,
    DeadlineExceeded,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum InspectionRoute {
    Direct,
    Proxy,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum TlsFailureReason {
    NotTls,
    PeerClosed,
    Alert,
    Certificate,
    Other,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct CompletedStage {
    pub stage: InspectionStage,
    pub elapsed_ms: u64,
}

/// Structured inspection failure sent over IPC. It never carries the proxy
/// URL, proxy credentials, or upstream response text.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct CertificateInspectionError {
    pub kind: InspectionFailureKind,
    pub stage: InspectionStage,
    pub route: InspectionRoute,
    /// Requested authority (`host:port`, `[v6]:port`); empty for an invalid target.
    pub target: String,
    /// Last socket address dialled on the direct route.
    pub address: Option<String>,
    pub addresses_tried: u16,
    /// Measured since inspection start.
    pub elapsed_ms: u64,
    /// Measured time in the failing stage.
    pub stage_elapsed_ms: u64,
    /// The budget that expired, if any.
    pub timeout_ms: Option<u64>,
    pub proxy_status: Option<u16>,
    pub tls_reason: Option<TlsFailureReason>,
    /// Stages that finished, in order, with their durations.
    pub completed: Vec<CompletedStage>,
    pub message: String,
}

impl std::fmt::Display for CertificateInspectionError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for CertificateInspectionError {}

/// Rust-only budgets. There is deliberately no IPC option to change them.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) struct InspectionTimeouts {
    pub(super) resolve: Duration,
    pub(super) connect: Duration,
    pub(super) per_address_floor: Duration,
    pub(super) proxy_tunnel: Duration,
    pub(super) tls_handshake: Duration,
    pub(super) overall: Duration,
}

impl InspectionTimeouts {
    // Windows abandons a silent SYN after about 21 s; 10 s still covers four
    // transmissions and matches the other native web connect timeouts.
    pub(super) const DEFAULT: Self = Self {
        resolve: Duration::from_secs(10),
        connect: Duration::from_secs(10),
        per_address_floor: Duration::from_secs(3),
        proxy_tunnel: Duration::from_secs(10),
        tls_handshake: Duration::from_secs(10),
        overall: Duration::from_secs(25),
    };
}

pub(super) type NetFuture<T> = Pin<Box<dyn Future<Output = io::Result<T>> + Send>>;

/// Name resolution and TCP dialing. Replaced only by Rust tests.
pub(super) trait InspectionNet: Sync {
    fn resolve(&self, authority: &str) -> NetFuture<Vec<SocketAddr>>;
    fn dial(&self, address: SocketAddr) -> NetFuture<TcpStream>;
}

pub(super) struct SystemNet;

impl InspectionNet for SystemNet {
    fn resolve(&self, authority: &str) -> NetFuture<Vec<SocketAddr>> {
        let authority = authority.to_owned();
        Box::pin(async move { Ok(tokio::net::lookup_host(authority).await?.collect()) })
    }

    fn dial(&self, address: SocketAddr) -> NetFuture<TcpStream> {
        Box::pin(TcpStream::connect(address))
    }
}

fn parse_proxy(proxy_url: &str) -> Result<url::Url, String> {
    let url =
        url::Url::parse(proxy_url).map_err(|_| "Invalid certificate proxy URL".to_string())?;
    if proxy_url.trim() != proxy_url
        || !matches!(url.scheme(), "http" | "https")
        || url.host_str().is_none()
        || url.port() == Some(0)
        || url.path() != "/"
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err("Certificate proxy must be an HTTP(S) authority".into());
    }
    Ok(url)
}

fn authority(host: &str, port: u16) -> Result<String, String> {
    if port == 0
        || host.is_empty()
        || host
            .chars()
            .any(|c| c.is_whitespace() || "/\\@?#".contains(c))
    {
        return Err("Invalid certificate target authority".into());
    }
    // URL parsing normalizes DNS/IPv6 while refusing header delimiters.
    let host = host.trim_start_matches('[').trim_end_matches(']');
    let host = if host.contains(':') {
        format!("[{host}]")
    } else {
        host.to_string()
    };
    let parsed = url::Url::parse(&format!("https://{host}:{port}/"))
        .map_err(|_| "Invalid certificate target authority".to_string())?;
    if !parsed.username().is_empty() || parsed.password().is_some() || parsed.host_str().is_none() {
        return Err("Invalid certificate target authority".into());
    }
    Ok(format!(
        "{}:{port}",
        parsed.host_str().expect("validated host")
    ))
}

fn decode_user_info(value: &str) -> String {
    // form_urlencoded decodes percent escapes; literal '+' is not a space in
    // URL user-info, so protect it first. Values enter Base64, never raw headers.
    url::form_urlencoded::parse(
        format!("v={}", value.replace('+', "%2B").replace('&', "%26")).as_bytes(),
    )
    .next()
    .map(|(_, value)| value.into_owned())
    .unwrap_or_default()
}

fn millis(duration: Duration) -> u64 {
    u64::try_from(duration.as_millis()).unwrap_or(u64::MAX)
}

/// `N ms` below one second, otherwise tenths of a second rounded half up.
/// Integer math keeps this identical to JavaScript `toFixed(1)` on whole ms.
fn format_elapsed(ms: u64) -> String {
    if ms < 1000 {
        return format!("{ms} ms");
    }
    let tenths = ms.saturating_add(50) / 100;
    format!("{}.{} s", tenths / 10, tenths % 10)
}

// Scope ids are dropped so the address stays a plain `ip:port` authority.
fn socket_address(address: SocketAddr) -> String {
    match address {
        SocketAddr::V4(address) => address.to_string(),
        SocketAddr::V6(address) => format!("[{}]:{}", address.ip(), address.port()),
    }
}

fn connect_failure_kind(error: &io::Error) -> InspectionFailureKind {
    match error.kind() {
        io::ErrorKind::TimedOut => InspectionFailureKind::ConnectTimeout,
        io::ErrorKind::ConnectionRefused => InspectionFailureKind::ConnectionRefused,
        io::ErrorKind::HostUnreachable | io::ErrorKind::NetworkUnreachable => {
            InspectionFailureKind::HostUnreachable
        }
        _ => InspectionFailureKind::ConnectFailed,
    }
}

fn tls_failure_reason(error: &io::Error) -> TlsFailureReason {
    // tokio-rustls wraps protocol failures as io::Error(InvalidData, rustls::Error).
    if let Some(error) = error
        .get_ref()
        .and_then(|inner| inner.downcast_ref::<rustls::Error>())
    {
        return match error {
            rustls::Error::InvalidMessage(_) => TlsFailureReason::NotTls,
            rustls::Error::AlertReceived(_) => TlsFailureReason::Alert,
            rustls::Error::InvalidCertificate(_)
            | rustls::Error::PeerMisbehaved(_)
            | rustls::Error::General(_) => TlsFailureReason::Certificate,
            _ => TlsFailureReason::Other,
        };
    }
    match error.kind() {
        io::ErrorKind::UnexpectedEof
        | io::ErrorKind::ConnectionReset
        | io::ErrorKind::ConnectionAborted
        | io::ErrorKind::BrokenPipe => TlsFailureReason::PeerClosed,
        _ => TlsFailureReason::Other,
    }
}

/// Technical sentence built only from the structured fields. Proxy-route
/// messages name neither the proxy nor the target.
fn describe(error: &CertificateInspectionError) -> String {
    use InspectionFailureKind as Kind;
    let stage_elapsed = format_elapsed(error.stage_elapsed_ms);
    let limit = error
        .timeout_ms
        .map_or_else(|| stage_elapsed.clone(), format_elapsed);
    let peer = match &error.address {
        Some(address) if *address != error.target => format!("{} ({address})", error.target),
        _ => error.target.clone(),
    };
    let tried = if error.addresses_tried > 1 {
        format!(" ({} addresses tried)", error.addresses_tried)
    } else {
        String::new()
    };
    let website = match error.route {
        InspectionRoute::Direct => peer.clone(),
        InspectionRoute::Proxy => "The website behind the configured proxy".to_string(),
    };
    let status = error.proxy_status.unwrap_or_default();
    match error.kind {
        Kind::InvalidTarget => "Invalid certificate target authority".into(),
        Kind::DnsFailure => {
            let host = error
                .target
                .rsplit_once(':')
                .map_or(error.target.as_str(), |(host, _)| host);
            match error.timeout_ms {
                Some(_) => format!("Could not resolve {host} within {limit}"),
                None => format!("Could not resolve {host} after {stage_elapsed}"),
            }
        }
        Kind::ConnectTimeout => format!("TCP connect to {peer} timed out after {limit}{tried}"),
        Kind::ConnectionRefused => {
            format!("{peer} refused the TCP connection after {stage_elapsed}{tried}")
        }
        Kind::HostUnreachable => {
            format!("No route to {peer} (host unreachable) after {stage_elapsed}{tried}")
        }
        Kind::ConnectFailed => format!("TCP connect to {peer} failed after {stage_elapsed}{tried}"),
        Kind::ProxyInvalid => "The configured proxy is not a valid HTTP(S) proxy authority".into(),
        Kind::ProxyUnreachable => match error.timeout_ms {
            Some(_) => format!("The configured proxy could not be reached within {limit}"),
            None => format!("The configured proxy could not be reached after {stage_elapsed}"),
        },
        Kind::ProxyTlsFailed => match error.timeout_ms {
            Some(_) => format!("The configured HTTPS proxy did not complete TLS within {limit}"),
            None => "The configured HTTPS proxy failed TLS verification".into(),
        },
        Kind::ProxyAuthRejected => {
            format!("The configured proxy rejected authentication (HTTP {status})")
        }
        Kind::ProxyTunnelRejected => {
            format!("The configured proxy could not open a tunnel (HTTP {status})")
        }
        Kind::ProxyTunnelTimeout => {
            format!("The configured proxy did not open a tunnel within {limit}")
        }
        Kind::ProxyProtocolError => {
            "The configured proxy returned an invalid CONNECT response".into()
        }
        Kind::TlsHandshakeTimeout => match error.route {
            InspectionRoute::Direct => {
                format!("{peer} accepted TCP but did not complete a TLS handshake within {limit}")
            }
            InspectionRoute::Proxy => {
                format!("{website} did not complete a TLS handshake within {limit}")
            }
        },
        Kind::TlsHandshakeFailed => match error.tls_reason {
            Some(TlsFailureReason::NotTls) => {
                format!("{website} answered with data that is not TLS")
            }
            Some(TlsFailureReason::PeerClosed) => {
                format!("{website} closed the connection during the TLS handshake")
            }
            Some(TlsFailureReason::Alert) => {
                format!("{website} rejected the TLS handshake with an alert")
            }
            Some(TlsFailureReason::Certificate) => {
                format!("{website} sent a certificate or handshake signature that could not be verified")
            }
            Some(TlsFailureReason::Other) | None => {
                format!("{website} could not complete a TLS handshake")
            }
        },
        Kind::CertificateUnreadable => "The server certificate could not be read".into(),
        Kind::InspectionUnavailable => "The local TLS inspection verifier is unavailable".into(),
        Kind::DeadlineExceeded => format!(
            "Certificate inspection did not finish within {limit} ({})",
            error.stage.label()
        ),
    }
}

/// A failure whose message is composed once every field is known.
struct Failure(CertificateInspectionError);

impl Failure {
    fn timeout(mut self, budget: Duration) -> Self {
        self.0.timeout_ms = Some(millis(budget));
        self
    }

    fn proxy_status(mut self, status: u16) -> Self {
        self.0.proxy_status = Some(status);
        self
    }

    fn tls_reason(mut self, reason: TlsFailureReason) -> Self {
        self.0.tls_reason = Some(reason);
        self
    }
}

impl From<Failure> for CertificateInspectionError {
    fn from(Failure(mut error): Failure) -> Self {
        error.message = describe(&error);
        error
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Expired {
    Stage(Duration),
    Overall,
}

enum DialError {
    Io(io::Error),
    TimedOut(Duration),
    Overall,
}

enum TunnelError {
    Status(u16),
    Protocol,
}

/// Measured progress of one inspection.
struct Attempt {
    timeouts: InspectionTimeouts,
    started: Instant,
    route: InspectionRoute,
    target: String,
    address: Option<SocketAddr>,
    addresses_tried: u16,
    stage: InspectionStage,
    stage_started: Instant,
    completed: Vec<CompletedStage>,
}

impl Attempt {
    fn new(route: InspectionRoute, timeouts: InspectionTimeouts) -> Self {
        let now = Instant::now();
        Self {
            timeouts,
            started: now,
            route,
            target: String::new(),
            address: None,
            addresses_tried: 0,
            stage: InspectionStage::Target,
            stage_started: now,
            completed: Vec::new(),
        }
    }

    fn begin(&mut self, stage: InspectionStage) {
        self.stage = stage;
        self.stage_started = Instant::now();
    }

    fn complete(&mut self) {
        self.completed.push(CompletedStage {
            stage: self.stage,
            elapsed_ms: millis(self.stage_started.elapsed()),
        });
    }

    /// Runs a step within its stage budget, or the remaining overall budget
    /// when that is shorter.
    async fn within<T>(
        &self,
        budget: Duration,
        step: impl Future<Output = T>,
    ) -> Result<T, Expired> {
        let remaining = self.timeouts.overall.saturating_sub(self.started.elapsed());
        let (limit, expired) = if remaining < budget {
            (remaining, Expired::Overall)
        } else {
            (budget, Expired::Stage(budget))
        };
        tokio::time::timeout(limit, step).await.map_err(|_| expired)
    }

    fn fail(&self, kind: InspectionFailureKind) -> Failure {
        let now = Instant::now();
        Failure(CertificateInspectionError {
            kind,
            stage: self.stage,
            route: self.route,
            target: self.target.clone(),
            address: self.address.map(socket_address),
            addresses_tried: self.addresses_tried,
            elapsed_ms: millis(now.saturating_duration_since(self.started)),
            stage_elapsed_ms: millis(now.saturating_duration_since(self.stage_started)),
            timeout_ms: None,
            proxy_status: None,
            tls_reason: None,
            completed: self.completed.clone(),
            message: String::new(),
        })
    }

    fn expired(&self, expired: Expired, kind: InspectionFailureKind) -> Failure {
        match expired {
            Expired::Stage(budget) => self.fail(kind).timeout(budget),
            Expired::Overall => self
                .fail(InspectionFailureKind::DeadlineExceeded)
                .timeout(self.timeouts.overall),
        }
    }

    async fn resolve(
        &self,
        net: &dyn InspectionNet,
        authority: &str,
    ) -> Result<Vec<SocketAddr>, Option<Expired>> {
        match self
            .within(self.timeouts.resolve, net.resolve(authority))
            .await
        {
            Ok(Ok(mut addresses)) if !addresses.is_empty() => {
                addresses.truncate(MAX_ADDRESSES);
                Ok(addresses)
            }
            Ok(_) => Err(None),
            Err(expired) => Err(Some(expired)),
        }
    }

    /// Dials addresses in order. Each gets an equal share of the connect
    /// budget, never below the floor, and never past the overall deadline.
    async fn dial(
        &mut self,
        net: &dyn InspectionNet,
        addresses: &[SocketAddr],
        record: bool,
    ) -> Result<TcpStream, DialError> {
        let count = u32::try_from(addresses.len()).unwrap_or(u32::MAX).max(1);
        let floor = self.timeouts.per_address_floor.min(self.timeouts.connect);
        let share = (self.timeouts.connect / count).max(floor);
        let mut waited = Duration::ZERO;
        let mut last = DialError::Overall;
        for &address in addresses {
            if record {
                self.address = Some(address);
                self.addresses_tried = self.addresses_tried.saturating_add(1);
            }
            match self.within(share, net.dial(address)).await {
                Ok(Ok(stream)) => return Ok(stream),
                Ok(Err(error)) => last = DialError::Io(error),
                Err(Expired::Stage(budget)) => {
                    waited += budget;
                    last = DialError::TimedOut(waited);
                }
                Err(Expired::Overall) => return Err(DialError::Overall),
            }
        }
        Err(last)
    }
}

async fn open_tunnel(
    socket: &mut Socket,
    target: &str,
    proxy: &url::Url,
) -> Result<(), TunnelError> {
    let mut request = format!("CONNECT {target} HTTP/1.1\r\nHost: {target}\r\n");
    if !proxy.username().is_empty() || proxy.password().is_some() {
        let credentials = format!(
            "{}:{}",
            decode_user_info(proxy.username()),
            decode_user_info(proxy.password().unwrap_or_default())
        );
        let encoded = base64::engine::general_purpose::STANDARD.encode(credentials);
        request.push_str(&format!("Proxy-Authorization: Basic {encoded}\r\n"));
    }
    request.push_str("\r\n");
    socket
        .write_all(request.as_bytes())
        .await
        .map_err(|_| TunnelError::Protocol)?;
    let mut header = Vec::with_capacity(512);
    while !header.ends_with(b"\r\n\r\n") {
        if header.len() == MAX_CONNECT_HEADER_BYTES {
            return Err(TunnelError::Protocol);
        }
        header.push(socket.read_u8().await.map_err(|_| TunnelError::Protocol)?);
    }
    let status_line = header
        .split(|byte| *byte == b'\n')
        .next()
        .unwrap_or_default();
    let status_line = std::str::from_utf8(status_line).map_err(|_| TunnelError::Protocol)?;
    let mut parts = status_line.split_whitespace();
    let version = parts.next().unwrap_or_default();
    let status = parts.next().and_then(|value| value.parse::<u16>().ok());
    // Only the numeric status leaves this function: an upstream response or
    // proxy URL can contain secrets.
    match status {
        _ if !matches!(version, "HTTP/1.0" | "HTTP/1.1") => Err(TunnelError::Protocol),
        Some(200..=299) => Ok(()),
        Some(code @ 100..=599) => Err(TunnelError::Status(code)),
        _ => Err(TunnelError::Protocol),
    }
}

async fn connect_direct(attempt: &mut Attempt, net: &dyn InspectionNet) -> Result<Socket, Failure> {
    use InspectionFailureKind as Kind;
    attempt.begin(InspectionStage::Resolve);
    let addresses = match attempt.resolve(net, &attempt.target).await {
        Ok(addresses) => addresses,
        Err(Some(expired)) => return Err(attempt.expired(expired, Kind::DnsFailure)),
        Err(None) => return Err(attempt.fail(Kind::DnsFailure)),
    };
    attempt.complete();

    attempt.begin(InspectionStage::Connect);
    match attempt.dial(net, &addresses, true).await {
        Ok(stream) => {
            attempt.complete();
            Ok(Box::new(stream))
        }
        Err(DialError::Io(error)) => Err(attempt.fail(connect_failure_kind(&error))),
        Err(DialError::TimedOut(waited)) => Err(attempt.fail(Kind::ConnectTimeout).timeout(waited)),
        Err(DialError::Overall) => Err(attempt.expired(Expired::Overall, Kind::ConnectTimeout)),
    }
}

async fn connect_through_proxy(
    attempt: &mut Attempt,
    net: &dyn InspectionNet,
    proxy_url: &str,
) -> Result<Socket, Failure> {
    use InspectionFailureKind as Kind;
    attempt.begin(InspectionStage::ProxyConnect);
    let proxy = parse_proxy(proxy_url).map_err(|_| attempt.fail(Kind::ProxyInvalid))?;
    let proxy_host = proxy
        .host_str()
        .expect("validated proxy host")
        .trim_start_matches('[')
        .trim_end_matches(']');
    let proxy_port = proxy
        .port_or_known_default()
        .expect("HTTP(S) has a default port");
    let proxy_authority =
        authority(proxy_host, proxy_port).map_err(|_| attempt.fail(Kind::ProxyInvalid))?;
    let proxy_name = if proxy.scheme() == "https" {
        Some(tls_server_name(proxy_host).map_err(|_| attempt.fail(Kind::ProxyInvalid))?)
    } else {
        None
    };

    // The proxy is resolved and dialled; the target never is on this route.
    let addresses = match attempt.resolve(net, &proxy_authority).await {
        Ok(addresses) => addresses,
        Err(Some(expired)) => return Err(attempt.expired(expired, Kind::ProxyUnreachable)),
        Err(None) => return Err(attempt.fail(Kind::ProxyUnreachable)),
    };
    let tcp = match attempt.dial(net, &addresses, false).await {
        Ok(tcp) => tcp,
        Err(DialError::Io(_)) => return Err(attempt.fail(Kind::ProxyUnreachable)),
        Err(DialError::TimedOut(waited)) => {
            return Err(attempt.fail(Kind::ProxyUnreachable).timeout(waited))
        }
        Err(DialError::Overall) => {
            return Err(attempt.expired(Expired::Overall, Kind::ProxyUnreachable))
        }
    };
    attempt.complete();

    let mut socket: Socket = match proxy_name {
        Some(proxy_name) => {
            attempt.begin(InspectionStage::ProxyTls);
            // Inspecting the target certificate must NEVER disable verification of
            // a separate HTTPS proxy's own certificate.
            let config =
                build_tls_config(true).map_err(|_| attempt.fail(Kind::InspectionUnavailable))?;
            let connector = tokio_rustls::TlsConnector::from(config);
            let handshake = attempt
                .within(
                    attempt.timeouts.tls_handshake,
                    connector.connect(proxy_name, tcp),
                )
                .await;
            match handshake {
                Ok(Ok(stream)) => {
                    attempt.complete();
                    Box::new(stream)
                }
                Ok(Err(_)) => return Err(attempt.fail(Kind::ProxyTlsFailed)),
                Err(expired) => return Err(attempt.expired(expired, Kind::ProxyTlsFailed)),
            }
        }
        None => Box::new(tcp),
    };

    attempt.begin(InspectionStage::ProxyTunnel);
    let tunnel = attempt
        .within(
            attempt.timeouts.proxy_tunnel,
            open_tunnel(&mut socket, &attempt.target, &proxy),
        )
        .await;
    match tunnel {
        Ok(Ok(())) => {
            attempt.complete();
            Ok(socket)
        }
        Ok(Err(TunnelError::Status(407))) => {
            Err(attempt.fail(Kind::ProxyAuthRejected).proxy_status(407))
        }
        Ok(Err(TunnelError::Status(status))) => {
            Err(attempt.fail(Kind::ProxyTunnelRejected).proxy_status(status))
        }
        Ok(Err(TunnelError::Protocol)) => Err(attempt.fail(Kind::ProxyProtocolError)),
        Err(expired) => Err(attempt.expired(expired, Kind::ProxyTunnelTimeout)),
    }
}

/// Fetch the leaf and chain without sending an HTTP request to the target.
pub async fn fetch_tls_certificate_info(
    host: &str,
    port: u16,
    proxy_url: Option<&str>,
) -> Result<TlsCertificateInfo, CertificateInspectionError> {
    inspect_certificate_with_roots(host, port, proxy_url, super::native_root_store()).await
}

// Root injection is Rust-internal for synthetic fixtures, never an IPC option.
pub(super) async fn inspect_certificate_with_roots(
    host: &str,
    port: u16,
    proxy_url: Option<&str>,
    roots: Result<rustls::RootCertStore, String>,
) -> Result<TlsCertificateInfo, CertificateInspectionError> {
    inspect_certificate_with(
        host,
        port,
        proxy_url,
        roots,
        InspectionTimeouts::DEFAULT,
        &SystemNet,
    )
    .await
}

// Budget and network injection are Rust-internal test seams, never IPC options.
pub(super) async fn inspect_certificate_with(
    host: &str,
    port: u16,
    proxy_url: Option<&str>,
    roots: Result<rustls::RootCertStore, String>,
    timeouts: InspectionTimeouts,
    net: &dyn InspectionNet,
) -> Result<TlsCertificateInfo, CertificateInspectionError> {
    let route = match proxy_url {
        Some(_) => InspectionRoute::Proxy,
        None => InspectionRoute::Direct,
    };
    let mut attempt = Attempt::new(route, timeouts);
    inspect(&mut attempt, host, port, proxy_url, roots, net)
        .await
        .map_err(Into::into)
}

async fn inspect(
    attempt: &mut Attempt,
    host: &str,
    port: u16,
    proxy_url: Option<&str>,
    roots: Result<rustls::RootCertStore, String>,
    net: &dyn InspectionNet,
) -> Result<TlsCertificateInfo, Failure> {
    use InspectionFailureKind as Kind;
    let name_host = host.trim_start_matches('[').trim_end_matches(']');
    // Never echo a rejected target: it can carry injected header text.
    let (Ok(target), Ok(server_name)) = (authority(host, port), tls_server_name(name_host)) else {
        return Err(attempt.fail(Kind::InvalidTarget));
    };
    attempt.target = target;

    attempt.begin(InspectionStage::Verifier);
    let (config, verification) = super::tls_ca::inspection_tls_config(roots)
        .map_err(|_| attempt.fail(Kind::InspectionUnavailable))?;

    let socket = match proxy_url {
        Some(proxy_url) => connect_through_proxy(attempt, net, proxy_url).await?,
        None => connect_direct(attempt, net).await?,
    };

    attempt.begin(InspectionStage::TlsHandshake);
    let connector = tokio_rustls::TlsConnector::from(config);
    let handshake = attempt
        .within(
            attempt.timeouts.tls_handshake,
            connector.connect(server_name, socket),
        )
        .await;
    let tls = match handshake {
        Ok(Ok(tls)) => tls,
        Ok(Err(error)) => {
            return Err(attempt
                .fail(Kind::TlsHandshakeFailed)
                .tls_reason(tls_failure_reason(&error)))
        }
        Err(expired) => return Err(attempt.expired(expired, Kind::TlsHandshakeTimeout)),
    };
    attempt.complete();

    attempt.begin(InspectionStage::Certificate);
    let mut info =
        capture_peer_certificate_chain(tls.get_ref().1.peer_certificates().unwrap_or_default())
            .map_err(|_| attempt.fail(Kind::CertificateUnreadable))?;
    attempt.complete();

    attempt.begin(InspectionStage::Verifier);
    info.ca_validation = verification
        .completed(name_host, port, proxy_url, &info.fingerprint)
        .map_err(|_| attempt.fail(Kind::InspectionUnavailable))?;
    Ok(info)
}

#[cfg(test)]
#[path = "http_proxy_transport_tests.rs"]
mod tests;
