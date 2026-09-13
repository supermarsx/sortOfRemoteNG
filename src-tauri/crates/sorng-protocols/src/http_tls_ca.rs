//! Native HTTPS CA evidence. Inspection sends no target HTTP bytes; a CA
//! admission must still use the CA-and-leaf verifier on the real connection.
//! Native roots do not imply online OCSP/CRL revocation checks.

use super::*;
use rustls::client::WebPkiServerVerifier;
use std::sync::Mutex as SyncMutex;
use std::time::{Duration, Instant};

const PROOF_LIFETIME: Duration = Duration::from_secs(60);
const MAX_PROOFS: usize = 128;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "kebab-case")]
pub enum CaValidationStatus {
    Verified,
    Unverified,
    #[default]
    Unavailable,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct TlsCaValidation {
    pub status: CaValidationStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub proof_id: Option<String>,
}

struct InspectionProof {
    id: String,
    authority: String,
    route: [u8; 32],
    fingerprint: String,
    expires: Instant,
}

#[derive(Default)]
struct Proofs(VecDeque<InspectionProof>);

fn proofs() -> &'static SyncMutex<Proofs> {
    static PROOFS: OnceLock<SyncMutex<Proofs>> = OnceLock::new();
    PROOFS.get_or_init(|| SyncMutex::new(Proofs::default()))
}

fn authority(host: &str, port: u16) -> Result<String, String> {
    if port == 0 || host.is_empty() || host.chars().any(|c| c.is_whitespace()) {
        return Err("Invalid CA verification authority".into());
    }
    let host = host.trim_start_matches('[').trim_end_matches(']');
    let host = match host.parse::<std::net::IpAddr>() {
        Ok(ip) => ip.to_string(),
        Err(_) => match url::Host::parse(host).map_err(|_| "Invalid CA verification authority")? {
            url::Host::Domain(domain) => domain.trim_end_matches('.').to_ascii_lowercase(),
            other => other.to_string(),
        },
    };
    Ok(format!("{host}:{port}"))
}

fn route(proxy_url: Option<&str>) -> [u8; 32] {
    // Bind exact explicit route including proxy authentication, without retaining
    // or exposing its credentials. No ambient-proxy or direct-route fallback.
    Sha256::digest(proxy_url.unwrap_or_default().as_bytes()).into()
}

impl Proofs {
    fn prune(&mut self, now: Instant) {
        self.0.retain(|proof| proof.expires > now);
    }

    fn issue(
        &mut self,
        host: &str,
        port: u16,
        proxy_url: Option<&str>,
        fingerprint: &str,
        now: Instant,
    ) -> Result<String, String> {
        let authority = authority(host, port)?;
        self.prune(now);
        if self.0.len() >= MAX_PROOFS {
            self.0.pop_front();
        }
        let id = uuid::Uuid::new_v4().simple().to_string();
        self.0.push_back(InspectionProof {
            id: id.clone(),
            authority,
            route: route(proxy_url),
            fingerprint: fingerprint.to_owned(),
            expires: now + PROOF_LIFETIME,
        });
        Ok(id)
    }

    fn consume(
        &mut self,
        id: &str,
        host: &str,
        port: u16,
        proxy_url: Option<&str>,
        fingerprint: &str,
        now: Instant,
    ) -> Result<(), String> {
        self.prune(now);
        if id.len() != 32 || !id.bytes().all(|byte| byte.is_ascii_hexdigit()) {
            return Err("Invalid HTTPS CA inspection proof".into());
        }
        let index = self
            .0
            .iter()
            .position(|proof| proof.id == id)
            .ok_or("HTTPS CA inspection expired or was already used; inspect again")?;
        let proof = self.0.remove(index).expect("located proof");
        if proof.authority != authority(host, port)?
            || proof.route != route(proxy_url)
            || proof.fingerprint != fingerprint
        {
            return Err(
                "HTTPS CA inspection does not match this authority, route or certificate".into(),
            );
        }
        Ok(())
    }
}

/// Only the native scoped trust command consumes this evidence. Frontend
/// presentation metadata or caller-supplied Booleans cannot manufacture it.
pub fn consume_ca_inspection_proof(
    id: &str,
    host: &str,
    port: u16,
    proxy_url: Option<&str>,
    fingerprint: &str,
) -> Result<(), String> {
    proofs()
        .lock()
        .map_err(|_| "HTTPS CA proof state unavailable")?
        .consume(id, host, port, proxy_url, fingerprint, Instant::now())
}

fn verifier(roots: rustls::RootCertStore) -> Result<Arc<WebPkiServerVerifier>, String> {
    if roots.is_empty() {
        return Err("No usable native TLS roots are available".into());
    }
    WebPkiServerVerifier::builder_with_provider(
        Arc::new(roots),
        Arc::new(rustls::crypto::aws_lc_rs::default_provider()),
    )
    .build()
    .map_err(|_| "Native TLS verifier could not be initialized".into())
}

#[derive(Debug)]
pub(super) struct InspectionVerifier {
    ca: Option<Arc<WebPkiServerVerifier>>,
    status: SyncMutex<CaValidationStatus>,
}

impl InspectionVerifier {
    /// Call only after the handshake succeeds: the verifier separately checks
    /// possession of the leaf key via the TLS handshake signature.
    pub(super) fn completed(
        &self,
        host: &str,
        port: u16,
        proxy_url: Option<&str>,
        fingerprint: &str,
    ) -> Result<TlsCaValidation, String> {
        let status = *self
            .status
            .lock()
            .map_err(|_| "TLS inspection state unavailable")?;
        let proof_id = if status == CaValidationStatus::Verified {
            Some(
                proofs()
                    .lock()
                    .map_err(|_| "HTTPS CA proof state unavailable")?
                    .issue(host, port, proxy_url, fingerprint, Instant::now())?,
            )
        } else {
            None
        };
        Ok(TlsCaValidation { status, proof_id })
    }
}

impl ServerCertVerifier for InspectionVerifier {
    fn verify_server_cert(
        &self,
        cert: &CertificateDer<'_>,
        chain: &[CertificateDer<'_>],
        name: &ServerName<'_>,
        ocsp: &[u8],
        now: UnixTime,
    ) -> Result<ServerCertVerified, rustls::Error> {
        let status = match &self.ca {
            Some(ca) if ca.verify_server_cert(cert, chain, name, ocsp, now).is_ok() => {
                CaValidationStatus::Verified
            }
            Some(_) => CaValidationStatus::Unverified,
            None => CaValidationStatus::Unavailable,
        };
        *self
            .status
            .lock()
            .map_err(|_| rustls::Error::General("TLS inspection state unavailable".into()))? =
            status;
        // Invalid chains remain inspectable for explicit user review. This is
        // not admission, and cannot mint a verified proof.
        Ok(ServerCertVerified::assertion())
    }
    fn verify_tls12_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        signature: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        rustls::crypto::verify_tls12_signature(
            message,
            cert,
            signature,
            &rustls::crypto::aws_lc_rs::default_provider().signature_verification_algorithms,
        )
    }
    fn verify_tls13_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        signature: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        rustls::crypto::verify_tls13_signature(
            message,
            cert,
            signature,
            &rustls::crypto::aws_lc_rs::default_provider().signature_verification_algorithms,
        )
    }
    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        rustls::crypto::aws_lc_rs::default_provider()
            .signature_verification_algorithms
            .supported_schemes()
    }
}

pub(super) fn inspection_tls_config(
    roots: Result<rustls::RootCertStore, String>,
) -> Result<(Arc<rustls::ClientConfig>, Arc<InspectionVerifier>), String> {
    let verifier = Arc::new(InspectionVerifier {
        ca: roots.and_then(verifier).ok(),
        status: SyncMutex::new(CaValidationStatus::Unavailable),
    });
    let config = rustls::ClientConfig::builder_with_provider(Arc::new(
        rustls::crypto::aws_lc_rs::default_provider(),
    ))
    .with_safe_default_protocol_versions()
    .map_err(|_| "TLS inspection versions unavailable")?
    .dangerous()
    .with_custom_certificate_verifier(verifier.clone())
    .with_no_client_auth();
    Ok((Arc::new(config), verifier))
}

#[derive(Debug)]
struct CaPinnedVerifier {
    ca: Arc<WebPkiServerVerifier>,
    pin: PinnedCertificateVerification,
    target: ServerName<'static>,
    https_proxy: Option<ServerName<'static>>,
}

impl ServerCertVerifier for CaPinnedVerifier {
    fn verify_server_cert(
        &self,
        cert: &CertificateDer<'_>,
        chain: &[CertificateDer<'_>],
        name: &ServerName<'_>,
        ocsp: &[u8],
        now: UnixTime,
    ) -> Result<ServerCertVerified, rustls::Error> {
        self.ca.verify_server_cert(cert, chain, name, ocsp, now)?;
        if name == &self.target {
            self.pin.verify_server_cert(cert, chain, name, ocsp, now)
        } else if self.https_proxy.as_ref() == Some(name) {
            // reqwest reuses this config for the HTTPS CONNECT proxy. That
            // separate authority keeps CA/name/time checks, not the NAS pin.
            Ok(ServerCertVerified::assertion())
        } else {
            Err(rustls::Error::General(
                "TLS authority is outside the inspected route".into(),
            ))
        }
    }
    fn verify_tls12_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        signature: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        self.ca.verify_tls12_signature(message, cert, signature)
    }
    fn verify_tls13_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        signature: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        self.ca.verify_tls13_signature(message, cert, signature)
    }
    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        self.ca.supported_verify_schemes()
    }
}

pub fn build_ca_pinned_tls_config(
    fingerprint: String,
    min_tls: &str,
    target_host: &str,
    proxy_url: Option<&str>,
) -> Result<rustls::ClientConfig, String> {
    ca_pinned_config(
        fingerprint,
        min_tls,
        target_host,
        proxy_url,
        native_root_store()?,
    )
}

fn ca_pinned_config(
    fingerprint: String,
    min_tls: &str,
    target_host: &str,
    proxy_url: Option<&str>,
    roots: rustls::RootCertStore,
) -> Result<rustls::ClientConfig, String> {
    // Reuse strict fingerprint syntax validation, never normalize junk into a pin.
    validate_cert_fingerprint(&fingerprint)?;
    let ca = verifier(roots)?;
    let target = tls_server_name(target_host.trim_start_matches('[').trim_end_matches(']'))?;
    let https_proxy = proxy_url
        .map(|value| {
            let url = url::Url::parse(value).map_err(|_| "Invalid HTTPS proxy route")?;
            if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() {
                return Err("Invalid HTTPS proxy route".to_string());
            }
            if url.scheme() == "https" {
                tls_server_name(
                    url.host_str()
                        .expect("checked host")
                        .trim_start_matches('[')
                        .trim_end_matches(']'),
                )
                .map(Some)
            } else {
                Ok(None)
            }
        })
        .transpose()?
        .flatten();
    let versions = if min_tls.trim() == "1.3" {
        vec![&rustls::version::TLS13]
    } else {
        vec![&rustls::version::TLS13, &rustls::version::TLS12]
    };
    rustls::ClientConfig::builder_with_provider(Arc::new(
        rustls::crypto::aws_lc_rs::default_provider(),
    ))
    .with_protocol_versions(&versions)
    .map_err(|_| "TLS protocol versions unavailable")?
    .dangerous()
    .with_custom_certificate_verifier(Arc::new(CaPinnedVerifier {
        ca,
        pin: PinnedCertificateVerification::new(fingerprint),
        target,
        https_proxy,
    }))
    .with_no_client_auth()
    .pipe(Ok)
}

#[cfg(test)]
#[path = "http_tls_ca_tests.rs"]
mod tests;
