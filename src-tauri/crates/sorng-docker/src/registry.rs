// ── sorng-docker/src/registry.rs ──────────────────────────────────────────────
//! Docker registry authentication and catalog operations.

use crate::client::DockerClient;
use crate::error::DockerResult;
use crate::types::*;

pub struct RegistryManager;

impl RegistryManager {
    /// Authenticate with a registry.
    pub async fn login(
        client: &DockerClient,
        creds: &RegistryCredentials,
    ) -> DockerResult<RegistryAuthResult> {
        let body = serde_json::json!({
            "username": creds.username,
            "password": creds.password,
            "serveraddress": creds.server_address,
            "email": creds.email,
        });
        client.post_json("/auth", &body).await
    }

    /// Search images on Docker Hub (via daemon proxy).
    pub async fn search(
        client: &DockerClient,
        term: &str,
        limit: Option<i32>,
    ) -> DockerResult<Vec<RegistrySearchResult>> {
        let path = if let Some(l) = limit {
            format!("/images/search?term={}&limit={}", term, l)
        } else {
            format!("/images/search?term={}", term)
        };
        client.get(&path).await
    }

    /// Get distribution info (manifest/digest) for an image.
    pub async fn distribution_info(
        client: &DockerClient,
        image: &str,
    ) -> DockerResult<serde_json::Value> {
        client.get(&format!("/distribution/{}/json", image)).await
    }
}
