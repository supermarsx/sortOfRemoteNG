// ── sorng-mac/src/service.rs ──────────────────────────────────────────────────
//! Aggregate MAC façade — single entry point that holds connections
//! and delegates to domain modules.

use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

use crate::client::MacClient;
use crate::error::{MacError, MacResult};
use crate::types::*;

/// Shared Tauri state handle.
pub type MacServiceState = Arc<Mutex<MacService>>;

/// Main MAC service managing connections.
pub struct MacService {
    connections: HashMap<String, MacClient>,
}

impl Default for MacService {
    fn default() -> Self {
        Self::new()
    }
}

impl MacService {
    pub fn new() -> Self {
        Self {
            connections: HashMap::new(),
        }
    }

    // ── Connection lifecycle ──────────────────────────────────────

    pub async fn connect(
        &mut self,
        id: String,
        config: MacConnectionConfig,
    ) -> MacResult<MacConnectionSummary> {
        let client = MacClient::new(config)?;
        let system_type = detect_system_inner(&client).await?;
        let version = detect_version(&client, &system_type).await.ok();
        let enforcing = is_enforcing(&client, &system_type).await;
        let active_modules = count_active_modules(&client, &system_type).await;

        let summary = MacConnectionSummary {
            host: client.config.host.clone(),
            mac_system: system_type,
            version,
            enforcing,
            active_modules_count: active_modules,
        };
        self.connections.insert(id, client);
        Ok(summary)
    }

    pub fn disconnect(&mut self, id: &str) -> MacResult<()> {
        self.connections
            .remove(id)
            .map(|_| ())
            .ok_or_else(|| MacError::not_connected(format!("No connection '{}'", id)))
    }

    pub fn list_connections(&self) -> Vec<String> {
        self.connections.keys().cloned().collect()
    }

    fn client(&self, id: &str) -> MacResult<&MacClient> {
        self.connections
            .get(id)
            .ok_or_else(|| MacError::not_connected(format!("No connection '{}'", id)))
    }

    // ── Detection ────────────────────────────────────────────────

    pub async fn detect_system(&self, id: &str) -> MacResult<MacSystemType> {
        detect_system_inner(self.client(id)?).await
    }

    pub async fn get_dashboard(&self, id: &str) -> MacResult<MacDashboard> {
        let client = self.client(id)?;
        let sys = detect_system_inner(client).await?;

        match sys {
            MacSystemType::SELinux => {
                let mode = crate::selinux::get_mode(client).await?;
                let modules = crate::selinux::list_modules(client).await?;
                let booleans = crate::selinux::list_booleans(client).await?;
                let status = crate::selinux::get_status(client).await?;
                let audit = crate::selinux::audit_log(client, 1).await.ok();
                Ok(MacDashboard {
                    system_type: MacSystemType::SELinux,
                    mode: mode.to_string(),
                    policy_version: Some(status.policy_version),
                    loaded_modules: modules.len() as u32,
                    active_booleans: booleans.len() as u32,
                    denied_count_24h: 0,
                    profiles_count: 0,
                    last_audit: audit.and_then(|a| a.first().map(|e| e.timestamp.clone())),
                })
            }
            MacSystemType::AppArmor => {
                let status = crate::apparmor::get_status(client).await?;
                let audit = crate::apparmor::audit_log(client, 1).await.ok();
                Ok(MacDashboard {
                    system_type: MacSystemType::AppArmor,
                    mode: "enforce".to_string(),
                    policy_version: Some(status.version.clone()),
                    loaded_modules: 0,
                    active_booleans: 0,
                    denied_count_24h: 0,
                    profiles_count: status.profiles_loaded,
                    last_audit: audit.and_then(|a| a.first().map(|e| e.timestamp.clone())),
                })
            }
            MacSystemType::Tomoyo => {
                let status = crate::tomoyo::get_status(client).await?;
                Ok(MacDashboard {
                    system_type: MacSystemType::Tomoyo,
                    mode: "enabled".to_string(),
                    policy_version: None,
                    loaded_modules: 0,
                    active_booleans: 0,
                    denied_count_24h: 0,
                    profiles_count: status.enforcing_domains
                        + status.learning_domains
                        + status.permissive_domains,
                    last_audit: None,
                })
            }
            MacSystemType::Smack => {
                let status = crate::smack::get_status(client).await?;
                Ok(MacDashboard {
                    system_type: MacSystemType::Smack,
                    mode: if status.enabled {
                        "enabled".to_string()
                    } else {
                        "disabled".to_string()
                    },
                    policy_version: None,
                    loaded_modules: 0,
                    active_booleans: 0,
                    denied_count_24h: 0,
                    profiles_count: status.labels_count,
                    last_audit: None,
                })
            }
            MacSystemType::None => Err(MacError::unsupported("No MAC system detected")),
        }
    }

    // ── SELinux delegates ────────────────────────────────────────

    pub async fn selinux_status(&self, id: &str) -> MacResult<SelinuxStatus> {
        crate::selinux::get_status(self.client(id)?).await
    }

    pub async fn selinux_get_mode(&self, id: &str) -> MacResult<SelinuxMode> {
        crate::selinux::get_mode(self.client(id)?).await
    }

    pub async fn selinux_set_mode(
        &self,
        id: &str,
        request: SetModeRequest,
    ) -> MacResult<SelinuxMode> {
        crate::selinux::set_mode(self.client(id)?, &request).await
    }

    pub async fn selinux_list_booleans(&self, id: &str) -> MacResult<Vec<SelinuxBoolean>> {
        crate::selinux::list_booleans(self.client(id)?).await
    }

    pub async fn selinux_get_boolean(&self, id: &str, name: &str) -> MacResult<SelinuxBoolean> {
        crate::selinux::get_boolean(self.client(id)?, name).await
    }

    pub async fn selinux_set_boolean(
        &self,
        id: &str,
        request: SetBooleanRequest,
    ) -> MacResult<bool> {
        crate::selinux::set_boolean(self.client(id)?, &request).await
    }

    pub async fn selinux_list_modules(&self, id: &str) -> MacResult<Vec<SelinuxModule>> {
        crate::selinux::list_modules(self.client(id)?).await
    }

    pub async fn selinux_manage_module(
        &self,
        id: &str,
        request: ManageModuleRequest,
    ) -> MacResult<bool> {
        crate::selinux::manage_module(self.client(id)?, &request).await
    }

    pub async fn selinux_list_file_contexts(&self, id: &str) -> MacResult<Vec<SelinuxFileContext>> {
        crate::selinux::list_file_contexts(self.client(id)?).await
    }

    pub async fn selinux_add_file_context(
        &self,
        id: &str,
        request: AddFileContextRequest,
    ) -> MacResult<bool> {
        crate::selinux::add_file_context(self.client(id)?, &request).await
    }

    pub async fn selinux_remove_file_context(&self, id: &str, pattern: &str) -> MacResult<bool> {
        crate::selinux::remove_file_context(self.client(id)?, pattern).await
    }

    pub async fn selinux_restorecon(
        &self,
        id: &str,
        path: &str,
        recursive: bool,
    ) -> MacResult<Vec<String>> {
        crate::selinux::restorecon(self.client(id)?, path, recursive).await
    }

    pub async fn selinux_list_ports(&self, id: &str) -> MacResult<Vec<SelinuxPort>> {
        crate::selinux::list_ports(self.client(id)?).await
    }

    pub async fn selinux_add_port_context(
        &self,
        id: &str,
        request: AddPortContextRequest,
    ) -> MacResult<bool> {
        crate::selinux::add_port_context(self.client(id)?, &request).await
    }

    pub async fn selinux_list_users(&self, id: &str) -> MacResult<Vec<SelinuxUser>> {
        crate::selinux::list_users(self.client(id)?).await
    }

    pub async fn selinux_list_roles(&self, id: &str) -> MacResult<Vec<SelinuxRole>> {
        crate::selinux::list_roles(self.client(id)?).await
    }

    pub async fn selinux_get_policy_info(&self, id: &str) -> MacResult<SelinuxPolicy> {
        crate::selinux::get_policy_info(self.client(id)?).await
    }

    pub async fn selinux_audit_log(
        &self,
        id: &str,
        limit: u32,
    ) -> MacResult<Vec<SelinuxAuditEntry>> {
        crate::selinux::audit_log(self.client(id)?, limit).await
    }

    pub async fn selinux_audit2allow(&self, id: &str, audit_lines: &str) -> MacResult<String> {
        crate::selinux::audit2allow(self.client(id)?, audit_lines).await
    }

    // ── AppArmor delegates ───────────────────────────────────────

    pub async fn apparmor_status(&self, id: &str) -> MacResult<AppArmorStatus> {
        crate::apparmor::get_status(self.client(id)?).await
    }

    pub async fn apparmor_list_profiles(&self, id: &str) -> MacResult<Vec<AppArmorProfile>> {
        crate::apparmor::list_profiles(self.client(id)?).await
    }

    pub async fn apparmor_set_profile_mode(
        &self,
        id: &str,
        request: SetProfileModeRequest,
    ) -> MacResult<bool> {
        crate::apparmor::set_profile_mode(self.client(id)?, &request).await
    }

    pub async fn apparmor_reload_profile(&self, id: &str, profile_name: &str) -> MacResult<bool> {
        crate::apparmor::reload_profile(self.client(id)?, profile_name).await
    }

    pub async fn apparmor_create_profile(
        &self,
        id: &str,
        request: CreateProfileRequest,
    ) -> MacResult<AppArmorProfile> {
        crate::apparmor::create_profile(self.client(id)?, &request).await
    }

    pub async fn apparmor_delete_profile(&self, id: &str, profile_name: &str) -> MacResult<bool> {
        crate::apparmor::delete_profile(self.client(id)?, profile_name).await
    }

    pub async fn apparmor_get_profile_content(
        &self,
        id: &str,
        profile_name: &str,
    ) -> MacResult<String> {
        crate::apparmor::get_profile_content(self.client(id)?, profile_name).await
    }

    pub async fn apparmor_update_profile_content(
        &self,
        id: &str,
        profile_name: &str,
        content: &str,
    ) -> MacResult<bool> {
        crate::apparmor::update_profile_content(self.client(id)?, profile_name, content).await
    }

    pub async fn apparmor_audit_log(
        &self,
        id: &str,
        limit: u32,
    ) -> MacResult<Vec<AppArmorLogEntry>> {
        crate::apparmor::audit_log(self.client(id)?, limit).await
    }

    // ── TOMOYO delegates ─────────────────────────────────────────

    pub async fn tomoyo_status(&self, id: &str) -> MacResult<TomoyoStatus> {
        crate::tomoyo::get_status(self.client(id)?).await
    }

    pub async fn tomoyo_list_domains(&self, id: &str) -> MacResult<Vec<TomoyoDomain>> {
        crate::tomoyo::list_domains(self.client(id)?).await
    }

    pub async fn tomoyo_set_domain_mode(
        &self,
        id: &str,
        request: SetDomainModeRequest,
    ) -> MacResult<bool> {
        crate::tomoyo::set_domain_mode(self.client(id)?, &request).await
    }

    pub async fn tomoyo_list_rules(&self, id: &str, domain: &str) -> MacResult<Vec<TomoyoRule>> {
        crate::tomoyo::list_rules(self.client(id)?, domain).await
    }

    // ── SMACK delegates ──────────────────────────────────────────

    pub async fn smack_status(&self, id: &str) -> MacResult<SmackStatus> {
        crate::smack::get_status(self.client(id)?).await
    }

    pub async fn smack_list_labels(&self, id: &str) -> MacResult<Vec<SmackLabel>> {
        crate::smack::list_labels(self.client(id)?).await
    }

    pub async fn smack_list_rules(&self, id: &str) -> MacResult<Vec<SmackRule>> {
        crate::smack::list_rules(self.client(id)?).await
    }

    pub async fn smack_add_rule(&self, id: &str, request: AddSmackRuleRequest) -> MacResult<bool> {
        crate::smack::add_rule(self.client(id)?, &request).await
    }

    pub async fn smack_remove_rule(
        &self,
        id: &str,
        subject: &str,
        object: &str,
    ) -> MacResult<bool> {
        crate::smack::remove_rule(self.client(id)?, subject, object).await
    }

    // ── Compliance ───────────────────────────────────────────────

    pub async fn compliance_check(&self, id: &str, framework: &str) -> MacResult<ComplianceResult> {
        let client = self.client(id)?;
        let sys = detect_system_inner(client).await?;
        crate::compliance::check(client, &sys, framework).await
    }
}

// ── Helper functions ─────────────────────────────────────────────────────────

async fn detect_system_inner(client: &MacClient) -> MacResult<MacSystemType> {
    // Check SELinux first (most common on RHEL/CentOS/Fedora)
    let se = client.run_command("getenforce 2>/dev/null").await?;
    if !se.trim().is_empty()
        && se.trim().to_lowercase() != "command not found"
        && !se.contains("No such file")
    {
        return Ok(MacSystemType::SELinux);
    }

    // Check AppArmor (Ubuntu/Debian/SUSE)
    let aa = client
        .run_command("aa-status --enabled 2>/dev/null; echo $?")
        .await?;
    if aa.trim().ends_with('0') || aa.contains("apparmor") {
        return Ok(MacSystemType::AppArmor);
    }

    // Check TOMOYO
    let tomoyo = client
        .run_command("test -f /sys/kernel/security/tomoyo/stat && echo yes || echo no")
        .await?;
    if tomoyo.trim() == "yes" {
        return Ok(MacSystemType::Tomoyo);
    }

    // Check SMACK
    let smack = client
        .run_command("mount | grep smackfs 2>/dev/null")
        .await?;
    if !smack.trim().is_empty() {
        return Ok(MacSystemType::Smack);
    }

    Ok(MacSystemType::None)
}

async fn detect_version(client: &MacClient, sys: &MacSystemType) -> MacResult<String> {
    match sys {
        MacSystemType::SELinux => {
            let out = client.run_command("rpm -q selinux-policy 2>/dev/null || dpkg -l selinux-policy-default 2>/dev/null | tail -1").await?;
            Ok(out.trim().to_string())
        }
        MacSystemType::AppArmor => {
            let out = client
                .run_command("apparmor_parser --version 2>&1 | head -1")
                .await?;
            Ok(out.trim().to_string())
        }
        MacSystemType::Tomoyo => {
            let out = client
                .run_command("cat /sys/kernel/security/tomoyo/version 2>/dev/null || echo unknown")
                .await?;
            Ok(out.trim().to_string())
        }
        MacSystemType::Smack => Ok("smack".to_string()),
        MacSystemType::None => Ok(String::new()),
    }
}

async fn is_enforcing(client: &MacClient, sys: &MacSystemType) -> bool {
    match sys {
        MacSystemType::SELinux => {
            let out = client.run_command("getenforce").await.unwrap_or_default();
            out.trim().to_lowercase() == "enforcing"
        }
        MacSystemType::AppArmor => {
            // If AppArmor is loaded and has enforce profiles, consider it enforcing
            let out = client
                .run_sudo_command("aa-status")
                .await
                .unwrap_or_default();
            out.contains("enforce")
        }
        MacSystemType::Tomoyo => {
            let out = client
                .run_command("cat /sys/kernel/security/tomoyo/stat 2>/dev/null")
                .await
                .unwrap_or_default();
            out.contains("enforcing")
        }
        MacSystemType::Smack => {
            let out = client
                .run_command("mount | grep smackfs")
                .await
                .unwrap_or_default();
            !out.trim().is_empty()
        }
        MacSystemType::None => false,
    }
}

async fn count_active_modules(client: &MacClient, sys: &MacSystemType) -> u32 {
    match sys {
        MacSystemType::SELinux => {
            let out = client
                .run_command("semodule -l 2>/dev/null | wc -l")
                .await
                .unwrap_or_default();
            out.trim().parse().unwrap_or(0)
        }
        MacSystemType::AppArmor => {
            let out = client
                .run_sudo_command("aa-status 2>/dev/null | head -2")
                .await
                .unwrap_or_default();
            // First numeric value is usually profiles loaded
            out.lines()
                .find_map(|l| {
                    l.split_whitespace()
                        .next()
                        .and_then(|n| n.parse::<u32>().ok())
                })
                .unwrap_or(0)
        }
        _ => 0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_service_new() {
        let svc = MacService::new();
        assert!(svc.connections.is_empty());
        assert!(svc.list_connections().is_empty());
    }

    #[test]
    fn test_disconnect_missing() {
        let mut svc = MacService::new();
        let result = svc.disconnect("nonexistent");
        assert!(result.is_err());
    }

    #[test]
    fn test_client_missing() {
        let svc = MacService::new();
        let result = svc.client("nonexistent");
        assert!(result.is_err());
    }
}
