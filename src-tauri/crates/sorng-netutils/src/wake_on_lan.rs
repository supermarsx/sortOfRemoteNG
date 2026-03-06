//! # wake_on_lan — WoL magic packet sender
//!
//! Generates and sends Wake-on-LAN magic packets to wake
//! remote machines by their MAC address.

use crate::types::*;

/// Build a WoL magic packet (102 bytes) for the given MAC address.
///
/// The magic packet consists of 6 bytes of 0xFF followed by
/// the target MAC address repeated 16 times.
pub fn build_magic_packet(mac: &str) -> Result<[u8; 102], String> {
    let parts: Vec<&str> = mac.split(|c| c == ':' || c == '-').collect();
    if parts.len() != 6 {
        return Err(format!("Invalid MAC address: {}", mac));
    }
    let mut mac_bytes = [0u8; 6];
    for (i, part) in parts.iter().enumerate() {
        mac_bytes[i] = u8::from_str_radix(part, 16)
            .map_err(|_| format!("Invalid hex byte: {}", part))?;
    }
    let mut packet = [0xFFu8; 102];
    for i in 0..16 {
        let offset = 6 + i * 6;
        packet[offset..offset + 6].copy_from_slice(&mac_bytes);
    }
    Ok(packet)
}

/// Build `etherwake` / `wakeonlan` command arguments.
pub fn build_wol_args(mac: &str, interface: Option<&str>, broadcast: Option<&str>) -> Vec<String> {
    let mut args = Vec::new();
    if let Some(iface) = interface {
        args.push("-i".to_string());
        args.push(iface.to_string());
    }
    if let Some(bc) = broadcast {
        args.push("-b".to_string());
        args.push(bc.to_string());
    }
    args.push(mac.to_string());
    args
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn magic_packet_valid() {
        let pkt = build_magic_packet("AA:BB:CC:DD:EE:FF").unwrap();
        assert_eq!(pkt.len(), 102);
        // First 6 bytes should be 0xFF
        assert!(pkt[..6].iter().all(|&b| b == 0xFF));
        // Byte 6 should be 0xAA
        assert_eq!(pkt[6], 0xAA);
        // Last 6 bytes should be the MAC
        assert_eq!(&pkt[96..102], &[0xAA, 0xBB, 0xCC, 0xDD, 0xEE, 0xFF]);
    }

    #[test]
    fn magic_packet_dash_separator() {
        let pkt = build_magic_packet("11-22-33-44-55-66").unwrap();
        assert_eq!(pkt[6], 0x11);
    }

    #[test]
    fn magic_packet_invalid() {
        assert!(build_magic_packet("invalid").is_err());
        assert!(build_magic_packet("AA:BB:CC").is_err());
    }

    #[test]
    fn wol_args() {
        let args = build_wol_args("AA:BB:CC:DD:EE:FF", Some("eth0"), None);
        assert!(args.contains(&"-i".to_string()));
        assert!(args.contains(&"AA:BB:CC:DD:EE:FF".to_string()));
    }
}
