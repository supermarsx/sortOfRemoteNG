//! # Certificate Generation Module
//!
//! Comprehensive certificate and key generation facilities:
//! - Self-signed certificates (TLS server/client)
//! - Certificate Authority (CA) creation
//! - Certificate Signing Requests (CSR)
//! - CA-signed certificate issuance
//! - PKCS#12 / PFX export
//! - PEM / DER export
//! - Multiple key algorithms: RSA (2048/3072/4096/8192), ECDSA P-256/P-384, Ed25519
//! - Configurable signature hash: SHA-256, SHA-384, SHA-512

use base64::Engine;
use chrono::Utc;
use rcgen::{
    BasicConstraints, Certificate, CertificateParams, DistinguishedName, DnType,
    ExtendedKeyUsagePurpose, IsCa, KeyPair, KeyUsagePurpose, SanType, SignatureAlgorithm,
    PKCS_ECDSA_P256_SHA256, PKCS_ECDSA_P384_SHA384, PKCS_ED25519, PKCS_RSA_SHA256,
    PKCS_RSA_SHA384, PKCS_RSA_SHA512,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use time::{Duration, OffsetDateTime};
use tokio::sync::Mutex;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/// Supported key algorithms for certificate generation.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum KeyAlgorithm {
    /// RSA 2048-bit
    Rsa2048,
    /// RSA 3072-bit
    Rsa3072,
    /// RSA 4096-bit
    Rsa4096,
    /// RSA 8192-bit (high security, slow generation)
    Rsa8192,
    /// ECDSA using the P-256 (secp256r1) curve
    EcdsaP256,
    /// ECDSA using the P-384 (secp384r1) curve
    EcdsaP384,
    /// Ed25519 (Edwards-curve Digital Signature Algorithm)
    Ed25519,
}

/// Signature hash algorithm (used with RSA; ECDSA/Ed25519 have fixed hashes).
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
#[serde(rename_all = "lowercase")]
pub enum SignatureHash {
    /// SHA-256 (default for RSA-2048/3072, only option for ECDSA P-256)
    #[default]
    Sha256,
    /// SHA-384 (recommended for RSA-3072+, only option for ECDSA P-384)
    Sha384,
    /// SHA-512 (recommended for RSA-4096+, high-security use)
    Sha512,
}

/// Certificate purpose / profile.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum CertProfile {
    /// Certificate Authority (can sign other certs)
    Ca,
    /// Intermediate CA (constrained path length)
    IntermediateCa,
    /// TLS server authentication
    TlsServer,
    /// TLS client authentication
    TlsClient,
    /// Both server and client auth
    TlsDual,
    /// Code signing
    CodeSigning,
    /// Email (S/MIME)
    Email,
    /// Timestamping authority (RFC 3161)
    TimestampAuthority,
    /// OCSP response signing
    OcspSigning,
    /// Document signing (PDF, XML, etc.)
    DocumentSigning,
    /// VPN server (TLS + IPsec server OIDs)
    VpnServer,
    /// VPN client (TLS + IPsec client OIDs)
    VpnClient,
    /// Any / unrestricted extended key usage (dev/test)
    AnyPurpose,
    /// SSH CA certificate (for signing SSH user/host certs)
    SshCa,
}

/// Parameters for generating a certificate or CA.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct CertGenParams {
    /// Common Name (CN)
    pub common_name: String,
    /// Organization (O)
    pub organization: Option<String>,
    /// Organizational Unit (OU)
    pub organizational_unit: Option<String>,
    /// Country (C) — 2-letter ISO code
    pub country: Option<String>,
    /// State / Province (ST)
    pub state: Option<String>,
    /// Locality / City (L)
    pub locality: Option<String>,
    /// Subject Alternative Names (DNS names, IPs, emails)
    pub san_dns: Vec<String>,
    pub san_ips: Vec<String>,
    pub san_emails: Vec<String>,
    /// Key algorithm
    pub algorithm: KeyAlgorithm,
    /// Signature hash algorithm (for RSA; ECDSA/Ed25519 ignore this)
    #[serde(default)]
    pub signature_hash: SignatureHash,
    /// Certificate profile
    pub profile: CertProfile,
    /// Validity in days from now
    pub validity_days: u32,
    /// For CA certs: maximum path length constraint (None = unlimited)
    pub path_length: Option<u8>,
}

/// Parameters for generating a Certificate Signing Request.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct CsrGenParams {
    pub common_name: String,
    pub organization: Option<String>,
    pub organizational_unit: Option<String>,
    pub country: Option<String>,
    pub state: Option<String>,
    pub locality: Option<String>,
    pub san_dns: Vec<String>,
    pub san_ips: Vec<String>,
    pub san_emails: Vec<String>,
    pub algorithm: KeyAlgorithm,
    /// Signature hash algorithm (for RSA; ECDSA/Ed25519 ignore this)
    #[serde(default)]
    pub signature_hash: SignatureHash,
}

/// Parameters for signing a CSR with a CA.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct CsrSignParams {
    /// PEM-encoded CSR
    pub csr_pem: String,
    /// CA certificate ID to sign with
    pub ca_id: String,
    /// Certificate profile for the issued cert
    pub profile: CertProfile,
    /// Validity in days
    pub validity_days: u32,
}

/// Parameters for PKCS#12/PFX export.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Pkcs12ExportParams {
    /// Certificate ID to export
    pub cert_id: String,
    /// Password to protect the PFX file
    pub password: String,
    /// Include the full certificate chain
    pub include_chain: bool,
}

/// Generated certificate result.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct GeneratedCert {
    /// Unique ID
    pub id: String,
    /// PEM-encoded certificate
    pub cert_pem: String,
    /// PEM-encoded private key
    pub key_pem: String,
    /// Certificate fingerprint (SHA-256 hex)
    pub fingerprint: String,
    /// Subject CN
    pub common_name: String,
    /// Certificate profile
    pub profile: CertProfile,
    /// Key algorithm used
    pub algorithm: KeyAlgorithm,
    /// Signature hash algorithm
    pub signature_hash: SignatureHash,
    /// Not-before date (RFC 3339)
    pub not_before: String,
    /// Not-after date (RFC 3339)
    pub not_after: String,
    /// Issuer CN (self for self-signed, CA CN for CA-issued)
    pub issuer: String,
    /// Serial number (hex)
    pub serial: String,
    /// Whether this is a CA certificate
    pub is_ca: bool,
    /// Subject Alternative Names
    pub san: Vec<String>,
    /// ID of the CA that signed this (None for self-signed/CA roots)
    pub signed_by: Option<String>,
    /// Creation timestamp
    pub created_at: String,
}

/// Generated CSR result.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct GeneratedCsr {
    pub id: String,
    pub csr_pem: String,
    pub key_pem: String,
    pub common_name: String,
    pub algorithm: KeyAlgorithm,
    pub signature_hash: SignatureHash,
    pub san: Vec<String>,
    pub created_at: String,
}

/// Certificate store entry for persistence.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct CertStoreEntry {
    pub cert: GeneratedCert,
    /// Optional label / nickname
    pub label: Option<String>,
    /// Tags for organization
    pub tags: Vec<String>,
}

/// CSR store entry for persistence.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct CsrStoreEntry {
    pub csr: GeneratedCsr,
    pub label: Option<String>,
}

/// Persistent store structure.
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
struct CertGenStore {
    certs: HashMap<String, CertStoreEntry>,
    csrs: HashMap<String, CsrStoreEntry>,
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

pub type CertGenServiceState = Arc<Mutex<CertGenService>>;

pub struct CertGenService {
    store: CertGenStore,
    store_path: PathBuf,
}

impl CertGenService {
    /// Create a new certificate generation service.
    pub fn new(store_path: String) -> CertGenServiceState {
        let path = PathBuf::from(&store_path);
        let store = if path.exists() {
            fs::read_to_string(&path)
                .ok()
                .and_then(|data| serde_json::from_str(&data).ok())
                .unwrap_or_default()
        } else {
            CertGenStore::default()
        };
        Arc::new(Mutex::new(CertGenService {
            store,
            store_path: path,
        }))
    }

    fn persist(&self) -> Result<(), String> {
        if let Some(parent) = self.store_path.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("Failed to create directory: {}", e))?;
        }
        let data =
            serde_json::to_string_pretty(&self.store).map_err(|e| format!("Serialize: {}", e))?;
        fs::write(&self.store_path, data).map_err(|e| format!("Write: {}", e))
    }

    // -----------------------------------------------------------------------
    // Key pair helpers
    // -----------------------------------------------------------------------

    /// Resolve the rcgen `SignatureAlgorithm` given a key algorithm and hash.
    /// For ECDSA and Ed25519 the hash is dictated by the curve, so `hash` is
    /// ignored for those variants.
    fn rcgen_sign_algo(
        algo: &KeyAlgorithm,
        hash: &SignatureHash,
    ) -> &'static SignatureAlgorithm {
        match algo {
            KeyAlgorithm::EcdsaP256 => &PKCS_ECDSA_P256_SHA256,
            KeyAlgorithm::EcdsaP384 => &PKCS_ECDSA_P384_SHA384,
            KeyAlgorithm::Ed25519 => &PKCS_ED25519,
            // RSA — honour the caller's hash preference
            _ => match hash {
                SignatureHash::Sha256 => &PKCS_RSA_SHA256,
                SignatureHash::Sha384 => &PKCS_RSA_SHA384,
                SignatureHash::Sha512 => &PKCS_RSA_SHA512,
            },
        }
    }

    /// Generate a key-pair sized/typed according to `algo`.
    /// The initial `SignatureAlgorithm` attached to the `KeyPair` is
    /// SHA-256 for RSA (will be overridden later via `rcgen_sign_algo`).
    fn generate_key_pair(algo: &KeyAlgorithm) -> Result<KeyPair, String> {
        match algo {
            KeyAlgorithm::Rsa2048 => Self::_rsa_key_pair(2048),
            KeyAlgorithm::Rsa3072 => Self::_rsa_key_pair(3072),
            KeyAlgorithm::Rsa4096 => Self::_rsa_key_pair(4096),
            KeyAlgorithm::Rsa8192 => Self::_rsa_key_pair(8192),
            KeyAlgorithm::EcdsaP256 => {
                let secret_key = p256::SecretKey::random(&mut rand::thread_rng());
                let pkcs8_der = pkcs8::EncodePrivateKey::to_pkcs8_der(&secret_key)
                    .map_err(|e| format!("PKCS8 encode P-256: {}", e))?;
                KeyPair::from_der_and_sign_algo(pkcs8_der.as_bytes(), &PKCS_ECDSA_P256_SHA256)
                    .map_err(|e| format!("KeyPair from P-256: {}", e))
            }
            KeyAlgorithm::EcdsaP384 => {
                let secret_key = p384::SecretKey::random(&mut rand::thread_rng());
                let pkcs8_der = pkcs8::EncodePrivateKey::to_pkcs8_der(&secret_key)
                    .map_err(|e| format!("PKCS8 encode P-384: {}", e))?;
                KeyPair::from_der_and_sign_algo(pkcs8_der.as_bytes(), &PKCS_ECDSA_P384_SHA384)
                    .map_err(|e| format!("KeyPair from P-384: {}", e))
            }
            KeyAlgorithm::Ed25519 => KeyPair::generate(&PKCS_ED25519)
                .map_err(|e| format!("Ed25519 keygen: {}", e)),
        }
    }

    /// Internal helper — generate an RSA key pair of the given bit size.
    fn _rsa_key_pair(bits: usize) -> Result<KeyPair, String> {
        let private_key = rsa::RsaPrivateKey::new(&mut rand::thread_rng(), bits)
            .map_err(|e| format!("RSA-{} keygen failed: {}", bits, e))?;
        let pkcs8_der = pkcs8::EncodePrivateKey::to_pkcs8_der(&private_key)
            .map_err(|e| format!("PKCS8 encode RSA-{}: {}", bits, e))?;
        // Initial algo is SHA-256; callers override via rcgen_sign_algo
        KeyPair::from_der_and_sign_algo(pkcs8_der.as_bytes(), &PKCS_RSA_SHA256)
            .map_err(|e| format!("KeyPair from RSA-{}: {}", bits, e))
    }

    // -----------------------------------------------------------------------
    // Distinguished name builder
    // -----------------------------------------------------------------------

    fn build_dn(
        cn: &str,
        org: &Option<String>,
        ou: &Option<String>,
        country: &Option<String>,
        state: &Option<String>,
        locality: &Option<String>,
    ) -> DistinguishedName {
        let mut dn = DistinguishedName::new();
        dn.push(DnType::CommonName, cn);
        if let Some(o) = org {
            dn.push(DnType::OrganizationName, o.as_str());
        }
        if let Some(u) = ou {
            dn.push(DnType::OrganizationalUnitName, u.as_str());
        }
        if let Some(c) = country {
            dn.push(DnType::CountryName, c.as_str());
        }
        if let Some(s) = state {
            dn.push(DnType::StateOrProvinceName, s.as_str());
        }
        if let Some(l) = locality {
            dn.push(DnType::LocalityName, l.as_str());
        }
        dn
    }

    // -----------------------------------------------------------------------
    // Certificate params builder
    // -----------------------------------------------------------------------

    fn build_cert_params(params: &CertGenParams, key_pair: KeyPair) -> CertificateParams {
        // Collect DNS SANs for the constructor
        let san_strings: Vec<String> = params.san_dns.clone();
        let mut cp = CertificateParams::new(san_strings);

        cp.distinguished_name = Self::build_dn(
            &params.common_name,
            &params.organization,
            &params.organizational_unit,
            &params.country,
            &params.state,
            &params.locality,
        );

        // Validity
        let now = OffsetDateTime::now_utc();
        cp.not_before = now;
        cp.not_after = now + Duration::days(params.validity_days as i64);

        // Add IP and email SANs (DNS already added via constructor)
        for ip in &params.san_ips {
            if let Ok(addr) = ip.parse::<std::net::IpAddr>() {
                cp.subject_alt_names.push(SanType::IpAddress(addr));
            }
        }
        for email in &params.san_emails {
            cp.subject_alt_names
                .push(SanType::Rfc822Name(email.clone()));
        }

        // Key usages & extended key usages based on profile
        match params.profile {
            CertProfile::Ca => {
                cp.is_ca = IsCa::Ca(BasicConstraints::Constrained(
                    params.path_length.unwrap_or(0),
                ));
                cp.key_usages = vec![
                    KeyUsagePurpose::KeyCertSign,
                    KeyUsagePurpose::CrlSign,
                    KeyUsagePurpose::DigitalSignature,
                ];
            }
            CertProfile::IntermediateCa => {
                // Intermediate CA: must have a path-length constraint (≥0).
                cp.is_ca = IsCa::Ca(BasicConstraints::Constrained(
                    params.path_length.unwrap_or(0),
                ));
                cp.key_usages = vec![
                    KeyUsagePurpose::KeyCertSign,
                    KeyUsagePurpose::CrlSign,
                    KeyUsagePurpose::DigitalSignature,
                ];
            }
            CertProfile::TlsServer => {
                cp.is_ca = IsCa::NoCa;
                cp.key_usages = vec![
                    KeyUsagePurpose::DigitalSignature,
                    KeyUsagePurpose::KeyEncipherment,
                ];
                cp.extended_key_usages = vec![ExtendedKeyUsagePurpose::ServerAuth];
            }
            CertProfile::TlsClient => {
                cp.is_ca = IsCa::NoCa;
                cp.key_usages = vec![
                    KeyUsagePurpose::DigitalSignature,
                    KeyUsagePurpose::KeyEncipherment,
                ];
                cp.extended_key_usages = vec![ExtendedKeyUsagePurpose::ClientAuth];
            }
            CertProfile::TlsDual => {
                cp.is_ca = IsCa::NoCa;
                cp.key_usages = vec![
                    KeyUsagePurpose::DigitalSignature,
                    KeyUsagePurpose::KeyEncipherment,
                ];
                cp.extended_key_usages = vec![
                    ExtendedKeyUsagePurpose::ServerAuth,
                    ExtendedKeyUsagePurpose::ClientAuth,
                ];
            }
            CertProfile::CodeSigning => {
                cp.is_ca = IsCa::NoCa;
                cp.key_usages = vec![KeyUsagePurpose::DigitalSignature];
                cp.extended_key_usages = vec![ExtendedKeyUsagePurpose::CodeSigning];
            }
            CertProfile::Email => {
                cp.is_ca = IsCa::NoCa;
                cp.key_usages = vec![
                    KeyUsagePurpose::DigitalSignature,
                    KeyUsagePurpose::KeyEncipherment,
                ];
                cp.extended_key_usages = vec![ExtendedKeyUsagePurpose::EmailProtection];
            }
            CertProfile::TimestampAuthority => {
                cp.is_ca = IsCa::NoCa;
                cp.key_usages = vec![KeyUsagePurpose::DigitalSignature];
                cp.extended_key_usages = vec![ExtendedKeyUsagePurpose::TimeStamping];
            }
            CertProfile::OcspSigning => {
                cp.is_ca = IsCa::NoCa;
                cp.key_usages = vec![KeyUsagePurpose::DigitalSignature];
                cp.extended_key_usages = vec![ExtendedKeyUsagePurpose::OcspSigning];
            }
            CertProfile::DocumentSigning => {
                cp.is_ca = IsCa::NoCa;
                cp.key_usages = vec![
                    KeyUsagePurpose::DigitalSignature,
                    KeyUsagePurpose::ContentCommitment,
                ];
                cp.extended_key_usages = vec![ExtendedKeyUsagePurpose::CodeSigning];
            }
            CertProfile::VpnServer => {
                cp.is_ca = IsCa::NoCa;
                cp.key_usages = vec![
                    KeyUsagePurpose::DigitalSignature,
                    KeyUsagePurpose::KeyEncipherment,
                ];
                cp.extended_key_usages = vec![
                    ExtendedKeyUsagePurpose::ServerAuth,
                    // 1.3.6.1.5.5.8.2.2 — IPsec Tunnel
                    ExtendedKeyUsagePurpose::Any,
                ];
            }
            CertProfile::VpnClient => {
                cp.is_ca = IsCa::NoCa;
                cp.key_usages = vec![
                    KeyUsagePurpose::DigitalSignature,
                    KeyUsagePurpose::KeyEncipherment,
                ];
                cp.extended_key_usages = vec![
                    ExtendedKeyUsagePurpose::ClientAuth,
                    ExtendedKeyUsagePurpose::Any,
                ];
            }
            CertProfile::AnyPurpose => {
                cp.is_ca = IsCa::NoCa;
                cp.key_usages = vec![
                    KeyUsagePurpose::DigitalSignature,
                    KeyUsagePurpose::KeyEncipherment,
                ];
                cp.extended_key_usages = vec![ExtendedKeyUsagePurpose::Any];
            }
            CertProfile::SshCa => {
                // SSH CA: acts as a CA but with minimal X.509 constraints.
                cp.is_ca = IsCa::Ca(BasicConstraints::Unconstrained);
                cp.key_usages = vec![
                    KeyUsagePurpose::KeyCertSign,
                    KeyUsagePurpose::DigitalSignature,
                ];
            }
        }

        // Algorithm selection — uses the combined algo+hash helper
        cp.alg = Self::rcgen_sign_algo(&params.algorithm, &params.signature_hash);

        cp.key_pair = Some(key_pair);

        // Generate serial number
        let mut serial = [0u8; 16];
        rand::RngCore::fill_bytes(&mut rand::thread_rng(), &mut serial);
        serial[0] &= 0x7F; // Ensure positive
        cp.serial_number = Some(serial.to_vec().into());

        cp
    }

    // -----------------------------------------------------------------------
    // Fingerprint helper
    // -----------------------------------------------------------------------

    fn fingerprint_of_pem(cert_pem: &str) -> String {
        let b64: String = cert_pem
            .lines()
            .filter(|l| !l.starts_with("-----"))
            .collect::<Vec<_>>()
            .join("");
        if let Ok(der) = base64::engine::general_purpose::STANDARD.decode(b64.as_bytes()) {
            let mut hasher = Sha256::new();
            hasher.update(&der);
            return hex::encode(hasher.finalize());
        }
        String::new()
    }

    fn san_list(params: &CertGenParams) -> Vec<String> {
        let mut list = Vec::new();
        for d in &params.san_dns {
            list.push(format!("DNS:{}", d));
        }
        for i in &params.san_ips {
            list.push(format!("IP:{}", i));
        }
        for e in &params.san_emails {
            list.push(format!("email:{}", e));
        }
        list
    }

    // -----------------------------------------------------------------------
    // Public API: Generate self-signed certificate
    // -----------------------------------------------------------------------

    pub async fn generate_self_signed(
        &mut self,
        params: CertGenParams,
    ) -> Result<GeneratedCert, String> {
        let key_pair = Self::generate_key_pair(&params.algorithm)?;
        let cert_params = Self::build_cert_params(&params, key_pair);

        let not_before_str = cert_params
            .not_before
            .format(&time::format_description::well_known::Rfc3339)
            .map_err(|e| format!("Format not_before: {}", e))?;
        let not_after_str = cert_params
            .not_after
            .format(&time::format_description::well_known::Rfc3339)
            .map_err(|e| format!("Format not_after: {}", e))?;

        let cert = Certificate::from_params(cert_params)
            .map_err(|e| format!("Certificate creation: {}", e))?;

        let cert_pem = cert
            .serialize_pem()
            .map_err(|e| format!("PEM serialize: {}", e))?;
        let key_pem = cert.serialize_private_key_pem();
        let fingerprint = Self::fingerprint_of_pem(&cert_pem);
        let is_ca = matches!(
            params.profile,
            CertProfile::Ca | CertProfile::IntermediateCa | CertProfile::SshCa
        );

        let id = uuid::Uuid::new_v4().to_string();
        let now = Utc::now().to_rfc3339();

        let generated = GeneratedCert {
            id: id.clone(),
            cert_pem,
            key_pem,
            fingerprint,
            common_name: params.common_name.clone(),
            profile: params.profile.clone(),
            algorithm: params.algorithm.clone(),
            signature_hash: params.signature_hash.clone(),
            not_before: not_before_str,
            not_after: not_after_str,
            issuer: params.common_name.clone(),
            serial: String::new(),
            is_ca,
            san: Self::san_list(&params),
            signed_by: None,
            created_at: now,
        };

        self.store.certs.insert(
            id.clone(),
            CertStoreEntry {
                cert: generated.clone(),
                label: None,
                tags: vec![],
            },
        );
        self.persist()?;

        Ok(generated)
    }

    // -----------------------------------------------------------------------
    // Public API: Generate CA certificate
    // -----------------------------------------------------------------------

    pub async fn generate_ca(&mut self, params: CertGenParams) -> Result<GeneratedCert, String> {
        let mut ca_params = params;
        ca_params.profile = CertProfile::Ca;
        self.generate_self_signed(ca_params).await
    }

    // -----------------------------------------------------------------------
    // Public API: Generate CSR
    // -----------------------------------------------------------------------

    pub async fn generate_csr(&mut self, params: CsrGenParams) -> Result<GeneratedCsr, String> {
        let key_pair = Self::generate_key_pair(&params.algorithm)?;

        let san_strings: Vec<String> = params.san_dns.clone();
        let mut cp = CertificateParams::new(san_strings);

        cp.distinguished_name = Self::build_dn(
            &params.common_name,
            &params.organization,
            &params.organizational_unit,
            &params.country,
            &params.state,
            &params.locality,
        );

        for ip in &params.san_ips {
            if let Ok(addr) = ip.parse::<std::net::IpAddr>() {
                cp.subject_alt_names.push(SanType::IpAddress(addr));
            }
        }
        for email in &params.san_emails {
            cp.subject_alt_names
                .push(SanType::Rfc822Name(email.clone()));
        }

        match params.algorithm {
            KeyAlgorithm::Rsa2048 | KeyAlgorithm::Rsa3072 | KeyAlgorithm::Rsa4096
            | KeyAlgorithm::Rsa8192 => {
                cp.alg = Self::rcgen_sign_algo(&params.algorithm, &params.signature_hash);
            }
            KeyAlgorithm::EcdsaP256 => {
                cp.alg = &PKCS_ECDSA_P256_SHA256;
            }
            KeyAlgorithm::EcdsaP384 => {
                cp.alg = &PKCS_ECDSA_P384_SHA384;
            }
            KeyAlgorithm::Ed25519 => {
                cp.alg = &PKCS_ED25519;
            }
        }

        cp.key_pair = Some(key_pair);

        let cert =
            Certificate::from_params(cp).map_err(|e| format!("CSR cert creation: {}", e))?;
        let csr_pem = cert
            .serialize_request_pem()
            .map_err(|e| format!("CSR PEM: {}", e))?;
        let key_pem = cert.serialize_private_key_pem();

        let mut san_list = Vec::new();
        for d in &params.san_dns {
            san_list.push(format!("DNS:{}", d));
        }
        for i in &params.san_ips {
            san_list.push(format!("IP:{}", i));
        }
        for e in &params.san_emails {
            san_list.push(format!("email:{}", e));
        }

        let id = uuid::Uuid::new_v4().to_string();
        let generated = GeneratedCsr {
            id: id.clone(),
            csr_pem,
            key_pem,
            common_name: params.common_name.clone(),
            algorithm: params.algorithm.clone(),
            signature_hash: params.signature_hash.clone(),
            san: san_list,
            created_at: Utc::now().to_rfc3339(),
        };

        self.store.csrs.insert(
            id.clone(),
            CsrStoreEntry {
                csr: generated.clone(),
                label: None,
            },
        );
        self.persist()?;

        Ok(generated)
    }

    // -----------------------------------------------------------------------
    // Public API: Sign a CSR with a stored CA
    // -----------------------------------------------------------------------

    pub async fn sign_csr(&mut self, params: CsrSignParams) -> Result<GeneratedCert, String> {
        // Load the CA certificate and key
        let ca_entry = self
            .store
            .certs
            .get(&params.ca_id)
            .ok_or_else(|| format!("CA certificate '{}' not found", params.ca_id))?
            .clone();

        if !ca_entry.cert.is_ca {
            return Err("Selected certificate is not a CA".to_string());
        }

        // Rebuild the CA Certificate from stored PEM key
        let ca_key_pair = KeyPair::from_pem(&ca_entry.cert.key_pem)
            .map_err(|e| format!("Parse CA key: {}", e))?;

        let mut ca_cp = CertificateParams::new(vec![]);
        ca_cp.distinguished_name = {
            let mut dn = DistinguishedName::new();
            dn.push(DnType::CommonName, ca_entry.cert.common_name.as_str());
            dn
        };
        ca_cp.is_ca = IsCa::Ca(BasicConstraints::Unconstrained);
        ca_cp.key_usages = vec![
            KeyUsagePurpose::KeyCertSign,
            KeyUsagePurpose::CrlSign,
            KeyUsagePurpose::DigitalSignature,
        ];
        ca_cp.key_pair = Some(ca_key_pair);

        // Use the CA's stored algorithm + signature hash
        ca_cp.alg = Self::rcgen_sign_algo(
            &ca_entry.cert.algorithm,
            &ca_entry.cert.signature_hash,
        );

        let ca_cert =
            Certificate::from_params(ca_cp).map_err(|e| format!("Rebuild CA cert: {}", e))?;

        // Generate a new end-entity key pair (same algorithm as the CA for now)
        let ee_key_pair = Self::generate_key_pair(&ca_entry.cert.algorithm)?;

        let mut ee_cp = CertificateParams::new(vec![]);
        ee_cp.is_ca = IsCa::NoCa;

        // Set profile-based key usages
        match params.profile {
            CertProfile::TlsServer => {
                ee_cp.key_usages = vec![
                    KeyUsagePurpose::DigitalSignature,
                    KeyUsagePurpose::KeyEncipherment,
                ];
                ee_cp.extended_key_usages = vec![ExtendedKeyUsagePurpose::ServerAuth];
            }
            CertProfile::TlsClient => {
                ee_cp.key_usages = vec![
                    KeyUsagePurpose::DigitalSignature,
                    KeyUsagePurpose::KeyEncipherment,
                ];
                ee_cp.extended_key_usages = vec![ExtendedKeyUsagePurpose::ClientAuth];
            }
            CertProfile::TlsDual => {
                ee_cp.key_usages = vec![
                    KeyUsagePurpose::DigitalSignature,
                    KeyUsagePurpose::KeyEncipherment,
                ];
                ee_cp.extended_key_usages = vec![
                    ExtendedKeyUsagePurpose::ServerAuth,
                    ExtendedKeyUsagePurpose::ClientAuth,
                ];
            }
            CertProfile::CodeSigning => {
                ee_cp.key_usages = vec![KeyUsagePurpose::DigitalSignature];
                ee_cp.extended_key_usages = vec![ExtendedKeyUsagePurpose::CodeSigning];
            }
            CertProfile::Email => {
                ee_cp.key_usages = vec![
                    KeyUsagePurpose::DigitalSignature,
                    KeyUsagePurpose::KeyEncipherment,
                ];
                ee_cp.extended_key_usages = vec![ExtendedKeyUsagePurpose::EmailProtection];
            }
            CertProfile::TimestampAuthority => {
                ee_cp.key_usages = vec![KeyUsagePurpose::DigitalSignature];
                ee_cp.extended_key_usages = vec![ExtendedKeyUsagePurpose::TimeStamping];
            }
            CertProfile::OcspSigning => {
                ee_cp.key_usages = vec![KeyUsagePurpose::DigitalSignature];
                ee_cp.extended_key_usages = vec![ExtendedKeyUsagePurpose::OcspSigning];
            }
            CertProfile::DocumentSigning => {
                ee_cp.key_usages = vec![
                    KeyUsagePurpose::DigitalSignature,
                    KeyUsagePurpose::ContentCommitment,
                ];
                ee_cp.extended_key_usages = vec![ExtendedKeyUsagePurpose::CodeSigning];
            }
            CertProfile::VpnServer => {
                ee_cp.key_usages = vec![
                    KeyUsagePurpose::DigitalSignature,
                    KeyUsagePurpose::KeyEncipherment,
                ];
                ee_cp.extended_key_usages = vec![
                    ExtendedKeyUsagePurpose::ServerAuth,
                    ExtendedKeyUsagePurpose::Any,
                ];
            }
            CertProfile::VpnClient => {
                ee_cp.key_usages = vec![
                    KeyUsagePurpose::DigitalSignature,
                    KeyUsagePurpose::KeyEncipherment,
                ];
                ee_cp.extended_key_usages = vec![
                    ExtendedKeyUsagePurpose::ClientAuth,
                    ExtendedKeyUsagePurpose::Any,
                ];
            }
            CertProfile::AnyPurpose => {
                ee_cp.key_usages = vec![
                    KeyUsagePurpose::DigitalSignature,
                    KeyUsagePurpose::KeyEncipherment,
                ];
                ee_cp.extended_key_usages = vec![ExtendedKeyUsagePurpose::Any];
            }
            _ => {
                // Ca, IntermediateCa, SshCa — shouldn't normally be issued
                // via sign_csr, but handle gracefully.
                ee_cp.key_usages = vec![KeyUsagePurpose::DigitalSignature];
            }
        }

        let now = OffsetDateTime::now_utc();
        ee_cp.not_before = now;
        ee_cp.not_after = now + Duration::days(params.validity_days as i64);
        ee_cp.key_pair = Some(ee_key_pair);

        // Inherit algorithm selection from the CA
        ee_cp.alg = Self::rcgen_sign_algo(
            &ca_entry.cert.algorithm,
            &ca_entry.cert.signature_hash,
        );

        let ee_cert =
            Certificate::from_params(ee_cp).map_err(|e| format!("EE cert creation: {}", e))?;

        let signed_pem = ee_cert
            .serialize_pem_with_signer(&ca_cert)
            .map_err(|e| format!("CSR signing: {}", e))?;
        let ee_key_pem = ee_cert.serialize_private_key_pem();

        let not_before_str = now
            .format(&time::format_description::well_known::Rfc3339)
            .unwrap_or_default();
        let not_after = now + Duration::days(params.validity_days as i64);
        let not_after_str = not_after
            .format(&time::format_description::well_known::Rfc3339)
            .unwrap_or_default();

        let fingerprint = Self::fingerprint_of_pem(&signed_pem);
        let id = uuid::Uuid::new_v4().to_string();

        let generated = GeneratedCert {
            id: id.clone(),
            cert_pem: signed_pem,
            key_pem: ee_key_pem,
            fingerprint,
            common_name: String::from("(CA-issued)"),
            profile: params.profile.clone(),
            algorithm: ca_entry.cert.algorithm.clone(),
            signature_hash: ca_entry.cert.signature_hash.clone(),
            not_before: not_before_str,
            not_after: not_after_str,
            issuer: ca_entry.cert.common_name.clone(),
            serial: String::new(),
            is_ca: false,
            san: vec![],
            signed_by: Some(ca_entry.cert.id.clone()),
            created_at: Utc::now().to_rfc3339(),
        };

        self.store.certs.insert(
            id.clone(),
            CertStoreEntry {
                cert: generated.clone(),
                label: None,
                tags: vec![],
            },
        );
        self.persist()?;

        Ok(generated)
    }

    // -----------------------------------------------------------------------
    // Public API: Issue certificate signed by a CA (full params, not CSR)
    // -----------------------------------------------------------------------

    pub async fn issue_certificate(
        &mut self,
        params: CertGenParams,
        ca_id: String,
    ) -> Result<GeneratedCert, String> {
        let ca_entry = self
            .store
            .certs
            .get(&ca_id)
            .ok_or_else(|| format!("CA certificate '{}' not found", ca_id))?
            .clone();

        if !ca_entry.cert.is_ca {
            return Err("Selected certificate is not a CA".to_string());
        }

        // Rebuild the CA
        let ca_key_pair = KeyPair::from_pem(&ca_entry.cert.key_pem)
            .map_err(|e| format!("Parse CA key: {}", e))?;

        let mut ca_cp = CertificateParams::new(vec![]);
        ca_cp.distinguished_name = {
            let mut dn = DistinguishedName::new();
            dn.push(DnType::CommonName, ca_entry.cert.common_name.as_str());
            dn
        };
        ca_cp.is_ca = IsCa::Ca(BasicConstraints::Unconstrained);
        ca_cp.key_usages = vec![
            KeyUsagePurpose::KeyCertSign,
            KeyUsagePurpose::CrlSign,
            KeyUsagePurpose::DigitalSignature,
        ];
        ca_cp.key_pair = Some(ca_key_pair);

        ca_cp.alg = Self::rcgen_sign_algo(
            &ca_entry.cert.algorithm,
            &ca_entry.cert.signature_hash,
        );

        let ca_cert =
            Certificate::from_params(ca_cp).map_err(|e| format!("Rebuild CA: {}", e))?;

        // Build the end-entity certificate
        let ee_key_pair = Self::generate_key_pair(&params.algorithm)?;
        let ee_cp = Self::build_cert_params(&params, ee_key_pair);

        let not_before_str = ee_cp
            .not_before
            .format(&time::format_description::well_known::Rfc3339)
            .unwrap_or_default();
        let not_after_str = ee_cp
            .not_after
            .format(&time::format_description::well_known::Rfc3339)
            .unwrap_or_default();

        let ee_cert =
            Certificate::from_params(ee_cp).map_err(|e| format!("EE cert: {}", e))?;

        let cert_pem = ee_cert
            .serialize_pem_with_signer(&ca_cert)
            .map_err(|e| format!("Sign with CA: {}", e))?;
        let key_pem = ee_cert.serialize_private_key_pem();
        let fingerprint = Self::fingerprint_of_pem(&cert_pem);

        let id = uuid::Uuid::new_v4().to_string();
        let now_str = Utc::now().to_rfc3339();

        let generated = GeneratedCert {
            id: id.clone(),
            cert_pem,
            key_pem,
            fingerprint,
            common_name: params.common_name.clone(),
            profile: params.profile.clone(),
            algorithm: params.algorithm.clone(),
            signature_hash: params.signature_hash.clone(),
            not_before: not_before_str,
            not_after: not_after_str,
            issuer: ca_entry.cert.common_name.clone(),
            serial: String::new(),
            is_ca: matches!(
                params.profile,
                CertProfile::Ca | CertProfile::IntermediateCa | CertProfile::SshCa
            ),
            san: Self::san_list(&params),
            signed_by: Some(ca_id),
            created_at: now_str,
        };

        self.store.certs.insert(
            id.clone(),
            CertStoreEntry {
                cert: generated.clone(),
                label: None,
                tags: vec![],
            },
        );
        self.persist()?;

        Ok(generated)
    }

    // -----------------------------------------------------------------------
    // Public API: Export to PEM files
    // -----------------------------------------------------------------------

    pub async fn export_pem(
        &self,
        cert_id: &str,
        dir: &str,
    ) -> Result<(String, String), String> {
        let entry = self
            .store
            .certs
            .get(cert_id)
            .ok_or("Certificate not found")?;

        let safe_name = entry
            .cert
            .common_name
            .replace(|c: char| !c.is_alphanumeric() && c != '-' && c != '_', "_");
        let cert_path = Path::new(dir).join(format!("{}.crt", safe_name));
        let key_path = Path::new(dir).join(format!("{}.key", safe_name));

        fs::write(&cert_path, &entry.cert.cert_pem)
            .map_err(|e| format!("Write cert: {}", e))?;
        fs::write(&key_path, &entry.cert.key_pem)
            .map_err(|e| format!("Write key: {}", e))?;

        Ok((
            cert_path.to_string_lossy().to_string(),
            key_path.to_string_lossy().to_string(),
        ))
    }

    // -----------------------------------------------------------------------
    // Public API: Export to DER
    // -----------------------------------------------------------------------

    pub async fn export_der(&self, cert_id: &str, dir: &str) -> Result<String, String> {
        let entry = self
            .store
            .certs
            .get(cert_id)
            .ok_or("Certificate not found")?;

        let pem_data = pem::parse(&entry.cert.cert_pem)
            .map_err(|e| format!("PEM parse: {}", e))?;
        let safe_name = entry
            .cert
            .common_name
            .replace(|c: char| !c.is_alphanumeric() && c != '-' && c != '_', "_");
        let der_path = Path::new(dir).join(format!("{}.der", safe_name));
        fs::write(&der_path, pem_data.contents())
            .map_err(|e| format!("Write DER: {}", e))?;

        Ok(der_path.to_string_lossy().to_string())
    }

    // -----------------------------------------------------------------------
    // Public API: Export full chain PEM
    // -----------------------------------------------------------------------

    pub async fn export_chain_pem(&self, cert_id: &str, dir: &str) -> Result<String, String> {
        let chain = self.get_cert_chain(cert_id).await?;
        let mut full_pem = String::new();
        for c in &chain {
            full_pem.push_str(&c.cert_pem);
            full_pem.push('\n');
        }
        let safe_name = chain
            .first()
            .map(|c| c.common_name.clone())
            .unwrap_or_else(|| "chain".to_string())
            .replace(|c: char| !c.is_alphanumeric() && c != '-' && c != '_', "_");
        let chain_path = Path::new(dir).join(format!("{}-chain.crt", safe_name));
        fs::write(&chain_path, &full_pem).map_err(|e| format!("Write chain: {}", e))?;

        Ok(chain_path.to_string_lossy().to_string())
    }

    // -----------------------------------------------------------------------
    // Public API: List / Get / Delete
    // -----------------------------------------------------------------------

    pub async fn list_generated_certs(&self) -> Vec<GeneratedCert> {
        self.store
            .certs
            .values()
            .map(|e| {
                // Strip private key from listing for security
                let mut cert = e.cert.clone();
                cert.key_pem = String::new();
                cert
            })
            .collect()
    }

    pub async fn get_generated_cert(&self, id: &str) -> Result<GeneratedCert, String> {
        self.store
            .certs
            .get(id)
            .map(|e| e.cert.clone())
            .ok_or_else(|| "Certificate not found".to_string())
    }

    pub async fn delete_generated_cert(&mut self, id: &str) -> Result<(), String> {
        self.store
            .certs
            .remove(id)
            .ok_or_else(|| "Certificate not found".to_string())?;
        self.persist()
    }

    pub async fn list_generated_csrs(&self) -> Vec<GeneratedCsr> {
        self.store.csrs.values().map(|e| {
            let mut csr = e.csr.clone();
            csr.key_pem = String::new();
            csr
        }).collect()
    }

    pub async fn delete_generated_csr(&mut self, id: &str) -> Result<(), String> {
        self.store
            .csrs
            .remove(id)
            .ok_or_else(|| "CSR not found".to_string())?;
        self.persist()
    }

    pub async fn update_cert_label(
        &mut self,
        id: &str,
        label: Option<String>,
        tags: Option<Vec<String>>,
    ) -> Result<(), String> {
        let entry = self
            .store
            .certs
            .get_mut(id)
            .ok_or("Certificate not found")?;
        if let Some(l) = label {
            entry.label = Some(l);
        }
        if let Some(t) = tags {
            entry.tags = t;
        }
        self.persist()
    }

    /// Get certificate chain for a given cert (walks signed_by up to root).
    pub async fn get_cert_chain(&self, id: &str) -> Result<Vec<GeneratedCert>, String> {
        let mut chain = Vec::new();
        let mut current_id = id.to_string();

        loop {
            let entry = self
                .store
                .certs
                .get(&current_id)
                .ok_or_else(|| format!("Certificate '{}' not found in chain", current_id))?;
            chain.push(entry.cert.clone());

            match &entry.cert.signed_by {
                Some(parent_id) => current_id = parent_id.clone(),
                None => break,
            }

            // Safety: prevent infinite loops
            if chain.len() > 20 {
                return Err("Certificate chain too deep (possible cycle)".to_string());
            }
        }

        Ok(chain)
    }
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn cert_gen_self_signed(
    state: tauri::State<'_, CertGenServiceState>,
    params: CertGenParams,
) -> Result<GeneratedCert, String> {
    let mut svc = state.lock().await;
    svc.generate_self_signed(params).await
}

#[tauri::command]
pub async fn cert_gen_ca(
    state: tauri::State<'_, CertGenServiceState>,
    params: CertGenParams,
) -> Result<GeneratedCert, String> {
    let mut svc = state.lock().await;
    svc.generate_ca(params).await
}

#[tauri::command]
pub async fn cert_gen_csr(
    state: tauri::State<'_, CertGenServiceState>,
    params: CsrGenParams,
) -> Result<GeneratedCsr, String> {
    let mut svc = state.lock().await;
    svc.generate_csr(params).await
}

#[tauri::command]
pub async fn cert_sign_csr(
    state: tauri::State<'_, CertGenServiceState>,
    params: CsrSignParams,
) -> Result<GeneratedCert, String> {
    let mut svc = state.lock().await;
    svc.sign_csr(params).await
}

#[tauri::command]
pub async fn cert_gen_export_pem(
    state: tauri::State<'_, CertGenServiceState>,
    cert_id: String,
    dir: String,
) -> Result<(String, String), String> {
    let svc = state.lock().await;
    svc.export_pem(&cert_id, &dir).await
}

#[tauri::command]
pub async fn cert_gen_export_der(
    state: tauri::State<'_, CertGenServiceState>,
    cert_id: String,
    dir: String,
) -> Result<String, String> {
    let svc = state.lock().await;
    svc.export_der(&cert_id, &dir).await
}

#[tauri::command]
pub async fn cert_gen_list(
    state: tauri::State<'_, CertGenServiceState>,
) -> Result<Vec<GeneratedCert>, String> {
    let svc = state.lock().await;
    Ok(svc.list_generated_certs().await)
}

#[tauri::command]
pub async fn cert_gen_get(
    state: tauri::State<'_, CertGenServiceState>,
    id: String,
) -> Result<GeneratedCert, String> {
    let svc = state.lock().await;
    svc.get_generated_cert(&id).await
}

#[tauri::command]
pub async fn cert_gen_delete(
    state: tauri::State<'_, CertGenServiceState>,
    id: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.delete_generated_cert(&id).await
}

#[tauri::command]
pub async fn cert_gen_list_csrs(
    state: tauri::State<'_, CertGenServiceState>,
) -> Result<Vec<GeneratedCsr>, String> {
    let svc = state.lock().await;
    Ok(svc.list_generated_csrs().await)
}

#[tauri::command]
pub async fn cert_gen_delete_csr(
    state: tauri::State<'_, CertGenServiceState>,
    id: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.delete_generated_csr(&id).await
}

#[tauri::command]
pub async fn cert_gen_update_label(
    state: tauri::State<'_, CertGenServiceState>,
    id: String,
    label: Option<String>,
    tags: Option<Vec<String>>,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.update_cert_label(&id, label, tags).await
}

#[tauri::command]
pub async fn cert_gen_get_chain(
    state: tauri::State<'_, CertGenServiceState>,
    id: String,
) -> Result<Vec<GeneratedCert>, String> {
    let svc = state.lock().await;
    svc.get_cert_chain(&id).await
}

#[tauri::command]
pub async fn cert_gen_issue(
    state: tauri::State<'_, CertGenServiceState>,
    params: CertGenParams,
    ca_id: String,
) -> Result<GeneratedCert, String> {
    let mut svc = state.lock().await;
    svc.issue_certificate(params, ca_id).await
}

#[tauri::command]
pub async fn cert_gen_export_chain(
    state: tauri::State<'_, CertGenServiceState>,
    cert_id: String,
    dir: String,
) -> Result<String, String> {
    let svc = state.lock().await;
    svc.export_chain_pem(&cert_id, &dir).await
}
