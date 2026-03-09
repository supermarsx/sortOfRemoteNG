// ── sorng-ansible/src/service.rs ─────────────────────────────────────────────
//! Aggregate Ansible façade — single entry point that holds connections
//! and delegates to the domain managers.

use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

use crate::adhoc::AdHocManager;
use crate::client::AnsibleClient;
use crate::config::ConfigManager;
use crate::error::{AnsibleError, AnsibleResult};
use crate::facts::FactManager;
use crate::galaxy::GalaxyManager;
use crate::inventory::InventoryManager;
use crate::playbooks::PlaybookManager;
use crate::roles::RoleManager;
use crate::types::*;
use crate::vault::VaultManager;

/// Shared Tauri state handle.
pub type AnsibleServiceState = Arc<Mutex<AnsibleService>>;

/// Main Ansible service managing connections and delegating operations.
pub struct AnsibleService {
    /// Active Ansible connections keyed by a user-chosen id.
    connections: HashMap<String, AnsibleClient>,
    /// Execution history.
    history: Vec<ExecutionHistoryEntry>,
}

impl Default for AnsibleService {
    fn default() -> Self {
        Self::new()
    }
}

impl AnsibleService {
    pub fn new() -> Self {
        Self {
            connections: HashMap::new(),
            history: Vec::new(),
        }
    }

    // ── Connection lifecycle ─────────────────────────────────────────

    /// Register and validate an Ansible control-node connection.
    pub async fn connect(
        &mut self,
        id: String,
        config: AnsibleConnectionConfig,
    ) -> AnsibleResult<AnsibleInfo> {
        let client = AnsibleClient::from_config(&config).await?;
        let info = client.detect_info().await?;
        self.connections.insert(id, client);
        Ok(info)
    }

    /// Disconnect / remove a connection.
    pub fn disconnect(&mut self, id: &str) -> AnsibleResult<()> {
        self.connections
            .remove(id)
            .ok_or_else(|| AnsibleError::connection(format!("No connection with id '{}'", id)))?;
        Ok(())
    }

    /// List active connection ids.
    pub fn list_connections(&self) -> Vec<String> {
        self.connections.keys().cloned().collect()
    }

    /// Check if Ansible is available for a specific connection.
    pub async fn is_available(&self, id: &str) -> AnsibleResult<bool> {
        let client = self.client(id)?;
        Ok(client.is_available().await)
    }

    /// Get Ansible info for a connection.
    pub async fn get_info(&self, id: &str) -> AnsibleResult<AnsibleInfo> {
        let client = self.client(id)?;
        client.detect_info().await
    }

    // ── Inventory ────────────────────────────────────────────────────

    pub async fn inventory_parse(&self, id: &str, source: &str) -> AnsibleResult<Inventory> {
        let client = self.client(id)?;
        InventoryManager::parse(client, source).await
    }

    pub async fn inventory_graph(&self, id: &str, source: &str) -> AnsibleResult<String> {
        let client = self.client(id)?;
        InventoryManager::graph(client, source).await
    }

    pub async fn inventory_list_hosts(
        &self,
        id: &str,
        source: &str,
        pattern: &str,
    ) -> AnsibleResult<Vec<String>> {
        let client = self.client(id)?;
        InventoryManager::list_hosts(client, source, pattern).await
    }

    pub async fn inventory_host_vars(
        &self,
        id: &str,
        source: &str,
        host: &str,
    ) -> AnsibleResult<HashMap<String, serde_json::Value>> {
        let client = self.client(id)?;
        InventoryManager::host_vars(client, source, host).await
    }

    pub async fn inventory_add_host(
        &self,
        path: &str,
        params: &AddHostParams,
    ) -> AnsibleResult<()> {
        InventoryManager::add_host(path, params).await
    }

    pub async fn inventory_remove_host(&self, path: &str, host: &str) -> AnsibleResult<bool> {
        InventoryManager::remove_host(path, host).await
    }

    pub async fn inventory_add_group(
        &self,
        path: &str,
        params: &AddGroupParams,
    ) -> AnsibleResult<()> {
        InventoryManager::add_group(path, params).await
    }

    pub async fn inventory_remove_group(&self, path: &str, group: &str) -> AnsibleResult<bool> {
        InventoryManager::remove_group(path, group).await
    }

    pub async fn inventory_dynamic(
        &self,
        id: &str,
        config: &DynamicInventoryConfig,
    ) -> AnsibleResult<Inventory> {
        let client = self.client(id)?;
        InventoryManager::run_dynamic(client, config).await
    }

    // ── Playbooks ────────────────────────────────────────────────────

    pub async fn playbook_parse(&self, path: &str) -> AnsibleResult<Playbook> {
        PlaybookManager::parse(path).await
    }

    pub async fn playbook_list(&self, dir: &str) -> AnsibleResult<Vec<String>> {
        PlaybookManager::list_in_directory(dir).await
    }

    pub async fn playbook_syntax_check(
        &self,
        id: &str,
        path: &str,
    ) -> AnsibleResult<PlaybookValidation> {
        let client = self.client(id)?;
        PlaybookManager::syntax_check(client, path).await
    }

    pub async fn playbook_lint(&self, id: &str, path: &str) -> AnsibleResult<PlaybookValidation> {
        let client = self.client(id)?;
        PlaybookManager::lint(client, path).await
    }

    pub async fn playbook_run(
        &mut self,
        id: &str,
        options: &PlaybookRunOptions,
    ) -> AnsibleResult<ExecutionResult> {
        let client = self.client(id)?;
        let result = PlaybookManager::run(client, options).await?;
        self.record_history(&result, CommandType::Playbook);
        Ok(result)
    }

    pub async fn playbook_check(
        &self,
        id: &str,
        options: &PlaybookRunOptions,
    ) -> AnsibleResult<ExecutionResult> {
        let client = self.client(id)?;
        PlaybookManager::check(client, options).await
    }

    pub async fn playbook_diff(
        &self,
        id: &str,
        options: &PlaybookRunOptions,
    ) -> AnsibleResult<ExecutionResult> {
        let client = self.client(id)?;
        PlaybookManager::diff(client, options).await
    }

    // ── Ad-hoc commands ──────────────────────────────────────────────

    pub async fn adhoc_run(
        &mut self,
        id: &str,
        options: &AdHocOptions,
    ) -> AnsibleResult<ExecutionResult> {
        let client = self.client(id)?;
        let result = AdHocManager::run(client, options).await?;
        self.record_history(&result, CommandType::AdHoc);
        Ok(result)
    }

    pub async fn adhoc_ping(
        &self,
        id: &str,
        pattern: &str,
        inventory: Option<&str>,
    ) -> AnsibleResult<ExecutionResult> {
        let client = self.client(id)?;
        AdHocManager::ping(client, pattern, inventory).await
    }

    pub async fn adhoc_shell(
        &self,
        id: &str,
        pattern: &str,
        command: &str,
        inventory: Option<&str>,
        use_become: bool,
    ) -> AnsibleResult<ExecutionResult> {
        let client = self.client(id)?;
        AdHocManager::shell(client, pattern, command, inventory, use_become).await
    }

    pub async fn adhoc_copy(
        &self,
        id: &str,
        pattern: &str,
        src: &str,
        dest: &str,
        inventory: Option<&str>,
        use_become: bool,
    ) -> AnsibleResult<ExecutionResult> {
        let client = self.client(id)?;
        AdHocManager::copy_file(client, pattern, src, dest, inventory, use_become).await
    }

    pub async fn adhoc_service(
        &self,
        id: &str,
        pattern: &str,
        service_name: &str,
        state: &str,
        inventory: Option<&str>,
    ) -> AnsibleResult<ExecutionResult> {
        let client = self.client(id)?;
        AdHocManager::service_action(client, pattern, service_name, state, inventory).await
    }

    pub async fn adhoc_package(
        &self,
        id: &str,
        pattern: &str,
        package: &str,
        state: &str,
        inventory: Option<&str>,
    ) -> AnsibleResult<ExecutionResult> {
        let client = self.client(id)?;
        AdHocManager::package_action(client, pattern, package, state, inventory).await
    }

    // ── Roles ────────────────────────────────────────────────────────

    pub async fn roles_list(&self, roles_path: &str) -> AnsibleResult<Vec<Role>> {
        RoleManager::list(roles_path).await
    }

    pub async fn role_inspect(&self, role_path: &str) -> AnsibleResult<Role> {
        RoleManager::inspect_role(std::path::Path::new(role_path)).await
    }

    pub async fn role_init(&self, id: &str, options: &RoleInitOptions) -> AnsibleResult<Role> {
        let client = self.client(id)?;
        RoleManager::init(client, options).await
    }

    pub async fn role_dependencies(
        &self,
        roles_path: &str,
        role_name: &str,
    ) -> AnsibleResult<Vec<RoleDependency>> {
        RoleManager::resolve_dependencies(roles_path, role_name).await
    }

    pub async fn role_install_deps(&self, id: &str, role_path: &str) -> AnsibleResult<String> {
        let client = self.client(id)?;
        RoleManager::install_dependencies(client, role_path).await
    }

    // ── Vault ────────────────────────────────────────────────────────

    pub async fn vault_encrypt(
        &self,
        id: &str,
        file_path: &str,
        vpf: Option<&str>,
        vid: Option<&str>,
    ) -> AnsibleResult<VaultResult> {
        let client = self.client(id)?;
        VaultManager::encrypt_file(client, file_path, vpf, vid).await
    }

    pub async fn vault_decrypt(
        &self,
        id: &str,
        file_path: &str,
        vpf: Option<&str>,
        vid: Option<&str>,
    ) -> AnsibleResult<VaultResult> {
        let client = self.client(id)?;
        VaultManager::decrypt_file(client, file_path, vpf, vid).await
    }

    pub async fn vault_view(
        &self,
        id: &str,
        file_path: &str,
        vpf: Option<&str>,
    ) -> AnsibleResult<String> {
        let client = self.client(id)?;
        VaultManager::view(client, file_path, vpf).await
    }

    pub async fn vault_rekey(
        &self,
        id: &str,
        options: &VaultRekeyOptions,
    ) -> AnsibleResult<VaultResult> {
        let client = self.client(id)?;
        VaultManager::rekey(client, options).await
    }

    pub async fn vault_encrypt_string(
        &self,
        id: &str,
        options: &VaultEncryptStringOptions,
    ) -> AnsibleResult<String> {
        let client = self.client(id)?;
        VaultManager::encrypt_string(client, options).await
    }

    pub async fn vault_is_encrypted(&self, file_path: &str) -> AnsibleResult<bool> {
        VaultManager::is_encrypted(file_path).await
    }

    // ── Galaxy ───────────────────────────────────────────────────────

    pub async fn galaxy_install_role(
        &self,
        id: &str,
        options: &GalaxyInstallOptions,
    ) -> AnsibleResult<String> {
        let client = self.client(id)?;
        GalaxyManager::install_role(client, options).await
    }

    pub async fn galaxy_list_roles(
        &self,
        id: &str,
        roles_path: Option<&str>,
    ) -> AnsibleResult<Vec<GalaxySearchResult>> {
        let client = self.client(id)?;
        GalaxyManager::list_roles(client, roles_path).await
    }

    pub async fn galaxy_remove_role(
        &self,
        id: &str,
        name: &str,
        rp: Option<&str>,
    ) -> AnsibleResult<String> {
        let client = self.client(id)?;
        GalaxyManager::remove_role(client, name, rp).await
    }

    pub async fn galaxy_install_collection(
        &self,
        id: &str,
        options: &GalaxyInstallOptions,
    ) -> AnsibleResult<String> {
        let client = self.client(id)?;
        GalaxyManager::install_collection(client, options).await
    }

    pub async fn galaxy_list_collections(
        &self,
        id: &str,
        cp: Option<&str>,
    ) -> AnsibleResult<Vec<GalaxyCollection>> {
        let client = self.client(id)?;
        GalaxyManager::list_collections(client, cp).await
    }

    pub async fn galaxy_remove_collection(
        &self,
        id: &str,
        name: &str,
        cp: Option<&str>,
    ) -> AnsibleResult<String> {
        let client = self.client(id)?;
        GalaxyManager::remove_collection(client, name, cp).await
    }

    pub async fn galaxy_search(
        &self,
        id: &str,
        options: &GalaxySearchOptions,
    ) -> AnsibleResult<Vec<GalaxySearchResult>> {
        let client = self.client(id)?;
        GalaxyManager::search_roles(client, options).await
    }

    pub async fn galaxy_role_info(&self, id: &str, name: &str) -> AnsibleResult<String> {
        let client = self.client(id)?;
        GalaxyManager::role_info(client, name).await
    }

    pub async fn galaxy_install_requirements(
        &self,
        id: &str,
        path: &str,
        force: bool,
    ) -> AnsibleResult<String> {
        let client = self.client(id)?;
        GalaxyManager::install_requirements(client, path, force).await
    }

    // ── Facts ────────────────────────────────────────────────────────

    pub async fn facts_gather(
        &self,
        id: &str,
        pattern: &str,
        inventory: Option<&str>,
        filter: Option<&str>,
    ) -> AnsibleResult<HashMap<String, HostFacts>> {
        let client = self.client(id)?;
        FactManager::gather(client, pattern, inventory, filter).await
    }

    pub async fn facts_gather_subset(
        &self,
        id: &str,
        pattern: &str,
        inventory: Option<&str>,
        subsets: &[&str],
    ) -> AnsibleResult<HashMap<String, HostFacts>> {
        let client = self.client(id)?;
        FactManager::gather_subset(client, pattern, inventory, subsets).await
    }

    pub async fn facts_gather_min(
        &self,
        id: &str,
        pattern: &str,
        inventory: Option<&str>,
    ) -> AnsibleResult<HashMap<String, HostFacts>> {
        let client = self.client(id)?;
        FactManager::gather_min(client, pattern, inventory).await
    }

    // ── Config ───────────────────────────────────────────────────────

    pub async fn config_dump(&self, id: &str) -> AnsibleResult<Vec<ConfigSetting>> {
        let client = self.client(id)?;
        ConfigManager::dump(client).await
    }

    pub async fn config_get(&self, id: &str, key: &str) -> AnsibleResult<Option<ConfigSetting>> {
        let client = self.client(id)?;
        ConfigManager::get(client, key).await
    }

    pub async fn config_parse_file(&self, path: &str) -> AnsibleResult<AnsibleConfig> {
        ConfigManager::parse_config_file(path).await
    }

    pub async fn config_detect_path(&self, id: &str) -> AnsibleResult<Option<String>> {
        let client = self.client(id)?;
        ConfigManager::detect_config_path(client).await
    }

    pub async fn list_modules(&self, id: &str) -> AnsibleResult<Vec<String>> {
        let client = self.client(id)?;
        ConfigManager::list_modules(client).await
    }

    pub async fn module_doc(&self, id: &str, module_name: &str) -> AnsibleResult<ModuleInfo> {
        let client = self.client(id)?;
        ConfigManager::module_doc(client, module_name).await
    }

    pub async fn module_examples(&self, id: &str, module_name: &str) -> AnsibleResult<String> {
        let client = self.client(id)?;
        ConfigManager::module_examples(client, module_name).await
    }

    pub async fn list_plugins(&self, id: &str, plugin_type: &str) -> AnsibleResult<Vec<String>> {
        let client = self.client(id)?;
        ConfigManager::list_plugins(client, plugin_type).await
    }

    // ── History ──────────────────────────────────────────────────────

    pub fn history_list(&self) -> Vec<ExecutionHistoryEntry> {
        self.history.clone()
    }

    pub fn history_clear(&mut self) {
        self.history.clear();
    }

    pub fn history_get(&self, exec_id: &str) -> Option<ExecutionHistoryEntry> {
        self.history.iter().find(|e| e.id == exec_id).cloned()
    }

    // ── Internal helpers ─────────────────────────────────────────────

    fn client(&self, id: &str) -> AnsibleResult<&AnsibleClient> {
        self.connections.get(id).ok_or_else(|| {
            AnsibleError::connection(format!(
                "No Ansible connection with id '{}'. Call ansible_connect first.",
                id
            ))
        })
    }

    fn record_history(&mut self, result: &ExecutionResult, cmd_type: CommandType) {
        self.history.push(ExecutionHistoryEntry {
            id: result.id.clone(),
            command_type: cmd_type,
            command: result.command.clone(),
            started_at: result.started_at,
            finished_at: result.finished_at,
            status: result.status.clone(),
            exit_code: result.exit_code,
            host_count: result.host_results.len() as u32,
            ok: result.stats.ok,
            changed: result.stats.changed,
            failed: result.stats.failed,
            unreachable: result.stats.unreachable,
            user: None,
            tags: Vec::new(),
        });

        // Cap history at 500 entries
        if self.history.len() > 500 {
            self.history.drain(..self.history.len() - 500);
        }
    }
}
