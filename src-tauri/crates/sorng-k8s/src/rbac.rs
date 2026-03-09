// ── sorng-k8s/src/rbac.rs ───────────────────────────────────────────────────
//! Roles, ClusterRoles, RoleBindings, ClusterRoleBindings, ServiceAccounts.

use crate::client::K8sClient;
use crate::error::{K8sError, K8sResult};
use crate::types::*;
use log::info;

/// RBAC management operations.
pub struct RbacManager;

impl RbacManager {
    // ── Roles (namespaced) ──────────────────────────────────────────────

    pub async fn list_roles(
        client: &K8sClient,
        namespace: &str,
        opts: &ListOptions,
    ) -> K8sResult<Vec<RoleInfo>> {
        let url = format!(
            "{}{}",
            client.rbac_v1_namespaced_url(namespace, "roles"),
            K8sClient::list_query(opts)
        );
        let resp: serde_json::Value = client.get(&url).await?;
        let empty = vec![];
        let items = resp
            .get("items")
            .and_then(|v| v.as_array())
            .unwrap_or(&empty);
        Ok(items
            .iter()
            .filter_map(|i| serde_json::from_value(i.clone()).ok())
            .collect())
    }

    pub async fn get_role(client: &K8sClient, namespace: &str, name: &str) -> K8sResult<RoleInfo> {
        let url = format!(
            "{}/{}",
            client.rbac_v1_namespaced_url(namespace, "roles"),
            name
        );
        client.get(&url).await
    }

    pub async fn create_role(
        client: &K8sClient,
        namespace: &str,
        config: &CreateRoleConfig,
    ) -> K8sResult<RoleInfo> {
        let url = client.rbac_v1_namespaced_url(namespace, "roles");
        let body = serde_json::json!({
            "apiVersion": "rbac.authorization.k8s.io/v1",
            "kind": "Role",
            "metadata": {
                "name": config.name,
                "namespace": namespace,
                "labels": config.labels,
                "annotations": config.annotations,
            },
            "rules": config.rules,
        });
        info!("Creating Role '{}/{}'", namespace, config.name);
        client.post(&url, &body).await
    }

    pub async fn delete_role(
        client: &K8sClient,
        namespace: &str,
        name: &str,
    ) -> K8sResult<serde_json::Value> {
        let url = format!(
            "{}/{}",
            client.rbac_v1_namespaced_url(namespace, "roles"),
            name
        );
        client.delete(&url).await
    }

    // ── ClusterRoles (cluster-scoped) ───────────────────────────────────

    pub async fn list_cluster_roles(
        client: &K8sClient,
        opts: &ListOptions,
    ) -> K8sResult<Vec<ClusterRoleInfo>> {
        let url = format!(
            "{}{}",
            client.rbac_v1_url("clusterroles"),
            K8sClient::list_query(opts)
        );
        let resp: serde_json::Value = client.get(&url).await?;
        let empty = vec![];
        let items = resp
            .get("items")
            .and_then(|v| v.as_array())
            .unwrap_or(&empty);
        Ok(items
            .iter()
            .filter_map(|i| serde_json::from_value(i.clone()).ok())
            .collect())
    }

    pub async fn get_cluster_role(client: &K8sClient, name: &str) -> K8sResult<ClusterRoleInfo> {
        let url = format!("{}/{}", client.rbac_v1_url("clusterroles"), name);
        client.get(&url).await
    }

    pub async fn create_cluster_role(
        client: &K8sClient,
        config: &CreateClusterRoleConfig,
    ) -> K8sResult<ClusterRoleInfo> {
        let url = client.rbac_v1_url("clusterroles");
        let body = serde_json::json!({
            "apiVersion": "rbac.authorization.k8s.io/v1",
            "kind": "ClusterRole",
            "metadata": {
                "name": config.name,
                "labels": config.labels,
                "annotations": config.annotations,
            },
            "rules": config.rules,
            "aggregationRule": config.aggregation_rule,
        });
        info!("Creating ClusterRole '{}'", config.name);
        client.post(&url, &body).await
    }

    pub async fn delete_cluster_role(
        client: &K8sClient,
        name: &str,
    ) -> K8sResult<serde_json::Value> {
        let url = format!("{}/{}", client.rbac_v1_url("clusterroles"), name);
        client.delete(&url).await
    }

    // ── RoleBindings (namespaced) ───────────────────────────────────────

    pub async fn list_role_bindings(
        client: &K8sClient,
        namespace: &str,
        opts: &ListOptions,
    ) -> K8sResult<Vec<RoleBindingInfo>> {
        let url = format!(
            "{}{}",
            client.rbac_v1_namespaced_url(namespace, "rolebindings"),
            K8sClient::list_query(opts)
        );
        let resp: serde_json::Value = client.get(&url).await?;
        let empty = vec![];
        let items = resp
            .get("items")
            .and_then(|v| v.as_array())
            .unwrap_or(&empty);
        Ok(items
            .iter()
            .filter_map(|i| serde_json::from_value(i.clone()).ok())
            .collect())
    }

    pub async fn get_role_binding(
        client: &K8sClient,
        namespace: &str,
        name: &str,
    ) -> K8sResult<RoleBindingInfo> {
        let url = format!(
            "{}/{}",
            client.rbac_v1_namespaced_url(namespace, "rolebindings"),
            name
        );
        client.get(&url).await
    }

    pub async fn create_role_binding(
        client: &K8sClient,
        namespace: &str,
        config: &CreateRoleBindingConfig,
    ) -> K8sResult<RoleBindingInfo> {
        let url = client.rbac_v1_namespaced_url(namespace, "rolebindings");
        let body = serde_json::json!({
            "apiVersion": "rbac.authorization.k8s.io/v1",
            "kind": "RoleBinding",
            "metadata": {
                "name": config.name,
                "namespace": namespace,
                "labels": config.labels,
                "annotations": config.annotations,
            },
            "subjects": config.subjects,
            "roleRef": config.role_ref,
        });
        info!("Creating RoleBinding '{}/{}'", namespace, config.name);
        client.post(&url, &body).await
    }

    pub async fn delete_role_binding(
        client: &K8sClient,
        namespace: &str,
        name: &str,
    ) -> K8sResult<serde_json::Value> {
        let url = format!(
            "{}/{}",
            client.rbac_v1_namespaced_url(namespace, "rolebindings"),
            name
        );
        client.delete(&url).await
    }

    // ── ClusterRoleBindings (cluster-scoped) ────────────────────────────

    pub async fn list_cluster_role_bindings(
        client: &K8sClient,
        opts: &ListOptions,
    ) -> K8sResult<Vec<ClusterRoleBindingInfo>> {
        let url = format!(
            "{}{}",
            client.rbac_v1_url("clusterrolebindings"),
            K8sClient::list_query(opts)
        );
        let resp: serde_json::Value = client.get(&url).await?;
        let empty = vec![];
        let items = resp
            .get("items")
            .and_then(|v| v.as_array())
            .unwrap_or(&empty);
        Ok(items
            .iter()
            .filter_map(|i| serde_json::from_value(i.clone()).ok())
            .collect())
    }

    pub async fn get_cluster_role_binding(
        client: &K8sClient,
        name: &str,
    ) -> K8sResult<ClusterRoleBindingInfo> {
        let url = format!("{}/{}", client.rbac_v1_url("clusterrolebindings"), name);
        client.get(&url).await
    }

    pub async fn create_cluster_role_binding(
        client: &K8sClient,
        config: &CreateClusterRoleBindingConfig,
    ) -> K8sResult<ClusterRoleBindingInfo> {
        let url = client.rbac_v1_url("clusterrolebindings");
        let body = serde_json::json!({
            "apiVersion": "rbac.authorization.k8s.io/v1",
            "kind": "ClusterRoleBinding",
            "metadata": {
                "name": config.name,
                "labels": config.labels,
                "annotations": config.annotations,
            },
            "subjects": config.subjects,
            "roleRef": config.role_ref,
        });
        info!("Creating ClusterRoleBinding '{}'", config.name);
        client.post(&url, &body).await
    }

    pub async fn delete_cluster_role_binding(
        client: &K8sClient,
        name: &str,
    ) -> K8sResult<serde_json::Value> {
        let url = format!("{}/{}", client.rbac_v1_url("clusterrolebindings"), name);
        client.delete(&url).await
    }

    // ── ServiceAccounts ─────────────────────────────────────────────────

    pub async fn list_service_accounts(
        client: &K8sClient,
        namespace: &str,
        opts: &ListOptions,
    ) -> K8sResult<Vec<ServiceAccountInfo>> {
        let url = format!(
            "{}{}",
            client.namespaced_url(namespace, "serviceaccounts"),
            K8sClient::list_query(opts)
        );
        let resp: serde_json::Value = client.get(&url).await?;
        let empty = vec![];
        let items = resp
            .get("items")
            .and_then(|v| v.as_array())
            .unwrap_or(&empty);
        Ok(items
            .iter()
            .filter_map(|i| serde_json::from_value(i.clone()).ok())
            .collect())
    }

    pub async fn get_service_account(
        client: &K8sClient,
        namespace: &str,
        name: &str,
    ) -> K8sResult<ServiceAccountInfo> {
        let url = format!(
            "{}/{}",
            client.namespaced_url(namespace, "serviceaccounts"),
            name
        );
        client.get(&url).await
    }

    pub async fn create_service_account(
        client: &K8sClient,
        namespace: &str,
        config: &CreateServiceAccountConfig,
    ) -> K8sResult<ServiceAccountInfo> {
        let url = client.namespaced_url(namespace, "serviceaccounts");
        let image_pull_secrets: Vec<serde_json::Value> = config
            .image_pull_secrets
            .iter()
            .map(|name| serde_json::json!({ "name": name }))
            .collect();
        let body = serde_json::json!({
            "apiVersion": "v1",
            "kind": "ServiceAccount",
            "metadata": {
                "name": config.name,
                "namespace": namespace,
                "labels": config.labels,
                "annotations": config.annotations,
            },
            "automountServiceAccountToken": config.automount_service_account_token,
            "imagePullSecrets": image_pull_secrets,
        });
        info!("Creating ServiceAccount '{}/{}'", namespace, config.name);
        client.post(&url, &body).await
    }

    pub async fn delete_service_account(
        client: &K8sClient,
        namespace: &str,
        name: &str,
    ) -> K8sResult<serde_json::Value> {
        let url = format!(
            "{}/{}",
            client.namespaced_url(namespace, "serviceaccounts"),
            name
        );
        client.delete(&url).await
    }

    /// Create a token for a ServiceAccount (TokenRequest API).
    pub async fn create_token(
        client: &K8sClient,
        namespace: &str,
        service_account: &str,
        audience: Option<&str>,
        expiration_secs: Option<i64>,
    ) -> K8sResult<String> {
        let url = format!(
            "{}/{}/token",
            client.namespaced_url(namespace, "serviceaccounts"),
            service_account
        );
        let mut spec = serde_json::json!({});
        if let Some(aud) = audience {
            spec["audiences"] = serde_json::json!([aud]);
        }
        if let Some(exp) = expiration_secs {
            spec["expirationSeconds"] = serde_json::json!(exp);
        }
        let body = serde_json::json!({
            "apiVersion": "authentication.k8s.io/v1",
            "kind": "TokenRequest",
            "spec": spec,
        });
        let resp: serde_json::Value = client.post(&url, &body).await?;
        resp.get("status")
            .and_then(|s| s.get("token"))
            .and_then(|t| t.as_str())
            .map(String::from)
            .ok_or_else(|| K8sError::parse("Missing token in TokenRequest response"))
    }
}
