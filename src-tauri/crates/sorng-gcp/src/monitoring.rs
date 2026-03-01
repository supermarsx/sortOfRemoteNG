//! Google Cloud Monitoring client.
//!
//! Covers time series data, metric descriptors, and alert policies.
//!
//! API base: `https://monitoring.googleapis.com/v3`

use crate::client::GcpClient;
use crate::error::GcpResult;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

const SERVICE: &str = "monitoring";
const V3: &str = "/v3";

// ── Types ───────────────────────────────────────────────────────────────

/// A metric descriptor.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MetricDescriptor {
    #[serde(default)]
    pub name: String,
    #[serde(default, rename = "type")]
    pub metric_type: String,
    #[serde(default)]
    pub labels: Vec<LabelDescriptor>,
    #[serde(default, rename = "metricKind")]
    pub metric_kind: Option<String>,
    #[serde(default, rename = "valueType")]
    pub value_type: Option<String>,
    #[serde(default)]
    pub unit: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default, rename = "displayName")]
    pub display_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LabelDescriptor {
    #[serde(default)]
    pub key: String,
    #[serde(default, rename = "valueType")]
    pub value_type: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
}

/// A single time series.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TimeSeries {
    #[serde(default)]
    pub metric: Metric,
    #[serde(default)]
    pub resource: MonitoredResourceTs,
    #[serde(default, rename = "metricKind")]
    pub metric_kind: Option<String>,
    #[serde(default, rename = "valueType")]
    pub value_type: Option<String>,
    #[serde(default)]
    pub points: Vec<Point>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Metric {
    #[serde(default, rename = "type")]
    pub metric_type: String,
    #[serde(default)]
    pub labels: HashMap<String, String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct MonitoredResourceTs {
    #[serde(default, rename = "type")]
    pub resource_type: String,
    #[serde(default)]
    pub labels: HashMap<String, String>,
}

/// A single data point.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Point {
    #[serde(default)]
    pub interval: TimeInterval,
    #[serde(default)]
    pub value: TypedValue,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct TimeInterval {
    #[serde(default, rename = "startTime")]
    pub start_time: Option<String>,
    #[serde(default, rename = "endTime")]
    pub end_time: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct TypedValue {
    #[serde(default, rename = "boolValue")]
    pub bool_value: Option<bool>,
    #[serde(default, rename = "int64Value")]
    pub int64_value: Option<String>,
    #[serde(default, rename = "doubleValue")]
    pub double_value: Option<f64>,
    #[serde(default, rename = "stringValue")]
    pub string_value: Option<String>,
}

/// An alert policy.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AlertPolicy {
    #[serde(default)]
    pub name: String,
    #[serde(default, rename = "displayName")]
    pub display_name: String,
    #[serde(default)]
    pub documentation: Option<AlertDocumentation>,
    #[serde(default, rename = "userLabels")]
    pub user_labels: HashMap<String, String>,
    #[serde(default)]
    pub conditions: Vec<AlertCondition>,
    #[serde(default)]
    pub combiner: Option<String>,
    #[serde(default)]
    pub enabled: Option<bool>,
    #[serde(default, rename = "notificationChannels")]
    pub notification_channels: Vec<String>,
    #[serde(default, rename = "creationRecord")]
    pub creation_record: Option<serde_json::Value>,
    #[serde(default, rename = "mutationRecord")]
    pub mutation_record: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AlertDocumentation {
    #[serde(default)]
    pub content: Option<String>,
    #[serde(default, rename = "mimeType")]
    pub mime_type: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AlertCondition {
    #[serde(default)]
    pub name: String,
    #[serde(default, rename = "displayName")]
    pub display_name: String,
    #[serde(default, rename = "conditionThreshold")]
    pub condition_threshold: Option<serde_json::Value>,
    #[serde(default, rename = "conditionAbsent")]
    pub condition_absent: Option<serde_json::Value>,
    #[serde(default, rename = "conditionMatchedLog")]
    pub condition_matched_log: Option<serde_json::Value>,
}

/// A notification channel.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NotificationChannel {
    #[serde(default)]
    pub name: String,
    #[serde(default, rename = "type")]
    pub channel_type: String,
    #[serde(default, rename = "displayName")]
    pub display_name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub labels: HashMap<String, String>,
    #[serde(default)]
    pub enabled: Option<bool>,
    #[serde(default, rename = "verificationStatus")]
    pub verification_status: Option<String>,
}

/// A monitored resource descriptor.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MonitoredResourceDescriptor {
    #[serde(default)]
    pub name: String,
    #[serde(default, rename = "type")]
    pub resource_type: String,
    #[serde(default, rename = "displayName")]
    pub display_name: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub labels: Vec<LabelDescriptor>,
}

// ── List wrappers ───────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
struct MetricDescriptorList {
    #[serde(default, rename = "metricDescriptors")]
    metric_descriptors: Vec<MetricDescriptor>,
    #[serde(default, rename = "nextPageToken")]
    next_page_token: Option<String>,
}

#[derive(Debug, Deserialize)]
struct TimeSeriesList {
    #[serde(default, rename = "timeSeries")]
    time_series: Vec<TimeSeries>,
    #[serde(default, rename = "nextPageToken")]
    next_page_token: Option<String>,
}

#[derive(Debug, Deserialize)]
struct AlertPolicyList {
    #[serde(default, rename = "alertPolicies")]
    alert_policies: Vec<AlertPolicy>,
    #[serde(default, rename = "nextPageToken")]
    next_page_token: Option<String>,
}

#[derive(Debug, Deserialize)]
struct NotificationChannelList {
    #[serde(default, rename = "notificationChannels")]
    notification_channels: Vec<NotificationChannel>,
    #[serde(default, rename = "nextPageToken")]
    next_page_token: Option<String>,
}

#[derive(Debug, Deserialize)]
struct MonitoredResourceDescriptorList {
    #[serde(default, rename = "resourceDescriptors")]
    resource_descriptors: Vec<MonitoredResourceDescriptor>,
    #[serde(default, rename = "nextPageToken")]
    next_page_token: Option<String>,
}

// ── Cloud Monitoring Client ─────────────────────────────────────────────

pub struct MonitoringClient;

impl MonitoringClient {
    // ── Metric descriptors ──────────────────────────────────────────

    /// List metric descriptors.
    pub async fn list_metric_descriptors(
        client: &mut GcpClient,
        project: &str,
        filter: Option<&str>,
    ) -> GcpResult<Vec<MetricDescriptor>> {
        let path = format!("{}/projects/{}/metricDescriptors", V3, project);
        let mut params: Vec<(&str, &str)> = Vec::new();
        let filter_val: String;
        if let Some(f) = filter {
            filter_val = f.to_string();
            params.push(("filter", &filter_val));
        }
        let resp: MetricDescriptorList = client.get(SERVICE, &path, &params).await?;
        Ok(resp.metric_descriptors)
    }

    /// Get a specific metric descriptor.
    pub async fn get_metric_descriptor(
        client: &mut GcpClient,
        project: &str,
        metric_type: &str,
    ) -> GcpResult<MetricDescriptor> {
        let encoded = percent_encoding::utf8_percent_encode(
            metric_type,
            percent_encoding::NON_ALPHANUMERIC,
        )
        .to_string();
        let path = format!(
            "{}/projects/{}/metricDescriptors/{}",
            V3, project, encoded
        );
        client.get(SERVICE, &path, &[]).await
    }

    // ── Time series ─────────────────────────────────────────────────

    /// List time series data.
    pub async fn list_time_series(
        client: &mut GcpClient,
        project: &str,
        filter: &str,
        start_time: &str,
        end_time: &str,
        alignment_period: Option<&str>,
        per_series_aligner: Option<&str>,
    ) -> GcpResult<Vec<TimeSeries>> {
        let path = format!("{}/projects/{}/timeSeries", V3, project);
        let mut params: Vec<(&str, &str)> = vec![
            ("filter", filter),
            ("interval.startTime", start_time),
            ("interval.endTime", end_time),
        ];
        if let Some(ap) = alignment_period {
            params.push(("aggregation.alignmentPeriod", ap));
        }
        if let Some(psa) = per_series_aligner {
            params.push(("aggregation.perSeriesAligner", psa));
        }
        let resp: TimeSeriesList = client.get(SERVICE, &path, &params).await?;
        Ok(resp.time_series)
    }

    // ── Alert policies ──────────────────────────────────────────────

    /// List alert policies.
    pub async fn list_alert_policies(
        client: &mut GcpClient,
        project: &str,
    ) -> GcpResult<Vec<AlertPolicy>> {
        let path = format!("{}/projects/{}/alertPolicies", V3, project);
        let resp: AlertPolicyList = client.get(SERVICE, &path, &[]).await?;
        Ok(resp.alert_policies)
    }

    /// Get an alert policy.
    pub async fn get_alert_policy(
        client: &mut GcpClient,
        project: &str,
        policy_id: &str,
    ) -> GcpResult<AlertPolicy> {
        let path = format!(
            "{}/projects/{}/alertPolicies/{}",
            V3, project, policy_id
        );
        client.get(SERVICE, &path, &[]).await
    }

    /// Create an alert policy.
    pub async fn create_alert_policy(
        client: &mut GcpClient,
        project: &str,
        policy: &AlertPolicy,
    ) -> GcpResult<AlertPolicy> {
        let path = format!("{}/projects/{}/alertPolicies", V3, project);
        client.post(SERVICE, &path, policy).await
    }

    /// Delete an alert policy.
    pub async fn delete_alert_policy(
        client: &mut GcpClient,
        project: &str,
        policy_id: &str,
    ) -> GcpResult<()> {
        let path = format!(
            "{}/projects/{}/alertPolicies/{}",
            V3, project, policy_id
        );
        client.delete(SERVICE, &path).await?;
        Ok(())
    }

    // ── Notification channels ───────────────────────────────────────

    /// List notification channels.
    pub async fn list_notification_channels(
        client: &mut GcpClient,
        project: &str,
    ) -> GcpResult<Vec<NotificationChannel>> {
        let path = format!("{}/projects/{}/notificationChannels", V3, project);
        let resp: NotificationChannelList =
            client.get(SERVICE, &path, &[]).await?;
        Ok(resp.notification_channels)
    }

    /// Get a notification channel.
    pub async fn get_notification_channel(
        client: &mut GcpClient,
        project: &str,
        channel_id: &str,
    ) -> GcpResult<NotificationChannel> {
        let path = format!(
            "{}/projects/{}/notificationChannels/{}",
            V3, project, channel_id
        );
        client.get(SERVICE, &path, &[]).await
    }

    /// Delete a notification channel.
    pub async fn delete_notification_channel(
        client: &mut GcpClient,
        project: &str,
        channel_id: &str,
    ) -> GcpResult<()> {
        let path = format!(
            "{}/projects/{}/notificationChannels/{}",
            V3, project, channel_id
        );
        client.delete(SERVICE, &path).await?;
        Ok(())
    }

    // ── Monitored resource descriptors ──────────────────────────────

    /// List monitored resource descriptors.
    pub async fn list_monitored_resource_descriptors(
        client: &mut GcpClient,
        project: &str,
    ) -> GcpResult<Vec<MonitoredResourceDescriptor>> {
        let path = format!(
            "{}/projects/{}/monitoredResourceDescriptors",
            V3, project
        );
        let resp: MonitoredResourceDescriptorList =
            client.get(SERVICE, &path, &[]).await?;
        Ok(resp.resource_descriptors)
    }
}
