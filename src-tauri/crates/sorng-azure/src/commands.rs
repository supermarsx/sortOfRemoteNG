//! Tauri command handlers for Azure Resource Manager integration.
//!
//! All commands follow the `azure_*` naming convention and accept
//! `State<'_, AzureServiceState>` as their first parameter.

use std::collections::HashMap;

use tauri::State;

use crate::service::AzureServiceState;
use crate::types::*;

/// Convert an AzureError to a String for Tauri's error channel.
fn err_str(e: AzureError) -> String {
    e.to_string()
}

// ── Auth / Configuration ─────────────────────────────────────────────

#[tauri::command]
pub async fn azure_set_credentials(
    state: State<'_, AzureServiceState>,
    tenant_id: String,
    client_id: String,
    client_secret: String,
    subscription_id: String,
    default_resource_group: Option<String>,
    default_region: Option<String>,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.set_credentials(AzureCredentials {
        tenant_id,
        client_id,
        client_secret,
        subscription_id,
        ..Default::default()
    });
    svc.set_default_resource_group(default_resource_group);
    svc.set_default_region(default_region);
    Ok(())
}

#[tauri::command]
pub async fn azure_authenticate(state: State<'_, AzureServiceState>) -> Result<(), String> {
    state.lock().await.authenticate().await.map_err(err_str)
}

#[tauri::command]
pub async fn azure_disconnect(state: State<'_, AzureServiceState>) -> Result<(), String> {
    state.lock().await.disconnect();
    Ok(())
}

#[tauri::command]
pub async fn azure_is_authenticated(state: State<'_, AzureServiceState>) -> Result<bool, String> {
    Ok(state.lock().await.is_authenticated())
}

#[tauri::command]
pub async fn azure_connection_summary(
    state: State<'_, AzureServiceState>,
) -> Result<AzureConnectionSummary, String> {
    Ok(state.lock().await.connection_summary())
}

// ── Virtual Machines ─────────────────────────────────────────────────

#[tauri::command]
pub async fn azure_list_vms(
    state: State<'_, AzureServiceState>,
) -> Result<Vec<VirtualMachine>, String> {
    state.lock().await.list_vms().await.map_err(err_str)
}

#[tauri::command]
pub async fn azure_list_vms_in_rg(
    state: State<'_, AzureServiceState>,
    resource_group: String,
) -> Result<Vec<VirtualMachine>, String> {
    state
        .lock()
        .await
        .list_vms_in_rg(&resource_group)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn azure_get_vm(
    state: State<'_, AzureServiceState>,
    resource_group: String,
    vm_name: String,
) -> Result<VirtualMachine, String> {
    state
        .lock()
        .await
        .get_vm(&resource_group, &vm_name)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn azure_get_vm_instance_view(
    state: State<'_, AzureServiceState>,
    resource_group: String,
    vm_name: String,
) -> Result<VmInstanceView, String> {
    state
        .lock()
        .await
        .get_vm_instance_view(&resource_group, &vm_name)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn azure_start_vm(
    state: State<'_, AzureServiceState>,
    resource_group: String,
    vm_name: String,
) -> Result<(), String> {
    state
        .lock()
        .await
        .start_vm(&resource_group, &vm_name)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn azure_stop_vm(
    state: State<'_, AzureServiceState>,
    resource_group: String,
    vm_name: String,
) -> Result<(), String> {
    state
        .lock()
        .await
        .stop_vm(&resource_group, &vm_name)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn azure_restart_vm(
    state: State<'_, AzureServiceState>,
    resource_group: String,
    vm_name: String,
) -> Result<(), String> {
    state
        .lock()
        .await
        .restart_vm(&resource_group, &vm_name)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn azure_deallocate_vm(
    state: State<'_, AzureServiceState>,
    resource_group: String,
    vm_name: String,
) -> Result<(), String> {
    state
        .lock()
        .await
        .deallocate_vm(&resource_group, &vm_name)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn azure_delete_vm(
    state: State<'_, AzureServiceState>,
    resource_group: String,
    vm_name: String,
) -> Result<(), String> {
    state
        .lock()
        .await
        .delete_vm(&resource_group, &vm_name)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn azure_resize_vm(
    state: State<'_, AzureServiceState>,
    resource_group: String,
    vm_name: String,
    new_size: String,
) -> Result<VirtualMachine, String> {
    state
        .lock()
        .await
        .resize_vm(&resource_group, &vm_name, &new_size)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn azure_list_vm_sizes(
    state: State<'_, AzureServiceState>,
    location: String,
) -> Result<Vec<VmSize>, String> {
    state
        .lock()
        .await
        .list_vm_sizes(&location)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn azure_list_vm_summaries(
    state: State<'_, AzureServiceState>,
) -> Result<Vec<VmSummary>, String> {
    state.lock().await.list_vm_summaries().await.map_err(err_str)
}

// ── Resource Groups ──────────────────────────────────────────────────

#[tauri::command]
pub async fn azure_list_resource_groups(
    state: State<'_, AzureServiceState>,
) -> Result<Vec<ResourceGroup>, String> {
    state
        .lock()
        .await
        .list_resource_groups()
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn azure_get_resource_group(
    state: State<'_, AzureServiceState>,
    name: String,
) -> Result<ResourceGroup, String> {
    state
        .lock()
        .await
        .get_resource_group(&name)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn azure_create_resource_group(
    state: State<'_, AzureServiceState>,
    name: String,
    location: String,
    tags: Option<HashMap<String, String>>,
) -> Result<ResourceGroup, String> {
    state
        .lock()
        .await
        .create_resource_group(&name, &location, tags)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn azure_delete_resource_group(
    state: State<'_, AzureServiceState>,
    name: String,
) -> Result<(), String> {
    state
        .lock()
        .await
        .delete_resource_group(&name)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn azure_list_resources_in_rg(
    state: State<'_, AzureServiceState>,
    resource_group: String,
) -> Result<Vec<AzureResource>, String> {
    state
        .lock()
        .await
        .list_resources_in_rg(&resource_group)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn azure_list_all_resources(
    state: State<'_, AzureServiceState>,
) -> Result<Vec<AzureResource>, String> {
    state
        .lock()
        .await
        .list_all_resources()
        .await
        .map_err(err_str)
}

// ── Storage ──────────────────────────────────────────────────────────

#[tauri::command]
pub async fn azure_list_storage_accounts(
    state: State<'_, AzureServiceState>,
) -> Result<Vec<StorageAccount>, String> {
    state
        .lock()
        .await
        .list_storage_accounts()
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn azure_list_storage_accounts_in_rg(
    state: State<'_, AzureServiceState>,
    resource_group: String,
) -> Result<Vec<StorageAccount>, String> {
    state
        .lock()
        .await
        .list_storage_accounts_in_rg(&resource_group)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn azure_get_storage_account(
    state: State<'_, AzureServiceState>,
    resource_group: String,
    name: String,
) -> Result<StorageAccount, String> {
    state
        .lock()
        .await
        .get_storage_account(&resource_group, &name)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn azure_create_storage_account(
    state: State<'_, AzureServiceState>,
    resource_group: String,
    name: String,
    location: String,
    sku: String,
    kind: String,
) -> Result<StorageAccount, String> {
    state
        .lock()
        .await
        .create_storage_account(&resource_group, &name, &location, &sku, &kind)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn azure_delete_storage_account(
    state: State<'_, AzureServiceState>,
    resource_group: String,
    name: String,
) -> Result<(), String> {
    state
        .lock()
        .await
        .delete_storage_account(&resource_group, &name)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn azure_list_storage_keys(
    state: State<'_, AzureServiceState>,
    resource_group: String,
    name: String,
) -> Result<Vec<StorageAccountKey>, String> {
    state
        .lock()
        .await
        .list_storage_keys(&resource_group, &name)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn azure_list_containers(
    state: State<'_, AzureServiceState>,
    resource_group: String,
    account_name: String,
) -> Result<Vec<BlobContainer>, String> {
    state
        .lock()
        .await
        .list_containers(&resource_group, &account_name)
        .await
        .map_err(err_str)
}

// ── Networking ───────────────────────────────────────────────────────

#[tauri::command]
pub async fn azure_list_vnets(
    state: State<'_, AzureServiceState>,
) -> Result<Vec<VirtualNetwork>, String> {
    state.lock().await.list_vnets().await.map_err(err_str)
}

#[tauri::command]
pub async fn azure_list_vnets_in_rg(
    state: State<'_, AzureServiceState>,
    resource_group: String,
) -> Result<Vec<VirtualNetwork>, String> {
    state
        .lock()
        .await
        .list_vnets_in_rg(&resource_group)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn azure_get_vnet(
    state: State<'_, AzureServiceState>,
    resource_group: String,
    name: String,
) -> Result<VirtualNetwork, String> {
    state
        .lock()
        .await
        .get_vnet(&resource_group, &name)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn azure_list_nsgs(
    state: State<'_, AzureServiceState>,
) -> Result<Vec<NetworkSecurityGroup>, String> {
    state.lock().await.list_nsgs().await.map_err(err_str)
}

#[tauri::command]
pub async fn azure_list_nsgs_in_rg(
    state: State<'_, AzureServiceState>,
    resource_group: String,
) -> Result<Vec<NetworkSecurityGroup>, String> {
    state
        .lock()
        .await
        .list_nsgs_in_rg(&resource_group)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn azure_list_public_ips(
    state: State<'_, AzureServiceState>,
) -> Result<Vec<PublicIpAddress>, String> {
    state.lock().await.list_public_ips().await.map_err(err_str)
}

#[tauri::command]
pub async fn azure_list_nics(
    state: State<'_, AzureServiceState>,
) -> Result<Vec<NetworkInterface>, String> {
    state.lock().await.list_nics().await.map_err(err_str)
}

#[tauri::command]
pub async fn azure_list_load_balancers(
    state: State<'_, AzureServiceState>,
) -> Result<Vec<LoadBalancer>, String> {
    state
        .lock()
        .await
        .list_load_balancers()
        .await
        .map_err(err_str)
}

// ── App Service ──────────────────────────────────────────────────────

#[tauri::command]
pub async fn azure_list_web_apps(
    state: State<'_, AzureServiceState>,
) -> Result<Vec<WebApp>, String> {
    state.lock().await.list_web_apps().await.map_err(err_str)
}

#[tauri::command]
pub async fn azure_list_web_apps_in_rg(
    state: State<'_, AzureServiceState>,
    resource_group: String,
) -> Result<Vec<WebApp>, String> {
    state
        .lock()
        .await
        .list_web_apps_in_rg(&resource_group)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn azure_get_web_app(
    state: State<'_, AzureServiceState>,
    resource_group: String,
    name: String,
) -> Result<WebApp, String> {
    state
        .lock()
        .await
        .get_web_app(&resource_group, &name)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn azure_start_web_app(
    state: State<'_, AzureServiceState>,
    resource_group: String,
    name: String,
) -> Result<(), String> {
    state
        .lock()
        .await
        .start_web_app(&resource_group, &name)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn azure_stop_web_app(
    state: State<'_, AzureServiceState>,
    resource_group: String,
    name: String,
) -> Result<(), String> {
    state
        .lock()
        .await
        .stop_web_app(&resource_group, &name)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn azure_restart_web_app(
    state: State<'_, AzureServiceState>,
    resource_group: String,
    name: String,
) -> Result<(), String> {
    state
        .lock()
        .await
        .restart_web_app(&resource_group, &name)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn azure_delete_web_app(
    state: State<'_, AzureServiceState>,
    resource_group: String,
    name: String,
) -> Result<(), String> {
    state
        .lock()
        .await
        .delete_web_app(&resource_group, &name)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn azure_list_slots(
    state: State<'_, AzureServiceState>,
    resource_group: String,
    app_name: String,
) -> Result<Vec<DeploymentSlot>, String> {
    state
        .lock()
        .await
        .list_slots(&resource_group, &app_name)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn azure_swap_slot(
    state: State<'_, AzureServiceState>,
    resource_group: String,
    app_name: String,
    target_slot: String,
) -> Result<(), String> {
    state
        .lock()
        .await
        .swap_slot(&resource_group, &app_name, &target_slot)
        .await
        .map_err(err_str)
}

// ── SQL ──────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn azure_list_sql_servers(
    state: State<'_, AzureServiceState>,
) -> Result<Vec<SqlServer>, String> {
    state.lock().await.list_sql_servers().await.map_err(err_str)
}

#[tauri::command]
pub async fn azure_list_sql_servers_in_rg(
    state: State<'_, AzureServiceState>,
    resource_group: String,
) -> Result<Vec<SqlServer>, String> {
    state
        .lock()
        .await
        .list_sql_servers_in_rg(&resource_group)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn azure_get_sql_server(
    state: State<'_, AzureServiceState>,
    resource_group: String,
    name: String,
) -> Result<SqlServer, String> {
    state
        .lock()
        .await
        .get_sql_server(&resource_group, &name)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn azure_list_databases(
    state: State<'_, AzureServiceState>,
    resource_group: String,
    server_name: String,
) -> Result<Vec<SqlDatabase>, String> {
    state
        .lock()
        .await
        .list_databases(&resource_group, &server_name)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn azure_get_database(
    state: State<'_, AzureServiceState>,
    resource_group: String,
    server_name: String,
    database_name: String,
) -> Result<SqlDatabase, String> {
    state
        .lock()
        .await
        .get_database(&resource_group, &server_name, &database_name)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn azure_create_database(
    state: State<'_, AzureServiceState>,
    resource_group: String,
    server_name: String,
    database_name: String,
    location: String,
    sku: Option<String>,
    max_size_bytes: Option<i64>,
) -> Result<SqlDatabase, String> {
    state
        .lock()
        .await
        .create_database(
            &resource_group,
            &server_name,
            &database_name,
            &location,
            sku.as_deref(),
            max_size_bytes,
        )
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn azure_delete_database(
    state: State<'_, AzureServiceState>,
    resource_group: String,
    server_name: String,
    database_name: String,
) -> Result<(), String> {
    state
        .lock()
        .await
        .delete_database(&resource_group, &server_name, &database_name)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn azure_list_firewall_rules(
    state: State<'_, AzureServiceState>,
    resource_group: String,
    server_name: String,
) -> Result<Vec<SqlFirewallRule>, String> {
    state
        .lock()
        .await
        .list_firewall_rules(&resource_group, &server_name)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn azure_create_firewall_rule(
    state: State<'_, AzureServiceState>,
    resource_group: String,
    server_name: String,
    rule_name: String,
    start_ip: String,
    end_ip: String,
) -> Result<SqlFirewallRule, String> {
    state
        .lock()
        .await
        .create_firewall_rule(&resource_group, &server_name, &rule_name, &start_ip, &end_ip)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn azure_delete_firewall_rule(
    state: State<'_, AzureServiceState>,
    resource_group: String,
    server_name: String,
    rule_name: String,
) -> Result<(), String> {
    state
        .lock()
        .await
        .delete_firewall_rule(&resource_group, &server_name, &rule_name)
        .await
        .map_err(err_str)
}

// ── Key Vault ────────────────────────────────────────────────────────

#[tauri::command]
pub async fn azure_list_vaults(
    state: State<'_, AzureServiceState>,
) -> Result<Vec<KeyVault>, String> {
    state.lock().await.list_vaults().await.map_err(err_str)
}

#[tauri::command]
pub async fn azure_list_vaults_in_rg(
    state: State<'_, AzureServiceState>,
    resource_group: String,
) -> Result<Vec<KeyVault>, String> {
    state
        .lock()
        .await
        .list_vaults_in_rg(&resource_group)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn azure_get_vault(
    state: State<'_, AzureServiceState>,
    resource_group: String,
    name: String,
) -> Result<KeyVault, String> {
    state
        .lock()
        .await
        .get_vault(&resource_group, &name)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn azure_list_secrets(
    state: State<'_, AzureServiceState>,
    vault_name: String,
) -> Result<Vec<SecretItem>, String> {
    state
        .lock()
        .await
        .list_secrets(&vault_name)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn azure_get_secret(
    state: State<'_, AzureServiceState>,
    vault_name: String,
    secret_name: String,
) -> Result<SecretBundle, String> {
    state
        .lock()
        .await
        .get_secret(&vault_name, &secret_name)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn azure_set_secret(
    state: State<'_, AzureServiceState>,
    vault_name: String,
    secret_name: String,
    value: String,
    content_type: Option<String>,
) -> Result<SecretBundle, String> {
    state
        .lock()
        .await
        .set_secret(&vault_name, &secret_name, &value, content_type.as_deref())
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn azure_delete_secret(
    state: State<'_, AzureServiceState>,
    vault_name: String,
    secret_name: String,
) -> Result<(), String> {
    state
        .lock()
        .await
        .delete_secret(&vault_name, &secret_name)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn azure_list_keys(
    state: State<'_, AzureServiceState>,
    vault_name: String,
) -> Result<Vec<KeyItem>, String> {
    state
        .lock()
        .await
        .list_keys(&vault_name)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn azure_list_certificates(
    state: State<'_, AzureServiceState>,
    vault_name: String,
) -> Result<Vec<CertificateItem>, String> {
    state
        .lock()
        .await
        .list_certificates(&vault_name)
        .await
        .map_err(err_str)
}

// ── Container Instances ──────────────────────────────────────────────

#[tauri::command]
pub async fn azure_list_container_groups(
    state: State<'_, AzureServiceState>,
) -> Result<Vec<ContainerGroup>, String> {
    state
        .lock()
        .await
        .list_container_groups()
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn azure_list_container_groups_in_rg(
    state: State<'_, AzureServiceState>,
    resource_group: String,
) -> Result<Vec<ContainerGroup>, String> {
    state
        .lock()
        .await
        .list_container_groups_in_rg(&resource_group)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn azure_get_container_group(
    state: State<'_, AzureServiceState>,
    resource_group: String,
    name: String,
) -> Result<ContainerGroup, String> {
    state
        .lock()
        .await
        .get_container_group(&resource_group, &name)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn azure_create_container_group(
    state: State<'_, AzureServiceState>,
    resource_group: String,
    name: String,
    body: serde_json::Value,
) -> Result<ContainerGroup, String> {
    state
        .lock()
        .await
        .create_container_group(&resource_group, &name, &body)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn azure_delete_container_group(
    state: State<'_, AzureServiceState>,
    resource_group: String,
    name: String,
) -> Result<(), String> {
    state
        .lock()
        .await
        .delete_container_group(&resource_group, &name)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn azure_restart_container_group(
    state: State<'_, AzureServiceState>,
    resource_group: String,
    name: String,
) -> Result<(), String> {
    state
        .lock()
        .await
        .restart_container_group(&resource_group, &name)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn azure_stop_container_group(
    state: State<'_, AzureServiceState>,
    resource_group: String,
    name: String,
) -> Result<(), String> {
    state
        .lock()
        .await
        .stop_container_group(&resource_group, &name)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn azure_start_container_group(
    state: State<'_, AzureServiceState>,
    resource_group: String,
    name: String,
) -> Result<(), String> {
    state
        .lock()
        .await
        .start_container_group(&resource_group, &name)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn azure_get_container_logs(
    state: State<'_, AzureServiceState>,
    resource_group: String,
    group_name: String,
    container_name: String,
    tail: Option<u32>,
) -> Result<ContainerLogs, String> {
    state
        .lock()
        .await
        .get_container_logs(&resource_group, &group_name, &container_name, tail)
        .await
        .map_err(err_str)
}

// ── Monitor ──────────────────────────────────────────────────────────

#[tauri::command]
pub async fn azure_list_metric_definitions(
    state: State<'_, AzureServiceState>,
    resource_id: String,
) -> Result<Vec<MetricDefinition>, String> {
    state
        .lock()
        .await
        .list_metric_definitions(&resource_id)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn azure_query_metrics(
    state: State<'_, AzureServiceState>,
    resource_id: String,
    metric_names: String,
    timespan: Option<String>,
    interval: Option<String>,
    aggregation: Option<String>,
) -> Result<MetricResponse, String> {
    state
        .lock()
        .await
        .query_metrics(
            &resource_id,
            &metric_names,
            timespan.as_deref(),
            interval.as_deref(),
            aggregation.as_deref(),
        )
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn azure_list_activity_log(
    state: State<'_, AzureServiceState>,
    filter: String,
    select: Option<String>,
) -> Result<Vec<ActivityLogEntry>, String> {
    state
        .lock()
        .await
        .list_activity_log(&filter, select.as_deref())
        .await
        .map_err(err_str)
}

// ── Cost Management ──────────────────────────────────────────────────

#[tauri::command]
pub async fn azure_list_usage_details(
    state: State<'_, AzureServiceState>,
    filter: Option<String>,
    top: Option<u32>,
) -> Result<Vec<UsageDetail>, String> {
    state
        .lock()
        .await
        .list_usage_details(filter.as_deref(), top)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn azure_list_budgets(
    state: State<'_, AzureServiceState>,
) -> Result<Vec<Budget>, String> {
    state.lock().await.list_budgets().await.map_err(err_str)
}

#[tauri::command]
pub async fn azure_get_budget(
    state: State<'_, AzureServiceState>,
    name: String,
) -> Result<Budget, String> {
    state
        .lock()
        .await
        .get_budget(&name)
        .await
        .map_err(err_str)
}

// ── Resource Search ──────────────────────────────────────────────────

#[tauri::command]
pub async fn azure_search_resources(
    state: State<'_, AzureServiceState>,
    query: String,
    top: Option<i32>,
    skip: Option<i32>,
) -> Result<ResourceSearchResponse, String> {
    state
        .lock()
        .await
        .search_resources(&query, top, skip)
        .await
        .map_err(err_str)
}
