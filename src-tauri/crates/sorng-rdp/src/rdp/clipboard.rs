//! CLIPRDR clipboard backend for Tauri-based RDP sessions.
//!
//! Bridges the ironrdp-cliprdr static virtual channel to the frontend via
//! Tauri events and a shared state object.  Supports both text clipboard
//! (CF_UNICODETEXT) and file transfer (FileGroupDescriptorW / FileContents).

use std::collections::VecDeque;
use std::fmt;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use super::session_state::ChannelSummary;
use super::settings::ClipboardDirection;
use super::virtual_channels::{
    VirtualChannelDescriptor, VirtualChannelKind, VirtualChannelPriority, VirtualChannelState,
};
use crate::ironrdp_cliprdr::backend::CliprdrBackend;
use crate::ironrdp_cliprdr::pdu::{
    ClipboardFileAttributes, ClipboardFormat, ClipboardFormatId, ClipboardGeneralCapabilityFlags,
    FileContentsRequest, FileContentsResponse, FileDescriptor, FormatDataRequest,
    FormatDataResponse, LockDataId, OwnedFormatDataResponse, PackedFileList,
};
use crate::ironrdp_core::impl_as_any;
use sorng_core::events::DynEventEmitter;

/// Standard Windows CF_UNICODETEXT format ID.
pub const CF_UNICODETEXT: u32 = 13;

/// Registered format ID used to advertise a file list (FileGroupDescriptorW).
/// This is a client-chosen ID in the registered range; the server uses whatever
/// ID we advertise in the format list.
pub const FILEGROUPDESCRIPTORW_ID: u32 = 0xC0A0;

const CLIPRDR_CHANNEL_NAME: &str = "cliprdr";
const CHANNEL_FAULT_CLASS: &str = "channel_fault";
const FORMAT_DATA_ERROR_CLASS: &str = "format_data_error";
const FILE_CONTENTS_ERROR_CLASS: &str = "file_contents_error";
const PROTOCOL_VIOLATION_CLASS: &str = "protocol_violation";
const REACTIVATION_FAULT_CLASS: &str = "reactivation_fault";
const MAX_PENDING_CLIPBOARD_REQUESTS: usize = 64;

/// Publication receipt, never a claim that a remote application pasted text.
pub struct ClipboardPublication {
    pub text: String,
    reply: Option<tokio::sync::oneshot::Sender<Result<(), String>>>,
    deadline: Instant,
    published: bool,
}
impl fmt::Debug for ClipboardPublication {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("ClipboardPublication")
            .finish_non_exhaustive()
    }
}
impl ClipboardPublication {
    pub fn new(text: String, reply: tokio::sync::oneshot::Sender<Result<(), String>>) -> Self {
        Self {
            text,
            reply: Some(reply),
            deadline: Instant::now() + Duration::from_secs(5),
            published: false,
        }
    }
    fn cancelled(&self) -> bool {
        Instant::now() >= self.deadline || self.reply.as_ref().is_none_or(|reply| reply.is_closed())
    }
    pub fn fail(mut self, message: &str) {
        if let Some(reply) = self.reply.take() {
            let _ = reply.send(Err(message.into()));
        }
    }
}
impl Drop for ClipboardPublication {
    fn drop(&mut self) {
        if let Some(reply) = self.reply.take() {
            let _ = reply.send(Err(
                "Clipboard publication cancelled with its connection attempt.".into(),
            ));
        }
    }
}

#[derive(Debug, Clone)]
pub struct ClipboardOffer {
    pub text: Option<String>,
    pub files: Vec<StagedFile>,
    pub epoch: u64,
}
#[derive(Debug)]
pub struct PendingClipboardData {
    pub request: FormatDataRequest,
    pub offer: Arc<ClipboardOffer>,
}
#[derive(Debug)]
pub struct PendingClipboardFile {
    pub request: FileContentsRequest,
    pub offer: Arc<ClipboardOffer>,
}

pub fn format_data_response(
    pending: &PendingClipboardData,
    allowed: bool,
) -> OwnedFormatDataResponse {
    if allowed && pending.request.format == ClipboardFormatId::new(CF_UNICODETEXT) {
        if let Some(text) = &pending.offer.text {
            return OwnedFormatDataResponse::new_data(encode_utf16le(text));
        }
    }
    if allowed
        && pending.request.format == ClipboardFormatId::new(FILEGROUPDESCRIPTORW_ID)
        && !pending.offer.files.is_empty()
    {
        return encode_file_list_response(&pending.offer.files);
    }
    OwnedFormatDataResponse::new_error()
}

/// A file staged for CLIPRDR file transfer.
#[derive(Debug, Clone)]
pub struct StagedFile {
    /// File name (max 259 chars for CLIPRDR), may contain backslash path separators.
    pub name: String,
    /// File size in bytes (0 for directories).
    pub size: u64,
    /// Local filesystem path for reading file content (empty for directories).
    pub path: String,
    /// Whether this entry is a directory.
    pub is_directory: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipboardFormatListCounters {
    pub format_list_requests_received: u64,
    pub remote_format_lists_received: u64,
    pub remote_format_lists_blocked: u64,
    pub last_remote_format_count: u64,
    pub format_data_requests_received: u64,
    pub format_data_requests_blocked: u64,
    pub format_data_responses_received: u64,
    pub format_data_response_errors: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipboardFileTransferCounters {
    pub staged_file_count: u64,
    pub staged_directory_count: u64,
    pub staged_total_bytes: u64,
    pub file_bytes_transferred: u64,
    pub file_contents_requests_received: u64,
    pub file_contents_requests_blocked: u64,
    pub file_contents_responses_received: u64,
    pub file_transfer_errors: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipboardDiagnostics {
    pub channel: VirtualChannelDescriptor,
    pub channel_summary: ChannelSummary,
    pub direction: ClipboardDirection,
    pub ready: bool,
    pub suspended_for_reactivation: bool,
    pub reactivation_count: u64,
    pub format_lists: ClipboardFormatListCounters,
    pub file_transfer: ClipboardFileTransferCounters,
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
    pub pending_data_request: VecDeque<PendingClipboardData>,
    /// Text received from the remote via `FormatDataResponse` (UTF-8).
    pub remote_text: Option<String>,
    /// Files staged for CLIPRDR file transfer.
    pub staged_files: Vec<StagedFile>,
    /// Pending `FileContentsRequest` from the server (needs response via
    /// `submit_file_contents` on the next loop iteration).
    pub pending_file_contents_request: VecDeque<PendingClipboardFile>,
    /// Total bytes transferred so far across all staged files.
    pub file_bytes_transferred: u64,
    /// When true, clipboard operations are suppressed (runtime toggle).
    pub disabled: bool,
    /// Session-level clipboard direction policy.
    pub direction: ClipboardDirection,
    pub advertisement_pending: bool,
    pub format_list_requested: bool,
    pub remote_generation: u64,
    remote_request: Option<u64>,
    remote_request_started: Option<Instant>,
    pub reconnect_required: bool,
    remote_paste_pending: bool,
    publication: Option<ClipboardPublication>,
    offer_snapshot: Option<Arc<ClipboardOffer>>,
    pub offer_epoch: u64,
    /// True while the active session is between DeactivateAll and reactivation.
    pub suspended_for_reactivation: bool,
    /// Number of reactivation cycles observed by the runner.
    pub reactivation_count: u64,
    /// Sanitized class for the most recent CLIPRDR fault, if any.
    pub last_fault_class: Option<String>,
    /// Server requests for our local format list.
    pub format_list_requests_received: u64,
    /// Remote format lists received after server-side copy operations.
    pub remote_format_lists_received: u64,
    /// Remote format lists ignored by direction/runtime policy.
    pub remote_format_lists_blocked: u64,
    /// Number of formats in the most recent remote format list.
    pub last_remote_format_count: u64,
    /// Server requests for local clipboard payload data.
    pub format_data_requests_received: u64,
    /// Local data requests rejected by direction/runtime policy.
    pub format_data_requests_blocked: u64,
    /// Remote payload responses received after local paste requests.
    pub format_data_responses_received: u64,
    /// Error responses received after local paste requests.
    pub format_data_response_errors: u64,
    /// Server requests for staged local file contents.
    pub file_contents_requests_received: u64,
    /// File contents requests rejected by direction/runtime policy.
    pub file_contents_requests_blocked: u64,
    /// File contents responses observed from the remote side.
    pub file_contents_responses_received: u64,
    /// Sanitized count of CLIPRDR file-transfer failures.
    pub file_transfer_errors: u64,
}

impl Default for ClipboardState {
    fn default() -> Self {
        Self::new(ClipboardDirection::default())
    }
}

impl ClipboardState {
    pub fn stage_text(&mut self, text: String) -> bool {
        if !self.apply_local_advertisement_policy() {
            return false;
        }
        if let Some(old) = self.publication.take() {
            old.fail("Clipboard publication was superseded.");
        }
        self.local_text = Some(text);
        self.staged_files.clear();
        self.offer_snapshot = None;
        self.advertisement_pending = true;
        true
    }
    pub fn stage_files(&mut self, files: Vec<StagedFile>) {
        if !self.apply_local_advertisement_policy() {
            return;
        }
        if let Some(request) = self.publication.take() {
            request.fail("Clipboard publication was superseded.");
        }
        self.local_text = None;
        self.staged_files = files;
        self.offer_snapshot = None;
        self.file_bytes_transferred = 0;
        self.advertisement_pending = true;
    }
    pub fn queue_publication(&mut self, mut request: ClipboardPublication) {
        if request.cancelled() {
            request.fail("Clipboard publication expired before sending.");
            return;
        }
        if !self.allows_client_to_server() {
            request.fail("Local-to-remote clipboard is disabled by direction policy.");
            return;
        }
        if self.publication.is_some() {
            request.fail("Another clipboard publication is still pending.");
            return;
        }
        self.stage_text(std::mem::take(&mut request.text));
        self.publication = Some(request);
    }
    pub fn set_policy(&mut self, enabled: bool, direction: ClipboardDirection) {
        if self.reconnect_required {
            return;
        }
        if self.disabled == !enabled && self.direction == direction {
            return;
        }
        self.disabled = !enabled;
        self.direction = direction;
        self.remote_generation = self.remote_generation.saturating_add(1);
        self.remote_paste_pending = false;
        self.remote_text = None;
        if !self.allows_client_to_server() {
            self.clear_local_clipboard_offer();
            if let Some(request) = self.publication.take() {
                request.fail("Clipboard publication cancelled by direction policy.");
            }
            self.advertisement_pending = true;
        }
    }
    pub fn request_initial_formats(&mut self) {
        self.format_list_requested = true;
        self.advertisement_pending = true;
    }
    pub fn next_advertisement(&mut self) -> Option<Vec<ClipboardFormat>> {
        if self
            .publication
            .as_ref()
            .is_some_and(ClipboardPublication::cancelled)
        {
            let request = self.publication.take().unwrap();
            let published = request.published;
            request.fail(if published {
                "Clipboard publication confirmation expired; delivery may have occurred."
            } else {
                "Clipboard publication expired before sending."
            });
            self.clear_local_clipboard_offer();
            self.advertisement_pending = true;
        }
        if !self.advertisement_pending
            || (!self.format_list_requested && !self.ready)
            || self.suspended_for_reactivation
        {
            return None;
        }
        let formats = if !self.allows_client_to_server() {
            Vec::new()
        } else if !self.staged_files.is_empty() {
            vec![
                ClipboardFormat::new(ClipboardFormatId::new(FILEGROUPDESCRIPTORW_ID))
                    .with_name(crate::ironrdp_cliprdr::pdu::ClipboardFormatName::FILE_LIST),
            ]
        } else if self.local_text.is_some() {
            vec![ClipboardFormat::new(ClipboardFormatId::new(CF_UNICODETEXT))]
        } else {
            Vec::new()
        };
        Some(formats)
    }
    pub fn advertisement_written(&mut self) {
        self.advertisement_pending = false;
        if let Some(request) = &mut self.publication {
            request.published = true;
        }
        self.complete_publication();
    }
    fn complete_publication(&mut self) {
        if self.ready
            && self
                .publication
                .as_ref()
                .is_some_and(|request| request.published && !request.cancelled())
        {
            if let Some(mut request) = self.publication.take() {
                if let Some(reply) = request.reply.take() {
                    let _ = reply.send(Ok(()));
                }
            }
        }
    }
    pub fn publication_failed(&mut self) {
        self.mark_faulted(CHANNEL_FAULT_CLASS);
        self.disabled = true;
        self.remote_generation = self.remote_generation.saturating_add(1);
        self.remote_text = None;
        self.clear_local_clipboard_offer();
        self.advertisement_pending = false;
        if let Some(request) = self.publication.take() {
            request.fail("Clipboard transport failed; delivery may have occurred. Reconnect before retrying.");
        }
    }
    pub fn request_remote_text(&mut self) {
        if self.allows_server_to_client() && self.remote_request != Some(self.remote_generation) {
            self.remote_paste_pending = true;
        }
    }
    pub fn begin_remote_text(&mut self) -> bool {
        if !self.remote_paste_pending
            || self.remote_request.is_some()
            || !self.ready
            || self.suspended_for_reactivation
            || !self.allows_server_to_client()
            || !self
                .remote_formats
                .iter()
                .any(|format| format.id() == ClipboardFormatId::new(CF_UNICODETEXT))
        {
            return false;
        }
        self.remote_request = Some(self.remote_generation);
        self.remote_request_started = Some(Instant::now());
        self.remote_paste_pending = false;
        true
    }
    pub fn remote_request_failed(&mut self) {
        self.remote_request = None;
        self.remote_request_started = None;
    }
    pub fn remote_response_expired(&mut self) -> bool {
        if !self.reconnect_required
            && self
                .remote_request_started
                .is_some_and(|started| started.elapsed() >= Duration::from_secs(5))
        {
            self.reconnect_required = true;
            self.publication_failed();
            return true;
        }
        false
    }
    fn accept_remote_response(&mut self) -> bool {
        self.remote_request_started = None;
        self.remote_request.take() == Some(self.remote_generation)
            && self.allows_server_to_client()
            && !self.suspended_for_reactivation
    }
    pub fn new(direction: ClipboardDirection) -> Self {
        Self {
            local_text: None,
            remote_formats: Vec::new(),
            ready: false,
            pending_data_request: VecDeque::new(),
            remote_text: None,
            staged_files: Vec::new(),
            pending_file_contents_request: VecDeque::new(),
            file_bytes_transferred: 0,
            disabled: false,
            direction,
            advertisement_pending: false,
            format_list_requested: false,
            remote_generation: 0,
            remote_request: None,
            remote_request_started: None,
            reconnect_required: false,
            remote_paste_pending: false,
            publication: None,
            offer_snapshot: None,
            offer_epoch: 0,
            suspended_for_reactivation: false,
            reactivation_count: 0,
            last_fault_class: None,
            format_list_requests_received: 0,
            remote_format_lists_received: 0,
            remote_format_lists_blocked: 0,
            last_remote_format_count: 0,
            format_data_requests_received: 0,
            format_data_requests_blocked: 0,
            format_data_responses_received: 0,
            format_data_response_errors: 0,
            file_contents_requests_received: 0,
            file_contents_requests_blocked: 0,
            file_contents_responses_received: 0,
            file_transfer_errors: 0,
        }
    }

    pub fn mark_ready(&mut self) {
        self.ready = true;
        self.suspended_for_reactivation = false;
        self.last_fault_class = None;
        self.complete_publication();
    }

    pub fn mark_suspended_for_reactivation(&mut self) {
        self.suspended_for_reactivation = true;
        self.remote_generation = self.remote_generation.saturating_add(1);
        self.remote_paste_pending = false;
        self.remote_text = None;
        if let Some(request) = self.publication.take() {
            request.fail("Clipboard publication cancelled by session reactivation.");
            self.clear_local_clipboard_offer();
            self.advertisement_pending = true;
        }
    }

    pub fn mark_reactivated(&mut self) {
        self.ready = true;
        self.suspended_for_reactivation = false;
        self.reactivation_count = self.reactivation_count.saturating_add(1);
        self.last_fault_class = None;
    }

    pub fn mark_faulted(&mut self, fault_class: &str) {
        self.last_fault_class = Some(normalize_fault_class(fault_class));
    }

    pub fn record_file_transfer_error(&mut self) {
        self.file_transfer_errors = self.file_transfer_errors.saturating_add(1);
        self.mark_faulted(FILE_CONTENTS_ERROR_CLASS);
    }

    pub fn channel_descriptor(&self) -> VirtualChannelDescriptor {
        let mut descriptor = VirtualChannelDescriptor::new(
            CLIPRDR_CHANNEL_NAME,
            VirtualChannelKind::Static,
            VirtualChannelPriority::Normal,
            self.cliprdr_enabled_for_diagnostics(),
        );
        descriptor.state = self.virtual_channel_state();
        descriptor.messages_received = self
            .format_list_requests_received
            .saturating_add(self.remote_format_lists_received)
            .saturating_add(self.format_data_requests_received)
            .saturating_add(self.format_data_responses_received)
            .saturating_add(self.file_contents_requests_received)
            .saturating_add(self.file_contents_responses_received);
        descriptor.last_error_class = self.last_fault_class.clone();
        descriptor
    }

    pub fn channel_summary(&self) -> ChannelSummary {
        let state = self.virtual_channel_state();
        ChannelSummary {
            enabled_count: u16::from(state.is_enabled()),
            ready_count: u16::from(state.is_ready()),
            failed_count: u16::from(state.is_failed()),
        }
    }

    pub fn diagnostics(&self) -> ClipboardDiagnostics {
        ClipboardDiagnostics {
            channel: self.channel_descriptor(),
            channel_summary: self.channel_summary(),
            direction: self.direction,
            ready: self.ready,
            suspended_for_reactivation: self.suspended_for_reactivation,
            reactivation_count: self.reactivation_count,
            format_lists: ClipboardFormatListCounters {
                format_list_requests_received: self.format_list_requests_received,
                remote_format_lists_received: self.remote_format_lists_received,
                remote_format_lists_blocked: self.remote_format_lists_blocked,
                last_remote_format_count: self.last_remote_format_count,
                format_data_requests_received: self.format_data_requests_received,
                format_data_requests_blocked: self.format_data_requests_blocked,
                format_data_responses_received: self.format_data_responses_received,
                format_data_response_errors: self.format_data_response_errors,
            },
            file_transfer: ClipboardFileTransferCounters {
                staged_file_count: self.staged_file_count(),
                staged_directory_count: self.staged_directory_count(),
                staged_total_bytes: self.staged_total_bytes(),
                file_bytes_transferred: self.file_bytes_transferred,
                file_contents_requests_received: self.file_contents_requests_received,
                file_contents_requests_blocked: self.file_contents_requests_blocked,
                file_contents_responses_received: self.file_contents_responses_received,
                file_transfer_errors: self.file_transfer_errors,
            },
        }
    }

    pub fn apply_local_advertisement_policy(&mut self) -> bool {
        let allowed = self.allows_client_to_server();
        if !allowed {
            self.clear_local_clipboard_offer();
        }

        allowed
    }

    pub fn store_remote_formats(&mut self, available_formats: &[ClipboardFormat]) -> bool {
        self.remote_generation = self.remote_generation.saturating_add(1);
        self.remote_text = None;
        if self.remote_request.is_some() {
            self.remote_paste_pending = true;
        }
        self.remote_format_lists_received = self.remote_format_lists_received.saturating_add(1);
        self.last_remote_format_count = available_formats.len() as u64;

        if !self.allows_server_to_client() {
            self.remote_format_lists_blocked = self.remote_format_lists_blocked.saturating_add(1);
            self.clear_remote_clipboard_snapshot();
            return false;
        }

        self.remote_formats = available_formats.to_vec();
        true
    }

    pub fn queue_format_data_request(&mut self, request: FormatDataRequest) -> bool {
        self.format_data_requests_received = self.format_data_requests_received.saturating_add(1);
        let allowed = self.apply_local_advertisement_policy();
        if !allowed {
            self.format_data_requests_blocked = self.format_data_requests_blocked.saturating_add(1);
        }
        if self.pending_data_request.len() < MAX_PENDING_CLIPBOARD_REQUESTS {
            let offer = self
                .offer_snapshot
                .get_or_insert_with(|| {
                    Arc::new(ClipboardOffer {
                        text: self.local_text.clone(),
                        files: self.staged_files.clone(),
                        epoch: self.offer_epoch,
                    })
                })
                .clone();
            self.pending_data_request
                .push_back(PendingClipboardData { request, offer });
        } else {
            self.publication_failed();
        }
        allowed
    }

    pub fn queue_file_contents_request(&mut self, request: FileContentsRequest) -> bool {
        self.file_contents_requests_received =
            self.file_contents_requests_received.saturating_add(1);
        let allowed = self.apply_local_advertisement_policy();
        if !allowed {
            self.file_contents_requests_blocked =
                self.file_contents_requests_blocked.saturating_add(1);
        }
        if self.pending_file_contents_request.len() < MAX_PENDING_CLIPBOARD_REQUESTS {
            let offer = self
                .offer_snapshot
                .get_or_insert_with(|| {
                    Arc::new(ClipboardOffer {
                        text: self.local_text.clone(),
                        files: self.staged_files.clone(),
                        epoch: self.offer_epoch,
                    })
                })
                .clone();
            self.pending_file_contents_request
                .push_back(PendingClipboardFile { request, offer });
        } else {
            self.publication_failed();
        }
        allowed
    }

    pub fn allows_client_to_server(&self) -> bool {
        !self.disabled && !self.reconnect_required && self.direction.allows_client_to_server()
    }

    pub fn allows_server_to_client(&self) -> bool {
        !self.disabled && !self.reconnect_required && self.direction.allows_server_to_client()
    }

    fn clear_local_clipboard_offer(&mut self) {
        self.offer_epoch = self.offer_epoch.saturating_add(1);
        self.offer_snapshot = None;
        self.local_text = None;
        self.staged_files.clear();
        self.file_bytes_transferred = 0;
    }

    fn clear_remote_clipboard_snapshot(&mut self) {
        self.remote_formats.clear();
        self.remote_text = None;
    }

    fn cliprdr_enabled_for_diagnostics(&self) -> bool {
        !self.disabled && self.direction != ClipboardDirection::Disabled
    }

    fn virtual_channel_state(&self) -> VirtualChannelState {
        if !self.cliprdr_enabled_for_diagnostics() {
            VirtualChannelState::Disabled
        } else if self.last_fault_class.is_some() {
            VirtualChannelState::Faulted
        } else if self.suspended_for_reactivation {
            VirtualChannelState::Suspended
        } else if self.ready {
            VirtualChannelState::Ready
        } else {
            VirtualChannelState::Registered
        }
    }

    fn record_format_list_request(&mut self) {
        self.format_list_requests_received = self.format_list_requests_received.saturating_add(1);
    }

    fn record_format_data_response(&mut self, is_error: bool) {
        self.format_data_responses_received = self.format_data_responses_received.saturating_add(1);
        if is_error {
            self.format_data_response_errors = self.format_data_response_errors.saturating_add(1);
            self.mark_faulted(FORMAT_DATA_ERROR_CLASS);
        }
    }

    fn record_file_contents_response(&mut self) {
        self.file_contents_responses_received =
            self.file_contents_responses_received.saturating_add(1);
    }

    fn staged_file_count(&self) -> u64 {
        self.staged_files
            .iter()
            .filter(|file| !file.is_directory)
            .count() as u64
    }

    fn staged_directory_count(&self) -> u64 {
        self.staged_files
            .iter()
            .filter(|file| file.is_directory)
            .count() as u64
    }

    fn staged_total_bytes(&self) -> u64 {
        self.staged_files.iter().map(|file| file.size).sum()
    }
}

fn normalize_fault_class(fault_class: &str) -> String {
    match fault_class {
        FORMAT_DATA_ERROR_CLASS
        | FILE_CONTENTS_ERROR_CLASS
        | PROTOCOL_VIOLATION_CLASS
        | REACTIVATION_FAULT_CLASS
        | CHANNEL_FAULT_CLASS => fault_class.to_string(),
        _ => CHANNEL_FAULT_CLASS.to_string(),
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
        log::info!(
            "CLIPRDR session {}: clipboard channel ready",
            self.session_id
        );
        if let Ok(mut state) = self.state.lock() {
            state.mark_ready();
        }
        let _ = self.emitter.emit_event(
            "rdp://clipboard-ready",
            serde_json::json!({ "session_id": self.session_id }),
        );
    }

    fn on_process_negotiated_capabilities(
        &mut self,
        capabilities: ClipboardGeneralCapabilityFlags,
    ) {
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

        if let Ok(mut state) = self.state.lock() {
            state.record_format_list_request();
            state.request_initial_formats();
            if !state.apply_local_advertisement_policy() {
                log::info!(
                    "CLIPRDR session {}: suppressing local clipboard advertisement due to direction policy",
                    self.session_id
                );
            }
        }
    }

    fn on_remote_copy(&mut self, available_formats: &[ClipboardFormat]) {
        log::info!(
            "CLIPRDR session {}: remote copied {} format(s)",
            self.session_id,
            available_formats.len()
        );
        let generation = if let Ok(mut state) = self.state.lock() {
            state
                .store_remote_formats(available_formats)
                .then_some(state.remote_generation)
        } else {
            None
        };

        let Some(generation) = generation else {
            log::info!(
                "CLIPRDR session {}: ignoring remote clipboard formats due to direction policy",
                self.session_id
            );
            return;
        };

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
                "generation": generation,
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
            let allowed = state.queue_format_data_request(request);
            if !allowed {
                log::info!(
                    "CLIPRDR session {}: rejecting local clipboard data request due to direction policy",
                    self.session_id
                );
            }
        }
    }

    fn on_format_data_response(&mut self, response: FormatDataResponse<'_>) {
        if response.is_error() {
            if let Ok(mut state) = self.state.lock() {
                state.record_format_data_response(true);
                state.accept_remote_response();
                state.remote_text = None;
            }
            log::warn!(
                "CLIPRDR session {}: received error format data response",
                self.session_id
            );
            return;
        }

        let generation = self
            .state
            .lock()
            .map(|mut state| {
                let allowed = state.accept_remote_response();
                state.record_format_data_response(false);
                if !allowed {
                    state.remote_text = None;
                }
                allowed.then_some(state.remote_generation)
            })
            .ok()
            .flatten();

        let Some(generation) = generation else {
            log::info!(
                "CLIPRDR session {}: dropping clipboard data response due to direction policy",
                self.session_id
            );
            return;
        };

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
                "generation": generation,
            }),
        );
    }

    fn on_file_contents_request(&mut self, request: FileContentsRequest) {
        log::info!(
            "CLIPRDR session {}: file contents request idx={} flags={:?} pos={} size={}",
            self.session_id,
            request.index,
            request.flags,
            request.position,
            request.requested_size
        );
        if let Ok(mut state) = self.state.lock() {
            let allowed = state.queue_file_contents_request(request);
            if !allowed {
                log::info!(
                    "CLIPRDR session {}: rejecting local clipboard file request due to direction policy",
                    self.session_id
                );
            }
        }
    }

    fn on_file_contents_response(&mut self, _response: FileContentsResponse<'_>) {
        if let Ok(mut state) = self.state.lock() {
            state.record_file_contents_response();
        }
        // Not used — we only send files, not receive them via CLIPRDR
    }

    fn on_lock(&mut self, _data_id: LockDataId) {}
    fn on_unlock(&mut self, _data_id: LockDataId) {}
}

// ---- Helpers ----

/// Decode a null-terminated UTF-16LE byte slice to a Rust String.
fn decode_utf16le(data: &[u8]) -> String {
    // Trailing odd byte is ignored, exactly as `chunks_exact(2)` did.
    let (pairs, _) = data.as_chunks::<2>();
    let u16s: Vec<u16> = pairs
        .iter()
        .copied()
        .map(u16::from_le_bytes)
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
    let descriptors: Vec<FileDescriptor> = files
        .iter()
        .map(|f| FileDescriptor {
            attributes: Some(if f.is_directory {
                ClipboardFileAttributes::DIRECTORY
            } else {
                ClipboardFileAttributes::ARCHIVE
            }),
            last_write_time: None,
            file_size: Some(f.size),
            name: f.name.clone(),
        })
        .collect();
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ironrdp_cliprdr::pdu::FileContentsFlags;

    fn sample_format() -> ClipboardFormat {
        ClipboardFormat::new(ClipboardFormatId::new(CF_UNICODETEXT))
    }

    fn sample_format_request() -> FormatDataRequest {
        FormatDataRequest {
            format: ClipboardFormatId::new(CF_UNICODETEXT),
        }
    }

    fn sample_file_request() -> FileContentsRequest {
        FileContentsRequest {
            stream_id: 7,
            index: 0,
            flags: FileContentsFlags::empty(),
            position: 0,
            requested_size: 64,
            data_id: None,
        }
    }

    fn staged_file() -> StagedFile {
        StagedFile {
            name: "example.txt".to_string(),
            size: 12,
            path: "C:/tmp/example.txt".to_string(),
            is_directory: false,
        }
    }

    fn assert_no_path_markers(encoded: &str) {
        for marker in [
            "C:/tmp/example.txt",
            "C:\\Users\\Alice\\secret.txt",
            "example.txt",
            "secret.txt",
            "Alice",
        ] {
            assert!(
                !encoded.contains(marker),
                "path marker {marker:?} leaked in {encoded}"
            );
        }
    }

    fn populated_state(direction: ClipboardDirection) -> ClipboardState {
        let mut state = ClipboardState::new(direction);
        state.local_text = Some("local".to_string());
        state.remote_text = Some("remote".to_string());
        state.remote_formats = vec![sample_format()];
        state.staged_files = vec![staged_file()];
        state.file_bytes_transferred = 12;
        state
    }

    #[test]
    fn clipboard_state_honors_direction_policy() {
        let mut state = ClipboardState::new(ClipboardDirection::ServerToClient);

        assert!(!state.allows_client_to_server());
        assert!(state.allows_server_to_client());

        state.disabled = true;

        assert!(!state.allows_client_to_server());
        assert!(!state.allows_server_to_client());
    }

    #[test]
    fn clipboard_state_default_is_bidirectional() {
        let state = ClipboardState::default();

        assert!(state.allows_client_to_server());
        assert!(state.allows_server_to_client());
    }

    #[test]
    fn clipboard_diagnostics_summarize_counts_without_paths() {
        let mut state = ClipboardState::new(ClipboardDirection::Bidirectional);
        state.mark_ready();
        state.staged_files = vec![
            staged_file(),
            StagedFile {
                name: "secret.txt".to_string(),
                size: 24,
                path: "C:\\Users\\Alice\\secret.txt".to_string(),
                is_directory: false,
            },
        ];
        state.file_bytes_transferred = 12;
        state.record_format_list_request();
        assert!(state.store_remote_formats(&[sample_format()]));
        assert!(state.queue_format_data_request(sample_format_request()));
        state.record_format_data_response(false);
        assert!(state.queue_file_contents_request(sample_file_request()));
        state.record_file_contents_response();

        let diagnostics = state.diagnostics();
        let encoded = serde_json::to_string(&diagnostics).expect("clipboard diagnostics json");

        assert_eq!(diagnostics.channel.state, VirtualChannelState::Ready);
        assert_eq!(diagnostics.channel_summary.enabled_count, 1);
        assert_eq!(diagnostics.channel_summary.ready_count, 1);
        assert_eq!(diagnostics.channel_summary.failed_count, 0);
        assert_eq!(diagnostics.format_lists.format_list_requests_received, 1);
        assert_eq!(diagnostics.format_lists.remote_format_lists_received, 1);
        assert_eq!(diagnostics.format_lists.last_remote_format_count, 1);
        assert_eq!(diagnostics.file_transfer.staged_file_count, 2);
        assert_eq!(diagnostics.file_transfer.staged_total_bytes, 36);
        assert_eq!(diagnostics.file_transfer.file_bytes_transferred, 12);
        assert_no_path_markers(&encoded);
    }

    #[test]
    fn clipboard_reactivation_hooks_suspend_and_restore_channel_readiness() {
        let mut state = ClipboardState::new(ClipboardDirection::Bidirectional);
        state.mark_ready();

        state.mark_suspended_for_reactivation();

        assert_eq!(
            state.channel_descriptor().state,
            VirtualChannelState::Suspended
        );
        assert_eq!(state.channel_summary().enabled_count, 1);
        assert_eq!(state.channel_summary().ready_count, 0);
        assert_eq!(state.reactivation_count, 0);

        state.mark_reactivated();

        assert_eq!(state.channel_descriptor().state, VirtualChannelState::Ready);
        assert_eq!(state.channel_summary().ready_count, 1);
        assert_eq!(state.reactivation_count, 1);
    }

    #[test]
    fn clipboard_fault_summary_uses_sanitized_classes_only() {
        let mut state = ClipboardState::new(ClipboardDirection::Bidirectional);
        state.mark_ready();

        state.mark_faulted("C:\\Users\\Alice\\secret.txt");

        let diagnostics = state.diagnostics();
        let encoded = serde_json::to_string(&diagnostics).expect("clipboard diagnostics json");

        assert_eq!(diagnostics.channel.state, VirtualChannelState::Faulted);
        assert_eq!(diagnostics.channel_summary.failed_count, 1);
        assert_eq!(
            diagnostics.channel.last_error_class.as_deref(),
            Some(CHANNEL_FAULT_CLASS)
        );
        assert_no_path_markers(&encoded);

        state.mark_faulted(FORMAT_DATA_ERROR_CLASS);
        assert_eq!(
            state.channel_descriptor().last_error_class.as_deref(),
            Some(FORMAT_DATA_ERROR_CLASS)
        );
    }

    #[test]
    fn clipboard_direction_bidirectional_keeps_clipboard_flows_available() {
        let mut state = populated_state(ClipboardDirection::Bidirectional);

        assert!(state.apply_local_advertisement_policy());
        assert_eq!(state.local_text.as_deref(), Some("local"));
        assert_eq!(state.staged_files.len(), 1);

        assert!(state.store_remote_formats(&[sample_format()]));
        assert_eq!(state.remote_formats.len(), 1);
        assert!(
            state.remote_text.is_none(),
            "a new remote format list invalidates the prior payload"
        );

        assert!(state.queue_format_data_request(sample_format_request()));
        assert!(!state.pending_data_request.is_empty());
        assert_eq!(state.local_text.as_deref(), Some("local"));

        assert!(state.queue_file_contents_request(sample_file_request()));
        assert!(!state.pending_file_contents_request.is_empty());
        assert_eq!(state.staged_files.len(), 1);
    }

    #[test]
    fn clipboard_direction_client_to_server_rejects_remote_formats_only() {
        let mut state = populated_state(ClipboardDirection::ClientToServer);

        assert!(state.apply_local_advertisement_policy());
        assert_eq!(state.local_text.as_deref(), Some("local"));
        assert_eq!(state.staged_files.len(), 1);

        assert!(!state.store_remote_formats(&[sample_format()]));
        assert!(state.remote_formats.is_empty());
        assert!(state.remote_text.is_none());

        assert!(state.queue_format_data_request(sample_format_request()));
        assert!(!state.pending_data_request.is_empty());
        assert_eq!(state.local_text.as_deref(), Some("local"));

        assert!(state.queue_file_contents_request(sample_file_request()));
        assert!(!state.pending_file_contents_request.is_empty());
        assert_eq!(state.staged_files.len(), 1);
    }

    #[test]
    fn clipboard_direction_server_to_client_rejects_local_clipboard_requests() {
        let mut state = populated_state(ClipboardDirection::ServerToClient);

        assert!(!state.apply_local_advertisement_policy());
        assert!(state.local_text.is_none());
        assert!(state.staged_files.is_empty());
        assert_eq!(state.file_bytes_transferred, 0);

        assert!(state.store_remote_formats(&[sample_format()]));
        assert_eq!(state.remote_formats.len(), 1);
        assert!(
            state.remote_text.is_none(),
            "a new remote format list invalidates the prior payload"
        );

        assert!(!state.queue_format_data_request(sample_format_request()));
        assert!(!state.pending_data_request.is_empty());
        assert!(state.local_text.is_none());

        assert!(!state.queue_file_contents_request(sample_file_request()));
        assert!(!state.pending_file_contents_request.is_empty());
        assert!(state.staged_files.is_empty());
    }

    #[test]
    fn clipboard_direction_disabled_rejects_all_clipboard_flows() {
        let mut state = populated_state(ClipboardDirection::Disabled);

        assert!(!state.apply_local_advertisement_policy());
        assert!(state.local_text.is_none());
        assert!(state.staged_files.is_empty());
        assert_eq!(state.file_bytes_transferred, 0);

        assert!(!state.store_remote_formats(&[sample_format()]));
        assert!(state.remote_formats.is_empty());
        assert!(state.remote_text.is_none());

        assert!(!state.queue_format_data_request(sample_format_request()));
        assert!(!state.pending_data_request.is_empty());
        assert!(state.local_text.is_none());

        assert!(!state.queue_file_contents_request(sample_file_request()));
        assert!(!state.pending_file_contents_request.is_empty());
        assert!(state.staged_files.is_empty());
    }
}

#[cfg(test)]
#[path = "clipboard_reliability_tests.rs"]
mod reliability_tests;
