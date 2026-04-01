use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;
use uuid::Uuid;

pub type AgentServiceState = Arc<Mutex<AgentService>>;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentConnectionConfig {
    pub host: String,
    pub port: u16,
    pub agent_type: AgentType,
    pub auth_token: Option<String>,
    pub api_key: Option<String>,
    pub timeout: Option<u64>,
    pub use_ssl: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum AgentType {
    Monitoring,
    LogCollector,
    MetricExporter,
    Custom(String),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentSession {
    pub id: String,
    pub host: String,
    pub port: u16,
    pub agent_type: AgentType,
    pub connected_at: DateTime<Utc>,
    pub authenticated: bool,
    pub status: AgentStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum AgentStatus {
    Connected,
    Disconnected,
    Error(String),
    Collecting,
    Idle,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentMetrics {
    pub timestamp: DateTime<Utc>,
    pub cpu_usage: Option<f64>,
    pub memory_usage: Option<f64>,
    pub disk_usage: Option<f64>,
    pub network_rx: Option<u64>,
    pub network_tx: Option<u64>,
    pub custom_metrics: HashMap<String, serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentLogEntry {
    pub timestamp: DateTime<Utc>,
    pub level: String,
    pub message: String,
    pub source: String,
    pub metadata: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentCommand {
    pub command: String,
    pub parameters: Option<serde_json::Value>,
    pub timeout: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentCommandResult {
    pub command_id: String,
    pub success: bool,
    pub output: Option<String>,
    pub error: Option<String>,
    pub execution_time_ms: u64,
}

pub struct AgentService {
    sessions: HashMap<String, AgentSession>,
    configs: HashMap<String, AgentConnectionConfig>,
    client: reqwest::Client,
}

impl AgentService {
    pub fn new() -> AgentServiceState {
        Arc::new(Mutex::new(AgentService {
            sessions: HashMap::new(),
            configs: HashMap::new(),
            client: reqwest::Client::new(),
        }))
    }

    fn build_base_url(&self, config: &AgentConnectionConfig) -> String {
        let scheme = if config.use_ssl { "https" } else { "http" };
        format!("{}://{}:{}", scheme, config.host, config.port)
    }

    fn apply_auth(
        &self,
        builder: reqwest::RequestBuilder,
        config: &AgentConnectionConfig,
    ) -> reqwest::RequestBuilder {
        if let Some(token) = &config.auth_token {
            builder.bearer_auth(token)
        } else if let Some(key) = &config.api_key {
            builder.header("X-API-Key", key.as_str())
        } else {
            builder
        }
    }

    pub async fn connect_agent(&mut self, config: AgentConnectionConfig) -> Result<String, String> {
        let session_id = Uuid::new_v4().to_string();

        let session = AgentSession {
            id: session_id.clone(),
            host: config.host.clone(),
            port: config.port,
            agent_type: config.agent_type.clone(),
            connected_at: Utc::now(),
            authenticated: config.auth_token.is_some() || config.api_key.is_some(),
            status: AgentStatus::Connected,
        };

        self.configs.insert(session_id.clone(), config);
        self.sessions.insert(session_id.clone(), session);
        Ok(session_id)
    }

    pub async fn disconnect_agent(&mut self, session_id: &str) -> Result<(), String> {
        if let Some(session) = self.sessions.get_mut(session_id) {
            session.status = AgentStatus::Disconnected;
            Ok(())
        } else {
            Err(format!("Agent session {} not found", session_id))
        }
    }

    pub async fn get_agent_metrics(&self, session_id: &str) -> Result<AgentMetrics, String> {
        let session = self
            .sessions
            .get(session_id)
            .ok_or_else(|| format!("Agent session {} not found", session_id))?;

        if !matches!(&session.status, AgentStatus::Connected) {
            return Err(format!("Agent session {} is not connected", session_id));
        }

        let config = self
            .configs
            .get(session_id)
            .ok_or_else(|| format!("Agent config for session {} not found", session_id))?;

        let url = format!("{}/api/metrics", self.build_base_url(config));
        let mut builder = self.client.get(&url);
        builder = self.apply_auth(builder, config);

        if let Some(timeout_ms) = config.timeout {
            builder = builder.timeout(std::time::Duration::from_millis(timeout_ms));
        }

        let resp = builder
            .send()
            .await
            .map_err(|e| format!("Failed to fetch agent metrics: {}", e))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(format!("Agent metrics HTTP error {}: {}", status, body));
        }

        resp.json::<AgentMetrics>()
            .await
            .map_err(|e| format!("Failed to parse agent metrics: {}", e))
    }

    pub async fn get_agent_logs(
        &self,
        session_id: &str,
        limit: Option<usize>,
    ) -> Result<Vec<AgentLogEntry>, String> {
        let session = self
            .sessions
            .get(session_id)
            .ok_or_else(|| format!("Agent session {} not found", session_id))?;

        if !matches!(&session.status, AgentStatus::Connected) {
            return Err(format!("Agent session {} is not connected", session_id));
        }

        let config = self
            .configs
            .get(session_id)
            .ok_or_else(|| format!("Agent config for session {} not found", session_id))?;

        let limit = limit.unwrap_or(100);
        let url = format!("{}/api/logs?limit={}", self.build_base_url(config), limit);
        let mut builder = self.client.get(&url);
        builder = self.apply_auth(builder, config);

        if let Some(timeout_ms) = config.timeout {
            builder = builder.timeout(std::time::Duration::from_millis(timeout_ms));
        }

        let resp = builder
            .send()
            .await
            .map_err(|e| format!("Failed to fetch agent logs: {}", e))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(format!("Agent logs HTTP error {}: {}", status, body));
        }

        resp.json::<Vec<AgentLogEntry>>()
            .await
            .map_err(|e| format!("Failed to parse agent logs: {}", e))
    }

    pub async fn execute_agent_command(
        &self,
        session_id: &str,
        command: AgentCommand,
    ) -> Result<String, String> {
        let session = self
            .sessions
            .get(session_id)
            .ok_or_else(|| format!("Agent session {} not found", session_id))?;

        if !matches!(&session.status, AgentStatus::Connected) {
            return Err(format!("Agent session {} is not connected", session_id));
        }

        let config = self
            .configs
            .get(session_id)
            .ok_or_else(|| format!("Agent config for session {} not found", session_id))?;

        let url = format!("{}/api/commands", self.build_base_url(config));
        let mut builder = self.client.post(&url).json(&command);
        builder = self.apply_auth(builder, config);

        if let Some(timeout_ms) = config.timeout {
            builder = builder.timeout(std::time::Duration::from_millis(timeout_ms));
        }

        let resp = builder
            .send()
            .await
            .map_err(|e| format!("Failed to execute agent command: {}", e))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(format!("Agent command HTTP error {}: {}", status, body));
        }

        #[derive(Deserialize)]
        struct CommandResponse {
            command_id: String,
        }

        let parsed: CommandResponse = resp
            .json()
            .await
            .map_err(|e| format!("Failed to parse command response: {}", e))?;

        Ok(parsed.command_id)
    }

    pub async fn get_agent_command_result(
        &self,
        session_id: &str,
        command_id: &str,
    ) -> Result<AgentCommandResult, String> {
        let session = self
            .sessions
            .get(session_id)
            .ok_or_else(|| format!("Agent session {} not found", session_id))?;

        if !matches!(&session.status, AgentStatus::Connected) {
            return Err(format!("Agent session {} is not connected", session_id));
        }

        let config = self
            .configs
            .get(session_id)
            .ok_or_else(|| format!("Agent config for session {} not found", session_id))?;

        let url = format!(
            "{}/api/commands/{}",
            self.build_base_url(config),
            command_id
        );
        let mut builder = self.client.get(&url);
        builder = self.apply_auth(builder, config);

        if let Some(timeout_ms) = config.timeout {
            builder = builder.timeout(std::time::Duration::from_millis(timeout_ms));
        }

        let resp = builder
            .send()
            .await
            .map_err(|e| format!("Failed to fetch command result: {}", e))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(format!(
                "Agent command result HTTP error {}: {}",
                status, body
            ));
        }

        resp.json::<AgentCommandResult>()
            .await
            .map_err(|e| format!("Failed to parse command result: {}", e))
    }

    pub async fn get_agent_session(&self, session_id: &str) -> Option<AgentSession> {
        self.sessions.get(session_id).cloned()
    }

    pub async fn list_agent_sessions(&self) -> Vec<AgentSession> {
        self.sessions.values().cloned().collect()
    }

    pub async fn update_agent_status(
        &mut self,
        session_id: &str,
        status: AgentStatus,
    ) -> Result<(), String> {
        if let Some(session) = self.sessions.get_mut(session_id) {
            session.status = status;
            Ok(())
        } else {
            Err(format!("Agent session {} not found", session_id))
        }
    }

    pub async fn get_agent_info(&self, session_id: &str) -> Result<serde_json::Value, String> {
        let _session = self
            .sessions
            .get(session_id)
            .ok_or_else(|| format!("Agent session {} not found", session_id))?;

        let config = self
            .configs
            .get(session_id)
            .ok_or_else(|| format!("Agent config for session {} not found", session_id))?;

        let url = format!("{}/api/info", self.build_base_url(config));
        let mut builder = self.client.get(&url);
        builder = self.apply_auth(builder, config);

        if let Some(timeout_ms) = config.timeout {
            builder = builder.timeout(std::time::Duration::from_millis(timeout_ms));
        }

        let resp = builder
            .send()
            .await
            .map_err(|e| format!("Failed to fetch agent info: {}", e))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(format!("Agent info HTTP error {}: {}", status, body));
        }

        resp.json::<serde_json::Value>()
            .await
            .map_err(|e| format!("Failed to parse agent info: {}", e))
    }
}
