//! AWS Lambda service client.
//!
//! Mirrors `aws-sdk-lambda` types and operations. Lambda uses the REST+JSON protocol.
//!
//! Reference: <https://docs.aws.amazon.com/lambda/latest/api/>

use crate::client::AwsClient;
use crate::error::{AwsError, AwsResult};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap};

const SERVICE: &str = "lambda";

// ── Types ───────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
pub enum Runtime {
    #[serde(rename = "nodejs18.x")]
    Nodejs18X,
    #[serde(rename = "nodejs20.x")]
    Nodejs20X,
    #[serde(rename = "python3.11")]
    Python311,
    #[serde(rename = "python3.12")]
    Python312,
    #[serde(rename = "java17")]
    Java17,
    #[serde(rename = "java21")]
    Java21,
    #[serde(rename = "dotnet6")]
    Dotnet6,
    #[serde(rename = "dotnet8")]
    Dotnet8,
    #[serde(rename = "go1.x")]
    Go1X,
    #[serde(rename = "ruby3.2")]
    Ruby32,
    #[serde(rename = "ruby3.3")]
    Ruby33,
    #[serde(rename = "provided.al2")]
    ProvidedAl2,
    #[serde(rename = "provided.al2023")]
    ProvidedAl2023,
}

impl std::fmt::Display for Runtime {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let s = serde_json::to_value(self).ok().and_then(|v| v.as_str().map(String::from)).unwrap_or_default();
        f.write_str(&s)
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
pub enum Architecture {
    #[serde(rename = "x86_64")]
    X86_64,
    #[serde(rename = "arm64")]
    Arm64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FunctionConfiguration {
    pub function_name: String,
    pub function_arn: String,
    pub runtime: Option<String>,
    pub role: String,
    pub handler: Option<String>,
    pub code_size: i64,
    pub description: Option<String>,
    pub timeout: u32,
    pub memory_size: u32,
    pub last_modified: String,
    pub code_sha256: Option<String>,
    pub version: String,
    pub vpc_config: Option<VpcConfig>,
    pub environment: Option<EnvironmentResponse>,
    pub tracing_config: Option<TracingConfig>,
    pub state: Option<String>,
    pub state_reason: Option<String>,
    pub state_reason_code: Option<String>,
    pub layers: Vec<LayerRef>,
    pub architectures: Vec<String>,
    pub ephemeral_storage: Option<EphemeralStorage>,
    pub package_type: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VpcConfig {
    pub subnet_ids: Vec<String>,
    pub security_group_ids: Vec<String>,
    pub vpc_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EnvironmentResponse {
    pub variables: HashMap<String, String>,
    pub error: Option<EnvironmentError>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EnvironmentError {
    pub error_code: Option<String>,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TracingConfig {
    pub mode: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LayerRef {
    pub arn: Option<String>,
    pub code_size: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EphemeralStorage {
    pub size: u32,
}

/// Function code for creating / updating a function.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FunctionCode {
    #[serde(rename = "S3Bucket", skip_serializing_if = "Option::is_none")]
    pub s3_bucket: Option<String>,
    #[serde(rename = "S3Key", skip_serializing_if = "Option::is_none")]
    pub s3_key: Option<String>,
    #[serde(rename = "S3ObjectVersion", skip_serializing_if = "Option::is_none")]
    pub s3_object_version: Option<String>,
    #[serde(rename = "ZipFile", skip_serializing_if = "Option::is_none")]
    pub zip_file: Option<String>, // base64
    #[serde(rename = "ImageUri", skip_serializing_if = "Option::is_none")]
    pub image_uri: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateFunctionInput {
    #[serde(rename = "FunctionName")]
    pub function_name: String,
    #[serde(rename = "Runtime", skip_serializing_if = "Option::is_none")]
    pub runtime: Option<String>,
    #[serde(rename = "Role")]
    pub role: String,
    #[serde(rename = "Handler", skip_serializing_if = "Option::is_none")]
    pub handler: Option<String>,
    #[serde(rename = "Code")]
    pub code: FunctionCode,
    #[serde(rename = "Description", skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(rename = "Timeout", skip_serializing_if = "Option::is_none")]
    pub timeout: Option<u32>,
    #[serde(rename = "MemorySize", skip_serializing_if = "Option::is_none")]
    pub memory_size: Option<u32>,
    #[serde(rename = "Environment", skip_serializing_if = "Option::is_none")]
    pub environment: Option<EnvironmentInput>,
    #[serde(rename = "VpcConfig", skip_serializing_if = "Option::is_none")]
    pub vpc_config: Option<VpcConfigInput>,
    #[serde(rename = "Layers", skip_serializing_if = "Option::is_none")]
    pub layers: Option<Vec<String>>,
    #[serde(rename = "Architectures", skip_serializing_if = "Option::is_none")]
    pub architectures: Option<Vec<String>>,
    #[serde(rename = "PackageType", skip_serializing_if = "Option::is_none")]
    pub package_type: Option<String>,
    #[serde(rename = "Tags", skip_serializing_if = "Option::is_none")]
    pub tags: Option<HashMap<String, String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EnvironmentInput {
    #[serde(rename = "Variables")]
    pub variables: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VpcConfigInput {
    #[serde(rename = "SubnetIds")]
    pub subnet_ids: Vec<String>,
    #[serde(rename = "SecurityGroupIds")]
    pub security_group_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InvocationResponse {
    pub status_code: u16,
    pub function_error: Option<String>,
    pub log_result: Option<String>,
    pub payload: Option<String>,
    pub executed_version: Option<String>,
}

/// Event source mapping (triggers from DynamoDB, SQS, etc.).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EventSourceMapping {
    #[serde(rename = "UUID")]
    pub uuid: String,
    #[serde(rename = "FunctionArn")]
    pub function_arn: String,
    #[serde(rename = "EventSourceArn")]
    pub event_source_arn: String,
    #[serde(rename = "State")]
    pub state: String,
    #[serde(rename = "BatchSize")]
    pub batch_size: Option<u32>,
    #[serde(rename = "MaximumBatchingWindowInSeconds")]
    pub maximum_batching_window_in_seconds: Option<u32>,
    #[serde(rename = "LastModified")]
    pub last_modified: Option<String>,
}

/// Lambda function alias.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Alias {
    #[serde(rename = "AliasArn")]
    pub alias_arn: String,
    #[serde(rename = "Name")]
    pub name: String,
    #[serde(rename = "FunctionVersion")]
    pub function_version: String,
    #[serde(rename = "Description")]
    pub description: Option<String>,
}

/// Lambda layer version.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LayerVersion {
    pub layer_version_arn: Option<String>,
    pub version: Option<i64>,
    pub description: Option<String>,
    pub compatible_runtimes: Vec<String>,
    pub compatible_architectures: Vec<String>,
    pub created_date: Option<String>,
}

/// Concurrency configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Concurrency {
    pub reserved_concurrent_executions: Option<u32>,
}

// ── Lambda Client ───────────────────────────────────────────────────────

pub struct LambdaClient {
    client: AwsClient,
}

impl LambdaClient {
    pub fn new(client: AwsClient) -> Self {
        Self { client }
    }

    /// Lists all Lambda functions in the account.
    pub async fn list_functions(&self, marker: Option<&str>, max_items: Option<u32>) -> AwsResult<(Vec<FunctionConfiguration>, Option<String>)> {
        let mut path = "/2015-03-31/functions".to_string();
        let mut query_parts = Vec::new();
        if let Some(m) = marker {
            query_parts.push(format!("Marker={}", m));
        }
        if let Some(mi) = max_items {
            query_parts.push(format!("MaxItems={}", mi));
        }
        if !query_parts.is_empty() {
            path = format!("{}?{}", path, query_parts.join("&"));
        }
        let response = self.client.rest_request(SERVICE, "GET", &path, BTreeMap::new(), "").await?;
        let result: serde_json::Value = serde_json::from_str(&response.body)
            .map_err(|e| AwsError::new(SERVICE, "ParseError", &e.to_string(), response.status))?;
        let functions: Vec<FunctionConfiguration> = result.get("Functions")
            .and_then(|v| serde_json::from_value(v.clone()).ok())
            .unwrap_or_default();
        let next_marker = result.get("NextMarker")
            .and_then(|v| v.as_str())
            .map(String::from);
        Ok((functions, next_marker))
    }

    /// Gets a function's configuration and code location.
    pub async fn get_function(&self, function_name: &str) -> AwsResult<FunctionConfiguration> {
        let path = format!("/2015-03-31/functions/{}", function_name);
        let response = self.client.rest_request(SERVICE, "GET", &path, BTreeMap::new(), "").await?;
        let result: serde_json::Value = serde_json::from_str(&response.body)
            .map_err(|e| AwsError::new(SERVICE, "ParseError", &e.to_string(), response.status))?;
        let config = result.get("Configuration")
            .ok_or_else(|| AwsError::new(SERVICE, "ParseError", "No Configuration in response", 200))?;
        serde_json::from_value(config.clone())
            .map_err(|e| AwsError::new(SERVICE, "ParseError", &e.to_string(), 200))
    }

    /// Creates a new Lambda function.
    pub async fn create_function(&self, input: &CreateFunctionInput) -> AwsResult<FunctionConfiguration> {
        let path = "/2015-03-31/functions";
        let body = serde_json::to_string(input).map_err(|e| AwsError::new(SERVICE, "SerializeError", &e.to_string(), 0))?;
        let response = self.client.rest_request(SERVICE, "POST", path, BTreeMap::new(), &body).await?;
        serde_json::from_str(&response.body)
            .map_err(|e| AwsError::new(SERVICE, "ParseError", &e.to_string(), response.status))
    }

    /// Deletes a Lambda function.
    pub async fn delete_function(&self, function_name: &str, qualifier: Option<&str>) -> AwsResult<()> {
        let mut path = format!("/2015-03-31/functions/{}", function_name);
        if let Some(q) = qualifier {
            path = format!("{}?Qualifier={}", path, q);
        }
        self.client.rest_request(SERVICE, "DELETE", &path, BTreeMap::new(), "").await?;
        Ok(())
    }

    /// Updates a function's code.
    pub async fn update_function_code(&self, function_name: &str, code: &FunctionCode) -> AwsResult<FunctionConfiguration> {
        let path = format!("/2015-03-31/functions/{}/code", function_name);
        let body = serde_json::to_string(code).map_err(|e| AwsError::new(SERVICE, "SerializeError", &e.to_string(), 0))?;
        let response = self.client.rest_request(SERVICE, "PUT", &path, BTreeMap::new(), &body).await?;
        serde_json::from_str(&response.body)
            .map_err(|e| AwsError::new(SERVICE, "ParseError", &e.to_string(), response.status))
    }

    /// Updates a function's configuration.
    pub async fn update_function_configuration(&self, function_name: &str, config: &serde_json::Value) -> AwsResult<FunctionConfiguration> {
        let path = format!("/2015-03-31/functions/{}/configuration", function_name);
        let body = serde_json::to_string(config).map_err(|e| AwsError::new(SERVICE, "SerializeError", &e.to_string(), 0))?;
        let response = self.client.rest_request(SERVICE, "PUT", &path, BTreeMap::new(), &body).await?;
        serde_json::from_str(&response.body)
            .map_err(|e| AwsError::new(SERVICE, "ParseError", &e.to_string(), response.status))
    }

    /// Invokes a Lambda function synchronously or asynchronously.
    pub async fn invoke(&self, function_name: &str, payload: &[u8], invocation_type: Option<&str>) -> AwsResult<InvocationResponse> {
        let path = format!("/2015-03-31/functions/{}/invocations", function_name);
        let body = std::str::from_utf8(payload).unwrap_or("{}");

        let mut headers = BTreeMap::new();
        if let Some(inv_type) = invocation_type {
            headers.insert("x-amz-invocation-type".to_string(), inv_type.to_string());
        }
        headers.insert("x-amz-log-type".to_string(), "Tail".to_string());

        let response = self.client.rest_request(SERVICE, "POST", &path, headers, body).await?;
        Ok(InvocationResponse {
            status_code: response.status,
            function_error: response.headers.get("x-amz-function-error").cloned(),
            log_result: response.headers.get("x-amz-log-result").cloned(),
            payload: Some(response.body),
            executed_version: response.headers.get("x-amz-executed-version").cloned(),
        })
    }

    /// Lists event source mappings.
    pub async fn list_event_source_mappings(&self, function_name: Option<&str>) -> AwsResult<Vec<EventSourceMapping>> {
        let mut path = "/2015-03-31/event-source-mappings".to_string();
        if let Some(fn_name) = function_name {
            path = format!("{}?FunctionName={}", path, fn_name);
        }
        let response = self.client.rest_request(SERVICE, "GET", &path, BTreeMap::new(), "").await?;
        let result: serde_json::Value = serde_json::from_str(&response.body)
            .map_err(|e| AwsError::new(SERVICE, "ParseError", &e.to_string(), response.status))?;
        Ok(result.get("EventSourceMappings")
            .and_then(|v| serde_json::from_value(v.clone()).ok())
            .unwrap_or_default())
    }

    /// Creates an event source mapping.
    pub async fn create_event_source_mapping(&self, function_name: &str, event_source_arn: &str, batch_size: Option<u32>) -> AwsResult<EventSourceMapping> {
        let path = "/2015-03-31/event-source-mappings";
        let body = serde_json::json!({
            "FunctionName": function_name,
            "EventSourceArn": event_source_arn,
            "BatchSize": batch_size.unwrap_or(10),
            "Enabled": true,
        });
        let body_str = body.to_string();
        let response = self.client.rest_request(SERVICE, "POST", path, BTreeMap::new(), &body_str).await?;
        serde_json::from_str(&response.body)
            .map_err(|e| AwsError::new(SERVICE, "ParseError", &e.to_string(), response.status))
    }

    /// Lists function aliases.
    pub async fn list_aliases(&self, function_name: &str) -> AwsResult<Vec<Alias>> {
        let path = format!("/2015-03-31/functions/{}/aliases", function_name);
        let response = self.client.rest_request(SERVICE, "GET", &path, BTreeMap::new(), "").await?;
        let result: serde_json::Value = serde_json::from_str(&response.body)
            .map_err(|e| AwsError::new(SERVICE, "ParseError", &e.to_string(), response.status))?;
        Ok(result.get("Aliases")
            .and_then(|v| serde_json::from_value(v.clone()).ok())
            .unwrap_or_default())
    }

    /// Creates a function alias.
    pub async fn create_alias(&self, function_name: &str, name: &str, function_version: &str, description: Option<&str>) -> AwsResult<Alias> {
        let path = format!("/2015-03-31/functions/{}/aliases", function_name);
        let mut body = serde_json::json!({
            "Name": name,
            "FunctionVersion": function_version,
        });
        if let Some(desc) = description {
            body["Description"] = serde_json::Value::String(desc.to_string());
        }
        let body_str = body.to_string();
        let response = self.client.rest_request(SERVICE, "POST", &path, BTreeMap::new(), &body_str).await?;
        serde_json::from_str(&response.body)
            .map_err(|e| AwsError::new(SERVICE, "ParseError", &e.to_string(), response.status))
    }

    /// Lists layer versions.
    pub async fn list_layer_versions(&self, layer_name: &str) -> AwsResult<Vec<LayerVersion>> {
        let path = format!("/2018-10-31/layers/{}/versions", layer_name);
        let response = self.client.rest_request(SERVICE, "GET", &path, BTreeMap::new(), "").await?;
        let result: serde_json::Value = serde_json::from_str(&response.body)
            .map_err(|e| AwsError::new(SERVICE, "ParseError", &e.to_string(), response.status))?;
        Ok(result.get("LayerVersions")
            .and_then(|v| serde_json::from_value(v.clone()).ok())
            .unwrap_or_default())
    }

    /// Gets the reserved concurrency configuration for a function.
    pub async fn get_function_concurrency(&self, function_name: &str) -> AwsResult<Concurrency> {
        let path = format!("/2019-09-30/functions/{}/concurrency", function_name);
        let response = self.client.rest_request(SERVICE, "GET", &path, BTreeMap::new(), "").await?;
        serde_json::from_str(&response.body)
            .map_err(|e| AwsError::new(SERVICE, "ParseError", &e.to_string(), response.status))
    }

    /// Sets the reserved concurrency for a function.
    pub async fn put_function_concurrency(&self, function_name: &str, concurrent_executions: u32) -> AwsResult<Concurrency> {
        let path = format!("/2017-10-31/functions/{}/concurrency", function_name);
        let body = serde_json::json!({ "ReservedConcurrentExecutions": concurrent_executions });
        let body_str = body.to_string();
        let response = self.client.rest_request(SERVICE, "PUT", &path, BTreeMap::new(), &body_str).await?;
        serde_json::from_str(&response.body)
            .map_err(|e| AwsError::new(SERVICE, "ParseError", &e.to_string(), response.status))
    }

    /// Publishes a version of the function.
    pub async fn publish_version(&self, function_name: &str, description: Option<&str>) -> AwsResult<FunctionConfiguration> {
        let path = format!("/2015-03-31/functions/{}/versions", function_name);
        let mut body = serde_json::json!({});
        if let Some(desc) = description {
            body["Description"] = serde_json::Value::String(desc.to_string());
        }
        let body_str = body.to_string();
        let response = self.client.rest_request(SERVICE, "POST", &path, BTreeMap::new(), &body_str).await?;
        serde_json::from_str(&response.body)
            .map_err(|e| AwsError::new(SERVICE, "ParseError", &e.to_string(), response.status))
    }

    /// Lists published versions of a function.
    pub async fn list_versions_by_function(&self, function_name: &str) -> AwsResult<Vec<FunctionConfiguration>> {
        let path = format!("/2015-03-31/functions/{}/versions", function_name);
        let response = self.client.rest_request(SERVICE, "GET", &path, BTreeMap::new(), "").await?;
        let result: serde_json::Value = serde_json::from_str(&response.body)
            .map_err(|e| AwsError::new(SERVICE, "ParseError", &e.to_string(), response.status))?;
        Ok(result.get("Versions")
            .and_then(|v| serde_json::from_value(v.clone()).ok())
            .unwrap_or_default())
    }

    /// Tags a Lambda function.
    pub async fn tag_resource(&self, arn: &str, tags: &HashMap<String, String>) -> AwsResult<()> {
        let path = format!("/2017-03-31/tags/{}", arn);
        let body = serde_json::json!({ "Tags": tags });
        let body_str = body.to_string();
        self.client.rest_request(SERVICE, "POST", &path, BTreeMap::new(), &body_str).await?;
        Ok(())
    }

    /// Lists tags for a Lambda resource.
    pub async fn list_tags(&self, arn: &str) -> AwsResult<HashMap<String, String>> {
        let path = format!("/2017-03-31/tags/{}", arn);
        let response = self.client.rest_request(SERVICE, "GET", &path, BTreeMap::new(), "").await?;
        let result: serde_json::Value = serde_json::from_str(&response.body)
            .map_err(|e| AwsError::new(SERVICE, "ParseError", &e.to_string(), response.status))?;
        Ok(result.get("Tags")
            .and_then(|v| serde_json::from_value(v.clone()).ok())
            .unwrap_or_default())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn runtime_display() {
        assert_eq!(Runtime::Python312.to_string(), "python3.12");
        assert_eq!(Runtime::Nodejs20X.to_string(), "nodejs20.x");
    }

    #[test]
    fn function_config_serde() {
        let cfg = FunctionConfiguration {
            function_name: "my-func".to_string(),
            function_arn: "arn:aws:lambda:us-east-1:123456789012:function:my-func".to_string(),
            runtime: Some("python3.12".to_string()),
            role: "arn:aws:iam::123456789012:role/lambda-role".to_string(),
            handler: Some("index.handler".to_string()),
            code_size: 1024,
            description: Some("Test function".to_string()),
            timeout: 30,
            memory_size: 128,
            last_modified: "2024-01-01T00:00:00.000+0000".to_string(),
            code_sha256: Some("abc123".to_string()),
            version: "$LATEST".to_string(),
            vpc_config: None,
            environment: None,
            tracing_config: None,
            state: Some("Active".to_string()),
            state_reason: None,
            state_reason_code: None,
            layers: vec![],
            architectures: vec!["x86_64".to_string()],
            ephemeral_storage: Some(EphemeralStorage { size: 512 }),
            package_type: Some("Zip".to_string()),
        };
        let json = serde_json::to_string(&cfg).unwrap();
        let back: FunctionConfiguration = serde_json::from_str(&json).unwrap();
        assert_eq!(back.function_name, "my-func");
        assert_eq!(back.memory_size, 128);
    }

    #[test]
    fn create_function_input_serde() {
        let input = CreateFunctionInput {
            function_name: "hello".to_string(),
            runtime: Some("python3.12".to_string()),
            role: "arn:aws:iam::123456789012:role/role".to_string(),
            handler: Some("index.handler".to_string()),
            code: FunctionCode {
                s3_bucket: Some("my-bucket".to_string()),
                s3_key: Some("code.zip".to_string()),
                s3_object_version: None,
                zip_file: None,
                image_uri: None,
            },
            description: Some("Hello function".to_string()),
            timeout: Some(30),
            memory_size: Some(256),
            environment: Some(EnvironmentInput {
                variables: [("ENV".to_string(), "prod".to_string())].into(),
            }),
            vpc_config: None,
            layers: None,
            architectures: Some(vec!["arm64".to_string()]),
            package_type: None,
            tags: None,
        };
        let json = serde_json::to_string(&input).unwrap();
        assert!(json.contains("FunctionName"));
        assert!(json.contains("S3Bucket"));
    }
}
