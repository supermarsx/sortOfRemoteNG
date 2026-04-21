use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

// ═══════════════════════════════════════════════════════════════════════
//  Core types
// ═══════════════════════════════════════════════════════════════════════

/// What kind of secret is on the clipboard.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SecretKind {
    /// SSH / RDP / VNC / etc. connection password.
    Password,
    /// SSH private-key passphrase.
    Passphrase,
    /// TOTP one-time code.
    TotpCode,
    /// Username (not truly secret but treated the same way for auto-clear).
    Username,
    /// An API key or bearer token.
    ApiKey,
    /// A generic secret string (e.g. from a password manager entry).
    GenericSecret,
    /// Plain text copied by the user (lower sensitivity).
    PlainText,
}

impl SecretKind {
    /// Recommended auto-clear timeout in seconds for each kind.
    pub fn default_clear_secs(&self) -> u64 {
        match self {
            Self::Password | Self::Passphrase | Self::ApiKey | Self::GenericSecret => 12,
            Self::TotpCode => 30, // TOTP typically refreshes every 30s
            Self::Username => 30,
            Self::PlainText => 0, // Never auto-clear plain text
        }
    }

    /// Whether this kind should be masked in the UI by default.
    pub fn is_sensitive(&self) -> bool {
        !matches!(self, Self::PlainText | Self::Username)
    }
}

/// A clipboard entry — the value currently (or recently) held.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipEntry {
    /// Unique ID for this clipboard event.
    pub id: String,
    /// The secret value. Stored in memory only — never serialized to disk.
    #[serde(skip)]
    pub value: String,
    /// What kind of secret this is.
    pub kind: SecretKind,
    /// Optional label for display ("SSH password for prod-server").
    pub label: Option<String>,
    /// Which connection ID this came from, if any.
    pub connection_id: Option<String>,
    /// Which field was copied (e.g. "password", "passphrase", "totpCode").
    pub field: Option<String>,
    /// When this was placed on the clipboard.
    pub copied_at: DateTime<Utc>,
    /// When auto-clear will fire (if enabled). None = no auto-clear.
    pub expires_at: Option<DateTime<Utc>>,
    /// How many times this entry has been pasted.
    pub paste_count: u32,
    /// Maximum number of pastes allowed (0 = unlimited).
    pub max_pastes: u32,
    /// Whether this entry has been cleared (expired or manually).
    pub cleared: bool,
}

impl ClipEntry {
    /// Create a new entry. Auto-calculates expiry based on kind + config.
    pub fn new(
        value: String,
        kind: SecretKind,
        label: Option<String>,
        connection_id: Option<String>,
        field: Option<String>,
        clear_after_secs: u64,
        max_pastes: u32,
    ) -> Self {
        let now = Utc::now();
        let expires_at = if clear_after_secs > 0 {
            Some(now + chrono::Duration::seconds(clear_after_secs as i64))
        } else {
            None
        };

        Self {
            id: Uuid::new_v4().to_string(),
            value,
            kind,
            label,
            connection_id,
            field,
            copied_at: now,
            expires_at,
            paste_count: 0,
            max_pastes,
            cleared: false,
        }
    }

    /// Is this entry still valid (not cleared, not expired, paste limit not exceeded)?
    pub fn is_valid(&self) -> bool {
        if self.cleared {
            return false;
        }
        if let Some(exp) = self.expires_at {
            if Utc::now() >= exp {
                return false;
            }
        }
        if self.max_pastes > 0 && self.paste_count >= self.max_pastes {
            return false;
        }
        true
    }

    /// Seconds remaining before expiry. None if no expiry.
    pub fn seconds_remaining(&self) -> Option<i64> {
        self.expires_at.map(|exp| {
            let diff = exp - Utc::now();
            diff.num_seconds().max(0)
        })
    }

    /// Sanitized view for the UI — value is masked.
    pub fn to_display(&self) -> ClipEntryDisplay {
        let masked = if self.kind.is_sensitive() {
            let len = self.value.len();
            if len == 0 {
                String::new()
            } else if len <= 4 {
                "••••".to_string()
            } else {
                format!("{}••••{}", &self.value[..1], &self.value[len - 1..])
            }
        } else {
            self.value.clone()
        };

        ClipEntryDisplay {
            id: self.id.clone(),
            kind: self.kind,
            label: self.label.clone(),
            connection_id: self.connection_id.clone(),
            field: self.field.clone(),
            copied_at: self.copied_at,
            expires_at: self.expires_at,
            seconds_remaining: self.seconds_remaining(),
            paste_count: self.paste_count,
            max_pastes: self.max_pastes,
            cleared: self.cleared,
            masked_value: masked,
            is_valid: self.is_valid(),
        }
    }
}

/// A display-safe projection of a `ClipEntry` (value is masked).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipEntryDisplay {
    pub id: String,
    pub kind: SecretKind,
    pub label: Option<String>,
    pub connection_id: Option<String>,
    pub field: Option<String>,
    pub copied_at: DateTime<Utc>,
    pub expires_at: Option<DateTime<Utc>>,
    pub seconds_remaining: Option<i64>,
    pub paste_count: u32,
    pub max_pastes: u32,
    pub cleared: bool,
    pub masked_value: String,
    pub is_valid: bool,
}

// ═══════════════════════════════════════════════════════════════════════
//  Configuration
// ═══════════════════════════════════════════════════════════════════════

/// User-configurable settings for the secure clipboard.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SecureClipConfig {
    /// Globally enable/disable the secure clipboard.
    pub enabled: bool,

    /// Auto-clear timeout in seconds (0 = use per-kind defaults).
    /// Overrides the per-kind default if non-zero.
    #[serde(default = "default_clear_secs")]
    pub auto_clear_secs: u64,

    /// Default max pastes for sensitive entries (0 = unlimited).
    #[serde(default = "default_max_pastes")]
    pub default_max_pastes: u32,

    /// Whether to allow one-time-paste mode (entry is cleared after first paste).
    #[serde(default = "default_true")]
    pub one_time_paste_available: bool,

    /// Copy-to-terminal: automatically type the password into the active SSH session.
    #[serde(default = "default_true")]
    pub paste_to_terminal_enabled: bool,

    /// Show a notification when a secret is copied / cleared.
    #[serde(default = "default_true")]
    pub show_notifications: bool,

    /// Play a sound effect on copy / clear.
    #[serde(default)]
    pub play_sounds: bool,

    /// Keep a history of past clip metadata (not values!) for auditing.
    #[serde(default = "default_true")]
    pub history_enabled: bool,

    /// Max number of history entries to keep.
    #[serde(default = "default_history_max")]
    pub history_max_entries: usize,

    /// Prevent copying secrets when the app is locked.
    #[serde(default = "default_true")]
    pub block_when_locked: bool,

    /// Clear the OS clipboard on application exit.
    #[serde(default = "default_true")]
    pub clear_on_exit: bool,

    /// Clear the OS clipboard when the app is locked / minimized.
    #[serde(default)]
    pub clear_on_lock: bool,

    /// Per-kind timeout overrides (kind → seconds).
    #[serde(default)]
    pub kind_clear_overrides: std::collections::HashMap<SecretKind, u64>,
}

fn default_clear_secs() -> u64 {
    12
}
fn default_max_pastes() -> u32 {
    0
}
fn default_true() -> bool {
    true
}
fn default_history_max() -> usize {
    200
}

impl Default for SecureClipConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            auto_clear_secs: 12,
            default_max_pastes: 0,
            one_time_paste_available: true,
            paste_to_terminal_enabled: true,
            show_notifications: true,
            play_sounds: false,
            history_enabled: true,
            history_max_entries: 200,
            block_when_locked: true,
            clear_on_exit: true,
            clear_on_lock: false,
            kind_clear_overrides: Default::default(),
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════
//  Copy request — what the frontend sends us
// ═══════════════════════════════════════════════════════════════════════

/// A request to copy a credential field to the secure clipboard.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CopyRequest {
    /// The secret value to copy.
    pub value: String,
    /// What kind of secret.
    pub kind: SecretKind,
    /// Optional human label.
    pub label: Option<String>,
    /// Connection ID this came from (if any).
    pub connection_id: Option<String>,
    /// Field name (e.g. "password", "passphrase", "totpCode").
    pub field: Option<String>,
    /// Override the auto-clear timeout (seconds). None = use config default.
    pub clear_after_secs: Option<u64>,
    /// Override max pastes. None = use config default.
    pub max_pastes: Option<u32>,
    /// If true, this is a one-time paste (cleared after first paste).
    #[serde(default)]
    pub one_time: bool,
}

/// A request to paste the current secret into an SSH terminal session.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PasteToTerminalRequest {
    /// Which SSH session to paste into.
    pub session_id: String,
    /// If set, paste a specific clip entry by ID. Otherwise paste the "current" entry.
    pub entry_id: Option<String>,
    /// Whether to simulate keystroke-by-keystroke typing (slower but works in more TUIs).
    #[serde(default)]
    pub simulate_typing: bool,
    /// Delay between keystrokes in ms (only for simulate_typing).
    #[serde(default = "default_typing_delay")]
    pub typing_delay_ms: u64,
}

fn default_typing_delay() -> u64 {
    15
}

/// Response returned by the `paste_to_terminal` command.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PasteToTerminalResponse {
    pub entry_id: String,
    pub value: String,
}

// ═══════════════════════════════════════════════════════════════════════
//  History entry — metadata only, value is never stored
// ═══════════════════════════════════════════════════════════════════════

/// A historical record of a copy event (the plaintext value is NOT stored).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipHistoryEntry {
    pub id: String,
    pub kind: SecretKind,
    pub label: Option<String>,
    pub connection_id: Option<String>,
    pub field: Option<String>,
    pub copied_at: DateTime<Utc>,
    pub cleared_at: Option<DateTime<Utc>>,
    pub clear_reason: Option<ClearReason>,
    pub paste_count: u32,
    pub max_pastes: u32,
}

/// Why an entry was cleared from the clipboard.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ClearReason {
    /// Automatic timeout.
    AutoClear,
    /// Maximum pastes reached.
    MaxPastes,
    /// User manually cleared.
    ManualClear,
    /// New copy replaced the old entry.
    Replaced,
    /// Application locked.
    AppLocked,
    /// Application exiting.
    AppExit,
}

// ═══════════════════════════════════════════════════════════════════════
//  Stats
// ═══════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SecureClipStats {
    pub current_entry_active: bool,
    pub current_entry_kind: Option<SecretKind>,
    pub seconds_remaining: Option<i64>,
    pub total_copies: u64,
    pub total_pastes: u64,
    pub total_auto_clears: u64,
    pub total_manual_clears: u64,
    pub history_entries: usize,
}
