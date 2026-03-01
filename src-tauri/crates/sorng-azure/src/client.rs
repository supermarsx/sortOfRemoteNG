//! HTTP client wrapper for Azure Resource Manager API.
//!
//! Handles bearer-token injection, rate-limit retries with exponential backoff,
//! pagination via `nextLink`, and standard ARM error extraction.

use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use log::{debug, warn};
use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION, CONTENT_TYPE};
use reqwest::Client;

use crate::types::{
    ArmList, AzureConfig, AzureCredentials, AzureError, AzureErrorKind, AzureResult, AzureToken,
    ARM_BASE,
};

/// Maximum retries for transient / rate-limit errors.
const MAX_RETRIES: u32 = 3;
/// Base delay between retries (doubled each attempt).
const BASE_DELAY_MS: u64 = 500;

/// HTTP client with Azure-specific auth and retry logic.
pub struct AzureClient {
    http: Client,
    token: Option<AzureToken>,
    credentials: Option<AzureCredentials>,
    config: AzureConfig,
    last_request_at: AtomicU64,
}

impl AzureClient {
    pub fn new() -> Self {
        Self {
            http: Client::builder()
                .timeout(Duration::from_secs(30))
                .build()
                .unwrap_or_default(),
            token: None,
            credentials: None,
            config: AzureConfig::new(),
            last_request_at: AtomicU64::new(0),
        }
    }

    // ── Accessors ────────────────────────────────────────────────────

    pub fn config(&self) -> &AzureConfig {
        &self.config
    }

    pub fn config_mut(&mut self) -> &mut AzureConfig {
        &mut self.config
    }

    pub fn set_credentials(&mut self, creds: AzureCredentials) {
        self.credentials = Some(creds);
    }

    pub fn credentials(&self) -> Option<&AzureCredentials> {
        self.credentials.as_ref()
    }

    pub fn set_token(&mut self, token: AzureToken) {
        self.token = Some(token);
    }

    pub fn token(&self) -> Option<&AzureToken> {
        self.token.as_ref()
    }

    pub fn clear_token(&mut self) {
        self.token = None;
    }

    pub fn is_authenticated(&self) -> bool {
        self.token
            .as_ref()
            .map(|t| !t.access_token.is_empty() && !t.is_expired())
            .unwrap_or(false)
    }

    pub fn subscription_id(&self) -> AzureResult<&str> {
        self.credentials
            .as_ref()
            .map(|c| c.subscription_id.as_str())
            .filter(|s| !s.is_empty())
            .ok_or_else(AzureError::subscription_not_set)
    }

    /// Inner reqwest client (for auth module direct use).
    pub fn http(&self) -> &Client {
        &self.http
    }

    // ── URL builders ─────────────────────────────────────────────────

    /// Build an ARM management URL: `https://management.azure.com{path}`
    pub fn arm_url(path: &str) -> String {
        format!("{}{}", ARM_BASE, path)
    }

    /// Subscription-scoped URL.
    pub fn subscription_url(&self, suffix: &str) -> AzureResult<String> {
        let sub = self.subscription_id()?;
        Ok(format!("{}/subscriptions/{}{}", ARM_BASE, sub, suffix))
    }

    /// Resource-group-scoped URL.
    pub fn resource_group_url(&self, rg: &str, suffix: &str) -> AzureResult<String> {
        let sub = self.subscription_id()?;
        Ok(format!(
            "{}/subscriptions/{}/resourceGroups/{}{}",
            ARM_BASE, sub, rg, suffix
        ))
    }

    // ── Auth header builder ──────────────────────────────────────────

    fn auth_headers(&self) -> AzureResult<HeaderMap> {
        let token = self
            .token
            .as_ref()
            .filter(|t| !t.access_token.is_empty())
            .ok_or_else(AzureError::not_authenticated)?;

        let mut headers = HeaderMap::new();
        let val = format!("Bearer {}", token.access_token);
        headers.insert(
            AUTHORIZATION,
            HeaderValue::from_str(&val).map_err(|e| {
                AzureError::new(AzureErrorKind::Auth, format!("Header value error: {e}"))
            })?,
        );
        Ok(headers)
    }

    // ── Core HTTP verbs ──────────────────────────────────────────────

    pub async fn get_json<T: serde::de::DeserializeOwned>(
        &self,
        url: &str,
    ) -> AzureResult<T> {
        let empty: &[(&str, &str)] = &[];
        self.get_json_with_query(url, empty).await
    }

    pub async fn get_json_with_query<T: serde::de::DeserializeOwned>(
        &self,
        url: &str,
        query: &[(impl AsRef<str>, impl AsRef<str>)],
    ) -> AzureResult<T> {
        let headers = self.auth_headers()?;
        self.last_request_at
            .store(now_millis(), Ordering::Relaxed);

        let query_pairs: Vec<(&str, &str)> = query
            .iter()
            .map(|(k, v)| (k.as_ref(), v.as_ref()))
            .collect();

        for attempt in 0..=MAX_RETRIES {
            let resp = self
                .http
                .get(url)
                .headers(headers.clone())
                .query(&query_pairs)
                .send()
                .await
                .map_err(|e| AzureError::new(AzureErrorKind::Network, format!("{e}")))?;

            let status = resp.status();
            if status.is_success() {
                return resp.json::<T>().await.map_err(|e| {
                    AzureError::new(AzureErrorKind::Parse, format!("JSON parse: {e}"))
                });
            }

            if should_retry(status.as_u16()) && attempt < MAX_RETRIES {
                let delay = BASE_DELAY_MS * 2u64.pow(attempt);
                warn!("Azure GET {} → {} – retrying in {}ms", url, status, delay);
                tokio::time::sleep(Duration::from_millis(delay)).await;
                continue;
            }

            let body = resp.text().await.unwrap_or_default();
            return Err(AzureError::from_status(status.as_u16(), &body));
        }

        Err(AzureError::new(
            AzureErrorKind::Network,
            "Max retries exceeded",
        ))
    }

    pub async fn post_json<B: serde::Serialize, T: serde::de::DeserializeOwned>(
        &self,
        url: &str,
        body: &B,
    ) -> AzureResult<T> {
        let headers = self.auth_headers()?;
        self.last_request_at
            .store(now_millis(), Ordering::Relaxed);

        for attempt in 0..=MAX_RETRIES {
            let resp = self
                .http
                .post(url)
                .headers(headers.clone())
                .json(body)
                .send()
                .await
                .map_err(|e| AzureError::new(AzureErrorKind::Network, format!("{e}")))?;

            let status = resp.status();
            if status.is_success() {
                return resp.json::<T>().await.map_err(|e| {
                    AzureError::new(AzureErrorKind::Parse, format!("JSON parse: {e}"))
                });
            }

            if should_retry(status.as_u16()) && attempt < MAX_RETRIES {
                let delay = BASE_DELAY_MS * 2u64.pow(attempt);
                warn!("Azure POST {} → {} – retrying in {}ms", url, status, delay);
                tokio::time::sleep(Duration::from_millis(delay)).await;
                continue;
            }

            let body_text = resp.text().await.unwrap_or_default();
            return Err(AzureError::from_status(status.as_u16(), &body_text));
        }

        Err(AzureError::new(
            AzureErrorKind::Network,
            "Max retries exceeded",
        ))
    }

    /// POST that accepts 200/201/202 and returns Ok(()) on success.
    /// Used for actions like VM start/stop, app service restart, etc.
    pub async fn post_action(
        &self,
        url: &str,
    ) -> AzureResult<()> {
        let headers = self.auth_headers()?;
        self.last_request_at
            .store(now_millis(), Ordering::Relaxed);

        for attempt in 0..=MAX_RETRIES {
            let resp = self
                .http
                .post(url)
                .headers(headers.clone())
                .header(CONTENT_TYPE, "application/json")
                .send()
                .await
                .map_err(|e| AzureError::new(AzureErrorKind::Network, format!("{e}")))?;

            let status = resp.status().as_u16();
            if (200..=204).contains(&status) {
                return Ok(());
            }

            if should_retry(status) && attempt < MAX_RETRIES {
                let delay = BASE_DELAY_MS * 2u64.pow(attempt);
                warn!("Azure POST action {} → {} – retrying in {}ms", url, status, delay);
                tokio::time::sleep(Duration::from_millis(delay)).await;
                continue;
            }

            let body = resp.text().await.unwrap_or_default();
            return Err(AzureError::from_status(status, &body));
        }

        Err(AzureError::new(
            AzureErrorKind::Network,
            "Max retries exceeded",
        ))
    }

    pub async fn put_json<B: serde::Serialize, T: serde::de::DeserializeOwned>(
        &self,
        url: &str,
        body: &B,
    ) -> AzureResult<T> {
        let headers = self.auth_headers()?;
        self.last_request_at
            .store(now_millis(), Ordering::Relaxed);

        for attempt in 0..=MAX_RETRIES {
            let resp = self
                .http
                .put(url)
                .headers(headers.clone())
                .json(body)
                .send()
                .await
                .map_err(|e| AzureError::new(AzureErrorKind::Network, format!("{e}")))?;

            let status = resp.status();
            if status.is_success() {
                return resp.json::<T>().await.map_err(|e| {
                    AzureError::new(AzureErrorKind::Parse, format!("JSON parse: {e}"))
                });
            }

            if should_retry(status.as_u16()) && attempt < MAX_RETRIES {
                let delay = BASE_DELAY_MS * 2u64.pow(attempt);
                warn!("Azure PUT {} → {} – retrying in {}ms", url, status, delay);
                tokio::time::sleep(Duration::from_millis(delay)).await;
                continue;
            }

            let body_text = resp.text().await.unwrap_or_default();
            return Err(AzureError::from_status(status.as_u16(), &body_text));
        }

        Err(AzureError::new(
            AzureErrorKind::Network,
            "Max retries exceeded",
        ))
    }

    pub async fn patch_json<B: serde::Serialize, T: serde::de::DeserializeOwned>(
        &self,
        url: &str,
        body: &B,
    ) -> AzureResult<T> {
        let headers = self.auth_headers()?;
        self.last_request_at
            .store(now_millis(), Ordering::Relaxed);

        for attempt in 0..=MAX_RETRIES {
            let resp = self
                .http
                .patch(url)
                .headers(headers.clone())
                .json(body)
                .send()
                .await
                .map_err(|e| AzureError::new(AzureErrorKind::Network, format!("{e}")))?;

            let status = resp.status();
            if status.is_success() {
                return resp.json::<T>().await.map_err(|e| {
                    AzureError::new(AzureErrorKind::Parse, format!("JSON parse: {e}"))
                });
            }

            if should_retry(status.as_u16()) && attempt < MAX_RETRIES {
                let delay = BASE_DELAY_MS * 2u64.pow(attempt);
                warn!("Azure PATCH {} → {} – retrying in {}ms", url, status, delay);
                tokio::time::sleep(Duration::from_millis(delay)).await;
                continue;
            }

            let body_text = resp.text().await.unwrap_or_default();
            return Err(AzureError::from_status(status.as_u16(), &body_text));
        }

        Err(AzureError::new(
            AzureErrorKind::Network,
            "Max retries exceeded",
        ))
    }

    pub async fn delete(&self, url: &str) -> AzureResult<()> {
        let headers = self.auth_headers()?;
        self.last_request_at
            .store(now_millis(), Ordering::Relaxed);

        for attempt in 0..=MAX_RETRIES {
            let resp = self
                .http
                .delete(url)
                .headers(headers.clone())
                .send()
                .await
                .map_err(|e| AzureError::new(AzureErrorKind::Network, format!("{e}")))?;

            let status = resp.status();
            // 200, 202 (accepted), 204 (no content) are all OK for DELETE
            if status.is_success() || status.as_u16() == 204 {
                return Ok(());
            }

            if should_retry(status.as_u16()) && attempt < MAX_RETRIES {
                let delay = BASE_DELAY_MS * 2u64.pow(attempt);
                warn!("Azure DELETE {} → {} – retrying in {}ms", url, status, delay);
                tokio::time::sleep(Duration::from_millis(delay)).await;
                continue;
            }

            let body = resp.text().await.unwrap_or_default();
            return Err(AzureError::from_status(status.as_u16(), &body));
        }

        Err(AzureError::new(
            AzureErrorKind::Network,
            "Max retries exceeded",
        ))
    }

    // ── Pagination helper ────────────────────────────────────────────

    /// Follow `nextLink` to collect **all** items from a paginated ARM list endpoint.
    pub async fn get_all_pages<T: serde::de::DeserializeOwned + Clone + Default>(
        &self,
        initial_url: &str,
    ) -> AzureResult<Vec<T>> {
        let mut all: Vec<T> = Vec::new();
        let mut url = initial_url.to_string();

        loop {
            debug!("Azure paginate: {}", url);
            let page: ArmList<T> = self.get_json(&url).await?;
            all.extend(page.value);
            match page.next_link {
                Some(next) if !next.is_empty() => url = next,
                _ => break,
            }
        }

        Ok(all)
    }

    /// POST unauthenticated form data (used by auth module for token exchange).
    pub async fn post_form_unauthenticated<T: serde::de::DeserializeOwned>(
        &self,
        url: &str,
        form: &[(impl AsRef<str>, impl AsRef<str>)],
    ) -> AzureResult<T> {
        let form_pairs: Vec<(&str, &str)> = form
            .iter()
            .map(|(k, v)| (k.as_ref(), v.as_ref()))
            .collect();

        let resp = self
            .http
            .post(url)
            .form(&form_pairs)
            .send()
            .await
            .map_err(|e| AzureError::new(AzureErrorKind::Network, format!("{e}")))?;

        if resp.status().is_success() {
            resp.json::<T>().await.map_err(|e| {
                AzureError::new(AzureErrorKind::Parse, format!("JSON parse: {e}"))
            })
        } else {
            let status = resp.status().as_u16();
            let body = resp.text().await.unwrap_or_default();
            Err(AzureError::from_status(status, &body))
        }
    }
}

// ── Helpers ─────────────────────────────────────────────────────────

fn should_retry(status: u16) -> bool {
    matches!(status, 429 | 500 | 502 | 503 | 504)
}

fn now_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

impl Clone for AzureClient {
    fn clone(&self) -> Self {
        Self {
            http: self.http.clone(),
            token: self.token.clone(),
            credentials: self.credentials.clone(),
            config: self.config.clone(),
            last_request_at: AtomicU64::new(
                self.last_request_at.load(Ordering::Relaxed),
            ),
        }
    }
}

// ─── Tests ──────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn new_client_default() {
        let c = AzureClient::new();
        assert!(!c.is_authenticated());
        assert!(c.credentials().is_none());
        assert!(c.token().is_none());
    }

    #[test]
    fn set_token_authenticates() {
        let mut c = AzureClient::new();
        c.set_token(AzureToken {
            access_token: "abc".into(),
            token_type: "Bearer".into(),
            expires_at: Some(chrono::Utc::now() + chrono::Duration::hours(1)),
            resource: None,
        });
        assert!(c.is_authenticated());
    }

    #[test]
    fn expired_token_not_authenticated() {
        let mut c = AzureClient::new();
        c.set_token(AzureToken {
            access_token: "abc".into(),
            token_type: "Bearer".into(),
            expires_at: Some(chrono::Utc::now() - chrono::Duration::hours(1)),
            resource: None,
        });
        assert!(!c.is_authenticated());
    }

    #[test]
    fn clear_token_removes_auth() {
        let mut c = AzureClient::new();
        c.set_token(AzureToken {
            access_token: "abc".into(),
            token_type: "Bearer".into(),
            expires_at: Some(chrono::Utc::now() + chrono::Duration::hours(1)),
            resource: None,
        });
        assert!(c.is_authenticated());
        c.clear_token();
        assert!(!c.is_authenticated());
    }

    #[test]
    fn subscription_id_missing() {
        let c = AzureClient::new();
        assert!(c.subscription_id().is_err());
    }

    #[test]
    fn subscription_id_present() {
        let mut c = AzureClient::new();
        c.set_credentials(AzureCredentials {
            subscription_id: "sub-123".into(),
            ..Default::default()
        });
        assert_eq!(c.subscription_id().unwrap(), "sub-123");
    }

    #[test]
    fn arm_url_construction() {
        let url = AzureClient::arm_url("/subscriptions/abc");
        assert_eq!(url, "https://management.azure.com/subscriptions/abc");
    }

    #[test]
    fn subscription_url_construction() {
        let mut c = AzureClient::new();
        c.set_credentials(AzureCredentials {
            subscription_id: "sub1".into(),
            ..Default::default()
        });
        let url = c
            .subscription_url("/providers/Microsoft.Compute/virtualMachines")
            .unwrap();
        assert!(url.contains("/subscriptions/sub1/providers/Microsoft.Compute"));
    }

    #[test]
    fn resource_group_url_construction() {
        let mut c = AzureClient::new();
        c.set_credentials(AzureCredentials {
            subscription_id: "sub1".into(),
            ..Default::default()
        });
        let url = c.resource_group_url("rg1", "/providers/Microsoft.Compute/virtualMachines").unwrap();
        assert!(url.contains("/resourceGroups/rg1/providers"));
    }

    #[test]
    fn config_access() {
        let c = AzureClient::new();
        assert_eq!(c.config().default_page_size, 100);
    }

    #[test]
    fn clone_client() {
        let c = AzureClient::new();
        let _c2 = c.clone();
    }

    #[test]
    fn should_retry_logic() {
        assert!(should_retry(429));
        assert!(should_retry(500));
        assert!(should_retry(502));
        assert!(should_retry(503));
        assert!(should_retry(504));
        assert!(!should_retry(400));
        assert!(!should_retry(401));
        assert!(!should_retry(404));
    }
}
