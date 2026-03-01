//! Central service façade for Azure Resource Manager operations.
//!
//! Aggregates the HTTP client, auth state and all domain modules behind a
//! single `AzureService` struct that can be managed as Tauri state.

use std::sync::Arc;
use tokio::sync::Mutex;

use crate::app_service;
use crate::auth;
use crate::client::AzureClient;
use crate::container_instances;
use crate::cost;
use crate::key_vault;
use crate::monitor;
use crate::networking;
use crate::resource_groups;
use crate::search;
use crate::sql;
use crate::storage;
use crate::types::*;
use crate::virtual_machines;

/// Thread-safe service state for Tauri.
pub type AzureServiceState = Arc<Mutex<AzureService>>;

/// The core Azure service combining client + state.
pub struct AzureService {
    client: AzureClient,
    credentials: Option<AzureCredentials>,
    default_resource_group: Option<String>,
    default_region: Option<String>,
}

impl AzureService {
    /// Create a new service wrapped in `Arc<Mutex<_>>` for Tauri state management.
    pub fn new() -> AzureServiceState {
        let service = Self {
            client: AzureClient::new(),
            credentials: None,
            default_resource_group: None,
            default_region: None,
        };
        Arc::new(Mutex::new(service))
    }

    // ── Configuration ────────────────────────────────────────────────

    pub fn set_credentials(&mut self, creds: AzureCredentials) {
        self.client.set_credentials(creds.clone());
        self.credentials = Some(creds);
    }

    pub fn set_default_resource_group(&mut self, rg: Option<String>) {
        self.default_resource_group = rg;
    }

    pub fn set_default_region(&mut self, region: Option<String>) {
        self.default_region = region;
    }

    pub fn is_authenticated(&self) -> bool {
        self.client.is_authenticated()
    }

    pub fn connection_summary(&self) -> AzureConnectionSummary {
        AzureConnectionSummary {
            authenticated: self.is_authenticated(),
            subscription_id: self
                .credentials
                .as_ref()
                .map(|c| c.subscription_id.clone()),
            tenant_id: self.credentials.as_ref().map(|c| c.tenant_id.clone()),
            default_resource_group: self.default_resource_group.clone(),
            default_region: self.default_region.clone(),
            token_expires_at: self
                .client
                .token()
                .and_then(|t| t.expires_at.map(|e| e.to_rfc3339())),
        }
    }

    // ── Auth ─────────────────────────────────────────────────────────

    pub async fn authenticate(&mut self) -> AzureResult<()> {
        let creds = self
            .credentials
            .as_ref()
            .ok_or_else(AzureError::not_authenticated)?;
        let token = auth::acquire_token(&self.client, creds).await?;
        self.client.set_token(token);
        Ok(())
    }

    pub async fn authenticate_for_vault(&mut self) -> AzureResult<AzureToken> {
        let creds = self
            .credentials
            .as_ref()
            .ok_or_else(AzureError::not_authenticated)?;
        auth::acquire_vault_token(&self.client, creds).await
    }

    pub fn set_token(&mut self, token: AzureToken) {
        self.client.set_token(token);
    }

    pub fn get_token(&self) -> Option<&AzureToken> {
        self.client.token()
    }

    pub fn disconnect(&mut self) {
        self.client.clear_token();
    }

    async fn ensure_auth(&mut self) -> AzureResult<()> {
        if !self.client.is_authenticated() {
            self.authenticate().await?;
        }
        Ok(())
    }

    // ── Virtual Machines ─────────────────────────────────────────────

    pub async fn list_vms(&mut self) -> AzureResult<Vec<VirtualMachine>> {
        self.ensure_auth().await?;
        virtual_machines::list_vms(&self.client).await
    }

    pub async fn list_vms_in_rg(&mut self, rg: &str) -> AzureResult<Vec<VirtualMachine>> {
        self.ensure_auth().await?;
        virtual_machines::list_vms_in_rg(&self.client, rg).await
    }

    pub async fn get_vm(&mut self, rg: &str, vm_name: &str) -> AzureResult<VirtualMachine> {
        self.ensure_auth().await?;
        virtual_machines::get_vm(&self.client, rg, vm_name).await
    }

    pub async fn get_vm_instance_view(&mut self, rg: &str, vm_name: &str) -> AzureResult<VmInstanceView> {
        self.ensure_auth().await?;
        virtual_machines::get_instance_view(&self.client, rg, vm_name).await
    }

    pub async fn start_vm(&mut self, rg: &str, vm_name: &str) -> AzureResult<()> {
        self.ensure_auth().await?;
        virtual_machines::start_vm(&self.client, rg, vm_name).await
    }

    pub async fn stop_vm(&mut self, rg: &str, vm_name: &str) -> AzureResult<()> {
        self.ensure_auth().await?;
        virtual_machines::stop_vm(&self.client, rg, vm_name).await
    }

    pub async fn restart_vm(&mut self, rg: &str, vm_name: &str) -> AzureResult<()> {
        self.ensure_auth().await?;
        virtual_machines::restart_vm(&self.client, rg, vm_name).await
    }

    pub async fn deallocate_vm(&mut self, rg: &str, vm_name: &str) -> AzureResult<()> {
        self.ensure_auth().await?;
        virtual_machines::deallocate_vm(&self.client, rg, vm_name).await
    }

    pub async fn delete_vm(&mut self, rg: &str, vm_name: &str) -> AzureResult<()> {
        self.ensure_auth().await?;
        virtual_machines::delete_vm(&self.client, rg, vm_name).await
    }

    pub async fn resize_vm(
        &mut self,
        rg: &str,
        vm_name: &str,
        new_size: &str,
    ) -> AzureResult<VirtualMachine> {
        self.ensure_auth().await?;
        virtual_machines::resize_vm(&self.client, rg, vm_name, new_size).await
    }

    pub async fn list_vm_sizes(&mut self, location: &str) -> AzureResult<Vec<VmSize>> {
        self.ensure_auth().await?;
        virtual_machines::list_sizes_in_location(&self.client, location).await
    }

    pub async fn list_vm_summaries(&mut self) -> AzureResult<Vec<VmSummary>> {
        self.ensure_auth().await?;
        let vms = virtual_machines::list_vms(&self.client).await?;
        let mut summaries = Vec::with_capacity(vms.len());
        for vm in &vms {
            summaries.push(virtual_machines::vm_to_summary(vm));
        }
        Ok(summaries)
    }

    // ── Resource Groups ──────────────────────────────────────────────

    pub async fn list_resource_groups(&mut self) -> AzureResult<Vec<ResourceGroup>> {
        self.ensure_auth().await?;
        resource_groups::list_resource_groups(&self.client).await
    }

    pub async fn get_resource_group(&mut self, rg: &str) -> AzureResult<ResourceGroup> {
        self.ensure_auth().await?;
        resource_groups::get_resource_group(&self.client, rg).await
    }

    pub async fn create_resource_group(
        &mut self,
        rg: &str,
        location: &str,
        tags: Option<std::collections::HashMap<String, String>>,
    ) -> AzureResult<ResourceGroup> {
        self.ensure_auth().await?;
        let request = CreateResourceGroupRequest {
            location: location.to_string(),
            tags: tags.unwrap_or_default(),
        };
        resource_groups::create_resource_group(&self.client, rg, &request).await
    }

    pub async fn delete_resource_group(&mut self, rg: &str) -> AzureResult<()> {
        self.ensure_auth().await?;
        resource_groups::delete_resource_group(&self.client, rg).await
    }

    pub async fn list_resources_in_rg(&mut self, rg: &str) -> AzureResult<Vec<AzureResource>> {
        self.ensure_auth().await?;
        resource_groups::list_resources_in_rg(&self.client, rg).await
    }

    pub async fn list_all_resources(&mut self) -> AzureResult<Vec<AzureResource>> {
        self.ensure_auth().await?;
        resource_groups::list_all_resources(&self.client).await
    }

    // ── Storage ──────────────────────────────────────────────────────

    pub async fn list_storage_accounts(&mut self) -> AzureResult<Vec<StorageAccount>> {
        self.ensure_auth().await?;
        storage::list_storage_accounts(&self.client).await
    }

    pub async fn list_storage_accounts_in_rg(
        &mut self,
        rg: &str,
    ) -> AzureResult<Vec<StorageAccount>> {
        self.ensure_auth().await?;
        storage::list_storage_accounts_in_rg(&self.client, rg).await
    }

    pub async fn get_storage_account(
        &mut self,
        rg: &str,
        name: &str,
    ) -> AzureResult<StorageAccount> {
        self.ensure_auth().await?;
        storage::get_storage_account(&self.client, rg, name).await
    }

    pub async fn create_storage_account(
        &mut self,
        rg: &str,
        name: &str,
        location: &str,
        sku: &str,
        kind: &str,
    ) -> AzureResult<StorageAccount> {
        self.ensure_auth().await?;
        let request = CreateStorageAccountRequest {
            location: location.to_string(),
            kind: kind.to_string(),
            sku: StorageSku {
                name: Some(sku.to_string()),
                tier: None,
            },
            tags: std::collections::HashMap::new(),
        };
        storage::create_storage_account(&self.client, rg, name, &request).await
    }

    pub async fn delete_storage_account(&mut self, rg: &str, name: &str) -> AzureResult<()> {
        self.ensure_auth().await?;
        storage::delete_storage_account(&self.client, rg, name).await
    }

    pub async fn list_storage_keys(
        &mut self,
        rg: &str,
        name: &str,
    ) -> AzureResult<Vec<StorageAccountKey>> {
        self.ensure_auth().await?;
        storage::list_keys(&self.client, rg, name).await
    }

    pub async fn list_containers(
        &mut self,
        rg: &str,
        account_name: &str,
    ) -> AzureResult<Vec<BlobContainer>> {
        self.ensure_auth().await?;
        storage::list_containers(&self.client, rg, account_name).await
    }

    // ── Networking ───────────────────────────────────────────────────

    pub async fn list_vnets(&mut self) -> AzureResult<Vec<VirtualNetwork>> {
        self.ensure_auth().await?;
        networking::list_vnets(&self.client).await
    }

    pub async fn list_vnets_in_rg(&mut self, rg: &str) -> AzureResult<Vec<VirtualNetwork>> {
        self.ensure_auth().await?;
        networking::list_vnets_in_rg(&self.client, rg).await
    }

    pub async fn get_vnet(&mut self, rg: &str, name: &str) -> AzureResult<VirtualNetwork> {
        self.ensure_auth().await?;
        networking::get_vnet(&self.client, rg, name).await
    }

    pub async fn list_nsgs(&mut self) -> AzureResult<Vec<NetworkSecurityGroup>> {
        self.ensure_auth().await?;
        networking::list_nsgs(&self.client).await
    }

    pub async fn list_nsgs_in_rg(&mut self, rg: &str) -> AzureResult<Vec<NetworkSecurityGroup>> {
        self.ensure_auth().await?;
        networking::list_nsgs_in_rg(&self.client, rg).await
    }

    pub async fn get_nsg(
        &mut self,
        rg: &str,
        nsg_name: &str,
    ) -> AzureResult<NetworkSecurityGroup> {
        self.ensure_auth().await?;
        networking::get_nsg(&self.client, rg, nsg_name).await
    }

    pub async fn list_public_ips(&mut self) -> AzureResult<Vec<PublicIpAddress>> {
        self.ensure_auth().await?;
        networking::list_public_ips(&self.client).await
    }

    pub async fn list_nics(&mut self) -> AzureResult<Vec<NetworkInterface>> {
        self.ensure_auth().await?;
        networking::list_nics(&self.client).await
    }

    pub async fn list_load_balancers(&mut self) -> AzureResult<Vec<LoadBalancer>> {
        self.ensure_auth().await?;
        networking::list_load_balancers(&self.client).await
    }

    // ── App Service ──────────────────────────────────────────────────

    pub async fn list_web_apps(&mut self) -> AzureResult<Vec<WebApp>> {
        self.ensure_auth().await?;
        app_service::list_web_apps(&self.client).await
    }

    pub async fn list_web_apps_in_rg(&mut self, rg: &str) -> AzureResult<Vec<WebApp>> {
        self.ensure_auth().await?;
        app_service::list_web_apps_in_rg(&self.client, rg).await
    }

    pub async fn get_web_app(&mut self, rg: &str, name: &str) -> AzureResult<WebApp> {
        self.ensure_auth().await?;
        app_service::get_web_app(&self.client, rg, name).await
    }

    pub async fn start_web_app(&mut self, rg: &str, name: &str) -> AzureResult<()> {
        self.ensure_auth().await?;
        app_service::start_web_app(&self.client, rg, name).await
    }

    pub async fn stop_web_app(&mut self, rg: &str, name: &str) -> AzureResult<()> {
        self.ensure_auth().await?;
        app_service::stop_web_app(&self.client, rg, name).await
    }

    pub async fn restart_web_app(&mut self, rg: &str, name: &str) -> AzureResult<()> {
        self.ensure_auth().await?;
        app_service::restart_web_app(&self.client, rg, name).await
    }

    pub async fn delete_web_app(&mut self, rg: &str, name: &str) -> AzureResult<()> {
        self.ensure_auth().await?;
        app_service::delete_web_app(&self.client, rg, name).await
    }

    pub async fn list_slots(
        &mut self,
        rg: &str,
        app_name: &str,
    ) -> AzureResult<Vec<DeploymentSlot>> {
        self.ensure_auth().await?;
        app_service::list_slots(&self.client, rg, app_name).await
    }

    pub async fn swap_slot(
        &mut self,
        rg: &str,
        app_name: &str,
        target_slot: &str,
    ) -> AzureResult<()> {
        self.ensure_auth().await?;
        app_service::swap_slot(&self.client, rg, app_name, target_slot).await
    }

    // ── SQL ──────────────────────────────────────────────────────────

    pub async fn list_sql_servers(&mut self) -> AzureResult<Vec<SqlServer>> {
        self.ensure_auth().await?;
        sql::list_sql_servers(&self.client).await
    }

    pub async fn list_sql_servers_in_rg(&mut self, rg: &str) -> AzureResult<Vec<SqlServer>> {
        self.ensure_auth().await?;
        sql::list_sql_servers_in_rg(&self.client, rg).await
    }

    pub async fn get_sql_server(&mut self, rg: &str, name: &str) -> AzureResult<SqlServer> {
        self.ensure_auth().await?;
        sql::get_sql_server(&self.client, rg, name).await
    }

    pub async fn list_databases(
        &mut self,
        rg: &str,
        server: &str,
    ) -> AzureResult<Vec<SqlDatabase>> {
        self.ensure_auth().await?;
        sql::list_databases(&self.client, rg, server).await
    }

    pub async fn get_database(
        &mut self,
        rg: &str,
        server: &str,
        db: &str,
    ) -> AzureResult<SqlDatabase> {
        self.ensure_auth().await?;
        sql::get_database(&self.client, rg, server, db).await
    }

    pub async fn create_database(
        &mut self,
        rg: &str,
        server: &str,
        db: &str,
        location: &str,
        sku: Option<&str>,
        max_size: Option<i64>,
    ) -> AzureResult<SqlDatabase> {
        self.ensure_auth().await?;
        sql::create_database(&self.client, rg, server, db, location, sku, max_size).await
    }

    pub async fn delete_database(
        &mut self,
        rg: &str,
        server: &str,
        db: &str,
    ) -> AzureResult<()> {
        self.ensure_auth().await?;
        sql::delete_database(&self.client, rg, server, db).await
    }

    pub async fn list_firewall_rules(
        &mut self,
        rg: &str,
        server: &str,
    ) -> AzureResult<Vec<SqlFirewallRule>> {
        self.ensure_auth().await?;
        sql::list_firewall_rules(&self.client, rg, server).await
    }

    pub async fn create_firewall_rule(
        &mut self,
        rg: &str,
        server: &str,
        rule_name: &str,
        start_ip: &str,
        end_ip: &str,
    ) -> AzureResult<SqlFirewallRule> {
        self.ensure_auth().await?;
        sql::create_firewall_rule(&self.client, rg, server, rule_name, start_ip, end_ip).await
    }

    pub async fn delete_firewall_rule(
        &mut self,
        rg: &str,
        server: &str,
        rule_name: &str,
    ) -> AzureResult<()> {
        self.ensure_auth().await?;
        sql::delete_firewall_rule(&self.client, rg, server, rule_name).await
    }

    // ── Key Vault ────────────────────────────────────────────────────

    pub async fn list_vaults(&mut self) -> AzureResult<Vec<KeyVault>> {
        self.ensure_auth().await?;
        key_vault::list_vaults(&self.client).await
    }

    pub async fn list_vaults_in_rg(&mut self, rg: &str) -> AzureResult<Vec<KeyVault>> {
        self.ensure_auth().await?;
        key_vault::list_vaults_in_rg(&self.client, rg).await
    }

    pub async fn get_vault(&mut self, rg: &str, name: &str) -> AzureResult<KeyVault> {
        self.ensure_auth().await?;
        key_vault::get_vault(&self.client, rg, name).await
    }

    pub async fn list_secrets(&mut self, vault_name: &str) -> AzureResult<Vec<SecretItem>> {
        self.ensure_auth().await?;
        key_vault::list_secrets(&self.client, vault_name).await
    }

    pub async fn get_secret(
        &mut self,
        vault_name: &str,
        secret_name: &str,
    ) -> AzureResult<SecretBundle> {
        self.ensure_auth().await?;
        key_vault::get_secret(&self.client, vault_name, secret_name).await
    }

    pub async fn set_secret(
        &mut self,
        vault_name: &str,
        secret_name: &str,
        value: &str,
        content_type: Option<&str>,
    ) -> AzureResult<SecretBundle> {
        self.ensure_auth().await?;
        key_vault::set_secret(&self.client, vault_name, secret_name, value, content_type).await
    }

    pub async fn delete_secret(
        &mut self,
        vault_name: &str,
        secret_name: &str,
    ) -> AzureResult<()> {
        self.ensure_auth().await?;
        key_vault::delete_secret(&self.client, vault_name, secret_name).await
    }

    pub async fn list_keys(&mut self, vault_name: &str) -> AzureResult<Vec<KeyItem>> {
        self.ensure_auth().await?;
        key_vault::list_keys(&self.client, vault_name).await
    }

    pub async fn list_certificates(
        &mut self,
        vault_name: &str,
    ) -> AzureResult<Vec<CertificateItem>> {
        self.ensure_auth().await?;
        key_vault::list_certificates(&self.client, vault_name).await
    }

    // ── Container Instances ──────────────────────────────────────────

    pub async fn list_container_groups(&mut self) -> AzureResult<Vec<ContainerGroup>> {
        self.ensure_auth().await?;
        container_instances::list_container_groups(&self.client).await
    }

    pub async fn list_container_groups_in_rg(
        &mut self,
        rg: &str,
    ) -> AzureResult<Vec<ContainerGroup>> {
        self.ensure_auth().await?;
        container_instances::list_container_groups_in_rg(&self.client, rg).await
    }

    pub async fn get_container_group(
        &mut self,
        rg: &str,
        name: &str,
    ) -> AzureResult<ContainerGroup> {
        self.ensure_auth().await?;
        container_instances::get_container_group(&self.client, rg, name).await
    }

    pub async fn create_container_group(
        &mut self,
        rg: &str,
        name: &str,
        body: &serde_json::Value,
    ) -> AzureResult<ContainerGroup> {
        self.ensure_auth().await?;
        container_instances::create_container_group(&self.client, rg, name, body).await
    }

    pub async fn delete_container_group(&mut self, rg: &str, name: &str) -> AzureResult<()> {
        self.ensure_auth().await?;
        container_instances::delete_container_group(&self.client, rg, name).await
    }

    pub async fn restart_container_group(&mut self, rg: &str, name: &str) -> AzureResult<()> {
        self.ensure_auth().await?;
        container_instances::restart_container_group(&self.client, rg, name).await
    }

    pub async fn stop_container_group(&mut self, rg: &str, name: &str) -> AzureResult<()> {
        self.ensure_auth().await?;
        container_instances::stop_container_group(&self.client, rg, name).await
    }

    pub async fn start_container_group(&mut self, rg: &str, name: &str) -> AzureResult<()> {
        self.ensure_auth().await?;
        container_instances::start_container_group(&self.client, rg, name).await
    }

    pub async fn get_container_logs(
        &mut self,
        rg: &str,
        group_name: &str,
        container_name: &str,
        tail: Option<u32>,
    ) -> AzureResult<ContainerLogs> {
        self.ensure_auth().await?;
        container_instances::get_container_logs(&self.client, rg, group_name, container_name, tail)
            .await
    }

    // ── Monitor ──────────────────────────────────────────────────────

    pub async fn list_metric_definitions(
        &mut self,
        resource_id: &str,
    ) -> AzureResult<Vec<MetricDefinition>> {
        self.ensure_auth().await?;
        monitor::list_metric_definitions(&self.client, resource_id).await
    }

    pub async fn query_metrics(
        &mut self,
        resource_id: &str,
        metric_names: &str,
        timespan: Option<&str>,
        interval: Option<&str>,
        aggregation: Option<&str>,
    ) -> AzureResult<MetricResponse> {
        self.ensure_auth().await?;
        monitor::query_metrics(
            &self.client,
            resource_id,
            metric_names,
            timespan,
            interval,
            aggregation,
        )
        .await
    }

    pub async fn list_activity_log(
        &mut self,
        filter: &str,
        select: Option<&str>,
    ) -> AzureResult<Vec<ActivityLogEntry>> {
        self.ensure_auth().await?;
        monitor::list_activity_log(&self.client, filter, select).await
    }

    // ── Cost Management ──────────────────────────────────────────────

    pub async fn list_usage_details(
        &mut self,
        filter: Option<&str>,
        top: Option<u32>,
    ) -> AzureResult<Vec<UsageDetail>> {
        self.ensure_auth().await?;
        cost::list_usage_details(&self.client, filter, top).await
    }

    pub async fn list_budgets(&mut self) -> AzureResult<Vec<Budget>> {
        self.ensure_auth().await?;
        cost::list_budgets(&self.client).await
    }

    pub async fn get_budget(&mut self, name: &str) -> AzureResult<Budget> {
        self.ensure_auth().await?;
        cost::get_budget(&self.client, name).await
    }

    // ── Resource Search ──────────────────────────────────────────────

    pub async fn search_resources(
        &mut self,
        query: &str,
        top: Option<i32>,
        skip: Option<i32>,
    ) -> AzureResult<ResourceSearchResponse> {
        self.ensure_auth().await?;
        search::search_resources_in_subscription(&self.client, query, top, skip).await
    }

    pub async fn search_resources_cross_subscription(
        &mut self,
        query: &str,
        subscriptions: &[String],
        top: Option<i32>,
        skip: Option<i32>,
    ) -> AzureResult<ResourceSearchResponse> {
        self.ensure_auth().await?;
        search::search_resources(&self.client, query, subscriptions, top, skip).await
    }
}

// ─── Tests ──────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn new_creates_state() {
        let state = AzureService::new();
        let service = state.try_lock().unwrap();
        assert!(!service.is_authenticated());
    }

    #[test]
    fn connection_summary_not_authenticated() {
        let state = AzureService::new();
        let service = state.try_lock().unwrap();
        let summary = service.connection_summary();
        assert!(!summary.authenticated);
        assert!(summary.subscription_id.is_none());
    }

    #[test]
    fn set_credentials_updates() {
        let state = AzureService::new();
        let mut service = state.try_lock().unwrap();
        service.set_credentials(AzureCredentials {
            tenant_id: "t1".into(),
            client_id: "c1".into(),
            client_secret: "s1".into(),
            subscription_id: "sub1".into(),
            ..Default::default()
        });
        let summary = service.connection_summary();
        assert_eq!(summary.subscription_id, Some("sub1".into()));
        assert_eq!(summary.tenant_id, Some("t1".into()));
    }

    #[test]
    fn set_default_resource_group() {
        let state = AzureService::new();
        let mut service = state.try_lock().unwrap();
        service.set_default_resource_group(Some("rg1".into()));
        assert_eq!(
            service.connection_summary().default_resource_group,
            Some("rg1".into())
        );
    }

    #[test]
    fn disconnect_clears_auth() {
        let state = AzureService::new();
        let mut service = state.try_lock().unwrap();
        service.disconnect();
        assert!(!service.is_authenticated());
    }
}
