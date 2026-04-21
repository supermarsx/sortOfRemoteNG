//! AUDIN (Audio Input) Dynamic Virtual Channel processor.
//!
//! Implements MS-RDPEAI for redirecting local microphone input to the remote
//! RDP session. Audio is captured via `cpal` and streamed as PCM data.

use std::collections::VecDeque;
use std::sync::{Arc, Mutex};

use crate::ironrdp_core::impl_as_any;
use crate::ironrdp::pdu::PduResult;

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
}

impl std::fmt::Debug for AudinDvcProcessor {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("AudinDvcProcessor")
            .field("session_id", &self.session_id)
            .field("enabled", &self.enabled)
            .field("open", &self.open)
            .finish_non_exhaustive()
    }
}

impl_as_any!(AudinDvcProcessor);

impl AudinDvcProcessor {
    pub fn new(session_id: String, enabled: bool) -> Self {
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
        }
    }

    pub fn set_enabled(&mut self, enabled: bool) {
        log::info!("AUDIN session {}: audio input {}", self.session_id, if enabled { "enabled" } else { "disabled" });
        self.enabled = enabled;
        if !enabled {
            // Stop capture
            self._capture_stream = None;
            self.open = false;
        }
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
            log::info!("AUDIN session {}: capture disabled, not starting", self.session_id);
            return Vec::new();
        }

        let fmt = match self.active_format.and_then(|i| self.formats.get(i)) {
            Some(f) => f.clone(),
            None => {
                log::warn!("AUDIN session {}: no active format, can't start capture", self.session_id);
                return Vec::new();
            }
        };

        log::info!(
            "AUDIN session {}: starting capture {}Hz {}ch {}bit, {} frames/pkt",
            self.session_id, fmt.samples_per_sec, fmt.channels, fmt.bits_per_sample, self.frames_per_packet
        );

        let buffer = self.capture_buffer.clone();

        // Try to open the default input device via cpal
        use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
        let host = cpal::default_host();
        let device = match host.default_input_device() {
            Some(d) => d,
            None => {
                log::warn!("AUDIN session {}: no input device available", self.session_id);
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
                let bytes: Vec<u8> = data.iter()
                    .flat_map(|s| s.to_le_bytes())
                    .collect();
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
                log::error!("AUDIN session {}: failed to build input stream: {}", session_id, e);
                return Vec::new();
            }
        };

        if let Err(e) = stream.play() {
            log::error!("AUDIN session {}: failed to start capture: {}", self.session_id, e);
            return Vec::new();
        }

        self._capture_stream = Some(SendStream(stream));
        self.open = true;
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
        let mut buf = match self.capture_buffer.lock() {
            Ok(b) => b,
            Err(_) => return Vec::new(),
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
        if body.len() < 8 { return; }
        let num_formats = u32::from_le_bytes([body[0], body[1], body[2], body[3]]) as usize;
        // Skip cbSizeFormatsPacket (4 bytes)
        let mut offset = 8;

        self.formats.clear();
        for _ in 0..num_formats {
            if offset + 18 > body.len() { break; }
            let tag = u16::from_le_bytes([body[offset], body[offset + 1]]);
            let channels = u16::from_le_bytes([body[offset + 2], body[offset + 3]]);
            let sample_rate = u32::from_le_bytes([body[offset + 4], body[offset + 5], body[offset + 6], body[offset + 7]]);
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
            self.formats.push(AudinFormat {
                channels: 1,
                samples_per_sec: 22050,
                bits_per_sample: 16,
                block_align: 2,
            });
        }

        log::info!("AUDIN session {}: parsed {} server formats, accepted {} PCM formats",
            self.session_id, num_formats, self.formats.len());
    }
}

/// Raw bytes wrapper for DVC messages.
struct AudinDvcPdu(Vec<u8>);

impl crate::ironrdp_core::Encode for AudinDvcPdu {
    fn encode(&self, dst: &mut crate::ironrdp_core::WriteCursor<'_>) -> crate::ironrdp_core::EncodeResult<()> {
        crate::ironrdp_core::ensure_size!(in: dst, size: self.0.len());
        dst.write_slice(&self.0);
        Ok(())
    }
    fn name(&self) -> &'static str { "AudinDvcPdu" }
    fn size(&self) -> usize { self.0.len() }
}

impl crate::ironrdp_dvc::DvcEncode for AudinDvcPdu {}

impl crate::ironrdp_dvc::DvcProcessor for AudinDvcProcessor {
    fn channel_name(&self) -> &str {
        "AUDIO_INPUT"
    }

    fn start(&mut self, channel_id: u32) -> PduResult<Vec<crate::ironrdp_dvc::DvcMessage>> {
        self.channel_id = channel_id;
        log::info!("AUDIN session {}: DVC channel opened (id={})", self.session_id, channel_id);
        // Send client version
        let version_pdu = Self::build_version();
        Ok(vec![Box::new(AudinDvcPdu(version_pdu)) as crate::ironrdp_dvc::DvcMessage])
    }

    fn process(&mut self, _channel_id: u32, payload: &[u8]) -> PduResult<Vec<crate::ironrdp_dvc::DvcMessage>> {
        if payload.is_empty() {
            return Ok(Vec::new());
        }

        let msg_type = payload[0];
        let body = &payload[1..];

        match msg_type {
            MSG_SNDIN_VERSION => {
                if body.len() >= 4 {
                    let server_version = u32::from_le_bytes([body[0], body[1], body[2], body[3]]);
                    log::info!("AUDIN session {}: server version {}", self.session_id, server_version);
                }
                // We already sent our version in start()
                Ok(Vec::new())
            }
            MSG_SNDIN_FORMATS => {
                self.parse_server_formats(body);
                let reply = Self::build_formats_reply(&self.formats);
                log::info!("AUDIN session {}: sending {} accepted formats", self.session_id, self.formats.len());
                Ok(vec![Box::new(AudinDvcPdu(reply)) as crate::ironrdp_dvc::DvcMessage])
            }
            MSG_SNDIN_OPEN => {
                if body.len() >= 8 {
                    self.frames_per_packet = u32::from_le_bytes([body[0], body[1], body[2], body[3]]);
                    let format_idx = u32::from_le_bytes([body[4], body[5], body[6], body[7]]) as usize;
                    self.active_format = if format_idx < self.formats.len() { Some(format_idx) } else { Some(0) };
                    log::info!("AUDIN session {}: Open - format={} frames/pkt={}", self.session_id, format_idx, self.frames_per_packet);
                }
                // Start capture and send any initial data
                let audio_pdus = self.start_capture();
                let mut msgs: Vec<crate::ironrdp_dvc::DvcMessage> = audio_pdus.into_iter()
                    .map(|d| Box::new(AudinDvcPdu(d)) as crate::ironrdp_dvc::DvcMessage)
                    .collect();
                // Also drain any immediately available audio
                let drain = self.drain_audio();
                msgs.extend(drain.into_iter().map(|d| Box::new(AudinDvcPdu(d)) as crate::ironrdp_dvc::DvcMessage));
                Ok(msgs)
            }
            MSG_SNDIN_FORMATCHANGE => {
                if body.len() >= 4 {
                    let new_idx = u32::from_le_bytes([body[0], body[1], body[2], body[3]]) as usize;
                    log::info!("AUDIN session {}: format change to {}", self.session_id, new_idx);
                    self.active_format = if new_idx < self.formats.len() { Some(new_idx) } else { self.active_format };
                    // Restart capture with new format
                    self._capture_stream = None;
                    self.open = false;
                    self.start_capture();
                }
                Ok(Vec::new())
            }
            _ => {
                log::debug!("AUDIN session {}: unknown msg 0x{:02X}", self.session_id, msg_type);
                // Drain audio on any incoming message (server polls by sending data requests)
                let drain = self.drain_audio();
                Ok(drain.into_iter().map(|d| Box::new(AudinDvcPdu(d)) as crate::ironrdp_dvc::DvcMessage).collect())
            }
        }
    }

    fn close(&mut self, _channel_id: u32) {
        log::info!("AUDIN session {}: DVC channel closed", self.session_id);
        self._capture_stream = None;
        self.open = false;
    }
}
