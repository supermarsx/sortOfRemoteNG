//! Data types for the CUPS/IPP integration.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// ═══════════════════════════════════════════════════════════════════════
// Connection / Session
// ═══════════════════════════════════════════════════════════════════════

/// Encryption policy for the CUPS connection.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CupsEncryption {
    /// Never use encryption.
    Never,
    /// Use encryption if available (opportunistic TLS).
    IfRequested,
    /// Require encryption — fail if TLS cannot be established.
    Required,
    /// Always encrypt (alias for Required).
    Always,
}

impl Default for CupsEncryption {
    fn default() -> Self {
        Self::IfRequested
    }
}

/// Configuration required to reach a CUPS server.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CupsConnectionConfig {
    /// Hostname or IP address of the CUPS server.
    pub host: String,
    /// Port (default 631).
    #[serde(default = "default_port")]
    pub port: u16,
    /// Username for HTTP Basic authentication (optional).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub username: Option<String>,
    /// Password for HTTP Basic authentication (optional).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub password: Option<String>,
    /// Use TLS (https).
    #[serde(default)]
    pub use_tls: bool,
    /// Encryption policy.
    #[serde(default)]
    pub encryption: CupsEncryption,
    /// Request timeout in seconds.
    #[serde(default = "default_timeout")]
    pub timeout_secs: u64,
}

fn default_port() -> u16 {
    631
}
fn default_timeout() -> u64 {
    30
}

impl CupsConnectionConfig {
    /// Build the base URL for the CUPS server.
    pub fn base_url(&self) -> String {
        let scheme = if self.use_tls { "https" } else { "http" };
        format!("{scheme}://{}:{}", self.host, self.port)
    }

    /// Build a printer URI.
    pub fn printer_uri(&self, name: &str) -> String {
        format!("{}/printers/{name}", self.base_url())
    }

    /// Build a class URI.
    pub fn class_uri(&self, name: &str) -> String {
        format!("{}/classes/{name}", self.base_url())
    }

    /// Build the admin URI.
    pub fn admin_uri(&self) -> String {
        format!("{}/admin/", self.base_url())
    }

    /// Build the jobs URI.
    pub fn jobs_uri(&self) -> String {
        format!("{}/jobs/", self.base_url())
    }

    /// Full IPP URI for the server root.
    pub fn ipp_uri(&self) -> String {
        let scheme = if self.use_tls { "ipps" } else { "ipp" };
        format!("{scheme}://{}:{}/", self.host, self.port)
    }
}

/// An active session to a CUPS server.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CupsSession {
    pub id: String,
    pub config: CupsConnectionConfig,
    pub connected_at: DateTime<Utc>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub server_info: Option<CupsServerInfo>,
}

// ═══════════════════════════════════════════════════════════════════════
// Printer
// ═══════════════════════════════════════════════════════════════════════

/// IPP printer-state values (RFC 2911 §4.4.11).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PrinterState {
    /// Printer is idle and ready to accept jobs.
    Idle = 3,
    /// Printer is currently processing a job.
    Processing = 4,
    /// Printer has been stopped (paused).
    Stopped = 5,
}

impl PrinterState {
    pub fn from_ipp(value: i32) -> Self {
        match value {
            3 => Self::Idle,
            4 => Self::Processing,
            5 => Self::Stopped,
            _ => Self::Idle,
        }
    }
}

/// Bitflag-style printer type bits (CUPS extension to IPP).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrinterTypeFlags(pub u32);

impl PrinterTypeFlags {
    pub const LOCAL: u32         = 0x0000_0000;
    pub const CLASS: u32         = 0x0000_0001;
    pub const REMOTE: u32        = 0x0000_0002;
    pub const NETWORK: u32       = 0x0000_0004; // not a true printer — a host
    pub const FAX: u32           = 0x0000_0040;
    pub const COLOR: u32         = 0x0000_0080;
    pub const DUPLEX: u32        = 0x0000_0100;
    pub const STAPLE: u32        = 0x0000_0200;
    pub const COPIES: u32        = 0x0000_0400;
    pub const COLLATE: u32       = 0x0000_0800;
    pub const PUNCH: u32         = 0x0000_1000;
    pub const COVER: u32         = 0x0000_2000;
    pub const BIND: u32          = 0x0000_4000;
    pub const SORT: u32          = 0x0000_8000;
    pub const MFP: u32           = 0x0001_0000; // scanner + printer
    pub const LARGE_FORMAT: u32  = 0x0002_0000;
    pub const THREE_D: u32       = 0x0004_0000;
    pub const DISCOVERED: u32    = 0x0080_0000;

    pub fn is_set(&self, flag: u32) -> bool {
        (self.0 & flag) != 0
    }
    pub fn is_class(&self) -> bool { self.is_set(Self::CLASS) }
    pub fn is_remote(&self) -> bool { self.is_set(Self::REMOTE) }
    pub fn is_color(&self) -> bool { self.is_set(Self::COLOR) }
    pub fn is_duplex(&self) -> bool { self.is_set(Self::DUPLEX) }
}

/// Comprehensive printer information.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrinterInfo {
    pub name: String,
    pub uri: String,
    pub state: PrinterState,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub state_message: Option<String>,
    #[serde(default)]
    pub state_reasons: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub location: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub make_model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub device_uri: Option<String>,
    pub printer_type: PrinterTypeFlags,
    pub is_shared: bool,
    pub is_accepting: bool,
    pub is_default: bool,
    pub color_supported: bool,
    pub duplex_supported: bool,
    #[serde(default)]
    pub media_supported: Vec<String>,
    #[serde(default)]
    pub resolution_supported: Vec<String>,
    pub job_count: u32,
    pub total_page_count: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub info: Option<String>,
}

impl Default for PrinterInfo {
    fn default() -> Self {
        Self {
            name: String::new(),
            uri: String::new(),
            state: PrinterState::Idle,
            state_message: None,
            state_reasons: Vec::new(),
            location: None,
            description: None,
            make_model: None,
            device_uri: None,
            printer_type: PrinterTypeFlags(0),
            is_shared: false,
            is_accepting: true,
            is_default: false,
            color_supported: false,
            duplex_supported: false,
            media_supported: Vec::new(),
            resolution_supported: Vec::new(),
            job_count: 0,
            total_page_count: 0,
            info: None,
        }
    }
}

/// Arguments for modifying a printer.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModifyPrinterArgs {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub device_uri: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ppd_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub location: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub shared: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub accepting: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_policy: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub op_policy: Option<String>,
}

/// Discovered device from CUPS-Get-Devices.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveredDevice {
    pub device_class: String,
    pub device_uri: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub device_make_model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub device_info: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub device_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub device_location: Option<String>,
}

/// Printer statistics.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrinterStatistics {
    pub total_pages: u64,
    pub total_jobs: u64,
    pub avg_pages_per_job: f64,
    pub total_bytes: u64,
    pub uptime_secs: u64,
    pub completed_jobs: u64,
    pub canceled_jobs: u64,
    pub aborted_jobs: u64,
}

// ═══════════════════════════════════════════════════════════════════════
// Jobs
// ═══════════════════════════════════════════════════════════════════════

/// IPP job-state values (RFC 2911 §4.3.7).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum JobState {
    Pending = 3,
    PendingHeld = 4,
    Processing = 5,
    ProcessingStopped = 6,
    Canceled = 7,
    Aborted = 8,
    Completed = 9,
}

impl JobState {
    pub fn from_ipp(value: i32) -> Self {
        match value {
            3 => Self::Pending,
            4 => Self::PendingHeld,
            5 => Self::Processing,
            6 => Self::ProcessingStopped,
            7 => Self::Canceled,
            8 => Self::Aborted,
            9 => Self::Completed,
            _ => Self::Pending,
        }
    }

    pub fn is_terminal(&self) -> bool {
        matches!(self, Self::Canceled | Self::Aborted | Self::Completed)
    }
}

/// Comprehensive job information.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JobInfo {
    pub id: u32,
    pub name: String,
    pub state: JobState,
    #[serde(default)]
    pub state_reasons: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user: Option<String>,
    pub printer_uri: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub printer_name: Option<String>,
    pub created_at: DateTime<Utc>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub processing_at: Option<DateTime<Utc>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completed_at: Option<DateTime<Utc>>,
    pub pages_completed: u32,
    pub copies: u32,
    pub priority: u32,
    pub size_bytes: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub media: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sides: Option<Sides>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub quality: Option<PrintQuality>,
}

/// Which jobs to list.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum WhichJobs {
    /// All non-completed jobs.
    NotCompleted,
    /// Only completed jobs.
    Completed,
    /// All jobs.
    All,
}

impl WhichJobs {
    pub fn as_ipp_keyword(&self) -> &'static str {
        match self {
            Self::NotCompleted => "not-completed",
            Self::Completed => "completed",
            Self::All => "all",
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════
// Print Options
// ═══════════════════════════════════════════════════════════════════════

/// Sides (duplex) setting.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Sides {
    OneSided,
    TwoSidedLongEdge,
    TwoSidedShortEdge,
}

impl Sides {
    pub fn as_ipp_keyword(&self) -> &'static str {
        match self {
            Self::OneSided => "one-sided",
            Self::TwoSidedLongEdge => "two-sided-long-edge",
            Self::TwoSidedShortEdge => "two-sided-short-edge",
        }
    }
}

/// Print quality.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PrintQuality {
    Draft = 3,
    Normal = 4,
    High = 5,
}

impl PrintQuality {
    pub fn as_ipp_enum(&self) -> i32 {
        *self as i32
    }
}

/// Orientation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Orientation {
    Portrait = 3,
    Landscape = 4,
    ReverseLandscape = 5,
    ReversePortrait = 6,
}

impl Orientation {
    pub fn as_ipp_enum(&self) -> i32 {
        *self as i32
    }
}

/// Color mode.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ColorMode {
    Auto,
    Color,
    Monochrome,
}

impl ColorMode {
    pub fn as_ipp_keyword(&self) -> &'static str {
        match self {
            Self::Auto => "auto",
            Self::Color => "color",
            Self::Monochrome => "monochrome",
        }
    }
}

/// Finishing operations.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Finishing {
    None = 3,
    Staple = 4,
    Punch = 5,
    Cover = 6,
    Bind = 7,
    SaddleStitch = 8,
    EdgeStitch = 9,
    FoldAccordion = 10,
    FoldDoubleGate = 11,
    FoldHalf = 12,
}

/// All options that can be attached to a print job.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrintOptions {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub copies: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub media: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sides: Option<Sides>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub print_quality: Option<PrintQuality>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub orientation: Option<Orientation>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color_mode: Option<ColorMode>,
    /// Page ranges, e.g. "1-5,8,11-13".
    #[serde(skip_serializing_if = "Option::is_none")]
    pub page_ranges: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fit_to_page: Option<bool>,
    /// Number-up (N pages per physical sheet).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub number_up: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub media_source: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output_bin: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub finishings: Vec<Finishing>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub job_priority: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub job_name: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════
// Printer Classes
// ═══════════════════════════════════════════════════════════════════════

/// A CUPS printer class (a logical group of printers).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrinterClass {
    pub name: String,
    pub member_names: Vec<String>,
    pub member_uris: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub location: Option<String>,
    pub state: PrinterState,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub state_message: Option<String>,
    pub is_accepting: bool,
    pub is_shared: bool,
}

/// Arguments for modifying a class.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModifyClassArgs {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub member_names: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub location: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub shared: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub accepting: Option<bool>,
}

// ═══════════════════════════════════════════════════════════════════════
// PPD / Drivers
// ═══════════════════════════════════════════════════════════════════════

/// Metadata about a PPD file available on the server.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PpdInfo {
    pub name: String,
    pub make: String,
    pub make_model: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub device_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub natural_language: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ppd_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model_number: Option<i32>,
}

/// A filter for listing PPDs.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PpdFilter {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub make: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub make_model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub device_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub language: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub product: Option<String>,
}

/// A single option choice within a PPD file.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PpdChoice {
    pub keyword: String,
    pub text: String,
    pub is_default: bool,
}

/// A configurable option parsed from a PPD file.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PpdOption {
    pub keyword: String,
    pub text: String,
    pub group: String,
    pub choices: Vec<PpdChoice>,
    pub default_choice: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ui_type: Option<String>,
}

/// Full PPD content: both the raw text and parsed options.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PpdContent {
    pub raw: String,
    pub options: Vec<PpdOption>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub nickname: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub manufacturer: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model_name: Option<String>,
}

/// Driver information.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DriverInfo {
    pub name: String,
    pub description: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub device_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub make_model: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════
// IPP Attributes
// ═══════════════════════════════════════════════════════════════════════

/// An IPP attribute value.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "type", content = "value")]
pub enum IppAttributeValue {
    Integer(i32),
    Boolean(bool),
    Enum(i32),
    Text(String),
    Name(String),
    Keyword(String),
    Uri(String),
    Charset(String),
    NaturalLanguage(String),
    DateTime(String),
    Resolution { cross_feed: i32, feed: i32, units: i32 },
    RangeOfInteger { lower: i32, upper: i32 },
    OctetString(Vec<u8>),
    Collection(HashMap<String, IppAttributeValue>),
    SetOf(Vec<IppAttributeValue>),
    Unknown(Vec<u8>),
}

/// A single IPP attribute (name + one or more values).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IppAttribute {
    pub name: String,
    pub values: Vec<IppAttributeValue>,
}

/// IPP status codes (RFC 8011 §4.1.4.1).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct IppStatusCode(pub u16);

impl IppStatusCode {
    pub const SUCCESSFUL_OK: u16                          = 0x0000;
    pub const SUCCESSFUL_OK_IGNORED:  u16                 = 0x0001;
    pub const SUCCESSFUL_OK_CONFLICTING_ATTRS: u16        = 0x0002;
    pub const CLIENT_ERROR_BAD_REQUEST: u16               = 0x0400;
    pub const CLIENT_ERROR_FORBIDDEN: u16                 = 0x0401;
    pub const CLIENT_ERROR_NOT_AUTHENTICATED: u16         = 0x0402;
    pub const CLIENT_ERROR_NOT_AUTHORIZED: u16            = 0x0403;
    pub const CLIENT_ERROR_NOT_POSSIBLE: u16              = 0x0404;
    pub const CLIENT_ERROR_TIMEOUT: u16                   = 0x0405;
    pub const CLIENT_ERROR_NOT_FOUND: u16                 = 0x0406;
    pub const CLIENT_ERROR_GONE: u16                      = 0x0407;
    pub const CLIENT_ERROR_TOO_MANY_REQUESTS: u16         = 0x040C;
    pub const SERVER_ERROR_INTERNAL: u16                  = 0x0500;
    pub const SERVER_ERROR_NOT_ACCEPTING: u16             = 0x0501;
    pub const SERVER_ERROR_BUSY: u16                      = 0x0502;
    pub const SERVER_ERROR_VERSION_NOT_SUPPORTED: u16     = 0x0503;
    pub const SERVER_ERROR_TEMPORARY: u16                 = 0x0504;
    pub const SERVER_ERROR_SERVICE_UNAVAILABLE: u16       = 0x0505;

    pub fn is_success(code: u16) -> bool {
        code < 0x0400
    }

    pub fn is_client_error(code: u16) -> bool {
        (0x0400..0x0500).contains(&code)
    }

    pub fn is_server_error(code: u16) -> bool {
        code >= 0x0500
    }
}

// ═══════════════════════════════════════════════════════════════════════
// Subscriptions / Notifications
// ═══════════════════════════════════════════════════════════════════════

/// IPP notification events.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum NotifyEvent {
    PrinterStateChanged,
    PrinterRestarted,
    PrinterShutdown,
    PrinterStopped,
    PrinterFinishedJob,
    PrinterMediaChanged,
    PrinterAdded,
    PrinterDeleted,
    PrinterModified,
    PrinterQueueOrderChanged,
    JobCreated,
    JobCompleted,
    JobStopped,
    JobProgress,
    JobStateChanged,
    ServerRestarted,
    ServerStarted,
    ServerStopped,
    ServerAudit,
}

impl NotifyEvent {
    pub fn as_ipp_keyword(&self) -> &'static str {
        match self {
            Self::PrinterStateChanged => "printer-state-changed",
            Self::PrinterRestarted => "printer-restarted",
            Self::PrinterShutdown => "printer-shutdown",
            Self::PrinterStopped => "printer-stopped",
            Self::PrinterFinishedJob => "printer-finished-job",
            Self::PrinterMediaChanged => "printer-media-changed",
            Self::PrinterAdded => "printer-added",
            Self::PrinterDeleted => "printer-deleted",
            Self::PrinterModified => "printer-modified",
            Self::PrinterQueueOrderChanged => "printer-queue-order-changed",
            Self::JobCreated => "job-created",
            Self::JobCompleted => "job-completed",
            Self::JobStopped => "job-stopped",
            Self::JobProgress => "job-progress",
            Self::JobStateChanged => "job-state-changed",
            Self::ServerRestarted => "server-restarted",
            Self::ServerStarted => "server-started",
            Self::ServerStopped => "server-stopped",
            Self::ServerAudit => "server-audit",
        }
    }

    pub fn from_keyword(kw: &str) -> Option<Self> {
        match kw {
            "printer-state-changed" => Some(Self::PrinterStateChanged),
            "printer-restarted" => Some(Self::PrinterRestarted),
            "printer-shutdown" => Some(Self::PrinterShutdown),
            "printer-stopped" => Some(Self::PrinterStopped),
            "printer-finished-job" => Some(Self::PrinterFinishedJob),
            "printer-media-changed" => Some(Self::PrinterMediaChanged),
            "printer-added" => Some(Self::PrinterAdded),
            "printer-deleted" => Some(Self::PrinterDeleted),
            "printer-modified" => Some(Self::PrinterModified),
            "printer-queue-order-changed" => Some(Self::PrinterQueueOrderChanged),
            "job-created" => Some(Self::JobCreated),
            "job-completed" => Some(Self::JobCompleted),
            "job-stopped" => Some(Self::JobStopped),
            "job-progress" => Some(Self::JobProgress),
            "job-state-changed" => Some(Self::JobStateChanged),
            "server-restarted" => Some(Self::ServerRestarted),
            "server-started" => Some(Self::ServerStarted),
            "server-stopped" => Some(Self::ServerStopped),
            "server-audit" => Some(Self::ServerAudit),
            _ => None,
        }
    }
}

/// An active IPP subscription.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubscriptionInfo {
    pub id: u32,
    pub events: Vec<NotifyEvent>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub printer_uri: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub job_id: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub recipient_uri: Option<String>,
    pub lease_duration: u32,
    pub created_at: DateTime<Utc>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expiration: Option<DateTime<Utc>>,
}

/// A single notification event received from a subscription.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotificationEvent {
    pub subscription_id: u32,
    pub sequence_number: u32,
    pub event: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub printer_uri: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub printer_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub printer_state: Option<PrinterState>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub job_id: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub job_state: Option<JobState>,
    pub timestamp: DateTime<Utc>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════
// Server Administration
// ═══════════════════════════════════════════════════════════════════════

/// CUPS server information and settings.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CupsServerInfo {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_auth_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_encryption: Option<String>,
    pub share_printers: bool,
    pub remote_admin: bool,
    pub remote_any: bool,
    pub user_cancel_any: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub log_level: Option<String>,
    pub max_clients: u32,
    pub max_jobs: u32,
    pub preserve_job_history: bool,
    pub preserve_job_files: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub server_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_paper_size: Option<String>,
}

/// Type of server log.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum LogType {
    Access,
    Error,
    Page,
}

impl LogType {
    pub fn filename(&self) -> &'static str {
        match self {
            Self::Access => "access_log",
            Self::Error => "error_log",
            Self::Page => "page_log",
        }
    }
}
