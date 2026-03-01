use super::api_client::OnePasswordApiClient;
use super::types::*;

/// Health and heartbeat operations for the 1Password Connect server.
pub struct OnePasswordHealth;

impl OnePasswordHealth {
    /// Check if the Connect server is alive.
    pub async fn heartbeat(
        client: &OnePasswordApiClient,
    ) -> Result<bool, OnePasswordError> {
        client.heartbeat().await
    }

    /// Get detailed server health including dependency status.
    pub async fn get_health(
        client: &OnePasswordApiClient,
    ) -> Result<ServerHealth, OnePasswordError> {
        client.health().await
    }

    /// Check if all dependencies are healthy.
    pub async fn is_healthy(
        client: &OnePasswordApiClient,
    ) -> Result<bool, OnePasswordError> {
        let health = client.health().await?;
        if let Some(deps) = &health.dependencies {
            Ok(deps.iter().all(|d| d.status == "ACTIVE"))
        } else {
            Ok(true)
        }
    }

    /// Get the Connect server version.
    pub async fn get_version(
        client: &OnePasswordApiClient,
    ) -> Result<String, OnePasswordError> {
        let health = client.health().await?;
        Ok(health.version)
    }

    /// List unhealthy dependencies.
    pub async fn get_unhealthy_deps(
        client: &OnePasswordApiClient,
    ) -> Result<Vec<ServiceDependency>, OnePasswordError> {
        let health = client.health().await?;
        Ok(health
            .dependencies
            .unwrap_or_default()
            .into_iter()
            .filter(|d| d.status != "ACTIVE")
            .collect())
    }
}
