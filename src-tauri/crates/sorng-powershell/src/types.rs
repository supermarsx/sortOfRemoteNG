use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// ─── Transport Protocol ──────────────────────────────────────────────────────

/// Transport protocol used for PowerShell Remoting connections.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum PsTransportProtocol {
    /// WinRM over HTTP (port 5985)
    Http,
    /// WinRM over HTTPS (port 5986)
    Https,
    /// PowerShell Remoting over SSH (PS 7+)
    Ssh,
}

impl Default for PsTransportProtocol {
    fn default() -> Self {
        Self::Https
    }
}

impl PsTransportProtocol {
    pub fn default_port(&self) -> u16 {
        match self {
            Self::Http => 5985,
            Self::Https => 5986,
            Self::Ssh => 22,
        }
    }
}

// ─── Authentication ──────────────────────────────────────────────────────────

/// Authentication method for WinRM connections.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum PsAuthMethod {
    /// HTTP Basic authentication (plaintext, HTTPS recommended)
    Basic,
    /// Windows NTLM authentication
    Ntlm,
    /// Windows Negotiate (SPNEGO: Kerberos with NTLM fallback)
    Negotiate,
    /// Kerberos authentication only
    Kerberos,
    /// Credential Security Support Provider
    CredSsp,
    /// Client certificate authentication
    Certificate,
    /// Default (lets the server decide)
    Default,
    /// Digest authentication
    Digest,
}

impl Default for PsAuthMethod {
    fn default() -> Self {
        Self::Negotiate
    }
}

/// Credentials for PowerShell Remoting sessions.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PsCredential {
    pub username: String,
    #[serde(default)]
    pub password: Option<String>,
    /// Domain for domain-joined authentication
    #[serde(default)]
    pub domain: Option<String>,
    /// PFX/PEM certificate path (for Certificate auth)
    #[serde(default)]
    pub certificate_path: Option<String>,
    /// Certificate thumbprint (for Certificate auth)
    #[serde(default)]
    pub certificate_thumbprint: Option<String>,
    /// Private key path (for Certificate auth)
    #[serde(default)]
    pub private_key_path: Option<String>,
    /// SSH key path (for SSH transport)
    #[serde(default)]
    pub ssh_key_path: Option<String>,
}

// ─── Connection Configuration ────────────────────────────────────────────────

/// Complete configuration for a PowerShell Remoting connection.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PsRemotingConfig {
    /// Target hostname or IP address
    pub computer_name: String,
    /// Connection port (defaults based on transport)
    #[serde(default)]
    pub port: Option<u16>,
    /// Transport protocol
    #[serde(default)]
    pub transport: PsTransportProtocol,
    /// Authentication method
    #[serde(default)]
    pub auth_method: PsAuthMethod,
    /// User credentials
    pub credential: PsCredential,
    /// Skip CA check for self-signed certificates
    #[serde(default)]
    pub skip_ca_check: bool,
    /// Skip CN check for certificate hostname mismatch
    #[serde(default)]
    pub skip_cn_check: bool,
    /// Skip revocation check
    #[serde(default)]
    pub skip_revocation_check: bool,
    /// Use SSL (alias for HTTPS transport)
    #[serde(default)]
    pub use_ssl: bool,
    /// WinRM URI path (default: /wsman)
    #[serde(default = "default_wsman_path")]
    pub uri_path: String,
    /// Custom WinRM URI (overrides computed URI)
    #[serde(default)]
    pub connection_uri: Option<String>,
    /// Session options
    #[serde(default)]
    pub session_option: PsSessionOption,
    /// Session configuration name (e.g., "microsoft.powershell", JEA endpoint)
    #[serde(default = "default_configuration_name")]
    pub configuration_name: String,
    /// Application name for WinRM URI
    #[serde(default = "default_app_name")]
    pub application_name: String,
    /// Enable session reconnection
    #[serde(default = "default_true")]
    pub enable_reconnect: bool,
    /// Proxy configuration
    #[serde(default)]
    pub proxy: Option<PsProxyConfig>,
    /// Custom SOAP headers
    #[serde(default)]
    pub custom_headers: HashMap<String, String>,
}

fn default_wsman_path() -> String {
    "/wsman".to_string()
}

fn default_configuration_name() -> String {
    "Microsoft.PowerShell".to_string()
}

fn default_app_name() -> String {
    "wsman".to_string()
}

fn default_true() -> bool {
    true
}

impl PsRemotingConfig {
    /// Compute the effective port for this configuration.
    pub fn effective_port(&self) -> u16 {
        self.port.unwrap_or_else(|| self.transport.default_port())
    }

    /// Compute the full WinRM endpoint URI.
    pub fn endpoint_uri(&self) -> String {
        if let Some(ref uri) = self.connection_uri {
            return uri.clone();
        }
        let scheme = match self.transport {
            PsTransportProtocol::Http => "http",
            PsTransportProtocol::Https => "https",
            PsTransportProtocol::Ssh => return format!("ssh://{}:{}", self.computer_name, self.effective_port()),
        };
        format!(
            "{}://{}:{}/{}/{}",
            scheme,
            self.computer_name,
            self.effective_port(),
            self.application_name,
            self.uri_path.trim_start_matches('/')
        )
    }
}

// ─── Session Options ─────────────────────────────────────────────────────────

/// Options controlling session behavior and timeouts.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PsSessionOption {
    /// Operation timeout in seconds (default: 180)
    #[serde(default = "default_operation_timeout")]
    pub operation_timeout_sec: u32,
    /// Open timeout for connection in seconds (default: 180)
    #[serde(default = "default_operation_timeout")]
    pub open_timeout_sec: u32,
    /// Cancel timeout in seconds (default: 60)
    #[serde(default = "default_cancel_timeout")]
    pub cancel_timeout_sec: u32,
    /// Idle timeout in seconds (default: 7200, i.e. 2 hours)
    #[serde(default = "default_idle_timeout")]
    pub idle_timeout_sec: u32,
    /// Maximum number of redirections to follow
    #[serde(default = "default_max_redirections")]
    pub max_redirections: u32,
    /// Disable machine profile loading on remote end
    #[serde(default)]
    pub skip_machine_profile: bool,
    /// Culture for the remote session (e.g., "en-US")
    #[serde(default = "default_culture")]
    pub culture: String,
    /// UI culture for the remote session
    #[serde(default = "default_culture")]
    pub ui_culture: String,
    /// Maximum received data size per command in MB
    #[serde(default = "default_max_data_mb")]
    pub max_received_data_size_mb: u32,
    /// Maximum received object size in MB
    #[serde(default = "default_max_object_mb")]
    pub max_received_object_size_mb: u32,
    /// Output buffering mode for disconnected sessions
    #[serde(default)]
    pub output_buffering_mode: OutputBufferingMode,
    /// Maximum number of commands per shell
    #[serde(default = "default_max_commands")]
    pub max_commands_per_shell: u32,
    /// Maximum concurrent users
    #[serde(default = "default_max_sessions")]
    pub max_concurrent_users: u32,
    /// Enable compression
    #[serde(default = "default_true")]
    pub no_compression: bool,
    /// Heartbeat/keep-alive interval in seconds (0 to disable)
    #[serde(default = "default_keepalive")]
    pub keepalive_interval_sec: u32,
    /// Disable UTF-8 encoding (use system default)
    #[serde(default)]
    pub no_utf8: bool,
    /// Maximum connection retry count
    #[serde(default = "default_retry_count")]
    pub max_connection_retry_count: u32,
    /// Delay between connection retries in seconds
    #[serde(default = "default_retry_delay")]
    pub max_connection_retry_delay_sec: u32,
}

fn default_operation_timeout() -> u32 {
    180
}
fn default_cancel_timeout() -> u32 {
    60
}
fn default_idle_timeout() -> u32 {
    7200
}
fn default_max_redirections() -> u32 {
    5
}
fn default_culture() -> String {
    "en-US".to_string()
}
fn default_max_data_mb() -> u32 {
    50
}
fn default_max_object_mb() -> u32 {
    10
}
fn default_max_commands() -> u32 {
    20
}
fn default_max_sessions() -> u32 {
    25
}
fn default_keepalive() -> u32 {
    30
}
fn default_retry_count() -> u32 {
    3
}
fn default_retry_delay() -> u32 {
    5
}

impl Default for PsSessionOption {
    fn default() -> Self {
        Self {
            operation_timeout_sec: default_operation_timeout(),
            open_timeout_sec: default_operation_timeout(),
            cancel_timeout_sec: default_cancel_timeout(),
            idle_timeout_sec: default_idle_timeout(),
            max_redirections: default_max_redirections(),
            skip_machine_profile: false,
            culture: default_culture(),
            ui_culture: default_culture(),
            max_received_data_size_mb: default_max_data_mb(),
            max_received_object_size_mb: default_max_object_mb(),
            output_buffering_mode: OutputBufferingMode::default(),
            max_commands_per_shell: default_max_commands(),
            max_concurrent_users: default_max_sessions(),
            no_compression: false,
            keepalive_interval_sec: default_keepalive(),
            no_utf8: false,
            max_connection_retry_count: default_retry_count(),
            max_connection_retry_delay_sec: default_retry_delay(),
        }
    }
}

// ─── Session State ───────────────────────────────────────────────────────────

/// State of a PowerShell Remoting session.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum PsSessionState {
    /// Session is being created
    Opening,
    /// Session is open and ready for commands
    Opened,
    /// Session is disconnected but can be reconnected
    Disconnected,
    /// Session is being closed
    Closing,
    /// Session is closed
    Closed,
    /// Session encountered an unrecoverable error
    Broken,
}

impl Default for PsSessionState {
    fn default() -> Self {
        Self::Opening
    }
}

/// Information about an active PowerShell Remoting session.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PsSession {
    /// Unique session identifier
    pub id: String,
    /// Server-assigned shell ID
    pub shell_id: Option<String>,
    /// Display name (user-settable)
    pub name: String,
    /// Target computer name
    pub computer_name: String,
    /// Session state
    pub state: PsSessionState,
    /// Session availability
    pub availability: PsSessionAvailability,
    /// Configuration name (endpoint)
    pub configuration_name: String,
    /// PowerShell version on remote end
    pub ps_version: Option<String>,
    /// OS version on remote end
    pub os_version: Option<String>,
    /// Session creation timestamp
    pub created_at: DateTime<Utc>,
    /// Last activity timestamp
    pub last_activity: DateTime<Utc>,
    /// Session idle duration in seconds
    pub idle_seconds: u64,
    /// Number of commands executed in this session
    pub command_count: u64,
    /// Transport protocol used
    pub transport: PsTransportProtocol,
    /// Authentication method used
    pub auth_method: PsAuthMethod,
    /// Whether the session supports disconnect/reconnect
    pub supports_disconnect: bool,
    /// Reconnection count
    pub reconnect_count: u32,
    /// Associated runspace ID
    pub runspace_id: Option<String>,
    /// Remote port
    pub port: u16,
}

/// Availability of a PSSession for new commands.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum PsSessionAvailability {
    /// Session is available for new commands
    Available,
    /// Session is currently busy executing a command
    Busy,
    /// Session availability is unknown
    None,
}

impl Default for PsSessionAvailability {
    fn default() -> Self {
        Self::Available
    }
}

// ─── Output Buffering ────────────────────────────────────────────────────────

/// How output is buffered when a session is disconnected.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum OutputBufferingMode {
    /// No output buffering; commands may fail
    None,
    /// Drop oldest output when buffer is full
    Drop,
    /// Block command execution when buffer is full
    Block,
}

impl Default for OutputBufferingMode {
    fn default() -> Self {
        Self::Block
    }
}

// ─── Invocation State ────────────────────────────────────────────────────────

/// State of a command invocation (pipeline).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum PsInvocationState {
    NotStarted,
    Running,
    Stopping,
    Stopped,
    Completed,
    Failed,
    Disconnected,
}

impl Default for PsInvocationState {
    fn default() -> Self {
        Self::NotStarted
    }
}

// ─── Output Streams ──────────────────────────────────────────────────────────

/// PowerShell output stream type.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum PsStreamType {
    Output,
    Error,
    Warning,
    Verbose,
    Debug,
    Information,
    Progress,
}

/// A single record from a PowerShell output stream.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PsStreamRecord {
    pub stream: PsStreamType,
    pub data: serde_json::Value,
    pub timestamp: DateTime<Utc>,
    /// For Error records: exception details
    #[serde(default)]
    pub exception: Option<PsErrorRecord>,
    /// For Progress records: progress details
    #[serde(default)]
    pub progress: Option<PsProgressRecord>,
}

/// PowerShell ErrorRecord details.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PsErrorRecord {
    pub exception_type: String,
    pub message: String,
    pub fully_qualified_error_id: Option<String>,
    pub category: Option<String>,
    pub target_object: Option<String>,
    pub script_stack_trace: Option<String>,
    pub invocation_info: Option<String>,
    pub pipeline_iteration_info: Option<String>,
}

/// PowerShell ProgressRecord details.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PsProgressRecord {
    pub activity: String,
    pub status_description: String,
    pub percent_complete: i32,
    pub seconds_remaining: i64,
    pub current_operation: Option<String>,
    pub parent_activity_id: i32,
    pub activity_id: i32,
    pub record_type: ProgressRecordType,
}

/// Type of progress record.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum ProgressRecordType {
    Processing,
    Completed,
}

impl Default for ProgressRecordType {
    fn default() -> Self {
        Self::Processing
    }
}

// ─── Command Output ──────────────────────────────────────────────────────────

/// Complete output from a PowerShell command invocation.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PsCommandOutput {
    /// Unique command invocation ID
    pub invocation_id: String,
    /// Session ID this command ran on
    pub session_id: String,
    /// Command string
    pub command: String,
    /// Final invocation state
    pub state: PsInvocationState,
    /// All output records across all streams
    pub streams: Vec<PsStreamRecord>,
    /// Output stream objects (deserialized)
    pub output: Vec<serde_json::Value>,
    /// Error stream records
    pub errors: Vec<PsErrorRecord>,
    /// Whether the command had terminating errors
    pub had_errors: bool,
    /// Start time
    pub started_at: DateTime<Utc>,
    /// End time
    pub completed_at: Option<DateTime<Utc>>,
    /// Execution duration in milliseconds
    pub duration_ms: u64,
    /// CLIXML raw output (if preserved)
    #[serde(default)]
    pub raw_clixml: Option<String>,
}

// ─── Invoke-Command Parameters ───────────────────────────────────────────────

/// Parameters for Invoke-Command style execution.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PsInvokeCommandParams {
    /// Session ID to execute on (mutually exclusive with computer_name)
    #[serde(default)]
    pub session_id: Option<String>,
    /// Script block text to execute
    pub script_block: String,
    /// Arguments to pass to the script block ($args / $using: vars)
    #[serde(default)]
    pub argument_list: Vec<serde_json::Value>,
    /// Named parameters for the script block
    #[serde(default)]
    pub parameters: HashMap<String, serde_json::Value>,
    /// Run as a background job
    #[serde(default)]
    pub as_job: bool,
    /// Maximum number of concurrent connections (for fan-out)
    #[serde(default = "default_throttle_limit")]
    pub throttle_limit: u32,
    /// Input objects to stream into the script
    #[serde(default)]
    pub input_object: Vec<serde_json::Value>,
    /// Disconnect immediately after starting the command
    #[serde(default)]
    pub invoke_and_disconnect: bool,
    /// Hide the computer name column in output
    #[serde(default)]
    pub hide_computer_name: bool,
    /// FilePath (run a local .ps1 script on the remote machine)
    #[serde(default)]
    pub file_path: Option<String>,
    /// Custom command name to execute (instead of script block)
    #[serde(default)]
    pub command_name: Option<String>,
    /// Timeout for this specific invocation in seconds (0 = no timeout)
    #[serde(default)]
    pub timeout_sec: u32,
}

fn default_throttle_limit() -> u32 {
    32
}

// ─── Proxy Configuration ─────────────────────────────────────────────────────

/// Proxy settings for WinRM connections.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PsProxyConfig {
    /// Proxy access type
    pub access_type: PsProxyAccessType,
    /// Proxy authentication method
    #[serde(default)]
    pub authentication: Option<PsAuthMethod>,
    /// Proxy credentials
    #[serde(default)]
    pub credential: Option<PsCredential>,
}

/// Type of proxy access.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum PsProxyAccessType {
    NoProxyServer,
    WinHttpConfig,
    AutoDetect,
    InternetExplorer,
}

// ─── CIM Types ───────────────────────────────────────────────────────────────

/// Configuration for a CIM session.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CimSessionConfig {
    pub computer_name: String,
    #[serde(default)]
    pub port: Option<u16>,
    #[serde(default)]
    pub credential: Option<PsCredential>,
    #[serde(default)]
    pub auth_method: PsAuthMethod,
    /// CIM session protocol
    #[serde(default)]
    pub protocol: CimProtocol,
    #[serde(default)]
    pub skip_ca_check: bool,
    #[serde(default)]
    pub skip_cn_check: bool,
    #[serde(default)]
    pub skip_revocation_check: bool,
    /// Operation timeout in seconds
    #[serde(default = "default_operation_timeout")]
    pub operation_timeout_sec: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum CimProtocol {
    Wsman,
    Dcom,
}

impl Default for CimProtocol {
    fn default() -> Self {
        Self::Wsman
    }
}

/// CIM instance data.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CimInstance {
    pub class_name: String,
    pub namespace: String,
    pub server_name: String,
    pub properties: HashMap<String, serde_json::Value>,
    pub system_properties: HashMap<String, serde_json::Value>,
}

/// CIM query parameters.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CimQueryParams {
    pub session_id: String,
    pub namespace: Option<String>,
    pub class_name: String,
    #[serde(default)]
    pub filter: Option<String>,
    #[serde(default)]
    pub property: Vec<String>,
    #[serde(default)]
    pub key_only: bool,
    #[serde(default)]
    pub shallow: bool,
}

/// CIM method invocation parameters.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CimMethodParams {
    pub session_id: String,
    pub namespace: Option<String>,
    pub class_name: String,
    pub method_name: String,
    #[serde(default)]
    pub arguments: HashMap<String, serde_json::Value>,
    /// Optional: invoke on a specific instance (by key properties)
    #[serde(default)]
    pub instance_keys: HashMap<String, serde_json::Value>,
}

/// CIM subscription parameters for events.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CimSubscriptionParams {
    pub session_id: String,
    pub namespace: Option<String>,
    pub query: String,
    #[serde(default = "default_query_dialect")]
    pub query_dialect: String,
    /// Polling interval in seconds (for extrinsic events)
    #[serde(default)]
    pub polling_interval_sec: Option<u32>,
}

fn default_query_dialect() -> String {
    "WQL".to_string()
}

// ─── DSC Types ───────────────────────────────────────────────────────────────

/// DSC configuration document.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DscConfiguration {
    pub name: String,
    pub content: String,
    pub parameters: HashMap<String, serde_json::Value>,
    #[serde(default)]
    pub configuration_data: Option<serde_json::Value>,
}

/// DSC resource state.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DscResourceState {
    pub resource_name: String,
    pub module_name: String,
    pub instance_name: String,
    pub in_desired_state: bool,
    pub properties: HashMap<String, serde_json::Value>,
}

/// DSC node compliance status.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DscComplianceStatus {
    Compliant,
    NonCompliant,
    Error,
    NotApplicable,
    Unknown,
}

/// DSC operation result.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DscResult {
    pub computer_name: String,
    pub status: DscComplianceStatus,
    pub resources: Vec<DscResourceState>,
    pub reboot_required: bool,
    pub timestamp: DateTime<Utc>,
    #[serde(default)]
    pub errors: Vec<String>,
}

// ─── JEA Types ───────────────────────────────────────────────────────────────

/// JEA (Just Enough Administration) endpoint definition.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JeaEndpoint {
    pub name: String,
    pub session_type: JeaSessionType,
    #[serde(default)]
    pub role_definitions: HashMap<String, JeaRoleCapability>,
    #[serde(default)]
    pub transcript_directory: Option<String>,
    #[serde(default)]
    pub run_as_virtual_account: bool,
    #[serde(default)]
    pub run_as_virtual_account_groups: Vec<String>,
    #[serde(default)]
    pub language_mode: PsLanguageMode,
    #[serde(default)]
    pub execution_policy: PsExecutionPolicy,
    #[serde(default)]
    pub modules_to_import: Vec<String>,
    #[serde(default)]
    pub visible_cmdlets: Vec<String>,
    #[serde(default)]
    pub visible_functions: Vec<String>,
    #[serde(default)]
    pub visible_providers: Vec<String>,
    #[serde(default)]
    pub visible_external_commands: Vec<String>,
    #[serde(default)]
    pub scripts_to_process: Vec<String>,
    #[serde(default)]
    pub environment_variables: HashMap<String, String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub guid: Option<String>,
}

/// JEA role capability entry.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JeaRoleCapability {
    pub role_capability_files: Vec<String>,
    #[serde(default)]
    pub visible_cmdlets: Vec<String>,
    #[serde(default)]
    pub visible_functions: Vec<String>,
    #[serde(default)]
    pub visible_providers: Vec<String>,
    #[serde(default)]
    pub visible_external_commands: Vec<String>,
    #[serde(default)]
    pub function_definitions: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum JeaSessionType {
    RestrictedRemoteServer,
    Empty,
    Default,
}

impl Default for JeaSessionType {
    fn default() -> Self {
        Self::RestrictedRemoteServer
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum PsLanguageMode {
    FullLanguage,
    RestrictedLanguage,
    ConstrainedLanguage,
    NoLanguage,
}

impl Default for PsLanguageMode {
    fn default() -> Self {
        Self::RestrictedLanguage
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum PsExecutionPolicy {
    Unrestricted,
    RemoteSigned,
    AllSigned,
    Restricted,
    Bypass,
    Undefined,
}

impl Default for PsExecutionPolicy {
    fn default() -> Self {
        Self::RemoteSigned
    }
}

// ─── File Transfer ───────────────────────────────────────────────────────────

/// Parameters for file copy over PS Remoting.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PsFileCopyParams {
    pub session_id: String,
    /// Local path (source for ToSession, destination for FromSession)
    pub local_path: String,
    /// Remote path (destination for ToSession, source for FromSession)
    pub remote_path: String,
    /// Direction of copy
    pub direction: PsFileCopyDirection,
    /// Recurse into subdirectories
    #[serde(default)]
    pub recurse: bool,
    /// Force overwrite
    #[serde(default)]
    pub force: bool,
    /// Chunk size in bytes for transfer (default: 1MB)
    #[serde(default = "default_chunk_size")]
    pub chunk_size: usize,
}

fn default_chunk_size() -> usize {
    1048576 // 1 MB
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum PsFileCopyDirection {
    ToSession,
    FromSession,
}

/// Progress of a file transfer.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PsFileTransferProgress {
    pub transfer_id: String,
    pub session_id: String,
    pub direction: PsFileCopyDirection,
    pub source_path: String,
    pub destination_path: String,
    pub total_bytes: u64,
    pub transferred_bytes: u64,
    pub percent_complete: f64,
    pub bytes_per_second: f64,
    pub started_at: DateTime<Utc>,
    pub estimated_completion: Option<DateTime<Utc>>,
    pub state: PsTransferState,
    #[serde(default)]
    pub current_file: Option<String>,
    #[serde(default)]
    pub files_total: u32,
    #[serde(default)]
    pub files_transferred: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum PsTransferState {
    Pending,
    Transferring,
    Completed,
    Failed,
    Cancelled,
}

// ─── PowerShell Direct (Hyper-V) ─────────────────────────────────────────────

/// Configuration for PowerShell Direct connection to a Hyper-V VM.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PsDirectConfig {
    /// VM name
    #[serde(default)]
    pub vm_name: Option<String>,
    /// VM GUID
    #[serde(default)]
    pub vm_id: Option<String>,
    /// Hyper-V host (default: localhost)
    #[serde(default)]
    pub hyper_v_host: Option<String>,
    /// Credentials for the VM
    pub credential: PsCredential,
    /// Configuration name
    #[serde(default = "default_configuration_name")]
    pub configuration_name: String,
}

// ─── Session Configuration ───────────────────────────────────────────────────

/// A registered PowerShell session configuration (endpoint).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PsSessionConfiguration {
    pub name: String,
    pub ps_version: Option<String>,
    pub startup_script: Option<String>,
    pub permission: Option<String>,
    pub run_as_user: Option<String>,
    pub session_type: Option<String>,
    pub output_buffering_mode: Option<String>,
    pub max_received_command_size_mb: Option<f64>,
    pub max_received_object_size_mb: Option<f64>,
    pub max_sessions_per_user: Option<u32>,
    pub enabled: bool,
    pub uri: Option<String>,
    pub sdk_version: Option<String>,
    pub architecture: Option<String>,
    pub description: Option<String>,
}

// ─── Diagnostics ─────────────────────────────────────────────────────────────

/// Result from Test-WSMan or other diagnostic checks.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PsDiagnosticResult {
    pub computer_name: String,
    pub wsman_reachable: bool,
    pub protocol_version: Option<String>,
    pub product_vendor: Option<String>,
    pub product_version: Option<String>,
    pub stack_version: Option<String>,
    pub os_info: Option<String>,
    pub ps_version: Option<String>,
    pub latency_ms: Option<u64>,
    pub auth_methods_available: Vec<String>,
    pub max_envelope_size_kb: Option<u32>,
    pub max_timeout_ms: Option<u32>,
    pub locale: Option<String>,
    pub certificate_info: Option<PsCertificateInfo>,
    pub errors: Vec<String>,
    pub warnings: Vec<String>,
    pub timestamp: DateTime<Utc>,
    /// Overall success flag
    #[serde(default)]
    pub success: bool,
    /// Individual diagnostic checks
    #[serde(default)]
    pub checks: Vec<DiagnosticCheck>,
    /// Total duration in milliseconds
    #[serde(default)]
    pub duration_ms: u64,
}

/// Certificate information from the remote endpoint.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PsCertificateInfo {
    pub subject: String,
    pub issuer: String,
    pub thumbprint: String,
    pub not_before: DateTime<Utc>,
    pub not_after: DateTime<Utc>,
    pub key_size: u32,
    pub is_self_signed: bool,
    #[serde(default)]
    pub dns_name_list: Vec<String>,
    #[serde(default)]
    pub has_private_key: bool,
    #[serde(default)]
    pub serial_number: Option<String>,
    #[serde(default)]
    pub signature_algorithm: Option<String>,
    #[serde(default)]
    pub key_usage: Option<String>,
}

// ─── Diagnostic Check Types ──────────────────────────────────────────────────

/// A single diagnostic check result.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticCheck {
    pub name: String,
    pub passed: bool,
    pub message: String,
    pub severity: DiagnosticSeverity,
    pub duration_ms: Option<u64>,
}

/// Severity level of a diagnostic check.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DiagnosticSeverity {
    Info,
    Warning,
    Critical,
}

// ─── Events ──────────────────────────────────────────────────────────────────

/// Events emitted to the frontend for real-time updates.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(tag = "type")]
pub enum PsRemotingEvent {
    SessionStateChanged {
        session_id: String,
        old_state: PsSessionState,
        new_state: PsSessionState,
        timestamp: DateTime<Utc>,
    },
    CommandOutput {
        session_id: String,
        invocation_id: String,
        record: PsStreamRecord,
    },
    CommandStateChanged {
        session_id: String,
        invocation_id: String,
        old_state: PsInvocationState,
        new_state: PsInvocationState,
    },
    FileTransferProgress {
        progress: PsFileTransferProgress,
    },
    DiagnosticComplete {
        result: PsDiagnosticResult,
    },
    SessionReconnected {
        session_id: String,
        timestamp: DateTime<Utc>,
    },
    SessionBroken {
        session_id: String,
        error: String,
        timestamp: DateTime<Utc>,
    },
    KeepAliveResponse {
        session_id: String,
        latency_ms: u64,
        timestamp: DateTime<Utc>,
    },
    CimEventReceived {
        subscription_id: String,
        session_id: String,
        event_data: serde_json::Value,
        timestamp: DateTime<Utc>,
    },
    SessionCreated {
        session_id: String,
        computer_name: String,
        timestamp: DateTime<Utc>,
    },
    SessionDisconnected {
        session_id: String,
        timestamp: DateTime<Utc>,
    },
    SessionClosed {
        session_id: String,
        timestamp: DateTime<Utc>,
    },
    CommandCompleted {
        session_id: String,
        invocation_id: String,
        had_errors: bool,
        duration_ms: u64,
        timestamp: DateTime<Utc>,
    },
    InteractiveSessionStarted {
        session_id: String,
        timestamp: DateTime<Utc>,
    },
    InteractiveSessionEnded {
        session_id: String,
        timestamp: DateTime<Utc>,
    },
    FileTransferStarted {
        session_id: String,
        transfer_id: String,
        direction: String,
        timestamp: DateTime<Utc>,
    },
}

// ─── SOAP / WinRM Protocol Types ─────────────────────────────────────────────

/// WinRM SOAP action types.
#[derive(Debug, Clone, PartialEq)]
pub enum WsManAction {
    Create,
    Delete,
    Get,
    Put,
    Enumerate,
    EnumerateResponse,
    Pull,
    Subscribe,
    Unsubscribe,
    Command,
    Receive,
    Send,
    Signal,
    Custom(String),
}

impl WsManAction {
    pub fn uri(&self) -> &str {
        match self {
            Self::Create => "http://schemas.xmlsoap.org/ws/2004/09/transfer/Create",
            Self::Delete => "http://schemas.xmlsoap.org/ws/2004/09/transfer/Delete",
            Self::Get => "http://schemas.xmlsoap.org/ws/2004/09/transfer/Get",
            Self::Put => "http://schemas.xmlsoap.org/ws/2004/09/transfer/Put",
            Self::Enumerate => "http://schemas.xmlsoap.org/ws/2004/09/enumeration/Enumerate",
            Self::EnumerateResponse => "http://schemas.xmlsoap.org/ws/2004/09/enumeration/EnumerateResponse",
            Self::Pull => "http://schemas.xmlsoap.org/ws/2004/09/enumeration/Pull",
            Self::Subscribe => "http://schemas.xmlsoap.org/ws/2004/11/eventing/Subscribe",
            Self::Unsubscribe => "http://schemas.xmlsoap.org/ws/2004/11/eventing/Unsubscribe",
            Self::Command => "http://schemas.microsoft.com/wbem/wsman/1/windows/shell/Command",
            Self::Receive => "http://schemas.microsoft.com/wbem/wsman/1/windows/shell/Receive",
            Self::Send => "http://schemas.microsoft.com/wbem/wsman/1/windows/shell/Send",
            Self::Signal => "http://schemas.microsoft.com/wbem/wsman/1/windows/shell/Signal",
            Self::Custom(uri) => uri.as_str(),
        }
    }
}

/// WinRM signal codes.
pub struct WsManSignal;

impl WsManSignal {
    pub const TERMINATE: &'static str =
        "http://schemas.microsoft.com/wbem/wsman/1/windows/shell/signal/terminate";
    pub const CTRL_C: &'static str =
        "http://schemas.microsoft.com/wbem/wsman/1/windows/shell/signal/ctrl_c";
    pub const CTRL_BREAK: &'static str =
        "http://schemas.microsoft.com/wbem/wsman/1/windows/shell/signal/ctrl_break";
    pub const PS_DISCONNECT: &'static str =
        "http://schemas.microsoft.com/wbem/wsman/1/windows/shell/signal/Disconnect";
    pub const PS_RECONNECT: &'static str =
        "http://schemas.microsoft.com/wbem/wsman/1/windows/shell/signal/Reconnect";
}

/// WinRM resource URIs.
pub struct WsManResourceUri;

impl WsManResourceUri {
    pub const SHELL: &'static str =
        "http://schemas.microsoft.com/wbem/wsman/1/windows/shell/cmd";
    pub const PS_SHELL: &'static str =
        "http://schemas.microsoft.com/powershell/Microsoft.PowerShell";
    pub const CONFIG: &'static str =
        "http://schemas.microsoft.com/wbem/wsman/1/config";
    pub const WINRS: &'static str =
        "http://schemas.microsoft.com/wbem/wsman/1/windows/shell";
    pub const CIM: &'static str =
        "http://schemas.dmtf.org/wbem/wscim/1/cim-schema/2";
    pub const PLUGIN: &'static str =
        "http://schemas.microsoft.com/wbem/wsman/1/config/PluginConfiguration";
}

/// WinRM SOAP namespaces.
pub struct WsManNamespace;

impl WsManNamespace {
    pub const SOAP: &'static str = "http://www.w3.org/2003/05/soap-envelope";
    pub const ADDRESSING: &'static str = "http://schemas.xmlsoap.org/ws/2004/08/addressing";
    pub const WSMAN: &'static str = "http://schemas.dmtf.org/wbem/wsman/1/wsman.xsd";
    pub const WSMAND: &'static str = "http://schemas.microsoft.com/wbem/wsman/1/wsman.xsd";
    pub const WSMAN_FAULT: &'static str = "http://schemas.microsoft.com/wbem/wsman/1/wsmanfault";
    pub const SHELL: &'static str = "http://schemas.microsoft.com/wbem/wsman/1/windows/shell";
    pub const WSEN: &'static str = "http://schemas.xmlsoap.org/ws/2004/09/enumeration";
    pub const WSET: &'static str = "http://schemas.xmlsoap.org/ws/2004/09/transfer";
    pub const WSSE: &'static str = "http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd";
    pub const XMLSCHEMA: &'static str = "http://www.w3.org/2001/XMLSchema";
    pub const XMLSCHEMA_INST: &'static str = "http://www.w3.org/2001/XMLSchema-instance";
    pub const PS_STREAMS: &'static str = "http://schemas.microsoft.com/powershell/Microsoft.PowerShell";
    pub const CIM: &'static str = "http://schemas.dmtf.org/wbem/wscim/1/common";
}
