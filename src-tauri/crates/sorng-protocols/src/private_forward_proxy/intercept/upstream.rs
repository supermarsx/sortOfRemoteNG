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

use super::tls_policy::{TlsFailure, UpstreamTlsProfile};
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
    Tls(TlsFailure),
    TlsAttempt(TlsFailure, super::tls_attempt::TlsAttempt),
}

impl UpstreamFailure {
    /// K6 diagnostics: fixed enum only.
    pub(crate) const fn outcome(self) -> UpstreamOutcome {
        match self {
            Self::Denied => UpstreamOutcome::Denied,
            Self::Timeout => UpstreamOutcome::Timeout,
            Self::Fatal(fatal) => UpstreamOutcome::Fatal(fatal),
            Self::RouteFailed => UpstreamOutcome::RouteFailed,
            Self::Tls(_) | Self::TlsAttempt(..) => UpstreamOutcome::Fatal(UpstreamFatal::Protocol),
        }
    }

    /// `X-Sorng-Upstream` header value of the synthetic error response.
    pub(crate) const fn header_value(self) -> &'static str {
        match self {
            Self::Denied => "certificate-denied",
            Self::Timeout => "review-timeout",
            Self::Fatal(_) => "fatal",
            Self::RouteFailed => "route-failed",
            Self::Tls(_) | Self::TlsAttempt(..) => "fatal",
        }
    }
}

/// How the connection that carried an exchange was admitted.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct Admission {
    /// `false` for allow-once / temporary admissions: never disk-cached.
    pub persistent: bool,
    /// Exact connection's OS name/date/chain verdict, never a remembered exception.
    pub system_ca_valid: bool,
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
    let versions: &[&rustls::SupportedProtocolVersion] = match config.tls_profile {
        UpstreamTlsProfile::Tls12 => &[&rustls::version::TLS12],
        UpstreamTlsProfile::Tls13 => &[&rustls::version::TLS13],
        _ => &[&rustls::version::TLS13, &rustls::version::TLS12],
    };
    let mut client = rustls::ClientConfig::builder_with_provider(config.provider().clone())
        .with_protocol_versions(versions)
        .map_err(|_| io::Error::new(io::ErrorKind::Unsupported, "upstream TLS versions"))?
        .dangerous()
        .with_custom_certificate_verifier(verifier.clone())
        .with_client_cert_resolver(Arc::new(RecordingClientAuth(verifier.clone())));
    client.alpn_protocols = match offer {
        Offer::H2AndHttp11 => vec![ALPN_H2.to_vec(), ALPN_HTTP11.to_vec()],
        Offer::Http11Only => vec![ALPN_HTTP11.to_vec()],
    };
    client.resumption = rustls::client::Resumption::disabled();
    client.enable_early_data = false;
    client.enable_sni = true;
    Ok(Arc::new(client))
}

#[derive(Debug)]
struct RecordingClientAuth(Arc<RecordingVerifier>);
impl rustls::client::ResolvesClientCert for RecordingClientAuth {
    fn resolve(
        &self,
        _: &[&[u8]],
        _: &[rustls::SignatureScheme],
    ) -> Option<Arc<rustls::sign::CertifiedKey>> {
        self.0
            .client_auth_requested
            .store(true, std::sync::atomic::Ordering::Relaxed);
        None
    }
    fn has_certs(&self) -> bool {
        false
    }
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
        return match error.kind() {
            io::ErrorKind::ConnectionReset | io::ErrorKind::ConnectionAborted => {
                UpstreamFailure::Tls(TlsFailure::Reset)
            }
            io::ErrorKind::UnexpectedEof => UpstreamFailure::Tls(TlsFailure::Eof),
            io::ErrorKind::TimedOut => UpstreamFailure::Tls(TlsFailure::Timeout),
            _ => UpstreamFailure::RouteFailed,
        };
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
        E::PeerIncompatible(reason) => {
            use rustls::PeerIncompatible as P;
            UpstreamFailure::Tls(match reason {
                P::NoCipherSuitesInCommon => TlsFailure::Cipher,
                P::NoSignatureSchemesInCommon
                | P::NoCertificateRequestSignatureSchemesInCommon
                | P::SignatureAlgorithmsExtensionRequired => TlsFailure::SignatureAlgorithm,
                P::NoKxGroupsInCommon
                | P::KeyShareExtensionRequired
                | P::NamedGroupsExtensionRequired => TlsFailure::KeyExchange,
                P::ServerDoesNotSupportTls12Or13
                | P::ServerTlsVersionIsDisabledByOurConfig
                | P::Tls12NotOffered
                | P::Tls12NotOfferedOrEnabled
                | P::SupportedVersionsExtensionRequired => TlsFailure::Version,
                _ => TlsFailure::Parameters,
            })
        }
        E::NoApplicationProtocol => UpstreamFailure::Tls(TlsFailure::Alpn),
        E::DecryptError => UpstreamFailure::Tls(TlsFailure::Decryption),
        E::AlertReceived(alert) => UpstreamFailure::Tls(match alert {
            A::ProtocolVersion => TlsFailure::Version,
            A::HandshakeFailure => TlsFailure::PeerHandshakeAlert,
            A::InsufficientSecurity => TlsFailure::PeerSecurityAlert,
            _ => TlsFailure::PeerAlert(u8::from(*alert)),
        }),
        E::PeerMisbehaved(_)
        | E::InappropriateMessage { .. }
        | E::InappropriateHandshakeMessage { .. }
        | E::InvalidMessage(_)
        | E::PeerSentOversizedRecord => UpstreamFailure::Tls(TlsFailure::InvalidHandshake),
        _ => UpstreamFailure::Tls(TlsFailure::Engine),
    }
}

/// Maps the app's verdict.
pub(crate) fn verdict_admission(
    verdict: UpstreamVerdict,
    system_ca_valid: bool,
) -> Result<Admission, UpstreamFailure> {
    match verdict {
        UpstreamVerdict::Admit { persistent } => Ok(Admission {
            persistent,
            system_ca_valid,
        }),
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
    establish_with_timeout(request, CONNECT_TIMEOUT).await
}
pub(crate) async fn establish_with_timeout(
    request: ConnectRequest<'_>,
    connect_timeout: Duration,
) -> Result<Established, UpstreamFailure> {
    let authority = request.authority;
    let dial = request.dialer.dial(authority.clone());
    let stream = match tokio::time::timeout(connect_timeout, dial).await {
        Ok(Ok(stream)) => stream,
        _ => return Err(UpstreamFailure::RouteFailed),
    };
    if !request.tls {
        // Plain http:// has no certificate to evaluate; the CONNECT/request
        // grant already authorised this exact authority.
        return Ok(Established {
            io: stream,
            h2: false,
            admission: Admission {
                persistent: true,
                system_ca_valid: false,
            },
        });
    }
    let name = server_name(authority).ok_or(UpstreamFailure::RouteFailed)?;
    use super::tls_attempt::{snapshot, TlsAttempt, Trace, TracedIo};
    let profile = request.verifier.tls_profile;
    let mut attempt = TlsAttempt::new(
        profile,
        request.verifier.allow_weak_certificates,
        authority.host().parse::<std::net::IpAddr>().is_err(),
        request.offer == Offer::H2AndHttp11,
    );
    if !profile.requires_helper() {
        let provider = request.verifier.provider();
        let suites = provider.cipher_suites.iter().filter(|suite| match profile {
            UpstreamTlsProfile::Tls12 => {
                suite.version().version == rustls::ProtocolVersion::TLSv1_2
            }
            UpstreamTlsProfile::Tls13 => {
                suite.version().version == rustls::ProtocolVersion::TLSv1_3
            }
            _ => true,
        });
        for (slot, suite) in attempt.cipher_ids.iter_mut().zip(suites) {
            *slot = u16::from(suite.suite());
            attempt.cipher_count += 1;
        }
        for (slot, scheme) in attempt.signature_ids.iter_mut().zip(
            provider
                .signature_verification_algorithms
                .supported_schemes(),
        ) {
            *slot = u16::from(scheme);
            attempt.signature_count += 1;
        }
        for (slot, group) in attempt.group_ids.iter_mut().zip(&provider.kx_groups) {
            *slot = u16::from(group.name());
            attempt.group_count += 1;
        }
    }
    let trace = Arc::new(std::sync::Mutex::new(Trace::new(attempt)));
    let stream: BoxedStream = Box::new(TracedIo {
        inner: stream,
        trace: trace.clone(),
    });
    let enrich = |failure| match failure {
        UpstreamFailure::Tls(cause) => UpstreamFailure::TlsAttempt(cause, snapshot(&trace)),
        other => other,
    };
    if request.verifier.tls_profile.requires_helper() {
        return super::legacy_tls::establish(request, stream, name)
            .await
            .map_err(enrich);
    }
    let verifier = RecordingVerifier::new(request.verifier);
    let config = client_config(request.verifier, verifier.clone(), request.offer)
        .map_err(|_| UpstreamFailure::Fatal(UpstreamFatal::Protocol))?;
    let connector = tokio_rustls::TlsConnector::from(config);
    let tls = match tokio::time::timeout(connect_timeout, connector.connect(name.clone(), stream))
        .await
    {
        Err(_) => return Err(enrich(UpstreamFailure::Tls(TlsFailure::Timeout))),
        Ok(Err(error)) => {
            {
                let mut trace = trace.lock().unwrap_or_else(|e| e.into_inner());
                trace.attempt.client_auth_requested |= verifier
                    .client_auth_requested
                    .load(std::sync::atomic::Ordering::Relaxed);
                trace.attempt.certificate_seen |= verifier
                    .certificate_seen
                    .load(std::sync::atomic::Ordering::Relaxed);
            }
            return Err(enrich(handshake_failure(&error, verifier.record().fatal)));
        }
        Ok(Ok(tls)) => tls,
    };
    let record = verifier.record();
    if let Some(fatal) = record.fatal {
        return Err(UpstreamFailure::Fatal(fatal));
    }
    let (chain, h2, tls_version, cipher_suite) = {
        let (_, connection) = tls.get_ref();
        let chain: Vec<Vec<u8>> = connection
            .peer_certificates()
            .unwrap_or_default()
            .iter()
            .map(|der| der.as_ref().to_vec())
            .collect();
        let tls_version = connection
            .protocol_version()
            .and_then(|version| match version {
                rustls::ProtocolVersion::TLSv1_2 => Some("TLS 1.2".to_owned()),
                rustls::ProtocolVersion::TLSv1_3 => Some("TLS 1.3".to_owned()),
                _ => None,
            });
        let cipher_suite = connection
            .negotiated_cipher_suite()
            .map(|suite| format!("{:?}", suite.suite()));
        (
            chain,
            connection.alpn_protocol() == Some(ALPN_H2),
            tls_version,
            cipher_suite,
        )
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
                tls_version,
                cipher_suite,
            })
            .await
    };
    let admission = verdict_admission(verdict, system_ca_valid)?;
    Ok(Established {
        io: Box::new(tls),
        h2,
        admission,
    })
}
