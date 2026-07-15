//! Shared, binary-safe socket transport primitives.
//!
//! This crate intentionally supports direct TCP and UDP routes only.  Proxy,
//! SSH-jump, TLS, and STARTTLS variants are represented in the public route
//! model so callers can fail closed instead of silently bypassing a requested
//! network or security layer.

use serde::{Deserialize, Serialize};
use socket2::{SockRef, TcpKeepalive};
use std::collections::HashSet;
use std::io;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr};
use std::sync::Arc;
use std::time::{Duration, Instant};
use thiserror::Error;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::tcp::{OwnedReadHalf, OwnedWriteHalf};
use tokio::net::{lookup_host, TcpSocket, TcpStream, UdpSocket};
use tokio::time::timeout;
use tokio_util::sync::CancellationToken;

const MAX_TIMEOUT: Duration = Duration::from_secs(24 * 60 * 60);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TransportProtocol {
    Tcp,
    Udp,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AddressFamily {
    #[default]
    Any,
    PreferIpv4,
    PreferIpv6,
    Ipv4Only,
    Ipv6Only,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RouteKind {
    Direct,
    HttpConnect,
    Socks4,
    Socks5,
    SshJump,
    Tls,
    StartTls,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Route {
    #[default]
    Direct,
    HttpConnect,
    Socks4,
    Socks5,
    SshJump,
    Tls,
    StartTls,
}

impl Route {
    pub const fn kind(self) -> RouteKind {
        match self {
            Self::Direct => RouteKind::Direct,
            Self::HttpConnect => RouteKind::HttpConnect,
            Self::Socks4 => RouteKind::Socks4,
            Self::Socks5 => RouteKind::Socks5,
            Self::SshJump => RouteKind::SshJump,
            Self::Tls => RouteKind::Tls,
            Self::StartTls => RouteKind::StartTls,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RouteCapabilities {
    pub direct: bool,
    pub http_connect: bool,
    pub socks4: bool,
    pub socks5: bool,
    pub ssh_jump: bool,
    pub tls: bool,
    pub start_tls: bool,
}

impl RouteCapabilities {
    pub const fn direct_only() -> Self {
        Self {
            direct: true,
            http_connect: false,
            socks4: false,
            socks5: false,
            ssh_jump: false,
            tls: false,
            start_tls: false,
        }
    }

    pub const fn supports(self, route: RouteKind) -> bool {
        match route {
            RouteKind::Direct => self.direct,
            RouteKind::HttpConnect => self.http_connect,
            RouteKind::Socks4 => self.socks4,
            RouteKind::Socks5 => self.socks5,
            RouteKind::SshJump => self.ssh_jump,
            RouteKind::Tls => self.tls,
            RouteKind::StartTls => self.start_tls,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SocketTarget {
    pub host: String,
    pub port: u16,
}

impl SocketTarget {
    pub fn new(host: impl Into<String>, port: u16) -> Self {
        Self {
            host: host.into(),
            port,
        }
    }

    fn validate(&self) -> Result<(), TransportError> {
        if self.host.trim().is_empty() || self.host.len() > 253 || self.port == 0 {
            return Err(TransportError::InvalidConfiguration);
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalBind {
    pub address: IpAddr,
    pub port: u16,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct IoTimeouts {
    pub connect: Duration,
    pub write: Duration,
    pub idle: Duration,
}

impl Default for IoTimeouts {
    fn default() -> Self {
        Self {
            connect: Duration::from_secs(10),
            write: Duration::from_secs(10),
            idle: Duration::from_secs(5 * 60),
        }
    }
}

impl IoTimeouts {
    fn validate(self) -> Result<Self, TransportError> {
        if self.connect.is_zero()
            || self.write.is_zero()
            || self.idle.is_zero()
            || self.connect > MAX_TIMEOUT
            || self.write > MAX_TIMEOUT
            || self.idle > MAX_TIMEOUT
        {
            return Err(TransportError::InvalidConfiguration);
        }
        Ok(self)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TcpOptions {
    pub address_family: AddressFamily,
    pub local_bind: Option<LocalBind>,
    pub no_delay: bool,
    pub keepalive: Option<Duration>,
    pub timeouts: IoTimeouts,
}

impl Default for TcpOptions {
    fn default() -> Self {
        Self {
            address_family: AddressFamily::Any,
            local_bind: None,
            no_delay: true,
            keepalive: Some(Duration::from_secs(60)),
            timeouts: IoTimeouts::default(),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct UdpOptions {
    pub address_family: AddressFamily,
    pub local_bind: Option<LocalBind>,
    pub timeouts: IoTimeouts,
}

impl Default for UdpOptions {
    fn default() -> Self {
        Self {
            address_family: AddressFamily::Any,
            local_bind: None,
            timeouts: IoTimeouts::default(),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Operation {
    Resolve,
    Bind,
    Connect,
    Configure,
    Read,
    Write,
    Shutdown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RedactedIoKind {
    NotFound,
    PermissionDenied,
    ConnectionRefused,
    ConnectionReset,
    ConnectionAborted,
    NotConnected,
    AddressInUse,
    AddressNotAvailable,
    BrokenPipe,
    AlreadyExists,
    WouldBlock,
    InvalidInput,
    InvalidData,
    TimedOut,
    Interrupted,
    UnexpectedEof,
    Other,
}

impl From<io::ErrorKind> for RedactedIoKind {
    fn from(value: io::ErrorKind) -> Self {
        match value {
            io::ErrorKind::NotFound => Self::NotFound,
            io::ErrorKind::PermissionDenied => Self::PermissionDenied,
            io::ErrorKind::ConnectionRefused => Self::ConnectionRefused,
            io::ErrorKind::ConnectionReset => Self::ConnectionReset,
            io::ErrorKind::ConnectionAborted => Self::ConnectionAborted,
            io::ErrorKind::NotConnected => Self::NotConnected,
            io::ErrorKind::AddrInUse => Self::AddressInUse,
            io::ErrorKind::AddrNotAvailable => Self::AddressNotAvailable,
            io::ErrorKind::BrokenPipe => Self::BrokenPipe,
            io::ErrorKind::AlreadyExists => Self::AlreadyExists,
            io::ErrorKind::WouldBlock => Self::WouldBlock,
            io::ErrorKind::InvalidInput => Self::InvalidInput,
            io::ErrorKind::InvalidData => Self::InvalidData,
            io::ErrorKind::TimedOut => Self::TimedOut,
            io::ErrorKind::Interrupted => Self::Interrupted,
            io::ErrorKind::UnexpectedEof => Self::UnexpectedEof,
            _ => Self::Other,
        }
    }
}

#[derive(Debug, Error, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "code", rename_all = "snake_case")]
pub enum TransportError {
    #[error("socket configuration is invalid")]
    InvalidConfiguration,
    #[error("the requested route is unsupported for {protocol:?}: {route:?}")]
    UnsupportedRoute {
        protocol: TransportProtocol,
        route: RouteKind,
    },
    #[error("name resolution failed")]
    ResolveFailed,
    #[error("name resolution returned no compatible address")]
    NoCompatibleAddress,
    #[error("socket operation timed out: {operation:?}")]
    TimedOut { operation: Operation },
    #[error("socket operation was cancelled")]
    Cancelled,
    #[error("socket operation failed: {operation:?} ({kind:?})")]
    Io {
        operation: Operation,
        kind: RedactedIoKind,
        os_code: Option<i32>,
    },
}

impl TransportError {
    fn io(operation: Operation, error: &io::Error) -> Self {
        Self::Io {
            operation,
            kind: error.kind().into(),
            os_code: error.raw_os_error(),
        }
    }
}

#[derive(Debug, Clone)]
pub struct SocketConnector {
    cancellation: CancellationToken,
}

impl Default for SocketConnector {
    fn default() -> Self {
        Self::new()
    }
}

impl SocketConnector {
    pub fn new() -> Self {
        Self {
            cancellation: CancellationToken::new(),
        }
    }

    pub fn with_cancellation(cancellation: CancellationToken) -> Self {
        Self { cancellation }
    }

    pub const fn capabilities(&self, _protocol: TransportProtocol) -> RouteCapabilities {
        RouteCapabilities::direct_only()
    }

    pub fn cancellation_token(&self) -> CancellationToken {
        self.cancellation.clone()
    }

    pub fn cancel(&self) {
        self.cancellation.cancel();
    }

    pub async fn connect_tcp(
        &self,
        target: &SocketTarget,
        route: Route,
        options: TcpOptions,
    ) -> Result<TcpConnection, TransportError> {
        validate_route(TransportProtocol::Tcp, route)?;
        target.validate()?;
        let timeouts = options.timeouts.validate()?;
        validate_keepalive(options.keepalive)?;
        let addresses = resolve(
            target,
            options.address_family,
            timeouts.connect,
            &self.cancellation,
        )
        .await?;
        let deadline = Instant::now() + timeouts.connect;
        let mut last_error = None;

        for (index, address) in addresses.iter().copied().enumerate() {
            if !bind_matches(options.local_bind, address) {
                continue;
            }
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                return Err(TransportError::TimedOut {
                    operation: Operation::Connect,
                });
            }
            let attempt_timeout = fair_attempt_timeout(remaining, addresses.len() - index);
            match connect_tcp_address(
                address,
                options.local_bind,
                attempt_timeout,
                &self.cancellation,
            )
            .await
            {
                Ok(stream) => {
                    stream
                        .set_nodelay(options.no_delay)
                        .map_err(|error| TransportError::io(Operation::Configure, &error))?;
                    if let Some(keepalive) = options.keepalive {
                        let settings = TcpKeepalive::new()
                            .with_time(keepalive)
                            .with_interval(keepalive.min(Duration::from_secs(30)));
                        SockRef::from(&stream)
                            .set_tcp_keepalive(&settings)
                            .map_err(|error| TransportError::io(Operation::Configure, &error))?;
                    }
                    return Ok(TcpConnection {
                        stream,
                        timeouts,
                        cancellation: self.cancellation.child_token(),
                    });
                }
                Err(error) => last_error = Some(error),
            }
        }

        Err(last_error.unwrap_or(TransportError::NoCompatibleAddress))
    }

    pub async fn connect_udp(
        &self,
        target: &SocketTarget,
        route: Route,
        options: UdpOptions,
    ) -> Result<UdpConnection, TransportError> {
        validate_route(TransportProtocol::Udp, route)?;
        target.validate()?;
        let timeouts = options.timeouts.validate()?;
        let addresses = resolve(
            target,
            options.address_family,
            timeouts.connect,
            &self.cancellation,
        )
        .await?;
        let deadline = Instant::now() + timeouts.connect;
        let mut last_error = None;

        for (index, address) in addresses.iter().copied().enumerate() {
            if !bind_matches(options.local_bind, address) {
                continue;
            }
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                return Err(TransportError::TimedOut {
                    operation: Operation::Connect,
                });
            }
            let attempt_timeout = fair_attempt_timeout(remaining, addresses.len() - index);
            match connect_udp_address(
                address,
                options.local_bind,
                attempt_timeout,
                &self.cancellation,
            )
            .await
            {
                Ok(socket) => {
                    return Ok(UdpConnection {
                        socket: Arc::new(socket),
                        timeouts,
                        cancellation: self.cancellation.child_token(),
                    });
                }
                Err(error) => last_error = Some(error),
            }
        }

        Err(last_error.unwrap_or(TransportError::NoCompatibleAddress))
    }
}

fn validate_route(protocol: TransportProtocol, route: Route) -> Result<(), TransportError> {
    if route == Route::Direct {
        Ok(())
    } else {
        Err(TransportError::UnsupportedRoute {
            protocol,
            route: route.kind(),
        })
    }
}

fn validate_keepalive(keepalive: Option<Duration>) -> Result<(), TransportError> {
    if keepalive.is_some_and(|value| value.is_zero() || value > MAX_TIMEOUT) {
        Err(TransportError::InvalidConfiguration)
    } else {
        Ok(())
    }
}

fn bind_matches(local_bind: Option<LocalBind>, remote: SocketAddr) -> bool {
    local_bind.is_none_or(|bind| bind.address.is_ipv4() == remote.is_ipv4())
}

fn fair_attempt_timeout(remaining: Duration, candidates: usize) -> Duration {
    let divisor = u32::try_from(candidates.max(1)).unwrap_or(u32::MAX);
    remaining.checked_div(divisor).unwrap_or(remaining)
}

async fn resolve(
    target: &SocketTarget,
    family: AddressFamily,
    resolve_timeout: Duration,
    cancellation: &CancellationToken,
) -> Result<Vec<SocketAddr>, TransportError> {
    let lookup = timeout(
        resolve_timeout,
        lookup_host((target.host.as_str(), target.port)),
    );
    let resolved = tokio::select! {
        biased;
        _ = cancellation.cancelled() => return Err(TransportError::Cancelled),
        result = lookup => result,
    };
    let addresses = match resolved {
        Err(_) => {
            return Err(TransportError::TimedOut {
                operation: Operation::Resolve,
            })
        }
        Ok(Err(_)) => return Err(TransportError::ResolveFailed),
        Ok(Ok(addresses)) => addresses,
    };

    let mut unique = HashSet::new();
    let mut ipv4 = Vec::new();
    let mut ipv6 = Vec::new();
    for address in addresses {
        if unique.insert(address) {
            if address.is_ipv4() {
                ipv4.push(address);
            } else {
                ipv6.push(address);
            }
        }
    }

    let ordered = match family {
        AddressFamily::Any => {
            let mut all = ipv4;
            all.extend(ipv6);
            all
        }
        AddressFamily::PreferIpv4 => interleave(ipv4, ipv6),
        AddressFamily::PreferIpv6 => interleave(ipv6, ipv4),
        AddressFamily::Ipv4Only => ipv4,
        AddressFamily::Ipv6Only => ipv6,
    };
    if ordered.is_empty() {
        Err(TransportError::NoCompatibleAddress)
    } else {
        Ok(ordered)
    }
}

fn interleave(primary: Vec<SocketAddr>, secondary: Vec<SocketAddr>) -> Vec<SocketAddr> {
    let mut result = Vec::with_capacity(primary.len() + secondary.len());
    let mut primary = primary.into_iter();
    let mut secondary = secondary.into_iter();
    loop {
        match (primary.next(), secondary.next()) {
            (None, None) => break,
            (first, second) => {
                result.extend(first);
                result.extend(second);
            }
        }
    }
    result
}

async fn connect_tcp_address(
    remote: SocketAddr,
    local_bind: Option<LocalBind>,
    connect_timeout: Duration,
    cancellation: &CancellationToken,
) -> Result<TcpStream, TransportError> {
    let socket = if remote.is_ipv4() {
        TcpSocket::new_v4()
    } else {
        TcpSocket::new_v6()
    }
    .map_err(|error| TransportError::io(Operation::Configure, &error))?;
    if let Some(bind) = local_bind {
        socket
            .bind(SocketAddr::new(bind.address, bind.port))
            .map_err(|error| TransportError::io(Operation::Bind, &error))?;
    }
    let connecting = timeout(connect_timeout, socket.connect(remote));
    tokio::select! {
        biased;
        _ = cancellation.cancelled() => Err(TransportError::Cancelled),
        result = connecting => match result {
            Err(_) => Err(TransportError::TimedOut { operation: Operation::Connect }),
            Ok(Err(error)) => Err(TransportError::io(Operation::Connect, &error)),
            Ok(Ok(stream)) => Ok(stream),
        }
    }
}

async fn connect_udp_address(
    remote: SocketAddr,
    local_bind: Option<LocalBind>,
    connect_timeout: Duration,
    cancellation: &CancellationToken,
) -> Result<UdpSocket, TransportError> {
    let local = local_bind
        .map(|bind| SocketAddr::new(bind.address, bind.port))
        .unwrap_or_else(|| {
            if remote.is_ipv4() {
                SocketAddr::new(IpAddr::V4(Ipv4Addr::UNSPECIFIED), 0)
            } else {
                SocketAddr::new(IpAddr::V6(Ipv6Addr::UNSPECIFIED), 0)
            }
        });
    let socket = UdpSocket::bind(local)
        .await
        .map_err(|error| TransportError::io(Operation::Bind, &error))?;
    let connecting = timeout(connect_timeout, socket.connect(remote));
    tokio::select! {
        biased;
        _ = cancellation.cancelled() => Err(TransportError::Cancelled),
        result = connecting => match result {
            Err(_) => Err(TransportError::TimedOut { operation: Operation::Connect }),
            Ok(Err(error)) => Err(TransportError::io(Operation::Connect, &error)),
            Ok(Ok(())) => Ok(socket),
        }
    }
}

#[derive(Debug)]
pub struct TcpConnection {
    stream: TcpStream,
    timeouts: IoTimeouts,
    cancellation: CancellationToken,
}

impl TcpConnection {
    pub fn local_addr(&self) -> Result<SocketAddr, TransportError> {
        self.stream
            .local_addr()
            .map_err(|error| TransportError::io(Operation::Configure, &error))
    }

    pub fn peer_addr(&self) -> Result<SocketAddr, TransportError> {
        self.stream
            .peer_addr()
            .map_err(|error| TransportError::io(Operation::Configure, &error))
    }

    pub fn cancellation_token(&self) -> CancellationToken {
        self.cancellation.clone()
    }

    /// Return the connected Tokio stream for protocol engines that require a
    /// single `AsyncRead + AsyncWrite` duplex object.  Such engines become
    /// responsible for applying their own read, write, and cancellation
    /// policy after taking ownership of the stream.
    pub fn into_stream(self) -> TcpStream {
        self.stream
    }

    pub fn into_split(self) -> (TcpReader, TcpWriter) {
        let (reader, writer) = self.stream.into_split();
        (
            TcpReader {
                reader,
                idle_timeout: self.timeouts.idle,
                cancellation: self.cancellation.clone(),
            },
            TcpWriter {
                writer,
                write_timeout: self.timeouts.write,
                cancellation: self.cancellation,
                shutdown: false,
            },
        )
    }
}

#[derive(Debug)]
pub struct TcpReader {
    reader: OwnedReadHalf,
    idle_timeout: Duration,
    cancellation: CancellationToken,
}

impl TcpReader {
    pub async fn read(&mut self, buffer: &mut [u8]) -> Result<usize, TransportError> {
        let reading = timeout(self.idle_timeout, self.reader.read(buffer));
        tokio::select! {
            biased;
            _ = self.cancellation.cancelled() => Err(TransportError::Cancelled),
            result = reading => match result {
                Err(_) => Err(TransportError::TimedOut { operation: Operation::Read }),
                Ok(Err(error)) => Err(TransportError::io(Operation::Read, &error)),
                Ok(Ok(size)) => Ok(size),
            }
        }
    }
}

#[derive(Debug)]
pub struct TcpWriter {
    writer: OwnedWriteHalf,
    write_timeout: Duration,
    cancellation: CancellationToken,
    shutdown: bool,
}

impl TcpWriter {
    pub async fn write_all(&mut self, data: &[u8]) -> Result<(), TransportError> {
        if self.shutdown {
            return Err(TransportError::Io {
                operation: Operation::Write,
                kind: RedactedIoKind::BrokenPipe,
                os_code: None,
            });
        }
        let writing = timeout(self.write_timeout, self.writer.write_all(data));
        tokio::select! {
            biased;
            _ = self.cancellation.cancelled() => Err(TransportError::Cancelled),
            result = writing => match result {
                Err(_) => Err(TransportError::TimedOut { operation: Operation::Write }),
                Ok(Err(error)) => Err(TransportError::io(Operation::Write, &error)),
                Ok(Ok(())) => Ok(()),
            }
        }
    }

    pub async fn shutdown_write(&mut self) -> Result<(), TransportError> {
        if self.shutdown {
            return Ok(());
        }
        let result = timeout(self.write_timeout, self.writer.shutdown()).await;
        self.shutdown = true;
        match result {
            Err(_) => Err(TransportError::TimedOut {
                operation: Operation::Shutdown,
            }),
            Ok(Err(error)) => Err(TransportError::io(Operation::Shutdown, &error)),
            Ok(Ok(())) => Ok(()),
        }
    }

    pub async fn close(&mut self) -> Result<(), TransportError> {
        let result = self.shutdown_write().await;
        self.cancellation.cancel();
        result
    }
}

#[derive(Debug, Clone)]
pub struct UdpConnection {
    socket: Arc<UdpSocket>,
    timeouts: IoTimeouts,
    cancellation: CancellationToken,
}

impl UdpConnection {
    pub fn local_addr(&self) -> Result<SocketAddr, TransportError> {
        self.socket
            .local_addr()
            .map_err(|error| TransportError::io(Operation::Configure, &error))
    }

    pub fn peer_addr(&self) -> Result<SocketAddr, TransportError> {
        self.socket
            .peer_addr()
            .map_err(|error| TransportError::io(Operation::Configure, &error))
    }

    pub fn cancellation_token(&self) -> CancellationToken {
        self.cancellation.clone()
    }

    pub async fn send(&self, datagram: &[u8]) -> Result<usize, TransportError> {
        let sending = timeout(self.timeouts.write, self.socket.send(datagram));
        tokio::select! {
            biased;
            _ = self.cancellation.cancelled() => Err(TransportError::Cancelled),
            result = sending => match result {
                Err(_) => Err(TransportError::TimedOut { operation: Operation::Write }),
                Ok(Err(error)) => Err(TransportError::io(Operation::Write, &error)),
                Ok(Ok(size)) => Ok(size),
            }
        }
    }

    pub async fn recv(&self, buffer: &mut [u8]) -> Result<usize, TransportError> {
        let receiving = timeout(self.timeouts.idle, self.socket.recv(buffer));
        tokio::select! {
            biased;
            _ = self.cancellation.cancelled() => Err(TransportError::Cancelled),
            result = receiving => match result {
                Err(_) => Err(TransportError::TimedOut { operation: Operation::Read }),
                Ok(Err(error)) => Err(TransportError::io(Operation::Read, &error)),
                Ok(Ok(size)) => Ok(size),
            }
        }
    }

    pub fn close(&self) {
        self.cancellation.cancel();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::{TcpListener, UdpSocket as TokioUdpSocket};

    fn test_timeouts() -> IoTimeouts {
        IoTimeouts {
            connect: Duration::from_secs(2),
            write: Duration::from_secs(2),
            idle: Duration::from_secs(2),
        }
    }

    #[tokio::test]
    async fn tcp_loopback_is_binary_safe_and_supports_half_close() {
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut bytes = Vec::new();
            stream.read_to_end(&mut bytes).await.unwrap();
            stream.write_all(&bytes).await.unwrap();
            stream.shutdown().await.unwrap();
        });

        let connector = SocketConnector::new();
        let connection = connector
            .connect_tcp(
                &SocketTarget::new("localhost", address.port()),
                Route::Direct,
                TcpOptions {
                    address_family: AddressFamily::Ipv4Only,
                    timeouts: test_timeouts(),
                    ..TcpOptions::default()
                },
            )
            .await
            .unwrap();
        let (mut reader, mut writer) = connection.into_split();
        let payload = b"\0binary\xffpayload";
        writer.write_all(payload).await.unwrap();
        writer.shutdown_write().await.unwrap();
        writer.shutdown_write().await.unwrap();
        let mut received = vec![0; payload.len()];
        let size = reader.read(&mut received).await.unwrap();
        assert_eq!(&received[..size], payload);
        assert_eq!(reader.read(&mut received).await.unwrap(), 0);
        server.await.unwrap();
    }

    #[tokio::test]
    async fn udp_loopback_preserves_datagram_boundaries_and_zero_length_datagrams() {
        let server = TokioUdpSocket::bind((Ipv4Addr::LOCALHOST, 0))
            .await
            .unwrap();
        let address = server.local_addr().unwrap();
        let server_task = tokio::spawn(async move {
            let mut buffer = [0_u8; 32];
            for _ in 0..2 {
                let (size, peer) = server.recv_from(&mut buffer).await.unwrap();
                server.send_to(&buffer[..size], peer).await.unwrap();
            }
        });

        let connection = SocketConnector::new()
            .connect_udp(
                &SocketTarget::new("localhost", address.port()),
                Route::Direct,
                UdpOptions {
                    address_family: AddressFamily::Ipv4Only,
                    timeouts: test_timeouts(),
                    ..UdpOptions::default()
                },
            )
            .await
            .unwrap();
        assert_eq!(connection.send(b"one").await.unwrap(), 3);
        assert_eq!(connection.send(b"").await.unwrap(), 0);
        let mut buffer = [0_u8; 32];
        assert_eq!(connection.recv(&mut buffer).await.unwrap(), 3);
        assert_eq!(&buffer[..3], b"one");
        assert_eq!(connection.recv(&mut buffer).await.unwrap(), 0);
        server_task.await.unwrap();
    }

    #[tokio::test]
    async fn unsupported_routes_fail_closed_without_touching_the_network() {
        let connector = SocketConnector::new();
        for route in [
            Route::HttpConnect,
            Route::Socks4,
            Route::Socks5,
            Route::SshJump,
            Route::Tls,
            Route::StartTls,
        ] {
            let error = connector
                .connect_tcp(
                    &SocketTarget::new("example.invalid", 443),
                    route,
                    TcpOptions::default(),
                )
                .await
                .unwrap_err();
            assert_eq!(
                error,
                TransportError::UnsupportedRoute {
                    protocol: TransportProtocol::Tcp,
                    route: route.kind(),
                }
            );
        }
    }

    #[tokio::test]
    async fn cancellation_interrupts_idle_receive_and_close_is_idempotent() {
        let server = TokioUdpSocket::bind((Ipv4Addr::LOCALHOST, 0))
            .await
            .unwrap();
        let address = server.local_addr().unwrap();
        let connector = SocketConnector::new();
        let connection = connector
            .connect_udp(
                &SocketTarget::new(address.ip().to_string(), address.port()),
                Route::Direct,
                UdpOptions {
                    timeouts: test_timeouts(),
                    ..UdpOptions::default()
                },
            )
            .await
            .unwrap();
        connection.close();
        connection.close();
        let mut buffer = [0_u8; 1];
        assert_eq!(
            connection.recv(&mut buffer).await,
            Err(TransportError::Cancelled)
        );
    }

    #[tokio::test]
    async fn explicit_local_bind_is_honored() {
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move { listener.accept().await.unwrap().1 });
        let connection = SocketConnector::new()
            .connect_tcp(
                &SocketTarget::new(address.ip().to_string(), address.port()),
                Route::Direct,
                TcpOptions {
                    local_bind: Some(LocalBind {
                        address: IpAddr::V4(Ipv4Addr::LOCALHOST),
                        port: 0,
                    }),
                    timeouts: test_timeouts(),
                    ..TcpOptions::default()
                },
            )
            .await
            .unwrap();
        assert_eq!(
            connection.local_addr().unwrap().ip(),
            IpAddr::V4(Ipv4Addr::LOCALHOST)
        );
        assert_eq!(server.await.unwrap().ip(), IpAddr::V4(Ipv4Addr::LOCALHOST));
    }
}
