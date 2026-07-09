//! # sorng-tls-trust — shared TOFU TLS verifier for management clients
//!
//! Six management clients (supermicro, hetzner, oracle-cloud, warpgate,
//! powershell, winmgmt) historically called
//! `reqwest::ClientBuilder::danger_accept_invalid_certs(true)` — sending
//! credentials to a server whose certificate was never checked or memorized.
//!
//! This crate provides the *shared plumbing* so those clients route their TLS
//! certificate decision through the backend **Trust Center**
//! (`sorng_storage::trust_store`) with **Trust-On-First-Use (TOFU)** as the
//! default policy, instead of unconditionally skipping verification.
//!
//! ## What it does
//!
//! [`build_tofu_client`] installs a custom [`rustls::client::danger::ServerCertVerifier`]
//! ([`TofuVerifier`]) into a `reqwest::ClientBuilder` via
//! `use_preconfigured_tls`. On each handshake the verifier:
//!
//! 1. Fingerprints the leaf certificate (SHA-256 hex — same format the trust
//!    store records) and parses subject/issuer/validity/SAN for the record.
//! 2. Runs standard webpki chain validation against the native root store.
//!    Unknown certificates are only pinned on first use when this validation
//!    succeeds; the explicit `AlwaysTrust` override remains the escape hatch
//!    for legacy self-signed endpoints.
//! 3. Consults the persistent Trust Center store (via the blocking
//!    [`sorng_storage::trust_store::SyncTrustStore`] façade) and applies a
//!    **pure decision function** [`decide_tls_trust`]:
//!    - `Tofu` (default): valid unknown → fingerprint + persist + accept;
//!      invalid unknown → reject; known & matching → accept; **changed →
//!      reject** (MITM).
//!    - `AlwaysTrust`: accept without storing — the explicit replacement for
//!      today's blind skip (the legacy skip flags map to this override).
//!    - `Strict`: reject unknown; accept only a pre-approved match.
//!    - `AlwaysAsk`: no prompt channel for these non-interactive backends, so
//!      it degrades to TOFU-persist-on-valid-unknown / reject-on-invalid-or-change
//!      (same as SFTP's `Ask`).
//!
//! `verify_tls12_signature` / `verify_tls13_signature` /
//! `supported_verify_schemes` delegate to rustls' default
//! `WebPkiServerVerifier`, so cryptographic signature checking always stays on.
//!
//! ## Crypto provider
//!
//! The workspace installs the **ring** provider process-globally (in
//! `sorng-app`). The `ClientConfig` here is built with
//! `rustls::ClientConfig::builder()`, which uses the installed default
//! provider — building with a different provider would panic at handshake.

use std::sync::Arc;

use rustls::client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier};
use rustls::client::WebPkiServerVerifier;
use rustls::pki_types::{CertificateDer, ServerName, UnixTime};
use rustls::{DigitallySignedStruct, SignatureScheme};

use sorng_storage::trust_store::{
    CertIdentity, Identity, SyncTrustStore, TrustPolicy, TrustVerifyResult,
};

/// The Trust Center record type used for these legacy management clients.
/// Rendered as "Legacy TLS" in the Trust Center UI. Records are keyed
/// `tls:host:port` by the store.
pub const TLS_RECORD_TYPE: &str = "tls";

// ---------------------------------------------------------------------------
// Pure decision core (unit-tested; mirrors sftp::service::decide_host_key_action)
// ---------------------------------------------------------------------------

/// Outcome of the TOFU policy decision for a presented TLS certificate.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TlsTrustAction {
    /// Identity is trusted as-is — proceed (no store write).
    Accept,
    /// Trust-on-first-use: persist the identity, then proceed.
    AcceptAndPersist,
    /// Reject the connection with an actionable reason.
    Reject(String),
}

/// What the store said about the presented identity, distilled from
/// [`TrustVerifyResult`] into the three cases the policy core cares about.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StoreVerdict {
    /// No record for this host yet.
    Unknown,
    /// Stored fingerprint matches the presented one.
    Match,
    /// A record exists but the presented fingerprint differs (possible MITM),
    /// or the record is revoked / chain-pinned mismatch.
    Changed,
}

impl StoreVerdict {
    /// Collapse a [`TrustVerifyResult`] into the coarse verdict the pure
    /// decision core reasons over.
    pub fn from_verify_result(result: &TrustVerifyResult) -> Self {
        match result {
            TrustVerifyResult::Trusted => StoreVerdict::Match,
            // First-use / pending states all mean "no usable prior trust".
            TrustVerifyResult::FirstUse { .. }
            | TrustVerifyResult::PendingThreshold { .. }
            | TrustVerifyResult::PendingVerification { .. } => StoreVerdict::Unknown,
            // Any changed/expired/revoked/chain-mismatch is a hard "changed".
            TrustVerifyResult::Mismatch { .. }
            | TrustVerifyResult::Expired { .. }
            | TrustVerifyResult::Revoked { .. }
            | TrustVerifyResult::ChainMismatch { .. }
            | TrustVerifyResult::RotationGrace { .. } => StoreVerdict::Changed,
        }
    }
}

/// Pure TOFU policy decision. Decides what to do with a presented TLS
/// certificate given the store's verdict, the effective policy, and whether
/// the certificate chain validated against the native roots.
///
/// This is intentionally side-effect-free and exhaustively unit-tested so the
/// policy matrix is covered without a live TLS server. The verifier calls it,
/// then carries out the side effects (persist / reject).
///
/// * `Match`    → always accept (fingerprint already trusted).
/// * `Changed`  → always reject (possible MITM) — except `AlwaysTrust`, which
///   accepts anything (its documented escape-hatch behaviour).
/// * `Unknown`  → policy-dependent:
///   - `AlwaysTrust`        → accept, do not persist.
///   - `Strict`             → reject (manual pinning required).
///   - `Tofu` / `AlwaysAsk` / others → accept and persist (TOFU), but only
///     after normal WebPKI chain/hostname validation succeeds.
pub fn decide_tls_trust(
    verdict: StoreVerdict,
    policy: &TrustPolicy,
    chain_valid: bool,
) -> TlsTrustAction {
    // AlwaysTrust short-circuits everything: it is the explicit replacement for
    // the old blind `danger_accept_invalid_certs(true)`. It accepts any
    // identity (even a changed one) and never persists a record.
    if matches!(policy, TrustPolicy::AlwaysTrust) {
        return TlsTrustAction::Accept;
    }

    match verdict {
        StoreVerdict::Match => TlsTrustAction::Accept,
        StoreVerdict::Changed => TlsTrustAction::Reject(
            "the server's TLS certificate does not match the identity pinned in \
             the Trust Center. This may indicate a man-in-the-middle attack. \
             If the certificate was legitimately rotated, remove the old record \
             from the Trust Center (Legacy TLS) and reconnect."
                .to_string(),
        ),
        StoreVerdict::Unknown => match policy {
            // Strict: an unknown host is rejected — only a pre-approved match
            // is allowed.
            TrustPolicy::Strict => TlsTrustAction::Reject(
                "the server's TLS certificate is not in the Trust Center and the \
                 effective policy is Strict. Pin it manually in the Trust Center \
                 (Legacy TLS) to allow the connection."
                    .to_string(),
            ),
            // Tofu (default), AlwaysAsk (degrades to TOFU — non-interactive),
            // and all other policies trust-on-first-use only after the normal
            // CA/hostname checks have succeeded. This preserves default reqwest
            // security for public APIs and prevents pinning a first-use MITM
            // certificate; use the explicit AlwaysTrust override for legacy
            // self-signed endpoints.
            _ if chain_valid => TlsTrustAction::AcceptAndPersist,
            _ => TlsTrustAction::Reject(
                "the server's TLS certificate could not be validated by the \
                 system trust store, so it was not pinned on first use. If this \
                 is a trusted legacy self-signed endpoint, enable the explicit \
                 TLS skip/AlwaysTrust override for this connection."
                    .to_string(),
            ),
        },
    }
}

// ---------------------------------------------------------------------------
// Trust store handle abstraction (so the verifier is unit-testable with a stub)
// ---------------------------------------------------------------------------

/// Blocking trust-store access used by the verifier. Implemented for the real
/// [`SyncTrustStore`] and for in-memory stubs in tests.
pub trait BlockingTrustStore: Send + Sync {
    /// Verify a presented identity against the persistent store.
    fn verify(
        &self,
        host: &str,
        record_type: &str,
        identity: Identity,
    ) -> Result<TrustVerifyResult, String>;

    /// Persist (memorize) an identity for a host.
    fn trust(
        &self,
        host: String,
        record_type: String,
        identity: Identity,
        user_approved: bool,
    ) -> Result<(), String>;

    /// The effective global policy (per-host overrides are honoured by the
    /// store's verify result; the explicit per-connection override is passed
    /// separately via [`TofuTlsContext::policy_override`]).
    fn global_policy(&self) -> TrustPolicy;
}

impl BlockingTrustStore for SyncTrustStore {
    fn verify(
        &self,
        host: &str,
        record_type: &str,
        identity: Identity,
    ) -> Result<TrustVerifyResult, String> {
        self.verify_identity_blocking(host, record_type, identity)
    }

    fn trust(
        &self,
        host: String,
        record_type: String,
        identity: Identity,
        user_approved: bool,
    ) -> Result<(), String> {
        self.trust_identity_blocking(host, record_type, identity, user_approved)
    }

    fn global_policy(&self) -> TrustPolicy {
        self.global_policy()
    }
}

// ---------------------------------------------------------------------------
// Verifier context
// ---------------------------------------------------------------------------

/// Per-client context handed to [`build_tofu_client`]. Identifies the target
/// server (for the `tls:host:port` record key) and an optional explicit
/// policy override (the legacy skip flag maps to `Some(AlwaysTrust)`).
pub struct TofuTlsContext {
    /// Blocking handle to the persistent Trust Center store.
    pub store: Arc<dyn BlockingTrustStore>,
    /// Canonical host (scheme-stripped, no port).
    pub host: String,
    /// Canonical port (so the record is keyed `tls:host:port`).
    pub port: u16,
    /// Per-connection policy override. `Some(AlwaysTrust)` is how a legacy
    /// skip flag is honoured; `None` defers to the store's effective/global
    /// policy (default TOFU).
    pub policy_override: Option<TrustPolicy>,
}

impl TofuTlsContext {
    /// The `host:port` string used as the store host key.
    fn host_key(&self) -> String {
        format!("{}:{}", self.host, self.port)
    }
}

// ---------------------------------------------------------------------------
// Cert detail extraction
// ---------------------------------------------------------------------------

struct LeafCertDetails {
    /// SHA-256 hex (lowercase, no separators) — matches the trust store format.
    fingerprint: String,
    subject: Option<String>,
    issuer: Option<String>,
    valid_from: Option<String>,
    valid_to: Option<String>,
    serial: Option<String>,
    signature_algorithm: Option<String>,
    san: Option<Vec<String>>,
    pem: Option<String>,
}

/// Compute the SHA-256 hex fingerprint of a DER blob (lowercase, no colons),
/// matching `sorng_storage`'s `hex::encode` convention.
fn fingerprint_hex(der: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    hex::encode(Sha256::digest(der))
}

fn pem_encode(der: &[u8]) -> String {
    use base64::Engine;
    let b64 = base64::engine::general_purpose::STANDARD.encode(der);
    let body = b64
        .as_bytes()
        .chunks(64)
        .map(|c| std::str::from_utf8(c).unwrap_or(""))
        .collect::<Vec<_>>()
        .join("\n");
    format!("-----BEGIN CERTIFICATE-----\n{body}\n-----END CERTIFICATE-----")
}

fn extract_leaf_details(der: &[u8]) -> LeafCertDetails {
    let fingerprint = fingerprint_hex(der);
    let pem = Some(pem_encode(der));

    match x509_parser::parse_x509_certificate(der) {
        Ok((_rem, cert)) => {
            let san = cert.subject_alternative_name().ok().flatten().map(|ext| {
                ext.value
                    .general_names
                    .iter()
                    .map(|name| format!("{name}"))
                    .collect::<Vec<_>>()
            });
            LeafCertDetails {
                fingerprint,
                subject: Some(cert.subject().to_string()),
                issuer: Some(cert.issuer().to_string()),
                valid_from: cert.validity().not_before.to_rfc2822().ok(),
                valid_to: cert.validity().not_after.to_rfc2822().ok(),
                serial: Some(cert.raw_serial_as_string()),
                signature_algorithm: Some(cert.signature_algorithm.algorithm.to_string()),
                san,
                pem,
            }
        }
        Err(e) => {
            log::warn!("sorng-tls-trust: failed to parse leaf certificate: {e}");
            LeafCertDetails {
                fingerprint,
                subject: None,
                issuer: None,
                valid_from: None,
                valid_to: None,
                serial: None,
                signature_algorithm: None,
                san: None,
                pem,
            }
        }
    }
}

impl LeafCertDetails {
    fn into_identity(self) -> Identity {
        let now = chrono::Utc::now().to_rfc3339();
        Identity::Tls(CertIdentity {
            fingerprint: self.fingerprint,
            subject: self.subject,
            issuer: self.issuer,
            first_seen: now.clone(),
            last_seen: now,
            valid_from: self.valid_from,
            valid_to: self.valid_to,
            pem: self.pem,
            serial: self.serial,
            signature_algorithm: self.signature_algorithm,
            san: self.san,
            chain_fingerprints: Vec::new(),
        })
    }
}

// ---------------------------------------------------------------------------
// The verifier
// ---------------------------------------------------------------------------

/// A `rustls` server-certificate verifier that pins TLS *identity* through the
/// Trust Center (TOFU) while delegating all signature/chain cryptography to the
/// default `WebPkiServerVerifier`.
pub struct TofuVerifier {
    ctx: TofuTlsContext,
    inner: Arc<WebPkiServerVerifier>,
}

impl std::fmt::Debug for TofuVerifier {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("TofuVerifier")
            .field("host", &self.ctx.host)
            .field("port", &self.ctx.port)
            .field("policy_override", &self.ctx.policy_override)
            .finish()
    }
}

impl TofuVerifier {
    /// Build a verifier whose webpki delegate validates against the native
    /// root store.
    pub fn new(ctx: TofuTlsContext) -> Result<Self, String> {
        let mut roots = rustls::RootCertStore::empty();
        let loaded = rustls_native_certs::load_native_certs();
        for cert in loaded.certs {
            // Ignore individual malformed roots — webpki still validates
            // against the rest. A wholly empty root store only affects the
            // `chain_valid` diagnostic; TOFU identity pinning is unaffected.
            let _ = roots.add(cert);
        }
        let inner = WebPkiServerVerifier::builder(Arc::new(roots))
            .build()
            .map_err(|e| format!("failed to build webpki verifier: {e}"))?;
        Ok(Self { ctx, inner })
    }

    /// The effective policy: explicit per-connection override wins, else the
    /// store's global policy (default TOFU).
    fn effective_policy(&self) -> TrustPolicy {
        self.ctx
            .policy_override
            .clone()
            .unwrap_or_else(|| self.ctx.store.global_policy())
    }
}

impl ServerCertVerifier for TofuVerifier {
    fn verify_server_cert(
        &self,
        end_entity: &CertificateDer<'_>,
        intermediates: &[CertificateDer<'_>],
        server_name: &ServerName<'_>,
        ocsp_response: &[u8],
        now: UnixTime,
    ) -> Result<ServerCertVerified, rustls::Error> {
        // 1. Fingerprint + parse the leaf cert.
        let details = extract_leaf_details(end_entity.as_ref());
        let identity = details.into_identity();

        // 2. Standard webpki chain/hostname validation. Unknown certificates
        //    are only pinned when this succeeds; otherwise a first-use MITM
        //    could become trusted before any prior identity exists.
        let chain_valid = self
            .inner
            .verify_server_cert(end_entity, intermediates, server_name, ocsp_response, now)
            .is_ok();

        // 3. Determine the effective policy and consult the store.
        let policy = self.effective_policy();
        let host_key = self.ctx.host_key();

        // AlwaysTrust never touches the store (preserves the escape hatch).
        let verdict = if matches!(policy, TrustPolicy::AlwaysTrust) {
            StoreVerdict::Unknown
        } else {
            match self
                .ctx
                .store
                .verify(&host_key, TLS_RECORD_TYPE, identity.clone())
            {
                Ok(result) => StoreVerdict::from_verify_result(&result),
                Err(e) => {
                    return Err(rustls::Error::General(format!(
                        "trust store verification failed for {host_key}: {e}"
                    )));
                }
            }
        };

        // 4. Pure policy decision, then carry out the side effect.
        match decide_tls_trust(verdict, &policy, chain_valid) {
            TlsTrustAction::Accept => Ok(ServerCertVerified::assertion()),
            TlsTrustAction::AcceptAndPersist => {
                self.ctx
                    .store
                    .trust(
                        host_key.clone(),
                        TLS_RECORD_TYPE.to_string(),
                        identity,
                        false,
                    )
                    .map_err(|e| {
                        rustls::Error::General(format!(
                            "failed to persist TOFU trust record for {host_key}: {e}"
                        ))
                    })?;
                Ok(ServerCertVerified::assertion())
            }
            TlsTrustAction::Reject(reason) => Err(rustls::Error::General(reason)),
        }
    }

    fn verify_tls12_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        // Signatures must remain cryptographically valid — TOFU pins identity,
        // it does not disable signature checking.
        self.inner.verify_tls12_signature(message, cert, dss)
    }

    fn verify_tls13_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        self.inner.verify_tls13_signature(message, cert, dss)
    }

    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        self.inner.supported_verify_schemes()
    }
}

// ---------------------------------------------------------------------------
// reqwest integration
// ---------------------------------------------------------------------------

/// Build a `reqwest::Client` whose TLS verification routes through the Trust
/// Center with TOFU. This is the one call the six management clients make in
/// place of `builder.danger_accept_invalid_certs(true)`.
///
/// The `builder` should carry the client's other settings (timeouts, cookie
/// store, etc.) *before* being passed in — this only installs the TLS config
/// and builds.
pub fn build_tofu_client(
    builder: reqwest::ClientBuilder,
    ctx: TofuTlsContext,
) -> Result<reqwest::Client, String> {
    let verifier = TofuVerifier::new(ctx)?;
    let config = rustls::ClientConfig::builder()
        .dangerous()
        .with_custom_certificate_verifier(Arc::new(verifier))
        .with_no_client_auth();

    builder
        .use_preconfigured_tls(config)
        .build()
        .map_err(|e| format!("failed to build reqwest client with TOFU verifier: {e}"))
}

/// Convenience: map a legacy "skip TLS verification" boolean to the explicit
/// per-connection policy override. `true` → `Some(AlwaysTrust)` (the visible,
/// revocable replacement for the old blind skip); `false` → `None` (defer to
/// the store's effective/global default, i.e. TOFU).
pub fn skip_flag_to_override(skip: bool) -> Option<TrustPolicy> {
    if skip {
        Some(TrustPolicy::AlwaysTrust)
    } else {
        None
    }
}

#[cfg(test)]
mod tests;
