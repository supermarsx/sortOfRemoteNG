//! AWS CloudWatch service client (Metrics + Logs).
//!
//! Mirrors `aws-sdk-cloudwatch` and `aws-sdk-cloudwatchlogs` types and operations.
//! CloudWatch Metrics uses the Query protocol (API version 2010-08-01).
//! CloudWatch Logs uses the JSON protocol (target prefix `Logs_20140328`).
//!
//! Reference: <https://docs.aws.amazon.com/AmazonCloudWatch/latest/APIReference/>
//! Reference: <https://docs.aws.amazon.com/AmazonCloudWatchLogs/latest/APIReference/>

use crate::client::{self, AwsClient};
use crate::error::{AwsError, AwsResult};
use serde::{Deserialize, Serialize};

const METRICS_API_VERSION: &str = "2010-08-01";
const SERVICE: &str = "monitoring";
const LOGS_SERVICE: &str = "logs";

// ── Metric Types ────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Metric {
    pub namespace: String,
    pub metric_name: String,
    pub dimensions: Vec<Dimension>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Dimension {
    pub name: String,
    pub value: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
pub enum Statistic {
    SampleCount,
    Average,
    Sum,
    Minimum,
    Maximum,
}

impl std::fmt::Display for Statistic {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::SampleCount => write!(f, "SampleCount"),
            Self::Average => write!(f, "Average"),
            Self::Sum => write!(f, "Sum"),
            Self::Minimum => write!(f, "Minimum"),
            Self::Maximum => write!(f, "Maximum"),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Datapoint {
    pub timestamp: String,
    pub sample_count: Option<f64>,
    pub average: Option<f64>,
    pub sum: Option<f64>,
    pub minimum: Option<f64>,
    pub maximum: Option<f64>,
    pub unit: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MetricAlarm {
    pub alarm_name: String,
    pub alarm_arn: Option<String>,
    pub alarm_description: Option<String>,
    pub state_value: String,
    pub state_reason: Option<String>,
    pub state_updated_timestamp: Option<String>,
    pub metric_name: Option<String>,
    pub namespace: Option<String>,
    pub statistic: Option<String>,
    pub period: Option<u32>,
    pub evaluation_periods: Option<u32>,
    pub threshold: Option<f64>,
    pub comparison_operator: Option<String>,
    pub actions_enabled: bool,
    pub alarm_actions: Vec<String>,
    pub ok_actions: Vec<String>,
    pub insufficient_data_actions: Vec<String>,
    pub dimensions: Vec<Dimension>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MetricDatum {
    pub metric_name: String,
    pub dimensions: Vec<Dimension>,
    pub value: Option<f64>,
    pub unit: Option<String>,
    pub timestamp: Option<String>,
    pub statistic_values: Option<StatisticSet>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StatisticSet {
    pub sample_count: f64,
    pub sum: f64,
    pub minimum: f64,
    pub maximum: f64,
}

/// Input for PutMetricAlarm.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PutMetricAlarmInput {
    pub alarm_name: String,
    pub alarm_description: Option<String>,
    pub metric_name: String,
    pub namespace: String,
    pub statistic: String,
    pub period: u32,
    pub evaluation_periods: u32,
    pub threshold: f64,
    pub comparison_operator: String,
    pub alarm_actions: Vec<String>,
    pub ok_actions: Vec<String>,
    pub insufficient_data_actions: Vec<String>,
    pub dimensions: Vec<Dimension>,
}

/// Single metric data query for GetMetricData.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MetricDataQuery {
    pub id: String,
    pub metric_stat: Option<MetricStat>,
    pub expression: Option<String>,
    pub return_data: bool,
    pub period: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MetricStat {
    pub metric: Metric,
    pub period: u32,
    pub stat: String,
    pub unit: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MetricDataResult {
    pub id: String,
    pub label: Option<String>,
    pub timestamps: Vec<String>,
    pub values: Vec<f64>,
    pub status_code: Option<String>,
}

// ── Log Types ───────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LogGroup {
    #[serde(rename = "logGroupName")]
    pub log_group_name: String,
    #[serde(rename = "logGroupArn")]
    pub log_group_arn: Option<String>,
    #[serde(rename = "creationTime")]
    pub creation_time: Option<i64>,
    #[serde(rename = "retentionInDays")]
    pub retention_in_days: Option<i32>,
    #[serde(rename = "metricFilterCount")]
    pub metric_filter_count: Option<i32>,
    #[serde(rename = "storedBytes")]
    pub stored_bytes: Option<i64>,
    #[serde(rename = "kmsKeyId")]
    pub kms_key_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LogStream {
    #[serde(rename = "logStreamName")]
    pub log_stream_name: String,
    #[serde(rename = "creationTime")]
    pub creation_time: Option<i64>,
    #[serde(rename = "firstEventTimestamp")]
    pub first_event_timestamp: Option<i64>,
    #[serde(rename = "lastEventTimestamp")]
    pub last_event_timestamp: Option<i64>,
    #[serde(rename = "lastIngestionTime")]
    pub last_ingestion_time: Option<i64>,
    #[serde(rename = "uploadSequenceToken")]
    pub upload_sequence_token: Option<String>,
    #[serde(rename = "arn")]
    pub arn: Option<String>,
    #[serde(rename = "storedBytes")]
    pub stored_bytes: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OutputLogEvent {
    pub timestamp: Option<i64>,
    pub message: Option<String>,
    pub ingestion_time: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InputLogEvent {
    pub timestamp: i64,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FilteredLogEvent {
    #[serde(rename = "logStreamName")]
    pub log_stream_name: Option<String>,
    pub timestamp: Option<i64>,
    pub message: Option<String>,
    #[serde(rename = "ingestionTime")]
    pub ingestion_time: Option<i64>,
    #[serde(rename = "eventId")]
    pub event_id: Option<String>,
}

/// Metric filter definition.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MetricFilter {
    #[serde(rename = "filterName")]
    pub filter_name: String,
    #[serde(rename = "filterPattern")]
    pub filter_pattern: String,
    #[serde(rename = "logGroupName")]
    pub log_group_name: Option<String>,
    #[serde(rename = "creationTime")]
    pub creation_time: Option<i64>,
}

// ── CloudWatch Client ───────────────────────────────────────────────────

pub struct CloudWatchClient {
    client: AwsClient,
}

impl CloudWatchClient {
    pub fn new(client: AwsClient) -> Self {
        Self { client }
    }

    // ── Metrics ─────────────────────────────────────────────────────

    /// Lists metrics matching optional filters.
    pub async fn list_metrics(&self, namespace: Option<&str>, metric_name: Option<&str>, dimensions: &[Dimension]) -> AwsResult<Vec<Metric>> {
        let mut params = client::build_query_params("ListMetrics", METRICS_API_VERSION);
        if let Some(ns) = namespace {
            params.insert("Namespace".to_string(), ns.to_string());
        }
        if let Some(mn) = metric_name {
            params.insert("MetricName".to_string(), mn.to_string());
        }
        for (i, dim) in dimensions.iter().enumerate() {
            params.insert(format!("Dimensions.member.{}.Name", i + 1), dim.name.clone());
            params.insert(format!("Dimensions.member.{}.Value", i + 1), dim.value.clone());
        }
        let response = self.client.query_request(SERVICE, &params).await?;
        let blocks = client::xml_blocks(&response.body, "member");
        Ok(blocks.iter().filter_map(|b| {
            Some(Metric {
                namespace: client::xml_text(b, "Namespace")?,
                metric_name: client::xml_text(b, "MetricName")?,
                dimensions: self.parse_dimensions(b),
            })
        }).collect())
    }

    /// Gets statistics for a specific metric.
    pub async fn get_metric_statistics(&self, namespace: &str, metric_name: &str, start_time: &str, end_time: &str, period: u32, statistics: &[Statistic], dimensions: &[Dimension]) -> AwsResult<Vec<Datapoint>> {
        let mut params = client::build_query_params("GetMetricStatistics", METRICS_API_VERSION);
        params.insert("Namespace".to_string(), namespace.to_string());
        params.insert("MetricName".to_string(), metric_name.to_string());
        params.insert("StartTime".to_string(), start_time.to_string());
        params.insert("EndTime".to_string(), end_time.to_string());
        params.insert("Period".to_string(), period.to_string());
        for (i, stat) in statistics.iter().enumerate() {
            params.insert(format!("Statistics.member.{}", i + 1), stat.to_string());
        }
        for (i, dim) in dimensions.iter().enumerate() {
            params.insert(format!("Dimensions.member.{}.Name", i + 1), dim.name.clone());
            params.insert(format!("Dimensions.member.{}.Value", i + 1), dim.value.clone());
        }
        let response = self.client.query_request(SERVICE, &params).await?;
        let blocks = client::xml_blocks(&response.body, "member");
        Ok(blocks.iter().map(|b| Datapoint {
            timestamp: client::xml_text(b, "Timestamp").unwrap_or_default(),
            sample_count: client::xml_text(b, "SampleCount").and_then(|v| v.parse().ok()),
            average: client::xml_text(b, "Average").and_then(|v| v.parse().ok()),
            sum: client::xml_text(b, "Sum").and_then(|v| v.parse().ok()),
            minimum: client::xml_text(b, "Minimum").and_then(|v| v.parse().ok()),
            maximum: client::xml_text(b, "Maximum").and_then(|v| v.parse().ok()),
            unit: client::xml_text(b, "Unit"),
        }).collect())
    }

    /// Publishes metric data points to CloudWatch.
    pub async fn put_metric_data(&self, namespace: &str, metric_data: &[MetricDatum]) -> AwsResult<()> {
        let mut params = client::build_query_params("PutMetricData", METRICS_API_VERSION);
        params.insert("Namespace".to_string(), namespace.to_string());
        for (i, datum) in metric_data.iter().enumerate() {
            let prefix = format!("MetricData.member.{}", i + 1);
            params.insert(format!("{}.MetricName", prefix), datum.metric_name.clone());
            if let Some(v) = datum.value {
                params.insert(format!("{}.Value", prefix), v.to_string());
            }
            if let Some(ref u) = datum.unit {
                params.insert(format!("{}.Unit", prefix), u.clone());
            }
            if let Some(ref ts) = datum.timestamp {
                params.insert(format!("{}.Timestamp", prefix), ts.clone());
            }
            for (j, dim) in datum.dimensions.iter().enumerate() {
                params.insert(format!("{}.Dimensions.member.{}.Name", prefix, j + 1), dim.name.clone());
                params.insert(format!("{}.Dimensions.member.{}.Value", prefix, j + 1), dim.value.clone());
            }
        }
        self.client.query_request(SERVICE, &params).await?;
        Ok(())
    }

    // ── Alarms ──────────────────────────────────────────────────────

    pub async fn describe_alarms(&self, alarm_names: &[String], state_value: Option<&str>) -> AwsResult<Vec<MetricAlarm>> {
        let mut params = client::build_query_params("DescribeAlarms", METRICS_API_VERSION);
        for (i, name) in alarm_names.iter().enumerate() {
            params.insert(format!("AlarmNames.member.{}", i + 1), name.clone());
        }
        if let Some(sv) = state_value {
            params.insert("StateValue".to_string(), sv.to_string());
        }
        let response = self.client.query_request(SERVICE, &params).await?;
        Ok(self.parse_alarms(&response.body))
    }

    pub async fn put_metric_alarm(&self, input: &PutMetricAlarmInput) -> AwsResult<()> {
        let mut params = client::build_query_params("PutMetricAlarm", METRICS_API_VERSION);
        params.insert("AlarmName".to_string(), input.alarm_name.clone());
        params.insert("MetricName".to_string(), input.metric_name.clone());
        params.insert("Namespace".to_string(), input.namespace.clone());
        params.insert("Statistic".to_string(), input.statistic.clone());
        params.insert("Period".to_string(), input.period.to_string());
        params.insert("EvaluationPeriods".to_string(), input.evaluation_periods.to_string());
        params.insert("Threshold".to_string(), input.threshold.to_string());
        params.insert("ComparisonOperator".to_string(), input.comparison_operator.clone());
        if let Some(ref desc) = input.alarm_description {
            params.insert("AlarmDescription".to_string(), desc.clone());
        }
        for (i, action) in input.alarm_actions.iter().enumerate() {
            params.insert(format!("AlarmActions.member.{}", i + 1), action.clone());
        }
        for (i, action) in input.ok_actions.iter().enumerate() {
            params.insert(format!("OKActions.member.{}", i + 1), action.clone());
        }
        for (i, dim) in input.dimensions.iter().enumerate() {
            params.insert(format!("Dimensions.member.{}.Name", i + 1), dim.name.clone());
            params.insert(format!("Dimensions.member.{}.Value", i + 1), dim.value.clone());
        }
        self.client.query_request(SERVICE, &params).await?;
        Ok(())
    }

    pub async fn delete_alarms(&self, alarm_names: &[String]) -> AwsResult<()> {
        let mut params = client::build_query_params("DeleteAlarms", METRICS_API_VERSION);
        for (i, name) in alarm_names.iter().enumerate() {
            params.insert(format!("AlarmNames.member.{}", i + 1), name.clone());
        }
        self.client.query_request(SERVICE, &params).await?;
        Ok(())
    }

    pub async fn set_alarm_state(&self, alarm_name: &str, state_value: &str, state_reason: &str) -> AwsResult<()> {
        let mut params = client::build_query_params("SetAlarmState", METRICS_API_VERSION);
        params.insert("AlarmName".to_string(), alarm_name.to_string());
        params.insert("StateValue".to_string(), state_value.to_string());
        params.insert("StateReason".to_string(), state_reason.to_string());
        self.client.query_request(SERVICE, &params).await?;
        Ok(())
    }

    // ── CloudWatch Logs ─────────────────────────────────────────────

    pub async fn describe_log_groups(&self, prefix: Option<&str>, limit: Option<u32>) -> AwsResult<Vec<LogGroup>> {
        let mut body = serde_json::json!({});
        if let Some(p) = prefix {
            body["logGroupNamePrefix"] = serde_json::Value::String(p.to_string());
        }
        if let Some(l) = limit {
            body["limit"] = serde_json::json!(l);
        }
        let response = self.client.json_request(LOGS_SERVICE, "Logs_20140328.DescribeLogGroups", &body).await?;
        let result: serde_json::Value = serde_json::from_str(&response.body)
            .map_err(|e| AwsError::new(LOGS_SERVICE, "ParseError", &e.to_string(), response.status_code))?;
        Ok(result.get("logGroups")
            .and_then(|v| serde_json::from_value(v.clone()).ok())
            .unwrap_or_default())
    }

    pub async fn create_log_group(&self, log_group_name: &str, retention_in_days: Option<i32>) -> AwsResult<()> {
        let mut body = serde_json::json!({ "logGroupName": log_group_name });
        if let Some(r) = retention_in_days {
            body["retentionInDays"] = serde_json::json!(r);
        }
        self.client.json_request(LOGS_SERVICE, "Logs_20140328.CreateLogGroup", &body).await?;
        Ok(())
    }

    pub async fn delete_log_group(&self, log_group_name: &str) -> AwsResult<()> {
        let body = serde_json::json!({ "logGroupName": log_group_name });
        self.client.json_request(LOGS_SERVICE, "Logs_20140328.DeleteLogGroup", &body).await?;
        Ok(())
    }

    pub async fn describe_log_streams(&self, log_group_name: &str, prefix: Option<&str>, order_by: Option<&str>, limit: Option<u32>) -> AwsResult<Vec<LogStream>> {
        let mut body = serde_json::json!({ "logGroupName": log_group_name });
        if let Some(p) = prefix {
            body["logStreamNamePrefix"] = serde_json::Value::String(p.to_string());
        }
        if let Some(o) = order_by {
            body["orderBy"] = serde_json::Value::String(o.to_string());
        }
        if let Some(l) = limit {
            body["limit"] = serde_json::json!(l);
        }
        body["descending"] = serde_json::json!(true);
        let response = self.client.json_request(LOGS_SERVICE, "Logs_20140328.DescribeLogStreams", &body).await?;
        let result: serde_json::Value = serde_json::from_str(&response.body)
            .map_err(|e| AwsError::new(LOGS_SERVICE, "ParseError", &e.to_string(), response.status_code))?;
        Ok(result.get("logStreams")
            .and_then(|v| serde_json::from_value(v.clone()).ok())
            .unwrap_or_default())
    }

    pub async fn get_log_events(&self, log_group_name: &str, log_stream_name: &str, start_time: Option<i64>, end_time: Option<i64>, limit: Option<u32>, start_from_head: Option<bool>) -> AwsResult<(Vec<OutputLogEvent>, Option<String>, Option<String>)> {
        let mut body = serde_json::json!({
            "logGroupName": log_group_name,
            "logStreamName": log_stream_name,
        });
        if let Some(st) = start_time { body["startTime"] = serde_json::json!(st); }
        if let Some(et) = end_time { body["endTime"] = serde_json::json!(et); }
        if let Some(l) = limit { body["limit"] = serde_json::json!(l); }
        if let Some(sfh) = start_from_head { body["startFromHead"] = serde_json::json!(sfh); }
        let response = self.client.json_request(LOGS_SERVICE, "Logs_20140328.GetLogEvents", &body).await?;
        let result: serde_json::Value = serde_json::from_str(&response.body)
            .map_err(|e| AwsError::new(LOGS_SERVICE, "ParseError", &e.to_string(), response.status_code))?;
        let events: Vec<OutputLogEvent> = result.get("events")
            .and_then(|v| serde_json::from_value(v.clone()).ok())
            .unwrap_or_default();
        let forward_token = result.get("nextForwardToken").and_then(|v| v.as_str()).map(String::from);
        let backward_token = result.get("nextBackwardToken").and_then(|v| v.as_str()).map(String::from);
        Ok((events, forward_token, backward_token))
    }

    pub async fn put_log_events(&self, log_group_name: &str, log_stream_name: &str, events: &[InputLogEvent], sequence_token: Option<&str>) -> AwsResult<Option<String>> {
        let mut body = serde_json::json!({
            "logGroupName": log_group_name,
            "logStreamName": log_stream_name,
            "logEvents": events,
        });
        if let Some(st) = sequence_token {
            body["sequenceToken"] = serde_json::Value::String(st.to_string());
        }
        let response = self.client.json_request(LOGS_SERVICE, "Logs_20140328.PutLogEvents", &body).await?;
        let result: serde_json::Value = serde_json::from_str(&response.body)
            .map_err(|e| AwsError::new(LOGS_SERVICE, "ParseError", &e.to_string(), response.status_code))?;
        Ok(result.get("nextSequenceToken").and_then(|v| v.as_str()).map(String::from))
    }

    pub async fn filter_log_events(&self, log_group_name: &str, filter_pattern: Option<&str>, start_time: Option<i64>, end_time: Option<i64>, limit: Option<u32>) -> AwsResult<Vec<FilteredLogEvent>> {
        let mut body = serde_json::json!({ "logGroupName": log_group_name });
        if let Some(fp) = filter_pattern {
            body["filterPattern"] = serde_json::Value::String(fp.to_string());
        }
        if let Some(st) = start_time { body["startTime"] = serde_json::json!(st); }
        if let Some(et) = end_time { body["endTime"] = serde_json::json!(et); }
        if let Some(l) = limit { body["limit"] = serde_json::json!(l); }
        let response = self.client.json_request(LOGS_SERVICE, "Logs_20140328.FilterLogEvents", &body).await?;
        let result: serde_json::Value = serde_json::from_str(&response.body)
            .map_err(|e| AwsError::new(LOGS_SERVICE, "ParseError", &e.to_string(), response.status_code))?;
        Ok(result.get("events")
            .and_then(|v| serde_json::from_value(v.clone()).ok())
            .unwrap_or_default())
    }

    pub async fn put_retention_policy(&self, log_group_name: &str, retention_in_days: i32) -> AwsResult<()> {
        let body = serde_json::json!({
            "logGroupName": log_group_name,
            "retentionInDays": retention_in_days,
        });
        self.client.json_request(LOGS_SERVICE, "Logs_20140328.PutRetentionPolicy", &body).await?;
        Ok(())
    }

    // ── Helpers ─────────────────────────────────────────────────────

    fn parse_dimensions(&self, xml: &str) -> Vec<Dimension> {
        client::xml_blocks(xml, "member").iter().filter_map(|b| {
            Some(Dimension {
                name: client::xml_text(b, "Name")?,
                value: client::xml_text(b, "Value")?,
            })
        }).collect()
    }

    fn parse_alarms(&self, xml: &str) -> Vec<MetricAlarm> {
        client::xml_blocks(xml, "member").iter().filter_map(|b| {
            Some(MetricAlarm {
                alarm_name: client::xml_text(b, "AlarmName")?,
                alarm_arn: client::xml_text(b, "AlarmArn"),
                alarm_description: client::xml_text(b, "AlarmDescription"),
                state_value: client::xml_text(b, "StateValue").unwrap_or_default(),
                state_reason: client::xml_text(b, "StateReason"),
                state_updated_timestamp: client::xml_text(b, "StateUpdatedTimestamp"),
                metric_name: client::xml_text(b, "MetricName"),
                namespace: client::xml_text(b, "Namespace"),
                statistic: client::xml_text(b, "Statistic"),
                period: client::xml_text(b, "Period").and_then(|v| v.parse().ok()),
                evaluation_periods: client::xml_text(b, "EvaluationPeriods").and_then(|v| v.parse().ok()),
                threshold: client::xml_text(b, "Threshold").and_then(|v| v.parse().ok()),
                comparison_operator: client::xml_text(b, "ComparisonOperator"),
                actions_enabled: client::xml_text(b, "ActionsEnabled").map(|v| v == "true").unwrap_or(true),
                alarm_actions: client::xml_text_all(b, "AlarmActions"),
                ok_actions: client::xml_text_all(b, "OKActions"),
                insufficient_data_actions: client::xml_text_all(b, "InsufficientDataActions"),
                dimensions: self.parse_dimensions(b),
            })
        }).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn metric_alarm_serde() {
        let alarm = MetricAlarm {
            alarm_name: "HighCPU".to_string(),
            alarm_arn: Some("arn:aws:cloudwatch:us-east-1:123:alarm:HighCPU".to_string()),
            alarm_description: Some("CPU > 80%".to_string()),
            state_value: "OK".to_string(),
            state_reason: None,
            state_updated_timestamp: None,
            metric_name: Some("CPUUtilization".to_string()),
            namespace: Some("AWS/EC2".to_string()),
            statistic: Some("Average".to_string()),
            period: Some(300),
            evaluation_periods: Some(3),
            threshold: Some(80.0),
            comparison_operator: Some("GreaterThanThreshold".to_string()),
            actions_enabled: true,
            alarm_actions: vec!["arn:aws:sns:us-east-1:123:alerts".to_string()],
            ok_actions: vec![],
            insufficient_data_actions: vec![],
            dimensions: vec![Dimension { name: "InstanceId".to_string(), value: "i-abc123".to_string() }],
        };
        let json = serde_json::to_string(&alarm).unwrap();
        let back: MetricAlarm = serde_json::from_str(&json).unwrap();
        assert_eq!(back.alarm_name, "HighCPU");
        assert_eq!(back.threshold, Some(80.0));
    }

    #[test]
    fn log_group_serde() {
        let lg = LogGroup {
            log_group_name: "/aws/lambda/my-func".to_string(),
            log_group_arn: Some("arn:aws:logs:us-east-1:123:log-group:/aws/lambda/my-func:*".to_string()),
            creation_time: Some(1704067200000),
            retention_in_days: Some(14),
            metric_filter_count: Some(0),
            stored_bytes: Some(1048576),
            kms_key_id: None,
        };
        let json = serde_json::to_string(&lg).unwrap();
        let back: LogGroup = serde_json::from_str(&json).unwrap();
        assert_eq!(back.log_group_name, "/aws/lambda/my-func");
    }

    #[test]
    fn statistic_display() {
        assert_eq!(Statistic::Average.to_string(), "Average");
        assert_eq!(Statistic::SampleCount.to_string(), "SampleCount");
    }
}
