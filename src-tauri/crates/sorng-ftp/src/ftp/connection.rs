//! TCP + TLS transport — establishes the FTP control connection.
//!
//! Handles plain-TCP connect, implicit-FTPS wrapping, and the
//! timeout policy from `FtpConnectionConfig`.

use crate::ftp::error::{FtpError, FtpResult};
use crate::ftp::protocol::FtpCodec;
use crate::ftp::tls::upgrade_to_tls;
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
    let dur = Duration::from_secs(config.connect_timeout_sec);

    let tcp = timeout(dur, TcpStream::connect((config.host.as_str(), config.port)))
        .await
        .map_err(|_| FtpError::timeout("FTP TCP connection timed out"))?
        .map_err(|e| FtpError::connection_failed(format!("FTP TCP connection failed: {}", e)))?;

    tcp.set_nodelay(true).ok();

    match config.security {
        FtpSecurityMode::Implicit => {
            // Implicit FTPS — TLS wraps the socket immediately.
            let mut plain = FtpCodec::from_tcp(tcp);
            plain.set_io_timeout(dur);
            let mut codec = upgrade_to_tls(
                plain,
                &config.host,
                config.accept_invalid_certs,
                config.acknowledge_invalid_cert_risk,
                dur,
            )
            .await
            .map_err(|e| FtpError::tls_failed(format!("Implicit TLS handshake: {}", e)))?;
            codec.set_io_timeout(dur);
            let banner = codec.read_response().await?;
            Ok((codec, banner))
        }
        _ => {
            // Plain TCP (None or Explicit — Explicit upgrades later).
            let mut codec = FtpCodec::from_tcp(tcp);
            codec.set_io_timeout(dur);
            let banner = codec.read_response().await?;
            Ok((codec, banner))
        }
    }
}
