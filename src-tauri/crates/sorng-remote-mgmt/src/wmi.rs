use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;
use uuid::Uuid;

pub type WmiServiceState = Arc<Mutex<WmiService>>;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WmiConnectionConfig {
    pub host: String,
    pub username: Option<String>,
    pub password: Option<String>,
    pub domain: Option<String>,
    pub namespace: Option<String>,
    pub timeout: Option<u64>,
    pub use_ssl: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WmiSession {
    pub id: String,
    pub host: String,
    pub connected_at: DateTime<Utc>,
    pub namespace: String,
    pub authenticated: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WmiQueryResult {
    pub columns: Vec<String>,
    pub rows: Vec<Vec<String>>,
    pub execution_time_ms: u64,
}

pub struct WmiService {
    sessions: HashMap<String, WmiSession>,
    configs: HashMap<String, WmiConnectionConfig>,
}

impl WmiService {
    pub fn new() -> WmiServiceState {
        Arc::new(Mutex::new(WmiService {
            sessions: HashMap::new(),
            configs: HashMap::new(),
        }))
    }

    pub async fn connect_wmi(&mut self, config: WmiConnectionConfig) -> Result<String, String> {
        let session_id = Uuid::new_v4().to_string();

        let session = WmiSession {
            id: session_id.clone(),
            host: config.host.clone(),
            connected_at: Utc::now(),
            namespace: config
                .namespace
                .clone()
                .unwrap_or_else(|| "root\\cimv2".to_string()),
            authenticated: config.username.is_some(),
        };

        self.configs.insert(session_id.clone(), config);
        self.sessions.insert(session_id.clone(), session);
        Ok(session_id)
    }

    pub async fn disconnect_wmi(&mut self, session_id: &str) -> Result<(), String> {
        self.configs.remove(session_id);
        if self.sessions.remove(session_id).is_some() {
            Ok(())
        } else {
            Err(format!("WMI session {} not found", session_id))
        }
    }

    pub async fn execute_wmi_query(
        &self,
        session_id: &str,
        query: String,
    ) -> Result<WmiQueryResult, String> {
        let session = self
            .sessions
            .get(session_id)
            .ok_or_else(|| format!("WMI session {} not found", session_id))?;

        let config = self
            .configs
            .get(session_id)
            .ok_or_else(|| format!("WMI config for session {} not found", session_id))?;

        let start_time = std::time::Instant::now();

        let cred_prefix = build_credential_prefix(config)?;
        let computer_args = build_computer_args(config, &session.host)?;
        let ps_command = format!(
            "{}Get-WmiObject -Query '{}' -Namespace '{}'{} | ConvertTo-Json -Depth 5 -Compress",
            cred_prefix,
            escape_ps_string(&query)?,
            escape_ps_string(&session.namespace)?,
            computer_args,
        );

        let output = run_powershell(&ps_command).await?;
        let execution_time = start_time.elapsed().as_millis() as u64;

        parse_wmi_json_output(&output, execution_time)
    }

    pub async fn get_wmi_session(&self, session_id: &str) -> Option<WmiSession> {
        self.sessions.get(session_id).cloned()
    }

    pub async fn list_wmi_sessions(&self) -> Vec<WmiSession> {
        self.sessions.values().cloned().collect()
    }

    pub async fn get_wmi_classes(
        &self,
        session_id: &str,
        namespace: Option<String>,
    ) -> Result<Vec<String>, String> {
        let session = self
            .sessions
            .get(session_id)
            .ok_or_else(|| format!("WMI session {} not found", session_id))?;

        let config = self
            .configs
            .get(session_id)
            .ok_or_else(|| format!("WMI config for session {} not found", session_id))?;

        let ns = namespace.as_deref().unwrap_or(&session.namespace);
        let cred_prefix = build_credential_prefix(config)?;
        let computer_args = build_computer_args(config, &session.host)?;
        let ps_command = format!(
            "{}Get-WmiObject -List -Namespace '{}'{} | Select-Object -ExpandProperty Name | ConvertTo-Json -Compress",
            cred_prefix,
            escape_ps_string(ns)?,
            computer_args,
        );

        let output = run_powershell(&ps_command).await?;
        let trimmed = output.trim();

        if trimmed.is_empty() {
            return Ok(Vec::new());
        }

        serde_json::from_str(trimmed)
            .map_err(|e| format!("Failed to parse WMI classes list: {}", e))
    }

    pub async fn get_wmi_namespaces(&self, session_id: &str) -> Result<Vec<String>, String> {
        let session = self
            .sessions
            .get(session_id)
            .ok_or_else(|| format!("WMI session {} not found", session_id))?;

        let config = self
            .configs
            .get(session_id)
            .ok_or_else(|| format!("WMI config for session {} not found", session_id))?;

        let cred_prefix = build_credential_prefix(config)?;
        let computer_args = build_computer_args(config, &session.host)?;
        let ps_command = format!(
            "{}Get-WmiObject -Namespace 'root' -Class __NAMESPACE{} | Select-Object -ExpandProperty Name | ConvertTo-Json -Compress",
            cred_prefix,
            computer_args,
        );

        let output = run_powershell(&ps_command).await?;
        let trimmed = output.trim();

        if trimmed.is_empty() {
            return Ok(Vec::new());
        }

        let names: Vec<String> = serde_json::from_str(trimmed)
            .map_err(|e| format!("Failed to parse WMI namespaces: {}", e))?;

        Ok(names.into_iter().map(|n| format!("root\\{}", n)).collect())
    }
}

// ── PowerShell helpers ──────────────────────────────────────────────────

fn escape_ps_string(s: &str) -> Result<String, String> {
    // Reject control characters and dangerous PowerShell metacharacters
    for c in s.chars() {
        if c.is_control() && c != '\t' {
            return Err(format!("Input contains control character: U+{:04X}", c as u32));
        }
        if matches!(c, '$' | '`' | ';' | '|' | '{' | '}' | '(' | ')') {
            return Err(format!("Input contains dangerous character: '{}'", c));
        }
    }
    Ok(s.replace('\'', "''"))
}

fn is_local_host(host: &str) -> bool {
    host == "localhost" || host == "127.0.0.1" || host == "::1" || host == "."
}

fn build_credential_prefix(config: &WmiConnectionConfig) -> Result<String, String> {
    match (&config.username, &config.password) {
        (Some(username), Some(password)) => {
            let full_user = if let Some(domain) = &config.domain {
                format!("{}\\{}", domain, username)
            } else {
                username.clone()
            };
            Ok(format!(
                "$__secpw = ConvertTo-SecureString '{}' -AsPlainText -Force; $__cred = New-Object System.Management.Automation.PSCredential('{}', $__secpw); ",
                escape_ps_string(password)?,
                escape_ps_string(&full_user)?,
            ))
        }
        _ => Ok(String::new()),
    }
}

fn build_computer_args(config: &WmiConnectionConfig, host: &str) -> Result<String, String> {
    if is_local_host(host) {
        return Ok(String::new());
    }
    let mut args = format!(" -ComputerName '{}'", escape_ps_string(host)?);
    if config.username.is_some() && config.password.is_some() {
        args.push_str(" -Credential $__cred");
    }
    Ok(args)
}

fn parse_wmi_json_output(output: &str, execution_time_ms: u64) -> Result<WmiQueryResult, String> {
    let trimmed = output.trim();
    if trimmed.is_empty() {
        return Ok(WmiQueryResult {
            columns: Vec::new(),
            rows: Vec::new(),
            execution_time_ms,
        });
    }

    let value: serde_json::Value = serde_json::from_str(trimmed)
        .map_err(|e| format!("Failed to parse WMI JSON output: {}", e))?;

    let objects = match &value {
        serde_json::Value::Array(arr) => arr.clone(),
        serde_json::Value::Object(_) => vec![value],
        _ => return Err("Unexpected WMI output format".to_string()),
    };

    if objects.is_empty() {
        return Ok(WmiQueryResult {
            columns: Vec::new(),
            rows: Vec::new(),
            execution_time_ms,
        });
    }

    let columns: Vec<String> = objects[0]
        .as_object()
        .map(|obj| obj.keys().cloned().collect())
        .unwrap_or_default();

    let rows: Vec<Vec<String>> = objects
        .iter()
        .map(|obj| {
            columns
                .iter()
                .map(|col| {
                    obj.get(col)
                        .map(|v| match v {
                            serde_json::Value::String(s) => s.clone(),
                            serde_json::Value::Null => String::new(),
                            other => other.to_string(),
                        })
                        .unwrap_or_default()
                })
                .collect()
        })
        .collect();

    Ok(WmiQueryResult {
        columns,
        rows,
        execution_time_ms,
    })
}

#[cfg(target_os = "windows")]
async fn run_powershell(command: &str) -> Result<String, String> {
    let output = tokio::process::Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", command])
        .output()
        .await
        .map_err(|e| format!("Failed to execute PowerShell: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("PowerShell command failed: {}", stderr.trim()));
    }

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

#[cfg(not(target_os = "windows"))]
async fn run_powershell(_command: &str) -> Result<String, String> {
    Err("WMI queries require Windows with PowerShell".to_string())
}
