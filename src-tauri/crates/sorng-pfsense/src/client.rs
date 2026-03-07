//! pfSense/OPNsense API client.

use crate::error::{PfsenseError, PfsenseResult};
use crate::types::{PfsenseConnectionConfig, SshOutput};

pub struct PfsenseClient {
    pub config: PfsenseConnectionConfig,
    http: reqwest::Client,
}

impl PfsenseClient {
    pub fn new(config: PfsenseConnectionConfig) -> PfsenseResult<Self> {
        let http = reqwest::Client::builder()
            .danger_accept_invalid_certs(!config.tls_verify)
            .timeout(std::time::Duration::from_secs(config.timeout_secs))
            .build()
            .map_err(|e| PfsenseError::connection(format!("Failed to build HTTP client: {e}")))?;
        Ok(Self { config, http })
    }

    pub fn api_base_url(&self) -> String {
        let scheme = if self.config.tls_verify { "https" } else { "https" };
        format!("{scheme}://{}:{}", self.config.host, self.config.port)
    }

    pub async fn exec_ssh(&self, command: &str) -> PfsenseResult<SshOutput> {
        log::debug!("SSH exec on {}: {}", self.config.host, command);
        // Stub – would use an SSH library in production
        Ok(SshOutput {
            stdout: String::new(),
            stderr: String::new(),
            exit_code: 0,
        })
    }

    pub async fn api_get(&self, endpoint: &str) -> PfsenseResult<serde_json::Value> {
        let url = format!("{}/api/v1{}", self.api_base_url(), endpoint);
        let resp = self.http.get(&url)
            .basic_auth(&self.config.username, Some(&self.config.password))
            .header("X-API-Key", &self.config.api_key)
            .header("X-API-Secret", &self.config.api_secret)
            .send()
            .await
            .map_err(|e| PfsenseError::api(format!("GET {endpoint} failed: {e}")))?;

        if !resp.status().is_success() {
            return Err(PfsenseError::api(format!(
                "GET {endpoint} returned {}",
                resp.status()
            )));
        }

        resp.json::<serde_json::Value>()
            .await
            .map_err(|e| PfsenseError::parse(format!("Failed to parse response: {e}")))
    }

    pub async fn api_post(
        &self,
        endpoint: &str,
        body: &serde_json::Value,
    ) -> PfsenseResult<serde_json::Value> {
        let url = format!("{}/api/v1{}", self.api_base_url(), endpoint);
        let resp = self.http.post(&url)
            .basic_auth(&self.config.username, Some(&self.config.password))
            .header("X-API-Key", &self.config.api_key)
            .header("X-API-Secret", &self.config.api_secret)
            .json(body)
            .send()
            .await
            .map_err(|e| PfsenseError::api(format!("POST {endpoint} failed: {e}")))?;

        if !resp.status().is_success() {
            return Err(PfsenseError::api(format!(
                "POST {endpoint} returned {}",
                resp.status()
            )));
        }

        resp.json::<serde_json::Value>()
            .await
            .map_err(|e| PfsenseError::parse(format!("Failed to parse response: {e}")))
    }

    pub async fn api_put(
        &self,
        endpoint: &str,
        body: &serde_json::Value,
    ) -> PfsenseResult<serde_json::Value> {
        let url = format!("{}/api/v1{}", self.api_base_url(), endpoint);
        let resp = self.http.put(&url)
            .basic_auth(&self.config.username, Some(&self.config.password))
            .header("X-API-Key", &self.config.api_key)
            .header("X-API-Secret", &self.config.api_secret)
            .json(body)
            .send()
            .await
            .map_err(|e| PfsenseError::api(format!("PUT {endpoint} failed: {e}")))?;

        if !resp.status().is_success() {
            return Err(PfsenseError::api(format!(
                "PUT {endpoint} returned {}",
                resp.status()
            )));
        }

        resp.json::<serde_json::Value>()
            .await
            .map_err(|e| PfsenseError::parse(format!("Failed to parse response: {e}")))
    }

    pub async fn api_delete(&self, endpoint: &str) -> PfsenseResult<()> {
        let url = format!("{}/api/v1{}", self.api_base_url(), endpoint);
        let resp = self.http.delete(&url)
            .basic_auth(&self.config.username, Some(&self.config.password))
            .header("X-API-Key", &self.config.api_key)
            .header("X-API-Secret", &self.config.api_secret)
            .send()
            .await
            .map_err(|e| PfsenseError::api(format!("DELETE {endpoint} failed: {e}")))?;

        if !resp.status().is_success() {
            return Err(PfsenseError::api(format!(
                "DELETE {endpoint} returned {}",
                resp.status()
            )));
        }
        Ok(())
    }

    pub async fn read_remote_file(&self, path: &str) -> PfsenseResult<String> {
        let output = self.exec_ssh(&format!("cat {}", self.shell_escape(path))).await?;
        if output.exit_code != 0 {
            return Err(PfsenseError::api(format!(
                "Failed to read {path}: {}",
                output.stderr
            )));
        }
        Ok(output.stdout)
    }

    pub async fn write_remote_file(&self, path: &str, content: &str) -> PfsenseResult<()> {
        let escaped = content.replace('\'', "'\\''");
        let cmd = format!(
            "printf '%s' '{}' > {}",
            escaped,
            self.shell_escape(path)
        );
        let output = self.exec_ssh(&cmd).await?;
        if output.exit_code != 0 {
            return Err(PfsenseError::api(format!(
                "Failed to write {path}: {}",
                output.stderr
            )));
        }
        Ok(())
    }

    pub fn shell_escape(&self, s: &str) -> String {
        format!("'{}'", s.replace('\'', "'\\''"))
    }
}
