//! # HTTP Bearer Token Authentication Module
//!
//! This module provides HTTP Bearer token authentication functionality.
//! It supports OAuth2 flows, JWT tokens, and integration with external identity providers.
//!
//! ## Features
//!
//! - OAuth2 authorization code flow
//! - JWT token validation and parsing
//! - Token refresh capabilities
//! - Integration with popular identity providers
//!
//! ## Security
//!
//! Tokens are validated for expiration and signature.
//! HTTPS is required for all token exchanges.
//!
//! ## Example
//!

use jsonwebtoken::{decode, decode_header, encode, Algorithm, DecodingKey, EncodingKey, Header, Validation};
use oauth2::basic::BasicClient;
use oauth2::{
    AuthUrl, ClientId, ClientSecret, CsrfToken, PkceCodeChallenge, RedirectUrl, Scope, TokenUrl,
};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

/// OAuth2 provider configuration
#[derive(Serialize, Deserialize, Clone)]
pub struct OAuthProvider {
    /// Provider name (e.g., "google", "github", "microsoft")
    pub name: String,
    /// Client ID from the provider
    pub client_id: String,
    /// Client secret from the provider
    pub client_secret: String,
    /// Authorization URL
    pub auth_url: String,
    /// Token URL
    pub token_url: String,
    /// User info URL
    pub user_info_url: String,
    /// Scopes to request
    pub scopes: Vec<String>,
}

/// JWT token claims
#[derive(Debug, Serialize, Deserialize)]
pub struct Claims {
    /// Subject (user identifier)
    pub sub: String,
    /// Expiration time
    pub exp: usize,
    /// Issued at time
    pub iat: usize,
    /// Issuer
    pub iss: String,
}

/// Role carried in an internally-issued session token.
///
/// Kept intentionally small for v1 of the REST API: `Admin` may reach every
/// route, `Readonly` is rejected on mutating routes by the API middleware.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Role {
    /// Full access, including mutating routes.
    Admin,
    /// Read-only access; mutating routes are rejected.
    Readonly,
}

/// Claims for an internally-issued, HS256-signed session token.
///
/// Distinct from [`Claims`] (used for externally-issued RS256 tokens) so the
/// external validation path is untouched and the `role` claim only ever
/// travels on tokens this service mints itself.
#[derive(Debug, Serialize, Deserialize)]
pub struct SessionClaims {
    /// Subject (authenticated username).
    pub sub: String,
    /// Authorization role.
    pub role: Role,
    /// Issued-at time (unix seconds).
    pub iat: usize,
    /// Expiration time (unix seconds).
    pub exp: usize,
}

/// A freshly-issued session token plus the metadata `/auth/login` returns.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SessionToken {
    /// The signed compact JWT.
    pub token: String,
    /// When the token expires.
    pub expires_at: chrono::DateTime<chrono::Utc>,
    /// The role encoded in the token.
    pub role: Role,
}

/// Token information
#[derive(Serialize, Deserialize, Clone)]
pub struct TokenInfo {
    /// Access token
    pub access_token: String,
    /// Refresh token (optional)
    pub refresh_token: Option<String>,
    /// Token type
    pub token_type: String,
    /// Expiration time
    pub expires_at: Option<chrono::DateTime<chrono::Utc>>,
    /// Associated username
    pub username: String,
}

/// Maximum lifetime of an internally-issued session token (1 hour). Requested
/// TTLs are clamped to this so a token can never outlive the short-TTL policy.
const MAX_SESSION_TTL_SECS: i64 = 3600;

/// Minimum acceptable HS256 secret length (256 bits). Signing/verifying with a
/// shorter secret is refused rather than silently weakening the MAC.
const MIN_HS256_SECRET_LEN: usize = 32;

/// HTTP Bearer authentication service state
pub type BearerAuthServiceState = Arc<Mutex<BearerAuthService>>;

/// Service for managing HTTP Bearer token authentication
pub struct BearerAuthService {
    /// HTTP client for API calls
    #[allow(dead_code)]
    client: Client,
    /// OAuth2 providers
    providers: HashMap<String, OAuthProvider>,
    /// Active tokens
    tokens: HashMap<String, TokenInfo>,
    /// JWT validation keys
    jwt_keys: HashMap<String, DecodingKey>,
    /// Revoked session tokens: token string -> the unix-second upper bound
    /// after which the entry can be pruned (a token can never outlive
    /// [`MAX_SESSION_TTL_SECS`], so the set stays bounded without decoding).
    revoked_sessions: HashMap<String, usize>,
}

impl BearerAuthService {
    /// Creates a new Bearer authentication service
    pub fn new() -> BearerAuthServiceState {
        Arc::new(Mutex::new(BearerAuthService {
            client: Client::new(),
            providers: HashMap::new(),
            tokens: HashMap::new(),
            jwt_keys: HashMap::new(),
            revoked_sessions: HashMap::new(),
        }))
    }

    /// Authenticates a user with username/password and returns a Bearer token
    pub async fn authenticate_user(
        &mut self,
        username: String,
        password: String,
        provider_url: Option<String>,
    ) -> Result<String, String> {
        if let Some(provider_url) = provider_url {
            // External provider authentication
            self.authenticate_with_provider(username, password, &provider_url)
                .await
        } else {
            // Local authentication - this would typically call your existing auth service
            // For now, return a mock token
            let token = self.generate_token(&username);
            let token_info = TokenInfo {
                access_token: token.clone(),
                refresh_token: Some(format!("refresh_{}", token)),
                token_type: "Bearer".to_string(),
                expires_at: Some(chrono::Utc::now() + chrono::Duration::hours(1)),
                username: username.clone(),
            };
            self.tokens.insert(token.clone(), token_info);
            Ok(token)
        }
    }

    /// Authenticates with an external OAuth2 provider
    async fn authenticate_with_provider(
        &mut self,
        username: String,
        _password: String,
        provider_url: &str,
    ) -> Result<String, String> {
        // This is a simplified implementation
        // In a real implementation, you would:
        // 1. Redirect user to provider's authorization URL
        // 2. Handle the authorization code callback
        // 3. Exchange code for tokens

        // For now, simulate the flow
        let token = format!("oauth_{}_{}", provider_url, username);
        let token_info = TokenInfo {
            access_token: token.clone(),
            refresh_token: Some(format!("refresh_{}", token)),
            token_type: "Bearer".to_string(),
            expires_at: Some(chrono::Utc::now() + chrono::Duration::hours(1)),
            username,
        };
        self.tokens.insert(token.clone(), token_info);
        Ok(token)
    }

    /// Validates a Bearer token
    pub fn validate_token(&self, token: &str) -> Result<String, String> {
        if let Some(token_info) = self.tokens.get(token) {
            // Check expiration
            if let Some(expires_at) = token_info.expires_at {
                if chrono::Utc::now() > expires_at {
                    return Err("Token expired".to_string());
                }
            }
            Ok(token_info.username.clone())
        } else {
            // Try JWT validation
            self.validate_jwt_token(token)
        }
    }

    /// Validates a JWT token
    fn validate_jwt_token(&self, token: &str) -> Result<String, String> {
        // Try to decode with available keys
        for key in self.jwt_keys.values() {
            let validation = Validation::new(Algorithm::RS256);
            match decode::<Claims>(token, key, &validation) {
                Ok(token_data) => {
                    // Check expiration
                    let now = chrono::Utc::now().timestamp() as usize;
                    if token_data.claims.exp < now {
                        return Err("JWT token expired".to_string());
                    }
                    return Ok(token_data.claims.sub);
                }
                Err(_) => continue,
            }
        }
        Err("Invalid JWT token".to_string())
    }

    /// Refreshes an access token
    pub fn refresh_token(&mut self, refresh_token: &str) -> Result<String, String> {
        // Find the token info by refresh token
        let mut token_to_refresh = None;
        let mut new_token = None;

        for (access_token, token_info) in &self.tokens {
            if token_info.refresh_token.as_ref() == Some(&refresh_token.to_string()) {
                // Generate new token
                let username = token_info.username.clone();
                let new_access_token = self.generate_token(&username);
                let new_token_info = TokenInfo {
                    access_token: new_access_token.clone(),
                    refresh_token: token_info.refresh_token.clone(),
                    token_type: "Bearer".to_string(),
                    expires_at: Some(chrono::Utc::now() + chrono::Duration::hours(1)),
                    username,
                };

                token_to_refresh = Some(access_token.clone());
                new_token = Some((new_access_token, new_token_info));
                break;
            }
        }

        if let (Some(old_token), Some((new_access_token, new_token_info))) =
            (token_to_refresh, new_token)
        {
            self.tokens.remove(&old_token);
            self.tokens.insert(new_access_token.clone(), new_token_info);
            Ok(new_access_token)
        } else {
            Err("Invalid refresh token".to_string())
        }
    }

    /// Adds an OAuth2 provider
    pub async fn add_oauth_provider(&mut self, provider: OAuthProvider) -> Result<(), String> {
        self.providers.insert(provider.name.clone(), provider);
        Ok(())
    }

    /// Initiates OAuth2 authorization flow
    pub fn initiate_oauth_flow(
        &self,
        provider_name: &str,
        redirect_uri: &str,
    ) -> Result<String, String> {
        if let Some(provider) = self.providers.get(provider_name) {
            let client = BasicClient::new(ClientId::new(provider.client_id.clone()))
                .set_client_secret(ClientSecret::new(provider.client_secret.clone()))
                .set_auth_uri(AuthUrl::new(provider.auth_url.clone()).map_err(|e| e.to_string())?)
                .set_token_uri(
                    TokenUrl::new(provider.token_url.clone()).map_err(|e| e.to_string())?,
                )
                .set_redirect_uri(
                    RedirectUrl::new(redirect_uri.to_string()).map_err(|e| e.to_string())?,
                );

            let (pkce_challenge, _pkce_verifier) = PkceCodeChallenge::new_random_sha256();

            let (auth_url, _csrf_token): (_, CsrfToken) = client
                .authorize_url(CsrfToken::new_random)
                .add_scopes(provider.scopes.iter().map(|s| Scope::new(s.clone())))
                .set_pkce_challenge(pkce_challenge)
                .url();

            Ok(auth_url.to_string())
        } else {
            Err("OAuth provider not found".to_string())
        }
    }

    /// Handles OAuth2 callback
    pub async fn handle_oauth_callback(
        &mut self,
        provider_name: &str,
        code: &str,
        _state: &str,
    ) -> Result<String, String> {
        // This would complete the OAuth flow and return a token
        // Simplified implementation
        let token = format!("oauth_callback_{}_{}", provider_name, code);
        Ok(token)
    }

    /// Completes OAuth2 authorization flow
    pub async fn complete_oauth_flow(
        &mut self,
        provider_name: String,
        code: String,
        state: String,
    ) -> Result<String, String> {
        self.handle_oauth_callback(&provider_name, &code, &state)
            .await
    }

    /// Lists available OAuth2 providers
    pub async fn list_providers(&self) -> Vec<String> {
        self.providers.keys().cloned().collect()
    }

    /// Adds a JWT validation key
    pub async fn add_jwt_key(&mut self, issuer: String, key_pem: &str) -> Result<(), String> {
        let key = DecodingKey::from_rsa_pem(key_pem.as_bytes())
            .map_err(|e| format!("Invalid RSA key: {}", e))?;
        self.jwt_keys.insert(issuer, key);
        Ok(())
    }

    /// Generates a cryptographically secure random token
    fn generate_token(&self, _username: &str) -> String {
        use rand::RngCore;
        let mut bytes = [0u8; 32];
        rand::rngs::OsRng.fill_bytes(&mut bytes);
        hex::encode(bytes)
    }

    /// Lists active tokens for a user
    pub async fn list_user_tokens(&self, username: &str) -> Vec<TokenInfo> {
        self.tokens
            .values()
            .filter(|token| token.username == username)
            .cloned()
            .collect()
    }

    /// Revokes a token
    pub async fn revoke_token(&mut self, token: &str) -> Result<(), String> {
        if self.tokens.remove(token).is_some() {
            Ok(())
        } else {
            Err("Token not found".to_string())
        }
    }

    // ---- Internal HS256 session tokens ------------------------------------
    //
    // These are the short-lived, role-carrying tokens the REST API issues on
    // `/auth/login` and accepts as `Authorization: Bearer <jwt>`. They are
    // symmetric (HS256) and keyed by the resolved `JWT_SECRET`, which is
    // passed in by the caller — this module never reads the environment and
    // never logs the secret.

    /// Issues a short-lived HS256 session token for `subject` with `role`.
    ///
    /// `secret` is the resolved `JWT_SECRET` (≥ 256 bits). `ttl_secs` is
    /// clamped into `1..=`[`MAX_SESSION_TTL_SECS`] so a token can never exceed
    /// the short-TTL policy. Returns the signed token together with its expiry
    /// and role (the shape `/auth/login` responds with).
    pub fn issue_session_token(
        &self,
        secret: &[u8],
        subject: &str,
        role: Role,
        ttl_secs: i64,
    ) -> Result<SessionToken, String> {
        if secret.len() < MIN_HS256_SECRET_LEN {
            return Err(format!(
                "JWT secret too short: need at least {} bytes",
                MIN_HS256_SECRET_LEN
            ));
        }
        let ttl = ttl_secs.clamp(1, MAX_SESSION_TTL_SECS);
        let now = chrono::Utc::now();
        let expires_at = now + chrono::Duration::seconds(ttl);
        let claims = SessionClaims {
            sub: subject.to_string(),
            role,
            iat: now.timestamp() as usize,
            exp: expires_at.timestamp() as usize,
        };
        let token = encode(
            &Header::new(Algorithm::HS256),
            &claims,
            &EncodingKey::from_secret(secret),
        )
        .map_err(|e| format!("failed to sign session token: {e}"))?;
        Ok(SessionToken {
            token,
            expires_at,
            role,
        })
    }

    /// Verifies an HS256 session token and returns its claims.
    ///
    /// Enforces, in order: the header algorithm is exactly HS256 (explicit
    /// algorithm-confusion defense — `alg:none` and any asymmetric alg such as
    /// RS256 are rejected before the key is touched); the HS256 signature over
    /// `secret`; expiry; and that the token has not been revoked.
    pub fn verify_session_token(
        &self,
        secret: &[u8],
        token: &str,
    ) -> Result<SessionClaims, String> {
        if secret.len() < MIN_HS256_SECRET_LEN {
            return Err(format!(
                "JWT secret too short: need at least {} bytes",
                MIN_HS256_SECRET_LEN
            ));
        }

        // Algorithm-confusion defense: inspect the header and refuse anything
        // that isn't HS256 before we hand the token to the verifier. `none`
        // has no `Algorithm` variant, so it fails to even parse here.
        let header = decode_header(token).map_err(|e| format!("invalid token header: {e}"))?;
        if header.alg != Algorithm::HS256 {
            return Err(format!("unexpected token algorithm: {:?}", header.alg));
        }

        let mut validation = Validation::new(Algorithm::HS256);
        // Belt-and-suspenders: constrain the verifier's accepted set too.
        validation.algorithms = vec![Algorithm::HS256];
        validation.validate_exp = true;
        validation.validate_aud = false;

        let data = decode::<SessionClaims>(token, &DecodingKey::from_secret(secret), &validation)
            .map_err(|e| format!("session token rejected: {e}"))?;

        if self.is_session_revoked(token) {
            return Err("session token revoked".to_string());
        }

        Ok(data.claims)
    }

    /// Revokes a session token (logout). It stays in the revoke set until an
    /// upper bound that always exceeds the token's own expiry, then is pruned.
    pub fn revoke_session_token(&mut self, token: &str) {
        self.prune_revoked();
        let bound = (chrono::Utc::now().timestamp() + MAX_SESSION_TTL_SECS) as usize;
        self.revoked_sessions.insert(token.to_string(), bound);
    }

    /// Whether a session token is currently in the revoke set.
    fn is_session_revoked(&self, token: &str) -> bool {
        self.revoked_sessions.contains_key(token)
    }

    /// Drops revoke-set entries whose upper bound has passed.
    fn prune_revoked(&mut self) {
        let now = chrono::Utc::now().timestamp() as usize;
        self.revoked_sessions.retain(|_, bound| *bound > now);
    }
}

#[cfg(test)]
mod session_token_tests {
    use super::*;
    use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};

    // 32-byte (256-bit) secrets — the minimum HS256 secret length.
    const SECRET: &[u8] = b"0123456789abcdef0123456789abcdef";
    const OTHER_SECRET: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ012345";

    /// A bare service with no async/network state, for the sync token paths.
    fn service() -> BearerAuthService {
        BearerAuthService {
            client: Client::new(),
            providers: HashMap::new(),
            tokens: HashMap::new(),
            jwt_keys: HashMap::new(),
            revoked_sessions: HashMap::new(),
        }
    }

    /// Hand-builds a compact JWT with an arbitrary `alg` header and a bogus
    /// signature, to exercise the algorithm-confusion defenses.
    fn craft_token(alg: &str) -> String {
        let now = chrono::Utc::now().timestamp() as usize;
        let header = format!(r#"{{"alg":"{alg}","typ":"JWT"}}"#);
        let payload = format!(
            r#"{{"sub":"attacker","role":"admin","iat":{now},"exp":{}}}"#,
            now + 3600
        );
        format!(
            "{}.{}.{}",
            URL_SAFE_NO_PAD.encode(header.as_bytes()),
            URL_SAFE_NO_PAD.encode(payload.as_bytes()),
            URL_SAFE_NO_PAD.encode(b"sig")
        )
    }

    #[test]
    fn roundtrip_sign_then_verify() {
        let svc = service();
        let issued = svc
            .issue_session_token(SECRET, "alice", Role::Admin, 600)
            .unwrap();
        let claims = svc.verify_session_token(SECRET, &issued.token).unwrap();
        assert_eq!(claims.sub, "alice");
        assert_eq!(claims.role, Role::Admin);
        assert_eq!(issued.role, Role::Admin);
    }

    #[test]
    fn wrong_secret_rejected() {
        let svc = service();
        let issued = svc
            .issue_session_token(SECRET, "alice", Role::Admin, 600)
            .unwrap();
        assert!(svc
            .verify_session_token(OTHER_SECRET, &issued.token)
            .is_err());
    }

    #[test]
    fn role_claim_preserved_and_roles_distinguished() {
        let svc = service();
        let admin = svc
            .issue_session_token(SECRET, "root", Role::Admin, 600)
            .unwrap();
        let readonly = svc
            .issue_session_token(SECRET, "guest", Role::Readonly, 600)
            .unwrap();
        assert_eq!(
            svc.verify_session_token(SECRET, &admin.token).unwrap().role,
            Role::Admin
        );
        assert_eq!(
            svc.verify_session_token(SECRET, &readonly.token)
                .unwrap()
                .role,
            Role::Readonly
        );
        assert_ne!(Role::Admin, Role::Readonly);
    }

    #[test]
    fn ttl_clamped_to_max() {
        let svc = service();
        let issued = svc
            .issue_session_token(SECRET, "alice", Role::Admin, 10_000)
            .unwrap();
        // Requested 10_000s but policy caps at MAX_SESSION_TTL_SECS.
        let ceiling = chrono::Utc::now() + chrono::Duration::seconds(MAX_SESSION_TTL_SECS + 5);
        assert!(issued.expires_at <= ceiling);
    }

    #[test]
    fn expired_token_rejected() {
        let svc = service();
        let now = chrono::Utc::now().timestamp() as usize;
        // exp well past the verifier's default 60s leeway.
        let claims = SessionClaims {
            sub: "alice".into(),
            role: Role::Admin,
            iat: now - 7200,
            exp: now - 3600,
        };
        let token = encode(
            &Header::new(Algorithm::HS256),
            &claims,
            &EncodingKey::from_secret(SECRET),
        )
        .unwrap();
        assert!(svc.verify_session_token(SECRET, &token).is_err());
    }

    #[test]
    fn alg_none_rejected() {
        let svc = service();
        let token = craft_token("none");
        assert!(svc.verify_session_token(SECRET, &token).is_err());
    }

    #[test]
    fn non_hs256_alg_rejected() {
        let svc = service();
        // RS256-in-header (classic algorithm-confusion shape) is refused.
        let token = craft_token("RS256");
        assert!(svc.verify_session_token(SECRET, &token).is_err());
    }

    #[test]
    fn revoked_token_rejected() {
        let mut svc = service();
        let issued = svc
            .issue_session_token(SECRET, "alice", Role::Admin, 600)
            .unwrap();
        assert!(svc.verify_session_token(SECRET, &issued.token).is_ok());
        svc.revoke_session_token(&issued.token);
        assert!(svc.verify_session_token(SECRET, &issued.token).is_err());
    }

    #[test]
    fn short_secret_refused_on_issue_and_verify() {
        let svc = service();
        assert!(svc
            .issue_session_token(b"too-short", "alice", Role::Admin, 600)
            .is_err());
        assert!(svc.verify_session_token(b"too-short", "whatever").is_err());
    }
}
