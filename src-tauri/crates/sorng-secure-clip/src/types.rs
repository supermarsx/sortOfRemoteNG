use std::fmt;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;
use zeroize::{Zeroize, Zeroizing};

// ═══════════════════════════════════════════════════════════════════════
//  Limits
// ═══════════════════════════════════════════════════════════════════════

/// Longest auto-clear delay policy may configure: seven days.
pub const MIN_CLIPBOARD_BYTES: usize = 64 * 1024;
pub const DEFAULT_CLIPBOARD_BYTES: usize = 150 * 1024 * 1024;
pub const MAX_CLIPBOARD_BYTES: usize = 512 * 1024 * 1024;

pub const MAX_POLICY_CLEAR_SECS: u64 = 7 * 24 * 60 * 60;

/// Shortest delay a single copy request may ask for in
/// [`CopyRequest::clear_after_secs`]. Zero would mean "never clear", which
/// only policy may decide.
pub const MIN_REQUEST_CLEAR_SECS: u64 = 1;

/// Longest delay a single copy request may ask for: five minutes. The
/// renderer supplies this number, so it must not be able to keep a secret on
/// the clipboard for as long as it likes.
pub const MAX_REQUEST_CLEAR_SECS: u64 = 300;

// ═══════════════════════════════════════════════════════════════════════
//  Errors
// ═══════════════════════════════════════════════════════════════════════

/// Why a secure-clipboard operation was refused or could not finish.
///
/// Every variant travels as its fixed [`code`](Self::code) and as nothing
/// else: no sentence, no operating-system error text and never any part of a
/// value. The frontend turns a code into a sentence.
///
/// Contract K7 (t101): a copy fails with exactly one of `locked`, `busy`,
/// `too-large` or `unavailable`; see [`for_copy`](Self::for_copy). The other
/// codes belong to the paste, clear and configuration commands.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum SecureClipError {
    /// `locked`: the app is locked and policy blocks the secure clipboard.
    Locked,
    /// `busy`: the OS clipboard is held by another program, or a clipboard
    /// helper did not answer in time. Nothing was changed; a retry can work.
    Busy,
    /// `too-large`: the value exceeds the secure size limit. Nothing was
    /// written.
    TooLarge,
    /// `unavailable`: any other reason the operation could not be carried
    /// out: the secure clipboard is disabled, policy forbids the requested
    /// mode, or the OS clipboard rejected the operation.
    Unavailable,
    /// `invalid-request`: the caller's arguments are malformed (an empty
    /// value, a value with a NUL, an auto-clear delay outside
    /// [`MIN_REQUEST_CLEAR_SECS`]..=[`MAX_REQUEST_CLEAR_SECS`], a setting out
    /// of range). Never returned by a copy, which reports it as `unavailable`.
    InvalidRequest,
    /// `empty`: there is no entry to paste.
    Empty,
    /// `stale`: the requested entry is no longer the current one.
    Stale,
    /// `expired`: the entry expired, was cleared, or has no pastes left.
    Expired,
}

impl SecureClipError {
    /// The only codes a copy command may return (contract K7).
    pub const COPY_CODES: [&'static str; 4] = ["locked", "busy", "too-large", "unavailable"];

    /// The fixed wire code.
    pub const fn code(self) -> &'static str {
        match self {
            Self::Locked => "locked",
            Self::Busy => "busy",
            Self::TooLarge => "too-large",
            Self::Unavailable => "unavailable",
            Self::InvalidRequest => "invalid-request",
            Self::Empty => "empty",
            Self::Stale => "stale",
            Self::Expired => "expired",
        }
    }

    /// Narrow an error to the copy contract: anything that is not `locked`,
    /// `busy` or `too-large` is `unavailable`.
    pub const fn for_copy(self) -> Self {
        match self {
            Self::Locked | Self::Busy | Self::TooLarge => self,
            Self::Unavailable
            | Self::InvalidRequest
            | Self::Empty
            | Self::Stale
            | Self::Expired => Self::Unavailable,
        }
    }
}

impl fmt::Display for SecureClipError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.code())
    }
}

impl std::error::Error for SecureClipError {}

impl Serialize for SecureClipError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(self.code())
    }
}

impl From<SecureClipError> for String {
    fn from(error: SecureClipError) -> Self {
        error.code().to_string()
    }
}

/// Stands in for a value in `Debug` output.
struct Redacted;

impl fmt::Debug for Redacted {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("<redacted>")
    }
}

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
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipEntry {
    /// Unique ID for this clipboard event.
    pub id: String,
    /// The secret value. Stored in memory only — never serialized to disk.
    #[serde(skip)]
    pub value: std::sync::Arc<Zeroizing<String>>,
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

impl fmt::Debug for ClipEntry {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("ClipEntry")
            .field("id", &self.id)
            .field("value", &Redacted)
            .field("kind", &self.kind)
            .field("label", &self.label)
            .field("connection_id", &self.connection_id)
            .field("field", &self.field)
            .field("copied_at", &self.copied_at)
            .field("expires_at", &self.expires_at)
            .field("paste_count", &self.paste_count)
            .field("max_pastes", &self.max_pastes)
            .field("cleared", &self.cleared)
            .finish()
    }
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
        // Clamped to the policy ceiling so that no delay can overflow the
        // clock arithmetic or wrap into the past.
        let expires_at = (clear_after_secs > 0).then(|| {
            let seconds = clear_after_secs.min(MAX_POLICY_CLEAR_SECS) as i64;
            now + chrono::Duration::seconds(seconds)
        });

        Self {
            id: Uuid::new_v4().to_string(),
            value: std::sync::Arc::new(Zeroizing::new(value)),
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
            let char_count = self.value.chars().take(5).count();
            if char_count == 0 {
                String::new()
            } else if char_count <= 4 {
                "••••".to_string()
            } else {
                let first = self.value.chars().next().unwrap_or_default();
                let last = self.value.chars().next_back().unwrap_or_default();
                format!("{first}••••{last}")
            }
        } else {
            self.value.as_str().to_owned()
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
#[derive(Clone, Serialize, Deserialize)]
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

// `masked_value` is the whole value for the kinds the UI shows in clear and
// the first and last character for the others, so it stays out of `Debug`.
impl fmt::Debug for ClipEntryDisplay {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("ClipEntryDisplay")
            .field("id", &self.id)
            .field("kind", &self.kind)
            .field("label", &self.label)
            .field("connection_id", &self.connection_id)
            .field("field", &self.field)
            .field("copied_at", &self.copied_at)
            .field("expires_at", &self.expires_at)
            .field("seconds_remaining", &self.seconds_remaining)
            .field("paste_count", &self.paste_count)
            .field("max_pastes", &self.max_pastes)
            .field("cleared", &self.cleared)
            .field("masked_value", &Redacted)
            .field("is_valid", &self.is_valid)
            .finish()
    }
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

    /// Maximum UTF-8 bytes for one secure copy (64 KiB to 512 MiB).
    #[serde(default = "default_max_value_bytes")]
    pub max_value_bytes: usize,

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

fn default_max_value_bytes() -> usize {
    DEFAULT_CLIPBOARD_BYTES
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
            max_value_bytes: DEFAULT_CLIPBOARD_BYTES,
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
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CopyRequest {
    /// The secret value to copy. Must be non-empty and free of NUL.
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
    /// When present it must lie in
    /// [`MIN_REQUEST_CLEAR_SECS`]..=[`MAX_REQUEST_CLEAR_SECS`]; anything else
    /// is refused before the clipboard is touched.
    pub clear_after_secs: Option<u64>,
    /// Override max pastes. None = use config default.
    pub max_pastes: Option<u32>,
    /// If true, this is a one-time paste (cleared after first paste).
    #[serde(default)]
    pub one_time: bool,
}

impl Drop for CopyRequest {
    fn drop(&mut self) {
        self.value.zeroize();
    }
}

impl fmt::Debug for CopyRequest {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("CopyRequest")
            .field("value", &Redacted)
            .field("kind", &self.kind)
            .field("label", &self.label)
            .field("connection_id", &self.connection_id)
            .field("field", &self.field)
            .field("clear_after_secs", &self.clear_after_secs)
            .field("max_pastes", &self.max_pastes)
            .field("one_time", &self.one_time)
            .finish()
    }
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
    pub paste_count: u32,
    pub cleared: bool,
}

/// Internal native-only payload. This type is never serialized to the renderer.
pub struct NativeTerminalPaste {
    pub response: PasteToTerminalResponse,
    pub value: Zeroizing<String>,
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

#[cfg(test)]
mod tests {
    use super::*;

    const EVERY_ERROR: [SecureClipError; 8] = [
        SecureClipError::Locked,
        SecureClipError::Busy,
        SecureClipError::TooLarge,
        SecureClipError::Unavailable,
        SecureClipError::InvalidRequest,
        SecureClipError::Empty,
        SecureClipError::Stale,
        SecureClipError::Expired,
    ];

    #[test]
    fn every_error_travels_as_its_fixed_code_and_nothing_else() {
        let codes = [
            "locked",
            "busy",
            "too-large",
            "unavailable",
            "invalid-request",
            "empty",
            "stale",
            "expired",
        ];
        for (error, code) in EVERY_ERROR.into_iter().zip(codes) {
            assert_eq!(error.code(), code);
            assert_eq!(error.to_string(), code);
            assert_eq!(String::from(error), code);
            assert_eq!(
                serde_json::to_value(error).expect("serialize"),
                serde_json::Value::String(code.to_string())
            );
        }
    }

    #[test]
    fn a_copy_request_deserializes_as_the_frontend_sends_it() {
        // Every kind the frontend sends, by its wire name.
        for kind in [
            "username",
            "password",
            "totpCode",
            "apiKey",
            "genericSecret",
        ] {
            let request: CopyRequest = serde_json::from_value(serde_json::json!({
                "value": "SYNTHETIC",
                "kind": kind,
                "field": "recoveryCode",
                "connectionId": "c",
                "label": null,
                "clearAfterSecs": null,
                "maxPastes": null,
                "oneTime": false,
            }))
            .expect(kind);

            assert_eq!(serde_json::to_value(request.kind).expect("kind"), kind);
            assert_eq!(request.value, "SYNTHETIC");
            assert_eq!(request.field.as_deref(), Some("recoveryCode"));
            assert_eq!(request.connection_id.as_deref(), Some("c"));
            assert_eq!(request.clear_after_secs, None, "null leaves it to policy");
            assert_eq!(request.max_pastes, None);
            assert!(!request.one_time);
        }

        let timed: CopyRequest = serde_json::from_value(serde_json::json!({
            "value": "123456",
            "kind": "totpCode",
            "field": "totpCode",
            "connectionId": null,
            "label": null,
            "clearAfterSecs": 9,
            "maxPastes": null,
            "oneTime": false,
        }))
        .expect("a one-time code with a known expiry");
        assert_eq!(timed.clear_after_secs, Some(9));
    }

    #[test]
    fn a_copy_can_only_fail_with_the_four_contract_codes() {
        assert_eq!(
            SecureClipError::COPY_CODES,
            ["locked", "busy", "too-large", "unavailable"]
        );
        for error in EVERY_ERROR {
            let narrowed = error.for_copy();
            assert!(
                SecureClipError::COPY_CODES.contains(&narrowed.code()),
                "{error} must not reach a copy caller as {narrowed}"
            );
            assert_eq!(narrowed.for_copy(), narrowed);
        }
        for kept in [
            SecureClipError::Locked,
            SecureClipError::Busy,
            SecureClipError::TooLarge,
        ] {
            assert_eq!(kept.for_copy(), kept);
        }
    }
}
