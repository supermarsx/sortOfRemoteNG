//! Data types for LDAP management.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SshConfig { pub host: String, pub port: u16, pub username: String, pub auth: SshAuth, pub timeout_secs: u64 }
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum SshAuth { Password { password: String }, PrivateKey { key_path: String, passphrase: Option<String> }, Agent }
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LdapHost {
    pub id: String, pub name: String, pub ssh: Option<SshConfig>, pub use_sudo: bool,
    pub backend: LdapBackend, pub ldap_uri: String, pub base_dn: String,
    pub bind_dn: Option<String>, pub bind_password: Option<String>,
    pub use_tls: bool, pub created_at: DateTime<Utc>, pub updated_at: DateTime<Utc>,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LdapBackend { OpenLdap, Directory389, FreeIpa }

// ─── Entry ──────────────────────────────────────────────────────────
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LdapEntry {
    pub dn: String,
    pub object_classes: Vec<String>,
    pub attributes: HashMap<String, Vec<String>>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LdapSearchResult { pub entries: Vec<LdapEntry>, pub referrals: Vec<String>, pub total: u32 }
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LdapSearchOpts { pub base_dn: String, pub scope: LdapScope, pub filter: String, pub attributes: Vec<String>, pub size_limit: Option<u32> }
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LdapScope { Base, One, Sub }

// ─── User ───────────────────────────────────────────────────────────
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LdapUser {
    pub dn: String, pub uid: String, pub cn: String, pub sn: String,
    pub given_name: Option<String>, pub display_name: Option<String>,
    pub mail: Option<String>, pub uid_number: Option<u32>, pub gid_number: Option<u32>,
    pub home_directory: Option<String>, pub login_shell: Option<String>,
    pub member_of: Vec<String>, pub disabled: bool,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateLdapUserOpts {
    pub uid: String, pub cn: String, pub sn: String,
    pub given_name: Option<String>, pub mail: Option<String>,
    pub password: Option<String>, pub uid_number: Option<u32>,
    pub gid_number: Option<u32>, pub home_directory: Option<String>,
    pub login_shell: Option<String>, pub ou: Option<String>,
}

// ─── Group ──────────────────────────────────────────────────────────
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LdapGroup {
    pub dn: String, pub cn: String, pub gid_number: Option<u32>,
    pub members: Vec<String>, pub description: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateLdapGroupOpts { pub cn: String, pub gid_number: Option<u32>, pub description: Option<String>, pub ou: Option<String> }

// ─── OU ─────────────────────────────────────────────────────────────
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrganizationalUnit { pub dn: String, pub ou: String, pub description: Option<String> }

// ─── Schema ─────────────────────────────────────────────────────────
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LdapSchema { pub name: String, pub oid: String, pub description: Option<String>, pub attributes: Vec<String>, pub object_classes: Vec<String> }
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LdapAttributeType { pub name: String, pub oid: String, pub syntax: String, pub single_value: bool, pub description: Option<String> }
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LdapObjectClass { pub name: String, pub oid: String, pub kind: String, pub must: Vec<String>, pub may: Vec<String> }

// ─── Replication ────────────────────────────────────────────────────
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReplicationConfig { pub provider_uri: String, pub consumer_uri: String, pub repl_type: ReplicationType, pub base_dn: String, pub bind_dn: String, pub interval: Option<String> }
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ReplicationType { SyncRepl, MirrorMode, MultiMaster }
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReplicationStatus { pub provider: String, pub consumer: String, pub in_sync: bool, pub lag_seconds: Option<u64>, pub last_sync: Option<DateTime<Utc>> }

// ─── LDIF ───────────────────────────────────────────────────────────
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LdifChangeType { Add, Delete, Modify, ModRdn }
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LdifRecord { pub dn: String, pub change_type: LdifChangeType, pub attributes: HashMap<String, Vec<String>> }

// ─── Health ─────────────────────────────────────────────────────────
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LdapHealthCheck {
    pub backend: LdapBackend, pub service_running: bool, pub reachable: bool,
    pub tls_enabled: bool, pub total_entries: u32, pub user_count: u32, pub group_count: u32,
    pub replication_ok: bool, pub warnings: Vec<String>, pub checked_at: DateTime<Utc>,
}
