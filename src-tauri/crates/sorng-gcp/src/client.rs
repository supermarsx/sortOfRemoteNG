//! Base GCP HTTP client with OAuth2 token management.
//!
//! All GCP REST APIs follow a consistent pattern:
//! - Base URL: `https://{service}.googleapis.com`
//! - Auth: `Authorization: Bearer {access_token}`
//! - Request/Response: JSON
//! - Pagination: `pageToken` / `nextPageToken`
//!
//! This client handles token acquisition, refresh, retries, and error parsing.

use crate::auth::TokenManager;
use crate::config::ServiceAccountKey;
use crate::error::{GcpError, GcpResult};
use reqwest::Client;
use serde::de::DeserializeOwned;
use serde::Serialize;
use std::collections::HashMap;
use std::time::Duration;

/// Base GCP API client.
pub struct GcpClient {
    http: Client,
    token_manager: TokenManager,
    project_id: String,
    endpoint_override: Option<String>,
    user_agent: String,
}

impl GcpClient {
    /// Create a new GCP client.
    pub fn new(
        service_account: ServiceAccountKey,
        scopes: Vec<String>,
        endpoint_override: Option<String>,
    ) -> Self {
        let http = Client::builder()
            .timeout(Duration::from_secs(60))
            .connect_timeout(Duration::from_secs(15))
            .pool_max_idle_per_host(10)
            .build()
            .unwrap_or_else(|_| Client::new());

        let project_id = service_account.project_id.clone();
        let token_manager = TokenManager::new(service_account, scopes, http.clone());

        Self {
            http,
            token_manager,
            project_id,
            endpoint_override,
            user_agent: "SortOfRemoteNG/1.0 gcp-client/0.1".to_string(),
        }
    }

    /// Get the project ID.
    pub fn project_id(&self) -> &str {
        &self.project_id
    }

    /// Get the service account email.
    pub fn service_account_email(&self) -> &str {
        self.token_manager.service_account_email()
    }

    /// Build the base URL for a service.
    fn base_url(&self, service: &str) -> String {
        if let Some(ref url) = self.endpoint_override {
            url.clone()
        } else {
            format!("https://{}.googleapis.com", service)
        }
    }

    /// Get a valid bearer token.
    pub async fn get_token(&mut self) -> GcpResult<String> {
        self.token_manager
            .get_token()
            .await
            .map_err(|e| GcpError::auth_error(&e))
    }

    /// Force refresh the token.
    pub async fn refresh_token(&mut self) -> GcpResult<String> {
        self.token_manager
            .refresh()
            .await
            .map_err(|e| GcpError::auth_error(&e))
    }

    // ── Generic REST methods ────────────────────────────────────────

    /// GET a GCP API URL and deserialize the JSON response.
    pub async fn get<T: DeserializeOwned>(
        &mut self,
        service: &str,
        path: &str,
        query: &[(&str, &str)],
    ) -> GcpResult<T> {
        let url = format!("{}{}", self.base_url(service), path);
        let token = self.get_token().await?;

        let response = self
            .http
            .get(&url)
            .bearer_auth(&token)
            .header("User-Agent", &self.user_agent)
            .query(&query)
            .send()
            .await
            .map_err(|e| GcpError::from_str(service, &format!("Request failed: {}", e)))?;

        let status = response.status().as_u16();
        if status >= 400 {
            let body = response.text().await.unwrap_or_default();
            return Err(GcpError::from_api_response(service, status, &body));
        }

        response
            .json()
            .await
            .map_err(|e| GcpError::from_str(service, &format!("JSON parse error: {}", e)))
    }

    /// GET that returns the raw response body as a String.
    pub async fn get_text(
        &mut self,
        service: &str,
        path: &str,
        query: &[(&str, &str)],
    ) -> GcpResult<String> {
        let url = format!("{}{}", self.base_url(service), path);
        let token = self.get_token().await?;

        let response = self
            .http
            .get(&url)
            .bearer_auth(&token)
            .header("User-Agent", &self.user_agent)
            .query(&query)
            .send()
            .await
            .map_err(|e| GcpError::from_str(service, &format!("Request failed: {}", e)))?;

        let status = response.status().as_u16();
        if status >= 400 {
            let body = response.text().await.unwrap_or_default();
            return Err(GcpError::from_api_response(service, status, &body));
        }

        response
            .text()
            .await
            .map_err(|e| GcpError::from_str(service, &format!("Body read error: {}", e)))
    }

    /// POST JSON to a GCP API and deserialize the response.
    pub async fn post<B: Serialize, T: DeserializeOwned>(
        &mut self,
        service: &str,
        path: &str,
        body: &B,
    ) -> GcpResult<T> {
        let url = format!("{}{}", self.base_url(service), path);
        let token = self.get_token().await?;

        let response = self
            .http
            .post(&url)
            .bearer_auth(&token)
            .header("User-Agent", &self.user_agent)
            .json(body)
            .send()
            .await
            .map_err(|e| GcpError::from_str(service, &format!("Request failed: {}", e)))?;

        let status = response.status().as_u16();
        if status >= 400 {
            let body_text = response.text().await.unwrap_or_default();
            return Err(GcpError::from_api_response(service, status, &body_text));
        }

        response
            .json()
            .await
            .map_err(|e| GcpError::from_str(service, &format!("JSON parse error: {}", e)))
    }

    /// POST JSON and return raw text (for operations that return non-JSON).
    pub async fn post_text<B: Serialize>(
        &mut self,
        service: &str,
        path: &str,
        body: &B,
    ) -> GcpResult<String> {
        let url = format!("{}{}", self.base_url(service), path);
        let token = self.get_token().await?;

        let response = self
            .http
            .post(&url)
            .bearer_auth(&token)
            .header("User-Agent", &self.user_agent)
            .json(body)
            .send()
            .await
            .map_err(|e| GcpError::from_str(service, &format!("Request failed: {}", e)))?;

        let status = response.status().as_u16();
        if status >= 400 {
            let body_text = response.text().await.unwrap_or_default();
            return Err(GcpError::from_api_response(service, status, &body_text));
        }

        response
            .text()
            .await
            .map_err(|e| GcpError::from_str(service, &format!("Body read error: {}", e)))
    }

    /// PUT JSON to a GCP API.
    pub async fn put<B: Serialize, T: DeserializeOwned>(
        &mut self,
        service: &str,
        path: &str,
        body: &B,
    ) -> GcpResult<T> {
        let url = format!("{}{}", self.base_url(service), path);
        let token = self.get_token().await?;

        let response = self
            .http
            .put(&url)
            .bearer_auth(&token)
            .header("User-Agent", &self.user_agent)
            .json(body)
            .send()
            .await
            .map_err(|e| GcpError::from_str(service, &format!("Request failed: {}", e)))?;

        let status = response.status().as_u16();
        if status >= 400 {
            let body_text = response.text().await.unwrap_or_default();
            return Err(GcpError::from_api_response(service, status, &body_text));
        }

        response
            .json()
            .await
            .map_err(|e| GcpError::from_str(service, &format!("JSON parse error: {}", e)))
    }

    /// PATCH JSON to a GCP API.
    pub async fn patch<B: Serialize, T: DeserializeOwned>(
        &mut self,
        service: &str,
        path: &str,
        body: &B,
        query: &[(&str, &str)],
    ) -> GcpResult<T> {
        let url = format!("{}{}", self.base_url(service), path);
        let token = self.get_token().await?;

        let response = self
            .http
            .patch(&url)
            .bearer_auth(&token)
            .header("User-Agent", &self.user_agent)
            .query(&query)
            .json(body)
            .send()
            .await
            .map_err(|e| GcpError::from_str(service, &format!("Request failed: {}", e)))?;

        let status = response.status().as_u16();
        if status >= 400 {
            let body_text = response.text().await.unwrap_or_default();
            return Err(GcpError::from_api_response(service, status, &body_text));
        }

        response
            .json()
            .await
            .map_err(|e| GcpError::from_str(service, &format!("JSON parse error: {}", e)))
    }

    /// DELETE a resource. Returns the response body as text.
    pub async fn delete(
        &mut self,
        service: &str,
        path: &str,
    ) -> GcpResult<String> {
        let url = format!("{}{}", self.base_url(service), path);
        let token = self.get_token().await?;

        let response = self
            .http
            .delete(&url)
            .bearer_auth(&token)
            .header("User-Agent", &self.user_agent)
            .send()
            .await
            .map_err(|e| GcpError::from_str(service, &format!("Request failed: {}", e)))?;

        let status = response.status().as_u16();
        if status >= 400 {
            let body = response.text().await.unwrap_or_default();
            return Err(GcpError::from_api_response(service, status, &body));
        }

        response
            .text()
            .await
            .map_err(|e| GcpError::from_str(service, &format!("Body read error: {}", e)))
    }

    // ── Pagination helpers ──────────────────────────────────────────

    /// Fetch all pages of a paginated list endpoint.
    ///
    /// `extract` pulls the item Vec out of each page response.
    pub async fn get_all_pages<P, T>(
        &mut self,
        service: &str,
        path: &str,
        base_query: &[(&str, String)],
        extract: fn(&P) -> (Vec<T>, Option<String>),
    ) -> GcpResult<Vec<T>>
    where
        P: DeserializeOwned,
        T: Clone,
    {
        let mut all_items: Vec<T> = Vec::new();
        let mut page_token: Option<String> = None;

        loop {
            let mut query: Vec<(&str, String)> = base_query.to_vec();
            if let Some(ref pt) = page_token {
                query.push(("pageToken", pt.clone()));
            }
            let query_pairs: Vec<(&str, &str)> = query.iter().map(|(k, v)| (*k, v.as_str())).collect();

            let page: P = self.get(service, path, &query_pairs).await?;
            let (items, next) = extract(&page);
            all_items.extend(items);

            if next.is_none() {
                break;
            }
            page_token = next;
        }

        Ok(all_items)
    }

    // ── Operation polling ───────────────────────────────────────────

    /// Poll a long-running operation until it completes.
    pub async fn wait_for_operation(
        &mut self,
        service: &str,
        operation_url: &str,
        max_polls: u32,
        poll_interval_ms: u64,
    ) -> GcpResult<serde_json::Value> {
        for _ in 0..max_polls {
            let op: serde_json::Value = self
                .get(service, operation_url, &[])
                .await?;

            let done = op.get("done").and_then(|v| v.as_bool()).unwrap_or(false);
            // Compute Engine uses "status" = "DONE"
            let status = op
                .get("status")
                .and_then(|v| v.as_str())
                .unwrap_or("");

            if done || status == "DONE" {
                // Check for error
                if let Some(err) = op.get("error") {
                    let msg = err
                        .get("message")
                        .and_then(|v| v.as_str())
                        .unwrap_or("Operation failed");
                    let code = err
                        .get("code")
                        .and_then(|v| v.as_u64())
                        .unwrap_or(500) as u16;
                    return Err(GcpError::new(service, code, "OPERATION_FAILED", msg));
                }
                return Ok(op);
            }

            tokio::time::sleep(Duration::from_millis(poll_interval_ms)).await;
        }

        Err(GcpError::new(
            service,
            408,
            "DEADLINE_EXCEEDED",
            "Operation timed out waiting for completion",
        ))
    }
}

/// Helper to build query params.
pub fn query_params(params: &HashMap<String, String>) -> Vec<(&str, &str)> {
    params.iter().map(|(k, v)| (k.as_str(), v.as_str())).collect()
}
