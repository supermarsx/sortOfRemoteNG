//! All data types, error handling and configuration for the SMTP crate.

use std::collections::HashMap;
use std::fmt;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

// ─── Error ──────────────────────────────────────────────────────────

/// Kinds of SMTP errors.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum SmtpErrorKind {
    /// Server returned an error reply (4xx / 5xx).
    ServerReply,
    /// Authentication failed.
    AuthFailure,
    /// TLS negotiation failed.
    TlsError,
    /// DNS / MX resolution failed.
    DnsError,
    /// Connection refused or timed out.
    ConnectionError,
    /// I/O error during socket read/write.
    IoError,
    /// The message itself is malformed.
    MessageError,
    /// DKIM signing error.
    DkimError,
    /// Template rendering error.
    TemplateError,
    /// Queue error (capacity, persistence).
    QueueError,
    /// Address-book / contact error.
    ContactError,
    /// Configuration / credential error.
    ConfigError,
    /// Rate-limit / throttle exceeded.
    RateLimitError,
    /// Catch-all.
    Unknown,
}

impl fmt::Display for SmtpErrorKind {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{:?}", self)
    }
}

/// Top-level error type for the SMTP crate.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SmtpError {
    pub kind: SmtpErrorKind,
    pub message: String,
    /// The SMTP reply code (e.g. 550) if available.
    pub code: Option<u16>,
    /// The enhanced status code (e.g. "5.1.1") if available.
    pub enhanced_code: Option<String>,
}

impl SmtpError {
    pub fn new(kind: SmtpErrorKind, msg: impl Into<String>) -> Self {
        Self {
            kind,
            message: msg.into(),
            code: None,
            enhanced_code: None,
        }
    }

    pub fn with_code(mut self, code: u16) -> Self {
        self.code = Some(code);
        self
    }

    pub fn with_enhanced(mut self, ec: impl Into<String>) -> Self {
        self.enhanced_code = Some(ec.into());
        self
    }

    pub fn connection(msg: impl Into<String>) -> Self {
        Self::new(SmtpErrorKind::ConnectionError, msg)
    }

    pub fn auth(msg: impl Into<String>) -> Self {
        Self::new(SmtpErrorKind::AuthFailure, msg)
    }

    pub fn tls(msg: impl Into<String>) -> Self {
        Self::new(SmtpErrorKind::TlsError, msg)
    }

    pub fn io(msg: impl Into<String>) -> Self {
        Self::new(SmtpErrorKind::IoError, msg)
    }

    pub fn server(code: u16, msg: impl Into<String>) -> Self {
        Self::new(SmtpErrorKind::ServerReply, msg).with_code(code)
    }

    pub fn message(msg: impl Into<String>) -> Self {
        Self::new(SmtpErrorKind::MessageError, msg)
    }

    pub fn config(msg: impl Into<String>) -> Self {
        Self::new(SmtpErrorKind::ConfigError, msg)
    }

    pub fn template(msg: impl Into<String>) -> Self {
        Self::new(SmtpErrorKind::TemplateError, msg)
    }

    pub fn queue(msg: impl Into<String>) -> Self {
        Self::new(SmtpErrorKind::QueueError, msg)
    }

    pub fn contact(msg: impl Into<String>) -> Self {
        Self::new(SmtpErrorKind::ContactError, msg)
    }
}

impl fmt::Display for SmtpError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        if let Some(code) = self.code {
            write!(f, "[SMTP {}] {}: {}", code, self.kind, self.message)
        } else {
            write!(f, "[SMTP] {}: {}", self.kind, self.message)
        }
    }
}

impl std::error::Error for SmtpError {}

pub type SmtpResult<T> = Result<T, SmtpError>;

// ─── Enums ──────────────────────────────────────────────────────────

/// SMTP security mode.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum SmtpSecurity {
    /// Unencrypted (port 25 / 587 without STARTTLS).
    None,
    /// STARTTLS upgrade on port 587.
    StartTls,
    /// Implicit TLS (SMTPS) on port 465.
    ImplicitTls,
}

impl Default for SmtpSecurity {
    fn default() -> Self {
        Self::StartTls
    }
}

/// Supported authentication mechanisms.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum SmtpAuthMethod {
    Plain,
    Login,
    CramMd5,
    XOAuth2,
}

impl fmt::Display for SmtpAuthMethod {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Plain => write!(f, "PLAIN"),
            Self::Login => write!(f, "LOGIN"),
            Self::CramMd5 => write!(f, "CRAM-MD5"),
            Self::XOAuth2 => write!(f, "XOAUTH2"),
        }
    }
}

/// Priority / importance header value.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum MessagePriority {
    High,
    Normal,
    Low,
}

impl Default for MessagePriority {
    fn default() -> Self {
        Self::Normal
    }
}

impl fmt::Display for MessagePriority {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::High => write!(f, "1 (Highest)"),
            Self::Normal => write!(f, "3 (Normal)"),
            Self::Low => write!(f, "5 (Lowest)"),
        }
    }
}

/// Content-Transfer-Encoding.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum TransferEncoding {
    SevenBit,
    QuotedPrintable,
    Base64,
}

impl Default for TransferEncoding {
    fn default() -> Self {
        Self::QuotedPrintable
    }
}

impl fmt::Display for TransferEncoding {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::SevenBit => write!(f, "7bit"),
            Self::QuotedPrintable => write!(f, "quoted-printable"),
            Self::Base64 => write!(f, "base64"),
        }
    }
}

/// Queue item status.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum QueueItemStatus {
    Pending,
    Sending,
    Sent,
    Failed,
    ScheduledRetry,
    Cancelled,
}

impl Default for QueueItemStatus {
    fn default() -> Self {
        Self::Pending
    }
}

/// Send schedule mode.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum SendSchedule {
    Immediate,
    At(DateTime<Utc>),
    AfterSeconds(u64),
}

impl Default for SendSchedule {
    fn default() -> Self {
        Self::Immediate
    }
}

/// DKIM canonicalization algorithm.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum DkimCanonicalization {
    Simple,
    Relaxed,
}

impl Default for DkimCanonicalization {
    fn default() -> Self {
        Self::Relaxed
    }
}

impl fmt::Display for DkimCanonicalization {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Simple => write!(f, "simple"),
            Self::Relaxed => write!(f, "relaxed"),
        }
    }
}

/// Result of an MX lookup.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MxRecord {
    pub priority: u16,
    pub exchange: String,
}

/// Result of a diagnostic probe.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum DiagnosticCheck {
    Pass(String),
    Warn(String),
    Fail(String),
}

// ─── Configuration ──────────────────────────────────────────────────

/// SMTP server configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SmtpConfig {
    /// Hostname or IP of the SMTP server.
    pub host: String,
    /// Port (25 / 465 / 587 / 2525).
    pub port: u16,
    /// Security mode.
    pub security: SmtpSecurity,
    /// Connection timeout in seconds.
    pub connect_timeout_secs: u64,
    /// Read/write timeout in seconds.
    pub io_timeout_secs: u64,
    /// Domain to use in EHLO/HELO command.
    pub ehlo_domain: String,
    /// Maximum message size in bytes (0 = unlimited).
    pub max_message_size: u64,
    /// Whether to verify the server's TLS certificate.
    pub verify_certificates: bool,
    /// Optional path to a custom CA certificate PEM file.
    pub ca_cert_path: Option<String>,
    /// Optional path to a client certificate PEM file (for mutual TLS).
    pub client_cert_path: Option<String>,
    /// Optional path to a client key PEM file.
    pub client_key_path: Option<String>,
}

impl Default for SmtpConfig {
    fn default() -> Self {
        Self {
            host: String::new(),
            port: 587,
            security: SmtpSecurity::StartTls,
            connect_timeout_secs: 30,
            io_timeout_secs: 60,
            ehlo_domain: "localhost".into(),
            max_message_size: 0,
            verify_certificates: true,
            ca_cert_path: None,
            client_cert_path: None,
            client_key_path: None,
        }
    }
}

/// Credentials for SMTP authentication.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SmtpCredentials {
    pub username: String,
    pub password: String,
    /// The auth mechanism to use.
    pub method: Option<SmtpAuthMethod>,
    /// For XOAUTH2: the access token.
    pub oauth2_token: Option<String>,
}

/// DKIM configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DkimConfig {
    /// DKIM selector (e.g. "default", "s1").
    pub selector: String,
    /// Signing domain (e.g. "example.com").
    pub domain: String,
    /// RSA private key in PEM format.
    pub private_key_pem: String,
    /// Header canonicalization.
    pub header_canon: DkimCanonicalization,
    /// Body canonicalization.
    pub body_canon: DkimCanonicalization,
    /// Headers to sign.
    pub signed_headers: Vec<String>,
    /// Signature expiration in seconds (0 = no expiry).
    pub expire_secs: u64,
}

impl Default for DkimConfig {
    fn default() -> Self {
        Self {
            selector: "default".into(),
            domain: String::new(),
            private_key_pem: String::new(),
            header_canon: DkimCanonicalization::Relaxed,
            body_canon: DkimCanonicalization::Relaxed,
            signed_headers: vec![
                "from".into(),
                "to".into(),
                "subject".into(),
                "date".into(),
                "message-id".into(),
                "mime-version".into(),
                "content-type".into(),
            ],
            expire_secs: 0,
        }
    }
}

/// Queue configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueueConfig {
    /// Maximum number of items in the queue.
    pub max_size: usize,
    /// Maximum retries before marking as permanently failed.
    pub max_retries: u32,
    /// Base delay in seconds for exponential backoff.
    pub retry_base_delay_secs: u64,
    /// Maximum retry delay in seconds.
    pub retry_max_delay_secs: u64,
    /// How many messages to send concurrently.
    pub concurrency: usize,
    /// Minimum delay between sends to the same server (rate limiting), in ms.
    pub throttle_ms: u64,
}

impl Default for QueueConfig {
    fn default() -> Self {
        Self {
            max_size: 1000,
            max_retries: 3,
            retry_base_delay_secs: 60,
            retry_max_delay_secs: 3600,
            concurrency: 4,
            throttle_ms: 100,
        }
    }
}

// ─── Email Address ──────────────────────────────────────────────────

/// An email address with an optional display name.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct EmailAddress {
    /// Display name (e.g. "John Doe").
    pub name: Option<String>,
    /// The email address (e.g. "john@example.com").
    pub address: String,
}

impl EmailAddress {
    pub fn new(address: impl Into<String>) -> Self {
        Self {
            name: None,
            address: address.into(),
        }
    }

    pub fn with_name(address: impl Into<String>, name: impl Into<String>) -> Self {
        Self {
            name: Some(name.into()),
            address: address.into(),
        }
    }

    /// Format as RFC 5322 mailbox (e.g. `"John Doe" <john@example.com>`).
    pub fn to_mailbox(&self) -> String {
        match &self.name {
            Some(n) => format!("\"{}\" <{}>", n.replace('"', "\\\""), self.address),
            None => self.address.clone(),
        }
    }

    /// Extract just `<address>` for SMTP envelope.
    pub fn to_angle_addr(&self) -> String {
        format!("<{}>", self.address)
    }

    /// Parse a mailbox string like `"Name" <addr>` or `addr`.
    pub fn parse(input: &str) -> SmtpResult<Self> {
        let input = input.trim();
        // Pattern: "Name" <address>  or  Name <address>
        if let Some(lt) = input.find('<') {
            if let Some(gt) = input.find('>') {
                let addr = input[lt + 1..gt].trim().to_string();
                let name_part = input[..lt].trim();
                let name = if name_part.is_empty() {
                    None
                } else {
                    // Strip surrounding quotes if present
                    let n = name_part.trim_matches('"').trim().to_string();
                    if n.is_empty() { None } else { Some(n) }
                };
                if addr.contains('@') {
                    return Ok(Self { name, address: addr });
                }
            }
        }
        // Bare address
        if input.contains('@') && !input.contains(' ') {
            return Ok(Self {
                name: None,
                address: input.to_string(),
            });
        }
        Err(SmtpError::message(format!("Invalid email address: {}", input)))
    }

    /// Validate the address format (basic check).
    pub fn is_valid(&self) -> bool {
        let a = &self.address;
        if let Some(at) = a.find('@') {
            let local = &a[..at];
            let domain = &a[at + 1..];
            !local.is_empty() && !domain.is_empty() && domain.contains('.')
        } else {
            false
        }
    }

    /// Extract the domain part.
    pub fn domain(&self) -> Option<&str> {
        self.address.find('@').map(|at| &self.address[at + 1..])
    }
}

impl fmt::Display for EmailAddress {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.to_mailbox())
    }
}

// ─── Attachment ─────────────────────────────────────────────────────

/// An email attachment.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Attachment {
    /// File name (e.g. "report.pdf").
    pub filename: String,
    /// MIME type (e.g. "application/pdf").
    pub content_type: String,
    /// Base64-encoded content.
    pub data_base64: String,
    /// Content-ID for inline images (e.g. "logo123").
    pub content_id: Option<String>,
    /// Whether this is an inline attachment.
    pub inline: bool,
}

impl Attachment {
    pub fn new(filename: impl Into<String>, content_type: impl Into<String>, data: &[u8]) -> Self {
        use base64::Engine;
        Self {
            filename: filename.into(),
            content_type: content_type.into(),
            data_base64: base64::engine::general_purpose::STANDARD.encode(data),
            content_id: None,
            inline: false,
        }
    }

    pub fn inline_image(
        filename: impl Into<String>,
        content_type: impl Into<String>,
        data: &[u8],
        cid: impl Into<String>,
    ) -> Self {
        use base64::Engine;
        Self {
            filename: filename.into(),
            content_type: content_type.into(),
            data_base64: base64::engine::general_purpose::STANDARD.encode(data),
            content_id: Some(cid.into()),
            inline: true,
        }
    }

    /// Decode the attachment data from base64.
    pub fn decode_data(&self) -> SmtpResult<Vec<u8>> {
        use base64::Engine;
        base64::engine::general_purpose::STANDARD
            .decode(&self.data_base64)
            .map_err(|e| SmtpError::message(format!("Base64 decode error: {}", e)))
    }

    /// Estimated size in bytes.
    pub fn estimated_size(&self) -> usize {
        // base64 is ~4/3 of raw size
        self.data_base64.len() * 3 / 4
    }
}

// ─── Email Message ──────────────────────────────────────────────────

/// A complete email message ready to be sent.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EmailMessage {
    /// Unique message identifier.
    pub id: String,
    /// From address.
    pub from: EmailAddress,
    /// Reply-To address.
    pub reply_to: Option<EmailAddress>,
    /// To recipients.
    pub to: Vec<EmailAddress>,
    /// CC recipients.
    pub cc: Vec<EmailAddress>,
    /// BCC recipients.
    pub bcc: Vec<EmailAddress>,
    /// Subject line.
    pub subject: String,
    /// Plain-text body.
    pub text_body: Option<String>,
    /// HTML body.
    pub html_body: Option<String>,
    /// Attachments.
    pub attachments: Vec<Attachment>,
    /// Additional custom headers.
    pub custom_headers: HashMap<String, String>,
    /// Message priority.
    pub priority: MessagePriority,
    /// Date header override (defaults to send time).
    pub date: Option<DateTime<Utc>>,
    /// In-Reply-To message-id (for threading).
    pub in_reply_to: Option<String>,
    /// References message-ids (for threading).
    pub references: Vec<String>,
    /// Read-receipt request address.
    pub read_receipt_to: Option<EmailAddress>,
    /// Character set (defaults to UTF-8).
    pub charset: String,
    /// Transfer encoding for text parts.
    pub transfer_encoding: TransferEncoding,
}

impl Default for EmailMessage {
    fn default() -> Self {
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            from: EmailAddress::new(""),
            reply_to: None,
            to: Vec::new(),
            cc: Vec::new(),
            bcc: Vec::new(),
            subject: String::new(),
            text_body: None,
            html_body: None,
            attachments: Vec::new(),
            custom_headers: HashMap::new(),
            priority: MessagePriority::Normal,
            date: None,
            in_reply_to: None,
            references: Vec::new(),
            read_receipt_to: None,
            charset: "UTF-8".into(),
            transfer_encoding: TransferEncoding::QuotedPrintable,
        }
    }
}

impl EmailMessage {
    /// All envelope recipients (to + cc + bcc).
    pub fn all_recipients(&self) -> Vec<&EmailAddress> {
        self.to
            .iter()
            .chain(self.cc.iter())
            .chain(self.bcc.iter())
            .collect()
    }

    /// Total estimated size in bytes.
    pub fn estimated_size(&self) -> usize {
        let mut size = 0usize;
        size += self.subject.len();
        if let Some(ref t) = self.text_body {
            size += t.len();
        }
        if let Some(ref h) = self.html_body {
            size += h.len();
        }
        for a in &self.attachments {
            size += a.estimated_size();
        }
        // Headers overhead
        size += 512;
        size
    }

    /// Validate the message before sending.
    pub fn validate(&self) -> SmtpResult<()> {
        if self.from.address.is_empty() {
            return Err(SmtpError::message("From address is required"));
        }
        if !self.from.is_valid() {
            return Err(SmtpError::message(format!(
                "Invalid From address: {}",
                self.from.address
            )));
        }
        if self.to.is_empty() && self.cc.is_empty() && self.bcc.is_empty() {
            return Err(SmtpError::message("At least one recipient is required"));
        }
        for r in self.all_recipients() {
            if !r.is_valid() {
                return Err(SmtpError::message(format!(
                    "Invalid recipient address: {}",
                    r.address
                )));
            }
        }
        if self.text_body.is_none() && self.html_body.is_none() {
            return Err(SmtpError::message(
                "Message must have at least a text or HTML body",
            ));
        }
        Ok(())
    }
}

// ─── SMTP Reply ─────────────────────────────────────────────────────

/// A parsed SMTP reply line.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SmtpReply {
    /// The 3-digit reply code.
    pub code: u16,
    /// Enhanced status code (e.g. "2.1.0").
    pub enhanced_code: Option<String>,
    /// Reply text lines.
    pub lines: Vec<String>,
    /// Whether this is a multi-line reply.
    pub is_multiline: bool,
}

impl SmtpReply {
    /// Whether this is a positive completion (2xx).
    pub fn is_positive(&self) -> bool {
        (200..300).contains(&self.code)
    }

    /// Whether this is a positive intermediate (3xx).
    pub fn is_intermediate(&self) -> bool {
        (300..400).contains(&self.code)
    }

    /// Whether this is a transient negative (4xx).
    pub fn is_transient_negative(&self) -> bool {
        (400..500).contains(&self.code)
    }

    /// Whether this is a permanent negative (5xx).
    pub fn is_permanent_negative(&self) -> bool {
        (500..600).contains(&self.code)
    }

    /// Whether this reply indicates an error.
    pub fn is_error(&self) -> bool {
        self.code >= 400
    }

    /// The full reply text.
    pub fn text(&self) -> String {
        self.lines.join("\r\n")
    }

    /// Parse an SMTP reply from raw lines.
    pub fn parse(raw: &str) -> SmtpResult<Self> {
        let mut code: Option<u16> = None;
        let mut lines = Vec::new();
        let mut enhanced = None;
        let mut multiline = false;

        for line in raw.lines() {
            if line.len() < 3 {
                continue;
            }
            let c: u16 = line[..3]
                .parse()
                .map_err(|_| SmtpError::io(format!("Invalid reply code in: {}", line)))?;
            if code.is_none() {
                code = Some(c);
            }
            let separator = line.as_bytes().get(3).copied().unwrap_or(b' ');
            if separator == b'-' {
                multiline = true;
            }
            let text = if line.len() > 4 { &line[4..] } else { "" };
            // Try to extract enhanced code from first line text
            if enhanced.is_none() && !text.is_empty() {
                let parts: Vec<&str> = text.splitn(2, ' ').collect();
                if parts.len() >= 1 {
                    let ec = parts[0];
                    // Enhanced code pattern: d.d.d or d.d.dd
                    if ec.len() >= 5
                        && ec.chars().next().map(|c| c.is_ascii_digit()) == Some(true)
                        && ec.contains('.')
                    {
                        let segments: Vec<&str> = ec.split('.').collect();
                        if segments.len() == 3
                            && segments
                                .iter()
                                .all(|s| !s.is_empty() && s.chars().all(|ch| ch.is_ascii_digit()))
                        {
                            enhanced = Some(ec.to_string());
                        }
                    }
                }
            }
            lines.push(text.to_string());
        }

        match code {
            Some(c) => Ok(SmtpReply {
                code: c,
                enhanced_code: enhanced,
                lines,
                is_multiline: multiline,
            }),
            None => Err(SmtpError::io("Empty SMTP reply")),
        }
    }
}

impl fmt::Display for SmtpReply {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{} {}", self.code, self.text())
    }
}

// ─── EHLO Capabilities ─────────────────────────────────────────────

/// Parsed EHLO capability set.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct EhloCapabilities {
    /// The server greeting name.
    pub server_name: String,
    /// Maximum message size (SIZE extension).
    pub max_size: Option<u64>,
    /// Supported auth mechanisms.
    pub auth_mechanisms: Vec<String>,
    /// STARTTLS supported.
    pub starttls: bool,
    /// 8BITMIME supported.
    pub eight_bit_mime: bool,
    /// PIPELINING supported.
    pub pipelining: bool,
    /// CHUNKING / BDAT supported.
    pub chunking: bool,
    /// DSN (Delivery Status Notifications) supported.
    pub dsn: bool,
    /// SMTPUTF8 supported.
    pub smtputf8: bool,
    /// ENHANCEDSTATUSCODES supported.
    pub enhanced_status_codes: bool,
    /// All raw capability lines.
    pub raw_capabilities: Vec<String>,
}

impl EhloCapabilities {
    /// Parse EHLO response lines into capabilities.
    pub fn parse(reply: &SmtpReply) -> Self {
        let mut caps = Self::default();
        for (i, line) in reply.lines.iter().enumerate() {
            if i == 0 {
                caps.server_name = line.clone();
                continue;
            }
            let upper = line.to_uppercase();
            let parts: Vec<&str> = upper.splitn(2, ' ').collect();
            let keyword = parts[0];
            let param = parts.get(1).copied().unwrap_or("");

            match keyword {
                "SIZE" => {
                    caps.max_size = param.parse().ok();
                }
                "AUTH" => {
                    caps.auth_mechanisms = param.split_whitespace().map(|s| s.to_string()).collect();
                }
                "STARTTLS" => caps.starttls = true,
                "8BITMIME" => caps.eight_bit_mime = true,
                "PIPELINING" => caps.pipelining = true,
                "CHUNKING" | "BDAT" => caps.chunking = true,
                "DSN" => caps.dsn = true,
                "SMTPUTF8" => caps.smtputf8 = true,
                "ENHANCEDSTATUSCODES" => caps.enhanced_status_codes = true,
                _ => {}
            }
            caps.raw_capabilities.push(line.clone());
        }
        caps
    }

    /// Check if a specific auth mechanism is supported.
    pub fn supports_auth(&self, method: &str) -> bool {
        let upper = method.to_uppercase();
        self.auth_mechanisms.iter().any(|m| m == &upper)
    }
}

// ─── Queue Item ─────────────────────────────────────────────────────

/// An item in the send queue.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueueItem {
    /// Unique queue item ID.
    pub id: String,
    /// The email message.
    pub message: EmailMessage,
    /// Current status.
    pub status: QueueItemStatus,
    /// When the item was enqueued.
    pub enqueued_at: DateTime<Utc>,
    /// Scheduled send time.
    pub scheduled_at: Option<DateTime<Utc>>,
    /// When sending started.
    pub send_started_at: Option<DateTime<Utc>>,
    /// When sending completed (success or final failure).
    pub completed_at: Option<DateTime<Utc>>,
    /// Number of send attempts.
    pub attempts: u32,
    /// Error messages from each failed attempt.
    pub error_log: Vec<String>,
    /// SMTP config to use for sending (by profile name).
    pub profile_name: Option<String>,
    /// Per-recipient delivery status.
    pub recipient_status: HashMap<String, RecipientDeliveryStatus>,
}

impl QueueItem {
    pub fn new(message: EmailMessage) -> Self {
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            message,
            status: QueueItemStatus::Pending,
            enqueued_at: Utc::now(),
            scheduled_at: None,
            send_started_at: None,
            completed_at: None,
            attempts: 0,
            error_log: Vec::new(),
            profile_name: None,
            recipient_status: HashMap::new(),
        }
    }
}

/// Delivery status per recipient.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecipientDeliveryStatus {
    pub address: String,
    pub accepted: bool,
    pub smtp_code: Option<u16>,
    pub smtp_message: Option<String>,
}

// ─── Queue Summary ──────────────────────────────────────────────────

/// Summary statistics for the queue.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct QueueSummary {
    pub total: usize,
    pub pending: usize,
    pub sending: usize,
    pub sent: usize,
    pub failed: usize,
    pub scheduled_retry: usize,
    pub cancelled: usize,
}

// ─── Contact / Address Book ─────────────────────────────────────────

/// A contact in the address book.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Contact {
    pub id: String,
    pub email: String,
    pub name: Option<String>,
    pub organization: Option<String>,
    pub phone: Option<String>,
    pub notes: Option<String>,
    pub tags: Vec<String>,
    pub groups: Vec<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl Contact {
    pub fn new(email: impl Into<String>) -> Self {
        let now = Utc::now();
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            email: email.into(),
            name: None,
            organization: None,
            phone: None,
            notes: None,
            tags: Vec::new(),
            groups: Vec::new(),
            created_at: now,
            updated_at: now,
        }
    }

    /// Convert to an EmailAddress.
    pub fn to_email_address(&self) -> EmailAddress {
        match &self.name {
            Some(n) => EmailAddress::with_name(&self.email, n),
            None => EmailAddress::new(&self.email),
        }
    }
}

/// A contact group.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContactGroup {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl ContactGroup {
    pub fn new(name: impl Into<String>) -> Self {
        let now = Utc::now();
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            name: name.into(),
            description: None,
            created_at: now,
            updated_at: now,
        }
    }
}

// ─── Template ───────────────────────────────────────────────────────

/// An email template.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EmailTemplate {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub subject_template: String,
    pub text_template: Option<String>,
    pub html_template: Option<String>,
    /// Variables declared in this template.
    pub variables: Vec<TemplateVariable>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl EmailTemplate {
    pub fn new(name: impl Into<String>) -> Self {
        let now = Utc::now();
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            name: name.into(),
            description: None,
            subject_template: String::new(),
            text_template: None,
            html_template: None,
            variables: Vec::new(),
            created_at: now,
            updated_at: now,
        }
    }
}

/// A template variable definition.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TemplateVariable {
    pub name: String,
    pub description: Option<String>,
    pub default_value: Option<String>,
    pub required: bool,
}

// ─── SMTP Profile ───────────────────────────────────────────────────

/// A saved SMTP server profile.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SmtpProfile {
    pub id: String,
    pub name: String,
    pub config: SmtpConfig,
    pub credentials: SmtpCredentials,
    pub from_address: EmailAddress,
    pub dkim: Option<DkimConfig>,
    pub is_default: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl SmtpProfile {
    pub fn new(name: impl Into<String>) -> Self {
        let now = Utc::now();
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            name: name.into(),
            config: SmtpConfig::default(),
            credentials: SmtpCredentials::default(),
            from_address: EmailAddress::new(""),
            dkim: None,
            is_default: false,
            created_at: now,
            updated_at: now,
        }
    }
}

// ─── Send Result ────────────────────────────────────────────────────

/// Result from sending a single message.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SendResult {
    /// Message ID.
    pub message_id: String,
    /// Whether all recipients were accepted.
    pub success: bool,
    /// The queue item ID (if queued).
    pub queue_item_id: Option<String>,
    /// Server-assigned message ID from the DATA reply.
    pub server_message_id: Option<String>,
    /// Per-recipient acceptance status.
    pub recipients: Vec<RecipientDeliveryStatus>,
    /// Elapsed time in milliseconds.
    pub elapsed_ms: u64,
    /// Error message if !success.
    pub error: Option<String>,
}

// ─── Connection Summary ─────────────────────────────────────────────

/// Summary of the current SMTP connection state.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SmtpConnectionSummary {
    pub connected: bool,
    pub tls_active: bool,
    pub authenticated: bool,
    pub server_host: Option<String>,
    pub server_port: Option<u16>,
    pub server_name: Option<String>,
    pub ehlo_capabilities: Option<EhloCapabilities>,
    pub profile_name: Option<String>,
    pub messages_sent: u64,
    pub last_activity: Option<String>,
}

// ─── Diagnostics ────────────────────────────────────────────────────

/// Full diagnostics report.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiagnosticsReport {
    pub domain: String,
    pub mx_records: Vec<MxRecord>,
    pub checks: Vec<DiagnosticCheckResult>,
    pub overall_healthy: bool,
    pub timestamp: DateTime<Utc>,
}

/// A single diagnostic check result.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiagnosticCheckResult {
    pub name: String,
    pub result: DiagnosticCheck,
    pub elapsed_ms: u64,
}

// ─── Bulk Send ──────────────────────────────────────────────────────

/// Request to send to multiple recipients with optional personalization.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BulkSendRequest {
    /// Template ID to use.
    pub template_id: Option<String>,
    /// Base message (used if no template).
    pub base_message: Option<EmailMessage>,
    /// Per-recipient variable overrides.
    pub recipients: Vec<BulkRecipient>,
    /// Profile name for sending.
    pub profile_name: Option<String>,
    /// Scheduling.
    pub schedule: SendSchedule,
}

/// A recipient in a bulk send.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BulkRecipient {
    pub address: EmailAddress,
    pub variables: HashMap<String, String>,
}

/// Bulk send result summary.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BulkSendResult {
    pub total: usize,
    pub queued: usize,
    pub failed: usize,
    pub queue_item_ids: Vec<String>,
    pub errors: Vec<String>,
}

// ─── Tests ──────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    // ── Error tests ─────────────────────────────────────────────

    #[test]
    fn error_display_without_code() {
        let e = SmtpError::new(SmtpErrorKind::ConnectionError, "timeout");
        assert_eq!(e.to_string(), "[SMTP] ConnectionError: timeout");
    }

    #[test]
    fn error_display_with_code() {
        let e = SmtpError::server(550, "Mailbox not found");
        assert_eq!(e.to_string(), "[SMTP 550] ServerReply: Mailbox not found");
    }

    #[test]
    fn error_with_enhanced_code() {
        let e = SmtpError::server(550, "no such user")
            .with_enhanced("5.1.1");
        assert_eq!(e.enhanced_code, Some("5.1.1".into()));
    }

    #[test]
    fn error_std_error_trait() {
        let e: Box<dyn std::error::Error> =
            Box::new(SmtpError::config("bad host"));
        assert!(e.to_string().contains("bad host"));
    }

    // ── EmailAddress tests ──────────────────────────────────────

    #[test]
    fn email_address_simple() {
        let addr = EmailAddress::new("alice@example.com");
        assert_eq!(addr.to_mailbox(), "alice@example.com");
        assert_eq!(addr.to_angle_addr(), "<alice@example.com>");
        assert!(addr.is_valid());
    }

    #[test]
    fn email_address_with_name() {
        let addr = EmailAddress::with_name("bob@example.com", "Bob Smith");
        assert_eq!(addr.to_mailbox(), "\"Bob Smith\" <bob@example.com>");
    }

    #[test]
    fn email_address_parse_angle() {
        let addr = EmailAddress::parse("\"Alice\" <alice@example.com>").unwrap();
        assert_eq!(addr.name, Some("Alice".into()));
        assert_eq!(addr.address, "alice@example.com");
    }

    #[test]
    fn email_address_parse_bare() {
        let addr = EmailAddress::parse("bob@example.com").unwrap();
        assert!(addr.name.is_none());
        assert_eq!(addr.address, "bob@example.com");
    }

    #[test]
    fn email_address_invalid() {
        assert!(EmailAddress::parse("not-an-email").is_err());
    }

    #[test]
    fn email_address_domain() {
        let addr = EmailAddress::new("user@example.com");
        assert_eq!(addr.domain(), Some("example.com"));
    }

    #[test]
    fn email_address_is_valid_checks() {
        assert!(EmailAddress::new("a@b.com").is_valid());
        assert!(!EmailAddress::new("noatsign").is_valid());
        assert!(!EmailAddress::new("@nodomain").is_valid());
        assert!(!EmailAddress::new("a@nodot").is_valid());
    }

    // ── Attachment tests ────────────────────────────────────────

    #[test]
    fn attachment_roundtrip() {
        let data = b"Hello, PDF!";
        let att = Attachment::new("doc.pdf", "application/pdf", data);
        let decoded = att.decode_data().unwrap();
        assert_eq!(decoded, data);
        assert!(!att.inline);
    }

    #[test]
    fn inline_attachment() {
        let att = Attachment::inline_image("logo.png", "image/png", b"\x89PNG", "logo1");
        assert!(att.inline);
        assert_eq!(att.content_id, Some("logo1".into()));
    }

    #[test]
    fn attachment_estimated_size() {
        let att = Attachment::new("f.txt", "text/plain", &[0u8; 100]);
        // base64 of 100 bytes ≈ 136 chars, estimated_size = 136 * 3 / 4 = 102
        assert!(att.estimated_size() >= 90);
    }

    // ── EmailMessage tests ──────────────────────────────────────

    #[test]
    fn email_message_default() {
        let msg = EmailMessage::default();
        assert!(!msg.id.is_empty());
        assert_eq!(msg.charset, "UTF-8");
    }

    #[test]
    fn email_message_validate_no_from() {
        let msg = EmailMessage::default();
        assert!(msg.validate().is_err());
    }

    #[test]
    fn email_message_validate_no_recipients() {
        let mut msg = EmailMessage::default();
        msg.from = EmailAddress::new("a@b.com");
        msg.text_body = Some("hi".into());
        assert!(msg.validate().is_err());
    }

    #[test]
    fn email_message_validate_no_body() {
        let mut msg = EmailMessage::default();
        msg.from = EmailAddress::new("a@b.com");
        msg.to.push(EmailAddress::new("b@c.com"));
        assert!(msg.validate().is_err());
    }

    #[test]
    fn email_message_validate_ok() {
        let mut msg = EmailMessage::default();
        msg.from = EmailAddress::new("a@b.com");
        msg.to.push(EmailAddress::new("b@c.com"));
        msg.text_body = Some("Hello".into());
        assert!(msg.validate().is_ok());
    }

    #[test]
    fn email_message_all_recipients() {
        let mut msg = EmailMessage::default();
        msg.to.push(EmailAddress::new("a@x.com"));
        msg.cc.push(EmailAddress::new("b@x.com"));
        msg.bcc.push(EmailAddress::new("c@x.com"));
        assert_eq!(msg.all_recipients().len(), 3);
    }

    // ── SmtpReply tests ─────────────────────────────────────────

    #[test]
    fn smtp_reply_parse_single() {
        let reply = SmtpReply::parse("250 OK").unwrap();
        assert_eq!(reply.code, 250);
        assert!(reply.is_positive());
        assert!(!reply.is_multiline);
    }

    #[test]
    fn smtp_reply_parse_multiline() {
        let raw = "250-mail.example.com\r\n250-SIZE 52428800\r\n250 STARTTLS";
        let reply = SmtpReply::parse(raw).unwrap();
        assert_eq!(reply.code, 250);
        assert!(reply.is_multiline);
        assert_eq!(reply.lines.len(), 3);
    }

    #[test]
    fn smtp_reply_parse_enhanced() {
        let reply = SmtpReply::parse("250 2.1.0 Sender OK").unwrap();
        assert_eq!(reply.enhanced_code, Some("2.1.0".into()));
    }

    #[test]
    fn smtp_reply_error_codes() {
        let r4 = SmtpReply::parse("421 Service not available").unwrap();
        assert!(r4.is_transient_negative());
        assert!(r4.is_error());

        let r5 = SmtpReply::parse("550 5.1.1 User unknown").unwrap();
        assert!(r5.is_permanent_negative());
        assert!(r5.is_error());
    }

    #[test]
    fn smtp_reply_intermediate() {
        let r = SmtpReply::parse("354 Start mail input").unwrap();
        assert!(r.is_intermediate());
    }

    // ── EhloCapabilities tests ──────────────────────────────────

    #[test]
    fn ehlo_capabilities_parse() {
        let reply = SmtpReply {
            code: 250,
            enhanced_code: None,
            lines: vec![
                "mail.example.com".into(),
                "SIZE 52428800".into(),
                "AUTH PLAIN LOGIN CRAM-MD5".into(),
                "STARTTLS".into(),
                "8BITMIME".into(),
                "PIPELINING".into(),
                "DSN".into(),
                "ENHANCEDSTATUSCODES".into(),
            ],
            is_multiline: true,
        };
        let caps = EhloCapabilities::parse(&reply);
        assert_eq!(caps.server_name, "mail.example.com");
        assert_eq!(caps.max_size, Some(52428800));
        assert!(caps.starttls);
        assert!(caps.eight_bit_mime);
        assert!(caps.pipelining);
        assert!(caps.dsn);
        assert!(caps.enhanced_status_codes);
        assert_eq!(caps.auth_mechanisms.len(), 3);
        assert!(caps.supports_auth("PLAIN"));
        assert!(caps.supports_auth("login"));
        assert!(!caps.supports_auth("XOAUTH2"));
    }

    // ── Config defaults ─────────────────────────────────────────

    #[test]
    fn smtp_config_defaults() {
        let cfg = SmtpConfig::default();
        assert_eq!(cfg.port, 587);
        assert_eq!(cfg.security, SmtpSecurity::StartTls);
        assert!(cfg.verify_certificates);
    }

    #[test]
    fn dkim_config_defaults() {
        let cfg = DkimConfig::default();
        assert_eq!(cfg.selector, "default");
        assert_eq!(cfg.header_canon, DkimCanonicalization::Relaxed);
        assert!(!cfg.signed_headers.is_empty());
    }

    #[test]
    fn queue_config_defaults() {
        let cfg = QueueConfig::default();
        assert_eq!(cfg.max_retries, 3);
        assert_eq!(cfg.concurrency, 4);
    }

    // ── Serde round-trips ───────────────────────────────────────

    #[test]
    fn email_address_serde() {
        let addr = EmailAddress::with_name("user@x.com", "User");
        let json = serde_json::to_string(&addr).unwrap();
        let d: EmailAddress = serde_json::from_str(&json).unwrap();
        assert_eq!(d, addr);
    }

    #[test]
    fn smtp_config_serde() {
        let cfg = SmtpConfig::default();
        let json = serde_json::to_string(&cfg).unwrap();
        let d: SmtpConfig = serde_json::from_str(&json).unwrap();
        assert_eq!(d.port, 587);
    }

    #[test]
    fn queue_summary_serde() {
        let qs = QueueSummary {
            total: 10,
            pending: 3,
            sending: 1,
            sent: 5,
            failed: 1,
            scheduled_retry: 0,
            cancelled: 0,
        };
        let json = serde_json::to_string(&qs).unwrap();
        let d: QueueSummary = serde_json::from_str(&json).unwrap();
        assert_eq!(d.total, 10);
    }

    #[test]
    fn contact_to_email_address() {
        let mut c = Contact::new("alice@x.com");
        c.name = Some("Alice".into());
        let addr = c.to_email_address();
        assert_eq!(addr.name, Some("Alice".into()));
        assert_eq!(addr.address, "alice@x.com");
    }

    #[test]
    fn contact_group_new() {
        let g = ContactGroup::new("Team");
        assert_eq!(g.name, "Team");
        assert!(!g.id.is_empty());
    }

    #[test]
    fn email_template_new() {
        let t = EmailTemplate::new("Welcome");
        assert_eq!(t.name, "Welcome");
        assert!(t.subject_template.is_empty());
    }

    #[test]
    fn smtp_profile_new() {
        let p = SmtpProfile::new("Gmail");
        assert_eq!(p.name, "Gmail");
        assert!(!p.is_default);
    }

    #[test]
    fn queue_item_new() {
        let msg = EmailMessage::default();
        let qi = QueueItem::new(msg);
        assert_eq!(qi.status, QueueItemStatus::Pending);
        assert_eq!(qi.attempts, 0);
    }

    #[test]
    fn message_priority_display() {
        assert_eq!(MessagePriority::High.to_string(), "1 (Highest)");
        assert_eq!(MessagePriority::Normal.to_string(), "3 (Normal)");
        assert_eq!(MessagePriority::Low.to_string(), "5 (Lowest)");
    }

    #[test]
    fn transfer_encoding_display() {
        assert_eq!(TransferEncoding::Base64.to_string(), "base64");
        assert_eq!(
            TransferEncoding::QuotedPrintable.to_string(),
            "quoted-printable"
        );
        assert_eq!(TransferEncoding::SevenBit.to_string(), "7bit");
    }

    #[test]
    fn security_mode_default() {
        assert_eq!(SmtpSecurity::default(), SmtpSecurity::StartTls);
    }

    #[test]
    fn auth_method_display() {
        assert_eq!(SmtpAuthMethod::Plain.to_string(), "PLAIN");
        assert_eq!(SmtpAuthMethod::CramMd5.to_string(), "CRAM-MD5");
        assert_eq!(SmtpAuthMethod::XOAuth2.to_string(), "XOAUTH2");
    }

    #[test]
    fn dkim_canonicalization_display() {
        assert_eq!(DkimCanonicalization::Simple.to_string(), "simple");
        assert_eq!(DkimCanonicalization::Relaxed.to_string(), "relaxed");
    }

    #[test]
    fn connection_summary_default() {
        let cs = SmtpConnectionSummary::default();
        assert!(!cs.connected);
        assert!(!cs.tls_active);
        assert!(!cs.authenticated);
    }

    #[test]
    fn bulk_send_request_serde() {
        let req = BulkSendRequest {
            template_id: Some("t1".into()),
            base_message: None,
            recipients: vec![BulkRecipient {
                address: EmailAddress::new("a@b.com"),
                variables: HashMap::new(),
            }],
            profile_name: None,
            schedule: SendSchedule::Immediate,
        };
        let json = serde_json::to_string(&req).unwrap();
        assert!(json.contains("a@b.com"));
    }

    #[test]
    fn send_result_serde() {
        let sr = SendResult {
            message_id: "m1".into(),
            success: true,
            queue_item_id: None,
            server_message_id: Some("srv123".into()),
            recipients: vec![],
            elapsed_ms: 42,
            error: None,
        };
        let json = serde_json::to_string(&sr).unwrap();
        let d: SendResult = serde_json::from_str(&json).unwrap();
        assert!(d.success);
        assert_eq!(d.elapsed_ms, 42);
    }

    #[test]
    fn diagnostics_report_serde() {
        let dr = DiagnosticsReport {
            domain: "example.com".into(),
            mx_records: vec![MxRecord {
                priority: 10,
                exchange: "mx.example.com".into(),
            }],
            checks: vec![],
            overall_healthy: true,
            timestamp: Utc::now(),
        };
        let json = serde_json::to_string(&dr).unwrap();
        assert!(json.contains("example.com"));
    }

    #[test]
    fn mx_record_serde() {
        let mx = MxRecord {
            priority: 10,
            exchange: "mx1.example.com".into(),
        };
        let json = serde_json::to_string(&mx).unwrap();
        let d: MxRecord = serde_json::from_str(&json).unwrap();
        assert_eq!(d.priority, 10);
    }
}
