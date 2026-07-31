//! OAuth 2.0 PKCE authorization flow for Dropbox.
//!
//! Implements the full authorization code flow with PKCE as recommended
//! by Dropbox for desktop / public clients.

use crate::types::{OAuthPkceState, OAuthTokenResponse};
use chrono::{Duration, Utc};
use rand::Rng;
use sha2::{Digest, Sha256};

const AUTH_URL: &str = "https://www.dropbox.com/oauth2/authorize";
const TOKEN_URL: &str = "https://api.dropboxapi.com/oauth2/token";
const REVOKE_URL: &str = "https://api.dropboxapi.com/2/auth/token/revoke";
const MAX_OAUTH_RESPONSE_BODY_BYTES: usize = 1024 * 1024;

/// Generate a random code verifier (43–128 characters, Base64URL-safe).
pub fn generate_code_verifier() -> String {
    let mut rng = rand::thread_rng();
    let bytes: Vec<u8> = (0..48).map(|_| rng.gen::<u8>()).collect();
    base64_url_encode(&bytes)
}

/// Derive the S256 code challenge from a verifier.
pub fn code_challenge_s256(verifier: &str) -> String {
    let hash = Sha256::digest(verifier.as_bytes());
    base64_url_encode(hash.as_slice())
}

/// Generate a random state parameter.
pub fn generate_state() -> String {
    let mut rng = rand::thread_rng();
    let bytes: Vec<u8> = (0..24).map(|_| rng.gen::<u8>()).collect();
    base64_url_encode(&bytes)
}

/// Base64-url-encode without padding.
fn base64_url_encode(bytes: &[u8]) -> String {
    use base64::engine::general_purpose::URL_SAFE_NO_PAD;
    use base64::Engine;
    URL_SAFE_NO_PAD.encode(bytes)
}

fn require_success_status(operation: &str, status: reqwest::StatusCode) -> Result<(), String> {
    if status.is_success() {
        Ok(())
    } else {
        Err(format!(
            "{operation} failed with HTTP status {}",
            status.as_u16()
        ))
    }
}

fn parse_token_response(
    operation: &str,
    status: reqwest::StatusCode,
    body: &str,
) -> Result<OAuthTokenResponse, String> {
    require_success_status(operation, status)?;
    serde_json::from_str(body).map_err(|e| {
        format!(
            "Failed to parse {operation} response: invalid JSON at line {}, column {}",
            e.line(),
            e.column()
        )
    })
}

fn build_http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| "Failed to build Dropbox HTTP client".to_string())
}

fn request_error(operation: &str, error: &reqwest::Error) -> String {
    let reason = if error.is_timeout() {
        "timed out"
    } else if error.is_connect() {
        "connection failed"
    } else {
        "transport failed"
    };
    format!("{operation}: {reason}")
}

async fn read_bounded_response_body(
    mut response: reqwest::Response,
    operation: &str,
) -> Result<String, String> {
    if response
        .content_length()
        .is_some_and(|length| length > MAX_OAUTH_RESPONSE_BODY_BYTES as u64)
    {
        return Err(format!(
            "{operation} response exceeds {MAX_OAUTH_RESPONSE_BODY_BYTES} byte limit"
        ));
    }

    let capacity = response
        .content_length()
        .unwrap_or(0)
        .min(MAX_OAUTH_RESPONSE_BODY_BYTES as u64) as usize;
    let mut body = Vec::with_capacity(capacity);
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|e| request_error(operation, &e))?
    {
        let remaining = (MAX_OAUTH_RESPONSE_BODY_BYTES + 1).saturating_sub(body.len());
        body.extend_from_slice(&chunk[..chunk.len().min(remaining)]);
        if body.len() > MAX_OAUTH_RESPONSE_BODY_BYTES {
            return Err(format!(
                "{operation} response exceeds {MAX_OAUTH_RESPONSE_BODY_BYTES} byte limit"
            ));
        }
    }

    Ok(String::from_utf8_lossy(&body).into_owned())
}

/// Build the full PKCE state and the authorization URL the user should open.
pub fn build_auth_url(
    app_key: &str,
    redirect_uri: &str,
    scopes: Option<&[&str]>,
) -> (String, OAuthPkceState) {
    let verifier = generate_code_verifier();
    let challenge = code_challenge_s256(&verifier);
    let state = generate_state();

    let mut url = format!(
        "{}?client_id={}&response_type=code&code_challenge={}&code_challenge_method=S256&state={}&redirect_uri={}&token_access_type=offline",
        AUTH_URL, app_key, challenge, state, redirect_uri,
    );

    if let Some(scopes) = scopes {
        if !scopes.is_empty() {
            url.push_str(&format!("&scope={}", scopes.join(" ")));
        }
    }

    let pkce = OAuthPkceState {
        code_verifier: verifier,
        code_challenge: challenge,
        state: state.clone(),
        redirect_uri: redirect_uri.to_string(),
    };

    (url, pkce)
}

/// Exchange the authorization code for tokens.
pub async fn exchange_code(
    app_key: &str,
    app_secret: Option<&str>,
    code: &str,
    pkce: &OAuthPkceState,
) -> Result<OAuthTokenResponse, String> {
    let client = build_http_client()?;

    let mut params = vec![
        ("grant_type", "authorization_code"),
        ("code", code),
        ("redirect_uri", &pkce.redirect_uri),
        ("code_verifier", &pkce.code_verifier),
        ("client_id", app_key),
    ];

    let secret_owned;
    if let Some(secret) = app_secret {
        secret_owned = secret.to_string();
        params.push(("client_secret", &secret_owned));
    }

    let resp = client
        .post(TOKEN_URL)
        .form(&params)
        .send()
        .await
        .map_err(|e| request_error("Token exchange request", &e))?;

    let status = resp.status();
    require_success_status("token exchange", status)?;
    let body = read_bounded_response_body(resp, "token exchange").await?;

    parse_token_response("token exchange", status, &body)
}

/// Refresh an expired access token using a refresh token.
pub async fn refresh_token(
    app_key: &str,
    app_secret: Option<&str>,
    refresh_tok: &str,
) -> Result<OAuthTokenResponse, String> {
    let client = build_http_client()?;

    let mut params = vec![
        ("grant_type", "refresh_token"),
        ("refresh_token", refresh_tok),
        ("client_id", app_key),
    ];

    let secret_owned;
    if let Some(secret) = app_secret {
        secret_owned = secret.to_string();
        params.push(("client_secret", &secret_owned));
    }

    let resp = client
        .post(TOKEN_URL)
        .form(&params)
        .send()
        .await
        .map_err(|e| request_error("Token refresh request", &e))?;

    let status = resp.status();
    require_success_status("token refresh", status)?;
    let body = read_bounded_response_body(resp, "token refresh").await?;

    parse_token_response("token refresh", status, &body)
}

/// Revoke an access token.
pub async fn revoke_token(access_token: &str) -> Result<(), String> {
    let client = build_http_client()?;
    let resp = client
        .post(REVOKE_URL)
        .bearer_auth(access_token)
        .send()
        .await
        .map_err(|e| request_error("Token revoke request", &e))?;
    require_success_status("token revoke", resp.status())?;
    Ok(())
}

/// Check whether a token is about to expire within the given margin.
pub fn is_token_expiring(expires_at: Option<&chrono::DateTime<Utc>>, margin_secs: i64) -> bool {
    match expires_at {
        Some(exp) => Utc::now() + Duration::seconds(margin_secs) >= *exp,
        None => true, // no expiry → treat as expired
    }
}

/// Compute the expiry timestamp from an `expires_in` seconds value.
pub fn expires_at_from_now(expires_in: i64) -> chrono::DateTime<Utc> {
    Utc::now() + Duration::seconds(expires_in)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn code_verifier_length() {
        let v = generate_code_verifier();
        assert!(v.len() >= 43, "verifier too short: {}", v.len());
    }

    #[test]
    fn code_challenge_deterministic() {
        let c1 = code_challenge_s256("test_verifier_value");
        let c2 = code_challenge_s256("test_verifier_value");
        assert_eq!(c1, c2);
    }

    #[test]
    fn code_challenge_differs_for_different_verifiers() {
        let c1 = code_challenge_s256("verifier_a");
        let c2 = code_challenge_s256("verifier_b");
        assert_ne!(c1, c2);
    }

    #[test]
    fn state_is_random() {
        let s1 = generate_state();
        let s2 = generate_state();
        assert_ne!(s1, s2);
    }

    #[test]
    fn build_auth_url_basic() {
        let (url, pkce) = build_auth_url("my_key", "http://localhost:8080", None);
        assert!(url.starts_with("https://www.dropbox.com/oauth2/authorize"));
        assert!(url.contains("client_id=my_key"));
        assert!(url.contains("code_challenge_method=S256"));
        assert!(url.contains(&pkce.state));
        assert!(url.contains("token_access_type=offline"));
        assert!(!pkce.code_verifier.is_empty());
    }

    #[test]
    fn build_auth_url_with_scopes() {
        let (url, _) = build_auth_url(
            "key",
            "http://localhost",
            Some(&["files.metadata.read", "files.content.write"]),
        );
        assert!(
            url.contains("scope=files.metadata.read+files.content.write")
                || url.contains("scope=files.metadata.read%20files.content.write")
                || url.contains("scope=files.metadata.read files.content.write")
        );
    }

    #[test]
    fn token_response_parser_accepts_successful_dropbox_payload() {
        let body = r#"{
            "access_token": "access-secret",
            "token_type": "bearer",
            "expires_in": 14400,
            "refresh_token": "refresh-secret",
            "scope": "account_info.read",
            "uid": "12345",
            "account_id": "dbid:example"
        }"#;

        let parsed = parse_token_response("token exchange", reqwest::StatusCode::OK, body)
            .expect("valid successful OAuth response");
        assert_eq!(parsed.access_token, "access-secret");
    }

    #[test]
    fn token_response_classifier_rejects_failure_without_exposing_body() {
        let body = r#"{"error":"invalid_grant","refresh_token":"highly-secret-marker"}"#;
        let error = parse_token_response("token refresh", reqwest::StatusCode::BAD_REQUEST, body)
            .expect_err("non-success status must be rejected");

        assert_eq!(error, "token refresh failed with HTTP status 400");
        assert!(!error.contains("highly-secret-marker"));
        assert!(!error.contains(body));
    }

    #[test]
    fn token_response_parse_error_never_exposes_body() {
        let body = "not-json-highly-secret-marker";
        let error = parse_token_response("token exchange", reqwest::StatusCode::OK, body)
            .expect_err("malformed success body must be rejected");

        assert!(error.starts_with("Failed to parse token exchange response:"));
        assert!(!error.contains("highly-secret-marker"));
        assert!(!error.contains(body));
    }

    #[test]
    fn is_token_expiring_none() {
        assert!(is_token_expiring(None, 300));
    }

    #[test]
    fn is_token_expiring_future() {
        let future = Utc::now() + Duration::hours(1);
        assert!(!is_token_expiring(Some(&future), 300));
    }

    #[test]
    fn is_token_expiring_soon() {
        let soon = Utc::now() + Duration::seconds(60);
        assert!(is_token_expiring(Some(&soon), 300));
    }

    #[test]
    fn is_token_expiring_past() {
        let past = Utc::now() - Duration::hours(1);
        assert!(is_token_expiring(Some(&past), 0));
    }

    #[test]
    fn expires_at_from_now_positive() {
        let exp = expires_at_from_now(3600);
        assert!(exp > Utc::now());
    }
}
