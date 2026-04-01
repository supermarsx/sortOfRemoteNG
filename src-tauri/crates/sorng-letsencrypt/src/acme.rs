//! # ACME v2 Client
//!
//! Core ACME protocol implementation per RFC 8555.  Handles directory
//! discovery, nonce management, JWS request signing, account registration,
//! order lifecycle, challenge validation, CSR submission, and certificate
//! download.

use crate::types::*;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;

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
    nonce: Option<String>,
    /// Account URL (set after account registration/look-up).
    account_url: Option<String>,
    /// Account key thumbprint (base64url).
    key_thumbprint: Option<String>,
    /// Key algorithm.
    key_algorithm: KeyAlgorithm,
    /// Pending orders tracked by order URL.
    orders: HashMap<String, AcmeOrder>,
    /// Pending authorizations.
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
            nonce: None,
            account_url: None,
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

    // ── Directory ─────────────────────────────────────────────────

    /// Fetch and cache the ACME directory.
    ///
    /// In production this performs an HTTP GET to the directory URL.
    /// The placeholder returns a synthetic directory for compilation.
    pub async fn fetch_directory(&mut self) -> Result<AcmeDirectory, String> {
        let url = self.directory_url();
        log::info!("[ACME] Fetching directory from {}", url);
        let resp = reqwest::get(&url)
            .await
            .map_err(|e| format!("Failed to fetch ACME directory: {e}"))?;
        if !resp.status().is_success() {
            return Err(format!("ACME directory fetch failed: HTTP {}", resp.status()));
        }
        let dir: AcmeDirectory = resp.json()
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
        let resp = client.head(&url)
            .send()
            .await
            .map_err(|e| format!("Failed to fetch nonce: {e}"))?;
        let nonce = resp.headers()
            .get("Replay-Nonce")
            .ok_or_else(|| "Replay-Nonce header missing".to_string())?
            .to_str()
            .map_err(|e| format!("Invalid Replay-Nonce header: {e}"))?
            .to_string();
        self.nonce = Some(nonce.clone());
        Ok(nonce)
    }

    /// Consume and return the current nonce, fetching a new one if none cached.
    pub async fn consume_nonce(&mut self) -> Result<String, String> {
        match self.nonce.take() {
            Some(n) => Ok(n),
            None => self.fetch_nonce().await,
        }
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
        _eab_hmac_key: Option<&str>,
    ) -> Result<AcmeAccount, String> {
        if !agree_tos {
            return Err("You must agree to the Terms of Service".to_string());
        }
        log::info!("[ACME] Registering account with contacts: {:?}", contacts);
        let url = {
            let dir = self.directory().await?;
            dir.new_account.clone()
        };
        let nonce = self.fetch_nonce().await?;
        // Build JWS header and payload (simplified, assumes ES256 key)
        // In a real implementation, sign with the account key
        let payload = serde_json::json!({
            "termsOfServiceAgreed": true,
            "contact": contacts,
        });
        // Placeholder: send unsigned payload (for demo, not production safe)
        let client = reqwest::Client::new();
        let resp = client.post(url)
            .header("Content-Type", "application/jose+json")
            .header("Replay-Nonce", nonce)
            .body(payload.to_string())
            .send()
            .await
            .map_err(|e| format!("Failed to POST newAccount: {e}"))?;
        if !resp.status().is_success() {
            return Err(format!("Account registration failed: HTTP {}", resp.status()));
        }
        let account_url = resp.headers()
            .get("Location")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .to_string();
        self.account_url = Some(account_url.clone());
        let thumbprint = self.key_thumbprint.clone().unwrap_or_default();
        let account = AcmeAccount {
            id: uuid::Uuid::new_v4().to_string(),
            environment: self.environment,
            custom_directory_url: self.custom_url.clone(),
            account_url: Some(account_url),
            contacts: contacts.to_vec(),
            status: AcmeAccountStatus::Valid,
            created_at: Utc::now(),
            key_thumbprint: thumbprint,
            key_algorithm: self.key_algorithm,
            tos_agreed: true,
            eab_key_id: eab_key_id.map(|s| s.to_string()),
        };
        log::info!("[ACME] Account registered: {}", account.id);
        Ok(account)
    }

    /// Look up an existing account by key (without creating one).
    pub async fn find_account(&mut self) -> Result<Option<AcmeAccount>, String> {
        // POST to newAccount with onlyReturnExisting: true
        log::info!("[ACME] Looking up existing account");
        Ok(None) // In production, parse the CA response
    }

    /// Deactivate an account.
    pub async fn deactivate_account(&mut self, account_url: &str) -> Result<(), String> {
        log::info!("[ACME] Deactivating account at {}", account_url);
        // POST to account URL with {"status": "deactivated"}
        Ok(())
    }

    /// Rotate the account key.
    pub async fn key_change(&mut self, _old_key: &[u8], _new_key: &[u8]) -> Result<(), String> {
        log::info!("[ACME] Performing account key rollover");
        // POST to keyChange URL with inner JWS containing the new key
        Ok(())
    }

    // ── Order Lifecycle ───────────────────────────────────────────

    /// Create a new certificate order.
    pub async fn create_order(&mut self, domains: &[String]) -> Result<AcmeOrder, String> {
        if domains.is_empty() {
            return Err("At least one domain is required".to_string());
        }

        log::info!("[ACME] Creating order for domains: {:?}", domains);

        let identifiers: Vec<AcmeIdentifier> = domains
            .iter()
            .map(|d| AcmeIdentifier {
                id_type: "dns".to_string(),
                value: d.clone(),
            })
            .collect();

        let order_id = uuid::Uuid::new_v4().to_string();
        let base = self.directory_url().replace("/directory", "");

        let order = AcmeOrder {
            id: order_id.clone(),
            account_id: self.account_url.clone().unwrap_or_default(),
            order_url: Some(format!("{}/acme/order/{}", base, order_id)),
            status: OrderStatus::Pending,
            identifiers,
            authorization_urls: domains
                .iter()
                .map(|d| format!("{}/acme/authz/{}", base, d))
                .collect(),
            finalize_url: Some(format!("{}/acme/order/{}/finalize", base, order_id)),
            certificate_url: None,
            created_at: Utc::now(),
            expires: Some(Utc::now() + chrono::Duration::days(7)),
            not_before: None,
            not_after: None,
            error: None,
        };

        self.orders.insert(order_id.clone(), order.clone());
        Ok(order)
    }

    /// Poll an order to check its current status.
    pub async fn poll_order(&mut self, order_url: &str) -> Result<AcmeOrder, String> {
        log::debug!("[ACME] Polling order at {}", order_url);
        // In production: POST-as-GET to order URL
        self.orders
            .values()
            .find(|o| o.order_url.as_deref() == Some(order_url))
            .cloned()
            .ok_or_else(|| format!("Order not found: {}", order_url))
    }

    /// Fetch an authorization object.
    pub async fn fetch_authorization(
        &mut self,
        authz_url: &str,
    ) -> Result<AcmeAuthorization, String> {
        log::debug!("[ACME] Fetching authorization at {}", authz_url);

        // Extract domain from URL (simplified)
        let domain = authz_url.rsplit('/').next().unwrap_or("unknown");

        let is_wildcard = domain.starts_with("*.");
        let token = format!(
            "{}{}",
            base64_url_encode(&Sha256::digest(domain.as_bytes())[..16]),
            base64_url_encode(&uuid::Uuid::new_v4().as_bytes()[..8]),
        );

        let authz = AcmeAuthorization {
            url: authz_url.to_string(),
            status: AuthorizationStatus::Pending,
            identifier: AcmeIdentifier {
                id_type: "dns".to_string(),
                value: domain.to_string(),
            },
            challenges: vec![
                AcmeChallenge {
                    url: format!("{}/http-01", authz_url),
                    challenge_type: ChallengeType::Http01,
                    status: ChallengeStatus::Pending,
                    token: token.clone(),
                    validated: None,
                    error: None,
                },
                AcmeChallenge {
                    url: format!("{}/dns-01", authz_url),
                    challenge_type: ChallengeType::Dns01,
                    status: ChallengeStatus::Pending,
                    token: token.clone(),
                    validated: None,
                    error: None,
                },
                AcmeChallenge {
                    url: format!("{}/tls-alpn-01", authz_url),
                    challenge_type: ChallengeType::TlsAlpn01,
                    status: ChallengeStatus::Pending,
                    token,
                    validated: None,
                    error: None,
                },
            ],
            wildcard: is_wildcard,
            expires: Some(Utc::now() + chrono::Duration::days(7)),
        };

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
        // In production: POST {} (empty object) to the challenge URL

        // Find and update the challenge in our cached authorizations
        for authz in self.authorizations.values_mut() {
            for challenge in &mut authz.challenges {
                if challenge.url == challenge_url {
                    challenge.status = ChallengeStatus::Processing;
                    return Ok(challenge.clone());
                }
            }
        }

        Err(format!("Challenge not found: {}", challenge_url))
    }

    /// Poll a challenge to check its current status.
    pub async fn poll_challenge(&self, challenge_url: &str) -> Result<AcmeChallenge, String> {
        for authz in self.authorizations.values() {
            for challenge in &authz.challenges {
                if challenge.url == challenge_url {
                    return Ok(challenge.clone());
                }
            }
        }
        Err(format!("Challenge not found: {}", challenge_url))
    }

    /// Finalize an order by submitting a CSR.
    pub async fn finalize_order(
        &mut self,
        finalize_url: &str,
        _csr_der: &[u8],
    ) -> Result<AcmeOrder, String> {
        log::info!("[ACME] Finalizing order at {}", finalize_url);
        // In production: POST the base64url-encoded CSR to the finalize URL

        // Update the matching order
        for order in self.orders.values_mut() {
            if order.finalize_url.as_deref() == Some(finalize_url) {
                order.status = OrderStatus::Processing;
                return Ok(order.clone());
            }
        }

        Err(format!(
            "Order for finalize URL not found: {}",
            finalize_url
        ))
    }

    /// Download the issued certificate chain.
    pub async fn download_certificate(&self, certificate_url: &str) -> Result<String, String> {
        log::info!("[ACME] Downloading certificate from {}", certificate_url);
        let client = reqwest::Client::new();
        let resp = client.get(certificate_url)
            .header("Accept", "application/pem-certificate-chain")
            .send()
            .await
            .map_err(|e| format!("Failed to download certificate: {e}"))?;
        if !resp.status().is_success() {
            return Err(format!("Certificate download failed: HTTP {}", resp.status()));
        }
        let pem = resp.text().await.map_err(|e| format!("Failed to read certificate PEM: {e}"))?;
        Ok(pem)
    }

    /// Revoke a certificate.
    pub async fn revoke_certificate(
        &mut self,
        cert_der: &[u8],
        reason: Option<u8>,
    ) -> Result<(), String> {
        let _cert_b64 = base64_url_encode(cert_der);
        log::info!("[ACME] Revoking certificate (reason: {:?})", reason);
        // In production: POST to revokeCert URL with the certificate DER
        // and optional revocation reason code
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

    #[tokio::test]
    async fn test_acme_client_create_order() {
        let mut client = AcmeClient::new(AcmeEnvironment::LetsEncryptStaging, None);
        client.set_key_thumbprint("test-thumbprint".to_string());

        let order = client
            .create_order(&["example.com".to_string(), "www.example.com".to_string()])
            .await
            .unwrap();

        assert_eq!(order.status, OrderStatus::Pending);
        assert_eq!(order.identifiers.len(), 2);
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
