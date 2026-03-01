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
    let client = reqwest::Client::new();

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
        .map_err(|e| format!("Token exchange request failed: {e}"))?;

    let body = resp
        .text()
        .await
        .map_err(|e| format!("Failed to read token response: {e}"))?;

    serde_json::from_str(&body)
        .map_err(|e| format!("Failed to parse token response: {e} — body: {body}"))
}

/// Refresh an expired access token using a refresh token.
pub async fn refresh_token(
    app_key: &str,
    app_secret: Option<&str>,
    refresh_tok: &str,
) -> Result<OAuthTokenResponse, String> {
    let client = reqwest::Client::new();

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
        .map_err(|e| format!("Token refresh request failed: {e}"))?;

    let body = resp
        .text()
        .await
        .map_err(|e| format!("Failed to read refresh response: {e}"))?;

    serde_json::from_str(&body)
        .map_err(|e| format!("Failed to parse refresh response: {e} — body: {body}"))
}

/// Revoke an access token (best-effort).
pub async fn revoke_token(access_token: &str) -> Result<(), String> {
    let client = reqwest::Client::new();
    let _ = client
        .post(REVOKE_URL)
        .bearer_auth(access_token)
        .send()
        .await
        .map_err(|e| format!("Token revoke failed: {e}"))?;
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
        let (url, _) = build_auth_url("key", "http://localhost", Some(&["files.metadata.read", "files.content.write"]));
        assert!(url.contains("scope=files.metadata.read+files.content.write") || url.contains("scope=files.metadata.read%20files.content.write") || url.contains("scope=files.metadata.read files.content.write"));
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
