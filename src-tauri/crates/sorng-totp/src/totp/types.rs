//! Core types for the TOTP/HOTP authenticator.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::fmt;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Algorithm
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Hash algorithm used for HMAC-based OTP.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum Algorithm {
    Sha1,
    Sha256,
    Sha512,
}

impl Default for Algorithm {
    fn default() -> Self {
        Self::Sha1
    }
}

impl fmt::Display for Algorithm {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Sha1 => write!(f, "SHA1"),
            Self::Sha256 => write!(f, "SHA256"),
            Self::Sha512 => write!(f, "SHA512"),
        }
    }
}

impl Algorithm {
    /// Parse from a case-insensitive string.
    pub fn from_str_loose(s: &str) -> Option<Self> {
        match s.to_uppercase().as_str() {
            "SHA1" | "SHA-1" | "HMACSHA1" | "HMAC-SHA1" => Some(Self::Sha1),
            "SHA256" | "SHA-256" | "HMACSHA256" | "HMAC-SHA256" => Some(Self::Sha256),
            "SHA512" | "SHA-512" | "HMACSHA512" | "HMAC-SHA512" => Some(Self::Sha512),
            _ => None,
        }
    }

    /// URI-safe name for `otpauth://` parameters.
    pub fn uri_name(&self) -> &'static str {
        match self {
            Self::Sha1 => "SHA1",
            Self::Sha256 => "SHA256",
            Self::Sha512 => "SHA512",
        }
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  OTP type
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Whether this entry uses time-based or counter-based OTP.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OtpType {
    Totp,
    Hotp,
}

impl Default for OtpType {
    fn default() -> Self {
        Self::Totp
    }
}

impl fmt::Display for OtpType {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Totp => write!(f, "totp"),
            Self::Hotp => write!(f, "hotp"),
        }
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  TOTP entry
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// A single TOTP/HOTP entry stored in the vault.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TotpEntry {
    /// Unique identifier.
    pub id: String,
    /// Issuer (e.g. "GitHub", "Google").
    pub issuer: Option<String>,
    /// Account label (e.g. "user@example.com").
    pub label: String,
    /// Base-32 encoded secret key.
    pub secret: String,
    /// Hash algorithm.
    pub algorithm: Algorithm,
    /// Number of digits in the generated code (6 or 8).
    pub digits: u8,
    /// TOTP or HOTP.
    pub otp_type: OtpType,
    /// Time period in seconds (TOTP only, typically 30).
    pub period: u32,
    /// Counter value (HOTP only).
    pub counter: u64,
    /// Group this entry belongs to.
    pub group_id: Option<String>,
    /// User-assigned icon identifier or emoji.
    pub icon: Option<String>,
    /// Colour tag for visual grouping.
    pub color: Option<String>,
    /// Notes / description.
    pub notes: Option<String>,
    /// Whether this entry is marked as a favourite.
    pub favourite: bool,
    /// Sort-order index within its group.
    pub sort_order: i32,
    /// When the entry was created.
    pub created_at: DateTime<Utc>,
    /// When the entry was last modified.
    pub updated_at: DateTime<Utc>,
    /// When a code was last copied to clipboard.
    pub last_used_at: Option<DateTime<Utc>>,
    /// Number of times a code has been generated.
    pub use_count: u64,
    /// Custom tags for filtering.
    pub tags: Vec<String>,
}

impl TotpEntry {
    /// Create a minimal TOTP entry with defaults.
    pub fn new(label: impl Into<String>, secret: impl Into<String>) -> Self {
        let now = Utc::now();
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            issuer: None,
            label: label.into(),
            secret: secret.into(),
            algorithm: Algorithm::default(),
            digits: 6,
            otp_type: OtpType::Totp,
            period: 30,
            counter: 0,
            group_id: None,
            icon: None,
            color: None,
            notes: None,
            favourite: false,
            sort_order: 0,
            created_at: now,
            updated_at: now,
            last_used_at: None,
            use_count: 0,
            tags: Vec::new(),
        }
    }

    /// Builder: set issuer.
    pub fn with_issuer(mut self, issuer: impl Into<String>) -> Self {
        self.issuer = Some(issuer.into());
        self
    }

    /// Builder: set algorithm.
    pub fn with_algorithm(mut self, algo: Algorithm) -> Self {
        self.algorithm = algo;
        self
    }

    /// Builder: set digit count.
    pub fn with_digits(mut self, digits: u8) -> Self {
        self.digits = digits;
        self
    }

    /// Builder: set time period.
    pub fn with_period(mut self, period: u32) -> Self {
        self.period = period;
        self
    }

    /// Builder: mark as HOTP.
    pub fn as_hotp(mut self, counter: u64) -> Self {
        self.otp_type = OtpType::Hotp;
        self.counter = counter;
        self
    }

    /// Builder: set group.
    pub fn with_group(mut self, group_id: impl Into<String>) -> Self {
        self.group_id = Some(group_id.into());
        self
    }

    /// Builder: set icon.
    pub fn with_icon(mut self, icon: impl Into<String>) -> Self {
        self.icon = Some(icon.into());
        self
    }

    /// Builder: set notes.
    pub fn with_notes(mut self, notes: impl Into<String>) -> Self {
        self.notes = Some(notes.into());
        self
    }

    /// Builder: set tags.
    pub fn with_tags(mut self, tags: Vec<String>) -> Self {
        self.tags = tags;
        self
    }

    /// Display name: "Issuer (label)" or just "label".
    pub fn display_name(&self) -> String {
        match &self.issuer {
            Some(iss) if !iss.is_empty() => format!("{} ({})", iss, self.label),
            _ => self.label.clone(),
        }
    }

    /// Check if the secret is valid base-32.
    pub fn is_secret_valid(&self) -> bool {
        let cleaned = self.secret.replace(' ', "").replace('-', "");
        base32::decode(base32::Alphabet::Rfc4648 { padding: false }, &cleaned.to_uppercase())
            .is_some()
    }

    /// Normalise the secret (uppercase, no spaces/dashes).
    pub fn normalised_secret(&self) -> String {
        self.secret
            .replace(' ', "")
            .replace('-', "")
            .to_uppercase()
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Group
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// A folder / group for organising entries.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TotpGroup {
    pub id: String,
    pub name: String,
    pub icon: Option<String>,
    pub color: Option<String>,
    pub sort_order: i32,
    pub created_at: DateTime<Utc>,
}

impl TotpGroup {
    pub fn new(name: impl Into<String>) -> Self {
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            name: name.into(),
            icon: None,
            color: None,
            sort_order: 0,
            created_at: Utc::now(),
        }
    }

    pub fn with_icon(mut self, icon: impl Into<String>) -> Self {
        self.icon = Some(icon.into());
        self
    }

    pub fn with_color(mut self, color: impl Into<String>) -> Self {
        self.color = Some(color.into());
        self
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Generated code result
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// A generated OTP code with associated timing info.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GeneratedCode {
    /// The OTP code string (e.g. "123456").
    pub code: String,
    /// Seconds remaining until the code expires (TOTP only).
    pub remaining_seconds: u32,
    /// Total period in seconds.
    pub period: u32,
    /// Progress as fraction 0.0–1.0 (1.0 = expired).
    pub progress: f64,
    /// The time step (TOTP) or counter (HOTP) used.
    pub counter: u64,
    /// Entry ID this code was generated for.
    pub entry_id: String,
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Import / Export format identifiers
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Supported import source formats.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ImportFormat {
    /// `otpauth://` URI (single or one-per-line).
    OtpAuthUri,
    /// `otpauth-migration://` protobuf payload (Google Authenticator export).
    GoogleAuthMigration,
    /// Aegis Authenticator JSON (plain or encrypted).
    AegisJson,
    /// 2FAS Authenticator JSON backup.
    TwoFasJson,
    /// andOTP JSON or encrypted backup.
    AndOtpJson,
    /// FreeOTP+ JSON backup.
    FreeOtpPlusJson,
    /// Bitwarden Authenticator JSON export.
    BitwardenJson,
    /// RAIVO OTP JSON export.
    RaivoJson,
    /// Authy (decoded local DB).
    AuthyJson,
    /// Generic CSV (with columns: issuer, label/account, secret, algorithm, digits, period).
    GenericCsv,
}

/// Supported export formats.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ExportFormat {
    /// Plain JSON array of `TotpEntry`.
    Json,
    /// CSV with standard columns.
    Csv,
    /// One `otpauth://` URI per line.
    OtpAuthUris,
    /// AES-256-GCM encrypted JSON.
    EncryptedJson,
    /// HTML page with QR codes for each entry.
    HtmlQrCodes,
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Import result
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Summary of an import operation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImportResult {
    pub format: ImportFormat,
    pub total_found: usize,
    pub imported: usize,
    pub skipped_duplicate: usize,
    pub errors: Vec<String>,
    pub entries: Vec<TotpEntry>,
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Vault metadata
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Metadata about the encrypted vault.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VaultMeta {
    pub version: u32,
    pub entry_count: usize,
    pub group_count: usize,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub last_saved_at: DateTime<Utc>,
    pub encrypted: bool,
}

impl Default for VaultMeta {
    fn default() -> Self {
        let now = Utc::now();
        Self {
            version: 1,
            entry_count: 0,
            group_count: 0,
            created_at: now,
            updated_at: now,
            last_saved_at: now,
            encrypted: false,
        }
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Error type
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Error kind for this crate.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum TotpErrorKind {
    InvalidSecret,
    InvalidUri,
    InvalidAlgorithm,
    InvalidDigits,
    InvalidPeriod,
    ImportFailed,
    ExportFailed,
    EncryptionFailed,
    DecryptionFailed,
    KeyDerivationFailed,
    NotFound,
    DuplicateEntry,
    StorageError,
    QrEncodeFailed,
    QrDecodeFailed,
    ParseError,
    IoError,
    VaultLocked,
    InvalidInput,
    Internal,
}

/// Crate-level error.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TotpError {
    pub kind: TotpErrorKind,
    pub message: String,
    pub detail: Option<String>,
}

impl fmt::Display for TotpError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "[{:?}] {}", self.kind, self.message)?;
        if let Some(d) = &self.detail {
            write!(f, " ({})", d)?;
        }
        Ok(())
    }
}

impl TotpError {
    pub fn new(kind: TotpErrorKind, msg: impl Into<String>) -> Self {
        Self {
            kind,
            message: msg.into(),
            detail: None,
        }
    }

    pub fn with_detail(mut self, detail: impl Into<String>) -> Self {
        self.detail = Some(detail.into());
        self
    }
}

impl From<TotpError> for String {
    fn from(e: TotpError) -> String {
        e.to_string()
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Verification result
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Result of verifying an OTP code against an entry.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VerifyResult {
    pub valid: bool,
    /// How many time-steps or counters off the match was (0 = exact).
    pub drift: i64,
    /// The counter value that matched (if any).
    pub matched_counter: Option<u64>,
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Search / filter helpers
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Filter options for listing entries.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct EntryFilter {
    pub search: Option<String>,
    pub group_id: Option<String>,
    pub tag: Option<String>,
    pub favourites_only: bool,
    pub otp_type: Option<OtpType>,
}

impl EntryFilter {
    /// Returns `true` if the entry matches all active filter criteria.
    pub fn matches(&self, entry: &TotpEntry) -> bool {
        if let Some(ref q) = self.search {
            let lower = q.to_lowercase();
            let name_match = entry.label.to_lowercase().contains(&lower)
                || entry
                    .issuer
                    .as_ref()
                    .map(|i| i.to_lowercase().contains(&lower))
                    .unwrap_or(false)
                || entry.tags.iter().any(|t| t.to_lowercase().contains(&lower));
            if !name_match {
                return false;
            }
        }
        if let Some(ref gid) = self.group_id {
            if entry.group_id.as_ref() != Some(gid) {
                return false;
            }
        }
        if let Some(ref tag) = self.tag {
            if !entry.tags.iter().any(|t| t == tag) {
                return false;
            }
        }
        if self.favourites_only && !entry.favourite {
            return false;
        }
        if let Some(otp) = self.otp_type {
            if entry.otp_type != otp {
                return false;
            }
        }
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── Algorithm ────────────────────────────────────────────────

    #[test]
    fn algorithm_default_is_sha1() {
        assert_eq!(Algorithm::default(), Algorithm::Sha1);
    }

    #[test]
    fn algorithm_display() {
        assert_eq!(Algorithm::Sha1.to_string(), "SHA1");
        assert_eq!(Algorithm::Sha256.to_string(), "SHA256");
        assert_eq!(Algorithm::Sha512.to_string(), "SHA512");
    }

    #[test]
    fn algorithm_from_str_loose() {
        assert_eq!(Algorithm::from_str_loose("sha1"), Some(Algorithm::Sha1));
        assert_eq!(Algorithm::from_str_loose("SHA-256"), Some(Algorithm::Sha256));
        assert_eq!(Algorithm::from_str_loose("HMAC-SHA512"), Some(Algorithm::Sha512));
        assert_eq!(Algorithm::from_str_loose("MD5"), None);
    }

    #[test]
    fn algorithm_uri_name() {
        assert_eq!(Algorithm::Sha1.uri_name(), "SHA1");
        assert_eq!(Algorithm::Sha256.uri_name(), "SHA256");
    }

    #[test]
    fn algorithm_serde_roundtrip() {
        let algo = Algorithm::Sha256;
        let json = serde_json::to_string(&algo).unwrap();
        assert_eq!(json, "\"SHA256\"");
        let back: Algorithm = serde_json::from_str(&json).unwrap();
        assert_eq!(back, algo);
    }

    // ── OtpType ──────────────────────────────────────────────────

    #[test]
    fn otp_type_default() {
        assert_eq!(OtpType::default(), OtpType::Totp);
    }

    #[test]
    fn otp_type_display() {
        assert_eq!(OtpType::Totp.to_string(), "totp");
        assert_eq!(OtpType::Hotp.to_string(), "hotp");
    }

    // ── TotpEntry ────────────────────────────────────────────────

    #[test]
    fn entry_new_defaults() {
        let entry = TotpEntry::new("alice@example.com", "JBSWY3DPEHPK3PXP");
        assert_eq!(entry.label, "alice@example.com");
        assert_eq!(entry.algorithm, Algorithm::Sha1);
        assert_eq!(entry.digits, 6);
        assert_eq!(entry.period, 30);
        assert_eq!(entry.otp_type, OtpType::Totp);
        assert!(!entry.favourite);
        assert!(entry.tags.is_empty());
    }

    #[test]
    fn entry_builder() {
        let entry = TotpEntry::new("user", "SECRET")
            .with_issuer("GitHub")
            .with_algorithm(Algorithm::Sha256)
            .with_digits(8)
            .with_period(60)
            .with_notes("my notes")
            .with_tags(vec!["work".into()]);
        assert_eq!(entry.issuer.as_deref(), Some("GitHub"));
        assert_eq!(entry.algorithm, Algorithm::Sha256);
        assert_eq!(entry.digits, 8);
        assert_eq!(entry.period, 60);
        assert_eq!(entry.notes.as_deref(), Some("my notes"));
        assert_eq!(entry.tags, vec!["work"]);
    }

    #[test]
    fn entry_as_hotp() {
        let entry = TotpEntry::new("user", "SECRET").as_hotp(42);
        assert_eq!(entry.otp_type, OtpType::Hotp);
        assert_eq!(entry.counter, 42);
    }

    #[test]
    fn entry_display_name() {
        let e1 = TotpEntry::new("user@ex.com", "S").with_issuer("GitHub");
        assert_eq!(e1.display_name(), "GitHub (user@ex.com)");
        let e2 = TotpEntry::new("user@ex.com", "S");
        assert_eq!(e2.display_name(), "user@ex.com");
    }

    #[test]
    fn entry_secret_validation() {
        let ok = TotpEntry::new("u", "JBSWY3DPEHPK3PXP");
        assert!(ok.is_secret_valid());
        let bad = TotpEntry::new("u", "!!!not-base32!!!");
        assert!(!bad.is_secret_valid());
    }

    #[test]
    fn entry_normalise_secret() {
        let entry = TotpEntry::new("u", "jbsw y3dp-ehpk 3pxp");
        assert_eq!(entry.normalised_secret(), "JBSWY3DPEHPK3PXP");
    }

    #[test]
    fn entry_serde_roundtrip() {
        let entry = TotpEntry::new("u", "JBSWY3DPEHPK3PXP").with_issuer("Test");
        let json = serde_json::to_string(&entry).unwrap();
        let back: TotpEntry = serde_json::from_str(&json).unwrap();
        assert_eq!(back.label, "u");
        assert_eq!(back.issuer.as_deref(), Some("Test"));
    }

    // ── TotpGroup ────────────────────────────────────────────────

    #[test]
    fn group_new() {
        let g = TotpGroup::new("Work").with_icon("🏢").with_color("#ff0000");
        assert_eq!(g.name, "Work");
        assert_eq!(g.icon.as_deref(), Some("🏢"));
        assert_eq!(g.color.as_deref(), Some("#ff0000"));
    }

    // ── GeneratedCode ────────────────────────────────────────────

    #[test]
    fn generated_code_serde() {
        let code = GeneratedCode {
            code: "123456".into(),
            remaining_seconds: 15,
            period: 30,
            progress: 0.5,
            counter: 55755375,
            entry_id: "id1".into(),
        };
        let json = serde_json::to_string(&code).unwrap();
        let back: GeneratedCode = serde_json::from_str(&json).unwrap();
        assert_eq!(back.code, "123456");
        assert_eq!(back.remaining_seconds, 15);
    }

    // ── EntryFilter ──────────────────────────────────────────────

    #[test]
    fn filter_empty_matches_all() {
        let f = EntryFilter::default();
        let e = TotpEntry::new("user", "SECRET");
        assert!(f.matches(&e));
    }

    #[test]
    fn filter_by_search() {
        let f = EntryFilter {
            search: Some("git".into()),
            ..Default::default()
        };
        let e1 = TotpEntry::new("user", "S").with_issuer("GitHub");
        let e2 = TotpEntry::new("user", "S").with_issuer("Google");
        assert!(f.matches(&e1));
        assert!(!f.matches(&e2));
    }

    #[test]
    fn filter_by_group() {
        let f = EntryFilter {
            group_id: Some("g1".into()),
            ..Default::default()
        };
        let e1 = TotpEntry::new("u", "S").with_group("g1");
        let e2 = TotpEntry::new("u", "S");
        assert!(f.matches(&e1));
        assert!(!f.matches(&e2));
    }

    #[test]
    fn filter_by_tag() {
        let f = EntryFilter {
            tag: Some("work".into()),
            ..Default::default()
        };
        let e1 = TotpEntry::new("u", "S").with_tags(vec!["work".into()]);
        let e2 = TotpEntry::new("u", "S");
        assert!(f.matches(&e1));
        assert!(!f.matches(&e2));
    }

    #[test]
    fn filter_favourites_only() {
        let f = EntryFilter {
            favourites_only: true,
            ..Default::default()
        };
        let mut e = TotpEntry::new("u", "S");
        assert!(!f.matches(&e));
        e.favourite = true;
        assert!(f.matches(&e));
    }

    #[test]
    fn filter_by_otp_type() {
        let f = EntryFilter {
            otp_type: Some(OtpType::Hotp),
            ..Default::default()
        };
        let e1 = TotpEntry::new("u", "S").as_hotp(0);
        let e2 = TotpEntry::new("u", "S");
        assert!(f.matches(&e1));
        assert!(!f.matches(&e2));
    }

    // ── Error ────────────────────────────────────────────────────

    #[test]
    fn error_display() {
        let err = TotpError::new(TotpErrorKind::InvalidSecret, "bad base32")
            .with_detail("extra info");
        let s = err.to_string();
        assert!(s.contains("InvalidSecret"));
        assert!(s.contains("bad base32"));
        assert!(s.contains("extra info"));
    }

    #[test]
    fn error_into_string() {
        let err = TotpError::new(TotpErrorKind::NotFound, "missing");
        let s: String = err.into();
        assert!(s.contains("NotFound"));
    }

    // ── VaultMeta ────────────────────────────────────────────────

    #[test]
    fn vault_meta_serde() {
        let meta = VaultMeta {
            version: 1,
            entry_count: 3,
            group_count: 1,
            created_at: Utc::now(),
            updated_at: Utc::now(),
            last_saved_at: Utc::now(),
            encrypted: true,
        };
        let json = serde_json::to_string(&meta).unwrap();
        let back: VaultMeta = serde_json::from_str(&json).unwrap();
        assert_eq!(back.version, 1);
        assert!(back.encrypted);
    }

    // ── VerifyResult ─────────────────────────────────────────────

    #[test]
    fn verify_result_serde() {
        let vr = VerifyResult {
            valid: true,
            drift: -1,
            matched_counter: Some(100),
        };
        let json = serde_json::to_string(&vr).unwrap();
        let back: VerifyResult = serde_json::from_str(&json).unwrap();
        assert!(back.valid);
        assert_eq!(back.drift, -1);
    }
}
