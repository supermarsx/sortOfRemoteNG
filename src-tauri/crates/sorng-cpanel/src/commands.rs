// ── sorng-cpanel/src/commands.rs ─────────────────────────────────────────────
//! Tauri commands – thin wrappers around `CpanelService`.

use crate::service::CpanelServiceState;
use crate::types::*;
use tauri::State;

type CmdResult<T> = Result<T, String>;

fn map_err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

// ── Connection ────────────────────────────────────────────────────

#[tauri::command]
pub async fn cpanel_connect(
    state: State<'_, CpanelServiceState>,
    id: String,
    config: CpanelConnectionConfig,
) -> CmdResult<CpanelConnectionSummary> {
    state
        .lock()
        .await
        .connect(id, config)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn cpanel_disconnect(state: State<'_, CpanelServiceState>, id: String) -> CmdResult<()> {
    state.lock().await.disconnect(&id).map_err(map_err)
}

#[tauri::command]
pub async fn cpanel_list_connections(
    state: State<'_, CpanelServiceState>,
) -> CmdResult<Vec<String>> {
    Ok(state.lock().await.list_connections())
}

#[tauri::command]
pub async fn cpanel_ping(
    state: State<'_, CpanelServiceState>,
    id: String,
) -> CmdResult<CpanelConnectionSummary> {
    state.lock().await.ping(&id).await.map_err(map_err)
}

// ── Accounts ──────────────────────────────────────────────────────

#[tauri::command]
pub async fn cpanel_list_accounts(
    state: State<'_, CpanelServiceState>,
    id: String,
) -> CmdResult<Vec<CpanelAccount>> {
    state.lock().await.list_accounts(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn cpanel_get_account(
    state: State<'_, CpanelServiceState>,
    id: String,
    user: String,
) -> CmdResult<CpanelAccount> {
    state
        .lock()
        .await
        .get_account(&id, &user)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn cpanel_create_account(
    state: State<'_, CpanelServiceState>,
    id: String,
    req: CreateAccountRequest,
) -> CmdResult<String> {
    state
        .lock()
        .await
        .create_account(&id, req)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn cpanel_suspend_account(
    state: State<'_, CpanelServiceState>,
    id: String,
    user: String,
    reason: Option<String>,
) -> CmdResult<String> {
    state
        .lock()
        .await
        .suspend_account(&id, &user, reason.as_deref())
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn cpanel_unsuspend_account(
    state: State<'_, CpanelServiceState>,
    id: String,
    user: String,
) -> CmdResult<String> {
    state
        .lock()
        .await
        .unsuspend_account(&id, &user)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn cpanel_terminate_account(
    state: State<'_, CpanelServiceState>,
    id: String,
    user: String,
    keep_dns: bool,
) -> CmdResult<String> {
    state
        .lock()
        .await
        .terminate_account(&id, &user, keep_dns)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn cpanel_modify_account(
    state: State<'_, CpanelServiceState>,
    id: String,
    req: ModifyAccountRequest,
) -> CmdResult<String> {
    state
        .lock()
        .await
        .modify_account(&id, req)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn cpanel_change_account_password(
    state: State<'_, CpanelServiceState>,
    id: String,
    user: String,
    password: String,
) -> CmdResult<String> {
    state
        .lock()
        .await
        .change_account_password(&id, &user, &password)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn cpanel_list_packages(
    state: State<'_, CpanelServiceState>,
    id: String,
) -> CmdResult<Vec<HostingPackage>> {
    state.lock().await.list_packages(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn cpanel_get_account_summary(
    state: State<'_, CpanelServiceState>,
    id: String,
    user: String,
) -> CmdResult<AccountSummary> {
    state
        .lock()
        .await
        .get_account_summary(&id, &user)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn cpanel_list_suspended_accounts(
    state: State<'_, CpanelServiceState>,
    id: String,
) -> CmdResult<Vec<CpanelAccount>> {
    state
        .lock()
        .await
        .list_suspended_accounts(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn cpanel_get_server_info(
    state: State<'_, CpanelServiceState>,
    id: String,
) -> CmdResult<CpanelServerInfo> {
    state
        .lock()
        .await
        .get_server_info(&id)
        .await
        .map_err(map_err)
}

// ── Domains ───────────────────────────────────────────────────────

#[tauri::command]
pub async fn cpanel_list_domains(
    state: State<'_, CpanelServiceState>,
    id: String,
    user: String,
) -> CmdResult<Vec<DomainInfo>> {
    state
        .lock()
        .await
        .list_domains(&id, &user)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn cpanel_list_all_domains(
    state: State<'_, CpanelServiceState>,
    id: String,
) -> CmdResult<Vec<DomainInfo>> {
    state
        .lock()
        .await
        .list_all_domains(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn cpanel_create_addon_domain(
    state: State<'_, CpanelServiceState>,
    id: String,
    user: String,
    req: CreateAddonDomainRequest,
) -> CmdResult<String> {
    state
        .lock()
        .await
        .create_addon_domain(&id, &user, req)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn cpanel_remove_addon_domain(
    state: State<'_, CpanelServiceState>,
    id: String,
    user: String,
    domain: String,
    subdomain: String,
) -> CmdResult<String> {
    state
        .lock()
        .await
        .remove_addon_domain(&id, &user, &domain, &subdomain)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn cpanel_create_subdomain(
    state: State<'_, CpanelServiceState>,
    id: String,
    user: String,
    req: CreateSubdomainRequest,
) -> CmdResult<String> {
    state
        .lock()
        .await
        .create_subdomain(&id, &user, req)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn cpanel_remove_subdomain(
    state: State<'_, CpanelServiceState>,
    id: String,
    user: String,
    domain: String,
) -> CmdResult<String> {
    state
        .lock()
        .await
        .remove_subdomain(&id, &user, &domain)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn cpanel_park_domain(
    state: State<'_, CpanelServiceState>,
    id: String,
    user: String,
    domain: String,
) -> CmdResult<String> {
    state
        .lock()
        .await
        .park_domain(&id, &user, &domain)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn cpanel_unpark_domain(
    state: State<'_, CpanelServiceState>,
    id: String,
    user: String,
    domain: String,
) -> CmdResult<String> {
    state
        .lock()
        .await
        .unpark_domain(&id, &user, &domain)
        .await
        .map_err(map_err)
}

// ── Email ─────────────────────────────────────────────────────────

#[tauri::command]
pub async fn cpanel_list_email_accounts(
    state: State<'_, CpanelServiceState>,
    id: String,
    user: String,
) -> CmdResult<Vec<EmailAccount>> {
    state
        .lock()
        .await
        .list_email_accounts(&id, &user)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn cpanel_create_email_account(
    state: State<'_, CpanelServiceState>,
    id: String,
    user: String,
    req: CreateEmailRequest,
) -> CmdResult<String> {
    state
        .lock()
        .await
        .create_email_account(&id, &user, req)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn cpanel_delete_email_account(
    state: State<'_, CpanelServiceState>,
    id: String,
    user: String,
    email: String,
) -> CmdResult<String> {
    state
        .lock()
        .await
        .delete_email_account(&id, &user, &email)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn cpanel_change_email_password(
    state: State<'_, CpanelServiceState>,
    id: String,
    user: String,
    email: String,
    password: String,
) -> CmdResult<String> {
    state
        .lock()
        .await
        .change_email_password(&id, &user, &email, &password)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn cpanel_set_email_quota(
    state: State<'_, CpanelServiceState>,
    id: String,
    user: String,
    email: String,
    quota: u64,
) -> CmdResult<String> {
    state
        .lock()
        .await
        .set_email_quota(&id, &user, &email, quota)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn cpanel_list_forwarders(
    state: State<'_, CpanelServiceState>,
    id: String,
    user: String,
    domain: String,
) -> CmdResult<Vec<EmailForwarder>> {
    state
        .lock()
        .await
        .list_forwarders(&id, &user, &domain)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn cpanel_add_forwarder(
    state: State<'_, CpanelServiceState>,
    id: String,
    user: String,
    domain: String,
    email: String,
    fwdopt: String,
    fwdemail: String,
) -> CmdResult<String> {
    state
        .lock()
        .await
        .add_forwarder(&id, &user, &domain, &email, &fwdopt, &fwdemail)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn cpanel_delete_forwarder(
    state: State<'_, CpanelServiceState>,
    id: String,
    user: String,
    address: String,
    dest: String,
) -> CmdResult<String> {
    state
        .lock()
        .await
        .delete_forwarder(&id, &user, &address, &dest)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn cpanel_list_autoresponders(
    state: State<'_, CpanelServiceState>,
    id: String,
    user: String,
    domain: String,
) -> CmdResult<Vec<EmailAutoresponder>> {
    state
        .lock()
        .await
        .list_autoresponders(&id, &user, &domain)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn cpanel_list_mailing_lists(
    state: State<'_, CpanelServiceState>,
    id: String,
    user: String,
    domain: String,
) -> CmdResult<Vec<MailingList>> {
    state
        .lock()
        .await
        .list_mailing_lists(&id, &user, &domain)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn cpanel_get_spam_settings(
    state: State<'_, CpanelServiceState>,
    id: String,
    user: String,
) -> CmdResult<SpamFilterSettings> {
    state
        .lock()
        .await
        .get_spam_settings(&id, &user)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn cpanel_list_mx_records(
    state: State<'_, CpanelServiceState>,
    id: String,
    user: String,
    domain: String,
) -> CmdResult<Vec<MxRecord>> {
    state
        .lock()
        .await
        .list_mx_records(&id, &user, &domain)
        .await
        .map_err(map_err)
}

// ── Databases ─────────────────────────────────────────────────────

#[tauri::command]
pub async fn cpanel_list_databases(
    state: State<'_, CpanelServiceState>,
    id: String,
    user: String,
) -> CmdResult<Vec<CpanelDatabase>> {
    state
        .lock()
        .await
        .list_databases(&id, &user)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn cpanel_create_database(
    state: State<'_, CpanelServiceState>,
    id: String,
    user: String,
    name: String,
) -> CmdResult<String> {
    state
        .lock()
        .await
        .create_database(&id, &user, &name)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn cpanel_delete_database(
    state: State<'_, CpanelServiceState>,
    id: String,
    user: String,
    name: String,
) -> CmdResult<String> {
    state
        .lock()
        .await
        .delete_database(&id, &user, &name)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn cpanel_list_database_users(
    state: State<'_, CpanelServiceState>,
    id: String,
    user: String,
) -> CmdResult<Vec<DatabaseUser>> {
    state
        .lock()
        .await
        .list_database_users(&id, &user)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn cpanel_create_database_user(
    state: State<'_, CpanelServiceState>,
    id: String,
    user: String,
    db_user: String,
    password: String,
) -> CmdResult<String> {
    state
        .lock()
        .await
        .create_database_user(&id, &user, &db_user, &password)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn cpanel_delete_database_user(
    state: State<'_, CpanelServiceState>,
    id: String,
    user: String,
    dbuser: String,
) -> CmdResult<String> {
    state
        .lock()
        .await
        .delete_database_user(&id, &user, &dbuser)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn cpanel_grant_database_privileges(
    state: State<'_, CpanelServiceState>,
    id: String,
    user: String,
    db_user: String,
    db: String,
    privileges: String,
) -> CmdResult<String> {
    state
        .lock()
        .await
        .grant_database_privileges(&id, &user, &db_user, &db, &privileges)
        .await
        .map_err(map_err)
}

// ── DNS ───────────────────────────────────────────────────────────

#[tauri::command]
pub async fn cpanel_list_dns_zones(
    state: State<'_, CpanelServiceState>,
    id: String,
) -> CmdResult<Vec<String>> {
    state
        .lock()
        .await
        .list_dns_zones(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn cpanel_get_dns_zone(
    state: State<'_, CpanelServiceState>,
    id: String,
    domain: String,
) -> CmdResult<DnsZone> {
    state
        .lock()
        .await
        .get_dns_zone(&id, &domain)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn cpanel_add_dns_record(
    state: State<'_, CpanelServiceState>,
    id: String,
    req: AddDnsRecordRequest,
) -> CmdResult<String> {
    state
        .lock()
        .await
        .add_dns_record(&id, req)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn cpanel_edit_dns_record(
    state: State<'_, CpanelServiceState>,
    id: String,
    req: EditDnsRecordRequest,
) -> CmdResult<String> {
    state
        .lock()
        .await
        .edit_dns_record(&id, req)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn cpanel_remove_dns_record(
    state: State<'_, CpanelServiceState>,
    id: String,
    zone: String,
    line: u32,
) -> CmdResult<String> {
    state
        .lock()
        .await
        .remove_dns_record(&id, &zone, line)
        .await
        .map_err(map_err)
}

// ── Files ─────────────────────────────────────────────────────────

#[tauri::command]
pub async fn cpanel_list_files(
    state: State<'_, CpanelServiceState>,
    id: String,
    user: String,
    path: String,
) -> CmdResult<Vec<FileItem>> {
    state
        .lock()
        .await
        .list_files(&id, &user, &path)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn cpanel_create_directory(
    state: State<'_, CpanelServiceState>,
    id: String,
    user: String,
    path: String,
    name: String,
) -> CmdResult<String> {
    state
        .lock()
        .await
        .create_directory(&id, &user, &path, &name)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn cpanel_delete_file(
    state: State<'_, CpanelServiceState>,
    id: String,
    user: String,
    path: String,
) -> CmdResult<String> {
    state
        .lock()
        .await
        .delete_file(&id, &user, &path)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn cpanel_get_disk_usage(
    state: State<'_, CpanelServiceState>,
    id: String,
    user: String,
) -> CmdResult<DiskUsageInfo> {
    state
        .lock()
        .await
        .get_disk_usage(&id, &user)
        .await
        .map_err(map_err)
}

// ── SSL ───────────────────────────────────────────────────────────

#[tauri::command]
pub async fn cpanel_list_ssl_certs(
    state: State<'_, CpanelServiceState>,
    id: String,
    user: String,
) -> CmdResult<Vec<SslCertificate>> {
    state
        .lock()
        .await
        .list_ssl_certs(&id, &user)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn cpanel_get_ssl_status(
    state: State<'_, CpanelServiceState>,
    id: String,
    user: String,
) -> CmdResult<Vec<SslStatus>> {
    state
        .lock()
        .await
        .get_ssl_status(&id, &user)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn cpanel_install_ssl(
    state: State<'_, CpanelServiceState>,
    id: String,
    req: InstallSslRequest,
) -> CmdResult<String> {
    state
        .lock()
        .await
        .install_ssl(&id, req)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn cpanel_generate_csr(
    state: State<'_, CpanelServiceState>,
    id: String,
    user: String,
    req: GenerateCsrRequest,
) -> CmdResult<CsrResult> {
    state
        .lock()
        .await
        .generate_csr(&id, &user, req)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn cpanel_autossl_check(
    state: State<'_, CpanelServiceState>,
    id: String,
    user: String,
) -> CmdResult<serde_json::Value> {
    state
        .lock()
        .await
        .autossl_check(&id, &user)
        .await
        .map_err(map_err)
}

// ── Backups ───────────────────────────────────────────────────────

#[tauri::command]
pub async fn cpanel_list_backups(
    state: State<'_, CpanelServiceState>,
    id: String,
    user: String,
) -> CmdResult<Vec<BackupInfo>> {
    state
        .lock()
        .await
        .list_backups(&id, &user)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn cpanel_create_full_backup(
    state: State<'_, CpanelServiceState>,
    id: String,
    user: String,
    dest: Option<String>,
    email: Option<String>,
) -> CmdResult<String> {
    state
        .lock()
        .await
        .create_full_backup(&id, &user, dest.as_deref(), email.as_deref())
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn cpanel_restore_file(
    state: State<'_, CpanelServiceState>,
    id: String,
    user: String,
    backup: String,
    path: String,
) -> CmdResult<String> {
    state
        .lock()
        .await
        .restore_file(&id, &user, &backup, &path)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn cpanel_get_backup_config(
    state: State<'_, CpanelServiceState>,
    id: String,
) -> CmdResult<serde_json::Value> {
    state
        .lock()
        .await
        .get_backup_config(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn cpanel_trigger_server_backup(
    state: State<'_, CpanelServiceState>,
    id: String,
) -> CmdResult<String> {
    state
        .lock()
        .await
        .trigger_server_backup(&id)
        .await
        .map_err(map_err)
}

// ── FTP ───────────────────────────────────────────────────────────

#[tauri::command]
pub async fn cpanel_list_ftp_accounts(
    state: State<'_, CpanelServiceState>,
    id: String,
    user: String,
) -> CmdResult<Vec<FtpAccount>> {
    state
        .lock()
        .await
        .list_ftp_accounts(&id, &user)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn cpanel_create_ftp_account(
    state: State<'_, CpanelServiceState>,
    id: String,
    user: String,
    req: CreateFtpRequest,
) -> CmdResult<String> {
    state
        .lock()
        .await
        .create_ftp_account(&id, &user, req)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn cpanel_delete_ftp_account(
    state: State<'_, CpanelServiceState>,
    id: String,
    user: String,
    ftp_user: String,
    destroy: bool,
) -> CmdResult<String> {
    state
        .lock()
        .await
        .delete_ftp_account(&id, &user, &ftp_user, destroy)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn cpanel_list_ftp_sessions(
    state: State<'_, CpanelServiceState>,
    id: String,
) -> CmdResult<Vec<FtpSession>> {
    state
        .lock()
        .await
        .list_ftp_sessions(&id)
        .await
        .map_err(map_err)
}

// ── Cron ──────────────────────────────────────────────────────────

#[tauri::command]
pub async fn cpanel_list_cron_jobs(
    state: State<'_, CpanelServiceState>,
    id: String,
    user: String,
) -> CmdResult<Vec<CronJob>> {
    state
        .lock()
        .await
        .list_cron_jobs(&id, &user)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn cpanel_add_cron_job(
    state: State<'_, CpanelServiceState>,
    id: String,
    user: String,
    req: CreateCronRequest,
) -> CmdResult<String> {
    state
        .lock()
        .await
        .add_cron_job(&id, &user, req)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn cpanel_edit_cron_job(
    state: State<'_, CpanelServiceState>,
    id: String,
    user: String,
    linekey: String,
    req: CreateCronRequest,
) -> CmdResult<String> {
    state
        .lock()
        .await
        .edit_cron_job(&id, &user, &linekey, req)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn cpanel_delete_cron_job(
    state: State<'_, CpanelServiceState>,
    id: String,
    user: String,
    linekey: String,
) -> CmdResult<String> {
    state
        .lock()
        .await
        .delete_cron_job(&id, &user, &linekey)
        .await
        .map_err(map_err)
}

// ── Stats ─────────────────────────────────────────────────────────

#[tauri::command]
pub async fn cpanel_get_bandwidth(
    state: State<'_, CpanelServiceState>,
    id: String,
    user: String,
) -> CmdResult<BandwidthUsage> {
    state
        .lock()
        .await
        .get_bandwidth(&id, &user)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn cpanel_get_resource_usage(
    state: State<'_, CpanelServiceState>,
    id: String,
    user: String,
) -> CmdResult<ResourceUsage> {
    state
        .lock()
        .await
        .get_resource_usage(&id, &user)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn cpanel_get_error_log(
    state: State<'_, CpanelServiceState>,
    id: String,
    user: String,
    lines: u32,
) -> CmdResult<Vec<ErrorLogEntry>> {
    state
        .lock()
        .await
        .get_error_log(&id, &user, lines)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn cpanel_get_server_load(
    state: State<'_, CpanelServiceState>,
    id: String,
) -> CmdResult<ServerLoadStatus> {
    state
        .lock()
        .await
        .get_server_load(&id)
        .await
        .map_err(map_err)
}

// ── PHP ───────────────────────────────────────────────────────────

#[tauri::command]
pub async fn cpanel_list_php_versions(
    state: State<'_, CpanelServiceState>,
    id: String,
) -> CmdResult<Vec<PhpVersion>> {
    state
        .lock()
        .await
        .list_php_versions(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn cpanel_get_domain_php_version(
    state: State<'_, CpanelServiceState>,
    id: String,
    user: String,
    domain: String,
) -> CmdResult<String> {
    state
        .lock()
        .await
        .get_domain_php_version(&id, &user, &domain)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn cpanel_set_domain_php_version(
    state: State<'_, CpanelServiceState>,
    id: String,
    user: String,
    domain: String,
    version: String,
) -> CmdResult<String> {
    state
        .lock()
        .await
        .set_domain_php_version(&id, &user, &domain, &version)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn cpanel_get_php_config(
    state: State<'_, CpanelServiceState>,
    id: String,
    user: String,
    version: String,
) -> CmdResult<PhpConfig> {
    state
        .lock()
        .await
        .get_php_config(&id, &user, &version)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn cpanel_list_php_extensions(
    state: State<'_, CpanelServiceState>,
    id: String,
    user: String,
    version: String,
) -> CmdResult<Vec<PhpExtension>> {
    state
        .lock()
        .await
        .list_php_extensions(&id, &user, &version)
        .await
        .map_err(map_err)
}

// ── Security ──────────────────────────────────────────────────────

#[tauri::command]
pub async fn cpanel_list_blocked_ips(
    state: State<'_, CpanelServiceState>,
    id: String,
    user: String,
) -> CmdResult<Vec<IpBlockRule>> {
    state
        .lock()
        .await
        .list_blocked_ips(&id, &user)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn cpanel_block_ip(
    state: State<'_, CpanelServiceState>,
    id: String,
    user: String,
    ip: String,
) -> CmdResult<String> {
    state
        .lock()
        .await
        .block_ip(&id, &user, &ip)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn cpanel_unblock_ip(
    state: State<'_, CpanelServiceState>,
    id: String,
    user: String,
    ip: String,
) -> CmdResult<String> {
    state
        .lock()
        .await
        .unblock_ip(&id, &user, &ip)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn cpanel_list_ssh_keys(
    state: State<'_, CpanelServiceState>,
    id: String,
    user: String,
) -> CmdResult<Vec<SshKey>> {
    state
        .lock()
        .await
        .list_ssh_keys(&id, &user)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn cpanel_import_ssh_key(
    state: State<'_, CpanelServiceState>,
    id: String,
    user: String,
    name: String,
    key: String,
    key_type: String,
) -> CmdResult<String> {
    state
        .lock()
        .await
        .import_ssh_key(&id, &user, &name, &key, &key_type)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn cpanel_delete_ssh_key(
    state: State<'_, CpanelServiceState>,
    id: String,
    user: String,
    name: String,
    key_type: String,
) -> CmdResult<String> {
    state
        .lock()
        .await
        .delete_ssh_key(&id, &user, &name, &key_type)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn cpanel_get_modsec_status(
    state: State<'_, CpanelServiceState>,
    id: String,
    domain: String,
) -> CmdResult<bool> {
    state
        .lock()
        .await
        .get_modsec_status(&id, &domain)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn cpanel_set_modsec(
    state: State<'_, CpanelServiceState>,
    id: String,
    domain: String,
    enabled: bool,
) -> CmdResult<String> {
    state
        .lock()
        .await
        .set_modsec(&id, &domain, enabled)
        .await
        .map_err(map_err)
}
