// ── sorng-mac/src/types.rs ────────────────────────────────────────────────────
//! All types used across the sorng-mac crate.

use serde::{Deserialize, Serialize};

// ═══════════════════════════════════════════════════════════════════════════════
// Connection & Top-Level
// ═══════════════════════════════════════════════════════════════════════════════

/// SSH connection configuration for a MAC-managed host.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MacConnectionConfig {
    pub host: String,
    pub port: Option<u16>,
    pub ssh_user: String,
    pub ssh_password: Option<String>,
    pub ssh_key: Option<String>,
    pub timeout_secs: Option<u64>,
    pub sudo_password: Option<String>,
}

/// Summary returned after a successful connection.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MacConnectionSummary {
    pub host: String,
    pub mac_system: MacSystemType,
    pub version: Option<String>,
    pub enforcing: bool,
    pub active_modules_count: u32,
}

/// Which MAC framework is active on the host.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum MacSystemType {
    SELinux,
    AppArmor,
    Tomoyo,
    Smack,
    None,
}

/// Aggregated dashboard data for the active MAC system.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MacDashboard {
    pub system_type: MacSystemType,
    pub mode: String,
    pub policy_version: Option<String>,
    pub loaded_modules: u32,
    pub active_booleans: u32,
    pub denied_count_24h: u64,
    pub profiles_count: u32,
    pub last_audit: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// SELinux Types
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SelinuxMode {
    Enforcing,
    Permissive,
    Disabled,
}

impl std::fmt::Display for SelinuxMode {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Enforcing => write!(f, "Enforcing"),
            Self::Permissive => write!(f, "Permissive"),
            Self::Disabled => write!(f, "Disabled"),
        }
    }
}

impl SelinuxMode {
    pub fn from_str_loose(s: &str) -> Self {
        match s.trim().to_lowercase().as_str() {
            "enforcing" => Self::Enforcing,
            "permissive" => Self::Permissive,
            _ => Self::Disabled,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SelinuxStatus {
    pub mode: SelinuxMode,
    pub policy_name: String,
    pub policy_version: String,
    pub max_kernel_policy_version: u32,
    pub loaded_policy_type: String,
    pub root_login_allowed: bool,
    pub max_open_files: u64,
    pub max_categories: u32,
    pub policy_deny_unknown: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SelinuxBoolean {
    pub name: String,
    pub current_value: bool,
    pub pending_value: bool,
    pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SelinuxModule {
    pub name: String,
    pub version: String,
    pub priority: u32,
    pub enabled: bool,
    pub cil: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SelinuxContext {
    pub user: String,
    pub role: String,
    pub type_field: String,
    pub level: String,
}

impl SelinuxContext {
    /// Parse a context string like "system_u:object_r:httpd_sys_content_t:s0"
    pub fn parse(s: &str) -> Option<Self> {
        let parts: Vec<&str> = s.split(':').collect();
        if parts.len() >= 4 {
            Some(Self {
                user: parts[0].to_string(),
                role: parts[1].to_string(),
                type_field: parts[2].to_string(),
                level: parts[3..].join(":"),
            })
        } else {
            None
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SelinuxFileContext {
    pub pattern: String,
    pub context: String,
    pub file_type: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SelinuxPort {
    pub protocol: String,
    pub port_range: String,
    pub context_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SelinuxUser {
    pub name: String,
    pub prefix: String,
    pub mls_level: String,
    pub mls_range: String,
    pub selinux_roles: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SelinuxRole {
    pub name: String,
    pub types: Vec<String>,
    pub default_type: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SelinuxPolicy {
    pub name: String,
    pub version: String,
    pub module_count: u32,
    pub boolean_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SelinuxAuditEntry {
    pub timestamp: String,
    pub event_type: String,
    pub source_context: Option<String>,
    pub target_context: Option<String>,
    pub target_class: Option<String>,
    pub permission: Option<String>,
    pub result: String,
    pub comm: Option<String>,
    pub path: Option<String>,
    pub pid: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SetBooleanRequest {
    pub name: String,
    pub value: bool,
    pub persistent: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SetModeRequest {
    pub mode: SelinuxMode,
    pub persistent: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AddFileContextRequest {
    pub pattern: String,
    pub context_type: String,
    pub context: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AddPortContextRequest {
    pub protocol: String,
    pub port_range: String,
    pub context_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ManageModuleRequest {
    pub action: ModuleAction,
    pub name: String,
    pub data_base64: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ModuleAction {
    Install,
    Remove,
    Enable,
    Disable,
}

// ═══════════════════════════════════════════════════════════════════════════════
// AppArmor Types
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppArmorStatus {
    pub version: String,
    pub profiles_loaded: u32,
    pub profiles_enforcing: u32,
    pub profiles_complain: u32,
    pub profiles_kill: u32,
    pub profiles_unconfined: u32,
    pub processes_confined: u32,
    pub processes_unconfined: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppArmorProfile {
    pub name: String,
    pub mode: AppArmorMode,
    pub pid_count: u32,
    pub source_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AppArmorMode {
    Enforce,
    Complain,
    Kill,
    Unconfined,
    Disabled,
}

impl std::fmt::Display for AppArmorMode {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Enforce => write!(f, "enforce"),
            Self::Complain => write!(f, "complain"),
            Self::Kill => write!(f, "kill"),
            Self::Unconfined => write!(f, "unconfined"),
            Self::Disabled => write!(f, "disabled"),
        }
    }
}

impl AppArmorMode {
    pub fn from_str_loose(s: &str) -> Self {
        match s.trim().to_lowercase().as_str() {
            "enforce" => Self::Enforce,
            "complain" => Self::Complain,
            "kill" => Self::Kill,
            "unconfined" => Self::Unconfined,
            _ => Self::Disabled,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppArmorLogEntry {
    pub timestamp: String,
    pub profile_name: String,
    pub operation: String,
    pub denied: bool,
    pub info: Option<String>,
    pub comm: Option<String>,
    pub requested_mask: Option<String>,
    pub fsuid: Option<u32>,
    pub ouid: Option<u32>,
    pub target: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SetProfileModeRequest {
    pub profile_name: String,
    pub mode: AppArmorMode,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateProfileRequest {
    pub program_path: String,
    pub template: Option<String>,
    pub description: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// TOMOYO Types
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TomoyoStatus {
    pub enabled: bool,
    pub learning_domains: u32,
    pub enforcing_domains: u32,
    pub permissive_domains: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TomoyoDomain {
    pub name: String,
    pub mode: TomoyoMode,
    pub rules_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TomoyoMode {
    Disabled,
    Learning,
    Permissive,
    Enforcing,
}

impl std::fmt::Display for TomoyoMode {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Disabled => write!(f, "disabled"),
            Self::Learning => write!(f, "learning"),
            Self::Permissive => write!(f, "permissive"),
            Self::Enforcing => write!(f, "enforcing"),
        }
    }
}

impl TomoyoMode {
    pub fn from_str_loose(s: &str) -> Self {
        match s.trim().to_lowercase().as_str() {
            "learning" => Self::Learning,
            "permissive" => Self::Permissive,
            "enforcing" => Self::Enforcing,
            _ => Self::Disabled,
        }
    }
    pub fn to_flag(&self) -> u8 {
        match self {
            Self::Disabled => 0,
            Self::Learning => 1,
            Self::Permissive => 2,
            Self::Enforcing => 3,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TomoyoRule {
    pub domain: String,
    pub permission: String,
    pub target: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SetDomainModeRequest {
    pub domain: String,
    pub mode: TomoyoMode,
}

// ═══════════════════════════════════════════════════════════════════════════════
// SMACK Types
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SmackStatus {
    pub enabled: bool,
    pub labels_count: u32,
    pub rules_count: u32,
    pub default_label: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SmackLabel {
    pub name: String,
    pub associated_processes: u32,
    pub access_count: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SmackRule {
    pub subject: String,
    pub object: String,
    pub access: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AddSmackRuleRequest {
    pub subject: String,
    pub object: String,
    pub access: String,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Compliance Types
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ComplianceResult {
    pub framework: String,
    pub total_checks: u32,
    pub passed: u32,
    pub failed: u32,
    pub warnings: u32,
    pub score_percent: f64,
    pub checks: Vec<ComplianceCheck>,
    pub timestamp: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ComplianceCheck {
    pub id: String,
    pub title: String,
    pub description: String,
    pub severity: Severity,
    pub status: CheckStatus,
    pub remediation: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Severity {
    Critical,
    High,
    Medium,
    Low,
    Info,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CheckStatus {
    Pass,
    Fail,
    Warning,
    NotApplicable,
    Error,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════════════

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_selinux_mode_from_str() {
        assert_eq!(
            SelinuxMode::from_str_loose("Enforcing"),
            SelinuxMode::Enforcing
        );
        assert_eq!(
            SelinuxMode::from_str_loose("permissive"),
            SelinuxMode::Permissive
        );
        assert_eq!(
            SelinuxMode::from_str_loose("DISABLED"),
            SelinuxMode::Disabled
        );
        assert_eq!(SelinuxMode::from_str_loose("junk"), SelinuxMode::Disabled);
    }

    #[test]
    fn test_selinux_mode_display() {
        assert_eq!(SelinuxMode::Enforcing.to_string(), "Enforcing");
        assert_eq!(SelinuxMode::Permissive.to_string(), "Permissive");
        assert_eq!(SelinuxMode::Disabled.to_string(), "Disabled");
    }

    #[test]
    fn test_selinux_context_parse() {
        let ctx = SelinuxContext::parse("system_u:object_r:httpd_sys_content_t:s0").unwrap();
        assert_eq!(ctx.user, "system_u");
        assert_eq!(ctx.role, "object_r");
        assert_eq!(ctx.type_field, "httpd_sys_content_t");
        assert_eq!(ctx.level, "s0");

        let ctx2 = SelinuxContext::parse("system_u:object_r:user_home_t:s0-s0:c0.c1023").unwrap();
        assert_eq!(ctx2.level, "s0-s0:c0.c1023");

        assert!(SelinuxContext::parse("invalid").is_none());
    }

    #[test]
    fn test_apparmor_mode_roundtrip() {
        assert_eq!(
            AppArmorMode::from_str_loose("enforce"),
            AppArmorMode::Enforce
        );
        assert_eq!(
            AppArmorMode::from_str_loose("complain"),
            AppArmorMode::Complain
        );
        assert_eq!(AppArmorMode::from_str_loose("kill"), AppArmorMode::Kill);
        assert_eq!(
            AppArmorMode::from_str_loose("unconfined"),
            AppArmorMode::Unconfined
        );
        assert_eq!(
            AppArmorMode::from_str_loose("garbage"),
            AppArmorMode::Disabled
        );
    }

    #[test]
    fn test_tomoyo_mode() {
        assert_eq!(TomoyoMode::from_str_loose("learning"), TomoyoMode::Learning);
        assert_eq!(
            TomoyoMode::from_str_loose("enforcing"),
            TomoyoMode::Enforcing
        );
        assert_eq!(TomoyoMode::Disabled.to_flag(), 0);
        assert_eq!(TomoyoMode::Enforcing.to_flag(), 3);
    }

    #[test]
    fn test_mac_system_type_serde() {
        let json = serde_json::to_string(&MacSystemType::SELinux).unwrap();
        assert!(json.contains("selinux") || json.contains("SELinux"));
        let parsed: MacSystemType = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed, MacSystemType::SELinux);
    }

    #[test]
    fn test_connection_config_serde() {
        let cfg = MacConnectionConfig {
            host: "192.168.1.10".into(),
            port: Some(22),
            ssh_user: "root".into(),
            ssh_password: None,
            ssh_key: Some("/home/user/.ssh/id_rsa".into()),
            timeout_secs: Some(30),
            sudo_password: None,
        };
        let json = serde_json::to_string(&cfg).unwrap();
        let parsed: MacConnectionConfig = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.host, "192.168.1.10");
        assert_eq!(parsed.port, Some(22));
    }

    #[test]
    fn test_severity_serde() {
        let json = serde_json::to_string(&Severity::Critical).unwrap();
        let parsed: Severity = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed, Severity::Critical);
    }

    #[test]
    fn test_check_status_serde() {
        let json = serde_json::to_string(&CheckStatus::NotApplicable).unwrap();
        let parsed: CheckStatus = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed, CheckStatus::NotApplicable);
    }

    #[test]
    fn test_module_action_serde() {
        let json = serde_json::to_string(&ModuleAction::Install).unwrap();
        let parsed: ModuleAction = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed, ModuleAction::Install);
    }

    #[test]
    fn test_dashboard_default_construction() {
        let dash = MacDashboard {
            system_type: MacSystemType::AppArmor,
            mode: "enforce".into(),
            policy_version: None,
            loaded_modules: 0,
            active_booleans: 0,
            denied_count_24h: 42,
            profiles_count: 15,
            last_audit: Some("2025-01-01T00:00:00Z".into()),
        };
        assert_eq!(dash.denied_count_24h, 42);
        assert_eq!(dash.profiles_count, 15);
    }
}
