//! High-level orchestrator — owns sessions, delegates to McApiClient.
//! Exposes the methods that `commands.rs` delegates to.

use crate::meshcentral::api_client::McApiClient;
use crate::meshcentral::error::{MeshCentralError, MeshCentralResult};
use crate::meshcentral::files::McFileTransferTracker;
use crate::meshcentral::types::*;
use log::info;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

/// Thread-safe state managed by Tauri.
pub type MeshCentralServiceState = Arc<Mutex<MeshCentralService>>;

pub struct MeshCentralService {
    /// Active sessions keyed by session label.
    pub sessions: HashMap<String, (McSession, McApiClient)>,
    /// File transfer progress tracker.
    pub transfers: McFileTransferTracker,
}

impl MeshCentralService {
    /// Create a new service wrapped in `Arc<Mutex<_>>` for Tauri state.
    pub fn new() -> MeshCentralServiceState {
        Arc::new(Mutex::new(MeshCentralService {
            sessions: HashMap::new(),
            transfers: McFileTransferTracker::new(),
        }))
    }

    // ─── Connection lifecycle ────────────────────────────────────

    /// Connect to a MeshCentral server.
    pub async fn connect(
        &mut self,
        config: McConnectionConfig,
    ) -> MeshCentralResult<McSession> {
        info!("MeshCentral connecting to {}", config.server_url);

        // Extract username from auth config before borrowing config
        let username = match &config.auth {
            McAuthConfig::Password { username, .. } => username.clone(),
            McAuthConfig::LoginToken { token_user, .. } => token_user.clone(),
            McAuthConfig::LoginKey { username, .. } => {
                username.clone().unwrap_or_else(|| "admin".to_string())
            }
        };
        let domain = config.domain.clone();
        let server_url = config.server_url.clone();

        let client = McApiClient::new(&config)?;

        // Verify connection by fetching server info
        let server_info = client.server_info().await.ok();

        let session = McSession {
            id: uuid::Uuid::new_v4().to_string(),
            server_url: client.base_url.clone(),
            username,
            domain,
            connected_at: chrono::Utc::now(),
            authenticated: true,
            server_info: server_info.clone(),
        };

        self.sessions
            .insert(session.id.clone(), (session.clone(), client));

        info!(
            "MeshCentral session {} established for {}",
            session.id, server_url
        );
        Ok(session)
    }

    /// Disconnect a session.
    pub async fn disconnect(&mut self, session_id: &str) -> MeshCentralResult<()> {
        if self.sessions.remove(session_id).is_some() {
            info!("MeshCentral session {} disconnected", session_id);
            Ok(())
        } else {
            Err(MeshCentralError::SessionNotFound(
                session_id.to_string(),
            ))
        }
    }

    /// Disconnect all sessions.
    pub async fn disconnect_all(&mut self) -> MeshCentralResult<()> {
        let count = self.sessions.len();
        self.sessions.clear();
        info!("MeshCentral: disconnected {} session(s)", count);
        Ok(())
    }

    /// Get session info.
    pub fn get_session_info(
        &self,
        session_id: &str,
    ) -> MeshCentralResult<McSession> {
        self.sessions
            .get(session_id)
            .map(|(s, _)| s.clone())
            .ok_or_else(|| {
                MeshCentralError::SessionNotFound(session_id.to_string())
            })
    }

    /// List all active sessions.
    pub fn list_sessions(&self) -> Vec<McSession> {
        self.sessions.values().map(|(s, _)| s.clone()).collect()
    }

    /// Ping a session to verify it is still alive.
    pub async fn ping(
        &mut self,
        session_id: &str,
    ) -> MeshCentralResult<bool> {
        let (_, client) = self.get_client(session_id)?;
        match client.ping().await {
            Ok(_) => Ok(true),
            Err(_) => Ok(false),
        }
    }

    // ─── Internal helper ─────────────────────────────────────────

    /// Get a mutable reference to the client for a session.
    fn get_client(
        &mut self,
        session_id: &str,
    ) -> MeshCentralResult<&mut (McSession, McApiClient)> {
        self.sessions.get_mut(session_id).ok_or_else(|| {
            MeshCentralError::SessionNotFound(session_id.to_string())
        })
    }

    /// Get an immutable reference to the client for a session.
    fn get_client_ref(
        &self,
        session_id: &str,
    ) -> MeshCentralResult<&(McSession, McApiClient)> {
        self.sessions.get(session_id).ok_or_else(|| {
            MeshCentralError::SessionNotFound(session_id.to_string())
        })
    }

    // ─── Server ──────────────────────────────────────────────────

    /// Get server information.
    pub async fn get_server_info(
        &self,
        session_id: &str,
    ) -> MeshCentralResult<McServerInfo> {
        let (_, client) = self.get_client_ref(session_id)?;
        client.server_info().await
    }

    /// Get the server version.
    pub async fn get_server_version(
        &self,
        session_id: &str,
    ) -> MeshCentralResult<String> {
        let (_, client) = self.get_client_ref(session_id)?;
        let info = client.server_info().await?;
        Ok(info.version)
    }

    /// Health check the server.
    pub async fn health_check(
        &self,
        session_id: &str,
    ) -> MeshCentralResult<bool> {
        let (_, client) = self.get_client_ref(session_id)?;
        client.health_check().await
    }

    // ─── Devices ─────────────────────────────────────────────────

    /// List devices.
    pub async fn list_devices(
        &self,
        session_id: &str,
        filter: Option<&McDeviceFilter>,
    ) -> MeshCentralResult<Vec<McDevice>> {
        let (_, client) = self.get_client_ref(session_id)?;
        client.list_devices(filter.cloned()).await
    }

    /// Get device info.
    pub async fn get_device_info(
        &self,
        session_id: &str,
        node_id: &str,
    ) -> MeshCentralResult<McDevice> {
        let (_, client) = self.get_client_ref(session_id)?;
        let info = client.get_device_info(node_id).await?;
        info.device.ok_or_else(|| {
            MeshCentralError::DeviceNotFound(node_id.to_string())
        })
    }

    /// Add a local device.
    pub async fn add_local_device(
        &self,
        session_id: &str,
        device: &McAddLocalDevice,
    ) -> MeshCentralResult<String> {
        let (_, client) = self.get_client_ref(session_id)?;
        client.add_local_device(device.clone()).await
    }

    /// Add an AMT device.
    pub async fn add_amt_device(
        &self,
        session_id: &str,
        device: &McAddAmtDevice,
    ) -> MeshCentralResult<String> {
        let (_, client) = self.get_client_ref(session_id)?;
        client.add_amt_device(device.clone()).await
    }

    /// Edit a device.
    pub async fn edit_device(
        &self,
        session_id: &str,
        edit: &McEditDevice,
    ) -> MeshCentralResult<String> {
        let (_, client) = self.get_client_ref(session_id)?;
        client.edit_device(edit.clone()).await
    }

    /// Remove devices.
    pub async fn remove_devices(
        &self,
        session_id: &str,
        node_ids: &[String],
    ) -> MeshCentralResult<String> {
        let (_, client) = self.get_client_ref(session_id)?;
        client.remove_devices(node_ids.to_vec()).await
    }

    /// Move a device to a different group.
    pub async fn move_device_to_group(
        &self,
        session_id: &str,
        node_id: &str,
        mesh_id: &str,
    ) -> MeshCentralResult<String> {
        let (_, client) = self.get_client_ref(session_id)?;
        client.move_device_to_group(node_id, Some(mesh_id), None).await
    }

    // ─── Device Groups ───────────────────────────────────────────

    /// List device groups.
    pub async fn list_device_groups(
        &self,
        session_id: &str,
    ) -> MeshCentralResult<Vec<McDeviceGroup>> {
        let (_, client) = self.get_client_ref(session_id)?;
        client.list_device_groups().await
    }

    /// Create a device group.
    pub async fn create_device_group(
        &self,
        session_id: &str,
        create: &McCreateDeviceGroup,
    ) -> MeshCentralResult<String> {
        let (_, client) = self.get_client_ref(session_id)?;
        client.create_device_group(create.clone()).await
    }

    /// Edit a device group.
    pub async fn edit_device_group(
        &self,
        session_id: &str,
        edit: &McEditDeviceGroup,
    ) -> MeshCentralResult<String> {
        let (_, client) = self.get_client_ref(session_id)?;
        client.edit_device_group(edit.clone()).await
    }

    /// Remove a device group.
    pub async fn remove_device_group(
        &self,
        session_id: &str,
        mesh_id: &str,
    ) -> MeshCentralResult<String> {
        let (_, client) = self.get_client_ref(session_id)?;
        client.remove_device_group(Some(mesh_id), None).await
    }

    // ─── Users ───────────────────────────────────────────────────

    /// List users.
    pub async fn list_users(
        &self,
        session_id: &str,
    ) -> MeshCentralResult<Vec<McUser>> {
        let (_, client) = self.get_client_ref(session_id)?;
        client.list_users().await
    }

    /// Add a user.
    pub async fn add_user(
        &self,
        session_id: &str,
        user: &McAddUser,
    ) -> MeshCentralResult<String> {
        let (_, client) = self.get_client_ref(session_id)?;
        client.add_user(user.clone()).await
    }

    /// Edit a user.
    pub async fn edit_user(
        &self,
        session_id: &str,
        edit: &McEditUser,
    ) -> MeshCentralResult<String> {
        let (_, client) = self.get_client_ref(session_id)?;
        client.edit_user(edit.clone()).await
    }

    /// Remove a user.
    pub async fn remove_user(
        &self,
        session_id: &str,
        user_id: &str,
    ) -> MeshCentralResult<String> {
        let (_, client) = self.get_client_ref(session_id)?;
        client.remove_user(user_id, None).await
    }

    // ─── User Groups ────────────────────────────────────────────

    /// List user groups.
    pub async fn list_user_groups(
        &self,
        session_id: &str,
    ) -> MeshCentralResult<Vec<McUserGroup>> {
        let (_, client) = self.get_client_ref(session_id)?;
        client.list_user_groups().await
    }

    /// Create a user group.
    pub async fn create_user_group(
        &self,
        session_id: &str,
        name: &str,
        desc: Option<&str>,
    ) -> MeshCentralResult<String> {
        let (_, client) = self.get_client_ref(session_id)?;
        client.create_user_group(name, desc, None).await
    }

    /// Remove a user group.
    pub async fn remove_user_group(
        &self,
        session_id: &str,
        group_id: &str,
    ) -> MeshCentralResult<String> {
        let (_, client) = self.get_client_ref(session_id)?;
        client.remove_user_group(group_id, None).await
    }

    // ─── Power ───────────────────────────────────────────────────

    /// Perform a power action on devices.
    pub async fn power_action(
        &self,
        session_id: &str,
        node_ids: &[String],
        action: McPowerAction,
    ) -> MeshCentralResult<String> {
        let (_, client) = self.get_client_ref(session_id)?;
        client.power_action(node_ids, action).await
    }

    /// Wake devices.
    pub async fn wake_devices(
        &self,
        session_id: &str,
        node_ids: &[String],
    ) -> MeshCentralResult<String> {
        let (_, client) = self.get_client_ref(session_id)?;
        client.wake_devices(node_ids).await
    }

    // ─── Remote Commands ─────────────────────────────────────────

    /// Run commands on devices.
    pub async fn run_commands(
        &self,
        session_id: &str,
        cmd: &McRunCommand,
    ) -> MeshCentralResult<McCommandResult> {
        let (_, client) = self.get_client_ref(session_id)?;
        client.run_commands(cmd).await
    }

    /// Run a command on a single device.
    pub async fn run_command_on_device(
        &self,
        session_id: &str,
        node_id: &str,
        command: &str,
        powershell: bool,
        run_as_user: bool,
    ) -> MeshCentralResult<McCommandResult> {
        let (_, client) = self.get_client_ref(session_id)?;
        client
            .run_command_on_device(node_id, command, powershell, run_as_user)
            .await
    }

    // ─── Files ───────────────────────────────────────────────────

    /// Upload a file to a device.
    pub async fn upload_file(
        &self,
        session_id: &str,
        upload: &McFileUpload,
    ) -> MeshCentralResult<String> {
        let (_, client) = self.get_client_ref(session_id)?;
        let transfer_id = client.upload_file(upload).await?;

        self.transfers.start_transfer(
            &transfer_id,
            McTransferDirection::Upload,
            None,
            &upload.device_id,
        );

        Ok(transfer_id)
    }

    /// Download a file from a device.
    pub async fn download_file(
        &self,
        session_id: &str,
        download: &McFileDownload,
    ) -> MeshCentralResult<String> {
        let (_, client) = self.get_client_ref(session_id)?;
        let transfer_id = client.download_file(download).await?;

        self.transfers.start_transfer(
            &transfer_id,
            McTransferDirection::Download,
            None,
            &download.device_id,
        );

        Ok(transfer_id)
    }

    /// Get file transfer progress.
    pub fn get_transfer_progress(
        &self,
        transfer_id: &str,
    ) -> Option<McFileTransferProgress> {
        self.transfers.get_progress(transfer_id)
    }

    /// Get all active transfers.
    pub fn get_active_transfers(&self) -> Vec<McFileTransferProgress> {
        self.transfers.get_all_active()
    }

    /// Cancel a file transfer.
    pub fn cancel_transfer(&self, transfer_id: &str) {
        self.transfers.cancel_transfer(transfer_id);
    }

    // ─── Events ──────────────────────────────────────────────────

    /// List events.
    pub async fn list_events(
        &self,
        session_id: &str,
        filter: Option<&McEventFilter>,
    ) -> MeshCentralResult<Vec<McEvent>> {
        let (_, client) = self.get_client_ref(session_id)?;
        client.list_events(filter).await
    }

    // ─── Sharing ─────────────────────────────────────────────────

    /// Create a device share.
    pub async fn create_device_share(
        &self,
        session_id: &str,
        share: &McCreateShare,
    ) -> MeshCentralResult<McDeviceShare> {
        let (_, client) = self.get_client_ref(session_id)?;
        client.create_device_share(share).await
    }

    /// List device shares.
    pub async fn list_device_shares(
        &self,
        session_id: &str,
        node_id: &str,
    ) -> MeshCentralResult<Vec<McDeviceShare>> {
        let (_, client) = self.get_client_ref(session_id)?;
        client.list_device_shares(node_id).await
    }

    /// Remove a device share.
    pub async fn remove_device_share(
        &self,
        session_id: &str,
        node_id: &str,
        share_id: &str,
    ) -> MeshCentralResult<String> {
        let (_, client) = self.get_client_ref(session_id)?;
        client.remove_device_share(node_id, share_id).await
    }

    // ─── Messaging ───────────────────────────────────────────────

    /// Send a toast notification to devices.
    pub async fn send_toast(
        &self,
        session_id: &str,
        toast: &McDeviceToast,
    ) -> MeshCentralResult<String> {
        let (_, client) = self.get_client_ref(session_id)?;
        client.send_toast(toast).await
    }

    /// Send a message box to a device.
    pub async fn send_message_box(
        &self,
        session_id: &str,
        msg: &McDeviceMessage,
    ) -> MeshCentralResult<String> {
        let (_, client) = self.get_client_ref(session_id)?;
        client.send_message_box(msg).await
    }

    /// Open a URL on a device.
    pub async fn send_open_url(
        &self,
        session_id: &str,
        open: &McDeviceOpenUrl,
    ) -> MeshCentralResult<String> {
        let (_, client) = self.get_client_ref(session_id)?;
        client.send_open_url(open).await
    }

    /// Broadcast a message to users.
    pub async fn broadcast_message(
        &self,
        session_id: &str,
        broadcast: &McBroadcast,
    ) -> MeshCentralResult<String> {
        let (_, client) = self.get_client_ref(session_id)?;
        client.broadcast_message(broadcast).await
    }

    // ─── Agents ──────────────────────────────────────────────────

    /// Download an agent installer.
    pub async fn download_agent(
        &self,
        session_id: &str,
        download: &McAgentDownload,
    ) -> MeshCentralResult<Vec<u8>> {
        let (_, client) = self.get_client_ref(session_id)?;
        client.download_agent(download).await
    }

    /// Download agent to a file on disk.
    pub async fn download_agent_to_file(
        &self,
        session_id: &str,
        download: &McAgentDownload,
        output_path: &str,
    ) -> MeshCentralResult<String> {
        let (_, client) = self.get_client_ref(session_id)?;
        client.download_agent_to_file(download, output_path).await
    }

    /// Send an invite email.
    pub async fn send_invite_email(
        &self,
        session_id: &str,
        invite: &McSendInviteEmail,
    ) -> MeshCentralResult<String> {
        let (_, client) = self.get_client_ref(session_id)?;
        client.send_invite_email(invite).await
    }

    /// Generate an invite link.
    pub async fn generate_invite_link(
        &self,
        session_id: &str,
        invite: &McGenerateInviteLink,
    ) -> MeshCentralResult<String> {
        let (_, client) = self.get_client_ref(session_id)?;
        client.generate_invite_link(invite).await
    }

    // ─── Reports ─────────────────────────────────────────────────

    /// Generate a report.
    pub async fn generate_report(
        &self,
        session_id: &str,
        report: &McGenerateReport,
    ) -> MeshCentralResult<McReport> {
        let (_, client) = self.get_client_ref(session_id)?;
        client.generate_report(report).await
    }

    // ─── Web Relay ───────────────────────────────────────────────

    /// Create a web relay session.
    pub async fn create_web_relay(
        &self,
        session_id: &str,
        relay: &McWebRelay,
    ) -> MeshCentralResult<McWebRelayResult> {
        let (_, client) = self.get_client_ref(session_id)?;
        client.create_web_relay(relay).await
    }
}
