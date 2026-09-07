//! RDPGFX DVC processor — core state machine implementing the Graphics Pipeline Extension.

use std::collections::{HashMap, VecDeque};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};

use crate::ironrdp_core::impl_as_any;
use crate::ironrdp_dvc::ironrdp_pdu::PduResult;
use crate::ironrdp_dvc::{DvcClientProcessor, DvcMessage, DvcProcessor};

use crate::h264::{self, DecodedFrame, H264Decoder, H264DecoderPreference};

use super::pdu::*;
use super::surfaces::SurfaceManager;

use crate::rdp::session_state::ChannelSummary;
use crate::rdp::virtual_channels::VirtualChannelState;

/// Channel name for RDPGFX (MS-RDPEGFX).
pub const GFX_CHANNEL_NAME: &str = "Microsoft::Windows::RDS::Graphics";

/// Re-export of the DVC processor trait so integration tests (and any external
/// consumer driving the GFX state machine) can call `start`/`process`/`close`
/// on a `GfxProcessor` without reaching into the crate-private vendor module.
pub use crate::ironrdp_dvc::DvcProcessor as GfxDvcProcessor;

/// Tier-A + Tier-B diagnostics snapshot for the RDPGFX graphics pipeline.
///
/// `summary` is the single-channel `ChannelSummary` view (enabled/ready/failed)
/// that the runner merges into the lifecycle channel summary exactly like
/// CLIPRDR / AUDIN / RDPDR / RDPSND. The remaining fields are GFX-specific
/// signals (negotiated codec, cap version, surface count, frames decoded,
/// frame-acks, pipeline errors) that ride the stats event so the panel can show
/// a dedicated Graphics row.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GfxDiagnostics {
    /// One-channel ready/fault/enabled view, merged into the lifecycle summary.
    pub summary: ChannelSummary,
    /// Negotiated capability version (CAPVERSION_*), once CapsConfirm arrives.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cap_version: Option<u32>,
    /// Negotiated codec name ("AVC444" | "AVC420" | "uncompressed" | …).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub codec: Option<&'static str>,
    /// Surfaces currently allocated by the server.
    pub surfaces_active: u16,
    /// Total frames decoded (or NAL-forwarded in passthrough mode).
    pub frames_decoded: u32,
    /// Frame-acknowledge PDUs sent back to the server.
    pub frame_acks_sent: u32,
    /// Count of per-frame pipeline parse/decode errors (recoverable — these do
    /// NOT fault the channel).
    pub pipeline_errors: u32,
    /// Class of the most recent pipeline error, for the panel tooltip.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_error_class: Option<String>,
    /// When true, raw H.264 NALs are forwarded for frontend WebCodecs decode.
    pub nal_passthrough: bool,
}

/// Cloneable, runner-readable handle to the live GFX diagnostics. The processor
/// is moved into DRDYNVC after registration (identical to AUDIN), so the runner
/// keeps a clone of this handle and reads the live snapshot the processor
/// publishes on every channel-state transition.
pub type SharedGfxDiagnostics = Arc<Mutex<GfxDiagnostics>>;

fn rect_fits(rect: &GfxRect16, width: u32, height: u32) -> bool {
    rect.left < rect.right
        && rect.top < rect.bottom
        && u32::from(rect.right) <= width
        && u32::from(rect.bottom) <= height
}

fn annex_b_has_nal(data: &[u8], kind: impl Fn(u8) -> bool) -> bool {
    data.windows(4)
        .any(|bytes| bytes[..3] == [0, 0, 1] && kind(bytes[3] & 0x1f))
}

/// AVC420 pictures are surface-relative, including codec padding. Only the
/// metadata mask changes the persistent surface; destRect is a bounding box,
/// not a request to scale or shift the decoded image.
fn apply_avc420_regions(
    surface: &mut super::surfaces::GfxSurface,
    frame: &DecodedFrame,
    regions: &[GfxRect16],
) -> Result<Option<GfxFrame>, &'static str> {
    let expected = (frame.width as usize)
        .checked_mul(frame.height as usize)
        .and_then(|n| n.checked_mul(4));
    if expected != Some(frame.rgba.len()) || regions.len() > MAX_AVC420_REGIONS {
        return Err("h264_frame_dimensions_invalid");
    }
    if regions.iter().any(|rect| {
        !rect_fits(rect, frame.width, frame.height)
            || !rect_fits(rect, u32::from(surface.width), u32::from(surface.height))
    }) {
        return Err("avc420_mask_out_of_bounds");
    }
    let Some(first) = regions.first() else {
        return Ok(None);
    };
    let bounds = regions.iter().fold(*first, |mut bounds, rect| {
        bounds.left = bounds.left.min(rect.left);
        bounds.top = bounds.top.min(rect.top);
        bounds.right = bounds.right.max(rect.right);
        bounds.bottom = bounds.bottom.max(rect.bottom);
        bounds
    });
    let origin = surface
        .output_origin
        .map(|(x, y)| {
            let x = u16::try_from(x).map_err(|_| "gfx_output_origin_out_of_bounds")?;
            let y = u16::try_from(y).map_err(|_| "gfx_output_origin_out_of_bounds")?;
            x.checked_add(bounds.right)
                .ok_or("gfx_output_origin_out_of_bounds")?;
            y.checked_add(bounds.bottom)
                .ok_or("gfx_output_origin_out_of_bounds")?;
            Ok::<_, &'static str>((x + bounds.left, y + bounds.top))
        })
        .transpose()?;
    let source_stride = frame.width as usize * 4;
    let surface_stride = usize::from(surface.width) * 4;
    for rect in regions {
        let bytes = usize::from(rect.right - rect.left) * 4;
        for y in usize::from(rect.top)..usize::from(rect.bottom) {
            let source = y * source_stride + usize::from(rect.left) * 4;
            let target = y * surface_stride + usize::from(rect.left) * 4;
            surface.rgba[target..target + bytes]
                .copy_from_slice(&frame.rgba[source..source + bytes]);
        }
    }
    let Some((screen_x, screen_y)) = origin else {
        return Ok(None);
    };
    let width = bounds.right - bounds.left;
    let height = bounds.bottom - bounds.top;
    let mut rgba = Vec::with_capacity(usize::from(width) * usize::from(height) * 4);
    for row in usize::from(bounds.top)..usize::from(bounds.bottom) {
        let start = row * surface_stride + usize::from(bounds.left) * 4;
        rgba.extend_from_slice(&surface.rgba[start..start + usize::from(width) * 4]);
    }
    Ok(Some(GfxFrame {
        screen_x,
        screen_y,
        width,
        height,
        rgba,
    }))
}

/// Derive the single-channel `ChannelSummary` from a GFX channel state.
fn channel_summary_for_state(state: VirtualChannelState) -> ChannelSummary {
    ChannelSummary {
        enabled_count: if state.is_enabled() { 1 } else { 0 },
        ready_count: if state.is_ready() { 1 } else { 0 },
        failed_count: if state.is_failed() { 1 } else { 0 },
    }
}

/// Map a negotiated cap version to a human-readable codec label.
fn codec_for_cap_version(version: u32) -> &'static str {
    match version {
        CAPVERSION_101 | CAPVERSION_102 | CAPVERSION_103 | CAPVERSION_104 => "AVC444",
        CAPVERSION_10 => "AVC420",
        CAPVERSION_8 | CAPVERSION_81 => "RemoteFX/uncompressed",
        _ => "unknown",
    }
}

/// A decoded GFX frame ready for display (RGBA dirty rect).
#[derive(Debug)]
pub struct GfxFrame {
    /// Screen X coordinate (from surface mapping).
    pub screen_x: u16,
    /// Screen Y coordinate.
    pub screen_y: u16,
    /// Width of the update region.
    pub width: u16,
    /// Height of the update region.
    pub height: u16,
    /// RGBA32 pixel data.
    pub rgba: Vec<u8>,
}

/// A raw H.264 NAL unit for frontend WebCodecs decode.
#[derive(Debug, Default)]
pub struct GfxNalFrame {
    /// Surface ID (for multi-surface tracking).
    pub surface_id: u16,
    /// Screen X coordinate (from surface mapping).
    pub screen_x: u16,
    /// Screen Y coordinate.
    pub screen_y: u16,
    /// Logical surface width; AVC mask coordinates are surface-relative.
    pub dest_w: u16,
    /// Logical surface height (independent of the codec's padded row stride).
    pub dest_h: u16,
    /// Zero/zero means unknown until the bitstream is decoded.
    pub coded_width: u16,
    pub coded_height: u16,
    /// Exclusive surface-relative rectangles to copy from the decoded picture.
    pub region_rects: Vec<GfxRect16>,
    /// Raw H.264 NAL unit bytes (not decoded).
    pub nal_data: Vec<u8>,
}

impl GfxNalFrame {
    pub fn payload_bytes(&self) -> Option<usize> {
        self.region_rects
            .len()
            .checked_mul(8)?
            .checked_add(28)?
            .checked_add(self.nal_data.len())
    }
}

/// Output from the GFX processor — either decoded RGBA or raw NAL passthrough.
#[derive(Debug)]
pub enum GfxOutput {
    /// Fully decoded RGBA dirty rect (legacy path).
    Rgba(GfxFrame),
    /// Raw H.264 NAL for frontend WebCodecs decode (zero-decode path).
    Nal(GfxNalFrame),
}

pub const MAX_PENDING_GFX_FRAMES: usize = 4;
/// Aggregate decoded-output mailbox budget. A 4096x2160 RGBA surface is about
/// 33.75 MiB before its transport header, so the former 32 MiB cap rejected
/// every valid 4K fallback frame before the consumer could tile it.
pub const MAX_PENDING_GFX_FRAME_BYTES: usize = 48 * 1024 * 1024;

impl GfxOutput {
    fn retained_bytes(&self) -> usize {
        match self {
            Self::Rgba(frame) => frame.rgba.len().saturating_add(8),
            Self::Nal(frame) => frame.payload_bytes().unwrap_or(usize::MAX),
        }
    }

    fn is_nal(&self) -> bool {
        matches!(self, Self::Nal(_))
    }
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct GfxFrameMailboxPressure {
    pub dropped_frames: u64,
    pub nal_chain_broken: bool,
}

#[derive(Default)]
struct GfxFrameMailboxState {
    frames: VecDeque<GfxOutput>,
    retained_bytes: usize,
    receiver_alive: bool,
    pressure: GfxFrameMailboxPressure,
    max_frames: usize,
    max_bytes: usize,
}

#[derive(Clone)]
pub struct GfxFrameSender {
    state: Arc<Mutex<GfxFrameMailboxState>>,
}

pub struct GfxFrameReceiver {
    state: Arc<Mutex<GfxFrameMailboxState>>,
}

pub fn bounded_gfx_frame_channel() -> (GfxFrameSender, GfxFrameReceiver) {
    bounded_gfx_frame_channel_with_limits(MAX_PENDING_GFX_FRAMES, MAX_PENDING_GFX_FRAME_BYTES)
}

fn bounded_gfx_frame_channel_with_limits(
    max_frames: usize,
    max_bytes: usize,
) -> (GfxFrameSender, GfxFrameReceiver) {
    let state = Arc::new(Mutex::new(GfxFrameMailboxState {
        frames: VecDeque::with_capacity(max_frames),
        receiver_alive: true,
        max_frames,
        max_bytes,
        ..GfxFrameMailboxState::default()
    }));
    (
        GfxFrameSender {
            state: Arc::clone(&state),
        },
        GfxFrameReceiver { state },
    )
}

impl GfxFrameSender {
    /// Non-blocking send: producer and consumer execute on the same session
    /// thread, so a standard bounded `sync_channel::send` could deadlock.
    pub fn send(&self, output: GfxOutput) -> Result<(), mpsc::TrySendError<GfxOutput>> {
        let bytes = output.retained_bytes();
        let nal_payload = output.is_nal();
        let mut state = match self.state.lock() {
            Ok(state) => state,
            Err(_) => return Err(mpsc::TrySendError::Disconnected(output)),
        };
        if !state.receiver_alive {
            return Err(mpsc::TrySendError::Disconnected(output));
        }
        let next_bytes = state.retained_bytes.saturating_add(bytes);
        if state.frames.len() >= state.max_frames
            || bytes > state.max_bytes
            || next_bytes > state.max_bytes
        {
            state.pressure.dropped_frames = state.pressure.dropped_frames.saturating_add(1);
            state.pressure.nal_chain_broken |= nal_payload;
            return Err(mpsc::TrySendError::Full(output));
        }
        state.frames.push_back(output);
        state.retained_bytes = next_bytes;
        Ok(())
    }
}

impl GfxFrameReceiver {
    pub fn try_recv(&self) -> Result<GfxOutput, mpsc::TryRecvError> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| mpsc::TryRecvError::Disconnected)?;
        let output = state.frames.pop_front().ok_or(mpsc::TryRecvError::Empty)?;
        state.retained_bytes = state.retained_bytes.saturating_sub(output.retained_bytes());
        Ok(output)
    }

    pub fn take_pressure(&self) -> GfxFrameMailboxPressure {
        self.state
            .lock()
            .map(|mut state| std::mem::take(&mut state.pressure))
            .unwrap_or_default()
    }
}

impl Drop for GfxFrameReceiver {
    fn drop(&mut self) {
        if let Ok(mut state) = self.state.lock() {
            state.receiver_alive = false;
            state.frames.clear();
            state.retained_bytes = 0;
        }
    }
}

/// GFX processor state.
const MAX_SURFACE_DECODERS: usize = 8;
const MAX_PENDING_DECODE_MASKS: usize = 8;

struct SurfaceDecoder {
    decoder: Box<dyn H264Decoder>,
    masks: HashMap<u64, Vec<GfxRect16>>,
    next_picture_id: u64,
    last_used: u64,
    needs_keyframe: bool,
}

pub struct GfxProcessor {
    surfaces: SurfaceManager,
    h264_decoders: HashMap<u16, SurfaceDecoder>,
    decoder_use: u64,
    /// Prevent a missing optional decoder from triggering filesystem/hash/load
    /// work and error logging for every incoming AVC frame. Reset/close clears
    /// this flag so a deliberately restarted graphics channel may retry.
    decoder_initialization_failed: bool,
    decoder_preference: H264DecoderPreference,
    /// Negotiated capability version.
    cap_version: Option<u32>,
    /// Channel for sending decoded frames to the session loop.
    frame_tx: GfxFrameSender,
    /// When true, send raw H.264 NALs instead of decoded RGBA.
    nal_passthrough: bool,
    /// Frame acknowledge tracking.
    total_frames_decoded: u32,
    current_frame_id: Option<u32>,
    /// Live channel state (Registered → Negotiating → Ready / Faulted).
    channel_state: VirtualChannelState,
    /// Negotiated codec name, derived on CapsConfirm.
    codec: Option<&'static str>,
    /// Frame-acknowledge PDUs sent back to the server.
    frame_acks_sent: u32,
    /// Recoverable per-frame pipeline error count (does NOT fault the channel).
    pipeline_errors: u32,
    /// Class of the most recent pipeline error.
    last_error_class: Option<String>,
    /// Runner-readable shared snapshot, published on every state transition (and
    /// periodically on the frame hot path) so the session runner can merge GFX's
    /// live ready/fault into the lifecycle summary and ride the Tier-B snapshot
    /// on the stats event, even though the processor is moved into DRDYNVC.
    shared: SharedGfxDiagnostics,
}

impl GfxProcessor {
    pub fn new(
        decoder_preference: H264DecoderPreference,
        frame_tx: GfxFrameSender,
        nal_passthrough: bool,
    ) -> Self {
        if nal_passthrough {
            log::info!(
                "GFX: NAL passthrough enabled — H.264 will be decoded on frontend via WebCodecs"
            );
        }
        // The runner only constructs a GfxProcessor when GFX is enabled, so seed
        // the channel as Registered (enabled, not yet ready) like AUDIN does.
        let channel_state = VirtualChannelState::Registered;
        let shared = Arc::new(Mutex::new(GfxDiagnostics {
            summary: channel_summary_for_state(channel_state),
            nal_passthrough,
            ..Default::default()
        }));
        Self {
            surfaces: SurfaceManager::new(),
            h264_decoders: HashMap::new(),
            decoder_use: 0,
            decoder_initialization_failed: false,
            decoder_preference,
            cap_version: None,
            frame_tx,
            nal_passthrough,
            total_frames_decoded: 0,
            current_frame_id: None,
            channel_state,
            codec: None,
            frame_acks_sent: 0,
            pipeline_errors: 0,
            last_error_class: None,
            shared,
        }
    }

    /// Returns a cloneable handle to the live GFX diagnostics. The runner holds
    /// this clone so it can read GFX's real ready/fault/enabled counts and the
    /// Tier-B GFX signals after the processor has been moved into DRDYNVC
    /// (mirrors how AUDIN shares its `SharedAudinSummary`).
    pub fn shared_diagnostics(&self) -> SharedGfxDiagnostics {
        self.shared.clone()
    }

    /// Build the current diagnostics snapshot from the processor's plain fields.
    fn snapshot(&self) -> GfxDiagnostics {
        GfxDiagnostics {
            summary: channel_summary_for_state(self.channel_state),
            cap_version: self.cap_version,
            codec: self.codec,
            surfaces_active: self.surfaces.active_count(),
            frames_decoded: self.total_frames_decoded,
            frame_acks_sent: self.frame_acks_sent,
            pipeline_errors: self.pipeline_errors,
            last_error_class: self.last_error_class.clone(),
            nal_passthrough: self.nal_passthrough,
        }
    }

    /// Publish the current snapshot into the shared handle so the runner observes
    /// the live transition. Called on every state transition (and, rate-limited,
    /// on the frame hot path) — never unconditionally per frame.
    fn publish(&self) {
        if let Ok(mut shared) = self.shared.lock() {
            *shared = self.snapshot();
        }
    }

    /// Transition the channel state and publish. Bumps the ready accounting only
    /// on the rising edge into Ready (mirrors AUDIN's `set_channel_state`).
    fn set_channel_state(&mut self, state: VirtualChannelState) {
        if state != VirtualChannelState::Faulted {
            self.last_error_class = None;
        }
        self.channel_state = state;
        self.publish();
    }

    /// Mark the channel faulted with an error class and publish. Reserved for
    /// fatal/structural pipeline errors (truncated/unparseable PDU header) — a
    /// single bad frame must NOT flip the channel to Faulted.
    fn mark_faulted(&mut self, class: &'static str) {
        self.channel_state = VirtualChannelState::Faulted;
        self.last_error_class = Some(class.to_string());
        self.publish();
    }

    /// Record a recoverable per-frame pipeline parse/decode error. Increments the
    /// error counter and records the class but does NOT fault the channel — a
    /// codec hiccup on one frame should not make the diagnostics row red.
    fn record_pipeline_error(&mut self, class: &'static str) {
        self.pipeline_errors = self.pipeline_errors.saturating_add(1);
        self.last_error_class = Some(class.to_string());
    }

    fn ensure_decoder(&mut self, surface_id: u16) {
        self.ensure_decoder_with(surface_id, h264::create_decoder);
    }

    fn ensure_decoder_with<F>(&mut self, surface_id: u16, create: F)
    where
        F: FnOnce(
            H264DecoderPreference,
        ) -> Result<(Box<dyn H264Decoder>, &'static str), h264::H264Error>,
    {
        self.decoder_use = self.decoder_use.saturating_add(1);
        if let Some(decoder) = self.h264_decoders.get_mut(&surface_id) {
            decoder.last_used = self.decoder_use;
            return;
        }
        if self.decoder_initialization_failed {
            return;
        }
        if self.h264_decoders.len() >= MAX_SURFACE_DECODERS {
            if let Some(oldest) = self
                .h264_decoders
                .iter()
                .min_by_key(|(_, slot)| slot.last_used)
                .map(|(&id, _)| id)
            {
                self.h264_decoders.remove(&oldest);
            }
        }
        match create(self.decoder_preference) {
            Ok((dec, name)) => {
                log::info!("GFX: surface {surface_id} H.264 decoder initialized: {name}");
                self.h264_decoders.insert(
                    surface_id,
                    SurfaceDecoder {
                        decoder: dec,
                        masks: HashMap::new(),
                        next_picture_id: 0,
                        last_used: self.decoder_use,
                        needs_keyframe: true,
                    },
                );
            }
            Err(e) => {
                self.decoder_initialization_failed = true;
                log::error!("GFX: H.264 decoder init failed: {e}");
            }
        }
    }

    fn handle_caps_confirm(&mut self, body: &[u8]) -> Vec<DvcMessage> {
        match CapsConfirm::parse(body) {
            Ok(caps) => {
                self.cap_version = Some(caps.version);
                self.codec = Some(codec_for_cap_version(caps.version));
                log::info!(
                    "GFX: server confirmed capability version 0x{:08X} (flags=0x{:X})",
                    caps.version,
                    caps.flags
                );
                // Caps negotiated → the graphics pipeline is Ready.
                self.set_channel_state(VirtualChannelState::Ready);
            }
            Err(e) => {
                log::warn!("GFX: CapsConfirm parse error: {e}");
                // Structural negotiation failure → fault the channel.
                self.mark_faulted("caps_confirm_parse_error");
            }
        }
        Vec::new()
    }

    fn handle_create_surface(&mut self, body: &[u8]) -> Vec<DvcMessage> {
        match CreateSurface::parse(body) {
            Ok(cs) => {
                self.h264_decoders.remove(&cs.surface_id);
                self.surfaces
                    .create_surface(cs.surface_id, cs.width, cs.height);
                // Surface count changed — refresh the snapshot.
                self.publish();
            }
            Err(e) => {
                log::warn!("GFX: CreateSurface parse error: {e}");
                self.record_pipeline_error("create_surface_parse_error");
            }
        }
        Vec::new()
    }

    fn handle_delete_surface(&mut self, body: &[u8]) -> Vec<DvcMessage> {
        match DeleteSurface::parse(body) {
            Ok(ds) => {
                self.h264_decoders.remove(&ds.surface_id);
                self.surfaces.delete_surface(ds.surface_id);
                self.publish();
            }
            Err(e) => {
                log::warn!("GFX: DeleteSurface parse error: {e}");
                self.record_pipeline_error("delete_surface_parse_error");
            }
        }
        Vec::new()
    }

    fn handle_map_surface_to_output(&mut self, body: &[u8]) -> Vec<DvcMessage> {
        match MapSurfaceToOutput::parse(body) {
            Ok(ms) => self.surfaces.map_surface_to_output(
                ms.surface_id,
                ms.output_origin_x,
                ms.output_origin_y,
            ),
            Err(e) => log::warn!("GFX: MapSurfaceToOutput parse error: {e}"),
        }
        Vec::new()
    }

    fn handle_start_frame(&mut self, body: &[u8]) -> Vec<DvcMessage> {
        match StartFrame::parse(body) {
            Ok(sf) => {
                self.current_frame_id = Some(sf.frame_id);
            }
            Err(e) => log::warn!("GFX: StartFrame parse error: {e}"),
        }
        Vec::new()
    }

    fn handle_end_frame(&mut self, body: &[u8]) -> Vec<DvcMessage> {
        match EndFrame::parse(body) {
            Ok(_ef) => {
                if let Some(frame_id) = self.current_frame_id.take() {
                    self.total_frames_decoded += 1;
                    self.frame_acks_sent = self.frame_acks_sent.saturating_add(1);

                    // Bounded per-frame publish: keep the frames/ack counters
                    // approximately live in the shared handle without locking the
                    // mutex on every frame (publish on transitions + every 30th).
                    if self.total_frames_decoded.is_multiple_of(30) {
                        self.publish();
                    }

                    let ack = FrameAcknowledgePdu {
                        queue_depth: 0xFFFFFFFF, // QUEUE_DEPTH_AVAILABLE
                        frame_id,
                        total_frames_decoded: self.total_frames_decoded,
                    };
                    return vec![Box::new(ack) as DvcMessage];
                }
            }
            Err(e) => {
                log::warn!("GFX: EndFrame parse error: {e}");
                self.record_pipeline_error("end_frame_parse_error");
            }
        }
        Vec::new()
    }

    fn handle_reset_graphics(&mut self, body: &[u8]) -> Vec<DvcMessage> {
        match ResetGraphics::parse(body) {
            Ok(rg) => {
                log::info!(
                    "GFX: ResetGraphics {}x{} monitors={}",
                    rg.width,
                    rg.height,
                    rg.monitor_count
                );
                self.surfaces.reset();
                self.h264_decoders.clear();
                self.decoder_initialization_failed = false;
                // Surfaces were dropped; refresh the snapshot (stay Ready).
                self.publish();
            }
            Err(e) => {
                log::warn!("GFX: ResetGraphics parse error: {e}");
                self.record_pipeline_error("reset_graphics_parse_error");
            }
        }
        Vec::new()
    }

    fn handle_wire_to_surface_1(&mut self, body: &[u8]) -> Vec<DvcMessage> {
        let wts = match WireToSurface1::parse(body) {
            Ok(w) => w,
            Err(e) => {
                log::warn!("GFX: WireToSurface1 parse error: {e}");
                self.record_pipeline_error("wire_to_surface_parse_error");
                return Vec::new();
            }
        };

        let valid_surface = self
            .surfaces
            .get_surface(wts.surface_id)
            .is_some_and(|surface| {
                rect_fits(
                    &wts.dest_rect,
                    u32::from(surface.width),
                    u32::from(surface.height),
                )
            });
        if !valid_surface {
            self.record_pipeline_error("wire_to_surface_bounds_invalid");
            return Vec::new();
        }

        match wts.codec_id {
            CODEC_AVC420 => {
                // Surface the in-use codec from the first AVC420 frame if caps
                // negotiation didn't already label it.
                if self.codec.is_none() {
                    self.codec = Some("AVC420");
                    self.publish();
                }
                self.decode_avc420(&wts)
            }
            CODEC_UNCOMPRESSED => {
                if self.codec.is_none() {
                    self.codec = Some("uncompressed");
                    self.publish();
                }
                self.handle_uncompressed(&wts)
            }
            other => {
                log::debug!("GFX: unsupported codec_id 0x{other:04X} in WireToSurface1");
            }
        }

        Vec::new()
    }

    fn decode_avc420(&mut self, wts: &WireToSurface1) {
        let avc = match Avc420BitmapStream::parse(&wts.bitmap_data) {
            Ok(a) => a,
            Err(e) => {
                log::warn!("GFX: Avc420BitmapStream parse error: {e}");
                self.record_pipeline_error("avc420_parse_error");
                return;
            }
        };

        if avc.h264_data.is_empty() {
            return;
        }

        let Some(surface) = self.surfaces.get_surface(wts.surface_id) else {
            return;
        };
        if avc
            .region_rects
            .iter()
            .any(|rect| !rect_fits(rect, u32::from(surface.width), u32::from(surface.height)))
        {
            self.record_pipeline_error("avc420_mask_out_of_bounds");
            return;
        }

        // ── NAL passthrough: send raw H.264 to frontend for WebCodecs decode ──
        if self.nal_passthrough {
            if let Some((ox, oy)) = surface.output_origin {
                if let (Ok(screen_x), Ok(screen_y)) = (u16::try_from(ox), u16::try_from(oy)) {
                    if avc.region_rects.iter().any(|rect| {
                        screen_x.checked_add(rect.right).is_none()
                            || screen_y.checked_add(rect.bottom).is_none()
                    }) {
                        self.record_pipeline_error("gfx_output_origin_out_of_bounds");
                        return;
                    }
                    let _ = self.frame_tx.send(GfxOutput::Nal(GfxNalFrame {
                        surface_id: wts.surface_id,
                        screen_x,
                        screen_y,
                        dest_w: surface.width,
                        dest_h: surface.height,
                        coded_width: 0,
                        coded_height: 0,
                        region_rects: avc.region_rects,
                        nal_data: avc.h264_data,
                    }));
                } else {
                    self.record_pipeline_error("gfx_output_origin_out_of_bounds");
                }
            }
            return;
        }

        // ── Legacy path: decode H.264 on backend, send RGBA ──
        self.ensure_decoder(wts.surface_id);
        let slot = match self.h264_decoders.get_mut(&wts.surface_id) {
            Some(d) => d,
            None => return,
        };

        let contains_picture = annex_b_has_nal(&avc.h264_data, |kind| (1..=5).contains(&kind));
        let keyframe = annex_b_has_nal(&avc.h264_data, |kind| kind == 5);
        if contains_picture && slot.needs_keyframe && !keyframe {
            return;
        }
        if keyframe {
            slot.needs_keyframe = false;
        }
        slot.next_picture_id = slot.next_picture_id.wrapping_add(1).max(1);
        let picture_id = slot.next_picture_id;
        if contains_picture {
            if slot.masks.len() >= MAX_PENDING_DECODE_MASKS {
                slot.masks.clear();
                slot.needs_keyframe = true;
                self.record_pipeline_error("h264_pending_mask_limit");
                return;
            }
            slot.masks.insert(picture_id, avc.region_rects);
        }
        let frames: Vec<DecodedFrame> = match slot.decoder.decode(&avc.h264_data, picture_id) {
            Ok(f) => f,
            Err(e) => {
                slot.masks.clear();
                slot.needs_keyframe = true;
                log::warn!("GFX: H.264 decode error: {e}");
                self.record_pipeline_error("h264_decode_error");
                return;
            }
        };

        for frame in frames {
            let regions = self
                .h264_decoders
                .get_mut(&wts.surface_id)
                .and_then(|slot| slot.masks.remove(&frame.picture_id));
            let Some(regions) = regions else {
                self.record_pipeline_error("h264_output_without_mask");
                continue;
            };
            if let Some(surface) = self.surfaces.get_surface_mut(wts.surface_id) {
                match apply_avc420_regions(surface, &frame, &regions) {
                    Ok(Some(output)) => {
                        let _ = self.frame_tx.send(GfxOutput::Rgba(output));
                    }
                    Ok(None) => {}
                    Err(class) => self.record_pipeline_error(class),
                }
            }
        }
    }

    fn handle_uncompressed(&mut self, wts: &WireToSurface1) {
        let dest_w = wts.dest_rect.right.saturating_sub(wts.dest_rect.left);
        let dest_h = wts.dest_rect.bottom.saturating_sub(wts.dest_rect.top);

        // Uncompressed data is raw pixels in the surface's pixel format.
        // For XRGB/ARGB 8888, it's 4 bytes per pixel in BGRA order.
        // Convert to RGBA for our pipeline.
        let pixel_count = dest_w as usize * dest_h as usize;
        let expected_len = pixel_count * 4;

        if wts.bitmap_data.len() < expected_len {
            return;
        }

        // Convert BGRX/BGRA -> RGBA using SIMD-dispatched conversion.
        let mut rgba = wts.bitmap_data[..expected_len].to_vec();
        crate::h264::yuv_convert::bgra_to_rgba_inplace(&mut rgba);
        if wts.pixel_format == 0x20 {
            for pixel in rgba.as_chunks_mut::<4>().0 {
                pixel[3] = 255;
            }
        }

        self.surfaces.blit_to_surface(
            wts.surface_id,
            &rgba,
            dest_w as u32,
            wts.dest_rect.left,
            wts.dest_rect.top,
            dest_w,
            dest_h,
        );

        if let Some(surface) = self.surfaces.get_surface(wts.surface_id) {
            if let Some((ox, oy)) = surface.output_origin {
                let Some(screen_x) = u16::try_from(ox)
                    .ok()
                    .and_then(|x| x.checked_add(wts.dest_rect.left))
                else {
                    self.record_pipeline_error("gfx_output_origin_out_of_bounds");
                    return;
                };
                let Some(screen_y) = u16::try_from(oy)
                    .ok()
                    .and_then(|y| y.checked_add(wts.dest_rect.top))
                else {
                    self.record_pipeline_error("gfx_output_origin_out_of_bounds");
                    return;
                };
                let _ = self.frame_tx.send(GfxOutput::Rgba(GfxFrame {
                    screen_x,
                    screen_y,
                    width: dest_w,
                    height: dest_h,
                    rgba,
                }));
            }
        }
    }
}

impl_as_any!(GfxProcessor);

impl DvcProcessor for GfxProcessor {
    fn channel_name(&self) -> &str {
        GFX_CHANNEL_NAME
    }

    fn start(&mut self, channel_id: u32) -> PduResult<Vec<DvcMessage>> {
        log::info!("GFX: DVC channel opened (id={channel_id}), sending CAPS_ADVERTISE");
        // Channel opened, CAPS_ADVERTISE sent → Negotiating.
        self.set_channel_state(VirtualChannelState::Negotiating);
        let caps = CapsAdvertisePdu::new_avc420();
        Ok(vec![Box::new(caps) as DvcMessage])
    }

    fn process(&mut self, _channel_id: u32, payload: &[u8]) -> PduResult<Vec<DvcMessage>> {
        let mut offset = 0;
        let mut all_responses = Vec::new();

        while offset + RDPGFX_HEADER_SIZE <= payload.len() {
            let header = match GfxHeader::parse(&payload[offset..]) {
                Ok(h) => h,
                Err(e) => {
                    log::warn!("GFX: header parse error at offset {offset}: {e}");
                    // Structural/unparseable PDU header → fault the channel.
                    self.mark_faulted("gfx_header_parse_error");
                    break;
                }
            };

            let pdu_len = header.pdu_length as usize;
            if pdu_len < RDPGFX_HEADER_SIZE || offset + pdu_len > payload.len() {
                log::warn!("GFX: truncated PDU at offset {offset} (pdu_len={pdu_len})");
                // Structural truncation of the PDU framing → fault the channel.
                self.mark_faulted("gfx_truncated_pdu");
                break;
            }

            let body = &payload[offset + RDPGFX_HEADER_SIZE..offset + pdu_len];

            let responses = match header.cmd_id {
                x if x == GfxCmdId::CapsConfirm as u16 => self.handle_caps_confirm(body),
                x if x == GfxCmdId::CreateSurface as u16 => self.handle_create_surface(body),
                x if x == GfxCmdId::DeleteSurface as u16 => self.handle_delete_surface(body),
                x if x == GfxCmdId::MapSurfaceToOutput as u16 => {
                    self.handle_map_surface_to_output(body)
                }
                x if x == GfxCmdId::StartFrame as u16 => self.handle_start_frame(body),
                x if x == GfxCmdId::EndFrame as u16 => self.handle_end_frame(body),
                x if x == GfxCmdId::WireToSurface1 as u16 => self.handle_wire_to_surface_1(body),
                x if x == GfxCmdId::ResetGraphics as u16 => self.handle_reset_graphics(body),
                other => {
                    log::debug!("GFX: unhandled cmd_id 0x{other:04X}");
                    Vec::new()
                }
            };

            all_responses.extend(responses);
            offset += pdu_len;
        }

        Ok(all_responses)
    }

    fn close(&mut self, channel_id: u32) {
        log::info!("GFX: DVC channel closed (id={channel_id})");
        self.surfaces.reset();
        self.h264_decoders.clear();
        self.decoder_initialization_failed = false;
        // Channel closed but re-openable → back to Registered (mirrors AUDIN).
        self.set_channel_state(VirtualChannelState::Registered);
    }
}

impl DvcClientProcessor for GfxProcessor {}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ironrdp_dvc::DvcProcessor;

    fn new_processor() -> (GfxProcessor, GfxFrameReceiver) {
        let (tx, rx) = bounded_gfx_frame_channel();
        let proc = GfxProcessor::new(H264DecoderPreference::Auto, tx, false);
        (proc, rx)
    }

    fn rgba_output(bytes: usize) -> GfxOutput {
        GfxOutput::Rgba(GfxFrame {
            screen_x: 0,
            screen_y: 0,
            width: 1,
            height: 1,
            rgba: vec![0; bytes],
        })
    }

    fn nal_output(bytes: usize) -> GfxOutput {
        GfxOutput::Nal(GfxNalFrame {
            surface_id: 0,
            screen_x: 0,
            screen_y: 0,
            dest_w: 1,
            dest_h: 1,
            nal_data: vec![0; bytes],
            ..GfxNalFrame::default()
        })
    }

    #[test]
    fn gfx_mailbox_is_hard_bounded_by_count_and_releases_after_receive() {
        let (tx, rx) = bounded_gfx_frame_channel_with_limits(2, 128);
        tx.send(rgba_output(4)).expect("first frame");
        tx.send(rgba_output(4)).expect("second frame");
        assert!(matches!(
            tx.send(rgba_output(4)),
            Err(mpsc::TrySendError::Full(_))
        ));
        assert_eq!(
            rx.take_pressure(),
            GfxFrameMailboxPressure {
                dropped_frames: 1,
                nal_chain_broken: false,
            }
        );

        rx.try_recv().expect("release one frame");
        tx.send(rgba_output(4))
            .expect("released count capacity is reusable");
    }

    #[test]
    fn gfx_mailbox_byte_rejection_marks_a_broken_nal_chain() {
        let (tx, rx) = bounded_gfx_frame_channel_with_limits(4, 24);
        tx.send(rgba_output(4)).expect("12 retained bytes");
        assert!(matches!(
            tx.send(nal_output(1)),
            Err(mpsc::TrySendError::Full(_))
        ));
        assert_eq!(
            rx.take_pressure(),
            GfxFrameMailboxPressure {
                dropped_frames: 1,
                nal_chain_broken: true,
            }
        );
        assert_eq!(rx.take_pressure(), GfxFrameMailboxPressure::default());
    }

    #[test]
    fn gfx_mailbox_accepts_one_4096x2160_rgba_frame_within_aggregate_cap() {
        let rgba_bytes = 4096usize * 2160 * 4;
        assert!(rgba_bytes + 8 <= MAX_PENDING_GFX_FRAME_BYTES);

        let (tx, rx) = bounded_gfx_frame_channel();
        tx.send(rgba_output(rgba_bytes))
            .expect("one valid 4K decoded frame must reach the tiling consumer");
        let received = rx.try_recv().expect("4K decoded frame");
        assert_eq!(received.retained_bytes(), rgba_bytes + 8);
    }

    /// Wrap a GFX command body in a full RDPGFX PDU (header + body).
    fn gfx_pdu(cmd_id: GfxCmdId, body: &[u8]) -> Vec<u8> {
        let pdu_len = (RDPGFX_HEADER_SIZE + body.len()) as u32;
        let mut buf = Vec::with_capacity(RDPGFX_HEADER_SIZE + body.len());
        buf.extend_from_slice(&(cmd_id as u16).to_le_bytes());
        buf.extend_from_slice(&0u16.to_le_bytes()); // flags
        buf.extend_from_slice(&pdu_len.to_le_bytes());
        buf.extend_from_slice(body);
        buf
    }

    fn caps_confirm_body(version: u32) -> Vec<u8> {
        let mut body = Vec::with_capacity(12);
        body.extend_from_slice(&version.to_le_bytes());
        body.extend_from_slice(&4u32.to_le_bytes()); // capsDataLength
        body.extend_from_slice(&0u32.to_le_bytes()); // flags
        body
    }

    #[test]
    fn seeded_handle_reports_enabled_registered() {
        let (proc, _rx) = new_processor();
        let handle = proc.shared_diagnostics();
        let d = handle.lock().unwrap();
        assert_eq!(d.summary.enabled_count, 1);
        assert_eq!(d.summary.ready_count, 0);
        assert_eq!(d.summary.failed_count, 0);
        assert_eq!(d.codec, None);
        assert!(!d.nal_passthrough);
    }

    #[test]
    fn decoder_initialization_failure_is_attempted_once_until_reset() {
        use std::cell::Cell;

        let (mut proc, _rx) = new_processor();
        let calls = Cell::new(0);
        proc.ensure_decoder_with(1, |_| {
            calls.set(calls.get() + 1);
            Err(h264::H264Error::InitFailed(
                "missing optional module".into(),
            ))
        });
        proc.ensure_decoder_with(2, |_| {
            calls.set(calls.get() + 1);
            Err(h264::H264Error::InitFailed("must not run".into()))
        });
        assert_eq!(calls.get(), 1);

        proc.close(7);
        proc.ensure_decoder_with(1, |_| {
            calls.set(calls.get() + 1);
            Err(h264::H264Error::InitFailed("retry after close".into()))
        });
        assert_eq!(calls.get(), 2);
    }

    struct ReorderingDecoder {
        held: Option<u64>,
    }
    impl H264Decoder for ReorderingDecoder {
        fn decode(
            &mut self,
            _: &[u8],
            picture_id: u64,
        ) -> Result<Vec<DecodedFrame>, h264::H264Error> {
            if let Some(first) = self.held.take() {
                Ok(vec![
                    DecodedFrame {
                        picture_id,
                        width: 4,
                        height: 2,
                        rgba: vec![22; 32],
                    },
                    DecodedFrame {
                        picture_id: first,
                        width: 4,
                        height: 2,
                        rgba: vec![11; 32],
                    },
                ])
            } else {
                self.held = Some(picture_id);
                Ok(Vec::new())
            }
        }
        fn name(&self) -> &'static str {
            "reordering-test"
        }
    }

    fn avc_update(surface_id: u16, rect: GfxRect16, keyframe: bool) -> WireToSurface1 {
        let mut bitmap_data = 1u32.to_le_bytes().to_vec();
        for edge in [rect.left, rect.top, rect.right, rect.bottom] {
            bitmap_data.extend_from_slice(&edge.to_le_bytes());
        }
        bitmap_data.extend_from_slice(&[0, 0]); // quantization metadata
        bitmap_data.extend_from_slice(&[0, 0, 0, 1, if keyframe { 0x65 } else { 0x41 }, 0]);
        WireToSurface1 {
            surface_id,
            codec_id: CODEC_AVC420,
            pixel_format: 0x20,
            dest_rect: rect,
            bitmap_data,
        }
    }

    #[test]
    fn independent_surface_decoders_correlate_reordered_picture_masks() {
        let (mut proc, rx) = new_processor();
        for id in [1, 2] {
            proc.surfaces.create_surface(id, 4, 2);
            proc.surfaces
                .map_surface_to_output(id, u32::from(id) * 10, 0);
            proc.ensure_decoder_with(id, |_| {
                Ok((Box::new(ReorderingDecoder { held: None }), "test"))
            });
        }
        let left = GfxRect16 {
            left: 0,
            top: 0,
            right: 1,
            bottom: 1,
        };
        let right = GfxRect16 {
            left: 3,
            top: 1,
            right: 4,
            bottom: 2,
        };
        proc.decode_avc420(&avc_update(1, left, true));
        proc.decode_avc420(&avc_update(2, right, true));
        assert!(
            rx.try_recv().is_err(),
            "each independent decoder must hold its first picture"
        );
        proc.decode_avc420(&avc_update(1, right, false));
        let GfxOutput::Rgba(second) = rx.try_recv().unwrap() else {
            panic!()
        };
        let GfxOutput::Rgba(first) = rx.try_recv().unwrap() else {
            panic!()
        };
        assert_eq!(
            (second.screen_x, second.screen_y, second.rgba),
            (13, 1, vec![22; 4])
        );
        assert_eq!(
            (first.screen_x, first.screen_y, first.rgba),
            (10, 0, vec![11; 4])
        );
        assert!(proc
            .surfaces
            .get_surface(2)
            .unwrap()
            .rgba
            .iter()
            .all(|&b| b == 0));
        assert_eq!(proc.h264_decoders[&2].masks.len(), 1);
        assert!(proc.h264_decoders[&1].masks.is_empty());
    }

    #[test]
    fn decoder_surface_lru_is_bounded_and_reused_ids_reset_references() {
        let (mut proc, _) = new_processor();
        for id in 0..MAX_SURFACE_DECODERS as u16 {
            proc.ensure_decoder_with(id, |_| {
                Ok((Box::new(ReorderingDecoder { held: None }), "test"))
            });
        }
        proc.ensure_decoder_with(0, |_| panic!("live surface decoder must be reused"));
        proc.ensure_decoder_with(100, |_| {
            Ok((Box::new(ReorderingDecoder { held: None }), "test"))
        });
        assert_eq!(proc.h264_decoders.len(), MAX_SURFACE_DECODERS);
        assert!(proc.h264_decoders.contains_key(&0));
        assert!(!proc.h264_decoders.contains_key(&1));
        assert!(proc.h264_decoders[&100].needs_keyframe);
        let mut body = 0u16.to_le_bytes().to_vec();
        body.extend_from_slice(&4u16.to_le_bytes());
        body.extend_from_slice(&2u16.to_le_bytes());
        body.push(0x20);
        proc.process(7, &gfx_pdu(GfxCmdId::CreateSurface, &body))
            .unwrap();
        assert!(!proc.h264_decoders.contains_key(&0));
    }

    #[test]
    fn padded_avc_picture_uses_decoded_stride_and_preserves_unmasked_surface_pixels() {
        let mut surfaces = SurfaceManager::new();
        surfaces.create_surface(1, 5, 3);
        surfaces.map_surface_to_output(1, 100, 200);
        let surface = surfaces.get_surface_mut(1).unwrap();
        surface.rgba.fill(99);
        let rgba = (0..8 * 4 * 4).map(|i| (i % 251) as u8).collect();
        let frame = DecodedFrame {
            picture_id: 1,
            width: 8,
            height: 4,
            rgba,
        };
        let rects = [
            GfxRect16 {
                left: 1,
                top: 1,
                right: 2,
                bottom: 3,
            },
            GfxRect16 {
                left: 4,
                top: 2,
                right: 5,
                bottom: 3,
            },
        ];
        let output = apply_avc420_regions(surface, &frame, &rects)
            .unwrap()
            .unwrap();
        assert_eq!(
            (
                output.screen_x,
                output.screen_y,
                output.width,
                output.height
            ),
            (101, 201, 4, 2)
        );
        for y in 0..3 {
            for x in 0..5 {
                let target = (y * 5 + x) * 4;
                let changed = (x == 1 && y >= 1) || (x == 4 && y == 2);
                let expected = if changed {
                    &frame.rgba[(y * 8 + x) * 4..(y * 8 + x) * 4 + 4]
                } else {
                    &[99; 4]
                };
                assert_eq!(&surface.rgba[target..target + 4], expected);
                if x >= 1 && y >= 1 {
                    let packed = ((y - 1) * 4 + x - 1) * 4;
                    assert_eq!(&output.rgba[packed..packed + 4], expected);
                }
            }
        }
        assert!(apply_avc420_regions(surface, &frame, &[])
            .unwrap()
            .is_none());
        let before = surface.rgba.clone();
        assert!(apply_avc420_regions(
            surface,
            &frame,
            &[GfxRect16 {
                left: 4,
                top: 0,
                right: 6,
                bottom: 1
            }]
        )
        .is_err());
        assert_eq!(surface.rgba, before, "invalid masks never partially apply");
        surface.output_origin = Some((65535, 0));
        assert!(apply_avc420_regions(surface, &frame, &rects).is_err());
    }

    #[test]
    fn spec_wire_layout_routes_avc420_mask_and_surface_origin_to_passthrough() {
        let (mut proc, rx) = new_processor();
        proc.nal_passthrough = true;
        proc.surfaces.create_surface(7, 16, 16);
        proc.surfaces.map_surface_to_output(7, 200, 300);
        let rect = GfxRect16 {
            left: 5,
            top: 6,
            right: 9,
            bottom: 10,
        };
        let update = avc_update(7, rect, true);
        let mut body = 7u16.to_le_bytes().to_vec();
        body.extend_from_slice(&CODEC_AVC420.to_le_bytes());
        body.push(0x20);
        for edge in [rect.left, rect.top, rect.right, rect.bottom] {
            body.extend_from_slice(&edge.to_le_bytes());
        }
        body.extend_from_slice(&(update.bitmap_data.len() as u32).to_le_bytes());
        body.extend_from_slice(&update.bitmap_data);
        proc.process(7, &gfx_pdu(GfxCmdId::WireToSurface1, &body))
            .unwrap();
        let GfxOutput::Nal(nal) = rx.try_recv().unwrap() else {
            panic!()
        };
        assert_eq!(
            (nal.screen_x, nal.screen_y, nal.dest_w, nal.dest_h),
            (200, 300, 16, 16)
        );
        assert_eq!(nal.region_rects, vec![rect]);
        assert_eq!(nal.coded_width, 0);
        assert_eq!(nal.nal_data, [0, 0, 0, 1, 0x65, 0]);
    }

    #[test]
    fn start_then_caps_confirm_drives_negotiating_then_ready_with_codec() {
        let (mut proc, _rx) = new_processor();
        let handle = proc.shared_diagnostics();

        proc.start(7).expect("gfx start");
        {
            let d = handle.lock().unwrap();
            // Negotiating is enabled but not yet ready.
            assert_eq!(d.summary.enabled_count, 1);
            assert_eq!(d.summary.ready_count, 0);
        }

        // AVC444 caps confirm → Ready + codec derived.
        let pdu = gfx_pdu(GfxCmdId::CapsConfirm, &caps_confirm_body(CAPVERSION_101));
        proc.process(7, &pdu).expect("caps confirm");
        let d = handle.lock().unwrap();
        assert_eq!(d.summary.ready_count, 1);
        assert_eq!(d.summary.failed_count, 0);
        assert_eq!(d.codec, Some("AVC444"));
        assert_eq!(d.cap_version, Some(CAPVERSION_101));
    }

    #[test]
    fn avc420_caps_version_maps_to_avc420_codec() {
        let (mut proc, _rx) = new_processor();
        let handle = proc.shared_diagnostics();
        let pdu = gfx_pdu(GfxCmdId::CapsConfirm, &caps_confirm_body(CAPVERSION_10));
        proc.process(7, &pdu).expect("caps confirm");
        assert_eq!(handle.lock().unwrap().codec, Some("AVC420"));
    }

    #[test]
    fn structural_header_error_faults_channel() {
        let (mut proc, _rx) = new_processor();
        let handle = proc.shared_diagnostics();
        // A payload long enough to attempt header parse but with a pdu_len that
        // overruns the buffer → truncated PDU → fault.
        let mut bad = Vec::new();
        bad.extend_from_slice(&(GfxCmdId::CapsConfirm as u16).to_le_bytes());
        bad.extend_from_slice(&0u16.to_le_bytes());
        bad.extend_from_slice(&0xFFFF_FFFFu32.to_le_bytes()); // pdu_len overruns
        bad.extend_from_slice(&[0u8; 4]);
        proc.process(7, &bad).expect("process bad pdu");

        let d = handle.lock().unwrap();
        assert_eq!(d.summary.failed_count, 1);
        assert_eq!(d.summary.ready_count, 0);
        assert_eq!(d.last_error_class.as_deref(), Some("gfx_truncated_pdu"));
    }

    #[test]
    fn per_frame_decode_error_increments_count_without_faulting() {
        let (mut proc, _rx) = new_processor();
        let handle = proc.shared_diagnostics();

        // Reach Ready first.
        let caps = gfx_pdu(GfxCmdId::CapsConfirm, &caps_confirm_body(CAPVERSION_10));
        proc.process(7, &caps).expect("caps");
        assert_eq!(handle.lock().unwrap().summary.ready_count, 1);

        // WireToSurface1 with a bitmap that fails AVC420 parse: a malformed
        // CAVIDEO frame. This must increment pipeline_errors but NOT fault.
        // Build a minimal WireToSurface1 body with codec=CAVIDEO and a too-short
        // bitmap stream so Avc420BitmapStream::parse fails.
        // (We invoke the recoverable path directly to keep the test focused on
        // the fault distinction rather than the wire layout.)
        proc.record_pipeline_error("avc420_parse_error");
        proc.publish();

        let d = handle.lock().unwrap();
        assert_eq!(d.pipeline_errors, 1);
        assert_eq!(
            d.summary.ready_count, 1,
            "channel stays Ready on frame error"
        );
        assert_eq!(d.summary.failed_count, 0);
        assert_eq!(d.last_error_class.as_deref(), Some("avc420_parse_error"));
    }

    #[test]
    fn create_surface_updates_active_count_in_snapshot() {
        let (mut proc, _rx) = new_processor();
        let handle = proc.shared_diagnostics();

        // CreateSurface body: surface_id(u16) + width(u16) + height(u16) + pixelformat(u8).
        let mut body = Vec::new();
        body.extend_from_slice(&1u16.to_le_bytes());
        body.extend_from_slice(&16u16.to_le_bytes());
        body.extend_from_slice(&16u16.to_le_bytes());
        body.push(0x20);
        let pdu = gfx_pdu(GfxCmdId::CreateSurface, &body);
        proc.process(7, &pdu).expect("create surface");

        assert_eq!(handle.lock().unwrap().surfaces_active, 1);
    }

    #[test]
    fn end_frame_increments_acks_and_close_returns_to_registered() {
        let (mut proc, _rx) = new_processor();
        let handle = proc.shared_diagnostics();

        // StartFrame then EndFrame so a frame-ack is produced.
        let mut sf = Vec::new();
        sf.extend_from_slice(&0u32.to_le_bytes()); // timestamp
        sf.extend_from_slice(&1u32.to_le_bytes()); // frame_id
        let start_pdu = gfx_pdu(GfxCmdId::StartFrame, &sf);
        let mut ef = Vec::new();
        ef.extend_from_slice(&1u32.to_le_bytes()); // frame_id
        let end_pdu = gfx_pdu(GfxCmdId::EndFrame, &ef);

        proc.process(7, &start_pdu).expect("start frame");
        let acks = proc.process(7, &end_pdu).expect("end frame");
        assert_eq!(acks.len(), 1, "EndFrame returns a FrameAcknowledge PDU");

        // Force a publish (per-frame publish is bounded to every 30th frame).
        proc.publish();
        assert_eq!(handle.lock().unwrap().frame_acks_sent, 1);
        assert_eq!(handle.lock().unwrap().frames_decoded, 1);

        proc.close(7);
        let d = handle.lock().unwrap();
        assert_eq!(d.summary.enabled_count, 1);
        assert_eq!(d.summary.ready_count, 0);
    }

    #[test]
    fn diagnostics_serialize_with_camel_case_wire_keys() {
        let (mut proc, _rx) = new_processor();
        let caps = gfx_pdu(GfxCmdId::CapsConfirm, &caps_confirm_body(CAPVERSION_101));
        proc.process(7, &caps).expect("caps");
        let snapshot = proc.shared_diagnostics().lock().unwrap().clone();
        let json = serde_json::to_string(&snapshot).unwrap();
        assert!(json.contains("capVersion"));
        assert!(json.contains("surfacesActive"));
        assert!(json.contains("framesDecoded"));
        assert!(json.contains("frameAcksSent"));
        assert!(json.contains("pipelineErrors"));
        assert!(json.contains("\"codec\":\"AVC444\""));
    }
}
