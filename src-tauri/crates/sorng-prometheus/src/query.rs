// ── Prometheus query management ──────────────────────────────────────────────

use crate::client::PrometheusClient;
use crate::error::{PrometheusError, PrometheusResult};
use crate::types::*;

pub struct QueryManager;

impl QueryManager {
    pub async fn instant_query(client: &PrometheusClient, query: &str, time: Option<&str>) -> PrometheusResult<QueryResult> {
        let mut endpoint = format!("/api/v1/query?query={}", urlencoding(query));
        if let Some(t) = time {
            endpoint.push_str(&format!("&time={t}"));
        }
        let body = client.api_get(&endpoint).await?;
        let v: serde_json::Value = serde_json::from_str(&body)
            .map_err(|e| PrometheusError::parse(format!("instant query: {e}")))?;
        if v["status"].as_str() != Some("success") {
            return Err(PrometheusError::query_failed(
                v["error"].as_str().unwrap_or("unknown error").to_string(),
            ));
        }
        Ok(QueryResult {
            result_type: v["data"]["resultType"].as_str().unwrap_or("").to_string(),
            result: v["data"]["result"].as_array().cloned().unwrap_or_default(),
            stats: v["data"]["stats"].as_object().map(|o| serde_json::Value::Object(o.clone())),
        })
    }

    pub async fn range_query(client: &PrometheusClient, req: &RangeQueryRequest) -> PrometheusResult<RangeQueryResult> {
        let mut endpoint = format!(
            "/api/v1/query_range?query={}&start={}&end={}",
            urlencoding(&req.query), urlencoding(&req.start), urlencoding(&req.end)
        );
        if let Some(step) = &req.step {
            endpoint.push_str(&format!("&step={step}"));
        }
        if let Some(timeout) = &req.timeout {
            endpoint.push_str(&format!("&timeout={timeout}"));
        }
        let body = client.api_get(&endpoint).await?;
        let v: serde_json::Value = serde_json::from_str(&body)
            .map_err(|e| PrometheusError::parse(format!("range query: {e}")))?;
        if v["status"].as_str() != Some("success") {
            return Err(PrometheusError::query_failed(
                v["error"].as_str().unwrap_or("unknown error").to_string(),
            ));
        }
        Ok(RangeQueryResult {
            result_type: v["data"]["resultType"].as_str().unwrap_or("").to_string(),
            result: v["data"]["result"].as_array().cloned().unwrap_or_default(),
            stats: v["data"]["stats"].as_object().map(|o| serde_json::Value::Object(o.clone())),
        })
    }

    pub async fn query_exemplars(client: &PrometheusClient, req: &ExemplarQueryRequest) -> PrometheusResult<Vec<Exemplar>> {
        let mut endpoint = format!("/api/v1/query_exemplars?query={}", urlencoding(&req.query));
        if let Some(start) = &req.start {
            endpoint.push_str(&format!("&start={start}"));
        }
        if let Some(end) = &req.end {
            endpoint.push_str(&format!("&end={end}"));
        }
        let body = client.api_get(&endpoint).await?;
        let v: serde_json::Value = serde_json::from_str(&body)
            .map_err(|e| PrometheusError::parse(format!("exemplars: {e}")))?;
        let data = v["data"].as_array()
            .ok_or_else(|| PrometheusError::parse("missing data"))?;
        let mut result = Vec::new();
        for item in data {
            result.push(serde_json::from_value(item.clone())
                .map_err(|e| PrometheusError::parse(format!("exemplar parse: {e}")))?);
        }
        Ok(result)
    }

    pub async fn get_metric_metadata(client: &PrometheusClient, metric: Option<&str>) -> PrometheusResult<Vec<MetricMetadata>> {
        let endpoint = match metric {
            Some(m) => format!("/api/v1/metadata?metric={m}"),
            None => "/api/v1/metadata".to_string(),
        };
        let body = client.api_get(&endpoint).await?;
        let v: serde_json::Value = serde_json::from_str(&body)
            .map_err(|e| PrometheusError::parse(format!("metadata: {e}")))?;
        let data = v["data"].as_object()
            .ok_or_else(|| PrometheusError::parse("missing data"))?;
        let mut result = Vec::new();
        for (name, entries) in data {
            if let Some(arr) = entries.as_array() {
                for entry in arr {
                    result.push(MetricMetadata {
                        metric_name: name.clone(),
                        metric_type: entry["type"].as_str().unwrap_or("").to_string(),
                        help: entry["help"].as_str().unwrap_or("").to_string(),
                        unit: entry["unit"].as_str().map(String::from),
                    });
                }
            }
        }
        Ok(result)
    }

    pub async fn list_metric_names(client: &PrometheusClient) -> PrometheusResult<Vec<String>> {
        let body = client.api_get("/api/v1/label/__name__/values").await?;
        let v: serde_json::Value = serde_json::from_str(&body)
            .map_err(|e| PrometheusError::parse(format!("metric names: {e}")))?;
        let data = v["data"].as_array()
            .ok_or_else(|| PrometheusError::parse("missing data"))?;
        Ok(data.iter().filter_map(|v| v.as_str().map(String::from)).collect())
    }

    pub async fn list_label_names(client: &PrometheusClient) -> PrometheusResult<Vec<String>> {
        let body = client.api_get("/api/v1/labels").await?;
        let v: serde_json::Value = serde_json::from_str(&body)
            .map_err(|e| PrometheusError::parse(format!("label names: {e}")))?;
        let data = v["data"].as_array()
            .ok_or_else(|| PrometheusError::parse("missing data"))?;
        Ok(data.iter().filter_map(|v| v.as_str().map(String::from)).collect())
    }

    pub async fn list_label_values(client: &PrometheusClient, label_name: &str) -> PrometheusResult<Vec<String>> {
        let endpoint = format!("/api/v1/label/{label_name}/values");
        let body = client.api_get(&endpoint).await?;
        let v: serde_json::Value = serde_json::from_str(&body)
            .map_err(|e| PrometheusError::parse(format!("label values: {e}")))?;
        let data = v["data"].as_array()
            .ok_or_else(|| PrometheusError::parse("missing data"))?;
        Ok(data.iter().filter_map(|v| v.as_str().map(String::from)).collect())
    }

    pub async fn get_series(client: &PrometheusClient, req: &SeriesQueryRequest) -> PrometheusResult<Vec<Series>> {
        let matchers = req.matchers.iter()
            .map(|m| format!("match[]={}", urlencoding(m)))
            .collect::<Vec<_>>()
            .join("&");
        let mut endpoint = format!("/api/v1/series?{matchers}");
        if let Some(start) = &req.start {
            endpoint.push_str(&format!("&start={start}"));
        }
        if let Some(end) = &req.end {
            endpoint.push_str(&format!("&end={end}"));
        }
        let body = client.api_get(&endpoint).await?;
        let v: serde_json::Value = serde_json::from_str(&body)
            .map_err(|e| PrometheusError::parse(format!("series: {e}")))?;
        let data = v["data"].as_array()
            .ok_or_else(|| PrometheusError::parse("missing data"))?;
        let mut result = Vec::new();
        for item in data {
            result.push(serde_json::from_value(item.clone())
                .map_err(|e| PrometheusError::parse(format!("series parse: {e}")))?);
        }
        Ok(result)
    }

    pub async fn delete_series(client: &PrometheusClient, req: &DeleteSeriesRequest) -> PrometheusResult<()> {
        let matchers = req.matchers.iter()
            .map(|m| format!("match[]={}", urlencoding(m)))
            .collect::<Vec<_>>()
            .join("&");
        let mut endpoint = format!("/api/v1/admin/tsdb/delete_series?{matchers}");
        if let Some(start) = &req.start {
            endpoint.push_str(&format!("&start={start}"));
        }
        if let Some(end) = &req.end {
            endpoint.push_str(&format!("&end={end}"));
        }
        client.api_post(&endpoint, "").await?;
        Ok(())
    }

    pub async fn get_query_stats(client: &PrometheusClient, query: &str) -> PrometheusResult<serde_json::Value> {
        let endpoint = format!("/api/v1/query?query={}&stats=all", urlencoding(query));
        let body = client.api_get(&endpoint).await?;
        let v: serde_json::Value = serde_json::from_str(&body)
            .map_err(|e| PrometheusError::parse(format!("query stats: {e}")))?;
        Ok(v["data"]["stats"].clone())
    }

    pub async fn explain_query(client: &PrometheusClient, query: &str) -> PrometheusResult<serde_json::Value> {
        // Use the query stats and metadata to explain the query
        let endpoint = format!("/api/v1/query?query={}&stats=all", urlencoding(query));
        let body = client.api_get(&endpoint).await?;
        let v: serde_json::Value = serde_json::from_str(&body)
            .map_err(|e| PrometheusError::parse(format!("explain query: {e}")))?;
        Ok(v["data"].clone())
    }
}

/// Simple URL-encoding for query parameters.
fn urlencoding(s: &str) -> String {
    s.replace('%', "%25")
        .replace(' ', "%20")
        .replace('{', "%7B")
        .replace('}', "%7D")
        .replace('"', "%22")
        .replace('=', "%3D")
        .replace('&', "%26")
        .replace('+', "%2B")
}
