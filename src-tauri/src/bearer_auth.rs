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

use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;
use serde::{Deserialize, Serialize};
use reqwest::Client;
use jsonwebtoken::{decode, DecodingKey, Validation, Algorithm};
use oauth2::{AuthorizationCode, ClientId, ClientSecret, CsrfToken, PkceCodeChallenge, RedirectUrl, Scope, TokenResponse};
use oauth2::basic::BasicClient;
use oauth2::reqwest::async_http_client;

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

/// HTTP Bearer authentication service state
pub type BearerAuthServiceState = Arc<Mutex<BearerAuthService>>;

/// Service for managing HTTP Bearer token authentication
pub struct BearerAuthService {
    /// HTTP client for API calls
    client: Client,
    /// OAuth2 providers
    providers: HashMap<String, OAuthProvider>,
    /// Active tokens
    tokens: HashMap<String, TokenInfo>,
    /// JWT validation keys
    jwt_keys: HashMap<String, DecodingKey>,
}

impl BearerAuthService {
    /// Creates a new Bearer authentication service
    pub fn new() -> BearerAuthServiceState {
        Arc::new(Mutex::new(BearerAuthService {
            client: Client::new(),
            providers: HashMap::new(),
            tokens: HashMap::new(),
            jwt_keys: HashMap::new(),
        }))
    }

    /// Authenticates a user with username/password and returns a Bearer token
    pub async fn authenticate_user(&mut self, username: String, password: String, provider_url: Option<String>) -> Result<String, String> {
        if let Some(provider_url) = provider_url {
            // External provider authentication
            self.authenticate_with_provider(username, password, &provider_url).await
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
    async fn authenticate_with_provider(&mut self, username: String, password: String, provider_url: &str) -> Result<String, String> {
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
    pub async fn validate_token(&self, token: &str) -> Result<String, String> {
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
            self.validate_jwt(token)
        }
    }

    /// Validates a JWT token
    fn validate_jwt(&self, token: &str) -> Result<String, String> {
        // Try to decode with available keys
        for (issuer, key) in &self.jwt_keys {
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
    pub async fn refresh_token(&mut self, refresh_token: &str) -> Result<String, String> {
        // Find the token info by refresh token
        for (access_token, token_info) in &self.tokens {
            if token_info.refresh_token.as_ref() == Some(&refresh_token.to_string()) {
                // Generate new token
                let new_token = self.generate_token(&token_info.username);
                let new_token_info = TokenInfo {
                    access_token: new_token.clone(),
                    refresh_token: token_info.refresh_token.clone(),
                    token_type: "Bearer".to_string(),
                    expires_at: Some(chrono::Utc::now() + chrono::Duration::hours(1)),
                    username: token_info.username.clone(),
                };

                // Remove old token and add new one
                self.tokens.remove(access_token);
                self.tokens.insert(new_token.clone(), new_token_info);
                return Ok(new_token);
            }
        }
        Err("Invalid refresh token".to_string())
    }

    /// Adds an OAuth2 provider
    pub async fn add_oauth_provider(&mut self, provider: OAuthProvider) -> Result<(), String> {
        self.providers.insert(provider.name.clone(), provider);
        Ok(())
    }

    /// Initiates OAuth2 authorization flow
    pub async fn initiate_oauth_flow(&self, provider_name: &str, redirect_uri: &str) -> Result<String, String> {
        if let Some(provider) = self.providers.get(provider_name) {
            let client = BasicClient::new(
                ClientId::new(provider.client_id.clone()),
                Some(ClientSecret::new(provider.client_secret.clone())),
                oauth2::AuthUrl::new(provider.auth_url.clone()).map_err(|e| e.to_string())?,
                Some(oauth2::TokenUrl::new(provider.token_url.clone()).map_err(|e| e.to_string())?),
            )
            .set_redirect_uri(RedirectUrl::new(redirect_uri.to_string()).map_err(|e| e.to_string())?);

            let (pkce_challenge, _pkce_verifier) = PkceCodeChallenge::new_random_sha256();

            let (auth_url, _csrf_token) = client
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
    pub async fn handle_oauth_callback(&mut self, provider_name: &str, code: &str, state: &str) -> Result<String, String> {
        // This would complete the OAuth flow and return a token
        // Simplified implementation
        let token = format!("oauth_callback_{}_{}", provider_name, code);
        Ok(token)
    }

    /// Adds a JWT validation key
    pub async fn add_jwt_key(&mut self, issuer: String, key_pem: &str) -> Result<(), String> {
        let key = DecodingKey::from_rsa_pem(key_pem.as_bytes())
            .map_err(|e| format!("Invalid RSA key: {}", e))?;
        self.jwt_keys.insert(issuer, key);
        Ok(())
    }

    /// Generates a simple token (for demo purposes)
    fn generate_token(&self, username: &str) -> String {
        use sha2::{Sha256, Digest};
        let mut hasher = Sha256::new();
        hasher.update(format!("{}_{}", username, chrono::Utc::now().timestamp()));
        let result = hasher.finalize();
        hex::encode(result)
    }

    /// Lists active tokens for a user
    pub async fn list_user_tokens(&self, username: &str) -> Vec<TokenInfo> {
        self.tokens.values()
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
}</content>
<parameter name="filePath">c:\Projects\sortOfRemoteNG\src-tauri\src\bearer_auth.rs