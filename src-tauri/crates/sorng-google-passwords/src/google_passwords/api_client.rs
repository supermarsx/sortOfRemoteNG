use crate::google_passwords::types::{GooglePasswordsConfig, GooglePasswordsError, GooglePasswordsErrorKind, OAuthToken};
use reqwest::{Client, Response, StatusCode};
use std::time::Duration;

/// Google OAuth2 / Passwords API client.
#[derive(Debug, Clone)]
pub struct GoogleApiClient {
    client: Client,
    config: GooglePasswordsConfig,
    token: Option<OAuthToken>,
}

impl GoogleApiClient {
    pub fn new(config: &GooglePasswordsConfig) -> Result<Self, GooglePasswordsError> {
        let client = Client::builder()
            .timeout(Duration::from_secs(config.timeout_secs))
            .user_agent("sortOfRemoteNG/1.0 (Google Passwords Integration)")
            .build()
            .map_err(|e| GooglePasswordsError::connection_error(format!("Failed to build HTTP client: {}", e)))?;

        Ok(Self {
            client,
            config: config.clone(),
            token: None,
        })
    }

    pub fn set_token(&mut self, token: OAuthToken) {
        self.token = Some(token);
    }

    pub fn clear_token(&mut self) {
        self.token = None;
    }

    pub fn has_token(&self) -> bool {
        self.token.as_ref().map(|t| !t.is_expired()).unwrap_or(false)
    }

    fn get_access_token(&self) -> Result<&str, GooglePasswordsError> {
        let token = self
            .token
            .as_ref()
            .ok_or_else(|| GooglePasswordsError::auth_failed("Not authenticated"))?;
        if token.is_expired() {
            return Err(GooglePasswordsError::token_expired());
        }
        Ok(&token.access_token)
    }

    async fn handle_response(&self, response: Response) -> Result<String, GooglePasswordsError> {
        let status = response.status();
        if status == StatusCode::UNAUTHORIZED {
            return Err(GooglePasswordsError::token_expired());
        }
        if status == StatusCode::FORBIDDEN {
            return Err(GooglePasswordsError::auth_failed("Access denied"));
        }
        if status == StatusCode::TOO_MANY_REQUESTS {
            return Err(GooglePasswordsError::new(
                GooglePasswordsErrorKind::RateLimited,
                "Rate limited by Google API",
            ));
        }
        if !status.is_success() {
            let body = response.text().await.unwrap_or_default();
            return Err(GooglePasswordsError::server_error(format!(
                "HTTP {} — {}",
                status.as_u16(),
                body
            )).with_status(status.as_u16()));
        }
        response
            .text()
            .await
            .map_err(|e| GooglePasswordsError::server_error(format!("Failed to read response: {}", e)))
    }

    /// Generate the OAuth2 authorization URL.
    pub fn get_auth_url(&self, state: &str) -> String {
        let scopes = self.config.scopes.join(" ");
        format!(
            "https://accounts.google.com/o/oauth2/v2/auth?\
            client_id={}&\
            redirect_uri={}&\
            response_type=code&\
            scope={}&\
            access_type=offline&\
            prompt=consent&\
            state={}",
            urlencoding::encode(&self.config.client_id),
            urlencoding::encode(&self.config.redirect_uri),
            urlencoding::encode(&scopes),
            urlencoding::encode(state),
        )
    }

    /// Exchange an authorization code for tokens.
    pub async fn exchange_code(&mut self, code: &str) -> Result<OAuthToken, GooglePasswordsError> {
        let response = self
            .client
            .post("https://oauth2.googleapis.com/token")
            .form(&[
                ("client_id", self.config.client_id.as_str()),
                ("client_secret", self.config.client_secret.as_str()),
                ("code", code),
                ("grant_type", "authorization_code"),
                ("redirect_uri", self.config.redirect_uri.as_str()),
            ])
            .send()
            .await?;

        let body = self.handle_response(response).await?;

        #[derive(serde::Deserialize)]
        struct TokenResponse {
            access_token: String,
            refresh_token: Option<String>,
            token_type: String,
            expires_in: Option<u64>,
            scope: Option<String>,
        }

        let token_resp: TokenResponse = serde_json::from_str(&body)
            .map_err(|e| GooglePasswordsError::parse_error(format!("Token parse error: {}", e)))?;

        let expires_at = token_resp
            .expires_in
            .map(|secs| chrono::Utc::now() + chrono::Duration::seconds(secs as i64));

        let token = OAuthToken {
            access_token: token_resp.access_token,
            refresh_token: token_resp.refresh_token,
            token_type: token_resp.token_type,
            expires_at,
            scope: token_resp.scope,
        };

        self.token = Some(token.clone());
        Ok(token)
    }

    /// Refresh the access token using the refresh token.
    pub async fn refresh_token(&mut self) -> Result<OAuthToken, GooglePasswordsError> {
        let refresh_token = self
            .token
            .as_ref()
            .and_then(|t| t.refresh_token.as_ref())
            .ok_or_else(|| GooglePasswordsError::auth_failed("No refresh token available"))?
            .clone();

        let response = self
            .client
            .post("https://oauth2.googleapis.com/token")
            .form(&[
                ("client_id", self.config.client_id.as_str()),
                ("client_secret", self.config.client_secret.as_str()),
                ("refresh_token", refresh_token.as_str()),
                ("grant_type", "refresh_token"),
            ])
            .send()
            .await?;

        let body = self.handle_response(response).await?;

        #[derive(serde::Deserialize)]
        struct RefreshResponse {
            access_token: String,
            token_type: String,
            expires_in: Option<u64>,
            scope: Option<String>,
        }

        let refresh_resp: RefreshResponse = serde_json::from_str(&body)
            .map_err(|e| GooglePasswordsError::parse_error(format!("Refresh token parse error: {}", e)))?;

        let expires_at = refresh_resp
            .expires_in
            .map(|secs| chrono::Utc::now() + chrono::Duration::seconds(secs as i64));

        let token = OAuthToken {
            access_token: refresh_resp.access_token,
            refresh_token: Some(refresh_token),
            token_type: refresh_resp.token_type,
            expires_at,
            scope: refresh_resp.scope,
        };

        self.token = Some(token.clone());
        Ok(token)
    }

    /// Revoke the current token.
    pub async fn revoke_token(&mut self) -> Result<(), GooglePasswordsError> {
        if let Some(ref token) = self.token {
            let _ = self
                .client
                .post("https://oauth2.googleapis.com/revoke")
                .form(&[("token", token.access_token.as_str())])
                .send()
                .await;
        }
        self.token = None;
        Ok(())
    }

    /// Get the user's profile information.
    pub async fn get_user_info(&self) -> Result<GoogleUserInfo, GooglePasswordsError> {
        let access_token = self.get_access_token()?;

        let response = self
            .client
            .get("https://www.googleapis.com/oauth2/v2/userinfo")
            .bearer_auth(access_token)
            .send()
            .await?;

        let body = self.handle_response(response).await?;
        serde_json::from_str(&body)
            .map_err(|e| GooglePasswordsError::parse_error(format!("User info parse error: {}", e)))
    }
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct GoogleUserInfo {
    pub id: String,
    pub email: String,
    pub name: Option<String>,
    pub picture: Option<String>,
}

/// URL-encode a string (minimal implementation to avoid extra dependency).
mod urlencoding {
    pub fn encode(input: &str) -> String {
        let mut encoded = String::new();
        for byte in input.bytes() {
            match byte {
                b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                    encoded.push(byte as char);
                }
                _ => {
                    encoded.push_str(&format!("%{:02X}", byte));
                }
            }
        }
        encoded
    }
}
