// ── Grafana API key and service account management ───────────────────────────

use crate::client::GrafanaClient;
use crate::error::{GrafanaError, GrafanaResult};
use crate::types::*;

pub struct ApiKeyManager;

impl ApiKeyManager {
    // ── API keys ─────────────────────────────────────────────────────

    pub async fn list_api_keys(client: &GrafanaClient) -> GrafanaResult<Vec<GrafanaApiKey>> {
        let body = client.api_get("/api/auth/keys").await?;
        serde_json::from_str(&body).map_err(|e| GrafanaError::parse(format!("list_api_keys: {e}")))
    }

    pub async fn create_api_key(client: &GrafanaClient, req: &CreateApiKeyRequest) -> GrafanaResult<serde_json::Value> {
        let payload = serde_json::to_string(req).map_err(|e| GrafanaError::parse(e.to_string()))?;
        let body = client.api_post("/api/auth/keys", &payload).await?;
        serde_json::from_str(&body).map_err(|e| GrafanaError::parse(format!("create_api_key: {e}")))
    }

    pub async fn delete_api_key(client: &GrafanaClient, id: i64) -> GrafanaResult<()> {
        client.api_delete(&format!("/api/auth/keys/{id}")).await?;
        Ok(())
    }

    // ── Service accounts ─────────────────────────────────────────────

    pub async fn list_service_accounts(client: &GrafanaClient) -> GrafanaResult<Vec<ServiceAccount>> {
        let body = client.api_get("/api/serviceaccounts/search").await?;
        let wrapper: serde_json::Value = serde_json::from_str(&body)
            .map_err(|e| GrafanaError::parse(format!("list_service_accounts: {e}")))?;
        let items = wrapper.get("serviceAccounts").cloned().unwrap_or(serde_json::Value::Array(vec![]));
        serde_json::from_value(items).map_err(|e| GrafanaError::parse(format!("list_service_accounts parse: {e}")))
    }

    pub async fn create_service_account(client: &GrafanaClient, req: &CreateServiceAccountRequest) -> GrafanaResult<ServiceAccount> {
        let payload = serde_json::to_string(req).map_err(|e| GrafanaError::parse(e.to_string()))?;
        let body = client.api_post("/api/serviceaccounts", &payload).await?;
        serde_json::from_str(&body).map_err(|e| GrafanaError::parse(format!("create_service_account: {e}")))
    }

    pub async fn delete_service_account(client: &GrafanaClient, id: i64) -> GrafanaResult<()> {
        client.api_delete(&format!("/api/serviceaccounts/{id}")).await?;
        Ok(())
    }

    pub async fn list_service_account_tokens(client: &GrafanaClient, sa_id: i64) -> GrafanaResult<Vec<ServiceAccountToken>> {
        let body = client.api_get(&format!("/api/serviceaccounts/{sa_id}/tokens")).await?;
        serde_json::from_str(&body).map_err(|e| GrafanaError::parse(format!("list_service_account_tokens: {e}")))
    }

    pub async fn create_service_account_token(client: &GrafanaClient, sa_id: i64, req: &CreateServiceAccountTokenRequest) -> GrafanaResult<ServiceAccountToken> {
        let payload = serde_json::to_string(req).map_err(|e| GrafanaError::parse(e.to_string()))?;
        let body = client.api_post(&format!("/api/serviceaccounts/{sa_id}/tokens"), &payload).await?;
        serde_json::from_str(&body).map_err(|e| GrafanaError::parse(format!("create_service_account_token: {e}")))
    }

    pub async fn delete_service_account_token(client: &GrafanaClient, sa_id: i64, token_id: i64) -> GrafanaResult<()> {
        client.api_delete(&format!("/api/serviceaccounts/{sa_id}/tokens/{token_id}")).await?;
        Ok(())
    }
}
