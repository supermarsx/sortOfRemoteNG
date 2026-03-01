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

/// Abstraction over a plain or TLS-wrapped data stream.
pub enum DataStream {
    Plain(TcpStream),
    Tls(tokio_native_tls::TlsStream<TcpStream>),
}

/// Open a data channel according to the configured mode.
///
/// Returns a connected `DataStream` ready for reading/writing.
pub async fn open_data_channel(
    codec: &mut FtpCodec,
    mode: DataChannelMode,
    security: &FtpSecurityMode,
    host: &str,
    accept_invalid_certs: bool,
    data_timeout: Duration,
    active_bind: Option<&str>,
) -> FtpResult<DataStream> {
    let tcp = match mode {
        DataChannelMode::Passive => open_pasv(codec, data_timeout).await?,
        DataChannelMode::ExtendedPassive => open_epsv(codec, host, data_timeout).await?,
        DataChannelMode::Active => open_port(codec, active_bind, data_timeout).await?,
        DataChannelMode::ExtendedActive => open_eprt(codec, active_bind, data_timeout).await?,
    };

    // Wrap in TLS if the control channel is secured (PROT P).
    if *security != FtpSecurityMode::None {
        let tls = tls::wrap_data_stream(tcp, host, accept_invalid_certs).await?;
        Ok(DataStream::Tls(tls))
    } else {
        Ok(DataStream::Plain(tcp))
    }
}

// ─── PASV ────────────────────────────────────────────────────────────

/// Issue `PASV`, parse the response, connect to the returned address.
///
/// Response format: `227 Entering Passive Mode (h1,h2,h3,h4,p1,p2)`
async fn open_pasv(codec: &mut FtpCodec, data_timeout: Duration) -> FtpResult<TcpStream> {
    let resp = codec.expect_ok("PASV").await?;
    let addr = parse_pasv_response(&resp.text())?;
    let tcp = timeout(data_timeout, TcpStream::connect(addr))
        .await
        .map_err(|_| FtpError::data_channel("PASV data connect timed out"))?
        .map_err(|e| FtpError::data_channel(format!("PASV data connect: {}", e)))?;
    Ok(tcp)
}

/// Parse `(h1,h2,h3,h4,p1,p2)` from a 227 response.
fn parse_pasv_response(text: &str) -> FtpResult<SocketAddr> {
    let re = Regex::new(r"\((\d+),(\d+),(\d+),(\d+),(\d+),(\d+)\)").unwrap();
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

    let ip = IpAddr::from([nums[0], nums[1], nums[2], nums[3]]);
    let port = (nums[4] as u16) * 256 + (nums[5] as u16);
    Ok(SocketAddr::new(ip, port))
}

// ─── EPSV ────────────────────────────────────────────────────────────

/// Issue `EPSV`, parse port, connect to the *same host* on that port.
///
/// Response format: `229 Entering Extended Passive Mode (|||port|)`
async fn open_epsv(
    codec: &mut FtpCodec,
    host: &str,
    data_timeout: Duration,
) -> FtpResult<TcpStream> {
    let resp = codec.expect_ok("EPSV").await?;
    let port = parse_epsv_response(&resp.text())?;
    let addr = format!("{}:{}", host, port);
    let tcp = timeout(data_timeout, TcpStream::connect(&addr))
        .await
        .map_err(|_| FtpError::data_channel("EPSV data connect timed out"))?
        .map_err(|e| FtpError::data_channel(format!("EPSV data connect: {}", e)))?;
    Ok(tcp)
}

fn parse_epsv_response(text: &str) -> FtpResult<u16> {
    let re = Regex::new(r"\|\|\|(\d+)\|").unwrap();
    let caps = re
        .captures(text)
        .ok_or_else(|| FtpError::protocol_error(format!("Cannot parse EPSV: {}", text)))?;
    caps[1]
        .parse::<u16>()
        .map_err(|_| FtpError::protocol_error("EPSV port out of range"))
}

// ─── PORT ────────────────────────────────────────────────────────────

/// Bind a local TCP listener, tell the server via `PORT`, then accept.
async fn open_port(
    codec: &mut FtpCodec,
    bind_addr: Option<&str>,
    data_timeout: Duration,
) -> FtpResult<TcpStream> {
    let bind = bind_addr.unwrap_or("0.0.0.0");
    let listener = TcpListener::bind(format!("{}:0", bind))
        .await
        .map_err(|e| FtpError::data_channel(format!("PORT bind: {}", e)))?;
    let local = listener.local_addr().map_err(|e| {
        FtpError::data_channel(format!("PORT local_addr: {}", e))
    })?;

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

    let (tcp, _) = timeout(data_timeout, listener.accept())
        .await
        .map_err(|_| FtpError::data_channel("PORT accept timed out"))?
        .map_err(|e| FtpError::data_channel(format!("PORT accept: {}", e)))?;
    Ok(tcp)
}

// ─── EPRT ────────────────────────────────────────────────────────────

/// Bind a local listener, tell server via `EPRT`, then accept.
///
/// Command format: `EPRT |1|ip|port|` (1 = IPv4, 2 = IPv6)
async fn open_eprt(
    codec: &mut FtpCodec,
    bind_addr: Option<&str>,
    data_timeout: Duration,
) -> FtpResult<TcpStream> {
    let bind = bind_addr.unwrap_or("0.0.0.0");
    let listener = TcpListener::bind(format!("{}:0", bind))
        .await
        .map_err(|e| FtpError::data_channel(format!("EPRT bind: {}", e)))?;
    let local = listener.local_addr().map_err(|e| {
        FtpError::data_channel(format!("EPRT local_addr: {}", e))
    })?;

    let af = match local.ip() {
        IpAddr::V4(_) => 1,
        IpAddr::V6(_) => 2,
    };
    let cmd = format!("EPRT |{}|{}|{}|", af, local.ip(), local.port());
    codec.expect_ok(&cmd).await?;

    let (tcp, _) = timeout(data_timeout, listener.accept())
        .await
        .map_err(|_| FtpError::data_channel("EPRT accept timed out"))?
        .map_err(|e| FtpError::data_channel(format!("EPRT accept: {}", e)))?;
    Ok(tcp)
}
