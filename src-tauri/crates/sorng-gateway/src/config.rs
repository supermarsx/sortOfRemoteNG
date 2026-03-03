//! # Gateway Configuration
//!
//! Configuration structures for the gateway, supporting TOML and JSON
//! config files for headless mode operation.

use crate::types::TlsConfig;
use crate::letsencrypt_bridge::GatewayLetsEncryptConfig;
use serde::{Deserialize, Serialize};

/// Complete gateway configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GatewayConfig {
    /// Gateway display name
    pub name: String,
    /// Host to listen on (e.g., "0.0.0.0")
    pub listen_host: String,
    /// Primary port for the management/admin API
    pub listen_port: u16,
    /// Port range start for dynamic proxy listeners
    pub proxy_port_range_start: u16,
    /// Port range end for dynamic proxy listeners
    pub proxy_port_range_end: u16,
    /// Data directory for persistence
    pub data_dir: String,
    /// Log directory
    pub log_dir: String,
    /// Log level ("debug", "info", "warn", "error")
    pub log_level: String,
    /// Whether running in headless mode (no GUI)
    pub headless: bool,
    /// Whether session recording is enabled globally
    pub recording_enabled: bool,
    /// TLS configuration
    pub tls: TlsConfig,
    /// Maximum total concurrent sessions
    pub max_total_sessions: u32,
    /// Maximum concurrent sessions per user
    pub max_sessions_per_user: u32,
    /// Session idle timeout in seconds (0 = disabled)
    pub idle_timeout_secs: u64,
    /// Maximum session duration in seconds (0 = unlimited)
    pub max_session_duration_secs: u64,
    /// Admin API authentication required
    pub admin_api_auth_required: bool,
    /// Enable health check endpoint
    pub health_check_enabled: bool,
    /// Health check endpoint path
    pub health_check_path: String,
    /// Enable metrics endpoint
    pub metrics_enabled: bool,
    /// Metrics endpoint path
    pub metrics_path: String,
    /// CORS allowed origins (for management API)
    pub cors_origins: Vec<String>,
    /// Let's Encrypt auto-TLS configuration
    pub letsencrypt: GatewayLetsEncryptConfig,
}

impl GatewayConfig {
    /// Create a default configuration with a specific data directory.
    pub fn default_with_dir(data_dir: String) -> Self {
        Self {
            name: "SortOfRemote NG Gateway".to_string(),
            listen_host: "127.0.0.1".to_string(),
            listen_port: 9080,
            proxy_port_range_start: 10000,
            proxy_port_range_end: 10999,
            data_dir: data_dir.clone(),
            log_dir: format!("{}/logs", data_dir),
            log_level: "info".to_string(),
            headless: false,
            recording_enabled: false,
            tls: TlsConfig::default(),
            max_total_sessions: 1000,
            max_sessions_per_user: 50,
            idle_timeout_secs: 3600,
            max_session_duration_secs: 0,
            admin_api_auth_required: true,
            health_check_enabled: true,
            health_check_path: "/health".to_string(),
            metrics_enabled: true,
            metrics_path: "/metrics".to_string(),
            cors_origins: vec!["http://localhost:3001".to_string()],
            letsencrypt: GatewayLetsEncryptConfig::default(),
        }
    }

    /// Load configuration from a TOML string.
    pub fn from_toml(toml_str: &str) -> Result<Self, String> {
        // Parse as JSON fallback since we depend on serde_json
        // In production, add `toml` crate dependency for native TOML support
        serde_json::from_str(toml_str)
            .map_err(|e| format!("Failed to parse config: {}", e))
    }

    /// Load configuration from a JSON string.
    pub fn from_json(json_str: &str) -> Result<Self, String> {
        serde_json::from_str(json_str)
            .map_err(|e| format!("Failed to parse config: {}", e))
    }

    /// Load configuration from a file path (auto-detects JSON).
    pub fn from_file(path: &str) -> Result<Self, String> {
        let content =
            std::fs::read_to_string(path).map_err(|e| format!("Failed to read config file: {}", e))?;

        Self::from_json(&content)
    }

    /// Save configuration to a JSON file.
    pub fn save_to_file(&self, path: &str) -> Result<(), String> {
        let json = serde_json::to_string_pretty(self)
            .map_err(|e| format!("Failed to serialize config: {}", e))?;
        std::fs::write(path, json).map_err(|e| format!("Failed to write config file: {}", e))
    }

    /// Validate the configuration for consistency.
    pub fn validate(&self) -> Result<(), Vec<String>> {
        let mut errors = Vec::new();

        if self.listen_port == 0 {
            errors.push("listen_port must be > 0".to_string());
        }
        if self.proxy_port_range_start >= self.proxy_port_range_end {
            errors.push("proxy_port_range_start must be < proxy_port_range_end".to_string());
        }
        if self.max_total_sessions == 0 {
            errors.push("max_total_sessions must be > 0".to_string());
        }
        if self.data_dir.is_empty() {
            errors.push("data_dir must not be empty".to_string());
        }
        if self.tls.enabled {
            if self.tls.cert_path.is_none() {
                errors.push("TLS enabled but cert_path is not set".to_string());
            }
            if self.tls.key_path.is_none() {
                errors.push("TLS enabled but key_path is not set".to_string());
            }
        }

        if errors.is_empty() {
            Ok(())
        } else {
            Err(errors)
        }
    }

    /// Generate a sample configuration JSON for documentation.
    pub fn sample_json() -> String {
        let sample = Self::default_with_dir("/var/lib/sorng-gateway".to_string());
        serde_json::to_string_pretty(&sample).unwrap_or_default()
    }
}

impl Default for GatewayConfig {
    fn default() -> Self {
        Self::default_with_dir("./gateway-data".to_string())
    }
}
