//! # Collaboration Types
//!
//! Core data types used across all collaboration modules. These types define the
//! fundamental entities of the multi-user collaboration system.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

// ── User & Identity ─────────────────────────────────────────────────

/// A collaborating user within the system.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CollabUser {
    /// Unique user identifier (UUID v4)
    pub id: String,
    /// Display name shown in presence indicators and audit logs
    pub display_name: String,
    /// Email address used for invitations and notifications
    pub email: String,
    /// URL to the user's avatar image (optional)
    pub avatar_url: Option<String>,
    /// When the user account was created
    pub created_at: DateTime<Utc>,
    /// Last time the user was active
    pub last_active: DateTime<Utc>,
    /// User-level preferences for collaboration notifications
    pub notification_preferences: NotificationPreferences,
}

/// Global notification preferences for a user.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NotificationPreferences {
    /// Receive notifications when someone joins a shared workspace
    pub on_workspace_join: bool,
    /// Receive notifications when a shared connection is modified
    pub on_connection_change: bool,
    /// Receive notifications on new messages
    pub on_message: bool,
    /// Receive notifications when someone starts a session on a shared host
    pub on_session_start: bool,
    /// Enable desktop/OS-level notifications
    pub desktop_notifications: bool,
    /// Enable in-app toast notifications
    pub in_app_notifications: bool,
}

impl Default for NotificationPreferences {
    fn default() -> Self {
        Self {
            on_workspace_join: true,
            on_connection_change: true,
            on_message: true,
            on_session_start: true,
            desktop_notifications: true,
            in_app_notifications: true,
        }
    }
}

// ── Teams ───────────────────────────────────────────────────────────

/// A team groups multiple users for simpler permission management.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Team {
    /// Unique team identifier (UUID v4)
    pub id: String,
    /// Team display name
    pub name: String,
    /// Optional description
    pub description: Option<String>,
    /// User ID of the team owner
    pub owner_id: String,
    /// Member user IDs with their team-level roles
    pub members: HashMap<String, TeamRole>,
    /// When the team was created
    pub created_at: DateTime<Utc>,
}

/// Role within a team (separate from workspace roles).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum TeamRole {
    /// Full control over the team
    Owner,
    /// Can manage members and team settings
    Admin,
    /// Regular team member
    Member,
}

// ── Workspaces ──────────────────────────────────────────────────────

/// A shared workspace containing connections that multiple users can access.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SharedWorkspace {
    /// Unique workspace identifier (UUID v4)
    pub id: String,
    /// Workspace display name
    pub name: String,
    /// Optional description of the workspace purpose
    pub description: Option<String>,
    /// User ID of the workspace creator/owner
    pub owner_id: String,
    /// Members with their workspace-level roles
    pub members: HashMap<String, WorkspaceRole>,
    /// Teams granted access (team_id → role)
    pub team_access: HashMap<String, WorkspaceRole>,
    /// IDs of shared connections within this workspace
    pub connection_ids: Vec<String>,
    /// IDs of shared folders/groups within this workspace
    pub folder_ids: Vec<String>,
    /// Whether the workspace is archived (read-only)
    pub archived: bool,
    /// Workspace-level settings
    pub settings: WorkspaceSettings,
    /// When the workspace was created
    pub created_at: DateTime<Utc>,
    /// When the workspace was last modified
    pub updated_at: DateTime<Utc>,
}

/// Workspace-level settings controlling collaboration behavior.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkspaceSettings {
    /// Allow members to invite others (or restrict to admins)
    pub members_can_invite: bool,
    /// Allow viewers to see connection credentials
    pub viewers_can_see_credentials: bool,
    /// Require approval for new member joins
    pub require_join_approval: bool,
    /// Maximum number of concurrent sessions per connection
    pub max_concurrent_sessions: Option<u32>,
    /// Enable session recording for all connections in this workspace
    pub force_session_recording: bool,
    /// Auto-lock workspace after inactivity (seconds)
    pub auto_lock_timeout: Option<u64>,
}

impl Default for WorkspaceSettings {
    fn default() -> Self {
        Self {
            members_can_invite: false,
            viewers_can_see_credentials: false,
            require_join_approval: true,
            max_concurrent_sessions: None,
            force_session_recording: false,
            auto_lock_timeout: None,
        }
    }
}

/// Role within a shared workspace, defining what a user can do.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub enum WorkspaceRole {
    /// Read-only access to connections and their details
    Viewer = 0,
    /// Can connect and use connections, but not modify them
    Operator = 1,
    /// Can create, modify, and delete connections
    Editor = 2,
    /// Can manage workspace members and settings
    Admin = 3,
    /// Full control including workspace deletion
    Owner = 4,
}

impl WorkspaceRole {
    /// Check if this role has at least the given permission level.
    pub fn has_at_least(&self, required: WorkspaceRole) -> bool {
        *self >= required
    }
}

// ── Sharing & Permissions ───────────────────────────────────────────

/// A shared resource (connection or folder) with its permission set.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SharedResource {
    /// Unique sharing record ID (UUID v4)
    pub id: String,
    /// The type of resource being shared
    pub resource_type: ResourceType,
    /// The ID of the actual connection/folder being shared
    pub resource_id: String,
    /// The workspace this sharing belongs to
    pub workspace_id: String,
    /// User who shared this resource
    pub shared_by: String,
    /// Per-user permission overrides (user_id → permission)
    pub user_permissions: HashMap<String, ResourcePermission>,
    /// When this resource was shared
    pub shared_at: DateTime<Utc>,
    /// Optional expiration for time-limited sharing
    pub expires_at: Option<DateTime<Utc>>,
    /// Whether the share link is active
    pub active: bool,
}

/// Type of shared resource.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ResourceType {
    /// A single connection entry
    Connection,
    /// A folder/group of connections
    Folder,
    /// An entire connection collection file
    Collection,
}

/// Permission level for a specific shared resource.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub enum ResourcePermission {
    /// Can only see the resource exists (name, type)
    Discover,
    /// Can see full details but not connect
    View,
    /// Can view and initiate connections
    Connect,
    /// Can modify connection parameters
    Edit,
    /// Full control including re-sharing and deletion
    Manage,
}

// ── Presence ────────────────────────────────────────────────────────

/// Current presence status for a user.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserPresence {
    /// User ID
    pub user_id: String,
    /// Current status
    pub status: PresenceStatus,
    /// What the user is currently doing (if active)
    pub activity: Option<UserActivity>,
    /// Last heartbeat timestamp
    pub last_heartbeat: DateTime<Utc>,
    /// Client version / platform info
    pub client_info: Option<String>,
    /// IP address of the client (for gateway awareness)
    pub client_ip: Option<String>,
}

/// Presence status values.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum PresenceStatus {
    /// User is online and active
    Online,
    /// User is online but idle
    Away,
    /// User is actively in a session
    Busy,
    /// User has explicitly set "do not disturb"
    DoNotDisturb,
    /// User is offline (last known state)
    Offline,
}

/// What a user is currently doing.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserActivity {
    /// Type of activity
    pub activity_type: ActivityType,
    /// Target connection/host (if applicable)
    pub target_id: Option<String>,
    /// Human-readable description
    pub description: String,
    /// When this activity started
    pub started_at: DateTime<Utc>,
}

/// Types of user activities tracked by the presence system.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ActivityType {
    /// Connected to a host via SSH
    SshSession,
    /// Connected to a host via RDP
    RdpSession,
    /// Connected to a host via VNC
    VncSession,
    /// Transferring files via SFTP/SCP/FTP
    FileTransfer,
    /// Running a database query
    DatabaseSession,
    /// Editing connection configuration
    Editing,
    /// Viewing/browsing connections
    Browsing,
    /// Idle within the application
    Idle,
}

// ── Session Sharing ─────────────────────────────────────────────────

/// A live session sharing instance.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SharedSession {
    /// Unique session share ID (UUID v4)
    pub id: String,
    /// The workspace this session belongs to
    pub workspace_id: String,
    /// User ID of the session owner (who initiated the connection)
    pub owner_id: String,
    /// The connection being shared
    pub connection_id: String,
    /// Protocol type of the session
    pub protocol: SessionProtocol,
    /// Sharing mode
    pub mode: ShareMode,
    /// Currently viewing/participating user IDs
    pub participants: Vec<SessionParticipant>,
    /// Maximum allowed participants (0 = unlimited)
    pub max_participants: u32,
    /// When the session sharing started
    pub started_at: DateTime<Utc>,
    /// Whether the shared session is still active
    pub active: bool,
}

/// The protocol of a shared session.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum SessionProtocol {
    Ssh,
    Rdp,
    Vnc,
    Telnet,
    Database,
    Ftp,
}

/// How a session is being shared.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ShareMode {
    /// Participants can only watch
    ViewOnly,
    /// Participants can interact (send input)
    Interactive,
    /// Owner can selectively grant/revoke input per participant
    Controlled,
}

/// A participant in a shared session.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionParticipant {
    /// User ID of the participant
    pub user_id: String,
    /// Whether this participant currently has input control
    pub has_input: bool,
    /// When they joined the shared session
    pub joined_at: DateTime<Utc>,
}

// ── Audit ───────────────────────────────────────────────────────────

/// An immutable audit log entry.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditEntry {
    /// Unique entry ID (UUID v4)
    pub id: String,
    /// Timestamp of the event
    pub timestamp: DateTime<Utc>,
    /// User who performed the action
    pub user_id: String,
    /// The workspace context (if applicable)
    pub workspace_id: Option<String>,
    /// What action was performed
    pub action: AuditAction,
    /// The target resource ID
    pub resource_id: Option<String>,
    /// The type of target resource
    pub resource_type: Option<ResourceType>,
    /// Human-readable description of the event
    pub description: String,
    /// Additional metadata (JSON-serializable)
    pub metadata: Option<serde_json::Value>,
    /// IP address of the client
    pub client_ip: Option<String>,
}

/// Categories of auditable actions.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum AuditAction {
    // Workspace actions
    WorkspaceCreated,
    WorkspaceUpdated,
    WorkspaceDeleted,
    WorkspaceArchived,
    WorkspaceMemberAdded,
    WorkspaceMemberRemoved,
    WorkspaceMemberRoleChanged,

    // Connection actions
    ConnectionCreated,
    ConnectionUpdated,
    ConnectionDeleted,
    ConnectionShared,
    ConnectionUnshared,

    // Session actions
    SessionStarted,
    SessionEnded,
    SessionShared,
    SessionJoined,
    SessionLeft,

    // Access actions
    PermissionGranted,
    PermissionRevoked,
    InvitationSent,
    InvitationAccepted,
    InvitationDeclined,

    // Security actions
    CredentialAccessed,
    CredentialExported,
    LoginAttempt,
    LoginSuccess,
    LoginFailure,
}

// ── Sync & Conflict Resolution ──────────────────────────────────────

/// A vector clock for conflict resolution across distributed edits.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct VectorClock {
    /// Map of node_id → logical timestamp
    pub clocks: HashMap<String, u64>,
}

impl VectorClock {
    /// Create a new empty vector clock.
    pub fn new() -> Self {
        Self {
            clocks: HashMap::new(),
        }
    }

    /// Increment the clock for the given node.
    pub fn tick(&mut self, node_id: &str) {
        let counter = self.clocks.entry(node_id.to_string()).or_insert(0);
        *counter += 1;
    }

    /// Merge another vector clock into this one (element-wise max).
    pub fn merge(&mut self, other: &VectorClock) {
        for (node_id, &timestamp) in &other.clocks {
            let entry = self.clocks.entry(node_id.clone()).or_insert(0);
            *entry = (*entry).max(timestamp);
        }
    }

    /// Check if this clock is causally before or concurrent with another.
    pub fn partial_cmp_causal(&self, other: &VectorClock) -> CausalOrdering {
        let mut self_less = false;
        let mut other_less = false;

        let all_keys: std::collections::HashSet<&String> =
            self.clocks.keys().chain(other.clocks.keys()).collect();

        for key in all_keys {
            let self_val = self.clocks.get(key).copied().unwrap_or(0);
            let other_val = other.clocks.get(key).copied().unwrap_or(0);

            if self_val < other_val {
                self_less = true;
            }
            if other_val < self_val {
                other_less = true;
            }
        }

        match (self_less, other_less) {
            (false, false) => CausalOrdering::Equal,
            (true, false) => CausalOrdering::Before,
            (false, true) => CausalOrdering::After,
            (true, true) => CausalOrdering::Concurrent,
        }
    }
}

/// Result of comparing two vector clocks.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CausalOrdering {
    /// Clocks are identical
    Equal,
    /// Self happened before other
    Before,
    /// Self happened after other
    After,
    /// Events are concurrent (conflict)
    Concurrent,
}

/// A sync operation representing a change to be propagated.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncOperation {
    /// Unique operation ID
    pub id: String,
    /// The node (user) that originated this operation
    pub origin_node: String,
    /// Vector clock at the time of the operation
    pub vector_clock: VectorClock,
    /// The type of change
    pub operation_type: SyncOperationType,
    /// The workspace context
    pub workspace_id: String,
    /// The target resource
    pub resource_id: String,
    /// The serialized change payload
    pub payload: serde_json::Value,
    /// ISO 8601 timestamp
    pub timestamp: DateTime<Utc>,
}

/// Types of synchronization operations.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum SyncOperationType {
    Create,
    Update,
    Delete,
    Move,
    Reorder,
}

// ── Messaging ───────────────────────────────────────────────────────

/// An in-app message between collaborators.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CollabMessage {
    /// Unique message ID (UUID v4)
    pub id: String,
    /// Workspace context
    pub workspace_id: String,
    /// Optional channel/thread (connection ID for annotations)
    pub channel_id: Option<String>,
    /// Sender user ID
    pub sender_id: String,
    /// Message content (plain text or markdown)
    pub content: String,
    /// Message type
    pub message_type: MessageType,
    /// ID of the message this replies to (if threaded)
    pub reply_to: Option<String>,
    /// When the message was sent
    pub sent_at: DateTime<Utc>,
    /// When the message was last edited (if edited)
    pub edited_at: Option<DateTime<Utc>>,
    /// Whether the message has been deleted (soft delete)
    pub deleted: bool,
}

/// Types of messages.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum MessageType {
    /// Regular chat message
    Chat,
    /// Annotation on a connection
    Annotation,
    /// System-generated notification message
    System,
    /// Alert/warning message
    Alert,
}

// ── Notifications ───────────────────────────────────────────────────

/// A notification event to be delivered to a user.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CollabNotification {
    /// Unique notification ID
    pub id: String,
    /// Target user ID
    pub target_user_id: String,
    /// Notification category
    pub category: NotificationCategory,
    /// Human-readable title
    pub title: String,
    /// Notification body
    pub body: String,
    /// Related workspace ID
    pub workspace_id: Option<String>,
    /// Related resource ID (for deep linking)
    pub resource_id: Option<String>,
    /// When the notification was created
    pub created_at: DateTime<Utc>,
    /// Whether the notification has been read
    pub read: bool,
    /// Whether the notification has been dismissed
    pub dismissed: bool,
}

/// Categories of notifications.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum NotificationCategory {
    WorkspaceInvite,
    MemberJoined,
    MemberLeft,
    ConnectionChanged,
    SessionStarted,
    SessionShared,
    Message,
    PermissionChanged,
    SecurityAlert,
    SystemUpdate,
}

// ── Invitations ─────────────────────────────────────────────────────

/// An invitation to join a workspace or team.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Invitation {
    /// Unique invitation ID (UUID v4)
    pub id: String,
    /// What is being invited to
    pub invitation_type: InvitationType,
    /// The target workspace or team ID
    pub target_id: String,
    /// The target workspace or team name (for display)
    pub target_name: String,
    /// User who sent the invitation
    pub invited_by: String,
    /// Email or user ID of the invitee
    pub invitee: String,
    /// The role that will be granted upon acceptance
    pub granted_role: WorkspaceRole,
    /// Optional personal message
    pub message: Option<String>,
    /// Current status of the invitation
    pub status: InvitationStatus,
    /// When the invitation was created
    pub created_at: DateTime<Utc>,
    /// When the invitation expires
    pub expires_at: DateTime<Utc>,
}

/// What the invitation is for.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum InvitationType {
    Workspace,
    Team,
}

/// Invitation lifecycle status.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum InvitationStatus {
    Pending,
    Accepted,
    Declined,
    Expired,
    Revoked,
}

/// Type alias for the collaboration service state (Tauri managed state pattern).
pub type CollaborationServiceState = Arc<Mutex<crate::service::CollaborationService>>;
