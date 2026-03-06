//! Data types for file sharing management.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SshConfig { pub host: String, pub port: u16, pub username: String, pub auth: SshAuth, pub timeout_secs: u64 }
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum SshAuth { Password { password: String }, PrivateKey { key_path: String, passphrase: Option<String> }, Agent }
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileSharingHost { pub id: String, pub name: String, pub ssh: Option<SshConfig>, pub use_sudo: bool, pub created_at: DateTime<Utc>, pub updated_at: DateTime<Utc> }

// ─── NFS ────────────────────────────────────────────────────────────
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NfsExport {
    pub path: String,
    pub clients: Vec<NfsClient>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NfsClient {
    pub host: String,
    pub options: Vec<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NfsServerConfig { pub nfs_version: Option<String>, pub threads: Option<u32>, pub exports: Vec<NfsExport> }
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NfsActiveClient { pub client_ip: String, pub export_path: String, pub nfs_version: String }

// ─── Samba ──────────────────────────────────────────────────────────
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SambaGlobalConfig {
    pub workgroup: Option<String>,
    pub server_string: Option<String>,
    pub netbios_name: Option<String>,
    pub security: Option<String>,
    pub map_to_guest: Option<String>,
    pub log_file: Option<String>,
    pub max_log_size: Option<u32>,
    pub settings: HashMap<String, String>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SambaShare {
    pub name: String,
    pub path: String,
    pub comment: Option<String>,
    pub browseable: bool,
    pub writable: bool,
    pub guest_ok: bool,
    pub read_only: bool,
    pub valid_users: Vec<String>,
    pub write_list: Vec<String>,
    pub create_mask: Option<String>,
    pub directory_mask: Option<String>,
    pub force_user: Option<String>,
    pub force_group: Option<String>,
    pub settings: HashMap<String, String>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SambaUser { pub username: String, pub sid: Option<String>, pub flags: Vec<String> }
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SambaConnection { pub pid: u32, pub username: String, pub group: String, pub machine: String, pub share: Option<String> }
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SambaFullConfig { pub global: SambaGlobalConfig, pub shares: Vec<SambaShare> }

// ─── Health ─────────────────────────────────────────────────────────
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileSharingHealthCheck {
    pub nfs_running: bool, pub samba_running: bool,
    pub nfs_exports_count: u32, pub samba_shares_count: u32,
    pub active_nfs_clients: u32, pub active_samba_connections: u32,
    pub warnings: Vec<String>, pub checked_at: DateTime<Utc>,
}
