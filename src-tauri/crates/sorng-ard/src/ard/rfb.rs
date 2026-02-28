//! RFB (Remote Framebuffer) protocol layer for ARD.
//!
//! Implements the core VNC wire protocol that ARD is built on:
//! version negotiation, security type selection, server-init, and the
//! message loop (framebuffer updates, pointer/keyboard events, etc.).
//!
//! Apple-specific security type 30 (ARD auth) is handled in [`super::auth`].

use byteorder::{BigEndian, ReadBytesExt, WriteBytesExt};
use std::io::{Read, Write};
use std::net::TcpStream;
use std::time::Duration;

use super::errors::ArdError;
use super::pixel_format::PixelFormat;

// ── RFB protocol constants ───────────────────────────────────────────────

/// Standard VNC security type identifiers.
pub mod security {
    /// No authentication.
    pub const NONE: u8 = 1;
    /// Classic VNC DES challenge-response.
    pub const VNC_AUTH: u8 = 2;
    /// Apple Remote Desktop (Diffie-Hellman + AES).
    pub const ARD_AUTH: u8 = 30;
    /// TLS (tight/vencrypt).
    pub const TLS: u8 = 18;
    /// VeNCrypt wrapper.
    pub const VENCRYPT: u8 = 19;
    /// Apple-specific extended security.
    pub const APPLE_EXT: u8 = 35;
}

/// RFB client → server message types.
pub mod client_msg {
    pub const SET_PIXEL_FORMAT: u8 = 0;
    pub const SET_ENCODINGS: u8 = 2;
    pub const FRAMEBUFFER_UPDATE_REQUEST: u8 = 3;
    pub const KEY_EVENT: u8 = 4;
    pub const POINTER_EVENT: u8 = 5;
    pub const CLIENT_CUT_TEXT: u8 = 6;
}

/// RFB server → client message types.
pub mod server_msg {
    pub const FRAMEBUFFER_UPDATE: u8 = 0;
    pub const SET_COLOUR_MAP_ENTRIES: u8 = 1;
    pub const BELL: u8 = 2;
    pub const SERVER_CUT_TEXT: u8 = 3;
}

/// Standard and Apple-specific pseudo-encoding IDs.
pub mod encoding {
    pub const RAW: i32 = 0;
    pub const COPY_RECT: i32 = 1;
    pub const RRE: i32 = 2;
    pub const HEXTILE: i32 = 5;
    pub const ZLIB: i32 = 6;
    pub const TIGHT: i32 = 7;
    pub const ZLIBHEX: i32 = 8;
    pub const ZRLE: i32 = 16;
    pub const CURSOR: i32 = -239;
    pub const DESKTOP_SIZE: i32 = -223;

    // ── Apple-specific ───────────────────────────────────────────────
    /// Apple Remote Desktop JPEG encoding.
    pub const APPLE_JPEG: i32 = 0x574D5600; // 'WMV\0' = 1464812032
    /// Apple clipboard pseudo-encoding.
    pub const APPLE_CLIPBOARD: i32 = 0x574D5601;
    /// Apple file-transfer pseudo-encoding.
    pub const APPLE_FILE_TRANSFER: i32 = 0x574D5602;
    /// Apple curtain-mode pseudo-encoding.
    pub const APPLE_CURTAIN: i32 = 0x574D5604;
    /// Apple Retina / HiDPI pseudo-encoding.
    pub const APPLE_RETINA: i32 = 0x574D5605;
    /// Apple 1608 pseudo-encoding (extended desktop).
    pub const APPLE_EXTENDED: i32 = 0x574D5648;
}

// ── Server init data ─────────────────────────────────────────────────────

/// Information received from the server during the ServerInit message.
#[derive(Debug, Clone)]
pub struct ServerInit {
    pub framebuffer_width: u16,
    pub framebuffer_height: u16,
    pub pixel_format: PixelFormat,
    pub name: String,
}

// ── RFB connection ───────────────────────────────────────────────────────

/// Low-level RFB connection wrapping a `TcpStream`.
pub struct RfbConnection {
    stream: TcpStream,
    /// RFB version chosen during negotiation.
    pub version: RfbVersion,
    /// Server init data (available after `handshake` completes).
    pub server_init: Option<ServerInit>,
}

/// RFB protocol version.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RfbVersion {
    V3_3,
    V3_7,
    V3_8,
    Unknown,
}

impl RfbVersion {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::V3_3 => "003.003",
            Self::V3_7 => "003.007",
            Self::V3_8 => "003.008",
            Self::Unknown => "unknown",
        }
    }
}

impl RfbConnection {
    // ── Construction ─────────────────────────────────────────────────────

    /// Connect to a VNC/ARD server over TCP.
    pub fn connect(host: &str, port: u16, timeout: Duration) -> Result<Self, ArdError> {
        let addr = format!("{host}:{port}");
        log::info!("RFB: connecting to {addr} (timeout {timeout:?})");

        let stream = TcpStream::connect_timeout(
            &addr
                .parse()
                .map_err(|e| ArdError::Protocol(format!("invalid address: {e}")))?,
            timeout,
        )?;
        stream.set_nodelay(true)?;
        stream.set_read_timeout(Some(Duration::from_secs(30)))?;
        stream.set_write_timeout(Some(Duration::from_secs(10)))?;

        Ok(Self {
            stream,
            version: RfbVersion::Unknown,
            server_init: None,
        })
    }

    /// Wrap an already-connected `TcpStream`.
    pub fn from_stream(stream: TcpStream) -> Self {
        Self {
            stream,
            version: RfbVersion::Unknown,
            server_init: None,
        }
    }

    /// Access the underlying stream (e.g. for the auth module).
    pub fn stream_mut(&mut self) -> &mut TcpStream {
        &mut self.stream
    }

    pub fn stream_ref(&self) -> &TcpStream {
        &self.stream
    }

    /// Attempt to clone the TCP stream (for split read/write paths).
    pub fn try_clone_stream(&self) -> Result<TcpStream, ArdError> {
        self.stream.try_clone().map_err(ArdError::Io)
    }

    // ── Version negotiation ──────────────────────────────────────────────

    /// Read the 12-byte server version string, choose a version, and
    /// respond.  Returns the negotiated [`RfbVersion`].
    pub fn negotiate_version(&mut self) -> Result<RfbVersion, ArdError> {
        let mut buf = [0u8; 12];
        self.stream.read_exact(&mut buf)?;
        let server_version = String::from_utf8_lossy(&buf);
        log::info!("RFB: server version = {}", server_version.trim());

        let version = if server_version.starts_with("RFB 003.008") {
            RfbVersion::V3_8
        } else if server_version.starts_with("RFB 003.007") {
            RfbVersion::V3_7
        } else if server_version.starts_with("RFB 003.003") {
            RfbVersion::V3_3
        } else {
            log::warn!("RFB: unknown version '{}'", server_version.trim());
            // Try to proceed with 3.8 anyway (Apple servers usually accept).
            RfbVersion::V3_8
        };

        // We always respond with 3.8 (the highest we support).
        let response = match version {
            RfbVersion::V3_3 => b"RFB 003.003\n",
            _ => b"RFB 003.008\n",
        };
        self.stream.write_all(response)?;
        self.stream.flush()?;
        self.version = version;
        Ok(version)
    }

    // ── Security negotiation ─────────────────────────────────────────────

    /// Read the security types offered by the server (RFB 3.7+).
    /// Returns the raw list of type bytes.
    pub fn read_security_types(&mut self) -> Result<Vec<u8>, ArdError> {
        match self.version {
            RfbVersion::V3_3 => {
                // In 3.3, server sends a u32 security type directly.
                let sec = self.stream.read_u32::<BigEndian>()?;
                if sec == 0 {
                    let reason = self.read_reason_string()?;
                    return Err(ArdError::Auth(format!("server refused: {reason}")));
                }
                Ok(vec![sec as u8])
            }
            _ => {
                let count = self.stream.read_u8()?;
                if count == 0 {
                    let reason = self.read_reason_string()?;
                    return Err(ArdError::Auth(format!("server refused: {reason}")));
                }
                let mut types = vec![0u8; count as usize];
                self.stream.read_exact(&mut types)?;
                log::info!("RFB: security types offered: {types:?}");
                Ok(types)
            }
        }
    }

    /// Choose a security type from the offered list.  Preference order:
    /// ARD auth (30) > VNC auth (2) > None (1).
    pub fn choose_security_type(offered: &[u8]) -> Result<u8, ArdError> {
        let priority = [
            security::ARD_AUTH,
            security::VNC_AUTH,
            security::NONE,
            security::TLS,
            security::VENCRYPT,
        ];

        for &pref in &priority {
            if offered.contains(&pref) {
                return Ok(pref);
            }
        }

        Err(ArdError::UnsupportedSecurity(offered.to_vec()))
    }

    /// Tell the server which security type we chose (RFB 3.7+).
    pub fn send_security_type(&mut self, sec: u8) -> Result<(), ArdError> {
        if self.version != RfbVersion::V3_3 {
            self.stream.write_u8(sec)?;
            self.stream.flush()?;
        }
        Ok(())
    }

    /// Read the 4-byte SecurityResult. Returns `Ok(())` on success,
    /// or an error with the reason string on failure.
    pub fn read_security_result(&mut self) -> Result<(), ArdError> {
        let result = self.stream.read_u32::<BigEndian>()?;
        if result == 0 {
            Ok(())
        } else {
            let reason = if self.version == RfbVersion::V3_8 {
                self.read_reason_string()
                    .unwrap_or_else(|_| "unknown".into())
            } else {
                "authentication failed".into()
            };
            Err(ArdError::Auth(reason))
        }
    }

    // ── Client / Server init ─────────────────────────────────────────────

    /// Send the ClientInit message.  `shared` = true lets the server keep
    /// other clients connected.
    pub fn send_client_init(&mut self, shared: bool) -> Result<(), ArdError> {
        let flag: u8 = if shared { 1 } else { 0 };
        self.stream.write_u8(flag)?;
        self.stream.flush()?;
        Ok(())
    }

    /// Read the ServerInit message.  Populates `self.server_init`.
    pub fn read_server_init(&mut self) -> Result<ServerInit, ArdError> {
        let fb_width = self.stream.read_u16::<BigEndian>()?;
        let fb_height = self.stream.read_u16::<BigEndian>()?;
        let pixel_format = PixelFormat::read_from(&mut self.stream)?;
        let name_len = self.stream.read_u32::<BigEndian>()? as usize;
        let mut name_buf = vec![0u8; name_len];
        self.stream.read_exact(&mut name_buf)?;
        let name = String::from_utf8_lossy(&name_buf).into_owned();

        let init = ServerInit {
            framebuffer_width: fb_width,
            framebuffer_height: fb_height,
            pixel_format,
            name,
        };
        log::info!(
            "RFB: ServerInit – {}x{}, pf={:?}, name='{}'",
            fb_width,
            fb_height,
            init.pixel_format,
            init.name
        );
        self.server_init = Some(init.clone());
        Ok(init)
    }

    // ── Client → Server messages ─────────────────────────────────────────

    /// Send a SetPixelFormat message.
    pub fn set_pixel_format(&mut self, pf: &PixelFormat) -> Result<(), ArdError> {
        self.stream.write_u8(client_msg::SET_PIXEL_FORMAT)?;
        self.stream.write_all(&[0u8; 3])?; // padding
        pf.write_to(&mut self.stream)?;
        self.stream.flush()?;
        Ok(())
    }

    /// Send a SetEncodings message.
    pub fn set_encodings(&mut self, encodings: &[i32]) -> Result<(), ArdError> {
        self.stream.write_u8(client_msg::SET_ENCODINGS)?;
        self.stream.write_u8(0)?; // padding
        self.stream
            .write_u16::<BigEndian>(encodings.len() as u16)?;
        for &enc in encodings {
            self.stream.write_i32::<BigEndian>(enc)?;
        }
        self.stream.flush()?;
        Ok(())
    }

    /// Request a framebuffer update.
    pub fn request_framebuffer_update(
        &mut self,
        incremental: bool,
        x: u16,
        y: u16,
        width: u16,
        height: u16,
    ) -> Result<(), ArdError> {
        self.stream
            .write_u8(client_msg::FRAMEBUFFER_UPDATE_REQUEST)?;
        self.stream.write_u8(u8::from(incremental))?;
        self.stream.write_u16::<BigEndian>(x)?;
        self.stream.write_u16::<BigEndian>(y)?;
        self.stream.write_u16::<BigEndian>(width)?;
        self.stream.write_u16::<BigEndian>(height)?;
        self.stream.flush()?;
        Ok(())
    }

    /// Send a keyboard event.
    pub fn send_key_event(&mut self, down: bool, key: u32) -> Result<(), ArdError> {
        self.stream.write_u8(client_msg::KEY_EVENT)?;
        self.stream.write_u8(u8::from(down))?;
        self.stream.write_all(&[0u8; 2])?; // padding
        self.stream.write_u32::<BigEndian>(key)?;
        self.stream.flush()?;
        Ok(())
    }

    /// Send a pointer (mouse) event.
    pub fn send_pointer_event(
        &mut self,
        button_mask: u8,
        x: u16,
        y: u16,
    ) -> Result<(), ArdError> {
        self.stream.write_u8(client_msg::POINTER_EVENT)?;
        self.stream.write_u8(button_mask)?;
        self.stream.write_u16::<BigEndian>(x)?;
        self.stream.write_u16::<BigEndian>(y)?;
        self.stream.flush()?;
        Ok(())
    }

    /// Send clipboard text to the server.
    pub fn send_client_cut_text(&mut self, text: &str) -> Result<(), ArdError> {
        let bytes = text.as_bytes();
        self.stream.write_u8(client_msg::CLIENT_CUT_TEXT)?;
        self.stream.write_all(&[0u8; 3])?; // padding
        self.stream
            .write_u32::<BigEndian>(bytes.len() as u32)?;
        self.stream.write_all(bytes)?;
        self.stream.flush()?;
        Ok(())
    }

    // ── Server → Client message reading ──────────────────────────────────

    /// Read and return the next server message type byte.
    pub fn read_server_message_type(&mut self) -> Result<u8, ArdError> {
        Ok(self.stream.read_u8()?)
    }

    /// Read a FramebufferUpdate header: returns the rectangle count.
    pub fn read_framebuffer_update_header(&mut self) -> Result<u16, ArdError> {
        let _pad = self.stream.read_u8()?;
        Ok(self.stream.read_u16::<BigEndian>()?)
    }

    /// Read a single framebuffer-update rectangle header.
    pub fn read_rect_header(&mut self) -> Result<RectHeader, ArdError> {
        let x = self.stream.read_u16::<BigEndian>()?;
        let y = self.stream.read_u16::<BigEndian>()?;
        let w = self.stream.read_u16::<BigEndian>()?;
        let h = self.stream.read_u16::<BigEndian>()?;
        let encoding = self.stream.read_i32::<BigEndian>()?;
        Ok(RectHeader {
            x,
            y,
            width: w,
            height: h,
            encoding,
        })
    }

    /// Read exactly `n` bytes from the stream.
    pub fn read_exact(&mut self, buf: &mut [u8]) -> Result<(), ArdError> {
        self.stream.read_exact(buf)?;
        Ok(())
    }

    /// Read a u32 from the stream (big-endian).
    pub fn read_u32(&mut self) -> Result<u32, ArdError> {
        Ok(self.stream.read_u32::<BigEndian>()?)
    }

    /// Read a u16 from the stream (big-endian).
    pub fn read_u16(&mut self) -> Result<u16, ArdError> {
        Ok(self.stream.read_u16::<BigEndian>()?)
    }

    /// Read a u8.
    pub fn read_u8(&mut self) -> Result<u8, ArdError> {
        Ok(self.stream.read_u8()?)
    }

    /// Read a ServerCutText message body and return the text.
    pub fn read_server_cut_text(&mut self) -> Result<String, ArdError> {
        let mut pad = [0u8; 3];
        self.stream.read_exact(&mut pad)?;
        let len = self.stream.read_u32::<BigEndian>()? as usize;
        let mut buf = vec![0u8; len];
        self.stream.read_exact(&mut buf)?;
        Ok(String::from_utf8_lossy(&buf).into_owned())
    }

    // ── Helpers ──────────────────────────────────────────────────────────

    /// Read a reason string (u32 length + UTF-8 bytes).
    fn read_reason_string(&mut self) -> Result<String, ArdError> {
        let len = self.stream.read_u32::<BigEndian>()? as usize;
        let mut buf = vec![0u8; len];
        self.stream.read_exact(&mut buf)?;
        Ok(String::from_utf8_lossy(&buf).into_owned())
    }
}

/// Rectangle header from a FramebufferUpdate.
#[derive(Debug, Clone, Copy)]
pub struct RectHeader {
    pub x: u16,
    pub y: u16,
    pub width: u16,
    pub height: u16,
    pub encoding: i32,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn choose_security_prefers_ard() {
        let offered = vec![security::NONE, security::VNC_AUTH, security::ARD_AUTH];
        assert_eq!(
            RfbConnection::choose_security_type(&offered).unwrap(),
            security::ARD_AUTH
        );
    }

    #[test]
    fn choose_security_prefers_vnc_over_none() {
        let offered = vec![security::NONE, security::VNC_AUTH];
        assert_eq!(
            RfbConnection::choose_security_type(&offered).unwrap(),
            security::VNC_AUTH
        );
    }

    #[test]
    fn choose_security_none_only() {
        let offered = vec![security::NONE];
        assert_eq!(
            RfbConnection::choose_security_type(&offered).unwrap(),
            security::NONE
        );
    }

    #[test]
    fn choose_security_unsupported() {
        let offered = vec![99, 100];
        assert!(RfbConnection::choose_security_type(&offered).is_err());
    }

    #[test]
    fn rfb_version_strings() {
        assert_eq!(RfbVersion::V3_8.as_str(), "003.008");
        assert_eq!(RfbVersion::V3_7.as_str(), "003.007");
        assert_eq!(RfbVersion::V3_3.as_str(), "003.003");
    }
}
