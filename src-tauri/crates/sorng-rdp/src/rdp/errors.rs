//! Typed error hierarchy for the RDP subsystem.
//!
//! Every transport layer returns specific status codes instead of opaque
//! strings.  This lets callers make *match*-based decisions (e.g. "is this
//! a network error eligible for reconnect?") rather than fragile substring
//! matching on error messages.

use std::fmt;
use std::io;

// ---------------------------------------------------------------------------
// Top-level RDP error
// ---------------------------------------------------------------------------

/// Structured error type for the RDP session lifecycle.
///
/// Each variant maps to a failure *category* — callers match on the variant
/// to decide the recovery strategy (reconnect, abort, ignore, etc.) without
/// parsing the inner description string.
#[derive(Debug)]
pub enum RdpError {
    /// DNS resolution or TCP-level connect failure.
    TcpConnect(String),

    /// TLS handshake or certificate validation failure.
    TlsHandshake(String),

    /// CredSSP / NLA authentication failure.
    Authentication(String),

    /// Connection-sequence protocol error (capability exchange, GCC/MCS, etc.).
    Protocol(String),

    /// Network I/O error during an established session.
    /// These are eligible for automatic reconnection.
    Network(io::Error),

    /// The server cleanly terminated the session (logoff, admin disconnect).
    ServerTerminated(String),

    /// The session was shut down by local request (user or system).
    Shutdown,

    /// The remote host sent an unexpected EOF (zero-byte read).
    /// Tracked separately so the consecutive-zero-byte-read counter
    /// can distinguish this from other network errors.
    UnexpectedEof,

    /// Too many consecutive processing errors without a successful PDU.
    /// The threshold is configurable.
    ErrorThresholdExceeded {
        consecutive: u32,
        threshold: u32,
        last_error: String,
    },

    /// Reactivation (Deactivate-All → Capability re-exchange) failed.
    ReactivationFailed(String),

    /// Catch-all for unexpected errors that don't fit another category.
    Other(String),
}

impl fmt::Display for RdpError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            RdpError::TcpConnect(msg) => write!(f, "TCP connect: {msg}"),
            RdpError::TlsHandshake(msg) => write!(f, "TLS handshake: {msg}"),
            RdpError::Authentication(msg) => write!(f, "Authentication: {msg}"),
            RdpError::Protocol(msg) => write!(f, "Protocol: {msg}"),
            RdpError::Network(e) => write!(f, "Network I/O: {e}"),
            RdpError::ServerTerminated(msg) => write!(f, "Server terminated: {msg}"),
            RdpError::Shutdown => write!(f, "Session shutdown"),
            RdpError::UnexpectedEof => write!(f, "Unexpected EOF (server closed connection)"),
            RdpError::ErrorThresholdExceeded {
                consecutive,
                threshold,
                last_error,
            } => write!(
                f,
                "Error threshold exceeded ({consecutive}/{threshold}): {last_error}"
            ),
            RdpError::ReactivationFailed(msg) => write!(f, "Reactivation failed: {msg}"),
            RdpError::Other(msg) => write!(f, "{msg}"),
        }
    }
}

impl std::error::Error for RdpError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            RdpError::Network(e) => Some(e),
            _ => None,
        }
    }
}

impl RdpError {
    /// Returns `true` if this error represents a network-level failure
    /// that is eligible for automatic reconnection.
    pub fn is_recoverable(&self) -> bool {
        matches!(
            self,
            RdpError::Network(_) | RdpError::UnexpectedEof | RdpError::TcpConnect(_)
        )
    }

    /// Returns `true` if this error means the session was intentionally
    /// terminated (by the user, admin, or server logoff).
    pub fn is_intentional_termination(&self) -> bool {
        matches!(self, RdpError::Shutdown | RdpError::ServerTerminated(_))
    }

    /// Classify an `io::Error` into the appropriate `RdpError` variant.
    /// Checks for zero-length reads separately from other I/O failures.
    pub fn from_io(e: io::Error) -> Self {
        if e.kind() == io::ErrorKind::UnexpectedEof {
            RdpError::UnexpectedEof
        } else {
            RdpError::Network(e)
        }
    }

    /// Classify an error string using heuristics.  This is the migration
    /// bridge — existing code that only has a `String` can still be
    /// classified, but new code should produce typed errors directly.
    pub fn classify_str(msg: &str) -> Self {
        if msg.contains("session_shutdown") {
            return RdpError::Shutdown;
        }
        if msg.contains("DNS resolution failed") || msg.contains("connect timed out") {
            return RdpError::TcpConnect(msg.to_string());
        }
        if msg.contains("TLS") || msg.contains("tls") || msg.contains("certificate") {
            return RdpError::TlsHandshake(msg.to_string());
        }
        if msg.contains("CredSSP")
            || msg.contains("authentication")
            || msg.contains("NLA")
            || msg.contains("NTLM")
        {
            return RdpError::Authentication(msg.to_string());
        }
        if is_network_error_heuristic(msg) {
            return RdpError::Network(io::Error::new(io::ErrorKind::ConnectionReset, msg));
        }
        if msg.contains("Reactivation") {
            return RdpError::ReactivationFailed(msg.to_string());
        }
        RdpError::Protocol(msg.to_string())
    }
}

impl From<io::Error> for RdpError {
    fn from(e: io::Error) -> Self {
        RdpError::from_io(e)
    }
}

// ---------------------------------------------------------------------------
// Heuristic helpers (replaces the old free-function `is_network_error_str`)
// ---------------------------------------------------------------------------

/// Check if an error message string indicates a network-level failure.
fn is_network_error_heuristic(s: &str) -> bool {
    s.contains("10054") // connection reset (Windows)
        || s.contains("10053") // connection aborted (Windows)
        || s.contains("forcibly closed")
        || s.contains("connection reset")
        || s.contains("broken pipe")
        || s.contains("Connection reset")
        || s.contains("Write failed")
        || s.contains("Failed to send response frame")
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn network_errors_are_recoverable() {
        let e = RdpError::Network(io::Error::new(io::ErrorKind::ConnectionReset, "reset"));
        assert!(e.is_recoverable());
    }

    #[test]
    fn eof_is_recoverable() {
        assert!(RdpError::UnexpectedEof.is_recoverable());
    }

    #[test]
    fn protocol_errors_are_not_recoverable() {
        let e = RdpError::Protocol("bad PDU".into());
        assert!(!e.is_recoverable());
    }

    #[test]
    fn shutdown_is_intentional() {
        assert!(RdpError::Shutdown.is_intentional_termination());
    }

    #[test]
    fn server_terminated_is_intentional() {
        let e = RdpError::ServerTerminated("logoff".into());
        assert!(e.is_intentional_termination());
    }

    #[test]
    fn classify_str_shutdown() {
        let e = RdpError::classify_str("session_shutdown: cancelled");
        assert!(matches!(e, RdpError::Shutdown));
    }

    #[test]
    fn classify_str_network() {
        let e = RdpError::classify_str("connection forcibly closed by remote host");
        assert!(e.is_recoverable());
    }

    #[test]
    fn classify_str_tls() {
        let e = RdpError::classify_str("TLS handshake failed: invalid cert");
        assert!(matches!(e, RdpError::TlsHandshake(_)));
    }

    #[test]
    fn classify_str_auth() {
        let e = RdpError::classify_str("CredSSP authentication error");
        assert!(matches!(e, RdpError::Authentication(_)));
    }

    #[test]
    fn from_io_eof() {
        let io_err = io::Error::new(io::ErrorKind::UnexpectedEof, "eof");
        let e = RdpError::from_io(io_err);
        assert!(matches!(e, RdpError::UnexpectedEof));
    }

    #[test]
    fn from_io_network() {
        let io_err = io::Error::new(io::ErrorKind::ConnectionReset, "reset");
        let e = RdpError::from_io(io_err);
        assert!(matches!(e, RdpError::Network(_)));
    }

    #[test]
    fn error_threshold_display() {
        let e = RdpError::ErrorThresholdExceeded {
            consecutive: 10,
            threshold: 10,
            last_error: "bad frame".into(),
        };
        let msg = format!("{e}");
        assert!(msg.contains("10/10"));
        assert!(msg.contains("bad frame"));
    }

    #[test]
    fn tcp_connect_is_recoverable() {
        let e = RdpError::TcpConnect("timeout".into());
        assert!(e.is_recoverable());
    }

    #[test]
    fn auth_is_not_recoverable() {
        let e = RdpError::Authentication("bad password".into());
        assert!(!e.is_recoverable());
    }

    #[test]
    fn display_formats() {
        assert_eq!(format!("{}", RdpError::Shutdown), "Session shutdown");
        assert_eq!(
            format!("{}", RdpError::UnexpectedEof),
            "Unexpected EOF (server closed connection)"
        );
    }
}
