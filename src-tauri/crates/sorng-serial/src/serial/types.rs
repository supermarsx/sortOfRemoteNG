//! Shared types for the Serial / RS-232 crate.
//!
//! Covers port configuration, session state, modem types,
//! protocol parameters, logging options, and Tauri event payloads.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Port Configuration
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Standard baud rates.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum BaudRate {
    #[serde(rename = "300")]
    Baud300,
    #[serde(rename = "1200")]
    Baud1200,
    #[serde(rename = "2400")]
    Baud2400,
    #[serde(rename = "4800")]
    Baud4800,
    #[serde(rename = "9600")]
    Baud9600,
    #[serde(rename = "14400")]
    Baud14400,
    #[serde(rename = "19200")]
    Baud19200,
    #[serde(rename = "38400")]
    Baud38400,
    #[serde(rename = "57600")]
    Baud57600,
    #[serde(rename = "115200")]
    Baud115200,
    #[serde(rename = "230400")]
    Baud230400,
    #[serde(rename = "460800")]
    Baud460800,
    #[serde(rename = "921600")]
    Baud921600,
    /// Custom / non-standard baud rate.
    Custom(u32),
}

impl Default for BaudRate {
    fn default() -> Self {
        Self::Baud9600
    }
}

impl BaudRate {
    /// Numeric value of the baud rate.
    pub fn value(&self) -> u32 {
        match self {
            Self::Baud300 => 300,
            Self::Baud1200 => 1200,
            Self::Baud2400 => 2400,
            Self::Baud4800 => 4800,
            Self::Baud9600 => 9600,
            Self::Baud14400 => 14400,
            Self::Baud19200 => 19200,
            Self::Baud38400 => 38400,
            Self::Baud57600 => 57600,
            Self::Baud115200 => 115200,
            Self::Baud230400 => 230400,
            Self::Baud460800 => 460800,
            Self::Baud921600 => 921600,
            Self::Custom(v) => *v,
        }
    }

    /// Try to parse a baud rate from a numeric value.
    pub fn from_value(v: u32) -> Self {
        match v {
            300 => Self::Baud300,
            1200 => Self::Baud1200,
            2400 => Self::Baud2400,
            4800 => Self::Baud4800,
            9600 => Self::Baud9600,
            14400 => Self::Baud14400,
            19200 => Self::Baud19200,
            38400 => Self::Baud38400,
            57600 => Self::Baud57600,
            115200 => Self::Baud115200,
            230400 => Self::Baud230400,
            460800 => Self::Baud460800,
            921600 => Self::Baud921600,
            other => Self::Custom(other),
        }
    }

    /// All standard baud rate values.
    pub fn standard_rates() -> Vec<u32> {
        vec![
            300, 1200, 2400, 4800, 9600, 14400, 19200, 38400, 57600, 115200,
            230400, 460800, 921600,
        ]
    }
}

/// Number of data bits per character.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum DataBits {
    #[serde(rename = "5")]
    Five,
    #[serde(rename = "6")]
    Six,
    #[serde(rename = "7")]
    Seven,
    #[serde(rename = "8")]
    Eight,
}

impl Default for DataBits {
    fn default() -> Self {
        Self::Eight
    }
}

impl DataBits {
    pub fn value(&self) -> u8 {
        match self {
            Self::Five => 5,
            Self::Six => 6,
            Self::Seven => 7,
            Self::Eight => 8,
        }
    }

    pub fn from_value(v: u8) -> Option<Self> {
        match v {
            5 => Some(Self::Five),
            6 => Some(Self::Six),
            7 => Some(Self::Seven),
            8 => Some(Self::Eight),
            _ => None,
        }
    }
}

/// Parity checking mode.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Parity {
    None,
    Odd,
    Even,
    Mark,
    Space,
}

impl Default for Parity {
    fn default() -> Self {
        Self::None
    }
}

impl Parity {
    pub fn label(&self) -> &'static str {
        match self {
            Self::None => "N",
            Self::Odd => "O",
            Self::Even => "E",
            Self::Mark => "M",
            Self::Space => "S",
        }
    }
}

/// Number of stop bits.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum StopBits {
    #[serde(rename = "1")]
    One,
    #[serde(rename = "1.5")]
    OnePointFive,
    #[serde(rename = "2")]
    Two,
}

impl Default for StopBits {
    fn default() -> Self {
        Self::One
    }
}

impl StopBits {
    pub fn label(&self) -> &'static str {
        match self {
            Self::One => "1",
            Self::OnePointFive => "1.5",
            Self::Two => "2",
        }
    }
}

/// Flow control mode.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FlowControl {
    None,
    /// Software flow control (XON/XOFF).
    XonXoff,
    /// Hardware flow control (RTS/CTS).
    RtsCts,
    /// Hardware flow control (DTR/DSR).
    DtrDsr,
}

impl Default for FlowControl {
    fn default() -> Self {
        Self::None
    }
}

/// RS-232 control line state.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ControlLines {
    /// Data Terminal Ready (output).
    pub dtr: bool,
    /// Request To Send (output).
    pub rts: bool,
    /// Clear To Send (input).
    pub cts: bool,
    /// Data Set Ready (input).
    pub dsr: bool,
    /// Ring Indicator (input).
    pub ri: bool,
    /// Data Carrier Detect (input).
    pub dcd: bool,
}

impl Default for ControlLines {
    fn default() -> Self {
        Self {
            dtr: false,
            rts: false,
            cts: false,
            dsr: false,
            ri: false,
            dcd: false,
        }
    }
}

/// Complete serial port configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SerialConfig {
    /// Port name (e.g. `COM3`, `/dev/ttyUSB0`).
    pub port_name: String,

    /// Baud rate.
    #[serde(default)]
    pub baud_rate: BaudRate,

    /// Data bits per character.
    #[serde(default)]
    pub data_bits: DataBits,

    /// Parity mode.
    #[serde(default)]
    pub parity: Parity,

    /// Stop bits.
    #[serde(default)]
    pub stop_bits: StopBits,

    /// Flow control mode.
    #[serde(default)]
    pub flow_control: FlowControl,

    /// Read timeout in milliseconds (0 = no timeout).
    #[serde(default = "default_read_timeout")]
    pub read_timeout_ms: u64,

    /// Write timeout in milliseconds (0 = no timeout).
    #[serde(default = "default_write_timeout")]
    pub write_timeout_ms: u64,

    /// Size of the receive buffer in bytes.
    #[serde(default = "default_rx_buffer_size")]
    pub rx_buffer_size: usize,

    /// Size of the transmit buffer in bytes.
    #[serde(default = "default_tx_buffer_size")]
    pub tx_buffer_size: usize,

    /// Assert DTR on open.
    #[serde(default = "default_true")]
    pub dtr_on_open: bool,

    /// Assert RTS on open.
    #[serde(default = "default_true")]
    pub rts_on_open: bool,

    /// Line ending to append on send commands.
    #[serde(default)]
    pub line_ending: LineEnding,

    /// Optional label / description.
    #[serde(default)]
    pub label: Option<String>,

    /// Inter-character delay in milliseconds (0 = none).
    #[serde(default)]
    pub char_delay_ms: u64,

    /// Enable local echo.
    #[serde(default)]
    pub local_echo: bool,
}

fn default_read_timeout() -> u64 {
    100
}
fn default_write_timeout() -> u64 {
    1000
}
fn default_rx_buffer_size() -> usize {
    4096
}
fn default_tx_buffer_size() -> usize {
    4096
}
fn default_true() -> bool {
    true
}

impl Default for SerialConfig {
    fn default() -> Self {
        Self {
            port_name: String::new(),
            baud_rate: BaudRate::default(),
            data_bits: DataBits::default(),
            parity: Parity::default(),
            stop_bits: StopBits::default(),
            flow_control: FlowControl::default(),
            read_timeout_ms: default_read_timeout(),
            write_timeout_ms: default_write_timeout(),
            rx_buffer_size: default_rx_buffer_size(),
            tx_buffer_size: default_tx_buffer_size(),
            dtr_on_open: true,
            rts_on_open: true,
            line_ending: LineEnding::default(),
            label: None,
            char_delay_ms: 0,
            local_echo: false,
        }
    }
}

impl SerialConfig {
    /// Shorthand notation (e.g. "9600-8N1").
    pub fn shorthand(&self) -> String {
        format!(
            "{}-{}{}{}",
            self.baud_rate.value(),
            self.data_bits.value(),
            self.parity.label(),
            self.stop_bits.label()
        )
    }
}

/// Line ending style.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum LineEnding {
    /// No line ending appended.
    None,
    /// Carriage Return (`\r`).
    Cr,
    /// Line Feed (`\n`).
    Lf,
    /// Carriage Return + Line Feed (`\r\n`).
    CrLf,
}

impl Default for LineEnding {
    fn default() -> Self {
        Self::CrLf
    }
}

impl LineEnding {
    /// The byte sequence for this line ending.
    pub fn bytes(&self) -> &[u8] {
        match self {
            Self::None => b"",
            Self::Cr => b"\r",
            Self::Lf => b"\n",
            Self::CrLf => b"\r\n",
        }
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Port Information
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Information about a discovered serial port.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SerialPortInfo {
    /// System port name (e.g. `COM3`, `/dev/ttyUSB0`).
    pub port_name: String,

    /// Port type.
    pub port_type: PortType,

    /// Human-readable description from the driver.
    pub description: Option<String>,

    /// Manufacturer string.
    pub manufacturer: Option<String>,

    /// USB Vendor ID (if USB-serial adapter).
    pub vid: Option<u16>,

    /// USB Product ID (if USB-serial adapter).
    pub pid: Option<u16>,

    /// USB serial number.
    pub serial_number: Option<String>,

    /// Friendly / display name.
    pub display_name: String,

    /// Whether the port appears to be in use.
    pub in_use: bool,
}

/// Type of serial port.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PortType {
    /// USB to serial adapter.
    UsbSerial,
    /// Native / built-in serial port.
    Native,
    /// PCI / PCI-Express serial card.
    Pci,
    /// Bluetooth serial profile (RFCOMM).
    Bluetooth,
    /// Virtual / pseudo-terminal pair.
    Virtual,
    /// Unknown type.
    Unknown,
}

impl PortType {
    pub fn label(&self) -> &'static str {
        match self {
            Self::UsbSerial => "USB-Serial",
            Self::Native => "Native",
            Self::Pci => "PCI",
            Self::Bluetooth => "Bluetooth",
            Self::Virtual => "Virtual",
            Self::Unknown => "Unknown",
        }
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Session
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// State of a serial session.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SessionState {
    Connecting,
    Connected,
    Disconnected,
    Error,
}

/// Information about a live serial session.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SerialSession {
    /// Unique session ID.
    pub id: String,
    /// Port name.
    pub port_name: String,
    /// Shorthand config string.
    pub config_shorthand: String,
    /// Current state.
    pub state: SessionState,
    /// Optional label.
    pub label: Option<String>,
    /// When the session was opened.
    pub connected_at: DateTime<Utc>,
    /// Bytes received total.
    pub bytes_rx: u64,
    /// Bytes transmitted total.
    pub bytes_tx: u64,
    /// Current control line state.
    pub control_lines: ControlLines,
}

/// Statistics for a session.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionStats {
    pub bytes_rx: u64,
    pub bytes_tx: u64,
    pub frames_rx: u64,
    pub frames_tx: u64,
    pub errors_rx: u64,
    pub errors_tx: u64,
    pub overruns: u64,
    pub parity_errors: u64,
    pub framing_errors: u64,
    pub break_count: u64,
    pub uptime_seconds: u64,
}

impl Default for SessionStats {
    fn default() -> Self {
        Self {
            bytes_rx: 0,
            bytes_tx: 0,
            frames_rx: 0,
            frames_tx: 0,
            errors_rx: 0,
            errors_tx: 0,
            overruns: 0,
            parity_errors: 0,
            framing_errors: 0,
            break_count: 0,
            uptime_seconds: 0,
        }
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Modem / AT Commands
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Hayes AT command response code.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ModemResponseCode {
    Ok,
    Connect,
    Ring,
    NoCarrier,
    Error,
    NoDialtone,
    Busy,
    NoAnswer,
    ConnectWithSpeed(u32),
    Unknown(String),
}

impl ModemResponseCode {
    /// Parse a modem response line into a code.
    pub fn parse(line: &str) -> Self {
        let trimmed = line.trim().to_uppercase();
        match trimmed.as_str() {
            "OK" | "0" => Self::Ok,
            "CONNECT" | "1" => Self::Connect,
            "RING" | "2" => Self::Ring,
            "NO CARRIER" | "3" => Self::NoCarrier,
            "ERROR" | "4" => Self::Error,
            "NO DIALTONE" | "6" => Self::NoDialtone,
            "BUSY" | "7" => Self::Busy,
            "NO ANSWER" | "8" => Self::NoAnswer,
            _ => {
                if let Some(speed_str) = trimmed.strip_prefix("CONNECT ") {
                    if let Ok(speed) = speed_str.trim().parse::<u32>() {
                        return Self::ConnectWithSpeed(speed);
                    }
                }
                Self::Unknown(line.trim().to_string())
            }
        }
    }

    pub fn is_ok(&self) -> bool {
        matches!(self, Self::Ok)
    }

    pub fn is_error(&self) -> bool {
        matches!(
            self,
            Self::Error | Self::NoCarrier | Self::NoDialtone | Self::Busy | Self::NoAnswer
        )
    }

    pub fn is_connect(&self) -> bool {
        matches!(self, Self::Connect | Self::ConnectWithSpeed(_))
    }
}

/// Modem init string preset.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModemProfile {
    pub name: String,
    pub init_string: String,
    pub dial_prefix: String,
    pub hangup_string: String,
    pub reset_string: String,
    pub description: Option<String>,
}

impl Default for ModemProfile {
    fn default() -> Self {
        Self {
            name: "Generic Hayes".to_string(),
            init_string: "ATZ".to_string(),
            dial_prefix: "ATDT".to_string(),
            hangup_string: "+++ATH0".to_string(),
            reset_string: "ATZ".to_string(),
            description: Some("Standard Hayes-compatible modem".to_string()),
        }
    }
}

/// Result of an AT command exchange.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AtCommandResult {
    /// The AT command sent.
    pub command: String,
    /// Full raw response text.
    pub raw_response: String,
    /// Parsed response lines (excluding echo and blank lines).
    pub response_lines: Vec<String>,
    /// Final result code.
    pub result_code: ModemResponseCode,
    /// Elapsed time in milliseconds.
    pub elapsed_ms: u64,
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  File Transfer Protocols
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// File transfer protocol.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TransferProtocol {
    Xmodem,
    XmodemCrc,
    Xmodem1k,
    Ymodem,
    YmodemG,
    Zmodem,
    Ascii,
    Kermit,
    Raw,
}

impl Default for TransferProtocol {
    fn default() -> Self {
        Self::Zmodem
    }
}

impl TransferProtocol {
    pub fn label(&self) -> &'static str {
        match self {
            Self::Xmodem => "XMODEM",
            Self::XmodemCrc => "XMODEM-CRC",
            Self::Xmodem1k => "XMODEM-1K",
            Self::Ymodem => "YMODEM",
            Self::YmodemG => "YMODEM-G",
            Self::Zmodem => "ZMODEM",
            Self::Ascii => "ASCII",
            Self::Kermit => "Kermit",
            Self::Raw => "Raw",
        }
    }

    pub fn block_size(&self) -> usize {
        match self {
            Self::Xmodem | Self::XmodemCrc => 128,
            Self::Xmodem1k | Self::Ymodem | Self::YmodemG => 1024,
            Self::Zmodem => 1024,
            Self::Kermit => 94,
            Self::Ascii | Self::Raw => 0,
        }
    }
}

/// Direction of a file transfer.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TransferDirection {
    Send,
    Receive,
}

/// State of a file transfer.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TransferState {
    Pending,
    InProgress,
    Completed,
    Failed,
    Cancelled,
}

/// Progress information for a file transfer.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferProgress {
    pub transfer_id: String,
    pub session_id: String,
    pub file_name: String,
    pub file_size: u64,
    pub bytes_transferred: u64,
    pub block_number: u32,
    pub total_blocks: u32,
    pub protocol: TransferProtocol,
    pub direction: TransferDirection,
    pub state: TransferState,
    pub error_count: u32,
    pub retry_count: u32,
    pub bytes_per_second: f64,
    pub elapsed_ms: u64,
    pub eta_ms: u64,
    pub percent_complete: f64,
}

/// Configuration for a file transfer.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferConfig {
    pub protocol: TransferProtocol,
    pub direction: TransferDirection,
    pub file_path: String,
    #[serde(default)]
    pub overwrite: bool,
    #[serde(default = "default_max_retries")]
    pub max_retries: u32,
    #[serde(default = "default_timeout_ms")]
    pub timeout_ms: u64,
}

fn default_max_retries() -> u32 {
    10
}
fn default_timeout_ms() -> u64 {
    30000
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Logging
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Format for session logging.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum LogFormat {
    /// Plain text (decoded data only).
    PlainText,
    /// Hex dump format (offset + hex + ASCII).
    HexDump,
    /// Timestamped lines.
    Timestamped,
    /// Raw binary capture.
    RawBinary,
    /// CSV format (timestamp, direction, hex, ascii).
    Csv,
}

impl Default for LogFormat {
    fn default() -> Self {
        Self::PlainText
    }
}

/// Configuration for session logging.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogConfig {
    /// Enable logging.
    pub enabled: bool,
    /// Log file path.
    pub file_path: String,
    /// Log format.
    #[serde(default)]
    pub format: LogFormat,
    /// Include timestamps.
    #[serde(default = "default_true")]
    pub timestamps: bool,
    /// Log direction indicators (TX/RX).
    #[serde(default = "default_true")]
    pub direction_markers: bool,
    /// Append to existing file.
    #[serde(default)]
    pub append: bool,
    /// Maximum file size in bytes (0 = unlimited).
    #[serde(default)]
    pub max_file_size: u64,
    /// Rotate when max size reached.
    #[serde(default)]
    pub rotate: bool,
}

impl Default for LogConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            file_path: String::new(),
            format: LogFormat::default(),
            timestamps: true,
            direction_markers: true,
            append: false,
            max_file_size: 0,
            rotate: false,
        }
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Macros / Scripting
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// A scripted send/expect step.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScriptStep {
    /// Text to send.
    pub send: Option<String>,
    /// Text or regex to wait for.
    pub expect: Option<String>,
    /// Whether `expect` is a regex pattern.
    #[serde(default)]
    pub expect_regex: bool,
    /// Timeout for this step in milliseconds.
    #[serde(default = "default_step_timeout")]
    pub timeout_ms: u64,
    /// Delay before this step in milliseconds.
    #[serde(default)]
    pub delay_ms: u64,
}

fn default_step_timeout() -> u64 {
    5000
}

/// A named script / macro for a serial session.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SerialScript {
    pub name: String,
    pub description: Option<String>,
    pub steps: Vec<ScriptStep>,
    #[serde(default)]
    pub repeat_count: u32,
}

/// Result of a script execution.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScriptResult {
    pub script_name: String,
    pub success: bool,
    pub steps_completed: usize,
    pub total_steps: usize,
    pub captured_output: Vec<String>,
    pub error: Option<String>,
    pub elapsed_ms: u64,
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Tauri Event Payloads
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Output data event (serial → frontend).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SerialOutputEvent {
    pub session_id: String,
    /// Base64-encoded raw bytes.
    pub data: String,
    /// UTF-8 lossy decoded text (for display).
    pub text: String,
}

/// Error event.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SerialErrorEvent {
    pub session_id: String,
    pub message: String,
    pub recoverable: bool,
}

/// Session closed event.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SerialClosedEvent {
    pub session_id: String,
    pub reason: String,
}

/// Control line change event.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ControlLineChangeEvent {
    pub session_id: String,
    pub lines: ControlLines,
}

/// Transfer progress event.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferProgressEvent {
    pub session_id: String,
    pub progress: TransferProgress,
}

/// Modem event.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModemEvent {
    pub session_id: String,
    pub response: AtCommandResult,
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Errors
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Error kinds specific to serial operations.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SerialErrorKind {
    PortNotFound,
    PortBusy,
    PermissionDenied,
    InvalidConfig,
    Timeout,
    IoError,
    FramingError,
    ParityError,
    OverrunError,
    BreakCondition,
    TransferFailed,
    ModemError,
    SessionNotFound,
    AlreadyConnected,
    NotConnected,
    ProtocolError,
    ScriptError,
}

/// Structured serial error.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SerialError {
    pub kind: SerialErrorKind,
    pub message: String,
    pub port_name: Option<String>,
    pub session_id: Option<String>,
}

impl std::fmt::Display for SerialError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "[{:?}] {}", self.kind, self.message)
    }
}

impl SerialError {
    pub fn new(kind: SerialErrorKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
            port_name: None,
            session_id: None,
        }
    }

    pub fn with_port(mut self, port: impl Into<String>) -> Self {
        self.port_name = Some(port.into());
        self
    }

    pub fn with_session(mut self, id: impl Into<String>) -> Self {
        self.session_id = Some(id.into());
        self
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_baud_rate_value_roundtrip() {
        for rate in BaudRate::standard_rates() {
            let br = BaudRate::from_value(rate);
            assert_eq!(br.value(), rate);
        }
        assert_eq!(BaudRate::Custom(250000).value(), 250000);
    }

    #[test]
    fn test_data_bits_roundtrip() {
        for v in [5, 6, 7, 8] {
            let db = DataBits::from_value(v).unwrap();
            assert_eq!(db.value(), v);
        }
        assert!(DataBits::from_value(9).is_none());
    }

    #[test]
    fn test_config_shorthand() {
        let cfg = SerialConfig {
            port_name: "COM3".to_string(),
            baud_rate: BaudRate::Baud115200,
            data_bits: DataBits::Eight,
            parity: Parity::None,
            stop_bits: StopBits::One,
            ..Default::default()
        };
        assert_eq!(cfg.shorthand(), "115200-8N1");
    }

    #[test]
    fn test_config_shorthand_7e1() {
        let cfg = SerialConfig {
            port_name: "COM1".to_string(),
            baud_rate: BaudRate::Baud19200,
            data_bits: DataBits::Seven,
            parity: Parity::Even,
            stop_bits: StopBits::One,
            ..Default::default()
        };
        assert_eq!(cfg.shorthand(), "19200-7E1");
    }

    #[test]
    fn test_line_ending_bytes() {
        assert_eq!(LineEnding::None.bytes(), b"");
        assert_eq!(LineEnding::Cr.bytes(), b"\r");
        assert_eq!(LineEnding::Lf.bytes(), b"\n");
        assert_eq!(LineEnding::CrLf.bytes(), b"\r\n");
    }

    #[test]
    fn test_modem_response_parse_ok() {
        assert_eq!(ModemResponseCode::parse("OK"), ModemResponseCode::Ok);
        assert_eq!(ModemResponseCode::parse("0"), ModemResponseCode::Ok);
    }

    #[test]
    fn test_modem_response_parse_connect_speed() {
        let code = ModemResponseCode::parse("CONNECT 57600");
        assert_eq!(code, ModemResponseCode::ConnectWithSpeed(57600));
        assert!(code.is_connect());
    }

    #[test]
    fn test_modem_response_parse_error_codes() {
        assert!(ModemResponseCode::parse("NO CARRIER").is_error());
        assert!(ModemResponseCode::parse("BUSY").is_error());
        assert!(ModemResponseCode::parse("NO DIALTONE").is_error());
        assert!(ModemResponseCode::parse("NO ANSWER").is_error());
        assert!(ModemResponseCode::parse("ERROR").is_error());
    }

    #[test]
    fn test_serial_error_builder() {
        let err = SerialError::new(SerialErrorKind::PortNotFound, "COM99 not found")
            .with_port("COM99")
            .with_session("abc-123");
        assert_eq!(err.kind, SerialErrorKind::PortNotFound);
        assert_eq!(err.port_name.as_deref(), Some("COM99"));
        assert_eq!(err.session_id.as_deref(), Some("abc-123"));
        assert!(err.to_string().contains("COM99 not found"));
    }

    #[test]
    fn test_transfer_protocol_block_size() {
        assert_eq!(TransferProtocol::Xmodem.block_size(), 128);
        assert_eq!(TransferProtocol::XmodemCrc.block_size(), 128);
        assert_eq!(TransferProtocol::Xmodem1k.block_size(), 1024);
        assert_eq!(TransferProtocol::Ymodem.block_size(), 1024);
        assert_eq!(TransferProtocol::Zmodem.block_size(), 1024);
    }

    #[test]
    fn test_serde_config_roundtrip() {
        let cfg = SerialConfig {
            port_name: "COM4".to_string(),
            baud_rate: BaudRate::Baud115200,
            data_bits: DataBits::Eight,
            parity: Parity::None,
            stop_bits: StopBits::One,
            flow_control: FlowControl::RtsCts,
            ..Default::default()
        };
        let json = serde_json::to_string(&cfg).unwrap();
        let back: SerialConfig = serde_json::from_str(&json).unwrap();
        assert_eq!(back.port_name, "COM4");
        assert_eq!(back.baud_rate, BaudRate::Baud115200);
        assert_eq!(back.flow_control, FlowControl::RtsCts);
    }

    #[test]
    fn test_session_stats_default() {
        let stats = SessionStats::default();
        assert_eq!(stats.bytes_rx, 0);
        assert_eq!(stats.bytes_tx, 0);
        assert_eq!(stats.errors_rx, 0);
    }

    #[test]
    fn test_port_type_label() {
        assert_eq!(PortType::UsbSerial.label(), "USB-Serial");
        assert_eq!(PortType::Native.label(), "Native");
        assert_eq!(PortType::Bluetooth.label(), "Bluetooth");
    }

    #[test]
    fn test_control_lines_default() {
        let cl = ControlLines::default();
        assert!(!cl.dtr);
        assert!(!cl.rts);
        assert!(!cl.cts);
        assert!(!cl.dsr);
        assert!(!cl.ri);
        assert!(!cl.dcd);
    }

    #[test]
    fn test_default_config_values() {
        let cfg = SerialConfig::default();
        assert_eq!(cfg.baud_rate, BaudRate::Baud9600);
        assert_eq!(cfg.data_bits, DataBits::Eight);
        assert_eq!(cfg.parity, Parity::None);
        assert_eq!(cfg.stop_bits, StopBits::One);
        assert_eq!(cfg.flow_control, FlowControl::None);
        assert!(cfg.dtr_on_open);
        assert!(cfg.rts_on_open);
        assert_eq!(cfg.line_ending, LineEnding::CrLf);
        assert_eq!(cfg.read_timeout_ms, 100);
    }
}
