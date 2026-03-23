//! RDPDR (Device Redirection) static virtual channel implementation.
//!
//! Implements the MS-RDPEFS protocol for redirecting local filesystem drives
//! to a remote RDP session.  Also announces printer/port/smartcard devices
//! (stub — I/O is not proxied for those device types).

pub mod pdu;
pub mod filesystem;

use std::collections::HashMap;
use std::fmt;
use std::path::PathBuf;

use crate::ironrdp_core::impl_as_any;
use crate::ironrdp_svc::{SvcClientProcessor, SvcProcessor, SvcMessage, ChannelFlags, SvcEncode};
use crate::ironrdp::pdu::gcc::ChannelName;
use crate::ironrdp::pdu::PduResult;
use sorng_core::events::DynEventEmitter;

use super::settings::DriveRedirectionConfig;
use self::filesystem::FileSystemDevice;
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
                SvcMessage::from(RdpdrPdu(data)).with_flags(ChannelFlags::SHOW_PROTOCOL)
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
            "RDPDR session {} (DVC): recv component=0x{:04X} packetId=0x{:04X} body_len={} state={:?}",
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
                let reply = build_client_announce_reply(1, 12, self.client_id);
                let name = build_client_name("SORNG");
                if body.len() >= 8 {
                    self.server_version_major = read_u16(body, 0);
                    self.server_version_minor = read_u16(body, 2);
                    self.client_id = read_u32(body, 4);
                    log::info!("RDPDR session {} (DVC): Server Announce v{}.{}", self.session_id, self.server_version_major, self.server_version_minor);
                }
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
                log::info!("RDPDR session {} (DVC): Client ID confirmed", self.session_id);
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
                    log::info!("RDPDR session {} (DVC): drive '{}' as {}:\\", self.session_id, drive_cfg.name, letter);
                }

                let mut buf = Vec::with_capacity(64);
                write_header(&mut buf, RDPDR_CTYP_CORE, PAKID_CORE_DEVICELIST_ANNOUNCE);
                buf.extend_from_slice(&(announced.len() as u32).to_le_bytes());
                for (idx, (device_id, letter)) in announced.iter().enumerate() {
                    let drive_cfg = &self.drives[letter_assignments[idx].0];
                    let device_data = encode_utf16le(&drive_cfg.path);
                    buf.extend_from_slice(&RDPDR_DTYP_FILESYSTEM.to_le_bytes());
                    buf.extend_from_slice(&device_id.to_le_bytes());
                    let mut dos_name = [0u8; 8];
                    dos_name[0] = *letter as u8;
                    dos_name[1] = b':';
                    buf.extend_from_slice(&dos_name);
                    buf.extend_from_slice(&(device_data.len() as u32).to_le_bytes());
                    buf.extend_from_slice(&device_data);
                }
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
                    if let Some(fs_device) = self.fs_devices.get_mut(&device_id) {
                        let response = fs_device.handle_irp(major_function, minor_function, completion_id, file_id, irp_data);
                        vec![response]
                    } else {
                        vec![build_io_completion(device_id, completion_id, STATUS_NOT_SUPPORTED, &[])]
                    }
                } else {
                    Vec::new()
                }
            }
            PAKID_CORE_USER_LOGGEDON => {
                log::info!("RDPDR session {} (DVC): user logged on", self.session_id);
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
        // Delegate to raw processor, wrap results as SVC messages
        let raw_response = self.process_rdpdr_payload(payload);
        Ok(self.make_messages(raw_response))
    }
}

// ── RDPSND stub SVC ──────────────────────────────────────────────────
// FreeRDP always loads an rdpsnd channel when RDPDR is active.
// Some Windows servers require rdpsnd to be present for RDPDR to work.

/// Minimal rdpsnd static virtual channel stub. Accepts incoming PDUs
/// but does not produce audio — its mere presence triggers the server
/// to activate device redirection.
#[derive(Debug)]
pub struct RdpsndStub;

impl_as_any!(RdpsndStub);
impl SvcClientProcessor for RdpsndStub {}

impl SvcProcessor for RdpsndStub {
    fn channel_name(&self) -> ChannelName {
        ChannelName::from_static(b"rdpsnd\0\0")
    }

    fn start(&mut self) -> PduResult<Vec<SvcMessage>> {
        log::info!("RDPSND stub: channel started");
        Ok(Vec::new())
    }

    fn process(&mut self, payload: &[u8]) -> PduResult<Vec<SvcMessage>> {
        log::debug!("RDPSND stub: received {} bytes (ignored)", payload.len());
        Ok(Vec::new())
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
        let raw_pdus = self.inner.process_rdpdr_payload(payload);
        let dvc_messages: Vec<crate::ironrdp_dvc::DvcMessage> = raw_pdus.into_iter()
            .map(|data| Box::new(RdpdrDvcPdu(data)) as crate::ironrdp_dvc::DvcMessage)
            .collect();
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
