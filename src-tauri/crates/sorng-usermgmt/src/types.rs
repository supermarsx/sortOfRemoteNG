//! Data types for Linux/Unix user and group management.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// ─── Host ───────────────────────────────────────────────────────────

/// SSH connection configuration for remote hosts.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SshConfig {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth: SshAuth,
    pub timeout_secs: u64,
}

/// SSH authentication method.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum SshAuth {
    Password { password: String },
    PrivateKey { key_path: String, passphrase: Option<String> },
    Agent,
}

/// A managed host for user/group management.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserMgmtHost {
    pub id: String,
    pub name: String,
    pub ssh: Option<SshConfig>,
    pub use_sudo: bool,
    pub os_family: OsFamily,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// OS family hint.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OsFamily {
    Debian,
    RedHat,
    Arch,
    Suse,
    Alpine,
    FreeBsd,
    OpenBsd,
    MacOs,
    Generic,
}

// ─── User ───────────────────────────────────────────────────────────

/// A system user parsed from /etc/passwd + /etc/shadow.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SystemUser {
    pub username: String,
    pub uid: u32,
    pub gid: u32,
    pub gecos: String,
    pub home_dir: String,
    pub shell: String,
    pub is_system: bool,
    pub is_locked: bool,
    pub has_password: bool,
    pub password_aging: Option<PasswordAging>,
    pub groups: Vec<String>,
    pub primary_group: String,
    pub last_login: Option<DateTime<Utc>>,
    pub last_password_change: Option<DateTime<Utc>>,
}

/// Options for creating a new user.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateUserOpts {
    pub username: String,
    pub uid: Option<u32>,
    pub gid: Option<u32>,
    pub comment: Option<String>,
    pub home_dir: Option<String>,
    pub create_home: bool,
    pub shell: Option<String>,
    pub password: Option<String>,
    pub system_account: bool,
    pub groups: Vec<String>,
    pub primary_group: Option<String>,
    pub skel_dir: Option<String>,
    pub expire_date: Option<String>,
    pub inactive_days: Option<i32>,
    pub no_login: bool,
    pub selinux_user: Option<String>,
}

/// Options for modifying an existing user.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModifyUserOpts {
    pub username: String,
    pub new_username: Option<String>,
    pub uid: Option<u32>,
    pub gid: Option<u32>,
    pub comment: Option<String>,
    pub home_dir: Option<String>,
    pub move_home: bool,
    pub shell: Option<String>,
    pub lock: Option<bool>,
    pub expire_date: Option<String>,
    pub groups: Option<Vec<String>>,
    pub append_groups: bool,
    pub primary_group: Option<String>,
    pub selinux_user: Option<String>,
}

/// Options for deleting a user.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeleteUserOpts {
    pub username: String,
    pub remove_home: bool,
    pub force: bool,
    pub backup_home: Option<String>,
}

// ─── Password / Aging ───────────────────────────────────────────────

/// Password aging information from /etc/shadow.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PasswordAging {
    /// Days since epoch of last password change
    pub last_change: Option<i64>,
    /// Minimum days between password changes
    pub min_days: Option<i32>,
    /// Maximum days a password is valid
    pub max_days: Option<i32>,
    /// Days before expiry to warn user
    pub warn_days: Option<i32>,
    /// Days after expiry until account is disabled
    pub inactive_days: Option<i32>,
    /// Days since epoch when account expires
    pub expire_date: Option<i64>,
    /// Whether the password is expired
    pub is_expired: bool,
    /// Days until password expires (None = never)
    pub days_until_expiry: Option<i64>,
}

/// Options for changing password aging via chage.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChangeAgingOpts {
    pub username: String,
    pub min_days: Option<i32>,
    pub max_days: Option<i32>,
    pub warn_days: Option<i32>,
    pub inactive_days: Option<i32>,
    pub expire_date: Option<String>,
    pub last_day: Option<i64>,
    pub force_change: bool,
}

// ─── Shadow Entry ───────────────────────────────────────────────────

/// A parsed /etc/shadow entry.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShadowEntry {
    pub username: String,
    pub password_hash: String,
    pub last_change: Option<i64>,
    pub min_days: Option<i32>,
    pub max_days: Option<i32>,
    pub warn_days: Option<i32>,
    pub inactive_days: Option<i32>,
    pub expire_date: Option<i64>,
    pub hash_algorithm: PasswordHashAlgorithm,
}

/// Password hashing algorithm.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PasswordHashAlgorithm {
    Md5,
    Sha256,
    Sha512,
    Blowfish,
    Yescrypt,
    Locked,
    NoPassword,
    Unknown,
}

// ─── Group ──────────────────────────────────────────────────────────

/// A system group parsed from /etc/group.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SystemGroup {
    pub name: String,
    pub gid: u32,
    pub members: Vec<String>,
    pub is_system: bool,
    pub has_password: bool,
    pub admins: Vec<String>,
}

/// Options for creating a new group.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateGroupOpts {
    pub name: String,
    pub gid: Option<u32>,
    pub system_group: bool,
    pub password: Option<String>,
    pub members: Vec<String>,
}

/// Options for modifying a group.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModifyGroupOpts {
    pub name: String,
    pub new_name: Option<String>,
    pub gid: Option<u32>,
    pub add_members: Vec<String>,
    pub remove_members: Vec<String>,
    pub set_members: Option<Vec<String>>,
    pub password: Option<String>,
    pub admins: Option<Vec<String>>,
}

// ─── Sudoers ────────────────────────────────────────────────────────

/// A parsed sudoers rule.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SudoersRule {
    pub id: String,
    pub principal: SudoersPrincipal,
    pub hosts: Vec<String>,
    pub run_as: Option<SudoersRunAs>,
    pub commands: Vec<String>,
    pub no_password: bool,
    pub tags: Vec<SudoersTag>,
    pub comment: Option<String>,
    pub source_file: String,
    pub line_number: u32,
}

/// Who the sudoers rule applies to.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum SudoersPrincipal {
    User { name: String },
    Group { name: String },
    Alias { name: String },
}

/// RunAs specification.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SudoersRunAs {
    pub users: Vec<String>,
    pub groups: Vec<String>,
}

/// Sudoers tags.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum SudoersTag {
    Nopasswd,
    Passwd,
    Noexec,
    Exec,
    Setenv,
    Nosetenv,
    Log,
    Nolog,
}

/// Sudoers alias definition.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SudoersAlias {
    pub alias_type: SudoersAliasType,
    pub name: String,
    pub members: Vec<String>,
}

/// Type of sudoers alias.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SudoersAliasType {
    UserAlias,
    HostAlias,
    CmndAlias,
    RunasAlias,
}

/// Sudoers defaults setting.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SudoersDefault {
    pub scope: SudoersDefaultScope,
    pub key: String,
    pub value: Option<String>,
    pub negated: bool,
}

/// Scope of a sudoers default.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum SudoersDefaultScope {
    Global,
    User { name: String },
    Host { name: String },
    RunAs { name: String },
    Command { name: String },
}

// ─── Shell ──────────────────────────────────────────────────────────

/// An available login shell.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoginShell {
    pub path: String,
    pub name: String,
    pub exists: bool,
}

// ─── Home Directory ─────────────────────────────────────────────────

/// Home directory information.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HomeInfo {
    pub path: String,
    pub exists: bool,
    pub owner_uid: Option<u32>,
    pub owner_gid: Option<u32>,
    pub size_bytes: Option<u64>,
    pub permissions: Option<String>,
    pub files_count: Option<u64>,
}

/// Skeleton directory template.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkelTemplate {
    pub path: String,
    pub files: Vec<SkelFile>,
}

/// A file in the skeleton directory.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkelFile {
    pub relative_path: String,
    pub file_type: SkelFileType,
    pub permissions: String,
    pub size_bytes: u64,
}

/// Type of skeleton file.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SkelFileType {
    File,
    Directory,
    Symlink,
}

// ─── Quotas ─────────────────────────────────────────────────────────

/// Disk quota for a user or group.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiskQuota {
    pub filesystem: String,
    pub principal: QuotaPrincipal,
    pub block_usage_kb: u64,
    pub block_soft_limit_kb: u64,
    pub block_hard_limit_kb: u64,
    pub inode_usage: u64,
    pub inode_soft_limit: u64,
    pub inode_hard_limit: u64,
    pub block_grace_remaining: Option<String>,
    pub inode_grace_remaining: Option<String>,
    pub over_block_soft: bool,
    pub over_inode_soft: bool,
}

/// Who the quota applies to.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum QuotaPrincipal {
    User { name: String, uid: u32 },
    Group { name: String, gid: u32 },
}

/// Options for setting a quota.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SetQuotaOpts {
    pub filesystem: String,
    pub principal: QuotaPrincipal,
    pub block_soft_kb: Option<u64>,
    pub block_hard_kb: Option<u64>,
    pub inode_soft: Option<u64>,
    pub inode_hard: Option<u64>,
}

// ─── Login Defs ─────────────────────────────────────────────────────

/// Parsed /etc/login.defs configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoginDefs {
    pub uid_min: u32,
    pub uid_max: u32,
    pub sys_uid_min: u32,
    pub sys_uid_max: u32,
    pub gid_min: u32,
    pub gid_max: u32,
    pub sys_gid_min: u32,
    pub sys_gid_max: u32,
    pub pass_max_days: i32,
    pub pass_min_days: i32,
    pub pass_warn_age: i32,
    pub pass_min_len: Option<i32>,
    pub login_retries: Option<i32>,
    pub login_timeout: Option<i32>,
    pub create_home: bool,
    pub default_home: Option<String>,
    pub umask: Option<String>,
    pub usergroups_enab: bool,
    pub encrypt_method: Option<String>,
    pub sha_crypt_rounds: Option<u32>,
    pub all_settings: HashMap<String, String>,
}

// ─── Sessions / Login History ───────────────────────────────────────

/// A login session from `last` or `who`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoginSession {
    pub username: String,
    pub terminal: String,
    pub remote_host: Option<String>,
    pub login_time: DateTime<Utc>,
    pub logout_time: Option<DateTime<Utc>>,
    pub duration_secs: Option<u64>,
    pub session_type: SessionType,
    pub still_active: bool,
}

/// Type of login session.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SessionType {
    Console,
    Ssh,
    Gui,
    Reboot,
    Shutdown,
    Unknown,
}

/// Last login information from `lastlog`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LastLogin {
    pub username: String,
    pub port: Option<String>,
    pub from_host: Option<String>,
    pub time: Option<DateTime<Utc>>,
    pub never_logged_in: bool,
}

/// Currently active session from `who` / `w`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActiveSession {
    pub username: String,
    pub terminal: String,
    pub remote_host: Option<String>,
    pub login_time: DateTime<Utc>,
    pub idle_time: Option<String>,
    pub current_process: Option<String>,
    pub cpu_time: Option<String>,
}

// ─── Bulk Operations ────────────────────────────────────────────────

/// A bulk user import record.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BulkUserRecord {
    pub username: String,
    pub password: Option<String>,
    pub uid: Option<u32>,
    pub gid: Option<u32>,
    pub comment: Option<String>,
    pub home_dir: Option<String>,
    pub shell: Option<String>,
    pub groups: Vec<String>,
    pub create_home: bool,
}

/// Result of a bulk import operation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BulkResult {
    pub total: usize,
    pub succeeded: usize,
    pub failed: usize,
    pub skipped: usize,
    pub results: Vec<BulkItemResult>,
}

/// Per-item result in a bulk operation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BulkItemResult {
    pub username: String,
    pub status: BulkItemStatus,
    pub message: Option<String>,
}

/// Status of a bulk item.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BulkItemStatus {
    Created,
    Updated,
    Deleted,
    Skipped,
    Failed,
}

// ─── Health Check ───────────────────────────────────────────────────

/// Health check result for user management subsystem.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserMgmtHealthCheck {
    pub passwd_readable: bool,
    pub shadow_readable: bool,
    pub group_readable: bool,
    pub useradd_available: bool,
    pub usermod_available: bool,
    pub userdel_available: bool,
    pub groupadd_available: bool,
    pub chage_available: bool,
    pub passwd_cmd_available: bool,
    pub sudo_available: bool,
    pub quota_available: bool,
    pub total_users: u32,
    pub total_groups: u32,
    pub system_users: u32,
    pub regular_users: u32,
    pub locked_users: u32,
    pub passwordless_users: u32,
    pub warnings: Vec<String>,
    pub checked_at: DateTime<Utc>,
}
