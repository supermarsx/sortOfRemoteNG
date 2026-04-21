// ── sorng-freeipa/src/commands.rs ─────────────────────────────────────────────
// Tauri commands – thin wrappers around `FreeIpaServiceHolder`.

use super::service::FreeIpaServiceState;
use super::types::*;
use tauri::State;

type CmdResult<T> = Result<T, String>;

fn map_err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

// ── Connection ────────────────────────────────────────────────────

#[tauri::command]
pub async fn freeipa_connect(
    state: State<'_, FreeIpaServiceState>,
    id: String,
    config: FreeIpaConnectionConfig,
) -> CmdResult<FreeIpaConnectionSummary> {
    state
        .lock()
        .await
        .connect(id, config)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn freeipa_disconnect(
    state: State<'_, FreeIpaServiceState>,
    id: String,
) -> CmdResult<()> {
    state.lock().await.disconnect(&id).map_err(map_err)
}

#[tauri::command]
pub async fn freeipa_list_connections(
    state: State<'_, FreeIpaServiceState>,
) -> CmdResult<Vec<FreeIpaConnectionSummary>> {
    Ok(state.lock().await.list_connections())
}

#[tauri::command]
pub async fn freeipa_get_dashboard(
    state: State<'_, FreeIpaServiceState>,
    id: String,
) -> CmdResult<FreeIpaDashboard> {
    state.lock().await.get_dashboard(&id).await.map_err(map_err)
}

// ── Users ─────────────────────────────────────────────────────────

#[tauri::command]
pub async fn freeipa_list_users(
    state: State<'_, FreeIpaServiceState>,
    id: String,
) -> CmdResult<Vec<IpaUser>> {
    state.lock().await.list_users(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn freeipa_get_user(
    state: State<'_, FreeIpaServiceState>,
    id: String,
    uid: String,
) -> CmdResult<IpaUser> {
    state
        .lock()
        .await
        .get_user(&id, &uid)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn freeipa_create_user(
    state: State<'_, FreeIpaServiceState>,
    id: String,
    request: CreateUserRequest,
) -> CmdResult<IpaUser> {
    state
        .lock()
        .await
        .create_user(&id, &request)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn freeipa_update_user(
    state: State<'_, FreeIpaServiceState>,
    id: String,
    uid: String,
    request: ModifyUserRequest,
) -> CmdResult<IpaUser> {
    state
        .lock()
        .await
        .update_user(&id, &uid, &request)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn freeipa_delete_user(
    state: State<'_, FreeIpaServiceState>,
    id: String,
    uid: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .delete_user(&id, &uid)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn freeipa_enable_user(
    state: State<'_, FreeIpaServiceState>,
    id: String,
    uid: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .enable_user(&id, &uid)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn freeipa_disable_user(
    state: State<'_, FreeIpaServiceState>,
    id: String,
    uid: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .disable_user(&id, &uid)
        .await
        .map_err(map_err)
}

// ── Groups ────────────────────────────────────────────────────────

#[tauri::command]
pub async fn freeipa_list_groups(
    state: State<'_, FreeIpaServiceState>,
    id: String,
) -> CmdResult<Vec<IpaGroup>> {
    state.lock().await.list_groups(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn freeipa_get_group(
    state: State<'_, FreeIpaServiceState>,
    id: String,
    cn: String,
) -> CmdResult<IpaGroup> {
    state
        .lock()
        .await
        .get_group(&id, &cn)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn freeipa_create_group(
    state: State<'_, FreeIpaServiceState>,
    id: String,
    request: CreateGroupRequest,
) -> CmdResult<IpaGroup> {
    state
        .lock()
        .await
        .create_group(&id, &request)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn freeipa_delete_group(
    state: State<'_, FreeIpaServiceState>,
    id: String,
    cn: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .delete_group(&id, &cn)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn freeipa_add_group_member(
    state: State<'_, FreeIpaServiceState>,
    id: String,
    cn: String,
    user: String,
) -> CmdResult<MemberResult> {
    state
        .lock()
        .await
        .add_group_member(&id, &cn, &user)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn freeipa_remove_group_member(
    state: State<'_, FreeIpaServiceState>,
    id: String,
    cn: String,
    user: String,
) -> CmdResult<MemberResult> {
    state
        .lock()
        .await
        .remove_group_member(&id, &cn, &user)
        .await
        .map_err(map_err)
}

// ── Hosts ─────────────────────────────────────────────────────────

#[tauri::command]
pub async fn freeipa_list_hosts(
    state: State<'_, FreeIpaServiceState>,
    id: String,
) -> CmdResult<Vec<IpaHost>> {
    state.lock().await.list_hosts(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn freeipa_get_host(
    state: State<'_, FreeIpaServiceState>,
    id: String,
    fqdn: String,
) -> CmdResult<IpaHost> {
    state
        .lock()
        .await
        .get_host(&id, &fqdn)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn freeipa_create_host(
    state: State<'_, FreeIpaServiceState>,
    id: String,
    request: CreateHostRequest,
) -> CmdResult<IpaHost> {
    state
        .lock()
        .await
        .create_host(&id, &request)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn freeipa_delete_host(
    state: State<'_, FreeIpaServiceState>,
    id: String,
    fqdn: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .delete_host(&id, &fqdn)
        .await
        .map_err(map_err)
}

// ── Services ──────────────────────────────────────────────────────

#[tauri::command]
pub async fn freeipa_list_services(
    state: State<'_, FreeIpaServiceState>,
    id: String,
) -> CmdResult<Vec<IpaService>> {
    state.lock().await.list_services(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn freeipa_get_service(
    state: State<'_, FreeIpaServiceState>,
    id: String,
    principal: String,
) -> CmdResult<IpaService> {
    state
        .lock()
        .await
        .get_service(&id, &principal)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn freeipa_create_service(
    state: State<'_, FreeIpaServiceState>,
    id: String,
    request: CreateServiceRequest,
) -> CmdResult<IpaService> {
    state
        .lock()
        .await
        .create_service(&id, &request)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn freeipa_delete_service(
    state: State<'_, FreeIpaServiceState>,
    id: String,
    principal: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .delete_service(&id, &principal)
        .await
        .map_err(map_err)
}

// ── DNS ───────────────────────────────────────────────────────────

#[tauri::command]
pub async fn freeipa_list_dns_zones(
    state: State<'_, FreeIpaServiceState>,
    id: String,
) -> CmdResult<Vec<DnsZone>> {
    state
        .lock()
        .await
        .list_dns_zones(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn freeipa_get_dns_zone(
    state: State<'_, FreeIpaServiceState>,
    id: String,
    zone: String,
) -> CmdResult<DnsZone> {
    state
        .lock()
        .await
        .get_dns_zone(&id, &zone)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn freeipa_create_dns_zone(
    state: State<'_, FreeIpaServiceState>,
    id: String,
    request: CreateDnsZoneRequest,
) -> CmdResult<DnsZone> {
    state
        .lock()
        .await
        .create_dns_zone(&id, &request)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn freeipa_delete_dns_zone(
    state: State<'_, FreeIpaServiceState>,
    id: String,
    zone: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .delete_dns_zone(&id, &zone)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn freeipa_list_dns_records(
    state: State<'_, FreeIpaServiceState>,
    id: String,
    zone: String,
) -> CmdResult<Vec<DnsRecord>> {
    state
        .lock()
        .await
        .list_dns_records(&id, &zone)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn freeipa_add_dns_record(
    state: State<'_, FreeIpaServiceState>,
    id: String,
    request: AddDnsRecordRequest,
) -> CmdResult<DnsRecord> {
    state
        .lock()
        .await
        .add_dns_record(&id, &request)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn freeipa_delete_dns_record(
    state: State<'_, FreeIpaServiceState>,
    id: String,
    zone: String,
    name: String,
    record_type: String,
    record_data: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .delete_dns_record(&id, &zone, &name, &record_type, &record_data)
        .await
        .map_err(map_err)
}

// ── RBAC ──────────────────────────────────────────────────────────

#[tauri::command]
pub async fn freeipa_list_roles(
    state: State<'_, FreeIpaServiceState>,
    id: String,
) -> CmdResult<Vec<IpaRole>> {
    state.lock().await.list_roles(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn freeipa_list_privileges(
    state: State<'_, FreeIpaServiceState>,
    id: String,
) -> CmdResult<Vec<IpaPrivilege>> {
    state
        .lock()
        .await
        .list_privileges(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn freeipa_list_permissions(
    state: State<'_, FreeIpaServiceState>,
    id: String,
) -> CmdResult<Vec<IpaPermission>> {
    state
        .lock()
        .await
        .list_permissions(&id)
        .await
        .map_err(map_err)
}

// ── Certificates ──────────────────────────────────────────────────

#[tauri::command]
pub async fn freeipa_list_certificates(
    state: State<'_, FreeIpaServiceState>,
    id: String,
) -> CmdResult<Vec<IpaCertificate>> {
    state
        .lock()
        .await
        .list_certificates(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn freeipa_request_certificate(
    state: State<'_, FreeIpaServiceState>,
    id: String,
    request: CertRequestParams,
) -> CmdResult<IpaCertificate> {
    state
        .lock()
        .await
        .request_certificate(&id, &request)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn freeipa_revoke_certificate(
    state: State<'_, FreeIpaServiceState>,
    id: String,
    serial: u64,
    reason: u32,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .revoke_certificate(&id, serial, reason)
        .await
        .map_err(map_err)
}

// ── Sudo ──────────────────────────────────────────────────────────

#[tauri::command]
pub async fn freeipa_list_sudo_rules(
    state: State<'_, FreeIpaServiceState>,
    id: String,
) -> CmdResult<Vec<IpaSudoRule>> {
    state
        .lock()
        .await
        .list_sudo_rules(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn freeipa_create_sudo_rule(
    state: State<'_, FreeIpaServiceState>,
    id: String,
    request: CreateSudoRuleRequest,
) -> CmdResult<IpaSudoRule> {
    state
        .lock()
        .await
        .create_sudo_rule(&id, &request)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn freeipa_delete_sudo_rule(
    state: State<'_, FreeIpaServiceState>,
    id: String,
    cn: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .delete_sudo_rule(&id, &cn)
        .await
        .map_err(map_err)
}

// ── HBAC ──────────────────────────────────────────────────────────

#[tauri::command]
pub async fn freeipa_list_hbac_rules(
    state: State<'_, FreeIpaServiceState>,
    id: String,
) -> CmdResult<Vec<IpaHbacRule>> {
    state
        .lock()
        .await
        .list_hbac_rules(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn freeipa_create_hbac_rule(
    state: State<'_, FreeIpaServiceState>,
    id: String,
    request: CreateHbacRuleRequest,
) -> CmdResult<IpaHbacRule> {
    state
        .lock()
        .await
        .create_hbac_rule(&id, &request)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn freeipa_delete_hbac_rule(
    state: State<'_, FreeIpaServiceState>,
    id: String,
    cn: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .delete_hbac_rule(&id, &cn)
        .await
        .map_err(map_err)
}

// ── Trusts ────────────────────────────────────────────────────────

#[tauri::command]
pub async fn freeipa_list_trusts(
    state: State<'_, FreeIpaServiceState>,
    id: String,
) -> CmdResult<Vec<IpaTrust>> {
    state.lock().await.list_trusts(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn freeipa_create_trust(
    state: State<'_, FreeIpaServiceState>,
    id: String,
    request: CreateTrustRequest,
) -> CmdResult<IpaTrust> {
    state
        .lock()
        .await
        .create_trust(&id, &request)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn freeipa_delete_trust(
    state: State<'_, FreeIpaServiceState>,
    id: String,
    realm: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .delete_trust(&id, &realm)
        .await
        .map_err(map_err)
}
