//! Proxmox VE REST API HTTP client with ticket + API-token authentication.
//!
//! Communicates via `https://{host}:{port}/api2/json/...`.
//! Supports two auth flows:
//! 1. Password → POST /api2/json/access/ticket → Cookie + CSRFPreventionToken
//!    (with PVE 6 inline `otp`, the PVE 7+ `NeedTFA` challenge → `tfa-challenge`
//!    second step, and age-based / 401-driven ticket renewal)
//! 2. API Token → PVEAPIToken=<tokenid>=<secret> header (never renewed)
//!
//! Also hosts [`probe_certificate`], a credential-free TLS handshake that
//! reports the server's leaf certificate for trust-on-first-use prompts.

use crate::error::{ProxmoxError, ProxmoxErrorKind, ProxmoxResult};
use crate::types::{
    ProxmoxAuthMethod, ProxmoxCertificateProbe, ProxmoxConfig, ProxmoxTicket, PveResponse,
};

use reqwest::{Client, Response, StatusCode};
use rustls::client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier};
use rustls::client::WebPkiServerVerifier;
use rustls::pki_types::{CertificateDer, ServerName, UnixTime};
use rustls::{DigitallySignedStruct, SignatureScheme};
use serde::de::DeserializeOwned;
use sha2::{Digest, Sha256};
use std::sync::{Arc, RwLock};
use std::time::{Duration, Instant};

const MAX_RESPONSE_BYTES: usize = 8 * 1024 * 1024;
const MAX_METADATA_RESPONSE_BYTES: usize = 256 * 1024;
const MAX_TIMEOUT_SECS: u64 = 300;
const MAX_FINGERPRINT_INPUT_BYTES: usize = 256;
const MAX_LOGIN_IDENTITY_BYTES: usize = 512;
const MAX_TFA_CODE_BYTES: usize = 256;
const MAX_TOTP_SECRET_BYTES: usize = 512;
const PROBE_TIMEOUT: Duration = Duration::from_secs(15);
/// PVE tickets are valid for 2 h; renew well before that.
pub const TICKET_RENEWAL_AFTER: Duration = Duration::from_secs(90 * 60);

#[derive(Debug)]
pub(crate) struct PinnedCertificateVerifier {
    expected_sha256: [u8; 32],
    signature_verifier: Arc<WebPkiServerVerifier>,
}

impl PinnedCertificateVerifier {
    pub(crate) fn new(expected_sha256: [u8; 32]) -> ProxmoxResult<Self> {
        let mut roots = rustls::RootCertStore::empty();
        for certificate in rustls_native_certs::load_native_certs().certs {
            let _ = roots.add(certificate);
        }
        let signature_verifier = WebPkiServerVerifier::builder_with_provider(
            Arc::new(roots),
            Arc::new(rustls::crypto::ring::default_provider()),
        )
        .build()
        .map_err(|_| {
            ProxmoxError::connection("Failed to initialize Proxmox TLS signature verification")
        })?;
        Ok(Self {
            expected_sha256,
            signature_verifier,
        })
    }
}

impl ServerCertVerifier for PinnedCertificateVerifier {
    fn verify_server_cert(
        &self,
        end_entity: &CertificateDer<'_>,
        _intermediates: &[CertificateDer<'_>],
        _server_name: &ServerName<'_>,
        _ocsp_response: &[u8],
        _now: UnixTime,
    ) -> Result<ServerCertVerified, rustls::Error> {
        verify_certificate_pin(end_entity.as_ref(), &self.expected_sha256)?;
        Ok(ServerCertVerified::assertion())
    }

    fn verify_tls12_signature(
        &self,
        message: &[u8],
        certificate: &CertificateDer<'_>,
        signature: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        self.signature_verifier
            .verify_tls12_signature(message, certificate, signature)
    }

    fn verify_tls13_signature(
        &self,
        message: &[u8],
        certificate: &CertificateDer<'_>,
        signature: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        self.signature_verifier
            .verify_tls13_signature(message, certificate, signature)
    }

    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        self.signature_verifier.supported_verify_schemes()
    }
}

pub(crate) fn normalize_sha256_fingerprint(value: Option<&str>) -> ProxmoxResult<Option<[u8; 32]>> {
    let Some(value) = value.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(None);
    };
    if value.len() > MAX_FINGERPRINT_INPUT_BYTES {
        return Err(ProxmoxError::connection(
            "Invalid Proxmox certificate fingerprint: input is too long",
        ));
    }
    let value = if value
        .get(..7)
        .is_some_and(|prefix| prefix.eq_ignore_ascii_case("sha256:"))
    {
        &value[7..]
    } else {
        value
    };
    let compact: String = value
        .chars()
        .filter(|character| *character != ':' && !character.is_ascii_whitespace())
        .collect();
    if compact.len() != 64 || !compact.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(ProxmoxError::connection(
            "Invalid Proxmox certificate fingerprint: expected exactly 64 SHA-256 hexadecimal digits",
        ));
    }
    let decoded = hex::decode(compact).map_err(|_| {
        ProxmoxError::connection(
            "Invalid Proxmox certificate fingerprint: expected hexadecimal SHA-256 bytes",
        )
    })?;
    let mut fingerprint = [0_u8; 32];
    fingerprint.copy_from_slice(&decoded);
    Ok(Some(fingerprint))
}

fn certificate_matches_pin(certificate_der: &[u8], expected_sha256: &[u8; 32]) -> bool {
    let actual: [u8; 32] = Sha256::digest(certificate_der).into();
    actual == *expected_sha256
}

fn verify_certificate_pin(
    certificate_der: &[u8],
    expected_sha256: &[u8; 32],
) -> Result<(), rustls::Error> {
    if certificate_matches_pin(certificate_der, expected_sha256) {
        Ok(())
    } else {
        Err(rustls::Error::General(
            "Proxmox TLS certificate fingerprint mismatch".to_string(),
        ))
    }
}

pub(crate) fn normalize_host(host: &str) -> ProxmoxResult<String> {
    let host = host.trim();
    if host.is_empty() || host.len() > 253 {
        return Err(ProxmoxError::connection("Invalid Proxmox host"));
    }
    // `url::Host::parse` needs IPv6 literals bracketed; accept both spellings.
    let candidate = if host.starts_with('[') || host.parse::<std::net::Ipv6Addr>().is_err() {
        host.to_string()
    } else {
        format!("[{host}]")
    };
    match url::Host::parse(&candidate)
        .map_err(|_| ProxmoxError::connection("Invalid Proxmox host"))?
    {
        url::Host::Ipv6(address) => Ok(format!("[{address}]")),
        parsed => Ok(parsed.to_string()),
    }
}

fn login_identity(username: &str, realm: &str) -> ProxmoxResult<String> {
    let username = username.trim();
    if username.is_empty()
        || username.len() > MAX_LOGIN_IDENTITY_BYTES
        || username.chars().any(char::is_control)
    {
        return Err(ProxmoxError::auth("Invalid Proxmox username"));
    }

    if let Some((account, explicit_realm)) = username.rsplit_once('@') {
        if account.is_empty() || explicit_realm.is_empty() {
            return Err(ProxmoxError::auth("Invalid Proxmox username"));
        }
        return Ok(username.to_string());
    }

    let realm = realm.trim();
    if realm.is_empty()
        || realm.len() > MAX_LOGIN_IDENTITY_BYTES
        || realm.chars().any(char::is_control)
    {
        return Err(ProxmoxError::auth("Invalid Proxmox authentication realm"));
    }
    Ok(format!("{username}@{realm}"))
}

fn ring_client_config_builder(
) -> ProxmoxResult<rustls::ConfigBuilder<rustls::ClientConfig, rustls::WantsVerifier>> {
    rustls::ClientConfig::builder_with_provider(Arc::new(rustls::crypto::ring::default_provider()))
        .with_safe_default_protocol_versions()
        .map_err(|_| ProxmoxError::connection("Failed to initialize Proxmox TLS configuration"))
}

/// Percent-decode a PVE TFA challenge payload (`%XX` escapes only).
fn percent_decode(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' && index + 3 <= bytes.len() {
            let hex_pair = std::str::from_utf8(&bytes[index + 1..index + 3]).unwrap_or("");
            if let Ok(value) = u8::from_str_radix(hex_pair, 16) {
                out.push(value);
                index += 3;
                continue;
            }
        }
        out.push(bytes[index]);
        index += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Extract the offered second-factor kinds from a PVE 7+ challenge ticket
/// (`PVE:!tfa!<urlencoded JSON>:<ts>::<sig>`). Unknown formats yield an empty list.
pub fn parse_tfa_challenge_types(challenge_ticket: &str) -> Vec<String> {
    let Some(payload) = challenge_ticket
        .split(':')
        .nth(1)
        .and_then(|segment| segment.strip_prefix("!tfa!"))
    else {
        return Vec::new();
    };
    let decoded = percent_decode(payload);
    let Ok(serde_json::Value::Object(map)) = serde_json::from_str::<serde_json::Value>(&decoded)
    else {
        return Vec::new();
    };
    let mut kinds: Vec<String> = map
        .into_iter()
        .filter(|(_, value)| match value {
            serde_json::Value::Bool(flag) => *flag,
            serde_json::Value::Null => false,
            serde_json::Value::Number(number) => number.as_f64().is_some_and(|n| n != 0.0),
            serde_json::Value::Array(items) => !items.is_empty(),
            _ => true,
        })
        .map(|(kind, _)| kind)
        .collect();
    kinds.sort();
    kinds
}

/// Generate the current RFC 6238 code for a base32 secret (SHA-1, 6 digits, 30 s —
/// the only parameters Proxmox VE issues).
pub fn totp_code_from_secret(secret_b32: &str) -> ProxmoxResult<String> {
    let secret: String = secret_b32
        .chars()
        .filter(|character| !character.is_ascii_whitespace() && *character != '-')
        .collect();
    if secret.is_empty() || secret.len() > MAX_TOTP_SECRET_BYTES {
        return Err(ProxmoxError::tfa("Invalid Proxmox TOTP secret"));
    }
    sorng_totp::totp::core::generate_totp(&secret, 6, 30, sorng_totp::totp::types::Algorithm::Sha1)
        .map_err(|_| ProxmoxError::tfa("Invalid Proxmox TOTP secret"))
}

/// Second-factor kinds accepted by `submit_tfa` (PVE 7+ `password` prefixes).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TfaKind {
    Totp,
    Recovery,
    Yubico,
}

impl TfaKind {
    pub fn parse(value: &str) -> Option<Self> {
        match value.trim().to_ascii_lowercase().as_str() {
            "totp" => Some(Self::Totp),
            "recovery" => Some(Self::Recovery),
            "yubico" => Some(Self::Yubico),
            _ => None,
        }
    }

    pub fn prefix(self) -> &'static str {
        match self {
            Self::Totp => "totp",
            Self::Recovery => "recovery",
            Self::Yubico => "yubico",
        }
    }
}

/// Outcome of the first authentication step.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LoginOutcome {
    Connected {
        username: String,
    },
    TfaRequired {
        username: String,
        tfa_types: Vec<String>,
    },
}

/// A stored PVE 7+ challenge awaiting the second factor.
#[derive(Debug, Clone)]
pub struct PendingTfa {
    pub challenge_ticket: String,
    pub username: String,
    pub tfa_types: Vec<String>,
}

#[derive(Debug, Default)]
struct SessionState {
    ticket: Option<ProxmoxTicket>,
    issued_at: Option<Instant>,
    /// Test hook: extra age added on top of `issued_at.elapsed()`.
    age_offset: Duration,
    pending_tfa: Option<PendingTfa>,
    /// Number of successful ticket renewals (observable for tests/diagnostics).
    renewals: u64,
}

#[derive(serde::Deserialize)]
struct TicketData {
    ticket: String,
    #[serde(default, alias = "CSRFPreventionToken")]
    csrf_token: Option<String>,
    username: String,
    #[serde(default, alias = "NeedTFA")]
    need_tfa: Option<serde_json::Value>,
}

impl TicketData {
    fn needs_tfa(&self) -> bool {
        match &self.need_tfa {
            None | Some(serde_json::Value::Null) => false,
            Some(serde_json::Value::Bool(flag)) => *flag,
            Some(serde_json::Value::Number(number)) => number.as_f64().is_some_and(|n| n != 0.0),
            Some(serde_json::Value::String(text)) => !(text.is_empty() || text == "0"),
            Some(_) => true,
        }
    }
}

/// Proxmox VE REST API client.
///
/// Ticket sessions live behind an `RwLock` so `&self` request paths can
/// transparently renew an ageing ticket (PVE tickets expire after 2 h; we
/// renew after [`TICKET_RENEWAL_AFTER`]) and retry once on a `401`.
/// API-token sessions never renew.
pub struct PveClient {
    client: Client,
    base_url: String,
    config: ProxmoxConfig,
    session: RwLock<SessionState>,
    api_token: Option<String>,
}

impl PveClient {
    /// Build a new client from config (does NOT authenticate yet).
    pub fn new(config: &ProxmoxConfig) -> ProxmoxResult<Self> {
        let fingerprint = normalize_sha256_fingerprint(config.fingerprint.as_deref())?;
        if config.insecure && fingerprint.is_none() {
            return Err(ProxmoxError::connection(
                "TLS certificate verification cannot be disabled without an exact SHA-256 certificate fingerprint",
            ));
        }
        if !config.insecure && fingerprint.is_some() {
            return Err(ProxmoxError::connection(
                "A Proxmox certificate fingerprint requires explicit self-signed certificate consent",
            ));
        }
        if config.port == 0 {
            return Err(ProxmoxError::connection("Invalid Proxmox port"));
        }
        if config.timeout_secs == 0 || config.timeout_secs > MAX_TIMEOUT_SECS {
            return Err(ProxmoxError::connection(
                "Invalid Proxmox timeout: expected 1 to 300 seconds",
            ));
        }
        let host = normalize_host(&config.host)?;
        let builder = Client::builder()
            .timeout(Duration::from_secs(config.timeout_secs))
            .redirect(reqwest::redirect::Policy::none())
            .cookie_store(true);
        let client = if let Some(expected_sha256) = fingerprint {
            let verifier = PinnedCertificateVerifier::new(expected_sha256)?;
            let tls = ring_client_config_builder()?
                .dangerous()
                .with_custom_certificate_verifier(Arc::new(verifier))
                .with_no_client_auth();
            builder.use_preconfigured_tls(tls).build()
        } else {
            builder.build()
        }
        .map_err(|_| ProxmoxError::connection("Failed to build Proxmox HTTP client"))?;

        let base_url = format!("https://{host}:{}", config.port);

        Ok(Self {
            client,
            base_url,
            config: config.clone(),
            session: RwLock::new(SessionState::default()),
            api_token: None,
        })
    }

    pub fn base_url(&self) -> &str {
        &self.base_url
    }
    pub fn config(&self) -> &ProxmoxConfig {
        &self.config
    }

    fn session_read(&self) -> std::sync::RwLockReadGuard<'_, SessionState> {
        self.session
            .read()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    fn session_write(&self) -> std::sync::RwLockWriteGuard<'_, SessionState> {
        self.session
            .write()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    pub fn is_connected(&self) -> bool {
        self.api_token.is_some() || self.session_read().ticket.is_some()
    }

    /// Snapshot of the active ticket (cloned; the live one may be renewed at any time).
    pub fn ticket(&self) -> Option<ProxmoxTicket> {
        self.session_read().ticket.clone()
    }

    /// True for password/ticket sessions (the only ones that renew).
    pub fn uses_ticket_session(&self) -> bool {
        self.api_token.is_none() && self.session_read().ticket.is_some()
    }

    /// The pending PVE 7+ challenge, if the first step returned `NeedTFA`.
    pub fn pending_tfa(&self) -> Option<PendingTfa> {
        self.session_read().pending_tfa.clone()
    }

    /// Number of successful ticket renewals since login.
    pub fn renewal_count(&self) -> u64 {
        self.session_read().renewals
    }

    /// Test/diagnostic hook: make the current ticket look `by` older than it is.
    pub fn debug_age_ticket(&self, by: Duration) {
        let mut session = self.session_write();
        session.age_offset = session.age_offset.saturating_add(by);
    }

    fn ticket_age(&self) -> Option<Duration> {
        let session = self.session_read();
        session
            .issued_at
            .map(|issued_at| issued_at.elapsed().saturating_add(session.age_offset))
    }

    // ── Authentication ──────────────────────────────────────────────

    /// Authenticate with the Proxmox VE server.
    ///
    /// Compatibility wrapper around [`Self::login_ex`]: a pending second
    /// factor surfaces as `ProxmoxErrorKind::TfaRequired` ("TFA_REQUIRED").
    pub async fn login(&mut self) -> ProxmoxResult<String> {
        match self.login_ex().await? {
            LoginOutcome::Connected { username } => Ok(username),
            LoginOutcome::TfaRequired { .. } => Err(ProxmoxError::tfa("TFA_REQUIRED")),
        }
    }

    /// Authenticate, reporting a PVE 7+ second-factor challenge instead of failing.
    pub async fn login_ex(&mut self) -> ProxmoxResult<LoginOutcome> {
        match self.config.auth.clone() {
            ProxmoxAuthMethod::Password {
                username,
                password,
                realm,
                otp,
                totp_secret,
            } => {
                let username = login_identity(&username, &realm)?;
                self.password_login(&username, &password, otp.as_deref(), totp_secret.as_deref())
                    .await
            }
            ProxmoxAuthMethod::ApiToken { token_id, secret } => {
                let token_header = format!("PVEAPIToken={token_id}={secret}");
                self.api_token = Some(token_header);
                // Validate by fetching version
                let _: serde_json::Value = self.get("/api2/json/version").await?;
                Ok(LoginOutcome::Connected { username: token_id })
            }
        }
    }

    /// First step of password auth (also used for the re-login fallback of renewal).
    async fn password_login(
        &self,
        username: &str,
        password: &str,
        otp: Option<&str>,
        totp_secret: Option<&str>,
    ) -> ProxmoxResult<LoginOutcome> {
        let mut params: Vec<(&str, String)> = vec![
            ("username", username.to_string()),
            ("password", password.to_string()),
        ];
        if let Some(otp_code) = otp.map(str::trim).filter(|code| !code.is_empty()) {
            // PVE 6 style inline OTP.
            params.push(("otp", otp_code.to_string()));
        }
        let data = self.post_ticket(&params).await?;

        if !data.needs_tfa() {
            self.store_ticket(&data, false);
            return Ok(LoginOutcome::Connected {
                username: data.username,
            });
        }

        let tfa_types = parse_tfa_challenge_types(&data.ticket);
        let pending = PendingTfa {
            challenge_ticket: data.ticket.clone(),
            username: data.username.clone(),
            tfa_types: tfa_types.clone(),
        };

        // Auto-complete with a stored TOTP secret, or with an explicit code
        // supplied for this attempt (PVE 7+ ignores the legacy `otp` field).
        let auto_code = match totp_secret
            .map(str::trim)
            .filter(|secret| !secret.is_empty())
        {
            Some(secret) => Some(totp_code_from_secret(secret)?),
            None => otp
                .map(str::trim)
                .filter(|code| !code.is_empty())
                .map(str::to_string),
        };
        if let Some(code) = auto_code {
            let data = self
                .complete_tfa_request(&pending, TfaKind::Totp, &code)
                .await?;
            self.store_ticket(&data, false);
            return Ok(LoginOutcome::Connected {
                username: data.username,
            });
        }

        {
            let mut session = self.session_write();
            session.ticket = None;
            session.issued_at = None;
            session.pending_tfa = Some(pending);
        }
        Ok(LoginOutcome::TfaRequired {
            username: data.username,
            tfa_types,
        })
    }

    /// Complete a pending PVE 7+ challenge with a second-factor code.
    ///
    /// On an invalid code the challenge stays pending so the user can retry.
    pub async fn submit_tfa(&self, kind: TfaKind, code: &str) -> ProxmoxResult<String> {
        let code = code.trim();
        if code.is_empty() || code.len() > MAX_TFA_CODE_BYTES || code.chars().any(char::is_control)
        {
            return Err(ProxmoxError::tfa("Invalid Proxmox second-factor code"));
        }
        let pending = self
            .pending_tfa()
            .ok_or_else(|| ProxmoxError::tfa("No Proxmox second-factor challenge is pending"))?;
        let data = self.complete_tfa_request(&pending, kind, code).await?;
        self.store_ticket(&data, false);
        Ok(data.username)
    }

    async fn complete_tfa_request(
        &self,
        pending: &PendingTfa,
        kind: TfaKind,
        code: &str,
    ) -> ProxmoxResult<TicketData> {
        let params: Vec<(&str, String)> = vec![
            ("username", pending.username.clone()),
            ("tfa-challenge", pending.challenge_ticket.clone()),
            ("password", format!("{}:{code}", kind.prefix())),
        ];
        let data = self
            .post_ticket(&params)
            .await
            .map_err(|error| match error.kind {
                ProxmoxErrorKind::AuthenticationError => {
                    ProxmoxError::tfa("Invalid Proxmox second-factor code")
                }
                _ => error,
            })?;
        if data.needs_tfa() {
            return Err(ProxmoxError::tfa("Proxmox rejected the second factor"));
        }
        Ok(data)
    }

    /// POST /access/ticket; `401` → auth error, other non-2xx → api error.
    async fn post_ticket(&self, params: &[(&str, String)]) -> ProxmoxResult<TicketData> {
        let url = format!("{}/api2/json/access/ticket", self.base_url);
        let resp = self
            .client
            .post(&url)
            .form(params)
            .send()
            .await
            .map_err(|_| ProxmoxError::connection("Proxmox login request failed"))?;

        if resp.status() == StatusCode::UNAUTHORIZED {
            return Err(ProxmoxError::auth("Invalid credentials"));
        }
        let status = resp.status();
        if !status.is_success() {
            return Err(ProxmoxError::api(
                status.as_u16(),
                format!("Login failed with HTTP {}", status.as_u16()),
            ));
        }
        let envelope: PveResponse<TicketData> =
            Self::parse_response(resp, MAX_METADATA_RESPONSE_BYTES).await?;
        Ok(envelope.data)
    }

    fn store_ticket(&self, data: &TicketData, renewed: bool) {
        let mut session = self.session_write();
        session.ticket = Some(ProxmoxTicket {
            ticket: data.ticket.clone(),
            csrf_token: data.csrf_token.clone().unwrap_or_default(),
            username: data.username.clone(),
            connected_at: chrono::Utc::now().to_rfc3339(),
        });
        session.issued_at = Some(Instant::now());
        session.age_offset = Duration::ZERO;
        session.pending_tfa = None;
        if renewed {
            session.renewals += 1;
        }
    }

    /// Renew the ticket: PVE accepts a still-valid ticket as the password.
    /// Falls back to a full re-login (with auto-TOTP when a secret is stored).
    pub async fn renew_ticket(&self) -> ProxmoxResult<()> {
        // API-token sessions carry no ticket and are never renewed. Checked first so
        // this holds even if a future caller reaches `renew_ticket` directly.
        if self.api_token.is_some() {
            return Ok(());
        }
        let current = self
            .ticket()
            .ok_or_else(|| ProxmoxError::auth("Not authenticated"))?;
        let params: Vec<(&str, String)> = vec![
            ("username", current.username.clone()),
            ("password", current.ticket.clone()),
        ];
        match self.post_ticket(&params).await {
            Ok(data) if !data.needs_tfa() => {
                self.store_ticket(&data, true);
                return Ok(());
            }
            Ok(_) => {}
            Err(error) if matches!(error.kind, ProxmoxErrorKind::AuthenticationError) => {}
            Err(error) => return Err(error),
        }
        // Ticket-as-password refused (expired ticket or hardened realm): re-login.
        let ProxmoxAuthMethod::Password {
            username,
            password,
            realm,
            totp_secret,
            ..
        } = &self.config.auth
        else {
            return Err(ProxmoxError::auth("Proxmox session expired — reconnect"));
        };
        let username = login_identity(username, realm)?;
        match self
            .password_login(&username, password, None, totp_secret.as_deref())
            .await
        {
            Ok(LoginOutcome::Connected { .. }) => {
                self.session_write().renewals += 1;
                Ok(())
            }
            Ok(LoginOutcome::TfaRequired { .. }) => {
                // Do not leave the session half-authenticated.
                let mut session = self.session_write();
                session.pending_tfa = None;
                session.ticket = None;
                session.issued_at = None;
                Err(ProxmoxError::auth("Proxmox session expired — reconnect"))
            }
            Err(error) => Err(error),
        }
    }

    /// Renew ahead of expiry; failures are logged, the request then relies on the 401 retry.
    async fn ensure_fresh_ticket(&self) {
        if !self.uses_ticket_session() {
            return;
        }
        if self
            .ticket_age()
            .is_some_and(|age| age >= TICKET_RENEWAL_AFTER)
        {
            if let Err(error) = self.renew_ticket().await {
                log::warn!("Proxmox ticket renewal failed: {error}");
            }
        }
    }

    /// Log out (invalidate ticket).
    pub async fn logout(&mut self) -> ProxmoxResult<()> {
        *self.session_write() = SessionState::default();
        self.api_token = None;
        Ok(())
    }

    /// Check if the session is still valid.
    pub async fn check_session(&self) -> ProxmoxResult<bool> {
        if !self.is_connected() {
            return Ok(false);
        }
        match self.get_raw("/api2/json/version").await {
            Ok(resp) => Ok(resp.status().is_success()),
            Err(_) => Ok(false),
        }
    }

    // ── HTTP helpers ────────────────────────────────────────────────

    fn auth_headers(
        &self,
        builder: reqwest::RequestBuilder,
    ) -> ProxmoxResult<reqwest::RequestBuilder> {
        if let Some(ref token) = self.api_token {
            Ok(builder.header("Authorization", token.as_str()))
        } else if let Some(ticket) = self.ticket() {
            Ok(builder
                .header("Cookie", format!("PVEAuthCookie={}", ticket.ticket))
                .header("CSRFPreventionToken", &ticket.csrf_token))
        } else {
            Err(ProxmoxError::auth("Not authenticated"))
        }
    }

    /// Send an authenticated request: pre-emptive renewal, then one renew+retry on `401`
    /// for ticket sessions.
    async fn send_authenticated(
        &self,
        builder: reqwest::RequestBuilder,
        failure: &'static str,
    ) -> ProxmoxResult<Response> {
        self.ensure_fresh_ticket().await;
        let retry = builder.try_clone();
        let resp = self
            .auth_headers(builder)?
            .send()
            .await
            .map_err(|_| ProxmoxError::connection(failure))?;
        if resp.status() != StatusCode::UNAUTHORIZED || !self.uses_ticket_session() {
            return Ok(resp);
        }
        let Some(retry) = retry else {
            return Ok(resp);
        };
        if let Err(error) = self.renew_ticket().await {
            log::warn!("Proxmox ticket renewal after 401 failed: {error}");
            return Ok(resp);
        }
        self.auth_headers(retry)?
            .send()
            .await
            .map_err(|_| ProxmoxError::connection(failure))
    }

    /// GET, returning parsed `PveResponse<T>.data`.
    pub async fn get<T: DeserializeOwned>(&self, path: &str) -> ProxmoxResult<T> {
        let resp = self.get_raw(path).await?;
        let resp = Self::check_status(resp).await?;
        let envelope: PveResponse<T> =
            Self::parse_response(resp, Self::response_limit(path)).await?;
        Ok(envelope.data)
    }

    /// GET raw Response.
    pub async fn get_raw(&self, path: &str) -> ProxmoxResult<Response> {
        let url = format!("{}{}", self.base_url, path);
        self.send_authenticated(self.client.get(&url), "Proxmox GET request failed")
            .await
    }

    /// GET with query parameters.
    pub async fn get_with_params<T: DeserializeOwned>(
        &self,
        path: &str,
        params: &[(&str, &str)],
    ) -> ProxmoxResult<T> {
        let url = format!("{}{}", self.base_url, path);
        let resp = self
            .send_authenticated(
                self.client.get(&url).query(params),
                "Proxmox GET request failed",
            )
            .await?;
        let resp = Self::check_status(resp).await?;
        let envelope: PveResponse<T> =
            Self::parse_response(resp, Self::response_limit(path)).await?;
        Ok(envelope.data)
    }

    /// POST with form body, returning the UPID (task ID) if applicable.
    pub async fn post_form<T: DeserializeOwned>(
        &self,
        path: &str,
        params: &[(&str, &str)],
    ) -> ProxmoxResult<T> {
        let url = format!("{}{}", self.base_url, path);
        let resp = self
            .send_authenticated(
                self.client.post(&url).form(params),
                "Proxmox POST request failed",
            )
            .await?;
        let resp = Self::check_status(resp).await?;
        let envelope: PveResponse<T> = Self::parse_response(resp, MAX_RESPONSE_BYTES).await?;
        Ok(envelope.data)
    }

    /// POST with JSON body.
    pub async fn post_json<B: serde::Serialize, T: DeserializeOwned>(
        &self,
        path: &str,
        body: &B,
    ) -> ProxmoxResult<T> {
        let url = format!("{}{}", self.base_url, path);
        let resp = self
            .send_authenticated(
                self.client.post(&url).json(body),
                "Proxmox POST request failed",
            )
            .await?;
        let resp = Self::check_status(resp).await?;
        let envelope: PveResponse<T> = Self::parse_response(resp, MAX_RESPONSE_BYTES).await?;
        Ok(envelope.data)
    }

    /// POST with no body; discards result.
    pub async fn post_empty(&self, path: &str) -> ProxmoxResult<Option<String>> {
        let url = format!("{}{}", self.base_url, path);
        let resp = self
            .send_authenticated(self.client.post(&url), "Proxmox POST request failed")
            .await?;
        let resp = Self::check_status(resp).await?;
        let text = Self::read_text_limited(resp, MAX_METADATA_RESPONSE_BYTES).await?;
        if text.is_empty() {
            return Ok(None);
        }
        // Try to extract UPID from task response
        if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&text) {
            if let Some(upid) = parsed.get("data").and_then(|d| d.as_str()) {
                return Ok(Some(upid.to_string()));
            }
        }
        Ok(None)
    }

    /// PUT with form body.
    pub async fn put_form(&self, path: &str, params: &[(&str, &str)]) -> ProxmoxResult<()> {
        let url = format!("{}{}", self.base_url, path);
        let resp = self
            .send_authenticated(
                self.client.put(&url).form(params),
                "Proxmox PUT request failed",
            )
            .await?;
        Self::check_status(resp).await?;
        Ok(())
    }

    /// PUT with JSON body.
    pub async fn put_json<B: serde::Serialize>(&self, path: &str, body: &B) -> ProxmoxResult<()> {
        let url = format!("{}{}", self.base_url, path);
        let resp = self
            .send_authenticated(
                self.client.put(&url).json(body),
                "Proxmox PUT request failed",
            )
            .await?;
        Self::check_status(resp).await?;
        Ok(())
    }

    /// DELETE.
    pub async fn delete(&self, path: &str) -> ProxmoxResult<Option<String>> {
        let url = format!("{}{}", self.base_url, path);
        let resp = self
            .send_authenticated(self.client.delete(&url), "Proxmox DELETE request failed")
            .await?;
        let resp = Self::check_status(resp).await?;
        let text = Self::read_text_limited(resp, MAX_METADATA_RESPONSE_BYTES).await?;
        if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&text) {
            if let Some(upid) = parsed.get("data").and_then(|d| d.as_str()) {
                return Ok(Some(upid.to_string()));
            }
        }
        Ok(None)
    }

    // ── Internal ────────────────────────────────────────────────────

    async fn check_status(resp: Response) -> ProxmoxResult<Response> {
        let status = resp.status();
        if status.is_success() {
            return Ok(resp);
        }

        let code = status.as_u16();

        match status {
            StatusCode::UNAUTHORIZED => Err(ProxmoxError::auth("Session expired or invalid")),
            StatusCode::FORBIDDEN => Err(ProxmoxError::access_denied("Access denied")),
            StatusCode::NOT_FOUND => Err(ProxmoxError::not_found("Resource not found")),
            _ => Err(ProxmoxError::api(code, format!("API error {code}"))),
        }
    }

    fn response_limit(path: &str) -> usize {
        if path == "/api2/json/version" {
            MAX_METADATA_RESPONSE_BYTES
        } else {
            MAX_RESPONSE_BYTES
        }
    }

    async fn read_bytes_limited(mut resp: Response, limit: usize) -> ProxmoxResult<Vec<u8>> {
        let declared = resp.content_length();
        if declared.is_some_and(|size| size > limit as u64) {
            return Err(ProxmoxError::parse(format!(
                "Proxmox response rejected: declared body exceeds {limit} bytes"
            )));
        }
        let mut body = Vec::with_capacity(declared.unwrap_or(0).min(limit as u64) as usize);
        while let Some(chunk) = resp
            .chunk()
            .await
            .map_err(|_| ProxmoxError::parse("Failed to read Proxmox response body"))?
        {
            let next_len = body.len().checked_add(chunk.len()).ok_or_else(|| {
                ProxmoxError::parse("Proxmox response rejected: body size overflow")
            })?;
            if next_len > limit {
                return Err(ProxmoxError::parse(format!(
                    "Proxmox response rejected: streamed body exceeds {limit} bytes"
                )));
            }
            body.extend_from_slice(&chunk);
        }
        Ok(body)
    }

    async fn read_text_limited(resp: Response, limit: usize) -> ProxmoxResult<String> {
        let body = Self::read_bytes_limited(resp, limit).await?;
        String::from_utf8(body)
            .map_err(|_| ProxmoxError::parse("Proxmox response body is not valid UTF-8"))
    }

    fn json_parse_error(error: serde_json::Error) -> ProxmoxError {
        ProxmoxError::parse(format!(
            "Invalid Proxmox JSON response at line {}, column {}",
            error.line(),
            error.column()
        ))
    }

    async fn parse_response<T: DeserializeOwned>(resp: Response, limit: usize) -> ProxmoxResult<T> {
        let body = Self::read_bytes_limited(resp, limit).await?;
        if body.is_empty() {
            return serde_json::from_str("null").map_err(Self::json_parse_error);
        }

        serde_json::from_slice(&body).map_err(Self::json_parse_error)
    }
}

// ── Certificate probe ───────────────────────────────────────────────

/// Accepts any certificate so the handshake completes; the caller reads the
/// presented chain afterwards. Used **only** by [`probe_certificate`], which
/// never sends application data.
#[derive(Debug)]
struct CapturingVerifier {
    provider: Arc<rustls::crypto::CryptoProvider>,
}

impl ServerCertVerifier for CapturingVerifier {
    fn verify_server_cert(
        &self,
        _end_entity: &CertificateDer<'_>,
        _intermediates: &[CertificateDer<'_>],
        _server_name: &ServerName<'_>,
        _ocsp_response: &[u8],
        _now: UnixTime,
    ) -> Result<ServerCertVerified, rustls::Error> {
        Ok(ServerCertVerified::assertion())
    }

    fn verify_tls12_signature(
        &self,
        message: &[u8],
        certificate: &CertificateDer<'_>,
        signature: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        rustls::crypto::verify_tls12_signature(
            message,
            certificate,
            signature,
            &self.provider.signature_verification_algorithms,
        )
    }

    fn verify_tls13_signature(
        &self,
        message: &[u8],
        certificate: &CertificateDer<'_>,
        signature: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        rustls::crypto::verify_tls13_signature(
            message,
            certificate,
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

/// Format a DER certificate's SHA-256 as `AA:BB:…`.
pub fn format_sha256_fingerprint(certificate_der: &[u8]) -> String {
    let digest = Sha256::digest(certificate_der);
    digest
        .iter()
        .map(|byte| format!("{byte:02X}"))
        .collect::<Vec<_>>()
        .join(":")
}

/// Describe a DER-encoded leaf certificate (no network).
pub fn describe_certificate(certificate_der: &[u8]) -> ProxmoxResult<ProxmoxCertificateProbe> {
    let (_, certificate) = x509_parser::parse_x509_certificate(certificate_der)
        .map_err(|_| ProxmoxError::parse("Proxmox server presented an unparsable certificate"))?;
    let subject = certificate.subject().to_string();
    let issuer = certificate.issuer().to_string();
    let to_rfc3339 = |time: x509_parser::time::ASN1Time| {
        chrono::DateTime::<chrono::Utc>::from_timestamp(time.timestamp(), 0)
            .map(|value| value.to_rfc3339())
            .unwrap_or_default()
    };
    let mut subject_alt_names = Vec::new();
    if let Ok(Some(extension)) = certificate.subject_alternative_name() {
        for name in &extension.value.general_names {
            match name {
                x509_parser::extensions::GeneralName::DNSName(dns) => {
                    subject_alt_names.push(dns.to_string())
                }
                x509_parser::extensions::GeneralName::IPAddress(bytes) => {
                    let rendered = match bytes.len() {
                        4 => std::net::Ipv4Addr::new(bytes[0], bytes[1], bytes[2], bytes[3])
                            .to_string(),
                        16 => {
                            let mut octets = [0_u8; 16];
                            octets.copy_from_slice(bytes);
                            std::net::Ipv6Addr::from(octets).to_string()
                        }
                        _ => continue,
                    };
                    subject_alt_names.push(rendered);
                }
                _ => {}
            }
        }
    }
    Ok(ProxmoxCertificateProbe {
        sha256: format_sha256_fingerprint(certificate_der),
        self_signed: subject == issuer,
        subject,
        issuer,
        not_before: to_rfc3339(certificate.validity().not_before),
        not_after: to_rfc3339(certificate.validity().not_after),
        subject_alt_names,
    })
}

/// Open a bare TLS handshake to `host:port`, capture the leaf certificate and
/// close. **Sends no credentials and no HTTP request**; stores nothing.
pub async fn probe_certificate(host: &str, port: u16) -> ProxmoxResult<ProxmoxCertificateProbe> {
    if port == 0 {
        return Err(ProxmoxError::connection("Invalid Proxmox port"));
    }
    let host = normalize_host(host)?;
    let unbracketed = host
        .strip_prefix('[')
        .and_then(|value| value.strip_suffix(']'))
        .unwrap_or(&host)
        .to_string();
    let server_name = ServerName::try_from(unbracketed.clone())
        .map_err(|_| ProxmoxError::connection("Invalid Proxmox host"))?;
    let provider = Arc::new(rustls::crypto::ring::default_provider());
    let tls = rustls::ClientConfig::builder_with_provider(Arc::clone(&provider))
        .with_safe_default_protocol_versions()
        .map_err(|_| ProxmoxError::connection("Failed to initialize Proxmox TLS configuration"))?
        .dangerous()
        .with_custom_certificate_verifier(Arc::new(CapturingVerifier { provider }))
        .with_no_client_auth();
    let connector = tokio_rustls::TlsConnector::from(Arc::new(tls));

    let handshake = async {
        let tcp = tokio::net::TcpStream::connect((unbracketed.as_str(), port))
            .await
            .map_err(|_| ProxmoxError::connection("Proxmox host is unreachable"))?;
        let stream = connector
            .connect(server_name, tcp)
            .await
            .map_err(|_| ProxmoxError::connection("Proxmox TLS handshake failed"))?;
        let leaf = stream
            .get_ref()
            .1
            .peer_certificates()
            .and_then(|chain| chain.first())
            .map(|certificate| certificate.as_ref().to_vec())
            .ok_or_else(|| ProxmoxError::connection("Proxmox server presented no certificate"))?;
        Ok::<Vec<u8>, ProxmoxError>(leaf)
    };
    let leaf = tokio::time::timeout(PROBE_TIMEOUT, handshake)
        .await
        .map_err(|_| ProxmoxError::timeout("Proxmox certificate probe timed out"))??;
    describe_certificate(&leaf)
}

#[cfg(test)]
mod tests {
    use super::{
        login_identity, normalize_sha256_fingerprint, parse_tfa_challenge_types, percent_decode,
        totp_code_from_secret, verify_certificate_pin, TfaKind,
    };
    use sha2::{Digest, Sha256};

    #[test]
    fn normalized_valid_sha256_pin_is_accepted() {
        let certificate = b"proxmox-test-certificate";
        let digest = Sha256::digest(certificate);
        let plain = hex::encode(digest);
        let colon_delimited = plain
            .as_bytes()
            .chunks(2)
            .map(|chunk| std::str::from_utf8(chunk).unwrap())
            .collect::<Vec<_>>()
            .join(":")
            .to_uppercase();
        let formatted = format!("SHA256:{colon_delimited}");

        let normalized = normalize_sha256_fingerprint(Some(&formatted))
            .unwrap()
            .unwrap();
        assert!(verify_certificate_pin(certificate, &normalized).is_ok());
    }

    #[test]
    fn malformed_sha256_pins_are_rejected_without_echoing_input() {
        let malformed_pins = [
            "SHA256:abc".to_string(),
            "g".repeat(64),
            format!("SHA256:{}DO_NOT_ECHO", "ab".repeat(32)),
        ];

        for malformed_pin in malformed_pins {
            let error = normalize_sha256_fingerprint(Some(&malformed_pin)).unwrap_err();
            let rendered = error.to_string();
            assert!(rendered.contains("expected exactly 64 SHA-256 hexadecimal digits"));
            assert!(!rendered.contains(&malformed_pin));
            assert!(!rendered.contains("DO_NOT_ECHO"));
        }
    }

    #[test]
    fn certificate_pin_mismatch_fails_closed_with_opaque_error() {
        let certificate = b"private-certificate-material-do-not-echo";
        let expected = [0x5a; 32];
        let expected_hex = hex::encode(expected);
        let actual_hex = hex::encode(Sha256::digest(certificate));

        let error = verify_certificate_pin(certificate, &expected).unwrap_err();
        let rendered = error.to_string();

        assert_eq!(
            rendered,
            "unexpected error: Proxmox TLS certificate fingerprint mismatch"
        );
        assert!(!rendered.contains(&expected_hex));
        assert!(!rendered.contains(&actual_hex));
        assert!(!rendered.contains("private-certificate-material"));
    }

    #[test]
    fn normalize_host_accepts_names_and_ip_literals() {
        assert_eq!(super::normalize_host("pve.lab").unwrap(), "pve.lab");
        assert_eq!(super::normalize_host(" 10.0.0.5 ").unwrap(), "10.0.0.5");
        assert_eq!(super::normalize_host("::1").unwrap(), "[::1]");
        assert_eq!(super::normalize_host("[fe80::1]").unwrap(), "[fe80::1]");
        assert!(super::normalize_host("").is_err());
        assert!(super::normalize_host("bad host").is_err());
    }

    #[test]
    fn login_identity_does_not_duplicate_an_explicit_realm() {
        assert_eq!(login_identity("root@pam", "pam").unwrap(), "root@pam");
        assert_eq!(login_identity("root", "pam").unwrap(), "root@pam");
    }

    #[test]
    fn tfa_challenge_types_are_parsed_from_the_challenge_ticket() {
        let ticket = "PVE:!tfa!%7B%22totp%22%3Atrue%2C%22recovery%22%3Atrue%2C%22webauthn%22%3Anull%2C%22yubico%22%3Afalse%7D:6667ABCD::sig";
        assert_eq!(
            parse_tfa_challenge_types(ticket),
            vec!["recovery".to_string(), "totp".to_string()]
        );
        assert!(parse_tfa_challenge_types("PVE:root@pam:6667ABCD::sig").is_empty());
        assert!(parse_tfa_challenge_types("garbage").is_empty());
        assert_eq!(percent_decode("a%20b%zz%"), "a b%zz%");
    }

    #[test]
    fn tfa_kind_parses_known_prefixes_only() {
        assert_eq!(TfaKind::parse(" TOTP "), Some(TfaKind::Totp));
        assert_eq!(TfaKind::parse("recovery"), Some(TfaKind::Recovery));
        assert_eq!(
            TfaKind::parse("yubico").map(TfaKind::prefix),
            Some("yubico")
        );
        assert_eq!(TfaKind::parse("webauthn"), None);
    }

    #[test]
    fn totp_code_from_secret_generates_six_digits_and_rejects_garbage() {
        let code = totp_code_from_secret("JBSW Y3DP EHPK 3PXP").unwrap();
        assert_eq!(code.len(), 6);
        assert!(code.bytes().all(|byte| byte.is_ascii_digit()));
        assert!(totp_code_from_secret("").is_err());
        assert!(totp_code_from_secret("not base32 !!!").is_err());
    }
}
