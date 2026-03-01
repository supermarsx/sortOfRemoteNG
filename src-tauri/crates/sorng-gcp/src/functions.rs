//! Google Cloud Functions client.
//!
//! Covers Cloud Functions (2nd gen) – list, get, call, create, delete.
//!
//! API base: `https://cloudfunctions.googleapis.com/v2`

use crate::client::GcpClient;
use crate::error::GcpResult;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

const SERVICE: &str = "cloudfunctions";
const V2: &str = "/v2";

// ── Types ───────────────────────────────────────────────────────────────

/// Cloud Function (2nd gen).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Function {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub state: String,
    #[serde(default, rename = "updateTime")]
    pub update_time: Option<String>,
    #[serde(default)]
    pub labels: HashMap<String, String>,
    #[serde(default)]
    pub environment: Option<String>,
    #[serde(default)]
    pub url: Option<String>,
    #[serde(default, rename = "buildConfig")]
    pub build_config: Option<BuildConfig>,
    #[serde(default, rename = "serviceConfig")]
    pub service_config: Option<ServiceConfig>,
    #[serde(default, rename = "eventTrigger")]
    pub event_trigger: Option<EventTrigger>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BuildConfig {
    #[serde(default)]
    pub runtime: Option<String>,
    #[serde(default, rename = "entryPoint")]
    pub entry_point: Option<String>,
    #[serde(default)]
    pub source: Option<serde_json::Value>,
    #[serde(default, rename = "dockerRepository")]
    pub docker_repository: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServiceConfig {
    #[serde(default)]
    pub uri: Option<String>,
    #[serde(default, rename = "serviceAccountEmail")]
    pub service_account_email: Option<String>,
    #[serde(default, rename = "availableMemory")]
    pub available_memory: Option<String>,
    #[serde(default, rename = "timeoutSeconds")]
    pub timeout_seconds: Option<u32>,
    #[serde(default, rename = "maxInstanceCount")]
    pub max_instance_count: Option<u32>,
    #[serde(default, rename = "minInstanceCount")]
    pub min_instance_count: Option<u32>,
    #[serde(default, rename = "availableCpu")]
    pub available_cpu: Option<String>,
    #[serde(default, rename = "environmentVariables")]
    pub environment_variables: HashMap<String, String>,
    #[serde(default, rename = "ingressSettings")]
    pub ingress_settings: Option<String>,
    #[serde(default, rename = "vpcConnector")]
    pub vpc_connector: Option<String>,
    #[serde(default)]
    pub revision: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EventTrigger {
    #[serde(default)]
    pub trigger: Option<String>,
    #[serde(default, rename = "triggerRegion")]
    pub trigger_region: Option<String>,
    #[serde(default, rename = "eventType")]
    pub event_type: Option<String>,
    #[serde(default, rename = "pubsubTopic")]
    pub pubsub_topic: Option<String>,
    #[serde(default, rename = "serviceAccountEmail")]
    pub service_account_email: Option<String>,
    #[serde(default, rename = "retryPolicy")]
    pub retry_policy: Option<String>,
}

/// Function invocation result.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CallResult {
    pub execution_id: Option<String>,
    pub result: Option<String>,
    pub error: Option<String>,
}

/// Long-running operation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FunctionOperation {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub done: bool,
    #[serde(default)]
    pub metadata: Option<serde_json::Value>,
    #[serde(default)]
    pub error: Option<serde_json::Value>,
    #[serde(default)]
    pub response: Option<serde_json::Value>,
}

// ── List wrapper ────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
struct FunctionList {
    #[serde(default)]
    functions: Vec<Function>,
    #[serde(default, rename = "nextPageToken")]
    next_page_token: Option<String>,
}

// ── Functions Client ────────────────────────────────────────────────────

pub struct FunctionsClient;

impl FunctionsClient {
    /// List Cloud Functions in a location.
    pub async fn list_functions(
        client: &mut GcpClient,
        project: &str,
        location: &str,
    ) -> GcpResult<Vec<Function>> {
        let path = format!(
            "{}/projects/{}/locations/{}/functions",
            V2, project, location
        );
        let resp: FunctionList = client.get(SERVICE, &path, &[]).await?;
        Ok(resp.functions)
    }

    /// List all functions across all locations.
    pub async fn list_all_functions(
        client: &mut GcpClient,
        project: &str,
    ) -> GcpResult<Vec<Function>> {
        let path = format!(
            "{}/projects/{}/locations/-/functions",
            V2, project
        );
        let resp: FunctionList = client.get(SERVICE, &path, &[]).await?;
        Ok(resp.functions)
    }

    /// Get a Cloud Function by name.
    pub async fn get_function(
        client: &mut GcpClient,
        project: &str,
        location: &str,
        function_name: &str,
    ) -> GcpResult<Function> {
        let path = format!(
            "{}/projects/{}/locations/{}/functions/{}",
            V2, project, location, function_name
        );
        client.get(SERVICE, &path, &[]).await
    }

    /// Delete a Cloud Function.
    pub async fn delete_function(
        client: &mut GcpClient,
        project: &str,
        location: &str,
        function_name: &str,
    ) -> GcpResult<FunctionOperation> {
        let path = format!(
            "{}/projects/{}/locations/{}/functions/{}",
            V2, project, location, function_name
        );
        let text = client.delete(SERVICE, &path).await?;
        serde_json::from_str(&text)
            .map_err(|e| crate::error::GcpError::from_str(SERVICE, &format!("Parse operation: {}", e)))
    }

    /// Call an HTTP-triggered Cloud Function (1st gen style via v1 API).
    pub async fn call_function(
        client: &mut GcpClient,
        project: &str,
        location: &str,
        function_name: &str,
        data: &str,
    ) -> GcpResult<CallResult> {
        // v1 still used for callFunction
        let path = format!(
            "/v1/projects/{}/locations/{}/functions/{}:call",
            project, location, function_name
        );
        let body = serde_json::json!({ "data": data });
        client.post(SERVICE, &path, &body).await
    }

    /// Generate a download URL for function source.
    pub async fn generate_download_url(
        client: &mut GcpClient,
        function_name: &str,
    ) -> GcpResult<String> {
        let path = format!("{}/{}:generateDownloadUrl", V2, function_name);
        let resp: serde_json::Value = client
            .post(SERVICE, &path, &serde_json::json!({}))
            .await?;
        Ok(resp
            .get("downloadUrl")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string())
    }
}
