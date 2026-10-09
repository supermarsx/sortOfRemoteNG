//! Native-only, authenticated HTTP/CONNECT relay. Not a browser integration.
//!
//! The caller supplies both an explicit route and destination grants. There is no
//! default/direct route, TLS interception, page rewriting, IPC or credential
//! serialization here. The native browser owner must enforce proxy use and isolate
//! its privileged app endpoints. A loopback address alone is NOT authentication.

use base64::Engine;
use rand::RngCore;
use sha2::{Digest, Sha256};
use std::fmt;
use std::future::Future;
use std::io;
use std::net::{Ipv4Addr, Ipv6Addr, SocketAddr};
use std::pin::Pin;
use std::sync::Arc;
use std::time::Duration;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::watch;
use tokio::task::{JoinHandle, JoinSet};
use zeroize::{Zeroize, Zeroizing};

#[path = "private_forward_proxy/http.rs"]
mod forward_http;
#[path = "private_forward_proxy/lifecycle.rs"]
mod lifecycle;
pub use lifecycle::{PrivateProxyDiagnostics, PrivateProxyState};
use lifecycle::{increment, Observations};

pub trait ProxyStream: AsyncRead + AsyncWrite + Unpin + Send {}
impl<T: AsyncRead + AsyncWrite + Unpin + Send> ProxyStream for T {}
pub type BoxedStream = Box<dyn ProxyStream>;
pub type DialFuture = Pin<Box<dyn Future<Output = io::Result<BoxedStream>> + Send + 'static>>;

/// Implementations must be cancellation-safe: dropping the returned future must
/// cancel establishment, and dropping its stream must release that tunnel only.
/// Never spawn detached establishment work or fall back to a different route.
pub trait RouteDialer: Send + Sync + 'static {
    fn dial(&self, authority: Authority) -> DialFuture;
}

impl<F> RouteDialer for F
where
    F: Fn(Authority) -> DialFuture + Send + Sync + 'static,
{
    fn dial(&self, authority: Authority) -> DialFuture {
        self(authority)
    }
}

/// Native, synchronous and nonblocking authorization; checked before any dial.
/// A callback can revoke individual grants. Session revocation also closes
/// already established streams via `PrivateForwardProxy::revoke` / `stop`.
pub type DestinationGrant = Arc<dyn Fn(&Authority) -> bool + Send + Sync>;

#[derive(Clone, Debug, Eq, PartialEq, Hash)]
pub struct Authority {
    host: String,
    port: u16,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct InvalidAuthority;
impl fmt::Display for InvalidAuthority {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("Invalid CONNECT authority")
    }
}
impl std::error::Error for InvalidAuthority {}

impl Authority {
    /// ASCII DNS (including punycode), canonical IPv4, or bracketed IPv6, with
    /// an explicit nonzero port. No URL syntax, escapes, zones or legacy IP forms.
    pub fn parse(value: &str) -> Result<Self, InvalidAuthority> {
        if value.len() > 261 || !value.is_ascii() {
            return Err(InvalidAuthority);
        }
        let (host, port) = if let Some(v6) = value.strip_prefix('[') {
            let (host, port) = v6.split_once("]:").ok_or(InvalidAuthority)?;
            let host = host.parse::<Ipv6Addr>().map_err(|_| InvalidAuthority)?;
            (host.to_string(), port)
        } else {
            let (host, port) = value.split_once(':').ok_or(InvalidAuthority)?;
            let host = if let Ok(ip) = host.parse::<Ipv4Addr>() {
                ip.to_string()
            } else {
                if host.is_empty()
                    || host.len() > 253
                    || host.split('.').any(|label| {
                        label.is_empty()
                            || label.len() > 63
                            || label.starts_with('-')
                            || label.ends_with('-')
                            || !label
                                .bytes()
                                .all(|b| b.is_ascii_alphanumeric() || b == b'-')
                    })
                    || host.rsplit('.').next().is_some_and(|label| {
                        label.bytes().all(|b| b.is_ascii_digit())
                            || label
                                .strip_prefix("0x")
                                .or_else(|| label.strip_prefix("0X"))
                                .is_some_and(|hex| hex.bytes().all(|b| b.is_ascii_hexdigit()))
                    })
                {
                    return Err(InvalidAuthority);
                }
                host.to_ascii_lowercase()
            };
            (host, port)
        };
        if port.is_empty() || port.starts_with('0') || !port.bytes().all(|b| b.is_ascii_digit()) {
            return Err(InvalidAuthority);
        }
        let port = port.parse::<u16>().map_err(|_| InvalidAuthority)?;
        Ok(Self { host, port })
    }

    pub fn host(&self) -> &str {
        &self.host
    }
    pub fn port(&self) -> u16 {
        self.port
    }
}

impl fmt::Display for Authority {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        if self.host.contains(':') {
            write!(f, "[{}]:{}", self.host, self.port)
        } else {
            write!(f, "{}:{}", self.host, self.port)
        }
    }
}

pub fn exact_authority_grant(authority: Authority) -> DestinationGrant {
    Arc::new(move |candidate| candidate == &authority)
}

#[derive(Clone, Copy, Debug)]
pub struct ProxyLimits {
    /// Includes unauthenticated readers, pending dials and established tunnels.
    pub max_clients: usize,
    pub max_header_bytes: usize,
    /// Absolute header deadline, not extended by trickled bytes.
    pub header_timeout: Duration,
    pub dial_timeout: Duration,
    pub response_timeout: Duration,
    /// Deadline for a plain HTTP response head, including streaming its upload.
    pub http_response_timeout: Duration,
    /// No-progress budget for plain HTTP uploads/downloads, not upgraded WS.
    pub http_idle_timeout: Duration,
}

impl Default for ProxyLimits {
    fn default() -> Self {
        Self {
            max_clients: 32,
            max_header_bytes: 8 * 1024,
            header_timeout: Duration::from_secs(10),
            dial_timeout: Duration::from_secs(25),
            response_timeout: Duration::from_secs(5),
            http_response_timeout: Duration::from_secs(60),
            http_idle_timeout: Duration::from_secs(60),
        }
    }
}

impl ProxyLimits {
    fn validate(self) -> io::Result<Self> {
        if !(1..=256).contains(&self.max_clients)
            || !(256..=16 * 1024).contains(&self.max_header_bytes)
            || [
                self.header_timeout,
                self.dial_timeout,
                self.response_timeout,
                self.http_response_timeout,
                self.http_idle_timeout,
            ]
            .iter()
            .any(|d| d.is_zero() || *d > Duration::from_secs(120))
        {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "Invalid private proxy limits",
            ));
        }
        Ok(self)
    }
}

const USERNAME: &str = "sorng-private-proxy";
const RELAY_BUFFER: usize = 32 * 1024;

// Deliberately no Debug, Clone, Serialize or credential-bearing error messages.
pub struct PrivateForwardProxy {
    address: SocketAddr,
    password: Zeroizing<String>,
    stopped: watch::Sender<bool>,
    task: Option<JoinHandle<io::Result<()>>>,
    observations: Arc<Observations>,
}

impl PrivateForwardProxy {
    pub async fn start(
        dialer: Arc<dyn RouteDialer>,
        grant: DestinationGrant,
        limits: ProxyLimits,
    ) -> io::Result<Self> {
        let limits = limits.validate()?;
        let mut random = Zeroizing::new([0u8; 32]);
        rand::rngs::OsRng
            .try_fill_bytes(&mut *random)
            .map_err(|_| io::Error::other("Private proxy credential generation failed"))?;
        let password = Zeroizing::new(hex::encode(random.as_slice()));
        let credentials = Zeroizing::new(format!("{USERNAME}:{}", password.as_str()));
        let credential_hash: [u8; 32] = Sha256::digest(credentials.as_bytes()).into();
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).await?;
        let address = listener.local_addr()?;
        let (stopped, receiver) = watch::channel(false);
        let observations = Arc::new(Observations::default());
        let task = tokio::spawn(serve(
            listener,
            receiver,
            dialer,
            grant,
            credential_hash,
            limits,
            observations.clone(),
        ));
        Ok(Self {
            address,
            password,
            stopped,
            task: Some(task),
            observations,
        })
    }

    pub fn local_addr(&self) -> SocketAddr {
        self.address
    }

    /// Native readiness snapshot. Check before Ready/status/authorization; a
    /// finished supervisor (including unexpected failure) is never usable even
    /// if no caller explicitly revoked it. This is not a future liveness lease.
    pub fn is_running(&self) -> bool {
        !*self.stopped.borrow() && self.task.as_ref().is_some_and(|task| !task.is_finished())
    }

    /// Secret-free observation only; does not start, probe, or authorize a route.
    pub fn diagnostics(&self) -> PrivateProxyDiagnostics {
        self.observations.snapshot(
            *self.stopped.borrow(),
            self.task.as_ref().is_none_or(|task| task.is_finished()),
        )
    }

    /// Native browser authentication callback ONLY. Never pass these values to
    /// serde, IPC, page JS, URLs, logs or Debug. No credentials after revocation
    /// or observed server completion/failure.
    pub fn with_credentials<R>(&self, use_credentials: impl FnOnce(&str, &str) -> R) -> Option<R> {
        if self.is_running() {
            Some(use_credentials(USERNAME, &self.password))
        } else {
            None
        }
    }

    /// Immediately signals revocation, including pending dials and active streams.
    /// Call `stop().await` to observe completion and listener/stream release.
    pub fn revoke(&self) {
        if self.diagnostics().state == PrivateProxyState::TaskEnded {
            self.observations.task_ended();
        }
        self.stopped.send_replace(true);
    }

    pub async fn stop(&mut self) -> io::Result<()> {
        self.revoke();
        self.password.zeroize();
        // Keep the JoinHandle in self until completed: cancelling stop() must
        // not detach cleanup or prevent a subsequent stop() from awaiting it.
        let result = match self.task.as_mut() {
            Some(task) => match task.await {
                Ok(result) => result,
                Err(_) => {
                    self.observations.task_ended();
                    Err(io::Error::other("Private proxy task failed"))
                }
            },
            None => return Ok(()),
        };
        self.task.take();
        result
    }
}

impl Drop for PrivateForwardProxy {
    fn drop(&mut self) {
        self.revoke();
    }
}

async fn revoked(mut receiver: watch::Receiver<bool>) {
    if *receiver.borrow() {
        return;
    }
    while receiver.changed().await.is_ok() {
        if *receiver.borrow() {
            return;
        }
    }
}

async fn serve(
    listener: TcpListener,
    stop: watch::Receiver<bool>,
    dialer: Arc<dyn RouteDialer>,
    grant: DestinationGrant,
    credential_hash: [u8; 32],
    limits: ProxyLimits,
    observations: Arc<Observations>,
) -> io::Result<()> {
    let mut clients = JoinSet::new();
    let result = loop {
        tokio::select! {
            biased;
            _ = revoked(stop.clone()) => break Ok(()),
            Some(_) = clients.join_next(), if !clients.is_empty() => {},
            accepted = listener.accept() => {
                let (mut client, _) = match accepted {
                    Ok(value) => value,
                    Err(_) => {
                        observations.listener_failed();
                        break Err(io::Error::other("Private proxy listener failed"));
                    }
                };
                increment(&observations.accepted_connections);
                if clients.len() >= limits.max_clients {
                    increment(&observations.capacity_refusals);
                    // No unbounded task/queue for rejected clients. The extra
                    // accepted socket exists only for this bounded refusal.
                    tokio::select! {
                        biased;
                        _ = revoked(stop.clone()) => break Ok(()),
                        _ = refuse_busy(&mut client, limits.response_timeout) => {},
                    }
                    continue;
                }
                let stop = stop.clone();
                let dialer = dialer.clone();
                let grant = grant.clone();
                let observations = observations.clone();
                clients.spawn(async move {
                    tokio::select! {
                        biased;
                        _ = revoked(stop) => {},
                        _ = handle_client(client, dialer, grant, credential_hash, limits, observations) => {},
                    }
                });
            }
        }
    };
    drop(listener);
    clients.abort_all();
    while clients.join_next().await.is_some() {}
    result
}

struct Admission {
    authority: Authority,
    early: Zeroizing<Vec<u8>>,
    forward: Option<forward_http::ForwardRequest>,
}

async fn read_admission(
    client: &mut TcpStream,
    credential_hash: &[u8; 32],
    max: usize,
) -> Result<Admission, u16> {
    let mut header = Zeroizing::new(Vec::new());
    let mut chunk = Zeroizing::new([0u8; 1024]);
    loop {
        if header.len() == max {
            return Err(431);
        }
        let available = chunk.len().min(max - header.len());
        let count = client
            .read(&mut chunk[..available])
            .await
            .map_err(|_| 400u16)?;
        if count == 0 {
            return Err(400);
        }
        let previous = header.len();
        header.extend_from_slice(&chunk[..count]);
        // Look across the chunk boundary, without repeatedly scanning the prefix.
        if let Some(offset) = header[previous.saturating_sub(3)..]
            .windows(4)
            .position(|w| w == b"\r\n\r\n")
        {
            let end = previous.saturating_sub(3) + offset + 4;
            if !header.starts_with(b"CONNECT ") {
                let forward = forward_http::validate(&header[..end], credential_hash)?;
                return Ok(Admission {
                    authority: forward.authority.clone(),
                    early: header,
                    forward: Some(forward),
                });
            }
            let authority = parse_admission(&header[..end], credential_hash)?;
            return Ok(Admission {
                authority,
                early: Zeroizing::new(header[end..].to_vec()),
                forward: None,
            });
        }
    }
}

fn parse_admission(header: &[u8], credential_hash: &[u8; 32]) -> Result<Authority, u16> {
    let text = std::str::from_utf8(header).map_err(|_| 400u16)?;
    let mut lines = text.strip_suffix("\r\n\r\n").ok_or(400u16)?.split("\r\n");
    let mut request = lines.next().ok_or(400u16)?.split(' ');
    if request.next() != Some("CONNECT") {
        return Err(400);
    }
    let authority = Authority::parse(request.next().ok_or(400u16)?).map_err(|_| 400u16)?;
    if request.next() != Some("HTTP/1.1") || request.next().is_some() {
        return Err(400);
    }
    let mut names = Vec::new();
    let mut host = None;
    let mut authorization = None;
    for line in lines {
        let (name, value) = line.split_once(':').ok_or(400u16)?;
        if name.is_empty()
            || !name
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"!#$%&'*+-.^_`|~".contains(&b))
            || !value.bytes().all(|b| (32..=126).contains(&b))
            || names.len() >= 64
        {
            return Err(400);
        }
        let name = name.to_ascii_lowercase();
        if names.contains(&name) {
            return Err(400);
        }
        let value = value.trim_matches(' ');
        match name.as_str() {
            "host" => host = Some(Authority::parse(value).map_err(|_| 400u16)?),
            "proxy-authorization" => authorization = Some(value),
            // CONNECT has no HTTP body here, nor forwarded application auth.
            "content-length" | "transfer-encoding" | "trailer" | "upgrade" | "expect"
            | "authorization" | "cookie" => return Err(400),
            "connection" | "proxy-connection"
                if !value.eq_ignore_ascii_case("keep-alive")
                    && !value.eq_ignore_ascii_case("close") =>
            {
                return Err(400)
            }
            _ => {}
        }
        names.push(name);
    }
    if host.as_ref() != Some(&authority) {
        return Err(400);
    }
    authenticate(authorization, credential_hash)?;
    Ok(authority)
}

fn authenticate(authorization: Option<&str>, credential_hash: &[u8; 32]) -> Result<(), u16> {
    let (scheme, encoded) = authorization
        .and_then(|value| value.split_once(' '))
        .ok_or(407u16)?;
    if !scheme.eq_ignore_ascii_case("Basic") {
        return Err(407);
    }
    let decoded = Zeroizing::new(
        base64::engine::general_purpose::STANDARD
            .decode(encoded)
            .map_err(|_| 407u16)?,
    );
    let hash: [u8; 32] = Sha256::digest(&*decoded).into();
    // Fixed-work comparison of hashes; no secret-prefix comparisons or logging.
    let difference = hash
        .iter()
        .zip(credential_hash)
        .fold(0u8, |acc, (a, b)| acc | std::hint::black_box(a ^ b));
    if difference != 0 {
        return Err(407);
    }
    Ok(())
}

async fn refuse(client: &mut TcpStream, status: u16, deadline: Duration) {
    let response = match status {
        407 => "HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm=\"private-forward-proxy\"\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
        403 => "HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
        408 => "HTTP/1.1 408 Request Timeout\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
        431 => "HTTP/1.1 431 Request Header Fields Too Large\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
        502 => "HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
        503 => "HTTP/1.1 503 Service Unavailable\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
        504 => "HTTP/1.1 504 Gateway Timeout\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
        _ => "HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
    };
    let _ = tokio::time::timeout(deadline, client.write_all(response.as_bytes())).await;
}

async fn refuse_busy(client: &mut TcpStream, deadline: Duration) {
    // We have deliberately not read this socket's request. On Windows, closing
    // with unread bytes can reset it before the 503 arrives. Half-close and give
    // the peer a bounded opportunity to consume the response and close. Neither
    // this drain nor its bytes can ever reach admission, authorization or a dial.
    let _ = tokio::time::timeout(deadline, async {
        refuse(client, 503, deadline).await;
        let _ = client.shutdown().await;
        let _ = tokio::time::timeout(Duration::from_millis(100), async {
            let mut remaining = 16 * 1024;
            let mut buffer = Zeroizing::new([0u8; 1024]);
            while remaining > 0 {
                match client.read(&mut buffer[..]).await {
                    Ok(0) | Err(_) => break,
                    Ok(count) => remaining -= count,
                }
            }
        })
        .await;
    })
    .await;
}

async fn handle_client(
    mut client: TcpStream,
    dialer: Arc<dyn RouteDialer>,
    grant: DestinationGrant,
    credential_hash: [u8; 32],
    limits: ProxyLimits,
    observations: Arc<Observations>,
) {
    let admission = match tokio::time::timeout(
        limits.header_timeout,
        read_admission(&mut client, &credential_hash, limits.max_header_bytes),
    )
    .await
    {
        Ok(Ok(admission)) => admission,
        result => {
            let status = match result {
                Ok(Err(status)) => status,
                _ => 408,
            };
            increment(if status == 407 {
                &observations.authentication_challenges
            } else {
                &observations.request_rejections
            });
            refuse(&mut client, status, limits.response_timeout).await;
            return;
        }
    };
    increment(&observations.authenticated_requests);
    if !grant(&admission.authority) {
        increment(&observations.destination_denials);
        refuse(&mut client, 403, limits.response_timeout).await;
        return;
    }
    let mut upstream =
        match tokio::time::timeout(limits.dial_timeout, dialer.dial(admission.authority)).await {
            Ok(Ok(stream)) => stream,
            result => {
                increment(&observations.upstream_failures);
                refuse(
                    &mut client,
                    if result.is_err() { 504 } else { 502 },
                    limits.response_timeout,
                )
                .await;
                return;
            }
        };
    if let Some(forward) = admission.forward {
        forward_http::relay(client, admission.early, upstream, forward, limits).await;
        return;
    }
    let started = tokio::time::timeout(limits.response_timeout, async {
        client
            .write_all(b"HTTP/1.1 200 Connection Established\r\n\r\n")
            .await?;
        upstream.write_all(&admission.early).await
    })
    .await;
    if !matches!(started, Ok(Ok(()))) {
        return;
    }
    // Tokio shuts down only the opposite writer on EOF and continues draining
    // the remaining direction. Quiet WSS is valid indefinitely until revocation.
    let _ = tokio::io::copy_bidirectional_with_sizes(
        &mut client,
        &mut upstream,
        RELAY_BUFFER,
        RELAY_BUFFER,
    )
    .await;
}

#[cfg(test)]
#[path = "private_forward_proxy/tests.rs"]
mod tests;

#[cfg(test)]
#[path = "private_forward_proxy/lifecycle_tests.rs"]
mod lifecycle_tests;
