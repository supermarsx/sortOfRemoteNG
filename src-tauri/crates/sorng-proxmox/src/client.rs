//! Proxmox VE REST API HTTP client with ticket + API-token authentication.
//!
//! Communicates via `https://{host}:{port}/api2/json/...`.
//! Supports two auth flows:
//! 1. Password → POST /api2/json/access/ticket → Cookie + CSRFPreventionToken
//! 2. API Token → PVEAPIToken=<tokenid>=<secret> header

use crate::error::{ProxmoxError, ProxmoxResult};
use crate::types::{ProxmoxAuthMethod, ProxmoxConfig, ProxmoxTicket, PveResponse};

use reqwest::{Client, Response, StatusCode};
use serde::de::DeserializeOwned;
use std::time::Duration;

/// Proxmox VE REST API client.
pub struct PveClient {
    client: Client,
    base_url: String,
    config: ProxmoxConfig,
    ticket: Option<ProxmoxTicket>,
    api_token: Option<String>,
}

impl PveClient {
    /// Build a new client from config (does NOT authenticate yet).
    pub fn new(config: &ProxmoxConfig) -> ProxmoxResult<Self> {
        let client = Client::builder()
            .danger_accept_invalid_certs(config.insecure)
            .timeout(Duration::from_secs(config.timeout_secs))
            .cookie_store(true)
            .build()
            .map_err(|e| ProxmoxError::connection(format!("Failed to build HTTP client: {e}")))?;

        let base_url = format!("https://{}:{}", config.host, config.port);

        Ok(Self {
            client,
            base_url,
            config: config.clone(),
            ticket: None,
            api_token: None,
        })
    }

    pub fn base_url(&self) -> &str {
        &self.base_url
    }
    pub fn config(&self) -> &ProxmoxConfig {
        &self.config
    }

    pub fn is_connected(&self) -> bool {
        self.ticket.is_some() || self.api_token.is_some()
    }

    pub fn ticket(&self) -> Option<&ProxmoxTicket> {
        self.ticket.as_ref()
    }

    // ── Authentication ──────────────────────────────────────────────

    /// Authenticate with the Proxmox VE server.
    pub async fn login(&mut self) -> ProxmoxResult<String> {
        match &self.config.auth {
            ProxmoxAuthMethod::Password {
                username,
                password,
                realm,
                otp,
            } => {
                let url = format!("{}/api2/json/access/ticket", self.base_url);
                let mut params = vec![
                    ("username", format!("{username}@{realm}")),
                    ("password", password.clone()),
                ];
                if let Some(otp_code) = otp {
                    params.push(("otp", otp_code.clone()));
                }

                let resp = self
                    .client
                    .post(&url)
                    .form(&params)
                    .send()
                    .await
                    .map_err(|e| ProxmoxError::connection(format!("Login request failed: {e}")))?;

                if resp.status() == StatusCode::UNAUTHORIZED {
                    return Err(ProxmoxError::auth("Invalid credentials"));
                }

                let status = resp.status();
                if !status.is_success() {
                    let body = resp.text().await.unwrap_or_default();
                    return Err(ProxmoxError::api(
                        status.as_u16(),
                        format!("Login failed: {body}"),
                    ));
                }

                #[derive(serde::Deserialize)]
                struct TicketData {
                    ticket: String,
                    #[serde(alias = "CSRFPreventionToken")]
                    csrf_token: String,
                    username: String,
                }
                let ticket_resp: PveResponse<TicketData> = resp
                    .json()
                    .await
                    .map_err(|e| ProxmoxError::parse(format!("Failed to parse ticket: {e}")))?;

                let info = ticket_resp.data;
                let ticket = ProxmoxTicket {
                    ticket: info.ticket,
                    csrf_token: info.csrf_token,
                    username: info.username.clone(),
                    connected_at: chrono::Utc::now().to_rfc3339(),
                };

                self.ticket = Some(ticket);
                Ok(info.username)
            }
            ProxmoxAuthMethod::ApiToken { token_id, secret } => {
                let token_header = format!("PVEAPIToken={token_id}={secret}");
                self.api_token = Some(token_header);
                // Validate by fetching version
                let _: serde_json::Value = self.get("/api2/json/version").await?;
                Ok(token_id.clone())
            }
        }
    }

    /// Log out (invalidate ticket).
    pub async fn logout(&mut self) -> ProxmoxResult<()> {
        self.ticket = None;
        self.api_token = None;
        Ok(())
    }

    /// Check if the session is still valid.
    pub async fn check_session(&self) -> ProxmoxResult<bool> {
        if !self.is_connected() {
            return Ok(false);
        }
        match self.get_raw("/api2/json/version").await {
            Ok(resp) => Ok(resp.status().is_success()),
            Err(_) => Ok(false),
        }
    }

    // ── HTTP helpers ────────────────────────────────────────────────

    fn auth_headers(
        &self,
        builder: reqwest::RequestBuilder,
    ) -> ProxmoxResult<reqwest::RequestBuilder> {
        if let Some(ref token) = self.api_token {
            Ok(builder.header("Authorization", token.as_str()))
        } else if let Some(ref ticket) = self.ticket {
            Ok(builder
                .header("Cookie", format!("PVEAuthCookie={}", ticket.ticket))
                .header("CSRFPreventionToken", &ticket.csrf_token))
        } else {
            Err(ProxmoxError::auth("Not authenticated"))
        }
    }

    /// GET, returning parsed `PveResponse<T>.data`.
    pub async fn get<T: DeserializeOwned>(&self, path: &str) -> ProxmoxResult<T> {
        let resp = self.get_raw(path).await?;
        let resp = Self::check_status(resp).await?;
        let envelope: PveResponse<T> = Self::parse_response(resp).await?;
        Ok(envelope.data)
    }

    /// GET raw Response.
    pub async fn get_raw(&self, path: &str) -> ProxmoxResult<Response> {
        let url = format!("{}{}", self.base_url, path);
        let builder = self.client.get(&url);
        let builder = self.auth_headers(builder)?;
        builder
            .send()
            .await
            .map_err(|e| ProxmoxError::connection(format!("GET {path} failed: {e}")))
    }

    /// GET with query parameters.
    pub async fn get_with_params<T: DeserializeOwned>(
        &self,
        path: &str,
        params: &[(&str, &str)],
    ) -> ProxmoxResult<T> {
        let url = format!("{}{}", self.base_url, path);
        let builder = self.client.get(&url).query(params);
        let builder = self.auth_headers(builder)?;
        let resp = builder
            .send()
            .await
            .map_err(|e| ProxmoxError::connection(format!("GET {path} failed: {e}")))?;
        let resp = Self::check_status(resp).await?;
        let envelope: PveResponse<T> = Self::parse_response(resp).await?;
        Ok(envelope.data)
    }

    /// POST with form body, returning the UPID (task ID) if applicable.
    pub async fn post_form<T: DeserializeOwned>(
        &self,
        path: &str,
        params: &[(&str, &str)],
    ) -> ProxmoxResult<T> {
        let url = format!("{}{}", self.base_url, path);
        let builder = self.client.post(&url).form(params);
        let builder = self.auth_headers(builder)?;
        let resp = builder
            .send()
            .await
            .map_err(|e| ProxmoxError::connection(format!("POST {path} failed: {e}")))?;
        let resp = Self::check_status(resp).await?;
        let envelope: PveResponse<T> = Self::parse_response(resp).await?;
        Ok(envelope.data)
    }

    /// POST with JSON body.
    pub async fn post_json<B: serde::Serialize, T: DeserializeOwned>(
        &self,
        path: &str,
        body: &B,
    ) -> ProxmoxResult<T> {
        let url = format!("{}{}", self.base_url, path);
        let builder = self.client.post(&url).json(body);
        let builder = self.auth_headers(builder)?;
        let resp = builder
            .send()
            .await
            .map_err(|e| ProxmoxError::connection(format!("POST {path} failed: {e}")))?;
        let resp = Self::check_status(resp).await?;
        let envelope: PveResponse<T> = Self::parse_response(resp).await?;
        Ok(envelope.data)
    }

    /// POST with no body; discards result.
    pub async fn post_empty(&self, path: &str) -> ProxmoxResult<Option<String>> {
        let url = format!("{}{}", self.base_url, path);
        let builder = self.client.post(&url);
        let builder = self.auth_headers(builder)?;
        let resp = builder
            .send()
            .await
            .map_err(|e| ProxmoxError::connection(format!("POST {path} failed: {e}")))?;
        let resp = Self::check_status(resp).await?;
        let text = resp.text().await.unwrap_or_default();
        if text.is_empty() {
            return Ok(None);
        }
        // Try to extract UPID from task response
        if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&text) {
            if let Some(upid) = parsed.get("data").and_then(|d| d.as_str()) {
                return Ok(Some(upid.to_string()));
            }
        }
        Ok(None)
    }

    /// PUT with form body.
    pub async fn put_form(&self, path: &str, params: &[(&str, &str)]) -> ProxmoxResult<()> {
        let url = format!("{}{}", self.base_url, path);
        let builder = self.client.put(&url).form(params);
        let builder = self.auth_headers(builder)?;
        let resp = builder
            .send()
            .await
            .map_err(|e| ProxmoxError::connection(format!("PUT {path} failed: {e}")))?;
        Self::check_status(resp).await?;
        Ok(())
    }

    /// PUT with JSON body.
    pub async fn put_json<B: serde::Serialize>(&self, path: &str, body: &B) -> ProxmoxResult<()> {
        let url = format!("{}{}", self.base_url, path);
        let builder = self.client.put(&url).json(body);
        let builder = self.auth_headers(builder)?;
        let resp = builder
            .send()
            .await
            .map_err(|e| ProxmoxError::connection(format!("PUT {path} failed: {e}")))?;
        Self::check_status(resp).await?;
        Ok(())
    }

    /// DELETE.
    pub async fn delete(&self, path: &str) -> ProxmoxResult<Option<String>> {
        let url = format!("{}{}", self.base_url, path);
        let builder = self.client.delete(&url);
        let builder = self.auth_headers(builder)?;
        let resp = builder
            .send()
            .await
            .map_err(|e| ProxmoxError::connection(format!("DELETE {path} failed: {e}")))?;
        let resp = Self::check_status(resp).await?;
        let text = resp.text().await.unwrap_or_default();
        if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&text) {
            if let Some(upid) = parsed.get("data").and_then(|d| d.as_str()) {
                return Ok(Some(upid.to_string()));
            }
        }
        Ok(None)
    }

    // ── Internal ────────────────────────────────────────────────────

    async fn check_status(resp: Response) -> ProxmoxResult<Response> {
        let status = resp.status();
        if status.is_success() {
            return Ok(resp);
        }

        let code = status.as_u16();
        let body = resp.text().await.unwrap_or_default();

        match status {
            StatusCode::UNAUTHORIZED => Err(ProxmoxError::auth(format!(
                "Session expired or invalid: {body}"
            ))),
            StatusCode::FORBIDDEN => Err(ProxmoxError::access_denied(format!(
                "Access denied: {body}"
            ))),
            StatusCode::NOT_FOUND => Err(ProxmoxError::not_found(format!(
                "Resource not found: {body}"
            ))),
            _ => Err(ProxmoxError::api(code, format!("API error {code}: {body}"))),
        }
    }

    async fn parse_response<T: DeserializeOwned>(resp: Response) -> ProxmoxResult<T> {
        let text = resp
            .text()
            .await
            .map_err(|e| ProxmoxError::parse(format!("Failed to read response body: {e}")))?;

        if text.is_empty() {
            return serde_json::from_str("null").map_err(|e| {
                ProxmoxError::parse(format!("Cannot deserialise empty response: {e}"))
            });
        }

        serde_json::from_str(&text).map_err(|e| {
            ProxmoxError::parse(format!(
                "JSON parse error: {e} — body: {}",
                &text[..text.len().min(500)]
            ))
        })
    }
}
