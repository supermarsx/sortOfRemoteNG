//! CLIPRDR clipboard backend for Tauri-based RDP sessions.
//!
//! Bridges the ironrdp-cliprdr static virtual channel to the frontend via
//! Tauri events and a shared state object.  Text clipboard (CF_UNICODETEXT)
//! is the primary supported format.

use std::sync::{Arc, Mutex};
use std::fmt;

use crate::ironrdp_cliprdr::backend::CliprdrBackend;
use crate::ironrdp_cliprdr::pdu::{
    ClipboardFormat, ClipboardFormatId, ClipboardGeneralCapabilityFlags, FileContentsRequest,
    FileContentsResponse, FormatDataRequest, FormatDataResponse, LockDataId,
};
use crate::ironrdp_core::impl_as_any;
use sorng_core::events::DynEventEmitter;

/// Standard Windows CF_UNICODETEXT format ID.
pub const CF_UNICODETEXT: u32 = 13;

/// Shared clipboard state accessible from both the backend callbacks (called
/// on the session thread during `ActiveStage::process()`) and the command
/// handling code (also on the session thread via `RdpCommand`).
#[derive(Debug)]
pub struct ClipboardState {
    /// Text the local user wants to paste into the remote session (UTF-8).
    pub local_text: Option<String>,
    /// Formats advertised by the remote after a copy operation.
    pub remote_formats: Vec<ClipboardFormat>,
    /// Whether the channel has completed initialization.
    pub ready: bool,
    /// Pending `FormatDataRequest` from the server (needs response via
    /// `submit_format_data` on the next loop iteration).
    pub pending_data_request: Option<FormatDataRequest>,
    /// Text received from the remote via `FormatDataResponse` (UTF-8).
    pub remote_text: Option<String>,
}

impl ClipboardState {
    pub fn new() -> Self {
        Self {
            local_text: None,
            remote_formats: Vec::new(),
            ready: false,
            pending_data_request: None,
            remote_text: None,
        }
    }
}

pub type SharedClipboardState = Arc<Mutex<ClipboardState>>;

/// CLIPRDR backend that bridges clipboard events to the Tauri frontend.
pub struct AppCliprdrBackend {
    session_id: String,
    emitter: DynEventEmitter,
    state: SharedClipboardState,
}

impl fmt::Debug for AppCliprdrBackend {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("AppCliprdrBackend")
            .field("session_id", &self.session_id)
            .finish_non_exhaustive()
    }
}

impl_as_any!(AppCliprdrBackend);

impl AppCliprdrBackend {
    pub fn new(session_id: String, emitter: DynEventEmitter, state: SharedClipboardState) -> Self {
        Self {
            session_id,
            emitter,
            state,
        }
    }
}

impl CliprdrBackend for AppCliprdrBackend {
    fn temporary_directory(&self) -> &str {
        // Not used for text-only clipboard; provide a dummy path.
        "."
    }

    fn client_capabilities(&self) -> ClipboardGeneralCapabilityFlags {
        ClipboardGeneralCapabilityFlags::empty()
    }

    fn on_ready(&mut self) {
        log::info!("CLIPRDR session {}: clipboard channel ready", self.session_id);
        if let Ok(mut state) = self.state.lock() {
            state.ready = true;
        }
        let _ = self.emitter.emit_event(
            "rdp://clipboard-ready",
            serde_json::json!({ "session_id": self.session_id }),
        );
    }

    fn on_process_negotiated_capabilities(&mut self, capabilities: ClipboardGeneralCapabilityFlags) {
        log::debug!(
            "CLIPRDR session {}: negotiated capabilities: {:?}",
            self.session_id,
            capabilities
        );
    }

    fn on_request_format_list(&mut self) {
        // Called during init. If we have local text, advertise CF_UNICODETEXT.
        // The session loop handles actually calling initiate_copy().
        log::debug!(
            "CLIPRDR session {}: format list requested (init phase)",
            self.session_id
        );
    }

    fn on_remote_copy(&mut self, available_formats: &[ClipboardFormat]) {
        log::info!(
            "CLIPRDR session {}: remote copied {} format(s)",
            self.session_id,
            available_formats.len()
        );
        if let Ok(mut state) = self.state.lock() {
            state.remote_formats = available_formats.to_vec();
        }

        // Check if CF_UNICODETEXT is among the available formats
        let has_text = available_formats
            .iter()
            .any(|f| f.id() == ClipboardFormatId::new(CF_UNICODETEXT));

        let _ = self.emitter.emit_event(
            "rdp://clipboard-formats",
            serde_json::json!({
                "session_id": self.session_id,
                "has_text": has_text,
                "format_count": available_formats.len(),
            }),
        );
    }

    fn on_format_data_request(&mut self, request: FormatDataRequest) {
        // Server wants data from our clipboard. Store the request so the
        // session loop can fulfil it on the next iteration via
        // `cliprdr.submit_format_data()`.
        log::info!(
            "CLIPRDR session {}: server requested format data ({:?})",
            self.session_id,
            request.format
        );
        if let Ok(mut state) = self.state.lock() {
            state.pending_data_request = Some(request);
        }
    }

    fn on_format_data_response(&mut self, response: FormatDataResponse<'_>) {
        if response.is_error() {
            log::warn!(
                "CLIPRDR session {}: received error format data response",
                self.session_id
            );
            return;
        }

        // Decode UTF-16LE to String
        let data = response.data();
        let text = decode_utf16le(data);

        log::info!(
            "CLIPRDR session {}: received clipboard text ({} chars)",
            self.session_id,
            text.len()
        );

        if let Ok(mut state) = self.state.lock() {
            state.remote_text = Some(text.clone());
        }

        let _ = self.emitter.emit_event(
            "rdp://clipboard-data",
            serde_json::json!({
                "session_id": self.session_id,
                "text": text,
            }),
        );
    }

    fn on_file_contents_request(&mut self, _request: FileContentsRequest) {
        // Not implemented — text-only clipboard
    }

    fn on_file_contents_response(&mut self, _response: FileContentsResponse<'_>) {
        // Not implemented — text-only clipboard
    }

    fn on_lock(&mut self, _data_id: LockDataId) {}
    fn on_unlock(&mut self, _data_id: LockDataId) {}
}

// ---- Helpers ----

/// Decode a null-terminated UTF-16LE byte slice to a Rust String.
fn decode_utf16le(data: &[u8]) -> String {
    let u16s: Vec<u16> = data
        .chunks_exact(2)
        .map(|pair| u16::from_le_bytes([pair[0], pair[1]]))
        .take_while(|&ch| ch != 0) // strip null terminator
        .collect();
    String::from_utf16_lossy(&u16s)
}

/// Encode a Rust &str to null-terminated UTF-16LE bytes (for CF_UNICODETEXT).
pub fn encode_utf16le(text: &str) -> Vec<u8> {
    let mut out: Vec<u8> = text
        .encode_utf16()
        .flat_map(|ch| ch.to_le_bytes())
        .collect();
    // Null terminator
    out.push(0);
    out.push(0);
    out
}
