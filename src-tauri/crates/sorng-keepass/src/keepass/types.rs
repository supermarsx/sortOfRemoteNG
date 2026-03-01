// ── sorng-keepass / types ──────────────────────────────────────────────────────
//
// All types for KeePass KDBX database integration.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// ─── Database Types ───────────────────────────────────────────────────────────

/// Represents an open KeePass database instance.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KeePassDatabase {
    /// Unique identifier for this open database session
    pub id: String,
    /// File path of the .kdbx file
    pub file_path: String,
    /// Database name from the metadata
    pub name: String,
    /// Database description
    pub description: String,
    /// Default username for new entries
    pub default_username: String,
    /// Whether the database is currently locked (in memory but sealed)
    pub locked: bool,
    /// Whether the database has unsaved changes
    pub modified: bool,
    /// KDBX format version (e.g., "4.1", "4.0", "3.1")
    pub format_version: String,
    /// Encryption cipher used
    pub cipher: KeePassCipher,
    /// Key derivation function settings
    pub kdf: KdfSettings,
    /// Compression algorithm
    pub compression: KeePassCompression,
    /// Root group UUID
    pub root_group_id: String,
    /// Recycle bin group UUID (if enabled)
    pub recycle_bin_id: Option<String>,
    /// Whether recycle bin is enabled
    pub recycle_bin_enabled: bool,
    /// Database color tag
    pub color: Option<String>,
    /// Master seed for key derivation (hex-encoded, never sent to frontend)
    #[serde(skip_serializing)]
    pub master_seed: Option<String>,
    /// Total number of entries
    pub entry_count: usize,
    /// Total number of groups
    pub group_count: usize,
    /// When the database was created
    pub created_at: String,
    /// When the database was last modified
    pub modified_at: String,
    /// When the database was last opened
    pub last_opened_at: String,
    /// Custom database icons
    pub custom_icon_count: usize,
    /// Database metadata key-value pairs
    pub custom_data: HashMap<String, String>,
}

/// Database creation request.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateDatabaseRequest {
    /// File path for the new .kdbx file
    pub file_path: String,
    /// Database name
    pub name: String,
    /// Database description (optional)
    pub description: Option<String>,
    /// Master password
    pub password: Option<String>,
    /// Path to a key file (optional)
    pub key_file_path: Option<String>,
    /// Encryption cipher
    pub cipher: Option<KeePassCipher>,
    /// KDF settings
    pub kdf: Option<KdfSettings>,
    /// Compression mode
    pub compression: Option<KeePassCompression>,
    /// Default username for new entries
    pub default_username: Option<String>,
    /// Whether to enable recycle bin
    pub enable_recycle_bin: Option<bool>,
}

/// Request to open an existing database.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpenDatabaseRequest {
    /// File path to the .kdbx file
    pub file_path: String,
    /// Master password
    pub password: Option<String>,
    /// Path to a key file
    pub key_file_path: Option<String>,
    /// Whether to open read-only
    pub read_only: Option<bool>,
}

/// Database save options.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SaveDatabaseOptions {
    /// If set, save to this path instead (Save As)
    pub file_path: Option<String>,
    /// Create a backup before saving
    pub create_backup: Option<bool>,
    /// New encryption settings (rekey)
    pub new_cipher: Option<KeePassCipher>,
    /// New KDF settings (rekey)
    pub new_kdf: Option<KdfSettings>,
}

/// Summary info for a database (returned without opening it).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DatabaseFileInfo {
    pub file_path: String,
    pub file_size: u64,
    pub format_version: Option<String>,
    pub cipher: Option<String>,
    pub kdf: Option<String>,
    pub created: Option<String>,
    pub modified: Option<String>,
}

// ─── Encryption / KDF ─────────────────────────────────────────────────────────

/// Encryption ciphers supported by KDBX.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum KeePassCipher {
    /// AES-256-CBC (AES/Rijndael)
    Aes256,
    /// Twofish-256-CBC
    Twofish,
    /// ChaCha20-Poly1305
    ChaCha20,
}

impl Default for KeePassCipher {
    fn default() -> Self {
        Self::Aes256
    }
}

/// Key derivation function settings.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KdfSettings {
    /// KDF algorithm
    pub algorithm: KdfAlgorithm,
    /// Number of iterations (AES-KDF rounds)
    pub iterations: Option<u64>,
    /// Memory usage in bytes (Argon2)
    pub memory: Option<u64>,
    /// Parallelism (Argon2 lanes)
    pub parallelism: Option<u32>,
    /// Salt (hex-encoded)
    pub salt: Option<String>,
}

impl Default for KdfSettings {
    fn default() -> Self {
        Self {
            algorithm: KdfAlgorithm::Argon2d,
            iterations: Some(2),
            memory: Some(64 * 1024 * 1024), // 64 MB
            parallelism: Some(2),
            salt: None,
        }
    }
}

/// Key derivation function algorithms.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum KdfAlgorithm {
    /// AES-KDF (legacy, KDBX 3.x)
    AesKdf,
    /// Argon2d (KDBX 4.x)
    Argon2d,
    /// Argon2id (KDBX 4.x, recommended)
    Argon2id,
}

/// Compression algorithms.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum KeePassCompression {
    None,
    GZip,
}

impl Default for KeePassCompression {
    fn default() -> Self {
        Self::GZip
    }
}

// ─── Composite Key Types ──────────────────────────────────────────────────────

/// Composite key components for opening/creating a database.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompositeKey {
    /// Master password component
    pub password: Option<String>,
    /// Key file path
    pub key_file_path: Option<String>,
    /// Key file content (base64, for in-memory key files)
    pub key_file_content: Option<String>,
    /// Whether Windows user account key is part of composite
    pub windows_user_account: bool,
    /// YubiKey challenge-response slot
    pub yubikey_slot: Option<u8>,
}

/// Key file format variants.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum KeyFileFormat {
    /// XML key file (.keyx) — KeePass 2.x
    Xml,
    /// 32-byte binary key file
    Binary32,
    /// 64-character hex string
    Hex64,
    /// Random-content key file (hashed)
    Random,
}

/// Key file creation request.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateKeyFileRequest {
    /// Output file path
    pub file_path: String,
    /// Key file format
    pub format: KeyFileFormat,
    /// Optional custom data to use as key material (base64-encoded)
    pub custom_data: Option<String>,
}

/// Key file info.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KeyFileInfo {
    pub file_path: String,
    pub format: KeyFileFormat,
    pub hash: String,
    pub file_size: u64,
    pub created_at: Option<String>,
}

// ─── Group Types ──────────────────────────────────────────────────────────────

/// A KeePass group (folder) in the database tree.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KeePassGroup {
    /// UUID of this group
    pub uuid: String,
    /// Display name
    pub name: String,
    /// Notes/description
    pub notes: String,
    /// Standard icon index (0-68)
    pub icon_id: u32,
    /// Custom icon UUID (if set)
    pub custom_icon_uuid: Option<String>,
    /// UUID of the parent group (None for root)
    pub parent_uuid: Option<String>,
    /// Whether this group is expanded in the tree UI
    pub is_expanded: bool,
    /// Default auto-type sequence for entries in this group
    pub default_auto_type_sequence: Option<String>,
    /// Auto-type enabled state
    pub enable_auto_type: Option<bool>,
    /// Search enabled for this group
    pub enable_searching: Option<bool>,
    /// Last top visible entry UUID
    pub last_top_visible_entry: Option<String>,
    /// Whether this is the recycle bin group
    pub is_recycle_bin: bool,
    /// Number of direct child entries
    pub entry_count: usize,
    /// Number of direct child groups
    pub child_group_count: usize,
    /// Total entries (recursive)
    pub total_entry_count: usize,
    /// Timestamps
    pub times: KeePassTimes,
    /// Tags
    pub tags: Vec<String>,
    /// Custom data on this group
    pub custom_data: HashMap<String, String>,
}

/// Request to create/update a group.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GroupRequest {
    /// Group name
    pub name: String,
    /// Parent group UUID (None → root)
    pub parent_uuid: Option<String>,
    /// Icon index
    pub icon_id: Option<u32>,
    /// Custom icon UUID
    pub custom_icon_uuid: Option<String>,
    /// Notes
    pub notes: Option<String>,
    /// Default auto-type sequence
    pub default_auto_type_sequence: Option<String>,
    /// Whether auto-type is enabled
    pub enable_auto_type: Option<bool>,
    /// Whether searching is enabled
    pub enable_searching: Option<bool>,
    /// Tags
    pub tags: Option<Vec<String>>,
}

/// Group tree node for hierarchical display.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GroupTreeNode {
    pub uuid: String,
    pub name: String,
    pub icon_id: u32,
    pub custom_icon_uuid: Option<String>,
    pub is_recycle_bin: bool,
    pub entry_count: usize,
    pub children: Vec<GroupTreeNode>,
    pub depth: usize,
}

// ─── Entry Types ──────────────────────────────────────────────────────────────

/// A KeePass password entry.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KeePassEntry {
    /// UUID of this entry
    pub uuid: String,
    /// UUID of the parent group
    pub group_uuid: String,
    /// Standard icon index
    pub icon_id: u32,
    /// Custom icon UUID
    pub custom_icon_uuid: Option<String>,
    /// Foreground color (hex)
    pub foreground_color: Option<String>,
    /// Background color (hex)
    pub background_color: Option<String>,
    /// Override URL for auto-type
    pub override_url: Option<String>,
    /// Quality estimate of the password (0-128 bits of entropy)
    pub password_quality: Option<f64>,
    /// Tags
    pub tags: Vec<String>,
    /// Standard fields
    pub title: String,
    pub username: String,
    /// Password (protected field — may be masked in responses)
    pub password: String,
    pub url: String,
    pub notes: String,
    /// Custom string fields (name → value)
    pub custom_fields: HashMap<String, CustomField>,
    /// Binary attachment references
    pub attachments: Vec<EntryAttachmentRef>,
    /// Auto-type configuration
    pub auto_type: Option<AutoTypeConfig>,
    /// OTP configuration (TOTP/HOTP)
    pub otp: Option<OtpConfig>,
    /// Entry timestamps
    pub times: KeePassTimes,
    /// Number of history entries
    pub history_count: usize,
    /// Whether this entry is in the recycle bin
    pub is_recycled: bool,
}

/// Request to create or update an entry.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EntryRequest {
    /// Group UUID for the entry
    pub group_uuid: String,
    /// Title
    pub title: Option<String>,
    /// Username
    pub username: Option<String>,
    /// Password
    pub password: Option<String>,
    /// URL
    pub url: Option<String>,
    /// Notes
    pub notes: Option<String>,
    /// Custom string fields
    pub custom_fields: Option<HashMap<String, CustomField>>,
    /// Icon index
    pub icon_id: Option<u32>,
    /// Custom icon UUID
    pub custom_icon_uuid: Option<String>,
    /// Foreground color
    pub foreground_color: Option<String>,
    /// Background color
    pub background_color: Option<String>,
    /// Override URL
    pub override_url: Option<String>,
    /// Tags
    pub tags: Option<Vec<String>>,
    /// Auto-type config
    pub auto_type: Option<AutoTypeConfig>,
    /// OTP config
    pub otp: Option<OtpConfig>,
    /// Expiry date
    pub expiry_time: Option<String>,
    /// Whether the entry expires
    pub expires: Option<bool>,
}

/// A custom string field on an entry.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CustomField {
    /// Field value
    pub value: String,
    /// Whether this field is memory-protected (sensitive)
    pub is_protected: bool,
}

/// Reference to a binary attachment within an entry.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EntryAttachmentRef {
    /// Binary pool reference ID
    pub ref_id: String,
    /// Display name / filename
    pub filename: String,
}

/// Entry summary for list views (doesn't include password or sensitive data).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EntrySummary {
    pub uuid: String,
    pub group_uuid: String,
    pub title: String,
    pub username: String,
    pub url: String,
    pub icon_id: u32,
    pub custom_icon_uuid: Option<String>,
    pub tags: Vec<String>,
    pub has_password: bool,
    pub has_otp: bool,
    pub has_attachments: bool,
    pub attachment_count: usize,
    pub is_expired: bool,
    pub created_at: String,
    pub modified_at: String,
    pub last_accessed_at: Option<String>,
    pub expiry_time: Option<String>,
}

/// Entry history snapshot.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EntryHistoryItem {
    /// Index in history (0 = oldest)
    pub index: usize,
    /// The full entry state at this point
    pub entry: KeePassEntry,
    /// When this snapshot was created
    pub modified_at: String,
}

/// Diff between two entry states.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EntryDiff {
    pub uuid: String,
    pub changed_fields: Vec<FieldChange>,
    pub added_custom_fields: Vec<String>,
    pub removed_custom_fields: Vec<String>,
    pub added_attachments: Vec<String>,
    pub removed_attachments: Vec<String>,
}

/// Individual field change.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FieldChange {
    pub field_name: String,
    pub old_value: Option<String>,
    pub new_value: Option<String>,
}

// ─── Timestamps ───────────────────────────────────────────────────────────────

/// KeePass timestamps for entries and groups.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KeePassTimes {
    pub created: String,
    pub last_modified: String,
    pub last_accessed: String,
    pub expiry_time: Option<String>,
    pub expires: bool,
    pub usage_count: u32,
    pub location_changed: Option<String>,
}

impl Default for KeePassTimes {
    fn default() -> Self {
        let now = chrono::Utc::now().to_rfc3339();
        Self {
            created: now.clone(),
            last_modified: now.clone(),
            last_accessed: now,
            expiry_time: None,
            expires: false,
            usage_count: 0,
            location_changed: None,
        }
    }
}

// ─── Auto-Type Types ──────────────────────────────────────────────────────────

/// Auto-type configuration for an entry.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AutoTypeConfig {
    /// Whether auto-type is enabled for this entry
    pub enabled: bool,
    /// Data transfer obfuscation level (0 = none, 1 = Two-channel auto-type obfuscation)
    pub obfuscation: u32,
    /// Default keystroke sequence (e.g., "{USERNAME}{TAB}{PASSWORD}{ENTER}")
    pub default_sequence: Option<String>,
    /// Window-specific associations
    pub associations: Vec<AutoTypeAssociation>,
}

/// An auto-type window/sequence association.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AutoTypeAssociation {
    /// Target window title pattern (supports wildcards)
    pub window: String,
    /// Keystroke sequence for this window (None = use default)
    pub sequence: Option<String>,
}

/// Result of auto-type matching.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AutoTypeMatch {
    pub entry_uuid: String,
    pub entry_title: String,
    pub sequence: String,
    pub window_match: String,
}

/// Auto-type sequence token (parsed).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum AutoTypeToken {
    /// Literal text to type
    Literal(String),
    /// Special key press (e.g., "TAB", "ENTER", "BACKSPACE")
    Key(String),
    /// Field reference (e.g., "UserName", "Password", "URL")
    FieldRef(String),
    /// Modifier key (e.g., "SHIFT", "CTRL", "ALT")
    Modifier(String),
    /// Delay in milliseconds
    Delay(u32),
    /// Special command (e.g., "CLEARFIELD", "VKEY")
    Command(String),
    /// Repeated token
    Repeat(Box<AutoTypeToken>, u32),
}

// ─── OTP Types ────────────────────────────────────────────────────────────────

/// One-Time Password (TOTP/HOTP) configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OtpConfig {
    /// OTP type
    pub otp_type: OtpType,
    /// Base32-encoded secret
    pub secret: String,
    /// Issuer name
    pub issuer: Option<String>,
    /// Account name
    pub account: Option<String>,
    /// Hash algorithm
    pub algorithm: OtpAlgorithm,
    /// Number of digits (6 or 8)
    pub digits: u32,
    /// TOTP period in seconds (default 30)
    pub period: Option<u32>,
    /// HOTP counter value
    pub counter: Option<u64>,
}

/// OTP type.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum OtpType {
    Totp,
    Hotp,
    Steam,
}

/// OTP hash algorithm.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum OtpAlgorithm {
    Sha1,
    Sha256,
    Sha512,
}

impl Default for OtpAlgorithm {
    fn default() -> Self {
        Self::Sha1
    }
}

/// Current OTP value with time info.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OtpValue {
    pub code: String,
    pub remaining_seconds: Option<u32>,
    pub period: Option<u32>,
    pub algorithm: OtpAlgorithm,
}

// ─── Attachment Types ─────────────────────────────────────────────────────────

/// A binary attachment stored in the database.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KeePassAttachment {
    /// Binary pool reference ID
    pub ref_id: String,
    /// Filename
    pub filename: String,
    /// MIME type (inferred)
    pub mime_type: String,
    /// Size in bytes
    pub size: u64,
    /// SHA-256 hash of the content
    pub hash: String,
}

/// Request to add an attachment.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AddAttachmentRequest {
    /// Entry UUID to attach to
    pub entry_uuid: String,
    /// Display name / filename
    pub filename: String,
    /// Base64-encoded file content
    pub data_base64: String,
    /// Optional MIME type override
    pub mime_type: Option<String>,
}

// ─── Search Types ─────────────────────────────────────────────────────────────

/// Advanced search query.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchQuery {
    /// Text to search for
    pub text: Option<String>,
    /// Whether to use regex matching
    pub is_regex: bool,
    /// Case-sensitive matching
    pub case_sensitive: bool,
    /// Fields to search in
    pub fields: Option<Vec<SearchField>>,
    /// Filter by tags (all must match)
    pub tags: Option<Vec<String>>,
    /// Only search within this group UUID
    pub group_uuid: Option<String>,
    /// Include subgroups when filtering by group
    pub include_subgroups: bool,
    /// Exclude expired entries
    pub exclude_expired: bool,
    /// Only return expired entries
    pub only_expired: bool,
    /// Only return entries expiring within N days
    pub expires_within_days: Option<u32>,
    /// Filter by attachment presence
    pub has_attachments: Option<bool>,
    /// Filter by OTP presence
    pub has_otp: Option<bool>,
    /// Filter by URL presence
    pub has_url: Option<bool>,
    /// Maximum password strength to include
    pub password_strength_max: Option<PasswordStrength>,
    /// Created after this date
    pub created_after: Option<String>,
    /// Created before this date
    pub created_before: Option<String>,
    /// Modified after this date
    pub modified_after: Option<String>,
    /// Modified before this date
    pub modified_before: Option<String>,
    /// Sort order
    pub sort_by: Option<SearchSortField>,
    /// Sort ascending
    pub sort_ascending: Option<bool>,
    /// Offset for pagination
    pub offset: Option<usize>,
    /// Maximum results
    pub limit: Option<usize>,
}

/// Searchable fields.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum SearchField {
    Title,
    Username,
    Password,
    Url,
    Notes,
    Tags,
    CustomFields,
    Uuid,
    Attachments,
}

/// Sort fields for search results.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum SearchSortField {
    Title,
    Username,
    Url,
    Created,
    Modified,
    Accessed,
    ExpiryTime,
}

/// Search result.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResult {
    pub entries: Vec<EntrySummary>,
    pub total_matches: usize,
    pub search_time_ms: u64,
    pub has_more: bool,
}

// ─── Password Generator Types ─────────────────────────────────────────────────

/// Password generation request.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PasswordGeneratorRequest {
    /// Mode of generation
    pub mode: PasswordGenMode,
    /// Desired password length
    pub length: usize,
    /// Character sets to include (for CharacterSet mode)
    pub character_sets: Option<Vec<CharacterSet>>,
    /// Custom characters to include
    pub custom_characters: Option<String>,
    /// Characters to exclude
    pub exclude_characters: Option<String>,
    /// Exclude look-alike characters (0OIl1|)
    pub exclude_lookalikes: bool,
    /// Ensure at least one character from each enabled set
    pub ensure_each_set: bool,
    /// Pattern string (for Pattern mode)
    pub pattern: Option<String>,
    /// Number of passwords to generate
    pub count: Option<usize>,
}

/// Password generation mode.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum PasswordGenMode {
    /// Generate based on selected character sets
    CharacterSet,
    /// Generate based on a pattern string
    Pattern,
    /// Generate a passphrase from word lists
    Passphrase,
}

/// Character sets for password generation.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum CharacterSet {
    UpperCase,
    LowerCase,
    Digits,
    Special,
    Space,
    Brackets,
    HighAnsi,
    Minus,
    Underline,
}

/// Passphrase generation options.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PassphraseOptions {
    /// Number of words
    pub word_count: usize,
    /// Separator between words
    pub separator: String,
    /// Capitalize first letter of each word
    pub capitalize: bool,
    /// Append a digit to each word
    pub include_numbers: bool,
}

/// Generated password result.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GeneratedPassword {
    pub password: String,
    pub entropy_bits: f64,
    pub strength: PasswordStrength,
    pub character_count: usize,
    pub has_upper: bool,
    pub has_lower: bool,
    pub has_digits: bool,
    pub has_special: bool,
}

/// Password strength rating.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum PasswordStrength {
    VeryWeak,
    Weak,
    Fair,
    Strong,
    VeryStrong,
}

/// Password quality analysis.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PasswordAnalysis {
    pub entropy_bits: f64,
    pub strength: PasswordStrength,
    pub length: usize,
    pub has_upper: bool,
    pub has_lower: bool,
    pub has_digits: bool,
    pub has_special: bool,
    pub has_unicode: bool,
    pub repeated_chars: usize,
    pub sequential_chars: usize,
    pub common_patterns: Vec<String>,
    pub suggestions: Vec<String>,
    pub estimated_crack_time: String,
}

/// Saved password generator profile.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PasswordProfile {
    pub id: String,
    pub name: String,
    pub description: String,
    pub config: PasswordGeneratorRequest,
    pub is_builtin: bool,
    pub created_at: String,
    pub modified_at: String,
}

// ─── Import / Export Types ────────────────────────────────────────────────────

/// Import source format.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum ImportFormat {
    /// KeePass 2.x XML export
    KeePassXml,
    /// KeePass CSV export
    KeePassCsv,
    /// Generic CSV with field mapping
    GenericCsv,
    /// LastPass CSV export
    LastPassCsv,
    /// Bitwarden JSON export
    BitwardenJson,
    /// Bitwarden CSV export
    BitwardenCsv,
    /// 1Password CSV export
    OnePasswordCsv,
    /// Chrome/Chromium CSV passwords export
    ChromeCsv,
    /// Firefox CSV passwords export
    FirefoxCsv,
    /// KeePass 1.x XML
    KeePassXmlV1,
    /// KDBX (merge/import another database)
    Kdbx,
}

/// Export target format.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum ExportFormat {
    /// KeePass XML
    KeePassXml,
    /// KeePass CSV
    KeePassCsv,
    /// Generic CSV
    GenericCsv,
    /// Plain CSV
    Csv,
    /// JSON (entries only)
    Json,
    /// HTML report (read-only)
    Html,
    /// Plain text
    PlainText,
}

/// Import configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImportConfig {
    /// Source format
    pub format: ImportFormat,
    /// File path to import from
    pub file_path: String,
    /// Target group UUID (None = root)
    pub target_group_uuid: Option<String>,
    /// How to handle duplicate entries
    pub duplicate_handling: DuplicateHandling,
    /// Field mapping for generic CSV (csv_header_name → target_field)
    pub field_mapping: Option<Vec<FieldMapping>>,
    /// CSV delimiter
    pub csv_delimiter: Option<char>,
    /// CSV has header row
    pub csv_has_header: Option<bool>,
    /// Password for source KDBX (if importing another database)
    pub source_password: Option<String>,
    /// Key file for source KDBX
    pub source_key_file: Option<String>,
}

/// Field mapping entry for CSV imports.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FieldMapping {
    pub key: String,
    pub value: String,
}

/// How to handle duplicate entries during import.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum DuplicateHandling {
    /// Import all entries regardless of duplicates
    ImportAll,
    /// Skip duplicates, keep existing
    Skip,
    /// Replace existing with imported
    Replace,
    /// Keep both (create new UUIDs for imported)
    KeepBoth,
    /// Merge fields (prefer newer)
    Merge,
}

/// Export configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExportConfig {
    /// Target format
    pub format: ExportFormat,
    /// Output file path
    pub file_path: String,
    /// Group UUID to export (None = all)
    pub group_uuid: Option<String>,
    /// Include entries in recycle bin
    pub include_recycled: bool,
    /// Include attachment data
    pub include_attachments: bool,
    /// Include entry history
    pub include_history: bool,
    /// Redact passwords in export
    pub redact_passwords: bool,
}

/// Import result summary.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImportResult {
    pub entries_imported: usize,
    pub entries_skipped: usize,
    pub entries_merged: usize,
    pub groups_created: usize,
    pub errors: Vec<ImportError>,
    pub warnings: Vec<String>,
}

/// Individual import error.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImportError {
    pub line_or_index: usize,
    pub field: Option<String>,
    pub message: String,
}

/// Export result.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExportResult {
    pub entries_exported: usize,
    pub file_path: String,
    pub file_size: u64,
    pub format: ExportFormat,
}

// ─── Merge Types ──────────────────────────────────────────────────────────────

/// Database merge/sync configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MergeConfig {
    /// Path to the remote database to merge
    pub remote_path: String,
    /// Password for the remote database
    pub remote_password: Option<String>,
    /// Key file for the remote database
    pub remote_key_file: Option<String>,
    /// Conflict resolution strategy
    pub conflict_resolution: ConflictResolution,
    /// Whether to sync deletions
    pub sync_deletions: bool,
    /// Whether to merge custom icons
    pub merge_custom_icons: bool,
}

/// How to resolve conflicts during merge.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum ConflictResolution {
    /// Keep local version for conflicts
    KeepLocal,
    /// Keep remote version for conflicts
    KeepRemote,
    /// Keep whichever is newer
    PreferNewer,
    /// Create duplicate entries for conflicts
    KeepBoth,
    /// Ask for each conflict (returns conflicts in result)
    Manual,
}

/// Merge result summary.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MergeResult {
    pub entries_added: usize,
    pub entries_updated: usize,
    pub entries_deleted: usize,
    pub groups_added: usize,
    pub groups_updated: usize,
    pub groups_deleted: usize,
    pub conflicts: Vec<MergeConflict>,
    pub duration_ms: u64,
}

/// A merge conflict requiring resolution.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MergeConflict {
    pub entry_uuid: String,
    pub entry_title: String,
    pub local_modified: String,
    pub remote_modified: String,
    pub changed_fields: Vec<String>,
}

// ─── Statistics / Diagnostics ─────────────────────────────────────────────────

/// Database statistics.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DatabaseStatistics {
    pub total_entries: usize,
    pub total_groups: usize,
    pub total_attachments: usize,
    pub total_attachment_size: u64,
    pub total_custom_icons: usize,
    pub total_history_items: usize,
    pub expired_entries: usize,
    pub entries_expiring_soon: usize,
    pub entries_without_password: usize,
    pub entries_with_weak_password: usize,
    pub entries_with_duplicate_password: usize,
    pub entries_with_otp: usize,
    pub entries_with_attachments: usize,
    pub most_used_tags: Vec<TagCount>,
    pub group_distribution: Vec<GroupEntryCount>,
    pub oldest_password: Option<OldPasswordInfo>,
    pub database_size_bytes: u64,
    pub format_version: String,
    pub cipher: KeePassCipher,
    pub kdf_algorithm: KdfAlgorithm,
}

/// Tag usage count.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TagCount {
    pub tag: String,
    pub count: usize,
}

/// Group entry count for distribution chart.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GroupEntryCount {
    pub group_uuid: String,
    pub group_name: String,
    pub count: usize,
}

/// Info about the oldest password.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OldPasswordInfo {
    pub entry_uuid: String,
    pub entry_title: String,
    pub last_changed: String,
    pub age_days: u64,
}

/// Password health report.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PasswordHealthReport {
    pub total_entries: usize,
    pub analyzed: usize,
    pub strong: usize,
    pub fair: usize,
    pub weak: usize,
    pub very_weak: usize,
    pub empty: usize,
    pub reused_passwords: Vec<ReusedPassword>,
    pub expired_entries: Vec<EntrySummary>,
    pub old_passwords: Vec<OldPasswordInfo>,
    pub weak_entries: Vec<WeakPasswordEntry>,
    pub average_entropy: f64,
    pub average_length: f64,
}

/// A password reused across entries.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReusedPassword {
    /// Hash of the password (for comparison, not the actual password)
    pub password_hash: String,
    /// Entry UUIDs sharing this password
    pub entry_uuids: Vec<String>,
    /// Entry titles for display
    pub entry_titles: Vec<String>,
    pub count: usize,
}

/// Entry with weak password info.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WeakPasswordEntry {
    pub entry_uuid: String,
    pub entry_title: String,
    pub strength: PasswordStrength,
    pub entropy_bits: f64,
    pub issues: Vec<String>,
}

// ─── Recent Database / History Types ──────────────────────────────────────────

/// Recently opened database entry.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecentDatabase {
    pub file_path: String,
    pub name: String,
    pub last_opened: String,
    pub file_exists: bool,
    pub file_size: Option<u64>,
    pub is_favorite: bool,
}

/// Database change log entry (for undo/redo).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChangeLogEntry {
    pub id: String,
    pub timestamp: String,
    pub action: ChangeAction,
    pub target_type: ChangeTargetType,
    pub target_uuid: String,
    pub target_name: String,
    pub description: String,
    pub reversible: bool,
}

/// The type of change.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum ChangeAction {
    Create,
    Update,
    Delete,
    Move,
    Restore,
    Import,
    Merge,
}

/// What was changed.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum ChangeTargetType {
    Entry,
    Group,
    Attachment,
    Database,
}
