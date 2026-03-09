//! SPICE clipboard (copy-paste) channel via the main channel agent.

use serde::{Deserialize, Serialize};
use std::collections::VecDeque;

// ── Clipboard types ─────────────────────────────────────────────────────────

/// Clipboard data format, mirroring SPICE agent clipboard types.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum ClipboardFormat {
    /// Plain UTF-8 text.
    Text,
    /// Rich text (RTF).
    Rtf,
    /// HTML content.
    Html,
    /// PNG image.
    ImagePng,
    /// BMP image.
    ImageBmp,
    /// File list (URI / paths).
    FileList,
}

impl ClipboardFormat {
    /// Wire type id used in the SPICE agent clipboard protocol.
    pub fn wire_type(&self) -> u32 {
        match self {
            Self::Text => 1,
            Self::Rtf => 2,
            Self::Html => 3,
            Self::ImagePng => 4,
            Self::ImageBmp => 5,
            Self::FileList => 6,
        }
    }

    pub fn from_wire_type(t: u32) -> Option<Self> {
        match t {
            1 => Some(Self::Text),
            2 => Some(Self::Rtf),
            3 => Some(Self::Html),
            4 => Some(Self::ImagePng),
            5 => Some(Self::ImageBmp),
            6 => Some(Self::FileList),
            _ => None,
        }
    }
}

/// Direction of a clipboard operation.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ClipboardDirection {
    /// Guest → Client.
    GuestToClient,
    /// Client → Guest.
    ClientToGuest,
}

/// A clipboard grab — the source announces that it has new data.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClipboardGrab {
    pub formats: Vec<ClipboardFormat>,
    pub direction: Option<String>,
}

/// A clipboard request — the destination asks for data in a specific format.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClipboardRequest {
    pub format: ClipboardFormat,
}

/// Clipboard data payload.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClipboardData {
    pub format: ClipboardFormat,
    pub data: Vec<u8>,
}

impl ClipboardData {
    /// Convenience constructor for text.
    pub fn text(s: &str) -> Self {
        Self {
            format: ClipboardFormat::Text,
            data: s.as_bytes().to_vec(),
        }
    }

    /// Convenience constructor for HTML.
    pub fn html(s: &str) -> Self {
        Self {
            format: ClipboardFormat::Html,
            data: s.as_bytes().to_vec(),
        }
    }

    /// Try to interpret the payload as UTF-8 text.
    pub fn as_text(&self) -> Option<&str> {
        std::str::from_utf8(&self.data).ok()
    }
}

/// A clipboard release — the source no longer has data.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClipboardRelease;

// ── Clipboard Agent Messages ────────────────────────────────────────────────

/// SPICE agent clipboard message types.
pub mod agent_msg {
    /// Clipboard grab (VD_AGENT_CLIPBOARD_GRAB = 3).
    pub const CLIPBOARD_GRAB: u32 = 3;
    /// Clipboard request (VD_AGENT_CLIPBOARD_REQUEST = 4).
    pub const CLIPBOARD_REQUEST: u32 = 4;
    /// Clipboard data (VD_AGENT_CLIPBOARD = 5).
    pub const CLIPBOARD: u32 = 5;
    /// Clipboard release (VD_AGENT_CLIPBOARD_RELEASE = 6).
    pub const CLIPBOARD_RELEASE: u32 = 6;
}

// ── Clipboard Manager ───────────────────────────────────────────────────────

/// Manages clipboard state between client and guest.
#[derive(Debug)]
pub struct ClipboardManager {
    /// Whether clipboard sharing is enabled.
    enabled: bool,
    /// The formats the guest currently has.
    guest_formats: Vec<ClipboardFormat>,
    /// The formats the client currently has.
    client_formats: Vec<ClipboardFormat>,
    /// Pending outgoing messages waiting to be flushed.
    outgoing: VecDeque<ClipboardMessage>,
    /// Maximum clipboard payload size (bytes).
    max_size: usize,
}

/// Outgoing clipboard protocol message.
#[derive(Debug, Clone)]
pub enum ClipboardMessage {
    Grab(ClipboardGrab),
    Request(ClipboardRequest),
    Data(ClipboardData),
    Release,
}

impl ClipboardManager {
    pub fn new(enabled: bool) -> Self {
        Self {
            enabled,
            guest_formats: Vec::new(),
            client_formats: Vec::new(),
            outgoing: VecDeque::new(),
            max_size: 32 * 1024 * 1024, // 32 MiB default
        }
    }

    pub fn set_enabled(&mut self, enabled: bool) {
        self.enabled = enabled;
        if !enabled {
            self.guest_formats.clear();
            self.client_formats.clear();
            self.outgoing.clear();
        }
    }

    pub fn is_enabled(&self) -> bool {
        self.enabled
    }

    pub fn set_max_size(&mut self, max: usize) {
        self.max_size = max;
    }

    /// Guest announces it has new clipboard data.
    pub fn handle_guest_grab(&mut self, formats: Vec<ClipboardFormat>) {
        if !self.enabled {
            return;
        }
        self.guest_formats = formats;
    }

    /// Client announces it has new clipboard data.
    pub fn handle_client_grab(&mut self, formats: Vec<ClipboardFormat>) {
        if !self.enabled {
            return;
        }
        self.client_formats = formats.clone();
        self.outgoing
            .push_back(ClipboardMessage::Grab(ClipboardGrab {
                formats,
                direction: Some("client_to_guest".into()),
            }));
    }

    /// Guest requests clipboard data in a specific format.
    pub fn handle_guest_request(&mut self, format: ClipboardFormat) {
        if !self.enabled {
            return;
        }
        if self.client_formats.contains(&format) {
            self.outgoing
                .push_back(ClipboardMessage::Request(ClipboardRequest { format }));
        }
    }

    /// Client sends clipboard data to the guest.
    pub fn send_to_guest(&mut self, data: ClipboardData) -> Result<(), String> {
        if !self.enabled {
            return Err("clipboard sharing is disabled".into());
        }
        if data.data.len() > self.max_size {
            return Err(format!(
                "clipboard data exceeds max size ({} > {})",
                data.data.len(),
                self.max_size
            ));
        }
        self.outgoing.push_back(ClipboardMessage::Data(data));
        Ok(())
    }

    /// Handle guest release.
    pub fn handle_guest_release(&mut self) {
        self.guest_formats.clear();
    }

    /// Client releases clipboard.
    pub fn release_client(&mut self) {
        self.client_formats.clear();
        if self.enabled {
            self.outgoing.push_back(ClipboardMessage::Release);
        }
    }

    /// Drain all pending outgoing messages.
    pub fn drain_outgoing(&mut self) -> Vec<ClipboardMessage> {
        self.outgoing.drain(..).collect()
    }

    /// Get the formats the guest currently offers.
    pub fn guest_formats(&self) -> &[ClipboardFormat] {
        &self.guest_formats
    }

    /// Get the formats the client currently offers.
    pub fn client_formats(&self) -> &[ClipboardFormat] {
        &self.client_formats
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clipboard_format_roundtrip() {
        for fmt in [
            ClipboardFormat::Text,
            ClipboardFormat::Rtf,
            ClipboardFormat::Html,
            ClipboardFormat::ImagePng,
            ClipboardFormat::ImageBmp,
            ClipboardFormat::FileList,
        ] {
            assert_eq!(ClipboardFormat::from_wire_type(fmt.wire_type()), Some(fmt));
        }
        assert_eq!(ClipboardFormat::from_wire_type(999), None);
    }

    #[test]
    fn clipboard_data_text() {
        let d = ClipboardData::text("hello");
        assert_eq!(d.as_text(), Some("hello"));
        assert_eq!(d.format, ClipboardFormat::Text);
    }

    #[test]
    fn clipboard_manager_flow() {
        let mut mgr = ClipboardManager::new(true);

        // Client grab
        mgr.handle_client_grab(vec![ClipboardFormat::Text, ClipboardFormat::Html]);
        assert_eq!(mgr.client_formats().len(), 2);

        // Guest request
        mgr.handle_guest_request(ClipboardFormat::Text);

        // Send data
        mgr.send_to_guest(ClipboardData::text("hello world"))
            .unwrap();

        let msgs = mgr.drain_outgoing();
        assert_eq!(msgs.len(), 3); // grab + request + data
    }

    #[test]
    fn clipboard_disabled() {
        let mut mgr = ClipboardManager::new(false);
        mgr.handle_client_grab(vec![ClipboardFormat::Text]);
        assert!(mgr.client_formats().is_empty());
        assert!(mgr.drain_outgoing().is_empty());
    }

    #[test]
    fn clipboard_max_size() {
        let mut mgr = ClipboardManager::new(true);
        mgr.set_max_size(10);
        let result = mgr.send_to_guest(ClipboardData::text("this is way too long"));
        assert!(result.is_err());
    }
}
