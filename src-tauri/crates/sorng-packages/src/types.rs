//! Data types for package management.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SshConfig { pub host: String, pub port: u16, pub username: String, pub auth: SshAuth, pub timeout_secs: u64 }
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum SshAuth { Password { password: String }, PrivateKey { key_path: String, passphrase: Option<String> }, Agent }
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PkgHost { pub id: String, pub name: String, pub ssh: Option<SshConfig>, pub use_sudo: bool, pub backend: PkgBackend, pub created_at: DateTime<Utc>, pub updated_at: DateTime<Utc> }

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PkgBackend { Apt, Dnf, Yum, Pacman, Zypper }

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Package {
    pub name: String,
    pub version: String,
    pub architecture: Option<String>,
    pub description: Option<String>,
    pub installed: bool,
    pub repo: Option<String>,
    pub size: Option<u64>,
    pub install_date: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PackageUpdate {
    pub name: String,
    pub current_version: String,
    pub new_version: String,
    pub repo: Option<String>,
    pub security: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PackageRepo {
    pub id: String,
    pub name: String,
    pub url: String,
    pub enabled: bool,
    pub repo_type: Option<String>,
    pub gpg_check: bool,
    pub gpg_key: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PackageGroup { pub name: String, pub description: Option<String>, pub packages: Vec<String>, pub installed: bool }

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SnapPackage { pub name: String, pub version: String, pub rev: String, pub channel: String, pub publisher: Option<String>, pub description: Option<String>, pub confined: bool }
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FlatpakPackage { pub app_id: String, pub name: String, pub version: String, pub origin: String, pub branch: String, pub arch: String }

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PkgHealthCheck {
    pub backend: PkgBackend, pub total_installed: u32, pub updates_available: u32,
    pub security_updates: u32, pub repos_count: u32, pub auto_update_enabled: bool,
    pub last_update: Option<DateTime<Utc>>, pub warnings: Vec<String>, pub checked_at: DateTime<Utc>,
}
