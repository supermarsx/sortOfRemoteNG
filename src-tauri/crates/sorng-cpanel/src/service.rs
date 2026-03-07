// ── sorng-cpanel/src/service.rs ──────────────────────────────────────────────
//! Aggregate cPanel service – holds connections and delegates to domain managers.

use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

use crate::client::CpanelClient;
use crate::error::{CpanelError, CpanelResult};
use crate::types::*;

use crate::accounts::AccountManager;
use crate::backups::BackupManager;
use crate::cron::CronManager;
use crate::databases::DatabaseManager;
use crate::dns::DnsManager;
use crate::domains::DomainManager;
use crate::email::EmailManager;
use crate::files::FileManager;
use crate::ftp::FtpManager;
use crate::php::PhpManager;
use crate::security::SecurityManager;
use crate::ssl::SslManager;
use crate::stats::StatsManager;

/// Shared Tauri state handle.
pub type CpanelServiceState = Arc<Mutex<CpanelService>>;

/// Main cPanel service managing connections.
pub struct CpanelService {
    connections: HashMap<String, CpanelClient>,
}

impl CpanelService {
    pub fn new() -> Self {
        Self {
            connections: HashMap::new(),
        }
    }

    // ── Connection lifecycle ──────────────────────────────────────

    pub async fn connect(
        &mut self,
        id: String,
        config: CpanelConnectionConfig,
    ) -> CpanelResult<CpanelConnectionSummary> {
        let client = CpanelClient::new(config)?;
        let summary = client.ping().await?;
        self.connections.insert(id, client);
        Ok(summary)
    }

    pub fn disconnect(&mut self, id: &str) -> CpanelResult<()> {
        self.connections
            .remove(id)
            .map(|_| ())
            .ok_or_else(|| CpanelError::not_connected(format!("No connection '{id}'")))
    }

    pub fn list_connections(&self) -> Vec<String> {
        self.connections.keys().cloned().collect()
    }

    fn client(&self, id: &str) -> CpanelResult<&CpanelClient> {
        self.connections
            .get(id)
            .ok_or_else(|| CpanelError::not_connected(format!("No connection '{id}'")))
    }

    pub async fn ping(&self, id: &str) -> CpanelResult<CpanelConnectionSummary> {
        self.client(id)?.ping().await
    }

    // ── Accounts (WHM) ───────────────────────────────────────────

    pub async fn list_accounts(&self, id: &str) -> CpanelResult<Vec<CpanelAccount>> {
        AccountManager::list(self.client(id)?).await
    }

    pub async fn get_account(&self, id: &str, user: &str) -> CpanelResult<CpanelAccount> {
        AccountManager::get(self.client(id)?, user).await
    }

    pub async fn create_account(
        &self,
        id: &str,
        req: CreateAccountRequest,
    ) -> CpanelResult<String> {
        AccountManager::create(self.client(id)?, &req).await
    }

    pub async fn suspend_account(
        &self,
        id: &str,
        user: &str,
        reason: Option<&str>,
    ) -> CpanelResult<String> {
        AccountManager::suspend(self.client(id)?, user, reason).await
    }

    pub async fn unsuspend_account(&self, id: &str, user: &str) -> CpanelResult<String> {
        AccountManager::unsuspend(self.client(id)?, user).await
    }

    pub async fn terminate_account(&self, id: &str, user: &str, keep_dns: bool) -> CpanelResult<String> {
        AccountManager::terminate(self.client(id)?, user, keep_dns).await
    }

    pub async fn modify_account(
        &self,
        id: &str,
        req: ModifyAccountRequest,
    ) -> CpanelResult<String> {
        AccountManager::modify(self.client(id)?, &req).await
    }

    pub async fn change_account_password(
        &self,
        id: &str,
        user: &str,
        password: &str,
    ) -> CpanelResult<String> {
        AccountManager::change_password(self.client(id)?, user, password).await
    }

    pub async fn list_packages(&self, id: &str) -> CpanelResult<Vec<HostingPackage>> {
        AccountManager::list_packages(self.client(id)?).await
    }

    pub async fn get_account_summary(
        &self,
        id: &str,
        user: &str,
    ) -> CpanelResult<AccountSummary> {
        AccountManager::get_summary(self.client(id)?, user).await
    }

    pub async fn list_suspended_accounts(
        &self,
        id: &str,
    ) -> CpanelResult<Vec<CpanelAccount>> {
        AccountManager::list_suspended(self.client(id)?).await
    }

    pub async fn get_server_info(&self, id: &str) -> CpanelResult<CpanelServerInfo> {
        AccountManager::get_server_info(self.client(id)?).await
    }

    // ── Domains ──────────────────────────────────────────────────

    pub async fn list_domains(&self, id: &str, user: &str) -> CpanelResult<Vec<DomainInfo>> {
        DomainManager::list(self.client(id)?, user).await
    }

    pub async fn list_all_domains(&self, id: &str) -> CpanelResult<Vec<DomainInfo>> {
        DomainManager::list_all(self.client(id)?).await
    }

    pub async fn create_addon_domain(
        &self,
        id: &str,
        user: &str,
        req: CreateAddonDomainRequest,
    ) -> CpanelResult<String> {
        DomainManager::create_addon(self.client(id)?, user, &req).await
    }

    pub async fn remove_addon_domain(
        &self,
        id: &str,
        user: &str,
        domain: &str,
        subdomain: &str,
    ) -> CpanelResult<String> {
        DomainManager::remove_addon(self.client(id)?, user, domain, subdomain).await
    }

    pub async fn create_subdomain(
        &self,
        id: &str,
        user: &str,
        req: CreateSubdomainRequest,
    ) -> CpanelResult<String> {
        DomainManager::create_subdomain(self.client(id)?, user, &req).await
    }

    pub async fn remove_subdomain(
        &self,
        id: &str,
        user: &str,
        domain: &str,
    ) -> CpanelResult<String> {
        DomainManager::remove_subdomain(self.client(id)?, user, domain).await
    }

    pub async fn park_domain(
        &self,
        id: &str,
        user: &str,
        domain: &str,
    ) -> CpanelResult<String> {
        DomainManager::park(self.client(id)?, user, domain).await
    }

    pub async fn unpark_domain(
        &self,
        id: &str,
        user: &str,
        domain: &str,
    ) -> CpanelResult<String> {
        DomainManager::unpark(self.client(id)?, user, domain).await
    }

    // ── Email ────────────────────────────────────────────────────

    pub async fn list_email_accounts(
        &self,
        id: &str,
        user: &str,
    ) -> CpanelResult<Vec<EmailAccount>> {
        EmailManager::list_accounts(self.client(id)?, user).await
    }

    pub async fn create_email_account(
        &self,
        id: &str,
        user: &str,
        req: CreateEmailRequest,
    ) -> CpanelResult<String> {
        EmailManager::create_account(self.client(id)?, user, &req).await
    }

    pub async fn delete_email_account(
        &self,
        id: &str,
        user: &str,
        email: &str,
    ) -> CpanelResult<String> {
        EmailManager::delete_account(self.client(id)?, user, email).await
    }

    pub async fn change_email_password(
        &self,
        id: &str,
        user: &str,
        email: &str,
        password: &str,
    ) -> CpanelResult<String> {
        EmailManager::change_password(self.client(id)?, user, email, password).await
    }

    pub async fn set_email_quota(
        &self,
        id: &str,
        user: &str,
        email: &str,
        quota: u64,
    ) -> CpanelResult<String> {
        EmailManager::set_quota(self.client(id)?, user, email, quota).await
    }

    pub async fn list_forwarders(
        &self,
        id: &str,
        user: &str,
        domain: &str,
    ) -> CpanelResult<Vec<EmailForwarder>> {
        EmailManager::list_forwarders(self.client(id)?, user, domain).await
    }

    pub async fn add_forwarder(
        &self,
        id: &str,
        user: &str,
        domain: &str,
        email: &str,
        fwdopt: &str,
        fwdemail: &str,
    ) -> CpanelResult<String> {
        EmailManager::add_forwarder(self.client(id)?, user, domain, email, fwdopt, fwdemail).await
    }

    pub async fn delete_forwarder(
        &self,
        id: &str,
        user: &str,
        address: &str,
        dest: &str,
    ) -> CpanelResult<String> {
        EmailManager::delete_forwarder(self.client(id)?, user, address, dest).await
    }

    pub async fn list_autoresponders(
        &self,
        id: &str,
        user: &str,
        domain: &str,
    ) -> CpanelResult<Vec<EmailAutoresponder>> {
        EmailManager::list_autoresponders(self.client(id)?, user, domain).await
    }

    pub async fn list_mailing_lists(
        &self,
        id: &str,
        user: &str,
        domain: &str,
    ) -> CpanelResult<Vec<MailingList>> {
        EmailManager::list_mailing_lists(self.client(id)?, user, domain).await
    }

    pub async fn get_spam_settings(
        &self,
        id: &str,
        user: &str,
    ) -> CpanelResult<SpamFilterSettings> {
        EmailManager::get_spam_settings(self.client(id)?, user).await
    }

    pub async fn list_mx_records(
        &self,
        id: &str,
        user: &str,
        domain: &str,
    ) -> CpanelResult<Vec<MxRecord>> {
        EmailManager::list_mx(self.client(id)?, user, domain).await
    }

    // ── Databases ────────────────────────────────────────────────

    pub async fn list_databases(
        &self,
        id: &str,
        user: &str,
    ) -> CpanelResult<Vec<CpanelDatabase>> {
        DatabaseManager::list_mysql_dbs(self.client(id)?, user).await
    }

    pub async fn create_database(
        &self,
        id: &str,
        user: &str,
        name: &str,
    ) -> CpanelResult<String> {
        DatabaseManager::create_mysql_db(self.client(id)?, user, name).await
    }

    pub async fn delete_database(
        &self,
        id: &str,
        user: &str,
        name: &str,
    ) -> CpanelResult<String> {
        DatabaseManager::delete_mysql_db(self.client(id)?, user, name).await
    }

    pub async fn list_database_users(
        &self,
        id: &str,
        user: &str,
    ) -> CpanelResult<Vec<DatabaseUser>> {
        DatabaseManager::list_mysql_users(self.client(id)?, user).await
    }

    pub async fn create_database_user(
        &self,
        id: &str,
        user: &str,
        db_user: &str,
        password: &str,
    ) -> CpanelResult<String> {
        DatabaseManager::create_mysql_user(self.client(id)?, user, db_user, password).await
    }

    pub async fn delete_database_user(
        &self,
        id: &str,
        user: &str,
        dbuser: &str,
    ) -> CpanelResult<String> {
        DatabaseManager::delete_mysql_user(self.client(id)?, user, dbuser).await
    }

    pub async fn grant_database_privileges(
        &self,
        id: &str,
        user: &str,
        db_user: &str,
        db: &str,
        privileges: &str,
    ) -> CpanelResult<String> {
        DatabaseManager::grant_mysql_privileges(self.client(id)?, user, db_user, db, privileges).await
    }

    // ── DNS ──────────────────────────────────────────────────────

    pub async fn list_dns_zones(&self, id: &str) -> CpanelResult<Vec<String>> {
        DnsManager::list_zones(self.client(id)?).await
    }

    pub async fn get_dns_zone(
        &self,
        id: &str,
        domain: &str,
    ) -> CpanelResult<DnsZone> {
        DnsManager::get_zone(self.client(id)?, domain).await
    }

    pub async fn add_dns_record(
        &self,
        id: &str,
        req: AddDnsRecordRequest,
    ) -> CpanelResult<String> {
        DnsManager::add_record(self.client(id)?, &req).await
    }

    pub async fn edit_dns_record(
        &self,
        id: &str,
        req: EditDnsRecordRequest,
    ) -> CpanelResult<String> {
        DnsManager::edit_record(self.client(id)?, &req).await
    }

    pub async fn remove_dns_record(
        &self,
        id: &str,
        zone: &str,
        line: u32,
    ) -> CpanelResult<String> {
        DnsManager::remove_record(self.client(id)?, zone, line).await
    }

    // ── Files ────────────────────────────────────────────────────

    pub async fn list_files(
        &self,
        id: &str,
        user: &str,
        path: &str,
    ) -> CpanelResult<Vec<FileItem>> {
        FileManager::list_files(self.client(id)?, user, path).await
    }

    pub async fn create_directory(
        &self,
        id: &str,
        user: &str,
        path: &str,
        name: &str,
    ) -> CpanelResult<String> {
        FileManager::create_directory(self.client(id)?, user, path, name).await
    }

    pub async fn delete_file(
        &self,
        id: &str,
        user: &str,
        path: &str,
    ) -> CpanelResult<String> {
        FileManager::delete(self.client(id)?, user, path).await
    }

    pub async fn get_disk_usage(
        &self,
        id: &str,
        user: &str,
    ) -> CpanelResult<DiskUsageInfo> {
        FileManager::get_disk_usage(self.client(id)?, user).await
    }

    // ── SSL ──────────────────────────────────────────────────────

    pub async fn list_ssl_certs(
        &self,
        id: &str,
        user: &str,
    ) -> CpanelResult<Vec<SslCertificate>> {
        SslManager::list_certs(self.client(id)?, user).await
    }

    pub async fn get_ssl_status(
        &self,
        id: &str,
        user: &str,
    ) -> CpanelResult<Vec<SslStatus>> {
        SslManager::get_ssl_status(self.client(id)?, user).await
    }

    pub async fn install_ssl(
        &self,
        id: &str,
        req: InstallSslRequest,
    ) -> CpanelResult<String> {
        SslManager::install_cert(self.client(id)?, &req).await
    }

    pub async fn generate_csr(
        &self,
        id: &str,
        user: &str,
        req: GenerateCsrRequest,
    ) -> CpanelResult<CsrResult> {
        SslManager::generate_csr(self.client(id)?, user, &req).await
    }

    pub async fn autossl_check(&self, id: &str, user: &str) -> CpanelResult<serde_json::Value> {
        SslManager::autossl_check(self.client(id)?, user).await
    }

    // ── Backups ──────────────────────────────────────────────────

    pub async fn list_backups(
        &self,
        id: &str,
        user: &str,
    ) -> CpanelResult<Vec<BackupInfo>> {
        BackupManager::list_backups(self.client(id)?, user).await
    }

    pub async fn create_full_backup(
        &self,
        id: &str,
        user: &str,
        dest: Option<&str>,
        email: Option<&str>,
    ) -> CpanelResult<String> {
        BackupManager::create_full_backup(self.client(id)?, user, dest, email).await
    }

    pub async fn restore_file(
        &self,
        id: &str,
        user: &str,
        backup: &str,
        path: &str,
    ) -> CpanelResult<String> {
        BackupManager::restore_file(self.client(id)?, user, backup, path).await
    }

    pub async fn get_backup_config(&self, id: &str) -> CpanelResult<serde_json::Value> {
        BackupManager::get_backup_config(self.client(id)?).await
    }

    pub async fn trigger_server_backup(&self, id: &str) -> CpanelResult<String> {
        BackupManager::trigger_server_backup(self.client(id)?).await
    }

    // ── FTP ──────────────────────────────────────────────────────

    pub async fn list_ftp_accounts(
        &self,
        id: &str,
        user: &str,
    ) -> CpanelResult<Vec<FtpAccount>> {
        FtpManager::list_accounts(self.client(id)?, user).await
    }

    pub async fn create_ftp_account(
        &self,
        id: &str,
        user: &str,
        req: CreateFtpRequest,
    ) -> CpanelResult<String> {
        FtpManager::create_account(self.client(id)?, user, &req).await
    }

    pub async fn delete_ftp_account(
        &self,
        id: &str,
        user: &str,
        ftp_user: &str,
        destroy: bool,
    ) -> CpanelResult<String> {
        FtpManager::delete_account(self.client(id)?, user, ftp_user, destroy).await
    }

    pub async fn list_ftp_sessions(
        &self,
        id: &str,
    ) -> CpanelResult<Vec<FtpSession>> {
        FtpManager::list_sessions(self.client(id)?).await
    }

    // ── Cron ─────────────────────────────────────────────────────

    pub async fn list_cron_jobs(
        &self,
        id: &str,
        user: &str,
    ) -> CpanelResult<Vec<CronJob>> {
        CronManager::list(self.client(id)?, user).await
    }

    pub async fn add_cron_job(
        &self,
        id: &str,
        user: &str,
        req: CreateCronRequest,
    ) -> CpanelResult<String> {
        CronManager::add(self.client(id)?, user, &req).await
    }

    pub async fn edit_cron_job(
        &self,
        id: &str,
        user: &str,
        linekey: &str,
        req: CreateCronRequest,
    ) -> CpanelResult<String> {
        CronManager::edit(self.client(id)?, user, linekey, &req).await
    }

    pub async fn delete_cron_job(
        &self,
        id: &str,
        user: &str,
        linekey: &str,
    ) -> CpanelResult<String> {
        CronManager::delete(self.client(id)?, user, linekey).await
    }

    // ── Stats ────────────────────────────────────────────────────

    pub async fn get_bandwidth(
        &self,
        id: &str,
        user: &str,
    ) -> CpanelResult<BandwidthUsage> {
        StatsManager::get_bandwidth(self.client(id)?, user).await
    }

    pub async fn get_resource_usage(
        &self,
        id: &str,
        user: &str,
    ) -> CpanelResult<ResourceUsage> {
        StatsManager::get_resource_usage(self.client(id)?, user).await
    }

    pub async fn get_error_log(
        &self,
        id: &str,
        user: &str,
        lines: u32,
    ) -> CpanelResult<Vec<ErrorLogEntry>> {
        StatsManager::get_error_log(self.client(id)?, user, lines).await
    }

    pub async fn get_server_load(&self, id: &str) -> CpanelResult<ServerLoadStatus> {
        StatsManager::get_server_load(self.client(id)?).await
    }

    // ── PHP ──────────────────────────────────────────────────────

    pub async fn list_php_versions(&self, id: &str) -> CpanelResult<Vec<PhpVersion>> {
        PhpManager::list_php_versions(self.client(id)?).await
    }

    pub async fn get_domain_php_version(
        &self,
        id: &str,
        user: &str,
        domain: &str,
    ) -> CpanelResult<String> {
        PhpManager::get_domain_php_version(self.client(id)?, user, domain).await
    }

    pub async fn set_domain_php_version(
        &self,
        id: &str,
        user: &str,
        domain: &str,
        version: &str,
    ) -> CpanelResult<String> {
        PhpManager::set_domain_php_version(self.client(id)?, user, domain, version).await
    }

    pub async fn get_php_config(
        &self,
        id: &str,
        user: &str,
        version: &str,
    ) -> CpanelResult<PhpConfig> {
        PhpManager::get_php_config(self.client(id)?, user, version).await
    }

    pub async fn list_php_extensions(
        &self,
        id: &str,
        user: &str,
        version: &str,
    ) -> CpanelResult<Vec<PhpExtension>> {
        PhpManager::list_extensions(self.client(id)?, user, version).await
    }

    // ── Security ─────────────────────────────────────────────────

    pub async fn list_blocked_ips(
        &self,
        id: &str,
        user: &str,
    ) -> CpanelResult<Vec<IpBlockRule>> {
        SecurityManager::list_blocked_ips(self.client(id)?, user).await
    }

    pub async fn block_ip(
        &self,
        id: &str,
        user: &str,
        ip: &str,
    ) -> CpanelResult<String> {
        SecurityManager::block_ip(self.client(id)?, user, ip).await
    }

    pub async fn unblock_ip(
        &self,
        id: &str,
        user: &str,
        ip: &str,
    ) -> CpanelResult<String> {
        SecurityManager::unblock_ip(self.client(id)?, user, ip).await
    }

    pub async fn list_ssh_keys(
        &self,
        id: &str,
        user: &str,
    ) -> CpanelResult<Vec<SshKey>> {
        SecurityManager::list_ssh_keys(self.client(id)?, user).await
    }

    pub async fn import_ssh_key(
        &self,
        id: &str,
        user: &str,
        name: &str,
        key: &str,
        key_type: &str,
    ) -> CpanelResult<String> {
        SecurityManager::import_ssh_key(self.client(id)?, user, name, key, key_type).await
    }

    pub async fn delete_ssh_key(
        &self,
        id: &str,
        user: &str,
        name: &str,
        key_type: &str,
    ) -> CpanelResult<String> {
        SecurityManager::delete_ssh_key(self.client(id)?, user, name, key_type).await
    }

    pub async fn get_modsec_status(
        &self,
        id: &str,
        domain: &str,
    ) -> CpanelResult<bool> {
        SecurityManager::get_modsec_status(self.client(id)?, domain).await
    }

    pub async fn set_modsec(
        &self,
        id: &str,
        domain: &str,
        enabled: bool,
    ) -> CpanelResult<String> {
        SecurityManager::set_modsec(self.client(id)?, domain, enabled).await
    }
}
