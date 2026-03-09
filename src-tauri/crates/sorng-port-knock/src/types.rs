use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

// ─── Core Protocol Types ───────────────────────────────────────────

/// Protocol used for a knock
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum KnockProtocol {
    Tcp,
    Udp,
}

impl std::fmt::Display for KnockProtocol {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Tcp => write!(f, "TCP"),
            Self::Udp => write!(f, "UDP"),
        }
    }
}

/// IP version for knock targeting
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum IpVersion {
    V4,
    V6,
    Auto,
}

/// A single knock step in a sequence
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KnockStep {
    pub port: u16,
    pub protocol: KnockProtocol,
    pub payload: Option<Vec<u8>>,
    pub delay_after_ms: u64,
}

/// A complete knock sequence definition
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KnockSequence {
    pub id: String,
    pub name: String,
    pub steps: Vec<KnockStep>,
    pub description: String,
    pub target_port: u16,
    pub target_protocol: KnockProtocol,
    pub timeout_ms: u64,
    pub max_retries: u32,
    pub ip_version: IpVersion,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

// ─── Knock Execution Types ─────────────────────────────────────────

/// Result of a single knock step execution
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KnockStepResult {
    pub step_index: usize,
    pub port: u16,
    pub protocol: KnockProtocol,
    pub success: bool,
    pub elapsed_ms: u64,
    pub error: Option<String>,
}

/// Status of a knock operation
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum KnockStatus {
    Pending,
    InProgress,
    Success,
    Failed,
    Timeout,
    PartialSuccess,
    Cancelled,
}

/// Result of executing a complete knock sequence
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KnockResult {
    pub id: String,
    pub host: String,
    pub sequence_id: String,
    pub status: KnockStatus,
    pub step_results: Vec<KnockStepResult>,
    pub target_port_opened: bool,
    pub total_elapsed_ms: u64,
    pub attempt_number: u32,
    pub timestamp: DateTime<Utc>,
    pub error: Option<String>,
}

/// Options for executing a knock
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KnockOptions {
    pub verify_after_knock: bool,
    pub verify_timeout_ms: u64,
    pub verify_retries: u32,
    pub source_port: Option<u16>,
    pub source_address: Option<String>,
    pub tcp_flags: Option<TcpFlags>,
    pub ttl: Option<u8>,
    pub interface: Option<String>,
}

impl Default for KnockOptions {
    fn default() -> Self {
        Self {
            verify_after_knock: true,
            verify_timeout_ms: 5000,
            verify_retries: 3,
            source_port: None,
            source_address: None,
            tcp_flags: None,
            ttl: None,
            interface: None,
        }
    }
}

/// TCP flag combinations for knock packets
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct TcpFlags {
    pub syn: bool,
    pub ack: bool,
    pub fin: bool,
    pub rst: bool,
    pub psh: bool,
    pub urg: bool,
}

impl Default for TcpFlags {
    fn default() -> Self {
        Self {
            syn: true,
            ack: false,
            fin: false,
            rst: false,
            psh: false,
            urg: false,
        }
    }
}

// ─── Cryptographic Types ───────────────────────────────────────────

/// Encryption algorithm for knock payloads
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum KnockEncryption {
    None,
    Aes256Gcm,
    Aes256Cbc,
    RijndaelCbc,
    ChaCha20Poly1305,
}

/// HMAC algorithm for knock authentication
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum HmacAlgorithm {
    Sha256,
    Sha384,
    Sha512,
}

/// Key derivation function parameters
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum KeyDerivation {
    Pbkdf2 {
        iterations: u32,
        salt_len: usize,
    },
    Argon2 {
        memory_kb: u32,
        iterations: u32,
        parallelism: u32,
    },
    Raw,
}

/// Encrypted knock payload
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EncryptedKnockPayload {
    pub algorithm: KnockEncryption,
    pub ciphertext: Vec<u8>,
    pub nonce: Vec<u8>,
    pub hmac: Option<Vec<u8>>,
    pub hmac_algorithm: Option<HmacAlgorithm>,
    pub key_derivation: KeyDerivation,
    pub timestamp: DateTime<Utc>,
}

/// Crypto key for knock operations
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KnockKey {
    pub id: String,
    pub name: String,
    pub key_type: KnockKeyType,
    pub created_at: DateTime<Utc>,
    pub expires_at: Option<DateTime<Utc>>,
    pub fingerprint: String,
}

/// Type of cryptographic key
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum KnockKeyType {
    SharedSecret,
    RsaPublic { bits: u32 },
    RsaPrivate { bits: u32 },
    GpgPublic { key_id: String },
    GpgPrivate { key_id: String },
}

/// Replay protection window
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReplayWindow {
    pub window_size: u64,
    pub seen_nonces: Vec<String>,
    pub last_timestamp: DateTime<Utc>,
}

// ─── Single Packet Authorization Types ─────────────────────────────

/// SPA message type
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum SpaMessageType {
    AccessRequest,
    CommandRequest,
    NatAccessRequest,
    LocalNatAccessRequest,
    ClientTimeout,
    ForwardAccess,
}

/// SPA digest type
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum SpaDigestType {
    Md5,
    Sha256,
    Sha384,
    Sha512,
}

/// A Single Packet Authorization message
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpaPacket {
    pub random_data: String,
    pub username: String,
    pub timestamp: u64,
    pub version: String,
    pub message_type: SpaMessageType,
    pub access_request: String,
    pub nat_access: Option<String>,
    pub server_auth: Option<String>,
    pub client_timeout: Option<u32>,
    pub digest: String,
    pub digest_type: SpaDigestType,
    pub encryption: KnockEncryption,
    pub hmac_digest: Option<String>,
}

/// SPA send options
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpaOptions {
    pub destination_port: u16,
    pub protocol: KnockProtocol,
    pub encryption: KnockEncryption,
    pub hmac_algorithm: Option<HmacAlgorithm>,
    pub digest_type: SpaDigestType,
    pub nat_ip: Option<String>,
    pub nat_port: Option<u16>,
    pub server_timeout: Option<u32>,
    pub allow_ip: Option<String>,
    pub gpg_key_id: Option<String>,
    pub gpg_recipient: Option<String>,
}

impl Default for SpaOptions {
    fn default() -> Self {
        Self {
            destination_port: 62201,
            protocol: KnockProtocol::Udp,
            encryption: KnockEncryption::Aes256Cbc,
            hmac_algorithm: Some(HmacAlgorithm::Sha256),
            digest_type: SpaDigestType::Sha256,
            nat_ip: None,
            nat_port: None,
            server_timeout: None,
            allow_ip: None,
            gpg_key_id: None,
            gpg_recipient: None,
        }
    }
}

/// SPA send result
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpaResult {
    pub success: bool,
    pub host: String,
    pub port: u16,
    pub message_type: SpaMessageType,
    pub elapsed_ms: u64,
    pub port_opened: Option<bool>,
    pub error: Option<String>,
    pub timestamp: DateTime<Utc>,
}

// ─── Firewall Types ────────────────────────────────────────────────

/// Supported firewall backends
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum FirewallBackend {
    Iptables,
    Nftables,
    Pf,
    WindowsFirewall,
    Ufw,
    Firewalld,
}

/// Firewall rule action
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum FirewallAction {
    Accept,
    Drop,
    Reject,
    Log,
}

/// Firewall rule direction
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum FirewallDirection {
    Inbound,
    Outbound,
    Forward,
}

/// A firewall rule for knock response
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FirewallRule {
    pub id: String,
    pub chain: String,
    pub action: FirewallAction,
    pub direction: FirewallDirection,
    pub protocol: KnockProtocol,
    pub source_ip: Option<String>,
    pub destination_ip: Option<String>,
    pub port: u16,
    pub comment: String,
    pub expires_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
}

/// Firewall state on a host
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FirewallState {
    pub backend: FirewallBackend,
    pub active: bool,
    pub rules_count: u32,
    pub knock_rules: Vec<FirewallRule>,
    pub default_policy: FirewallAction,
}

/// Firewall rule generation options
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FirewallRuleOptions {
    pub backend: FirewallBackend,
    pub expire_seconds: Option<u64>,
    pub log_prefix: Option<String>,
    pub chain: Option<String>,
    pub table: Option<String>,
    pub priority: Option<i32>,
}

// ─── knockd Types ──────────────────────────────────────────────────

/// A knockd configuration section
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KnockdSection {
    pub name: String,
    pub sequence: Vec<KnockStep>,
    pub seq_timeout: u32,
    pub tcpflags: Option<String>,
    pub start_command: String,
    pub stop_command: Option<String>,
    pub cmd_timeout: u32,
    pub one_time: bool,
    pub interface: Option<String>,
}

/// Full knockd configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KnockdConfig {
    pub use_syslog: bool,
    pub log_file: Option<String>,
    pub pid_file: String,
    pub interface: String,
    pub sections: Vec<KnockdSection>,
}

/// knockd service status
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KnockdStatus {
    pub running: bool,
    pub pid: Option<u32>,
    pub config_path: String,
    pub interface: String,
    pub uptime_seconds: Option<u64>,
    pub sequences_triggered: u64,
}

// ─── fwknop Types ──────────────────────────────────────────────────

/// fwknop access.conf stanza
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FwknopAccessStanza {
    pub source: String,
    pub open_ports: Vec<String>,
    pub restrict_ports: Option<Vec<String>>,
    pub key: Option<String>,
    pub key_base64: Option<String>,
    pub hmac_key: Option<String>,
    pub hmac_key_base64: Option<String>,
    pub hmac_digest_type: Option<HmacAlgorithm>,
    pub fw_access_timeout: u32,
    pub encryption_mode: KnockEncryption,
    pub require_source_address: bool,
    pub gpg_remote_id: Option<String>,
    pub gpg_decrypt_id: Option<String>,
    pub gpg_home_dir: Option<String>,
    pub force_nat: Option<String>,
    pub force_snat: Option<String>,
    pub cmd_exec_on_open: Option<String>,
    pub cmd_exec_on_close: Option<String>,
}

/// fwknop server configuration (fwknopd.conf)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FwknopServerConfig {
    pub pcap_interface: String,
    pub pcap_filter: String,
    pub enable_pcap_promisc: bool,
    pub max_spa_packet_age: u32,
    pub enable_digest_persistence: bool,
    pub rules_check_threshold: u32,
    pub flush_rules_at_init: bool,
    pub flush_rules_at_exit: bool,
    pub firewall_backend: FirewallBackend,
    pub access_stanzas: Vec<FwknopAccessStanza>,
}

/// fwknop client configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FwknopClientConfig {
    pub spa_server: String,
    pub spa_server_port: u16,
    pub spa_server_proto: KnockProtocol,
    pub access_port: String,
    pub allow_ip: Option<String>,
    pub resolve_ip_url: Option<String>,
    pub encryption_mode: KnockEncryption,
    pub key: Option<String>,
    pub key_base64: Option<String>,
    pub hmac_key: Option<String>,
    pub hmac_key_base64: Option<String>,
    pub hmac_digest_type: HmacAlgorithm,
    pub spa_source_port: Option<u16>,
    pub nat_access: Option<String>,
    pub nat_local: bool,
    pub nat_port: Option<u16>,
    pub server_timeout: Option<u32>,
    pub gpg_recipient: Option<String>,
    pub gpg_signer: Option<String>,
    pub gpg_home_dir: Option<String>,
}

// ─── Profile Types ─────────────────────────────────────────────────

/// Knock method type for profiles
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum KnockMethod {
    SimpleSequence,
    EncryptedSequence,
    Spa,
    Fwknop,
    KnockdCompat,
}

/// A saved knock profile
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KnockProfile {
    pub id: String,
    pub name: String,
    pub description: String,
    pub method: KnockMethod,
    pub sequence: Option<KnockSequence>,
    pub spa_options: Option<SpaOptions>,
    pub fwknop_config: Option<FwknopClientConfig>,
    pub firewall_options: Option<FirewallRuleOptions>,
    pub knock_options: KnockOptions,
    pub tags: Vec<String>,
    pub is_default: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// Profile import/export format
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ProfileFormat {
    Json,
    Toml,
    KnockdConf,
    FwknopRc,
}

// ─── History Types ─────────────────────────────────────────────────

/// A knock history entry
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KnockHistoryEntry {
    pub id: String,
    pub host: String,
    pub profile_id: Option<String>,
    pub profile_name: Option<String>,
    pub method: KnockMethod,
    pub status: KnockStatus,
    pub target_port: u16,
    pub port_opened: bool,
    pub elapsed_ms: u64,
    pub steps_completed: u32,
    pub steps_total: u32,
    pub error: Option<String>,
    pub timestamp: DateTime<Utc>,
}

/// History query filters
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HistoryFilter {
    pub host: Option<String>,
    pub profile_id: Option<String>,
    pub status: Option<KnockStatus>,
    pub method: Option<KnockMethod>,
    pub from_date: Option<DateTime<Utc>>,
    pub to_date: Option<DateTime<Utc>>,
    pub limit: Option<u32>,
    pub offset: Option<u32>,
}

/// Aggregated knock statistics
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KnockStatistics {
    pub total_attempts: u64,
    pub successful_attempts: u64,
    pub failed_attempts: u64,
    pub timeout_attempts: u64,
    pub avg_elapsed_ms: f64,
    pub min_elapsed_ms: u64,
    pub max_elapsed_ms: u64,
    pub most_used_profile: Option<String>,
    pub most_targeted_host: Option<String>,
    pub by_method: Vec<MethodStats>,
    pub by_host: Vec<HostStats>,
}

/// Stats per method
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MethodStats {
    pub method: KnockMethod,
    pub count: u64,
    pub success_rate: f64,
}

/// Stats per host
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HostStats {
    pub host: String,
    pub count: u64,
    pub success_rate: f64,
    pub avg_elapsed_ms: f64,
}

// ─── Scanner Types ─────────────────────────────────────────────────

/// Port state after scanning
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum PortState {
    Open,
    Closed,
    Filtered,
    Unknown,
}

/// Port scan result
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PortScanResult {
    pub host: String,
    pub port: u16,
    pub protocol: KnockProtocol,
    pub state: PortState,
    pub banner: Option<String>,
    pub elapsed_ms: u64,
    pub timestamp: DateTime<Utc>,
}

/// Knock verification result
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KnockVerification {
    pub host: String,
    pub port: u16,
    pub before_knock: PortState,
    pub after_knock: PortState,
    pub port_opened: bool,
    pub banner: Option<String>,
    pub elapsed_ms: u64,
    pub timestamp: DateTime<Utc>,
}

// ─── Host Types ────────────────────────────────────────────────────

/// A managed host for port knocking
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KnockHost {
    pub id: String,
    pub name: String,
    pub hostname: String,
    pub port: u16,
    pub description: String,
    pub default_profile_id: Option<String>,
    pub ssh_user: Option<String>,
    pub ssh_port: Option<u16>,
    pub tags: Vec<String>,
    pub last_knock_at: Option<DateTime<Utc>>,
    pub last_knock_status: Option<KnockStatus>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// Sequence generation parameters
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SequenceGenParams {
    pub length: u32,
    pub min_port: u16,
    pub max_port: u16,
    pub allow_tcp: bool,
    pub allow_udp: bool,
    pub inter_knock_delay_ms: u64,
    pub avoid_privileged_ports: bool,
    pub avoid_well_known_ports: bool,
    pub target_port: u16,
    pub target_protocol: KnockProtocol,
    pub timeout_ms: u64,
}

impl Default for SequenceGenParams {
    fn default() -> Self {
        Self {
            length: 4,
            min_port: 1024,
            max_port: 65535,
            allow_tcp: true,
            allow_udp: true,
            inter_knock_delay_ms: 500,
            avoid_privileged_ports: true,
            avoid_well_known_ports: true,
            target_port: 22,
            target_protocol: KnockProtocol::Tcp,
            timeout_ms: 15000,
        }
    }
}

/// Bulk knock request
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BulkKnockRequest {
    pub hosts: Vec<String>,
    pub sequence_id: Option<String>,
    pub profile_id: Option<String>,
    pub options: KnockOptions,
    pub parallel: bool,
    pub max_concurrent: u32,
}

/// Bulk knock result
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BulkKnockResult {
    pub results: Vec<KnockResult>,
    pub total_hosts: u32,
    pub successful: u32,
    pub failed: u32,
    pub total_elapsed_ms: u64,
}
