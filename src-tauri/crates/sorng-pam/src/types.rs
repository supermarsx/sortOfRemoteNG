//! Data types for PAM management.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// ─── Host / SSH ─────────────────────────────────────────────────────

/// SSH connection configuration for reaching a PAM host.
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

/// A managed PAM host (local or remote).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PamHost {
    pub id: String,
    pub name: String,
    pub ssh: Option<SshConfig>,
    #[serde(default)]
    pub use_sudo: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

// ─── PAM Module Types ───────────────────────────────────────────────

/// PAM module type — the first column in a PAM service file.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PamModuleType {
    Auth,
    Account,
    Password,
    Session,
}

impl PamModuleType {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Auth => "auth",
            Self::Account => "account",
            Self::Password => "password",
            Self::Session => "session",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s.trim().to_lowercase().as_str() {
            "auth" => Some(Self::Auth),
            "account" => Some(Self::Account),
            "password" => Some(Self::Password),
            "session" => Some(Self::Session),
            // handle -session, -auth etc. (optional prefix meaning silent)
            s if s.starts_with('-') => Self::parse(&s[1..]),
            _ => None,
        }
    }
}

/// PAM control flag — the second column in a PAM service file.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PamControlFlag {
    Required,
    Requisite,
    Sufficient,
    Optional,
    Include,
    Substack,
    /// Complex control syntax like [success=1 default=ignore]
    Complex(String),
}

impl PamControlFlag {
    pub fn as_str(&self) -> String {
        match self {
            Self::Required => "required".to_string(),
            Self::Requisite => "requisite".to_string(),
            Self::Sufficient => "sufficient".to_string(),
            Self::Optional => "optional".to_string(),
            Self::Include => "include".to_string(),
            Self::Substack => "substack".to_string(),
            Self::Complex(s) => s.clone(),
        }
    }

    pub fn parse(s: &str) -> Self {
        match s.trim().to_lowercase().as_str() {
            "required" => Self::Required,
            "requisite" => Self::Requisite,
            "sufficient" => Self::Sufficient,
            "optional" => Self::Optional,
            "include" => Self::Include,
            "substack" => Self::Substack,
            other => {
                if other.starts_with('[') && other.ends_with(']') {
                    Self::Complex(other.to_string())
                } else {
                    Self::Complex(other.to_string())
                }
            }
        }
    }
}

// ─── PAM Service Lines ──────────────────────────────────────────────

/// A single line from a PAM service configuration file.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PamModuleLine {
    pub module_type: PamModuleType,
    pub control: PamControlFlag,
    pub module_path: String,
    pub arguments: Vec<String>,
    /// Optional trailing comment
    pub comment: Option<String>,
    /// Whether this line had a leading `-` (silent flag)
    #[serde(default)]
    pub silent: bool,
}

impl PamModuleLine {
    /// Serialize back to PAM config format.
    pub fn to_config_line(&self) -> String {
        let prefix = if self.silent { "-" } else { "" };
        let mut parts = vec![
            format!("{}{}", prefix, self.module_type.as_str()),
            self.control.as_str(),
            self.module_path.clone(),
        ];
        for arg in &self.arguments {
            parts.push(arg.clone());
        }
        let line = parts.join("\t");
        if let Some(ref comment) = self.comment {
            format!("{}\t# {}", line, comment)
        } else {
            line
        }
    }
}

/// A PAM service (one file in /etc/pam.d/).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PamService {
    pub name: String,
    pub lines: Vec<PamModuleLine>,
    /// Names of services included via @include / include directives
    pub includes: Vec<String>,
    pub file_path: String,
}

// ─── PAM Module Info ────────────────────────────────────────────────

/// Information about an installed PAM module.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PamModuleInfo {
    pub name: String,
    pub path: String,
    pub description: String,
    pub available: bool,
}

// ─── Limits ─────────────────────────────────────────────────────────

/// Limit type (soft, hard, or both).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LimitType {
    Soft,
    Hard,
    Both,
}

impl LimitType {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Soft => "soft",
            Self::Hard => "hard",
            Self::Both => "-",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s.trim().to_lowercase().as_str() {
            "soft" => Some(Self::Soft),
            "hard" => Some(Self::Hard),
            "-" => Some(Self::Both),
            _ => None,
        }
    }
}

/// Resource limit items from limits.conf.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PamLimitItem {
    Core,
    Data,
    Fsize,
    Memlock,
    Nofile,
    Rss,
    Stack,
    Cpu,
    Nproc,
    As,
    Maxlogins,
    Maxsyslogins,
    Priority,
    Locks,
    Sigpending,
    Msgqueue,
    Nice,
    Rtprio,
}

impl PamLimitItem {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Core => "core",
            Self::Data => "data",
            Self::Fsize => "fsize",
            Self::Memlock => "memlock",
            Self::Nofile => "nofile",
            Self::Rss => "rss",
            Self::Stack => "stack",
            Self::Cpu => "cpu",
            Self::Nproc => "nproc",
            Self::As => "as",
            Self::Maxlogins => "maxlogins",
            Self::Maxsyslogins => "maxsyslogins",
            Self::Priority => "priority",
            Self::Locks => "locks",
            Self::Sigpending => "sigpending",
            Self::Msgqueue => "msgqueue",
            Self::Nice => "nice",
            Self::Rtprio => "rtprio",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s.trim().to_lowercase().as_str() {
            "core" => Some(Self::Core),
            "data" => Some(Self::Data),
            "fsize" => Some(Self::Fsize),
            "memlock" => Some(Self::Memlock),
            "nofile" => Some(Self::Nofile),
            "rss" => Some(Self::Rss),
            "stack" => Some(Self::Stack),
            "cpu" => Some(Self::Cpu),
            "nproc" => Some(Self::Nproc),
            "as" => Some(Self::As),
            "maxlogins" => Some(Self::Maxlogins),
            "maxsyslogins" => Some(Self::Maxsyslogins),
            "priority" => Some(Self::Priority),
            "locks" => Some(Self::Locks),
            "sigpending" => Some(Self::Sigpending),
            "msgqueue" => Some(Self::Msgqueue),
            "nice" => Some(Self::Nice),
            "rtprio" => Some(Self::Rtprio),
            _ => None,
        }
    }
}

/// A single resource limit entry from /etc/security/limits.conf.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PamLimit {
    /// Domain — username, @group, %, or *
    pub domain: String,
    pub limit_type: LimitType,
    pub item: PamLimitItem,
    /// Value — a number or "unlimited"
    pub value: String,
}

impl PamLimit {
    /// Serialize to limits.conf line format.
    pub fn to_config_line(&self) -> String {
        format!(
            "{}\t{}\t{}\t{}",
            self.domain,
            self.limit_type.as_str(),
            self.item.as_str(),
            self.value
        )
    }
}

// ─── Access Control ─────────────────────────────────────────────────

/// A rule from /etc/security/access.conf.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PamAccessRule {
    /// '+' (allow) or '-' (deny)
    pub permission: String,
    /// Users/groups this rule applies to
    pub users: Vec<String>,
    /// Origins (tty, host, domain, address)
    pub origins: Vec<String>,
}

impl PamAccessRule {
    /// Serialize to access.conf line format.
    pub fn to_config_line(&self) -> String {
        format!(
            "{} : {} : {}",
            self.permission,
            self.users.join(" "),
            self.origins.join(" ")
        )
    }
}

// ─── Time Rules ─────────────────────────────────────────────────────

/// A rule from /etc/security/time.conf.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PamTimeRule {
    /// Services this rule applies to (semicolon-separated in file)
    pub services: String,
    /// TTYs this rule applies to
    pub ttys: String,
    /// Users this rule applies to
    pub users: String,
    /// Times specification (e.g., "Al0800-1800")
    pub times: String,
}

impl PamTimeRule {
    /// Serialize to time.conf line format.
    pub fn to_config_line(&self) -> String {
        format!(
            "{};{};{};{}",
            self.services, self.ttys, self.users, self.times
        )
    }
}

// ─── Password Quality ───────────────────────────────────────────────

/// Password quality settings from /etc/security/pwquality.conf.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PwQualityConfig {
    /// Minimum number of characters that must differ from the old password
    pub difok: Option<i32>,
    /// Minimum password length
    pub minlen: Option<i32>,
    /// Credit for digits (negative = required minimum)
    pub dcredit: Option<i32>,
    /// Credit for uppercase letters
    pub ucredit: Option<i32>,
    /// Credit for lowercase letters
    pub lcredit: Option<i32>,
    /// Credit for other characters
    pub ocredit: Option<i32>,
    /// Minimum number of character classes required
    pub minclass: Option<i32>,
    /// Maximum number of consecutive same characters
    pub maxrepeat: Option<i32>,
    /// Maximum length of monotonic sequence
    pub maxsequence: Option<i32>,
    /// Maximum number of consecutive characters from same class
    pub maxclassrepeat: Option<i32>,
    /// Check if password contains the user's GECOS field info
    pub gecoscheck: Option<bool>,
    /// Check against cracklib dictionary
    pub dictcheck: Option<bool>,
    /// Check if password contains the username
    pub usercheck: Option<bool>,
    /// Whether rules are enforced (vs advisory)
    pub enforcing: Option<bool>,
    /// All raw key=value pairs (superset of above)
    #[serde(default)]
    pub all_settings: HashMap<String, String>,
}

impl Default for PwQualityConfig {
    fn default() -> Self {
        Self {
            difok: None,
            minlen: None,
            dcredit: None,
            ucredit: None,
            lcredit: None,
            ocredit: None,
            minclass: None,
            maxrepeat: None,
            maxsequence: None,
            maxclassrepeat: None,
            gecoscheck: None,
            dictcheck: None,
            usercheck: None,
            enforcing: None,
            all_settings: HashMap::new(),
        }
    }
}

// ─── Namespace ──────────────────────────────────────────────────────

/// A polyinstantiation rule from /etc/security/namespace.conf.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PamNamespaceRule {
    /// Directory to polyinstantiate (e.g., /tmp, /var/tmp)
    pub polydir: String,
    /// Instance method: user, context, level, tmpdir, tmpfs
    pub instance_method: String,
    /// Method-specific options
    pub method_options: Vec<String>,
}

impl PamNamespaceRule {
    /// Serialize to namespace.conf line format.
    pub fn to_config_line(&self) -> String {
        if self.method_options.is_empty() {
            format!("{}\t{}", self.polydir, self.instance_method)
        } else {
            format!(
                "{}\t{}\t{}",
                self.polydir,
                self.instance_method,
                self.method_options.join("\t")
            )
        }
    }
}

// ─── Login Defaults ─────────────────────────────────────────────────

/// Settings from /etc/login.defs.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoginDefs {
    /// All key-value settings from the file
    pub settings: HashMap<String, String>,
}

impl LoginDefs {
    pub fn get(&self, key: &str) -> Option<&String> {
        self.settings.get(key)
    }

    pub fn get_i32(&self, key: &str) -> Option<i32> {
        self.settings.get(key).and_then(|v| v.parse().ok())
    }

    pub fn get_bool(&self, key: &str) -> Option<bool> {
        self.settings.get(key).map(|v| {
            matches!(v.to_lowercase().as_str(), "yes" | "true" | "1")
        })
    }
}
