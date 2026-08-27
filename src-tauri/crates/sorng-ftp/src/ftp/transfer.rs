//! Data-channel management for FTP transfers.
//!
//! Supports four modes (RFC 959 + RFC 2428):
//! - **PASV** — server opens a port, client connects
//! - **EPSV** — extended passive (IPv6-ready)
//! - **PORT** — client opens a port, tells server
//! - **EPRT** — extended active (IPv6-ready)
//!
//! The data socket can optionally be TLS-wrapped for FTPS (PROT P).

use crate::ftp::error::{FtpError, FtpResult};
use crate::ftp::protocol::FtpCodec;
use crate::ftp::tls;
use crate::ftp::types::{DataChannelMode, FtpSecurityMode};
use regex::Regex;
use std::net::{IpAddr, SocketAddr};
use tokio::net::{TcpListener, TcpStream};
use tokio::time::{timeout, Duration};

/// Resolve the local bind host for an active-mode data listener.
///
/// Secure default (t40-e7): loopback (127.0.0.1) unless the user explicitly
/// names an external-facing interface via `active_bind_address`. That explicit
/// address is the opt-in for exposing the data channel to a remote server.
fn active_bind_host(bind_addr: Option<&str>) -> &str {
    bind_addr.unwrap_or("127.0.0.1")
}

/// Abstraction over a plain or TLS-wrapped data stream.
#[allow(clippy::large_enum_variant)]
pub enum DataStream {
    Plain(TcpStream),
    Tls(tokio_rustls::client::TlsStream<TcpStream>),
}

pub(crate) struct DataChannelOptions<'a> {
    pub(crate) mode: DataChannelMode,
    pub(crate) security: &'a FtpSecurityMode,
    pub(crate) host: &'a str,
    /// Control-connection port. The data channel is verified against the same
    /// `tls:host:port` Trust Center record as the control connection, so the
    /// ephemeral PASV/EPSV port is deliberately *not* used here.
    pub(crate) control_port: u16,
    pub(crate) accept_invalid_certs: bool,
    pub(crate) acknowledge_invalid_cert_risk: bool,
    pub(crate) data_timeout: Duration,
    pub(crate) active_bind: Option<&'a str>,
}

/// Open a data channel according to the configured mode.
///
/// Returns a connected `DataStream` ready for reading/writing.
pub(crate) async fn open_data_channel(
    codec: &mut FtpCodec,
    options: DataChannelOptions<'_>,
) -> FtpResult<DataStream> {
    let DataChannelOptions {
        mode,
        security,
        host,
        control_port,
        accept_invalid_certs,
        acknowledge_invalid_cert_risk,
        data_timeout,
        active_bind,
    } = options;

    let control_peer = codec
        .peer_addr()
        .ok_or_else(|| FtpError::data_channel("FTP control peer address is unavailable"))?;
    let tcp = match mode {
        DataChannelMode::Passive => open_pasv(codec, control_peer, data_timeout).await?,
        DataChannelMode::ExtendedPassive => open_epsv(codec, control_peer, data_timeout).await?,
        DataChannelMode::Active => {
            open_port(codec, active_bind, control_peer.ip(), data_timeout).await?
        }
        DataChannelMode::ExtendedActive => {
            open_eprt(codec, active_bind, control_peer.ip(), data_timeout).await?
        }
    };

    // Wrap in TLS if the control channel is secured (PROT P).
    if *security != FtpSecurityMode::None {
        let tls = tls::wrap_data_stream(
            tcp,
            tls::FtpsTlsParams {
                host,
                port: control_port,
                accept_invalid_certs,
                acknowledge_invalid_cert_risk,
            },
            data_timeout,
        )
        .await?;
        Ok(DataStream::Tls(tls))
    } else {
        Ok(DataStream::Plain(tcp))
    }
}

// ─── PASV ────────────────────────────────────────────────────────────

/// Issue `PASV`, parse the response, connect to the returned address.
///
/// Response format: `227 Entering Passive Mode (h1,h2,h3,h4,p1,p2)`
async fn open_pasv(
    codec: &mut FtpCodec,
    control_peer: SocketAddr,
    data_timeout: Duration,
) -> FtpResult<TcpStream> {
    let resp = codec.expect_ok("PASV").await?;
    let port = parse_pasv_response(&resp.text())?;
    let addr = SocketAddr::new(control_peer.ip(), port);
    let tcp = timeout(data_timeout, TcpStream::connect(addr))
        .await
        .map_err(|_| FtpError::data_channel("PASV data connect timed out"))?
        .map_err(|e| FtpError::data_channel(format!("PASV data connect: {}", e)))?;
    Ok(tcp)
}

/// Parse `(h1,h2,h3,h4,p1,p2)` from a 227 response.
fn parse_pasv_response(text: &str) -> FtpResult<u16> {
    let re = Regex::new(r"\((\d+),(\d+),(\d+),(\d+),(\d+),(\d+)\)").expect("valid regex literal");
    let caps = re
        .captures(text)
        .ok_or_else(|| FtpError::protocol_error(format!("Cannot parse PASV: {}", text)))?;

    let nums: Vec<u8> = (1..=6)
        .map(|i| {
            caps[i]
                .parse::<u8>()
                .map_err(|_| FtpError::protocol_error("PASV number out of range"))
        })
        .collect::<Result<Vec<_>, _>>()?;

    let port = (nums[4] as u16) * 256 + (nums[5] as u16);
    if port == 0 {
        return Err(FtpError::protocol_error("PASV returned port zero"));
    }
    Ok(port)
}

// ─── EPSV ────────────────────────────────────────────────────────────

/// Issue `EPSV`, parse port, connect to the *same host* on that port.
///
/// Response format: `229 Entering Extended Passive Mode (|||port|)`
async fn open_epsv(
    codec: &mut FtpCodec,
    control_peer: SocketAddr,
    data_timeout: Duration,
) -> FtpResult<TcpStream> {
    let resp = codec.expect_ok("EPSV").await?;
    let port = parse_epsv_response(&resp.text())?;
    let addr = SocketAddr::new(control_peer.ip(), port);
    let tcp = timeout(data_timeout, TcpStream::connect(addr))
        .await
        .map_err(|_| FtpError::data_channel("EPSV data connect timed out"))?
        .map_err(|e| FtpError::data_channel(format!("EPSV data connect: {}", e)))?;
    Ok(tcp)
}

fn parse_epsv_response(text: &str) -> FtpResult<u16> {
    let re = Regex::new(r"\|\|\|(\d+)\|").expect("valid regex literal");
    let caps = re
        .captures(text)
        .ok_or_else(|| FtpError::protocol_error(format!("Cannot parse EPSV: {}", text)))?;
    let port = caps[1]
        .parse::<u16>()
        .map_err(|_| FtpError::protocol_error("EPSV port out of range"))?;
    if port == 0 {
        return Err(FtpError::protocol_error("EPSV returned port zero"));
    }
    Ok(port)
}

// ─── PORT ────────────────────────────────────────────────────────────

/// Bind a local TCP listener, tell the server via `PORT`, then accept.
async fn open_port(
    codec: &mut FtpCodec,
    bind_addr: Option<&str>,
    expected_peer: IpAddr,
    data_timeout: Duration,
) -> FtpResult<TcpStream> {
    let bind = validate_active_bind(active_bind_host(bind_addr))?;
    let listener = TcpListener::bind(SocketAddr::new(bind, 0))
        .await
        .map_err(|e| FtpError::data_channel(format!("PORT bind: {}", e)))?;
    let local = listener
        .local_addr()
        .map_err(|e| FtpError::data_channel(format!("PORT local_addr: {}", e)))?;

    let ip = match local.ip() {
        IpAddr::V4(v4) => v4,
        _ => return Err(FtpError::data_channel("PORT requires IPv4")),
    };
    let octets = ip.octets();
    let port = local.port();
    let p1 = port / 256;
    let p2 = port % 256;

    let cmd = format!(
        "PORT {},{},{},{},{},{}",
        octets[0], octets[1], octets[2], octets[3], p1, p2
    );
    codec.expect_ok(&cmd).await?;

    let (tcp, peer) = timeout(data_timeout, listener.accept())
        .await
        .map_err(|_| FtpError::data_channel("PORT accept timed out"))?
        .map_err(|e| FtpError::data_channel(format!("PORT accept: {}", e)))?;
    if peer.ip() != expected_peer {
        return Err(FtpError::data_channel(
            "PORT data connection came from a non-control peer",
        ));
    }
    Ok(tcp)
}

// ─── EPRT ────────────────────────────────────────────────────────────

/// Bind a local listener, tell server via `EPRT`, then accept.
///
/// Command format: `EPRT |1|ip|port|` (1 = IPv4, 2 = IPv6)
async fn open_eprt(
    codec: &mut FtpCodec,
    bind_addr: Option<&str>,
    expected_peer: IpAddr,
    data_timeout: Duration,
) -> FtpResult<TcpStream> {
    let bind = validate_active_bind(active_bind_host(bind_addr))?;
    let listener = TcpListener::bind(SocketAddr::new(bind, 0))
        .await
        .map_err(|e| FtpError::data_channel(format!("EPRT bind: {}", e)))?;
    let local = listener
        .local_addr()
        .map_err(|e| FtpError::data_channel(format!("EPRT local_addr: {}", e)))?;

    let af = match local.ip() {
        IpAddr::V4(_) => 1,
        IpAddr::V6(_) => 2,
    };
    let cmd = format!("EPRT |{}|{}|{}|", af, local.ip(), local.port());
    codec.expect_ok(&cmd).await?;

    let (tcp, peer) = timeout(data_timeout, listener.accept())
        .await
        .map_err(|_| FtpError::data_channel("EPRT accept timed out"))?
        .map_err(|e| FtpError::data_channel(format!("EPRT accept: {}", e)))?;
    if peer.ip() != expected_peer {
        return Err(FtpError::data_channel(
            "EPRT data connection came from a non-control peer",
        ));
    }
    Ok(tcp)
}

fn validate_active_bind(value: &str) -> FtpResult<IpAddr> {
    let address = value
        .parse::<IpAddr>()
        .map_err(|_| FtpError::invalid_config("Active bind address must be a literal IP"))?;
    if address.is_unspecified() || address.is_multicast() {
        return Err(FtpError::invalid_config(
            "Active bind address must be a specific unicast address",
        ));
    }
    if matches!(address, IpAddr::V4(ip) if ip.is_broadcast()) {
        return Err(FtpError::invalid_config(
            "Active bind address must not be broadcast",
        ));
    }
    Ok(address)
}

#[cfg(test)]
mod tests {
    use super::active_bind_host;

    #[test]
    fn active_bind_defaults_to_loopback() {
        // No explicit address => secure-default loopback, not all-interfaces.
        assert_eq!(active_bind_host(None), "127.0.0.1");
    }

    #[test]
    fn active_bind_honors_explicit_address() {
        // Explicit external-facing address is the opt-in and is used verbatim.
        assert_eq!(active_bind_host(Some("192.168.1.10")), "192.168.1.10");
        assert_eq!(active_bind_host(Some("0.0.0.0")), "0.0.0.0");
    }
}
