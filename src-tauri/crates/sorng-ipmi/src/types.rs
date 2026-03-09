//! Comprehensive IPMI data types — sessions, chassis, SDR, SEL, FRU, SOL,
//! watchdog, LAN config, user management, PEF, channels, and wire-protocol types.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

// ═══════════════════════════════════════════════════════════════════════
// Protocol-level enums
// ═══════════════════════════════════════════════════════════════════════

/// IPMI protocol version.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
pub enum IpmiVersion {
    /// IPMI 1.5 (RMCP, pre-RAKP authentication)
    V15,
    /// IPMI 2.0 / RMCP+ (RAKP handshake, encrypted payloads)
    #[default]
    V20,
}

/// Authentication type for IPMI 1.5 sessions.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[repr(u8)]
#[derive(Default)]
pub enum AuthType {
    #[default]
    None = 0x00,
    MD2 = 0x01,
    MD5 = 0x02,
    Password = 0x04,
    OEM = 0x05,
}

impl AuthType {
    pub fn from_byte(b: u8) -> Self {
        match b {
            0x00 => Self::None,
            0x01 => Self::MD2,
            0x02 => Self::MD5,
            0x04 => Self::Password,
            0x05 => Self::OEM,
            _ => Self::None,
        }
    }
}

/// IPMI privilege level.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[repr(u8)]
#[derive(Default)]
pub enum PrivilegeLevel {
    Callback = 0x01,
    User = 0x02,
    Operator = 0x03,
    #[default]
    Administrator = 0x04,
    Oem = 0x05,
}

impl PrivilegeLevel {
    pub fn from_byte(b: u8) -> Self {
        match b & 0x0F {
            0x01 => Self::Callback,
            0x02 => Self::User,
            0x03 => Self::Operator,
            0x04 => Self::Administrator,
            0x05 => Self::Oem,
            _ => Self::User,
        }
    }
}

/// IPMI Network Function codes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[repr(u8)]
pub enum NetFunction {
    Chassis = 0x00,
    ChassisResponse = 0x01,
    Bridge = 0x02,
    BridgeResponse = 0x03,
    SensorEvent = 0x04,
    SensorEventResponse = 0x05,
    App = 0x06,
    AppResponse = 0x07,
    Firmware = 0x08,
    FirmwareResponse = 0x09,
    Storage = 0x0A,
    StorageResponse = 0x0B,
    Transport = 0x0C,
    TransportResponse = 0x0D,
    GroupExt = 0x2C,
    GroupExtResponse = 0x2D,
    OEM = 0x2E,
    OEMResponse = 0x2F,
}

impl NetFunction {
    pub fn from_byte(b: u8) -> Option<Self> {
        match b {
            0x00 => Some(Self::Chassis),
            0x01 => Some(Self::ChassisResponse),
            0x02 => Some(Self::Bridge),
            0x03 => Some(Self::BridgeResponse),
            0x04 => Some(Self::SensorEvent),
            0x05 => Some(Self::SensorEventResponse),
            0x06 => Some(Self::App),
            0x07 => Some(Self::AppResponse),
            0x08 => Some(Self::Firmware),
            0x09 => Some(Self::FirmwareResponse),
            0x0A => Some(Self::Storage),
            0x0B => Some(Self::StorageResponse),
            0x0C => Some(Self::Transport),
            0x0D => Some(Self::TransportResponse),
            0x2C => Some(Self::GroupExt),
            0x2D => Some(Self::GroupExtResponse),
            0x2E => Some(Self::OEM),
            0x2F => Some(Self::OEMResponse),
            _ => None,
        }
    }

    pub fn as_byte(self) -> u8 {
        self as u8
    }
}

// ═══════════════════════════════════════════════════════════════════════
// Session types
// ═══════════════════════════════════════════════════════════════════════

/// Configuration for establishing an IPMI session.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IpmiSessionConfig {
    /// BMC hostname or IP address.
    pub host: String,
    /// IPMI port (default 623).
    #[serde(default = "default_ipmi_port")]
    pub port: u16,
    /// Username for authentication.
    pub username: String,
    /// Password for authentication.
    pub password: String,
    /// IPMI version to use.
    #[serde(default)]
    pub version: IpmiVersion,
    /// Authentication type (IPMI 1.5).
    #[serde(default)]
    pub auth_type: AuthType,
    /// Requested privilege level.
    #[serde(default)]
    pub privilege: PrivilegeLevel,
    /// Cipher suite ID for IPMI 2.0 (0-17, default 3).
    #[serde(default = "default_cipher_suite")]
    pub cipher_suite: u8,
    /// Command timeout in seconds.
    #[serde(default = "default_timeout")]
    pub timeout_secs: u64,
    /// Number of retries on timeout.
    #[serde(default = "default_retries")]
    pub retries: u8,
}

fn default_ipmi_port() -> u16 {
    623
}
fn default_cipher_suite() -> u8 {
    3
}
fn default_timeout() -> u64 {
    5
}
fn default_retries() -> u8 {
    3
}

/// Session state machine.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum SessionState {
    Disconnected,
    Authenticating,
    Active,
    Error,
}

/// An active IPMI session.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IpmiSession {
    /// Unique session identifier (our internal UUID).
    pub id: String,
    /// Configuration used to create this session.
    pub config: IpmiSessionConfig,
    /// Current session state.
    pub state: SessionState,
    /// BMC-assigned session ID (wire protocol).
    pub bmc_session_id: u32,
    /// Our local session sequence number.
    pub session_seq: u32,
    /// Remote console sequence number.
    pub rq_seq: u8,
    /// Session creation timestamp.
    pub created_at: DateTime<Utc>,
    /// Last activity timestamp.
    pub last_activity: DateTime<Utc>,
    /// Negotiated auth type (IPMI 1.5).
    pub negotiated_auth: AuthType,
    /// Active privilege level.
    pub active_privilege: PrivilegeLevel,
    /// Authentication key material for IPMI 1.5 (auth_code).
    #[serde(skip)]
    pub auth_code: Vec<u8>,
    /// Session integrity key (IPMI 2.0 / RMCP+).
    #[serde(skip)]
    pub sik: Vec<u8>,
    /// K1 — integrity key derived from SIK.
    #[serde(skip)]
    pub k1: Vec<u8>,
    /// K2 — confidentiality key derived from SIK.
    #[serde(skip)]
    pub k2: Vec<u8>,
    /// Managed system random number (IPMI 2.0).
    #[serde(skip)]
    pub managed_system_random: Vec<u8>,
    /// Remote console random number (IPMI 2.0).
    #[serde(skip)]
    pub remote_console_random: Vec<u8>,
    /// Managed system GUID (IPMI 2.0).
    #[serde(skip)]
    pub managed_system_guid: Vec<u8>,
}

/// Summary info about a session for listing.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IpmiSessionInfo {
    pub id: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub state: SessionState,
    pub version: IpmiVersion,
    pub privilege: PrivilegeLevel,
    pub created_at: DateTime<Utc>,
    pub last_activity: DateTime<Utc>,
}

// ═══════════════════════════════════════════════════════════════════════
// Raw command types
// ═══════════════════════════════════════════════════════════════════════

/// An arbitrary IPMI request.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RawIpmiRequest {
    /// Network function code.
    pub netfn: u8,
    /// Command code.
    pub cmd: u8,
    /// Optional request data payload.
    #[serde(default)]
    pub data: Vec<u8>,
}

/// An IPMI response.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RawIpmiResponse {
    /// Completion code (0x00 = success).
    pub completion_code: u8,
    /// Response data payload.
    pub data: Vec<u8>,
}

/// IPMI completion codes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[repr(u8)]
pub enum CompletionCode {
    Success = 0x00,
    NodeBusy = 0xC0,
    InvalidCommand = 0xC1,
    InvalidForLun = 0xC2,
    Timeout = 0xC3,
    OutOfSpace = 0xC4,
    ReservationCancelled = 0xC5,
    RequestDataTruncated = 0xC6,
    InvalidDataLength = 0xC7,
    DataLengthExceeded = 0xC8,
    ParameterOutOfRange = 0xC9,
    CannotReturnBytes = 0xCA,
    NotPresent = 0xCB,
    InvalidDataField = 0xCC,
    CommandIllegal = 0xCD,
    CannotProvideResponse = 0xCE,
    DuplicateRequest = 0xCF,
    SdrRepoInUpdate = 0xD0,
    FirmwareInUpdate = 0xD1,
    BmcInitializing = 0xD2,
    DestinationUnavailable = 0xD3,
    InsufficientPrivilege = 0xD4,
    NotSupportedInState = 0xD5,
    SubFunctionDisabled = 0xD6,
    Unspecified = 0xFF,
}

impl CompletionCode {
    pub fn from_byte(b: u8) -> Self {
        match b {
            0x00 => Self::Success,
            0xC0 => Self::NodeBusy,
            0xC1 => Self::InvalidCommand,
            0xC2 => Self::InvalidForLun,
            0xC3 => Self::Timeout,
            0xC4 => Self::OutOfSpace,
            0xC5 => Self::ReservationCancelled,
            0xC6 => Self::RequestDataTruncated,
            0xC7 => Self::InvalidDataLength,
            0xC8 => Self::DataLengthExceeded,
            0xC9 => Self::ParameterOutOfRange,
            0xCA => Self::CannotReturnBytes,
            0xCB => Self::NotPresent,
            0xCC => Self::InvalidDataField,
            0xCD => Self::CommandIllegal,
            0xCE => Self::CannotProvideResponse,
            0xCF => Self::DuplicateRequest,
            0xD0 => Self::SdrRepoInUpdate,
            0xD1 => Self::FirmwareInUpdate,
            0xD2 => Self::BmcInitializing,
            0xD3 => Self::DestinationUnavailable,
            0xD4 => Self::InsufficientPrivilege,
            0xD5 => Self::NotSupportedInState,
            0xD6 => Self::SubFunctionDisabled,
            _ => Self::Unspecified,
        }
    }

    pub fn description(self) -> &'static str {
        match self {
            Self::Success => "Command completed normally",
            Self::NodeBusy => "Node busy, retry later",
            Self::InvalidCommand => "Invalid command",
            Self::InvalidForLun => "Command invalid for given LUN",
            Self::Timeout => "Timeout processing command",
            Self::OutOfSpace => "Out of space",
            Self::ReservationCancelled => "Reservation cancelled or invalid",
            Self::RequestDataTruncated => "Request data truncated",
            Self::InvalidDataLength => "Request data length invalid",
            Self::DataLengthExceeded => "Request data field length limit exceeded",
            Self::ParameterOutOfRange => "Parameter out of range",
            Self::CannotReturnBytes => "Cannot return number of requested data bytes",
            Self::NotPresent => "Requested sensor, data, or record not present",
            Self::InvalidDataField => "Invalid data field in request",
            Self::CommandIllegal => "Command illegal for specified sensor/record type",
            Self::CannotProvideResponse => "Command response could not be provided",
            Self::DuplicateRequest => "Cannot execute duplicated request",
            Self::SdrRepoInUpdate => "SDR repository in update mode",
            Self::FirmwareInUpdate => "Device in firmware update mode",
            Self::BmcInitializing => "BMC initialization in progress",
            Self::DestinationUnavailable => "Destination unavailable",
            Self::InsufficientPrivilege => "Insufficient privilege level",
            Self::NotSupportedInState => "Command not supported in present state",
            Self::SubFunctionDisabled => "Sub-function disabled or unavailable",
            Self::Unspecified => "Unspecified error",
        }
    }
}

impl PartialEq<u8> for CompletionCode {
    fn eq(&self, other: &u8) -> bool {
        *self as u8 == *other
    }
}

// ═══════════════════════════════════════════════════════════════════════
// Chassis types
// ═══════════════════════════════════════════════════════════════════════

/// Chassis power control actions.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[repr(u8)]
pub enum ChassisControl {
    PowerDown = 0x00,
    PowerUp = 0x01,
    PowerCycle = 0x02,
    HardReset = 0x03,
    DiagInterrupt = 0x04,
    SoftShutdown = 0x05,
}

impl ChassisControl {
    pub fn from_str_name(s: &str) -> Option<Self> {
        match s.to_lowercase().as_str() {
            "powerdown" | "power_down" | "off" => Some(Self::PowerDown),
            "powerup" | "power_up" | "on" => Some(Self::PowerUp),
            "powercycle" | "power_cycle" | "cycle" => Some(Self::PowerCycle),
            "hardreset" | "hard_reset" | "reset" => Some(Self::HardReset),
            "diaginterrupt" | "diag_interrupt" | "diag" => Some(Self::DiagInterrupt),
            "softshutdown" | "soft_shutdown" | "soft" => Some(Self::SoftShutdown),
            _ => None,
        }
    }
}

/// Chassis power status.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChassisStatus {
    /// System power is on.
    pub power_on: bool,
    /// Power overload detected.
    pub power_overload: bool,
    /// Power interlock active.
    pub power_interlock: bool,
    /// Power fault detected.
    pub power_fault: bool,
    /// Power control fault.
    pub power_control_fault: bool,
    /// Power restore policy.
    pub power_restore_policy: PowerRestorePolicy,
    /// Last power event byte (raw).
    pub last_power_event: u8,
    /// AC power lost.
    pub ac_failed: bool,
    /// Power-down via power overload.
    pub power_down_overload: bool,
    /// Power-down via power interlock.
    pub power_down_interlock: bool,
    /// Power-down via power fault.
    pub power_down_fault: bool,
    /// IPMI-originated power command.
    pub power_down_ipmi: bool,
    /// Chassis intrusion active.
    pub chassis_intrusion: bool,
    /// Front panel lockout active.
    pub front_panel_lockout: bool,
    /// Drive fault detected.
    pub drive_fault: bool,
    /// Cooling/fan fault detected.
    pub cooling_fault: bool,
}

/// Power restore policy.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum PowerRestorePolicy {
    AlwaysOff,
    PreviousState,
    AlwaysOn,
    Unknown,
}

impl PowerRestorePolicy {
    pub fn from_bits(bits: u8) -> Self {
        match bits & 0x03 {
            0 => Self::AlwaysOff,
            1 => Self::PreviousState,
            2 => Self::AlwaysOn,
            _ => Self::Unknown,
        }
    }
}

/// System restart cause.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum RestartCause {
    Unknown,
    ChassisControl,
    ResetPushButton,
    PowerUpPushButton,
    WatchdogExpired,
    Oem,
    AutoPowerOnAlwaysRestore,
    AutoPowerOnRestorePrevious,
    ResetPef,
    PowerCyclePef,
    SoftReset,
    PowerUpRtc,
}

impl RestartCause {
    pub fn from_byte(b: u8) -> Self {
        match b & 0x0F {
            0x00 => Self::Unknown,
            0x01 => Self::ChassisControl,
            0x02 => Self::ResetPushButton,
            0x03 => Self::PowerUpPushButton,
            0x04 => Self::WatchdogExpired,
            0x05 => Self::Oem,
            0x06 => Self::AutoPowerOnAlwaysRestore,
            0x07 => Self::AutoPowerOnRestorePrevious,
            0x08 => Self::ResetPef,
            0x09 => Self::PowerCyclePef,
            0x0A => Self::SoftReset,
            0x0B => Self::PowerUpRtc,
            _ => Self::Unknown,
        }
    }
}

/// Boot device for chassis boot options.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[repr(u8)]
pub enum BootDevice {
    NoOverride = 0x00,
    Pxe = 0x04,
    HardDrive = 0x08,
    SafeModeDiag = 0x0C,
    DiagPartition = 0x10,
    CdDvd = 0x14,
    BiosSetup = 0x18,
    RemoteFloppy = 0x1C,
    RemoteCdDvd = 0x20,
    PrimaryRemoteMedia = 0x24,
    RemoteHardDrive = 0x2C,
    Floppy = 0x3C,
}

impl BootDevice {
    pub fn from_byte(b: u8) -> Self {
        match b & 0x3C {
            0x00 => Self::NoOverride,
            0x04 => Self::Pxe,
            0x08 => Self::HardDrive,
            0x0C => Self::SafeModeDiag,
            0x10 => Self::DiagPartition,
            0x14 => Self::CdDvd,
            0x18 => Self::BiosSetup,
            0x1C => Self::RemoteFloppy,
            0x20 => Self::RemoteCdDvd,
            0x24 => Self::PrimaryRemoteMedia,
            0x2C => Self::RemoteHardDrive,
            0x3C => Self::Floppy,
            _ => Self::NoOverride,
        }
    }
}

/// Boot options.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BootOptions {
    pub boot_device: BootDevice,
    pub persistent: bool,
    pub efi_boot: bool,
    pub bios_verbosity: u8,
    pub console_redirection: u8,
    pub bios_mux_override: u8,
    pub valid: bool,
}

// ═══════════════════════════════════════════════════════════════════════
// Sensor / SDR types
// ═══════════════════════════════════════════════════════════════════════

/// Sensor type classification per IPMI spec.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum SensorType {
    Temperature,
    Voltage,
    Current,
    Fan,
    PhysicalSecurity,
    PlatformSecurity,
    Processor,
    PowerSupply,
    PowerUnit,
    CoolingDevice,
    MemoryModule,
    DriveSlot,
    PostMemoryResize,
    SystemFirmware,
    EventLogging,
    Watchdog1,
    SystemEvent,
    CriticalInterrupt,
    ButtonSwitch,
    ModuleBoard,
    MicrocontrollerCoprocessor,
    AddInCard,
    Chassis,
    ChipSet,
    OtherFru,
    CableInterconnect,
    Terminator,
    SystemBoot,
    BootError,
    OsBoot,
    OsCriticalStop,
    SlotConnector,
    SystemAcpiPowerState,
    Watchdog2,
    PlatformAlert,
    EntityPresence,
    MonitorAsicIc,
    Lan,
    ManagementSubsystemHealth,
    Battery,
    SessionAudit,
    VersionChange,
    FruState,
    OEM,
    Unknown(u8),
}

impl SensorType {
    pub fn from_byte(b: u8) -> Self {
        match b {
            0x01 => Self::Temperature,
            0x02 => Self::Voltage,
            0x03 => Self::Current,
            0x04 => Self::Fan,
            0x05 => Self::PhysicalSecurity,
            0x06 => Self::PlatformSecurity,
            0x07 => Self::Processor,
            0x08 => Self::PowerSupply,
            0x09 => Self::PowerUnit,
            0x0A => Self::CoolingDevice,
            0x0B => Self::MemoryModule,
            0x0D => Self::DriveSlot,
            0x0E => Self::PostMemoryResize,
            0x0F => Self::SystemFirmware,
            0x10 => Self::EventLogging,
            0x11 => Self::Watchdog1,
            0x12 => Self::SystemEvent,
            0x13 => Self::CriticalInterrupt,
            0x14 => Self::ButtonSwitch,
            0x15 => Self::ModuleBoard,
            0x16 => Self::MicrocontrollerCoprocessor,
            0x17 => Self::AddInCard,
            0x18 => Self::Chassis,
            0x19 => Self::ChipSet,
            0x1A => Self::OtherFru,
            0x1B => Self::CableInterconnect,
            0x1C => Self::Terminator,
            0x1D => Self::SystemBoot,
            0x1E => Self::BootError,
            0x1F => Self::OsBoot,
            0x20 => Self::OsCriticalStop,
            0x21 => Self::SlotConnector,
            0x22 => Self::SystemAcpiPowerState,
            0x23 => Self::Watchdog2,
            0x24 => Self::PlatformAlert,
            0x25 => Self::EntityPresence,
            0x26 => Self::MonitorAsicIc,
            0x27 => Self::Lan,
            0x28 => Self::ManagementSubsystemHealth,
            0x29 => Self::Battery,
            0x2A => Self::SessionAudit,
            0x2B => Self::VersionChange,
            0x2C => Self::FruState,
            0xC0..=0xFF => Self::OEM,
            other => Self::Unknown(other),
        }
    }
}

/// SDR record header (common to all SDR record types).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SdrHeader {
    /// Record ID.
    pub record_id: u16,
    /// SDR version.
    pub sdr_version: u8,
    /// Record type.
    pub record_type: u8,
    /// Record length (body only, excluding header).
    pub record_length: u8,
}

/// Linearization type for sensor reading conversion.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[repr(u8)]
pub enum Linearization {
    Linear = 0,
    Ln = 1,
    Log10 = 2,
    Log2 = 3,
    E = 4,
    Exp10 = 5,
    Exp2 = 6,
    OneOverX = 7,
    SqrX = 8,
    CubeX = 9,
    SqrtX = 10,
    CubeRoot = 11,
    NonLinear = 0x70,
}

impl Linearization {
    pub fn from_byte(b: u8) -> Self {
        match b & 0x7F {
            0 => Self::Linear,
            1 => Self::Ln,
            2 => Self::Log10,
            3 => Self::Log2,
            4 => Self::E,
            5 => Self::Exp10,
            6 => Self::Exp2,
            7 => Self::OneOverX,
            8 => Self::SqrX,
            9 => Self::CubeX,
            10 => Self::SqrtX,
            11 => Self::CubeRoot,
            _ => Self::NonLinear,
        }
    }

    /// Apply the linearization function to a raw converted value.
    pub fn apply(self, x: f64) -> f64 {
        match self {
            Self::Linear => x,
            Self::Ln => x.ln(),
            Self::Log10 => x.log10(),
            Self::Log2 => x.log2(),
            Self::E => x.exp(),
            Self::Exp10 => (10.0_f64).powf(x),
            Self::Exp2 => (2.0_f64).powf(x),
            Self::OneOverX => {
                if x.abs() < f64::EPSILON {
                    f64::NAN
                } else {
                    1.0 / x
                }
            }
            Self::SqrX => x * x,
            Self::CubeX => x * x * x,
            Self::SqrtX => x.sqrt(),
            Self::CubeRoot => x.cbrt(),
            Self::NonLinear => x,
        }
    }
}

/// SDR Full Sensor Record (Type 0x01).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SdrFullSensor {
    pub header: SdrHeader,
    pub sensor_owner_id: u8,
    pub sensor_owner_lun: u8,
    pub sensor_number: u8,
    pub entity_id: u8,
    pub entity_instance: u8,
    pub sensor_type: SensorType,
    pub event_reading_type: u8,
    pub sensor_units_1: u8,
    pub sensor_units_2_base: u8,
    pub sensor_units_3_modifier: u8,
    pub linearization: Linearization,
    /// M factor (10-bit, two's complement).
    pub m: i16,
    /// B factor (10-bit, two's complement).
    pub b: i16,
    /// B exponent (4-bit, two's complement) = K1.
    pub b_exp: i8,
    /// R exponent (4-bit, two's complement) = K2.
    pub r_exp: i8,
    pub tolerance: u8,
    pub accuracy: u16,
    pub analog_flags: u8,
    pub nominal_reading: u8,
    pub normal_max: u8,
    pub normal_min: u8,
    pub sensor_max: u8,
    pub sensor_min: u8,
    pub upper_non_recoverable: u8,
    pub upper_critical: u8,
    pub upper_non_critical: u8,
    pub lower_non_recoverable: u8,
    pub lower_critical: u8,
    pub lower_non_critical: u8,
    pub positive_hysteresis: u8,
    pub negative_hysteresis: u8,
    pub sensor_name: String,
}

/// SDR Compact Sensor Record (Type 0x02).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SdrCompactSensor {
    pub header: SdrHeader,
    pub sensor_owner_id: u8,
    pub sensor_owner_lun: u8,
    pub sensor_number: u8,
    pub entity_id: u8,
    pub entity_instance: u8,
    pub sensor_type: SensorType,
    pub event_reading_type: u8,
    pub sensor_name: String,
}

/// SDR FRU Device Locator Record (Type 0x11).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SdrFruLocator {
    pub header: SdrHeader,
    pub device_access_addr: u8,
    pub fru_device_id: u8,
    pub logical_physical: bool,
    pub access_lun: u8,
    pub channel_number: u8,
    pub device_type: u8,
    pub device_type_modifier: u8,
    pub entity_id: u8,
    pub entity_instance: u8,
    pub device_name: String,
}

/// SDR Management Controller Device Locator (Type 0x12).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SdrMcLocator {
    pub header: SdrHeader,
    pub device_slave_addr: u8,
    pub channel_number: u8,
    pub power_state_notification: u8,
    pub device_capabilities: u8,
    pub entity_id: u8,
    pub entity_instance: u8,
    pub device_name: String,
}

/// Union of all SDR record types.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum SdrRecord {
    FullSensor(SdrFullSensor),
    CompactSensor(SdrCompactSensor),
    FruLocator(SdrFruLocator),
    McLocator(SdrMcLocator),
    Unknown { header: SdrHeader, data: Vec<u8> },
}

/// SDR repository info.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SdrRepositoryInfo {
    pub sdr_version: u8,
    pub record_count: u16,
    pub free_space: u16,
    pub most_recent_addition: u32,
    pub most_recent_erase: u32,
    pub overflow: bool,
    pub supported_ops: u8,
}

/// Sensor reading with converted value.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SensorReading {
    pub sensor_number: u8,
    pub sensor_name: String,
    pub sensor_type: SensorType,
    pub raw_value: u8,
    pub converted_value: Option<f64>,
    pub units: String,
    pub reading_available: bool,
    pub scanning_enabled: bool,
    pub event_messages_enabled: bool,
    pub threshold_status: Option<SensorThresholdStatus>,
    pub discrete_state: Option<u16>,
}

/// Threshold crossing status.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SensorThresholdStatus {
    pub upper_non_recoverable: bool,
    pub upper_critical: bool,
    pub upper_non_critical: bool,
    pub lower_non_recoverable: bool,
    pub lower_critical: bool,
    pub lower_non_critical: bool,
}

/// Sensor threshold values (converted).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SensorThresholds {
    pub sensor_number: u8,
    pub upper_non_recoverable: Option<f64>,
    pub upper_critical: Option<f64>,
    pub upper_non_critical: Option<f64>,
    pub lower_non_recoverable: Option<f64>,
    pub lower_critical: Option<f64>,
    pub lower_non_critical: Option<f64>,
}

// ═══════════════════════════════════════════════════════════════════════
// SEL types
// ═══════════════════════════════════════════════════════════════════════

/// SEL repository info.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SelInfo {
    pub sel_version: u8,
    pub entries: u16,
    pub free_space: u16,
    pub most_recent_addition: u32,
    pub most_recent_erase: u32,
    pub delete_supported: bool,
    pub partial_add_supported: bool,
    pub reserve_supported: bool,
    pub get_allocation_supported: bool,
    pub overflow: bool,
}

/// SEL record type.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum SelRecordType {
    /// Standard system event (type 0x02).
    SystemEvent,
    /// OEM timestamped (0xC0-0xDF).
    OemTimestamped,
    /// OEM non-timestamped (0xE0-0xFF).
    OemNonTimestamped,
    /// Unknown record type.
    Unknown(u8),
}

impl SelRecordType {
    pub fn from_byte(b: u8) -> Self {
        match b {
            0x02 => Self::SystemEvent,
            0xC0..=0xDF => Self::OemTimestamped,
            0xE0..=0xFF => Self::OemNonTimestamped,
            other => Self::Unknown(other),
        }
    }
}

/// SEL entry (decoded).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SelEntry {
    pub record_id: u16,
    pub record_type: u8,
    pub record_type_name: String,
    pub timestamp: Option<DateTime<Utc>>,
    pub generator_id: Option<u16>,
    pub event_msg_rev: Option<u8>,
    pub sensor_type: Option<SensorType>,
    pub sensor_number: Option<u8>,
    pub event_dir: Option<String>,
    pub event_type: Option<u8>,
    pub event_data: Vec<u8>,
    pub description: String,
    pub raw_data: Vec<u8>,
}

// ═══════════════════════════════════════════════════════════════════════
// FRU types
// ═══════════════════════════════════════════════════════════════════════

/// FRU inventory area info.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FruInventoryInfo {
    pub area_size: u16,
    pub access_by_words: bool,
}

/// FRU area type.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum FruAreaType {
    InternalUse,
    ChassisInfo,
    BoardInfo,
    ProductInfo,
    MultiRecord,
}

/// Individual FRU data fields.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FruField {
    pub name: String,
    pub value: String,
}

/// FRU chassis info area.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FruChassisInfo {
    pub chassis_type: u8,
    pub chassis_type_name: String,
    pub part_number: String,
    pub serial_number: String,
    pub custom_fields: Vec<FruField>,
}

/// FRU board info area.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FruBoardInfo {
    pub language_code: u8,
    pub manufacture_date: Option<DateTime<Utc>>,
    pub manufacturer: String,
    pub product_name: String,
    pub serial_number: String,
    pub part_number: String,
    pub fru_file_id: String,
    pub custom_fields: Vec<FruField>,
}

/// FRU product info area.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FruProductInfo {
    pub language_code: u8,
    pub manufacturer: String,
    pub product_name: String,
    pub part_number: String,
    pub version: String,
    pub serial_number: String,
    pub asset_tag: String,
    pub fru_file_id: String,
    pub custom_fields: Vec<FruField>,
}

/// MultiRecord area entry.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FruMultiRecord {
    pub record_type_id: u8,
    pub end_of_list: bool,
    pub data: Vec<u8>,
}

/// Complete decoded FRU device info.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FruDeviceInfo {
    pub device_id: u8,
    pub chassis: Option<FruChassisInfo>,
    pub board: Option<FruBoardInfo>,
    pub product: Option<FruProductInfo>,
    pub multi_records: Vec<FruMultiRecord>,
    pub internal_use_data: Vec<u8>,
}

// ═══════════════════════════════════════════════════════════════════════
// SOL types
// ═══════════════════════════════════════════════════════════════════════

/// SOL configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SolConfig {
    pub enabled: bool,
    pub force_encryption: bool,
    pub force_authentication: bool,
    pub privilege_level: PrivilegeLevel,
    pub character_accumulate_interval: u8,
    pub character_send_threshold: u8,
    pub retry_count: u8,
    pub retry_interval: u8,
    pub non_volatile_bit_rate: u8,
    pub volatile_bit_rate: u8,
    pub payload_channel: u8,
    pub payload_port: u16,
}

/// SOL session state.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum SolSessionState {
    Inactive,
    Activating,
    Active,
    Deactivating,
    Error,
}

/// SOL session information.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SolSession {
    pub session_id: String,
    pub ipmi_session_id: String,
    pub state: SolSessionState,
    pub instance: u8,
    pub sequence_number: u8,
    pub accepted_char_count: u8,
    pub cts: bool,
    pub dcd_dsr: bool,
    pub break_detected: bool,
    pub created_at: DateTime<Utc>,
}

/// SOL payload type flags.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct SolPayloadFlags {
    pub nack: bool,
    pub ring_wor: bool,
    pub generate_break: bool,
    pub cts_pause: bool,
    pub flush_inbound: bool,
    pub flush_outbound: bool,
}

// ═══════════════════════════════════════════════════════════════════════
// Watchdog types
// ═══════════════════════════════════════════════════════════════════════

/// Watchdog timer use.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum WatchdogTimerUse {
    Reserved,
    BiosFrePost,
    BiosPost,
    OsLoad,
    SmsOs,
    Oem,
}

/// Watchdog timeout action.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[repr(u8)]
pub enum WatchdogAction {
    NoAction = 0x00,
    HardReset = 0x01,
    PowerDown = 0x02,
    PowerCycle = 0x03,
}

/// Pre-timeout interrupt type.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[repr(u8)]
pub enum PreTimeoutInterrupt {
    None = 0x00,
    Smi = 0x01,
    Nmi = 0x02,
    MessagingInterrupt = 0x03,
}

/// Watchdog timer configuration and current state.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchdogTimer {
    pub timer_use: WatchdogTimerUse,
    pub timer_running: bool,
    pub dont_log: bool,
    pub timeout_action: WatchdogAction,
    pub pre_timeout_interrupt: PreTimeoutInterrupt,
    pub pre_timeout_interval: u8,
    pub initial_countdown: u16,
    pub present_countdown: u16,
}

// ═══════════════════════════════════════════════════════════════════════
// LAN configuration types
// ═══════════════════════════════════════════════════════════════════════

/// IP address source for LAN configuration.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum IpSource {
    Unspecified,
    Static,
    Dhcp,
    Bios,
}

/// LAN configuration parameter IDs.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum LanParameterId {
    SetInProgress,
    AuthTypeSupport,
    IpAddress,
    IpAddressSource,
    MacAddress,
    SubnetMask,
    DefaultGateway,
    DefaultGatewayMac,
    BackupGateway,
    CommunityString,
    VlanId,
    VlanPriority,
    CipherSuiteEntrySupport,
    CipherSuiteEntries,
}

/// Complete LAN configuration for a channel.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LanConfig {
    pub ip_address: String,
    pub ip_source: IpSource,
    pub subnet_mask: String,
    pub mac_address: String,
    pub default_gateway: String,
    pub default_gateway_mac: Option<String>,
    pub backup_gateway: Option<String>,
    pub vlan_id: Option<u16>,
    pub vlan_enabled: bool,
    pub vlan_priority: Option<u8>,
    pub community_string: Option<String>,
    pub cipher_suites: Option<Vec<u8>>,
}

// ═══════════════════════════════════════════════════════════════════════
// User management types
// ═══════════════════════════════════════════════════════════════════════

/// IPMI user information.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IpmiUser {
    pub user_id: u8,
    pub name: String,
    pub enabled: bool,
    pub callin: bool,
    pub link_auth: bool,
    pub ipmi_messaging: bool,
    pub privilege: PrivilegeLevel,
}

/// User access settings per channel.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserAccess {
    pub max_user_ids: u8,
    pub enabled_user_count: u8,
    pub fixed_names_count: u8,
    pub privilege: PrivilegeLevel,
    pub link_auth_enabled: bool,
    pub ipmi_messaging_enabled: bool,
    pub callin_allowed: bool,
}

// ═══════════════════════════════════════════════════════════════════════
// PEF types
// ═══════════════════════════════════════════════════════════════════════

/// PEF capabilities.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PefCapabilities {
    pub version: u8,
    pub action_support: u8,
    pub filter_table_size: u8,
}

/// PEF filter entry.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PefFilter {
    pub filter_number: u8,
    pub enabled: bool,
    pub action: PefAction,
    pub alert_policy_number: u8,
    pub severity: u8,
    pub generator_id: u16,
    pub sensor_type: u8,
    pub sensor_number: u8,
    pub event_trigger: u8,
}

/// PEF action flags.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PefAction {
    pub alert: bool,
    pub power_off: bool,
    pub reset: bool,
    pub power_cycle: bool,
    pub oem: bool,
    pub diagnostic_interrupt: bool,
}

impl PefAction {
    pub fn from_byte(b: u8) -> Self {
        Self {
            alert: (b & 0x01) != 0,
            power_off: (b & 0x02) != 0,
            reset: (b & 0x04) != 0,
            power_cycle: (b & 0x08) != 0,
            oem: (b & 0x10) != 0,
            diagnostic_interrupt: (b & 0x20) != 0,
        }
    }

    pub fn to_byte(self) -> u8 {
        let mut b = 0u8;
        if self.alert {
            b |= 0x01;
        }
        if self.power_off {
            b |= 0x02;
        }
        if self.reset {
            b |= 0x04;
        }
        if self.power_cycle {
            b |= 0x08;
        }
        if self.oem {
            b |= 0x10;
        }
        if self.diagnostic_interrupt {
            b |= 0x20;
        }
        b
    }
}

/// PEF configuration parameters.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PefConfig {
    pub capabilities: PefCapabilities,
    pub pef_enabled: bool,
    pub event_messages_enabled: bool,
    pub action_control: PefAction,
    pub startup_delay: u8,
    pub alert_startup_delay: u8,
    pub filters: Vec<PefFilter>,
}

// ═══════════════════════════════════════════════════════════════════════
// Channel types
// ═══════════════════════════════════════════════════════════════════════

/// Channel protocol type.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ChannelProtocol {
    Ipmb,
    IcmbV10,
    IcmbV09,
    Ipmi,
    Kcs,
    Smic,
    Bt10,
    Bt15,
    TMode,
    Reserved,
}

/// Channel medium type.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ChannelMedium {
    Ipmb,
    IcmbV10,
    IcmbV09,
    Lan8023,
    Serial,
    OtherLan,
    PciSmbus,
    SmBusV11,
    SmBusV20,
    SystemInterface,
    Reserved,
}

/// Channel info.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelInfo {
    pub channel_number: u8,
    pub medium_type: ChannelMedium,
    pub protocol_type: ChannelProtocol,
    pub session_support: String,
    pub vendor_id: u32,
}

/// Channel access settings.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelAccess {
    pub channel: u8,
    pub alerting_enabled: bool,
    pub per_msg_auth_enabled: bool,
    pub user_auth_enabled: bool,
    pub access_mode: u8,
    pub privilege_limit: PrivilegeLevel,
}

// ═══════════════════════════════════════════════════════════════════════
// Device identity & firmware types
// ═══════════════════════════════════════════════════════════════════════

/// BMC Device ID info (Get Device ID response).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IpmiDeviceId {
    pub device_id: u8,
    pub device_revision: u8,
    pub firmware_major: u8,
    pub firmware_minor: String,
    pub ipmi_version: String,
    pub additional_device_support: u8,
    pub manufacturer_id: u32,
    pub product_id: u16,
    pub aux_firmware_revision: Option<Vec<u8>>,
    /// Device provides SDR repository.
    pub sdr_repository_support: bool,
    /// Device provides SEL.
    pub sel_device_support: bool,
    /// Device provides FRU inventory.
    pub fru_inventory_support: bool,
    /// Device accepts IPMB event receiver command.
    pub ipmb_event_receiver_support: bool,
    /// Device accepts IPMB event generator command.
    pub ipmb_event_generator_support: bool,
    /// Chassis device.
    pub chassis_device_support: bool,
}

/// Cipher suite definition.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CipherSuite {
    pub id: u8,
    pub auth_algorithm: String,
    pub integrity_algorithm: String,
    pub confidentiality_algorithm: String,
}

/// Session info (active sessions on the BMC).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BmcSessionInfo {
    pub session_handle: u8,
    pub session_id: u32,
    pub user_id: u8,
    pub privilege: PrivilegeLevel,
    pub channel: u8,
    pub remote_ip: Option<String>,
    pub remote_port: Option<u16>,
}

// ═══════════════════════════════════════════════════════════════════════
// Tauri event types
// ═══════════════════════════════════════════════════════════════════════

/// IPMI event payload for Tauri event emission.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IpmiEvent {
    pub session_id: String,
    pub event_type: String,
    pub timestamp: DateTime<Utc>,
    pub data: serde_json::Value,
}

/// Power-on hours counter.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PowerOnHours {
    pub minutes_per_count: u8,
    pub counter: u32,
    pub total_hours: f64,
}

/// Raw command history entry.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RawCommandHistoryEntry {
    pub timestamp: DateTime<Utc>,
    pub session_id: String,
    pub netfn: u8,
    pub cmd: u8,
    pub request_data: String,
    pub completion_code: u8,
    pub response_data: String,
}
