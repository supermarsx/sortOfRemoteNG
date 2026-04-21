//! Vendor-neutral DMTF Redfish REST/JSON client.
//!
//! Every BMC that supports Redfish (iDRAC 7+, iLO 4+, Supermicro X11+,
//! Lenovo XClarity, …) speaks the same core schema.  This module provides
//! the HTTP plumbing.  OEM extensions are handled in the vendor crate.

use crate::error::{BmcError, BmcResult};
use crate::types::{OdataLink, RedfishCollection};

use reqwest::{Client, Response, StatusCode};
use serde::de::DeserializeOwned;
use std::time::Duration;

/// Configuration required to build a Redfish client.
#[derive(Debug, Clone)]
pub struct RedfishConfig {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: String,
    pub insecure: bool,
    pub timeout_secs: u64,
}

/// Active Redfish session info.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RedfishSession {
    pub token: String,
    pub session_uri: String,
    pub username: String,
    pub connected_at: String,
}

/// A vendor-neutral Redfish REST client.
pub struct RedfishClient {
    client: Client,
    base_url: String,
    config: RedfishConfig,
    session: Option<RedfishSession>,
    basic_auth: Option<(String, String)>,
}

impl RedfishClient {
    /// Build a new Redfish client (does NOT authenticate yet).
    pub fn new(config: &RedfishConfig) -> BmcResult<Self> {
        if config.insecure {
            tracing::warn!(
                security_event = "insecure_tls",
                component = "bmc.redfish",
                host = %config.host,
                port = config.port,
                "TLS verification disabled (danger_accept_invalid_certs=true) for Redfish client"
            );
        }
        let client = Client::builder()
            .danger_accept_invalid_certs(config.insecure)
            .timeout(Duration::from_secs(config.timeout_secs))
            .build()
            .map_err(|e| BmcError::connection(format!("Failed to build HTTP client: {e}")))?;

        let base_url = format!("https://{}:{}", config.host, config.port);

        Ok(Self {
            client,
            base_url,
            config: config.clone(),
            session: None,
            basic_auth: Some((config.username.clone(), config.password.clone())),
        })
    }

    pub fn base_url(&self) -> &str {
        &self.base_url
    }
    pub fn config(&self) -> &RedfishConfig {
        &self.config
    }

    pub fn is_connected(&self) -> bool {
        self.session.is_some() || self.basic_auth.is_some()
    }

    pub fn session(&self) -> Option<&RedfishSession> {
        self.session.as_ref()
    }

    // ── Authentication ──────────────────────────────────────────────

    /// Authenticate via session-based or Basic auth.
    pub async fn login(&mut self, use_session: bool) -> BmcResult<String> {
        let root_url = format!("{}/redfish/v1", self.base_url);
        let (username, password) = self
            .basic_auth
            .clone()
            .ok_or_else(|| BmcError::auth("No credentials configured"))?;

        if use_session {
            match self.create_session(&username, &password).await {
                Ok(session) => {
                    let user = session.username.clone();
                    self.session = Some(session);
                    return Ok(user);
                }
                Err(_) => {
                    log::warn!("Session auth failed, using Basic auth");
                }
            }
        }

        // Validate with Basic auth by fetching service root
        let resp = self
            .client
            .get(&root_url)
            .basic_auth(&username, Some(&password))
            .send()
            .await
            .map_err(|e| BmcError::connection(format!("Redfish root request failed: {e}")))?;

        if resp.status() == StatusCode::UNAUTHORIZED {
            return Err(BmcError::auth("Invalid credentials"));
        }
        if !resp.status().is_success() {
            let status = resp.status().as_u16();
            let body = resp.text().await.unwrap_or_default();
            return Err(BmcError::api(
                status,
                format!("Service root check failed: {body}"),
            ));
        }

        Ok(username)
    }

    async fn create_session(&self, username: &str, password: &str) -> BmcResult<RedfishSession> {
        let url = format!("{}/redfish/v1/SessionService/Sessions", self.base_url);
        let body = serde_json::json!({
            "UserName": username,
            "Password": password
        });

        let resp = self
            .client
            .post(&url)
            .json(&body)
            .send()
            .await
            .map_err(|e| BmcError::connection(format!("Session create failed: {e}")))?;

        if !resp.status().is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(BmcError::auth(format!("Session auth failed: {body}")));
        }

        let token = resp
            .headers()
            .get("X-Auth-Token")
            .and_then(|v| v.to_str().ok())
            .unwrap_or_default()
            .to_string();

        let session_uri = resp
            .headers()
            .get("Location")
            .and_then(|v| v.to_str().ok())
            .unwrap_or_default()
            .to_string();

        Ok(RedfishSession {
            token,
            session_uri,
            username: username.to_string(),
            connected_at: chrono::Utc::now().to_rfc3339(),
        })
    }

    /// Log out (delete session).
    pub async fn logout(&mut self) -> BmcResult<()> {
        if let Some(ref session) = self.session {
            if !session.session_uri.is_empty() {
                let url = if session.session_uri.starts_with("http") {
                    session.session_uri.clone()
                } else {
                    format!("{}{}", self.base_url, session.session_uri)
                };
                let _ = self
                    .client
                    .delete(&url)
                    .header("X-Auth-Token", &session.token)
                    .send()
                    .await;
            }
        }
        self.session = None;
        Ok(())
    }

    /// Check session validity.
    pub async fn check_session(&self) -> BmcResult<bool> {
        if !self.is_connected() {
            return Ok(false);
        }
        match self.get_raw("/redfish/v1").await {
            Ok(resp) => Ok(resp.status().is_success()),
            Err(_) => Ok(false),
        }
    }

    // ── HTTP helpers ────────────────────────────────────────────────

    fn auth_request(&self, builder: reqwest::RequestBuilder) -> BmcResult<reqwest::RequestBuilder> {
        if let Some(ref session) = self.session {
            Ok(builder.header("X-Auth-Token", &session.token))
        } else if let Some((ref user, ref pass)) = self.basic_auth {
            Ok(builder.basic_auth(user, Some(pass)))
        } else {
            Err(BmcError::auth("Not authenticated"))
        }
    }

    /// GET a Redfish resource, parsed as `T`.
    pub async fn get<T: DeserializeOwned>(&self, path: &str) -> BmcResult<T> {
        let resp = self.get_raw(path).await?;
        let resp = Self::check_status(resp).await?;
        Self::parse_json(resp).await
    }

    /// GET raw Response.
    pub async fn get_raw(&self, path: &str) -> BmcResult<Response> {
        let url = self.full_url(path);
        let builder = self.client.get(&url);
        let builder = self.auth_request(builder)?;
        builder
            .send()
            .await
            .map_err(|e| BmcError::connection(format!("GET {path} failed: {e}")))
    }

    /// POST with JSON body, returning the Location header (for jobs).
    pub async fn post_action<B: serde::Serialize>(
        &self,
        path: &str,
        body: &B,
    ) -> BmcResult<Option<String>> {
        let url = self.full_url(path);
        let builder = self.client.post(&url).json(body);
        let builder = self.auth_request(builder)?;
        let resp = builder
            .send()
            .await
            .map_err(|e| BmcError::connection(format!("POST {path} failed: {e}")))?;

        let location = resp
            .headers()
            .get("Location")
            .and_then(|v| v.to_str().ok())
            .map(|s| s.to_string());

        if resp.status().is_success() || resp.status() == StatusCode::ACCEPTED {
            return Ok(location);
        }

        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        Err(BmcError::api(
            status.as_u16(),
            format!("POST action {path} failed: {body}"),
        ))
    }

    /// POST with JSON body, parsed response.
    pub async fn post_json<B: serde::Serialize, T: DeserializeOwned>(
        &self,
        path: &str,
        body: &B,
    ) -> BmcResult<T> {
        let url = self.full_url(path);
        let builder = self.client.post(&url).json(body);
        let builder = self.auth_request(builder)?;
        let resp = builder
            .send()
            .await
            .map_err(|e| BmcError::connection(format!("POST {path} failed: {e}")))?;
        let resp = Self::check_status(resp).await?;
        Self::parse_json(resp).await
    }

    /// PATCH with JSON body (for config updates).
    pub async fn patch_json<B: serde::Serialize>(&self, path: &str, body: &B) -> BmcResult<()> {
        let url = self.full_url(path);
        let builder = self.client.patch(&url).json(body);
        let builder = self.auth_request(builder)?;
        let resp = builder
            .send()
            .await
            .map_err(|e| BmcError::connection(format!("PATCH {path} failed: {e}")))?;
        Self::check_status(resp).await?;
        Ok(())
    }

    /// DELETE.
    pub async fn delete(&self, path: &str) -> BmcResult<()> {
        let url = self.full_url(path);
        let builder = self.client.delete(&url);
        let builder = self.auth_request(builder)?;
        let resp = builder
            .send()
            .await
            .map_err(|e| BmcError::connection(format!("DELETE {path} failed: {e}")))?;
        Self::check_status(resp).await?;
        Ok(())
    }

    /// Expand all members of a Redfish collection.
    pub async fn get_collection_expanded<T: DeserializeOwned>(
        &self,
        path: &str,
    ) -> BmcResult<Vec<T>> {
        // Try $expand first
        let expanded_path = if path.contains('?') {
            format!("{}&$expand=*($levels=1)", path)
        } else {
            format!("{}?$expand=*($levels=1)", path)
        };

        if let Ok(coll) = self.get::<RedfishCollection<T>>(&expanded_path).await {
            return Ok(coll.members);
        }

        // Fall back to enumerate + fetch each
        let coll: RedfishCollection<OdataLink> = self.get(path).await?;
        let mut items = Vec::with_capacity(coll.members.len());
        for link in &coll.members {
            match self.get::<T>(&link.odata_id).await {
                Ok(item) => items.push(item),
                Err(e) => log::warn!("Failed to expand {}: {e}", link.odata_id),
            }
        }
        Ok(items)
    }

    /// Query the Redfish service root version.
    pub async fn get_service_root_version(&self) -> BmcResult<Option<String>> {
        let root: serde_json::Value = self.get("/redfish/v1").await?;
        Ok(root
            .get("RedfishVersion")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()))
    }

    // ── Internal ────────────────────────────────────────────────────

    pub fn full_url(&self, path: &str) -> String {
        if path.starts_with("http") {
            path.to_string()
        } else {
            format!("{}{}", self.base_url, path)
        }
    }

    async fn check_status(resp: Response) -> BmcResult<Response> {
        let status = resp.status();
        if status.is_success() {
            return Ok(resp);
        }

        let code = status.as_u16();
        let body = resp.text().await.unwrap_or_default();

        match status {
            StatusCode::UNAUTHORIZED => Err(BmcError::auth(format!(
                "Session expired or invalid: {body}"
            ))),
            StatusCode::FORBIDDEN => Err(BmcError::access_denied(format!("Access denied: {body}"))),
            StatusCode::NOT_FOUND => {
                Err(BmcError::not_found(format!("Resource not found: {body}")))
            }
            _ => Err(BmcError::api(code, format!("API error {code}: {body}"))),
        }
    }

    async fn parse_json<T: DeserializeOwned>(resp: Response) -> BmcResult<T> {
        let text = resp
            .text()
            .await
            .map_err(|e| BmcError::parse(format!("Failed to read response body: {e}")))?;

        if text.is_empty() {
            return serde_json::from_str("null")
                .map_err(|e| BmcError::parse(format!("Cannot deserialise empty response: {e}")));
        }

        serde_json::from_str(&text).map_err(|e| {
            BmcError::parse(format!(
                "JSON parse error: {e} — body: {}",
                &text[..text.len().min(500)]
            ))
        })
    }
}
