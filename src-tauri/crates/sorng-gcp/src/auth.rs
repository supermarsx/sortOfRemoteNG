//! OAuth2 / JWT authentication for Google Cloud APIs.
//!
//! Implements the service-account JWT → access-token exchange flow as
//! documented at:
//! <https://developers.google.com/identity/protocols/oauth2/service-account>
//!
//! 1. Build a JWT signed with the service account's RSA private key
//! 2. POST it to the token endpoint
//! 3. Receive an access token with an expiry
//! 4. Cache the token and refresh before expiry

use crate::config::ServiceAccountKey;
use chrono::Utc;
use jsonwebtoken::{encode, Algorithm, EncodingKey, Header};
use reqwest::Client;
use serde::{Deserialize, Serialize};

/// JWT claims for Google OAuth2.
#[derive(Debug, Serialize)]
struct JwtClaims {
    /// Issuer — the service account email.
    iss: String,
    /// Requested scopes (space-separated).
    scope: String,
    /// Audience — the token endpoint.
    aud: String,
    /// Expiration (unix timestamp).
    exp: i64,
    /// Issued at (unix timestamp).
    iat: i64,
    /// Optional "subject" for domain-wide delegation.
    #[serde(skip_serializing_if = "Option::is_none")]
    sub: Option<String>,
}

/// An OAuth2 access token with metadata.
#[derive(Debug, Clone)]
pub struct AccessToken {
    /// The bearer token string.
    pub token: String,
    /// When this token expires (unix timestamp seconds).
    pub expires_at: i64,
}

impl AccessToken {
    /// Check if the token is expired (with 60 s buffer).
    pub fn is_expired(&self) -> bool {
        Utc::now().timestamp() >= self.expires_at - 60
    }
}

/// Cached token manager.
pub struct TokenManager {
    service_account: ServiceAccountKey,
    scopes: Vec<String>,
    cached_token: Option<AccessToken>,
    http_client: Client,
    /// Optional impersonation subject (domain-wide delegation).
    subject: Option<String>,
}

impl TokenManager {
    /// Create a new token manager.
    pub fn new(
        service_account: ServiceAccountKey,
        scopes: Vec<String>,
        http_client: Client,
    ) -> Self {
        Self {
            service_account,
            scopes,
            cached_token: None,
            http_client,
            subject: None,
        }
    }

    /// Set impersonation subject for domain-wide delegation.
    pub fn with_subject(mut self, subject: String) -> Self {
        self.subject = Some(subject);
        self
    }

    /// Get a valid access token, refreshing if needed.
    pub async fn get_token(&mut self) -> Result<String, String> {
        if let Some(ref token) = self.cached_token {
            if !token.is_expired() {
                return Ok(token.token.clone());
            }
        }
        let token = self.fetch_new_token().await?;
        let result = token.token.clone();
        self.cached_token = Some(token);
        Ok(result)
    }

    /// Force refresh the token.
    pub async fn refresh(&mut self) -> Result<String, String> {
        self.cached_token = None;
        self.get_token().await
    }

    /// Exchange a JWT assertion for an access token.
    async fn fetch_new_token(&self) -> Result<AccessToken, String> {
        let now = Utc::now().timestamp();

        let claims = JwtClaims {
            iss: self.service_account.client_email.clone(),
            scope: self.scopes.join(" "),
            aud: self.service_account.token_uri.clone(),
            exp: now + 3600,
            iat: now,
            sub: self.subject.clone(),
        };

        let header = Header {
            alg: Algorithm::RS256,
            kid: Some(self.service_account.private_key_id.clone()),
            ..Default::default()
        };

        // Normalise PEM line breaks.
        let pem = self
            .service_account
            .private_key
            .replace("\\n", "\n");

        let encoding_key = EncodingKey::from_rsa_pem(pem.as_bytes())
            .map_err(|e| format!("Failed to load private key: {}", e))?;

        let jwt = encode(&header, &claims, &encoding_key)
            .map_err(|e| format!("Failed to encode JWT: {}", e))?;

        // Exchange for access token.
        let mut form = std::collections::HashMap::new();
        form.insert("grant_type", "urn:ietf:params:oauth:grant-type:jwt-bearer");
        form.insert("assertion", &jwt);

        let response = self
            .http_client
            .post(&self.service_account.token_uri)
            .form(&form)
            .send()
            .await
            .map_err(|e| format!("Token exchange request failed: {}", e))?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(format!("Token exchange failed (HTTP {}): {}", status, body));
        }

        #[derive(Deserialize)]
        struct TokenResponse {
            access_token: String,
            expires_in: Option<i64>,
            #[allow(dead_code)]
            token_type: Option<String>,
        }

        let token_resp: TokenResponse = response
            .json()
            .await
            .map_err(|e| format!("Failed to parse token response: {}", e))?;

        let expires_at = now + token_resp.expires_in.unwrap_or(3600);

        Ok(AccessToken {
            token: token_resp.access_token,
            expires_at,
        })
    }

    /// Get the project ID from the service account key.
    pub fn project_id(&self) -> &str {
        &self.service_account.project_id
    }

    /// Get the service account email.
    pub fn service_account_email(&self) -> &str {
        &self.service_account.client_email
    }
}
