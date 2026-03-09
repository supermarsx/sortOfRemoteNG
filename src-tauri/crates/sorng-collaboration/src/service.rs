//! # Collaboration Service
//!
//! Main entry point for the collaboration system. Orchestrates all sub-modules
//! and provides the Tauri-compatible managed state interface.

use crate::audit::AuditLog;
use crate::conflict::ConflictResolver;
use crate::discovery::DiscoveryService;
use crate::messaging::MessagingService;
use crate::notifications::NotificationService;
use crate::presence::PresenceTracker;
use crate::rbac::RbacEnforcer;
use crate::session_share::SessionShareManager;
use crate::sharing::SharingManager;
use crate::sync::SyncEngine;
use crate::types::*;
use crate::workspace::WorkspaceManager;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

/// The top-level collaboration service that coordinates all collaboration features.
///
/// This service holds references to all sub-systems and provides a unified API
/// for the Tauri command layer to interact with.
pub struct CollaborationService {
    /// Current authenticated user in collaboration context
    current_user: Option<CollabUser>,
    /// Workspace management
    pub workspaces: WorkspaceManager,
    /// Presence tracking
    pub presence: PresenceTracker,
    /// Sharing management
    pub sharing: SharingManager,
    /// Session sharing
    pub session_share: SessionShareManager,
    /// Sync engine
    pub sync_engine: SyncEngine,
    /// Audit log
    pub audit: AuditLog,
    /// RBAC enforcer
    pub rbac: RbacEnforcer,
    /// Messaging
    pub messaging: MessagingService,
    /// Notifications
    pub notifications: NotificationService,
    /// Conflict resolver
    pub conflict: ConflictResolver,
    /// Discovery
    pub discovery: DiscoveryService,
    /// Whether the collaboration server is running
    server_running: bool,
    /// Port the collaboration WebSocket server listens on
    server_port: Option<u16>,
}

impl CollaborationService {
    /// Create a new collaboration service with default sub-systems.
    pub fn new(data_dir: String) -> CollaborationServiceState {
        let audit = AuditLog::new(&data_dir);
        let service = CollaborationService {
            current_user: None,
            workspaces: WorkspaceManager::new(&data_dir),
            presence: PresenceTracker::new(),
            sharing: SharingManager::new(&data_dir),
            session_share: SessionShareManager::new(),
            sync_engine: SyncEngine::new(),
            audit,
            rbac: RbacEnforcer::new(),
            messaging: MessagingService::new(&data_dir),
            notifications: NotificationService::new(),
            conflict: ConflictResolver::new(),
            discovery: DiscoveryService::new(&data_dir),
            server_running: false,
            server_port: None,
        };
        Arc::new(Mutex::new(service))
    }

    // ── User Identity ───────────────────────────────────────────────

    /// Set the current user for this collaboration session.
    pub fn set_current_user(&mut self, user: CollabUser) {
        log::info!(
            "Collaboration user set: {} ({})",
            user.display_name,
            user.id
        );
        self.presence.set_status(&user.id, PresenceStatus::Online);
        self.current_user = Some(user);
    }

    /// Get the current user, if authenticated.
    pub fn current_user(&self) -> Option<&CollabUser> {
        self.current_user.as_ref()
    }

    /// Get the current user ID, or return an error if not authenticated.
    pub fn require_user(&self) -> Result<&CollabUser, String> {
        self.current_user
            .as_ref()
            .ok_or_else(|| "No collaboration user set. Please authenticate first.".to_string())
    }

    // ── Workspace Operations (delegated) ────────────────────────────

    /// Create a new shared workspace.
    pub async fn create_workspace(
        &mut self,
        name: String,
        description: Option<String>,
    ) -> Result<SharedWorkspace, String> {
        let user = self.require_user()?.clone();
        let workspace = self.workspaces.create(name, description, &user)?;
        self.audit.log_action(
            &user.id,
            Some(&workspace.id),
            AuditAction::WorkspaceCreated,
            None,
            None,
            format!("Workspace '{}' created", workspace.name),
            None,
        );
        Ok(workspace)
    }

    /// List all workspaces the current user has access to.
    pub fn list_workspaces(&self) -> Result<Vec<SharedWorkspace>, String> {
        let user = self.require_user()?;
        Ok(self.workspaces.list_for_user(&user.id))
    }

    /// Join an existing workspace via invitation.
    pub async fn join_workspace(
        &mut self,
        workspace_id: &str,
        invitation_id: &str,
    ) -> Result<(), String> {
        let user = self.require_user()?.clone();
        let invitation = self
            .discovery
            .get_invitation(invitation_id)?
            .ok_or("Invitation not found")?;

        if invitation.status != InvitationStatus::Pending {
            return Err("Invitation is no longer pending".to_string());
        }

        self.workspaces
            .add_member(workspace_id, &user.id, invitation.granted_role)?;
        self.discovery.accept_invitation(invitation_id)?;
        self.audit.log_action(
            &user.id,
            Some(workspace_id),
            AuditAction::WorkspaceMemberAdded,
            None,
            None,
            format!("User '{}' joined workspace", user.display_name),
            None,
        );
        self.notifications.broadcast_workspace(
            workspace_id,
            &self.workspaces,
            &user.id,
            NotificationCategory::MemberJoined,
            "New Member",
            &format!("{} joined the workspace", user.display_name),
        );
        Ok(())
    }

    /// Leave a workspace.
    pub async fn leave_workspace(&mut self, workspace_id: &str) -> Result<(), String> {
        let user = self.require_user()?.clone();
        self.workspaces.remove_member(workspace_id, &user.id)?;
        self.audit.log_action(
            &user.id,
            Some(workspace_id),
            AuditAction::WorkspaceMemberRemoved,
            None,
            None,
            format!("User '{}' left workspace", user.display_name),
            None,
        );
        self.notifications.broadcast_workspace(
            workspace_id,
            &self.workspaces,
            &user.id,
            NotificationCategory::MemberLeft,
            "Member Left",
            &format!("{} left the workspace", user.display_name),
        );
        Ok(())
    }

    // ── Sharing Operations ──────────────────────────────────────────

    /// Share a connection with a workspace.
    pub async fn share_connection(
        &mut self,
        workspace_id: &str,
        connection_id: &str,
        permissions: HashMap<String, ResourcePermission>,
    ) -> Result<SharedResource, String> {
        let user = self.require_user()?.clone();
        self.rbac.require_permission(
            &self.workspaces,
            workspace_id,
            &user.id,
            WorkspaceRole::Editor,
        )?;

        let resource =
            self.sharing
                .share_connection(workspace_id, connection_id, &user.id, permissions)?;
        self.audit.log_action(
            &user.id,
            Some(workspace_id),
            AuditAction::ConnectionShared,
            Some(connection_id),
            Some(ResourceType::Connection),
            format!("Connection {} shared in workspace", connection_id),
            None,
        );
        Ok(resource)
    }

    /// Unshare a connection from a workspace.
    pub async fn unshare_connection(
        &mut self,
        workspace_id: &str,
        connection_id: &str,
    ) -> Result<(), String> {
        let user = self.require_user()?.clone();
        self.rbac.require_permission(
            &self.workspaces,
            workspace_id,
            &user.id,
            WorkspaceRole::Editor,
        )?;
        self.sharing.unshare(workspace_id, connection_id)?;
        self.audit.log_action(
            &user.id,
            Some(workspace_id),
            AuditAction::ConnectionUnshared,
            Some(connection_id),
            Some(ResourceType::Connection),
            format!("Connection {} unshared", connection_id),
            None,
        );
        Ok(())
    }

    // ── Session Sharing ─────────────────────────────────────────────

    /// Start sharing an active session with workspace members.
    pub async fn start_session_share(
        &mut self,
        workspace_id: &str,
        connection_id: &str,
        protocol: SessionProtocol,
        mode: ShareMode,
        max_participants: u32,
    ) -> Result<SharedSession, String> {
        let user = self.require_user()?.clone();
        self.rbac.require_permission(
            &self.workspaces,
            workspace_id,
            &user.id,
            WorkspaceRole::Operator,
        )?;
        let session = self.session_share.start_share(
            workspace_id,
            connection_id,
            &user.id,
            protocol,
            mode,
            max_participants,
        )?;
        self.audit.log_action(
            &user.id,
            Some(workspace_id),
            AuditAction::SessionShared,
            Some(connection_id),
            Some(ResourceType::Connection),
            format!("Session sharing started for connection {}", connection_id),
            None,
        );
        self.notifications.broadcast_workspace(
            workspace_id,
            &self.workspaces,
            &user.id,
            NotificationCategory::SessionShared,
            "Session Shared",
            &format!("{} is sharing a {:?} session", user.display_name, protocol),
        );
        Ok(session)
    }

    /// Join an active shared session.
    pub async fn join_shared_session(&mut self, session_id: &str) -> Result<SharedSession, String> {
        let user = self.require_user()?.clone();
        let session = self.session_share.join_session(session_id, &user.id)?;
        self.audit.log_action(
            &user.id,
            Some(&session.workspace_id),
            AuditAction::SessionJoined,
            Some(&session.connection_id),
            Some(ResourceType::Connection),
            format!("User '{}' joined shared session", user.display_name),
            None,
        );
        Ok(session)
    }

    /// Stop sharing a session.
    pub async fn stop_session_share(&mut self, session_id: &str) -> Result<(), String> {
        let user = self.require_user()?.clone();
        let session = self.session_share.get_session(session_id)?;
        if session.owner_id != user.id {
            return Err("Only the session owner can stop sharing".to_string());
        }
        self.session_share.stop_share(session_id)?;
        self.audit.log_action(
            &user.id,
            Some(&session.workspace_id),
            AuditAction::SessionEnded,
            Some(&session.connection_id),
            Some(ResourceType::Connection),
            "Session sharing stopped".to_string(),
            None,
        );
        Ok(())
    }

    // ── Presence ────────────────────────────────────────────────────

    /// Update the current user's presence status.
    pub fn update_presence(&mut self, status: PresenceStatus) -> Result<(), String> {
        let user_id = self.require_user()?.id.clone();
        self.presence.set_status(&user_id, status);
        Ok(())
    }

    /// Update what the current user is doing.
    pub fn update_activity(&mut self, activity: UserActivity) -> Result<(), String> {
        let user_id = self.require_user()?.id.clone();
        self.presence.set_activity(&user_id, activity);
        Ok(())
    }

    /// Get presence information for all members of a workspace.
    pub fn get_workspace_presence(&self, workspace_id: &str) -> Result<Vec<UserPresence>, String> {
        let user = self.require_user()?;
        self.rbac.require_permission(
            &self.workspaces,
            workspace_id,
            &user.id,
            WorkspaceRole::Viewer,
        )?;
        let members = self.workspaces.get_member_ids(workspace_id)?;
        Ok(self.presence.get_presence_for_users(&members))
    }

    // ── Messaging ───────────────────────────────────────────────────

    /// Send a message in a workspace.
    pub async fn send_message(
        &mut self,
        workspace_id: &str,
        content: String,
        channel_id: Option<String>,
        message_type: MessageType,
        reply_to: Option<String>,
    ) -> Result<CollabMessage, String> {
        let user = self.require_user()?.clone();
        self.rbac.require_permission(
            &self.workspaces,
            workspace_id,
            &user.id,
            WorkspaceRole::Viewer,
        )?;
        let message = self.messaging.send_message(
            workspace_id,
            &user.id,
            content,
            channel_id,
            message_type,
            reply_to,
        )?;
        Ok(message)
    }

    /// Get messages for a workspace, optionally filtered by channel.
    pub fn get_messages(
        &self,
        workspace_id: &str,
        channel_id: Option<&str>,
        limit: usize,
        before: Option<&str>,
    ) -> Result<Vec<CollabMessage>, String> {
        let user = self.require_user()?;
        self.rbac.require_permission(
            &self.workspaces,
            workspace_id,
            &user.id,
            WorkspaceRole::Viewer,
        )?;
        Ok(self
            .messaging
            .get_messages(workspace_id, channel_id, limit, before))
    }

    // ── Notifications ───────────────────────────────────────────────

    /// Get unread notifications for the current user.
    pub fn get_notifications(&self) -> Result<Vec<CollabNotification>, String> {
        let user = self.require_user()?;
        Ok(self.notifications.get_for_user(&user.id))
    }

    /// Mark a notification as read.
    pub fn mark_notification_read(&mut self, notification_id: &str) -> Result<(), String> {
        let user_id = self.require_user()?.id.clone();
        self.notifications.mark_read(&user_id, notification_id)
    }

    /// Dismiss all notifications for the current user.
    pub fn dismiss_all_notifications(&mut self) -> Result<(), String> {
        let user_id = self.require_user()?.id.clone();
        self.notifications.dismiss_all(&user_id);
        Ok(())
    }

    // ── Invitations ─────────────────────────────────────────────────

    /// Invite a user to a workspace.
    pub async fn invite_to_workspace(
        &mut self,
        workspace_id: &str,
        invitee_email: &str,
        role: WorkspaceRole,
        message: Option<String>,
    ) -> Result<Invitation, String> {
        let user = self.require_user()?.clone();
        self.rbac.require_permission(
            &self.workspaces,
            workspace_id,
            &user.id,
            WorkspaceRole::Admin,
        )?;
        let ws = self
            .workspaces
            .get(workspace_id)?
            .ok_or("Workspace not found")?;
        let invitation = self.discovery.create_invitation(
            InvitationType::Workspace,
            workspace_id,
            &ws.name,
            &user.id,
            invitee_email,
            role,
            message,
        )?;
        self.audit.log_action(
            &user.id,
            Some(workspace_id),
            AuditAction::InvitationSent,
            None,
            None,
            format!("Invitation sent to {}", invitee_email),
            None,
        );
        Ok(invitation)
    }

    /// List pending invitations for the current user.
    pub fn list_pending_invitations(&self) -> Result<Vec<Invitation>, String> {
        let user = self.require_user()?;
        Ok(self.discovery.list_pending_for_user(&user.email))
    }

    // ── Sync ────────────────────────────────────────────────────────

    /// Push a local change to the sync engine for distribution.
    pub fn push_sync_operation(&mut self, op: SyncOperation) -> Result<(), String> {
        let _user = self.require_user()?;
        self.sync_engine.push(op);
        Ok(())
    }

    /// Pull pending sync operations for a workspace.
    pub fn pull_sync_operations(
        &self,
        workspace_id: &str,
        since_clock: &VectorClock,
    ) -> Result<Vec<SyncOperation>, String> {
        let _user = self.require_user()?;
        Ok(self.sync_engine.pull(workspace_id, since_clock))
    }

    // ── Audit ───────────────────────────────────────────────────────

    /// Query the audit log for a workspace.
    pub fn query_audit_log(
        &self,
        workspace_id: &str,
        limit: usize,
        action_filter: Option<AuditAction>,
    ) -> Result<Vec<AuditEntry>, String> {
        let user = self.require_user()?;
        self.rbac.require_permission(
            &self.workspaces,
            workspace_id,
            &user.id,
            WorkspaceRole::Admin,
        )?;
        Ok(self.audit.query(workspace_id, limit, action_filter))
    }

    // ── Server Lifecycle ────────────────────────────────────────────

    /// Start the collaboration WebSocket server for real-time sync.
    pub async fn start_server(&mut self, port: u16) -> Result<(), String> {
        if self.server_running {
            return Err("Collaboration server is already running".to_string());
        }
        log::info!("Starting collaboration server on port {}", port);
        self.server_running = true;
        self.server_port = Some(port);
        // The actual WebSocket server would be spawned as a tokio task here.
        // For now we record the configuration; the transport layer is in sync.rs.
        Ok(())
    }

    /// Stop the collaboration server.
    pub async fn stop_server(&mut self) -> Result<(), String> {
        if !self.server_running {
            return Err("Collaboration server is not running".to_string());
        }
        log::info!("Stopping collaboration server");
        self.server_running = false;
        self.server_port = None;
        Ok(())
    }

    /// Check if the collaboration server is running.
    pub fn is_server_running(&self) -> bool {
        self.server_running
    }
}
