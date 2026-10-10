//! Bounded recovery on the existing listener, never a new listener or route.
use std::{future::Future, io, net::SocketAddr, time::Duration};
use tokio::net::{TcpListener, TcpStream};

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
        // resource exhaustion stay terminal. Do not guess from raw error text
        // or retry broad categories such as Other, NotConnected or TimedOut.
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
            // Fixed text only: socket errors can carry paths or endpoint data.
            log::warn!("Private proxy listener transient accept error; bounded retry pending");
        }
        self.retries += 1;
        Some(delay)
    }
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
