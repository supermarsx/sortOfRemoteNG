//! RFB protocol message builders and parsers.
//!
//! Client → Server and Server → Client message framing per RFC 6143.

use crate::vnc::types::{
    ClientMessageType, EncodingType, PixelFormat, ServerMessageType,
};

// ── Client → Server message builders ────────────────────────────────────

/// Build SetPixelFormat message (§7.5.1).
/// 1 byte type + 3 padding + 16 bytes pixel format = 20 bytes.
pub fn build_set_pixel_format(pf: &PixelFormat) -> Vec<u8> {
    let mut buf = Vec::with_capacity(20);
    buf.push(ClientMessageType::SetPixelFormat as u8);
    buf.extend_from_slice(&[0, 0, 0]); // padding
    buf.extend_from_slice(&pf.to_bytes());
    buf
}

/// Build SetEncodings message (§7.5.2).
/// 1 byte type + 1 padding + 2 bytes count + 4 bytes per encoding.
pub fn build_set_encodings(encodings: &[EncodingType]) -> Vec<u8> {
    let count = encodings.len() as u16;
    let mut buf = Vec::with_capacity(4 + encodings.len() * 4);
    buf.push(ClientMessageType::SetEncodings as u8);
    buf.push(0); // padding
    buf.push((count >> 8) as u8);
    buf.push((count & 0xFF) as u8);
    for enc in encodings {
        let v = enc.to_i32();
        buf.push((v >> 24) as u8);
        buf.push((v >> 16) as u8);
        buf.push((v >> 8) as u8);
        buf.push(v as u8);
    }
    buf
}

/// Build FramebufferUpdateRequest (§7.5.3).
/// `incremental`: 0 = full, 1 = incremental.
pub fn build_fb_update_request(
    incremental: bool,
    x: u16,
    y: u16,
    width: u16,
    height: u16,
) -> Vec<u8> {
    let mut buf = Vec::with_capacity(10);
    buf.push(ClientMessageType::FramebufferUpdateRequest as u8);
    buf.push(if incremental { 1 } else { 0 });
    buf.extend_from_slice(&x.to_be_bytes());
    buf.extend_from_slice(&y.to_be_bytes());
    buf.extend_from_slice(&width.to_be_bytes());
    buf.extend_from_slice(&height.to_be_bytes());
    buf
}

/// Build KeyEvent message (§7.5.4).
pub fn build_key_event(down: bool, key: u32) -> Vec<u8> {
    let mut buf = Vec::with_capacity(8);
    buf.push(ClientMessageType::KeyEvent as u8);
    buf.push(if down { 1 } else { 0 });
    buf.extend_from_slice(&[0, 0]); // padding
    buf.extend_from_slice(&key.to_be_bytes());
    buf
}

/// Build PointerEvent message (§7.5.5).
pub fn build_pointer_event(button_mask: u8, x: u16, y: u16) -> Vec<u8> {
    let mut buf = Vec::with_capacity(6);
    buf.push(ClientMessageType::PointerEvent as u8);
    buf.push(button_mask);
    buf.extend_from_slice(&x.to_be_bytes());
    buf.extend_from_slice(&y.to_be_bytes());
    buf
}

/// Build ClientCutText message (§7.5.6).
pub fn build_client_cut_text(text: &str) -> Vec<u8> {
    let text_bytes = text.as_bytes();
    let len = text_bytes.len() as u32;
    let mut buf = Vec::with_capacity(8 + text_bytes.len());
    buf.push(ClientMessageType::ClientCutText as u8);
    buf.extend_from_slice(&[0, 0, 0]); // padding
    buf.extend_from_slice(&len.to_be_bytes());
    buf.extend_from_slice(text_bytes);
    buf
}

// ── Server → Client parsing helpers ─────────────────────────────────────

/// Parse the server message type from the first byte.
pub fn parse_server_message_type(byte: u8) -> Option<ServerMessageType> {
    ServerMessageType::from_byte(byte)
}

/// Parse the 12-byte RFB version banner string.
pub fn parse_version_string(buf: &[u8; 12]) -> String {
    String::from_utf8_lossy(buf).trim().to_string()
}

/// Parse server init message after the security handshake.
/// Returns (width, height, pixel_format, name).
pub fn parse_server_init(data: &[u8]) -> Result<(u16, u16, PixelFormat, String), String> {
    if data.len() < 24 {
        return Err(format!("ServerInit too short: {} bytes", data.len()));
    }
    let width = u16::from_be_bytes([data[0], data[1]]);
    let height = u16::from_be_bytes([data[2], data[3]]);

    let mut pf_bytes = [0u8; 16];
    pf_bytes.copy_from_slice(&data[4..20]);
    let pixel_format = PixelFormat::from_bytes(&pf_bytes);

    let name_len = u32::from_be_bytes([data[20], data[21], data[22], data[23]]) as usize;

    let name = if data.len() >= 24 + name_len {
        String::from_utf8_lossy(&data[24..24 + name_len]).to_string()
    } else {
        String::new()
    };

    Ok((width, height, pixel_format, name))
}

/// Parse a FramebufferUpdate rectangle header (12 bytes).
/// Returns (x, y, width, height, encoding_type).
pub fn parse_rect_header(data: &[u8]) -> Result<(u16, u16, u16, u16, EncodingType), String> {
    if data.len() < 12 {
        return Err("Rectangle header too short".into());
    }
    let x = u16::from_be_bytes([data[0], data[1]]);
    let y = u16::from_be_bytes([data[2], data[3]]);
    let w = u16::from_be_bytes([data[4], data[5]]);
    let h = u16::from_be_bytes([data[6], data[7]]);
    let enc = i32::from_be_bytes([data[8], data[9], data[10], data[11]]);
    Ok((x, y, w, h, EncodingType::from_i32(enc)))
}

/// Parse security type list (RFB 3.7+).
/// `data` is the bytes *after* the count byte.
pub fn parse_security_types(count: u8, data: &[u8]) -> Vec<u8> {
    data.iter().take(count as usize).copied().collect()
}

/// Parse the VNC authentication challenge (16 bytes).
pub fn parse_vnc_auth_challenge(data: &[u8]) -> Result<[u8; 16], String> {
    if data.len() < 16 {
        return Err("VNC auth challenge too short".into());
    }
    let mut challenge = [0u8; 16];
    challenge.copy_from_slice(&data[..16]);
    Ok(challenge)
}

/// Parse security result (4 bytes, big-endian u32). 0 = OK.
pub fn parse_security_result(data: &[u8]) -> Result<u32, String> {
    if data.len() < 4 {
        return Err("Security result too short".into());
    }
    Ok(u32::from_be_bytes([data[0], data[1], data[2], data[3]]))
}

/// Parse ServerCutText length (after the 3 padding bytes).
pub fn parse_cut_text_length(data: &[u8]) -> Result<u32, String> {
    if data.len() < 4 {
        return Err("CutText length too short".into());
    }
    Ok(u32::from_be_bytes([data[0], data[1], data[2], data[3]]))
}

/// Build the 4-byte ClientInit message. `shared` = allow other clients.
pub fn build_client_init(shared: bool) -> Vec<u8> {
    vec![if shared { 1 } else { 0 }]
}

/// Resolve encoding type from a name string.
pub fn encoding_from_name(name: &str) -> Option<EncodingType> {
    match name.to_lowercase().as_str() {
        "raw" => Some(EncodingType::Raw),
        "copyrect" => Some(EncodingType::CopyRect),
        "rre" => Some(EncodingType::RRE),
        "hextile" => Some(EncodingType::Hextile),
        "trle" => Some(EncodingType::TRLE),
        "zrle" => Some(EncodingType::ZRLE),
        "tight" => Some(EncodingType::Tight),
        _ => None,
    }
}

/// Convert a list of encoding name strings into encoding types,
/// automatically appending pseudo-encodings.
pub fn resolve_encodings(names: &[String], local_cursor: bool) -> Vec<EncodingType> {
    let mut result: Vec<EncodingType> = names
        .iter()
        .filter_map(|n| encoding_from_name(n))
        .collect();

    // Always include CopyRect if not already present.
    if !result.contains(&EncodingType::CopyRect) {
        result.push(EncodingType::CopyRect);
    }

    // Pseudo-encodings.
    if local_cursor {
        result.push(EncodingType::CursorPseudo);
    }
    result.push(EncodingType::DesktopSizePseudo);
    result.push(EncodingType::ExtendedDesktopSizePseudo);
    result.push(EncodingType::LastRectPseudo);

    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::vnc::types::{keysym, mouse_button};

    // ── SetPixelFormat ──────────────────────────────────────────────

    #[test]
    fn set_pixel_format_length() {
        let msg = build_set_pixel_format(&PixelFormat::rgba32());
        assert_eq!(msg.len(), 20);
        assert_eq!(msg[0], ClientMessageType::SetPixelFormat as u8);
    }

    #[test]
    fn set_pixel_format_contains_format_bytes() {
        let pf = PixelFormat::rgba32();
        let msg = build_set_pixel_format(&pf);
        let pf_bytes = pf.to_bytes();
        assert_eq!(&msg[4..20], &pf_bytes);
    }

    // ── SetEncodings ────────────────────────────────────────────────

    #[test]
    fn set_encodings_empty() {
        let msg = build_set_encodings(&[]);
        assert_eq!(msg.len(), 4);
        assert_eq!(msg[0], ClientMessageType::SetEncodings as u8);
        assert_eq!(msg[2], 0);
        assert_eq!(msg[3], 0);
    }

    #[test]
    fn set_encodings_multiple() {
        let encs = vec![EncodingType::ZRLE, EncodingType::Raw, EncodingType::CopyRect];
        let msg = build_set_encodings(&encs);
        assert_eq!(msg.len(), 4 + 3 * 4);
        let count = u16::from_be_bytes([msg[2], msg[3]]);
        assert_eq!(count, 3);
    }

    #[test]
    fn set_encodings_negative_encoding() {
        let encs = vec![EncodingType::CursorPseudo];
        let msg = build_set_encodings(&encs);
        let enc_val = i32::from_be_bytes([msg[4], msg[5], msg[6], msg[7]]);
        assert_eq!(enc_val, -239);
    }

    // ── FramebufferUpdateRequest ────────────────────────────────────

    #[test]
    fn fb_update_request_length() {
        let msg = build_fb_update_request(true, 0, 0, 1920, 1080);
        assert_eq!(msg.len(), 10);
        assert_eq!(msg[0], ClientMessageType::FramebufferUpdateRequest as u8);
    }

    #[test]
    fn fb_update_request_incremental() {
        let msg = build_fb_update_request(true, 0, 0, 100, 100);
        assert_eq!(msg[1], 1);
    }

    #[test]
    fn fb_update_request_full() {
        let msg = build_fb_update_request(false, 0, 0, 100, 100);
        assert_eq!(msg[1], 0);
    }

    #[test]
    fn fb_update_request_coordinates() {
        let msg = build_fb_update_request(true, 100, 200, 300, 400);
        let x = u16::from_be_bytes([msg[2], msg[3]]);
        let y = u16::from_be_bytes([msg[4], msg[5]]);
        let w = u16::from_be_bytes([msg[6], msg[7]]);
        let h = u16::from_be_bytes([msg[8], msg[9]]);
        assert_eq!(x, 100);
        assert_eq!(y, 200);
        assert_eq!(w, 300);
        assert_eq!(h, 400);
    }

    // ── KeyEvent ────────────────────────────────────────────────────

    #[test]
    fn key_event_length() {
        let msg = build_key_event(true, keysym::RETURN);
        assert_eq!(msg.len(), 8);
        assert_eq!(msg[0], ClientMessageType::KeyEvent as u8);
    }

    #[test]
    fn key_event_down() {
        let msg = build_key_event(true, keysym::F1);
        assert_eq!(msg[1], 1);
        let key = u32::from_be_bytes([msg[4], msg[5], msg[6], msg[7]]);
        assert_eq!(key, keysym::F1);
    }

    #[test]
    fn key_event_up() {
        let msg = build_key_event(false, keysym::ESCAPE);
        assert_eq!(msg[1], 0);
    }

    // ── PointerEvent ────────────────────────────────────────────────

    #[test]
    fn pointer_event_length() {
        let msg = build_pointer_event(0, 100, 200);
        assert_eq!(msg.len(), 6);
        assert_eq!(msg[0], ClientMessageType::PointerEvent as u8);
    }

    #[test]
    fn pointer_event_buttons_and_coords() {
        let mask = mouse_button::LEFT | mouse_button::RIGHT;
        let msg = build_pointer_event(mask, 500, 300);
        assert_eq!(msg[1], mask);
        let x = u16::from_be_bytes([msg[2], msg[3]]);
        let y = u16::from_be_bytes([msg[4], msg[5]]);
        assert_eq!(x, 500);
        assert_eq!(y, 300);
    }

    // ── ClientCutText ───────────────────────────────────────────────

    #[test]
    fn client_cut_text_length() {
        let msg = build_client_cut_text("hello");
        assert_eq!(msg.len(), 8 + 5);
        assert_eq!(msg[0], ClientMessageType::ClientCutText as u8);
    }

    #[test]
    fn client_cut_text_contains_text() {
        let msg = build_client_cut_text("test");
        let len = u32::from_be_bytes([msg[4], msg[5], msg[6], msg[7]]);
        assert_eq!(len, 4);
        assert_eq!(&msg[8..], b"test");
    }

    #[test]
    fn client_cut_text_empty() {
        let msg = build_client_cut_text("");
        assert_eq!(msg.len(), 8);
        let len = u32::from_be_bytes([msg[4], msg[5], msg[6], msg[7]]);
        assert_eq!(len, 0);
    }

    // ── Server init parsing ─────────────────────────────────────────

    #[test]
    fn parse_server_init_basic() {
        let mut data = Vec::new();
        // width=800, height=600
        data.extend_from_slice(&800u16.to_be_bytes());
        data.extend_from_slice(&600u16.to_be_bytes());
        // pixel format (16 bytes)
        data.extend_from_slice(&PixelFormat::rgba32().to_bytes());
        // name length = 3
        data.extend_from_slice(&3u32.to_be_bytes());
        data.extend_from_slice(b"VNC");

        let (w, h, pf, name) = parse_server_init(&data).unwrap();
        assert_eq!(w, 800);
        assert_eq!(h, 600);
        assert_eq!(pf, PixelFormat::rgba32());
        assert_eq!(name, "VNC");
    }

    #[test]
    fn parse_server_init_too_short() {
        let data = vec![0u8; 10];
        assert!(parse_server_init(&data).is_err());
    }

    #[test]
    fn parse_server_init_no_name_data() {
        let mut data = Vec::new();
        data.extend_from_slice(&1920u16.to_be_bytes());
        data.extend_from_slice(&1080u16.to_be_bytes());
        data.extend_from_slice(&PixelFormat::rgba32().to_bytes());
        data.extend_from_slice(&5u32.to_be_bytes()); // says 5 bytes but we don't include them

        let (w, h, _, name) = parse_server_init(&data).unwrap();
        assert_eq!(w, 1920);
        assert_eq!(h, 1080);
        assert_eq!(name, ""); // graceful fallback
    }

    // ── Rect header parsing ─────────────────────────────────────────

    #[test]
    fn parse_rect_header_raw() {
        let mut data = Vec::new();
        data.extend_from_slice(&10u16.to_be_bytes());  // x
        data.extend_from_slice(&20u16.to_be_bytes());  // y
        data.extend_from_slice(&100u16.to_be_bytes()); // w
        data.extend_from_slice(&200u16.to_be_bytes()); // h
        data.extend_from_slice(&0i32.to_be_bytes());   // Raw encoding

        let (x, y, w, h, enc) = parse_rect_header(&data).unwrap();
        assert_eq!(x, 10);
        assert_eq!(y, 20);
        assert_eq!(w, 100);
        assert_eq!(h, 200);
        assert_eq!(enc, EncodingType::Raw);
    }

    #[test]
    fn parse_rect_header_copyrect() {
        let mut data = Vec::new();
        data.extend_from_slice(&0u16.to_be_bytes());
        data.extend_from_slice(&0u16.to_be_bytes());
        data.extend_from_slice(&50u16.to_be_bytes());
        data.extend_from_slice(&50u16.to_be_bytes());
        data.extend_from_slice(&1i32.to_be_bytes()); // CopyRect

        let (_, _, _, _, enc) = parse_rect_header(&data).unwrap();
        assert_eq!(enc, EncodingType::CopyRect);
    }

    #[test]
    fn parse_rect_header_pseudo_encoding() {
        let mut data = Vec::new();
        data.extend_from_slice(&0u16.to_be_bytes());
        data.extend_from_slice(&0u16.to_be_bytes());
        data.extend_from_slice(&1920u16.to_be_bytes());
        data.extend_from_slice(&1080u16.to_be_bytes());
        data.extend_from_slice(&(-223i32).to_be_bytes()); // DesktopSize pseudo

        let (_, _, w, h, enc) = parse_rect_header(&data).unwrap();
        assert_eq!(w, 1920);
        assert_eq!(h, 1080);
        assert_eq!(enc, EncodingType::DesktopSizePseudo);
    }

    #[test]
    fn parse_rect_header_too_short() {
        assert!(parse_rect_header(&[0; 8]).is_err());
    }

    // ── Security helpers ────────────────────────────────────────────

    #[test]
    fn parse_security_types_list() {
        let types = parse_security_types(3, &[1, 2, 16, 99]);
        assert_eq!(types, vec![1, 2, 16]);
    }

    #[test]
    fn parse_vnc_auth_challenge_ok() {
        let data = vec![0u8; 16];
        let challenge = parse_vnc_auth_challenge(&data).unwrap();
        assert_eq!(challenge.len(), 16);
    }

    #[test]
    fn parse_vnc_auth_challenge_short() {
        assert!(parse_vnc_auth_challenge(&[0; 10]).is_err());
    }

    #[test]
    fn parse_security_result_ok() {
        let data = 0u32.to_be_bytes();
        assert_eq!(parse_security_result(&data).unwrap(), 0);
    }

    #[test]
    fn parse_security_result_fail() {
        let data = 1u32.to_be_bytes();
        assert_eq!(parse_security_result(&data).unwrap(), 1);
    }

    // ── Client init ─────────────────────────────────────────────────

    #[test]
    fn client_init_shared() {
        assert_eq!(build_client_init(true), vec![1]);
    }

    #[test]
    fn client_init_exclusive() {
        assert_eq!(build_client_init(false), vec![0]);
    }

    // ── Encoding resolution ─────────────────────────────────────────

    #[test]
    fn encoding_from_name_known() {
        assert_eq!(encoding_from_name("Raw"), Some(EncodingType::Raw));
        assert_eq!(encoding_from_name("zrle"), Some(EncodingType::ZRLE));
        assert_eq!(encoding_from_name("TIGHT"), Some(EncodingType::Tight));
    }

    #[test]
    fn encoding_from_name_unknown() {
        assert!(encoding_from_name("nonexistent").is_none());
    }

    #[test]
    fn resolve_encodings_adds_pseudo() {
        let names = vec!["ZRLE".into(), "Raw".into()];
        let resolved = resolve_encodings(&names, true);
        assert!(resolved.contains(&EncodingType::ZRLE));
        assert!(resolved.contains(&EncodingType::Raw));
        assert!(resolved.contains(&EncodingType::CopyRect));
        assert!(resolved.contains(&EncodingType::CursorPseudo));
        assert!(resolved.contains(&EncodingType::DesktopSizePseudo));
    }

    #[test]
    fn resolve_encodings_no_cursor() {
        let names = vec!["Raw".into()];
        let resolved = resolve_encodings(&names, false);
        assert!(!resolved.contains(&EncodingType::CursorPseudo));
        assert!(resolved.contains(&EncodingType::DesktopSizePseudo));
    }

    #[test]
    fn resolve_encodings_copyrect_not_duplicated() {
        let names = vec!["CopyRect".into(), "Raw".into()];
        let resolved = resolve_encodings(&names, false);
        let count = resolved.iter().filter(|e| **e == EncodingType::CopyRect).count();
        assert_eq!(count, 1);
    }

    // ── Version string ──────────────────────────────────────────────

    #[test]
    fn parse_version_string_trims() {
        let v = parse_version_string(b"RFB 003.008\n");
        assert_eq!(v, "RFB 003.008");
    }
}
