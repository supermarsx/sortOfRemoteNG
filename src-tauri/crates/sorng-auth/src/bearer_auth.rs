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

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use jsonwebtoken::{
    decode, decode_header, encode, Algorithm, DecodingKey, EncodingKey, Header, Validation,
};
use oauth2::basic::BasicClient;
use oauth2::{
    AuthUrl, ClientId, ClientSecret, CsrfToken, PkceCodeChallenge, RedirectUrl, Scope, TokenUrl,
};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::Mutex;
use url::Url;
use zeroize::{Zeroize, Zeroizing};

/// OAuth2 provider configuration
#[derive(Serialize, Deserialize, Clone)]
pub struct OAuthProvider {
    /// Provider name (e.g., "google", "github", "microsoft")
    pub name: String,
    /// Client ID from the provider
    pub client_id: String,
    /// Client secret from the provider
    #[serde(skip_serializing, default)]
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

/// OAuth callbacks must complete promptly. Pending state is also capped so an
/// unauthenticated caller cannot grow the service indefinitely.
const OAUTH_FLOW_TTL_SECS: i64 = 600;
const MAX_PENDING_OAUTH_FLOWS: usize = 128;
const MAX_OAUTH_RESPONSE_BYTES: usize = 64 * 1024;
const MAX_OAUTH_CODE_BYTES: usize = 8 * 1024;
const MAX_JWT_BYTES: usize = 64 * 1024;
const MAX_JWT_PAYLOAD_BYTES: usize = 16 * 1024;
const OAUTH_CONNECT_TIMEOUT: Duration = Duration::from_secs(5);
const OAUTH_TOTAL_TIMEOUT: Duration = Duration::from_secs(15);
const OAUTH_READ_TIMEOUT: Duration = Duration::from_secs(10);
const OAUTH_AUTHENTICATION_UNSUPPORTED: &str =
    "Provider OAuth authentication is unsupported until identity validation and session issuance are implemented";

struct JwtIssuerConfig {
    key: DecodingKey,
    algorithm: Algorithm,
    audience: String,
}

#[derive(Deserialize)]
struct UnverifiedIssuer {
    iss: Option<String>,
}

#[derive(Clone)]
struct StoredOAuthProvider {
    name: String,
    client_id: String,
    client_secret: String,
    auth_url: String,
    token_url: String,
    user_info_url: String,
    scopes: Vec<String>,
}

impl StoredOAuthProvider {
    fn from_public(mut provider: OAuthProvider) -> Self {
        Self {
            name: std::mem::take(&mut provider.name),
            client_id: std::mem::take(&mut provider.client_id),
            client_secret: std::mem::take(&mut provider.client_secret),
            auth_url: std::mem::take(&mut provider.auth_url),
            token_url: std::mem::take(&mut provider.token_url),
            user_info_url: std::mem::take(&mut provider.user_info_url),
            scopes: std::mem::take(&mut provider.scopes),
        }
    }

    fn zeroize_sensitive(&mut self) {
        self.name.zeroize();
        self.client_id.zeroize();
        self.client_secret.zeroize();
        self.auth_url.zeroize();
        self.token_url.zeroize();
        self.user_info_url.zeroize();
        self.scopes.zeroize();
    }
}

impl Drop for StoredOAuthProvider {
    fn drop(&mut self) {
        self.zeroize_sensitive();
    }
}

struct PendingOAuthFlow {
    provider: StoredOAuthProvider,
    redirect_uri: String,
    pkce_verifier: String,
    expires_at_unix: i64,
}

impl PendingOAuthFlow {
    fn zeroize_sensitive(&mut self) {
        self.redirect_uri.zeroize();
        self.pkce_verifier.zeroize();
    }
}

impl Drop for PendingOAuthFlow {
    fn drop(&mut self) {
        self.zeroize_sensitive();
    }
}

struct OAuthExchangeRequest {
    token_url: Url,
    client_id: String,
    client_secret: String,
    code: String,
    redirect_uri: String,
    pkce_verifier: String,
}

impl OAuthExchangeRequest {
    fn zeroize_sensitive(&mut self) {
        self.client_id.zeroize();
        self.client_secret.zeroize();
        self.code.zeroize();
        self.redirect_uri.zeroize();
        self.pkce_verifier.zeroize();
    }
}

impl Drop for OAuthExchangeRequest {
    fn drop(&mut self) {
        self.zeroize_sensitive();
    }
}

struct OAuthExchangeResponse {
    access_token: String,
    refresh_token: Option<String>,
    token_type: String,
    _expires_at: Option<chrono::DateTime<chrono::Utc>>,
}

impl OAuthExchangeResponse {
    fn zeroize_sensitive(&mut self) {
        self.access_token.zeroize();
        self.refresh_token.zeroize();
        self.token_type.zeroize();
    }
}

impl Drop for OAuthExchangeResponse {
    fn drop(&mut self) {
        self.zeroize_sensitive();
    }
}

type OAuthExchangeFuture<'a> =
    Pin<Box<dyn Future<Output = Result<OAuthExchangeResponse, String>> + Send + 'a>>;

trait OAuthExchangeClient: Send + Sync {
    fn exchange<'a>(&'a self, request: OAuthExchangeRequest) -> OAuthExchangeFuture<'a>;
}

struct ReqwestOAuthExchangeClient {
    client: Client,
    max_response_bytes: usize,
}

#[derive(Clone, Copy)]
struct OAuthHttpPolicy {
    connect_timeout: Duration,
    total_timeout: Duration,
    read_timeout: Duration,
    follow_redirects: bool,
    max_response_bytes: usize,
}

impl OAuthHttpPolicy {
    const fn bounded() -> Self {
        Self {
            connect_timeout: OAUTH_CONNECT_TIMEOUT,
            total_timeout: OAUTH_TOTAL_TIMEOUT,
            read_timeout: OAUTH_READ_TIMEOUT,
            follow_redirects: false,
            max_response_bytes: MAX_OAUTH_RESPONSE_BYTES,
        }
    }
}

fn build_oauth_exchange_client() -> Result<ReqwestOAuthExchangeClient, String> {
    let policy = OAuthHttpPolicy::bounded();
    let redirect_policy = if policy.follow_redirects {
        reqwest::redirect::Policy::limited(1)
    } else {
        reqwest::redirect::Policy::none()
    };
    let client = Client::builder()
        .connect_timeout(policy.connect_timeout)
        .timeout(policy.total_timeout)
        .read_timeout(policy.read_timeout)
        .redirect(redirect_policy)
        .build()
        .map_err(|_| "OAuth HTTP transport is unavailable".to_string())?;
    Ok(ReqwestOAuthExchangeClient {
        client,
        max_response_bytes: policy.max_response_bytes,
    })
}

struct UnavailableOAuthExchangeClient;

impl OAuthExchangeClient for UnavailableOAuthExchangeClient {
    fn exchange<'a>(&'a self, _request: OAuthExchangeRequest) -> OAuthExchangeFuture<'a> {
        Box::pin(async { Err("OAuth HTTP transport is unavailable".to_string()) })
    }
}

#[derive(Deserialize)]
struct OAuthTokenEndpointResponse {
    access_token: String,
    refresh_token: Option<String>,
    token_type: String,
    expires_in: Option<u64>,
}

impl OAuthTokenEndpointResponse {
    fn zeroize_sensitive(&mut self) {
        self.access_token.zeroize();
        self.refresh_token.zeroize();
        self.token_type.zeroize();
    }
}

impl Drop for OAuthTokenEndpointResponse {
    fn drop(&mut self) {
        self.zeroize_sensitive();
    }
}

impl OAuthExchangeClient for ReqwestOAuthExchangeClient {
    fn exchange<'a>(&'a self, request: OAuthExchangeRequest) -> OAuthExchangeFuture<'a> {
        Box::pin(async move {
            let form = [
                ("grant_type", "authorization_code"),
                ("code", request.code.as_str()),
                ("redirect_uri", request.redirect_uri.as_str()),
                ("client_id", request.client_id.as_str()),
                ("client_secret", request.client_secret.as_str()),
                ("code_verifier", request.pkce_verifier.as_str()),
            ];

            let mut response = self
                .client
                .post(request.token_url.as_str())
                .header(reqwest::header::ACCEPT, "application/json")
                .form(&form)
                .send()
                .await
                .map_err(|_| "OAuth token exchange failed".to_string())?;

            if !response.status().is_success() {
                return Err("OAuth token endpoint rejected the request".to_string());
            }
            if response
                .content_length()
                .is_some_and(|length| length > self.max_response_bytes as u64)
            {
                return Err("OAuth token response exceeded the size limit".to_string());
            }

            let mut body = Zeroizing::new(Vec::new());
            while let Some(chunk) = response
                .chunk()
                .await
                .map_err(|_| "OAuth token response could not be read".to_string())?
            {
                if body.len().saturating_add(chunk.len()) > self.max_response_bytes {
                    return Err("OAuth token response exceeded the size limit".to_string());
                }
                body.extend_from_slice(&chunk);
            }

            let mut payload: OAuthTokenEndpointResponse =
                serde_json::from_slice(body.as_slice())
                    .map_err(|_| "OAuth token response was invalid".to_string())?;
            if payload.access_token.is_empty() || payload.access_token.len() > 16 * 1024 {
                return Err("OAuth token response contained an invalid access token".to_string());
            }
            if payload.token_type.is_empty()
                || payload.token_type.len() > 128
                || !payload.token_type.eq_ignore_ascii_case("bearer")
            {
                return Err("OAuth token response contained an unsupported token type".to_string());
            }
            if payload
                .refresh_token
                .as_ref()
                .is_some_and(|token| token.is_empty() || token.len() > 16 * 1024)
            {
                return Err("OAuth token response contained an invalid refresh token".to_string());
            }

            let expires_at = match payload.expires_in {
                Some(0) => {
                    return Err("OAuth token response was already expired".to_string());
                }
                Some(seconds) => i64::try_from(seconds)
                    .ok()
                    .and_then(|seconds| {
                        chrono::Utc::now().checked_add_signed(chrono::Duration::seconds(seconds))
                    })
                    .ok_or_else(|| "OAuth token lifetime was invalid".to_string())?
                    .into(),
                None => None,
            };

            Ok(OAuthExchangeResponse {
                access_token: std::mem::take(&mut payload.access_token),
                refresh_token: std::mem::take(&mut payload.refresh_token),
                token_type: std::mem::take(&mut payload.token_type),
                _expires_at: expires_at,
            })
        })
    }
}

/// HTTP Bearer authentication service state
pub type BearerAuthServiceState = Arc<Mutex<BearerAuthService>>;

/// Service for managing HTTP Bearer token authentication
pub struct BearerAuthService {
    /// OAuth2 providers
    providers: HashMap<String, StoredOAuthProvider>,
    /// Single-use OAuth transactions keyed by their CSRF state.
    pending_oauth_flows: HashMap<String, PendingOAuthFlow>,
    /// Prepared for a future, fully owned provider-login integration. Generic
    /// OAuth commands remain unregistered and callbacks currently fail closed.
    _oauth_exchange_client: Arc<dyn OAuthExchangeClient>,
    /// Active tokens
    tokens: HashMap<String, TokenInfo>,
    /// External JWT policy, keyed by the exact trusted issuer.
    jwt_issuers: HashMap<String, JwtIssuerConfig>,
    /// Revoked session tokens: token string -> the unix-second upper bound
    /// after which the entry can be pruned (a token can never outlive
    /// [`MAX_SESSION_TTL_SECS`], so the set stays bounded without decoding).
    revoked_sessions: HashMap<String, usize>,
}

impl BearerAuthService {
    /// Creates a new Bearer authentication service
    pub fn new() -> BearerAuthServiceState {
        let oauth_exchange_client: Arc<dyn OAuthExchangeClient> =
            match build_oauth_exchange_client() {
                Ok(client) => Arc::new(client),
                Err(_) => Arc::new(UnavailableOAuthExchangeClient),
            };
        Arc::new(Mutex::new(BearerAuthService {
            providers: HashMap::new(),
            pending_oauth_flows: HashMap::new(),
            _oauth_exchange_client: oauth_exchange_client,
            tokens: HashMap::new(),
            jwt_issuers: HashMap::new(),
            revoked_sessions: HashMap::new(),
        }))
    }

    /// Authenticates a user with username/password and returns a Bearer token
    pub async fn authenticate_user(
        &mut self,
        mut username: String,
        mut password: String,
        mut provider_url: Option<String>,
    ) -> Result<String, String> {
        let result = if provider_url.is_some() {
            Err(OAUTH_AUTHENTICATION_UNSUPPORTED.to_string())
        } else {
            Err(
                "Local username/password bearer authentication is not wired to the auth service; refusing to issue a token"
                    .to_string(),
            )
        };
        username.zeroize();
        password.zeroize();
        provider_url.zeroize();
        result
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
        if token.is_empty() || token.len() > MAX_JWT_BYTES {
            return Err("Invalid JWT token".to_string());
        }

        let header = decode_header(token).map_err(|_| "Invalid JWT token".to_string())?;
        let issuer = Self::unverified_jwt_issuer(token)?;
        let config = self
            .jwt_issuers
            .get(&issuer)
            .ok_or_else(|| "JWT issuer is not trusted".to_string())?;
        if header.alg != config.algorithm {
            return Err("JWT algorithm is not permitted for issuer".to_string());
        }

        let mut validation = Validation::new(config.algorithm);
        validation.algorithms = vec![config.algorithm];
        validation.set_issuer(&[issuer.as_str()]);
        validation.set_audience(&[config.audience.as_str()]);
        validation.required_spec_claims.insert("iss".to_string());
        validation.required_spec_claims.insert("aud".to_string());
        validation.validate_exp = true;
        validation.validate_aud = true;

        decode::<Claims>(token, &config.key, &validation)
            .map(|data| data.claims.sub)
            .map_err(|_| "JWT token rejected".to_string())
    }

    fn unverified_jwt_issuer(token: &str) -> Result<String, String> {
        let mut segments = token.split('.');
        let _header = segments.next();
        let payload = segments
            .next()
            .ok_or_else(|| "Invalid JWT token".to_string())?;
        if segments.next().is_none()
            || segments.next().is_some()
            || payload.len() > MAX_JWT_PAYLOAD_BYTES
        {
            return Err("Invalid JWT token".to_string());
        }
        let payload = URL_SAFE_NO_PAD
            .decode(payload)
            .map_err(|_| "Invalid JWT token".to_string())?;
        if payload.len() > MAX_JWT_PAYLOAD_BYTES {
            return Err("Invalid JWT token".to_string());
        }
        let claims: UnverifiedIssuer =
            serde_json::from_slice(&payload).map_err(|_| "Invalid JWT token".to_string())?;
        claims
            .iss
            .filter(|issuer| !issuer.is_empty() && issuer.len() <= 512)
            .ok_or_else(|| "JWT issuer claim is missing".to_string())
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

    /// Stores configuration for the unregistered, experimental OAuth helper.
    #[doc(hidden)]
    pub async fn add_oauth_provider(&mut self, mut provider: OAuthProvider) -> Result<(), String> {
        if let Err(error) = Self::validate_oauth_provider(&provider) {
            Self::zeroize_oauth_provider(&mut provider);
            return Err(error);
        }
        let provider = StoredOAuthProvider::from_public(provider);
        self.providers.insert(provider.name.clone(), provider);
        Ok(())
    }

    /// Builds an authorization URL for the unregistered, experimental helper.
    /// Completion cannot authenticate an application user until provider
    /// identity validation and session issuance have a real owner.
    #[doc(hidden)]
    pub fn initiate_oauth_flow(
        &mut self,
        provider_name: &str,
        redirect_uri: &str,
    ) -> Result<String, String> {
        self.prune_oauth_state();
        if self.pending_oauth_flows.len() >= MAX_PENDING_OAUTH_FLOWS {
            return Err("Too many OAuth authorization flows are pending".to_string());
        }
        let provider = self
            .providers
            .get(provider_name)
            .cloned()
            .ok_or_else(|| "OAuth provider is not configured".to_string())?;
        Self::validate_redirect_uri(redirect_uri)?;

        let client = BasicClient::new(ClientId::new(provider.client_id.clone()))
            .set_client_secret(ClientSecret::new(provider.client_secret.clone()))
            .set_auth_uri(
                AuthUrl::new(provider.auth_url.clone())
                    .map_err(|_| "OAuth authorization endpoint is invalid".to_string())?,
            )
            .set_token_uri(
                TokenUrl::new(provider.token_url.clone())
                    .map_err(|_| "OAuth token endpoint is invalid".to_string())?,
            )
            .set_redirect_uri(
                RedirectUrl::new(redirect_uri.to_string())
                    .map_err(|_| "OAuth redirect URI is invalid".to_string())?,
            );

        let (pkce_challenge, pkce_verifier) = PkceCodeChallenge::new_random_sha256();
        let (auth_url, csrf_token): (_, CsrfToken) = client
            .authorize_url(CsrfToken::new_random)
            .add_scopes(
                provider
                    .scopes
                    .iter()
                    .map(|scope| Scope::new(scope.clone())),
            )
            .set_pkce_challenge(pkce_challenge)
            .url();
        let state = csrf_token.secret().to_string();
        if self.pending_oauth_flows.contains_key(&state) {
            return Err("Could not allocate unique OAuth state".to_string());
        }
        self.pending_oauth_flows.insert(
            state,
            PendingOAuthFlow {
                provider,
                redirect_uri: redirect_uri.to_string(),
                pkce_verifier: pkce_verifier.secret().to_string(),
                expires_at_unix: chrono::Utc::now().timestamp() + OAUTH_FLOW_TTL_SECS,
            },
        );

        Ok(auth_url.to_string())
    }

    /// Consumes an experimental OAuth callback without exchanging its code.
    /// This deliberately fails closed until a complete identity-validation and
    /// application-session issuance path exists.
    #[doc(hidden)]
    pub async fn handle_oauth_callback(
        &mut self,
        provider_name: &str,
        code: &str,
        state: &str,
    ) -> Result<String, String> {
        if provider_name.is_empty()
            || provider_name.len() > 128
            || code.is_empty()
            || code.len() > MAX_OAUTH_CODE_BYTES
            || state.is_empty()
            || state.len() > 512
        {
            return Err("OAuth callback parameters are invalid".to_string());
        }

        self.prune_oauth_state();
        let (mut stored_state, flow) = self
            .pending_oauth_flows
            .remove_entry(state)
            .ok_or_else(|| "OAuth callback state is invalid or expired".to_string())?;
        stored_state.zeroize();
        if flow.expires_at_unix <= chrono::Utc::now().timestamp() {
            return Err("OAuth callback state is invalid or expired".to_string());
        }
        if flow.provider.name != provider_name {
            return Err(
                "OAuth callback provider does not match the authorization flow".to_string(),
            );
        }
        Err(OAUTH_AUTHENTICATION_UNSUPPORTED.to_string())
    }

    /// Completes the unregistered, experimental helper and zeroizes owned
    /// callback parameters before returning its fail-closed result.
    #[doc(hidden)]
    pub async fn complete_oauth_flow(
        &mut self,
        mut provider_name: String,
        mut code: String,
        mut state: String,
    ) -> Result<String, String> {
        let result = self
            .handle_oauth_callback(&provider_name, &code, &state)
            .await;
        provider_name.zeroize();
        code.zeroize();
        state.zeroize();
        result
    }

    /// Lists configurations for the unregistered, experimental OAuth helper.
    #[doc(hidden)]
    pub async fn list_providers(&self) -> Vec<String> {
        self.providers.keys().cloned().collect()
    }

    /// Adds an RS256 validation key using the issuer itself as the audience.
    /// Prefer [`Self::add_jwt_issuer`] when the provider has a distinct client
    /// ID or resource audience.
    pub async fn add_jwt_key(&mut self, issuer: String, key_pem: &str) -> Result<(), String> {
        let audience = issuer.clone();
        self.add_jwt_issuer(issuer, audience, key_pem).await
    }

    /// Adds the exact issuer/key/algorithm/audience policy for an external
    /// RS256 token. Validation never tries a key belonging to another issuer.
    pub async fn add_jwt_issuer(
        &mut self,
        issuer: String,
        audience: String,
        key_pem: &str,
    ) -> Result<(), String> {
        if issuer.is_empty() || issuer.len() > 512 || audience.is_empty() || audience.len() > 512 {
            return Err("JWT issuer and audience must be configured".to_string());
        }
        let key = DecodingKey::from_rsa_pem(key_pem.as_bytes())
            .map_err(|_| "Invalid RSA validation key".to_string())?;
        self.jwt_issuers.insert(
            issuer,
            JwtIssuerConfig {
                key,
                algorithm: Algorithm::RS256,
                audience,
            },
        );
        Ok(())
    }

    fn validate_oauth_provider(provider: &OAuthProvider) -> Result<(), String> {
        if provider.name.is_empty()
            || provider.name.len() > 128
            || provider.client_id.is_empty()
            || provider.client_id.len() > 4 * 1024
            || provider.client_secret.is_empty()
            || provider.client_secret.len() > 16 * 1024
            || provider.scopes.len() > 64
            || provider
                .scopes
                .iter()
                .any(|scope| scope.is_empty() || scope.len() > 256)
        {
            return Err("OAuth provider configuration is incomplete".to_string());
        }
        Self::validate_https_endpoint(&provider.auth_url, "authorization")?;
        Self::validate_https_endpoint(&provider.token_url, "token")?;
        if !provider.user_info_url.is_empty() {
            Self::validate_https_endpoint(&provider.user_info_url, "user information")?;
        }
        Ok(())
    }

    fn zeroize_oauth_provider(provider: &mut OAuthProvider) {
        provider.name.zeroize();
        provider.client_id.zeroize();
        provider.client_secret.zeroize();
        provider.auth_url.zeroize();
        provider.token_url.zeroize();
        provider.user_info_url.zeroize();
        provider.scopes.zeroize();
    }

    fn validate_https_endpoint(endpoint: &str, label: &str) -> Result<(), String> {
        let url = Url::parse(endpoint).map_err(|_| format!("OAuth {label} endpoint is invalid"))?;
        if url.scheme() != "https"
            || !url.username().is_empty()
            || url.password().is_some()
            || url.fragment().is_some()
            || url.host_str().is_none()
        {
            return Err(format!("OAuth {label} endpoint must be an HTTPS URL"));
        }
        Ok(())
    }

    fn validate_redirect_uri(redirect_uri: &str) -> Result<(), String> {
        let url =
            Url::parse(redirect_uri).map_err(|_| "OAuth redirect URI is invalid".to_string())?;
        if !url.username().is_empty() || url.password().is_some() || url.fragment().is_some() {
            return Err("OAuth redirect URI is invalid".to_string());
        }
        if url.scheme() == "http"
            && !url.host_str().is_some_and(|host| {
                host.eq_ignore_ascii_case("localhost")
                    || host
                        .parse::<std::net::IpAddr>()
                        .is_ok_and(|ip| ip.is_loopback())
            })
        {
            return Err("OAuth HTTP redirect URI must use a loopback host".to_string());
        }
        Ok(())
    }

    fn prune_oauth_state(&mut self) {
        let now = chrono::Utc::now().timestamp();
        let mut retained = HashMap::with_capacity(self.pending_oauth_flows.len());
        for (mut state, flow) in self.pending_oauth_flows.drain() {
            if flow.expires_at_unix > now {
                retained.insert(state, flow);
            } else {
                state.zeroize();
            }
        }
        self.pending_oauth_flows = retained;
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
            providers: HashMap::new(),
            pending_oauth_flows: HashMap::new(),
            oauth_credentials: HashMap::new(),
            oauth_exchange_client: Arc::new(ReqwestOAuthExchangeClient {
                client: Client::new(),
            }),
            tokens: HashMap::new(),
            jwt_issuers: HashMap::new(),
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

    #[derive(Serialize)]
    struct ExternalClaims<'a> {
        sub: &'a str,
        exp: usize,
        iat: usize,
        #[serde(skip_serializing_if = "Option::is_none")]
        iss: Option<&'a str>,
        aud: &'a str,
    }

    fn rsa_keypair() -> (String, String) {
        use rsa::pkcs8::{EncodePrivateKey, EncodePublicKey, LineEnding};
        let private = rsa::RsaPrivateKey::new(&mut rand::rngs::OsRng, 2048).unwrap();
        let private_pem = private.to_pkcs8_pem(LineEnding::LF).unwrap().to_string();
        let public_pem = private
            .to_public_key()
            .to_public_key_pem(LineEnding::LF)
            .unwrap();
        (private_pem, public_pem)
    }

    fn external_token(private_pem: &str, issuer: Option<&str>, audience: &str) -> String {
        let now = chrono::Utc::now().timestamp() as usize;
        encode(
            &Header::new(Algorithm::RS256),
            &ExternalClaims {
                sub: "external-user",
                exp: now + 600,
                iat: now,
                iss: issuer,
                aud: audience,
            },
            &EncodingKey::from_rsa_pem(private_pem.as_bytes()).unwrap(),
        )
        .unwrap()
    }

    #[tokio::test]
    async fn rs256_is_bound_to_exact_issuer_key_and_audience() {
        let (private_a, public_a) = rsa_keypair();
        let (private_b, public_b) = rsa_keypair();
        let mut svc = service();
        svc.add_jwt_issuer(
            "https://issuer-a.example".into(),
            "audience-a".into(),
            &public_a,
        )
        .await
        .unwrap();
        svc.add_jwt_issuer(
            "https://issuer-b.example".into(),
            "audience-b".into(),
            &public_b,
        )
        .await
        .unwrap();

        let valid = external_token(&private_b, Some("https://issuer-b.example"), "audience-b");
        assert_eq!(svc.validate_jwt_token(&valid).unwrap(), "external-user");

        // A token signed by issuer B's valid key cannot claim issuer A: only
        // issuer A's configured key is selected.
        let cross_issuer =
            external_token(&private_b, Some("https://issuer-a.example"), "audience-a");
        assert!(svc.validate_jwt_token(&cross_issuer).is_err());

        let wrong_audience =
            external_token(&private_b, Some("https://issuer-b.example"), "audience-a");
        assert!(svc.validate_jwt_token(&wrong_audience).is_err());

        let unknown = external_token(&private_a, Some("https://unknown.example"), "audience-a");
        assert!(svc.validate_jwt_token(&unknown).is_err());

        let missing = external_token(&private_a, None, "audience-a");
        assert!(svc.validate_jwt_token(&missing).is_err());
    }

    struct MockOAuthExchangeClient {
        calls: Arc<std::sync::atomic::AtomicUsize>,
    }

    impl OAuthExchangeClient for MockOAuthExchangeClient {
        fn exchange<'a>(&'a self, request: OAuthExchangeRequest) -> OAuthExchangeFuture<'a> {
            self.calls.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            Box::pin(async move {
                assert_eq!(request.token_url.as_str(), "https://identity.example/token");
                assert!(!request.code.is_empty());
                assert!(!request.pkce_verifier.is_empty());
                Ok(OAuthExchangeResponse {
                    access_token: "provider-access-secret".to_string(),
                    refresh_token: Some("provider-refresh-secret".to_string()),
                    token_type: "Bearer".to_string(),
                    _expires_at: Some(chrono::Utc::now() + chrono::Duration::minutes(5)),
                })
            })
        }
    }

    fn oauth_provider() -> OAuthProvider {
        OAuthProvider {
            name: "example".to_string(),
            client_id: "client-id".to_string(),
            client_secret: "client-secret".to_string(),
            auth_url: "https://identity.example/authorize".to_string(),
            token_url: "https://identity.example/token".to_string(),
            user_info_url: "https://identity.example/userinfo".to_string(),
            scopes: vec!["openid".to_string()],
        }
    }

    fn oauth_state(authorization_url: &str) -> String {
        Url::parse(authorization_url)
            .unwrap()
            .query_pairs()
            .find_map(|(name, value)| (name == "state").then(|| value.into_owned()))
            .unwrap()
    }

    fn oauth_service(calls: Arc<std::sync::atomic::AtomicUsize>) -> BearerAuthService {
        let mut svc = service();
        svc._oauth_exchange_client = Arc::new(MockOAuthExchangeClient { calls });
        svc
    }

    #[tokio::test]
    async fn oauth_state_is_single_use_and_completion_fails_closed_without_exchange() {
        use std::sync::atomic::Ordering;
        let calls = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let mut svc = oauth_service(Arc::clone(&calls));
        svc.add_oauth_provider(oauth_provider()).await.unwrap();
        let authorization_url = svc
            .initiate_oauth_flow("example", "http://127.0.0.1:43119/callback")
            .unwrap();
        assert!(Url::parse(&authorization_url)
            .unwrap()
            .query_pairs()
            .any(|(name, value)| name == "code_challenge" && !value.is_empty()));
        let state = oauth_state(&authorization_url);

        let mismatch = svc
            .handle_oauth_callback("example", "raw-code-secret", "wrong-state")
            .await
            .unwrap_err();
        assert!(!mismatch.contains("raw-code-secret"));
        assert_eq!(calls.load(Ordering::SeqCst), 0);

        let completion_error = svc
            .handle_oauth_callback("example", "raw-code-secret", &state)
            .await
            .unwrap_err();
        assert_eq!(completion_error, OAUTH_AUTHENTICATION_UNSUPPORTED);
        assert!(!completion_error.contains("raw-code-secret"));
        assert_eq!(calls.load(Ordering::SeqCst), 0);
        assert!(svc.pending_oauth_flows.is_empty());

        assert!(svc
            .handle_oauth_callback("example", "another-code", &state)
            .await
            .is_err());
        assert_eq!(calls.load(Ordering::SeqCst), 0);
    }

    #[tokio::test]
    async fn oauth_expired_state_and_unsupported_provider_fail_without_exchange() {
        use std::sync::atomic::Ordering;
        let calls = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let mut svc = oauth_service(Arc::clone(&calls));
        svc.add_oauth_provider(oauth_provider()).await.unwrap();
        let authorization_url = svc
            .initiate_oauth_flow("example", "http://localhost:43119/callback")
            .unwrap();
        let state = oauth_state(&authorization_url);
        svc.pending_oauth_flows
            .get_mut(&state)
            .unwrap()
            .expires_at_unix = chrono::Utc::now().timestamp() - 1;
        assert!(svc
            .handle_oauth_callback("example", "authorization-code", &state)
            .await
            .is_err());

        let mut incomplete = oauth_provider();
        incomplete.name = "unsupported".to_string();
        incomplete.token_url.clear();
        assert!(svc.add_oauth_provider(incomplete).await.is_err());
        assert!(svc
            .initiate_oauth_flow("unsupported", "http://localhost:43119/callback")
            .is_err());
        assert_eq!(calls.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn oauth_transport_policy_is_bounded_redirect_free_and_requires_no_network() {
        let policy = OAuthHttpPolicy::bounded();
        assert!(!policy.connect_timeout.is_zero());
        assert!(!policy.total_timeout.is_zero());
        assert!(!policy.read_timeout.is_zero());
        assert!(policy.connect_timeout <= policy.total_timeout);
        assert!(policy.read_timeout <= policy.total_timeout);
        assert!(!policy.follow_redirects);
        assert_eq!(policy.max_response_bytes, 64 * 1024);

        let client = build_oauth_exchange_client().unwrap();
        assert_eq!(client.max_response_bytes, policy.max_response_bytes);
    }

    #[test]
    fn oauth_owned_secret_holders_zeroize_explicitly() {
        let mut provider = StoredOAuthProvider::from_public(oauth_provider());
        provider.zeroize_sensitive();
        assert!(provider.name.is_empty());
        assert!(provider.client_id.is_empty());
        assert!(provider.client_secret.is_empty());
        assert!(provider.auth_url.is_empty());
        assert!(provider.token_url.is_empty());
        assert!(provider.user_info_url.is_empty());
        assert!(provider.scopes.is_empty());

        let mut request = OAuthExchangeRequest {
            token_url: Url::parse("https://identity.example/token").unwrap(),
            client_id: "client-id".to_string(),
            client_secret: "client-secret".to_string(),
            code: "authorization-code".to_string(),
            redirect_uri: "http://localhost:43119/callback".to_string(),
            pkce_verifier: "pkce-secret".to_string(),
        };
        request.zeroize_sensitive();
        assert!(request.client_id.is_empty());
        assert!(request.client_secret.is_empty());
        assert!(request.code.is_empty());
        assert!(request.redirect_uri.is_empty());
        assert!(request.pkce_verifier.is_empty());

        let mut response = OAuthExchangeResponse {
            access_token: "access-secret".to_string(),
            refresh_token: Some("refresh-secret".to_string()),
            token_type: "Bearer".to_string(),
            _expires_at: None,
        };
        response.zeroize_sensitive();
        assert!(response.access_token.is_empty());
        assert!(response
            .refresh_token
            .as_ref()
            .is_none_or(|token| token.is_empty()));
        assert!(response.token_type.is_empty());
    }

    #[tokio::test]
    async fn provider_authentication_is_opaque_and_unsupported() {
        let mut svc = service();
        let secret_url = "https://identity.example/login?client_secret=must-not-leak";
        let error = svc
            .authenticate_user(
                "provider-user".to_string(),
                "provider-password".to_string(),
                Some(secret_url.to_string()),
            )
            .await
            .unwrap_err();
        assert_eq!(error, OAUTH_AUTHENTICATION_UNSUPPORTED);
        assert!(!error.contains(secret_url));
        assert!(svc.tokens.is_empty());
    }
}
