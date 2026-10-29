//! K7 (x2): upstream certificate verification for intercepted attempts.
//!
//! The handshake verifier only *records*: it never fails a handshake because
//! of the name, the validity dates or an unknown authority, because those go
//! to the app's trust decision (TOFU, pins, review). It fails the handshake
//! only for the non-overridable set Chromium also refuses: malformed
//! certificates, weak keys and weak signature algorithms. TLS 1.2/1.3
//! handshake signatures are always checked strictly.
//!
//! After the handshake (off the async runtime, see `system_validation`) the
//! chain as sent is checked against the OS roots and OS revocation through
//! `rustls-platform-verifier`. Its verdict becomes `system_ca_valid`; a
//! revoked or badly signed chain is fatal. Tests inject their own "system"
//! root and a fake revocation list, so nothing depends on the machine's roots.
//!
//! No certificate, host or error text is logged.

// Wired into the exchange pipeline by x1 (forward.rs); unused until then.
#![cfg_attr(not(test), allow(dead_code))]

use super::trust::UpstreamFatal;
use rustls::client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier};
use rustls::crypto::CryptoProvider;
use rustls::pki_types::{CertificateDer, ServerName, UnixTime};
use rustls::{CertificateError, DigitallySignedStruct, SignatureScheme};
use std::sync::{Arc, Mutex};

/// Smallest RSA modulus accepted anywhere in an upstream chain.
const MIN_RSA_BITS: usize = 2048;

/// Signature algorithms Chromium refuses (SHA-1 / MD5 / MD2 families).
const WEAK_SIGNATURE_OIDS: &[&str] = &[
    "1.2.840.113549.1.1.2", // md2WithRSAEncryption
    "1.2.840.113549.1.1.4", // md5WithRSAEncryption
    "1.2.840.113549.1.1.5", // sha1WithRSAEncryption
    "1.3.14.3.2.29",        // sha1WithRSASignature (OIW)
    "1.2.840.10045.4.1",    // ecdsa-with-SHA1
    "1.2.840.10040.4.3",    // dsa-with-sha1
];

/// Per-attempt verifier configuration: the crypto provider and the "system"
/// verifier that decides `system_ca_valid`.
#[derive(Clone)]
pub(crate) struct UpstreamVerifierConfig {
    provider: Arc<CryptoProvider>,
    /// `None` when the platform verifier is unavailable: every chain is then
    /// treated as not CA-valid (the app decides; nothing is auto-trusted).
    system: Option<Arc<dyn ServerCertVerifier>>,
}

/// The process-default provider (the app installs ring at startup). The
/// fallback only matters for crate-local tests that install nothing.
pub(crate) fn process_provider() -> Arc<CryptoProvider> {
    CryptoProvider::get_default()
        .cloned()
        .unwrap_or_else(|| Arc::new(rustls::crypto::aws_lc_rs::default_provider()))
}

impl UpstreamVerifierConfig {
    /// OS roots + OS revocation (rustls-platform-verifier).
    pub(crate) fn platform() -> Self {
        let provider = process_provider();
        let system = rustls_platform_verifier::Verifier::new(provider.clone())
            .ok()
            .map(|verifier| Arc::new(verifier) as Arc<dyn ServerCertVerifier>);
        Self { provider, system }
    }

    /// Test configuration: `roots` play the OS root store and `revoked` lists
    /// end-entity DERs the fake OS revocation check reports as revoked.
    #[cfg(test)]
    pub(crate) fn for_tests(roots: &[CertificateDer<'static>], revoked: &[Vec<u8>]) -> Self {
        let provider = process_provider();
        let mut store = rustls::RootCertStore::empty();
        for root in roots {
            store.add(root.clone()).expect("test root");
        }
        let system: Option<Arc<dyn ServerCertVerifier>> = if store.is_empty() {
            None
        } else {
            let webpki = rustls::client::WebPkiServerVerifier::builder_with_provider(
                Arc::new(store),
                provider.clone(),
            )
            .build()
            .expect("test verifier");
            Some(Arc::new(tests::FakeRevocation {
                inner: webpki,
                revoked: revoked.to_vec(),
            }))
        };
        Self { provider, system }
    }

    pub(crate) fn provider(&self) -> &Arc<CryptoProvider> {
        &self.provider
    }

    /// OS validation of the chain as sent, for the exact upstream name. Runs
    /// a potentially blocking platform call: call from `spawn_blocking`.
    pub(crate) fn system_validation(
        &self,
        chain: &[Vec<u8>],
        name: &ServerName<'static>,
        ocsp: &[u8],
    ) -> SystemValidation {
        let (Some(system), Some((leaf, intermediates))) = (&self.system, chain.split_first())
        else {
            return SystemValidation::NotValid;
        };
        let leaf = CertificateDer::from(leaf.as_slice());
        let intermediates: Vec<CertificateDer<'_>> = intermediates
            .iter()
            .map(|der| CertificateDer::from(der.as_slice()))
            .collect();
        classify_system(system.verify_server_cert(
            &leaf,
            &intermediates,
            name,
            ocsp,
            UnixTime::now(),
        ))
    }
}

/// Outcome of the OS validation.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum SystemValidation {
    Valid,
    /// Name, date, authority or any other overridable problem: the app decides.
    NotValid,
    Fatal(UpstreamFatal),
}

pub(crate) fn classify_system(
    result: Result<ServerCertVerified, rustls::Error>,
) -> SystemValidation {
    match result {
        Ok(_) => SystemValidation::Valid,
        Err(rustls::Error::InvalidCertificate(error)) => match error {
            CertificateError::Revoked => SystemValidation::Fatal(UpstreamFatal::Revoked),
            CertificateError::BadSignature => SystemValidation::Fatal(UpstreamFatal::BadSignature),
            CertificateError::BadEncoding => SystemValidation::Fatal(UpstreamFatal::Malformed),
            _ => SystemValidation::NotValid,
        },
        Err(_) => SystemValidation::NotValid,
    }
}

/// Combines the OS verdict with the attempt's observed HSTS state. Returns
/// `Err(fatal)` for a non-overridable result, else `system_ca_valid`.
pub(crate) fn admission_input(
    validation: SystemValidation,
    hsts: bool,
) -> Result<bool, UpstreamFatal> {
    match validation {
        SystemValidation::Valid => Ok(true),
        SystemValidation::Fatal(fatal) => Err(fatal),
        // HSTS: a host that sent Strict-Transport-Security in this attempt
        // gets no certificate prompt for name/date/authority problems.
        SystemValidation::NotValid if hsts => Err(UpstreamFatal::HstsViolation),
        SystemValidation::NotValid => Ok(false),
    }
}

/// Structural, non-overridable checks on the chain as sent.
pub(crate) fn structural_fatal(chain: &[&[u8]]) -> Option<UpstreamFatal> {
    use x509_parser::prelude::{FromDer, X509Certificate};
    if chain.is_empty() {
        return Some(UpstreamFatal::Malformed);
    }
    let mut parsed = Vec::with_capacity(chain.len());
    for der in chain {
        match X509Certificate::from_der(der) {
            Ok(([], cert)) => parsed.push(cert),
            _ => return Some(UpstreamFatal::Malformed),
        }
    }
    let last = parsed.len() - 1;
    for (index, cert) in parsed.iter().enumerate() {
        if rsa_bits(cert).is_some_and(|bits| bits < MIN_RSA_BITS) {
            return Some(UpstreamFatal::WeakKey);
        }
        // A self-issued trust anchor sent at the end of a longer chain is
        // not judged by its own signature (Chromium ignores anchors' algos).
        let anchor = index == last && last > 0 && cert.subject() == cert.issuer();
        if !anchor && weak_signature_oid(&cert.signature_algorithm.algorithm.to_id_string()) {
            return Some(UpstreamFatal::WeakKey);
        }
    }
    None
}

pub(crate) fn weak_signature_oid(oid: &str) -> bool {
    WEAK_SIGNATURE_OIDS.contains(&oid)
}

fn rsa_bits(cert: &x509_parser::certificate::X509Certificate<'_>) -> Option<usize> {
    use x509_parser::public_key::PublicKey;
    match cert.public_key().parsed() {
        Ok(PublicKey::RSA(rsa)) => Some(modulus_bits(rsa.modulus)),
        // A key that claims RSA but does not parse is malformed, not weak;
        // the structural parse above already accepted the certificate.
        _ => None,
    }
}

/// Bit length of a big-endian unsigned modulus (leading zero bytes ignored).
pub(crate) fn modulus_bits(modulus: &[u8]) -> usize {
    let trimmed: &[u8] = match modulus.iter().position(|byte| *byte != 0) {
        Some(start) => &modulus[start..],
        None => return 0,
    };
    trimmed.len() * 8 - trimmed[0].leading_zeros() as usize
}

/// What the handshake verifier saw. Read once the handshake has finished.
/// `Debug` shows the OCSP length, never its bytes.
#[derive(Clone, Default, Eq, PartialEq)]
pub(crate) struct VerifyRecord {
    /// A structural fatal result that aborted the handshake.
    pub fatal: Option<UpstreamFatal>,
    /// Stapled OCSP response, passed on to the OS validation.
    pub ocsp: Vec<u8>,
}

impl std::fmt::Debug for VerifyRecord {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("VerifyRecord")
            .field("fatal", &self.fatal)
            .field("ocsp_len", &self.ocsp.len())
            .finish()
    }
}

/// One per upstream connection.
#[derive(Debug)]
pub(crate) struct RecordingVerifier {
    provider: Arc<CryptoProvider>,
    record: Mutex<VerifyRecord>,
}

impl RecordingVerifier {
    pub(crate) fn new(config: &UpstreamVerifierConfig) -> Arc<Self> {
        Arc::new(Self {
            provider: config.provider.clone(),
            record: Mutex::new(VerifyRecord::default()),
        })
    }

    pub(crate) fn record(&self) -> VerifyRecord {
        self.record
            .lock()
            .map(|record| record.clone())
            .unwrap_or_else(|_| VerifyRecord {
                fatal: Some(UpstreamFatal::Malformed),
                ocsp: Vec::new(),
            })
    }
}

impl ServerCertVerifier for RecordingVerifier {
    fn verify_server_cert(
        &self,
        end_entity: &CertificateDer<'_>,
        intermediates: &[CertificateDer<'_>],
        _name: &ServerName<'_>,
        ocsp: &[u8],
        _now: UnixTime,
    ) -> Result<ServerCertVerified, rustls::Error> {
        let chain: Vec<&[u8]> = std::iter::once(end_entity.as_ref())
            .chain(intermediates.iter().map(|der| der.as_ref()))
            .collect();
        let fatal = structural_fatal(&chain);
        let mut record = self
            .record
            .lock()
            .map_err(|_| rustls::Error::General("upstream verifier state unavailable".into()))?;
        record.fatal = fatal;
        record.ocsp = ocsp.to_vec();
        if fatal.is_some() {
            return Err(rustls::Error::InvalidCertificate(
                CertificateError::ApplicationVerificationFailure,
            ));
        }
        // Not admission: the app's trust decision runs after the handshake
        // and before any request byte.
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
            &self.provider.signature_verification_algorithms,
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
            &self.provider.signature_verification_algorithms,
        )
    }

    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        self.provider
            .signature_verification_algorithms
            .supported_schemes()
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    /// Plays OS revocation in tests: a listed end-entity is reported revoked.
    #[derive(Debug)]
    pub(crate) struct FakeRevocation {
        pub inner: Arc<rustls::client::WebPkiServerVerifier>,
        pub revoked: Vec<Vec<u8>>,
    }

    impl ServerCertVerifier for FakeRevocation {
        fn verify_server_cert(
            &self,
            end_entity: &CertificateDer<'_>,
            intermediates: &[CertificateDer<'_>],
            name: &ServerName<'_>,
            ocsp: &[u8],
            now: UnixTime,
        ) -> Result<ServerCertVerified, rustls::Error> {
            if self
                .revoked
                .iter()
                .any(|der| der.as_slice() == end_entity.as_ref())
            {
                return Err(rustls::Error::InvalidCertificate(CertificateError::Revoked));
            }
            self.inner
                .verify_server_cert(end_entity, intermediates, name, ocsp, now)
        }
        fn verify_tls12_signature(
            &self,
            message: &[u8],
            cert: &CertificateDer<'_>,
            signature: &DigitallySignedStruct,
        ) -> Result<HandshakeSignatureValid, rustls::Error> {
            self.inner.verify_tls12_signature(message, cert, signature)
        }
        fn verify_tls13_signature(
            &self,
            message: &[u8],
            cert: &CertificateDer<'_>,
            signature: &DigitallySignedStruct,
        ) -> Result<HandshakeSignatureValid, rustls::Error> {
            self.inner.verify_tls13_signature(message, cert, signature)
        }
        fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
            self.inner.supported_verify_schemes()
        }
    }

    #[test]
    fn modulus_bits_ignores_leading_zeroes_and_counts_the_top_byte() {
        assert_eq!(modulus_bits(&[]), 0);
        assert_eq!(modulus_bits(&[0, 0]), 0);
        assert_eq!(modulus_bits(&[0x80; 128]), 1024);
        let mut padded = vec![0u8];
        padded.extend([0xc0; 256]);
        assert_eq!(modulus_bits(&padded), 2048);
        assert_eq!(modulus_bits(&[0x01, 0xff]), 9);
    }

    #[test]
    fn weak_signature_oids_cover_sha1_md5_md2_only() {
        for weak in WEAK_SIGNATURE_OIDS {
            assert!(weak_signature_oid(weak));
        }
        for strong in [
            "1.2.840.113549.1.1.11", // sha256WithRSAEncryption
            "1.2.840.10045.4.3.2",   // ecdsa-with-SHA256
            "1.3.101.112",           // Ed25519
        ] {
            assert!(!weak_signature_oid(strong));
        }
    }

    #[test]
    fn os_results_map_to_fatal_only_for_the_non_overridable_set() {
        use CertificateError as E;
        let invalid = |error| classify_system(Err(rustls::Error::InvalidCertificate(error)));
        assert_eq!(
            invalid(E::Revoked),
            SystemValidation::Fatal(UpstreamFatal::Revoked)
        );
        assert_eq!(
            invalid(E::BadSignature),
            SystemValidation::Fatal(UpstreamFatal::BadSignature)
        );
        assert_eq!(
            invalid(E::BadEncoding),
            SystemValidation::Fatal(UpstreamFatal::Malformed)
        );
        for overridable in [
            E::Expired,
            E::NotValidYet,
            E::UnknownIssuer,
            E::NotValidForName,
            E::InvalidPurpose,
            E::UnknownRevocationStatus,
            E::UnhandledCriticalExtension,
        ] {
            assert_eq!(invalid(overridable), SystemValidation::NotValid);
        }
        assert_eq!(
            classify_system(Err(rustls::Error::General("os".into()))),
            SystemValidation::NotValid
        );
        assert_eq!(
            classify_system(Ok(ServerCertVerified::assertion())),
            SystemValidation::Valid
        );
    }

    #[test]
    fn hsts_turns_only_overridable_failures_into_violations() {
        assert_eq!(admission_input(SystemValidation::Valid, true), Ok(true));
        assert_eq!(
            admission_input(SystemValidation::NotValid, false),
            Ok(false)
        );
        assert_eq!(
            admission_input(SystemValidation::NotValid, true),
            Err(UpstreamFatal::HstsViolation)
        );
        assert_eq!(
            admission_input(SystemValidation::Fatal(UpstreamFatal::Revoked), true),
            Err(UpstreamFatal::Revoked)
        );
    }

    #[test]
    fn malformed_and_empty_chains_are_fatal() {
        assert_eq!(structural_fatal(&[]), Some(UpstreamFatal::Malformed));
        assert_eq!(
            structural_fatal(&[&[0x30, 0x03, 0x02, 0x01]]),
            Some(UpstreamFatal::Malformed)
        );
    }

    #[test]
    fn platform_config_builds_on_the_process_provider() {
        // Construction only: no OS root is consulted by this test.
        let config = UpstreamVerifierConfig::platform();
        assert!(Arc::ptr_eq(config.provider(), &config.clone().provider));
    }

    #[test]
    fn unavailable_system_verifier_never_reports_ca_validity() {
        let config = UpstreamVerifierConfig::for_tests(&[], &[]);
        let name = ServerName::try_from("example.test").unwrap();
        assert_eq!(
            config.system_validation(&[vec![0x30]], &name, &[]),
            SystemValidation::NotValid
        );
    }

    #[test]
    fn verify_record_debug_omits_the_ocsp_bytes() {
        let record = VerifyRecord {
            fatal: Some(UpstreamFatal::Revoked),
            ocsp: b"sentinel-host.invalid sentinel-secret-7f3a".to_vec(),
        };
        let debug = format!("{record:?} {record:#?}");
        // `Vec<u8>` debug would print the bytes as decimals; `s` is 115.
        assert!(!debug.contains("115"), "ocsp bytes leaked: {debug}");
        assert!(!debug.contains("sentinel"), "ocsp bytes leaked: {debug}");
        assert!(debug.contains("ocsp_len: 42"), "{debug}");
        assert!(debug.contains("Revoked"), "{debug}");
    }
}
