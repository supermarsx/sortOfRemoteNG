//! Service façade — manages multiple PAM hosts and delegates operations.

use crate::error::PamError;
use crate::types::{
    LoginDefs, PamAccessRule, PamHost, PamLimit, PamLimitItem, PamModuleInfo, PamModuleLine,
    PamNamespaceRule, PamService, PamTimeRule, PwQualityConfig,
};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

/// Shared state type alias for Tauri.
pub type PamServiceState = Arc<Mutex<PamService_>>;

/// Central service managing multiple PAM hosts.
pub struct PamService_ {
    hosts: HashMap<String, PamHost>,
}

impl PamService_ {
    /// Create a new service with empty state.
    pub fn new() -> PamServiceState {
        Arc::new(Mutex::new(Self {
            hosts: HashMap::new(),
        }))
    }

    // ─── Host Management ────────────────────────────────────────────

    /// Register a new host.
    pub fn add_host(&mut self, host: PamHost) -> Result<(), PamError> {
        if self.hosts.contains_key(&host.id) {
            return Err(PamError::InvalidConfig(format!(
                "Host {} already exists",
                host.id
            )));
        }
        self.hosts.insert(host.id.clone(), host);
        Ok(())
    }

    /// Update an existing host.
    pub fn update_host(&mut self, host: PamHost) -> Result<(), PamError> {
        if !self.hosts.contains_key(&host.id) {
            return Err(PamError::HostNotFound(host.id.clone()));
        }
        self.hosts.insert(host.id.clone(), host);
        Ok(())
    }

    /// Remove a host.
    pub fn remove_host(&mut self, host_id: &str) -> Result<PamHost, PamError> {
        self.hosts
            .remove(host_id)
            .ok_or_else(|| PamError::HostNotFound(host_id.to_string()))
    }

    /// Get a host by ID.
    pub fn get_host(&self, host_id: &str) -> Result<&PamHost, PamError> {
        self.hosts
            .get(host_id)
            .ok_or_else(|| PamError::HostNotFound(host_id.to_string()))
    }

    /// Clone a host by ID (for use outside the lock).
    pub fn clone_host(&self, host_id: &str) -> Result<PamHost, PamError> {
        self.get_host(host_id).cloned()
    }

    /// List all registered hosts.
    pub fn list_hosts(&self) -> Vec<PamHost> {
        self.hosts.values().cloned().collect()
    }
}

// ─── PAM Services ───────────────────────────────────────────────────

/// List PAM services on a host.
pub async fn host_list_services(host: &PamHost) -> Result<Vec<PamService>, PamError> {
    crate::services::list_services(host).await
}

/// Get a PAM service by name on a host.
pub async fn host_get_service(
    host: &PamHost,
    name: &str,
) -> Result<PamService, PamError> {
    crate::services::get_service(host, name).await
}

/// Create a PAM service on a host.
pub async fn host_create_service(
    host: &PamHost,
    name: &str,
    lines: &[PamModuleLine],
) -> Result<(), PamError> {
    crate::services::create_service(host, name, lines).await
}

/// Update a PAM service on a host.
pub async fn host_update_service(
    host: &PamHost,
    name: &str,
    lines: &[PamModuleLine],
) -> Result<(), PamError> {
    crate::services::update_service(host, name, lines).await
}

/// Delete a PAM service on a host.
pub async fn host_delete_service(host: &PamHost, name: &str) -> Result<(), PamError> {
    crate::services::delete_service(host, name).await
}

/// Backup a PAM service.
pub async fn host_backup_service(host: &PamHost, name: &str) -> Result<String, PamError> {
    crate::services::backup_service(host, name).await
}

/// Restore a PAM service from content.
pub async fn host_restore_service(
    host: &PamHost,
    name: &str,
    content: &str,
) -> Result<(), PamError> {
    crate::services::restore_service(host, name, content).await
}

/// Validate a PAM service.
pub async fn host_validate_service(
    host: &PamHost,
    name: &str,
) -> Result<Vec<String>, PamError> {
    crate::services::validate_service(host, name).await
}

// ─── PAM Modules ────────────────────────────────────────────────────

/// List available PAM modules on a host.
pub async fn host_list_modules(host: &PamHost) -> Result<Vec<PamModuleInfo>, PamError> {
    crate::modules::list_available_modules(host).await
}

/// Get module info on a host.
pub async fn host_get_module_info(
    host: &PamHost,
    module_name: &str,
) -> Result<PamModuleInfo, PamError> {
    crate::modules::get_module_info(host, module_name).await
}

/// Check if a module exists on a host.
pub async fn host_check_module(
    host: &PamHost,
    module_path: &str,
) -> Result<bool, PamError> {
    crate::modules::check_module_exists(host, module_path).await
}

/// Find which services use a module.
pub async fn host_find_module_users(
    host: &PamHost,
    module_name: &str,
) -> Result<Vec<String>, PamError> {
    crate::modules::find_module_users(host, module_name).await
}

// ─── Limits ─────────────────────────────────────────────────────────

/// Get limits.conf entries.
pub async fn host_get_limits(host: &PamHost) -> Result<Vec<PamLimit>, PamError> {
    crate::limits::get_limits(host).await
}

/// Set a limit.
pub async fn host_set_limit(host: &PamHost, limit: &PamLimit) -> Result<(), PamError> {
    crate::limits::set_limit(host, limit).await
}

/// Remove a limit.
pub async fn host_remove_limit(
    host: &PamHost,
    domain: &str,
    item: PamLimitItem,
) -> Result<(), PamError> {
    crate::limits::remove_limit(host, domain, item).await
}

/// Get limits.d entries.
pub async fn host_get_limits_d(
    host: &PamHost,
) -> Result<HashMap<String, Vec<PamLimit>>, PamError> {
    crate::limits::get_limits_d(host).await
}

// ─── Access Control ─────────────────────────────────────────────────

/// Get access.conf rules.
pub async fn host_get_access_rules(
    host: &PamHost,
) -> Result<Vec<PamAccessRule>, PamError> {
    crate::access::get_access_rules(host).await
}

/// Add an access rule.
pub async fn host_add_access_rule(
    host: &PamHost,
    rule: &PamAccessRule,
) -> Result<(), PamError> {
    crate::access::add_access_rule(host, rule).await
}

/// Remove an access rule.
pub async fn host_remove_access_rule(
    host: &PamHost,
    index: usize,
) -> Result<(), PamError> {
    crate::access::remove_access_rule(host, index).await
}

/// Update an access rule.
pub async fn host_update_access_rule(
    host: &PamHost,
    index: usize,
    rule: &PamAccessRule,
) -> Result<(), PamError> {
    crate::access::update_access_rule(host, index, rule).await
}

// ─── Time Rules ─────────────────────────────────────────────────────

/// Get time.conf rules.
pub async fn host_get_time_rules(host: &PamHost) -> Result<Vec<PamTimeRule>, PamError> {
    crate::time_conf::get_time_rules(host).await
}

/// Add a time rule.
pub async fn host_add_time_rule(
    host: &PamHost,
    rule: &PamTimeRule,
) -> Result<(), PamError> {
    crate::time_conf::add_time_rule(host, rule).await
}

/// Remove a time rule.
pub async fn host_remove_time_rule(
    host: &PamHost,
    index: usize,
) -> Result<(), PamError> {
    crate::time_conf::remove_time_rule(host, index).await
}

/// Update a time rule.
pub async fn host_update_time_rule(
    host: &PamHost,
    index: usize,
    rule: &PamTimeRule,
) -> Result<(), PamError> {
    crate::time_conf::update_time_rule(host, index, rule).await
}

// ─── Password Quality ───────────────────────────────────────────────

/// Get password quality config.
pub async fn host_get_pwquality(host: &PamHost) -> Result<PwQualityConfig, PamError> {
    crate::pwquality::get_pwquality(host).await
}

/// Set password quality config.
pub async fn host_set_pwquality(
    host: &PamHost,
    config: &PwQualityConfig,
) -> Result<(), PamError> {
    crate::pwquality::set_pwquality(host, config).await
}

/// Test a password against quality rules.
pub async fn host_test_password(
    host: &PamHost,
    password: &str,
) -> Result<Vec<String>, PamError> {
    crate::pwquality::test_password(host, password).await
}

// ─── Namespace ──────────────────────────────────────────────────────

/// Get namespace rules.
pub async fn host_get_namespace_rules(
    host: &PamHost,
) -> Result<Vec<PamNamespaceRule>, PamError> {
    crate::namespace::get_namespace_rules(host).await
}

/// Add a namespace rule.
pub async fn host_add_namespace_rule(
    host: &PamHost,
    rule: &PamNamespaceRule,
) -> Result<(), PamError> {
    crate::namespace::add_namespace_rule(host, rule).await
}

/// Remove a namespace rule.
pub async fn host_remove_namespace_rule(
    host: &PamHost,
    index: usize,
) -> Result<(), PamError> {
    crate::namespace::remove_namespace_rule(host, index).await
}

// ─── Login Defs ─────────────────────────────────────────────────────

/// Get login.defs settings.
pub async fn host_get_login_defs(host: &PamHost) -> Result<LoginDefs, PamError> {
    crate::login_defs::get_login_defs(host).await
}

/// Get a single login.defs value.
pub async fn host_get_login_def(
    host: &PamHost,
    key: &str,
) -> Result<Option<String>, PamError> {
    crate::login_defs::get_login_def(host, key).await
}

/// Set a login.defs value.
pub async fn host_set_login_def(
    host: &PamHost,
    key: &str,
    value: &str,
) -> Result<(), PamError> {
    crate::login_defs::set_login_def(host, key, value).await
}

/// Get password policy from login.defs.
pub async fn host_get_password_policy(
    host: &PamHost,
) -> Result<HashMap<String, String>, PamError> {
    crate::login_defs::get_password_policy(host).await
}
