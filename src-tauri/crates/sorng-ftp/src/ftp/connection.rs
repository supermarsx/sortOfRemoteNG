//! TCP + TLS transport — establishes the FTP control connection.
//!
//! Handles plain-TCP connect, implicit-FTPS wrapping, and the
//! timeout policy from `FtpConnectionConfig`.

use crate::ftp::error::{FtpError, FtpResult};
use crate::ftp::protocol::FtpCodec;
use crate::ftp::tls::build_tls_connector;
use crate::ftp::types::{FtpConnectionConfig, FtpResponse, FtpSecurityMode};
use std::time::Duration;
use tokio::net::TcpStream;
use tokio::time::timeout;

/// Establish the control connection and return a ready-to-use codec
/// **plus** the server welcome banner.
///
/// For Explicit FTPS the caller must later issue AUTH TLS themselves
/// (handled in `client.rs`).
pub async fn connect(config: &FtpConnectionConfig) -> FtpResult<(FtpCodec, FtpResponse)> {
    let addr = format!("{}:{}", config.host, config.port);
    let dur = Duration::from_secs(config.connect_timeout_sec);

    let tcp = timeout(dur, TcpStream::connect(&addr))
        .await
        .map_err(|_| FtpError::timeout(format!("TCP connect to {} timed out", addr)))?
        .map_err(|e| FtpError::connection_failed(format!("TCP connect to {}: {}", addr, e)))?;

    tcp.set_nodelay(true).ok();

    match config.security {
        FtpSecurityMode::Implicit => {
            // Implicit FTPS — TLS wraps the socket immediately.
            let connector = build_tls_connector(config.accept_invalid_certs)?;
            let tls = connector
                .connect(&config.host, tcp)
                .await
                .map_err(|e| FtpError::tls_failed(format!("Implicit TLS handshake: {}", e)))?;
            let mut codec = FtpCodec::from_tls(tls);
            let banner = codec.read_response().await?;
            Ok((codec, banner))
        }
        _ => {
            // Plain TCP (None or Explicit — Explicit upgrades later).
            let mut codec = FtpCodec::from_tcp(tcp);
            let banner = codec.read_response().await?;
            Ok((codec, banner))
        }
    }
}
