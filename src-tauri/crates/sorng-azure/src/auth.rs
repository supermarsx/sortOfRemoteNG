//! Azure AD OAuth2 authentication.
//!
//! Supports client-credentials (service-principal) flow using the
//! Microsoft Identity Platform v2.0 token endpoint.

use chrono::{Duration, Utc};
use log::debug;

use crate::client::AzureClient;
use crate::types::{
    AzureCredentials, AzureError, AzureErrorKind, AzureResult, AzureToken, TokenResponse,
};

/// Token endpoint URL for a given tenant.
fn token_url(tenant_id: &str) -> String {
    format!(
        "https://login.microsoftonline.com/{}/oauth2/v2.0/token",
        tenant_id
    )
}

/// Acquire a token using client-credentials grant.
pub async fn acquire_token(
    client: &AzureClient,
    creds: &AzureCredentials,
) -> AzureResult<AzureToken> {
    if creds.client_id.is_empty() || creds.client_secret.is_empty() || creds.tenant_id.is_empty() {
        return Err(AzureError::new(
            AzureErrorKind::Validation,
            "client_id, client_secret, and tenant_id are all required",
        ));
    }

    let url = token_url(&creds.tenant_id);
    debug!("Azure token request → {}", url);

    let form: Vec<(&str, &str)> = vec![
        ("grant_type", "client_credentials"),
        ("client_id", &creds.client_id),
        ("client_secret", &creds.client_secret),
        ("scope", "https://management.azure.com/.default"),
    ];

    let resp: TokenResponse = client.post_form_unauthenticated(&url, &form).await?;
    Ok(token_from_response(resp))
}

/// Acquire a token for Key Vault data-plane operations.
pub async fn acquire_vault_token(
    client: &AzureClient,
    creds: &AzureCredentials,
) -> AzureResult<AzureToken> {
    if creds.client_id.is_empty() || creds.client_secret.is_empty() || creds.tenant_id.is_empty() {
        return Err(AzureError::new(
            AzureErrorKind::Validation,
            "client_id, client_secret, and tenant_id are all required",
        ));
    }

    let url = token_url(&creds.tenant_id);
    debug!("Azure vault token request → {}", url);

    let form: Vec<(&str, &str)> = vec![
        ("grant_type", "client_credentials"),
        ("client_id", &creds.client_id),
        ("client_secret", &creds.client_secret),
        ("scope", "https://vault.azure.net/.default"),
    ];

    let resp: TokenResponse = client.post_form_unauthenticated(&url, &form).await?;
    Ok(token_from_response(resp))
}

/// Acquire a token for Azure Resource Graph queries.
pub async fn acquire_graph_token(
    client: &AzureClient,
    creds: &AzureCredentials,
) -> AzureResult<AzureToken> {
    if creds.client_id.is_empty() || creds.client_secret.is_empty() || creds.tenant_id.is_empty() {
        return Err(AzureError::new(
            AzureErrorKind::Validation,
            "Credentials are required for Resource Graph token",
        ));
    }

    let url = token_url(&creds.tenant_id);
    debug!("Azure graph token request → {}", url);

    let form: Vec<(&str, &str)> = vec![
        ("grant_type", "client_credentials"),
        ("client_id", &creds.client_id),
        ("client_secret", &creds.client_secret),
        ("scope", "https://management.azure.com/.default"),
    ];

    let resp: TokenResponse = client.post_form_unauthenticated(&url, &form).await?;
    Ok(token_from_response(resp))
}

/// Convert the raw token endpoint response into our cached `AzureToken`.
fn token_from_response(resp: TokenResponse) -> AzureToken {
    let expires_at = resp
        .expires_in
        .map(|secs| Utc::now() + Duration::seconds(secs as i64));

    AzureToken {
        access_token: resp.access_token,
        token_type: resp.token_type,
        expires_at,
        resource: resp.resource,
    }
}

// ─── Tests ──────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn token_url_construction() {
        let url = token_url("my-tenant-123");
        assert_eq!(
            url,
            "https://login.microsoftonline.com/my-tenant-123/oauth2/v2.0/token"
        );
    }

    #[test]
    fn token_from_response_with_expiry() {
        let resp = TokenResponse {
            access_token: "tok123".into(),
            token_type: "Bearer".into(),
            expires_in: Some(3600),
            resource: Some("https://management.azure.com/".into()),
        };
        let t = token_from_response(resp);
        assert_eq!(t.access_token, "tok123");
        assert!(t.expires_at.is_some());
        assert!(!t.is_expired());
        assert_eq!(t.resource, Some("https://management.azure.com/".into()));
    }

    #[test]
    fn token_from_response_no_expiry() {
        let resp = TokenResponse {
            access_token: "x".into(),
            token_type: "Bearer".into(),
            expires_in: None,
            resource: None,
        };
        let t = token_from_response(resp);
        assert!(t.expires_at.is_none());
        assert!(!t.is_expired());
    }

    #[tokio::test]
    async fn acquire_token_validation() {
        let client = AzureClient::new();
        let creds = AzureCredentials::default();
        let result = acquire_token(&client, &creds).await;
        assert!(result.is_err());
        let e = result.unwrap_err();
        assert_eq!(e.kind, AzureErrorKind::Validation);
    }

    #[tokio::test]
    async fn acquire_vault_token_validation() {
        let client = AzureClient::new();
        let creds = AzureCredentials::default();
        let result = acquire_vault_token(&client, &creds).await;
        assert!(result.is_err());
    }
}
