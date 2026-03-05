// ─── Exchange Integration – HTTP & PowerShell execution client ───────────────
//!
//! Dual-mode client: Graph API / REST for Exchange Online,
//! PowerShell script execution for on-prem Exchange.

use crate::auth;
use crate::types::*;
use log::{debug, warn};
use reqwest::Client as HttpClient;
use serde::de::DeserializeOwned;
use serde::Serialize;
use std::time::Duration;

/// Unified Exchange client supporting both Graph REST and PowerShell paths.
pub struct ExchangeClient {
    pub http: HttpClient,
    pub config: ExchangeConnectionConfig,
    pub graph_token: Option<ExchangeToken>,
    pub exo_token: Option<ExchangeToken>,
    pub ps_connected: bool,
}

impl ExchangeClient {
    pub fn new(config: ExchangeConnectionConfig) -> Self {
        let http = HttpClient::builder()
            .timeout(Duration::from_secs(config.timeout_secs))
            .danger_accept_invalid_certs(
                config
                    .on_prem
                    .as_ref()
                    .map(|c| c.skip_cert_check)
                    .unwrap_or(false),
            )
            .build()
            .unwrap_or_default();

        Self {
            http,
            config,
            graph_token: None,
            exo_token: None,
            ps_connected: false,
        }
    }

    // ─── Token management ────────────────────────────────────────────────

    /// Ensure the Graph API token is valid, acquiring or refreshing as needed.
    pub async fn ensure_graph_token(&mut self) -> ExchangeResult<()> {
        let creds = self
            .config
            .online
            .as_ref()
            .ok_or_else(|| ExchangeError::auth("online credentials not configured"))?;

        if let Some(ref t) = self.graph_token {
            if !t.is_expired() {
                return Ok(());
            }
        }
        debug!("Graph token expired or missing – acquiring");
        let token = auth::acquire_graph_token(&self.http, creds).await?;
        self.graph_token = Some(token);
        Ok(())
    }

    /// Ensure the EXO management token is valid.
    pub async fn ensure_exo_token(&mut self) -> ExchangeResult<()> {
        let creds = self
            .config
            .online
            .as_ref()
            .ok_or_else(|| ExchangeError::auth("online credentials not configured"))?;

        if let Some(ref t) = self.exo_token {
            if !t.is_expired() {
                return Ok(());
            }
        }
        debug!("EXO token expired or missing – acquiring");
        let token = auth::acquire_exo_token(&self.http, creds).await?;
        self.exo_token = Some(token);
        Ok(())
    }

    fn bearer_graph(&self) -> ExchangeResult<String> {
        self.graph_token
            .as_ref()
            .map(|t| format!("Bearer {}", t.access_token))
            .ok_or_else(|| ExchangeError::auth("not authenticated (no Graph token)"))
    }

    fn bearer_exo(&self) -> ExchangeResult<String> {
        self.exo_token
            .as_ref()
            .map(|t| format!("Bearer {}", t.access_token))
            .ok_or_else(|| ExchangeError::auth("not authenticated (no EXO token)"))
    }

    // ─── Graph REST helpers ──────────────────────────────────────────────

    /// GET a single JSON resource from Graph API.
    pub async fn graph_get<T: DeserializeOwned>(&self, path: &str) -> ExchangeResult<T> {
        let url = format!("{}{}", api::GRAPH_BASE, path);
        let auth = self.bearer_graph()?;

        debug!("Graph GET {url}");
        let resp = self
            .http
            .get(&url)
            .header("Authorization", &auth)
            .header("Content-Type", "application/json")
            .send()
            .await
            .map_err(|e| ExchangeError::connection(format!("Graph GET failed: {e}")))?;

        self.handle_response(resp).await
    }

    /// GET a paged list from Graph API.
    pub async fn graph_list<T: DeserializeOwned>(&self, path: &str) -> ExchangeResult<Vec<T>> {
        let mut results = Vec::new();
        let mut url = format!("{}{}", api::GRAPH_BASE, path);
        let auth = self.bearer_graph()?;

        loop {
            debug!("Graph LIST {url}");
            let resp = self
                .http
                .get(&url)
                .header("Authorization", &auth)
                .header("Content-Type", "application/json")
                .send()
                .await
                .map_err(|e| ExchangeError::connection(format!("Graph LIST failed: {e}")))?;

            let list: GraphList<T> = self.handle_response(resp).await?;
            results.extend(list.value);
            match list.next_link {
                Some(next) if !next.is_empty() => url = next,
                _ => break,
            }
        }
        Ok(results)
    }

    /// POST JSON to Graph API.
    pub async fn graph_post<B: Serialize, T: DeserializeOwned>(
        &self,
        path: &str,
        body: &B,
    ) -> ExchangeResult<T> {
        let url = format!("{}{}", api::GRAPH_BASE, path);
        let auth = self.bearer_graph()?;

        debug!("Graph POST {url}");
        let resp = self
            .http
            .post(&url)
            .header("Authorization", &auth)
            .header("Content-Type", "application/json")
            .json(body)
            .send()
            .await
            .map_err(|e| ExchangeError::connection(format!("Graph POST failed: {e}")))?;

        self.handle_response(resp).await
    }

    /// PATCH JSON on Graph API.
    pub async fn graph_patch<B: Serialize>(
        &self,
        path: &str,
        body: &B,
    ) -> ExchangeResult<()> {
        let url = format!("{}{}", api::GRAPH_BASE, path);
        let auth = self.bearer_graph()?;

        debug!("Graph PATCH {url}");
        let resp = self
            .http
            .patch(&url)
            .header("Authorization", &auth)
            .header("Content-Type", "application/json")
            .json(body)
            .send()
            .await
            .map_err(|e| ExchangeError::connection(format!("Graph PATCH failed: {e}")))?;

        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(ExchangeError {
                kind: ExchangeErrorKind::Graph,
                message: format!("Graph PATCH {status}: {body}"),
                status_code: Some(status.as_u16()),
                code: None,
            });
        }
        Ok(())
    }

    /// DELETE on Graph API.
    pub async fn graph_delete(&self, path: &str) -> ExchangeResult<()> {
        let url = format!("{}{}", api::GRAPH_BASE, path);
        let auth = self.bearer_graph()?;

        debug!("Graph DELETE {url}");
        let resp = self
            .http
            .delete(&url)
            .header("Authorization", &auth)
            .header("Content-Type", "application/json")
            .send()
            .await
            .map_err(|e| ExchangeError::connection(format!("Graph DELETE failed: {e}")))?;

        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(ExchangeError {
                kind: ExchangeErrorKind::Graph,
                message: format!("Graph DELETE {status}: {body}"),
                status_code: Some(status.as_u16()),
                code: None,
            });
        }
        Ok(())
    }

    // ─── PowerShell execution helpers ────────────────────────────────────

    /// Execute a PowerShell command and return the raw stdout.
    ///
    /// In production this delegates to `sorng-powershell` session execution;
    /// the method is designed so the service layer can plug the real executor.
    pub async fn run_ps(&self, script: &str) -> ExchangeResult<String> {
        // This is the integration point: the service layer wraps this with
        // the real sorng-powershell execution engine.
        // For now we return a placeholder indicating the script that would run.
        warn!("run_ps stub – real execution via sorng-powershell session required");
        Ok(format!("{{\"_stub\": true, \"script\": \"{}\"}}", script.replace('"', "\\\"")))
    }

    /// Execute a PowerShell command and deserialise the JSON output.
    pub async fn run_ps_json<T: DeserializeOwned>(&self, script: &str) -> ExchangeResult<T> {
        let json_script = auth::wrap_ps_json(script);
        let raw = self.run_ps(&json_script).await?;
        serde_json::from_str(&raw)
            .map_err(|e| ExchangeError::powershell(format!("JSON parse failed: {e}\nRaw: {raw}")))
    }

    /// Execute multiple PowerShell commands (pipeline).
    pub async fn run_ps_pipeline(&self, commands: &[&str]) -> ExchangeResult<String> {
        let joined = commands.join(" | ");
        self.run_ps(&joined).await
    }

    // ─── Response handling ───────────────────────────────────────────────

    async fn handle_response<T: DeserializeOwned>(
        &self,
        resp: reqwest::Response,
    ) -> ExchangeResult<T> {
        let status = resp.status();
        if status == reqwest::StatusCode::NOT_FOUND {
            let body = resp.text().await.unwrap_or_default();
            return Err(ExchangeError {
                kind: ExchangeErrorKind::NotFound,
                message: format!("resource not found: {body}"),
                status_code: Some(404),
                code: None,
            });
        }
        if status == reqwest::StatusCode::TOO_MANY_REQUESTS {
            let body = resp.text().await.unwrap_or_default();
            return Err(ExchangeError {
                kind: ExchangeErrorKind::Throttled,
                message: format!("throttled: {body}"),
                status_code: Some(429),
                code: None,
            });
        }
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(ExchangeError {
                kind: ExchangeErrorKind::Graph,
                message: format!("{status}: {body}"),
                status_code: Some(status.as_u16()),
                code: None,
            });
        }
        resp.json()
            .await
            .map_err(|e| ExchangeError::unknown(format!("response parse error: {e}")))
    }
}
