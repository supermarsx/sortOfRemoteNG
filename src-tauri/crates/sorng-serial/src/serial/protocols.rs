//! File transfer protocols for serial communication.
//!
//! Implements XMODEM (checksum + CRC-16), XMODEM-1K, YMODEM (batch),
//! and ZMODEM (streaming) protocol state machines.

use crate::serial::types::*;
use std::time::Instant;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Constants
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

pub const SOH: u8 = 0x01; // Start of XMODEM 128-byte block
pub const STX: u8 = 0x02; // Start of XMODEM 1024-byte block
pub const EOT: u8 = 0x04; // End of Transmission
pub const ACK: u8 = 0x06; // Acknowledge
pub const NAK: u8 = 0x15; // Negative Acknowledge
pub const CAN: u8 = 0x18; // Cancel
pub const SUB: u8 = 0x1A; // Padding byte (Ctrl-Z)
pub const C_BYTE: u8 = b'C'; // CRC mode request

// ZMODEM
pub const ZPAD: u8 = b'*';
pub const ZDLE: u8 = 0x18;
pub const ZBIN: u8 = b'A';
pub const ZHEX: u8 = b'B';
pub const ZBIN32: u8 = b'C';

// ZMODEM frame types
pub const ZRQINIT: u8 = 0x00;
pub const ZRINIT: u8 = 0x01;
pub const ZSINIT: u8 = 0x02;
pub const ZACK: u8 = 0x03;
pub const ZFILE: u8 = 0x04;
pub const ZSKIP: u8 = 0x05;
pub const ZNAK: u8 = 0x06;
pub const ZABORT: u8 = 0x07;
pub const ZFIN: u8 = 0x08;
pub const ZRPOS: u8 = 0x09;
pub const ZDATA: u8 = 0x0A;
pub const ZEOF: u8 = 0x0B;
pub const ZFERR: u8 = 0x0C;
pub const ZCRC: u8 = 0x0D;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  CRC calculations
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// CRC-16/XMODEM lookup table.
const CRC16_TABLE: [u16; 256] = {
    let mut table = [0u16; 256];
    let mut i = 0;
    while i < 256 {
        let mut crc = (i as u16) << 8;
        let mut j = 0;
        while j < 8 {
            if crc & 0x8000 != 0 {
                crc = (crc << 1) ^ 0x1021;
            } else {
                crc <<= 1;
            }
            j += 1;
        }
        table[i] = crc;
        i += 1;
    }
    table
};

/// Calculate CRC-16/XMODEM for a block of data.
pub fn crc16_xmodem(data: &[u8]) -> u16 {
    let mut crc: u16 = 0;
    for &byte in data {
        let index = ((crc >> 8) ^ (byte as u16)) as usize;
        crc = (crc << 8) ^ CRC16_TABLE[index];
    }
    crc
}

/// Calculate simple checksum (sum of all bytes mod 256).
pub fn xmodem_checksum(data: &[u8]) -> u8 {
    data.iter().fold(0u8, |acc, &b| acc.wrapping_add(b))
}

/// CRC-32 table for ZMODEM.
const CRC32_TABLE: [u32; 256] = {
    let mut table = [0u32; 256];
    let mut i = 0;
    while i < 256 {
        let mut crc = i as u32;
        let mut j = 0;
        while j < 8 {
            if crc & 1 != 0 {
                crc = (crc >> 1) ^ 0xEDB88320;
            } else {
                crc >>= 1;
            }
            j += 1;
        }
        table[i] = crc;
        i += 1;
    }
    table
};

/// Calculate CRC-32 for ZMODEM.
pub fn crc32(data: &[u8]) -> u32 {
    let mut crc: u32 = 0xFFFFFFFF;
    for &byte in data {
        let index = ((crc ^ byte as u32) & 0xFF) as usize;
        crc = (crc >> 8) ^ CRC32_TABLE[index];
    }
    crc ^ 0xFFFFFFFF
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  XMODEM
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// XMODEM transfer mode.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum XmodemMode {
    /// Original XMODEM with checksum.
    Checksum,
    /// XMODEM-CRC (CRC-16).
    Crc,
    /// XMODEM-1K (1024-byte blocks with CRC-16).
    OneK,
}

impl XmodemMode {
    pub fn block_size(&self) -> usize {
        match self {
            Self::Checksum | Self::Crc => 128,
            Self::OneK => 1024,
        }
    }

    pub fn header_byte(&self) -> u8 {
        match self {
            Self::Checksum | Self::Crc => SOH,
            Self::OneK => STX,
        }
    }
}

/// Build an XMODEM data block.
pub fn build_xmodem_block(
    block_num: u8,
    data: &[u8],
    mode: XmodemMode,
) -> Vec<u8> {
    let block_size = mode.block_size();
    let mut block = Vec::with_capacity(block_size + 5);

    // Header
    block.push(mode.header_byte());
    block.push(block_num);
    block.push(!block_num); // One's complement

    // Data (padded with SUB if needed)
    let mut padded = data.to_vec();
    padded.resize(block_size, SUB);
    block.extend_from_slice(&padded);

    // Error check
    match mode {
        XmodemMode::Checksum => {
            block.push(xmodem_checksum(&padded));
        }
        XmodemMode::Crc | XmodemMode::OneK => {
            let crc = crc16_xmodem(&padded);
            block.push((crc >> 8) as u8);
            block.push((crc & 0xFF) as u8);
        }
    }

    block
}

/// Verify an XMODEM data block.
pub fn verify_xmodem_block(block: &[u8], mode: XmodemMode) -> Result<(u8, Vec<u8>), String> {
    let block_size = mode.block_size();
    let expected_len = match mode {
        XmodemMode::Checksum => 3 + block_size + 1,
        XmodemMode::Crc | XmodemMode::OneK => 3 + block_size + 2,
    };

    if block.len() < expected_len {
        return Err(format!(
            "Block too short: {} < {}",
            block.len(),
            expected_len
        ));
    }

    let _header = block[0];
    let block_num = block[1];
    let block_complement = block[2];

    if block_num.wrapping_add(block_complement) != 0xFF {
        return Err(format!(
            "Block number complement mismatch: {} + {} ≠ 0xFF",
            block_num, block_complement
        ));
    }

    let data = &block[3..3 + block_size];

    match mode {
        XmodemMode::Checksum => {
            let expected = block[3 + block_size];
            let actual = xmodem_checksum(data);
            if expected != actual {
                return Err(format!("Checksum mismatch: {:02X} ≠ {:02X}", expected, actual));
            }
        }
        XmodemMode::Crc | XmodemMode::OneK => {
            let expected = ((block[3 + block_size] as u16) << 8) | (block[3 + block_size + 1] as u16);
            let actual = crc16_xmodem(data);
            if expected != actual {
                return Err(format!("CRC mismatch: {:04X} ≠ {:04X}", expected, actual));
            }
        }
    }

    Ok((block_num, data.to_vec()))
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  YMODEM
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Build a YMODEM block 0 (file header).
pub fn build_ymodem_header(file_name: &str, file_size: u64) -> Vec<u8> {
    let mut data = Vec::with_capacity(128);
    data.extend_from_slice(file_name.as_bytes());
    data.push(0x00); // NUL separator
    data.extend_from_slice(file_size.to_string().as_bytes());
    data.push(0x00); // NUL separator
    data.resize(128, 0x00); // Pad to 128 bytes

    build_xmodem_block(0, &data, XmodemMode::Crc)
}

/// Parse a YMODEM block 0 (file header).
pub fn parse_ymodem_header(data: &[u8]) -> Result<(String, u64), String> {
    // Find the file name (NUL-terminated)
    let name_end = data
        .iter()
        .position(|&b| b == 0x00)
        .ok_or("No NUL terminator in YMODEM header")?;
    let file_name = String::from_utf8_lossy(&data[..name_end]).to_string();

    if file_name.is_empty() {
        // Empty header signals end of batch
        return Ok((String::new(), 0));
    }

    // Parse file size after the NUL
    let size_start = name_end + 1;
    let size_end = data[size_start..]
        .iter()
        .position(|&b| b == 0x00 || b == b' ')
        .map(|p| p + size_start)
        .unwrap_or(data.len());
    let size_str = String::from_utf8_lossy(&data[size_start..size_end]);
    let file_size = size_str
        .parse::<u64>()
        .map_err(|e| format!("Failed to parse file size: {}", e))?;

    Ok((file_name, file_size))
}

/// Build a YMODEM end-of-batch header (all zeros).
pub fn build_ymodem_end_header() -> Vec<u8> {
    let data = vec![0u8; 128];
    build_xmodem_block(0, &data, XmodemMode::Crc)
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  ZMODEM helpers
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Encode a ZMODEM hex header.
pub fn encode_zhex_header(frame_type: u8, data: &[u8; 4]) -> Vec<u8> {
    let mut header = Vec::with_capacity(32);
    header.extend_from_slice(b"**\x18B"); // ZPAD ZPAD ZDLE ZHEX

    let mut payload = vec![frame_type];
    payload.extend_from_slice(data);

    let crc = crc16_xmodem(&payload);

    for &b in &payload {
        header.push(hex_nibble(b >> 4));
        header.push(hex_nibble(b & 0x0F));
    }
    header.push(hex_nibble((crc >> 12) as u8));
    header.push(hex_nibble((crc >> 8) as u8 & 0x0F));
    header.push(hex_nibble((crc >> 4) as u8 & 0x0F));
    header.push(hex_nibble(crc as u8 & 0x0F));
    header.push(b'\r');
    header.push(b'\n');

    header
}

/// Convert a nibble to an ASCII hex digit.
fn hex_nibble(n: u8) -> u8 {
    let n = n & 0x0F;
    if n < 10 {
        b'0' + n
    } else {
        b'a' + (n - 10)
    }
}

/// Build a ZMODEM ZRINIT frame.
pub fn build_zrinit(bufsize: u16) -> Vec<u8> {
    let data: [u8; 4] = [
        (bufsize & 0xFF) as u8,
        (bufsize >> 8) as u8,
        0, // Flags (can-full-duplex, can-overlap-io, etc.)
        0,
    ];
    encode_zhex_header(ZRINIT, &data)
}

/// Build a ZMODEM ZRQINIT frame.
pub fn build_zrqinit() -> Vec<u8> {
    encode_zhex_header(ZRQINIT, &[0, 0, 0, 0])
}

/// Build a ZMODEM ZFILE frame.
pub fn build_zfile() -> Vec<u8> {
    encode_zhex_header(ZFILE, &[0, 0, 0, 0])
}

/// Build a ZMODEM ZEOF frame with file offset.
pub fn build_zeof(offset: u32) -> Vec<u8> {
    let data: [u8; 4] = [
        (offset & 0xFF) as u8,
        ((offset >> 8) & 0xFF) as u8,
        ((offset >> 16) & 0xFF) as u8,
        ((offset >> 24) & 0xFF) as u8,
    ];
    encode_zhex_header(ZEOF, &data)
}

/// Build a ZMODEM ZFIN frame.
pub fn build_zfin() -> Vec<u8> {
    encode_zhex_header(ZFIN, &[0, 0, 0, 0])
}

/// Build a ZMODEM ZRPOS frame with file position.
pub fn build_zrpos(position: u32) -> Vec<u8> {
    let data: [u8; 4] = [
        (position & 0xFF) as u8,
        ((position >> 8) & 0xFF) as u8,
        ((position >> 16) & 0xFF) as u8,
        ((position >> 24) & 0xFF) as u8,
    ];
    encode_zhex_header(ZRPOS, &data)
}

/// Build a ZMODEM ZACK frame.
pub fn build_zack(position: u32) -> Vec<u8> {
    let data: [u8; 4] = [
        (position & 0xFF) as u8,
        ((position >> 8) & 0xFF) as u8,
        ((position >> 16) & 0xFF) as u8,
        ((position >> 24) & 0xFF) as u8,
    ];
    encode_zhex_header(ZACK, &data)
}

/// ZMODEM escape a byte (DLE encoding).
pub fn zmodem_escape(byte: u8) -> Vec<u8> {
    match byte {
        ZDLE | 0x10 | 0x11 | 0x13 | 0x90 | 0x91 | 0x93 => {
            vec![ZDLE, byte ^ 0x40]
        }
        _ => vec![byte],
    }
}

/// Escape a data block for ZMODEM transmission.
pub fn zmodem_escape_block(data: &[u8]) -> Vec<u8> {
    let mut escaped = Vec::with_capacity(data.len() * 2);
    for &b in data {
        escaped.extend(zmodem_escape(b));
    }
    escaped
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Transfer engine
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Progress callback type.
pub type ProgressCallback = Box<dyn Fn(&TransferProgress) + Send + Sync>;

/// Build transfer progress info.
pub fn build_progress(
    transfer_id: &str,
    session_id: &str,
    file_name: &str,
    file_size: u64,
    bytes_transferred: u64,
    block_number: u32,
    total_blocks: u32,
    protocol: TransferProtocol,
    direction: TransferDirection,
    state: TransferState,
    error_count: u32,
    retry_count: u32,
    start_time: Instant,
) -> TransferProgress {
    let elapsed_ms = start_time.elapsed().as_millis() as u64;
    let bytes_per_second = if elapsed_ms > 0 {
        (bytes_transferred as f64) / (elapsed_ms as f64 / 1000.0)
    } else {
        0.0
    };
    let percent_complete = if file_size > 0 {
        (bytes_transferred as f64 / file_size as f64) * 100.0
    } else {
        0.0
    };
    let remaining_bytes = file_size.saturating_sub(bytes_transferred);
    let eta_ms = if bytes_per_second > 0.0 {
        ((remaining_bytes as f64 / bytes_per_second) * 1000.0) as u64
    } else {
        0
    };

    TransferProgress {
        transfer_id: transfer_id.to_string(),
        session_id: session_id.to_string(),
        file_name: file_name.to_string(),
        file_size,
        bytes_transferred,
        block_number,
        total_blocks,
        protocol,
        direction,
        state,
        error_count,
        retry_count,
        bytes_per_second,
        elapsed_ms,
        eta_ms,
        percent_complete,
    }
}

/// Calculate total blocks for a file given the protocol.
pub fn calculate_total_blocks(file_size: u64, protocol: TransferProtocol) -> u32 {
    let block_size = protocol.block_size() as u64;
    if block_size == 0 {
        return 0;
    }
    ((file_size + block_size - 1) / block_size) as u32
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Kermit protocol helpers
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Kermit packet types.
pub mod kermit {
    pub const MARK: u8 = 0x01; // SOH
    pub const TYPE_SEND_INIT: u8 = b'S';
    pub const TYPE_FILE_HEADER: u8 = b'F';
    pub const TYPE_DATA: u8 = b'D';
    pub const TYPE_EOF: u8 = b'Z';
    pub const TYPE_BREAK: u8 = b'B';
    pub const TYPE_ACK: u8 = b'Y';
    pub const TYPE_NAK: u8 = b'N';
    pub const TYPE_ERROR: u8 = b'E';

    /// Kermit char encoding (printable offset).
    pub fn to_char(n: u8) -> u8 {
        n.wrapping_add(32)
    }

    /// Kermit char decoding.
    pub fn from_char(c: u8) -> u8 {
        c.wrapping_sub(32)
    }

    /// Build a Kermit packet.
    pub fn build_packet(seq: u8, ptype: u8, data: &[u8]) -> Vec<u8> {
        let len = data.len() as u8 + 3; // data + seq + type + checksum
        let mut packet = Vec::new();
        packet.push(MARK);
        packet.push(to_char(len));
        packet.push(to_char(seq & 63));
        packet.push(ptype);
        packet.extend_from_slice(data);

        // Type-1 checksum
        let sum: u32 = packet[1..].iter().map(|&b| b as u32).sum();
        let checksum = ((sum + (sum >> 6)) & 0x3F) as u8;
        packet.push(to_char(checksum));
        packet.push(b'\r');
        packet
    }

    /// Verify a Kermit packet checksum.
    pub fn verify_packet(packet: &[u8]) -> bool {
        if packet.len() < 5 || packet[0] != MARK {
            return false;
        }
        let len = from_char(packet[1]) as usize;
        if packet.len() < len + 2 {
            return false;
        }
        let sum: u32 = packet[1..1 + len].iter().map(|&b| b as u32).sum();
        let expected = to_char(((sum + (sum >> 6)) & 0x3F) as u8);
        packet[1 + len] == expected
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_crc16_xmodem_empty() {
        assert_eq!(crc16_xmodem(b""), 0);
    }

    #[test]
    fn test_crc16_xmodem_known() {
        // Known test vector: "123456789" → 0x31C3
        assert_eq!(crc16_xmodem(b"123456789"), 0x31C3);
    }

    #[test]
    fn test_xmodem_checksum() {
        let data = [1u8, 2, 3, 4, 5];
        assert_eq!(xmodem_checksum(&data), 15);
    }

    #[test]
    fn test_crc32_known() {
        // Known test vector: "123456789" → 0xCBF43926
        assert_eq!(crc32(b"123456789"), 0xCBF43926);
    }

    #[test]
    fn test_build_and_verify_xmodem_checksum() {
        let data = b"Hello, XMODEM!";
        let block = build_xmodem_block(1, data, XmodemMode::Checksum);
        assert_eq!(block[0], SOH);
        assert_eq!(block[1], 1);
        assert_eq!(block[2], 0xFE);
        let (num, payload) = verify_xmodem_block(&block, XmodemMode::Checksum).unwrap();
        assert_eq!(num, 1);
        assert_eq!(&payload[..data.len()], data);
    }

    #[test]
    fn test_build_and_verify_xmodem_crc() {
        let data = b"CRC mode data block";
        let block = build_xmodem_block(5, data, XmodemMode::Crc);
        let (num, payload) = verify_xmodem_block(&block, XmodemMode::Crc).unwrap();
        assert_eq!(num, 5);
        assert_eq!(&payload[..data.len()], data);
    }

    #[test]
    fn test_build_and_verify_xmodem_1k() {
        let data = vec![0x42u8; 512]; // Half a 1K block
        let block = build_xmodem_block(1, &data, XmodemMode::OneK);
        assert_eq!(block[0], STX);
        let (num, payload) = verify_xmodem_block(&block, XmodemMode::OneK).unwrap();
        assert_eq!(num, 1);
        assert_eq!(payload.len(), 1024);
        assert_eq!(&payload[..512], &data[..]);
        // Padding
        assert!(payload[512..].iter().all(|&b| b == SUB));
    }

    #[test]
    fn test_verify_xmodem_bad_checksum() {
        let mut block = build_xmodem_block(1, b"test", XmodemMode::Checksum);
        let last = block.len() - 1;
        block[last] ^= 0xFF; // Corrupt checksum
        assert!(verify_xmodem_block(&block, XmodemMode::Checksum).is_err());
    }

    #[test]
    fn test_verify_xmodem_bad_complement() {
        let mut block = build_xmodem_block(1, b"test", XmodemMode::Checksum);
        block[2] = 0x00; // Corrupt complement
        assert!(verify_xmodem_block(&block, XmodemMode::Checksum).is_err());
    }

    #[test]
    fn test_ymodem_header_roundtrip() {
        let header_block = build_ymodem_header("test.txt", 1024);
        // Verify the block
        let (num, data) = verify_xmodem_block(&header_block, XmodemMode::Crc).unwrap();
        assert_eq!(num, 0);
        let (name, size) = parse_ymodem_header(&data).unwrap();
        assert_eq!(name, "test.txt");
        assert_eq!(size, 1024);
    }

    #[test]
    fn test_ymodem_end_header() {
        let header = build_ymodem_end_header();
        let (num, data) = verify_xmodem_block(&header, XmodemMode::Crc).unwrap();
        assert_eq!(num, 0);
        let (name, size) = parse_ymodem_header(&data).unwrap();
        assert!(name.is_empty());
        assert_eq!(size, 0);
    }

    #[test]
    fn test_zmodem_escape() {
        assert_eq!(zmodem_escape(ZDLE), vec![ZDLE, ZDLE ^ 0x40]);
        assert_eq!(zmodem_escape(0x11), vec![ZDLE, 0x11 ^ 0x40]);
        assert_eq!(zmodem_escape(b'A'), vec![b'A']);
    }

    #[test]
    fn test_zmodem_escape_block() {
        let data = vec![0x41, ZDLE, 0x42, 0x11, 0x43];
        let escaped = zmodem_escape_block(&data);
        assert!(escaped.len() > data.len()); // ZDLE and 0x11 got escaped
    }

    #[test]
    fn test_build_zrinit() {
        let frame = build_zrinit(1024);
        assert!(frame.starts_with(b"**\x18B"));
    }

    #[test]
    fn test_build_zrqinit() {
        let frame = build_zrqinit();
        assert!(frame.starts_with(b"**\x18B"));
    }

    #[test]
    fn test_build_zeof() {
        let frame = build_zeof(1024);
        assert!(frame.starts_with(b"**\x18B"));
    }

    #[test]
    fn test_calculate_total_blocks() {
        assert_eq!(calculate_total_blocks(128, TransferProtocol::Xmodem), 1);
        assert_eq!(calculate_total_blocks(129, TransferProtocol::Xmodem), 2);
        assert_eq!(calculate_total_blocks(1024, TransferProtocol::Ymodem), 1);
        assert_eq!(calculate_total_blocks(0, TransferProtocol::Ascii), 0);
    }

    #[test]
    fn test_build_progress() {
        let start = Instant::now();
        let progress = build_progress(
            "xfer-1",
            "sess-1",
            "test.bin",
            10240,
            5120,
            40,
            80,
            TransferProtocol::Xmodem,
            TransferDirection::Send,
            TransferState::InProgress,
            0,
            0,
            start,
        );
        assert_eq!(progress.file_name, "test.bin");
        assert_eq!(progress.file_size, 10240);
        assert_eq!(progress.bytes_transferred, 5120);
        assert!((progress.percent_complete - 50.0).abs() < 0.1);
    }

    #[test]
    fn test_kermit_char_roundtrip() {
        for n in 0..95 {
            assert_eq!(kermit::from_char(kermit::to_char(n)), n);
        }
    }

    #[test]
    fn test_kermit_build_packet() {
        let packet = kermit::build_packet(0, kermit::TYPE_SEND_INIT, b"test");
        assert_eq!(packet[0], kermit::MARK);
        assert!(kermit::verify_packet(&packet));
    }

    #[test]
    fn test_kermit_verify_bad_packet() {
        assert!(!kermit::verify_packet(b""));
        assert!(!kermit::verify_packet(b"\x01\x20"));
        let mut packet = kermit::build_packet(0, kermit::TYPE_ACK, b"");
        let len = packet.len();
        if len >= 2 {
            packet[len - 2] ^= 0xFF; // Corrupt checksum
        }
        assert!(!kermit::verify_packet(&packet));
    }

    #[test]
    fn test_hex_nibble() {
        assert_eq!(hex_nibble(0), b'0');
        assert_eq!(hex_nibble(9), b'9');
        assert_eq!(hex_nibble(10), b'a');
        assert_eq!(hex_nibble(15), b'f');
    }
}
