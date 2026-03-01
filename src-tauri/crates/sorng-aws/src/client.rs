//! Base AWS HTTP client with SigV4 signing.
//!
//! Provides a generic HTTP client that adds AWS Signature V4 authentication
//! to every request. Supports both the AWS Query API (XML) and the newer
//! JSON API styles. Mirrors the `aws-smithy-client` runtime layer from the
//! official SDK.

use crate::config::{AwsCredentials, AwsRegion, RetryConfig, RetryMode};
use crate::error::{AwsError, AwsResult};
use crate::signing::SigV4Signer;
use chrono::Utc;
use reqwest::Client;
use std::collections::BTreeMap;
use std::time::Duration;

/// Base AWS client that handles signing, retries, and HTTP communication.
#[derive(Debug, Clone)]
pub struct AwsClient {
    /// HTTP client.
    http: Client,
    /// Credentials for signing.
    credentials: AwsCredentials,
    /// Region.
    region: AwsRegion,
    /// Retry configuration.
    retry_config: RetryConfig,
    /// Custom endpoint URL override (for LocalStack, MinIO, etc.).
    endpoint_override: Option<String>,
    /// User-Agent string.
    user_agent: String,
}

/// Response from an AWS API call.
#[derive(Debug, Clone)]
pub struct AwsResponse {
    pub status: u16,
    pub headers: BTreeMap<String, String>,
    pub body: String,
    pub request_id: Option<String>,
}

impl AwsClient {
    /// Create a new AWS client.
    pub fn new(
        credentials: AwsCredentials,
        region: AwsRegion,
        retry_config: RetryConfig,
        endpoint_override: Option<String>,
    ) -> Self {
        let http = Client::builder()
            .timeout(Duration::from_secs(30))
            .connect_timeout(Duration::from_secs(10))
            .pool_max_idle_per_host(10)
            .build()
            .unwrap_or_else(|_| Client::new());

        Self {
            http,
            credentials,
            region,
            retry_config,
            endpoint_override,
            user_agent: "SortOfRemoteNG/1.0 aws-client/0.1".to_string(),
        }
    }

    /// Get the base endpoint for a service.
    pub fn endpoint(&self, service: &str) -> String {
        if let Some(ref url) = self.endpoint_override {
            url.clone()
        } else {
            self.region.endpoint(service)
        }
    }

    /// Get the region name.
    pub fn region_name(&self) -> &str {
        &self.region.name
    }

    /// Execute a signed AWS Query API request (form-encoded body, XML response).
    ///
    /// This is used by EC2, IAM, STS, CloudWatch, SQS, SNS, CloudFormation,
    /// AutoScaling, and other services that use the Query protocol.
    pub async fn query_request(
        &self,
        service: &str,
        params: &BTreeMap<String, String>,
    ) -> AwsResult<AwsResponse> {
        let endpoint = self.endpoint(service);

        // Build form body
        let body = params
            .iter()
            .map(|(k, v)| format!("{}={}", crate::signing::uri_encode(k), crate::signing::uri_encode(v)))
            .collect::<Vec<_>>()
            .join("&");

        let host = extract_host(&endpoint);
        let mut headers = BTreeMap::new();
        headers.insert("host".to_string(), host);
        headers.insert(
            "content-type".to_string(),
            "application/x-www-form-urlencoded; charset=utf-8".to_string(),
        );

        self.execute_with_retry(service, "POST", &endpoint, headers, &body)
            .await
    }

    /// Execute a signed AWS JSON API request.
    ///
    /// Used by Lambda, ECS, Secrets Manager, SSM, DynamoDB,
    /// CloudWatch Logs, and other JSON-protocol services.
    pub async fn json_request(
        &self,
        service: &str,
        target: &str,
        json_body: &str,
    ) -> AwsResult<AwsResponse> {
        let endpoint = self.endpoint(service);
        let host = extract_host(&endpoint);

        let mut headers = BTreeMap::new();
        headers.insert("host".to_string(), host);
        headers.insert("content-type".to_string(), "application/x-amz-json-1.1".to_string());
        headers.insert("x-amz-target".to_string(), target.to_string());

        self.execute_with_retry(service, "POST", &endpoint, headers, json_body)
            .await
    }

    /// Execute a signed REST API request (used by S3, Route53, etc.).
    pub async fn rest_request(
        &self,
        service: &str,
        method: &str,
        path: &str,
        extra_headers: BTreeMap<String, String>,
        body: &str,
    ) -> AwsResult<AwsResponse> {
        let base = self.endpoint(service);
        let url = if path.starts_with('/') {
            format!("{}{}", base, path)
        } else {
            format!("{}/{}", base, path)
        };

        let host = extract_host(&base);
        let mut headers = extra_headers;
        headers.insert("host".to_string(), host);

        self.execute_with_retry(service, method, &url, headers, body)
            .await
    }

    /// Execute a signed REST XML request with a query string.
    pub async fn rest_xml_request(
        &self,
        service: &str,
        method: &str,
        path: &str,
        query_params: &BTreeMap<String, String>,
        body: &str,
    ) -> AwsResult<AwsResponse> {
        let base = self.endpoint(service);
        let query_string = if query_params.is_empty() {
            String::new()
        } else {
            format!(
                "?{}",
                query_params
                    .iter()
                    .map(|(k, v)| format!("{}={}", k, v))
                    .collect::<Vec<_>>()
                    .join("&")
            )
        };
        let url = format!("{}{}{}", base, path, query_string);
        let host = extract_host(&base);
        let mut headers = BTreeMap::new();
        headers.insert("host".to_string(), host);
        if !body.is_empty() {
            headers.insert("content-type".to_string(), "application/xml".to_string());
        }

        self.execute_with_retry(service, method, &url, headers, body)
            .await
    }

    /// Execute an HTTP request with SigV4 signing and retry logic.
    async fn execute_with_retry(
        &self,
        service: &str,
        method: &str,
        url: &str,
        headers: BTreeMap<String, String>,
        body: &str,
    ) -> AwsResult<AwsResponse> {
        let max_attempts = self.retry_config.max_attempts;

        for attempt in 0..max_attempts {
            match self.execute_signed(service, method, url, &headers, body).await {
                Ok(response) => {
                    if response.status >= 200 && response.status < 300 {
                        return Ok(response);
                    }

                    // Parse error
                    let error = if response.body.trim_start().starts_with('<') {
                        AwsError::parse_xml_error(service, response.status, &response.body)
                    } else {
                        AwsError::parse_json_error(service, response.status, &response.body)
                    };

                    // Retry if retryable and we have attempts left
                    if error.retryable && attempt + 1 < max_attempts {
                        let delay = self.calculate_backoff(attempt);
                        log::warn!(
                            "AWS {} retryable error (attempt {}/{}): {} - retrying in {}ms",
                            service,
                            attempt + 1,
                            max_attempts,
                            error.code,
                            delay
                        );
                        tokio::time::sleep(Duration::from_millis(delay)).await;
                        continue;
                    }

                    return Err(error);
                }
                Err(e) => {
                    if e.retryable && attempt + 1 < max_attempts {
                        let delay = self.calculate_backoff(attempt);
                        log::warn!(
                            "AWS {} HTTP error (attempt {}/{}): {} - retrying in {}ms",
                            service,
                            attempt + 1,
                            max_attempts,
                            e.message,
                            delay
                        );
                        tokio::time::sleep(Duration::from_millis(delay)).await;
                        continue;
                    }
                    return Err(e);
                }
            }
        }

        Err(AwsError::new(
            service,
            "MaxRetriesExceeded",
            &format!("Request failed after {} attempts", max_attempts),
            0,
        ))
    }

    /// Execute a single signed HTTP request.
    async fn execute_signed(
        &self,
        service: &str,
        method: &str,
        url: &str,
        headers: &BTreeMap<String, String>,
        body: &str,
    ) -> AwsResult<AwsResponse> {
        let signer = SigV4Signer::new(
            &self.credentials.access_key_id,
            &self.credentials.secret_access_key,
            self.credentials.session_token.as_deref(),
            &self.region.name,
            service,
        );

        let signed = signer.sign_request(method, url, headers, body, Utc::now());

        // Build reqwest request
        let mut req = match method {
            "GET" => self.http.get(&signed.url),
            "POST" => self.http.post(&signed.url),
            "PUT" => self.http.put(&signed.url),
            "DELETE" => self.http.delete(&signed.url),
            "HEAD" => self.http.head(&signed.url),
            "PATCH" => self.http.patch(&signed.url),
            _ => self.http.request(
                method.parse().map_err(|_| {
                    AwsError::from_str(service, &format!("Invalid HTTP method: {}", method))
                })?,
                url,
            ),
        };

        // Add signed headers
        for (key, value) in &signed.headers {
            req = req.header(key.as_str(), value.as_str());
        }

        // Add user agent
        req = req.header("user-agent", &self.user_agent);

        // Add body
        if let Some(ref b) = signed.body {
            req = req.body(b.clone());
        }

        // Execute
        let resp = req.send().await.map_err(AwsError::from)?;

        let status = resp.status().as_u16();
        let mut resp_headers = BTreeMap::new();
        for (key, value) in resp.headers() {
            if let Ok(v) = value.to_str() {
                resp_headers.insert(key.as_str().to_string(), v.to_string());
            }
        }
        let request_id = resp_headers
            .get("x-amz-request-id")
            .or_else(|| resp_headers.get("x-amzn-requestid"))
            .cloned();
        let resp_body = resp.text().await.map_err(AwsError::from)?;

        Ok(AwsResponse {
            status,
            headers: resp_headers,
            body: resp_body,
            request_id,
        })
    }

    /// Calculate exponential backoff with jitter.
    fn calculate_backoff(&self, attempt: u32) -> u64 {
        let base = self.retry_config.initial_backoff_ms;
        let max = self.retry_config.max_backoff_ms;
        let exponential = base * 2u64.pow(attempt);
        let capped = exponential.min(max);

        match self.retry_config.mode {
            RetryMode::Adaptive | RetryMode::Standard => {
                // Full jitter: random between 0 and capped
                use rand::Rng;
                let mut rng = rand::thread_rng();
                rng.gen_range(0..=capped)
            }
            RetryMode::Legacy => capped,
        }
    }
}

/// Extract the host from a URL string.
fn extract_host(url: &str) -> String {
    url::Url::parse(url)
        .ok()
        .and_then(|u| u.host_str().map(|h| h.to_string()))
        .unwrap_or_else(|| "amazonaws.com".to_string())
}

/// Helper to build Query API parameters with common fields.
pub fn build_query_params(action: &str, version: &str) -> BTreeMap<String, String> {
    let mut params = BTreeMap::new();
    params.insert("Action".to_string(), action.to_string());
    params.insert("Version".to_string(), version.to_string());
    params
}

/// Helper to add filter parameters to a query.
pub fn add_filters(params: &mut BTreeMap<String, String>, filters: &[crate::config::Filter]) {
    for (i, filter) in filters.iter().enumerate() {
        let idx = i + 1;
        params.insert(format!("Filter.{}.Name", idx), filter.name.clone());
        for (j, val) in filter.values.iter().enumerate() {
            params.insert(format!("Filter.{}.Value.{}", idx, j + 1), val.clone());
        }
    }
}

/// Helper to add tag parameters.
pub fn add_tags(params: &mut BTreeMap<String, String>, tags: &[crate::config::Tag], prefix: &str) {
    for (i, tag) in tags.iter().enumerate() {
        let idx = i + 1;
        params.insert(format!("{}.{}.Key", prefix, idx), tag.key.clone());
        params.insert(format!("{}.{}.Value", prefix, idx), tag.value.clone());
    }
}

/// Simple XML value extractor for AWS responses.
pub fn xml_text(xml: &str, tag: &str) -> Option<String> {
    let open = format!("<{}>", tag);
    let close = format!("</{}>", tag);
    if let Some(start) = xml.find(&open) {
        let content_start = start + open.len();
        if let Some(end) = xml[content_start..].find(&close) {
            return Some(xml[content_start..content_start + end].to_string());
        }
    }
    // Try with namespace prefix
    let open_ns = format!("<{}:", tag.split(':').last().unwrap_or(tag));
    if let Some(start) = xml.find(&open_ns) {
        if let Some(gt) = xml[start..].find('>') {
            let content_start = start + gt + 1;
            if let Some(end) = xml[content_start..].find(&close) {
                return Some(xml[content_start..content_start + end].to_string());
            }
        }
    }
    None
}

/// Extract all occurrences of a tag from XML.
pub fn xml_text_all(xml: &str, tag: &str) -> Vec<String> {
    let mut results = Vec::new();
    let open = format!("<{}>", tag);
    let close = format!("</{}>", tag);
    let mut search_from = 0;
    while let Some(start) = xml[search_from..].find(&open) {
        let abs_start = search_from + start + open.len();
        if let Some(end) = xml[abs_start..].find(&close) {
            results.push(xml[abs_start..abs_start + end].to_string());
            search_from = abs_start + end + close.len();
        } else {
            break;
        }
    }
    results
}

/// Extract an XML block (including nested content) for a given tag.
pub fn xml_block(xml: &str, tag: &str) -> Option<String> {
    let open = format!("<{}", tag);
    let close = format!("</{}>", tag);
    if let Some(start) = xml.find(&open) {
        if let Some(end) = xml[start..].find(&close) {
            let full_end = start + end + close.len();
            return Some(xml[start..full_end].to_string());
        }
    }
    None
}

/// Extract all XML blocks for a given tag.
pub fn xml_blocks(xml: &str, tag: &str) -> Vec<String> {
    let mut results = Vec::new();
    let open = format!("<{}", tag);
    let close = format!("</{}>", tag);
    let mut search_from = 0;
    while let Some(start) = xml[search_from..].find(&open) {
        let abs_start = search_from + start;
        if let Some(end) = xml[abs_start..].find(&close) {
            let full_end = abs_start + end + close.len();
            results.push(xml[abs_start..full_end].to_string());
            search_from = full_end;
        } else {
            break;
        }
    }
    results
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extract_host_https() {
        assert_eq!(
            extract_host("https://ec2.us-east-1.amazonaws.com"),
            "ec2.us-east-1.amazonaws.com"
        );
    }

    #[test]
    fn extract_host_with_path() {
        assert_eq!(
            extract_host("https://s3.us-west-2.amazonaws.com/bucket"),
            "s3.us-west-2.amazonaws.com"
        );
    }

    #[test]
    fn build_query_params_basic() {
        let params = build_query_params("DescribeInstances", "2016-11-15");
        assert_eq!(params["Action"], "DescribeInstances");
        assert_eq!(params["Version"], "2016-11-15");
    }

    #[test]
    fn xml_text_simple() {
        let xml = "<Response><InstanceId>i-123</InstanceId></Response>";
        assert_eq!(xml_text(xml, "InstanceId"), Some("i-123".to_string()));
    }

    #[test]
    fn xml_text_missing() {
        let xml = "<Response></Response>";
        assert_eq!(xml_text(xml, "Missing"), None);
    }

    #[test]
    fn xml_text_all_multiple() {
        let xml = "<List><item>a</item><item>b</item><item>c</item></List>";
        let items = xml_text_all(xml, "item");
        assert_eq!(items, vec!["a", "b", "c"]);
    }

    #[test]
    fn xml_block_extraction() {
        let xml = r#"<Root><Instance><Id>i-1</Id><State>running</State></Instance></Root>"#;
        let block = xml_block(xml, "Instance").unwrap();
        assert!(block.contains("<Id>i-1</Id>"));
        assert!(block.contains("<State>running</State>"));
    }

    #[test]
    fn xml_blocks_multiple() {
        let xml = r#"<Root><Item><Id>1</Id></Item><Item><Id>2</Id></Item></Root>"#;
        let blocks = xml_blocks(xml, "Item");
        assert_eq!(blocks.len(), 2);
    }

    #[test]
    fn add_filters_to_params() {
        let mut params = BTreeMap::new();
        let filters = vec![
            crate::config::Filter::new("instance-state-name", vec!["running".into()]),
        ];
        add_filters(&mut params, &filters);
        assert_eq!(params["Filter.1.Name"], "instance-state-name");
        assert_eq!(params["Filter.1.Value.1"], "running");
    }

    #[test]
    fn add_tags_to_params() {
        let mut params = BTreeMap::new();
        let tags = vec![crate::config::Tag::new("Name", "web-server")];
        add_tags(&mut params, &tags, "Tag");
        assert_eq!(params["Tag.1.Key"], "Name");
        assert_eq!(params["Tag.1.Value"], "web-server");
    }
}
