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
            .map(|data| SvcMessage::from(RdpdrPdu(data)).with_flags(ChannelFlags::SHOW_PROTOCOL))
            .collect()
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
        if payload.len() < 4 {
            log::warn!("RDPDR: payload too short ({} bytes)", payload.len());
            return Ok(Vec::new());
        }

        let component = read_u16(payload, 0);
        let packet_id = read_u16(payload, 2);
        let body = &payload[4..];

        if component != RDPDR_CTYP_CORE {
            log::debug!("RDPDR: ignoring non-core component 0x{:04X}", component);
            return Ok(Vec::new());
        }

        match packet_id {
            PAKID_CORE_SERVER_ANNOUNCE => self.handle_server_announce(body),
            PAKID_CORE_SERVER_CAPABILITY => self.handle_server_capability(body),
            PAKID_CORE_CLIENTID_CONFIRM => self.handle_client_id_confirm(body),
            PAKID_CORE_DEVICE_REPLY => self.handle_device_reply(body),
            PAKID_CORE_DEVICE_IOREQUEST => self.handle_io_request(body),
            PAKID_CORE_USER_LOGGEDON => {
                log::info!("RDPDR session {}: user logged on", self.session_id);
                Ok(Vec::new())
            }
            _ => {
                log::debug!("RDPDR: unhandled packet 0x{:04X}", packet_id);
                Ok(Vec::new())
            }
        }
    }
}

impl RdpdrClient {
    fn handle_server_announce(&mut self, body: &[u8]) -> PduResult<Vec<SvcMessage>> {
        if body.len() < 8 {
            return Ok(Vec::new());
        }
        self.server_version_major = read_u16(body, 0);
        self.server_version_minor = read_u16(body, 2);
        self.client_id = read_u32(body, 4);

        log::info!(
            "RDPDR session {}: Server Announce v{}.{} clientId={}",
            self.session_id, self.server_version_major, self.server_version_minor, self.client_id
        );

        self.state = RdpdrState::WaitingCapabilities;

        // Respond with Client Announce Reply + Client Name
        let reply = build_client_announce_reply(1, 12, self.client_id);
        let name = build_client_name("SORNG");
        Ok(self.make_messages(vec![reply, name]))
    }

    fn handle_server_capability(&mut self, _body: &[u8]) -> PduResult<Vec<SvcMessage>> {
        log::info!("RDPDR session {}: received Server Core Capability", self.session_id);
        self.state = RdpdrState::WaitingClientIdConfirm;

        let has_drives = !self.drives.is_empty();
        let caps = build_client_capabilities(
            self.device_flags.printers,
            self.device_flags.ports,
            self.device_flags.smart_cards,
            has_drives,
        );
        Ok(self.make_messages(vec![caps]))
    }

    fn handle_client_id_confirm(&mut self, body: &[u8]) -> PduResult<Vec<SvcMessage>> {
        if body.len() >= 8 {
            self.client_id = read_u32(body, 4);
        }
        log::info!("RDPDR session {}: Client ID confirmed: {}", self.session_id, self.client_id);
        self.state = RdpdrState::Ready;

        // Resolve drive letters with collision avoidance
        let letter_assignments = resolve_drive_letters(&self.drives);

        // Register filesystem devices and build announce PDU
        let mut announced: Vec<(u32, char)> = Vec::new();
        for (drive_idx, letter) in &letter_assignments {
            let drive_cfg = &self.drives[*drive_idx];
            let device_id = self.next_device_id;
            self.next_device_id += 1;
            let fs_device = FileSystemDevice::new(
                device_id,
                PathBuf::from(&drive_cfg.path),
                drive_cfg.read_only,
            );
            self.fs_devices.insert(device_id, fs_device);
            announced.push((device_id, *letter));
            log::info!(
                "RDPDR session {}: drive '{}' as {}:\\ → {:?} (read_only={})",
                self.session_id, drive_cfg.name, letter, drive_cfg.path, drive_cfg.read_only
            );
        }

        let mut buf = Vec::with_capacity(64);
        write_header(&mut buf, RDPDR_CTYP_CORE, PAKID_CORE_DEVICELIST_ANNOUNCE);
        buf.extend_from_slice(&(announced.len() as u32).to_le_bytes());

        for (idx, (device_id, letter)) in announced.iter().enumerate() {
            let drive_cfg = &self.drives[letter_assignments[idx].0];
            let device_data = encode_utf16le(&drive_cfg.path);

            buf.extend_from_slice(&RDPDR_DTYP_FILESYSTEM.to_le_bytes());
            buf.extend_from_slice(&device_id.to_le_bytes());
            // PreferredDosName: "X:" format, 8 bytes null-padded (MS-RDPEFS 2.2.2.9)
            let mut dos_name = [0u8; 8];
            dos_name[0] = *letter as u8;
            dos_name[1] = b':';
            buf.extend_from_slice(&dos_name);
            buf.extend_from_slice(&(device_data.len() as u32).to_le_bytes());
            buf.extend_from_slice(&device_data);
        }

        let _ = self.emitter.emit_event(
            "rdp://rdpdr-ready",
            serde_json::json!({
                "session_id": self.session_id,
                "drives": announced.len(),
            }),
        );

        Ok(self.make_messages(vec![buf]))
    }

    fn handle_device_reply(&mut self, body: &[u8]) -> PduResult<Vec<SvcMessage>> {
        if body.len() >= 8 {
            let device_id = read_u32(body, 0);
            let result_code = read_u32(body, 4);
            if result_code == STATUS_SUCCESS {
                log::info!("RDPDR session {}: device {} accepted by server", self.session_id, device_id);
            } else {
                log::warn!("RDPDR session {}: device {} rejected (0x{:08X})", self.session_id, device_id, result_code);
                self.fs_devices.remove(&device_id);
            }
        }
        Ok(Vec::new())
    }

    fn handle_io_request(&mut self, body: &[u8]) -> PduResult<Vec<SvcMessage>> {
        if body.len() < 20 {
            log::warn!("RDPDR: IO request too short");
            return Ok(Vec::new());
        }

        let device_id = read_u32(body, 0);
        let file_id = read_u32(body, 4);
        let completion_id = read_u32(body, 8);
        let major_function = read_u32(body, 12);
        let minor_function = read_u32(body, 16);
        let irp_data = &body[20..];

        let fs_device = match self.fs_devices.get_mut(&device_id) {
            Some(d) => d,
            None => {
                log::warn!("RDPDR: IO request for unknown device {}", device_id);
                let response = build_io_completion(device_id, completion_id, STATUS_NOT_SUPPORTED, &[]);
                return Ok(self.make_messages(vec![response]));
            }
        };

        let response = fs_device.handle_irp(major_function, minor_function, completion_id, file_id, irp_data);
        Ok(self.make_messages(vec![response]))
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
