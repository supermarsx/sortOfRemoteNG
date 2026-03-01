//! OAuth2 authentication for Microsoft Graph / OneDrive.
//!
//! Implements the following flows:
//!
//! - **Authorization code + PKCE** — interactive desktop flow that opens the
//!   system browser and listens on a local redirect URI.
//! - **Device code** — suitable for headless / CLI scenarios.
//! - **Client credentials** — for daemon / service identities.
//! - **Token refresh** — silently refreshes an expired token using the stored
//!   refresh token.
//!
//! All endpoints target Microsoft identity platform v2.0:
//! `https://login.microsoftonline.com/{tenant}/oauth2/v2.0/...`

use crate::onedrive::error::{OneDriveError, OneDriveErrorCode, OneDriveResult};
use crate::onedrive::types::{
    DeviceCodeInfo, GraphUserProfile, OAuthTokenSet, OneDriveConfig, PkceChallenge,
};
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use chrono::Utc;
use log::{debug, info};
use rand::RngCore;
use sha2::{Digest, Sha256};

/// Default OAuth2 scopes for OneDrive access.
pub const DEFAULT_SCOPES: &str =
    "offline_access Files.ReadWrite.All User.Read Sites.ReadWrite.All";

// ═══════════════════════════════════════════════════════════════════════
//  Public API
// ═══════════════════════════════════════════════════════════════════════

/// Generate a PKCE challenge pair.
pub fn generate_pkce() -> PkceChallenge {
    let mut buf = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut buf);
    let verifier = URL_SAFE_NO_PAD.encode(buf);
    let digest = Sha256::digest(verifier.as_bytes());
    let challenge = URL_SAFE_NO_PAD.encode(digest);
    PkceChallenge {
        code_verifier: verifier,
        code_challenge: challenge,
        method: "S256".into(),
    }
}

/// Build the authorization URL for the auth-code + PKCE flow.
pub fn build_auth_url(config: &OneDriveConfig, pkce: &PkceChallenge, state: &str) -> String {
    format!(
        "https://login.microsoftonline.com/{}/oauth2/v2.0/authorize?\
         client_id={}&response_type=code&redirect_uri={}&scope={}&\
         code_challenge={}&code_challenge_method={}&state={}&response_mode=query",
        config.tenant_id,
        percent_encoding::utf8_percent_encode(&config.client_id, percent_encoding::NON_ALPHANUMERIC),
        percent_encoding::utf8_percent_encode(&config.redirect_uri, percent_encoding::NON_ALPHANUMERIC),
        percent_encoding::utf8_percent_encode(DEFAULT_SCOPES, percent_encoding::NON_ALPHANUMERIC),
        pkce.code_challenge,
        pkce.method,
        state,
    )
}

/// Exchange an authorization code for tokens.
pub async fn exchange_code(
    config: &OneDriveConfig,
    code: &str,
    pkce: &PkceChallenge,
) -> OneDriveResult<OAuthTokenSet> {
    let token_url = format!(
        "https://login.microsoftonline.com/{}/oauth2/v2.0/token",
        config.tenant_id,
    );

    let mut params = vec![
        ("client_id", config.client_id.as_str()),
        ("grant_type", "authorization_code"),
        ("code", code),
        ("redirect_uri", config.redirect_uri.as_str()),
        ("code_verifier", pkce.code_verifier.as_str()),
        ("scope", DEFAULT_SCOPES),
    ];

    let secret_val;
    if let Some(ref secret) = config.client_secret {
        secret_val = secret.clone();
        params.push(("client_secret", &secret_val));
    }

    let client = reqwest::Client::new();
    let resp = client
        .post(&token_url)
        .form(&params)
        .send()
        .await
        .map_err(OneDriveError::from)?;

    let status = resp.status().as_u16();
    let body = resp.text().await.map_err(OneDriveError::from)?;

    if status != 200 {
        return Err(OneDriveError::from_graph_response(status, &body));
    }

    parse_token_response(&body)
}

/// Refresh an existing token set.
pub async fn refresh_token(
    config: &OneDriveConfig,
    refresh: &str,
) -> OneDriveResult<OAuthTokenSet> {
    let token_url = format!(
        "https://login.microsoftonline.com/{}/oauth2/v2.0/token",
        config.tenant_id,
    );

    let mut params = vec![
        ("client_id", config.client_id.as_str()),
        ("grant_type", "refresh_token"),
        ("refresh_token", refresh),
        ("scope", DEFAULT_SCOPES),
    ];

    let secret_val;
    if let Some(ref secret) = config.client_secret {
        secret_val = secret.clone();
        params.push(("client_secret", &secret_val));
    }

    let client = reqwest::Client::new();
    let resp = client
        .post(&token_url)
        .form(&params)
        .send()
        .await
        .map_err(OneDriveError::from)?;

    let status = resp.status().as_u16();
    let body = resp.text().await.map_err(OneDriveError::from)?;

    if status != 200 {
        return Err(OneDriveError::from_graph_response(status, &body));
    }

    info!("Token refreshed successfully");
    parse_token_response(&body)
}

/// Start the device-code flow — returns a `DeviceCodeInfo` the caller should
/// present to the user, then poll `poll_device_code` until it succeeds.
pub async fn start_device_code_flow(
    config: &OneDriveConfig,
) -> OneDriveResult<DeviceCodeInfo> {
    let url = format!(
        "https://login.microsoftonline.com/{}/oauth2/v2.0/devicecode",
        config.tenant_id,
    );

    let params = [
        ("client_id", config.client_id.as_str()),
        ("scope", DEFAULT_SCOPES),
    ];

    let client = reqwest::Client::new();
    let resp = client
        .post(&url)
        .form(&params)
        .send()
        .await
        .map_err(OneDriveError::from)?;

    let status = resp.status().as_u16();
    let body = resp.text().await.map_err(OneDriveError::from)?;

    if status != 200 {
        return Err(OneDriveError::from_graph_response(status, &body));
    }

    let v: serde_json::Value = serde_json::from_str(&body)?;
    Ok(DeviceCodeInfo {
        device_code: v["device_code"]
            .as_str()
            .unwrap_or_default()
            .to_string(),
        user_code: v["user_code"].as_str().unwrap_or_default().to_string(),
        verification_uri: v["verification_uri"]
            .as_str()
            .unwrap_or_default()
            .to_string(),
        expires_in: v["expires_in"].as_u64().unwrap_or(900),
        interval: v["interval"].as_u64().unwrap_or(5),
        message: v["message"].as_str().unwrap_or_default().to_string(),
    })
}

/// Poll for completion of a device-code flow.
///
/// Returns `Ok(token)` on success, `Err(AuthFailed)` if the flow is denied or
/// expired, or `Err(InternalError)` on unexpected responses.  The caller
/// should sleep for `device_code.interval` seconds between polls.
pub async fn poll_device_code(
    config: &OneDriveConfig,
    device_code: &str,
) -> OneDriveResult<OAuthTokenSet> {
    let token_url = format!(
        "https://login.microsoftonline.com/{}/oauth2/v2.0/token",
        config.tenant_id,
    );

    let params = [
        ("client_id", config.client_id.as_str()),
        ("grant_type", "urn:ietf:params:oauth:grant-type:device_code"),
        ("device_code", device_code),
    ];

    let client = reqwest::Client::new();
    let resp = client
        .post(&token_url)
        .form(&params)
        .send()
        .await
        .map_err(OneDriveError::from)?;

    let status = resp.status().as_u16();
    let body = resp.text().await.map_err(OneDriveError::from)?;

    if status == 200 {
        return parse_token_response(&body);
    }

    // 400 with "authorization_pending" means keep polling.
    let v: serde_json::Value = serde_json::from_str(&body).unwrap_or_default();
    let err_code = v["error"].as_str().unwrap_or("");
    match err_code {
        "authorization_pending" => Err(OneDriveError::new(
            OneDriveErrorCode::AuthFailed,
            "Authorization pending — keep polling",
        )),
        "slow_down" => Err(OneDriveError::new(
            OneDriveErrorCode::RateLimited,
            "Slow down — increase poll interval",
        )),
        "expired_token" => Err(OneDriveError::new(
            OneDriveErrorCode::TokenExpired,
            "Device code expired",
        )),
        "access_denied" => Err(OneDriveError::auth("User denied the request")),
        _ => Err(OneDriveError::from_graph_response(status, &body)),
    }
}

/// Client-credentials token grant (no user, daemon-style).
pub async fn client_credentials_token(
    config: &OneDriveConfig,
) -> OneDriveResult<OAuthTokenSet> {
    let secret = config
        .client_secret
        .as_deref()
        .ok_or_else(|| OneDriveError::auth("client_secret is required for client-credentials flow"))?;

    let token_url = format!(
        "https://login.microsoftonline.com/{}/oauth2/v2.0/token",
        config.tenant_id,
    );

    let params = [
        ("client_id", config.client_id.as_str()),
        ("client_secret", secret),
        ("grant_type", "client_credentials"),
        ("scope", "https://graph.microsoft.com/.default"),
    ];

    let client = reqwest::Client::new();
    let resp = client
        .post(&token_url)
        .form(&params)
        .send()
        .await
        .map_err(OneDriveError::from)?;

    let status = resp.status().as_u16();
    let body = resp.text().await.map_err(OneDriveError::from)?;

    if status != 200 {
        return Err(OneDriveError::from_graph_response(status, &body));
    }

    parse_token_response(&body)
}

/// Fetch the signed-in user profile (`/me`).
pub async fn get_user_profile(access_token: &str) -> OneDriveResult<GraphUserProfile> {
    let client = reqwest::Client::new();
    let resp = client
        .get("https://graph.microsoft.com/v1.0/me")
        .bearer_auth(access_token)
        .send()
        .await
        .map_err(OneDriveError::from)?;

    let status = resp.status().as_u16();
    let body = resp.text().await.map_err(OneDriveError::from)?;

    if status != 200 {
        return Err(OneDriveError::from_graph_response(status, &body));
    }

    let v: serde_json::Value = serde_json::from_str(&body)?;
    Ok(GraphUserProfile {
        id: v["id"].as_str().unwrap_or_default().to_string(),
        display_name: v["displayName"].as_str().map(String::from),
        user_principal_name: v["userPrincipalName"].as_str().map(String::from),
        mail: v["mail"].as_str().map(String::from),
    })
}

// ═══════════════════════════════════════════════════════════════════════
//  Internal helpers
// ═══════════════════════════════════════════════════════════════════════

fn parse_token_response(body: &str) -> OneDriveResult<OAuthTokenSet> {
    let v: serde_json::Value = serde_json::from_str(body)?;

    let access_token = v["access_token"]
        .as_str()
        .ok_or_else(|| OneDriveError::auth("No access_token in response"))?
        .to_string();

    let expires_in = v["expires_in"].as_i64().unwrap_or(3600);
    let expires_at = Utc::now() + chrono::Duration::seconds(expires_in);

    debug!("Parsed token, expires in {}s", expires_in);

    Ok(OAuthTokenSet {
        access_token,
        refresh_token: v["refresh_token"].as_str().map(String::from),
        token_type: v["token_type"]
            .as_str()
            .unwrap_or("Bearer")
            .to_string(),
        expires_at,
        scope: v["scope"].as_str().unwrap_or_default().to_string(),
        id_token: v["id_token"].as_str().map(String::from),
    })
}

// ═══════════════════════════════════════════════════════════════════════
//  Tests
// ═══════════════════════════════════════════════════════════════════════

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_generate_pkce() {
        let pkce = generate_pkce();
        assert!(!pkce.code_verifier.is_empty());
        assert!(!pkce.code_challenge.is_empty());
        assert_eq!(pkce.method, "S256");
        // Verifier should be ~43 chars (32 bytes base64url-encoded).
        assert!(pkce.code_verifier.len() >= 40);
    }

    #[test]
    fn test_build_auth_url() {
        let config = OneDriveConfig {
            client_id: "my-client-id".into(),
            tenant_id: "common".into(),
            redirect_uri: "http://localhost:8400/auth/callback".into(),
            ..Default::default()
        };
        let pkce = generate_pkce();
        let url = build_auth_url(&config, &pkce, "random_state");
        assert!(url.contains("login.microsoftonline.com"));
        assert!(url.contains("my%2Dclient%2Did"));
        assert!(url.contains("random_state"));
    }

    #[test]
    fn test_parse_token_response() {
        let body = r#"{
            "access_token": "eyJ0eXAi...",
            "token_type": "Bearer",
            "expires_in": 3600,
            "scope": "Files.ReadWrite.All User.Read",
            "refresh_token": "OAAABbbbb...",
            "id_token": "eyJhbGci..."
        }"#;
        let token = parse_token_response(body).unwrap();
        assert_eq!(token.access_token, "eyJ0eXAi...");
        assert_eq!(token.token_type, "Bearer");
        assert!(token.refresh_token.is_some());
        assert!(token.id_token.is_some());
        assert!(!token.is_expired());
    }

    #[test]
    fn test_parse_token_response_missing_access_token() {
        let body = r#"{"token_type": "Bearer"}"#;
        let result = parse_token_response(body);
        assert!(result.is_err());
    }
}
