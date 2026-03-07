// ── sorng-freeipa/src/client.rs ───────────────────────────────────────────────
//! FreeIPA JSON-RPC client with cookie-based session authentication.

use crate::error::{FreeIpaError, FreeIpaResult};
use crate::types::*;
use log::{debug, info};
use reqwest::Client;
use std::sync::Arc;
use std::time::Duration;

/// HTTP client for communicating with a FreeIPA server.
pub struct FreeIpaClient {
    pub config: FreeIpaConnectionConfig,
    http: Client,
    session_cookie: Option<String>,
}

impl FreeIpaClient {
    /// Build a new client from a connection config.
    pub fn new(config: FreeIpaConnectionConfig) -> FreeIpaResult<Self> {
        let timeout = config.timeout_secs.unwrap_or(30);
        let verify = config.verify_ssl.unwrap_or(true);

        let http = Client::builder()
            .timeout(Duration::from_secs(timeout))
            .danger_accept_invalid_certs(!verify)
            .cookie_store(true)
            .build()
            .map_err(|e| FreeIpaError::connection(format!("Failed to build HTTP client: {e}")))?;

        Ok(Self {
            config,
            http,
            session_cookie: None,
        })
    }

    /// Authenticate against `/ipa/session/login_password` using form data.
    pub async fn login(&mut self) -> FreeIpaResult<String> {
        let url = format!("{}/ipa/session/login_password", self.config.server_url);
        let params = [
            ("user", self.config.username.as_str()),
            ("password", self.config.password.as_str()),
        ];

        debug!("FreeIPA login to {}", url);
        let resp = self
            .http
            .post(&url)
            .header("Referer", format!("{}/ipa", self.config.server_url))
            .header("Content-Type", "application/x-www-form-urlencoded")
            .header("Accept", "text/plain")
            .form(&params)
            .send()
            .await?;

        let status = resp.status();
        if status == reqwest::StatusCode::UNAUTHORIZED {
            return Err(FreeIpaError::auth("Invalid username or password"));
        }
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(FreeIpaError::http(
                status.as_u16(),
                format!("Login failed ({}): {}", status, body),
            ));
        }

        // Extract session cookie from the cookie jar
        if let Some(cookie) = resp.headers().get("set-cookie") {
            self.session_cookie = cookie.to_str().ok().map(|s| s.to_string());
        }

        let realm = self
            .config
            .realm
            .clone()
            .unwrap_or_else(|| "UNKNOWN".into());
        info!(
            "Authenticated to FreeIPA {} as {}",
            self.config.server_url, self.config.username
        );
        Ok(format!(
            "Authenticated as {} in realm {}",
            self.config.username, realm
        ))
    }

    /// Issue a JSON-RPC call to `/ipa/session/json`.
    pub async fn rpc<T: serde::de::DeserializeOwned>(
        &self,
        method: &str,
        args: Vec<serde_json::Value>,
        options: serde_json::Value,
    ) -> FreeIpaResult<IpaResult<T>> {
        let url = format!("{}/ipa/session/json", self.config.server_url);
        let body = serde_json::json!({
            "method": method,
            "params": [args, options],
            "id": 0
        });

        debug!("FreeIPA RPC: {}", method);
        let resp = self
            .http
            .post(&url)
            .header("Referer", format!("{}/ipa", self.config.server_url))
            .header("Content-Type", "application/json")
            .header("Accept", "application/json")
            .json(&body)
            .send()
            .await?;

        let status = resp.status();
        if status == reqwest::StatusCode::UNAUTHORIZED {
            return Err(FreeIpaError::session_expired("Session expired, re-login required"));
        }
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(FreeIpaError::http(
                status.as_u16(),
                format!("RPC {method} failed ({}): {}", status, body),
            ));
        }

        let ipa_resp: IpaResponse<T> = resp.json().await.map_err(|e| {
            FreeIpaError::parse(format!("Failed to parse response for {method}: {e}"))
        })?;

        if let Some(err) = ipa_resp.error {
            return Err(FreeIpaError::ipa(err.code, err.message));
        }

        ipa_resp
            .result
            .ok_or_else(|| FreeIpaError::parse(format!("No result in response for {method}")))
    }

    /// Ping the FreeIPA server.
    pub async fn ping(&self) -> FreeIpaResult<String> {
        let result: IpaResult<serde_json::Value> =
            self.rpc("ping", vec![], serde_json::json!({"version": "2.251"})).await?;
        Ok(result
            .summary
            .unwrap_or_else(|| "pong".into()))
    }

    /// Check if the session is still authenticated.
    pub fn is_authenticated(&self) -> bool {
        self.session_cookie.is_some()
    }
}
