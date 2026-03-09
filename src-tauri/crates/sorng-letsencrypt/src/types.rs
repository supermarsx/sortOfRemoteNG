//! # Let's Encrypt / ACME Types
//!
//! Core data types for the ACME protocol implementation, certificate management,
//! challenge handling, and service configuration.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// ── ACME Environments ───────────────────────────────────────────────

/// ACME directory URLs for well-known CAs.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum AcmeEnvironment {
    /// Let's Encrypt production — issues real trusted certificates.
    /// Rate-limited: 50 certs/domain/week, 5 duplicate certs/week.
    LetsEncryptProduction,
    /// Let's Encrypt staging — for testing.  Issues untrusted certs
    /// with much higher rate limits.
    LetsEncryptStaging,
    /// ZeroSSL production.
    ZeroSsl,
    /// Buypass Go production.
    BuypassGo,
    /// Buypass Go staging.
    BuypassGoStaging,
    /// Google Trust Services (public ACME).
    GoogleTrustServices,
    /// Custom ACME directory URL.
    Custom,
}

impl AcmeEnvironment {
    /// Return the ACME directory URL for this environment.
    pub fn directory_url(&self) -> &str {
        match self {
            Self::LetsEncryptProduction => "https://acme-v02.api.letsencrypt.org/directory",
            Self::LetsEncryptStaging => "https://acme-staging-v02.api.letsencrypt.org/directory",
            Self::ZeroSsl => "https://acme.zerossl.com/v2/DV90",
            Self::BuypassGo => "https://api.buypass.com/acme/directory",
            Self::BuypassGoStaging => "https://api.test4.buypass.no/acme/directory",
            Self::GoogleTrustServices => "https://dv.acme-v02.api.pki.goog/directory",
            Self::Custom => "",
        }
    }

    /// Human-readable name for display.
    pub fn display_name(&self) -> &str {
        match self {
            Self::LetsEncryptProduction => "Let's Encrypt (Production)",
            Self::LetsEncryptStaging => "Let's Encrypt (Staging)",
            Self::ZeroSsl => "ZeroSSL",
            Self::BuypassGo => "Buypass Go (Production)",
            Self::BuypassGoStaging => "Buypass Go (Staging)",
            Self::GoogleTrustServices => "Google Trust Services",
            Self::Custom => "Custom ACME CA",
        }
    }
}

// ── ACME Directory ──────────────────────────────────────────────────

/// RFC 8555 §7.1.1 — ACME directory object.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AcmeDirectory {
    /// URL to create a new nonce.
    #[serde(rename = "newNonce")]
    pub new_nonce: String,
    /// URL to create a new account.
    #[serde(rename = "newAccount")]
    pub new_account: String,
    /// URL to create a new order.
    #[serde(rename = "newOrder")]
    pub new_order: String,
    /// URL to revoke a certificate.
    #[serde(rename = "revokeCert")]
    pub revoke_cert: String,
    /// URL to trigger a key change.
    #[serde(rename = "keyChange")]
    pub key_change: String,
    /// Optional metadata about the CA.
    pub meta: Option<AcmeDirectoryMeta>,
}

/// CA metadata from the directory endpoint.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AcmeDirectoryMeta {
    /// Terms of service URL.
    #[serde(rename = "termsOfService")]
    pub terms_of_service: Option<String>,
    /// CA website.
    pub website: Option<String>,
    /// List of CAA identities.
    #[serde(rename = "caaIdentities")]
    pub caa_identities: Option<Vec<String>>,
    /// Whether external account binding is required.
    #[serde(rename = "externalAccountRequired")]
    pub external_account_required: Option<bool>,
}

// ── Account ─────────────────────────────────────────────────────────

/// Local representation of an ACME account.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AcmeAccount {
    /// Local unique ID.
    pub id: String,
    /// ACME environment this account is registered with.
    pub environment: AcmeEnvironment,
    /// Custom directory URL (only used when environment == Custom).
    pub custom_directory_url: Option<String>,
    /// Account URL returned by the CA after registration.
    pub account_url: Option<String>,
    /// Contact email addresses.
    pub contacts: Vec<String>,
    /// Account status.
    pub status: AcmeAccountStatus,
    /// When the account was created locally.
    pub created_at: DateTime<Utc>,
    /// The JWK thumbprint of the account key (base64url).
    pub key_thumbprint: String,
    /// Key algorithm used.
    pub key_algorithm: KeyAlgorithm,
    /// Whether terms of service were agreed.
    pub tos_agreed: bool,
    /// External Account Binding key ID (for CAs that require EAB).
    pub eab_key_id: Option<String>,
}

/// ACME account statuses per RFC 8555 §7.1.6.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum AcmeAccountStatus {
    Valid,
    Deactivated,
    Revoked,
}

/// Key algorithms used for ACME account and certificate keys.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum KeyAlgorithm {
    /// ECDSA with P-256 curve (recommended for account keys).
    EcdsaP256,
    /// ECDSA with P-384 curve.
    EcdsaP384,
    /// RSA 2048-bit (widely compatible).
    Rsa2048,
    /// RSA 3072-bit.
    Rsa3072,
    /// RSA 4096-bit.
    Rsa4096,
}

impl KeyAlgorithm {
    pub fn display_name(&self) -> &str {
        match self {
            Self::EcdsaP256 => "ECDSA P-256",
            Self::EcdsaP384 => "ECDSA P-384",
            Self::Rsa2048 => "RSA 2048",
            Self::Rsa3072 => "RSA 3072",
            Self::Rsa4096 => "RSA 4096",
        }
    }

    pub fn key_bits(&self) -> u32 {
        match self {
            Self::EcdsaP256 => 256,
            Self::EcdsaP384 => 384,
            Self::Rsa2048 => 2048,
            Self::Rsa3072 => 3072,
            Self::Rsa4096 => 4096,
        }
    }
}

// ── Orders ──────────────────────────────────────────────────────────

/// An ACME order representing a certificate request.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AcmeOrder {
    /// Local order ID.
    pub id: String,
    /// Account ID this order belongs to.
    pub account_id: String,
    /// The ACME order URL.
    pub order_url: Option<String>,
    /// Order status.
    pub status: OrderStatus,
    /// Requested domain identifiers.
    pub identifiers: Vec<AcmeIdentifier>,
    /// Authorization URLs.
    pub authorization_urls: Vec<String>,
    /// Finalize URL (for submitting the CSR).
    pub finalize_url: Option<String>,
    /// Certificate URL (available once issued).
    pub certificate_url: Option<String>,
    /// When the order was created.
    pub created_at: DateTime<Utc>,
    /// When the order expires.
    pub expires: Option<DateTime<Utc>>,
    /// When the certificate becomes valid.
    pub not_before: Option<DateTime<Utc>>,
    /// When the certificate expires.
    pub not_after: Option<DateTime<Utc>>,
    /// Optional error from the CA.
    pub error: Option<AcmeError>,
}

/// Order statuses per RFC 8555 §7.1.3.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum OrderStatus {
    /// Order created, authorizations pending.
    Pending,
    /// All authorizations satisfied, ready to finalize.
    Ready,
    /// CSR submitted, CA is processing.
    Processing,
    /// Certificate issued and available.
    Valid,
    /// Order failed or expired.
    Invalid,
}

/// RFC 8555 §9.7.7 — ACME identifier.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AcmeIdentifier {
    /// Identifier type ("dns" for domain names).
    #[serde(rename = "type")]
    pub id_type: String,
    /// The identifier value (e.g. "example.com" or "*.example.com").
    pub value: String,
}

// ── Authorizations ──────────────────────────────────────────────────

/// ACME authorization object.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AcmeAuthorization {
    /// The authorization URL.
    pub url: String,
    /// Authorization status.
    pub status: AuthorizationStatus,
    /// The identifier being authorized.
    pub identifier: AcmeIdentifier,
    /// Available challenges.
    pub challenges: Vec<AcmeChallenge>,
    /// Whether this is a wildcard authorization.
    pub wildcard: bool,
    /// When the authorization expires.
    pub expires: Option<DateTime<Utc>>,
}

/// Authorization statuses per RFC 8555 §7.1.4.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum AuthorizationStatus {
    Pending,
    Valid,
    Invalid,
    Deactivated,
    Expired,
    Revoked,
}

// ── Challenges ──────────────────────────────────────────────────────

/// An ACME challenge.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AcmeChallenge {
    /// Challenge URL.
    pub url: String,
    /// Challenge type.
    #[serde(rename = "type")]
    pub challenge_type: ChallengeType,
    /// Challenge status.
    pub status: ChallengeStatus,
    /// Challenge token (for HTTP-01 and DNS-01).
    pub token: String,
    /// Challenge validation URL.
    pub validated: Option<DateTime<Utc>>,
    /// Challenge error (if failed).
    pub error: Option<AcmeError>,
}

/// Supported ACME challenge types.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ChallengeType {
    /// HTTP-01: serve a file on port 80 at /.well-known/acme-challenge/<token>.
    #[serde(rename = "http-01")]
    Http01,
    /// DNS-01: create a TXT record at _acme-challenge.<domain>.
    #[serde(rename = "dns-01")]
    Dns01,
    /// TLS-ALPN-01: serve a self-signed cert with the acme-tls/1 ALPN on port 443.
    #[serde(rename = "tls-alpn-01")]
    TlsAlpn01,
}

impl ChallengeType {
    pub fn display_name(&self) -> &str {
        match self {
            Self::Http01 => "HTTP-01",
            Self::Dns01 => "DNS-01",
            Self::TlsAlpn01 => "TLS-ALPN-01",
        }
    }

    /// Whether this challenge type supports wildcard domains.
    pub fn supports_wildcard(&self) -> bool {
        matches!(self, Self::Dns01)
    }
}

/// Challenge statuses per RFC 8555 §7.1.5.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ChallengeStatus {
    Pending,
    Processing,
    Valid,
    Invalid,
}

// ── ACME Errors ─────────────────────────────────────────────────────

/// ACME error response (RFC 8555 §6.7 / RFC 7807).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AcmeError {
    /// Error type URI.
    #[serde(rename = "type")]
    pub error_type: String,
    /// Human-readable error description.
    pub detail: Option<String>,
    /// HTTP status code.
    pub status: Option<u16>,
    /// Sub-problems.
    pub subproblems: Option<Vec<AcmeSubproblem>>,
}

/// ACME sub-problem for per-identifier errors.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AcmeSubproblem {
    #[serde(rename = "type")]
    pub error_type: String,
    pub detail: Option<String>,
    pub identifier: Option<AcmeIdentifier>,
}

// ── Certificates ────────────────────────────────────────────────────

/// A managed certificate tracked by the service.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ManagedCertificate {
    /// Local unique ID.
    pub id: String,
    /// Account ID used to obtain this certificate.
    pub account_id: String,
    /// Primary domain (Subject CN).
    pub primary_domain: String,
    /// All domains covered (SAN).
    pub domains: Vec<String>,
    /// Certificate status.
    pub status: CertificateStatus,
    /// Key algorithm used for certificate key pair.
    pub key_algorithm: KeyAlgorithm,
    /// Path to the full-chain PEM certificate on disk.
    pub cert_pem_path: Option<String>,
    /// Path to the private key PEM on disk.
    pub key_pem_path: Option<String>,
    /// Path to the issuer (intermediate) certificate.
    pub issuer_pem_path: Option<String>,
    /// Certificate serial number (hex).
    pub serial: Option<String>,
    /// Issuer common name.
    pub issuer_cn: Option<String>,
    /// Not valid before.
    pub not_before: Option<DateTime<Utc>>,
    /// Not valid after.
    pub not_after: Option<DateTime<Utc>>,
    /// Days until expiration.
    pub days_until_expiry: Option<i64>,
    /// SHA-256 fingerprint of the certificate.
    pub fingerprint_sha256: Option<String>,
    /// The ACME order ID that produced this certificate.
    pub order_id: Option<String>,
    /// When this certificate was first obtained.
    pub obtained_at: Option<DateTime<Utc>>,
    /// When this certificate was last renewed.
    pub last_renewed_at: Option<DateTime<Utc>>,
    /// Number of times this certificate has been renewed.
    pub renewal_count: u32,
    /// Whether automatic renewal is enabled.
    pub auto_renew: bool,
    /// Preferred challenge type for renewal.
    pub preferred_challenge: ChallengeType,
    /// OCSP stapling data (DER, base64-encoded).
    pub ocsp_response: Option<String>,
    /// When the OCSP response was last fetched.
    pub ocsp_fetched_at: Option<DateTime<Utc>>,
    /// Additional metadata.
    pub metadata: HashMap<String, String>,
}

/// Certificate lifecycle status.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum CertificateStatus {
    /// Certificate is being requested / challenges in progress.
    Pending,
    /// Certificate is valid and active.
    Active,
    /// Certificate is nearing expiry and renewal is scheduled.
    RenewalScheduled,
    /// Renewal is currently in progress.
    Renewing,
    /// Certificate has expired.
    Expired,
    /// Certificate was revoked.
    Revoked,
    /// Certificate request failed.
    Failed,
}

// ── DNS Provider Configuration ──────────────────────────────────────

/// Configuration for a DNS provider used for DNS-01 challenges.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DnsProviderConfig {
    /// Provider identifier.
    pub provider: DnsProvider,
    /// API token / key.
    pub api_token: Option<String>,
    /// API key ID (for providers that use key + secret).
    pub api_key_id: Option<String>,
    /// API secret.
    pub api_secret: Option<String>,
    /// Zone ID (for Cloudflare).
    pub zone_id: Option<String>,
    /// Hosted zone ID (for Route 53).
    pub hosted_zone_id: Option<String>,
    /// AWS region (for Route 53).
    pub aws_region: Option<String>,
    /// Propagation timeout in seconds (how long to wait for DNS).
    pub propagation_timeout_secs: u64,
    /// Polling interval in seconds (how often to check DNS).
    pub polling_interval_secs: u64,
    /// TTL for DNS records.
    pub ttl: u32,
}

impl Default for DnsProviderConfig {
    fn default() -> Self {
        Self {
            provider: DnsProvider::Manual,
            api_token: None,
            api_key_id: None,
            api_secret: None,
            zone_id: None,
            hosted_zone_id: None,
            aws_region: None,
            propagation_timeout_secs: 120,
            polling_interval_secs: 5,
            ttl: 120,
        }
    }
}

/// Supported DNS providers for DNS-01 challenges.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum DnsProvider {
    /// Cloudflare DNS API.
    Cloudflare,
    /// AWS Route 53.
    Route53,
    /// DigitalOcean DNS.
    DigitalOcean,
    /// Google Cloud DNS.
    GoogleCloudDns,
    /// Azure DNS.
    AzureDns,
    /// Namecheap DNS.
    Namecheap,
    /// GoDaddy DNS.
    GoDaddy,
    /// OVH DNS.
    Ovh,
    /// Hetzner DNS.
    Hetzner,
    /// Linode DNS.
    Linode,
    /// Vultr DNS.
    Vultr,
    /// PowerDNS.
    PowerDns,
    /// RFC 2136 dynamic DNS update.
    Rfc2136,
    /// Manual — user creates TXT records themselves.
    Manual,
}

impl DnsProvider {
    pub fn display_name(&self) -> &str {
        match self {
            Self::Cloudflare => "Cloudflare",
            Self::Route53 => "AWS Route 53",
            Self::DigitalOcean => "DigitalOcean",
            Self::GoogleCloudDns => "Google Cloud DNS",
            Self::AzureDns => "Azure DNS",
            Self::Namecheap => "Namecheap",
            Self::GoDaddy => "GoDaddy",
            Self::Ovh => "OVH",
            Self::Hetzner => "Hetzner",
            Self::Linode => "Linode",
            Self::Vultr => "Vultr",
            Self::PowerDns => "PowerDNS",
            Self::Rfc2136 => "RFC 2136 (nsupdate)",
            Self::Manual => "Manual",
        }
    }

    /// Whether this provider supports automatic DNS record creation.
    pub fn is_automated(&self) -> bool {
        !matches!(self, Self::Manual)
    }
}

// ── Renewal Configuration ───────────────────────────────────────────

/// Configuration for the automatic renewal scheduler.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RenewalConfig {
    /// Whether automatic renewal is enabled globally.
    pub enabled: bool,
    /// Renew certificates this many days before expiry.
    pub renew_before_days: u32,
    /// How often the scheduler checks for renewals, in seconds.
    pub check_interval_secs: u64,
    /// Random jitter added to renewal timing (in seconds) to avoid
    /// thundering-herd effects when many certs expire together.
    pub jitter_secs: u64,
    /// Maximum retry attempts for a failed renewal.
    pub max_retries: u32,
    /// Back-off base interval between retries (in seconds).
    pub retry_backoff_secs: u64,
    /// Whether to send notifications on renewal events.
    pub notify_on_renewal: bool,
    /// Whether to send notifications on renewal failures.
    pub notify_on_failure: bool,
    /// Number of days before expiry to emit a warning.
    pub warning_threshold_days: u32,
    /// Number of days before expiry to emit a critical alert.
    pub critical_threshold_days: u32,
}

impl Default for RenewalConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            renew_before_days: 30,
            check_interval_secs: 3600, // 1 hour
            jitter_secs: 300,          // 5 minutes
            max_retries: 5,
            retry_backoff_secs: 600, // 10 minutes
            notify_on_renewal: true,
            notify_on_failure: true,
            warning_threshold_days: 30,
            critical_threshold_days: 7,
        }
    }
}

/// A scheduled or past renewal attempt.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RenewalAttempt {
    /// Unique attempt ID.
    pub id: String,
    /// Certificate ID being renewed.
    pub certificate_id: String,
    /// When the attempt was started.
    pub started_at: DateTime<Utc>,
    /// When the attempt completed.
    pub completed_at: Option<DateTime<Utc>>,
    /// Attempt result.
    pub result: RenewalResult,
    /// Error message (if failed).
    pub error: Option<String>,
    /// Retry number (0 = first attempt).
    pub retry_number: u32,
    /// New certificate ID (if successful).
    pub new_certificate_id: Option<String>,
}

/// Result of a renewal attempt.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum RenewalResult {
    /// Renewal succeeded.
    Success,
    /// Renewal failed, will retry.
    Failed,
    /// Renewal skipped (not yet due).
    Skipped,
    /// Renewal in progress.
    InProgress,
}

// ── OCSP ────────────────────────────────────────────────────────────

/// OCSP stapling information for a certificate.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OcspStatus {
    /// Certificate ID.
    pub certificate_id: String,
    /// OCSP response status.
    pub status: OcspCertStatus,
    /// When the response was produced by the OCSP responder.
    pub produced_at: Option<DateTime<Utc>>,
    /// When the status information is valid from.
    pub this_update: Option<DateTime<Utc>>,
    /// When the status information expires.
    pub next_update: Option<DateTime<Utc>>,
    /// OCSP responder URL.
    pub responder_url: Option<String>,
    /// Whether the stapled response is still fresh.
    pub is_fresh: bool,
}

/// OCSP certificate statuses.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum OcspCertStatus {
    Good,
    Revoked,
    Unknown,
}

// ── Rate Limiting ───────────────────────────────────────────────────

/// Tracks Let's Encrypt rate limits for a domain.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RateLimitInfo {
    /// Domain being tracked.
    pub domain: String,
    /// Number of certificates issued this week.
    pub certs_this_week: u32,
    /// Weekly limit.
    pub weekly_limit: u32,
    /// Duplicate certificate count this week.
    pub duplicates_this_week: u32,
    /// Duplicate limit.
    pub duplicate_limit: u32,
    /// Failed validation count this hour.
    pub failed_validations_this_hour: u32,
    /// Hourly failure limit.
    pub hourly_failure_limit: u32,
    /// When the current weekly window resets.
    pub weekly_reset: Option<DateTime<Utc>>,
    /// Whether issuance is currently blocked by rate limits.
    pub is_rate_limited: bool,
    /// Retry-After value from the last 429 response (seconds).
    pub retry_after_secs: Option<u64>,
}

// ── Service Configuration ───────────────────────────────────────────

/// Top-level configuration for the Let's Encrypt service.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LetsEncryptConfig {
    /// Whether the Let's Encrypt integration is enabled.
    pub enabled: bool,
    /// ACME environment (production, staging, etc.).
    pub environment: AcmeEnvironment,
    /// Custom ACME directory URL (when environment == Custom).
    pub custom_directory_url: Option<String>,
    /// Contact email for the account.
    pub contact_email: String,
    /// Additional contact emails.
    pub additional_contacts: Vec<String>,
    /// Agree to the CA's terms of service.
    pub agree_tos: bool,
    /// Key algorithm for account keys.
    pub account_key_algorithm: KeyAlgorithm,
    /// Key algorithm for certificate keys.
    pub certificate_key_algorithm: KeyAlgorithm,
    /// Preferred challenge type.
    pub preferred_challenge: ChallengeType,
    /// DNS provider config (for DNS-01 challenges).
    pub dns_provider: Option<DnsProviderConfig>,
    /// External Account Binding key ID (for CAs requiring EAB).
    pub eab_key_id: Option<String>,
    /// External Account Binding HMAC key (base64url).
    pub eab_hmac_key: Option<String>,
    /// HTTP-01 challenge settings.
    pub http_challenge: HttpChallengeConfig,
    /// Renewal settings.
    pub renewal: RenewalConfig,
    /// Storage directory for certificates and account data.
    pub storage_dir: String,
    /// Whether to enable OCSP stapling.
    pub ocsp_stapling: bool,
    /// OCSP cache refresh interval in seconds.
    pub ocsp_refresh_interval_secs: u64,
}

impl Default for LetsEncryptConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            environment: AcmeEnvironment::LetsEncryptStaging,
            custom_directory_url: None,
            contact_email: String::new(),
            additional_contacts: Vec::new(),
            agree_tos: false,
            account_key_algorithm: KeyAlgorithm::EcdsaP256,
            certificate_key_algorithm: KeyAlgorithm::EcdsaP256,
            preferred_challenge: ChallengeType::Http01,
            dns_provider: None,
            eab_key_id: None,
            eab_hmac_key: None,
            http_challenge: HttpChallengeConfig::default(),
            renewal: RenewalConfig::default(),
            storage_dir: "./letsencrypt".to_string(),
            ocsp_stapling: true,
            ocsp_refresh_interval_secs: 3600,
        }
    }
}

/// Configuration for the HTTP-01 challenge server.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HttpChallengeConfig {
    /// Whether to start a standalone HTTP server on port 80 for challenges.
    pub standalone_server: bool,
    /// Port to listen on for the standalone server.
    pub listen_port: u16,
    /// Bind address for the standalone server.
    pub listen_addr: String,
    /// Alternative: write challenge files to this directory for an external
    /// web server (e.g., nginx) to serve.
    pub webroot_path: Option<String>,
    /// Alternative: proxy challenge requests from the gateway's own HTTP
    /// listener to the internal challenge responder.
    pub proxy_from_gateway: bool,
}

impl Default for HttpChallengeConfig {
    fn default() -> Self {
        Self {
            standalone_server: true,
            listen_port: 80,
            listen_addr: "0.0.0.0".to_string(),
            webroot_path: None,
            proxy_from_gateway: false,
        }
    }
}

// ── Events / Notifications ──────────────────────────────────────────

/// Events emitted by the Let's Encrypt service.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum LetsEncryptEvent {
    /// A new certificate was successfully obtained.
    CertificateObtained {
        certificate_id: String,
        domains: Vec<String>,
    },
    /// A certificate was renewed successfully.
    CertificateRenewed {
        certificate_id: String,
        domains: Vec<String>,
        renewal_count: u32,
    },
    /// A certificate renewal failed.
    RenewalFailed {
        certificate_id: String,
        domains: Vec<String>,
        error: String,
        retry_number: u32,
    },
    /// A certificate is expiring soon (warning threshold).
    ExpiryWarning {
        certificate_id: String,
        domains: Vec<String>,
        days_remaining: i64,
    },
    /// A certificate is critically close to expiry.
    ExpiryCritical {
        certificate_id: String,
        domains: Vec<String>,
        days_remaining: i64,
    },
    /// A certificate has expired.
    CertificateExpired {
        certificate_id: String,
        domains: Vec<String>,
    },
    /// A certificate was revoked.
    CertificateRevoked {
        certificate_id: String,
        domains: Vec<String>,
    },
    /// OCSP status changed.
    OcspStatusChanged {
        certificate_id: String,
        new_status: OcspCertStatus,
    },
    /// HTTP-01 challenge server started.
    ChallengeServerStarted { port: u16 },
    /// HTTP-01 challenge server stopped.
    ChallengeServerStopped,
    /// Rate limit warning.
    RateLimitWarning { domain: String, remaining: u32 },
}

// ── Service State ───────────────────────────────────────────────────

/// Summary of the Let's Encrypt service state (for UI display).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LetsEncryptStatus {
    /// Whether the service is enabled and configured.
    pub enabled: bool,
    /// Whether the service is currently running.
    pub running: bool,
    /// ACME environment name.
    pub environment: String,
    /// Total managed certificates.
    pub total_certificates: u32,
    /// Active (valid) certificates.
    pub active_certificates: u32,
    /// Certificates needing renewal.
    pub pending_renewal: u32,
    /// Expired certificates.
    pub expired_certificates: u32,
    /// Recent events (last 20).
    pub recent_events: Vec<LetsEncryptEvent>,
    /// Next scheduled renewal check.
    pub next_renewal_check: Option<DateTime<Utc>>,
    /// HTTP challenge server status.
    pub challenge_server_running: bool,
}
