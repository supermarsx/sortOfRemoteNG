// ── sorng-k8s/src/secrets.rs ────────────────────────────────────────────────
//! Secret CRUD with type-aware encoding (Opaque, TLS, DockerConfigJson, etc.).

use crate::client::K8sClient;
use crate::error::{K8sError, K8sResult};
use crate::types::*;
use log::info;

/// Secret management operations.
pub struct SecretManager;

impl SecretManager {
    /// List Secrets in a namespace.
    pub async fn list(
        client: &K8sClient,
        namespace: &str,
        opts: &ListOptions,
    ) -> K8sResult<Vec<SecretInfo>> {
        let url = format!(
            "{}{}",
            client.namespaced_url(namespace, "secrets"),
            K8sClient::list_query(opts)
        );
        let resp: serde_json::Value = client.get(&url).await?;
        let items = resp
            .get("items")
            .and_then(|v| v.as_array())
            .ok_or_else(|| K8sError::parse("Missing 'items' in secret list response"))?;
        Ok(items
            .iter()
            .filter_map(|i| serde_json::from_value(i.clone()).ok())
            .collect())
    }

    /// Get a single Secret.
    pub async fn get(client: &K8sClient, namespace: &str, name: &str) -> K8sResult<SecretInfo> {
        let url = format!("{}/{}", client.namespaced_url(namespace, "secrets"), name);
        client.get(&url).await
    }

    /// Create a Secret.
    pub async fn create(
        client: &K8sClient,
        namespace: &str,
        config: &CreateSecretConfig,
    ) -> K8sResult<SecretInfo> {
        let url = client.namespaced_url(namespace, "secrets");
        let secret_type = Self::secret_type_string(&config.secret_type);
        let body = serde_json::json!({
            "apiVersion": "v1",
            "kind": "Secret",
            "metadata": {
                "name": config.name,
                "namespace": namespace,
                "labels": config.labels,
                "annotations": config.annotations,
            },
            "type": secret_type,
            "data": config.data,
            "stringData": config.string_data,
            "immutable": config.immutable,
        });
        info!(
            "Creating Secret '{}/{}' (type: {})",
            namespace, config.name, secret_type
        );
        client.post(&url, &body).await
    }

    /// Update (replace) a Secret.
    pub async fn update(
        client: &K8sClient,
        namespace: &str,
        name: &str,
        manifest: &serde_json::Value,
    ) -> K8sResult<SecretInfo> {
        let url = format!("{}/{}", client.namespaced_url(namespace, "secrets"), name);
        client.put(&url, manifest).await
    }

    /// Patch a Secret.
    pub async fn patch(
        client: &K8sClient,
        namespace: &str,
        name: &str,
        patch: &serde_json::Value,
    ) -> K8sResult<SecretInfo> {
        let url = format!("{}/{}", client.namespaced_url(namespace, "secrets"), name);
        client.patch(&url, patch).await
    }

    /// Delete a Secret.
    pub async fn delete(
        client: &K8sClient,
        namespace: &str,
        name: &str,
    ) -> K8sResult<serde_json::Value> {
        let url = format!("{}/{}", client.namespaced_url(namespace, "secrets"), name);
        info!("Deleting Secret '{}/{}'", namespace, name);
        client.delete(&url).await
    }

    fn secret_type_string(st: &SecretType) -> String {
        match st {
            SecretType::Opaque => "Opaque".to_string(),
            SecretType::ServiceAccountToken => "kubernetes.io/service-account-token".to_string(),
            SecretType::DockerConfigJson => "kubernetes.io/dockerconfigjson".to_string(),
            SecretType::DockerConfig => "kubernetes.io/dockercfg".to_string(),
            SecretType::BasicAuth => "kubernetes.io/basic-auth".to_string(),
            SecretType::SshAuth => "kubernetes.io/ssh-auth".to_string(),
            SecretType::Tls => "kubernetes.io/tls".to_string(),
            SecretType::BootstrapToken => "bootstrap.kubernetes.io/token".to_string(),
            SecretType::Other(s) => s.clone(),
        }
    }
}
