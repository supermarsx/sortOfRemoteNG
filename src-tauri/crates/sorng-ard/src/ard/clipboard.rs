//! Apple Remote Desktop clipboard support.
//!
//! Handles both standard RFB `ClientCutText`/`ServerCutText` and the
//! Apple-specific clipboard extension (pseudo-encoding `0x574D5601`)
//! which supports multiple pasteboard types (plain text, RTF, HTML, file URLs).

use super::errors::ArdError;
use super::rfb::{self, RfbConnection};

/// Clipboard content that may include multiple pasteboard types.
#[derive(Debug, Clone, Default)]
pub struct ClipboardContent {
    pub text: Option<String>,
    pub rtf: Option<Vec<u8>>,
    pub html: Option<String>,
    pub file_url: Option<String>,
}

impl ClipboardContent {
    /// Create ClipboardContent with plain text only.
    pub fn plain(text: impl Into<String>) -> Self {
        Self {
            text: Some(text.into()),
            rtf: None,
            html: None,
            file_url: None,
        }
    }

    /// Whether all fields are empty/None.
    pub fn is_empty(&self) -> bool {
        self.text.is_none() && self.rtf.is_none() && self.html.is_none() && self.file_url.is_none()
    }
}

/// Apple clipboard pseudo-encoding.
pub const APPLE_CLIPBOARD_ENCODING: i32 = rfb::encoding::APPLE_CLIPBOARD;

/// Apple pasteboard type tags (4-byte big-endian identifiers).
pub mod pasteboard_type {
    /// Plain UTF-8 text ("utxt")
    pub const TEXT: u32 = 0x7574_7874;
    /// RTF data ("RTF ")
    pub const RTF: u32 = 0x5254_4620;
    /// HTML text ("HTML")
    pub const HTML: u32 = 0x4854_4D4C;
    /// File URL ("furl")
    pub const FILE: u32 = 0x6675_726C;
}

/// Read clipboard data sent by the server via Apple clipboard extension.
///
/// This is delivered inside a `FramebufferUpdate` rectangle with
/// encoding `APPLE_CLIPBOARD`. The rect header has already been consumed;
/// we read the Apple clipboard payload from the connection.
pub fn read_server_clipboard(conn: &mut RfbConnection) -> Result<ClipboardContent, ArdError> {
    let total_len = conn.read_u32()? as usize;
    if total_len == 0 {
        return Ok(ClipboardContent::default());
    }

    let num_types = conn.read_u32()? as usize;
    let mut content = ClipboardContent::default();
    let mut bytes_read = 4; // num_types u32

    for _ in 0..num_types {
        if bytes_read + 8 > total_len {
            break;
        }
        let tag = conn.read_u32()?;
        let data_len = conn.read_u32()? as usize;
        bytes_read += 8;

        if bytes_read + data_len > total_len + 4 {
            // Drain remaining
            let remaining = total_len.saturating_sub(bytes_read);
            if remaining > 0 {
                let mut drain = vec![0u8; remaining];
                conn.read_exact(&mut drain)?;
            }
            break;
        }

        let mut data = vec![0u8; data_len];
        conn.read_exact(&mut data)?;
        bytes_read += data_len;

        match tag {
            pasteboard_type::TEXT => {
                content.text = Some(String::from_utf8_lossy(&data).into_owned());
            }
            pasteboard_type::RTF => {
                content.rtf = Some(data);
            }
            pasteboard_type::HTML => {
                content.html = Some(String::from_utf8_lossy(&data).into_owned());
            }
            pasteboard_type::FILE => {
                content.file_url = Some(String::from_utf8_lossy(&data).into_owned());
            }
            _ => {
                log::debug!("Unknown pasteboard type: 0x{:08X}", tag);
            }
        }
    }

    // Drain any remaining bytes
    let remaining = total_len.saturating_sub(bytes_read);
    if remaining > 0 {
        let mut drain = vec![0u8; remaining];
        conn.read_exact(&mut drain)?;
    }

    Ok(content)
}

/// Send clipboard content to the server.
///
/// Uses standard RFB `ClientCutText` for plain text, and the Apple clipboard
/// extension for rich content (RTF, HTML, file URLs).
pub fn send_client_clipboard(
    conn: &mut RfbConnection,
    content: &ClipboardContent,
    supports_apple: bool,
) -> Result<(), ArdError> {
    if content.is_empty() {
        return Ok(());
    }

    // If we have only plain text or Apple extensions aren't supported,
    // use standard RFB ClientCutText
    let has_rich = content.rtf.is_some() || content.html.is_some() || content.file_url.is_some();

    if !has_rich || !supports_apple {
        if let Some(text) = &content.text {
            send_rfb_client_cut_text(conn, text)?;
        }
        return Ok(());
    }

    // Use Apple clipboard extension
    send_apple_clipboard_message(conn, content)?;
    Ok(())
}

/// Send standard RFB `ClientCutText` message (type 6).
pub fn send_rfb_client_cut_text(conn: &mut RfbConnection, text: &str) -> Result<(), ArdError> {
    let bytes = text.as_bytes();
    let mut msg = Vec::with_capacity(8 + bytes.len());

    // message-type: 6
    msg.push(rfb::client_msg::CLIENT_CUT_TEXT);
    // padding: 3 bytes
    msg.extend_from_slice(&[0u8; 3]);
    // length: u32
    msg.extend_from_slice(&(bytes.len() as u32).to_be_bytes());
    // text
    msg.extend_from_slice(bytes);

    conn.write_all(&msg)?;
    Ok(())
}

/// Send an Apple clipboard extension message.
///
/// The Apple clipboard extension piggybacks on `ClientCutText` (type 6)
/// with a special marker (`0xFF, 0xFF, 0xFF`) in the 3-byte padding field.
pub fn send_apple_clipboard_message(
    conn: &mut RfbConnection,
    content: &ClipboardContent,
) -> Result<(), ArdError> {
    // Build the pasteboard payload
    let mut payload = Vec::new();
    let mut num_types: u32 = 0;

    // Placeholder for num_types (we'll fill it in later)
    payload.extend_from_slice(&[0u8; 4]);

    if let Some(text) = &content.text {
        let data = text.as_bytes();
        payload.extend_from_slice(&pasteboard_type::TEXT.to_be_bytes());
        payload.extend_from_slice(&(data.len() as u32).to_be_bytes());
        payload.extend_from_slice(data);
        num_types += 1;
    }

    if let Some(rtf) = &content.rtf {
        payload.extend_from_slice(&pasteboard_type::RTF.to_be_bytes());
        payload.extend_from_slice(&(rtf.len() as u32).to_be_bytes());
        payload.extend_from_slice(rtf);
        num_types += 1;
    }

    if let Some(html) = &content.html {
        let data = html.as_bytes();
        payload.extend_from_slice(&pasteboard_type::HTML.to_be_bytes());
        payload.extend_from_slice(&(data.len() as u32).to_be_bytes());
        payload.extend_from_slice(data);
        num_types += 1;
    }

    if let Some(url) = &content.file_url {
        let data = url.as_bytes();
        payload.extend_from_slice(&pasteboard_type::FILE.to_be_bytes());
        payload.extend_from_slice(&(data.len() as u32).to_be_bytes());
        payload.extend_from_slice(data);
        num_types += 1;
    }

    // Fill in num_types
    payload[0..4].copy_from_slice(&num_types.to_be_bytes());

    // Build the full message
    let mut msg = Vec::with_capacity(8 + payload.len());

    // message-type: 6 (ClientCutText)
    msg.push(rfb::client_msg::CLIENT_CUT_TEXT);
    // Apple extension marker: 0xFF, 0xFF, 0xFF
    msg.extend_from_slice(&[0xFF, 0xFF, 0xFF]);
    // total payload length as u32
    msg.extend_from_slice(&(payload.len() as u32).to_be_bytes());
    // payload
    msg.extend_from_slice(&payload);

    conn.write_all(&msg)?;
    Ok(())
}

/// Check whether the negotiated encoding list includes the Apple clipboard.
pub fn supports_apple_clipboard(encodings: &[i32]) -> bool {
    encodings.contains(&APPLE_CLIPBOARD_ENCODING)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clipboard_content_plain() {
        let c = ClipboardContent::plain("hello");
        assert_eq!(c.text.as_deref(), Some("hello"));
        assert!(!c.is_empty());
    }

    #[test]
    fn clipboard_content_empty() {
        let c = ClipboardContent::default();
        assert!(c.is_empty());
    }

    #[test]
    fn pasteboard_tags() {
        // Verify tag values match expected 4CC codes
        assert_eq!(pasteboard_type::TEXT, 0x7574_7874); // "utxt"
        assert_eq!(pasteboard_type::RTF, 0x5254_4620); // "RTF "
        assert_eq!(pasteboard_type::HTML, 0x4854_4D4C); // "HTML"
        assert_eq!(pasteboard_type::FILE, 0x6675_726C); // "furl"
    }

    #[test]
    fn supports_apple_detection() {
        let with = vec![0, 1, rfb::encoding::APPLE_CLIPBOARD, 16];
        assert!(supports_apple_clipboard(&with));

        let without = vec![0, 1, 16];
        assert!(!supports_apple_clipboard(&without));
    }
}
