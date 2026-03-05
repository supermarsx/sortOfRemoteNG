// ─── Exchange Integration – service façade ───────────────────────────────────
//!
//! `ExchangeService` is the unified façade that Tauri commands call.
//! It manages connection state, token lifecycle and delegates to domain modules.

use crate::types::*;
use crate::{
    address_policy, archive, auth, calendars, certificates, client::ExchangeClient, compliance,
    connectors, contacts, distribution_groups, health, hygiene, inbox_rules, journal_rules,
    mail_flow, mailbox, migration, mobile_devices, org_config, policies, public_folders,
    rbac_audit, remote_domains, shared_mailbox, transport,
};
use log::info;
use std::sync::Arc;
use tokio::sync::Mutex;

pub type ExchangeServiceState = Arc<Mutex<ExchangeService>>;

pub struct ExchangeService {
    client: Option<ExchangeClient>,
    config: Option<ExchangeConnectionConfig>,
    connected: bool,
}

impl ExchangeService {
    pub fn new() -> ExchangeServiceState {
        Arc::new(Mutex::new(Self {
            client: None,
            config: None,
            connected: false,
        }))
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Connection management
    // ═══════════════════════════════════════════════════════════════════════

    /// Configure connection parameters.
    pub fn set_config(&mut self, config: ExchangeConnectionConfig) {
        self.config = Some(config);
        self.client = None;
        self.connected = false;
    }

    /// Connect / authenticate based on environment.
    pub async fn connect(&mut self) -> ExchangeResult<ExchangeConnectionSummary> {
        let config = self
            .config
            .clone()
            .ok_or_else(|| ExchangeError::validation("connection config not set"))?;

        let mut c = ExchangeClient::new(config.clone());

        match config.environment {
            ExchangeEnvironment::Online | ExchangeEnvironment::Hybrid => {
                info!("Authenticating to Exchange Online");
                c.ensure_graph_token().await?;
                c.ensure_exo_token().await?;
            }
            ExchangeEnvironment::OnPremises => {
                let creds = config
                    .on_prem
                    .as_ref()
                    .ok_or_else(|| ExchangeError::validation("on-prem credentials required"))?;
                let script = auth::build_ems_connect_script(creds);
                let out = c.run_ps(&script).await?;
                if !out.contains("EMS_CONNECTED") {
                    return Err(ExchangeError::connection(format!(
                        "EMS session failed: {out}"
                    )));
                }
                c.ps_connected = true;
            }
        }

        self.connected = true;
        self.client = Some(c);
        Ok(self.connection_summary())
    }

    /// Disconnect and clean up sessions.
    pub async fn disconnect(&mut self) -> ExchangeResult<()> {
        if let Some(ref c) = self.client {
            if c.ps_connected {
                let _ = c.run_ps(auth::build_ems_disconnect_script()).await;
            }
        }
        self.client = None;
        self.connected = false;
        Ok(())
    }

    pub fn is_connected(&self) -> bool {
        self.connected
    }

    pub fn connection_summary(&self) -> ExchangeConnectionSummary {
        let config = self.config.as_ref();
        ExchangeConnectionSummary {
            connected: self.connected,
            environment: config
                .map(|c| c.environment.clone())
                .unwrap_or_default(),
            server: config
                .and_then(|c| c.on_prem.as_ref().map(|p| p.server.clone())),
            organization: config
                .and_then(|c| c.online.as_ref().and_then(|o| o.organization.clone())),
            connected_as: config.and_then(|c| {
                c.on_prem
                    .as_ref()
                    .map(|p| p.username.clone())
                    .or_else(|| c.online.as_ref().map(|o| o.client_id.clone()))
            }),
            exchange_version: None,
        }
    }

    fn client(&self) -> ExchangeResult<&ExchangeClient> {
        self.client
            .as_ref()
            .ok_or_else(|| ExchangeError::connection("not connected"))
    }

    /// Ensure tokens are fresh before each operation.
    async fn ensure_auth(&mut self) -> ExchangeResult<()> {
        if !self.connected {
            return Err(ExchangeError::connection("not connected"));
        }
        if let Some(ref mut c) = self.client {
            if let Some(ref cfg) = self.config {
                match cfg.environment {
                    ExchangeEnvironment::Online | ExchangeEnvironment::Hybrid => {
                        c.ensure_graph_token().await?;
                        c.ensure_exo_token().await?;
                    }
                    _ => {}
                }
            }
        }
        Ok(())
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Mailbox operations
    // ═══════════════════════════════════════════════════════════════════════

    pub async fn list_mailboxes(
        &mut self,
        result_size: Option<i32>,
        filter: Option<String>,
    ) -> ExchangeResult<Vec<Mailbox>> {
        self.ensure_auth().await?;
        let c = self.client()?;
        match self.config.as_ref().map(|c| &c.environment) {
            Some(ExchangeEnvironment::Online) => mailbox::graph_list_mailboxes(c).await,
            _ => mailbox::ps_list_mailboxes(c, result_size, filter.as_deref()).await,
        }
    }

    pub async fn get_mailbox(&mut self, identity: &str) -> ExchangeResult<Mailbox> {
        self.ensure_auth().await?;
        let c = self.client()?;
        match self.config.as_ref().map(|c| &c.environment) {
            Some(ExchangeEnvironment::Online) => mailbox::graph_get_mailbox(c, identity).await,
            _ => mailbox::ps_get_mailbox(c, identity).await,
        }
    }

    pub async fn create_mailbox(&mut self, req: CreateMailboxRequest) -> ExchangeResult<Mailbox> {
        self.ensure_auth().await?;
        mailbox::ps_create_mailbox(self.client()?, &req).await
    }

    pub async fn remove_mailbox(&mut self, identity: &str) -> ExchangeResult<String> {
        self.ensure_auth().await?;
        mailbox::ps_remove_mailbox(self.client()?, identity).await
    }

    pub async fn enable_mailbox(
        &mut self,
        identity: &str,
        database: Option<String>,
    ) -> ExchangeResult<Mailbox> {
        self.ensure_auth().await?;
        mailbox::ps_enable_mailbox(self.client()?, identity, database.as_deref()).await
    }

    pub async fn disable_mailbox(&mut self, identity: &str) -> ExchangeResult<String> {
        self.ensure_auth().await?;
        mailbox::ps_disable_mailbox(self.client()?, identity).await
    }

    pub async fn update_mailbox(&mut self, req: UpdateMailboxRequest) -> ExchangeResult<String> {
        self.ensure_auth().await?;
        mailbox::ps_update_mailbox(self.client()?, &req).await
    }

    pub async fn get_mailbox_statistics(
        &mut self,
        identity: &str,
    ) -> ExchangeResult<MailboxStatistics> {
        self.ensure_auth().await?;
        mailbox::ps_get_mailbox_statistics(self.client()?, identity).await
    }

    pub async fn get_mailbox_permissions(
        &mut self,
        identity: &str,
    ) -> ExchangeResult<Vec<MailboxPermission>> {
        self.ensure_auth().await?;
        mailbox::ps_get_mailbox_permissions(self.client()?, identity).await
    }

    pub async fn add_mailbox_permission(
        &mut self,
        identity: &str,
        user: &str,
        access_rights: &str,
    ) -> ExchangeResult<String> {
        self.ensure_auth().await?;
        mailbox::ps_add_mailbox_permission(self.client()?, identity, user, access_rights).await
    }

    pub async fn remove_mailbox_permission(
        &mut self,
        identity: &str,
        user: &str,
        access_rights: &str,
    ) -> ExchangeResult<String> {
        self.ensure_auth().await?;
        mailbox::ps_remove_mailbox_permission(self.client()?, identity, user, access_rights).await
    }

    pub async fn get_forwarding(&mut self, identity: &str) -> ExchangeResult<MailboxForwarding> {
        self.ensure_auth().await?;
        mailbox::ps_get_forwarding(self.client()?, identity).await
    }

    pub async fn get_ooo(&mut self, identity: &str) -> ExchangeResult<OutOfOfficeSettings> {
        self.ensure_auth().await?;
        mailbox::ps_get_ooo(self.client()?, identity).await
    }

    pub async fn set_ooo(&mut self, settings: OutOfOfficeSettings) -> ExchangeResult<String> {
        self.ensure_auth().await?;
        mailbox::ps_set_ooo(self.client()?, &settings).await
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Distribution / M365 Groups
    // ═══════════════════════════════════════════════════════════════════════

    pub async fn list_groups(
        &mut self,
        result_size: Option<i32>,
    ) -> ExchangeResult<Vec<DistributionGroup>> {
        self.ensure_auth().await?;
        let c = self.client()?;
        match self.config.as_ref().map(|c| &c.environment) {
            Some(ExchangeEnvironment::Online) => distribution_groups::graph_list_groups(c).await,
            _ => distribution_groups::ps_list_groups(c, result_size).await,
        }
    }

    pub async fn get_group(&mut self, identity: &str) -> ExchangeResult<DistributionGroup> {
        self.ensure_auth().await?;
        distribution_groups::ps_get_group(self.client()?, identity).await
    }

    pub async fn create_group(
        &mut self,
        req: CreateGroupRequest,
    ) -> ExchangeResult<DistributionGroup> {
        self.ensure_auth().await?;
        distribution_groups::ps_create_group(self.client()?, &req).await
    }

    pub async fn update_group(&mut self, req: UpdateGroupRequest) -> ExchangeResult<String> {
        self.ensure_auth().await?;
        distribution_groups::ps_update_group(self.client()?, &req).await
    }

    pub async fn remove_group(&mut self, identity: &str) -> ExchangeResult<String> {
        self.ensure_auth().await?;
        distribution_groups::ps_remove_group(self.client()?, identity).await
    }

    pub async fn list_group_members(
        &mut self,
        identity: &str,
    ) -> ExchangeResult<Vec<GroupMember>> {
        self.ensure_auth().await?;
        let c = self.client()?;
        match self.config.as_ref().map(|c| &c.environment) {
            Some(ExchangeEnvironment::Online) => {
                distribution_groups::graph_list_group_members(c, identity).await
            }
            _ => distribution_groups::ps_list_group_members(c, identity).await,
        }
    }

    pub async fn add_group_member(
        &mut self,
        group: &str,
        member: &str,
    ) -> ExchangeResult<String> {
        self.ensure_auth().await?;
        distribution_groups::ps_add_group_member(self.client()?, group, member).await
    }

    pub async fn remove_group_member(
        &mut self,
        group: &str,
        member: &str,
    ) -> ExchangeResult<String> {
        self.ensure_auth().await?;
        distribution_groups::ps_remove_group_member(self.client()?, group, member).await
    }

    pub async fn list_dynamic_groups(&mut self) -> ExchangeResult<Vec<DistributionGroup>> {
        self.ensure_auth().await?;
        distribution_groups::ps_list_dynamic_groups(self.client()?).await
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Transport Rules
    // ═══════════════════════════════════════════════════════════════════════

    pub async fn list_transport_rules(&mut self) -> ExchangeResult<Vec<TransportRule>> {
        self.ensure_auth().await?;
        transport::ps_list_transport_rules(self.client()?).await
    }

    pub async fn get_transport_rule(&mut self, identity: &str) -> ExchangeResult<TransportRule> {
        self.ensure_auth().await?;
        transport::ps_get_transport_rule(self.client()?, identity).await
    }

    pub async fn create_transport_rule(
        &mut self,
        req: CreateTransportRuleRequest,
    ) -> ExchangeResult<TransportRule> {
        self.ensure_auth().await?;
        transport::ps_create_transport_rule(self.client()?, &req).await
    }

    pub async fn update_transport_rule(
        &mut self,
        identity: &str,
        params: serde_json::Value,
    ) -> ExchangeResult<String> {
        self.ensure_auth().await?;
        transport::ps_update_transport_rule(self.client()?, identity, &params).await
    }

    pub async fn remove_transport_rule(&mut self, identity: &str) -> ExchangeResult<String> {
        self.ensure_auth().await?;
        transport::ps_remove_transport_rule(self.client()?, identity).await
    }

    pub async fn enable_transport_rule(&mut self, identity: &str) -> ExchangeResult<String> {
        self.ensure_auth().await?;
        transport::ps_enable_transport_rule(self.client()?, identity).await
    }

    pub async fn disable_transport_rule(&mut self, identity: &str) -> ExchangeResult<String> {
        self.ensure_auth().await?;
        transport::ps_disable_transport_rule(self.client()?, identity).await
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Connectors
    // ═══════════════════════════════════════════════════════════════════════

    pub async fn list_send_connectors(&mut self) -> ExchangeResult<Vec<Connector>> {
        self.ensure_auth().await?;
        connectors::ps_list_send_connectors(self.client()?).await
    }

    pub async fn get_send_connector(&mut self, identity: &str) -> ExchangeResult<Connector> {
        self.ensure_auth().await?;
        connectors::ps_get_send_connector(self.client()?, identity).await
    }

    pub async fn list_receive_connectors(
        &mut self,
        server: Option<String>,
    ) -> ExchangeResult<Vec<Connector>> {
        self.ensure_auth().await?;
        connectors::ps_list_receive_connectors(self.client()?, server.as_deref()).await
    }

    pub async fn get_receive_connector(&mut self, identity: &str) -> ExchangeResult<Connector> {
        self.ensure_auth().await?;
        connectors::ps_get_receive_connector(self.client()?, identity).await
    }

    pub async fn list_inbound_connectors(&mut self) -> ExchangeResult<Vec<Connector>> {
        self.ensure_auth().await?;
        connectors::ps_list_inbound_connectors(self.client()?).await
    }

    pub async fn list_outbound_connectors(&mut self) -> ExchangeResult<Vec<Connector>> {
        self.ensure_auth().await?;
        connectors::ps_list_outbound_connectors(self.client()?).await
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Mail Flow
    // ═══════════════════════════════════════════════════════════════════════

    pub async fn message_trace(
        &mut self,
        req: MessageTraceRequest,
    ) -> ExchangeResult<Vec<MessageTraceResult>> {
        self.ensure_auth().await?;
        mail_flow::ps_message_trace(self.client()?, &req).await
    }

    pub async fn message_tracking_log(
        &mut self,
        sender: Option<String>,
        recipient: Option<String>,
        start: Option<String>,
        end: Option<String>,
        server: Option<String>,
        result_size: Option<i32>,
    ) -> ExchangeResult<Vec<MessageTraceResult>> {
        self.ensure_auth().await?;
        mail_flow::ps_message_tracking_log(
            self.client()?,
            sender.as_deref(),
            recipient.as_deref(),
            start.as_deref(),
            end.as_deref(),
            server.as_deref(),
            result_size,
        )
        .await
    }

    pub async fn list_queues(
        &mut self,
        server: Option<String>,
    ) -> ExchangeResult<Vec<MailQueue>> {
        self.ensure_auth().await?;
        mail_flow::ps_list_queues(self.client()?, server.as_deref()).await
    }

    pub async fn get_queue(&mut self, identity: &str) -> ExchangeResult<MailQueue> {
        self.ensure_auth().await?;
        mail_flow::ps_get_queue(self.client()?, identity).await
    }

    pub async fn retry_queue(&mut self, identity: &str) -> ExchangeResult<String> {
        self.ensure_auth().await?;
        mail_flow::ps_retry_queue(self.client()?, identity).await
    }

    pub async fn suspend_queue(&mut self, identity: &str) -> ExchangeResult<String> {
        self.ensure_auth().await?;
        mail_flow::ps_suspend_queue(self.client()?, identity).await
    }

    pub async fn resume_queue(&mut self, identity: &str) -> ExchangeResult<String> {
        self.ensure_auth().await?;
        mail_flow::ps_resume_queue(self.client()?, identity).await
    }

    pub async fn queue_summary(&mut self) -> ExchangeResult<Vec<MailQueue>> {
        self.ensure_auth().await?;
        mail_flow::ps_queue_summary(self.client()?).await
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Calendars & Resources
    // ═══════════════════════════════════════════════════════════════════════

    pub async fn list_calendar_permissions(
        &mut self,
        identity: &str,
    ) -> ExchangeResult<Vec<CalendarPermission>> {
        self.ensure_auth().await?;
        let c = self.client()?;
        match self.config.as_ref().map(|c| &c.environment) {
            Some(ExchangeEnvironment::Online) => {
                calendars::graph_list_calendar_permissions(c, identity).await
            }
            _ => calendars::ps_list_calendar_permissions(c, identity).await,
        }
    }

    pub async fn set_calendar_permission(
        &mut self,
        identity: &str,
        user: &str,
        access_rights: &str,
    ) -> ExchangeResult<String> {
        self.ensure_auth().await?;
        calendars::ps_set_calendar_permission(self.client()?, identity, user, access_rights).await
    }

    pub async fn remove_calendar_permission(
        &mut self,
        identity: &str,
        user: &str,
    ) -> ExchangeResult<String> {
        self.ensure_auth().await?;
        calendars::ps_remove_calendar_permission(self.client()?, identity, user).await
    }

    pub async fn get_booking_config(
        &mut self,
        identity: &str,
    ) -> ExchangeResult<ResourceBookingConfig> {
        self.ensure_auth().await?;
        calendars::ps_get_booking_config(self.client()?, identity).await
    }

    pub async fn set_booking_config(
        &mut self,
        config: ResourceBookingConfig,
    ) -> ExchangeResult<String> {
        self.ensure_auth().await?;
        calendars::ps_set_booking_config(self.client()?, &config).await
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Public Folders
    // ═══════════════════════════════════════════════════════════════════════

    pub async fn list_public_folders(
        &mut self,
        root: Option<String>,
        recurse: bool,
    ) -> ExchangeResult<Vec<PublicFolder>> {
        self.ensure_auth().await?;
        public_folders::ps_list_public_folders(self.client()?, root.as_deref(), recurse).await
    }

    pub async fn get_public_folder(&mut self, identity: &str) -> ExchangeResult<PublicFolder> {
        self.ensure_auth().await?;
        public_folders::ps_get_public_folder(self.client()?, identity).await
    }

    pub async fn create_public_folder(
        &mut self,
        name: &str,
        path: Option<String>,
    ) -> ExchangeResult<PublicFolder> {
        self.ensure_auth().await?;
        public_folders::ps_create_public_folder(self.client()?, name, path.as_deref()).await
    }

    pub async fn remove_public_folder(&mut self, identity: &str) -> ExchangeResult<String> {
        self.ensure_auth().await?;
        public_folders::ps_remove_public_folder(self.client()?, identity).await
    }

    pub async fn mail_enable_public_folder(&mut self, identity: &str) -> ExchangeResult<String> {
        self.ensure_auth().await?;
        public_folders::ps_mail_enable_public_folder(self.client()?, identity).await
    }

    pub async fn mail_disable_public_folder(&mut self, identity: &str) -> ExchangeResult<String> {
        self.ensure_auth().await?;
        public_folders::ps_mail_disable_public_folder(self.client()?, identity).await
    }

    pub async fn get_public_folder_statistics(
        &mut self,
        identity: &str,
    ) -> ExchangeResult<PublicFolderStatistics> {
        self.ensure_auth().await?;
        public_folders::ps_get_public_folder_statistics(self.client()?, identity).await
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Address Policies / Domains
    // ═══════════════════════════════════════════════════════════════════════

    pub async fn list_address_policies(&mut self) -> ExchangeResult<Vec<EmailAddressPolicy>> {
        self.ensure_auth().await?;
        address_policy::ps_list_address_policies(self.client()?).await
    }

    pub async fn get_address_policy(
        &mut self,
        identity: &str,
    ) -> ExchangeResult<EmailAddressPolicy> {
        self.ensure_auth().await?;
        address_policy::ps_get_address_policy(self.client()?, identity).await
    }

    pub async fn apply_address_policy(&mut self, identity: &str) -> ExchangeResult<String> {
        self.ensure_auth().await?;
        address_policy::ps_apply_address_policy(self.client()?, identity).await
    }

    pub async fn list_accepted_domains(&mut self) -> ExchangeResult<Vec<AcceptedDomain>> {
        self.ensure_auth().await?;
        let c = self.client()?;
        match self.config.as_ref().map(|c| &c.environment) {
            Some(ExchangeEnvironment::Online) => address_policy::graph_list_domains(c).await,
            _ => address_policy::ps_list_accepted_domains(c).await,
        }
    }

    pub async fn list_address_lists(&mut self) -> ExchangeResult<Vec<AddressList>> {
        self.ensure_auth().await?;
        address_policy::ps_list_address_lists(self.client()?).await
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Migration
    // ═══════════════════════════════════════════════════════════════════════

    pub async fn list_migration_batches(&mut self) -> ExchangeResult<Vec<MigrationBatch>> {
        self.ensure_auth().await?;
        migration::ps_list_migration_batches(self.client()?).await
    }

    pub async fn get_migration_batch(
        &mut self,
        identity: &str,
    ) -> ExchangeResult<MigrationBatch> {
        self.ensure_auth().await?;
        migration::ps_get_migration_batch(self.client()?, identity).await
    }

    pub async fn start_migration_batch(&mut self, identity: &str) -> ExchangeResult<String> {
        self.ensure_auth().await?;
        migration::ps_start_migration_batch(self.client()?, identity).await
    }

    pub async fn stop_migration_batch(&mut self, identity: &str) -> ExchangeResult<String> {
        self.ensure_auth().await?;
        migration::ps_stop_migration_batch(self.client()?, identity).await
    }

    pub async fn complete_migration_batch(&mut self, identity: &str) -> ExchangeResult<String> {
        self.ensure_auth().await?;
        migration::ps_complete_migration_batch(self.client()?, identity).await
    }

    pub async fn remove_migration_batch(&mut self, identity: &str) -> ExchangeResult<String> {
        self.ensure_auth().await?;
        migration::ps_remove_migration_batch(self.client()?, identity).await
    }

    pub async fn list_migration_users(
        &mut self,
        batch_id: Option<String>,
    ) -> ExchangeResult<Vec<MigrationUser>> {
        self.ensure_auth().await?;
        migration::ps_list_migration_users(self.client()?, batch_id.as_deref()).await
    }

    pub async fn list_move_requests(&mut self) -> ExchangeResult<Vec<MoveRequest>> {
        self.ensure_auth().await?;
        migration::ps_list_move_requests(self.client()?).await
    }

    pub async fn get_move_request_statistics(
        &mut self,
        identity: &str,
    ) -> ExchangeResult<MoveRequest> {
        self.ensure_auth().await?;
        migration::ps_get_move_request_statistics(self.client()?, identity).await
    }

    pub async fn new_move_request(
        &mut self,
        identity: &str,
        target_database: &str,
        batch_name: Option<String>,
    ) -> ExchangeResult<String> {
        self.ensure_auth().await?;
        migration::ps_new_move_request(
            self.client()?,
            identity,
            target_database,
            batch_name.as_deref(),
        )
        .await
    }

    pub async fn remove_move_request(&mut self, identity: &str) -> ExchangeResult<String> {
        self.ensure_auth().await?;
        migration::ps_remove_move_request(self.client()?, identity).await
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Compliance & Retention
    // ═══════════════════════════════════════════════════════════════════════

    pub async fn list_retention_policies(&mut self) -> ExchangeResult<Vec<RetentionPolicy>> {
        self.ensure_auth().await?;
        compliance::ps_list_retention_policies(self.client()?).await
    }

    pub async fn get_retention_policy(
        &mut self,
        identity: &str,
    ) -> ExchangeResult<RetentionPolicy> {
        self.ensure_auth().await?;
        compliance::ps_get_retention_policy(self.client()?, identity).await
    }

    pub async fn list_retention_tags(&mut self) -> ExchangeResult<Vec<RetentionTag>> {
        self.ensure_auth().await?;
        compliance::ps_list_retention_tags(self.client()?).await
    }

    pub async fn get_retention_tag(&mut self, identity: &str) -> ExchangeResult<RetentionTag> {
        self.ensure_auth().await?;
        compliance::ps_get_retention_tag(self.client()?, identity).await
    }

    pub async fn get_mailbox_hold(&mut self, identity: &str) -> ExchangeResult<MailboxHold> {
        self.ensure_auth().await?;
        compliance::ps_get_mailbox_hold(self.client()?, identity).await
    }

    pub async fn enable_litigation_hold(
        &mut self,
        identity: &str,
        duration: Option<String>,
        owner: Option<String>,
    ) -> ExchangeResult<String> {
        self.ensure_auth().await?;
        compliance::ps_enable_litigation_hold(
            self.client()?,
            identity,
            duration.as_deref(),
            owner.as_deref(),
        )
        .await
    }

    pub async fn disable_litigation_hold(&mut self, identity: &str) -> ExchangeResult<String> {
        self.ensure_auth().await?;
        compliance::ps_disable_litigation_hold(self.client()?, identity).await
    }

    pub async fn list_dlp_policies(&mut self) -> ExchangeResult<Vec<DlpPolicy>> {
        self.ensure_auth().await?;
        compliance::ps_list_dlp_policies(self.client()?).await
    }

    pub async fn get_dlp_policy(&mut self, identity: &str) -> ExchangeResult<DlpPolicy> {
        self.ensure_auth().await?;
        compliance::ps_get_dlp_policy(self.client()?, identity).await
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Health & Monitoring
    // ═══════════════════════════════════════════════════════════════════════

    pub async fn list_servers(&mut self) -> ExchangeResult<Vec<ExchangeServer>> {
        self.ensure_auth().await?;
        health::ps_list_servers(self.client()?).await
    }

    pub async fn get_server(&mut self, identity: &str) -> ExchangeResult<ExchangeServer> {
        self.ensure_auth().await?;
        health::ps_get_server(self.client()?, identity).await
    }

    pub async fn list_databases(
        &mut self,
        server: Option<String>,
    ) -> ExchangeResult<Vec<MailboxDatabase>> {
        self.ensure_auth().await?;
        health::ps_list_databases(self.client()?, server.as_deref()).await
    }

    pub async fn get_database(&mut self, identity: &str) -> ExchangeResult<MailboxDatabase> {
        self.ensure_auth().await?;
        health::ps_get_database(self.client()?, identity).await
    }

    pub async fn mount_database(&mut self, identity: &str) -> ExchangeResult<String> {
        self.ensure_auth().await?;
        health::ps_mount_database(self.client()?, identity).await
    }

    pub async fn dismount_database(&mut self, identity: &str) -> ExchangeResult<String> {
        self.ensure_auth().await?;
        health::ps_dismount_database(self.client()?, identity).await
    }

    pub async fn list_dags(&mut self) -> ExchangeResult<Vec<DatabaseAvailabilityGroup>> {
        self.ensure_auth().await?;
        health::ps_list_dags(self.client()?).await
    }

    pub async fn get_dag(
        &mut self,
        identity: &str,
    ) -> ExchangeResult<DatabaseAvailabilityGroup> {
        self.ensure_auth().await?;
        health::ps_get_dag(self.client()?, identity).await
    }

    pub async fn get_dag_copy_status(
        &mut self,
        server: Option<String>,
        database: Option<String>,
    ) -> ExchangeResult<Vec<DagReplicationStatus>> {
        self.ensure_auth().await?;
        health::ps_get_dag_copy_status(
            self.client()?,
            server.as_deref(),
            database.as_deref(),
        )
        .await
    }

    pub async fn test_replication_health(
        &mut self,
        server: &str,
    ) -> ExchangeResult<Vec<serde_json::Value>> {
        self.ensure_auth().await?;
        health::ps_test_replication_health(self.client()?, server).await
    }

    pub async fn service_health(&mut self) -> ExchangeResult<Vec<ServiceHealthStatus>> {
        self.ensure_auth().await?;
        health::graph_service_health(self.client()?).await
    }

    pub async fn service_issues(&mut self) -> ExchangeResult<Vec<serde_json::Value>> {
        self.ensure_auth().await?;
        health::graph_service_issues(self.client()?).await
    }

    pub async fn test_mailflow(
        &mut self,
        target: Option<String>,
    ) -> ExchangeResult<serde_json::Value> {
        self.ensure_auth().await?;
        health::ps_test_mailflow(self.client()?, target.as_deref()).await
    }

    pub async fn test_service_health(
        &mut self,
        server: &str,
    ) -> ExchangeResult<Vec<serde_json::Value>> {
        self.ensure_auth().await?;
        health::ps_test_service_health(self.client()?, server).await
    }

    pub async fn get_server_component_state(
        &mut self,
        server: &str,
    ) -> ExchangeResult<Vec<ServerComponentState>> {
        self.ensure_auth().await?;
        health::ps_get_server_component_state(self.client()?, server).await
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Mail Contacts & Mail Users
    // ═══════════════════════════════════════════════════════════════════════

    pub async fn list_mail_contacts(
        &mut self,
        result_size: Option<i32>,
    ) -> ExchangeResult<Vec<MailContact>> {
        self.ensure_auth().await?;
        let c = self.client()?;
        match self.config.as_ref().map(|c| &c.environment) {
            Some(ExchangeEnvironment::Online) => contacts::graph_list_contacts(c).await,
            _ => contacts::ps_list_mail_contacts(c, result_size).await,
        }
    }

    pub async fn get_mail_contact(&mut self, identity: &str) -> ExchangeResult<MailContact> {
        self.ensure_auth().await?;
        contacts::ps_get_mail_contact(self.client()?, identity).await
    }

    pub async fn create_mail_contact(
        &mut self,
        req: CreateMailContactRequest,
    ) -> ExchangeResult<MailContact> {
        self.ensure_auth().await?;
        contacts::ps_create_mail_contact(self.client()?, &req).await
    }

    pub async fn update_mail_contact(
        &mut self,
        identity: &str,
        params: serde_json::Value,
    ) -> ExchangeResult<String> {
        self.ensure_auth().await?;
        contacts::ps_update_mail_contact(self.client()?, identity, &params).await
    }

    pub async fn remove_mail_contact(&mut self, identity: &str) -> ExchangeResult<String> {
        self.ensure_auth().await?;
        contacts::ps_remove_mail_contact(self.client()?, identity).await
    }

    pub async fn list_mail_users(
        &mut self,
        result_size: Option<i32>,
    ) -> ExchangeResult<Vec<MailUser>> {
        self.ensure_auth().await?;
        contacts::ps_list_mail_users(self.client()?, result_size).await
    }

    pub async fn get_mail_user(&mut self, identity: &str) -> ExchangeResult<MailUser> {
        self.ensure_auth().await?;
        contacts::ps_get_mail_user(self.client()?, identity).await
    }

    pub async fn create_mail_user(&mut self, req: CreateMailUserRequest) -> ExchangeResult<MailUser> {
        self.ensure_auth().await?;
        contacts::ps_create_mail_user(self.client()?, &req).await
    }

    pub async fn remove_mail_user(&mut self, identity: &str) -> ExchangeResult<String> {
        self.ensure_auth().await?;
        contacts::ps_remove_mail_user(self.client()?, identity).await
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Shared Mailboxes & Resource Mailboxes
    // ═══════════════════════════════════════════════════════════════════════

    pub async fn convert_mailbox(
        &mut self,
        identity: &str,
        target_type: &str,
    ) -> ExchangeResult<String> {
        self.ensure_auth().await?;
        shared_mailbox::ps_convert_mailbox(self.client()?, identity, target_type).await
    }

    pub async fn list_shared_mailboxes(&mut self) -> ExchangeResult<Vec<Mailbox>> {
        self.ensure_auth().await?;
        shared_mailbox::ps_list_shared_mailboxes(self.client()?).await
    }

    pub async fn list_room_mailboxes(&mut self) -> ExchangeResult<Vec<Mailbox>> {
        self.ensure_auth().await?;
        shared_mailbox::ps_list_room_mailboxes(self.client()?).await
    }

    pub async fn list_equipment_mailboxes(&mut self) -> ExchangeResult<Vec<Mailbox>> {
        self.ensure_auth().await?;
        shared_mailbox::ps_list_equipment_mailboxes(self.client()?).await
    }

    pub async fn add_automapping(
        &mut self,
        mailbox: &str,
        user: &str,
    ) -> ExchangeResult<String> {
        self.ensure_auth().await?;
        shared_mailbox::ps_add_automapping(self.client()?, mailbox, user).await
    }

    pub async fn remove_automapping(
        &mut self,
        mailbox: &str,
        user: &str,
    ) -> ExchangeResult<String> {
        self.ensure_auth().await?;
        shared_mailbox::ps_remove_automapping(self.client()?, mailbox, user).await
    }

    pub async fn add_send_as(
        &mut self,
        mailbox: &str,
        trustee: &str,
    ) -> ExchangeResult<String> {
        self.ensure_auth().await?;
        shared_mailbox::ps_add_send_as(self.client()?, mailbox, trustee).await
    }

    pub async fn remove_send_as(
        &mut self,
        mailbox: &str,
        trustee: &str,
    ) -> ExchangeResult<String> {
        self.ensure_auth().await?;
        shared_mailbox::ps_remove_send_as(self.client()?, mailbox, trustee).await
    }

    pub async fn add_send_on_behalf(
        &mut self,
        mailbox: &str,
        trustee: &str,
    ) -> ExchangeResult<String> {
        self.ensure_auth().await?;
        shared_mailbox::ps_add_send_on_behalf(self.client()?, mailbox, trustee).await
    }

    pub async fn remove_send_on_behalf(
        &mut self,
        mailbox: &str,
        trustee: &str,
    ) -> ExchangeResult<String> {
        self.ensure_auth().await?;
        shared_mailbox::ps_remove_send_on_behalf(self.client()?, mailbox, trustee).await
    }

    pub async fn list_room_lists(&mut self) -> ExchangeResult<Vec<serde_json::Value>> {
        self.ensure_auth().await?;
        shared_mailbox::ps_list_room_lists(self.client()?).await
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Archive Mailboxes
    // ═══════════════════════════════════════════════════════════════════════

    pub async fn get_archive_info(
        &mut self,
        identity: &str,
    ) -> ExchangeResult<ArchiveMailboxInfo> {
        self.ensure_auth().await?;
        archive::ps_get_archive_info(self.client()?, identity).await
    }

    pub async fn enable_archive(&mut self, identity: &str) -> ExchangeResult<String> {
        self.ensure_auth().await?;
        archive::ps_enable_archive(self.client()?, identity).await
    }

    pub async fn disable_archive(&mut self, identity: &str) -> ExchangeResult<String> {
        self.ensure_auth().await?;
        archive::ps_disable_archive(self.client()?, identity).await
    }

    pub async fn enable_auto_expanding_archive(
        &mut self,
        identity: &str,
    ) -> ExchangeResult<String> {
        self.ensure_auth().await?;
        archive::ps_enable_auto_expanding_archive(self.client()?, identity).await
    }

    pub async fn set_archive_quota(
        &mut self,
        identity: &str,
        quota: &str,
        warning_quota: Option<String>,
    ) -> ExchangeResult<String> {
        self.ensure_auth().await?;
        archive::ps_set_archive_quota(
            self.client()?,
            identity,
            quota,
            warning_quota.as_deref(),
        )
        .await
    }

    pub async fn get_archive_statistics(
        &mut self,
        identity: &str,
    ) -> ExchangeResult<ArchiveStatistics> {
        self.ensure_auth().await?;
        archive::ps_get_archive_statistics(self.client()?, identity).await
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Mobile Devices
    // ═══════════════════════════════════════════════════════════════════════

    pub async fn list_mobile_devices(
        &mut self,
        mailbox: &str,
    ) -> ExchangeResult<Vec<MobileDevice>> {
        self.ensure_auth().await?;
        mobile_devices::ps_list_mobile_devices(self.client()?, mailbox).await
    }

    pub async fn get_mobile_device_statistics(
        &mut self,
        identity: &str,
    ) -> ExchangeResult<MobileDeviceStatistics> {
        self.ensure_auth().await?;
        mobile_devices::ps_get_mobile_device_statistics(self.client()?, identity).await
    }

    pub async fn wipe_mobile_device(&mut self, identity: &str) -> ExchangeResult<String> {
        self.ensure_auth().await?;
        mobile_devices::ps_wipe_mobile_device(self.client()?, identity).await
    }

    pub async fn block_mobile_device(&mut self, identity: &str) -> ExchangeResult<String> {
        self.ensure_auth().await?;
        mobile_devices::ps_block_mobile_device(self.client()?, identity).await
    }

    pub async fn allow_mobile_device(&mut self, identity: &str) -> ExchangeResult<String> {
        self.ensure_auth().await?;
        mobile_devices::ps_allow_mobile_device(self.client()?, identity).await
    }

    pub async fn remove_mobile_device(&mut self, identity: &str) -> ExchangeResult<String> {
        self.ensure_auth().await?;
        mobile_devices::ps_remove_mobile_device(self.client()?, identity).await
    }

    pub async fn list_all_mobile_devices(&mut self) -> ExchangeResult<Vec<MobileDevice>> {
        self.ensure_auth().await?;
        mobile_devices::ps_list_all_mobile_devices(self.client()?).await
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Inbox Rules
    // ═══════════════════════════════════════════════════════════════════════

    pub async fn list_inbox_rules(
        &mut self,
        mailbox: &str,
    ) -> ExchangeResult<Vec<InboxRule>> {
        self.ensure_auth().await?;
        inbox_rules::ps_list_inbox_rules(self.client()?, mailbox).await
    }

    pub async fn get_inbox_rule(
        &mut self,
        mailbox: &str,
        rule_id: &str,
    ) -> ExchangeResult<InboxRule> {
        self.ensure_auth().await?;
        inbox_rules::ps_get_inbox_rule(self.client()?, mailbox, rule_id).await
    }

    pub async fn create_inbox_rule(
        &mut self,
        req: CreateInboxRuleRequest,
    ) -> ExchangeResult<InboxRule> {
        self.ensure_auth().await?;
        inbox_rules::ps_create_inbox_rule(self.client()?, &req).await
    }

    pub async fn update_inbox_rule(
        &mut self,
        mailbox: &str,
        rule_id: &str,
        params: serde_json::Value,
    ) -> ExchangeResult<String> {
        self.ensure_auth().await?;
        inbox_rules::ps_update_inbox_rule(self.client()?, mailbox, rule_id, &params).await
    }

    pub async fn remove_inbox_rule(
        &mut self,
        mailbox: &str,
        rule_id: &str,
    ) -> ExchangeResult<String> {
        self.ensure_auth().await?;
        inbox_rules::ps_remove_inbox_rule(self.client()?, mailbox, rule_id).await
    }

    pub async fn enable_inbox_rule(
        &mut self,
        mailbox: &str,
        rule_id: &str,
    ) -> ExchangeResult<String> {
        self.ensure_auth().await?;
        inbox_rules::ps_enable_inbox_rule(self.client()?, mailbox, rule_id).await
    }

    pub async fn disable_inbox_rule(
        &mut self,
        mailbox: &str,
        rule_id: &str,
    ) -> ExchangeResult<String> {
        self.ensure_auth().await?;
        inbox_rules::ps_disable_inbox_rule(self.client()?, mailbox, rule_id).await
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Policies (OWA, Mobile Device, Throttling)
    // ═══════════════════════════════════════════════════════════════════════

    pub async fn list_owa_policies(&mut self) -> ExchangeResult<Vec<OwaMailboxPolicy>> {
        self.ensure_auth().await?;
        policies::ps_list_owa_policies(self.client()?).await
    }

    pub async fn get_owa_policy(
        &mut self,
        identity: &str,
    ) -> ExchangeResult<OwaMailboxPolicy> {
        self.ensure_auth().await?;
        policies::ps_get_owa_policy(self.client()?, identity).await
    }

    pub async fn set_owa_policy(
        &mut self,
        identity: &str,
        params: serde_json::Value,
    ) -> ExchangeResult<String> {
        self.ensure_auth().await?;
        policies::ps_set_owa_policy(self.client()?, identity, &params).await
    }

    pub async fn list_mobile_device_policies(
        &mut self,
    ) -> ExchangeResult<Vec<MobileDeviceMailboxPolicy>> {
        self.ensure_auth().await?;
        policies::ps_list_mobile_device_policies(self.client()?).await
    }

    pub async fn get_mobile_device_policy(
        &mut self,
        identity: &str,
    ) -> ExchangeResult<MobileDeviceMailboxPolicy> {
        self.ensure_auth().await?;
        policies::ps_get_mobile_device_policy(self.client()?, identity).await
    }

    pub async fn set_mobile_device_policy(
        &mut self,
        identity: &str,
        params: serde_json::Value,
    ) -> ExchangeResult<String> {
        self.ensure_auth().await?;
        policies::ps_set_mobile_device_policy(self.client()?, identity, &params).await
    }

    pub async fn list_throttling_policies(&mut self) -> ExchangeResult<Vec<ThrottlingPolicy>> {
        self.ensure_auth().await?;
        policies::ps_list_throttling_policies(self.client()?).await
    }

    pub async fn get_throttling_policy(
        &mut self,
        identity: &str,
    ) -> ExchangeResult<ThrottlingPolicy> {
        self.ensure_auth().await?;
        policies::ps_get_throttling_policy(self.client()?, identity).await
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Journal Rules
    // ═══════════════════════════════════════════════════════════════════════

    pub async fn list_journal_rules(&mut self) -> ExchangeResult<Vec<JournalRule>> {
        self.ensure_auth().await?;
        journal_rules::ps_list_journal_rules(self.client()?).await
    }

    pub async fn get_journal_rule(&mut self, identity: &str) -> ExchangeResult<JournalRule> {
        self.ensure_auth().await?;
        journal_rules::ps_get_journal_rule(self.client()?, identity).await
    }

    pub async fn create_journal_rule(
        &mut self,
        req: CreateJournalRuleRequest,
    ) -> ExchangeResult<JournalRule> {
        self.ensure_auth().await?;
        journal_rules::ps_create_journal_rule(self.client()?, &req).await
    }

    pub async fn remove_journal_rule(&mut self, identity: &str) -> ExchangeResult<String> {
        self.ensure_auth().await?;
        journal_rules::ps_remove_journal_rule(self.client()?, identity).await
    }

    pub async fn enable_journal_rule(&mut self, identity: &str) -> ExchangeResult<String> {
        self.ensure_auth().await?;
        journal_rules::ps_enable_journal_rule(self.client()?, identity).await
    }

    pub async fn disable_journal_rule(&mut self, identity: &str) -> ExchangeResult<String> {
        self.ensure_auth().await?;
        journal_rules::ps_disable_journal_rule(self.client()?, identity).await
    }

    // ═══════════════════════════════════════════════════════════════════════
    // RBAC & Audit
    // ═══════════════════════════════════════════════════════════════════════

    pub async fn list_role_groups(&mut self) -> ExchangeResult<Vec<RoleGroup>> {
        self.ensure_auth().await?;
        rbac_audit::ps_list_role_groups(self.client()?).await
    }

    pub async fn get_role_group(&mut self, identity: &str) -> ExchangeResult<RoleGroup> {
        self.ensure_auth().await?;
        rbac_audit::ps_get_role_group(self.client()?, identity).await
    }

    pub async fn add_role_group_member(
        &mut self,
        group: &str,
        member: &str,
    ) -> ExchangeResult<String> {
        self.ensure_auth().await?;
        rbac_audit::ps_add_role_group_member(self.client()?, group, member).await
    }

    pub async fn remove_role_group_member(
        &mut self,
        group: &str,
        member: &str,
    ) -> ExchangeResult<String> {
        self.ensure_auth().await?;
        rbac_audit::ps_remove_role_group_member(self.client()?, group, member).await
    }

    pub async fn list_management_roles(&mut self) -> ExchangeResult<Vec<ManagementRole>> {
        self.ensure_auth().await?;
        rbac_audit::ps_list_management_roles(self.client()?).await
    }

    pub async fn get_management_role(
        &mut self,
        identity: &str,
    ) -> ExchangeResult<ManagementRole> {
        self.ensure_auth().await?;
        rbac_audit::ps_get_management_role(self.client()?, identity).await
    }

    pub async fn list_role_assignments(
        &mut self,
        role: Option<String>,
        role_assignee: Option<String>,
    ) -> ExchangeResult<Vec<ManagementRoleAssignment>> {
        self.ensure_auth().await?;
        rbac_audit::ps_list_role_assignments(
            self.client()?,
            role.as_deref(),
            role_assignee.as_deref(),
        )
        .await
    }

    pub async fn search_admin_audit_log(
        &mut self,
        req: AdminAuditLogSearchRequest,
    ) -> ExchangeResult<Vec<AdminAuditLogEntry>> {
        self.ensure_auth().await?;
        rbac_audit::ps_search_admin_audit_log(self.client()?, &req).await
    }

    pub async fn get_admin_audit_log_config(
        &mut self,
    ) -> ExchangeResult<serde_json::Value> {
        self.ensure_auth().await?;
        rbac_audit::ps_get_admin_audit_log_config(self.client()?).await
    }

    pub async fn search_mailbox_audit_log(
        &mut self,
        mailbox: &str,
        start_date: Option<String>,
        end_date: Option<String>,
    ) -> ExchangeResult<Vec<MailboxAuditLogEntry>> {
        self.ensure_auth().await?;
        rbac_audit::ps_search_mailbox_audit_log(
            self.client()?,
            mailbox,
            start_date.as_deref(),
            end_date.as_deref(),
        )
        .await
    }

    pub async fn enable_mailbox_audit(
        &mut self,
        identity: &str,
    ) -> ExchangeResult<String> {
        self.ensure_auth().await?;
        rbac_audit::ps_enable_mailbox_audit(self.client()?, identity).await
    }

    pub async fn disable_mailbox_audit(
        &mut self,
        identity: &str,
    ) -> ExchangeResult<String> {
        self.ensure_auth().await?;
        rbac_audit::ps_disable_mailbox_audit(self.client()?, identity).await
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Remote Domains
    // ═══════════════════════════════════════════════════════════════════════

    pub async fn list_remote_domains(&mut self) -> ExchangeResult<Vec<RemoteDomain>> {
        self.ensure_auth().await?;
        remote_domains::ps_list_remote_domains(self.client()?).await
    }

    pub async fn get_remote_domain(&mut self, identity: &str) -> ExchangeResult<RemoteDomain> {
        self.ensure_auth().await?;
        remote_domains::ps_get_remote_domain(self.client()?, identity).await
    }

    pub async fn create_remote_domain(
        &mut self,
        req: CreateRemoteDomainRequest,
    ) -> ExchangeResult<RemoteDomain> {
        self.ensure_auth().await?;
        remote_domains::ps_create_remote_domain(self.client()?, &req).await
    }

    pub async fn update_remote_domain(
        &mut self,
        identity: &str,
        params: serde_json::Value,
    ) -> ExchangeResult<String> {
        self.ensure_auth().await?;
        remote_domains::ps_update_remote_domain(self.client()?, identity, &params).await
    }

    pub async fn remove_remote_domain(&mut self, identity: &str) -> ExchangeResult<String> {
        self.ensure_auth().await?;
        remote_domains::ps_remove_remote_domain(self.client()?, identity).await
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Certificates
    // ═══════════════════════════════════════════════════════════════════════

    pub async fn list_certificates(
        &mut self,
        server: Option<String>,
    ) -> ExchangeResult<Vec<ExchangeCertificate>> {
        self.ensure_auth().await?;
        certificates::ps_list_certificates(self.client()?, server.as_deref()).await
    }

    pub async fn get_certificate(
        &mut self,
        thumbprint: &str,
        server: Option<String>,
    ) -> ExchangeResult<ExchangeCertificate> {
        self.ensure_auth().await?;
        certificates::ps_get_certificate(self.client()?, thumbprint, server.as_deref()).await
    }

    pub async fn enable_certificate(
        &mut self,
        thumbprint: &str,
        services: &str,
        server: Option<String>,
    ) -> ExchangeResult<String> {
        self.ensure_auth().await?;
        certificates::ps_enable_certificate(
            self.client()?,
            thumbprint,
            services,
            server.as_deref(),
        )
        .await
    }

    pub async fn import_certificate(
        &mut self,
        file_path: &str,
        password: Option<String>,
        server: Option<String>,
    ) -> ExchangeResult<String> {
        self.ensure_auth().await?;
        certificates::ps_import_certificate(
            self.client()?,
            file_path,
            password.as_deref(),
            server.as_deref(),
        )
        .await
    }

    pub async fn remove_certificate(
        &mut self,
        thumbprint: &str,
        server: Option<String>,
    ) -> ExchangeResult<String> {
        self.ensure_auth().await?;
        certificates::ps_remove_certificate(self.client()?, thumbprint, server.as_deref()).await
    }

    pub async fn new_certificate_request(
        &mut self,
        subject_name: &str,
        domain_names: &[String],
        server: Option<String>,
    ) -> ExchangeResult<String> {
        self.ensure_auth().await?;
        certificates::ps_new_certificate_request(
            self.client()?,
            subject_name,
            domain_names,
            server.as_deref(),
        )
        .await
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Virtual Directories & Organization Config
    // ═══════════════════════════════════════════════════════════════════════

    pub async fn list_owa_virtual_directories(
        &mut self,
        server: Option<String>,
    ) -> ExchangeResult<Vec<VirtualDirectory>> {
        self.ensure_auth().await?;
        org_config::ps_list_owa_virtual_directories(self.client()?, server.as_deref()).await
    }

    pub async fn list_ecp_virtual_directories(
        &mut self,
        server: Option<String>,
    ) -> ExchangeResult<Vec<VirtualDirectory>> {
        self.ensure_auth().await?;
        org_config::ps_list_ecp_virtual_directories(self.client()?, server.as_deref()).await
    }

    pub async fn list_activesync_virtual_directories(
        &mut self,
        server: Option<String>,
    ) -> ExchangeResult<Vec<VirtualDirectory>> {
        self.ensure_auth().await?;
        org_config::ps_list_activesync_virtual_directories(self.client()?, server.as_deref()).await
    }

    pub async fn list_ews_virtual_directories(
        &mut self,
        server: Option<String>,
    ) -> ExchangeResult<Vec<VirtualDirectory>> {
        self.ensure_auth().await?;
        org_config::ps_list_ews_virtual_directories(self.client()?, server.as_deref()).await
    }

    pub async fn list_mapi_virtual_directories(
        &mut self,
        server: Option<String>,
    ) -> ExchangeResult<Vec<VirtualDirectory>> {
        self.ensure_auth().await?;
        org_config::ps_list_mapi_virtual_directories(self.client()?, server.as_deref()).await
    }

    pub async fn list_autodiscover_virtual_directories(
        &mut self,
        server: Option<String>,
    ) -> ExchangeResult<Vec<VirtualDirectory>> {
        self.ensure_auth().await?;
        org_config::ps_list_autodiscover_virtual_directories(self.client()?, server.as_deref())
            .await
    }

    pub async fn list_powershell_virtual_directories(
        &mut self,
        server: Option<String>,
    ) -> ExchangeResult<Vec<VirtualDirectory>> {
        self.ensure_auth().await?;
        org_config::ps_list_powershell_virtual_directories(self.client()?, server.as_deref()).await
    }

    pub async fn list_oab_virtual_directories(
        &mut self,
        server: Option<String>,
    ) -> ExchangeResult<Vec<VirtualDirectory>> {
        self.ensure_auth().await?;
        org_config::ps_list_oab_virtual_directories(self.client()?, server.as_deref()).await
    }

    pub async fn set_virtual_directory_urls(
        &mut self,
        vdir_type: VirtualDirectoryType,
        identity: &str,
        internal_url: Option<String>,
        external_url: Option<String>,
    ) -> ExchangeResult<String> {
        self.ensure_auth().await?;
        org_config::ps_set_virtual_directory_urls(
            self.client()?,
            &vdir_type,
            identity,
            internal_url.as_deref(),
            external_url.as_deref(),
        )
        .await
    }

    pub async fn list_outlook_anywhere(
        &mut self,
        server: Option<String>,
    ) -> ExchangeResult<Vec<VirtualDirectory>> {
        self.ensure_auth().await?;
        org_config::ps_list_outlook_anywhere(self.client()?, server.as_deref()).await
    }

    pub async fn get_organization_config(&mut self) -> ExchangeResult<OrganizationConfig> {
        self.ensure_auth().await?;
        org_config::ps_get_organization_config(self.client()?).await
    }

    pub async fn set_organization_config(
        &mut self,
        params: serde_json::Value,
    ) -> ExchangeResult<String> {
        self.ensure_auth().await?;
        org_config::ps_set_organization_config(self.client()?, &params).await
    }

    pub async fn get_transport_config(&mut self) -> ExchangeResult<TransportConfig> {
        self.ensure_auth().await?;
        org_config::ps_get_transport_config(self.client()?).await
    }

    pub async fn set_transport_config(
        &mut self,
        params: serde_json::Value,
    ) -> ExchangeResult<String> {
        self.ensure_auth().await?;
        org_config::ps_set_transport_config(self.client()?, &params).await
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Anti-Spam & Hygiene
    // ═══════════════════════════════════════════════════════════════════════

    pub async fn get_content_filter_config(&mut self) -> ExchangeResult<ContentFilterConfig> {
        self.ensure_auth().await?;
        hygiene::ps_get_content_filter_config(self.client()?).await
    }

    pub async fn set_content_filter_config(
        &mut self,
        params: serde_json::Value,
    ) -> ExchangeResult<String> {
        self.ensure_auth().await?;
        hygiene::ps_set_content_filter_config(self.client()?, &params).await
    }

    pub async fn get_connection_filter_config(
        &mut self,
    ) -> ExchangeResult<ConnectionFilterConfig> {
        self.ensure_auth().await?;
        hygiene::ps_get_connection_filter_config(self.client()?).await
    }

    pub async fn set_connection_filter_config(
        &mut self,
        params: serde_json::Value,
    ) -> ExchangeResult<String> {
        self.ensure_auth().await?;
        hygiene::ps_set_connection_filter_config(self.client()?, &params).await
    }

    pub async fn get_sender_filter_config(&mut self) -> ExchangeResult<SenderFilterConfig> {
        self.ensure_auth().await?;
        hygiene::ps_get_sender_filter_config(self.client()?).await
    }

    pub async fn set_sender_filter_config(
        &mut self,
        params: serde_json::Value,
    ) -> ExchangeResult<String> {
        self.ensure_auth().await?;
        hygiene::ps_set_sender_filter_config(self.client()?, &params).await
    }

    pub async fn list_quarantine_messages(
        &mut self,
        page_size: Option<i32>,
        quarantine_type: Option<String>,
    ) -> ExchangeResult<Vec<QuarantineMessage>> {
        self.ensure_auth().await?;
        hygiene::ps_list_quarantine_messages(
            self.client()?,
            page_size,
            quarantine_type.as_deref(),
        )
        .await
    }

    pub async fn get_quarantine_message(
        &mut self,
        identity: &str,
    ) -> ExchangeResult<QuarantineMessage> {
        self.ensure_auth().await?;
        hygiene::ps_get_quarantine_message(self.client()?, identity).await
    }

    pub async fn release_quarantine_message(
        &mut self,
        identity: &str,
        release_to_all: bool,
    ) -> ExchangeResult<String> {
        self.ensure_auth().await?;
        hygiene::ps_release_quarantine_message(self.client()?, identity, release_to_all).await
    }

    pub async fn delete_quarantine_message(
        &mut self,
        identity: &str,
    ) -> ExchangeResult<String> {
        self.ensure_auth().await?;
        hygiene::ps_delete_quarantine_message(self.client()?, identity).await
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Mailbox Import / Export (PST)
    // ═══════════════════════════════════════════════════════════════════════

    pub async fn new_mailbox_import_request(
        &mut self,
        mailbox: &str,
        file_path: &str,
        target_root_folder: Option<String>,
    ) -> ExchangeResult<String> {
        self.ensure_auth().await?;
        hygiene::ps_new_mailbox_import_request(
            self.client()?,
            mailbox,
            file_path,
            target_root_folder.as_deref(),
        )
        .await
    }

    pub async fn new_mailbox_export_request(
        &mut self,
        mailbox: &str,
        file_path: &str,
        include_folders: Option<Vec<String>>,
        exclude_folders: Option<Vec<String>>,
    ) -> ExchangeResult<String> {
        self.ensure_auth().await?;
        hygiene::ps_new_mailbox_export_request(
            self.client()?,
            mailbox,
            file_path,
            include_folders.as_deref(),
            exclude_folders.as_deref(),
        )
        .await
    }

    pub async fn list_mailbox_import_requests(
        &mut self,
        mailbox: Option<String>,
    ) -> ExchangeResult<Vec<MailboxImportExportRequest>> {
        self.ensure_auth().await?;
        hygiene::ps_list_mailbox_import_requests(self.client()?, mailbox.as_deref()).await
    }

    pub async fn list_mailbox_export_requests(
        &mut self,
        mailbox: Option<String>,
    ) -> ExchangeResult<Vec<MailboxImportExportRequest>> {
        self.ensure_auth().await?;
        hygiene::ps_list_mailbox_export_requests(self.client()?, mailbox.as_deref()).await
    }

    pub async fn remove_mailbox_import_request(
        &mut self,
        identity: &str,
    ) -> ExchangeResult<String> {
        self.ensure_auth().await?;
        hygiene::ps_remove_mailbox_import_request(self.client()?, identity).await
    }

    pub async fn remove_mailbox_export_request(
        &mut self,
        identity: &str,
    ) -> ExchangeResult<String> {
        self.ensure_auth().await?;
        hygiene::ps_remove_mailbox_export_request(self.client()?, identity).await
    }
}
