//! Extensions for the HTTP/3 protocol.

use std::str::FromStr;

/// Describes the `:protocol` pseudo-header for extended connect
///
/// See: <https://www.rfc-editor.org/rfc/rfc8441#section-4>
#[derive(Copy, PartialEq, Debug, Clone)]
pub struct Protocol(ProtocolInner);

impl Protocol {
    /// WebTransport protocol
    pub const WEB_TRANSPORT: Protocol = Protocol(ProtocolInner::WebTransport);
    /// RFC 9298 protocol
    pub const CONNECT_UDP: Protocol = Protocol(ProtocolInner::ConnectUdp);

    // ── SSH3 extended-CONNECT enablement patch (sortOfRemoteNG) ─────────────
    // Upstream h3 0.0.8 models `:protocol` as a CLOSED enum (`WebTransport` /
    // `ConnectUdp`) with no constructor for an arbitrary token, so an SSH3
    // client cannot emit the `:protocol = ssh3` extended-CONNECT pseudo-header
    // that real `francoismichel/ssh3` servers require to route the request.
    // This minimal additive patch adds an `Other(&'static str)` variant
    // (keeping `Protocol: Copy`, which `proto/headers.rs` relies on via
    // `.copied()`) plus a `from_static` constructor; `as_str` / `FromStr`
    // carry the custom token through verbatim. No upstream behaviour changes —
    // this only ADDS the ability to name a custom protocol token.
    // See `.orchestration/logs/t23-e7.md`.
    /// Construct a `Protocol` from a custom, `'static` pseudo-header token.
    ///
    /// Used by the SSH3 client to emit `:protocol = ssh3` on an extended
    /// CONNECT. The token should be a valid HTTP/3 pseudo-header value
    /// (lowercase, no whitespace); SSH3 uses the literal `"ssh3"`.
    #[inline]
    pub const fn from_static(token: &'static str) -> Protocol {
        Protocol(ProtocolInner::Other(token))
    }

    /// Return a &str representation of the `:protocol` pseudo-header value
    #[inline]
    pub fn as_str(&self) -> &str {
        match self.0 {
            ProtocolInner::WebTransport => "webtransport",
            ProtocolInner::ConnectUdp => "connect-udp",
            // SSH3 extended-CONNECT enablement patch: carry the custom token.
            ProtocolInner::Other(token) => token,
        }
    }
}

#[derive(Copy, PartialEq, Debug, Clone)]
enum ProtocolInner {
    WebTransport,
    ConnectUdp,
    /// SSH3 extended-CONNECT enablement patch (sortOfRemoteNG): a custom,
    /// `'static` `:protocol` token (e.g. `"ssh3"`). Keeps `Protocol: Copy`.
    Other(&'static str),
}

/// Error when parsing the protocol
pub struct InvalidProtocol;

impl FromStr for Protocol {
    type Err = InvalidProtocol;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "webtransport" => Ok(Self(ProtocolInner::WebTransport)),
            "connect-udp" => Ok(Self(ProtocolInner::ConnectUdp)),
            _ => Err(InvalidProtocol),
        }
    }
}
