use crate::google_passwords::api_client::GoogleApiClient;
use crate::google_passwords::types::{GooglePasswordsConfig, GooglePasswordsError, OAuthToken};

/// Generate the OAuth2 authorization URL for the user to visit.
pub fn get_authorization_url(config: &GooglePasswordsConfig, state: &str) -> Result<String, GooglePasswordsError> {
    let client = GoogleApiClient::new(config)?;
    Ok(client.get_auth_url(state))
}

/// Exchange an authorization code for an OAuth token.
pub async fn exchange_code(
    client: &mut GoogleApiClient,
    code: &str,
) -> Result<OAuthToken, GooglePasswordsError> {
    client.exchange_code(code).await
}

/// Refresh the access token.
pub async fn refresh_token(client: &mut GoogleApiClient) -> Result<OAuthToken, GooglePasswordsError> {
    client.refresh_token().await
}

/// Revoke authentication.
pub async fn revoke(client: &mut GoogleApiClient) -> Result<(), GooglePasswordsError> {
    client.revoke_token().await
}

/// Check if the token is valid (not expired).
pub fn is_authenticated(client: &GoogleApiClient) -> bool {
    client.has_token()
}

/// Generate a random state parameter for OAuth2 CSRF protection.
pub fn generate_oauth_state() -> String {
    use rand::Rng;
    let mut rng = rand::thread_rng();
    let bytes: Vec<u8> = (0..32).map(|_| rng.gen::<u8>()).collect();
    base64::Engine::encode(&base64::engine::general_purpose::URL_SAFE_NO_PAD, &bytes)
}
