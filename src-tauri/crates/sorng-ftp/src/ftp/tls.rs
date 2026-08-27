//! TLS helpers for Explicit and Implicit FTPS (RFC 4217).
//!
//! - Builds a `tokio_rustls::TlsConnector` whose server-certificate decision
//!   routes through the backend **Trust Center** with Trust-On-First-Use
//!   ([`sorng_tls_trust::TofuVerifier`]), replacing the former blind
//!   `NoCertificateVerification` accept-anything verifier.
//! - Provides `upgrade_to_tls` for wrapping an existing plain codec.
//!
//! ## Trust model (t62)
//!
//! Before t62 an FTPS connection with `acceptInvalidCerts` +
//! `acknowledgeInvalidCertRisk` installed a verifier that returned
//! "verified" for *every* certificate — nothing was recorded, nothing could be
//! reviewed, and a swapped certificate on a later connection was invisible.
//!
//! Now both paths go through the Trust Center:
//!
//! * **default** ([`FtpsTrustDecision::Tofu`]) — the leaf certificate is
//!   fingerprinted and pinned on first use (after normal WebPKI chain and
//!   hostname validation); a later handshake presenting a *different*
//!   certificate for the same `host:port` is rejected as a possible MITM.
//! * **both bypass flags set** ([`FtpsTrustDecision::AlwaysTrust`]) — an
//!   explicit, per-connection `AlwaysTrust` policy override. It is a visible
//!   Trust Center policy rather than a hidden bypass: a record revoked in the
//!   Trust Center still rejects the handshake, and signature verification is
//!   never disabled.
//!
//! The Trust Center store is per-database and resolved through the process
//! global trust runtime ([`sorng_tls_trust::TofuTlsContext::shared`]), so when
//! no database is active the handshake fails closed instead of silently
//! accepting.

use crate::ftp::error::{FtpError, FtpResult};
use crate::ftp::protocol::{FtpCodec, ReadHalf, WriteHalf};
use rustls::pki_types::ServerName;
use sorng_tls_trust::{skip_flag_to_override, TofuTlsContext, TofuVerifier};
use std::sync::Arc;
use std::time::Duration;
use tokio::net::TcpStream;
use tokio::time::timeout;
use tokio_rustls::{client::TlsStream, TlsConnector};

/// Endpoint + certificate-policy inputs for an FTPS handshake.
///
/// `host` doubles as the TLS SNI/verification name and, with `port`, as the
/// Trust Center record key (`tls:host:port`).
#[derive(Debug, Clone, Copy)]
pub struct FtpsTlsParams<'a> {
    /// Control-connection host, exactly as dialled.
    pub host: &'a str,
    /// **Control**-connection port. Data channels deliberately reuse it rather
    /// than their own ephemeral PASV/EPSV port, so one FTPS server yields one
    /// stable Trust Center record instead of a new one per transfer.
    pub port: u16,
    /// Legacy "accept self-signed / untrusted certificates" flag.
    pub accept_invalid_certs: bool,
    /// Runtime acknowledgement that must accompany `accept_invalid_certs`.
    pub acknowledge_invalid_cert_risk: bool,
}

/// How the FTPS configuration flags map onto a Trust Center policy.
///
/// This is the whole of the policy decision this crate makes; everything after
/// it is [`sorng_tls_trust`]'s pure `decide_tls_trust` matrix.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FtpsTrustDecision {
    /// No bypass requested: defer to the Trust Center's effective policy,
    /// which defaults to Trust-On-First-Use.
    Tofu,
    /// Both bypass flags set: an explicit, revocable `AlwaysTrust` override
    /// for this connection.
    AlwaysTrust,
}

impl FtpsTrustDecision {
    /// Whether this decision installs the explicit `AlwaysTrust` override.
    pub fn is_always_trust(self) -> bool {
        matches!(self, FtpsTrustDecision::AlwaysTrust)
    }
}

/// Map the two configuration flags to a [`FtpsTrustDecision`].
///
/// The flags are deliberately *paired*: `acceptInvalidCerts` alone (or an
/// acknowledgement without the request) is a configuration error, not a
/// silently-ignored field. This mirrors `validate_config` in `client.rs` so the
/// TLS layer stays safe even if it is reached through another entry point.
pub fn decide_ftps_trust(
    accept_invalid_certs: bool,
    acknowledge_invalid_cert_risk: bool,
) -> FtpResult<FtpsTrustDecision> {
    if accept_invalid_certs != acknowledge_invalid_cert_risk {
        return Err(FtpError::invalid_config(
            "FTPS certificate bypass requires acceptInvalidCerts and acknowledgeInvalidCertRisk to be enabled together",
        ));
    }
    Ok(if accept_invalid_certs {
        FtpsTrustDecision::AlwaysTrust
    } else {
        FtpsTrustDecision::Tofu
    })
}

/// Build a `TlsConnector` whose certificate verification routes through the
/// Trust Center.
pub fn build_tls_connector(params: FtpsTlsParams<'_>) -> FtpResult<TlsConnector> {
    let decision = decide_ftps_trust(
        params.accept_invalid_certs,
        params.acknowledge_invalid_cert_risk,
    )?;

    if decision.is_always_trust() {
        log::warn!(
            "FTPS certificate verification for {}:{} is running under an explicit AlwaysTrust \
             Trust Center override; revoke the record in the Trust Center to undo it",
            params.host,
            params.port
        );
    }

    let ctx = TofuTlsContext::shared(
        params.host.to_owned(),
        params.port,
        skip_flag_to_override(decision.is_always_trust()),
    );
    let verifier = TofuVerifier::new(ctx)
        .map_err(|e| FtpError::tls_failed(format!("Trust Center TLS verifier: {e}")))?;

    let config = rustls::ClientConfig::builder()
        .dangerous()
        .with_custom_certificate_verifier(Arc::new(verifier))
        .with_no_client_auth();

    Ok(TlsConnector::from(Arc::new(config)))
}

fn server_name(host: &str) -> FtpResult<ServerName<'static>> {
    ServerName::try_from(host.to_owned())
        .map_err(|_| FtpError::tls_failed(format!("Invalid TLS server name: {host}")))
}

async fn connect_tls(
    connector: TlsConnector,
    host: &str,
    tcp: TcpStream,
    io_timeout: Duration,
) -> FtpResult<TlsStream<TcpStream>> {
    timeout(io_timeout, connector.connect(server_name(host)?, tcp))
        .await
        .map_err(|_| FtpError::timeout("FTP TLS handshake timed out"))?
        .map_err(|e| FtpError::tls_failed(format!("TLS handshake failed: {e}")))
}

/// Upgrade an existing **plain** control connection to TLS.
///
/// Called after successful `AUTH TLS` + 234 reply.
/// Consumes the plain codec, performs the TLS handshake, returns a new codec.
pub async fn upgrade_to_tls(
    codec: FtpCodec,
    params: FtpsTlsParams<'_>,
    io_timeout: Duration,
) -> FtpResult<FtpCodec> {
    // Re-assemble the owned TcpStream from the split halves.
    let tcp = reunite_plain(codec)?;

    let connector = build_tls_connector(params)?;
    let tls = connect_tls(connector, params.host, tcp, io_timeout)
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
///
/// `params.port` is the **control** port, so the data channel is validated
/// against the same Trust Center record as the control connection.
pub async fn wrap_data_stream(
    tcp: TcpStream,
    params: FtpsTlsParams<'_>,
    io_timeout: Duration,
) -> FtpResult<TlsStream<TcpStream>> {
    let connector = build_tls_connector(params)?;
    connect_tls(connector, params.host, tcp, io_timeout)
        .await
        .map_err(|e| FtpError::tls_failed(format!("Data channel TLS: {}", e)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn no_bypass_flags_default_to_tofu() {
        assert_eq!(
            decide_ftps_trust(false, false).unwrap(),
            FtpsTrustDecision::Tofu
        );
    }

    #[test]
    fn both_bypass_flags_map_to_an_always_trust_override() {
        assert_eq!(
            decide_ftps_trust(true, true).unwrap(),
            FtpsTrustDecision::AlwaysTrust
        );
    }

    #[test]
    fn a_bypass_request_without_acknowledgement_is_rejected() {
        let err = decide_ftps_trust(true, false).unwrap_err();
        assert!(err.to_string().contains("acknowledgeInvalidCertRisk"));
    }

    #[test]
    fn an_acknowledgement_without_a_bypass_request_is_rejected() {
        assert!(decide_ftps_trust(false, true).is_err());
    }

    #[test]
    fn only_the_always_trust_decision_installs_the_override() {
        assert!(FtpsTrustDecision::AlwaysTrust.is_always_trust());
        assert!(!FtpsTrustDecision::Tofu.is_always_trust());
        // The override handed to the verifier is `Some(..)` exactly when the
        // decision is AlwaysTrust; the default defers to the store policy.
        assert!(skip_flag_to_override(FtpsTrustDecision::AlwaysTrust.is_always_trust()).is_some());
        assert!(skip_flag_to_override(FtpsTrustDecision::Tofu.is_always_trust()).is_none());
    }

    #[test]
    fn params_carry_the_control_port_for_the_record_key() {
        // The data channel must reuse the control port so an FTPS server maps
        // to one Trust Center record, not one per ephemeral PASV port.
        let params = FtpsTlsParams {
            host: "ftps.example.test",
            port: 990,
            accept_invalid_certs: false,
            acknowledge_invalid_cert_risk: false,
        };
        assert_eq!(params.port, 990);
        assert_eq!(
            decide_ftps_trust(
                params.accept_invalid_certs,
                params.acknowledge_invalid_cert_risk
            )
            .unwrap(),
            FtpsTrustDecision::Tofu
        );
    }
}
