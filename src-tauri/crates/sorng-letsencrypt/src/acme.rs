//! # ACME v2 Client
//!
//! Core ACME protocol implementation per RFC 8555.  Handles directory
//! discovery, nonce management, JWS request signing, account registration,
//! order lifecycle, challenge validation, CSR submission, and certificate
//! download.

use crate::types::*;
use chrono::Utc;
use p256::ecdsa::{signature::Signer, Signature, SigningKey};
use p256::pkcs8::{DecodePrivateKey, EncodePrivateKey, LineEnding};
use rand::rngs::OsRng;
use reqwest::header::{HeaderMap, ACCEPT, CONTENT_TYPE, LOCATION};
use reqwest::StatusCode;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::sync::Mutex;

// ── JWS / Crypto helpers ────────────────────────────────────────────

/// A JSON Web Signature (JWS) payload for ACME requests.
/// ACME uses the "Flattened JSON Serialization" defined in RFC 7515 §7.2.2.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JwsRequest {
    /// Base64url-encoded protected header.
    pub protected: String,
    /// Base64url-encoded payload (empty string for POST-as-GET).
    pub payload: String,
    /// Base64url-encoded signature.
    pub signature: String,
}

/// JWS protected header fields.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JwsHeader {
    /// Algorithm ("ES256", "RS256", etc.).
    pub alg: String,
    /// Nonce from the server.
    pub nonce: String,
    /// Request URL (must match the actual URL being POSTed to).
    pub url: String,
    /// Account key (JWK) — used only for new-account and revocation.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub jwk: Option<serde_json::Value>,
    /// Account URL ("kid") — used for all requests after account registration.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kid: Option<String>,
}

/// RFC 8555 §8.1 — key authorization string.
/// `key_authorization = token || '.' || base64url(thumbprint(accountKey))`
pub fn compute_key_authorization(token: &str, key_thumbprint: &str) -> String {
    format!("{}.{}", token, key_thumbprint)
}

/// For HTTP-01 challenges, the validation value is the key authorization itself.
pub fn http01_response(token: &str, key_thumbprint: &str) -> String {
    compute_key_authorization(token, key_thumbprint)
}

/// For DNS-01 challenges, the TXT record value is the base64url-encoded
/// SHA-256 digest of the key authorization.
pub fn dns01_txt_value(token: &str, key_thumbprint: &str) -> String {
    let key_auth = compute_key_authorization(token, key_thumbprint);
    let digest = Sha256::digest(key_auth.as_bytes());
    base64_url_encode(&digest)
}

/// For TLS-ALPN-01 challenges, the acmeIdentifier extension value is the
/// SHA-256 digest of the key authorization (as raw bytes).
pub fn tls_alpn01_value(token: &str, key_thumbprint: &str) -> Vec<u8> {
    let key_auth = compute_key_authorization(token, key_thumbprint);
    Sha256::digest(key_auth.as_bytes()).to_vec()
}

/// Base64url encode without padding (per RFC 4648 §5).
pub fn base64_url_encode(data: &[u8]) -> String {
    base64::Engine::encode(&base64::engine::general_purpose::URL_SAFE_NO_PAD, data)
}

/// Base64url decode (per RFC 4648 §5).
pub fn base64_url_decode(s: &str) -> Result<Vec<u8>, String> {
    base64::Engine::decode(&base64::engine::general_purpose::URL_SAFE_NO_PAD, s)
        .map_err(|e| format!("base64url decode error: {}", e))
}

/// Compute the RFC 7638 JWK thumbprint for ACME account keys.
pub fn compute_jwk_thumbprint(jwk: &Value) -> Result<String, String> {
    let kty = jwk
        .get("kty")
        .and_then(Value::as_str)
        .ok_or_else(|| "JWK kty is missing".to_string())?;

    let canonical = match kty {
        "EC" => {
            let crv = jwk
                .get("crv")
                .and_then(Value::as_str)
                .ok_or_else(|| "EC JWK crv is missing".to_string())?;
            let x = jwk
                .get("x")
                .and_then(Value::as_str)
                .ok_or_else(|| "EC JWK x is missing".to_string())?;
            let y = jwk
                .get("y")
                .and_then(Value::as_str)
                .ok_or_else(|| "EC JWK y is missing".to_string())?;
            format!(r#"{{"crv":"{}","kty":"EC","x":"{}","y":"{}"}}"#, crv, x, y)
        }
        _ => return Err(format!("Unsupported JWK kty for ACME thumbprint: {}", kty)),
    };

    Ok(base64_url_encode(&Sha256::digest(canonical.as_bytes())))
}

#[derive(Clone)]
enum AccountKey {
    EcdsaP256(SigningKey),
}

impl AccountKey {
    fn generate(alg: KeyAlgorithm) -> Result<Self, String> {
        match alg {
            KeyAlgorithm::EcdsaP256 => Ok(Self::EcdsaP256(SigningKey::random(&mut OsRng))),
            other => Err(format!(
                "ACME account key algorithm {} is unsupported by the core client; ES256 is implemented",
                other.display_name()
            )),
        }
    }

    fn from_pkcs8_pem(pem: &str) -> Result<Self, String> {
        SigningKey::from_pkcs8_pem(pem)
            .map(Self::EcdsaP256)
            .map_err(|e| format!("Failed to load ES256 account key PEM: {e}"))
    }

    fn to_pkcs8_pem(&self) -> Result<String, String> {
        match self {
            Self::EcdsaP256(key) => key
                .to_pkcs8_pem(LineEnding::LF)
                .map(|pem| pem.to_string())
                .map_err(|e| format!("Failed to encode ES256 account key PEM: {e}")),
        }
    }

    fn algorithm(&self) -> &'static str {
        match self {
            Self::EcdsaP256(_) => "ES256",
        }
    }

    fn key_algorithm(&self) -> KeyAlgorithm {
        match self {
            Self::EcdsaP256(_) => KeyAlgorithm::EcdsaP256,
        }
    }

    fn jwk(&self) -> Result<Value, String> {
        match self {
            Self::EcdsaP256(key) => {
                let public = key.verifying_key().to_encoded_point(false);
                let x = public
                    .x()
                    .ok_or_else(|| "P-256 public key x coordinate is missing".to_string())?;
                let y = public
                    .y()
                    .ok_or_else(|| "P-256 public key y coordinate is missing".to_string())?;
                Ok(json!({
                    "crv": "P-256",
                    "kty": "EC",
                    "x": base64_url_encode(x),
                    "y": base64_url_encode(y),
                }))
            }
        }
    }

    fn thumbprint(&self) -> Result<String, String> {
        compute_jwk_thumbprint(&self.jwk()?)
    }

    fn sign(&self, signing_input: &str) -> Vec<u8> {
        match self {
            Self::EcdsaP256(key) => {
                let signature: Signature = key.sign(signing_input.as_bytes());
                signature.to_bytes().to_vec()
            }
        }
    }
}

struct AcmeHttpResponse {
    status: StatusCode,
    headers: HeaderMap,
    body: Vec<u8>,
}

impl AcmeHttpResponse {
    fn location(&self) -> Option<String> {
        self.headers
            .get(LOCATION)
            .and_then(|v| v.to_str().ok())
            .map(ToString::to_string)
    }
}

fn parse_acme_problem(status: StatusCode, body: &[u8], operation: &str) -> String {
    match serde_json::from_slice::<AcmeError>(body) {
        Ok(problem) => {
            let detail = problem.detail.unwrap_or_else(|| "no detail".to_string());
            format!(
                "ACME {} failed: HTTP {} {} ({})",
                operation, status, detail, problem.error_type
            )
        }
        Err(_) => format!(
            "ACME {} failed: HTTP {} {}",
            operation,
            status,
            String::from_utf8_lossy(body)
        ),
    }
}

fn status_string(value: &Value) -> Option<&str> {
    value.get("status").and_then(Value::as_str)
}

fn parse_account_status(value: &Value) -> AcmeAccountStatus {
    match status_string(value) {
        Some("deactivated") => AcmeAccountStatus::Deactivated,
        Some("revoked") => AcmeAccountStatus::Revoked,
        _ => AcmeAccountStatus::Valid,
    }
}

fn parse_order_status(value: &Value) -> Result<OrderStatus, String> {
    match status_string(value).unwrap_or("pending") {
        "pending" => Ok(OrderStatus::Pending),
        "ready" => Ok(OrderStatus::Ready),
        "processing" => Ok(OrderStatus::Processing),
        "valid" => Ok(OrderStatus::Valid),
        "invalid" => Ok(OrderStatus::Invalid),
        other => Err(format!("Unknown ACME order status: {}", other)),
    }
}

fn parse_authorization_status(value: &Value) -> Result<AuthorizationStatus, String> {
    match status_string(value).unwrap_or("pending") {
        "pending" => Ok(AuthorizationStatus::Pending),
        "valid" => Ok(AuthorizationStatus::Valid),
        "invalid" => Ok(AuthorizationStatus::Invalid),
        "deactivated" => Ok(AuthorizationStatus::Deactivated),
        "expired" => Ok(AuthorizationStatus::Expired),
        "revoked" => Ok(AuthorizationStatus::Revoked),
        other => Err(format!("Unknown ACME authorization status: {}", other)),
    }
}

fn parse_challenge_status(value: &Value) -> Result<ChallengeStatus, String> {
    match status_string(value).unwrap_or("pending") {
        "pending" => Ok(ChallengeStatus::Pending),
        "processing" => Ok(ChallengeStatus::Processing),
        "valid" => Ok(ChallengeStatus::Valid),
        "invalid" => Ok(ChallengeStatus::Invalid),
        other => Err(format!("Unknown ACME challenge status: {}", other)),
    }
}

fn parse_datetime_field(
    value: &Value,
    field: &str,
) -> Result<Option<chrono::DateTime<Utc>>, String> {
    match value.get(field) {
        Some(v) if !v.is_null() => serde_json::from_value(v.clone())
            .map(Some)
            .map_err(|e| format!("Failed to parse ACME datetime field {field}: {e}")),
        _ => Ok(None),
    }
}

fn parse_string_array(value: &Value, field: &str) -> Vec<String> {
    value
        .get(field)
        .and_then(Value::as_array)
        .map(|values| {
            values
                .iter()
                .filter_map(Value::as_str)
                .map(ToString::to_string)
                .collect()
        })
        .unwrap_or_default()
}

fn parse_identifiers(value: &Value) -> Result<Vec<AcmeIdentifier>, String> {
    value
        .get("identifiers")
        .and_then(Value::as_array)
        .map(|values| {
            values
                .iter()
                .map(|v| {
                    serde_json::from_value(v.clone())
                        .map_err(|e| format!("Failed to parse ACME identifier: {e}"))
                })
                .collect()
        })
        .unwrap_or_else(|| Ok(Vec::new()))
}

fn parse_challenge(value: &Value) -> Result<AcmeChallenge, String> {
    Ok(AcmeChallenge {
        url: value
            .get("url")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string(),
        challenge_type: serde_json::from_value(
            value
                .get("type")
                .cloned()
                .ok_or_else(|| "ACME challenge type is missing".to_string())?,
        )
        .map_err(|e| format!("Failed to parse ACME challenge type: {e}"))?,
        status: parse_challenge_status(value)?,
        token: value
            .get("token")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string(),
        validated: parse_datetime_field(value, "validated")?,
        error: value
            .get("error")
            .cloned()
            .map(serde_json::from_value)
            .transpose()
            .map_err(|e| format!("Failed to parse ACME challenge error: {e}"))?,
    })
}

// ── ACME Client ─────────────────────────────────────────────────────

/// The core ACME v2 client.  Stateful: caches the directory, current nonce,
/// and the active account URL.
pub struct AcmeClient {
    /// The ACME environment.
    environment: AcmeEnvironment,
    /// Custom directory URL (when `environment == Custom`).
    custom_url: Option<String>,
    /// Cached ACME directory.
    directory: Option<AcmeDirectory>,
    /// Current replay-nonce.
    nonce: Mutex<Option<String>>,
    /// Account URL (set after account registration/look-up).
    #[allow(dead_code)]
    account_url: Option<String>,
    /// Account private key used for ACME JWS signing.
    account_key: Option<AccountKey>,
    /// Account key thumbprint (base64url).
    key_thumbprint: Option<String>,
    /// Key algorithm.
    key_algorithm: KeyAlgorithm,
    /// Pending orders tracked by order URL.
    #[allow(dead_code)]
    orders: HashMap<String, AcmeOrder>,
    /// Pending authorizations.
    #[allow(dead_code)]
    authorizations: HashMap<String, AcmeAuthorization>,
    /// Rate limit tracker.
    rate_limits: HashMap<String, RateLimitInfo>,
}

impl AcmeClient {
    /// Create a new ACME client for the given environment.
    pub fn new(environment: AcmeEnvironment, custom_url: Option<String>) -> Self {
        Self {
            environment,
            custom_url,
            directory: None,
            nonce: Mutex::new(None),
            account_url: None,
            account_key: None,
            key_thumbprint: None,
            key_algorithm: KeyAlgorithm::EcdsaP256,
            orders: HashMap::new(),
            authorizations: HashMap::new(),
            rate_limits: HashMap::new(),
        }
    }

    /// Get the effective directory URL.
    pub fn directory_url(&self) -> String {
        if self.environment == AcmeEnvironment::Custom {
            self.custom_url.clone().unwrap_or_default()
        } else {
            self.environment.directory_url().to_string()
        }
    }

    /// Set the key algorithm for requests.
    pub fn set_key_algorithm(&mut self, alg: KeyAlgorithm) {
        if self.key_algorithm != alg {
            self.account_key = None;
            self.key_thumbprint = None;
        }
        self.key_algorithm = alg;
    }

    /// Set the key thumbprint (computed from the account JWK).
    pub fn set_key_thumbprint(&mut self, thumbprint: String) {
        self.key_thumbprint = Some(thumbprint);
    }

    /// Get the current key thumbprint.
    pub fn key_thumbprint(&self) -> Option<&str> {
        self.key_thumbprint.as_deref()
    }

    /// Generate a new in-memory account key and return it as PKCS#8 PEM.
    pub fn generate_account_key(&mut self) -> Result<String, String> {
        let key = AccountKey::generate(self.key_algorithm)?;
        let thumbprint = key.thumbprint()?;
        let pem = key.to_pkcs8_pem()?;
        self.key_algorithm = key.key_algorithm();
        self.key_thumbprint = Some(thumbprint);
        self.account_key = Some(key);
        Ok(pem)
    }

    /// Load an existing ES256 account key from PKCS#8 PEM.
    pub fn load_account_key_pem(&mut self, pem: &str) -> Result<(), String> {
        let key = AccountKey::from_pkcs8_pem(pem)?;
        self.key_algorithm = key.key_algorithm();
        self.key_thumbprint = Some(key.thumbprint()?);
        self.account_key = Some(key);
        Ok(())
    }

    /// Export the current account key as PKCS#8 PEM, if one has been loaded.
    pub fn account_key_pem(&self) -> Result<Option<String>, String> {
        self.account_key
            .as_ref()
            .map(AccountKey::to_pkcs8_pem)
            .transpose()
    }

    /// Set the active ACME account URL for signed requests using a stored account.
    pub fn set_account_url(&mut self, account_url: Option<String>) {
        self.account_url = account_url;
    }

    /// Return the active ACME account URL, if one has been registered or loaded.
    pub fn account_url(&self) -> Option<&str> {
        self.account_url.as_deref()
    }

    // ── Directory ─────────────────────────────────────────────────

    /// Fetch and cache the ACME directory.
    pub async fn fetch_directory(&mut self) -> Result<AcmeDirectory, String> {
        let url = self.directory_url();
        log::info!("[ACME] Fetching directory from {}", url);
        let resp = reqwest::get(&url)
            .await
            .map_err(|e| format!("Failed to fetch ACME directory: {e}"))?;
        if !resp.status().is_success() {
            return Err(format!(
                "ACME directory fetch failed: HTTP {}",
                resp.status()
            ));
        }
        let dir: AcmeDirectory = resp
            .json()
            .await
            .map_err(|e| format!("Failed to parse ACME directory JSON: {e}"))?;
        self.directory = Some(dir.clone());
        Ok(dir)
    }

    /// Get the cached directory, fetching if necessary.
    pub async fn directory(&mut self) -> Result<&AcmeDirectory, String> {
        if self.directory.is_none() {
            self.fetch_directory().await?;
        }
        self.directory
            .as_ref()
            .ok_or_else(|| "Directory not available".to_string())
    }

    // ── Nonce Management ──────────────────────────────────────────

    /// Fetch a fresh anti-replay nonce from the CA.
    pub async fn fetch_nonce(&mut self) -> Result<String, String> {
        let url = {
            let dir = self.directory().await?;
            dir.new_nonce.clone()
        };
        let client = reqwest::Client::new();
        let resp = client
            .head(&url)
            .send()
            .await
            .map_err(|e| format!("Failed to fetch nonce: {e}"))?;
        let nonce = resp
            .headers()
            .get("Replay-Nonce")
            .ok_or_else(|| "Replay-Nonce header missing".to_string())?
            .to_str()
            .map_err(|e| format!("Invalid Replay-Nonce header: {e}"))?
            .to_string();
        self.store_nonce(nonce.clone())?;
        Ok(nonce)
    }

    /// Consume and return the current nonce, fetching a new one if none cached.
    pub async fn consume_nonce(&mut self) -> Result<String, String> {
        match self.take_nonce()? {
            Some(n) => Ok(n),
            None => self.fetch_nonce().await,
        }
    }

    fn take_nonce(&self) -> Result<Option<String>, String> {
        self.nonce
            .lock()
            .map(|mut nonce| nonce.take())
            .map_err(|_| "ACME nonce lock is poisoned".to_string())
    }

    fn store_nonce(&self, nonce: String) -> Result<(), String> {
        let mut guard = self
            .nonce
            .lock()
            .map_err(|_| "ACME nonce lock is poisoned".to_string())?;
        *guard = Some(nonce);
        Ok(())
    }

    fn update_nonce_from_headers(&self, headers: &HeaderMap) -> Result<(), String> {
        if let Some(nonce) = headers.get("Replay-Nonce").and_then(|v| v.to_str().ok()) {
            self.store_nonce(nonce.to_string())?;
        }
        Ok(())
    }

    async fn fetch_nonce_from_cached_directory(&self) -> Result<String, String> {
        let url = self
            .directory
            .as_ref()
            .ok_or_else(|| "Directory not available for nonce fetch".to_string())?
            .new_nonce
            .clone();
        let client = reqwest::Client::new();
        let resp = client
            .head(&url)
            .send()
            .await
            .map_err(|e| format!("Failed to fetch nonce: {e}"))?;
        let nonce = resp
            .headers()
            .get("Replay-Nonce")
            .ok_or_else(|| "Replay-Nonce header missing".to_string())?
            .to_str()
            .map_err(|e| format!("Invalid Replay-Nonce header: {e}"))?
            .to_string();
        self.store_nonce(nonce.clone())?;
        Ok(nonce)
    }

    async fn consume_nonce_from_cached_directory(&self) -> Result<String, String> {
        match self.take_nonce()? {
            Some(nonce) => Ok(nonce),
            None => self.fetch_nonce_from_cached_directory().await,
        }
    }

    // ── Signed ACME Requests ──────────────────────────────────────

    fn ensure_account_key(&mut self) -> Result<AccountKey, String> {
        if self.account_key.is_none() {
            let key = AccountKey::generate(self.key_algorithm)?;
            self.key_thumbprint = Some(key.thumbprint()?);
            self.key_algorithm = key.key_algorithm();
            self.account_key = Some(key);
        }
        self.account_key
            .clone()
            .ok_or_else(|| "ACME account key is not available".to_string())
    }

    fn build_jws(
        key: &AccountKey,
        nonce: String,
        url: &str,
        payload: Option<&Value>,
        kid: Option<&str>,
    ) -> Result<JwsRequest, String> {
        let mut header = JwsHeader {
            alg: key.algorithm().to_string(),
            nonce,
            url: url.to_string(),
            jwk: None,
            kid: kid.map(ToString::to_string),
        };
        if kid.is_none() {
            header.jwk = Some(key.jwk()?);
        }

        let protected_json = serde_json::to_vec(&header)
            .map_err(|e| format!("Failed to serialize JWS protected header: {e}"))?;
        let protected = base64_url_encode(&protected_json);
        let payload = match payload {
            Some(value) => base64_url_encode(
                &serde_json::to_vec(value)
                    .map_err(|e| format!("Failed to serialize JWS payload: {e}"))?,
            ),
            None => String::new(),
        };
        let signing_input = format!("{}.{}", protected, payload);
        let signature = base64_url_encode(&key.sign(&signing_input));

        Ok(JwsRequest {
            protected,
            payload,
            signature,
        })
    }

    async fn post_signed_with_key(
        &self,
        key: &AccountKey,
        url: &str,
        payload: Option<Value>,
        kid: Option<&str>,
        accept: Option<&str>,
    ) -> Result<AcmeHttpResponse, String> {
        let client = reqwest::Client::new();
        let mut last_bad_nonce = false;

        for _ in 0..2 {
            let nonce = self.consume_nonce_from_cached_directory().await?;
            let jws = Self::build_jws(key, nonce, url, payload.as_ref(), kid)?;
            let mut request = client
                .post(url)
                .header(CONTENT_TYPE, "application/jose+json")
                .json(&jws);
            if let Some(accept) = accept {
                request = request.header(ACCEPT, accept);
            }

            let resp = request
                .send()
                .await
                .map_err(|e| format!("Failed to POST signed ACME request to {url}: {e}"))?;
            let status = resp.status();
            let headers = resp.headers().clone();
            self.update_nonce_from_headers(&headers)?;
            let body = resp
                .bytes()
                .await
                .map_err(|e| format!("Failed to read ACME response body from {url}: {e}"))?
                .to_vec();

            if status.is_success() {
                return Ok(AcmeHttpResponse {
                    status,
                    headers,
                    body,
                });
            }

            let is_bad_nonce = serde_json::from_slice::<AcmeError>(&body)
                .map(|problem| problem.error_type == "urn:ietf:params:acme:error:badNonce")
                .unwrap_or(false);
            if is_bad_nonce && !last_bad_nonce {
                last_bad_nonce = true;
                continue;
            }

            return Ok(AcmeHttpResponse {
                status,
                headers,
                body,
            });
        }

        Err("ACME signed request retry loop exhausted".to_string())
    }

    async fn post_as_get(
        &self,
        key: &AccountKey,
        url: &str,
        accept: Option<&str>,
    ) -> Result<AcmeHttpResponse, String> {
        let kid = self
            .account_url
            .as_deref()
            .ok_or_else(|| "ACME account URL is required for POST-as-GET".to_string())?;
        self.post_signed_with_key(key, url, None, Some(kid), accept)
            .await
    }

    fn account_from_response(
        &self,
        value: &Value,
        account_url: Option<String>,
        contacts: &[String],
        tos_agreed: bool,
        eab_key_id: Option<&str>,
    ) -> Result<AcmeAccount, String> {
        Ok(AcmeAccount {
            id: uuid::Uuid::new_v4().to_string(),
            environment: self.environment,
            custom_directory_url: self.custom_url.clone(),
            account_url,
            contacts: value
                .get("contact")
                .and_then(Value::as_array)
                .map(|items| {
                    items
                        .iter()
                        .filter_map(Value::as_str)
                        .map(ToString::to_string)
                        .collect()
                })
                .unwrap_or_else(|| contacts.to_vec()),
            status: parse_account_status(value),
            created_at: Utc::now(),
            key_thumbprint: self
                .key_thumbprint
                .clone()
                .ok_or_else(|| "ACME account key thumbprint is not available".to_string())?,
            key_algorithm: self.key_algorithm,
            tos_agreed,
            eab_key_id: eab_key_id.map(ToString::to_string),
        })
    }

    fn order_from_response(
        &self,
        value: &Value,
        order_url: Option<String>,
    ) -> Result<AcmeOrder, String> {
        Ok(AcmeOrder {
            id: order_url
                .as_ref()
                .and_then(|url| url.rsplit('/').next())
                .filter(|id| !id.is_empty())
                .map(ToString::to_string)
                .unwrap_or_else(|| uuid::Uuid::new_v4().to_string()),
            account_id: self.account_url.clone().unwrap_or_default(),
            order_url,
            status: parse_order_status(value)?,
            identifiers: parse_identifiers(value)?,
            authorization_urls: parse_string_array(value, "authorizations"),
            finalize_url: value
                .get("finalize")
                .and_then(Value::as_str)
                .map(ToString::to_string),
            certificate_url: value
                .get("certificate")
                .and_then(Value::as_str)
                .map(ToString::to_string),
            created_at: Utc::now(),
            expires: parse_datetime_field(value, "expires")?,
            not_before: parse_datetime_field(value, "notBefore")?,
            not_after: parse_datetime_field(value, "notAfter")?,
            error: value
                .get("error")
                .cloned()
                .map(serde_json::from_value)
                .transpose()
                .map_err(|e| format!("Failed to parse ACME order error: {e}"))?,
        })
    }

    fn authorization_from_response(
        &self,
        authz_url: &str,
        value: &Value,
    ) -> Result<AcmeAuthorization, String> {
        let challenges = value
            .get("challenges")
            .and_then(Value::as_array)
            .map(|items| items.iter().map(parse_challenge).collect())
            .unwrap_or_else(|| Ok(Vec::new()))?;

        Ok(AcmeAuthorization {
            url: authz_url.to_string(),
            status: parse_authorization_status(value)?,
            identifier: value
                .get("identifier")
                .cloned()
                .map(serde_json::from_value)
                .transpose()
                .map_err(|e| format!("Failed to parse ACME authorization identifier: {e}"))?
                .unwrap_or(AcmeIdentifier {
                    id_type: "dns".to_string(),
                    value: String::new(),
                }),
            challenges,
            wildcard: value
                .get("wildcard")
                .and_then(Value::as_bool)
                .unwrap_or(false),
            expires: parse_datetime_field(value, "expires")?,
        })
    }

    // ── Account Operations ────────────────────────────────────────

    /// Register or find an existing account.
    ///
    /// Sends a POST to newAccount with `termsOfServiceAgreed: true` and
    /// the contact email(s).  If the account already exists, the CA returns
    /// the existing account URL (HTTP 200 instead of 201).
    pub async fn register_account(
        &mut self,
        contacts: &[String],
        agree_tos: bool,
        eab_key_id: Option<&str>,
        eab_hmac_key: Option<&str>,
    ) -> Result<AcmeAccount, String> {
        if !agree_tos {
            return Err("You must agree to the Terms of Service".to_string());
        }
        if eab_key_id.is_some() || eab_hmac_key.is_some() {
            return Err(
                "ACME external account binding is unsupported by the core client".to_string(),
            );
        }
        log::info!("[ACME] Registering account with contacts: {:?}", contacts);
        let url = {
            let dir = self.directory().await?;
            dir.new_account.clone()
        };
        let key = self.ensure_account_key()?;
        let payload = json!({
            "termsOfServiceAgreed": true,
            "contact": contacts,
        });

        let resp = self
            .post_signed_with_key(&key, &url, Some(payload), None, None)
            .await?;
        if !resp.status.is_success() {
            return Err(parse_acme_problem(
                resp.status,
                &resp.body,
                "account registration",
            ));
        }

        let account_url = resp
            .location()
            .or_else(|| self.account_url.clone())
            .ok_or_else(|| "ACME account registration response missing Location".to_string())?;
        self.account_url = Some(account_url.clone());
        let body: Value = serde_json::from_slice(&resp.body)
            .map_err(|e| format!("Failed to parse ACME account response: {e}"))?;
        let account =
            self.account_from_response(&body, Some(account_url), contacts, true, eab_key_id)?;
        log::info!("[ACME] Account registered: {}", account.id);
        Ok(account)
    }

    /// Look up an existing account by key (without creating one).
    pub async fn find_account(&mut self) -> Result<Option<AcmeAccount>, String> {
        log::info!("[ACME] Looking up existing account");
        let url = {
            let dir = self.directory().await?;
            dir.new_account.clone()
        };
        let key = self.ensure_account_key()?;
        let payload = json!({ "onlyReturnExisting": true });
        let resp = self
            .post_signed_with_key(&key, &url, Some(payload), None, None)
            .await?;

        if resp.status == StatusCode::NOT_FOUND {
            return Ok(None);
        }
        if !resp.status.is_success() {
            if serde_json::from_slice::<AcmeError>(&resp.body)
                .map(|problem| {
                    problem.error_type == "urn:ietf:params:acme:error:accountDoesNotExist"
                })
                .unwrap_or(false)
            {
                return Ok(None);
            }
            return Err(parse_acme_problem(
                resp.status,
                &resp.body,
                "account lookup",
            ));
        }

        let account_url = resp
            .location()
            .ok_or_else(|| "ACME account lookup response missing Location".to_string())?;
        self.account_url = Some(account_url.clone());
        let body: Value = serde_json::from_slice(&resp.body)
            .map_err(|e| format!("Failed to parse ACME account lookup response: {e}"))?;
        Ok(Some(self.account_from_response(
            &body,
            Some(account_url),
            &[],
            false,
            None,
        )?))
    }

    /// Deactivate an account.
    pub async fn deactivate_account(&mut self, account_url: &str) -> Result<(), String> {
        log::info!("[ACME] Deactivating account at {}", account_url);
        self.directory().await?;
        let key = self.ensure_account_key()?;
        let payload = json!({ "status": "deactivated" });
        let resp = self
            .post_signed_with_key(&key, account_url, Some(payload), Some(account_url), None)
            .await?;
        if !resp.status.is_success() {
            return Err(parse_acme_problem(
                resp.status,
                &resp.body,
                "account deactivation",
            ));
        }
        self.account_url = None;
        Ok(())
    }

    /// Rotate the account key.
    pub async fn key_change(&mut self, _old_key: &[u8], _new_key: &[u8]) -> Result<(), String> {
        log::info!("[ACME] Performing account key rollover");
        Err("ACME account key rollover is unsupported by the core client".to_string())
    }

    // ── Order Lifecycle ───────────────────────────────────────────

    /// Create a new certificate order.
    pub async fn create_order(&mut self, domains: &[String]) -> Result<AcmeOrder, String> {
        if domains.is_empty() {
            return Err("At least one domain is required".to_string());
        }

        log::info!("[ACME] Creating order for domains: {:?}", domains);
        let url = {
            let dir = self.directory().await?;
            dir.new_order.clone()
        };
        let key = self.ensure_account_key()?;
        let kid = self
            .account_url
            .clone()
            .ok_or_else(|| "ACME account URL is required before creating an order".to_string())?;
        let identifiers: Vec<Value> = domains
            .iter()
            .map(|domain| json!({ "type": "dns", "value": domain }))
            .collect();
        let payload = json!({ "identifiers": identifiers });

        let resp = self
            .post_signed_with_key(&key, &url, Some(payload), Some(&kid), None)
            .await?;
        if !resp.status.is_success() {
            return Err(parse_acme_problem(
                resp.status,
                &resp.body,
                "order creation",
            ));
        }

        let body: Value = serde_json::from_slice(&resp.body)
            .map_err(|e| format!("Failed to parse ACME order response: {e}"))?;
        let order = self.order_from_response(&body, resp.location())?;
        if let Some(order_url) = &order.order_url {
            self.orders.insert(order_url.clone(), order.clone());
        }
        Ok(order)
    }

    /// Poll an order to check its current status.
    pub async fn poll_order(&mut self, order_url: &str) -> Result<AcmeOrder, String> {
        log::debug!("[ACME] Polling order at {}", order_url);
        self.directory().await?;
        let key = self.ensure_account_key()?;
        let resp = self.post_as_get(&key, order_url, None).await?;
        if !resp.status.is_success() {
            return Err(parse_acme_problem(resp.status, &resp.body, "order polling"));
        }
        let body: Value = serde_json::from_slice(&resp.body)
            .map_err(|e| format!("Failed to parse ACME order poll response: {e}"))?;
        let order = self.order_from_response(&body, Some(order_url.to_string()))?;
        self.orders.insert(order_url.to_string(), order.clone());
        Ok(order)
    }

    /// Fetch an authorization object.
    pub async fn fetch_authorization(
        &mut self,
        authz_url: &str,
    ) -> Result<AcmeAuthorization, String> {
        log::debug!("[ACME] Fetching authorization at {}", authz_url);
        self.directory().await?;
        let key = self.ensure_account_key()?;
        let resp = self.post_as_get(&key, authz_url, None).await?;
        if !resp.status.is_success() {
            return Err(parse_acme_problem(
                resp.status,
                &resp.body,
                "authorization fetch",
            ));
        }
        let body: Value = serde_json::from_slice(&resp.body)
            .map_err(|e| format!("Failed to parse ACME authorization response: {e}"))?;
        let authz = self.authorization_from_response(authz_url, &body)?;
        self.authorizations
            .insert(authz_url.to_string(), authz.clone());
        Ok(authz)
    }

    /// Respond to a challenge (tell the CA we're ready for validation).
    pub async fn respond_challenge(
        &mut self,
        challenge_url: &str,
    ) -> Result<AcmeChallenge, String> {
        log::info!("[ACME] Responding to challenge at {}", challenge_url);
        self.directory().await?;
        let key = self.ensure_account_key()?;
        let kid = self
            .account_url
            .clone()
            .ok_or_else(|| "ACME account URL is required for challenge response".to_string())?;
        let resp = self
            .post_signed_with_key(&key, challenge_url, Some(json!({})), Some(&kid), None)
            .await?;
        if !resp.status.is_success() {
            return Err(parse_acme_problem(
                resp.status,
                &resp.body,
                "challenge response",
            ));
        }
        let body: Value = serde_json::from_slice(&resp.body)
            .map_err(|e| format!("Failed to parse ACME challenge response: {e}"))?;
        let challenge = parse_challenge(&body)?;
        for authz in self.authorizations.values_mut() {
            if let Some(existing) = authz
                .challenges
                .iter_mut()
                .find(|candidate| candidate.url == challenge.url)
            {
                *existing = challenge.clone();
            }
        }
        Ok(challenge)
    }

    /// Poll a challenge to check its current status.
    pub async fn poll_challenge(&self, challenge_url: &str) -> Result<AcmeChallenge, String> {
        log::debug!("[ACME] Polling challenge at {}", challenge_url);
        let key = self
            .account_key
            .clone()
            .ok_or_else(|| "ACME account key is required for challenge polling".to_string())?;
        let resp = self.post_as_get(&key, challenge_url, None).await?;
        if !resp.status.is_success() {
            return Err(parse_acme_problem(
                resp.status,
                &resp.body,
                "challenge polling",
            ));
        }
        let body: Value = serde_json::from_slice(&resp.body)
            .map_err(|e| format!("Failed to parse ACME challenge poll response: {e}"))?;
        parse_challenge(&body)
    }

    /// Finalize an order by submitting a CSR.
    pub async fn finalize_order(
        &mut self,
        finalize_url: &str,
        _csr_der: &[u8],
    ) -> Result<AcmeOrder, String> {
        log::info!("[ACME] Finalizing order at {}", finalize_url);
        self.directory().await?;
        let key = self.ensure_account_key()?;
        let kid = self
            .account_url
            .clone()
            .ok_or_else(|| "ACME account URL is required for order finalization".to_string())?;
        let payload = json!({ "csr": base64_url_encode(_csr_der) });
        let resp = self
            .post_signed_with_key(&key, finalize_url, Some(payload), Some(&kid), None)
            .await?;
        if !resp.status.is_success() {
            return Err(parse_acme_problem(
                resp.status,
                &resp.body,
                "order finalization",
            ));
        }
        let body: Value = serde_json::from_slice(&resp.body)
            .map_err(|e| format!("Failed to parse ACME finalize response: {e}"))?;
        let order_url = self
            .orders
            .values()
            .find(|order| order.finalize_url.as_deref() == Some(finalize_url))
            .and_then(|order| order.order_url.clone());
        let order = self.order_from_response(&body, order_url)?;
        if let Some(order_url) = &order.order_url {
            self.orders.insert(order_url.clone(), order.clone());
        }
        Ok(order)
    }

    /// Download the issued certificate chain.
    pub async fn download_certificate(&self, certificate_url: &str) -> Result<String, String> {
        log::info!("[ACME] Downloading certificate from {}", certificate_url);
        if let (Some(key), Some(_account_url), Some(_directory)) = (
            self.account_key.clone(),
            self.account_url.as_deref(),
            self.directory.as_ref(),
        ) {
            let resp = self
                .post_as_get(
                    &key,
                    certificate_url,
                    Some("application/pem-certificate-chain"),
                )
                .await?;
            if !resp.status.is_success() {
                return Err(parse_acme_problem(
                    resp.status,
                    &resp.body,
                    "certificate download",
                ));
            }
            return String::from_utf8(resp.body)
                .map_err(|e| format!("ACME certificate response was not valid UTF-8 PEM: {e}"));
        }

        let client = reqwest::Client::new();
        let resp = client
            .get(certificate_url)
            .header("Accept", "application/pem-certificate-chain")
            .send()
            .await
            .map_err(|e| format!("Failed to download certificate: {e}"))?;
        if !resp.status().is_success() {
            return Err(format!(
                "Certificate download failed: HTTP {}",
                resp.status()
            ));
        }
        let pem = resp
            .text()
            .await
            .map_err(|e| format!("Failed to read certificate PEM: {e}"))?;
        Ok(pem)
    }

    /// Revoke a certificate.
    pub async fn revoke_certificate(
        &mut self,
        cert_der: &[u8],
        reason: Option<u8>,
    ) -> Result<(), String> {
        log::info!("[ACME] Revoking certificate (reason: {:?})", reason);
        let url = {
            let dir = self.directory().await?;
            dir.revoke_cert.clone()
        };
        let key = self.ensure_account_key()?;
        let mut payload = json!({ "certificate": base64_url_encode(cert_der) });
        if let Some(reason) = reason {
            payload["reason"] = json!(reason);
        }
        let resp = self
            .post_signed_with_key(&key, &url, Some(payload), self.account_url.as_deref(), None)
            .await?;
        if !resp.status.is_success() {
            return Err(parse_acme_problem(
                resp.status,
                &resp.body,
                "certificate revocation",
            ));
        }
        Ok(())
    }

    // ── Rate Limit Tracking ───────────────────────────────────────

    /// Record that a certificate was issued for a domain.
    pub fn record_issuance(&mut self, domain: &str) {
        let entry = self
            .rate_limits
            .entry(domain.to_string())
            .or_insert_with(|| RateLimitInfo {
                domain: domain.to_string(),
                certs_this_week: 0,
                weekly_limit: 50,
                duplicates_this_week: 0,
                duplicate_limit: 5,
                failed_validations_this_hour: 0,
                hourly_failure_limit: 5,
                weekly_reset: Some(Utc::now() + chrono::Duration::days(7)),
                is_rate_limited: false,
                retry_after_secs: None,
            });
        entry.certs_this_week += 1;
        entry.is_rate_limited = entry.certs_this_week >= entry.weekly_limit;
    }

    /// Record a failed validation for a domain.
    pub fn record_validation_failure(&mut self, domain: &str) {
        let entry = self
            .rate_limits
            .entry(domain.to_string())
            .or_insert_with(|| RateLimitInfo {
                domain: domain.to_string(),
                certs_this_week: 0,
                weekly_limit: 50,
                duplicates_this_week: 0,
                duplicate_limit: 5,
                failed_validations_this_hour: 0,
                hourly_failure_limit: 5,
                weekly_reset: None,
                is_rate_limited: false,
                retry_after_secs: None,
            });
        entry.failed_validations_this_hour += 1;
        if entry.failed_validations_this_hour >= entry.hourly_failure_limit {
            entry.is_rate_limited = true;
        }
    }

    /// Check rate limit status for a domain.
    pub fn check_rate_limit(&self, domain: &str) -> Option<&RateLimitInfo> {
        self.rate_limits.get(domain)
    }

    /// Check whether a domain is currently rate-limited.
    pub fn is_rate_limited(&self, domain: &str) -> bool {
        self.rate_limits
            .get(domain)
            .map(|r| r.is_rate_limited)
            .unwrap_or(false)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_directory() -> AcmeDirectory {
        AcmeDirectory {
            new_nonce: "https://ca.example/acme/new-nonce".to_string(),
            new_account: "https://ca.example/acme/new-account".to_string(),
            new_order: "https://ca.example/acme/new-order".to_string(),
            revoke_cert: "https://ca.example/acme/revoke-cert".to_string(),
            key_change: "https://ca.example/acme/key-change".to_string(),
            meta: None,
        }
    }

    #[test]
    fn test_environment_urls() {
        assert!(AcmeEnvironment::LetsEncryptProduction
            .directory_url()
            .contains("acme-v02"));
        assert!(AcmeEnvironment::LetsEncryptStaging
            .directory_url()
            .contains("staging"));
    }

    #[test]
    fn test_key_authorization() {
        let ka = compute_key_authorization("test-token", "test-thumb");
        assert_eq!(ka, "test-token.test-thumb");
    }

    #[test]
    fn test_dns01_txt_value() {
        let val = dns01_txt_value("test-token", "test-thumb");
        // Should be the base64url-encoded SHA-256 of "test-token.test-thumb"
        assert!(!val.is_empty());
        assert!(!val.contains('='), "base64url should have no padding");
    }

    #[test]
    fn test_http01_response() {
        let resp = http01_response("abc123", "thumbprint");
        assert_eq!(resp, "abc123.thumbprint");
    }

    #[test]
    fn test_base64_url_roundtrip() {
        let data = b"hello acme world";
        let encoded = base64_url_encode(data);
        let decoded = base64_url_decode(&encoded).unwrap();
        assert_eq!(decoded, data);
    }

    #[test]
    fn test_jwk_thumbprint_uses_rfc7638_canonical_fields() {
        let jwk = json!({
            "kty": "EC",
            "y": "test-y",
            "x": "test-x",
            "crv": "P-256",
            "ignored": "value"
        });
        let expected = base64_url_encode(&Sha256::digest(
            br#"{"crv":"P-256","kty":"EC","x":"test-x","y":"test-y"}"#,
        ));

        assert_eq!(compute_jwk_thumbprint(&jwk).unwrap(), expected);
    }

    #[test]
    fn test_es256_jws_header_payload_and_signature_shape() {
        let key = AccountKey::generate(KeyAlgorithm::EcdsaP256).unwrap();
        let jws = AcmeClient::build_jws(
            &key,
            "nonce-1".to_string(),
            "https://ca.example/acme/new-account",
            Some(&json!({ "termsOfServiceAgreed": true })),
            None,
        )
        .unwrap();

        let protected: Value =
            serde_json::from_slice(&base64_url_decode(&jws.protected).unwrap()).unwrap();
        assert_eq!(protected["alg"], "ES256");
        assert_eq!(protected["nonce"], "nonce-1");
        assert_eq!(protected["url"], "https://ca.example/acme/new-account");
        assert!(protected.get("jwk").is_some());
        assert!(protected.get("kid").is_none());

        let payload: Value =
            serde_json::from_slice(&base64_url_decode(&jws.payload).unwrap()).unwrap();
        assert_eq!(payload["termsOfServiceAgreed"], true);
        assert_eq!(base64_url_decode(&jws.signature).unwrap().len(), 64);
    }

    #[test]
    fn test_account_key_pem_roundtrip_preserves_thumbprint() {
        let mut client = AcmeClient::new(AcmeEnvironment::LetsEncryptStaging, None);
        let pem = client.generate_account_key().unwrap();
        let thumbprint = client.key_thumbprint().unwrap().to_string();

        let mut loaded = AcmeClient::new(AcmeEnvironment::LetsEncryptStaging, None);
        loaded.load_account_key_pem(&pem).unwrap();

        assert_eq!(loaded.key_thumbprint(), Some(thumbprint.as_str()));
        assert!(loaded.account_key_pem().unwrap().is_some());
    }

    #[test]
    fn test_order_response_mapping_uses_lowercase_acme_statuses() {
        let mut client = AcmeClient::new(AcmeEnvironment::LetsEncryptStaging, None);
        client.account_url = Some("https://ca.example/acme/acct/1".to_string());
        let body = json!({
            "status": "ready",
            "identifiers": [{ "type": "dns", "value": "example.com" }],
            "authorizations": ["https://ca.example/acme/authz/1"],
            "finalize": "https://ca.example/acme/order/1/finalize",
            "expires": "2026-07-15T00:00:00Z"
        });

        let order = client
            .order_from_response(&body, Some("https://ca.example/acme/order/1".to_string()))
            .unwrap();

        assert_eq!(order.status, OrderStatus::Ready);
        assert_eq!(order.identifiers[0].value, "example.com");
        assert_eq!(order.authorization_urls.len(), 1);
        assert!(order.expires.is_some());
    }

    #[test]
    fn test_authorization_response_mapping_parses_challenges() {
        let client = AcmeClient::new(AcmeEnvironment::LetsEncryptStaging, None);
        let body = json!({
            "status": "pending",
            "identifier": { "type": "dns", "value": "example.com" },
            "challenges": [{
                "type": "http-01",
                "url": "https://ca.example/acme/chall/1",
                "status": "processing",
                "token": "token-1"
            }],
            "wildcard": false
        });

        let authz = client
            .authorization_from_response("https://ca.example/acme/authz/1", &body)
            .unwrap();

        assert_eq!(authz.status, AuthorizationStatus::Pending);
        assert_eq!(authz.challenges[0].challenge_type, ChallengeType::Http01);
        assert_eq!(authz.challenges[0].status, ChallengeStatus::Processing);
    }

    #[tokio::test]
    async fn test_acme_client_create_order_requires_account_url() {
        let mut client = AcmeClient::new(AcmeEnvironment::LetsEncryptStaging, None);
        client.directory = Some(test_directory());

        let err = client
            .create_order(&["example.com".to_string(), "www.example.com".to_string()])
            .await
            .unwrap_err();

        assert!(err.contains("account URL"));
    }

    #[tokio::test]
    async fn test_acme_client_empty_domains_rejected() {
        let mut client = AcmeClient::new(AcmeEnvironment::LetsEncryptStaging, None);
        let result = client.create_order(&[]).await;
        assert!(result.is_err());
    }

    #[test]
    fn test_rate_limit_tracking() {
        let mut client = AcmeClient::new(AcmeEnvironment::LetsEncryptStaging, None);

        assert!(!client.is_rate_limited("example.com"));
        client.record_issuance("example.com");
        assert!(!client.is_rate_limited("example.com"));

        // Simulate hitting the limit
        for _ in 0..50 {
            client.record_issuance("ratelimited.com");
        }
        assert!(client.is_rate_limited("ratelimited.com"));
    }
}
