//! ARD-specific error types.

use std::fmt;
use std::io;

/// Errors that can occur during ARD protocol operations.
#[derive(Debug)]
pub enum ArdError {
    /// I/O error from the underlying TCP connection.
    Io(io::Error),
    /// An RFB protocol violation or unexpected message.
    Protocol(String),
    /// Authentication failure.
    Auth(String),
    /// The server offered a security type we don't support.
    UnsupportedSecurity(u8),
    /// The server used an encoding we don't support.
    UnsupportedEncoding(i32),
    /// Framebuffer data could not be decoded.
    Decoding(String),
    /// Clipboard operation failed.
    Clipboard(String),
    /// File-transfer operation failed.
    FileTransfer(String),
    /// Curtain-mode operation failed.
    Curtain(String),
    /// A timeout occurred.
    Timeout(String),
    /// TLS error.
    Tls(String),
    /// Diffie-Hellman key exchange error.
    DiffieHellman(String),
    /// Internal / catch-all error.
    Internal(String),
}

impl fmt::Display for ArdError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Io(e) => write!(f, "I/O error: {e}"),
            Self::Protocol(msg) => write!(f, "Protocol error: {msg}"),
            Self::Auth(msg) => write!(f, "Authentication error: {msg}"),
            Self::UnsupportedSecurity(t) => write!(f, "Unsupported security type: {t}"),
            Self::UnsupportedEncoding(e) => write!(f, "Unsupported encoding: 0x{e:08x}"),
            Self::Decoding(msg) => write!(f, "Decoding error: {msg}"),
            Self::Clipboard(msg) => write!(f, "Clipboard error: {msg}"),
            Self::FileTransfer(msg) => write!(f, "File transfer error: {msg}"),
            Self::Curtain(msg) => write!(f, "Curtain mode error: {msg}"),
            Self::Timeout(msg) => write!(f, "Timeout: {msg}"),
            Self::Tls(msg) => write!(f, "TLS error: {msg}"),
            Self::DiffieHellman(msg) => write!(f, "DH error: {msg}"),
            Self::Internal(msg) => write!(f, "Internal error: {msg}"),
        }
    }
}

impl std::error::Error for ArdError {}

impl From<io::Error> for ArdError {
    fn from(e: io::Error) -> Self {
        // WouldBlock means no data available (non-blocking read).
        if e.kind() == io::ErrorKind::WouldBlock {
            return Self::Io(e);
        }
        Self::Io(e)
    }
}

impl From<ArdError> for String {
    fn from(e: ArdError) -> String {
        e.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn error_display() {
        let e = ArdError::Auth("bad password".into());
        assert_eq!(e.to_string(), "Authentication error: bad password");
    }

    #[test]
    fn io_error_conversion() {
        let io_err = io::Error::new(io::ErrorKind::ConnectionRefused, "refused");
        let ard_err: ArdError = io_err.into();
        assert!(matches!(ard_err, ArdError::Io(_)));
    }

    #[test]
    fn string_conversion() {
        let e = ArdError::Protocol("unexpected".into());
        let s: String = e.into();
        assert!(s.contains("Protocol error"));
    }
}
