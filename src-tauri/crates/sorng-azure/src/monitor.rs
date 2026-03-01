//! Azure Monitor – Metrics, metric definitions, activity log.

use log::debug;

use crate::client::AzureClient;
use crate::types::{
    ActivityLogEntry, AzureResult, MetricDefinition, MetricResponse,
};

// ─── Metric Definitions ─────────────────────────────────────────────

/// List available metric definitions for a resource.
/// `resource_id` is the full ARM resource ID (e.g. `/subscriptions/.../resourceGroups/.../providers/...`).
pub async fn list_metric_definitions(
    client: &AzureClient,
    resource_id: &str,
) -> AzureResult<Vec<MetricDefinition>> {
    let api = &client.config().api_version_monitor;
    let url = format!(
        "{}{}/providers/microsoft.insights/metricDefinitions?api-version={}",
        crate::types::ARM_BASE,
        resource_id,
        api
    );
    debug!("list_metric_definitions({}) → {}", resource_id, url);
    client.get_all_pages(&url).await
}

// ─── Metrics ────────────────────────────────────────────────────────

/// Query metrics for a resource.
///
/// - `metric_names`: comma-separated metric names (e.g. `"Percentage CPU,Network In Total"`)
/// - `timespan`: ISO 8601 duration or interval (e.g. `"PT1H"`, `"2024-01-01T00:00:00Z/2024-01-02T00:00:00Z"`)
/// - `interval`: aggregation granularity (e.g. `"PT5M"`, `"PT1H"`)
/// - `aggregation`: comma-separated (e.g. `"Average,Maximum"`)
pub async fn query_metrics(
    client: &AzureClient,
    resource_id: &str,
    metric_names: &str,
    timespan: Option<&str>,
    interval: Option<&str>,
    aggregation: Option<&str>,
) -> AzureResult<MetricResponse> {
    let api = &client.config().api_version_monitor;
    let mut url = format!(
        "{}{}/providers/microsoft.insights/metrics?api-version={}&metricnames={}",
        crate::types::ARM_BASE,
        resource_id,
        api,
        metric_names
    );
    if let Some(ts) = timespan {
        url.push_str(&format!("&timespan={}", ts));
    }
    if let Some(iv) = interval {
        url.push_str(&format!("&interval={}", iv));
    }
    if let Some(ag) = aggregation {
        url.push_str(&format!("&aggregation={}", ag));
    }
    debug!("query_metrics({}) → {}", resource_id, url);
    client.get_json(&url).await
}

// ─── Activity Log ───────────────────────────────────────────────────

/// List activity-log events for the subscription.
///
/// - `filter`: OData filter, e.g. `"eventTimestamp ge '2024-01-01'"`.
/// - `select`: optional comma-separated fields.
pub async fn list_activity_log(
    client: &AzureClient,
    filter: &str,
    select: Option<&str>,
) -> AzureResult<Vec<ActivityLogEntry>> {
    let api = &client.config().api_version_monitor;
    let mut path = format!(
        "/providers/microsoft.insights/eventtypes/management/values?api-version={}&$filter={}",
        api, filter
    );
    if let Some(s) = select {
        path.push_str(&format!("&$select={}", s));
    }
    let url = client.subscription_url(&path)?;
    debug!("list_activity_log → {}", url);
    client.get_all_pages(&url).await
}

// ─── Tests ──────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn metric_definition_deserialize() {
        let json = r#"{"id":"x","name":{"value":"Percentage CPU","localizedValue":"Percentage CPU"},"unit":"Percent","primaryAggregationType":"Average"}"#;
        let d: MetricDefinition = serde_json::from_str(json).unwrap();
        assert_eq!(d.name.unwrap().value, "Percentage CPU");
        assert_eq!(d.unit, Some("Percent".into()));
    }

    #[test]
    fn metric_response_deserialize() {
        let json = r#"{"cost":0,"timespan":"PT1H","interval":"PT5M","value":[{"id":"x","type":"Microsoft.Insights/metrics","name":{"value":"Percentage CPU","localizedValue":"Percentage CPU"},"unit":"Percent","timeseries":[{"metadatavalues":[],"data":[{"timeStamp":"2024-01-01T00:00:00Z","average":5.2}]}]}]}"#;
        let r: MetricResponse = serde_json::from_str(json).unwrap();
        assert_eq!(r.value.len(), 1);
        assert_eq!(r.value[0].name.as_ref().unwrap().value, "Percentage CPU");
        let ts = &r.value[0].timeseries[0];
        assert_eq!(ts.data[0].average, Some(5.2));
    }

    #[test]
    fn activity_log_entry_deserialize() {
        let json = r#"{"eventTimestamp":"2024-01-01T00:00:00Z","operationName":{"value":"Microsoft.Compute/virtualMachines/start/action","localizedValue":"Start VM"},"status":{"value":"Succeeded","localizedValue":"Succeeded"},"caller":"user@example.com","level":"Informational","resourceId":"/subscriptions/s1/resourceGroups/rg1/providers/Microsoft.Compute/virtualMachines/vm1"}"#;
        let entry: ActivityLogEntry = serde_json::from_str(json).unwrap();
        assert_eq!(entry.caller, Some("user@example.com".into()));
        assert!(entry.operation_name.unwrap().value.unwrap().contains("start"));
    }

    #[test]
    fn query_url_building() {
        let base = crate::types::ARM_BASE;
        let resource = "/subscriptions/s1/resourceGroups/rg1/providers/Microsoft.Compute/virtualMachines/vm1";
        let url = format!(
            "{}{}/providers/microsoft.insights/metrics?api-version=2024-02-01&metricnames=Percentage CPU&timespan=PT1H&interval=PT5M&aggregation=Average",
            base, resource
        );
        assert!(url.contains("metricnames=Percentage CPU"));
        assert!(url.contains("interval=PT5M"));
    }
}
