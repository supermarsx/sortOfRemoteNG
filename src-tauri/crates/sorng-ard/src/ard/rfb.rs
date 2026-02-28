//! RFB protocol layer for ARD.
//!
//! Handles version negotiation, server-init, pixel format setup,
//! encoding requests, and the raw message I/O on an RFB connection.

use std::io::{self, Read, Write};
use std::net::TcpStream;

use super::errors::ArdError;
use super::pixel_format::PixelFormat;

/// RFB protocol versions.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RfbVersion {
    V3_3,
    V3_7,
    V3_8,
}

/// Server-init message data.
#[derive(Debug, Clone)]
pub struct ServerInit {
    pub width: u16,
    pub height: u16,
    pub pixel_format: PixelFormat,
    pub name: String,
}

/// A wrapper around a TCP stream for RFB I/O.
pub struct RfbConnection {
    stream: TcpStream,
}

impl RfbConnection {
    pub fn new(stream: TcpStream) -> Self {
        Self { stream }
    }

    // ── Primitive I/O ────────────────────────────────────────────────

    pub fn read_u8(&mut self) -> Result<u8, ArdError> {
        let mut buf = [0u8; 1];
        self.stream.read_exact(&mut buf)?;
        Ok(buf[0])
    }

    /// Non-blocking read of a single byte. Returns `Ok(None)` if no data.
    pub fn try_read_u8(&mut self) -> Result<Option<u8>, ArdError> {
        self.stream.set_nonblocking(true).ok();
        let mut buf = [0u8; 1];
        let result = self.stream.read_exact(&mut buf);
        self.stream.set_nonblocking(false).ok();
        match result {
            Ok(()) => Ok(Some(buf[0])),
            Err(ref e) if e.kind() == io::ErrorKind::WouldBlock => Ok(None),
            Err(e) => Err(ArdError::Io(e)),
        }
    }

    pub fn read_u16(&mut self) -> Result<u16, ArdError> {
        let mut buf = [0u8; 2];
        self.stream.read_exact(&mut buf)?;
        Ok(u16::from_be_bytes(buf))
    }

    pub fn read_u32(&mut self) -> Result<u32, ArdError> {
        let mut buf = [0u8; 4];
        self.stream.read_exact(&mut buf)?;
        Ok(u32::from_be_bytes(buf))
    }

    pub fn read_u64(&mut self) -> Result<u64, ArdError> {
        let mut buf = [0u8; 8];
        self.stream.read_exact(&mut buf)?;
        Ok(u64::from_be_bytes(buf))
    }

    pub fn read_exact(&mut self, buf: &mut [u8]) -> Result<(), ArdError> {
        self.stream.read_exact(buf)?;
        Ok(())
    }

    pub fn write_all(&mut self, data: &[u8]) -> Result<(), ArdError> {
        self.stream.write_all(data)?;
        Ok(())
    }

    // ── Version handshake ────────────────────────────────────────────

    /// Read the 12-byte RFB version string from the server.
    pub fn read_version(&mut self) -> Result<RfbVersion, ArdError> {
        let mut buf = [0u8; 12];
        self.read_exact(&mut buf)?;
        let ver = String::from_utf8_lossy(&buf);
        let ver = ver.trim();

        if ver.starts_with("RFB 003.008") {
            Ok(RfbVersion::V3_8)
        } else if ver.starts_with("RFB 003.007") {
            Ok(RfbVersion::V3_7)
        } else if ver.starts_with("RFB 003.003") {
            Ok(RfbVersion::V3_3)
        } else {
            // Treat unknown as 3.3 for maximum compat.
            log::warn!("Unknown RFB version: {ver}, falling back to 3.3");
            Ok(RfbVersion::V3_3)
        }
    }

    /// Write the 12-byte RFB version string.
    pub fn write_version(&mut self, version: &RfbVersion) -> Result<(), ArdError> {
        let ver_str = match version {
            RfbVersion::V3_3 => b"RFB 003.003\n",
            RfbVersion::V3_7 => b"RFB 003.007\n",
            RfbVersion::V3_8 => b"RFB 003.008\n",
        };
        self.write_all(ver_str)
    }

    // ── Server init ──────────────────────────────────────────────────

    pub fn read_server_init(&mut self) -> Result<ServerInit, ArdError> {
        let width = self.read_u16()?;
        let height = self.read_u16()?;
        let pixel_format = PixelFormat::read_from(&mut self.stream)
            .map_err(|e| ArdError::Protocol(format!("Read pixel format: {e}")))?;

        let name_len = self.read_u32()? as usize;
        let mut name_buf = vec![0u8; name_len];
        self.read_exact(&mut name_buf)?;
        let name = String::from_utf8_lossy(&name_buf).into_owned();

        Ok(ServerInit {
            width,
            height,
            pixel_format,
            name,
        })
    }

    // ── Client messages ──────────────────────────────────────────────

    /// SetPixelFormat (message type 0).
    pub fn send_set_pixel_format(&mut self, pf: &PixelFormat) -> Result<(), ArdError> {
        let mut msg = Vec::with_capacity(20);
        msg.push(client_msg::SET_PIXEL_FORMAT);
        msg.extend_from_slice(&[0, 0, 0]); // padding
        pf.write_to(&mut msg)
            .map_err(|e| ArdError::Protocol(format!("Write pixel format: {e}")))?;
        self.write_all(&msg)
    }

    /// SetEncodings (message type 2).
    pub fn send_set_encodings(&mut self, encodings: &[i32]) -> Result<(), ArdError> {
        let mut msg = Vec::with_capacity(4 + encodings.len() * 4);
        msg.push(client_msg::SET_ENCODINGS);
        msg.push(0); // padding
        msg.extend_from_slice(&(encodings.len() as u16).to_be_bytes());
        for &enc in encodings {
            msg.extend_from_slice(&enc.to_be_bytes());
        }
        self.write_all(&msg)
    }

    /// FramebufferUpdateRequest (message type 3).
    pub fn send_framebuffer_update_request(
        &mut self,
        incremental: bool,
        x: u16,
        y: u16,
        width: u16,
        height: u16,
    ) -> Result<(), ArdError> {
        let mut msg = [0u8; 10];
        msg[0] = client_msg::FRAMEBUFFER_UPDATE_REQUEST;
        msg[1] = incremental as u8;
        msg[2..4].copy_from_slice(&x.to_be_bytes());
        msg[4..6].copy_from_slice(&y.to_be_bytes());
        msg[6..8].copy_from_slice(&width.to_be_bytes());
        msg[8..10].copy_from_slice(&height.to_be_bytes());
        self.write_all(&msg)
    }

    /// KeyEvent (message type 4).
    pub fn send_key_event(&mut self, down: bool, key: u32) -> Result<(), ArdError> {
        let mut msg = [0u8; 8];
        msg[0] = client_msg::KEY_EVENT;
        msg[1] = down as u8;
        msg[2..4].copy_from_slice(&[0, 0]); // padding
        msg[4..8].copy_from_slice(&key.to_be_bytes());
        self.write_all(&msg)
    }

    /// PointerEvent (message type 5).
    pub fn send_pointer_event(
        &mut self,
        button_mask: u8,
        x: u16,
        y: u16,
    ) -> Result<(), ArdError> {
        let mut msg = [0u8; 6];
        msg[0] = client_msg::POINTER_EVENT;
        msg[1] = button_mask;
        msg[2..4].copy_from_slice(&x.to_be_bytes());
        msg[4..6].copy_from_slice(&y.to_be_bytes());
        self.write_all(&msg)
    }

    // ── Rect header ──────────────────────────────────────────────────

    pub fn read_rect_header(&mut self) -> Result<RectHeader, ArdError> {
        let x = self.read_u16()?;
        let y = self.read_u16()?;
        let width = self.read_u16()?;
        let height = self.read_u16()?;
        let encoding = self.read_u32()? as i32;
        Ok(RectHeader {
            x,
            y,
            width,
            height,
            encoding,
        })
    }
}

/// Header for a framebuffer-update rectangle.
#[derive(Debug, Clone)]
pub struct RectHeader {
    pub x: u16,
    pub y: u16,
    pub width: u16,
    pub height: u16,
    pub encoding: i32,
}

// ── Constants ────────────────────────────────────────────────────────────

pub mod security {
    pub const NONE: u8 = 1;
    pub const VNC_AUTH: u8 = 2;
    pub const TLS: u8 = 18;
    pub const VENCRYPT: u8 = 19;
    pub const ARD_AUTH: u8 = 30;
    pub const APPLE_EXT: u8 = 35;
}

pub mod client_msg {
    pub const SET_PIXEL_FORMAT: u8 = 0;
    pub const SET_ENCODINGS: u8 = 2;
    pub const FRAMEBUFFER_UPDATE_REQUEST: u8 = 3;
    pub const KEY_EVENT: u8 = 4;
    pub const POINTER_EVENT: u8 = 5;
    pub const CLIENT_CUT_TEXT: u8 = 6;
}

pub mod server_msg {
    pub const FRAMEBUFFER_UPDATE: u8 = 0;
    pub const SET_COLOUR_MAP_ENTRIES: u8 = 1;
    pub const BELL: u8 = 2;
    pub const SERVER_CUT_TEXT: u8 = 3;
}

pub mod encoding {
    pub const RAW: i32 = 0;
    pub const COPY_RECT: i32 = 1;
    pub const RRE: i32 = 2;
    pub const HEXTILE: i32 = 5;
    pub const ZLIB: i32 = 6;
    pub const TIGHT: i32 = 7;
    pub const ZLIBHEX: i32 = 8;
    pub const ZRLE: i32 = 16;

    // Pseudo-encodings
    pub const CURSOR: i32 = -239;         // 0xFFFFFF11
    pub const DESKTOP_SIZE: i32 = -223;   // 0xFFFFFF21

    // Apple pseudo-encodings
    pub const APPLE_JPEG: i32 = 0x574D5600_u32 as i32;
    pub const APPLE_CLIPBOARD: i32 = 0x574D5601_u32 as i32;
    pub const APPLE_FILE_TRANSFER: i32 = 0x574D5602_u32 as i32;
    pub const APPLE_CURTAIN: i32 = 0x574D5604_u32 as i32;
    pub const APPLE_RETINA: i32 = 0x574D5605_u32 as i32;
    pub const APPLE_EXTENDED: i32 = 0x574D5606_u32 as i32;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encoding_constants() {
        assert_eq!(encoding::RAW, 0);
        assert_eq!(encoding::ZRLE, 16);
        assert_ne!(encoding::APPLE_JPEG, 0);
    }

    #[test]
    fn security_constants() {
        assert_eq!(security::NONE, 1);
        assert_eq!(security::ARD_AUTH, 30);
    }

    #[test]
    fn rect_header_debug() {
        let h = RectHeader {
            x: 0,
            y: 0,
            width: 100,
            height: 50,
            encoding: encoding::RAW,
        };
        let s = format!("{h:?}");
        assert!(s.contains("100"));
    }
}
