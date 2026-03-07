//! Data types for process management.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// ─── Host ───────────────────────────────────────────────────────────

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
    Password { password: String },
    PrivateKey { key_path: String, passphrase: Option<String> },
    Agent,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProcHost {
    pub id: String,
    pub name: String,
    pub ssh: Option<SshConfig>,
    pub use_sudo: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

// ─── Process State ──────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProcessState {
    Running,
    Sleeping,
    DiskSleep,
    Zombie,
    Stopped,
    TraceStopped,
    Dead,
    WakeKill,
    Waking,
    Parked,
    Idle,
    Unknown,
}

impl ProcessState {
    /// Parse from the single-char STAT field in `ps` output or /proc/pid/status State.
    pub fn from_stat_char(c: char) -> Self {
        match c {
            'R' => Self::Running,
            'S' => Self::Sleeping,
            'D' => Self::DiskSleep,
            'Z' => Self::Zombie,
            'T' => Self::Stopped,
            't' => Self::TraceStopped,
            'X' | 'x' => Self::Dead,
            'K' => Self::WakeKill,
            'W' => Self::Waking,
            'P' => Self::Parked,
            'I' => Self::Idle,
            _ => Self::Unknown,
        }
    }
}

// ─── Process Info ───────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProcessInfo {
    pub pid: u32,
    pub ppid: u32,
    pub user: String,
    pub group: String,
    pub state: ProcessState,
    pub command: String,
    pub full_cmdline: String,
    pub exe_path: String,
    pub cwd: String,
    pub cpu_percent: f64,
    pub memory_percent: f64,
    pub rss_bytes: u64,
    pub vsz_bytes: u64,
    pub threads: u32,
    pub nice: i32,
    pub priority: i32,
    pub start_time: String,
    pub elapsed: String,
    pub tty: String,
    pub wchan: String,
}

// ─── Process Tree ───────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProcessTree {
    pub process: ProcessInfo,
    pub children: Vec<ProcessTree>,
}

// ─── Signal ─────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum Signal {
    Sighup = 1,
    Sigint = 2,
    Sigquit = 3,
    Sigill = 4,
    Sigtrap = 5,
    Sigabrt = 6,
    Sigbus = 7,
    Sigfpe = 8,
    Sigkill = 9,
    Sigusr1 = 10,
    Sigsegv = 11,
    Sigusr2 = 12,
    Sigpipe = 13,
    Sigalrm = 14,
    Sigterm = 15,
    Sigstkflt = 16,
    Sigchld = 17,
    Sigcont = 18,
    Sigstop = 19,
    Sigtstp = 20,
    Sigttin = 21,
    Sigttou = 22,
    Sigurg = 23,
    Sigxcpu = 24,
    Sigxfsz = 25,
    Sigvtalrm = 26,
    Sigprof = 27,
    Sigwinch = 28,
    Sigio = 29,
    Sigpwr = 30,
    Sigsys = 31,
    Sigrtmin = 34,
    Sigrtmin1 = 35,
    Sigrtmin2 = 36,
    Sigrtmin3 = 37,
    Sigrtmin4 = 38,
    Sigrtmin5 = 39,
    Sigrtmin6 = 40,
    Sigrtmin7 = 41,
    Sigrtmin8 = 42,
    Sigrtmin9 = 43,
    Sigrtmin10 = 44,
    Sigrtmin11 = 45,
    Sigrtmin12 = 46,
    Sigrtmin13 = 47,
    Sigrtmin14 = 48,
    Sigrtmin15 = 49,
    Sigrtmax14 = 50,
    Sigrtmax13 = 51,
    Sigrtmax12 = 52,
    Sigrtmax11 = 53,
    Sigrtmax10 = 54,
    Sigrtmax9 = 55,
    Sigrtmax8 = 56,
    Sigrtmax7 = 57,
    Sigrtmax6 = 58,
    Sigrtmax5 = 59,
    Sigrtmax4 = 60,
    Sigrtmax3 = 61,
    Sigrtmax2 = 62,
    Sigrtmax1 = 63,
    Sigrtmax = 64,
}

impl Signal {
    /// Signal number for use with `kill -N`.
    pub fn number(self) -> i32 {
        self as i32
    }

    /// Signal name for use with `kill -s NAME`.
    pub fn name(self) -> &'static str {
        match self {
            Self::Sighup => "HUP",
            Self::Sigint => "INT",
            Self::Sigquit => "QUIT",
            Self::Sigill => "ILL",
            Self::Sigtrap => "TRAP",
            Self::Sigabrt => "ABRT",
            Self::Sigbus => "BUS",
            Self::Sigfpe => "FPE",
            Self::Sigkill => "KILL",
            Self::Sigusr1 => "USR1",
            Self::Sigsegv => "SEGV",
            Self::Sigusr2 => "USR2",
            Self::Sigpipe => "PIPE",
            Self::Sigalrm => "ALRM",
            Self::Sigterm => "TERM",
            Self::Sigstkflt => "STKFLT",
            Self::Sigchld => "CHLD",
            Self::Sigcont => "CONT",
            Self::Sigstop => "STOP",
            Self::Sigtstp => "TSTP",
            Self::Sigttin => "TTIN",
            Self::Sigttou => "TTOU",
            Self::Sigurg => "URG",
            Self::Sigxcpu => "XCPU",
            Self::Sigxfsz => "XFSZ",
            Self::Sigvtalrm => "VTALRM",
            Self::Sigprof => "PROF",
            Self::Sigwinch => "WINCH",
            Self::Sigio => "IO",
            Self::Sigpwr => "PWR",
            Self::Sigsys => "SYS",
            _ => "RTMIN",
        }
    }
}

// ─── Open Files ─────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FileType {
    Regular,
    Directory,
    Socket,
    Pipe,
    Device,
    AnonInode,
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpenFile {
    pub fd: String,
    pub file_type: FileType,
    pub path: String,
    pub mode: String,
}

// ─── Sockets ────────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SocketProtocol {
    Tcp,
    Udp,
    Tcp6,
    Udp6,
    Unix,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SocketInfo {
    pub protocol: SocketProtocol,
    pub local_addr: String,
    pub remote_addr: String,
    pub state: String,
    pub pid: Option<u32>,
    pub program: String,
}

// ─── Process Environment ────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProcessEnvironment {
    pub pid: u32,
    pub variables: HashMap<String, String>,
}

// ─── Process Limits ─────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LimitValue {
    pub soft: String,
    pub hard: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProcessLimits {
    pub pid: u32,
    pub max_open_files: LimitValue,
    pub max_processes: LimitValue,
    pub max_stack_size: LimitValue,
    pub max_memory: LimitValue,
    pub max_file_size: LimitValue,
    pub max_locked_memory: LimitValue,
    pub max_address_space: LimitValue,
    pub max_cpu_time: LimitValue,
    pub max_core_file: LimitValue,
    pub max_nice: LimitValue,
    pub max_realtime_priority: LimitValue,
}

// ─── Process Namespace ──────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProcessNamespace {
    pub pid: u32,
    pub pid_ns: String,
    pub mnt_ns: String,
    pub net_ns: String,
    pub uts_ns: String,
    pub ipc_ns: String,
    pub user_ns: String,
    pub cgroup_ns: String,
}

// ─── Cgroup Info ────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CgroupVersion {
    V1,
    V2,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CgroupInfo {
    pub version: CgroupVersion,
    pub controllers: Vec<String>,
    pub path: String,
    pub cpu_shares: Option<u64>,
    pub memory_limit: Option<u64>,
    pub io_weight: Option<u32>,
}

// ─── System Load ────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SystemLoad {
    pub load_1min: f64,
    pub load_5min: f64,
    pub load_15min: f64,
    pub running_processes: u32,
    pub total_processes: u32,
    pub last_pid: u32,
}

// ─── Uptime ─────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UptimeInfo {
    pub uptime_secs: f64,
    pub idle_secs: f64,
    pub boot_time: DateTime<Utc>,
    pub users_count: u32,
}

// ─── Top Process ────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TopProcess {
    pub pid: u32,
    pub user: String,
    pub cpu_percent: f64,
    pub memory_percent: f64,
    pub command: String,
}

// ─── Memory Map ─────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryMap {
    pub address_range: String,
    pub permissions: String,
    pub offset: String,
    pub device: String,
    pub inode: u64,
    pub pathname: String,
}

// ─── Process I/O ────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProcessIo {
    pub pid: u32,
    pub read_bytes: u64,
    pub write_bytes: u64,
    pub read_syscalls: u64,
    pub write_syscalls: u64,
    pub cancelled_write_bytes: u64,
}
