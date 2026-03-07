use std::collections::HashMap;

use reqwest::Client;
use serde::{Deserialize, Serialize};

use crate::error::{KafkaError, KafkaResult};
use crate::types::*;

/// Client for the Kafka Connect REST API.
pub struct KafkaConnectClient {
    client: Client,
    base_url: String,
    auth: Option<(String, String)>,
}

/// Status response from the Connect REST API.
#[derive(Debug, Deserialize)]
struct ConnectorStatusResponse {
    name: String,
    connector: ConnectorStatusDetail,
    tasks: Vec<TaskStatusDetail>,
    #[serde(rename = "type")]
    type_name: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ConnectorStatusDetail {
    state: String,
    worker_id: String,
    trace: Option<String>,
}

#[derive(Debug, Deserialize)]
struct TaskStatusDetail {
    id: i32,
    state: String,
    worker_id: String,
    trace: Option<String>,
}

/// Full connector details from GET /connectors/{name}.
#[derive(Debug, Deserialize)]
struct ConnectorDetailResponse {
    name: String,
    config: HashMap<String, String>,
    tasks: Vec<TaskIdResponse>,
    #[serde(rename = "type")]
    type_name: Option<String>,
}

#[derive(Debug, Deserialize)]
struct TaskIdResponse {
    connector: String,
    task: i32,
}

/// Validation result for a connector config.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConfigValidationResult {
    pub name: String,
    pub error_count: i32,
    pub configs: Vec<ConfigValidationEntry>,
}

/// A single config entry validation result.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConfigValidationEntry {
    pub name: String,
    pub value: Option<String>,
    pub recommended_values: Vec<String>,
    pub errors: Vec<String>,
    pub visible: bool,
}

#[derive(Debug, Deserialize)]
struct ValidationResponse {
    name: String,
    error_count: i32,
    configs: Vec<ValidationConfigEntry>,
}

#[derive(Debug, Deserialize)]
struct ValidationConfigEntry {
    definition: ValidationConfigDefinition,
    value: ValidationConfigValue,
}

#[derive(Debug, Deserialize)]
struct ValidationConfigDefinition {
    name: String,
}

#[derive(Debug, Deserialize)]
struct ValidationConfigValue {
    name: String,
    value: Option<String>,
    recommended_values: Vec<String>,
    errors: Vec<String>,
    visible: bool,
}

/// Plugin info from the Connect worker.
#[derive(Debug, Deserialize)]
struct PluginResponse {
    class: String,
    #[serde(rename = "type")]
    type_name: Option<String>,
    version: Option<String>,
}

impl KafkaConnectClient {
    /// Create a new Kafka Connect client.
    pub fn new(base_url: &str) -> Self {
        let url = base_url.trim_end_matches('/').to_string();
        Self {
            client: Client::new(),
            base_url: url,
            auth: None,
        }
    }

    /// Create a new Kafka Connect client with basic authentication.
    pub fn with_auth(base_url: &str, username: &str, password: &str) -> Self {
        let url = base_url.trim_end_matches('/').to_string();
        Self {
            client: Client::new(),
            base_url: url,
            auth: Some((username.to_string(), password.to_string())),
        }
    }

    fn request(&self, method: reqwest::Method, path: &str) -> reqwest::RequestBuilder {
        let url = format!("{}{}", self.base_url, path);
        let mut req = self.client.request(method, &url);
        req = req.header("Content-Type", "application/json");
        req = req.header("Accept", "application/json");
        if let Some((ref user, ref pass)) = self.auth {
            req = req.basic_auth(user, Some(pass));
        }
        req
    }

    /// List all connector names.
    pub async fn list_connectors(&self) -> KafkaResult<Vec<String>> {
        let resp = self
            .request(reqwest::Method::GET, "/connectors")
            .send()
            .await
            .map_err(|e| KafkaError::connect_error(format!("Request failed: {}", e)))?;

        if !resp.status().is_success() {
            return Err(KafkaError::connect_error(format!(
                "List connectors failed with status: {}",
                resp.status()
            )));
        }

        resp.json::<Vec<String>>()
            .await
            .map_err(|e| KafkaError::connect_error(format!("Parse error: {}", e)))
    }

    /// Get detailed information about a connector, including its status.
    pub async fn get_connector(&self, name: &str) -> KafkaResult<ConnectorInfo> {
        let detail = self.get_connector_detail(name).await?;
        let status = self.get_connector_status(name).await?;

        let type_name = detail
            .type_name
            .as_deref()
            .or(status.type_name.as_deref())
            .map(|t| match t.to_lowercase().as_str() {
                "source" => ConnectorType::Source,
                _ => ConnectorType::Sink,
            });

        let tasks: Vec<TaskInfo> = status
            .tasks
            .iter()
            .map(|t| TaskInfo {
                id: t.id,
                state: ConnectorState::from_str_loose(&t.state),
                worker_id: Some(t.worker_id.clone()),
                trace: t.trace.clone(),
            })
            .collect();

        Ok(ConnectorInfo {
            name: detail.name,
            type_name,
            state: ConnectorState::from_str_loose(&status.connector.state),
            worker_id: Some(status.connector.worker_id),
            config: detail.config,
            tasks,
            trace: status.connector.trace,
        })
    }

    async fn get_connector_detail(&self, name: &str) -> KafkaResult<ConnectorDetailResponse> {
        let path = format!("/connectors/{}", name);
        let resp = self
            .request(reqwest::Method::GET, &path)
            .send()
            .await
            .map_err(|e| KafkaError::connect_error(format!("Request failed: {}", e)))?;

        if !resp.status().is_success() {
            return Err(KafkaError::connect_error(format!(
                "Get connector '{}' failed with status: {}",
                name,
                resp.status()
            )));
        }

        resp.json::<ConnectorDetailResponse>()
            .await
            .map_err(|e| KafkaError::connect_error(format!("Parse error: {}", e)))
    }

    /// Create a new connector.
    pub async fn create_connector(
        &self,
        name: &str,
        config: HashMap<String, String>,
    ) -> KafkaResult<ConnectorInfo> {
        let mut body = HashMap::new();
        body.insert("name".to_string(), serde_json::Value::String(name.to_string()));
        body.insert(
            "config".to_string(),
            serde_json::to_value(&config)
                .map_err(|e| KafkaError::connect_error(format!("Serialize error: {}", e)))?,
        );

        let resp = self
            .request(reqwest::Method::POST, "/connectors")
            .json(&body)
            .send()
            .await
            .map_err(|e| KafkaError::connect_error(format!("Request failed: {}", e)))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(KafkaError::connect_error(format!(
                "Create connector failed ({}): {}",
                status, text
            )));
        }

        log::info!("Created connector '{}'", name);
        self.get_connector(name).await
    }

    /// Update the config of an existing connector (PUT).
    pub async fn update_connector(
        &self,
        name: &str,
        config: HashMap<String, String>,
    ) -> KafkaResult<ConnectorInfo> {
        let path = format!("/connectors/{}/config", name);
        let resp = self
            .request(reqwest::Method::PUT, &path)
            .json(&config)
            .send()
            .await
            .map_err(|e| KafkaError::connect_error(format!("Request failed: {}", e)))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(KafkaError::connect_error(format!(
                "Update connector '{}' failed ({}): {}",
                name, status, text
            )));
        }

        log::info!("Updated connector '{}'", name);
        self.get_connector(name).await
    }

    /// Delete a connector.
    pub async fn delete_connector(&self, name: &str) -> KafkaResult<()> {
        let path = format!("/connectors/{}", name);
        let resp = self
            .request(reqwest::Method::DELETE, &path)
            .send()
            .await
            .map_err(|e| KafkaError::connect_error(format!("Request failed: {}", e)))?;

        if !resp.status().is_success() {
            return Err(KafkaError::connect_error(format!(
                "Delete connector '{}' failed with status: {}",
                name,
                resp.status()
            )));
        }

        log::info!("Deleted connector '{}'", name);
        Ok(())
    }

    /// Pause a connector.
    pub async fn pause_connector(&self, name: &str) -> KafkaResult<()> {
        let path = format!("/connectors/{}/pause", name);
        let resp = self
            .request(reqwest::Method::PUT, &path)
            .send()
            .await
            .map_err(|e| KafkaError::connect_error(format!("Request failed: {}", e)))?;

        if !resp.status().is_success() {
            return Err(KafkaError::connect_error(format!(
                "Pause connector '{}' failed with status: {}",
                name,
                resp.status()
            )));
        }

        Ok(())
    }

    /// Resume a paused connector.
    pub async fn resume_connector(&self, name: &str) -> KafkaResult<()> {
        let path = format!("/connectors/{}/resume", name);
        let resp = self
            .request(reqwest::Method::PUT, &path)
            .send()
            .await
            .map_err(|e| KafkaError::connect_error(format!("Request failed: {}", e)))?;

        if !resp.status().is_success() {
            return Err(KafkaError::connect_error(format!(
                "Resume connector '{}' failed with status: {}",
                name,
                resp.status()
            )));
        }

        Ok(())
    }

    /// Restart a connector.
    pub async fn restart_connector(
        &self,
        name: &str,
        include_tasks: bool,
        only_failed: bool,
    ) -> KafkaResult<()> {
        let path = format!(
            "/connectors/{}/restart?includeTasks={}&onlyFailed={}",
            name, include_tasks, only_failed
        );
        let resp = self
            .request(reqwest::Method::POST, &path)
            .send()
            .await
            .map_err(|e| KafkaError::connect_error(format!("Request failed: {}", e)))?;

        if !resp.status().is_success() {
            return Err(KafkaError::connect_error(format!(
                "Restart connector '{}' failed with status: {}",
                name,
                resp.status()
            )));
        }

        log::info!("Restarted connector '{}'", name);
        Ok(())
    }

    /// Get the status of a connector and its tasks.
    pub async fn get_connector_status(
        &self,
        name: &str,
    ) -> KafkaResult<ConnectorStatusResponse> {
        let path = format!("/connectors/{}/status", name);
        let resp = self
            .request(reqwest::Method::GET, &path)
            .send()
            .await
            .map_err(|e| KafkaError::connect_error(format!("Request failed: {}", e)))?;

        if !resp.status().is_success() {
            return Err(KafkaError::connect_error(format!(
                "Get connector status '{}' failed with status: {}",
                name,
                resp.status()
            )));
        }

        resp.json::<ConnectorStatusResponse>()
            .await
            .map_err(|e| KafkaError::connect_error(format!("Parse error: {}", e)))
    }

    /// List tasks for a connector.
    pub async fn list_tasks(&self, connector_name: &str) -> KafkaResult<Vec<TaskInfo>> {
        let status = self.get_connector_status(connector_name).await?;
        Ok(status
            .tasks
            .iter()
            .map(|t| TaskInfo {
                id: t.id,
                state: ConnectorState::from_str_loose(&t.state),
                worker_id: Some(t.worker_id.clone()),
                trace: t.trace.clone(),
            })
            .collect())
    }

    /// Restart a specific task of a connector.
    pub async fn restart_task(&self, connector_name: &str, task_id: i32) -> KafkaResult<()> {
        let path = format!("/connectors/{}/tasks/{}/restart", connector_name, task_id);
        let resp = self
            .request(reqwest::Method::POST, &path)
            .send()
            .await
            .map_err(|e| KafkaError::connect_error(format!("Request failed: {}", e)))?;

        if !resp.status().is_success() {
            return Err(KafkaError::connect_error(format!(
                "Restart task {}/{} failed with status: {}",
                connector_name,
                task_id,
                resp.status()
            )));
        }

        log::info!("Restarted task {}/{}", connector_name, task_id);
        Ok(())
    }

    /// List available connector plugins.
    pub async fn list_plugins(&self) -> KafkaResult<Vec<ConnectorPlugin>> {
        let resp = self
            .request(reqwest::Method::GET, "/connector-plugins")
            .send()
            .await
            .map_err(|e| KafkaError::connect_error(format!("Request failed: {}", e)))?;

        if !resp.status().is_success() {
            return Err(KafkaError::connect_error(format!(
                "List plugins failed with status: {}",
                resp.status()
            )));
        }

        let plugins: Vec<PluginResponse> = resp
            .json()
            .await
            .map_err(|e| KafkaError::connect_error(format!("Parse error: {}", e)))?;

        Ok(plugins
            .into_iter()
            .map(|p| {
                let type_name = p.type_name.as_deref().map(|t| match t.to_lowercase().as_str() {
                    "source" => ConnectorType::Source,
                    _ => ConnectorType::Sink,
                });
                ConnectorPlugin {
                    class_name: p.class,
                    type_name,
                    version: p.version,
                }
            })
            .collect())
    }

    /// Validate a connector configuration against the plugin.
    pub async fn validate_config(
        &self,
        plugin_name: &str,
        config: &HashMap<String, String>,
    ) -> KafkaResult<ConfigValidationResult> {
        let path = format!("/connector-plugins/{}/config/validate", plugin_name);
        let resp = self
            .request(reqwest::Method::PUT, &path)
            .json(config)
            .send()
            .await
            .map_err(|e| KafkaError::connect_error(format!("Request failed: {}", e)))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(KafkaError::connect_error(format!(
                "Validate config failed ({}): {}",
                status, text
            )));
        }

        let validation: ValidationResponse = resp
            .json()
            .await
            .map_err(|e| KafkaError::connect_error(format!("Parse error: {}", e)))?;

        Ok(ConfigValidationResult {
            name: validation.name,
            error_count: validation.error_count,
            configs: validation
                .configs
                .into_iter()
                .map(|c| ConfigValidationEntry {
                    name: c.value.name,
                    value: c.value.value,
                    recommended_values: c.value.recommended_values,
                    errors: c.value.errors,
                    visible: c.value.visible,
                })
                .collect(),
        })
    }

    /// Get the Connect worker version and cluster info.
    pub async fn get_cluster_info(&self) -> KafkaResult<HashMap<String, String>> {
        let resp = self
            .request(reqwest::Method::GET, "/")
            .send()
            .await
            .map_err(|e| KafkaError::connect_error(format!("Request failed: {}", e)))?;

        if !resp.status().is_success() {
            return Err(KafkaError::connect_error(format!(
                "Get cluster info failed with status: {}",
                resp.status()
            )));
        }

        resp.json::<HashMap<String, String>>()
            .await
            .map_err(|e| KafkaError::connect_error(format!("Parse error: {}", e)))
    }
}
