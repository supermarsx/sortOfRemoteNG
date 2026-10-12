//! Bounded listener recovery. Transient accept errors retry on the existing
//! listener. A terminal accept failure rebinds the SAME loopback endpoint,
//! because the browser context's proxy endpoint is fixed for its lifetime.
//! Never a different port, route, credential or grant, and never unbounded.
use super::revoked;
use std::{
    future::Future,
    io,
    net::{Ipv4Addr, SocketAddr},
    time::Duration,
};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::watch;
use tokio::task::JoinSet;

/// Private cancellation-safe seam: production uses Tokio directly; tests inject
/// accept errors while retaining real loopback sockets and the real serve loop.
pub(super) trait AcceptListener: Send + 'static {
    fn accept(&mut self) -> impl Future<Output = io::Result<(TcpStream, SocketAddr)>> + Send + '_;
}

impl AcceptListener for TcpListener {
    fn accept(&mut self) -> impl Future<Output = io::Result<(TcpStream, SocketAddr)>> + Send + '_ {
        TcpListener::accept(self)
    }
}

/// Private cancellation-safe seam for obtaining a listener and for waiting
/// between attempts: production binds Tokio loopback sockets and sleeps on
/// Tokio's clock; tests script bind failures and the clock.
pub(super) trait ListenerSource: Send + 'static {
    type Listener: AcceptListener;
    /// Loopback only. Port 0 selects an ephemeral port (the initial bind); a
    /// rebind passes the port that the browser context already holds.
    fn bind(
        &mut self,
        port: u16,
    ) -> impl Future<Output = io::Result<(Self::Listener, SocketAddr)>> + Send + '_;
    fn pause(&mut self, delay: Duration) -> impl Future<Output = ()> + Send + '_;
}

pub(super) struct LoopbackSource;

impl ListenerSource for LoopbackSource {
    type Listener = TcpListener;

    async fn bind(&mut self, port: u16) -> io::Result<(TcpListener, SocketAddr)> {
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, port)).await?;
        let address = listener.local_addr()?;
        Ok((listener, address))
    }

    fn pause(&mut self, delay: Duration) -> impl Future<Output = ()> + Send + '_ {
        tokio::time::sleep(delay)
    }
}

// Initial bind: three attempts, waiting 0/50/200 ms before each. Any error kind
// is retried, since nothing is known yet about a socket that never existed.
pub(super) const BIND_DELAYS: [Duration; 3] = [
    Duration::ZERO,
    Duration::from_millis(50),
    Duration::from_millis(200),
];

// Rebinding after a terminal accept failure: three attempts, waiting
// 100/300/900 ms before each, 1.3 s in total before the relay ends.
pub(super) const REBIND_DELAYS: [Duration; 3] = [
    Duration::from_millis(100),
    Duration::from_millis(300),
    Duration::from_millis(900),
];

/// A bound relay endpoint and the source that can bind that endpoint again.
pub(super) struct Endpoint<S: ListenerSource> {
    pub listener: S::Listener,
    pub source: S,
    pub address: SocketAddr,
}

impl<S: ListenerSource> Endpoint<S> {
    /// Dropping this future cancels the pending attempt and every later one.
    pub async fn bind(mut source: S) -> io::Result<Self> {
        let attempts = BIND_DELAYS.len();
        let mut kind = io::ErrorKind::Other;
        for (attempt, delay) in BIND_DELAYS.into_iter().enumerate() {
            if !delay.is_zero() {
                source.pause(delay).await;
            }
            match source.bind(0).await {
                Ok((listener, address)) => {
                    if attempt > 0 {
                        log::info!(
                            "Private proxy listener bound on attempt {} of {attempts}",
                            attempt + 1
                        );
                    }
                    return Ok(Self {
                        listener,
                        source,
                        address,
                    });
                }
                Err(error) => {
                    // Kind only: socket errors can carry paths or endpoint data.
                    kind = error.kind();
                    log::warn!(
                        "Private proxy listener bind failed ({kind:?}); attempt {} of {attempts}",
                        attempt + 1
                    );
                }
            }
        }
        log::error!("Private proxy listener unavailable ({kind:?}); bind attempts exhausted");
        Err(io::Error::new(kind, "Private proxy listener bind failed"))
    }
}

// Five retries, 775 ms total scheduled delay. Every error waits, including
// Interrupted/WouldBlock, so a permanently ready failing socket cannot spin.
const DELAYS: [Duration; 5] = [
    Duration::from_millis(25),
    Duration::from_millis(50),
    Duration::from_millis(100),
    Duration::from_millis(200),
    Duration::from_millis(400),
];

#[derive(Default)]
pub(super) struct AcceptBackoff {
    retries: usize,
}

impl AcceptBackoff {
    pub fn retry_delay(&mut self, error: &io::Error) -> Option<Duration> {
        // Use the classified OS equivalents on Windows, Linux and macOS. An
        // incoming peer can abort/reset before accept; that is not a broken
        // listening socket. Unknown errors, permission/descriptor failures and
        // resource exhaustion are terminal for this listener and go to a rebind.
        // Do not guess from raw error text or retry broad categories such as
        // Other, NotConnected or TimedOut.
        if !matches!(
            error.kind(),
            io::ErrorKind::Interrupted
                | io::ErrorKind::WouldBlock
                | io::ErrorKind::ConnectionAborted
                | io::ErrorKind::ConnectionReset
        ) {
            return None;
        }
        let delay = DELAYS.get(self.retries).copied()?;
        if self.retries == 0 {
            // Fixed text and kind only: socket errors can carry paths or endpoint data.
            log::warn!(
                "Private proxy listener transient accept error ({:?}); bounded retry pending",
                error.kind()
            );
        }
        self.retries += 1;
        Some(delay)
    }
}

/// Rebind attempts spent since a connection was last accepted. A listener that
/// rebinds but never accepts again therefore cannot rebind without bound.
#[derive(Default)]
pub(super) struct RebindBudget {
    attempts: usize,
}

impl RebindBudget {
    fn next_delay(&mut self) -> Option<Duration> {
        let delay = REBIND_DELAYS.get(self.attempts).copied()?;
        self.attempts += 1;
        Some(delay)
    }
}

pub(super) enum Rebound<L> {
    Listener(L),
    Revoked,
    Exhausted,
}

/// Replaces a listener whose accept failed terminally. The caller has already
/// dropped that listener, so the port is free. Credentials, grants, the dialer
/// and established tunnels are untouched; revocation and reaping stay live
/// through every wait and every bind.
pub(super) async fn rebind<S: ListenerSource>(
    source: &mut S,
    address: SocketAddr,
    failure: io::ErrorKind,
    budget: &mut RebindBudget,
    stop: &watch::Receiver<bool>,
    clients: &mut JoinSet<()>,
    refusals: &mut JoinSet<()>,
) -> Rebound<S::Listener> {
    let attempts = REBIND_DELAYS.len();
    let mut kind = failure;
    while let Some(delay) = budget.next_delay() {
        {
            // One wait per attempt: client completions must not restart it.
            let pause = source.pause(delay);
            tokio::pin!(pause);
            loop {
                tokio::select! {
                    biased;
                    _ = revoked(stop.clone()) => return Rebound::Revoked,
                    Some(_) = clients.join_next(), if !clients.is_empty() => {},
                    Some(_) = refusals.join_next(), if !refusals.is_empty() => {},
                    _ = &mut pause => break,
                }
            }
        }
        let bound = tokio::select! {
            biased;
            _ = revoked(stop.clone()) => return Rebound::Revoked,
            bound = source.bind(address.port()) => bound,
        };
        match bound {
            Ok((listener, bound_address)) if bound_address == address => {
                log::info!(
                    "Private proxy listener rebound on attempt {} of {attempts}",
                    budget.attempts
                );
                return Rebound::Listener(listener);
            }
            // Never serve from an endpoint the browser context does not hold.
            Ok(_) => kind = io::ErrorKind::AddrNotAvailable,
            Err(error) => kind = error.kind(),
        }
        log::warn!(
            "Private proxy listener rebind failed ({kind:?}); attempt {} of {attempts}",
            budget.attempts
        );
    }
    log::error!("Private proxy listener failed ({kind:?}); rebind attempts exhausted");
    Rebound::Exhausted
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn retries_are_positive_increasing_and_bounded_for_each_allowed_kind() {
        for kind in [
            io::ErrorKind::Interrupted,
            io::ErrorKind::WouldBlock,
            io::ErrorKind::ConnectionAborted,
            io::ErrorKind::ConnectionReset,
        ] {
            let mut backoff = AcceptBackoff::default();
            let error = io::Error::from(kind);
            let expected = [25, 50, 100, 200, 400].map(Duration::from_millis);
            for delay in expected {
                assert_eq!(backoff.retry_delay(&error), Some(delay));
            }
            assert_eq!(backoff.retry_delay(&error), None);
            assert_eq!(backoff.retry_delay(&error), None);
        }
    }

    #[test]
    fn unclassified_and_listener_failures_are_not_retried() {
        for kind in [
            io::ErrorKind::PermissionDenied,
            io::ErrorKind::InvalidInput,
            io::ErrorKind::NotConnected,
            io::ErrorKind::AddrNotAvailable,
            io::ErrorKind::AddrInUse,
            io::ErrorKind::ConnectionRefused,
            io::ErrorKind::TimedOut,
            io::ErrorKind::BrokenPipe,
            io::ErrorKind::Unsupported,
            io::ErrorKind::Other,
        ] {
            assert_eq!(
                AcceptBackoff::default().retry_delay(&io::Error::from(kind)),
                None
            );
        }
    }

    #[test]
    fn bind_and_rebind_schedules_are_the_bounded_relay_contract() {
        assert_eq!(BIND_DELAYS, [0, 50, 200].map(Duration::from_millis));
        assert_eq!(REBIND_DELAYS, [100, 300, 900].map(Duration::from_millis));
        let mut budget = RebindBudget::default();
        for delay in REBIND_DELAYS {
            assert_eq!(budget.next_delay(), Some(delay));
        }
        assert_eq!(budget.next_delay(), None);
        assert_eq!(budget.next_delay(), None);
    }

    #[tokio::test]
    async fn loopback_source_rebinds_exactly_the_released_port() {
        let (listener, address) = LoopbackSource.bind(0).await.unwrap();
        assert_eq!(address.ip(), Ipv4Addr::LOCALHOST);
        assert_ne!(address.port(), 0);
        // A port that is still held is an error, never a second endpoint.
        assert!(LoopbackSource.bind(address.port()).await.is_err());
        drop(listener);
        let (_rebound, rebound_address) = LoopbackSource.bind(address.port()).await.unwrap();
        assert_eq!(rebound_address, address);
    }

    #[cfg(windows)]
    #[test]
    fn winsock_equivalents_use_the_same_narrow_policy() {
        for code in [10035, 10053, 10054] {
            // WSAEWOULDBLOCK, WSAECONNABORTED, WSAECONNRESET.
            assert!(
                AcceptBackoff::default()
                    .retry_delay(&io::Error::from_raw_os_error(code))
                    .is_some(),
                "expected retry for Winsock code {code}"
            );
        }
        for code in [10004, 10013, 10022, 10024, 10038, 10050, 10055, 10093] {
            // WSAEINTR cancels a legacy blocking Winsock call, not Tokio's
            // asynchronous accept. Rust leaves it unclassified; keep it fatal.
            // Access, argument, descriptor, socket, network, buffer and startup
            // failures do not establish that this listener remains usable.
            assert!(
                AcceptBackoff::default()
                    .retry_delay(&io::Error::from_raw_os_error(code))
                    .is_none(),
                "unexpected retry for Winsock code {code}"
            );
        }
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn linux_equivalents_use_the_same_narrow_policy() {
        for code in [4, 11, 103, 104] {
            // EINTR, EAGAIN/EWOULDBLOCK, ECONNABORTED, ECONNRESET.
            assert!(AcceptBackoff::default()
                .retry_delay(&io::Error::from_raw_os_error(code))
                .is_some());
        }
        for code in [9, 12, 13, 22, 23, 24, 88, 100, 105] {
            assert!(AcceptBackoff::default()
                .retry_delay(&io::Error::from_raw_os_error(code))
                .is_none());
        }
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn macos_equivalents_use_the_same_narrow_policy() {
        for code in [4, 35, 53, 54] {
            // EINTR, EAGAIN/EWOULDBLOCK, ECONNABORTED, ECONNRESET.
            assert!(AcceptBackoff::default()
                .retry_delay(&io::Error::from_raw_os_error(code))
                .is_some());
        }
        for code in [9, 12, 13, 22, 23, 24, 38, 50, 55] {
            assert!(AcceptBackoff::default()
                .retry_delay(&io::Error::from_raw_os_error(code))
                .is_none());
        }
    }
}
