//! TLS helpers for Explicit and Implicit FTPS (RFC 4217).
//!
//! - Builds a `tokio_rustls::TlsConnector` with optional
//!   self-signed cert acceptance.
//! - Provides `upgrade_to_tls` for wrapping an existing plain codec.

use crate::ftp::error::{FtpError, FtpResult};
use crate::ftp::protocol::{FtpCodec, ReadHalf, WriteHalf};
use std::sync::Arc;
use tokio::net::TcpStream;
use tokio_rustls::{client::TlsStream, TlsConnector};

#[derive(Debug)]
struct NoCertificateVerification;

impl rustls::client::ServerCertVerifier for NoCertificateVerification {
    fn verify_server_cert(
        &self,
        _end_entity: &rustls::Certificate,
        _intermediates: &[rustls::Certificate],
        _server_name: &rustls::ServerName,
        _scts: &mut dyn Iterator<Item = &[u8]>,
        _ocsp_response: &[u8],
        _now: std::time::SystemTime,
    ) -> Result<rustls::client::ServerCertVerified, rustls::Error> {
        Ok(rustls::client::ServerCertVerified::assertion())
    }
}

/// Build a `TlsConnector` according to our configuration.
pub fn build_tls_connector(accept_invalid_certs: bool) -> FtpResult<TlsConnector> {
    let config = if accept_invalid_certs {
        rustls::ClientConfig::builder()
            .with_safe_defaults()
            .with_custom_certificate_verifier(Arc::new(NoCertificateVerification))
            .with_no_client_auth()
    } else {
        let mut roots = rustls::RootCertStore::empty();
        for cert in rustls_native_certs::load_native_certs()
            .map_err(|e| FtpError::tls_failed(format!("Native cert load failed: {e}")))?
        {
            roots
                .add(&rustls::Certificate(cert.0))
                .map_err(|e| FtpError::tls_failed(format!("Native cert parse failed: {e}")))?;
        }

        rustls::ClientConfig::builder()
            .with_safe_defaults()
            .with_root_certificates(roots)
            .with_no_client_auth()
    };

    Ok(TlsConnector::from(Arc::new(config)))
}

fn server_name(host: &str) -> FtpResult<rustls::ServerName> {
    rustls::ServerName::try_from(host)
        .map_err(|_| FtpError::tls_failed(format!("Invalid TLS server name: {host}")))
}

async fn connect_tls(
    connector: TlsConnector,
    host: &str,
    tcp: TcpStream,
) -> FtpResult<TlsStream<TcpStream>> {
    connector
        .connect(server_name(host)?, tcp)
        .await
        .map_err(|e| FtpError::tls_failed(format!("TLS handshake failed: {e}")))
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
    let tls = connect_tls(connector, host, tcp)
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
) -> FtpResult<TlsStream<TcpStream>> {
    let connector = build_tls_connector(accept_invalid_certs)?;
    connect_tls(connector, host, tcp)
        .await
        .map_err(|e| FtpError::tls_failed(format!("Data channel TLS: {}", e)))
}
