//! OAuth2 authentication for Google Drive.
//!
//! Implements the full OAuth2 authorization-code flow:
//!   1. Build an authorization URL for the user.
//!   2. Exchange the authorization code for tokens.
//!   3. Refresh expired access tokens.
//!   4. Revoke tokens.

use chrono::{Duration, Utc};
use log::debug;

use crate::client::{AUTH_URL, REVOKE_URL, TOKEN_URL};
use crate::types::{
    GDriveError, GDriveErrorKind, GDriveResult, OAuthCredentials, OAuthToken, TokenResponse,
};

use crate::client::GDriveClient;

/// Build the Google OAuth2 authorization URL that the user should open.
pub fn build_auth_url(credentials: &OAuthCredentials) -> GDriveResult<String> {
    if credentials.client_id.is_empty() {
        return Err(GDriveError::invalid("client_id is required"));
    }
    if credentials.scopes.is_empty() {
        return Err(GDriveError::invalid("At least one scope is required"));
    }

    let scope = credentials.scopes.join(" ");
    let params = [
        ("client_id", credentials.client_id.as_str()),
        ("redirect_uri", credentials.redirect_uri.as_str()),
        ("response_type", "code"),
        ("scope", &scope),
        ("access_type", "offline"),
        ("prompt", "consent"),
    ];

    let url = url::Url::parse_with_params(AUTH_URL, &params)
        .map_err(|e| GDriveError::invalid(format!("Failed to build auth URL: {e}")))?;

    Ok(url.to_string())
}

/// Exchange an authorization code for access + refresh tokens.
pub async fn exchange_code(
    client: &GDriveClient,
    credentials: &OAuthCredentials,
    code: &str,
) -> GDriveResult<OAuthToken> {
    if code.is_empty() {
        return Err(GDriveError::invalid("Authorization code is empty"));
    }

    debug!("Exchanging authorization code for tokens");
    let params = [
        ("client_id", credentials.client_id.as_str()),
        ("client_secret", credentials.client_secret.as_str()),
        ("code", code),
        ("redirect_uri", credentials.redirect_uri.as_str()),
        ("grant_type", "authorization_code"),
    ];

    let resp: TokenResponse = client.post_form_unauthenticated(TOKEN_URL, &params).await?;
    Ok(token_from_response(resp))
}

/// Refresh an expired access token using the refresh token.
pub async fn refresh_token(
    client: &GDriveClient,
    credentials: &OAuthCredentials,
    refresh_token: &str,
) -> GDriveResult<OAuthToken> {
    if refresh_token.is_empty() {
        return Err(GDriveError::new(
            GDriveErrorKind::TokenExpired,
            "No refresh token available",
        ));
    }

    debug!("Refreshing access token");
    let params = [
        ("client_id", credentials.client_id.as_str()),
        ("client_secret", credentials.client_secret.as_str()),
        ("refresh_token", refresh_token),
        ("grant_type", "refresh_token"),
    ];

    let resp: TokenResponse = client.post_form_unauthenticated(TOKEN_URL, &params).await?;
    let mut token = token_from_response(resp);
    // Google does not always return a new refresh_token on refresh.
    if token.refresh_token.is_none() {
        token.refresh_token = Some(refresh_token.to_string());
    }
    Ok(token)
}

/// Revoke a token (access or refresh).
pub async fn revoke_token(client: &GDriveClient, token: &str) -> GDriveResult<()> {
    if token.is_empty() {
        return Err(GDriveError::invalid("Token string is empty"));
    }

    debug!("Revoking token");
    let params = [("token", token)];
    let _: serde_json::Value = client.post_form_unauthenticated(REVOKE_URL, &params).await
        .or_else(|e| {
            // Revocation endpoint may return 200 with empty body
            if matches!(e.kind, GDriveErrorKind::NetworkError) {
                Ok(serde_json::Value::Null)
            } else {
                Err(e)
            }
        })?;
    Ok(())
}

/// Convert the raw token response to our token type.
fn token_from_response(resp: TokenResponse) -> OAuthToken {
    let expires_at = resp.expires_in.map(|secs| Utc::now() + Duration::seconds(secs));
    OAuthToken {
        access_token: resp.access_token,
        refresh_token: resp.refresh_token,
        token_type: resp.token_type.unwrap_or_else(|| "Bearer".into()),
        expires_at,
        scope: resp.scope,
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Tests
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::scopes;

    #[test]
    fn build_auth_url_success() {
        let creds = OAuthCredentials {
            client_id: "test-client-id".into(),
            client_secret: "secret".into(),
            redirect_uri: "http://localhost:8080/callback".into(),
            scopes: vec![scopes::DRIVE.into()],
        };
        let url = build_auth_url(&creds).unwrap();
        assert!(url.contains("accounts.google.com"));
        assert!(url.contains("test-client-id"));
        assert!(url.contains("response_type=code"));
        assert!(url.contains("access_type=offline"));
        assert!(url.contains("prompt=consent"));
    }

    #[test]
    fn build_auth_url_multiple_scopes() {
        let creds = OAuthCredentials {
            client_id: "id".into(),
            client_secret: "secret".into(),
            redirect_uri: "http://localhost".into(),
            scopes: vec![scopes::DRIVE.into(), scopes::DRIVE_FILE.into()],
        };
        let url = build_auth_url(&creds).unwrap();
        // Scopes are space-separated, URL-encoded
        assert!(url.contains("scope="));
    }

    #[test]
    fn build_auth_url_empty_client_id() {
        let creds = OAuthCredentials {
            client_id: "".into(),
            ..Default::default()
        };
        let err = build_auth_url(&creds).unwrap_err();
        assert_eq!(err.kind, GDriveErrorKind::InvalidParameter);
    }

    #[test]
    fn build_auth_url_no_scopes() {
        let creds = OAuthCredentials {
            client_id: "id".into(),
            scopes: vec![],
            ..Default::default()
        };
        let err = build_auth_url(&creds).unwrap_err();
        assert_eq!(err.kind, GDriveErrorKind::InvalidParameter);
    }

    #[test]
    fn token_from_response_with_expiry() {
        let resp = TokenResponse {
            access_token: "ya29.test".into(),
            token_type: Some("Bearer".into()),
            expires_in: Some(3600),
            refresh_token: Some("1//refresh".into()),
            scope: Some(scopes::DRIVE.into()),
        };
        let tok = token_from_response(resp);
        assert_eq!(tok.access_token, "ya29.test");
        assert_eq!(tok.token_type, "Bearer");
        assert!(tok.expires_at.is_some());
        assert!(tok.refresh_token.is_some());
        assert!(!tok.is_expired());
    }

    #[test]
    fn token_from_response_no_expiry() {
        let resp = TokenResponse {
            access_token: "ya29.no_exp".into(),
            token_type: None,
            expires_in: None,
            refresh_token: None,
            scope: None,
        };
        let tok = token_from_response(resp);
        assert_eq!(tok.token_type, "Bearer"); // default
        assert!(tok.expires_at.is_none());
        assert!(!tok.is_expired());
    }

    #[test]
    fn token_from_response_without_token_type() {
        let resp = TokenResponse {
            access_token: "test".into(),
            token_type: None,
            expires_in: None,
            refresh_token: None,
            scope: None,
        };
        let tok = token_from_response(resp);
        assert_eq!(tok.token_type, "Bearer");
    }
}
