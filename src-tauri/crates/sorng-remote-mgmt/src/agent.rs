use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::net::IpAddr;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::Mutex;
use uuid::Uuid;
use zeroize::Zeroize;

const DEFAULT_REQUEST_TIMEOUT_MS: u64 = 10_000;
const MIN_REQUEST_TIMEOUT_MS: u64 = 50;
const MAX_REQUEST_TIMEOUT_MS: u64 = 60_000;
const MAX_AGENT_RESPONSE_BYTES: usize = 4 * 1024 * 1024;
const MAX_AGENT_COMMAND_BYTES: usize = 256 * 1024;
const MAX_AGENT_COMMAND_ID_BYTES: usize = 512;
const DEFAULT_AGENT_LOG_LIMIT: usize = 100;
const MAX_AGENT_LOG_LIMIT: usize = 1_000;
const MAX_AGENT_SESSIONS: usize = 64;

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

impl AgentConnectionConfig {
    fn zeroize_secrets(&mut self) {
        if let Some(token) = self.auth_token.as_mut() {
            token.zeroize();
        }
        if let Some(key) = self.api_key.as_mut() {
            key.zeroize();
        }
    }
}

impl Drop for AgentConnectionConfig {
    fn drop(&mut self) {
        self.zeroize_secrets();
    }
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
            client: reqwest::Client::builder()
                .redirect(reqwest::redirect::Policy::none())
                .timeout(Duration::from_millis(DEFAULT_REQUEST_TIMEOUT_MS))
                .build()
                .expect("static agent HTTP client configuration must be valid"),
        }))
    }

    fn validate_config(config: &AgentConnectionConfig) -> Result<(), String> {
        let host = config.host.as_str();
        if config.port == 0
            || host.is_empty()
            || host.len() > 253
            || host != host.trim()
            || !host.is_ascii()
            || host
                .chars()
                .any(|character| character.is_ascii_control() || "/\\?#@".contains(character))
        {
            return Err("Invalid agent endpoint configuration".to_string());
        }

        if config.auth_token.is_some() && config.api_key.is_some() {
            return Err("Configure only one agent authentication method".to_string());
        }
        if config
            .auth_token
            .as_ref()
            .is_some_and(|token| token.is_empty())
            || config.api_key.as_ref().is_some_and(|key| key.is_empty())
        {
            return Err("Agent credentials cannot be empty".to_string());
        }

        let bare_host = match (host.strip_prefix('['), host.strip_suffix(']')) {
            (Some(without_open), Some(_)) => without_open.strip_suffix(']').unwrap_or(without_open),
            (None, None) => host,
            _ => return Err("Invalid agent endpoint configuration".to_string()),
        };
        let parsed_ip = bare_host.parse::<IpAddr>().ok();
        if host.contains(':') && parsed_ip.is_none() {
            return Err("Invalid agent endpoint configuration".to_string());
        }

        if !config.use_ssl {
            if config.auth_token.is_some() || config.api_key.is_some() {
                return Err("Agent credentials require HTTPS".to_string());
            }
            let is_local = host.eq_ignore_ascii_case("localhost")
                || parsed_ip.is_some_and(|address| address.is_loopback());
            if !is_local {
                return Err(
                    "Plaintext agent connections are limited to unauthenticated local endpoints"
                        .to_string(),
                );
            }
        }

        Ok(())
    }

    fn build_base_url(&self, config: &AgentConnectionConfig) -> Result<reqwest::Url, String> {
        Self::validate_config(config)?;
        let scheme = if config.use_ssl { "https" } else { "http" };
        let bare_host = config
            .host
            .strip_prefix('[')
            .and_then(|host| host.strip_suffix(']'))
            .unwrap_or(&config.host);
        let formatted_host = match bare_host.parse::<IpAddr>() {
            Ok(IpAddr::V6(address)) => format!("[{address}]"),
            Ok(address) => address.to_string(),
            Err(_) => bare_host.to_string(),
        };
        reqwest::Url::parse(&format!("{scheme}://{formatted_host}:{}/", config.port))
            .map_err(|_| "Invalid agent endpoint configuration".to_string())
    }

    fn endpoint_url(
        &self,
        config: &AgentConnectionConfig,
        path_segments: &[&str],
    ) -> Result<reqwest::Url, String> {
        let mut url = self.build_base_url(config)?;
        {
            let mut segments = url
                .path_segments_mut()
                .map_err(|_| "Invalid agent endpoint configuration".to_string())?;
            segments.clear();
            for segment in path_segments {
                segments.push(segment);
            }
        }
        Ok(url)
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

    fn request_timeout(config: &AgentConnectionConfig) -> Duration {
        Duration::from_millis(
            config
                .timeout
                .unwrap_or(DEFAULT_REQUEST_TIMEOUT_MS)
                .clamp(MIN_REQUEST_TIMEOUT_MS, MAX_REQUEST_TIMEOUT_MS),
        )
    }

    fn apply_timeout(
        &self,
        builder: reqwest::RequestBuilder,
        config: &AgentConnectionConfig,
    ) -> reqwest::RequestBuilder {
        builder.timeout(Self::request_timeout(config))
    }

    fn transport_error(operation: &str, error: &reqwest::Error) -> String {
        if error.is_timeout() {
            format!("{operation} timed out")
        } else {
            format!("{operation} request failed")
        }
    }

    async fn send_bounded(
        &self,
        builder: reqwest::RequestBuilder,
        operation: &str,
    ) -> Result<Vec<u8>, String> {
        let mut response = builder
            .send()
            .await
            .map_err(|error| Self::transport_error(operation, &error))?;
        let status = response.status();

        if response
            .content_length()
            .is_some_and(|length| length > MAX_AGENT_RESPONSE_BYTES as u64)
        {
            return Err(format!("{operation} response exceeds the safety limit"));
        }

        let mut body = Vec::with_capacity(
            response
                .content_length()
                .unwrap_or(0)
                .min(MAX_AGENT_RESPONSE_BYTES as u64) as usize,
        );
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|error| Self::transport_error(operation, &error))?
        {
            let next_length = body
                .len()
                .checked_add(chunk.len())
                .ok_or_else(|| format!("{operation} response exceeds the safety limit"))?;
            if next_length > MAX_AGENT_RESPONSE_BYTES {
                return Err(format!("{operation} response exceeds the safety limit"));
            }
            body.extend_from_slice(&chunk);
        }

        if !status.is_success() {
            return Err(format!(
                "{operation} failed with HTTP status {}",
                status.as_u16()
            ));
        }
        Ok(body)
    }

    async fn get_bounded(
        &self,
        config: &AgentConnectionConfig,
        url: reqwest::Url,
        operation: &str,
    ) -> Result<Vec<u8>, String> {
        let builder = self.apply_timeout(self.apply_auth(self.client.get(url), config), config);
        self.send_bounded(builder, operation).await
    }

    pub async fn connect_agent(&mut self, config: AgentConnectionConfig) -> Result<String, String> {
        Self::validate_config(&config)?;
        if self.sessions.len() >= MAX_AGENT_SESSIONS {
            return Err(format!(
                "Agent session limit of {MAX_AGENT_SESSIONS} has been reached"
            ));
        }

        let probe_url = self.endpoint_url(&config, &["api", "info"])?;
        self.get_bounded(&config, probe_url, "Agent connection probe")
            .await?;

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
        let removed_session = self.sessions.remove(session_id);
        if let Some(mut config) = self.configs.remove(session_id) {
            config.zeroize_secrets();
        }
        if removed_session.is_some() {
            Ok(())
        } else {
            Err("Agent session not found".to_string())
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

        let url = self.endpoint_url(config, &["api", "metrics"])?;
        let body = self
            .get_bounded(config, url, "Agent metrics request")
            .await?;
        serde_json::from_slice::<AgentMetrics>(&body)
            .map_err(|_| "Agent metrics response was invalid".to_string())
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

        let limit = limit
            .unwrap_or(DEFAULT_AGENT_LOG_LIMIT)
            .clamp(1, MAX_AGENT_LOG_LIMIT);
        let mut url = self.endpoint_url(config, &["api", "logs"])?;
        url.query_pairs_mut()
            .append_pair("limit", &limit.to_string());
        let body = self.get_bounded(config, url, "Agent logs request").await?;
        let mut logs = serde_json::from_slice::<Vec<AgentLogEntry>>(&body)
            .map_err(|_| "Agent logs response was invalid".to_string())?;
        logs.truncate(limit);
        Ok(logs)
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

        let url = self.endpoint_url(config, &["api", "commands"])?;
        let command_body = serde_json::to_vec(&command)
            .map_err(|_| "Agent command could not be encoded".to_string())?;
        if command_body.len() > MAX_AGENT_COMMAND_BYTES {
            return Err("Agent command exceeds the safety limit".to_string());
        }
        let builder = self.apply_timeout(
            self.apply_auth(
                self.client
                    .post(url)
                    .header(reqwest::header::CONTENT_TYPE, "application/json")
                    .body(command_body),
                config,
            ),
            config,
        );
        let body = self.send_bounded(builder, "Agent command request").await?;

        #[derive(Deserialize)]
        struct CommandResponse {
            command_id: String,
        }

        let parsed: CommandResponse = serde_json::from_slice(&body)
            .map_err(|_| "Agent command response was invalid".to_string())?;
        if parsed.command_id.is_empty()
            || parsed.command_id.len() > MAX_AGENT_COMMAND_ID_BYTES
            || parsed.command_id.chars().any(char::is_control)
        {
            return Err("Agent command response was invalid".to_string());
        }

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

        if command_id.is_empty()
            || command_id.len() > MAX_AGENT_COMMAND_ID_BYTES
            || command_id.chars().any(char::is_control)
        {
            return Err("Invalid agent command identifier".to_string());
        }
        let url = self.endpoint_url(config, &["api", "commands", command_id])?;
        let body = self
            .get_bounded(config, url, "Agent command result request")
            .await?;
        serde_json::from_slice::<AgentCommandResult>(&body)
            .map_err(|_| "Agent command result response was invalid".to_string())
    }

    pub async fn get_agent_session(&self, session_id: &str) -> Option<AgentSession> {
        self.sessions.get(session_id).cloned()
    }

    pub async fn list_agent_sessions(&self) -> Vec<AgentSession> {
        let mut sessions: Vec<_> = self.sessions.values().cloned().collect();
        sessions.sort_by(|left, right| {
            left.connected_at
                .cmp(&right.connected_at)
                .then_with(|| left.id.cmp(&right.id))
        });
        sessions
    }

    pub async fn update_agent_status(
        &mut self,
        session_id: &str,
        status: AgentStatus,
    ) -> Result<(), String> {
        if matches!(&status, AgentStatus::Disconnected) {
            return self.disconnect_agent(session_id).await;
        }
        if let Some(session) = self.sessions.get_mut(session_id) {
            session.status = status;
            Ok(())
        } else {
            Err(format!("Agent session {} not found", session_id))
        }
    }

    pub async fn get_agent_info(&self, session_id: &str) -> Result<serde_json::Value, String> {
        let session = self
            .sessions
            .get(session_id)
            .ok_or_else(|| format!("Agent session {} not found", session_id))?;

        if !matches!(&session.status, AgentStatus::Connected) {
            return Err("Agent session is not connected".to_string());
        }

        let config = self
            .configs
            .get(session_id)
            .ok_or_else(|| format!("Agent config for session {} not found", session_id))?;

        let url = self.endpoint_url(config, &["api", "info"])?;
        let body = self.get_bounded(config, url, "Agent info request").await?;
        serde_json::from_slice::<serde_json::Value>(&body)
            .map_err(|_| "Agent info response was invalid".to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;
    use tokio::sync::oneshot;

    fn local_config(port: u16) -> AgentConnectionConfig {
        AgentConnectionConfig {
            host: "127.0.0.1".to_string(),
            port,
            agent_type: AgentType::Monitoring,
            auth_token: None,
            api_key: None,
            timeout: Some(500),
            use_ssl: false,
        }
    }

    fn bare_service() -> AgentService {
        AgentService {
            sessions: HashMap::new(),
            configs: HashMap::new(),
            client: reqwest::Client::builder()
                .redirect(reqwest::redirect::Policy::none())
                .timeout(Duration::from_millis(DEFAULT_REQUEST_TIMEOUT_MS))
                .build()
                .unwrap(),
        }
    }

    fn insert_connected_session(
        service: &mut AgentService,
        config: AgentConnectionConfig,
    ) -> String {
        let id = Uuid::new_v4().to_string();
        service.sessions.insert(
            id.clone(),
            AgentSession {
                id: id.clone(),
                host: config.host.clone(),
                port: config.port,
                agent_type: config.agent_type.clone(),
                connected_at: Utc::now(),
                authenticated: config.auth_token.is_some() || config.api_key.is_some(),
                status: AgentStatus::Connected,
            },
        );
        service.configs.insert(id.clone(), config);
        id
    }

    async fn spawn_mock(
        status: u16,
        body: Vec<u8>,
        advertised_length: Option<usize>,
        response_delay: Duration,
    ) -> (u16, oneshot::Receiver<String>) {
        let listener = TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let (request_tx, request_rx) = oneshot::channel();
        tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut request = Vec::new();
            let mut buffer = [0_u8; 1024];
            while !request.windows(4).any(|window| window == b"\r\n\r\n") {
                let read = stream.read(&mut buffer).await.unwrap();
                if read == 0 {
                    break;
                }
                request.extend_from_slice(&buffer[..read]);
            }
            let _ = request_tx.send(String::from_utf8_lossy(&request).into_owned());
            tokio::time::sleep(response_delay).await;
            let reason = if status == 200 { "OK" } else { "ERROR" };
            let length = advertised_length.unwrap_or(body.len());
            let headers = format!(
                "HTTP/1.1 {status} {reason}\r\nContent-Type: application/json\r\nContent-Length: {length}\r\nConnection: close\r\n\r\n"
            );
            let _ = stream.write_all(headers.as_bytes()).await;
            let _ = stream.write_all(&body).await;
        });
        (port, request_rx)
    }

    #[tokio::test]
    async fn plaintext_credentials_are_refused_before_network_access() {
        let mut service = bare_service();
        let mut config = local_config(9);
        config.auth_token = Some("must-not-travel".to_string());

        let error = service.connect_agent(config).await.unwrap_err();

        assert_eq!(error, "Agent credentials require HTTPS");
        assert!(service.sessions.is_empty());
        assert!(service.configs.is_empty());
    }

    #[tokio::test]
    async fn connect_probes_before_storing_the_session() {
        let (port, request) =
            spawn_mock(200, br#"{"agent":"ready"}"#.to_vec(), None, Duration::ZERO).await;
        let mut service = bare_service();

        let id = service.connect_agent(local_config(port)).await.unwrap();

        assert!(request.await.unwrap().starts_with("GET /api/info HTTP/1.1"));
        assert!(service.sessions.contains_key(&id));
        assert!(service.configs.contains_key(&id));
    }

    #[tokio::test]
    async fn oversized_success_and_error_bodies_are_rejected_before_parsing() {
        for status in [200, 500] {
            let (port, _request) = spawn_mock(
                status,
                Vec::new(),
                Some(MAX_AGENT_RESPONSE_BYTES + 1),
                Duration::ZERO,
            )
            .await;
            let mut service = bare_service();
            let id = insert_connected_session(&mut service, local_config(port));

            let error = service.get_agent_metrics(&id).await.unwrap_err();

            assert_eq!(
                error,
                "Agent metrics request response exceeds the safety limit"
            );
        }
    }

    #[tokio::test]
    async fn session_cap_refuses_new_connections_deterministically() {
        let mut service = bare_service();
        for index in 0..MAX_AGENT_SESSIONS {
            let id = format!("session-{index:03}");
            let config = local_config(9);
            service.sessions.insert(
                id.clone(),
                AgentSession {
                    id: id.clone(),
                    host: config.host.clone(),
                    port: config.port,
                    agent_type: AgentType::Monitoring,
                    connected_at: Utc::now(),
                    authenticated: false,
                    status: AgentStatus::Connected,
                },
            );
            service.configs.insert(id, config);
        }

        let error = service.connect_agent(local_config(9)).await.unwrap_err();

        assert_eq!(
            error,
            format!("Agent session limit of {MAX_AGENT_SESSIONS} has been reached")
        );
        assert_eq!(service.sessions.len(), MAX_AGENT_SESSIONS);
    }

    #[tokio::test]
    async fn disconnect_removes_session_and_erases_config_secrets() {
        let mut service = bare_service();
        let mut config = local_config(443);
        config.use_ssl = true;
        config.auth_token = Some("secret-token".to_string());
        let id = insert_connected_session(&mut service, config);

        service.disconnect_agent(&id).await.unwrap();

        assert!(!service.sessions.contains_key(&id));
        assert!(!service.configs.contains_key(&id));

        let mut erasure_probe = local_config(443);
        erasure_probe.auth_token = Some("secret-token".to_string());
        erasure_probe.api_key = Some("secret-key".to_string());
        erasure_probe.zeroize_secrets();
        assert_eq!(erasure_probe.auth_token.as_deref(), Some(""));
        assert_eq!(erasure_probe.api_key.as_deref(), Some(""));
    }

    #[tokio::test]
    async fn request_timeout_is_finite_and_error_is_opaque() {
        let (port, _request) = spawn_mock(
            200,
            br#"{"cpu_usage":null}"#.to_vec(),
            None,
            Duration::from_millis(250),
        )
        .await;
        let mut service = bare_service();
        let mut config = local_config(port);
        config.timeout = Some(MIN_REQUEST_TIMEOUT_MS);
        let id = insert_connected_session(&mut service, config);

        let error = service.get_agent_metrics(&id).await.unwrap_err();

        assert_eq!(error, "Agent metrics request timed out");
        assert!(!error.contains("127.0.0.1"));
        assert!(!error.contains("http://"));
    }
}
