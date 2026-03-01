//! Google Cloud Secret Manager client.
//!
//! Covers secrets, secret versions, and access operations.
//!
//! API base: `https://secretmanager.googleapis.com/v1`

use crate::client::GcpClient;
use crate::error::GcpResult;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

const SERVICE: &str = "secretmanager";
const V1: &str = "/v1";

// ── Types ───────────────────────────────────────────────────────────────

/// Secret Manager secret.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Secret {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub labels: HashMap<String, String>,
    #[serde(default, rename = "createTime")]
    pub create_time: Option<String>,
    #[serde(default)]
    pub replication: Option<serde_json::Value>,
    #[serde(default)]
    pub etag: Option<String>,
    #[serde(default, rename = "expireTime")]
    pub expire_time: Option<String>,
    #[serde(default)]
    pub rotation: Option<serde_json::Value>,
    #[serde(default, rename = "versionAliases")]
    pub version_aliases: HashMap<String, String>,
}

/// Secret version.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SecretVersion {
    #[serde(default)]
    pub name: String,
    #[serde(default, rename = "createTime")]
    pub create_time: Option<String>,
    #[serde(default, rename = "destroyTime")]
    pub destroy_time: Option<String>,
    #[serde(default)]
    pub state: String,
    #[serde(default)]
    pub etag: Option<String>,
    #[serde(default, rename = "replicationStatus")]
    pub replication_status: Option<serde_json::Value>,
}

/// Accessed secret payload.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SecretPayload {
    /// The secret data (base64-encoded by the API).
    #[serde(default)]
    pub data: String,
    #[serde(default, rename = "dataCrc32c")]
    pub data_crc32c: Option<String>,
}

#[derive(Debug, Deserialize)]
struct AccessSecretResponse {
    #[serde(default)]
    name: String,
    #[serde(default)]
    payload: Option<SecretPayload>,
}

// ── List wrappers ───────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
struct SecretList {
    #[serde(default)]
    secrets: Vec<Secret>,
    #[serde(default, rename = "nextPageToken")]
    next_page_token: Option<String>,
    #[serde(default, rename = "totalSize")]
    total_size: Option<u64>,
}

#[derive(Debug, Deserialize)]
struct VersionList {
    #[serde(default)]
    versions: Vec<SecretVersion>,
    #[serde(default, rename = "nextPageToken")]
    next_page_token: Option<String>,
    #[serde(default, rename = "totalSize")]
    total_size: Option<u64>,
}

// ── Secret Manager Client ───────────────────────────────────────────────

pub struct SecretManagerClient;

impl SecretManagerClient {
    /// List secrets in a project.
    pub async fn list_secrets(
        client: &mut GcpClient,
        project: &str,
    ) -> GcpResult<Vec<Secret>> {
        let path = format!("{}/projects/{}/secrets", V1, project);
        let resp: SecretList = client.get(SERVICE, &path, &[]).await?;
        Ok(resp.secrets)
    }

    /// Get a secret by name.
    pub async fn get_secret(
        client: &mut GcpClient,
        project: &str,
        secret_id: &str,
    ) -> GcpResult<Secret> {
        let path = format!("{}/projects/{}/secrets/{}", V1, project, secret_id);
        client.get(SERVICE, &path, &[]).await
    }

    /// Create a secret (empty, then add versions).
    pub async fn create_secret(
        client: &mut GcpClient,
        project: &str,
        secret_id: &str,
        labels: Option<HashMap<String, String>>,
    ) -> GcpResult<Secret> {
        let path = format!("{}/projects/{}/secrets?secretId={}", V1, project, secret_id);
        let mut body = serde_json::json!({
            "replication": {
                "automatic": {}
            }
        });
        if let Some(lbls) = labels {
            body["labels"] = serde_json::to_value(lbls).unwrap_or_default();
        }
        client.post(SERVICE, &path, &body).await
    }

    /// Delete a secret.
    pub async fn delete_secret(
        client: &mut GcpClient,
        project: &str,
        secret_id: &str,
    ) -> GcpResult<()> {
        let path = format!("{}/projects/{}/secrets/{}", V1, project, secret_id);
        client.delete(SERVICE, &path).await?;
        Ok(())
    }

    /// Update secret labels.
    pub async fn update_secret_labels(
        client: &mut GcpClient,
        project: &str,
        secret_id: &str,
        labels: HashMap<String, String>,
    ) -> GcpResult<Secret> {
        let path = format!("{}/projects/{}/secrets/{}", V1, project, secret_id);
        let body = serde_json::json!({ "labels": labels });
        let query = [("updateMask", "labels")];
        client.patch(SERVICE, &path, &body, &query).await
    }

    // ── Versions ────────────────────────────────────────────────────

    /// Add a new version to a secret.
    pub async fn add_secret_version(
        client: &mut GcpClient,
        project: &str,
        secret_id: &str,
        data: &str,
    ) -> GcpResult<SecretVersion> {
        let path = format!(
            "{}/projects/{}/secrets/{}:addVersion",
            V1, project, secret_id
        );
        let encoded = base64::Engine::encode(
            &base64::engine::general_purpose::STANDARD,
            data.as_bytes(),
        );
        let body = serde_json::json!({
            "payload": {
                "data": encoded,
            }
        });
        client.post(SERVICE, &path, &body).await
    }

    /// List versions of a secret.
    pub async fn list_secret_versions(
        client: &mut GcpClient,
        project: &str,
        secret_id: &str,
    ) -> GcpResult<Vec<SecretVersion>> {
        let path = format!(
            "{}/projects/{}/secrets/{}/versions",
            V1, project, secret_id
        );
        let resp: VersionList = client.get(SERVICE, &path, &[]).await?;
        Ok(resp.versions)
    }

    /// Access a secret version's value.
    pub async fn access_secret_version(
        client: &mut GcpClient,
        project: &str,
        secret_id: &str,
        version: &str,
    ) -> GcpResult<String> {
        let path = format!(
            "{}/projects/{}/secrets/{}/versions/{}:access",
            V1, project, secret_id, version
        );
        let resp: AccessSecretResponse = client.get(SERVICE, &path, &[]).await?;
        if let Some(payload) = resp.payload {
            let bytes = base64::Engine::decode(
                &base64::engine::general_purpose::STANDARD,
                &payload.data,
            )
            .map_err(|e| crate::error::GcpError::from_str(SERVICE, &format!("Base64 decode: {}", e)))?;
            String::from_utf8(bytes)
                .map_err(|e| crate::error::GcpError::from_str(SERVICE, &format!("UTF-8 decode: {}", e)))
        } else {
            Ok(String::new())
        }
    }

    /// Destroy a secret version.
    pub async fn destroy_secret_version(
        client: &mut GcpClient,
        project: &str,
        secret_id: &str,
        version: &str,
    ) -> GcpResult<SecretVersion> {
        let path = format!(
            "{}/projects/{}/secrets/{}/versions/{}:destroy",
            V1, project, secret_id, version
        );
        client
            .post(SERVICE, &path, &serde_json::json!({}))
            .await
    }

    /// Enable a disabled secret version.
    pub async fn enable_secret_version(
        client: &mut GcpClient,
        project: &str,
        secret_id: &str,
        version: &str,
    ) -> GcpResult<SecretVersion> {
        let path = format!(
            "{}/projects/{}/secrets/{}/versions/{}:enable",
            V1, project, secret_id, version
        );
        client
            .post(SERVICE, &path, &serde_json::json!({}))
            .await
    }

    /// Disable a secret version.
    pub async fn disable_secret_version(
        client: &mut GcpClient,
        project: &str,
        secret_id: &str,
        version: &str,
    ) -> GcpResult<SecretVersion> {
        let path = format!(
            "{}/projects/{}/secrets/{}/versions/{}:disable",
            V1, project, secret_id, version
        );
        client
            .post(SERVICE, &path, &serde_json::json!({}))
            .await
    }
}
