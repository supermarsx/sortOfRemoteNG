//! TLS helpers for Explicit and Implicit FTPS (RFC 4217).
//!
//! - Builds a `tokio_native_tls::TlsConnector` with optional
//!   self-signed cert acceptance.
//! - Provides `upgrade_to_tls` for wrapping an existing plain codec.

use crate::ftp::error::{FtpError, FtpResult};
use crate::ftp::protocol::{FtpCodec, ReadHalf, WriteHalf};
use tokio::net::TcpStream;
use tokio_native_tls::TlsConnector;

/// Build a `TlsConnector` according to our configuration.
pub fn build_tls_connector(accept_invalid_certs: bool) -> FtpResult<TlsConnector> {
    let mut builder = native_tls::TlsConnector::builder();
    if accept_invalid_certs {
        builder.danger_accept_invalid_certs(true);
        builder.danger_accept_invalid_hostnames(true);
    }
    let connector = builder.build()?;
    Ok(TlsConnector::from(connector))
}

/// Upgrade an existing **plain** control connection to TLS.
///
/// Called after successful `AUTH TLS` + 234 reply.
/// Consumes the plain codec, performs the TLS handshake, returns a new codec.
pub async fn upgrade_to_tls(
    codec: FtpCodec,
    host: &str,
    accept_invalid_certs: bool,
) -> FtpResult<FtpCodec> {
    // Re-assemble the owned TcpStream from the split halves.
    let tcp = reunite_plain(codec)?;

    let connector = build_tls_connector(accept_invalid_certs)?;
    let tls = connector
        .connect(host, tcp)
        .await
        .map_err(|e| FtpError::tls_failed(format!("Explicit TLS handshake: {}", e)))?;

    Ok(FtpCodec::from_tls(tls))
}

/// Reunite the read + write halves back into a `TcpStream`.
/// Only works when both halves are `Plain`.
fn reunite_plain(codec: FtpCodec) -> FtpResult<TcpStream> {
    let rd = match codec.reader {
        ReadHalf::Plain(br) => br.into_inner(),
        ReadHalf::Tls(_) => {
            return Err(FtpError::protocol_error(
                "Cannot upgrade: connection is already TLS",
            ))
        }
    };
    let wr = match codec.writer {
        WriteHalf::Plain(w) => w,
        WriteHalf::Tls(_) => {
            return Err(FtpError::protocol_error(
                "Cannot upgrade: connection is already TLS",
            ))
        }
    };
    rd.reunite(wr)
        .map_err(|e| FtpError::protocol_error(format!("Reunite failed: {}", e)))
}

/// Create a TLS-wrapped data channel for FTPS.
pub async fn wrap_data_stream(
    tcp: TcpStream,
    host: &str,
    accept_invalid_certs: bool,
) -> FtpResult<tokio_native_tls::TlsStream<TcpStream>> {
    let connector = build_tls_connector(accept_invalid_certs)?;
    connector
        .connect(host, tcp)
        .await
        .map_err(|e| FtpError::tls_failed(format!("Data channel TLS: {}", e)))
}
