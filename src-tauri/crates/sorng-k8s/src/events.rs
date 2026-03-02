// ── sorng-k8s/src/events.rs ─────────────────────────────────────────────────
//! Cluster event streaming and filtering.

use crate::client::K8sClient;
use crate::error::{K8sError, K8sResult};
use crate::types::*;

/// Event management operations.
pub struct EventManager;

impl EventManager {
    /// List events in a namespace.
    pub async fn list(client: &K8sClient, namespace: &str, opts: &ListOptions) -> K8sResult<Vec<K8sEvent>> {
        let url = format!("{}{}", client.namespaced_url(namespace, "events"), K8sClient::list_query(opts));
        let resp: serde_json::Value = client.get(&url).await?;
        let items = resp.get("items").and_then(|v| v.as_array())
            .ok_or_else(|| K8sError::parse("Missing 'items' in event list"))?;
        Ok(items.iter().filter_map(|i| serde_json::from_value(i.clone()).ok()).collect())
    }

    /// List events across all namespaces.
    pub async fn list_all(client: &K8sClient, opts: &ListOptions) -> K8sResult<Vec<K8sEvent>> {
        let url = format!("{}/api/v1/events{}", client.base_url, K8sClient::list_query(opts));
        let resp: serde_json::Value = client.get(&url).await?;
        let items = resp.get("items").and_then(|v| v.as_array())
            .ok_or_else(|| K8sError::parse("Missing 'items' in event list"))?;
        Ok(items.iter().filter_map(|i| serde_json::from_value(i.clone()).ok()).collect())
    }

    /// List events for a specific resource.
    pub async fn list_for_resource(
        client: &K8sClient,
        namespace: &str,
        kind: &str,
        name: &str,
    ) -> K8sResult<Vec<K8sEvent>> {
        let field_selector = format!(
            "involvedObject.kind={},involvedObject.name={}",
            kind, name
        );
        let opts = ListOptions {
            field_selector: Some(field_selector),
            ..Default::default()
        };
        Self::list(client, namespace, &opts).await
    }

    /// Filter events with a custom filter.
    pub async fn filter(client: &K8sClient, filter: &EventFilter) -> K8sResult<Vec<K8sEvent>> {
        let mut opts = ListOptions::default();

        let mut field_selectors = Vec::new();
        if let Some(ref name) = filter.involved_object_name {
            field_selectors.push(format!("involvedObject.name={}", name));
        }
        if let Some(ref kind) = filter.involved_object_kind {
            field_selectors.push(format!("involvedObject.kind={}", kind));
        }
        if let Some(ref et) = filter.event_type {
            field_selectors.push(format!("type={}", et));
        }
        if let Some(ref reason) = filter.reason {
            field_selectors.push(format!("reason={}", reason));
        }
        if let Some(ref fs) = filter.field_selector {
            field_selectors.push(fs.clone());
        }
        if !field_selectors.is_empty() {
            opts.field_selector = Some(field_selectors.join(","));
        }
        opts.label_selector = filter.label_selector.clone();
        opts.limit = filter.limit;

        if let Some(ref ns) = filter.namespace {
            Self::list(client, ns, &opts).await
        } else {
            Self::list_all(client, &opts).await
        }
    }

    /// Get warning events (useful for cluster health checks).
    pub async fn list_warnings(client: &K8sClient, namespace: Option<&str>) -> K8sResult<Vec<K8sEvent>> {
        let filter = EventFilter {
            namespace: namespace.map(String::from),
            event_type: Some("Warning".to_string()),
            ..Default::default()
        };
        Self::filter(client, &filter).await
    }

    /// List CRDs (Custom Resource Definitions).
    pub async fn list_crds(client: &K8sClient, opts: &ListOptions) -> K8sResult<Vec<CrdInfo>> {
        let url = format!("{}{}", client.apiextensions_v1_url("customresourcedefinitions"), K8sClient::list_query(opts));
        let resp: serde_json::Value = client.get(&url).await?;
        let empty = vec![];
        let items = resp.get("items").and_then(|v| v.as_array()).unwrap_or(&empty);
        Ok(items.iter().filter_map(|i| serde_json::from_value(i.clone()).ok()).collect())
    }

    /// Get a CRD.
    pub async fn get_crd(client: &K8sClient, name: &str) -> K8sResult<CrdInfo> {
        let url = format!("{}/{}", client.apiextensions_v1_url("customresourcedefinitions"), name);
        client.get(&url).await
    }

    /// List HPAs in a namespace.
    pub async fn list_hpas(client: &K8sClient, namespace: &str, opts: &ListOptions) -> K8sResult<Vec<HpaInfo>> {
        let url = format!("{}{}", client.autoscaling_v2_url(namespace, "horizontalpodautoscalers"), K8sClient::list_query(opts));
        let resp: serde_json::Value = client.get(&url).await?;
        let empty = vec![];
        let items = resp.get("items").and_then(|v| v.as_array()).unwrap_or(&empty);
        Ok(items.iter().filter_map(|i| serde_json::from_value(i.clone()).ok()).collect())
    }

    /// Get an HPA.
    pub async fn get_hpa(client: &K8sClient, namespace: &str, name: &str) -> K8sResult<HpaInfo> {
        let url = format!("{}/{}", client.autoscaling_v2_url(namespace, "horizontalpodautoscalers"), name);
        client.get(&url).await
    }
}

impl Default for EventFilter {
    fn default() -> Self {
        Self {
            namespace: None,
            involved_object_name: None,
            involved_object_kind: None,
            event_type: None,
            reason: None,
            field_selector: None,
            label_selector: None,
            limit: None,
        }
    }
}
