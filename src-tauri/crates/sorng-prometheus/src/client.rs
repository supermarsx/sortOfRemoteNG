// ── sorng-prometheus – SSH/HTTP client ────────────────────────────────────────
//! Executes Prometheus commands on a remote host via SSH and the HTTP API.

use crate::error::{PrometheusError, PrometheusResult};
use crate::types::*;
use log::debug;
use reqwest::Client as HttpClient;
use std::time::Duration;

/// Prometheus management client – connects via SSH and the HTTP API.
pub struct PrometheusClient {
    pub config: PrometheusConnectionConfig,
    http: HttpClient,
}

impl PrometheusClient {
    pub fn new(config: PrometheusConnectionConfig) -> PrometheusResult<Self> {
        let http = HttpClient::builder()
            .timeout(Duration::from_secs(config.timeout_secs.unwrap_or(30)))
            .build()
            .map_err(|e| PrometheusError::connection(format!("http client build: {e}")))?;
        Ok(Self { config, http })
    }

    // ── URL helpers ──────────────────────────────────────────────

    pub fn api_url(&self, path: &str) -> String {
        let base = self.config.api_url.clone().unwrap_or_else(|| {
            let scheme = if self.config.use_tls.unwrap_or(false) { "https" } else { "http" };
            let port = self.config.port.unwrap_or(9090);
            format!("{scheme}://{}:{port}", self.config.host)
        });
        let base = base.trim_end_matches('/');
        format!("{base}{path}")
    }

    pub fn config_path(&self) -> &str {
        self.config.config_path.as_deref().unwrap_or("/etc/prometheus/prometheus.yml")
    }

    pub fn data_dir(&self) -> &str {
        self.config.data_dir.as_deref().unwrap_or("/var/lib/prometheus")
    }

    pub fn service_name(&self) -> &str {
        self.config.service_name.as_deref().unwrap_or("prometheus")
    }

    // ── SSH command execution stub ───────────────────────────────

    pub async fn exec_ssh(&self, command: &str) -> PrometheusResult<SshOutput> {
        debug!("PROM SSH [{}]: {}", self.config.host, command);
        // Stub: actual implementation would use the SSH subsystem
        Err(PrometheusError::ssh(format!(
            "SSH execution not connected to {}. Command: {}",
            self.config.host, command
        )))
    }

    // ── HTTP API methods ─────────────────────────────────────────

    pub async fn api_get(&self, endpoint: &str) -> PrometheusResult<String> {
        let url = self.api_url(endpoint);
        debug!("PROM GET {}", url);
        let mut req = self.http.get(&url);
        if let (Some(user), Some(pass)) = (&self.config.api_user, &self.config.api_password) {
            req = req.basic_auth(user, Some(pass));
        }
        let resp = req.send().await.map_err(PrometheusError::http)?;
        if !resp.status().is_success() {
            return Err(PrometheusError::api(format!(
                "GET {} returned {}", url, resp.status()
            )));
        }
        resp.text().await.map_err(PrometheusError::http)
    }

    pub async fn api_post(&self, endpoint: &str, body: &str) -> PrometheusResult<String> {
        let url = self.api_url(endpoint);
        debug!("PROM POST {}", url);
        let mut req = self.http.post(&url)
            .header("Content-Type", "application/x-www-form-urlencoded")
            .body(body.to_string());
        if let (Some(user), Some(pass)) = (&self.config.api_user, &self.config.api_password) {
            req = req.basic_auth(user, Some(pass));
        }
        let resp = req.send().await.map_err(PrometheusError::http)?;
        if !resp.status().is_success() {
            return Err(PrometheusError::api(format!(
                "POST {} returned {}", url, resp.status()
            )));
        }
        resp.text().await.map_err(PrometheusError::http)
    }

    pub async fn api_post_json(&self, endpoint: &str, body: &str) -> PrometheusResult<String> {
        let url = self.api_url(endpoint);
        debug!("PROM POST JSON {}", url);
        let mut req = self.http.post(&url)
            .header("Content-Type", "application/json")
            .body(body.to_string());
        if let (Some(user), Some(pass)) = (&self.config.api_user, &self.config.api_password) {
            req = req.basic_auth(user, Some(pass));
        }
        let resp = req.send().await.map_err(PrometheusError::http)?;
        if !resp.status().is_success() {
            return Err(PrometheusError::api(format!(
                "POST {} returned {}", url, resp.status()
            )));
        }
        resp.text().await.map_err(PrometheusError::http)
    }

    pub async fn api_put_json(&self, endpoint: &str, body: &str) -> PrometheusResult<String> {
        let url = self.api_url(endpoint);
        debug!("PROM PUT JSON {}", url);
        let mut req = self.http.put(&url)
            .header("Content-Type", "application/json")
            .body(body.to_string());
        if let (Some(user), Some(pass)) = (&self.config.api_user, &self.config.api_password) {
            req = req.basic_auth(user, Some(pass));
        }
        let resp = req.send().await.map_err(PrometheusError::http)?;
        if !resp.status().is_success() {
            return Err(PrometheusError::api(format!(
                "PUT {} returned {}", url, resp.status()
            )));
        }
        resp.text().await.map_err(PrometheusError::http)
    }

    pub async fn api_delete(&self, endpoint: &str) -> PrometheusResult<String> {
        let url = self.api_url(endpoint);
        debug!("PROM DELETE {}", url);
        let mut req = self.http.delete(&url);
        if let (Some(user), Some(pass)) = (&self.config.api_user, &self.config.api_password) {
            req = req.basic_auth(user, Some(pass));
        }
        let resp = req.send().await.map_err(PrometheusError::http)?;
        if !resp.status().is_success() {
            return Err(PrometheusError::api(format!(
                "DELETE {} returned {}", url, resp.status()
            )));
        }
        resp.text().await.map_err(PrometheusError::http)
    }

    // ── Remote file helpers ──────────────────────────────────────

    pub async fn read_remote_file(&self, path: &str) -> PrometheusResult<String> {
        let out = self.exec_ssh(&format!("cat '{}'", path.replace('\'', "'\\''"))).await?;
        Ok(out.stdout)
    }

    pub async fn write_remote_file(&self, path: &str, content: &str) -> PrometheusResult<()> {
        let escaped = content.replace('\'', "'\\''");
        let cmd = format!("printf '%s' '{}' | sudo tee '{}' > /dev/null", escaped, path.replace('\'', "'\\''"));
        self.exec_ssh(&cmd).await?;
        Ok(())
    }
}
