// ── sorng-freeipa/src/service.rs ──────────────────────────────────────────────
//! Aggregate FreeIPA façade – single entry point that holds connections
//! and delegates to domain managers.

use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

use crate::certificates::CertManager;
use crate::client::FreeIpaClient;
use crate::dns::DnsManager;
use crate::error::{FreeIpaError, FreeIpaResult};
use crate::groups::GroupManager;
use crate::hbac::HbacManager;
use crate::hosts::HostManager;
use crate::rbac::RbacManager;
use crate::services::ServiceManager;
use crate::sudo::SudoManager;
use crate::trusts::TrustManager;
use crate::types::*;
use crate::users::UserManager;

/// Shared Tauri state handle.
pub type FreeIpaServiceState = Arc<Mutex<FreeIpaServiceHolder>>;

/// Main FreeIPA service managing connections.
pub struct FreeIpaServiceHolder {
    connections: HashMap<String, FreeIpaClient>,
}

impl FreeIpaServiceHolder {
    pub fn new() -> Self {
        Self {
            connections: HashMap::new(),
        }
    }

    // ── Connection lifecycle ──────────────────────────────────────

    pub async fn connect(
        &mut self,
        id: String,
        config: FreeIpaConnectionConfig,
    ) -> FreeIpaResult<FreeIpaConnectionSummary> {
        let realm = config.realm.clone().unwrap_or_else(|| "UNKNOWN".into());
        let server_url = config.server_url.clone();
        let username = config.username.clone();
        let mut client = FreeIpaClient::new(config)?;
        client.login().await?;
        let summary = FreeIpaConnectionSummary {
            server_url,
            realm,
            authenticated_user: Some(username),
        };
        self.connections.insert(id, client);
        Ok(summary)
    }

    pub fn disconnect(&mut self, id: &str) -> FreeIpaResult<()> {
        self.connections
            .remove(id)
            .map(|_| ())
            .ok_or_else(|| FreeIpaError::not_connected(format!("No connection '{id}'")))
    }

    pub fn list_connections(&self) -> Vec<FreeIpaConnectionSummary> {
        self.connections
            .values()
            .map(|c| FreeIpaConnectionSummary {
                server_url: c.config.server_url.clone(),
                realm: c.config.realm.clone().unwrap_or_else(|| "UNKNOWN".into()),
                authenticated_user: Some(c.config.username.clone()),
            })
            .collect()
    }

    fn client(&self, id: &str) -> FreeIpaResult<&FreeIpaClient> {
        self.connections
            .get(id)
            .ok_or_else(|| FreeIpaError::not_connected(format!("No connection '{id}'")))
    }

    // ── Dashboard ────────────────────────────────────────────────

    pub async fn get_dashboard(&self, id: &str) -> FreeIpaResult<FreeIpaDashboard> {
        let c = self.client(id)?;
        let users = UserManager::list_users(c).await.unwrap_or_default();
        let active = users.iter().filter(|u| u.nsaccountlock != Some(true)).count() as u64;
        let disabled = users.iter().filter(|u| u.nsaccountlock == Some(true)).count() as u64;
        let groups = GroupManager::list_groups(c).await.unwrap_or_default();
        let hosts = HostManager::list_hosts(c).await.unwrap_or_default();
        let services = ServiceManager::list_services(c).await.unwrap_or_default();
        let dns_zones = DnsManager::list_zones(c).await.unwrap_or_default();
        let sudo_rules = SudoManager::list_sudo_rules(c).await.unwrap_or_default();
        let hbac_rules = HbacManager::list_hbac_rules(c).await.unwrap_or_default();
        let roles = RbacManager::list_roles(c).await.unwrap_or_default();
        let trusts = TrustManager::list_trusts(c).await.unwrap_or_default();
        let certs = CertManager::list_certificates(c).await.unwrap_or_default();
        let expired = certs.iter().filter(|cert| cert.revoked == Some(true)).count() as u64;

        Ok(FreeIpaDashboard {
            total_users: users.len() as u64,
            active_users: active,
            disabled_users: disabled,
            total_groups: groups.len() as u64,
            total_hosts: hosts.len() as u64,
            total_services: services.len() as u64,
            total_dns_zones: dns_zones.len() as u64,
            total_sudo_rules: sudo_rules.len() as u64,
            total_hbac_rules: hbac_rules.len() as u64,
            total_roles: roles.len() as u64,
            total_trusts: trusts.len() as u64,
            total_certificates: certs.len() as u64,
            expired_certificates: expired,
        })
    }

    // ── Users ────────────────────────────────────────────────────

    pub async fn list_users(&self, id: &str) -> FreeIpaResult<Vec<IpaUser>> {
        UserManager::list_users(self.client(id)?).await
    }

    pub async fn get_user(&self, id: &str, uid: &str) -> FreeIpaResult<IpaUser> {
        UserManager::get_user(self.client(id)?, uid).await
    }

    pub async fn create_user(&self, id: &str, req: &CreateUserRequest) -> FreeIpaResult<IpaUser> {
        UserManager::create_user(self.client(id)?, req).await
    }

    pub async fn update_user(
        &self,
        id: &str,
        uid: &str,
        req: &ModifyUserRequest,
    ) -> FreeIpaResult<IpaUser> {
        UserManager::modify_user(self.client(id)?, uid, req).await
    }

    pub async fn delete_user(&self, id: &str, uid: &str) -> FreeIpaResult<()> {
        UserManager::delete_user(self.client(id)?, uid).await
    }

    pub async fn enable_user(&self, id: &str, uid: &str) -> FreeIpaResult<()> {
        UserManager::enable_user(self.client(id)?, uid).await
    }

    pub async fn disable_user(&self, id: &str, uid: &str) -> FreeIpaResult<()> {
        UserManager::disable_user(self.client(id)?, uid).await
    }

    // ── Groups ───────────────────────────────────────────────────

    pub async fn list_groups(&self, id: &str) -> FreeIpaResult<Vec<IpaGroup>> {
        GroupManager::list_groups(self.client(id)?).await
    }

    pub async fn get_group(&self, id: &str, cn: &str) -> FreeIpaResult<IpaGroup> {
        GroupManager::get_group(self.client(id)?, cn).await
    }

    pub async fn create_group(
        &self,
        id: &str,
        req: &CreateGroupRequest,
    ) -> FreeIpaResult<IpaGroup> {
        GroupManager::create_group(self.client(id)?, req).await
    }

    pub async fn delete_group(&self, id: &str, cn: &str) -> FreeIpaResult<()> {
        GroupManager::delete_group(self.client(id)?, cn).await
    }

    pub async fn add_group_member(
        &self,
        id: &str,
        cn: &str,
        user: &str,
    ) -> FreeIpaResult<MemberResult> {
        GroupManager::add_member(self.client(id)?, cn, user).await
    }

    pub async fn remove_group_member(
        &self,
        id: &str,
        cn: &str,
        user: &str,
    ) -> FreeIpaResult<MemberResult> {
        GroupManager::remove_member(self.client(id)?, cn, user).await
    }

    // ── Hosts ────────────────────────────────────────────────────

    pub async fn list_hosts(&self, id: &str) -> FreeIpaResult<Vec<IpaHost>> {
        HostManager::list_hosts(self.client(id)?).await
    }

    pub async fn get_host(&self, id: &str, fqdn: &str) -> FreeIpaResult<IpaHost> {
        HostManager::get_host(self.client(id)?, fqdn).await
    }

    pub async fn create_host(
        &self,
        id: &str,
        req: &CreateHostRequest,
    ) -> FreeIpaResult<IpaHost> {
        HostManager::create_host(self.client(id)?, req).await
    }

    pub async fn delete_host(&self, id: &str, fqdn: &str) -> FreeIpaResult<()> {
        HostManager::delete_host(self.client(id)?, fqdn).await
    }

    // ── Services ─────────────────────────────────────────────────

    pub async fn list_services(&self, id: &str) -> FreeIpaResult<Vec<IpaService>> {
        ServiceManager::list_services(self.client(id)?).await
    }

    pub async fn get_service(&self, id: &str, principal: &str) -> FreeIpaResult<IpaService> {
        ServiceManager::get_service(self.client(id)?, principal).await
    }

    pub async fn create_service(
        &self,
        id: &str,
        req: &CreateServiceRequest,
    ) -> FreeIpaResult<IpaService> {
        ServiceManager::create_service(self.client(id)?, req).await
    }

    pub async fn delete_service(&self, id: &str, principal: &str) -> FreeIpaResult<()> {
        ServiceManager::delete_service(self.client(id)?, principal).await
    }

    // ── DNS ──────────────────────────────────────────────────────

    pub async fn list_dns_zones(&self, id: &str) -> FreeIpaResult<Vec<DnsZone>> {
        DnsManager::list_zones(self.client(id)?).await
    }

    pub async fn get_dns_zone(&self, id: &str, zone: &str) -> FreeIpaResult<DnsZone> {
        DnsManager::get_zone(self.client(id)?, zone).await
    }

    pub async fn create_dns_zone(
        &self,
        id: &str,
        req: &CreateDnsZoneRequest,
    ) -> FreeIpaResult<DnsZone> {
        DnsManager::create_zone(self.client(id)?, req).await
    }

    pub async fn delete_dns_zone(&self, id: &str, zone: &str) -> FreeIpaResult<()> {
        DnsManager::delete_zone(self.client(id)?, zone).await
    }

    pub async fn list_dns_records(
        &self,
        id: &str,
        zone: &str,
    ) -> FreeIpaResult<Vec<DnsRecord>> {
        DnsManager::list_records(self.client(id)?, zone).await
    }

    pub async fn add_dns_record(
        &self,
        id: &str,
        req: &AddDnsRecordRequest,
    ) -> FreeIpaResult<DnsRecord> {
        DnsManager::add_record(self.client(id)?, req).await
    }

    pub async fn delete_dns_record(
        &self,
        id: &str,
        zone: &str,
        name: &str,
        record_type: &str,
        record_data: &str,
    ) -> FreeIpaResult<()> {
        DnsManager::delete_record(self.client(id)?, zone, name, record_type, record_data).await
    }

    // ── RBAC ─────────────────────────────────────────────────────

    pub async fn list_roles(&self, id: &str) -> FreeIpaResult<Vec<IpaRole>> {
        RbacManager::list_roles(self.client(id)?).await
    }

    pub async fn get_role(&self, id: &str, cn: &str) -> FreeIpaResult<IpaRole> {
        RbacManager::get_role(self.client(id)?, cn).await
    }

    pub async fn list_privileges(&self, id: &str) -> FreeIpaResult<Vec<IpaPrivilege>> {
        RbacManager::list_privileges(self.client(id)?).await
    }

    pub async fn list_permissions(&self, id: &str) -> FreeIpaResult<Vec<IpaPermission>> {
        RbacManager::list_permissions(self.client(id)?).await
    }

    // ── Certificates ─────────────────────────────────────────────

    pub async fn list_certificates(&self, id: &str) -> FreeIpaResult<Vec<IpaCertificate>> {
        CertManager::list_certificates(self.client(id)?).await
    }

    pub async fn get_certificate(&self, id: &str, serial: u64) -> FreeIpaResult<IpaCertificate> {
        CertManager::get_certificate(self.client(id)?, serial).await
    }

    pub async fn request_certificate(
        &self,
        id: &str,
        req: &CertRequestParams,
    ) -> FreeIpaResult<IpaCertificate> {
        CertManager::request_certificate(self.client(id)?, req).await
    }

    pub async fn revoke_certificate(
        &self,
        id: &str,
        serial: u64,
        reason: u32,
    ) -> FreeIpaResult<()> {
        CertManager::revoke_certificate(self.client(id)?, serial, reason).await
    }

    // ── Sudo ─────────────────────────────────────────────────────

    pub async fn list_sudo_rules(&self, id: &str) -> FreeIpaResult<Vec<IpaSudoRule>> {
        SudoManager::list_sudo_rules(self.client(id)?).await
    }

    pub async fn get_sudo_rule(&self, id: &str, cn: &str) -> FreeIpaResult<IpaSudoRule> {
        SudoManager::get_sudo_rule(self.client(id)?, cn).await
    }

    pub async fn create_sudo_rule(
        &self,
        id: &str,
        req: &CreateSudoRuleRequest,
    ) -> FreeIpaResult<IpaSudoRule> {
        SudoManager::create_sudo_rule(self.client(id)?, req).await
    }

    pub async fn delete_sudo_rule(&self, id: &str, cn: &str) -> FreeIpaResult<()> {
        SudoManager::delete_sudo_rule(self.client(id)?, cn).await
    }

    // ── HBAC ─────────────────────────────────────────────────────

    pub async fn list_hbac_rules(&self, id: &str) -> FreeIpaResult<Vec<IpaHbacRule>> {
        HbacManager::list_hbac_rules(self.client(id)?).await
    }

    pub async fn get_hbac_rule(&self, id: &str, cn: &str) -> FreeIpaResult<IpaHbacRule> {
        HbacManager::get_hbac_rule(self.client(id)?, cn).await
    }

    pub async fn create_hbac_rule(
        &self,
        id: &str,
        req: &CreateHbacRuleRequest,
    ) -> FreeIpaResult<IpaHbacRule> {
        HbacManager::create_hbac_rule(self.client(id)?, req).await
    }

    pub async fn delete_hbac_rule(&self, id: &str, cn: &str) -> FreeIpaResult<()> {
        HbacManager::delete_hbac_rule(self.client(id)?, cn).await
    }

    // ── Trusts ───────────────────────────────────────────────────

    pub async fn list_trusts(&self, id: &str) -> FreeIpaResult<Vec<IpaTrust>> {
        TrustManager::list_trusts(self.client(id)?).await
    }

    pub async fn get_trust(&self, id: &str, realm: &str) -> FreeIpaResult<IpaTrust> {
        TrustManager::get_trust(self.client(id)?, realm).await
    }

    pub async fn create_trust(
        &self,
        id: &str,
        req: &CreateTrustRequest,
    ) -> FreeIpaResult<IpaTrust> {
        TrustManager::create_trust(self.client(id)?, req).await
    }

    pub async fn delete_trust(&self, id: &str, realm: &str) -> FreeIpaResult<()> {
        TrustManager::delete_trust(self.client(id)?, realm).await
    }
}
