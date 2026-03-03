// ── sorng-ansible/src/commands.rs ────────────────────────────────────────────
//! Tauri command handlers — every public function is a `#[tauri::command]`.

use std::collections::HashMap;

use tauri::State;

use crate::service::AnsibleServiceState;
use crate::types::*;

// ── Connection lifecycle ─────────────────────────────────────────────────────

#[tauri::command]
pub async fn ansible_connect(
    state: State<'_, AnsibleServiceState>,
    id: String,
    config: AnsibleConnectionConfig,
) -> Result<AnsibleInfo, String> {
    let mut svc = state.lock().await;
    svc.connect(id, config).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ansible_disconnect(
    state: State<'_, AnsibleServiceState>,
    id: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.disconnect(&id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ansible_list_connections(
    state: State<'_, AnsibleServiceState>,
) -> Result<Vec<String>, String> {
    let svc = state.lock().await;
    Ok(svc.list_connections())
}

#[tauri::command]
pub async fn ansible_is_available(
    state: State<'_, AnsibleServiceState>,
    id: String,
) -> Result<bool, String> {
    let svc = state.lock().await;
    svc.is_available(&id).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ansible_get_info(
    state: State<'_, AnsibleServiceState>,
    id: String,
) -> Result<AnsibleInfo, String> {
    let svc = state.lock().await;
    svc.get_info(&id).await.map_err(|e| e.to_string())
}

// ── Inventory ────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn ansible_inventory_parse(
    state: State<'_, AnsibleServiceState>,
    id: String,
    source: String,
) -> Result<Inventory, String> {
    let svc = state.lock().await;
    svc.inventory_parse(&id, &source).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ansible_inventory_graph(
    state: State<'_, AnsibleServiceState>,
    id: String,
    source: String,
) -> Result<String, String> {
    let svc = state.lock().await;
    svc.inventory_graph(&id, &source).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ansible_inventory_list_hosts(
    state: State<'_, AnsibleServiceState>,
    id: String,
    source: String,
    pattern: String,
) -> Result<Vec<String>, String> {
    let svc = state.lock().await;
    svc.inventory_list_hosts(&id, &source, &pattern).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ansible_inventory_host_vars(
    state: State<'_, AnsibleServiceState>,
    id: String,
    source: String,
    host: String,
) -> Result<HashMap<String, serde_json::Value>, String> {
    let svc = state.lock().await;
    svc.inventory_host_vars(&id, &source, &host).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ansible_inventory_add_host(
    state: State<'_, AnsibleServiceState>,
    path: String,
    params: AddHostParams,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.inventory_add_host(&path, &params).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ansible_inventory_remove_host(
    state: State<'_, AnsibleServiceState>,
    path: String,
    host: String,
) -> Result<bool, String> {
    let svc = state.lock().await;
    svc.inventory_remove_host(&path, &host).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ansible_inventory_add_group(
    state: State<'_, AnsibleServiceState>,
    path: String,
    params: AddGroupParams,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.inventory_add_group(&path, &params).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ansible_inventory_remove_group(
    state: State<'_, AnsibleServiceState>,
    path: String,
    group: String,
) -> Result<bool, String> {
    let svc = state.lock().await;
    svc.inventory_remove_group(&path, &group).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ansible_inventory_dynamic(
    state: State<'_, AnsibleServiceState>,
    id: String,
    config: DynamicInventoryConfig,
) -> Result<Inventory, String> {
    let svc = state.lock().await;
    svc.inventory_dynamic(&id, &config).await.map_err(|e| e.to_string())
}

// ── Playbooks ────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn ansible_playbook_parse(
    state: State<'_, AnsibleServiceState>,
    path: String,
) -> Result<Playbook, String> {
    let svc = state.lock().await;
    svc.playbook_parse(&path).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ansible_playbook_list(
    state: State<'_, AnsibleServiceState>,
    dir: String,
) -> Result<Vec<String>, String> {
    let svc = state.lock().await;
    svc.playbook_list(&dir).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ansible_playbook_syntax_check(
    state: State<'_, AnsibleServiceState>,
    id: String,
    path: String,
) -> Result<PlaybookValidation, String> {
    let svc = state.lock().await;
    svc.playbook_syntax_check(&id, &path).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ansible_playbook_lint(
    state: State<'_, AnsibleServiceState>,
    id: String,
    path: String,
) -> Result<PlaybookValidation, String> {
    let svc = state.lock().await;
    svc.playbook_lint(&id, &path).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ansible_playbook_run(
    state: State<'_, AnsibleServiceState>,
    id: String,
    options: PlaybookRunOptions,
) -> Result<ExecutionResult, String> {
    let mut svc = state.lock().await;
    svc.playbook_run(&id, &options).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ansible_playbook_check(
    state: State<'_, AnsibleServiceState>,
    id: String,
    options: PlaybookRunOptions,
) -> Result<ExecutionResult, String> {
    let svc = state.lock().await;
    svc.playbook_check(&id, &options).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ansible_playbook_diff(
    state: State<'_, AnsibleServiceState>,
    id: String,
    options: PlaybookRunOptions,
) -> Result<ExecutionResult, String> {
    let svc = state.lock().await;
    svc.playbook_diff(&id, &options).await.map_err(|e| e.to_string())
}

// ── Ad-hoc commands ──────────────────────────────────────────────────────────

#[tauri::command]
pub async fn ansible_adhoc_run(
    state: State<'_, AnsibleServiceState>,
    id: String,
    options: AdHocOptions,
) -> Result<ExecutionResult, String> {
    let mut svc = state.lock().await;
    svc.adhoc_run(&id, &options).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ansible_adhoc_ping(
    state: State<'_, AnsibleServiceState>,
    id: String,
    pattern: String,
    inventory: Option<String>,
) -> Result<ExecutionResult, String> {
    let svc = state.lock().await;
    svc.adhoc_ping(&id, &pattern, inventory.as_deref()).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ansible_adhoc_shell(
    state: State<'_, AnsibleServiceState>,
    id: String,
    pattern: String,
    command: String,
    inventory: Option<String>,
    use_become: bool,
) -> Result<ExecutionResult, String> {
    let svc = state.lock().await;
    svc.adhoc_shell(&id, &pattern, &command, inventory.as_deref(), use_become)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ansible_adhoc_copy(
    state: State<'_, AnsibleServiceState>,
    id: String,
    pattern: String,
    src: String,
    dest: String,
    inventory: Option<String>,
    use_become: bool,
) -> Result<ExecutionResult, String> {
    let svc = state.lock().await;
    svc.adhoc_copy(&id, &pattern, &src, &dest, inventory.as_deref(), use_become)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ansible_adhoc_service(
    state: State<'_, AnsibleServiceState>,
    id: String,
    pattern: String,
    service_name: String,
    service_state: String,
    inventory: Option<String>,
) -> Result<ExecutionResult, String> {
    let svc = state.lock().await;
    svc.adhoc_service(&id, &pattern, &service_name, &service_state, inventory.as_deref())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ansible_adhoc_package(
    state: State<'_, AnsibleServiceState>,
    id: String,
    pattern: String,
    package: String,
    package_state: String,
    inventory: Option<String>,
) -> Result<ExecutionResult, String> {
    let svc = state.lock().await;
    svc.adhoc_package(&id, &pattern, &package, &package_state, inventory.as_deref())
        .await
        .map_err(|e| e.to_string())
}

// ── Roles ────────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn ansible_roles_list(
    state: State<'_, AnsibleServiceState>,
    roles_path: String,
) -> Result<Vec<Role>, String> {
    let svc = state.lock().await;
    svc.roles_list(&roles_path).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ansible_role_inspect(
    state: State<'_, AnsibleServiceState>,
    role_path: String,
) -> Result<Role, String> {
    let svc = state.lock().await;
    svc.role_inspect(&role_path).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ansible_role_init(
    state: State<'_, AnsibleServiceState>,
    id: String,
    options: RoleInitOptions,
) -> Result<Role, String> {
    let svc = state.lock().await;
    svc.role_init(&id, &options).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ansible_role_dependencies(
    state: State<'_, AnsibleServiceState>,
    roles_path: String,
    role_name: String,
) -> Result<Vec<RoleDependency>, String> {
    let svc = state.lock().await;
    svc.role_dependencies(&roles_path, &role_name).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ansible_role_install_deps(
    state: State<'_, AnsibleServiceState>,
    id: String,
    role_path: String,
) -> Result<String, String> {
    let svc = state.lock().await;
    svc.role_install_deps(&id, &role_path).await.map_err(|e| e.to_string())
}

// ── Vault ────────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn ansible_vault_encrypt(
    state: State<'_, AnsibleServiceState>,
    id: String,
    file_path: String,
    vault_password_file: Option<String>,
    vault_id: Option<String>,
) -> Result<VaultResult, String> {
    let svc = state.lock().await;
    svc.vault_encrypt(&id, &file_path, vault_password_file.as_deref(), vault_id.as_deref())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ansible_vault_decrypt(
    state: State<'_, AnsibleServiceState>,
    id: String,
    file_path: String,
    vault_password_file: Option<String>,
    vault_id: Option<String>,
) -> Result<VaultResult, String> {
    let svc = state.lock().await;
    svc.vault_decrypt(&id, &file_path, vault_password_file.as_deref(), vault_id.as_deref())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ansible_vault_view(
    state: State<'_, AnsibleServiceState>,
    id: String,
    file_path: String,
    vault_password_file: Option<String>,
) -> Result<String, String> {
    let svc = state.lock().await;
    svc.vault_view(&id, &file_path, vault_password_file.as_deref())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ansible_vault_rekey(
    state: State<'_, AnsibleServiceState>,
    id: String,
    options: VaultRekeyOptions,
) -> Result<VaultResult, String> {
    let svc = state.lock().await;
    svc.vault_rekey(&id, &options).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ansible_vault_encrypt_string(
    state: State<'_, AnsibleServiceState>,
    id: String,
    options: VaultEncryptStringOptions,
) -> Result<String, String> {
    let svc = state.lock().await;
    svc.vault_encrypt_string(&id, &options).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ansible_vault_is_encrypted(
    state: State<'_, AnsibleServiceState>,
    file_path: String,
) -> Result<bool, String> {
    let svc = state.lock().await;
    svc.vault_is_encrypted(&file_path).await.map_err(|e| e.to_string())
}

// ── Galaxy ───────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn ansible_galaxy_install_role(
    state: State<'_, AnsibleServiceState>,
    id: String,
    options: GalaxyInstallOptions,
) -> Result<String, String> {
    let svc = state.lock().await;
    svc.galaxy_install_role(&id, &options).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ansible_galaxy_list_roles(
    state: State<'_, AnsibleServiceState>,
    id: String,
    roles_path: Option<String>,
) -> Result<Vec<GalaxySearchResult>, String> {
    let svc = state.lock().await;
    svc.galaxy_list_roles(&id, roles_path.as_deref()).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ansible_galaxy_remove_role(
    state: State<'_, AnsibleServiceState>,
    id: String,
    role_name: String,
    roles_path: Option<String>,
) -> Result<String, String> {
    let svc = state.lock().await;
    svc.galaxy_remove_role(&id, &role_name, roles_path.as_deref()).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ansible_galaxy_install_collection(
    state: State<'_, AnsibleServiceState>,
    id: String,
    options: GalaxyInstallOptions,
) -> Result<String, String> {
    let svc = state.lock().await;
    svc.galaxy_install_collection(&id, &options).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ansible_galaxy_list_collections(
    state: State<'_, AnsibleServiceState>,
    id: String,
    collections_path: Option<String>,
) -> Result<Vec<GalaxyCollection>, String> {
    let svc = state.lock().await;
    svc.galaxy_list_collections(&id, collections_path.as_deref()).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ansible_galaxy_remove_collection(
    state: State<'_, AnsibleServiceState>,
    id: String,
    name: String,
    collections_path: Option<String>,
) -> Result<String, String> {
    let svc = state.lock().await;
    svc.galaxy_remove_collection(&id, &name, collections_path.as_deref()).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ansible_galaxy_search(
    state: State<'_, AnsibleServiceState>,
    id: String,
    options: GalaxySearchOptions,
) -> Result<Vec<GalaxySearchResult>, String> {
    let svc = state.lock().await;
    svc.galaxy_search(&id, &options).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ansible_galaxy_role_info(
    state: State<'_, AnsibleServiceState>,
    id: String,
    role_name: String,
) -> Result<String, String> {
    let svc = state.lock().await;
    svc.galaxy_role_info(&id, &role_name).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ansible_galaxy_install_requirements(
    state: State<'_, AnsibleServiceState>,
    id: String,
    requirements_path: String,
    force: bool,
) -> Result<String, String> {
    let svc = state.lock().await;
    svc.galaxy_install_requirements(&id, &requirements_path, force).await.map_err(|e| e.to_string())
}

// ── Facts ────────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn ansible_facts_gather(
    state: State<'_, AnsibleServiceState>,
    id: String,
    pattern: String,
    inventory: Option<String>,
    filter: Option<String>,
) -> Result<HashMap<String, HostFacts>, String> {
    let svc = state.lock().await;
    svc.facts_gather(&id, &pattern, inventory.as_deref(), filter.as_deref())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ansible_facts_gather_min(
    state: State<'_, AnsibleServiceState>,
    id: String,
    pattern: String,
    inventory: Option<String>,
) -> Result<HashMap<String, HostFacts>, String> {
    let svc = state.lock().await;
    svc.facts_gather_min(&id, &pattern, inventory.as_deref())
        .await
        .map_err(|e| e.to_string())
}

// ── Config ───────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn ansible_config_dump(
    state: State<'_, AnsibleServiceState>,
    id: String,
) -> Result<Vec<ConfigSetting>, String> {
    let svc = state.lock().await;
    svc.config_dump(&id).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ansible_config_get(
    state: State<'_, AnsibleServiceState>,
    id: String,
    key: String,
) -> Result<Option<ConfigSetting>, String> {
    let svc = state.lock().await;
    svc.config_get(&id, &key).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ansible_config_parse_file(
    state: State<'_, AnsibleServiceState>,
    path: String,
) -> Result<AnsibleConfig, String> {
    let svc = state.lock().await;
    svc.config_parse_file(&path).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ansible_config_detect_path(
    state: State<'_, AnsibleServiceState>,
    id: String,
) -> Result<Option<String>, String> {
    let svc = state.lock().await;
    svc.config_detect_path(&id).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ansible_list_modules(
    state: State<'_, AnsibleServiceState>,
    id: String,
) -> Result<Vec<String>, String> {
    let svc = state.lock().await;
    svc.list_modules(&id).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ansible_module_doc(
    state: State<'_, AnsibleServiceState>,
    id: String,
    module_name: String,
) -> Result<ModuleInfo, String> {
    let svc = state.lock().await;
    svc.module_doc(&id, &module_name).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ansible_module_examples(
    state: State<'_, AnsibleServiceState>,
    id: String,
    module_name: String,
) -> Result<String, String> {
    let svc = state.lock().await;
    svc.module_examples(&id, &module_name).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ansible_list_plugins(
    state: State<'_, AnsibleServiceState>,
    id: String,
    plugin_type: String,
) -> Result<Vec<String>, String> {
    let svc = state.lock().await;
    svc.list_plugins(&id, &plugin_type).await.map_err(|e| e.to_string())
}

// ── History ──────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn ansible_history_list(
    state: State<'_, AnsibleServiceState>,
) -> Result<Vec<ExecutionHistoryEntry>, String> {
    let svc = state.lock().await;
    Ok(svc.history_list())
}

#[tauri::command]
pub async fn ansible_history_get(
    state: State<'_, AnsibleServiceState>,
    exec_id: String,
) -> Result<Option<ExecutionHistoryEntry>, String> {
    let svc = state.lock().await;
    Ok(svc.history_get(&exec_id))
}

#[tauri::command]
pub async fn ansible_history_clear(
    state: State<'_, AnsibleServiceState>,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.history_clear();
    Ok(())
}
