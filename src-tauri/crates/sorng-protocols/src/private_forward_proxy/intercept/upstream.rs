//! K7 (x2): one admitted upstream connection.
//!
//! dial (RouteDialer, exact authority) -> rustls client with the recording
//! verifier (per-connection `ClientConfig` on the process-default provider,
//! TLS 1.2/1.3, ALPN h2/http1.1, no resumption, no early data) -> OS
//! validation off the runtime -> `UpstreamTrust::evaluate` with the chain as
//! sent -> admitted stream. Nothing is written to the upstream before the
//! trust verdict is `Admit`; every failure fails closed.

// Wired into the exchange pipeline by x1 (forward.rs); unused until then.
#![cfg_attr(not(test), allow(dead_code))]

use super::trust::{UpstreamEvidence, UpstreamFatal, UpstreamTrust, UpstreamVerdict};
use super::upstream_verify::{
    admission_input, RecordingVerifier, SystemValidation, UpstreamVerifierConfig,
};
use super::UpstreamOutcome;
use crate::private_forward_proxy::{Authority, BoxedStream, RouteDialer};
use rustls::pki_types::ServerName;
use std::io;
use std::sync::Arc;
use std::time::Duration;

/// Dial plus TLS handshake bound. The trust decision itself is bounded by the
/// app (review timeout), not here.
pub(crate) const CONNECT_TIMEOUT: Duration = Duration::from_secs(30);

pub(crate) const ALPN_H2: &[u8] = b"h2";
pub(crate) const ALPN_HTTP11: &[u8] = b"http/1.1";

/// Why an upstream exchange could not be served. Maps to the synthetic 502
/// `X-Sorng-Upstream` value.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum UpstreamFailure {
    Denied,
    Timeout,
    Fatal(UpstreamFatal),
    RouteFailed,
}

impl UpstreamFailure {
    /// K6 diagnostics: fixed enum only.
    pub(crate) const fn outcome(self) -> UpstreamOutcome {
        match self {
            Self::Denied => UpstreamOutcome::Denied,
            Self::Timeout => UpstreamOutcome::Timeout,
            Self::Fatal(fatal) => UpstreamOutcome::Fatal(fatal),
            Self::RouteFailed => UpstreamOutcome::RouteFailed,
        }
    }

    /// `X-Sorng-Upstream` header value of the synthetic error response.
    pub(crate) const fn header_value(self) -> &'static str {
        match self {
            Self::Denied => "certificate-denied",
            Self::Timeout => "review-timeout",
            Self::Fatal(_) => "fatal",
            Self::RouteFailed => "route-failed",
        }
    }
}

/// How the connection that carried an exchange was admitted.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct Admission {
    /// `false` for allow-once / temporary admissions: never disk-cached.
    pub persistent: bool,
}

/// Which ALPN protocols to offer upstream.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum Offer {
    H2AndHttp11,
    Http11Only,
}

/// An admitted upstream byte stream. No request byte has been written.
pub(crate) struct Established {
    pub io: BoxedStream,
    pub h2: bool,
    pub admission: Admission,
}

/// Per-connection client config: a fresh recording verifier each time, no
/// session resumption (resumption would skip certificate evidence).
pub(crate) fn client_config(
    config: &UpstreamVerifierConfig,
    verifier: Arc<RecordingVerifier>,
    offer: Offer,
) -> io::Result<Arc<rustls::ClientConfig>> {
    let mut client = rustls::ClientConfig::builder_with_provider(config.provider().clone())
        .with_protocol_versions(&[&rustls::version::TLS13, &rustls::version::TLS12])
        .map_err(|_| io::Error::new(io::ErrorKind::Unsupported, "upstream TLS versions"))?
        .dangerous()
        .with_custom_certificate_verifier(verifier)
        .with_no_client_auth();
    client.alpn_protocols = match offer {
        Offer::H2AndHttp11 => vec![ALPN_H2.to_vec(), ALPN_HTTP11.to_vec()],
        Offer::Http11Only => vec![ALPN_HTTP11.to_vec()],
    };
    client.resumption = rustls::client::Resumption::disabled();
    client.enable_early_data = false;
    client.enable_sni = true;
    Ok(Arc::new(client))
}

/// The upstream TLS name for an authority (DNS or IP; IPs send no SNI).
pub(crate) fn server_name(authority: &Authority) -> Option<ServerName<'static>> {
    ServerName::try_from(authority.host().to_owned()).ok()
}

/// Classifies a failed handshake. A structural fatal recorded by the
/// verifier wins; protocol-level refusals are fatal; anything else is a
/// route failure (reset, EOF, timeout).
pub(crate) fn handshake_failure(
    error: &io::Error,
    recorded: Option<UpstreamFatal>,
) -> UpstreamFailure {
    if let Some(fatal) = recorded {
        return UpstreamFailure::Fatal(fatal);
    }
    let Some(tls) = error
        .get_ref()
        .and_then(|inner| inner.downcast_ref::<rustls::Error>())
    else {
        return UpstreamFailure::RouteFailed;
    };
    use rustls::{AlertDescription as A, CertificateError as C, Error as E};
    match tls {
        E::InvalidCertificate(C::BadSignature) => {
            UpstreamFailure::Fatal(UpstreamFatal::BadSignature)
        }
        E::InvalidCertificate(C::BadEncoding) | E::NoCertificatesPresented => {
            UpstreamFailure::Fatal(UpstreamFatal::Malformed)
        }
        E::InvalidCertificate(_) => UpstreamFailure::Fatal(UpstreamFatal::BadSignature),
        E::PeerIncompatible(_)
        | E::PeerMisbehaved(_)
        | E::InappropriateMessage { .. }
        | E::InappropriateHandshakeMessage { .. }
        | E::InvalidMessage(_)
        | E::NoApplicationProtocol
        | E::PeerSentOversizedRecord
        | E::DecryptError
        | E::AlertReceived(
            A::ProtocolVersion
            | A::HandshakeFailure
            | A::InsufficientSecurity
            | A::IllegalParameter,
        ) => UpstreamFailure::Fatal(UpstreamFatal::Protocol),
        _ => UpstreamFailure::RouteFailed,
    }
}

/// Maps the app's verdict.
pub(crate) fn verdict_admission(verdict: UpstreamVerdict) -> Result<Admission, UpstreamFailure> {
    match verdict {
        UpstreamVerdict::Admit { persistent } => Ok(Admission { persistent }),
        UpstreamVerdict::Deny => Err(UpstreamFailure::Denied),
        UpstreamVerdict::Timeout => Err(UpstreamFailure::Timeout),
    }
}

/// Inputs for one upstream connection.
pub(crate) struct ConnectRequest<'a> {
    pub dialer: &'a Arc<dyn RouteDialer>,
    pub trust: &'a Arc<dyn UpstreamTrust>,
    pub verifier: &'a UpstreamVerifierConfig,
    pub authority: &'a Authority,
    pub tls: bool,
    /// The host sent Strict-Transport-Security earlier in this attempt.
    pub hsts: bool,
    pub offer: Offer,
    /// Serialises trust evaluations per authority so parallel first-use
    /// connections produce one decision (and at most one prompt) each.
    pub trust_gate: &'a tokio::sync::Mutex<()>,
}

/// Dials, handshakes and asks the app. Every path that is not an explicit
/// `Admit` returns an error and drops the stream unwritten.
pub(crate) async fn establish(request: ConnectRequest<'_>) -> Result<Established, UpstreamFailure> {
    let authority = request.authority;
    let dial = request.dialer.dial(authority.clone());
    let stream = match tokio::time::timeout(CONNECT_TIMEOUT, dial).await {
        Ok(Ok(stream)) => stream,
        _ => return Err(UpstreamFailure::RouteFailed),
    };
    if !request.tls {
        // Plain http:// has no certificate to evaluate; the CONNECT/request
        // grant already authorised this exact authority.
        return Ok(Established {
            io: stream,
            h2: false,
            admission: Admission { persistent: true },
        });
    }
    let name = server_name(authority).ok_or(UpstreamFailure::RouteFailed)?;
    let verifier = RecordingVerifier::new(request.verifier);
    let config = client_config(request.verifier, verifier.clone(), request.offer)
        .map_err(|_| UpstreamFailure::Fatal(UpstreamFatal::Protocol))?;
    let connector = tokio_rustls::TlsConnector::from(config);
    let tls = match tokio::time::timeout(CONNECT_TIMEOUT, connector.connect(name.clone(), stream))
        .await
    {
        Err(_) => return Err(UpstreamFailure::RouteFailed),
        Ok(Err(error)) => return Err(handshake_failure(&error, verifier.record().fatal)),
        Ok(Ok(tls)) => tls,
    };
    let record = verifier.record();
    if let Some(fatal) = record.fatal {
        return Err(UpstreamFailure::Fatal(fatal));
    }
    let (chain, h2) = {
        let (_, connection) = tls.get_ref();
        let chain: Vec<Vec<u8>> = connection
            .peer_certificates()
            .unwrap_or_default()
            .iter()
            .map(|der| der.as_ref().to_vec())
            .collect();
        (chain, connection.alpn_protocol() == Some(ALPN_H2))
    };
    if chain.is_empty() {
        return Err(UpstreamFailure::Fatal(UpstreamFatal::Malformed));
    }
    // The platform verifier may block (OS chain building, revocation
    // caches); keep it off the async workers.
    let validation = {
        let config = request.verifier.clone();
        let chain = chain.clone();
        let ocsp = record.ocsp;
        tokio::task::spawn_blocking(move || config.system_validation(&chain, &name, &ocsp))
            .await
            .unwrap_or(SystemValidation::NotValid)
    };
    let system_ca_valid =
        admission_input(validation, request.hsts).map_err(UpstreamFailure::Fatal)?;
    let verdict = {
        let _serial = request.trust_gate.lock().await;
        request
            .trust
            .evaluate(UpstreamEvidence {
                authority: authority.clone(),
                chain_der: chain,
                system_ca_valid,
                temporary_ok: true,
            })
            .await
    };
    let admission = verdict_admission(verdict)?;
    Ok(Established {
        io: Box::new(tls),
        h2,
        admission,
    })
}
