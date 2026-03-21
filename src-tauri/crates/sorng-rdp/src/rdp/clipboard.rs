//! CLIPRDR clipboard backend for Tauri-based RDP sessions.
//!
//! Bridges the ironrdp-cliprdr static virtual channel to the frontend via
//! Tauri events and a shared state object.  Supports both text clipboard
//! (CF_UNICODETEXT) and file transfer (FileGroupDescriptorW / FileContents).

use std::sync::{Arc, Mutex};
use std::fmt;

use crate::ironrdp_cliprdr::backend::CliprdrBackend;
use crate::ironrdp_cliprdr::pdu::{
    ClipboardFormat, ClipboardFormatId, ClipboardGeneralCapabilityFlags, FileContentsRequest,
    FileContentsResponse, FormatDataRequest, FormatDataResponse, LockDataId,
    PackedFileList, FileDescriptor, ClipboardFileAttributes, OwnedFormatDataResponse,
};
use crate::ironrdp_core::impl_as_any;
use sorng_core::events::DynEventEmitter;

/// Standard Windows CF_UNICODETEXT format ID.
pub const CF_UNICODETEXT: u32 = 13;

/// Registered format ID used to advertise a file list (FileGroupDescriptorW).
/// This is a client-chosen ID in the registered range; the server uses whatever
/// ID we advertise in the format list.
pub const FILEGROUPDESCRIPTORW_ID: u32 = 0xC0A0;

/// A file staged for CLIPRDR file transfer.
#[derive(Debug, Clone)]
pub struct StagedFile {
    /// File name (max 259 chars for CLIPRDR).
    pub name: String,
    /// File size in bytes.
    pub size: u64,
    /// Local filesystem path for reading file content.
    pub path: String,
}

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
    /// Files staged for CLIPRDR file transfer.
    pub staged_files: Vec<StagedFile>,
    /// Pending `FileContentsRequest` from the server (needs response via
    /// `submit_file_contents` on the next loop iteration).
    pub pending_file_contents_request: Option<FileContentsRequest>,
    /// Total bytes transferred so far across all staged files.
    pub file_bytes_transferred: u64,
}

impl ClipboardState {
    pub fn new() -> Self {
        Self {
            local_text: None,
            remote_formats: Vec::new(),
            ready: false,
            pending_data_request: None,
            remote_text: None,
            staged_files: Vec::new(),
            pending_file_contents_request: None,
            file_bytes_transferred: 0,
        }
    }
}

pub type SharedClipboardState = Arc<Mutex<ClipboardState>>;

/// CLIPRDR backend that bridges clipboard events to the Tauri frontend.
pub struct AppCliprdrBackend {
    session_id: String,
    emitter: DynEventEmitter,
    state: SharedClipboardState,
    temp_dir: String,
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
        let temp_dir = std::env::temp_dir()
            .join("sorng-cliprdr")
            .to_string_lossy()
            .into_owned();
        // Ensure the directory exists
        let _ = std::fs::create_dir_all(&temp_dir);
        Self {
            session_id,
            emitter,
            state,
            temp_dir,
        }
    }
}

impl CliprdrBackend for AppCliprdrBackend {
    fn temporary_directory(&self) -> &str {
        &self.temp_dir
    }

    fn client_capabilities(&self) -> ClipboardGeneralCapabilityFlags {
        ClipboardGeneralCapabilityFlags::STREAM_FILECLIP_ENABLED
            | ClipboardGeneralCapabilityFlags::FILECLIP_NO_FILE_PATHS
            | ClipboardGeneralCapabilityFlags::HUGE_FILE_SUPPORT_ENABLED
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

    fn on_file_contents_request(&mut self, request: FileContentsRequest) {
        log::info!(
            "CLIPRDR session {}: file contents request idx={} flags={:?} pos={} size={}",
            self.session_id, request.index, request.flags, request.position, request.requested_size
        );
        if let Ok(mut state) = self.state.lock() {
            state.pending_file_contents_request = Some(request);
        }
    }

    fn on_file_contents_response(&mut self, _response: FileContentsResponse<'_>) {
        // Not used — we only send files, not receive them via CLIPRDR
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

/// Build a PackedFileList from staged files.
pub fn build_file_list(files: &[StagedFile]) -> PackedFileList {
    let descriptors: Vec<FileDescriptor> = files.iter().map(|f| FileDescriptor {
        attributes: Some(ClipboardFileAttributes::ARCHIVE),
        last_write_time: None,
        file_size: Some(f.size),
        name: f.name.clone(),
    }).collect();
    PackedFileList { files: descriptors }
}

/// Encode staged files into an OwnedFormatDataResponse containing a CLIPRDR_FILELIST.
pub fn encode_file_list_response(files: &[StagedFile]) -> OwnedFormatDataResponse {
    let list = build_file_list(files);
    match OwnedFormatDataResponse::new_file_list(&list) {
        Ok(resp) => resp,
        Err(e) => {
            log::error!("Failed to encode file list: {e}");
            OwnedFormatDataResponse::new_error()
        }
    }
}
