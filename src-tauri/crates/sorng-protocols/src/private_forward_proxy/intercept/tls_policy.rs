//! Device-facing TLS policy. Modern browser-facing TLS is independent.
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum UpstreamTlsProfile {
    #[default]
    Modern,
    Tls12,
    Tls13,
    Tls10,
    Tls11,
    Ssl3,
    Ssl2,
    /// Explicit opt-in: negotiate SSLv3 through TLS 1.2. SSLv2 is exact-only.
    Legacy,
}

impl UpstreamTlsProfile {
    pub fn requires_helper(self) -> bool {
        matches!(
            self,
            Self::Tls10 | Self::Tls11 | Self::Ssl3 | Self::Ssl2 | Self::Legacy
        )
    }

    pub(crate) fn helper_name(self) -> &'static str {
        match self {
            Self::Tls10 => "tls10",
            Self::Tls11 => "tls11",
            Self::Ssl3 => "ssl3",
            Self::Ssl2 => "ssl2",
            Self::Legacy => "legacy",
            _ => "unsupported",
        }
    }
}

/// Bounded, typed causes: never display arbitrary backend error strings.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum TlsFailure {
    Parameters,
    Engine,
    Version,
    Cipher,
    SignatureAlgorithm,
    KeyExchange,
    Alpn,
    InvalidHandshake,
    Decryption,
    PeerHandshakeAlert,
    PeerSecurityAlert,
    PeerAlert(u8),
    Reset,
    Eof,
    Timeout,
    HelperUnavailable,
    HelperProtocol,
    HelperEngine(u32),
}

impl TlsFailure {
    pub(crate) fn code(self) -> &'static str {
        match self {
            Self::Parameters => "tls-incompatible-parameters",
            Self::Engine => "tls-engine-failed",
            Self::Version => "tls-version-mismatch",
            Self::Cipher => "tls-cipher-mismatch",
            Self::SignatureAlgorithm => "tls-signature-algorithm",
            Self::KeyExchange => "tls-key-exchange",
            Self::Alpn => "tls-alpn-mismatch",
            Self::InvalidHandshake => "tls-invalid-handshake",
            Self::Decryption => "tls-decryption-failed",
            Self::PeerHandshakeAlert => "tls-peer-handshake-failure",
            Self::PeerSecurityAlert => "tls-peer-insufficient-security",
            Self::PeerAlert(_) => "tls-peer-alert",
            Self::Reset => "tls-connection-reset",
            Self::Eof => "tls-unexpected-eof",
            Self::Timeout => "tls-handshake-timeout",
            Self::HelperUnavailable => "tls-legacy-unavailable",
            Self::HelperProtocol => "tls-legacy-helper-protocol",
            Self::HelperEngine(_) => "tls-legacy-engine",
        }
    }

    pub(crate) fn detail(self) -> &'static str {
        match self {
            Self::Parameters => "The peer's TLS extensions or handshake parameters are incompatible with this backend's configuration.",
            Self::Engine => "The TLS engine could not complete the handshake. It did not provide a more specific supported failure category.",
            Self::Version => "The peer rejected the offered SSL/TLS versions, or no supported version was shared.",
            Self::Cipher => "The TLS peers have no supported cipher suite in common.",
            Self::SignatureAlgorithm => "The TLS peers have no compatible signature algorithm.",
            Self::KeyExchange => "The TLS peers have no compatible key exchange group or parameters.",
            Self::Alpn => "The TLS peers could not agree on an application protocol (ALPN).",
            Self::InvalidHandshake => "The TLS peer sent malformed or unexpected handshake data. An HTTP service on the HTTPS port can also cause this.",
            Self::Decryption => "TLS record decryption or handshake integrity verification failed.",
            Self::PeerHandshakeAlert => "The server sent handshake_failure (alert 40). It did not specify whether the cause was ciphers, signatures, client authentication, or another handshake requirement.",
            Self::PeerSecurityAlert => "The server sent insufficient_security (alert 71), rejecting the offered security parameters.",
            Self::PeerAlert(_) => "The server terminated negotiation with a TLS alert. The alert number is included in the cause chain.",
            Self::Reset => "The connection was reset during the SSL/TLS handshake. The peer did not report a protocol or certificate cause.",
            Self::Eof => "The peer closed the connection during the SSL/TLS handshake without a complete TLS error alert.",
            Self::Timeout => "The SSL/TLS handshake did not complete within 30 seconds.",
            Self::HelperUnavailable => "The selected legacy SSL/TLS profile requires the sorng-legacy-tls helper, which is missing or could not be started.",
            Self::HelperProtocol => "The legacy SSL/TLS helper exited or returned an invalid or oversized protocol message.",
            Self::HelperEngine(_) => "The legacy SSL/TLS engine rejected the handshake. Its numeric OpenSSL error code is included in the cause chain.",
        }
    }
}

impl std::fmt::Display for TlsFailure {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.detail())?;
        match self {
            Self::PeerAlert(n) => {
                let name = match n {
                    10 => "unexpected_message",
                    20 => "bad_record_mac",
                    21 => "decryption_failed",
                    22 => "record_overflow",
                    30 => "decompression_failure",
                    41 => "no_certificate",
                    42 => "bad_certificate",
                    43 => "unsupported_certificate",
                    44 => "certificate_revoked",
                    45 => "certificate_expired",
                    46 => "certificate_unknown",
                    47 => "illegal_parameter",
                    48 => "unknown_ca",
                    49 => "access_denied",
                    50 => "decode_error",
                    51 => "decrypt_error",
                    60 => "export_restriction",
                    80 => "internal_error",
                    86 => "inappropriate_fallback",
                    90 => "user_canceled",
                    100 => "no_renegotiation",
                    109 => "missing_extension",
                    110 => "unsupported_extension",
                    112 => "unrecognized_name",
                    113 => "bad_certificate_status_response",
                    115 => "unknown_psk_identity",
                    116 => "certificate_required",
                    120 => "no_application_protocol",
                    _ => "unknown_alert",
                };
                write!(f, " Alert: {n} ({name}).")
            }
            Self::HelperEngine(n) => write!(f, " OpenSSL error: 0x{n:08x}."),
            _ => Ok(()),
        }
    }
}
impl std::error::Error for TlsFailure {}
