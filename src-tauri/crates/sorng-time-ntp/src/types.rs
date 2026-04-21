//! Data types for time, timezone, and NTP management.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

// ─── SSH / Host ─────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SshConfig {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth: SshAuth,
    pub timeout_secs: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum SshAuth {
    Password {
        password: String,
    },
    PrivateKey {
        key_path: String,
        passphrase: Option<String>,
    },
    Agent,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TimeHost {
    pub id: String,
    pub name: String,
    pub ssh: Option<SshConfig>,
    pub use_sudo: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

// ─── System Time ────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SystemTime {
    pub current_time: DateTime<Utc>,
    pub timezone: String,
    pub timezone_offset: String,
    pub utc_time: DateTime<Utc>,
    pub rtc_time: Option<DateTime<Utc>>,
    pub ntp_enabled: bool,
    pub ntp_synced: bool,
    pub rtc_in_local_tz: bool,
}

// ─── Timezone ───────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TimezoneInfo {
    pub name: String,
    pub offset: String,
    pub abbreviation: String,
    pub is_dst: bool,
}

// ─── NTP Implementation ─────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NtpImplementation {
    Chrony,
    NtpdClassic,
    Systemd,
    OpenNTPD,
    Windows,
    Unknown,
}

// ─── NTP Server Configuration ───────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NtpServerConfig {
    pub address: String,
    #[serde(rename = "type")]
    pub server_type: NtpServerType,
    pub iburst: bool,
    pub prefer: bool,
    pub minpoll: Option<u32>,
    pub maxpoll: Option<u32>,
    pub key: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NtpServerType {
    Server,
    Pool,
    Peer,
}

// ─── NTP Peer ───────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NtpPeer {
    pub tally_char: String,
    pub remote: String,
    pub refid: String,
    pub stratum: u32,
    #[serde(rename = "type")]
    pub peer_type: String,
    pub when: String,
    pub poll: u32,
    pub reach: String,
    pub delay: f64,
    pub offset: f64,
    pub jitter: f64,
    pub state: NtpPeerState,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NtpPeerState {
    Sync,
    Candidate,
    Outlier,
    Falseticker,
    Excess,
    Reject,
    Unknown,
}

// ─── Chrony Config ──────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChronyConfig {
    pub servers: Vec<NtpServerConfig>,
    pub pools: Vec<NtpServerConfig>,
    pub makestep_threshold: f64,
    pub makestep_limit: i32,
    pub rtcsync: bool,
    pub driftfile: String,
    pub logdir: String,
    pub allow: Vec<String>,
    pub deny: Vec<String>,
    pub extra_directives: Vec<String>,
}

// ─── ntpd Config ────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NtpdConfig {
    pub servers: Vec<NtpServerConfig>,
    pub restrict_rules: Vec<String>,
    pub driftfile: String,
    pub statsdir: Option<String>,
    pub keys_file: Option<String>,
    pub extra_lines: Vec<String>,
}

// ─── NTP Status ─────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NtpStatus {
    pub implementation: NtpImplementation,
    pub synced: bool,
    pub stratum: u32,
    pub reference: String,
    pub offset_ms: f64,
    pub frequency_ppm: f64,
    pub sys_time: Option<DateTime<Utc>>,
    pub precision: Option<f64>,
    pub root_delay: f64,
    pub root_dispersion: f64,
}

// ─── NTP Source ─────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NtpSource {
    pub name: String,
    pub address: String,
    pub stratum: u32,
    pub poll: u32,
    pub reach: String,
    pub last_rx: String,
    pub offset: f64,
    pub error: f64,
}

// ─── Time Sync Stats ────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TimeSyncStats {
    pub offset_seconds: f64,
    pub frequency_ppm: f64,
    pub residual_freq: f64,
    pub skew: f64,
    pub root_delay: f64,
    pub root_dispersion: f64,
    pub update_interval: f64,
    pub leap_status: String,
}

// ─── PTP Status ─────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PtpStatus {
    pub clock_id: String,
    pub port_state: String,
    pub master_offset_ns: f64,
    pub path_delay_ns: f64,
}

// ─── PTP Port ───────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PtpPort {
    pub name: String,
    pub index: u32,
    pub state: String,
    pub delay_mechanism: String,
    pub peer_delay_ns: f64,
}
