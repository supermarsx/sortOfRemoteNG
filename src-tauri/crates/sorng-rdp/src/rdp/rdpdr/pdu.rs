//! MS-RDPEFS PDU definitions for the RDPDR (Device Redirection) virtual channel.
//!
//! Reference: [MS-RDPEFS] Remote Desktop Protocol: File System Virtual Channel Extension
//! https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-rdpefs


// ── RDPDR Header ─────────────────────────────────────────────────────

/// Component field value for core RDPDR packets.
pub const RDPDR_CTYP_CORE: u16 = 0x4472; // "Dr"

// Core Packet IDs
pub const PAKID_CORE_SERVER_ANNOUNCE: u16 = 0x496E;
pub const PAKID_CORE_CLIENTID_CONFIRM: u16 = 0x4343;
pub const PAKID_CORE_CLIENT_NAME: u16 = 0x434E;
pub const PAKID_CORE_DEVICELIST_ANNOUNCE: u16 = 0x4441;
pub const PAKID_CORE_DEVICE_REPLY: u16 = 0x6472;
pub const PAKID_CORE_DEVICE_IOREQUEST: u16 = 0x4952;
pub const PAKID_CORE_DEVICE_IOCOMPLETION: u16 = 0x4943;
pub const PAKID_CORE_SERVER_CAPABILITY: u16 = 0x5350;
pub const PAKID_CORE_CLIENT_CAPABILITY: u16 = 0x4350;
pub const PAKID_CORE_USER_LOGGEDON: u16 = 0x554C;

// Device types
pub const RDPDR_DTYP_SERIAL: u32 = 0x0000_0001;
pub const RDPDR_DTYP_PARALLEL: u32 = 0x0000_0002;
pub const RDPDR_DTYP_PRINT: u32 = 0x0000_0004;
pub const RDPDR_DTYP_FILESYSTEM: u32 = 0x0000_0008;
pub const RDPDR_DTYP_SMARTCARD: u32 = 0x0000_0020;

// Capability types
pub const CAP_GENERAL_TYPE: u16 = 0x0001;
pub const CAP_PRINTER_TYPE: u16 = 0x0002;
pub const CAP_PORT_TYPE: u16 = 0x0003;
pub const CAP_DRIVE_TYPE: u16 = 0x0004;
pub const CAP_SMARTCARD_TYPE: u16 = 0x0005;

// General capability flags
pub const RDPDR_IRP_MJ_CREATE: u32 = 0x0000_0001;
pub const RDPDR_IRP_MJ_CLEANUP: u32 = 0x0000_0002;
pub const RDPDR_IRP_MJ_CLOSE: u32 = 0x0000_0004;
pub const RDPDR_IRP_MJ_READ: u32 = 0x0000_0008;
pub const RDPDR_IRP_MJ_WRITE: u32 = 0x0000_0010;
pub const RDPDR_IRP_MJ_FLUSH_BUFFERS: u32 = 0x0000_0020;
pub const RDPDR_IRP_MJ_SHUTDOWN: u32 = 0x0000_0040;
pub const RDPDR_IRP_MJ_DEVICE_CONTROL: u32 = 0x0000_0080;
pub const RDPDR_IRP_MJ_QUERY_VOLUME_INFORMATION: u32 = 0x0000_0100;
pub const RDPDR_IRP_MJ_SET_VOLUME_INFORMATION: u32 = 0x0000_0200;
pub const RDPDR_IRP_MJ_QUERY_INFORMATION: u32 = 0x0000_0400;
pub const RDPDR_IRP_MJ_SET_INFORMATION: u32 = 0x0000_0800;
pub const RDPDR_IRP_MJ_DIRECTORY_CONTROL: u32 = 0x0000_1000;
pub const RDPDR_IRP_MJ_LOCK_CONTROL: u32 = 0x0000_2000;
pub const RDPDR_IRP_MJ_QUERY_SECURITY: u32 = 0x0000_4000;
pub const RDPDR_IRP_MJ_SET_SECURITY: u32 = 0x0000_8000;
pub const RDPDR_ALL_IRPS: u32 = 0x0000_FFFF;

// Extended PDU flags
pub const RDPDR_DEVICE_REMOVE_PDUS: u32 = 0x0000_0001;
pub const RDPDR_CLIENT_DISPLAY_NAME_PDU: u32 = 0x0000_0002;
pub const RDPDR_USER_LOGGEDON_PDU: u32 = 0x0000_0004;

// IRP Major Function codes
pub const IRP_MJ_CREATE: u32 = 0x0000_0000;
pub const IRP_MJ_CLOSE: u32 = 0x0000_0002;
pub const IRP_MJ_READ: u32 = 0x0000_0003;
pub const IRP_MJ_WRITE: u32 = 0x0000_0004;
pub const IRP_MJ_QUERY_INFORMATION: u32 = 0x0000_0005;
pub const IRP_MJ_SET_INFORMATION: u32 = 0x0000_0006;
pub const IRP_MJ_QUERY_VOLUME_INFORMATION: u32 = 0x0000_000A;
pub const IRP_MJ_SET_VOLUME_INFORMATION: u32 = 0x0000_000B;
pub const IRP_MJ_DIRECTORY_CONTROL: u32 = 0x0000_000C;
pub const IRP_MJ_DEVICE_CONTROL: u32 = 0x0000_000E;
pub const IRP_MJ_LOCK_CONTROL: u32 = 0x0000_0011;

// IRP Minor Function codes (for IRP_MJ_DIRECTORY_CONTROL)
pub const IRP_MN_QUERY_DIRECTORY: u32 = 0x0000_0001;
pub const IRP_MN_NOTIFY_CHANGE_DIRECTORY: u32 = 0x0000_0002;

// File information classes
pub const FILE_BASIC_INFORMATION: u32 = 4;
pub const FILE_STANDARD_INFORMATION: u32 = 5;
pub const FILE_ATTRIBUTE_TAG_INFORMATION: u32 = 35;
pub const FILE_BOTH_DIR_INFORMATION: u32 = 3;
pub const FILE_DIRECTORY_INFORMATION: u32 = 1;
pub const FILE_FULL_DIR_INFORMATION: u32 = 2;
pub const FILE_NAMES_INFORMATION: u32 = 12;
pub const FILE_END_OF_FILE_INFORMATION: u32 = 20;
pub const FILE_DISPOSITION_INFORMATION: u32 = 13;
pub const FILE_RENAME_INFORMATION: u32 = 10;
pub const FILE_ALLOCATION_INFORMATION: u32 = 19;

// Volume information classes
pub const FILE_FS_VOLUME_INFORMATION: u32 = 1;
pub const FILE_FS_SIZE_INFORMATION: u32 = 3;
pub const FILE_FS_ATTRIBUTE_INFORMATION: u32 = 5;
pub const FILE_FS_FULL_SIZE_INFORMATION: u32 = 7;
pub const FILE_FS_DEVICE_INFORMATION: u32 = 4;

// File attributes
pub const FILE_ATTRIBUTE_READONLY: u32 = 0x0000_0001;
pub const FILE_ATTRIBUTE_HIDDEN: u32 = 0x0000_0002;
pub const FILE_ATTRIBUTE_SYSTEM: u32 = 0x0000_0004;
pub const FILE_ATTRIBUTE_DIRECTORY: u32 = 0x0000_0010;
pub const FILE_ATTRIBUTE_ARCHIVE: u32 = 0x0000_0020;
pub const FILE_ATTRIBUTE_NORMAL: u32 = 0x0000_0080;

// Create disposition
pub const FILE_SUPERSEDE: u32 = 0;
pub const FILE_OPEN: u32 = 1;
pub const FILE_CREATE: u32 = 2;
pub const FILE_OPEN_IF: u32 = 3;
pub const FILE_OVERWRITE: u32 = 4;
pub const FILE_OVERWRITE_IF: u32 = 5;

// Create options
pub const FILE_DIRECTORY_FILE: u32 = 0x0000_0001;
pub const FILE_NON_DIRECTORY_FILE: u32 = 0x0000_0040;
pub const FILE_DELETE_ON_CLOSE: u32 = 0x0000_1000;

// NTSTATUS codes
pub const STATUS_SUCCESS: u32 = 0x0000_0000;
pub const STATUS_NO_MORE_FILES: u32 = 0x8000_0006;
pub const STATUS_NOT_SUPPORTED: u32 = 0xC000_00BB;
pub const STATUS_NO_SUCH_FILE: u32 = 0xC000_000F;
pub const STATUS_OBJECT_NAME_NOT_FOUND: u32 = 0xC000_0034;
pub const STATUS_OBJECT_NAME_COLLISION: u32 = 0xC000_0035;
pub const STATUS_ACCESS_DENIED: u32 = 0xC000_0022;
pub const STATUS_UNSUCCESSFUL: u32 = 0xC000_0001;
pub const STATUS_NOT_IMPLEMENTED: u32 = 0xC000_0002;
pub const STATUS_OBJECT_PATH_NOT_FOUND: u32 = 0xC000_003A;
pub const STATUS_DIRECTORY_NOT_EMPTY: u32 = 0xC000_0101;

// ── Helpers ──────────────────────────────────────────────────────────

/// Read a u16 LE from a byte slice at offset.
pub fn read_u16(data: &[u8], off: usize) -> u16 {
    u16::from_le_bytes([data[off], data[off + 1]])
}

/// Read a u32 LE from a byte slice at offset.
pub fn read_u32(data: &[u8], off: usize) -> u32 {
    u32::from_le_bytes([data[off], data[off + 1], data[off + 2], data[off + 3]])
}

/// Read a u64 LE from a byte slice at offset.
pub fn read_u64(data: &[u8], off: usize) -> u64 {
    u64::from_le_bytes([
        data[off], data[off+1], data[off+2], data[off+3],
        data[off+4], data[off+5], data[off+6], data[off+7],
    ])
}

/// Encode a null-terminated UTF-16LE string.
pub fn encode_utf16le(s: &str) -> Vec<u8> {
    let mut out: Vec<u8> = s.encode_utf16().flat_map(|ch| ch.to_le_bytes()).collect();
    out.push(0); out.push(0); // null terminator
    out
}

/// Decode a null-terminated UTF-16LE string from a byte slice.
pub fn decode_utf16le(data: &[u8]) -> String {
    let u16s: Vec<u16> = data.chunks_exact(2)
        .map(|pair| u16::from_le_bytes([pair[0], pair[1]]))
        .take_while(|&ch| ch != 0)
        .collect();
    String::from_utf16_lossy(&u16s)
}

// ── PDU Builders ─────────────────────────────────────────────────────

/// Build an RDPDR_HEADER (4 bytes).
pub fn write_header(buf: &mut Vec<u8>, component: u16, packet_id: u16) {
    buf.extend_from_slice(&component.to_le_bytes());
    buf.extend_from_slice(&packet_id.to_le_bytes());
}

/// Build Client Announce Reply.
pub fn build_client_announce_reply(version_major: u16, version_minor: u16, client_id: u32) -> Vec<u8> {
    let mut buf = Vec::with_capacity(12);
    write_header(&mut buf, RDPDR_CTYP_CORE, PAKID_CORE_CLIENTID_CONFIRM);
    buf.extend_from_slice(&version_major.to_le_bytes());
    buf.extend_from_slice(&version_minor.to_le_bytes());
    buf.extend_from_slice(&client_id.to_le_bytes());
    buf
}

/// Build Client Name Request.
pub fn build_client_name(computer_name: &str) -> Vec<u8> {
    let name_bytes = encode_utf16le(computer_name);
    let mut buf = Vec::with_capacity(16 + name_bytes.len());
    write_header(&mut buf, RDPDR_CTYP_CORE, PAKID_CORE_CLIENT_NAME);
    buf.extend_from_slice(&1u32.to_le_bytes()); // unicodeFlag = 1
    buf.extend_from_slice(&0u32.to_le_bytes()); // codePage = 0
    buf.extend_from_slice(&(name_bytes.len() as u32).to_le_bytes()); // computerNameLen
    buf.extend_from_slice(&name_bytes);
    buf
}

/// Build Client Core Capability Response.
pub fn build_client_capabilities(printers: bool, ports: bool, smart_cards: bool, has_drives: bool) -> Vec<u8> {
    // (cap_type, version, body)
    let mut caps: Vec<(u16, u32, Vec<u8>)> = Vec::new();

    // General capability set (always included)
    {
        let mut body = Vec::with_capacity(36);
        body.extend_from_slice(&0u32.to_le_bytes()); // osType
        body.extend_from_slice(&0u32.to_le_bytes()); // osVersion
        body.extend_from_slice(&1u16.to_le_bytes()); // protocolMajorVersion
        body.extend_from_slice(&12u16.to_le_bytes()); // protocolMinorVersion (0x000C = support dir notify)
        body.extend_from_slice(&RDPDR_ALL_IRPS.to_le_bytes()); // ioCode1
        body.extend_from_slice(&0u32.to_le_bytes()); // ioCode2
        let ext_pdu = RDPDR_DEVICE_REMOVE_PDUS | RDPDR_CLIENT_DISPLAY_NAME_PDU | RDPDR_USER_LOGGEDON_PDU;
        body.extend_from_slice(&ext_pdu.to_le_bytes()); // extendedPDU
        body.extend_from_slice(&1u32.to_le_bytes()); // extraFlags1 (ENABLE_ASYNCIO)
        body.extend_from_slice(&0u32.to_le_bytes()); // extraFlags2
        body.extend_from_slice(&0u32.to_le_bytes()); // specialTypeDeviceCap (reserved)
        caps.push((CAP_GENERAL_TYPE, 2, body)); // GENERAL_CAPABILITY_VERSION_02
    }

    // Drive capability (if drives configured)
    if has_drives {
        caps.push((CAP_DRIVE_TYPE, 2, Vec::new())); // DRIVE_CAPABILITY_VERSION_02
    }
    if printers {
        caps.push((CAP_PRINTER_TYPE, 1, Vec::new()));
    }
    if ports {
        caps.push((CAP_PORT_TYPE, 1, Vec::new()));
    }
    if smart_cards {
        caps.push((CAP_SMARTCARD_TYPE, 1, Vec::new()));
    }

    let mut buf = Vec::with_capacity(64);
    write_header(&mut buf, RDPDR_CTYP_CORE, PAKID_CORE_CLIENT_CAPABILITY);
    buf.extend_from_slice(&(caps.len() as u16).to_le_bytes()); // numCapabilities
    buf.extend_from_slice(&0u16.to_le_bytes()); // padding

    for (cap_type, version, body) in &caps {
        let cap_len = (4 + 4 + body.len()) as u16; // capType(2) + capLen(2) + version(4) + body
        buf.extend_from_slice(&cap_type.to_le_bytes());
        buf.extend_from_slice(&cap_len.to_le_bytes());
        buf.extend_from_slice(&version.to_le_bytes());
        buf.extend_from_slice(body);
    }

    buf
}

/// Build Client Device List Announce Request.
pub fn build_device_list_announce(devices: &[(u32, u32, &str, Vec<u8>)]) -> Vec<u8> {
    // devices: [(device_type, device_id, preferred_dos_name, device_data)]
    let mut buf = Vec::with_capacity(64);
    write_header(&mut buf, RDPDR_CTYP_CORE, PAKID_CORE_DEVICELIST_ANNOUNCE);
    buf.extend_from_slice(&(devices.len() as u32).to_le_bytes()); // deviceCount

    for (device_type, device_id, dos_name, device_data) in devices {
        buf.extend_from_slice(&device_type.to_le_bytes());
        buf.extend_from_slice(&device_id.to_le_bytes());
        // preferredDosName: 8 bytes, null-padded ASCII
        let mut name_buf = [0u8; 8];
        let name_bytes = dos_name.as_bytes();
        let copy_len = name_bytes.len().min(7); // leave room for null
        name_buf[..copy_len].copy_from_slice(&name_bytes[..copy_len]);
        buf.extend_from_slice(&name_buf);
        buf.extend_from_slice(&(device_data.len() as u32).to_le_bytes());
        buf.extend_from_slice(device_data);
    }

    buf
}

/// Build Device I/O Completion (response to an IRP).
pub fn build_io_completion(device_id: u32, completion_id: u32, io_status: u32, output: &[u8]) -> Vec<u8> {
    let mut buf = Vec::with_capacity(16 + output.len());
    write_header(&mut buf, RDPDR_CTYP_CORE, PAKID_CORE_DEVICE_IOCOMPLETION);
    buf.extend_from_slice(&device_id.to_le_bytes());
    buf.extend_from_slice(&completion_id.to_le_bytes());
    buf.extend_from_slice(&io_status.to_le_bytes());
    buf.extend_from_slice(output);
    buf
}

/// Convert a `SystemTime` to Windows FILETIME (100-nanosecond intervals since 1601-01-01).
pub fn system_time_to_filetime(st: std::time::SystemTime) -> u64 {
    // Unix epoch is 11644473600 seconds after Windows FILETIME epoch
    const EPOCH_DIFF: u64 = 11_644_473_600;
    match st.duration_since(std::time::UNIX_EPOCH) {
        Ok(dur) => (dur.as_secs() + EPOCH_DIFF) * 10_000_000 + dur.subsec_nanos() as u64 / 100,
        Err(_) => 0,
    }
}
