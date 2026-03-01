// ──────────────────────────────────────────────────────────────────────────────
// sorng-nextcloud · auth
// ──────────────────────────────────────────────────────────────────────────────
// Authentication helpers:
//  • Login Flow v2 (recommended device/app credential flow)
//  • OAuth 2 token exchange & refresh (when `oauth2` app is enabled)
//  • App-password / basic-auth validation
//  • Credential lifecycle helpers
// ──────────────────────────────────────────────────────────────────────────────

use crate::client::NextcloudClient;
use crate::types::*;
use log::{debug, info, warn};

// ── Login Flow v2 ────────────────────────────────────────────────────────────
// Docs: https://docs.nextcloud.com/server/latest/developer_manual/client_apis/LoginFlow/index.html#login-flow-v2

/// Initiate Login Flow v2. Returns the state object containing the URL the user
/// should open in their browser and the poll endpoint for the client.
pub async fn start_login_flow_v2(base_url: &str) -> Result<LoginFlowV2State, String> {
    let url = format!(
        "{}/index.php/login/v2",
        base_url.trim_end_matches('/')
    );

    let http = reqwest::Client::new();
    let resp = http
        .post(&url)
        .send()
        .await
        .map_err(|e| format!("login flow v2 init: {}", e))?;

    let status = resp.status();
    if !status.is_success() {
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("login flow v2 init {} → {}: {}", url, status, text));
    }

    let init: LoginFlowV2Init = resp
        .json()
        .await
        .map_err(|e| format!("parse login flow v2 response: {}", e))?;

    Ok(LoginFlowV2State {
        login_url: init.login,
        poll_endpoint: init.poll.endpoint,
        poll_token: init.poll.token,
    })
}

/// Poll the Login Flow v2 endpoint. Returns `Ok(Some(creds))` when the user has
/// completed the flow, `Ok(None)` while still pending, or `Err` on failure.
pub async fn poll_login_flow_v2(
    state: &LoginFlowV2State,
) -> Result<Option<LoginFlowV2Credentials>, String> {
    let http = reqwest::Client::new();
    let resp = http
        .post(&state.poll_endpoint)
        .form(&[("token", &state.poll_token)])
        .send()
        .await
        .map_err(|e| format!("login flow v2 poll: {}", e))?;

    let status = resp.status();

    // 404 means the user hasn't completed login yet
    if status == reqwest::StatusCode::NOT_FOUND {
        return Ok(None);
    }

    if !status.is_success() {
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("login flow v2 poll failed {}: {}", status, text));
    }

    let creds: LoginFlowV2Credentials = resp
        .json()
        .await
        .map_err(|e| format!("parse login flow v2 credentials: {}", e))?;

    info!(
        "Login Flow v2 completed – server={}, user={}",
        creds.server, creds.login_name
    );

    Ok(Some(creds))
}

/// Convenience: repeatedly poll until complete or timeout (seconds).
pub async fn await_login_flow_v2(
    state: &LoginFlowV2State,
    timeout_secs: u64,
    poll_interval_ms: u64,
) -> Result<LoginFlowV2Credentials, String> {
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(timeout_secs);

    loop {
        if std::time::Instant::now() >= deadline {
            return Err("Login Flow v2 timed out".to_string());
        }

        match poll_login_flow_v2(state).await? {
            Some(creds) => return Ok(creds),
            None => {
                debug!("login flow v2 still pending, waiting {}ms", poll_interval_ms);
                tokio::time::sleep(std::time::Duration::from_millis(poll_interval_ms)).await;
            }
        }
    }
}

// ── OAuth 2 ──────────────────────────────────────────────────────────────────
// Nextcloud supports OAuth 2 when the `oauth2` app is enabled.

/// Build the authorization URL for OAuth 2 PKCE flow.
pub fn build_oauth2_authorize_url(
    base_url: &str,
    client_id: &str,
    redirect_uri: &str,
    state: &str,
    code_challenge: &str,
) -> String {
    format!(
        "{}/index.php/apps/oauth2/authorize?response_type=code&client_id={}&redirect_uri={}&state={}&code_challenge={}&code_challenge_method=S256",
        base_url.trim_end_matches('/'),
        url::form_urlencoded::byte_serialize(client_id.as_bytes()).collect::<String>(),
        url::form_urlencoded::byte_serialize(redirect_uri.as_bytes()).collect::<String>(),
        url::form_urlencoded::byte_serialize(state.as_bytes()).collect::<String>(),
        url::form_urlencoded::byte_serialize(code_challenge.as_bytes()).collect::<String>(),
    )
}

/// Exchange an authorization code for tokens.
pub async fn exchange_oauth2_code(
    base_url: &str,
    client_id: &str,
    client_secret: &str,
    code: &str,
    redirect_uri: &str,
    code_verifier: &str,
) -> Result<OAuthTokenResponse, String> {
    let url = format!(
        "{}/index.php/apps/oauth2/api/v1/token",
        base_url.trim_end_matches('/')
    );

    let http = reqwest::Client::new();
    let resp = http
        .post(&url)
        .form(&[
            ("grant_type", "authorization_code"),
            ("code", code),
            ("redirect_uri", redirect_uri),
            ("client_id", client_id),
            ("client_secret", client_secret),
            ("code_verifier", code_verifier),
        ])
        .send()
        .await
        .map_err(|e| format!("oauth2 token exchange: {}", e))?;

    let status = resp.status();
    if !status.is_success() {
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("oauth2 token exchange {} → {}: {}", url, status, text));
    }

    resp.json::<OAuthTokenResponse>()
        .await
        .map_err(|e| format!("parse oauth2 token: {}", e))
}

/// Refresh an OAuth 2 access token.
pub async fn refresh_oauth2_token(
    base_url: &str,
    client_id: &str,
    client_secret: &str,
    refresh_token: &str,
) -> Result<OAuthTokenResponse, String> {
    let url = format!(
        "{}/index.php/apps/oauth2/api/v1/token",
        base_url.trim_end_matches('/')
    );

    let http = reqwest::Client::new();
    let resp = http
        .post(&url)
        .form(&[
            ("grant_type", "refresh_token"),
            ("refresh_token", refresh_token),
            ("client_id", client_id),
            ("client_secret", client_secret),
        ])
        .send()
        .await
        .map_err(|e| format!("oauth2 refresh: {}", e))?;

    let status = resp.status();
    if !status.is_success() {
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("oauth2 refresh {} → {}: {}", url, status, text));
    }

    resp.json::<OAuthTokenResponse>()
        .await
        .map_err(|e| format!("parse refreshed token: {}", e))
}

// ── App password validation ──────────────────────────────────────────────────

/// Validate credentials by calling the OCS user endpoint.
/// Returns the user id on success.
pub async fn validate_credentials(client: &NextcloudClient) -> Result<String, String> {
    let resp: OcsResponse<serde_json::Value> = client
        .ocs_get("ocs/v2.php/cloud/user?format=json")
        .await?;

    let user_id = resp
        .ocs
        .data
        .get("id")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| "missing user id in response".to_string())?;

    info!("Credentials validated for user: {}", user_id);
    Ok(user_id)
}

/// Delete / revoke an app password via the OCS API.
pub async fn revoke_app_password(client: &NextcloudClient) -> Result<(), String> {
    let _: OcsResponse<serde_json::Value> = client
        .ocs_delete("ocs/v2.php/core/apppassword")
        .await?;
    info!("App password revoked");
    Ok(())
}

// ── PKCE helpers ─────────────────────────────────────────────────────────────

/// Generate a random code verifier for PKCE (43-128 chars, URL-safe).
pub fn generate_code_verifier() -> String {
    use rand::Rng;
    const CHARSET: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
    let mut rng = rand::thread_rng();
    (0..128)
        .map(|_| CHARSET[rng.gen_range(0..CHARSET.len())] as char)
        .collect()
}

/// Derive the S256 code challenge from a code verifier.
pub fn generate_code_challenge(verifier: &str) -> String {
    use base64::Engine;
    use sha2::{Digest, Sha256};

    let digest = Sha256::digest(verifier.as_bytes());
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(digest)
}

// ═══════════════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════════════

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn code_verifier_length() {
        let v = generate_code_verifier();
        assert_eq!(v.len(), 128);
        assert!(v.chars().all(|c| c.is_ascii_alphanumeric() || "-._~".contains(c)));
    }

    #[test]
    fn code_challenge_is_base64url() {
        let v = generate_code_verifier();
        let c = generate_code_challenge(&v);
        // S256 → 32 bytes → 43 base64url chars (no padding)
        assert_eq!(c.len(), 43);
        assert!(c.chars().all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '_'));
    }

    #[test]
    fn code_challenge_deterministic() {
        let c1 = generate_code_challenge("test-verifier");
        let c2 = generate_code_challenge("test-verifier");
        assert_eq!(c1, c2);
    }

    #[test]
    fn oauth2_authorize_url_format() {
        let url = build_oauth2_authorize_url(
            "https://nc.test",
            "my-client",
            "http://localhost:8080/callback",
            "random-state",
            "challenge123",
        );
        assert!(url.starts_with("https://nc.test/index.php/apps/oauth2/authorize"));
        assert!(url.contains("client_id=my-client"));
        assert!(url.contains("response_type=code"));
        assert!(url.contains("code_challenge=challenge123"));
        assert!(url.contains("code_challenge_method=S256"));
    }

    #[test]
    fn oauth2_authorize_url_encodes_params() {
        let url = build_oauth2_authorize_url(
            "https://nc.test",
            "client id",
            "http://localhost/call back",
            "st ate",
            "ch+all",
        );
        assert!(url.contains("client_id=client+id"));
    }
}
