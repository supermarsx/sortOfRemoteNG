//! Error types for the ARD protocol stack.

use std::fmt;

/// Top-level ARD error.
#[derive(Debug)]
pub enum ArdError {
    /// Network-level I/O failure.
    Io(std::io::Error),
    /// RFB protocol violation.
    Protocol(String),
    /// Authentication failure (VNC-auth, ARD-auth, or Mac OS auth).
    Auth(String),
    /// The server offered no security types we support.
    UnsupportedSecurity(Vec<u8>),
    /// Unsupported RFB encoding.
    UnsupportedEncoding(i32),
    /// Server sent a framebuffer update we cannot decode.
    Decoding(String),
    /// Clipboard operation failure.
    Clipboard(String),
    /// File transfer failure.
    FileTransfer(String),
    /// Server refused a curtain-mode request.
    Curtain(String),
    /// Timeout expired.
    Timeout(String),
    /// TLS/encryption error.
    Tls(String),
    /// DH key-exchange error.
    DiffieHellman(String),
    /// Generic internal error.
    Internal(String),
}

impl fmt::Display for ArdError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Io(e) => write!(f, "I/O error: {e}"),
            Self::Protocol(msg) => write!(f, "Protocol error: {msg}"),
            Self::Auth(msg) => write!(f, "Authentication error: {msg}"),
            Self::UnsupportedSecurity(types) => {
                write!(f, "Unsupported security types: {types:?}")
            }
            Self::UnsupportedEncoding(enc) => {
                write!(f, "Unsupported encoding: {enc}")
            }
            Self::Decoding(msg) => write!(f, "Decoding error: {msg}"),
            Self::Clipboard(msg) => write!(f, "Clipboard error: {msg}"),
            Self::FileTransfer(msg) => write!(f, "File transfer error: {msg}"),
            Self::Curtain(msg) => write!(f, "Curtain mode error: {msg}"),
            Self::Timeout(msg) => write!(f, "Timeout: {msg}"),
            Self::Tls(msg) => write!(f, "TLS error: {msg}"),
            Self::DiffieHellman(msg) => write!(f, "DH key exchange error: {msg}"),
            Self::Internal(msg) => write!(f, "Internal error: {msg}"),
        }
    }
}

impl std::error::Error for ArdError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Io(e) => Some(e),
            _ => None,
        }
    }
}

impl From<std::io::Error> for ArdError {
    fn from(e: std::io::Error) -> Self {
        Self::Io(e)
    }
}

impl From<ArdError> for String {
    fn from(e: ArdError) -> Self {
        e.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn error_display() {
        let e = ArdError::Auth("bad password".into());
        assert!(e.to_string().contains("bad password"));
    }

    #[test]
    fn io_error_conversion() {
        let io = std::io::Error::new(std::io::ErrorKind::ConnectionRefused, "refused");
        let e: ArdError = io.into();
        assert!(matches!(e, ArdError::Io(_)));
        assert!(e.to_string().contains("refused"));
    }

    #[test]
    fn string_conversion() {
        let e = ArdError::Protocol("bad handshake".into());
        let s: String = e.into();
        assert!(s.contains("bad handshake"));
    }
}
