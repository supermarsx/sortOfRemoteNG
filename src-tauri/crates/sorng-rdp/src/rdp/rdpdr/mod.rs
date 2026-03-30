//! RDPDR (Device Redirection) static virtual channel implementation.
//!
//! Implements the MS-RDPEFS protocol for redirecting local filesystem drives,
//! printers, serial ports, and smart cards to a remote RDP session.

pub mod pdu;
pub mod filesystem;
pub mod printer;
pub mod serial;
pub mod smartcard;

use std::collections::HashMap;
use std::fmt;
use std::path::PathBuf;

use crate::ironrdp_core::impl_as_any;
use crate::ironrdp_svc::{SvcClientProcessor, SvcProcessor, SvcMessage, SvcEncode};
use crate::ironrdp::pdu::gcc::ChannelName;
use crate::ironrdp::pdu::PduResult;
use sorng_core::events::DynEventEmitter;

use super::settings::DriveRedirectionConfig;
use self::filesystem::FileSystemDevice;
use self::printer::PrinterDevice;
use self::serial::SerialDevice;
use self::smartcard::SmartCardDevice;
use self::pdu::*;

/// Which non-filesystem device types to announce to the server.
#[derive(Debug, Clone)]
pub struct DeviceFlags {
    pub printers: bool,
    pub ports: bool,
    pub smart_cards: bool,
}

#[derive(Debug, Clone, Copy, PartialEq)]
enum RdpdrState {
    WaitingServerAnnounce,
    WaitingCapabilities,
    WaitingClientIdConfirm,
    Ready,
}

/// RDPDR static virtual channel processor.
pub struct RdpdrClient {
    session_id: String,
    #[allow(dead_code)]
    emitter: DynEventEmitter,
    state: RdpdrState,
    server_version_major: u16,
    server_version_minor: u16,
    client_id: u32,
    drives: Vec<DriveRedirectionConfig>,
    device_flags: DeviceFlags,
    fs_devices: HashMap<u32, FileSystemDevice>,
    printer_devices: HashMap<u32, PrinterDevice>,
    serial_devices: HashMap<u32, SerialDevice>,
    smartcard_device: Option<(u32, SmartCardDevice)>,
    next_device_id: u32,
    pending_responses: Vec<Vec<u8>>,
}

impl fmt::Debug for RdpdrClient {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("RdpdrClient")
            .field("session_id", &self.session_id)
            .field("state", &self.state)
            .field("drives", &self.drives.len())
            .finish_non_exhaustive()
    }
}

impl_as_any!(RdpdrClient);
impl SvcClientProcessor for RdpdrClient {}

impl RdpdrClient {
    pub fn new(
        session_id: String,
        emitter: DynEventEmitter,
        drives: Vec<DriveRedirectionConfig>,
        device_flags: DeviceFlags,
    ) -> Self {
        Self {
            session_id,
            emitter,
            state: RdpdrState::WaitingServerAnnounce,
            server_version_major: 1,
            server_version_minor: 0,
            client_id: 0,
            drives,
            device_flags,
            fs_devices: HashMap::new(),
            printer_devices: HashMap::new(),
            serial_devices: HashMap::new(),
            smartcard_device: None,
            next_device_id: 1,
            pending_responses: Vec::new(),
        }
    }

    /// Take any pending IRP responses that need to be sent.
    pub fn take_pending_responses(&mut self) -> Vec<Vec<u8>> {
        std::mem::take(&mut self.pending_responses)
    }

    fn make_messages(&self, pdus: Vec<Vec<u8>>) -> Vec<SvcMessage> {
        pdus.into_iter()
            .map(|data| {
                log::info!("RDPDR session {}: sending {} bytes (component=0x{:04X} packetId=0x{:04X})",
                    self.session_id, data.len(),
                    if data.len() >= 2 { read_u16(&data, 0) } else { 0 },
                    if data.len() >= 4 { read_u16(&data, 2) } else { 0 },
                );
                SvcMessage::from(RdpdrPdu(data))
            })
            .collect()
    }

    /// Transport-agnostic RDPDR PDU processing. Returns raw response PDU bytes.
    /// Duplicates the dispatch logic from SvcProcessor::process() but collects
    /// raw bytes instead of SvcMessages (which have private internals).
    pub fn process_rdpdr_payload(&mut self, payload: &[u8]) -> Vec<Vec<u8>> {
        if payload.len() < 4 {
            log::warn!("RDPDR: payload too short ({} bytes)", payload.len());
            return Vec::new();
        }

        let component = read_u16(payload, 0);
        let packet_id = read_u16(payload, 2);
        let body = &payload[4..];

        log::info!(
            "RDPDR session {}: recv component=0x{:04X} packetId=0x{:04X} body_len={} state={:?}",
            self.session_id, component, packet_id, body.len(), self.state
        );

        if component != RDPDR_CTYP_CORE {
            return Vec::new();
        }

        // Call handlers — they return PduResult<Vec<SvcMessage>> but we intercept
        // via make_messages which wraps RdpdrPdu(Vec<u8>). We need raw bytes so
        // we stash them in pending_responses before make_messages wraps them.
        self.pending_responses.clear();

        let result = match packet_id {
            PAKID_CORE_SERVER_ANNOUNCE => {
                if body.len() >= 8 {
                    self.server_version_major = read_u16(body, 0);
                    self.server_version_minor = read_u16(body, 2);
                    self.client_id = read_u32(body, 4);
                    log::info!("RDPDR session {}: Server Announce v{}.{} clientId={} (state was {:?})", self.session_id, self.server_version_major, self.server_version_minor, self.client_id, self.state);
                }
                // Reset state — server can re-announce at any time (e.g., after reactivation)
                self.fs_devices.clear();
                self.printer_devices.clear();
                self.serial_devices.clear();
                self.smartcard_device = None;
                self.next_device_id = 1;
                let reply = build_client_announce_reply(1, 12, self.client_id);
                let name = build_client_name("SORNG");
                self.state = RdpdrState::WaitingCapabilities;
                vec![reply, name]
            }
            PAKID_CORE_SERVER_CAPABILITY => {
                self.state = RdpdrState::WaitingClientIdConfirm;
                let has_drives = !self.drives.is_empty();
                vec![build_client_capabilities(
                    self.device_flags.printers, self.device_flags.ports,
                    self.device_flags.smart_cards, has_drives,
                )]
            }
            PAKID_CORE_CLIENTID_CONFIRM => {
                if body.len() >= 8 {
                    self.client_id = read_u32(body, 4);
                }
                log::info!("RDPDR session {}: Client ID confirmed", self.session_id);
                self.state = RdpdrState::Ready;

                // Resolve drive letters and register devices
                let letter_assignments = resolve_drive_letters(&self.drives);
                let mut announced: Vec<(u32, char)> = Vec::new();
                for (drive_idx, letter) in &letter_assignments {
                    let drive_cfg = &self.drives[*drive_idx];
                    let device_id = self.next_device_id;
                    self.next_device_id += 1;
                    let fs_device = FileSystemDevice::new(device_id, PathBuf::from(&drive_cfg.path), drive_cfg.read_only);
                    self.fs_devices.insert(device_id, fs_device);
                    announced.push((device_id, *letter));
                    log::info!("RDPDR session {}: drive '{}' as {}:\\", self.session_id, drive_cfg.name, letter);
                }

                let mut buf = Vec::with_capacity(256);
                write_header(&mut buf, RDPDR_CTYP_CORE, PAKID_CORE_DEVICELIST_ANNOUNCE);
                let device_count_offset = buf.len();
                buf.extend_from_slice(&0u32.to_le_bytes()); // placeholder, filled below
                let mut total_devices: u32 = 0;

                // ── Filesystem drives ─────────────────────────────────
                for (idx, (device_id, letter)) in announced.iter().enumerate() {
                    let drive_cfg = &self.drives[letter_assignments[idx].0];
                    let display_name = format!("{}:\\", letter);
                    let device_data = encode_utf16le(&display_name);
                    buf.extend_from_slice(&RDPDR_DTYP_FILESYSTEM.to_le_bytes());
                    buf.extend_from_slice(&device_id.to_le_bytes());
                    let mut dos_name = [0u8; 8];
                    let name_str = format!("{}:", letter);
                    let name_bytes = name_str.as_bytes();
                    dos_name[..name_bytes.len().min(7)].copy_from_slice(&name_bytes[..name_bytes.len().min(7)]);
                    buf.extend_from_slice(&dos_name);
                    buf.extend_from_slice(&(device_data.len() as u32).to_le_bytes());
                    buf.extend_from_slice(&device_data);
                    total_devices += 1;
                    log::info!(
                        "RDPDR session {}: announced drive device_id={} dos_name='{}' -> '{}'",
                        self.session_id, device_id, name_str, drive_cfg.path
                    );
                }

                // ── Printer ───────────────────────────────────────────
                if self.device_flags.printers {
                    let printer_id = self.next_device_id;
                    self.next_device_id += 1;
                    let output_dir = dirs::data_dir()
                        .unwrap_or_else(|| PathBuf::from("."))
                        .join("com.sortofremote.ng")
                        .join("print-jobs");
                    let printer = PrinterDevice::new(
                        printer_id, "sortOfRemote PDF", output_dir,
                        self.session_id.clone(), self.emitter.clone(),
                    );
                    let device_data = printer.build_device_data();
                    buf.extend_from_slice(&RDPDR_DTYP_PRINT.to_le_bytes());
                    buf.extend_from_slice(&printer_id.to_le_bytes());
                    let mut dos_name = [0u8; 8];
                    dos_name[..6].copy_from_slice(b"PRN1\0\0");
                    buf.extend_from_slice(&dos_name);
                    buf.extend_from_slice(&(device_data.len() as u32).to_le_bytes());
                    buf.extend_from_slice(&device_data);
                    self.printer_devices.insert(printer_id, printer);
                    total_devices += 1;
                    log::info!("RDPDR session {}: announced printer device_id={}", self.session_id, printer_id);
                }

                // ── Smart Card ────────────────────────────────────────
                if self.device_flags.smart_cards {
                    let sc_id = self.next_device_id;
                    self.next_device_id += 1;
                    let sc = SmartCardDevice::new(sc_id, self.session_id.clone());
                    buf.extend_from_slice(&RDPDR_DTYP_SMARTCARD.to_le_bytes());
                    buf.extend_from_slice(&sc_id.to_le_bytes());
                    let mut dos_name = [0u8; 8];
                    dos_name[..5].copy_from_slice(b"SCARD");
                    buf.extend_from_slice(&dos_name);
                    buf.extend_from_slice(&0u32.to_le_bytes()); // DeviceDataLength = 0
                    self.smartcard_device = Some((sc_id, sc));
                    total_devices += 1;
                    log::info!("RDPDR session {}: announced smartcard device_id={}", self.session_id, sc_id);
                }

                // ── Serial Ports ──────────────────────────────────────
                // Serial ports are announced when the ports flag is set.
                // Without specific port configuration from settings, we
                // announce COM1 as a default so the server knows serial
                // redirect is available. Once settings support serial port
                // config, this section should iterate user-configured ports.
                if self.device_flags.ports {
                    let serial_id = self.next_device_id;
                    self.next_device_id += 1;
                    let device = serial::SerialDevice::new(serial_id, "COM1", self.session_id.clone());
                    buf.extend_from_slice(&RDPDR_DTYP_SERIAL.to_le_bytes());
                    buf.extend_from_slice(&serial_id.to_le_bytes());
                    let mut dos_name = [0u8; 8];
                    let name = b"COM1";
                    dos_name[..name.len().min(8)].copy_from_slice(&name[..name.len().min(8)]);
                    buf.extend_from_slice(&dos_name);
                    buf.extend_from_slice(&0u32.to_le_bytes()); // DeviceDataLength = 0
                    self.serial_devices.insert(serial_id, device);
                    total_devices += 1;
                    log::info!("RDPDR session {}: announced serial device_id={} port=COM1", self.session_id, serial_id);
                }

                // Patch the device count
                buf[device_count_offset..device_count_offset + 4]
                    .copy_from_slice(&total_devices.to_le_bytes());

                vec![buf]
            }
            PAKID_CORE_DEVICE_REPLY => {
                if body.len() >= 8 {
                    let device_id = read_u32(body, 0);
                    let result_code = read_u32(body, 4);
                    if result_code == STATUS_SUCCESS {
                        log::info!("RDPDR session {}: device {} accepted", self.session_id, device_id);
                    } else {
                        log::warn!("RDPDR session {}: device {} rejected (0x{:08X})", self.session_id, device_id, result_code);
                        self.fs_devices.remove(&device_id);
                    }
                }
                Vec::new()
            }
            PAKID_CORE_DEVICE_IOREQUEST => {
                if body.len() >= 20 {
                    let device_id = read_u32(body, 0);
                    let file_id = read_u32(body, 4);
                    let completion_id = read_u32(body, 8);
                    let major_function = read_u32(body, 12);
                    let minor_function = read_u32(body, 16);
                    let irp_data = &body[20..];
                    log::info!(
                        "RDPDR session {}: IRP dev={} file={} comp={} major=0x{:X} minor=0x{:X} data_len={}",
                        self.session_id, device_id, file_id, completion_id,
                        major_function, minor_function, irp_data.len()
                    );
                    // Route IRP to the correct device handler
                    let irp_result = if let Some(dev) = self.fs_devices.get_mut(&device_id) {
                        dev.handle_irp(major_function, minor_function, completion_id, file_id, irp_data)
                    } else if let Some(dev) = self.printer_devices.get_mut(&device_id) {
                        dev.handle_irp(major_function, minor_function, completion_id, file_id, irp_data)
                    } else if let Some(dev) = self.serial_devices.get_mut(&device_id) {
                        dev.handle_irp(major_function, minor_function, completion_id, file_id, irp_data)
                    } else if let Some((id, dev)) = &mut self.smartcard_device {
                        if *id == device_id { dev.handle_irp(major_function, minor_function, completion_id, file_id, irp_data) } else { None }
                    } else {
                        None
                    };

                    if let Some(response) = irp_result {
                        log::debug!(
                            "RDPDR session {}: IRP response {} bytes, status=0x{:08X}",
                            self.session_id, response.len(),
                            if response.len() >= 16 { read_u32(&response, 12) } else { 0 }
                        );
                        vec![response]
                    } else if self.fs_devices.contains_key(&device_id)
                        || self.printer_devices.contains_key(&device_id)
                        || self.serial_devices.contains_key(&device_id)
                        || self.smartcard_device.as_ref().map(|(id, _)| *id == device_id).unwrap_or(false)
                    {
                        // Device exists but handler returned None (discarded IRP)
                        Vec::new()
                    } else {
                        vec![build_io_completion(device_id, completion_id, STATUS_NOT_SUPPORTED, &[])]
                    }
                } else {
                    Vec::new()
                }
            }
            PAKID_CORE_USER_LOGGEDON => {
                log::info!("RDPDR session {}: user logged on", self.session_id);
                Vec::new()
            }
            _ => Vec::new(),
        };

        result
    }
}

/// Wrapper to make raw bytes encodable as an SVC message.
struct RdpdrPdu(Vec<u8>);

impl crate::ironrdp_core::Encode for RdpdrPdu {
    fn encode(&self, dst: &mut crate::ironrdp_core::WriteCursor<'_>) -> crate::ironrdp_core::EncodeResult<()> {
        crate::ironrdp_core::ensure_size!(in: dst, size: self.0.len());
        dst.write_slice(&self.0);
        Ok(())
    }
    fn name(&self) -> &'static str { "RdpdrPdu" }
    fn size(&self) -> usize { self.0.len() }
}

impl SvcEncode for RdpdrPdu {}

impl SvcProcessor for RdpdrClient {
    fn channel_name(&self) -> ChannelName {
        ChannelName::from_static(b"rdpdr\0\0\0")
    }

    fn start(&mut self) -> PduResult<Vec<SvcMessage>> {
        log::info!("RDPDR session {}: channel started, waiting for Server Announce", self.session_id);
        Ok(Vec::new())
    }

    fn process(&mut self, payload: &[u8]) -> PduResult<Vec<SvcMessage>> {
        log::info!("RDPDR SVC session {}: received {} bytes on static channel", self.session_id, payload.len());
        let raw_response = self.process_rdpdr_payload(payload);
        let messages = self.make_messages(raw_response);
        log::info!("RDPDR SVC session {}: returning {} SVC messages", self.session_id, messages.len());
        Ok(messages)
    }
}

// ── RDPSND SVC ───────────────────────────────────────────────────────
// MS-RDPEA: Remote Desktop Protocol Audio Output Virtual Channel.
// Handles format negotiation AND audio playback.

// rdpsnd PDU message types (MS-RDPEA 2.2.1)
const SNDC_CLOSE: u8 = 0x01;
const SNDC_WAVE: u8 = 0x02;
const SNDC_SETVOLUME: u8 = 0x03;
const SNDC_WAVECONFIRM: u8 = 0x05;
const SNDC_TRAINING: u8 = 0x06;
const SNDC_FORMATS: u8 = 0x07;
const SNDC_QUALITYMODE: u8 = 0x0C;
const SNDC_WAVE2: u8 = 0x0D;

const WAVE_FORMAT_PCM: u16 = 0x0001;

/// Negotiated audio format descriptor.
#[derive(Debug, Clone)]
#[allow(dead_code)]
struct AudioFormat {
    format_tag: u16,
    channels: u16,
    samples_per_sec: u32,
    bits_per_sample: u16,
    block_align: u16,
}

/// Rdpsnd SVC — format negotiation + audio playback via frontend WebAudio.
pub struct RdpsndClient {
    session_id: String,
    emitter: DynEventEmitter,
    enabled: bool,
    negotiated: bool,
    formats: Vec<AudioFormat>,
    // Legacy SNDC_WAVE state (two-PDU path)
    pending_wave: Option<PendingWave>,
}

struct PendingWave {
    timestamp: u16,
    format_no: u16,
    block_no: u8,
    first_4: [u8; 4],
    total_size: usize, // audio data total = body_size - 12
}

impl fmt::Debug for RdpsndClient {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("RdpsndClient")
            .field("session_id", &self.session_id)
            .field("enabled", &self.enabled)
            .field("negotiated", &self.negotiated)
            .field("formats", &self.formats.len())
            .finish()
    }
}

impl RdpsndClient {
    pub fn new(session_id: String, emitter: DynEventEmitter, enabled: bool) -> Self {
        Self {
            session_id,
            emitter,
            enabled,
            negotiated: false,
            formats: Vec::new(),
            pending_wave: None,
        }
    }

    pub fn set_enabled(&mut self, enabled: bool) {
        log::info!("RDPSND session {}: audio playback {}", self.session_id, if enabled { "enabled" } else { "muted" });
        self.enabled = enabled;
    }

    fn build_header(msg_type: u8, body_size: u16) -> Vec<u8> {
        let mut buf = Vec::with_capacity(4 + body_size as usize);
        buf.push(msg_type);
        buf.push(0);
        buf.extend_from_slice(&body_size.to_le_bytes());
        buf
    }

    fn build_formats_reply(&self, server_version: u16) -> Vec<u8> {
        let pcm_format = Self::build_pcm_format(2, 44100, 16);
        let body_size: u16 = 4 + 4 + 4 + 2 + 2 + 1 + 2 + 1 + pcm_format.len() as u16;
        let mut buf = Self::build_header(SNDC_FORMATS, body_size);
        buf.extend_from_slice(&0u32.to_le_bytes()); // dwFlags
        buf.extend_from_slice(&0xFFFFu32.to_le_bytes()); // dwVolume
        buf.extend_from_slice(&0u32.to_le_bytes()); // dwPitch
        buf.extend_from_slice(&0u16.to_le_bytes()); // wDGramPort
        buf.extend_from_slice(&1u16.to_le_bytes()); // wNumberOfFormats = 1
        buf.push(0); // cLastBlockConfirmed
        buf.extend_from_slice(&server_version.min(0x0006).to_le_bytes());
        buf.push(0); // bPad
        buf.extend_from_slice(&pcm_format);
        buf
    }

    fn build_pcm_format(channels: u16, sample_rate: u32, bits: u16) -> Vec<u8> {
        let block_align = channels * (bits / 8);
        let avg_bytes = sample_rate * block_align as u32;
        let mut buf = Vec::with_capacity(18);
        buf.extend_from_slice(&WAVE_FORMAT_PCM.to_le_bytes());
        buf.extend_from_slice(&channels.to_le_bytes());
        buf.extend_from_slice(&sample_rate.to_le_bytes());
        buf.extend_from_slice(&avg_bytes.to_le_bytes());
        buf.extend_from_slice(&block_align.to_le_bytes());
        buf.extend_from_slice(&bits.to_le_bytes());
        buf.extend_from_slice(&0u16.to_le_bytes()); // cbSize
        buf
    }

    fn build_training_confirm(timestamp: u16, pack_size: u16) -> Vec<u8> {
        let mut buf = Self::build_header(SNDC_TRAINING, 4);
        buf.extend_from_slice(&timestamp.to_le_bytes());
        buf.extend_from_slice(&pack_size.to_le_bytes());
        buf
    }

    fn build_quality_mode() -> Vec<u8> {
        let mut buf = Self::build_header(SNDC_QUALITYMODE, 2);
        buf.extend_from_slice(&0x0001u16.to_le_bytes()); // DYNAMIC
        buf
    }

    fn build_wave_confirm(timestamp: u16, block_no: u8) -> Vec<u8> {
        let mut buf = Self::build_header(SNDC_WAVECONFIRM, 4);
        buf.extend_from_slice(&timestamp.to_le_bytes());
        buf.push(block_no);
        buf.push(0); // bPad
        buf
    }

    /// Emit audio data to the frontend for WebAudio playback.
    fn emit_audio(&self, pcm_data: &[u8], format_no: u16) {
        let fmt = self.formats.get(format_no as usize);
        let (channels, sample_rate, bits) = match fmt {
            Some(f) => (f.channels, f.samples_per_sec, f.bits_per_sample),
            None => (2, 44100, 16), // fallback
        };

        use base64::Engine;
        let b64 = base64::engine::general_purpose::STANDARD.encode(pcm_data);

        let _ = self.emitter.emit_event(
            "rdp://audio-data",
            serde_json::json!({
                "sessionId": self.session_id,
                "pcmBase64": b64,
                "channels": channels,
                "sampleRate": sample_rate,
                "bitsPerSample": bits,
            }),
        );
    }

    /// Parse server formats from SNDC_FORMATS body to build our accepted list.
    fn parse_server_formats(&mut self, body: &[u8]) {
        // We only accept PCM, so store one format matching our reply
        self.formats.clear();
        self.formats.push(AudioFormat {
            format_tag: WAVE_FORMAT_PCM,
            channels: 2,
            samples_per_sec: 44100,
            bits_per_sample: 16,
            block_align: 4,
        });
    }
}

/// Wrapper for rdpsnd raw bytes as SVC message.
struct RdpsndPdu(Vec<u8>);

impl crate::ironrdp_core::Encode for RdpsndPdu {
    fn encode(&self, dst: &mut crate::ironrdp_core::WriteCursor<'_>) -> crate::ironrdp_core::EncodeResult<()> {
        crate::ironrdp_core::ensure_size!(in: dst, size: self.0.len());
        dst.write_slice(&self.0);
        Ok(())
    }
    fn name(&self) -> &'static str { "RdpsndPdu" }
    fn size(&self) -> usize { self.0.len() }
}

impl SvcEncode for RdpsndPdu {}

impl_as_any!(RdpsndClient);
impl SvcClientProcessor for RdpsndClient {}

impl SvcProcessor for RdpsndClient {
    fn channel_name(&self) -> ChannelName {
        ChannelName::from_static(b"rdpsnd\0\0")
    }

    fn start(&mut self) -> PduResult<Vec<SvcMessage>> {
        log::info!("RDPSND session {}: channel started (audio={})", self.session_id, self.enabled);
        Ok(Vec::new())
    }

    fn process(&mut self, payload: &[u8]) -> PduResult<Vec<SvcMessage>> {
        if payload.len() < 4 {
            return Ok(Vec::new());
        }

        let msg_type = payload[0];
        let body_size = u16::from_le_bytes([payload[2], payload[3]]) as usize;
        let body = &payload[4..];

        // Legacy SNDC_WAVE: the Wave PDU follows immediately with no header.
        // If we have a pending WaveInfo, this payload IS the Wave PDU data.
        if let Some(pending) = self.pending_wave.take() {
            // Wave PDU: first 4 bytes are padding (replace with WaveInfo's data[4])
            let skip = 4.min(body.len());
            let mut pcm = Vec::with_capacity(pending.total_size);
            pcm.extend_from_slice(&pending.first_4);
            if payload.len() > skip {
                pcm.extend_from_slice(&payload[skip..]);
            }

            if self.enabled {
                self.emit_audio(&pcm, pending.format_no);
            }

            let confirm = Self::build_wave_confirm(pending.timestamp, pending.block_no);
            return Ok(vec![SvcMessage::from(RdpsndPdu(confirm))]);
        }

        match msg_type {
            SNDC_FORMATS => {
                if body.len() < 20 { return Ok(Vec::new()); }
                let num_formats = u16::from_le_bytes([body[12], body[13]]);
                let server_version = u16::from_le_bytes([body[15], body[16]]);
                log::info!("RDPSND session {}: Server Formats v{} ({} formats)", self.session_id, server_version, num_formats);

                self.parse_server_formats(body);
                let reply = self.build_formats_reply(server_version);
                self.negotiated = true;
                Ok(vec![SvcMessage::from(RdpsndPdu(reply))])
            }
            SNDC_TRAINING => {
                if body.len() >= 4 {
                    let ts = u16::from_le_bytes([body[0], body[1]]);
                    let ps = u16::from_le_bytes([body[2], body[3]]);
                    log::info!("RDPSND session {}: Training (ts={}, size={})", self.session_id, ts, ps);
                    Ok(vec![SvcMessage::from(RdpsndPdu(Self::build_training_confirm(ts, ps)))])
                } else {
                    Ok(Vec::new())
                }
            }
            SNDC_WAVE2 => {
                // Modern single-PDU audio: 12-byte sub-header + PCM data
                if body.len() < 12 { return Ok(Vec::new()); }
                let timestamp = u16::from_le_bytes([body[0], body[1]]);
                let format_no = u16::from_le_bytes([body[2], body[3]]);
                let block_no = body[4];
                let pcm_data = &body[12..];

                log::debug!("RDPSND session {}: WAVE2 block={} fmt={} pcm={}B", self.session_id, block_no, format_no, pcm_data.len());

                if self.enabled {
                    self.emit_audio(pcm_data, format_no);
                }

                let confirm = Self::build_wave_confirm(timestamp, block_no);
                Ok(vec![SvcMessage::from(RdpsndPdu(confirm))])
            }
            SNDC_WAVE => {
                // Legacy two-PDU: WaveInfo (this PDU) + Wave (next PDU)
                if body.len() < 12 { return Ok(Vec::new()); }
                let timestamp = u16::from_le_bytes([body[0], body[1]]);
                let format_no = u16::from_le_bytes([body[2], body[3]]);
                let block_no = body[4];
                let mut first_4 = [0u8; 4];
                first_4.copy_from_slice(&body[8..12]);

                log::debug!("RDPSND session {}: WAVE block={} fmt={} body_size={}", self.session_id, block_no, format_no, body_size);

                // Store state; the next process() call will be the Wave PDU
                self.pending_wave = Some(PendingWave {
                    timestamp,
                    format_no,
                    block_no,
                    first_4,
                    total_size: body_size.saturating_sub(12),
                });
                Ok(Vec::new())
            }
            SNDC_SETVOLUME => {
                if body.len() >= 4 {
                    let vol = u32::from_le_bytes([body[0], body[1], body[2], body[3]]);
                    let left = (vol & 0xFFFF) as f32 / 65535.0;
                    let right = ((vol >> 16) & 0xFFFF) as f32 / 65535.0;
                    log::info!("RDPSND session {}: SetVolume left={:.0}% right={:.0}%", self.session_id, left * 100.0, right * 100.0);
                    let _ = self.emitter.emit_event("rdp://audio-volume", serde_json::json!({
                        "sessionId": self.session_id,
                        "left": left,
                        "right": right,
                    }));
                }
                Ok(Vec::new())
            }
            SNDC_QUALITYMODE => {
                Ok(vec![SvcMessage::from(RdpsndPdu(Self::build_quality_mode()))])
            }
            SNDC_CLOSE => {
                log::info!("RDPSND session {}: Close", self.session_id);
                let _ = self.emitter.emit_event("rdp://audio-close", serde_json::json!({
                    "sessionId": self.session_id,
                }));
                Ok(Vec::new())
            }
            _ => {
                log::debug!("RDPSND session {}: msgType=0x{:02X} ({}B), ignoring", self.session_id, msg_type, body.len());
                Ok(Vec::new())
            }
        }
    }
}

/// Resolve drive letters for all configured drives, avoiding collisions.
/// Returns Vec of (config_index, assigned_letter).
/// Auto-assigns from Z downward to avoid common Windows drive letters.
fn resolve_drive_letters(drives: &[DriveRedirectionConfig]) -> Vec<(usize, char)> {
    use std::collections::{HashMap, HashSet};

    let mut used: HashSet<char> = HashSet::new();
    let mut assignments: Vec<(usize, Option<char>)> = Vec::with_capacity(drives.len());

    // Phase 1: count preferences to detect conflicts
    let mut letter_counts: HashMap<char, usize> = HashMap::new();
    for drive in drives {
        if let Some(letter) = drive.preferred_letter {
            *letter_counts.entry(letter).or_insert(0) += 1;
        }
    }

    // Phase 2: assign unique preferences
    for (i, drive) in drives.iter().enumerate() {
        match drive.preferred_letter {
            Some(letter) if *letter_counts.get(&letter).unwrap_or(&0) == 1 => {
                used.insert(letter);
                assignments.push((i, Some(letter)));
            }
            _ => {
                assignments.push((i, None));
            }
        }
    }

    // Phase 3: resolve conflicts (first occurrence wins) + auto-assign from Z downward
    let mut seen_conflicts: HashSet<char> = HashSet::new();
    let mut auto_cursor = b'Z';

    for entry in assignments.iter_mut() {
        if entry.1.is_some() {
            continue;
        }

        let drive = &drives[entry.0];

        // Conflicting preference: first occurrence keeps the letter
        if let Some(letter) = drive.preferred_letter {
            if !seen_conflicts.contains(&letter) && !used.contains(&letter) {
                seen_conflicts.insert(letter);
                used.insert(letter);
                entry.1 = Some(letter);
                continue;
            }
        }

        // Auto-assign from Z downward
        while auto_cursor >= b'A' {
            let candidate = auto_cursor as char;
            auto_cursor -= 1;
            if !used.contains(&candidate) {
                used.insert(candidate);
                entry.1 = Some(candidate);
                break;
            }
        }

        if entry.1.is_none() {
            log::warn!("RDPDR: all 26 drive letters exhausted, skipping drive '{}'", drive.name);
        }
    }

    assignments.into_iter()
        .filter_map(|(i, letter)| letter.map(|l| (i, l)))
        .collect()
}

// ── DVC Adapter ──────────────────────────────────────────────────────
// Modern Windows servers route RDPDR through Dynamic Virtual Channels
// instead of the legacy static channel. This adapter wraps the RDPDR
// protocol state machine as a DvcProcessor.

/// DVC-based RDPDR processor for modern Windows servers.
pub struct RdpdrDvcProcessor {
    inner: RdpdrClient,
}

impl fmt::Debug for RdpdrDvcProcessor {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("RdpdrDvcProcessor")
            .field("session_id", &self.inner.session_id)
            .finish_non_exhaustive()
    }
}

impl_as_any!(RdpdrDvcProcessor);

/// Raw bytes wrapper for DVC messages.
struct RdpdrDvcPdu(Vec<u8>);

impl crate::ironrdp_core::Encode for RdpdrDvcPdu {
    fn encode(&self, dst: &mut crate::ironrdp_core::WriteCursor<'_>) -> crate::ironrdp_core::EncodeResult<()> {
        crate::ironrdp_core::ensure_size!(in: dst, size: self.0.len());
        dst.write_slice(&self.0);
        Ok(())
    }
    fn name(&self) -> &'static str { "RdpdrDvcPdu" }
    fn size(&self) -> usize { self.0.len() }
}

impl crate::ironrdp_dvc::DvcEncode for RdpdrDvcPdu {}

impl RdpdrDvcProcessor {
    pub fn new(
        session_id: String,
        emitter: DynEventEmitter,
        drives: Vec<DriveRedirectionConfig>,
        device_flags: DeviceFlags,
    ) -> Self {
        Self {
            inner: RdpdrClient::new(session_id, emitter, drives, device_flags),
        }
    }
}

impl crate::ironrdp_dvc::DvcProcessor for RdpdrDvcProcessor {
    fn channel_name(&self) -> &str {
        "RDPDR"
    }

    fn start(&mut self, _channel_id: u32) -> PduResult<Vec<crate::ironrdp_dvc::DvcMessage>> {
        log::info!("RDPDR DVC session {}: channel opened, waiting for Server Announce", self.inner.session_id);
        Ok(Vec::new())
    }

    fn process(&mut self, _channel_id: u32, payload: &[u8]) -> PduResult<Vec<crate::ironrdp_dvc::DvcMessage>> {
        log::info!("RDPDR DVC session {}: received {} bytes on dynamic channel", self.inner.session_id, payload.len());
        let raw_pdus = self.inner.process_rdpdr_payload(payload);
        let dvc_messages: Vec<crate::ironrdp_dvc::DvcMessage> = raw_pdus.into_iter()
            .map(|data| {
                log::info!("RDPDR DVC session {}: sending {} bytes response", self.inner.session_id, data.len());
                Box::new(RdpdrDvcPdu(data)) as crate::ironrdp_dvc::DvcMessage
            })
            .collect();
        log::info!("RDPDR DVC session {}: returning {} DVC messages", self.inner.session_id, dvc_messages.len());
        Ok(dvc_messages)
    }

    fn close(&mut self, _channel_id: u32) {
        log::info!("RDPDR DVC session {}: channel closed", self.inner.session_id);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cfg(name: &str, letter: Option<char>) -> DriveRedirectionConfig {
        DriveRedirectionConfig {
            name: name.to_string(),
            path: format!("C:\\{}", name),
            read_only: false,
            preferred_letter: letter,
        }
    }

    #[test]
    fn all_auto_assigns_z_downward() {
        let drives = vec![cfg("A", None), cfg("B", None), cfg("C", None)];
        let result = resolve_drive_letters(&drives);
        assert_eq!(result, vec![(0, 'Z'), (1, 'Y'), (2, 'X')]);
    }

    #[test]
    fn unique_preferences_honored() {
        let drives = vec![cfg("A", Some('D')), cfg("B", Some('E')), cfg("C", Some('F'))];
        let result = resolve_drive_letters(&drives);
        assert_eq!(result, vec![(0, 'D'), (1, 'E'), (2, 'F')]);
    }

    #[test]
    fn duplicate_preferences_first_wins() {
        let drives = vec![cfg("A", Some('D')), cfg("B", Some('D')), cfg("C", None)];
        let result = resolve_drive_letters(&drives);
        assert_eq!(result[0], (0, 'D'));
        assert_ne!(result[1].1, 'D');
        // All three get unique letters
        let letters: std::collections::HashSet<char> = result.iter().map(|(_, l)| *l).collect();
        assert_eq!(letters.len(), 3);
    }

    #[test]
    fn mixed_preferences_and_auto() {
        let drives = vec![cfg("A", Some('Z')), cfg("B", None), cfg("C", Some('X'))];
        let result = resolve_drive_letters(&drives);
        assert_eq!(result[0], (0, 'Z'));
        assert_eq!(result[2], (2, 'X'));
        // Auto gets Y (next from Z, but Z is taken)
        assert_eq!(result[1], (1, 'Y'));
    }

    #[test]
    fn preferred_common_letters_honored() {
        let drives = vec![cfg("A", Some('C')), cfg("B", Some('D'))];
        let result = resolve_drive_letters(&drives);
        assert_eq!(result, vec![(0, 'C'), (1, 'D')]);
    }
}
