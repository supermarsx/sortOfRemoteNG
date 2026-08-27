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
//!    - `AlwaysAsk`: no prompt channel exists for these non-interactive
//!      backends, so unknown identities fail closed.
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

use std::sync::{Arc, Mutex, OnceLock};

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
const MAX_HOST_BYTES: usize = 253;
const MAX_LEAF_CERT_BYTES: usize = 1024 * 1024;
const MAX_CHAIN_CERTIFICATES: usize = 16;
const MAX_CHAIN_BYTES: usize = 4 * 1024 * 1024;
const MAX_OCSP_BYTES: usize = 1024 * 1024;
const MAX_CERT_FIELD_BYTES: usize = 4096;
const MAX_SAN_ENTRIES: usize = 256;
const MAX_SAN_BYTES: usize = 1024;

static TRUST_DECISION_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

fn canonical_trust_host(host: &str) -> Result<String, String> {
    let unbracketed = if host.starts_with('[') && host.ends_with(']') && host.len() > 2 {
        &host[1..host.len() - 1]
    } else {
        host
    };

    if let Ok(address) = unbracketed.parse::<std::net::IpAddr>() {
        return Ok(address.to_string());
    }

    let dns_name = unbracketed.strip_suffix('.').unwrap_or(unbracketed);
    if dns_name.is_empty()
        || !dns_name.is_ascii()
        || dns_name.starts_with('.')
        || dns_name.contains("..")
        || dns_name.contains('*')
    {
        return Err("invalid TLS trust context host".to_string());
    }
    Ok(dns_name.to_ascii_lowercase())
}

fn server_name_matches_context(
    context_host: &str,
    server_name: &ServerName<'_>,
) -> Result<bool, String> {
    let expected = canonical_trust_host(context_host)?;
    let verification_name = server_name.to_str();
    let actual = canonical_trust_host(verification_name.as_ref())?;
    Ok(expected == actual)
}

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
    /// A record exists but was explicitly revoked.
    Revoked,
    /// The policy requires an interaction or threshold this verifier cannot
    /// complete.
    Pending,
}

impl StoreVerdict {
    /// Collapse a [`TrustVerifyResult`] into the coarse verdict the pure
    /// decision core reasons over.
    pub fn from_verify_result(result: &TrustVerifyResult) -> Self {
        match result {
            TrustVerifyResult::Trusted => StoreVerdict::Match,
            TrustVerifyResult::FirstUse { .. } => StoreVerdict::Unknown,
            TrustVerifyResult::PendingThreshold { .. }
            | TrustVerifyResult::PendingVerification { .. } => StoreVerdict::Pending,
            // Any changed/expired/revoked/chain-mismatch is a hard "changed".
            TrustVerifyResult::Mismatch { .. }
            | TrustVerifyResult::Expired { .. }
            | TrustVerifyResult::ChainMismatch { .. }
            | TrustVerifyResult::RotationGrace { .. } => StoreVerdict::Changed,
            TrustVerifyResult::Revoked { .. } => StoreVerdict::Revoked,
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
    if matches!(verdict, StoreVerdict::Revoked) {
        return TlsTrustAction::Reject(
            "the server's TLS identity is revoked in the Trust Center".to_string(),
        );
    }

    if matches!(policy, TrustPolicy::CaTrustOnly) && !chain_valid {
        return TlsTrustAction::Reject(
            "the effective CA-only policy requires successful WebPKI chain and \
             hostname validation"
                .to_string(),
        );
    }

    if matches!(policy, TrustPolicy::AlwaysTrust) {
        return TlsTrustAction::Accept;
    }

    match verdict {
        StoreVerdict::Match => TlsTrustAction::Accept,
        StoreVerdict::Pending => TlsTrustAction::Reject(
            "the effective trust policy requires approval or additional verification \
             that is unavailable in this non-interactive TLS client"
                .to_string(),
        ),
        StoreVerdict::Revoked => unreachable!("revocation is handled before policy"),
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
            TrustPolicy::Strict | TrustPolicy::AlwaysAsk => TlsTrustAction::Reject(
                "the server's TLS certificate is not in the Trust Center and the \
                 effective policy requires explicit approval. This non-interactive \
                 client cannot prompt; pin it manually in the Trust Center."
                    .to_string(),
            ),
            TrustPolicy::Tofu
            | TrustPolicy::TofuWithExpiry
            | TrustPolicy::CertificatePinning
            | TrustPolicy::KeyRotationGrace
                if chain_valid =>
            {
                TlsTrustAction::AcceptAndPersist
            }
            TrustPolicy::CaTrustOnly if chain_valid => TlsTrustAction::Accept,
            TrustPolicy::TrustOnVerify
            | TrustPolicy::ConditionalTrust
            | TrustPolicy::ThresholdTrust => TlsTrustAction::Reject(
                "the effective trust policy cannot be completed by this \
                 non-interactive TLS client"
                    .to_string(),
            ),
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
    /// Context over the process-global per-database Trust Center
    /// ([`SyncTrustStore::shared`]). This is what management clients use
    /// since t62 — no store path plumbing; when no database is active the
    /// handshake fails closed.
    pub fn shared(
        host: impl Into<String>,
        port: u16,
        policy_override: Option<TrustPolicy>,
    ) -> Self {
        Self {
            store: Arc::new(SyncTrustStore::shared()),
            host: host.into(),
            port,
            policy_override,
        }
    }

    /// The `host:port` string used as the store host key.
    fn host_key(&self) -> String {
        format!("{}:{}", self.host, self.port)
    }

    fn validate(&self) -> Result<(), String> {
        let host = self.host.as_str();
        if host.is_empty()
            || host.len() > MAX_HOST_BYTES
            || host.trim() != host
            || host.chars().any(char::is_control)
            || host.chars().any(char::is_whitespace)
            || host.contains("://")
            || host.contains('/')
            || host.contains('\\')
            || host.contains('@')
            || self.port == 0
        {
            return Err("invalid TLS trust context endpoint".to_string());
        }
        canonical_trust_host(host)?;
        Ok(())
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
    chain_fingerprints: Vec<String>,
    time_valid: bool,
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

fn bounded_field(value: String, maximum: usize) -> Option<String> {
    if !value.is_empty() && value.len() <= maximum && !value.contains('\0') {
        Some(value)
    } else {
        None
    }
}

fn extract_leaf_details(der: &[u8], intermediates: &[CertificateDer<'_>]) -> LeafCertDetails {
    let fingerprint = fingerprint_hex(der);
    let pem = Some(pem_encode(der));
    let mut chain_fingerprints = Vec::with_capacity(intermediates.len() + 1);
    chain_fingerprints.push(fingerprint.clone());
    chain_fingerprints.extend(
        intermediates
            .iter()
            .map(|certificate| fingerprint_hex(certificate.as_ref())),
    );

    match x509_parser::parse_x509_certificate(der) {
        Ok((_rem, cert)) => {
            let san = cert.subject_alternative_name().ok().flatten().map(|ext| {
                ext.value
                    .general_names
                    .iter()
                    .take(MAX_SAN_ENTRIES)
                    .filter_map(|name| bounded_field(format!("{name}"), MAX_SAN_BYTES))
                    .collect::<Vec<_>>()
            });
            let now = chrono::Utc::now().timestamp();
            LeafCertDetails {
                fingerprint,
                subject: bounded_field(cert.subject().to_string(), MAX_CERT_FIELD_BYTES),
                issuer: bounded_field(cert.issuer().to_string(), MAX_CERT_FIELD_BYTES),
                valid_from: cert.validity().not_before.to_rfc2822().ok(),
                valid_to: cert.validity().not_after.to_rfc2822().ok(),
                serial: bounded_field(cert.raw_serial_as_string(), 512),
                signature_algorithm: bounded_field(
                    cert.signature_algorithm.algorithm.to_string(),
                    256,
                ),
                san,
                pem,
                chain_fingerprints,
                time_valid: cert.validity().not_before.timestamp() <= now
                    && now <= cert.validity().not_after.timestamp(),
            }
        }
        Err(_) => {
            log::warn!("sorng-tls-trust: failed to parse bounded leaf certificate");
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
                chain_fingerprints,
                time_valid: false,
            }
        }
    }
}

impl LeafCertDetails {
    fn into_identity(self) -> Identity {
        let now = chrono::Utc::now().to_rfc3339();
        Identity::Tls(Box::new(CertIdentity {
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
            chain_fingerprints: self.chain_fingerprints,
            subject_cn: None,
            subject_org: None,
            subject_ou: None,
            subject_country: None,
            subject_state: None,
            subject_locality: None,
            subject_email: None,
            issuer_cn: None,
            issuer_org: None,
            issuer_country: None,
            key_algorithm: None,
            key_size: None,
            version: None,
            chain: None,
        }))
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
        ctx.validate()?;
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
        if !server_name_matches_context(&self.ctx.host, server_name).map_err(|_| {
            rustls::Error::General(
                "the TLS verification name is not a valid scoped trust host".to_string(),
            )
        })? {
            return Err(rustls::Error::General(
                "the TLS verification name does not match the scoped trust host".to_string(),
            ));
        }

        if end_entity.is_empty() || end_entity.len() > MAX_LEAF_CERT_BYTES {
            return Err(rustls::Error::General(
                "the server leaf certificate exceeds the safety limit".to_string(),
            ));
        }
        let chain_bytes = intermediates.iter().try_fold(0usize, |total, certificate| {
            total.checked_add(certificate.len())
        });
        if intermediates.len() > MAX_CHAIN_CERTIFICATES
            || chain_bytes.is_none_or(|total| total > MAX_CHAIN_BYTES)
        {
            return Err(rustls::Error::General(
                "the server certificate chain exceeds the safety limit".to_string(),
            ));
        }
        if ocsp_response.len() > MAX_OCSP_BYTES {
            return Err(rustls::Error::General(
                "the server OCSP response exceeds the safety limit".to_string(),
            ));
        }

        // 1. Fingerprint + parse the leaf cert.
        let details = extract_leaf_details(end_entity.as_ref(), intermediates);
        let certificate_time_valid = details.time_valid;
        let identity = details.into_identity();

        // 2. Standard webpki chain/hostname validation. Unknown certificates
        //    are only pinned when this succeeds; otherwise a first-use MITM
        //    could become trusted before any prior identity exists.
        let chain_valid = self
            .inner
            .verify_server_cert(end_entity, intermediates, server_name, ocsp_response, now)
            .is_ok();

        let _decision_guard = TRUST_DECISION_LOCK
            .get_or_init(|| Mutex::new(()))
            .try_lock()
            .map_err(|_| {
                rustls::Error::General(
                    "TLS trust verification is busy; retry the connection".to_string(),
                )
            })?;

        // 3. Determine the effective policy and consult the store.
        let policy = self.effective_policy();
        let host_key = self.ctx.host_key();

        if !certificate_time_valid && !matches!(policy, TrustPolicy::AlwaysTrust) {
            return Err(rustls::Error::General(
                "the server TLS certificate is expired or not yet valid".to_string(),
            ));
        }

        let verdict = match self
            .ctx
            .store
            .verify(&host_key, TLS_RECORD_TYPE, identity.clone())
        {
            Ok(result) => StoreVerdict::from_verify_result(&result),
            Err(_) => {
                log::warn!("sorng-tls-trust: persistent trust verification failed");
                return Err(rustls::Error::General(
                    "persistent TLS trust verification failed".to_string(),
                ));
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
                    .map_err(|_| {
                        log::warn!("sorng-tls-trust: persistent trust write failed");
                        rustls::Error::General(
                            "failed to persist the TLS trust decision".to_string(),
                        )
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
        .map_err(|_| "failed to build the bounded TOFU HTTP client".to_string())
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
