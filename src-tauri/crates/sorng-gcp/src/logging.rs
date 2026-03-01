//! Google Cloud Logging client.
//!
//! Covers log entries, log sinks, and log-based metrics.
//!
//! API base: `https://logging.googleapis.com/v2`

use crate::client::GcpClient;
use crate::error::GcpResult;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

const SERVICE: &str = "logging";
const V2: &str = "/v2";

// ── Types ───────────────────────────────────────────────────────────────

/// A single log entry.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LogEntry {
    #[serde(default, rename = "logName")]
    pub log_name: String,
    #[serde(default)]
    pub resource: Option<MonitoredResource>,
    #[serde(default)]
    pub timestamp: Option<String>,
    #[serde(default, rename = "receiveTimestamp")]
    pub receive_timestamp: Option<String>,
    #[serde(default)]
    pub severity: Option<String>,
    #[serde(default, rename = "insertId")]
    pub insert_id: Option<String>,
    #[serde(default, rename = "textPayload")]
    pub text_payload: Option<String>,
    #[serde(default, rename = "jsonPayload")]
    pub json_payload: Option<serde_json::Value>,
    #[serde(default)]
    pub labels: HashMap<String, String>,
    #[serde(default)]
    pub trace: Option<String>,
    #[serde(default, rename = "spanId")]
    pub span_id: Option<String>,
    #[serde(default, rename = "httpRequest")]
    pub http_request: Option<serde_json::Value>,
}

/// Monitored resource descriptor.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MonitoredResource {
    #[serde(default, rename = "type")]
    pub resource_type: String,
    #[serde(default)]
    pub labels: HashMap<String, String>,
}

/// A log sink (export destination).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LogSink {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub destination: String,
    #[serde(default)]
    pub filter: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub disabled: bool,
    #[serde(default, rename = "outputVersionFormat")]
    pub output_version_format: Option<String>,
    #[serde(default, rename = "writerIdentity")]
    pub writer_identity: Option<String>,
    #[serde(default, rename = "includeChildren")]
    pub include_children: bool,
    #[serde(default, rename = "createTime")]
    pub create_time: Option<String>,
    #[serde(default, rename = "updateTime")]
    pub update_time: Option<String>,
}

/// A log-based metric.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LogMetric {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub filter: String,
    #[serde(default)]
    pub disabled: bool,
    #[serde(default, rename = "metricDescriptor")]
    pub metric_descriptor: Option<serde_json::Value>,
    #[serde(default, rename = "valueExtractor")]
    pub value_extractor: Option<String>,
    #[serde(default, rename = "labelExtractors")]
    pub label_extractors: HashMap<String, String>,
    #[serde(default, rename = "createTime")]
    pub create_time: Option<String>,
    #[serde(default, rename = "updateTime")]
    pub update_time: Option<String>,
}

/// A log name.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LogName {
    #[serde(default)]
    pub name: String,
}

// ── List wrappers ───────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
struct ListEntriesResponse {
    #[serde(default)]
    entries: Vec<LogEntry>,
    #[serde(default, rename = "nextPageToken")]
    next_page_token: Option<String>,
}

#[derive(Debug, Deserialize)]
struct SinkList {
    #[serde(default)]
    sinks: Vec<LogSink>,
    #[serde(default, rename = "nextPageToken")]
    next_page_token: Option<String>,
}

#[derive(Debug, Deserialize)]
struct MetricList {
    #[serde(default)]
    metrics: Vec<LogMetric>,
    #[serde(default, rename = "nextPageToken")]
    next_page_token: Option<String>,
}

#[derive(Debug, Deserialize)]
struct LogNameList {
    #[serde(default, rename = "logNames")]
    log_names: Vec<String>,
    #[serde(default, rename = "nextPageToken")]
    next_page_token: Option<String>,
}

// ── Cloud Logging Client ────────────────────────────────────────────────

pub struct LoggingClient;

impl LoggingClient {
    // ── Log entries ─────────────────────────────────────────────────

    /// List log entries matching a filter.
    pub async fn list_entries(
        client: &mut GcpClient,
        project: &str,
        filter: Option<&str>,
        order_by: Option<&str>,
        page_size: Option<u32>,
    ) -> GcpResult<Vec<LogEntry>> {
        let path = format!("{}/entries:list", V2);
        let body = serde_json::json!({
            "resourceNames": [format!("projects/{}", project)],
            "filter": filter.unwrap_or(""),
            "orderBy": order_by.unwrap_or("timestamp desc"),
            "pageSize": page_size.unwrap_or(100),
        });
        let resp: ListEntriesResponse = client.post(SERVICE, &path, &body).await?;
        Ok(resp.entries)
    }

    /// Write log entries.
    pub async fn write_entries(
        client: &mut GcpClient,
        project: &str,
        log_name: &str,
        entries: Vec<LogEntry>,
        resource: Option<MonitoredResource>,
    ) -> GcpResult<()> {
        let path = format!("{}/entries:write", V2);
        let body = serde_json::json!({
            "logName": format!("projects/{}/logs/{}", project, log_name),
            "resource": resource,
            "entries": entries,
        });
        client.post_text(SERVICE, &path, &body).await?;
        Ok(())
    }

    /// List available log names.
    pub async fn list_logs(
        client: &mut GcpClient,
        project: &str,
    ) -> GcpResult<Vec<String>> {
        let path = format!("{}/projects/{}/logs", V2, project);
        let resp: LogNameList = client.get(SERVICE, &path, &[]).await?;
        Ok(resp.log_names)
    }

    /// Delete a named log and all its entries.
    pub async fn delete_log(
        client: &mut GcpClient,
        project: &str,
        log_name: &str,
    ) -> GcpResult<()> {
        let encoded_name = percent_encoding::utf8_percent_encode(
            log_name,
            percent_encoding::NON_ALPHANUMERIC,
        )
        .to_string();
        let path = format!("{}/projects/{}/logs/{}", V2, project, encoded_name);
        client.delete(SERVICE, &path).await?;
        Ok(())
    }

    // ── Sinks ───────────────────────────────────────────────────────

    /// List sinks.
    pub async fn list_sinks(
        client: &mut GcpClient,
        project: &str,
    ) -> GcpResult<Vec<LogSink>> {
        let path = format!("{}/projects/{}/sinks", V2, project);
        let resp: SinkList = client.get(SERVICE, &path, &[]).await?;
        Ok(resp.sinks)
    }

    /// Get a sink.
    pub async fn get_sink(
        client: &mut GcpClient,
        project: &str,
        sink_name: &str,
    ) -> GcpResult<LogSink> {
        let path = format!("{}/projects/{}/sinks/{}", V2, project, sink_name);
        client.get(SERVICE, &path, &[]).await
    }

    /// Create a sink.
    pub async fn create_sink(
        client: &mut GcpClient,
        project: &str,
        name: &str,
        destination: &str,
        filter: Option<&str>,
    ) -> GcpResult<LogSink> {
        let path = format!("{}/projects/{}/sinks", V2, project);
        let body = serde_json::json!({
            "name": name,
            "destination": destination,
            "filter": filter.unwrap_or(""),
        });
        client.post(SERVICE, &path, &body).await
    }

    /// Delete a sink.
    pub async fn delete_sink(
        client: &mut GcpClient,
        project: &str,
        sink_name: &str,
    ) -> GcpResult<()> {
        let path = format!("{}/projects/{}/sinks/{}", V2, project, sink_name);
        client.delete(SERVICE, &path).await?;
        Ok(())
    }

    // ── Log-based metrics ───────────────────────────────────────────

    /// List log-based metrics.
    pub async fn list_metrics(
        client: &mut GcpClient,
        project: &str,
    ) -> GcpResult<Vec<LogMetric>> {
        let path = format!("{}/projects/{}/metrics", V2, project);
        let resp: MetricList = client.get(SERVICE, &path, &[]).await?;
        Ok(resp.metrics)
    }

    /// Get a log-based metric.
    pub async fn get_metric(
        client: &mut GcpClient,
        project: &str,
        metric_name: &str,
    ) -> GcpResult<LogMetric> {
        let path = format!("{}/projects/{}/metrics/{}", V2, project, metric_name);
        client.get(SERVICE, &path, &[]).await
    }

    /// Create a log-based metric.
    pub async fn create_metric(
        client: &mut GcpClient,
        project: &str,
        name: &str,
        filter: &str,
        description: Option<&str>,
    ) -> GcpResult<LogMetric> {
        let path = format!("{}/projects/{}/metrics", V2, project);
        let body = serde_json::json!({
            "name": name,
            "filter": filter,
            "description": description.unwrap_or(""),
        });
        client.post(SERVICE, &path, &body).await
    }

    /// Delete a log-based metric.
    pub async fn delete_metric(
        client: &mut GcpClient,
        project: &str,
        metric_name: &str,
    ) -> GcpResult<()> {
        let path = format!("{}/projects/{}/metrics/{}", V2, project, metric_name);
        client.delete(SERVICE, &path).await?;
        Ok(())
    }
}
