use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::Mutex;
use uuid::Uuid;

const DEFAULT_WMI_TIMEOUT_SECS: u64 = 30;
const MAX_WMI_TIMEOUT_SECS: u64 = 120;
#[cfg(target_os = "windows")]
const MAX_WMI_INPUT_BYTES: usize = 128 * 1024;
#[cfg(target_os = "windows")]
const MAX_WMI_OUTPUT_BYTES: usize = 4 * 1024 * 1024;
#[cfg(target_os = "windows")]
const WMI_POWERSHELL_SCRIPT: &str = r#"
$ErrorActionPreference = 'Stop'
$payload = ([Console]::In.ReadToEnd() | ConvertFrom-Json)
$wmiArgs = @{ Namespace = [string]$payload.namespace; ErrorAction = 'Stop' }
if (-not [bool]$payload.is_local) {
    $wmiArgs.ComputerName = [string]$payload.host
    if ($null -ne $payload.username -and $null -ne $payload.password) {
        $securePassword = ConvertTo-SecureString ([string]$payload.password) -AsPlainText -Force
        $wmiArgs.Credential = New-Object System.Management.Automation.PSCredential([string]$payload.username, $securePassword)
    }
}
switch ([string]$payload.operation) {
    'probe' { Get-WmiObject @wmiArgs -Class Win32_OperatingSystem | Select-Object -First 1 | Out-Null }
    'query' { Get-WmiObject @wmiArgs -Query ([string]$payload.query) | ConvertTo-Json -Depth 5 -Compress }
    'classes' { Get-WmiObject @wmiArgs -List | Select-Object -ExpandProperty Name | ConvertTo-Json -Compress }
    'namespaces' { $wmiArgs.Namespace = 'root'; Get-WmiObject @wmiArgs -Class __NAMESPACE | Select-Object -ExpandProperty Name | ConvertTo-Json -Compress }
    default { throw 'Unsupported WMI operation' }
}
"#;

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

#[derive(Serialize)]
struct WmiPowerShellRequest {
    operation: &'static str,
    host: String,
    is_local: bool,
    namespace: String,
    query: Option<String>,
    username: Option<String>,
    password: Option<String>,
}

impl WmiService {
    pub fn new() -> WmiServiceState {
        Arc::new(Mutex::new(WmiService {
            sessions: HashMap::new(),
            configs: HashMap::new(),
        }))
    }

    pub async fn connect_wmi(&mut self, config: WmiConnectionConfig) -> Result<String, String> {
        let namespace = config
            .namespace
            .clone()
            .unwrap_or_else(|| "root\\cimv2".to_string());
        validate_wmi_config(&config, &namespace)?;
        let probe = build_wmi_request(&config, &config.host, &namespace, "probe", None);
        run_powershell(&probe, wmi_timeout(&config)).await?;
        let session_id = Uuid::new_v4().to_string();

        let session = WmiSession {
            id: session_id.clone(),
            host: config.host.clone(),
            connected_at: Utc::now(),
            namespace,
            authenticated: config.username.is_some() && config.password.is_some(),
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

        validate_bounded_text("WMI query", &query, 64 * 1024)?;
        let request = build_wmi_request(
            config,
            &session.host,
            &session.namespace,
            "query",
            Some(&query),
        );
        let output = run_powershell(&request, wmi_timeout(config)).await?;
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
        validate_bounded_text("WMI namespace", ns, 256)?;
        let request = build_wmi_request(config, &session.host, ns, "classes", None);
        let output = run_powershell(&request, wmi_timeout(config)).await?;
        let trimmed = output.trim();

        if trimmed.is_empty() {
            return Ok(Vec::new());
        }

        parse_string_list(trimmed, "WMI classes list")
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

        let request = build_wmi_request(
            config,
            &session.host,
            &session.namespace,
            "namespaces",
            None,
        );
        let output = run_powershell(&request, wmi_timeout(config)).await?;
        let trimmed = output.trim();

        if trimmed.is_empty() {
            return Ok(Vec::new());
        }

        let names = parse_string_list(trimmed, "WMI namespaces")?;

        Ok(names.into_iter().map(|n| format!("root\\{}", n)).collect())
    }
}

// ── PowerShell helpers ──────────────────────────────────────────────────

fn validate_bounded_text(label: &str, value: &str, max_bytes: usize) -> Result<(), String> {
    if value.is_empty() || value.len() > max_bytes || value.contains('\0') {
        return Err(format!(
            "{label} is empty, too long, or contains a NUL byte"
        ));
    }
    Ok(())
}

fn is_local_host(host: &str) -> bool {
    host == "localhost" || host == "127.0.0.1" || host == "::1" || host == "."
}

fn validate_wmi_config(config: &WmiConnectionConfig, namespace: &str) -> Result<(), String> {
    if config.use_ssl {
        return Err(
            "WMI SSL is not implemented; refusing to silently downgrade to DCOM".to_string(),
        );
    }
    validate_bounded_text("WMI host", &config.host, 253)?;
    validate_bounded_text("WMI namespace", namespace, 256)?;
    match (&config.username, &config.password) {
        (Some(username), Some(password)) => {
            validate_bounded_text("WMI username", username, 256)?;
            validate_bounded_text("WMI password", password, 4096)?;
        }
        (None, None) => {}
        _ => return Err("WMI username and password must be supplied together".to_string()),
    }
    if let Some(domain) = &config.domain {
        validate_bounded_text("WMI domain", domain, 256)?;
    }
    Ok(())
}

fn build_wmi_request(
    config: &WmiConnectionConfig,
    host: &str,
    namespace: &str,
    operation: &'static str,
    query: Option<&str>,
) -> WmiPowerShellRequest {
    let username = match (&config.domain, &config.username) {
        (Some(domain), Some(username)) => Some(format!("{domain}\\{username}")),
        (None, Some(username)) => Some(username.clone()),
        (_, None) => None,
    };
    WmiPowerShellRequest {
        operation,
        host: host.to_string(),
        is_local: is_local_host(host),
        namespace: namespace.to_string(),
        query: query.map(str::to_string),
        username,
        password: config.password.clone(),
    }
}

fn wmi_timeout(config: &WmiConnectionConfig) -> Duration {
    Duration::from_secs(
        config
            .timeout
            .unwrap_or(DEFAULT_WMI_TIMEOUT_SECS)
            .clamp(1, MAX_WMI_TIMEOUT_SECS),
    )
}

fn parse_string_list(value: &str, label: &str) -> Result<Vec<String>, String> {
    match serde_json::from_str::<serde_json::Value>(value)
        .map_err(|error| format!("Failed to parse {label}: {error}"))?
    {
        serde_json::Value::String(value) => Ok(vec![value]),
        serde_json::Value::Array(values) => values
            .into_iter()
            .map(|value| {
                value
                    .as_str()
                    .map(str::to_string)
                    .ok_or_else(|| format!("Unexpected value in {label}"))
            })
            .collect(),
        _ => Err(format!("Unexpected {label} output format")),
    }
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
async fn read_bounded<R>(reader: R) -> Result<Vec<u8>, String>
where
    R: tokio::io::AsyncRead + Unpin,
{
    use tokio::io::AsyncReadExt;
    let mut bytes = Vec::new();
    reader
        .take((MAX_WMI_OUTPUT_BYTES + 1) as u64)
        .read_to_end(&mut bytes)
        .await
        .map_err(|error| format!("Failed to read PowerShell output: {error}"))?;
    if bytes.len() > MAX_WMI_OUTPUT_BYTES {
        return Err("PowerShell output exceeded the safety limit".to_string());
    }
    Ok(bytes)
}

#[cfg(target_os = "windows")]
async fn run_powershell(
    request: &WmiPowerShellRequest,
    operation_timeout: Duration,
) -> Result<String, String> {
    use std::process::Stdio;
    use tokio::io::AsyncWriteExt;

    let input = serde_json::to_vec(request)
        .map_err(|error| format!("Failed to encode WMI request: {error}"))?;
    if input.len() > MAX_WMI_INPUT_BYTES {
        return Err("WMI request exceeded the safety limit".to_string());
    }
    let system_root = std::env::var_os("SystemRoot")
        .ok_or_else(|| "Windows system directory is unavailable".to_string())?;
    let powershell = std::path::PathBuf::from(system_root)
        .join("System32")
        .join("WindowsPowerShell")
        .join("v1.0")
        .join("powershell.exe");
    if !powershell.is_file() {
        return Err("Trusted Windows PowerShell executable was not found".to_string());
    }

    let mut child = tokio::process::Command::new(powershell)
        .args([
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            WMI_POWERSHELL_SCRIPT,
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|error| format!("Failed to start PowerShell: {error}"))?;
    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| "PowerShell stdin was unavailable".to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "PowerShell stdout was unavailable".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "PowerShell stderr was unavailable".to_string())?;

    let operation = async {
        stdin
            .write_all(&input)
            .await
            .map_err(|error| format!("Failed to send WMI request: {error}"))?;
        drop(stdin);
        let (stdout, _stderr, status) =
            tokio::try_join!(read_bounded(stdout), read_bounded(stderr), async {
                child
                    .wait()
                    .await
                    .map_err(|error| format!("Failed to wait for PowerShell: {error}"))
            })?;
        if !status.success() {
            return Err("PowerShell WMI operation failed".to_string());
        }
        Ok(String::from_utf8_lossy(&stdout).to_string())
    };

    tokio::time::timeout(operation_timeout, operation)
        .await
        .map_err(|_| "PowerShell WMI operation timed out".to_string())?
}

#[cfg(not(target_os = "windows"))]
async fn run_powershell(
    _request: &WmiPowerShellRequest,
    _operation_timeout: Duration,
) -> Result<String, String> {
    Err("WMI queries require Windows with PowerShell".to_string())
}
