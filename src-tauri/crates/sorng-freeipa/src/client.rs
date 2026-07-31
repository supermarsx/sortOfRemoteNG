// ── sorng-freeipa/src/client.rs ───────────────────────────────────────────────
//! FreeIPA JSON-RPC client with cookie-based session authentication.

use crate::error::{FreeIpaError, FreeIpaResult};
use crate::types::*;
use log::{debug, info};
use reqwest::Client;
use std::time::Duration;

const MAX_RESPONSE_BODY_BYTES: usize = 8 * 1024 * 1024;

async fn read_bounded_response(mut response: reqwest::Response) -> FreeIpaResult<Vec<u8>> {
    if response
        .content_length()
        .is_some_and(|length| length > MAX_RESPONSE_BODY_BYTES as u64)
    {
        return Err(FreeIpaError::parse(
            "FreeIPA response body exceeds the 8 MiB safety limit".to_string(),
        ));
    }

    let mut body = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| {
        FreeIpaError::parse("Failed to read FreeIPA response body".to_string())
    })? {
        let remaining_probe = MAX_RESPONSE_BODY_BYTES + 1 - body.len();
        let take = chunk.len().min(remaining_probe);
        body.try_reserve(take).map_err(|_| {
            FreeIpaError::parse("Unable to buffer FreeIPA response body".to_string())
        })?;
        body.extend_from_slice(&chunk[..take]);

        if body.len() > MAX_RESPONSE_BODY_BYTES {
            return Err(FreeIpaError::parse(
                "FreeIPA response body exceeds the 8 MiB safety limit".to_string(),
            ));
        }
    }

    Ok(body)
}

async fn read_bounded_text(response: reqwest::Response) -> FreeIpaResult<String> {
    let _body = read_bounded_response(response).await?;
    Ok("response details omitted".to_string())
}

async fn read_bounded_json<T: serde::de::DeserializeOwned>(
    response: reqwest::Response,
) -> FreeIpaResult<T> {
    let body = read_bounded_response(response).await?;
    serde_json::from_slice(&body)
        .map_err(|_| FreeIpaError::parse("FreeIPA response was not valid JSON".to_string()))
}

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
        if !verify {
            return Err(FreeIpaError::connection(
                "TLS certificate verification cannot be disabled: verify_ssl=false requires an explicit runtime acknowledgement contract",
            ));
        }

        let http = Client::builder()
            .timeout(Duration::from_secs(timeout))
            .redirect(reqwest::redirect::Policy::none())
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

        debug!("FreeIPA request");
        let resp = self
            .http
            .post(&url)
            .header("Referer", format!("{}/ipa", self.config.server_url))
            .header("Content-Type", "application/x-www-form-urlencoded")
            .header("Accept", "text/plain")
            .form(&params)
            .send()
            .await
            .map_err(|_| FreeIpaError::connection("FreeIPA request failed"))?;

        let status = resp.status();
        if status == reqwest::StatusCode::UNAUTHORIZED {
            return Err(FreeIpaError::auth("Invalid username or password"));
        }
        if !status.is_success() {
            let _ = read_bounded_text(resp).await?;
            return Err(FreeIpaError::http(
                status.as_u16(),
                format!("FreeIPA login failed with HTTP {}", status.as_u16()),
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
        info!("FreeIPA authentication succeeded");
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

        debug!("FreeIPA request");
        let resp = self
            .http
            .post(&url)
            .header("Referer", format!("{}/ipa", self.config.server_url))
            .header("Content-Type", "application/json")
            .header("Accept", "application/json")
            .json(&body)
            .send()
            .await
            .map_err(|_| FreeIpaError::connection("FreeIPA request failed"))?;

        let status = resp.status();
        if status == reqwest::StatusCode::UNAUTHORIZED {
            return Err(FreeIpaError::session_expired(
                "Session expired, re-login required",
            ));
        }
        if !status.is_success() {
            let _ = read_bounded_text(resp).await?;
            return Err(FreeIpaError::http(
                status.as_u16(),
                format!("FreeIPA RPC failed with HTTP {}", status.as_u16()),
            ));
        }

        let ipa_resp: IpaResponse<T> = read_bounded_json(resp).await?;

        if let Some(err) = ipa_resp.error {
            return Err(FreeIpaError::ipa(err.code, "FreeIPA API reported an error".to_string()));
        }

        ipa_resp
            .result
            .ok_or_else(|| FreeIpaError::parse("FreeIPA response did not include a result".to_string()))
    }

    /// Ping the FreeIPA server.
    pub async fn ping(&self) -> FreeIpaResult<String> {
        let result: IpaResult<serde_json::Value> = self
            .rpc("ping", vec![], serde_json::json!({"version": "2.251"}))
            .await?;
        Ok(result.summary.unwrap_or_else(|| "pong".into()))
    }

    /// Check if the session is still authenticated.
    pub fn is_authenticated(&self) -> bool {
        self.session_cookie.is_some()
    }
}
