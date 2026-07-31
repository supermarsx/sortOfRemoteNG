//! Proxmox VE REST API HTTP client with ticket + API-token authentication.
//!
//! Communicates via `https://{host}:{port}/api2/json/...`.
//! Supports two auth flows:
//! 1. Password → POST /api2/json/access/ticket → Cookie + CSRFPreventionToken
//! 2. API Token → PVEAPIToken=<tokenid>=<secret> header

use crate::error::{ProxmoxError, ProxmoxResult};
use crate::types::{ProxmoxAuthMethod, ProxmoxConfig, ProxmoxTicket, PveResponse};

use reqwest::{Client, Response, StatusCode};
use rustls::client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier};
use rustls::client::WebPkiServerVerifier;
use rustls::pki_types::{CertificateDer, ServerName, UnixTime};
use rustls::{DigitallySignedStruct, SignatureScheme};
use serde::de::DeserializeOwned;
use sha2::{Digest, Sha256};
use std::{sync::Arc, time::Duration};

const MAX_RESPONSE_BYTES: usize = 8 * 1024 * 1024;
const MAX_METADATA_RESPONSE_BYTES: usize = 256 * 1024;
const MAX_TIMEOUT_SECS: u64 = 300;
const MAX_FINGERPRINT_INPUT_BYTES: usize = 256;
const MAX_LOGIN_IDENTITY_BYTES: usize = 512;

#[derive(Debug)]
struct PinnedCertificateVerifier {
    expected_sha256: [u8; 32],
    signature_verifier: Arc<WebPkiServerVerifier>,
}

impl PinnedCertificateVerifier {
    fn new(expected_sha256: [u8; 32]) -> ProxmoxResult<Self> {
        let mut roots = rustls::RootCertStore::empty();
        for certificate in rustls_native_certs::load_native_certs().certs {
            let _ = roots.add(certificate);
        }
        let signature_verifier = WebPkiServerVerifier::builder(Arc::new(roots))
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

fn normalize_sha256_fingerprint(value: Option<&str>) -> ProxmoxResult<Option<[u8; 32]>> {
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

fn normalize_host(host: &str) -> ProxmoxResult<String> {
    let host = host.trim();
    if host.is_empty() || host.len() > 253 {
        return Err(ProxmoxError::connection("Invalid Proxmox host"));
    }
    let unbracketed = host
        .strip_prefix('[')
        .and_then(|value| value.strip_suffix(']'))
        .unwrap_or(host);
    match url::Host::parse(unbracketed)
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

/// Proxmox VE REST API client.
pub struct PveClient {
    client: Client,
    base_url: String,
    config: ProxmoxConfig,
    ticket: Option<ProxmoxTicket>,
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
            let tls = rustls::ClientConfig::builder()
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
            ticket: None,
            api_token: None,
        })
    }

    pub fn base_url(&self) -> &str {
        &self.base_url
    }
    pub fn config(&self) -> &ProxmoxConfig {
        &self.config
    }

    pub fn is_connected(&self) -> bool {
        self.ticket.is_some() || self.api_token.is_some()
    }

    pub fn ticket(&self) -> Option<&ProxmoxTicket> {
        self.ticket.as_ref()
    }

    // ── Authentication ──────────────────────────────────────────────

    /// Authenticate with the Proxmox VE server.
    pub async fn login(&mut self) -> ProxmoxResult<String> {
        match &self.config.auth {
            ProxmoxAuthMethod::Password {
                username,
                password,
                realm,
                otp,
            } => {
                let url = format!("{}/api2/json/access/ticket", self.base_url);
                let username = login_identity(username, realm)?;
                let mut params = vec![
                    ("username", username),
                    ("password", password.clone()),
                ];
                if let Some(otp_code) = otp {
                    params.push(("otp", otp_code.clone()));
                }

                let resp = self
                    .client
                    .post(&url)
                    .form(&params)
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

                #[derive(serde::Deserialize)]
                struct TicketData {
                    ticket: String,
                    #[serde(alias = "CSRFPreventionToken")]
                    csrf_token: String,
                    username: String,
                }
                let ticket_resp: PveResponse<TicketData> =
                    Self::parse_response(resp, MAX_METADATA_RESPONSE_BYTES).await?;

                let info = ticket_resp.data;
                let ticket = ProxmoxTicket {
                    ticket: info.ticket,
                    csrf_token: info.csrf_token,
                    username: info.username.clone(),
                    connected_at: chrono::Utc::now().to_rfc3339(),
                };

                self.ticket = Some(ticket);
                Ok(info.username)
            }
            ProxmoxAuthMethod::ApiToken { token_id, secret } => {
                let token_header = format!("PVEAPIToken={token_id}={secret}");
                self.api_token = Some(token_header);
                // Validate by fetching version
                let _: serde_json::Value = self.get("/api2/json/version").await?;
                Ok(token_id.clone())
            }
        }
    }

    /// Log out (invalidate ticket).
    pub async fn logout(&mut self) -> ProxmoxResult<()> {
        self.ticket = None;
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
        } else if let Some(ref ticket) = self.ticket {
            Ok(builder
                .header("Cookie", format!("PVEAuthCookie={}", ticket.ticket))
                .header("CSRFPreventionToken", &ticket.csrf_token))
        } else {
            Err(ProxmoxError::auth("Not authenticated"))
        }
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
        let builder = self.client.get(&url);
        let builder = self.auth_headers(builder)?;
        builder
            .send()
            .await
            .map_err(|_| ProxmoxError::connection("Proxmox GET request failed"))
    }

    /// GET with query parameters.
    pub async fn get_with_params<T: DeserializeOwned>(
        &self,
        path: &str,
        params: &[(&str, &str)],
    ) -> ProxmoxResult<T> {
        let url = format!("{}{}", self.base_url, path);
        let builder = self.client.get(&url).query(params);
        let builder = self.auth_headers(builder)?;
        let resp = builder
            .send()
            .await
            .map_err(|_| ProxmoxError::connection("Proxmox GET request failed"))?;
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
        let builder = self.client.post(&url).form(params);
        let builder = self.auth_headers(builder)?;
        let resp = builder
            .send()
            .await
            .map_err(|_| ProxmoxError::connection("Proxmox POST request failed"))?;
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
        let builder = self.client.post(&url).json(body);
        let builder = self.auth_headers(builder)?;
        let resp = builder
            .send()
            .await
            .map_err(|_| ProxmoxError::connection("Proxmox POST request failed"))?;
        let resp = Self::check_status(resp).await?;
        let envelope: PveResponse<T> = Self::parse_response(resp, MAX_RESPONSE_BYTES).await?;
        Ok(envelope.data)
    }

    /// POST with no body; discards result.
    pub async fn post_empty(&self, path: &str) -> ProxmoxResult<Option<String>> {
        let url = format!("{}{}", self.base_url, path);
        let builder = self.client.post(&url);
        let builder = self.auth_headers(builder)?;
        let resp = builder
            .send()
            .await
            .map_err(|_| ProxmoxError::connection("Proxmox POST request failed"))?;
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
        let builder = self.client.put(&url).form(params);
        let builder = self.auth_headers(builder)?;
        let resp = builder
            .send()
            .await
            .map_err(|_| ProxmoxError::connection("Proxmox PUT request failed"))?;
        Self::check_status(resp).await?;
        Ok(())
    }

    /// PUT with JSON body.
    pub async fn put_json<B: serde::Serialize>(&self, path: &str, body: &B) -> ProxmoxResult<()> {
        let url = format!("{}{}", self.base_url, path);
        let builder = self.client.put(&url).json(body);
        let builder = self.auth_headers(builder)?;
        let resp = builder
            .send()
            .await
            .map_err(|_| ProxmoxError::connection("Proxmox PUT request failed"))?;
        Self::check_status(resp).await?;
        Ok(())
    }

    /// DELETE.
    pub async fn delete(&self, path: &str) -> ProxmoxResult<Option<String>> {
        let url = format!("{}{}", self.base_url, path);
        let builder = self.client.delete(&url);
        let builder = self.auth_headers(builder)?;
        let resp = builder
            .send()
            .await
            .map_err(|_| ProxmoxError::connection("Proxmox DELETE request failed"))?;
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

    async fn read_bytes_limited(
        mut resp: Response,
        limit: usize,
    ) -> ProxmoxResult<Vec<u8>> {
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

    async fn read_text_limited(
        resp: Response,
        limit: usize,
    ) -> ProxmoxResult<String> {
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

#[cfg(test)]
mod tests {
    use super::{login_identity, normalize_sha256_fingerprint, verify_certificate_pin};
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
    fn login_identity_does_not_duplicate_an_explicit_realm() {
        assert_eq!(login_identity("root@pam", "pam").unwrap(), "root@pam");
        assert_eq!(login_identity("root", "pam").unwrap(), "root@pam");
    }
}
