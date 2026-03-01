//! MIME message builder.
//!
//! Converts an `EmailMessage` into a properly formatted RFC 5322 / MIME
//! message string suitable for the SMTP DATA command.

use base64::Engine;
use chrono::Utc;

use crate::types::*;

/// Build the full MIME message string from an `EmailMessage`.
pub fn build_message(msg: &EmailMessage) -> SmtpResult<String> {
    msg.validate()?;

    let mut out = String::with_capacity(msg.estimated_size() + 1024);
    let boundary_mixed = format!("----=_Part_{}", uuid::Uuid::new_v4().simple());
    let boundary_alt = format!("----=_Alt_{}", uuid::Uuid::new_v4().simple());
    let boundary_related = format!("----=_Rel_{}", uuid::Uuid::new_v4().simple());

    let has_attachments = msg
        .attachments
        .iter()
        .any(|a| !a.inline);
    let has_inline_images = msg.attachments.iter().any(|a| a.inline);
    let has_html = msg.html_body.is_some();
    let has_text = msg.text_body.is_some();
    let is_multipart_alt = has_text && has_html;

    // ── Headers ────────────────────────────────────────────
    write_header(&mut out, "Message-ID", &format!("<{}>", msg.id));
    write_header(
        &mut out,
        "Date",
        &msg.date
            .unwrap_or_else(Utc::now)
            .format("%a, %d %b %Y %H:%M:%S %z")
            .to_string(),
    );
    write_header(&mut out, "From", &msg.from.to_mailbox());

    if let Some(ref reply_to) = msg.reply_to {
        write_header(&mut out, "Reply-To", &reply_to.to_mailbox());
    }

    write_header(
        &mut out,
        "To",
        &msg.to.iter().map(|a| a.to_mailbox()).collect::<Vec<_>>().join(", "),
    );

    if !msg.cc.is_empty() {
        write_header(
            &mut out,
            "Cc",
            &msg.cc.iter().map(|a| a.to_mailbox()).collect::<Vec<_>>().join(", "),
        );
    }
    // BCC not included in headers (by design)

    write_header(&mut out, "Subject", &encode_header_value(&msg.subject));
    write_header(&mut out, "MIME-Version", "1.0");

    // Priority
    if msg.priority != MessagePriority::Normal {
        write_header(&mut out, "X-Priority", &msg.priority.to_string());
        let importance = match msg.priority {
            MessagePriority::High => "high",
            MessagePriority::Normal => "normal",
            MessagePriority::Low => "low",
        };
        write_header(&mut out, "Importance", importance);
    }

    // Threading
    if let Some(ref irt) = msg.in_reply_to {
        write_header(&mut out, "In-Reply-To", &format!("<{}>", irt));
    }
    if !msg.references.is_empty() {
        let refs = msg
            .references
            .iter()
            .map(|r| format!("<{}>", r))
            .collect::<Vec<_>>()
            .join(" ");
        write_header(&mut out, "References", &refs);
    }

    // Read receipt
    if let Some(ref rr) = msg.read_receipt_to {
        write_header(
            &mut out,
            "Disposition-Notification-To",
            &rr.to_mailbox(),
        );
    }

    // Custom headers
    for (name, value) in &msg.custom_headers {
        write_header(&mut out, name, value);
    }

    // ── Body structure ─────────────────────────────────────
    if has_attachments {
        // multipart/mixed
        write_header(
            &mut out,
            "Content-Type",
            &format!("multipart/mixed; boundary=\"{}\"", boundary_mixed),
        );
        out.push_str("\r\n");
        out.push_str("This is a multi-part message in MIME format.\r\n");
        out.push_str(&format!("\r\n--{}\r\n", boundary_mixed));

        // Inner body (alternatives + inline images)
        write_body_content(
            &mut out,
            msg,
            &boundary_alt,
            &boundary_related,
            has_html,
            has_text,
            is_multipart_alt,
            has_inline_images,
        );

        // Regular attachments
        for att in &msg.attachments {
            if att.inline {
                continue;
            }
            out.push_str(&format!("\r\n--{}\r\n", boundary_mixed));
            write_attachment(&mut out, att);
        }
        out.push_str(&format!("\r\n--{}--\r\n", boundary_mixed));
    } else if has_inline_images {
        // multipart/related (no file attachments, but inline images)
        write_header(
            &mut out,
            "Content-Type",
            &format!("multipart/related; boundary=\"{}\"", boundary_related),
        );
        out.push_str("\r\n");
        write_body_alternatives(
            &mut out,
            msg,
            &boundary_alt,
            has_text,
            has_html,
            is_multipart_alt,
        );
        for att in &msg.attachments {
            if att.inline {
                out.push_str(&format!("\r\n--{}\r\n", boundary_related));
                write_attachment(&mut out, att);
            }
        }
        out.push_str(&format!("\r\n--{}--\r\n", boundary_related));
    } else if is_multipart_alt {
        // multipart/alternative (text + HTML, no attachments)
        write_header(
            &mut out,
            "Content-Type",
            &format!("multipart/alternative; boundary=\"{}\"", boundary_alt),
        );
        out.push_str("\r\n");
        write_text_part(&mut out, msg, &boundary_alt);
        write_html_part(&mut out, msg, &boundary_alt);
        out.push_str(&format!("\r\n--{}--\r\n", boundary_alt));
    } else if has_html {
        // HTML only
        write_header(
            &mut out,
            "Content-Type",
            &format!("text/html; charset=\"{}\"", msg.charset),
        );
        write_header(
            &mut out,
            "Content-Transfer-Encoding",
            &msg.transfer_encoding.to_string(),
        );
        out.push_str("\r\n");
        out.push_str(&encode_body(
            msg.html_body.as_deref().unwrap_or(""),
            msg.transfer_encoding,
        ));
    } else {
        // Text only
        write_header(
            &mut out,
            "Content-Type",
            &format!("text/plain; charset=\"{}\"", msg.charset),
        );
        write_header(
            &mut out,
            "Content-Transfer-Encoding",
            &msg.transfer_encoding.to_string(),
        );
        out.push_str("\r\n");
        out.push_str(&encode_body(
            msg.text_body.as_deref().unwrap_or(""),
            msg.transfer_encoding,
        ));
    }

    Ok(out)
}

// ── Helper: write body content inside mixed ─────────────────────────

fn write_body_content(
    out: &mut String,
    msg: &EmailMessage,
    boundary_alt: &str,
    boundary_related: &str,
    has_html: bool,
    has_text: bool,
    is_multipart_alt: bool,
    has_inline_images: bool,
) {
    if has_inline_images && has_html {
        // multipart/related containing alternative + inline images
        write_header(
            out,
            "Content-Type",
            &format!("multipart/related; boundary=\"{}\"", boundary_related),
        );
        out.push_str("\r\n");
        out.push_str(&format!("--{}\r\n", boundary_related));
        write_body_alternatives(out, msg, boundary_alt, has_text, has_html, is_multipart_alt);
        for att in &msg.attachments {
            if att.inline {
                out.push_str(&format!("\r\n--{}\r\n", boundary_related));
                write_attachment(out, att);
            }
        }
        out.push_str(&format!("\r\n--{}--\r\n", boundary_related));
    } else {
        write_body_alternatives(out, msg, boundary_alt, has_text, has_html, is_multipart_alt);
    }
}

fn write_body_alternatives(
    out: &mut String,
    msg: &EmailMessage,
    boundary_alt: &str,
    has_text: bool,
    has_html: bool,
    is_multipart_alt: bool,
) {
    if is_multipart_alt {
        write_header(
            out,
            "Content-Type",
            &format!("multipart/alternative; boundary=\"{}\"", boundary_alt),
        );
        out.push_str("\r\n");
        write_text_part(out, msg, boundary_alt);
        write_html_part(out, msg, boundary_alt);
        out.push_str(&format!("\r\n--{}--\r\n", boundary_alt));
    } else if has_html {
        write_header(
            out,
            "Content-Type",
            &format!("text/html; charset=\"{}\"", msg.charset),
        );
        write_header(
            out,
            "Content-Transfer-Encoding",
            &msg.transfer_encoding.to_string(),
        );
        out.push_str("\r\n");
        out.push_str(&encode_body(
            msg.html_body.as_deref().unwrap_or(""),
            msg.transfer_encoding,
        ));
    } else if has_text {
        write_header(
            out,
            "Content-Type",
            &format!("text/plain; charset=\"{}\"", msg.charset),
        );
        write_header(
            out,
            "Content-Transfer-Encoding",
            &msg.transfer_encoding.to_string(),
        );
        out.push_str("\r\n");
        out.push_str(&encode_body(
            msg.text_body.as_deref().unwrap_or(""),
            msg.transfer_encoding,
        ));
    }
}

fn write_text_part(out: &mut String, msg: &EmailMessage, boundary: &str) {
    out.push_str(&format!("\r\n--{}\r\n", boundary));
    write_header(
        out,
        "Content-Type",
        &format!("text/plain; charset=\"{}\"", msg.charset),
    );
    write_header(
        out,
        "Content-Transfer-Encoding",
        &msg.transfer_encoding.to_string(),
    );
    out.push_str("\r\n");
    out.push_str(&encode_body(
        msg.text_body.as_deref().unwrap_or(""),
        msg.transfer_encoding,
    ));
}

fn write_html_part(out: &mut String, msg: &EmailMessage, boundary: &str) {
    out.push_str(&format!("\r\n--{}\r\n", boundary));
    write_header(
        out,
        "Content-Type",
        &format!("text/html; charset=\"{}\"", msg.charset),
    );
    write_header(
        out,
        "Content-Transfer-Encoding",
        &msg.transfer_encoding.to_string(),
    );
    out.push_str("\r\n");
    out.push_str(&encode_body(
        msg.html_body.as_deref().unwrap_or(""),
        msg.transfer_encoding,
    ));
}

fn write_attachment(out: &mut String, att: &Attachment) {
    let disposition = if att.inline { "inline" } else { "attachment" };
    write_header(
        out,
        "Content-Type",
        &format!("{}; name=\"{}\"", att.content_type, att.filename),
    );
    write_header(
        out,
        "Content-Disposition",
        &format!("{}; filename=\"{}\"", disposition, att.filename),
    );
    write_header(out, "Content-Transfer-Encoding", "base64");
    if let Some(ref cid) = att.content_id {
        write_header(out, "Content-ID", &format!("<{}>", cid));
    }
    out.push_str("\r\n");
    // Wrap base64 at 76 chars per line
    let b64 = &att.data_base64;
    for chunk in b64.as_bytes().chunks(76) {
        out.push_str(std::str::from_utf8(chunk).unwrap_or(""));
        out.push_str("\r\n");
    }
}

// ── Header helpers ──────────────────────────────────────────────────

fn write_header(out: &mut String, name: &str, value: &str) {
    out.push_str(name);
    out.push_str(": ");
    out.push_str(value);
    out.push_str("\r\n");
}

/// RFC 2047 encode a header value if it contains non-ASCII characters.
pub fn encode_header_value(value: &str) -> String {
    if value.is_ascii() {
        return value.to_string();
    }
    // Use RFC 2047 Base64 encoding for the whole value
    let encoded = base64::engine::general_purpose::STANDARD.encode(value.as_bytes());
    format!("=?UTF-8?B?{}?=", encoded)
}

/// Encode body text with the specified transfer encoding.
pub fn encode_body(text: &str, encoding: TransferEncoding) -> String {
    match encoding {
        TransferEncoding::SevenBit => text.to_string(),
        TransferEncoding::QuotedPrintable => {
            quoted_printable::encode_to_str(text.as_bytes())
        }
        TransferEncoding::Base64 => {
            let b64 = base64::engine::general_purpose::STANDARD.encode(text.as_bytes());
            // Wrap at 76 chars
            b64.as_bytes()
                .chunks(76)
                .map(|c| std::str::from_utf8(c).unwrap_or(""))
                .collect::<Vec<_>>()
                .join("\r\n")
        }
    }
}

/// Build a `MessageBuilder` for convenience.
pub struct MessageBuilder {
    msg: EmailMessage,
}

impl MessageBuilder {
    pub fn new() -> Self {
        Self {
            msg: EmailMessage::default(),
        }
    }

    pub fn from(mut self, addr: EmailAddress) -> Self {
        self.msg.from = addr;
        self
    }

    pub fn from_str(mut self, addr: &str) -> SmtpResult<Self> {
        self.msg.from = EmailAddress::parse(addr)?;
        Ok(self)
    }

    pub fn reply_to(mut self, addr: EmailAddress) -> Self {
        self.msg.reply_to = Some(addr);
        self
    }

    pub fn to(mut self, addr: EmailAddress) -> Self {
        self.msg.to.push(addr);
        self
    }

    pub fn to_str(mut self, addr: &str) -> SmtpResult<Self> {
        self.msg.to.push(EmailAddress::parse(addr)?);
        Ok(self)
    }

    pub fn cc(mut self, addr: EmailAddress) -> Self {
        self.msg.cc.push(addr);
        self
    }

    pub fn bcc(mut self, addr: EmailAddress) -> Self {
        self.msg.bcc.push(addr);
        self
    }

    pub fn subject(mut self, s: impl Into<String>) -> Self {
        self.msg.subject = s.into();
        self
    }

    pub fn text(mut self, body: impl Into<String>) -> Self {
        self.msg.text_body = Some(body.into());
        self
    }

    pub fn html(mut self, body: impl Into<String>) -> Self {
        self.msg.html_body = Some(body.into());
        self
    }

    pub fn attachment(mut self, att: Attachment) -> Self {
        self.msg.attachments.push(att);
        self
    }

    pub fn priority(mut self, p: MessagePriority) -> Self {
        self.msg.priority = p;
        self
    }

    pub fn header(mut self, name: impl Into<String>, value: impl Into<String>) -> Self {
        self.msg.custom_headers.insert(name.into(), value.into());
        self
    }

    pub fn in_reply_to(mut self, msg_id: impl Into<String>) -> Self {
        self.msg.in_reply_to = Some(msg_id.into());
        self
    }

    pub fn reference(mut self, msg_id: impl Into<String>) -> Self {
        self.msg.references.push(msg_id.into());
        self
    }

    pub fn read_receipt(mut self, addr: EmailAddress) -> Self {
        self.msg.read_receipt_to = Some(addr);
        self
    }

    pub fn transfer_encoding(mut self, enc: TransferEncoding) -> Self {
        self.msg.transfer_encoding = enc;
        self
    }

    pub fn build(self) -> SmtpResult<EmailMessage> {
        self.msg.validate()?;
        Ok(self.msg)
    }

    /// Build without validation (for drafts).
    pub fn build_draft(self) -> EmailMessage {
        self.msg
    }
}

impl Default for MessageBuilder {
    fn default() -> Self {
        Self::new()
    }
}

// ─── Tests ──────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_message() -> EmailMessage {
        let mut msg = EmailMessage::default();
        msg.from = EmailAddress::new("sender@example.com");
        msg.to.push(EmailAddress::new("rcpt@example.com"));
        msg.subject = "Test Subject".into();
        msg.text_body = Some("Hello, world!".into());
        msg
    }

    #[test]
    fn build_text_only_message() {
        let msg = sample_message();
        let raw = build_message(&msg).unwrap();
        assert!(raw.contains("From: sender@example.com"));
        assert!(raw.contains("To: rcpt@example.com"));
        assert!(raw.contains("Subject: Test Subject"));
        assert!(raw.contains("MIME-Version: 1.0"));
        assert!(raw.contains("text/plain"));
    }

    #[test]
    fn build_html_only_message() {
        let mut msg = EmailMessage::default();
        msg.from = EmailAddress::new("a@b.com");
        msg.to.push(EmailAddress::new("c@d.com"));
        msg.subject = "HTML".into();
        msg.html_body = Some("<h1>Hello</h1>".into());
        let raw = build_message(&msg).unwrap();
        assert!(raw.contains("text/html"));
    }

    #[test]
    fn build_multipart_alternative() {
        let mut msg = sample_message();
        msg.html_body = Some("<p>Hello</p>".into());
        let raw = build_message(&msg).unwrap();
        assert!(raw.contains("multipart/alternative"));
        assert!(raw.contains("text/plain"));
        assert!(raw.contains("text/html"));
    }

    #[test]
    fn build_with_attachment() {
        let mut msg = sample_message();
        msg.attachments.push(Attachment::new("doc.pdf", "application/pdf", b"PDF"));
        let raw = build_message(&msg).unwrap();
        assert!(raw.contains("multipart/mixed"));
        assert!(raw.contains("doc.pdf"));
        assert!(raw.contains("application/pdf"));
    }

    #[test]
    fn build_with_inline_image() {
        let mut msg = EmailMessage::default();
        msg.from = EmailAddress::new("a@b.com");
        msg.to.push(EmailAddress::new("c@d.com"));
        msg.subject = "Inline".into();
        msg.html_body = Some("<img src=\"cid:logo\">".into());
        msg.attachments.push(Attachment::inline_image(
            "logo.png",
            "image/png",
            b"\x89PNG",
            "logo",
        ));
        let raw = build_message(&msg).unwrap();
        assert!(raw.contains("multipart/related"));
        assert!(raw.contains("Content-ID: <logo>"));
    }

    #[test]
    fn build_high_priority() {
        let mut msg = sample_message();
        msg.priority = MessagePriority::High;
        let raw = build_message(&msg).unwrap();
        assert!(raw.contains("X-Priority: 1 (Highest)"));
        assert!(raw.contains("Importance: high"));
    }

    #[test]
    fn build_with_reply_to() {
        let mut msg = sample_message();
        msg.reply_to = Some(EmailAddress::new("reply@example.com"));
        let raw = build_message(&msg).unwrap();
        assert!(raw.contains("Reply-To: reply@example.com"));
    }

    #[test]
    fn build_with_cc() {
        let mut msg = sample_message();
        msg.cc.push(EmailAddress::with_name("cc@example.com", "CC Guy"));
        let raw = build_message(&msg).unwrap();
        assert!(raw.contains("Cc: \"CC Guy\" <cc@example.com>"));
    }

    #[test]
    fn encode_header_ascii() {
        assert_eq!(encode_header_value("Hello"), "Hello");
    }

    #[test]
    fn encode_header_utf8() {
        let val = "Привет";
        let encoded = encode_header_value(val);
        assert!(encoded.starts_with("=?UTF-8?B?"));
        assert!(encoded.ends_with("?="));
    }

    #[test]
    fn encode_body_base64() {
        let encoded = encode_body("Hello World", TransferEncoding::Base64);
        let decoded = base64::engine::general_purpose::STANDARD
            .decode(encoded.trim().as_bytes())
            .unwrap();
        assert_eq!(String::from_utf8(decoded).unwrap(), "Hello World");
    }

    #[test]
    fn encode_body_seven_bit() {
        let text = "Just ASCII";
        assert_eq!(encode_body(text, TransferEncoding::SevenBit), text);
    }

    #[test]
    fn message_builder_chain() {
        let msg = MessageBuilder::new()
            .from(EmailAddress::new("a@b.com"))
            .to(EmailAddress::new("c@d.com"))
            .subject("Test")
            .text("Body")
            .priority(MessagePriority::Low)
            .header("X-Custom", "value")
            .build()
            .unwrap();
        assert_eq!(msg.from.address, "a@b.com");
        assert_eq!(msg.subject, "Test");
        assert_eq!(msg.priority, MessagePriority::Low);
        assert!(msg.custom_headers.contains_key("X-Custom"));
    }

    #[test]
    fn message_builder_draft() {
        let msg = MessageBuilder::new()
            .subject("Draft")
            .build_draft();
        assert_eq!(msg.subject, "Draft");
        // No validation errors even though incomplete
    }

    #[test]
    fn builder_from_str() {
        let msg = MessageBuilder::new()
            .from_str("\"Alice\" <alice@x.com>")
            .unwrap()
            .to_str("bob@x.com")
            .unwrap()
            .subject("Hi")
            .text("Hello")
            .build()
            .unwrap();
        assert_eq!(msg.from.name, Some("Alice".into()));
    }

    #[test]
    fn build_with_threading() {
        let mut msg = sample_message();
        msg.in_reply_to = Some("original-msg-id".into());
        msg.references.push("original-msg-id".into());
        msg.references.push("other-msg-id".into());
        let raw = build_message(&msg).unwrap();
        assert!(raw.contains("In-Reply-To: <original-msg-id>"));
        assert!(raw.contains("References: <original-msg-id> <other-msg-id>"));
    }

    #[test]
    fn build_with_read_receipt() {
        let mut msg = sample_message();
        msg.read_receipt_to = Some(EmailAddress::new("tracker@example.com"));
        let raw = build_message(&msg).unwrap();
        assert!(raw.contains("Disposition-Notification-To: tracker@example.com"));
    }
}
