//! AUDIN (Audio Input) Dynamic Virtual Channel processor.
//!
//! Implements MS-RDPEAI for redirecting local microphone input to the remote
//! RDP session. Audio is captured via `cpal` and streamed as PCM data.

use std::collections::VecDeque;
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};

use crate::ironrdp::pdu::PduResult;
use crate::ironrdp_core::impl_as_any;

use super::session_state::ChannelSummary;
use super::virtual_channels::{
    VirtualChannelDescriptor, VirtualChannelKind, VirtualChannelPriority, VirtualChannelState,
};

/// Cloneable handle to the AUDIN channel summary, shared between the
/// `AudinDvcProcessor` (which lives inside DRDYNVC after registration) and the
/// session runner (which keeps a clone so it can read AUDIN's *live* ready/fault
/// state for the lifecycle channel summary). Mirrors how CLIPRDR shares its
/// `SharedClipboardState` so the runner can read `ClipboardState::channel_summary()`.
pub type SharedAudinSummary = Arc<Mutex<ChannelSummary>>;

// AUDIN message types (MS-RDPEAI 2.2)
const MSG_SNDIN_VERSION: u8 = 0x01;
const MSG_SNDIN_FORMATS: u8 = 0x02;
const MSG_SNDIN_OPEN: u8 = 0x03;
const MSG_SNDIN_DATA: u8 = 0x04;
const MSG_SNDIN_FORMATCHANGE: u8 = 0x05;

const AUDIN_VERSION: u32 = 0x01;
const WAVE_FORMAT_PCM: u16 = 0x0001;

/// Negotiated audio format.
#[derive(Debug, Clone)]
struct AudinFormat {
    channels: u16,
    samples_per_sec: u32,
    bits_per_sample: u16,
    block_align: u16,
}

impl AudinFormat {
    fn metadata(&self, format_index: usize, frames_per_packet: u32) -> AudinAudioFormatMetadata {
        AudinAudioFormatMetadata {
            format_index,
            channels: self.channels,
            samples_per_sec: self.samples_per_sec,
            bits_per_sample: self.bits_per_sample,
            block_align: self.block_align,
            frames_per_packet: (frames_per_packet > 0).then_some(frames_per_packet),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudinAudioFormatMetadata {
    pub format_index: usize,
    pub channels: u16,
    pub samples_per_sec: u32,
    pub bits_per_sample: u16,
    pub block_align: u16,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub frames_per_packet: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudinDiagnostics {
    pub channel: VirtualChannelDescriptor,
    pub summary: ChannelSummary,
    pub ready_count: u64,
    pub fault_count: u64,
    pub accepted_format_count: u16,
    pub fallback_format_used: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub server_version: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub negotiated_format: Option<AudinAudioFormatMetadata>,
}

/// Wrapper to make cpal::Stream Send-safe. The Stream is always accessed
/// from the session thread that created it; cpal manages its own audio thread.
struct SendStream(#[allow(dead_code)] cpal::Stream);
unsafe impl Send for SendStream {}

/// DVC-based audio input (microphone) processor.
pub struct AudinDvcProcessor {
    session_id: String,
    enabled: bool,
    channel_id: u32,
    formats: Vec<AudinFormat>,
    active_format: Option<usize>,
    frames_per_packet: u32,
    capture_buffer: Arc<Mutex<VecDeque<u8>>>,
    _capture_stream: Option<SendStream>,
    open: bool,
    channel_state: VirtualChannelState,
    messages_received: u64,
    messages_sent: u64,
    ready_count: u64,
    fault_count: u64,
    last_error_class: Option<String>,
    server_version: Option<u32>,
    fallback_format_used: bool,
    /// Shared, runner-readable snapshot of the AUDIN channel summary. Updated on
    /// every channel-state transition so the session runner can merge AUDIN's
    /// live ready/fault/enabled counts into the lifecycle channel summary even
    /// though the processor itself is moved into DRDYNVC.
    shared_summary: SharedAudinSummary,
}

impl std::fmt::Debug for AudinDvcProcessor {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("AudinDvcProcessor")
            .field("session_id", &self.session_id)
            .field("enabled", &self.enabled)
            .field("open", &self.open)
            .field("channel_state", &self.channel_state)
            .finish_non_exhaustive()
    }
}

impl_as_any!(AudinDvcProcessor);

impl AudinDvcProcessor {
    pub fn new(session_id: String, enabled: bool) -> Self {
        let channel_state = if enabled {
            VirtualChannelState::Registered
        } else {
            VirtualChannelState::Disabled
        };
        Self {
            session_id,
            enabled,
            channel_id: 0,
            formats: Vec::new(),
            active_format: None,
            frames_per_packet: 0,
            capture_buffer: Arc::new(Mutex::new(VecDeque::new())),
            _capture_stream: Option::None,
            open: false,
            channel_state,
            messages_received: 0,
            messages_sent: 0,
            ready_count: 0,
            fault_count: 0,
            last_error_class: None,
            server_version: None,
            fallback_format_used: false,
            shared_summary: Arc::new(Mutex::new(channel_summary_for_state(channel_state))),
        }
    }

    /// Returns a cloneable handle to the live AUDIN channel summary. The runner
    /// holds this clone so it can read AUDIN's real ready/fault/enabled counts
    /// after the processor has been moved into DRDYNVC (mirrors how CLIPRDR
    /// shares its `SharedClipboardState`).
    pub fn shared_summary(&self) -> SharedAudinSummary {
        self.shared_summary.clone()
    }

    /// Push the current channel-state-derived summary into the shared handle so
    /// the runner observes the live transition.
    fn publish_summary(&self) {
        if let Ok(mut summary) = self.shared_summary.lock() {
            *summary = self.channel_summary();
        }
    }

    pub fn channel_descriptor(&self) -> VirtualChannelDescriptor {
        let mut descriptor = VirtualChannelDescriptor::new(
            "audin",
            VirtualChannelKind::Dynamic,
            VirtualChannelPriority::Optional,
            self.enabled,
        );
        descriptor.state = self.channel_state;
        descriptor.messages_received = self.messages_received;
        descriptor.messages_sent = self.messages_sent;
        descriptor.last_error_class = self.last_error_class.clone();
        descriptor
    }

    pub fn channel_summary(&self) -> ChannelSummary {
        channel_summary_for_state(self.channel_state)
    }

    pub fn diagnostics(&self) -> AudinDiagnostics {
        AudinDiagnostics {
            channel: self.channel_descriptor(),
            summary: self.channel_summary(),
            ready_count: self.ready_count,
            fault_count: self.fault_count,
            accepted_format_count: self.formats.len().min(u16::MAX as usize) as u16,
            fallback_format_used: self.fallback_format_used,
            server_version: self.server_version,
            negotiated_format: self.active_format.and_then(|idx| {
                self.formats
                    .get(idx)
                    .map(|fmt| fmt.metadata(idx, self.frames_per_packet))
            }),
        }
    }

    pub fn set_enabled(&mut self, enabled: bool) {
        log::info!(
            "AUDIN session {}: audio input {}",
            self.session_id,
            if enabled { "enabled" } else { "disabled" }
        );
        self.enabled = enabled;
        if !enabled {
            // Stop capture
            self._capture_stream = None;
            self.open = false;
            self.set_channel_state(VirtualChannelState::Disabled);
        } else if self.channel_state == VirtualChannelState::Disabled {
            self.set_channel_state(VirtualChannelState::Registered);
        }
    }

    fn set_channel_state(&mut self, state: VirtualChannelState) {
        if state == VirtualChannelState::Ready && self.channel_state != VirtualChannelState::Ready {
            self.ready_count = self.ready_count.saturating_add(1);
        }
        if state != VirtualChannelState::Faulted {
            self.last_error_class = None;
        }
        self.channel_state = state;
        self.publish_summary();
    }

    fn set_enabled_channel_state(&mut self, state: VirtualChannelState) {
        if self.enabled {
            self.set_channel_state(state);
        } else {
            self.set_channel_state(VirtualChannelState::Disabled);
        }
    }

    fn mark_faulted(&mut self, class: &'static str) {
        if self.channel_state != VirtualChannelState::Faulted {
            self.fault_count = self.fault_count.saturating_add(1);
        }
        self.channel_state = VirtualChannelState::Faulted;
        self.last_error_class = Some(class.to_string());
        self.publish_summary();
    }

    fn record_received(&mut self) {
        self.messages_received = self.messages_received.saturating_add(1);
    }

    fn record_sent(&mut self, count: usize) {
        self.messages_sent = self.messages_sent.saturating_add(count as u64);
    }

    fn build_version() -> Vec<u8> {
        let mut buf = Vec::with_capacity(5);
        buf.push(MSG_SNDIN_VERSION);
        buf.extend_from_slice(&AUDIN_VERSION.to_le_bytes());
        buf
    }

    fn build_formats_reply(accepted: &[AudinFormat]) -> Vec<u8> {
        let mut buf = Vec::with_capacity(32);
        buf.push(MSG_SNDIN_FORMATS);
        buf.extend_from_slice(&(accepted.len() as u32).to_le_bytes()); // NumFormats
                                                                       // cbSizeFormatsPacket — total size of format data
        let fmt_data_size: u32 = accepted.len() as u32 * 18; // WAVEFORMATEX without extra
        buf.extend_from_slice(&fmt_data_size.to_le_bytes());

        for fmt in accepted {
            buf.extend_from_slice(&WAVE_FORMAT_PCM.to_le_bytes()); // wFormatTag
            buf.extend_from_slice(&fmt.channels.to_le_bytes());
            buf.extend_from_slice(&fmt.samples_per_sec.to_le_bytes());
            let avg_bytes = fmt.samples_per_sec * fmt.block_align as u32;
            buf.extend_from_slice(&avg_bytes.to_le_bytes()); // nAvgBytesPerSec
            buf.extend_from_slice(&fmt.block_align.to_le_bytes());
            buf.extend_from_slice(&fmt.bits_per_sample.to_le_bytes());
            buf.extend_from_slice(&0u16.to_le_bytes()); // cbSize = 0
        }
        buf
    }

    #[allow(dead_code)]
    fn build_open_reply() -> Vec<u8> {
        vec![MSG_SNDIN_DATA]
    }

    fn start_capture(&mut self) -> Vec<Vec<u8>> {
        if !self.enabled {
            log::info!(
                "AUDIN session {}: capture disabled, not starting",
                self.session_id
            );
            self.set_channel_state(VirtualChannelState::Disabled);
            return Vec::new();
        }

        let fmt = match self.active_format.and_then(|i| self.formats.get(i)) {
            Some(f) => f.clone(),
            None => {
                log::warn!(
                    "AUDIN session {}: no active format, can't start capture",
                    self.session_id
                );
                self.mark_faulted("missing_active_format");
                return Vec::new();
            }
        };

        log::info!(
            "AUDIN session {}: starting capture {}Hz {}ch {}bit, {} frames/pkt",
            self.session_id,
            fmt.samples_per_sec,
            fmt.channels,
            fmt.bits_per_sample,
            self.frames_per_packet
        );

        let buffer = self.capture_buffer.clone();

        // Try to open the default input device via cpal
        use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
        let host = cpal::default_host();
        let device = match host.default_input_device() {
            Some(d) => d,
            None => {
                log::warn!(
                    "AUDIN session {}: no input device available",
                    self.session_id
                );
                self.mark_faulted("input_device_unavailable");
                return Vec::new();
            }
        };

        let config = cpal::StreamConfig {
            channels: fmt.channels,
            sample_rate: cpal::SampleRate(fmt.samples_per_sec),
            buffer_size: cpal::BufferSize::Default,
        };

        let session_id = self.session_id.clone();
        let stream = match device.build_input_stream(
            &config,
            move |data: &[i16], _: &cpal::InputCallbackInfo| {
                // Convert i16 samples to little-endian bytes
                let bytes: Vec<u8> = data.iter().flat_map(|s| s.to_le_bytes()).collect();
                if let Ok(mut buf) = buffer.lock() {
                    buf.extend(bytes);
                }
            },
            move |err| {
                log::error!("AUDIN session: capture error: {}", err);
            },
            None,
        ) {
            Ok(s) => s,
            Err(e) => {
                log::error!(
                    "AUDIN session {}: failed to build input stream: {}",
                    session_id,
                    e
                );
                self.mark_faulted("capture_stream_unavailable");
                return Vec::new();
            }
        };

        if let Err(e) = stream.play() {
            log::error!(
                "AUDIN session {}: failed to start capture: {}",
                self.session_id,
                e
            );
            self.mark_faulted("capture_start_failed");
            return Vec::new();
        }

        self._capture_stream = Some(SendStream(stream));
        self.open = true;
        self.set_channel_state(VirtualChannelState::Ready);
        log::info!("AUDIN session {}: capture started", self.session_id);
        Vec::new()
    }

    /// Drain captured audio and return Data PDUs.
    fn drain_audio(&mut self) -> Vec<Vec<u8>> {
        if !self.open || !self.enabled {
            return Vec::new();
        }

        let fmt = match self.active_format.and_then(|i| self.formats.get(i)) {
            Some(f) => f,
            None => return Vec::new(),
        };

        let packet_bytes = self.frames_per_packet as usize * fmt.block_align as usize;
        if packet_bytes == 0 {
            return Vec::new();
        }

        let mut pdus = Vec::new();
        let buffer = self.capture_buffer.clone();
        let mut buf = match buffer.lock() {
            Ok(b) => b,
            Err(_) => {
                self.mark_faulted("capture_buffer_unavailable");
                return Vec::new();
            }
        };

        while buf.len() >= packet_bytes {
            let mut data = Vec::with_capacity(1 + packet_bytes);
            data.push(MSG_SNDIN_DATA);
            for _ in 0..packet_bytes {
                data.push(buf.pop_front().expect("buf length checked >= packet_bytes"));
            }
            pdus.push(data);
        }

        pdus
    }

    fn parse_server_formats(&mut self, body: &[u8]) {
        if body.len() < 8 {
            self.mark_faulted("protocol_violation");
            return;
        }
        let num_formats = u32::from_le_bytes([body[0], body[1], body[2], body[3]]) as usize;
        // Skip cbSizeFormatsPacket (4 bytes)
        let mut offset = 8;

        self.formats.clear();
        self.fallback_format_used = false;
        let mut truncated = false;
        for _ in 0..num_formats {
            if offset + 18 > body.len() {
                truncated = true;
                break;
            }
            let tag = u16::from_le_bytes([body[offset], body[offset + 1]]);
            let channels = u16::from_le_bytes([body[offset + 2], body[offset + 3]]);
            let sample_rate = u32::from_le_bytes([
                body[offset + 4],
                body[offset + 5],
                body[offset + 6],
                body[offset + 7],
            ]);
            // skip nAvgBytesPerSec (4)
            let block_align = u16::from_le_bytes([body[offset + 12], body[offset + 13]]);
            let bits = u16::from_le_bytes([body[offset + 14], body[offset + 15]]);
            let cb_size = u16::from_le_bytes([body[offset + 16], body[offset + 17]]) as usize;
            offset += 18 + cb_size;

            if tag == WAVE_FORMAT_PCM {
                self.formats.push(AudinFormat {
                    channels,
                    samples_per_sec: sample_rate,
                    bits_per_sample: bits,
                    block_align,
                });
            }
        }

        // If no PCM format found, add a default
        if self.formats.is_empty() {
            self.fallback_format_used = true;
            self.formats.push(AudinFormat {
                channels: 1,
                samples_per_sec: 22050,
                bits_per_sample: 16,
                block_align: 2,
            });
        }

        if truncated {
            self.mark_faulted("protocol_violation");
        }

        log::info!(
            "AUDIN session {}: parsed {} server formats, accepted {} PCM formats",
            self.session_id,
            num_formats,
            self.formats.len()
        );
    }
}

/// Derive a `ChannelSummary` from a single AUDIN channel state. Shared by the
/// live `channel_summary()` accessor and the seed value placed into the shared
/// runner-readable summary handle at construction time.
fn channel_summary_for_state(state: VirtualChannelState) -> ChannelSummary {
    ChannelSummary {
        enabled_count: if state.is_enabled() { 1 } else { 0 },
        ready_count: if state.is_ready() { 1 } else { 0 },
        failed_count: if state.is_failed() { 1 } else { 0 },
    }
}

/// Raw bytes wrapper for DVC messages.
struct AudinDvcPdu(Vec<u8>);

impl crate::ironrdp_core::Encode for AudinDvcPdu {
    fn encode(
        &self,
        dst: &mut crate::ironrdp_core::WriteCursor<'_>,
    ) -> crate::ironrdp_core::EncodeResult<()> {
        crate::ironrdp_core::ensure_size!(in: dst, size: self.0.len());
        dst.write_slice(&self.0);
        Ok(())
    }
    fn name(&self) -> &'static str {
        "AudinDvcPdu"
    }
    fn size(&self) -> usize {
        self.0.len()
    }
}

impl crate::ironrdp_dvc::DvcEncode for AudinDvcPdu {}

impl crate::ironrdp_dvc::DvcProcessor for AudinDvcProcessor {
    fn channel_name(&self) -> &str {
        "AUDIO_INPUT"
    }

    fn start(&mut self, channel_id: u32) -> PduResult<Vec<crate::ironrdp_dvc::DvcMessage>> {
        self.channel_id = channel_id;
        self.set_enabled_channel_state(VirtualChannelState::Negotiating);
        log::info!(
            "AUDIN session {}: DVC channel opened (id={})",
            self.session_id,
            channel_id
        );
        // Send client version
        let version_pdu = Self::build_version();
        self.record_sent(1);
        Ok(vec![
            Box::new(AudinDvcPdu(version_pdu)) as crate::ironrdp_dvc::DvcMessage
        ])
    }

    fn process(
        &mut self,
        _channel_id: u32,
        payload: &[u8],
    ) -> PduResult<Vec<crate::ironrdp_dvc::DvcMessage>> {
        if payload.is_empty() {
            return Ok(Vec::new());
        }

        self.record_received();

        let msg_type = payload[0];
        let body = &payload[1..];

        match msg_type {
            MSG_SNDIN_VERSION => {
                if body.len() >= 4 {
                    let server_version = u32::from_le_bytes([body[0], body[1], body[2], body[3]]);
                    self.server_version = Some(server_version);
                    self.set_enabled_channel_state(VirtualChannelState::Negotiating);
                    log::info!(
                        "AUDIN session {}: server version {}",
                        self.session_id,
                        server_version
                    );
                }
                // We already sent our version in start()
                Ok(Vec::new())
            }
            MSG_SNDIN_FORMATS => {
                self.set_enabled_channel_state(VirtualChannelState::Negotiating);
                self.parse_server_formats(body);
                let reply = Self::build_formats_reply(&self.formats);
                self.record_sent(1);
                log::info!(
                    "AUDIN session {}: sending {} accepted formats",
                    self.session_id,
                    self.formats.len()
                );
                Ok(vec![
                    Box::new(AudinDvcPdu(reply)) as crate::ironrdp_dvc::DvcMessage
                ])
            }
            MSG_SNDIN_OPEN => {
                if body.len() >= 8 {
                    self.frames_per_packet =
                        u32::from_le_bytes([body[0], body[1], body[2], body[3]]);
                    let format_idx =
                        u32::from_le_bytes([body[4], body[5], body[6], body[7]]) as usize;
                    self.active_format = if format_idx < self.formats.len() {
                        Some(format_idx)
                    } else {
                        Some(0)
                    };
                    log::info!(
                        "AUDIN session {}: Open - format={} frames/pkt={}",
                        self.session_id,
                        format_idx,
                        self.frames_per_packet
                    );
                }
                // Start capture and send any initial data
                let audio_pdus = self.start_capture();
                let mut msgs: Vec<crate::ironrdp_dvc::DvcMessage> = audio_pdus
                    .into_iter()
                    .map(|d| Box::new(AudinDvcPdu(d)) as crate::ironrdp_dvc::DvcMessage)
                    .collect();
                // Also drain any immediately available audio
                let drain = self.drain_audio();
                msgs.extend(
                    drain
                        .into_iter()
                        .map(|d| Box::new(AudinDvcPdu(d)) as crate::ironrdp_dvc::DvcMessage),
                );
                self.record_sent(msgs.len());
                Ok(msgs)
            }
            MSG_SNDIN_FORMATCHANGE => {
                if body.len() >= 4 {
                    let new_idx = u32::from_le_bytes([body[0], body[1], body[2], body[3]]) as usize;
                    log::info!(
                        "AUDIN session {}: format change to {}",
                        self.session_id,
                        new_idx
                    );
                    self.active_format = if new_idx < self.formats.len() {
                        Some(new_idx)
                    } else {
                        self.mark_faulted("format_index_out_of_range");
                        self.active_format
                    };
                    // Restart capture with new format
                    self._capture_stream = None;
                    self.open = false;
                    self.start_capture();
                }
                Ok(Vec::new())
            }
            _ => {
                log::debug!(
                    "AUDIN session {}: unknown msg 0x{:02X}",
                    self.session_id,
                    msg_type
                );
                // Drain audio on any incoming message (server polls by sending data requests)
                let drain = self.drain_audio();
                self.record_sent(drain.len());
                Ok(drain
                    .into_iter()
                    .map(|d| Box::new(AudinDvcPdu(d)) as crate::ironrdp_dvc::DvcMessage)
                    .collect())
            }
        }
    }

    fn close(&mut self, _channel_id: u32) {
        log::info!("AUDIN session {}: DVC channel closed", self.session_id);
        self._capture_stream = None;
        self.open = false;
        self.set_enabled_channel_state(VirtualChannelState::Registered);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ironrdp_dvc::DvcProcessor;

    fn wave_format(tag: u16, channels: u16, sample_rate: u32, bits: u16) -> Vec<u8> {
        let block_align = channels * (bits / 8);
        let avg_bytes = sample_rate * block_align as u32;
        let mut bytes = Vec::with_capacity(18);
        bytes.extend_from_slice(&tag.to_le_bytes());
        bytes.extend_from_slice(&channels.to_le_bytes());
        bytes.extend_from_slice(&sample_rate.to_le_bytes());
        bytes.extend_from_slice(&avg_bytes.to_le_bytes());
        bytes.extend_from_slice(&block_align.to_le_bytes());
        bytes.extend_from_slice(&bits.to_le_bytes());
        bytes.extend_from_slice(&0u16.to_le_bytes());
        bytes
    }

    fn formats_payload(formats: Vec<Vec<u8>>) -> Vec<u8> {
        let mut payload = Vec::new();
        payload.push(MSG_SNDIN_FORMATS);
        payload.extend_from_slice(&(formats.len() as u32).to_le_bytes());
        payload.extend_from_slice(&((formats.len() * 18) as u32).to_le_bytes());
        for format in formats {
            payload.extend_from_slice(&format);
        }
        payload
    }

    fn open_payload(frames_per_packet: u32, format_index: u32) -> Vec<u8> {
        let mut payload = Vec::with_capacity(9);
        payload.push(MSG_SNDIN_OPEN);
        payload.extend_from_slice(&frames_per_packet.to_le_bytes());
        payload.extend_from_slice(&format_index.to_le_bytes());
        payload
    }

    #[test]
    fn audin_diagnostics_track_start_state_and_version_send() {
        let mut processor = AudinDvcProcessor::new("session-1".to_string(), true);

        let messages = processor.start(42).expect("audin start");
        let diagnostics = processor.diagnostics();

        assert_eq!(messages.len(), 1);
        assert_eq!(diagnostics.channel.name, "audin");
        assert_eq!(diagnostics.channel.kind, VirtualChannelKind::Dynamic);
        assert_eq!(
            diagnostics.channel.priority,
            VirtualChannelPriority::Optional
        );
        assert_eq!(diagnostics.channel.state, VirtualChannelState::Negotiating);
        assert_eq!(diagnostics.channel.messages_sent, 1);
        assert_eq!(diagnostics.summary.enabled_count, 1);
        assert_eq!(diagnostics.summary.ready_count, 0);
        assert_eq!(diagnostics.summary.failed_count, 0);
    }

    #[test]
    fn audin_diagnostics_surface_negotiated_metadata_without_cpal() {
        let mut processor = AudinDvcProcessor::new("session-1".to_string(), false);
        let formats = formats_payload(vec![wave_format(WAVE_FORMAT_PCM, 2, 44100, 16)]);

        let format_reply = processor.process(7, &formats).expect("formats reply");
        let open_reply = processor
            .process(7, &open_payload(512, 0))
            .expect("open reply");
        let diagnostics = processor.diagnostics();
        let negotiated = diagnostics
            .negotiated_format
            .as_ref()
            .expect("negotiated format metadata");

        assert_eq!(format_reply.len(), 1);
        assert!(open_reply.is_empty());
        assert_eq!(diagnostics.channel.state, VirtualChannelState::Disabled);
        assert_eq!(diagnostics.summary.enabled_count, 0);
        assert_eq!(diagnostics.channel.messages_received, 2);
        assert_eq!(diagnostics.channel.messages_sent, 1);
        assert_eq!(diagnostics.accepted_format_count, 1);
        assert!(!diagnostics.fallback_format_used);
        assert_eq!(negotiated.format_index, 0);
        assert_eq!(negotiated.channels, 2);
        assert_eq!(negotiated.samples_per_sec, 44100);
        assert_eq!(negotiated.bits_per_sample, 16);
        assert_eq!(negotiated.block_align, 4);
        assert_eq!(negotiated.frames_per_packet, Some(512));
    }

    #[test]
    fn audin_diagnostics_mark_safe_fallback_format_without_cpal() {
        let mut processor = AudinDvcProcessor::new("session-1".to_string(), false);
        let formats = formats_payload(vec![wave_format(0x0006, 1, 8000, 8)]);

        processor.process(7, &formats).expect("formats reply");
        processor
            .process(7, &open_payload(128, 0))
            .expect("open reply");
        let diagnostics = processor.diagnostics();
        let negotiated = diagnostics
            .negotiated_format
            .as_ref()
            .expect("fallback metadata");

        assert_eq!(diagnostics.accepted_format_count, 1);
        assert!(diagnostics.fallback_format_used);
        assert_eq!(negotiated.channels, 1);
        assert_eq!(negotiated.samples_per_sec, 22050);
        assert_eq!(negotiated.bits_per_sample, 16);
        assert_eq!(negotiated.block_align, 2);
        assert_eq!(negotiated.frames_per_packet, Some(128));
    }

    #[test]
    fn audin_fault_diagnostics_do_not_require_audio_devices() {
        let mut processor = AudinDvcProcessor::new("session-1".to_string(), true);

        processor
            .process(7, &open_payload(256, 0))
            .expect("open without formats");
        let diagnostics = processor.diagnostics();

        assert_eq!(diagnostics.channel.state, VirtualChannelState::Faulted);
        assert_eq!(diagnostics.summary.failed_count, 1);
        assert_eq!(diagnostics.fault_count, 1);
        assert_eq!(
            diagnostics.channel.last_error_class.as_deref(),
            Some("missing_active_format")
        );
    }

    #[test]
    fn audin_shared_summary_reflects_live_ready_and_fault_transitions() {
        let mut processor = AudinDvcProcessor::new("session-1".to_string(), true);
        let handle = processor.shared_summary();

        // Seeded at construction: enabled (Registered), not yet ready.
        {
            let summary = handle.lock().expect("summary lock");
            assert_eq!(summary.enabled_count, 1);
            assert_eq!(summary.ready_count, 0);
            assert_eq!(summary.failed_count, 0);
        }

        // Live ready transition surfaces through the shared handle.
        processor.set_channel_state(VirtualChannelState::Ready);
        {
            let summary = handle.lock().expect("summary lock");
            assert_eq!(summary.enabled_count, 1);
            assert_eq!(summary.ready_count, 1);
            assert_eq!(summary.failed_count, 0);
        }

        // Live fault transition surfaces through the shared handle.
        processor.mark_faulted("missing_active_format");
        {
            let summary = handle.lock().expect("summary lock");
            assert_eq!(summary.ready_count, 0);
            assert_eq!(summary.failed_count, 1);
        }
    }

    #[test]
    fn audin_ready_counter_tracks_ready_transitions() {
        let mut processor = AudinDvcProcessor::new("session-1".to_string(), true);

        processor.set_channel_state(VirtualChannelState::Ready);
        processor.set_channel_state(VirtualChannelState::Ready);
        let diagnostics = processor.diagnostics();

        assert_eq!(diagnostics.channel.state, VirtualChannelState::Ready);
        assert_eq!(diagnostics.summary.ready_count, 1);
        assert_eq!(diagnostics.ready_count, 1);
    }
}
