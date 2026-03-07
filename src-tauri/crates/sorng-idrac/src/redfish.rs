//! Redfish REST/JSON client for iDRAC 7+/8/9.
//!
//! Communicates via `https://{host}:{port}/redfish/v1/…`.
//! Supports Basic Auth and X-Auth-Token session auth.

use crate::error::{IdracError, IdracResult};
use crate::types::{IdracAuthMethod, IdracConfig, IdracSession, OdataLink, RedfishCollection};

use reqwest::{Client, Response, StatusCode};
use serde::de::DeserializeOwned;
use std::time::Duration;

/// Redfish REST client for modern iDRAC.
pub struct RedfishClient {
    client: Client,
    base_url: String,
    config: IdracConfig,
    session: Option<IdracSession>,
    basic_auth: Option<(String, String)>,
}

impl RedfishClient {
    /// Build a new Redfish client (does NOT authenticate yet).
    pub fn new(config: &IdracConfig) -> IdracResult<Self> {
        let client = Client::builder()
            .danger_accept_invalid_certs(config.insecure)
            .timeout(Duration::from_secs(config.timeout_secs))
            .build()
            .map_err(|e| IdracError::connection(format!("Failed to build HTTP client: {e}")))?;

        let base_url = format!("https://{}:{}", config.host, config.port);

        let basic_auth = match &config.auth {
            IdracAuthMethod::Basic { username, password } => {
                Some((username.clone(), password.clone()))
            }
            IdracAuthMethod::Session { username, password } => {
                Some((username.clone(), password.clone()))
            }
        };

        Ok(Self {
            client,
            base_url,
            config: config.clone(),
            session: None,
            basic_auth,
        })
    }

    pub fn base_url(&self) -> &str {
        &self.base_url
    }
    pub fn config(&self) -> &IdracConfig {
        &self.config
    }

    pub fn is_connected(&self) -> bool {
        self.session.is_some() || self.basic_auth.is_some()
    }

    pub fn session(&self) -> Option<&IdracSession> {
        self.session.as_ref()
    }

    // ── Authentication ──────────────────────────────────────────────

    /// Authenticate — try session auth first, fall back to Basic.
    pub async fn login(&mut self) -> IdracResult<String> {
        // Try to get Redfish service root first (validates connectivity)
        let root_url = format!("{}/redfish/v1", self.base_url);
        let (username, password) = self.basic_auth.clone().ok_or_else(|| {
            IdracError::auth("No credentials configured")
        })?;

        // Attempt session-based auth (POST /redfish/v1/Sessions)
        if matches!(self.config.auth, IdracAuthMethod::Session { .. }) {
            match self.create_session(&username, &password).await {
                Ok(session) => {
                    let user = session.username.clone();
                    self.session = Some(session);
                    return Ok(user);
                }
                Err(_) => {
                    // Fall back to Basic auth
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
            .map_err(|e| IdracError::connection(format!("Redfish root request failed: {e}")))?;

        if resp.status() == StatusCode::UNAUTHORIZED {
            return Err(IdracError::auth("Invalid credentials"));
        }
        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(IdracError::api(
                status.as_u16(),
                format!("Service root check failed: {body}"),
            ));
        }

        Ok(username)
    }

    /// Create a Redfish session.
    async fn create_session(
        &self,
        username: &str,
        password: &str,
    ) -> IdracResult<IdracSession> {
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
            .map_err(|e| IdracError::connection(format!("Session create failed: {e}")))?;

        if !resp.status().is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(IdracError::auth(format!("Session auth failed: {body}")));
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

        Ok(IdracSession {
            token,
            session_uri,
            username: username.to_string(),
            connected_at: chrono::Utc::now().to_rfc3339(),
        })
    }

    /// Log out (delete session).
    pub async fn logout(&mut self) -> IdracResult<()> {
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
    pub async fn check_session(&self) -> IdracResult<bool> {
        if !self.is_connected() {
            return Ok(false);
        }
        match self.get_raw("/redfish/v1").await {
            Ok(resp) => Ok(resp.status().is_success()),
            Err(_) => Ok(false),
        }
    }

    // ── HTTP helpers ────────────────────────────────────────────────

    fn auth_request(
        &self,
        builder: reqwest::RequestBuilder,
    ) -> IdracResult<reqwest::RequestBuilder> {
        if let Some(ref session) = self.session {
            Ok(builder.header("X-Auth-Token", &session.token))
        } else if let Some((ref user, ref pass)) = self.basic_auth {
            Ok(builder.basic_auth(user, Some(pass)))
        } else {
            Err(IdracError::auth("Not authenticated"))
        }
    }

    /// GET a Redfish resource, parsed as `T`.
    pub async fn get<T: DeserializeOwned>(&self, path: &str) -> IdracResult<T> {
        let resp = self.get_raw(path).await?;
        let resp = Self::check_status(resp).await?;
        Self::parse_json(resp).await
    }

    /// GET raw Response.
    pub async fn get_raw(&self, path: &str) -> IdracResult<Response> {
        let url = self.full_url(path);
        let builder = self.client.get(&url);
        let builder = self.auth_request(builder)?;
        builder
            .send()
            .await
            .map_err(|e| IdracError::connection(format!("GET {path} failed: {e}")))
    }

    /// GET with query params.
    pub async fn get_with_params<T: DeserializeOwned>(
        &self,
        path: &str,
        params: &[(&str, &str)],
    ) -> IdracResult<T> {
        let url = self.full_url(path);
        let builder = self.client.get(&url).query(params);
        let builder = self.auth_request(builder)?;
        let resp = builder
            .send()
            .await
            .map_err(|e| IdracError::connection(format!("GET {path} failed: {e}")))?;
        let resp = Self::check_status(resp).await?;
        Self::parse_json(resp).await
    }

    /// POST with JSON body.
    pub async fn post_json<B: serde::Serialize, T: DeserializeOwned>(
        &self,
        path: &str,
        body: &B,
    ) -> IdracResult<T> {
        let url = self.full_url(path);
        let builder = self.client.post(&url).json(body);
        let builder = self.auth_request(builder)?;
        let resp = builder
            .send()
            .await
            .map_err(|e| IdracError::connection(format!("POST {path} failed: {e}")))?;
        let resp = Self::check_status(resp).await?;
        Self::parse_json(resp).await
    }

    /// POST with JSON body, returning the Location header (for jobs).
    pub async fn post_action<B: serde::Serialize>(
        &self,
        path: &str,
        body: &B,
    ) -> IdracResult<Option<String>> {
        let url = self.full_url(path);
        let builder = self.client.post(&url).json(body);
        let builder = self.auth_request(builder)?;
        let resp = builder
            .send()
            .await
            .map_err(|e| IdracError::connection(format!("POST {path} failed: {e}")))?;

        let location = resp
            .headers()
            .get("Location")
            .and_then(|v| v.to_str().ok())
            .map(|s| s.to_string());

        // 200, 202, 204 are all success for actions
        if resp.status().is_success() || resp.status() == StatusCode::ACCEPTED {
            return Ok(location);
        }

        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        Err(IdracError::api(
            status.as_u16(),
            format!("POST action {path} failed: {body}"),
        ))
    }

    /// POST with empty body (for simple actions like power reset).
    pub async fn post_empty(&self, path: &str) -> IdracResult<Option<String>> {
        let empty = serde_json::json!({});
        self.post_action(path, &empty).await
    }

    /// PATCH with JSON body (for config updates).
    pub async fn patch_json<B: serde::Serialize>(
        &self,
        path: &str,
        body: &B,
    ) -> IdracResult<()> {
        let url = self.full_url(path);
        let builder = self.client.patch(&url).json(body);
        let builder = self.auth_request(builder)?;
        let resp = builder
            .send()
            .await
            .map_err(|e| IdracError::connection(format!("PATCH {path} failed: {e}")))?;
        Self::check_status(resp).await?;
        Ok(())
    }

    /// PUT with JSON body.
    pub async fn put_json<B: serde::Serialize>(
        &self,
        path: &str,
        body: &B,
    ) -> IdracResult<()> {
        let url = self.full_url(path);
        let builder = self.client.put(&url).json(body);
        let builder = self.auth_request(builder)?;
        let resp = builder
            .send()
            .await
            .map_err(|e| IdracError::connection(format!("PUT {path} failed: {e}")))?;
        Self::check_status(resp).await?;
        Ok(())
    }

    /// DELETE.
    pub async fn delete(&self, path: &str) -> IdracResult<()> {
        let url = self.full_url(path);
        let builder = self.client.delete(&url);
        let builder = self.auth_request(builder)?;
        let resp = builder
            .send()
            .await
            .map_err(|e| IdracError::connection(format!("DELETE {path} failed: {e}")))?;
        Self::check_status(resp).await?;
        Ok(())
    }

    /// Expand all members of a Redfish collection by following @odata.id links.
    pub async fn get_collection_expanded<T: DeserializeOwned>(
        &self,
        path: &str,
    ) -> IdracResult<Vec<T>> {
        // Try $expand first (iDRAC 9 supports it)
        let expanded_path = if path.contains('?') {
            format!("{}&$expand=*($levels=1)", path)
        } else {
            format!("{}?$expand=*($levels=1)", path)
        };

        if let Ok(coll) = self
            .get::<RedfishCollection<T>>(&expanded_path)
            .await
        {
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

    // ── detect iDRAC version ────────────────────────────────────────

    /// Query the service root to detect iDRAC firmware version.
    pub async fn detect_version(&self) -> IdracResult<Option<String>> {
        let root: serde_json::Value = self.get("/redfish/v1").await?;
        // Dell OEM extension: /redfish/v1 → Oem.Dell.ServiceTag, etc.
        // Or look at /redfish/v1/Managers/iDRAC.Embedded.1
        if let Some(ver) = root
            .pointer("/Oem/Dell/iDRACFirmwareVersion")
            .or_else(|| root.pointer("/RedfishVersion"))
            .and_then(|v| v.as_str())
        {
            return Ok(Some(ver.to_string()));
        }

        // Try manager endpoint
        if let Ok(mgr) = self
            .get::<serde_json::Value>("/redfish/v1/Managers/iDRAC.Embedded.1")
            .await
        {
            if let Some(ver) = mgr.get("FirmwareVersion").and_then(|v| v.as_str()) {
                return Ok(Some(ver.to_string()));
            }
        }

        Ok(None)
    }

    // ── Internal ────────────────────────────────────────────────────

    fn full_url(&self, path: &str) -> String {
        if path.starts_with("http") {
            path.to_string()
        } else {
            format!("{}{}", self.base_url, path)
        }
    }

    async fn check_status(resp: Response) -> IdracResult<Response> {
        let status = resp.status();
        if status.is_success() {
            return Ok(resp);
        }

        let code = status.as_u16();
        let body = resp.text().await.unwrap_or_default();

        match status {
            StatusCode::UNAUTHORIZED => Err(IdracError::auth(format!(
                "Session expired or invalid: {body}"
            ))),
            StatusCode::FORBIDDEN => Err(IdracError::access_denied(format!(
                "Access denied: {body}"
            ))),
            StatusCode::NOT_FOUND => Err(IdracError::not_found(format!(
                "Resource not found: {body}"
            ))),
            StatusCode::METHOD_NOT_ALLOWED => Err(IdracError::unsupported(format!(
                "Method not allowed (possibly unsupported on this iDRAC): {body}"
            ))),
            _ => Err(IdracError::api(code, format!("API error {code}: {body}"))),
        }
    }

    async fn parse_json<T: DeserializeOwned>(resp: Response) -> IdracResult<T> {
        let text = resp
            .text()
            .await
            .map_err(|e| IdracError::parse(format!("Failed to read response body: {e}")))?;

        if text.is_empty() {
            return serde_json::from_str("null").map_err(|e| {
                IdracError::parse(format!("Cannot deserialise empty response: {e}"))
            });
        }

        serde_json::from_str(&text).map_err(|e| {
            IdracError::parse(format!(
                "JSON parse error: {e} — body: {}",
                &text[..text.len().min(500)]
            ))
        })
    }
}
